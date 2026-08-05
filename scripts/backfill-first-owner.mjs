// One-off backfill: fill `firstOwner` on every existing cubes.json
// entry that doesn't have one yet. Idempotent — re-running just
// picks up any entries where esplora hiccuped last time.
//
//   node scripts/backfill-first-owner.mjs           # sequential, ~100ms per request
//   FLUSH_EVERY=50 node scripts/backfill-first-owner.mjs
//                                                   # write to disk every N updates
//                                                   # so a crash doesn't lose progress
//
// api.ordpool.space is our own backend (see workspace CLAUDE.md), so
// rate-limit choice is on us. Serial + small delay keeps things gentle.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFirstOwnerAddress, revealTxidFromInscriptionId } from './esplora.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUBES_PATH = path.resolve(__dirname, '..', 'data', 'cubes.json');

const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 100);
const FLUSH_EVERY = Number(process.env.FLUSH_EVERY ?? 25);

async function readJson(p) { return JSON.parse(await readFile(p, 'utf-8')); }
async function writeJson(p, v) { await writeFile(p, JSON.stringify(v, null, 2) + '\n'); }

async function main() {
  const cubes = await readJson(CUBES_PATH);

  // Entries missing firstOwner OR having it as null (from a prior failed
  // grind lookup) are candidates. Entries with a set firstOwner are
  // final — we never re-derive an immutable on-chain fact.
  const todo = cubes
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.firstOwner === undefined || c.firstOwner === null);

  console.log(`${cubes.length} total cubes, ${todo.length} without firstOwner`);
  if (todo.length === 0) {
    console.log('nothing to backfill; exiting');
    return;
  }

  let filled = 0;
  let failed = 0;
  let sinceFlush = 0;
  const t0 = Date.now();

  for (const { c, i } of todo) {
    try {
      const revealTxid = revealTxidFromInscriptionId(c.inscriptionId);
      const addr = await getFirstOwnerAddress(revealTxid);
      cubes[i] = { ...c, firstOwner: addr };
      if (addr) {
        filled++;
      } else {
        failed++;
        console.warn(`  [${i}] ${c.inscriptionId} → vout[0] has no address; wrote null`);
      }
    } catch (err) {
      failed++;
      console.warn(`  [${i}] ${c.inscriptionId} → ${err.message}`);
      cubes[i] = { ...c, firstOwner: null };
    }

    sinceFlush++;
    if (sinceFlush >= FLUSH_EVERY) {
      await writeJson(CUBES_PATH, cubes);
      sinceFlush = 0;
      const done = filled + failed;
      const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log(`  …flushed ${done}/${todo.length} (${rate}/s)`);
    }

    if (REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  await writeJson(CUBES_PATH, cubes);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\ndone: ${filled} filled, ${failed} with null firstOwner, in ${dt}s`);
  if (failed > 0) {
    console.log('re-run to retry the null entries once esplora is happier');
  }
}

await main();
