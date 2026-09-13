// Phase C — incremental walker.
//
// Reads data/cursor.json, walks forward via the ord inscription `next` linked
// list, identifies cubes (HTML inscriptions matching the cube marker), and
// appends any finds to data/cubes.json. Re-sorts and re-numbers afterwards.
//
//   npm run grind                       # default 5000 iterations
//   MAX_ITERATIONS=50000 npm run grind  # backfill mode
//   STOP_AT_TIP=1 npm run grind         # exit early when caught up
//
// Designed to be idempotent: re-running with no new inscriptions is a no-op.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getInscription, getContent, getStatus, isNotFoundError } from './ord.mjs';
import { getFirstOwnerAddress, revealTxidFromInscriptionId } from './esplora.mjs';
import { parseCube } from './parse-cube.mjs';
import { applyPositionalNames } from './sort.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CUBES_PATH = path.join(DATA_DIR, 'cubes.json');
const CURSOR_PATH = path.join(DATA_DIR, 'cursor.json');

const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS ?? 5000);
const STOP_AT_TIP = process.env.STOP_AT_TIP === '1';
const HEARTBEAT_EVERY = 500;

// Metadata prefetch width. The walk follows `next` one id at a time, so on its
// own every step pays a full round-trip before the next id is even known.
// Inscription numbers are contiguous and `next` runs in number order, so the
// range ahead of the cursor can be fetched in parallel and the walk then reads
// from memory. The request COUNT upstream is unchanged; only wall-clock moves.
const CONCURRENCY = Number(process.env.ORD_CONCURRENCY ?? 8);

// Cube content shape — narrow enough to skip the vast majority of inscriptions
// cheaply on metadata alone.
const HTML_CONTENT_TYPES = new Set(['text/html;charset=utf-8', 'text/html']);
const MIN_LEN = 400;
const MAX_LEN = 900;

// ---------------------------------------------------------------------------

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf-8'));
}

function looksLikeCubeShape(meta) {
  if (!HTML_CONTENT_TYPES.has((meta.content_type ?? '').toLowerCase())) return false;
  const len = meta.content_length;
  return typeof len === 'number' && len >= MIN_LEN && len <= MAX_LEN;
}

/**
 * Fetch metadata for the contiguous number range [from, to] with bounded
 * concurrency, keyed by inscription id.
 *
 * The `next` chain remains the source of truth for the walk; this map is only a
 * cache in front of it. A number that 404s, errors, or turns out not to sit on
 * the chain is simply absent, and the walk fetches that id directly. So a gap, a
 * reorg or a cursed inscription costs one request, never correctness.
 */
async function prefetchByNumber(from, to) {
  if (to < from) return new Map();

  const numbers = [];
  for (let n = from; n <= to; n++) numbers.push(n);

  const byId = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < numbers.length) {
      const n = numbers[nextIndex++];
      try {
        const meta = await getInscription(n);
        if (meta?.id) byId.set(meta.id, meta);
      } catch {
        // Absent from the map on purpose: the walk falls back to a live fetch.
      }
    }
  }

  const workers = Math.min(CONCURRENCY, numbers.length);
  await Promise.all(Array.from({ length: workers }, worker));
  console.log(`  prefetched ${byId.size}/${numbers.length} ahead (concurrency ${workers})`);
  return byId;
}


