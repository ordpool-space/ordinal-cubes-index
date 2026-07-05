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
import { getInscription, getContent, getStatus } from './ord.mjs';
import { parseCube } from './parse-cube.mjs';
import { applyPositionalNames } from './sort.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CUBES_PATH = path.join(DATA_DIR, 'cubes.json');
const CURSOR_PATH = path.join(DATA_DIR, 'cursor.json');

const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS ?? 5000);
const STOP_AT_TIP = process.env.STOP_AT_TIP === '1';
const HEARTBEAT_EVERY = 500;

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


async function main() {
  const startedAt = Date.now();

  const cubes = await readJson(CUBES_PATH);
  const cursor = await readJson(CURSOR_PATH);
  const tip = (await getStatus()).blessed_inscriptions;

  console.log(`Cursor: ${cursor.lastScannedId} (#${cursor.lastScannedNumber})`);
  console.log(`Tip:    ${tip}  (gap ${(tip - cursor.lastScannedNumber).toLocaleString()})`);
  console.log(`Budget: ${MAX_ITERATIONS} iterations`);

  const knownIds = new Set(cubes.map((c) => c.inscriptionId));
  const foundThisRun = [];

  let currentId = cursor.lastScannedId;
  let currentMeta = await getInscription(currentId);
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
      nextMeta = await getInscription(nextId);
    } catch (err) {
      console.warn(`  fetch metadata failed for ${nextId}: ${err.message} — aborting run`);
      break;
    }

    if (looksLikeCubeShape(nextMeta) && !knownIds.has(nextId)) {
      try {
        const body = await getContent(nextId);
        const attributes = parseCube(body);
        if (attributes) {
          foundThisRun.push({
            inscriptionId: nextId,
            inscriptionNumber: nextMeta.number,
            blockHeight: nextMeta.height,
            timestamp: nextMeta.timestamp,
            contentLength: nextMeta.content_length,
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
