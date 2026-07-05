// Optional bulk backfill — parallel forward scan by inscription number.
//
// Why this exists in addition to grind.mjs: the steady-state grinder walks the
// `next` linked list one inscription at a time (safe for cursed inscriptions
// with negative numbers). After the Jubilee fork in early 2024, no new cursed
// inscriptions exist, so for any starting point past it the inscription number
// sequence is dense and we can walk it with parallel fetches — much faster
// than serial linked-list traversal when closing a multi-million-inscription
// gap to the chain tip.
//
//   node scripts/backfill.mjs                 # scan from current cursor → tip
//   CONCURRENCY=40 node scripts/backfill.mjs  # crank parallelism
//   BATCH_COMMIT=20000 node scripts/backfill.mjs
//
// Output is identical to grind.mjs: data/cubes.json + data/cursor.json.
// Run from your own box; we control ord.ordpool.space so rate limiting is
// not a concern, but be polite — start at modest concurrency and watch ord
// CPU. Re-runnable: each batch commits progress.

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

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const BATCH_COMMIT = Number(process.env.BATCH_COMMIT ?? 10000);

const HTML_CONTENT_TYPES = new Set(['text/html;charset=utf-8', 'text/html']);
const MIN_LEN = 400;
const MAX_LEN = 900;

const JUBILEE_INSCRIPTION_NUMBER = 73_534_344; // approx — first post-jubilee number

// ---------------------------------------------------------------------------

async function readJson(p) { return JSON.parse(await readFile(p, 'utf-8')); }
async function writeJson(p, v) { await writeFile(p, JSON.stringify(v, null, 2) + '\n'); }

function looksLikeCubeShape(meta) {
  if (!HTML_CONTENT_TYPES.has((meta.content_type ?? '').toLowerCase())) return false;
  const len = meta.content_length;
  return typeof len === 'number' && len >= MIN_LEN && len <= MAX_LEN;
}


async function checkOne(n) {
  let meta;
  try { meta = await getInscription(n); }
  catch { return null; }
  if (!looksLikeCubeShape(meta)) return null;
  let body;
  try { body = await getContent(meta.id); }
  catch { return null; }
  const attributes = parseCube(body);
  if (!attributes) return null;
  return {
    inscriptionId: meta.id,
    inscriptionNumber: meta.number,
    blockHeight: meta.height,
    timestamp: meta.timestamp,
    contentLength: meta.content_length,
    attributes,
  };
}

async function processBatch(start, end) {
  const numbers = [];
  for (let n = start; n < end; n++) numbers.push(n);

  // Bounded concurrency
  const found = [];
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const slot = i++;
      if (slot >= numbers.length) return;
      const cube = await checkOne(numbers[slot]);
      if (cube) found.push(cube);
    }
  });
  await Promise.all(workers);
  return found;
}

async function commit(cubes, cursorUpdate) {
  const renamed = applyPositionalNames(cubes);
  await writeJson(CUBES_PATH, renamed);
  await writeJson(CURSOR_PATH, cursorUpdate);
}

async function main() {
  const startedAt = Date.now();
  const cubes = await readJson(CUBES_PATH);
  const cursor = await readJson(CURSOR_PATH);
  const tip = (await getStatus()).blessed_inscriptions;

  if (cursor.lastScannedNumber < JUBILEE_INSCRIPTION_NUMBER) {
    console.warn(`Cursor #${cursor.lastScannedNumber} is pre-Jubilee. Bulk number walk skips cursed inscriptions — use grind.mjs (linked-list walk) for that range.`);
    process.exit(2);
  }

  let current = cursor.lastScannedNumber + 1;
  const knownIds = new Set(cubes.map((c) => c.inscriptionId));

  console.log(`Backfill: #${current} → #${tip}  (gap ${(tip - current).toLocaleString()})`);
  console.log(`Concurrency: ${CONCURRENCY}, commit every ${BATCH_COMMIT.toLocaleString()} inscriptions`);

  let totalFound = 0;
  while (current <= tip) {
    const end = Math.min(current + BATCH_COMMIT, tip + 1);
    const t0 = Date.now();
    const found = await processBatch(current, end);
    const dt = (Date.now() - t0) / 1000;
    const rate = ((end - current) / dt).toFixed(0);

    const fresh = found.filter((c) => !knownIds.has(c.inscriptionId));
    for (const c of fresh) {
      knownIds.add(c.inscriptionId);
      cubes.push(c);
    }
    totalFound += fresh.length;

    // Cursor walks via metadata of the highest scanned number
    let lastMeta;
    try { lastMeta = await getInscription(end - 1); }
    catch { lastMeta = { id: cursor.lastScannedId, number: end - 1 }; }

    await commit(cubes, {
      lastScannedId: lastMeta.id,
      lastScannedNumber: lastMeta.number,
      lastScannedBlockHeight: lastMeta.height,
      blessedTipAtLastRun: tip,
      lastScanAt: new Date().toISOString(),
      source: 'backfill',
    });

    const eta = Math.round(((tip - end) / Number(rate)) / 60);
    console.log(`  scanned #${current}..#${end - 1}  found ${fresh.length}  rate ${rate}/s  eta ${eta} min`);
    current = end;
  }

  console.log('='.repeat(60));
  console.log(`BACKFILL DONE`);
  console.log(`  New cubes:      ${totalFound}`);
  console.log(`  Total cubes:    ${cubes.length}`);
  console.log(`  Took:           ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