async function main() {
  const startedAt = Date.now();

  const cubes = await readJson(CUBES_PATH);
  const cursor = await readJson(CURSOR_PATH);
  // blessed_inscriptions is a count, so the newest inscription's number is one
  // less. Using the count directly overstates the gap and makes the STOP_AT_TIP
  // comparison below unreachable.
  const tip = (await getStatus()).blessed_inscriptions - 1;

  console.log(`Cursor: ${cursor.lastScannedId} (#${cursor.lastScannedNumber})`);
  console.log(`Tip:    ${tip}  (gap ${(tip - cursor.lastScannedNumber).toLocaleString()})`);
  console.log(`Budget: ${MAX_ITERATIONS} iterations`);

  const knownIds = new Set(cubes.map((c) => c.inscriptionId));
  const foundThisRun = [];

  let currentId = cursor.lastScannedId;
  let currentMeta;
  try {
    currentMeta = await getInscription(currentId);
  } catch (err) {
    // ord tip can regress relative to our cursor (a reorg, or an
    // upstream hiccup that outlasts the retry budget). The cursor's
    // inscription id genuinely doesn't resolve. Exit cleanly: the next
    // scheduled run tries again once ord catches back up, and CI stays
    // green instead of turning red on a transient upstream state we
    // don't control.
    if (isNotFoundError(err)) {
      console.warn(`Cursor 404 after retries — ord probably in a rewind window (tip=${tip}, cursor #${cursor.lastScannedNumber}). Exiting clean; the next run will retry.`);
      return;
    }
    throw err;
  }

  // Pull the range ahead of the cursor in parallel, so the walk below reads
  // metadata from memory instead of paying a round-trip before it can even learn
  // the next id. Bounded by the same iteration budget the walk uses. Anchored on
  // currentMeta.number (what ord says) rather than the persisted cursor number.
  const prefetched = await prefetchByNumber(
    currentMeta.number + 1,
    Math.min(tip, currentMeta.number + MAX_ITERATIONS),
  );

  let iter = 0;
  let reachedTip = false;

  while (iter < MAX_ITERATIONS) {
    const nextId = currentMeta.next;
    if (!nextId) {
      reachedTip = true;
      console.log('  reached tip — no more inscriptions');
      break;
    }

    let nextMeta;
    try {
      nextMeta = prefetched.get(nextId) ?? await getInscription(nextId);
    } catch (err) {
      if (isNotFoundError(err)) {
        // Persistent 404 on a mid-walk id: ord isn't going to resolve
        // this even after retries. Exit clean and let the next run
        // pick up if the linked list heals; don't advance the cursor
        // past a broken link.
        console.warn(`  mid-walk 404 on ${nextId} — ord returned 404 after retries. Exiting clean.`);
        return;
      }
      console.warn(`  fetch metadata failed for ${nextId}: ${err.message} — aborting run`);
      break;
    }

    if (looksLikeCubeShape(nextMeta) && !knownIds.has(nextId)) {
      try {
        const body = await getContent(nextId);
        const attributes = parseCube(body);
        if (attributes) {
          // First-owner address = the mint recipient's ordinals address,
          // read from vout[0] of the reveal tx (immutable, so writes once
          // and caches forever). Consumers filter cubes by this to derive
          // "cubes minted by the currently-connected wallet" without any
          // per-user storage. On failure (esplora hiccup, unrecognised
          // script type) we log + persist null; the backfill script picks
          // stragglers up on a re-run.
          let firstOwner = null;
          try {
            const revealTxid = revealTxidFromInscriptionId(nextId);
            firstOwner = await getFirstOwnerAddress(revealTxid);
          } catch (err) {
            console.warn(`  firstOwner fetch failed for ${nextId}: ${err.message}`);
          }
          foundThisRun.push({
            inscriptionId: nextId,
            inscriptionNumber: nextMeta.number,
            blockHeight: nextMeta.height,
            timestamp: nextMeta.timestamp,
            contentLength: nextMeta.content_length,
            firstOwner,
            attributes,
          });
          knownIds.add(nextId);
          console.log(`  ✓ cube #?: ${nextId} (number ${nextMeta.number})`);
        }
      } catch (err) {
        console.warn(`  content fetch failed for ${nextId}: ${err.message}`);
      }
    }

    currentId = nextId;
    currentMeta = nextMeta;
    iter++;

    if (iter % HEARTBEAT_EVERY === 0) {
      console.log(`  …${iter}/${MAX_ITERATIONS} (at number ${currentMeta.number})`);
    }

    if (STOP_AT_TIP && currentMeta.number >= tip) {
      reachedTip = true;
      break;
    }
  }

  // Merge & re-rank — applyPositionalNames sorts by (blockHeight, number)
  // and reassigns "Ordinal Cube #N" labels from the sorted position.
  if (foundThisRun.length > 0) {
    cubes.push(...foundThisRun);
    const renamed = applyPositionalNames(cubes);
    await writeFile(CUBES_PATH, JSON.stringify(renamed, null, 2) + '\n');
  }

  const newCursor = {
    lastScannedId: currentId,
    lastScannedNumber: currentMeta.number,
    lastScannedBlockHeight: currentMeta.height,
    lastScannedBlockTimestamp: currentMeta.timestamp,
    blessedTipAtLastRun: tip,
    lastScanAt: new Date().toISOString(),
    source: 'grind',
  };
  await writeFile(CURSOR_PATH, JSON.stringify(newCursor, null, 2) + '\n');

  console.log('');
  console.log('='.repeat(60));
  console.log('GRIND DONE');
  console.log('='.repeat(60));
  console.log(`  Iterations:     ${iter}`);
  console.log(`  New cubes:      ${foundThisRun.length}`);
  console.log(`  Total cubes:    ${cubes.length}`);
  console.log(`  New cursor:     ${newCursor.lastScannedId} (#${newCursor.lastScannedNumber})`);
  console.log(`  Reached tip:    ${reachedTip}`);
  console.log(`  Remaining gap:  ${(tip - newCursor.lastScannedNumber).toLocaleString()}`);
  console.log(`  Took:           ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
