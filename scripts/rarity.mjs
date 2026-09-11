// Phase D — rarity. Resolves the facts behind every cube side (sides.json),
// then scores and ranks all cubes (rarity.json). Runs after every grind and
// is idempotent: with nothing new, both files come out byte-identical.
// rarity.json always covers every cube in cubes.json; a run that cannot
// settle a side keeps what it resolved and exits non-zero without writing it.
//
//   npm run rarity              # resolve new sides, recompute the score
//   SKIP_SIDES=1 npm run rarity # score from the cached sides only
//
// The first run on a fresh checkout resolves every side ever used (one
// ord request per side, image probes in batches of 50, one archive shard
// per id prefix) and takes a few minutes; later runs only touch new sides.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeRarity } from './score.mjs';
import { ensureSides, loadSides, saveSides } from './sides.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CUBES_PATH = path.join(DATA_DIR, 'cubes.json');
const RARITY_PATH = path.join(DATA_DIR, 'rarity.json');

async function main() {
  const startedAt = Date.now();
  const cubes = JSON.parse(await readFile(CUBES_PATH, 'utf-8'));
  const sides = await loadSides();

  if (process.env.SKIP_SIDES !== '1') {
    const { resolved, unsettled } = await ensureSides(cubes, sides);
    if (resolved > 0) await saveSides(sides);
    // No half-scored index: the settled sides are kept for the next run,
    // rarity.json stays as it was, and this run reports the failure.
    if (unsettled > 0) throw new Error(`${unsettled} side(s) did not settle; rarity.json not written`);
  }

  const rarity = computeRarity(cubes, sides);
  await writeFile(RARITY_PATH, JSON.stringify(rarity, null, 2) + '\n');

  const top = rarity.cubes
    .filter((c) => c.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((c) => `#${c.position} ${c.collection ?? 'mixed'} score ${c.score}`)
    .join(' | ');
  console.log('='.repeat(60));
  console.log('RARITY DONE');
  console.log('='.repeat(60));
  console.log(`  Cubes:          ${rarity.totalCubes} (scored ${rarity.scoredCubes}, cursed ${rarity.cursedCubes}, after close ${rarity.afterCloseCubes})`);
  console.log(`  Collections:    ${rarity.collections.slice(0, 5).map((c) => `${c.symbol}=${c.cubes}`).join('  ')}`);
  console.log(`  Top 5:          ${top}`);
  console.log(`  Took:           ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
