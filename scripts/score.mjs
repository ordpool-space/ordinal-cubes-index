// The rarity score. Pure: cubes + sides in, rarity.json content out.
// The rules are published in README.md ("Rarity"); this file is their
// implementation and the README is the source the constants cite.
//
// Every cube in cubes.json gets exactly one status: scored, cursed, or
// after-close. Cursed means at least one of: two faces show the same
// inscription, a face is black (its side does not render), or a side was
// already claimed by an earlier cube. Claims go in mint order (block
// height, then inscription number, the same order that numbers the cubes),
// and every cube claims its sides whether or not it is cursed itself.
//
// score = tier bonus + popularity points
//   tier              by ordinal among scored cubes: 1 to 100, 101 to 1000,
//                     1001 to 5000, 5001 to 10000
//   popularity        of a collection = number of scored cubes showing at
//                     least one side from it
//   popularity points only for a cube whose six sides come from one
//                     collection: 100 × popularity / popularity of the
//                     most popular collection, rounded
//   rank              score descending, older cube first on a tie
//
// Both axes top out at 100, so the first hundred cubes keep their head
// start while a late cube can still climb to the top of everything below
// them by choosing the collection well.

import { compareByHeightThenNumber } from './sort.mjs';
import { sidesOf } from './sides.mjs';

export const RULES = Object.freeze({
  tiers: Object.freeze([
    Object.freeze({ tier: 1, upTo: 100, bonus: 100 }),
    Object.freeze({ tier: 2, upTo: 1000, bonus: 50 }),
    Object.freeze({ tier: 3, upTo: 5000, bonus: 25 }),
    Object.freeze({ tier: 4, upTo: 10000, bonus: 0 }),
  ]),
  popularityScale: 100,
  closesAfterScoredCubes: 10000,
  source: 'https://github.com/ordpool-space/ordinal-cubes-index#rarity',
});

export const FACE_COUNT = 6;

function tierOf(ordinal, rules) {
  return rules.tiers.find((t) => ordinal <= t.upTo) ?? null;
}

/**
 * Computes the rarity of every cube. Output order is the canonical cube
 * order (same as cubes.json); the `rank` field carries the leaderboard.
 */
export function computeRarity(cubes, sides, rules = RULES) {
  const ordered = [...cubes].sort(compareByHeightThenNumber);
  const claimed = new Set();
  const rows = [];

  for (const [position, cube] of ordered.entries()) {
    const ids = sidesOf(cube);
    const cursed = [];
    const blackSides = [];
    const reusedSides = [];

    if (ids.length !== FACE_COUNT || new Set(ids).size !== FACE_COUNT) cursed.push('duplicate-side');
    ids.forEach((id, index) => {
      const side = sides[id];
      // ensureSides resolves every side before scoring; a hole is a bug or
      // a hand-edited file, never a state to publish.
      if (!side) throw new Error(`side ${id} of cube ${cube.inscriptionId} has no entry in sides.json`);
      if (!side.renderable) blackSides.push(index + 1);
      if (claimed.has(id)) reusedSides.push(index + 1);
    });
    if (blackSides.length > 0) cursed.push('black-side');
    if (reusedSides.length > 0) cursed.push('reused-inscription');
    for (const id of ids) claimed.add(id);

    const symbols = ids.map((id) => sides[id]?.collection ?? null);
    const collections = [...new Set(symbols.filter((s) => s !== null))].sort();
    const collection = collections.length === 1 && symbols.every((s) => s !== null) ? collections[0] : null;

    rows.push({
      inscriptionId: cube.inscriptionId,
      position,
      status: cursed.length > 0 ? 'cursed' : 'scored',
      cursed,
      blackSides,
      reusedSides,
      collection,
      collections,
      validOrdinal: null,
      tier: null,
      tierBonus: null,
      popularity: null,
      popularityPoints: null,
      score: null,
      rank: null,
    });
  }

  // Ordinal among scored cubes, in mint order; the experiment closes after
  // the configured number, later cubes are neither cursed nor scored.
  let ordinal = 0;
  for (const row of rows) {
    if (row.status !== 'scored') continue;
    ordinal++;
    if (ordinal > rules.closesAfterScoredCubes) {
      row.status = 'after-close';
      continue;
    }
    row.validOrdinal = ordinal;
    const tier = tierOf(ordinal, rules);
    row.tier = tier.tier;
    row.tierBonus = tier.bonus;
  }

  // Popularity: scored cubes showing at least one side of the collection.
  const popularity = new Map();
  for (const row of rows) {
    if (row.status !== 'scored') continue;
    for (const symbol of row.collections) popularity.set(symbol, (popularity.get(symbol) ?? 0) + 1);
  }
  const maxPopularity = Math.max(0, ...popularity.values());

  for (const row of rows) {
    if (row.status !== 'scored') continue;
    // A mixed cube has no collection of its own: popularity 0, no points.
    row.popularity = row.collection ? popularity.get(row.collection) : 0;
    row.popularityPoints =
      maxPopularity > 0 ? Math.round((rules.popularityScale * row.popularity) / maxPopularity) : 0;
    row.score = row.tierBonus + row.popularityPoints;
  }

  const leaderboard = rows
    .filter((row) => row.status === 'scored')
    .sort((a, b) => b.score - a.score || a.position - b.position);
  leaderboard.forEach((row, index) => { row.rank = index + 1; });

  const collections = [...popularity.entries()]
    .map(([symbol, count]) => ({
      symbol,
      cubes: count,
      points: maxPopularity > 0 ? Math.round((rules.popularityScale * count) / maxPopularity) : 0,
    }))
    .sort((a, b) => b.cubes - a.cubes || (a.symbol < b.symbol ? -1 : 1));

  const count = (status) => rows.filter((row) => row.status === status).length;
  return {
    rules,
    totalCubes: rows.length,
    scoredCubes: count('scored'),
    cursedCubes: count('cursed'),
    afterCloseCubes: count('after-close'),
    collections,
    cubes: rows,
  };
}
