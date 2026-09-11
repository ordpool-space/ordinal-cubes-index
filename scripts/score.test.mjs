// Run with: node --test scripts/score.test.mjs
//
// Pins every rule of the rarity score against small hand-built cubes. Each
// test asserts the value a rule produces, so breaking the rule (flipping
// the claim order, moving a tier boundary, inverting the tiebreaker,
// counting cursed cubes into popularity) turns the test red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRarity, RULES } from './score.mjs';

const HEX = '0123456789abcdef';

/** Deterministic fake inscription id: 64 hex chars derived from a label, plus `i0`. */
function id(label) {
  let s = '';
  for (let i = 0; i < 64; i++) s += HEX[(label.charCodeAt(i % label.length) + i) % 16];
  return `${s}i0`;
}

let nextNumber = 1;
function cube(sideIds, { blockHeight = 800000, inscriptionNumber = nextNumber++ } = {}) {
  return {
    inscriptionId: id(`cube-${inscriptionNumber}`),
    inscriptionNumber,
    blockHeight,
    attributes: sideIds.map((value, i) => ({ trait_type: `Side ${i + 1}`, value })),
  };
}

/** Six fresh side ids for one cube, all in `collection`. */
function sixSides(label) {
  return [1, 2, 3, 4, 5, 6].map((n) => id(`${label}-${n}`));
}

function sidesFor(assignments) {
  const sides = {};
  for (const [sideId, spec] of Object.entries(assignments)) {
    sides[sideId] = { contentType: 'image/png', exists: true, renderable: true, width: 1, height: 1, collection: null, ...spec };
  }
  return sides;
}

function image(ids, collection) {
  const out = {};
  for (const sideId of ids) out[sideId] = { collection };
  return out;
}

function rowOf(result, c) {
  return result.cubes.find((row) => row.inscriptionId === c.inscriptionId);
}

test('a cube with six distinct renderable, unclaimed sides is scored', () => {
  const s = sixSides('a');
  const result = computeRarity([cube(s)], sidesFor(image(s, 'omb')));
  const row = result.cubes[0];
  assert.equal(row.status, 'scored');
  assert.deepEqual(row.cursed, []);
  assert.equal(row.validOrdinal, 1);
  assert.equal(row.tier, 1);
  assert.equal(row.rank, 1);
  assert.equal(result.scoredCubes, 1);
});

test('two faces showing the same inscription curse the cube', () => {
  const s = sixSides('a');
  s[5] = s[0];
  const result = computeRarity([cube(s)], sidesFor(image(s, 'omb')));
  assert.deepEqual(result.cubes[0].cursed, ['duplicate-side']);
  assert.equal(result.cubes[0].status, 'cursed');
  assert.equal(result.cubes[0].rank, null);
});

test('a side that does not render curses the cube and names the black face', () => {
  const s = sixSides('a');
  const sides = sidesFor(image(s, 'omb'));
  sides[s[2]].renderable = false;
  sides[s[4]].renderable = false;
  const result = computeRarity([cube(s)], sides);
  assert.deepEqual(result.cubes[0].cursed, ['black-side']);
  assert.deepEqual(result.cubes[0].blackSides, [3, 5]);
});

test('first is first: a side claimed by an earlier cube curses the later one, older cube unaffected', () => {
  const a = sixSides('a');
  const b = sixSides('b');
  b[1] = a[3];
  const older = cube(a, { blockHeight: 800000 });
  const newer = cube(b, { blockHeight: 800001 });
  const result = computeRarity([newer, older], sidesFor({ ...image(a, 'omb'), ...image(b, 'omb') }));
  assert.equal(rowOf(result, older).status, 'scored');
  assert.deepEqual(rowOf(result, newer).cursed, ['reused-inscription']);
  assert.deepEqual(rowOf(result, newer).reusedSides, [2]);
});

test('same block: the lower inscription number claims first', () => {
  const a = sixSides('a');
  const b = sixSides('b');
  b[0] = a[0];
  const first = cube(a, { blockHeight: 800000, inscriptionNumber: 500 });
  const second = cube(b, { blockHeight: 800000, inscriptionNumber: 501 });
  const result = computeRarity([second, first], sidesFor({ ...image(a, 'omb'), ...image(b, 'omb') }));
  assert.equal(rowOf(result, first).status, 'scored');
  assert.equal(rowOf(result, second).status, 'cursed');
});

test('a cursed cube still claims its sides for everyone after it', () => {
  const a = sixSides('a');
  a[5] = a[0]; // cursed: duplicate
  const b = sixSides('b');
  b[2] = a[1];
  const result = computeRarity([cube(a), cube(b)], sidesFor({ ...image(a, 'omb'), ...image(b, 'omb') }));
  assert.equal(result.cubes[0].status, 'cursed');
  assert.deepEqual(result.cubes[1].cursed, ['reused-inscription']);
});

test('a side without a resolved entry is an error, never a published status', () => {
  const s = sixSides('a');
  const sides = sidesFor(image(s, 'omb'));
  delete sides[s[3]];
  assert.throws(() => computeRarity([cube(s)], sides), new RegExp(`side ${s[3]} of cube .* has no entry`));
});

test('collection: all six sides from one collection, otherwise null', () => {
  const s = sixSides('a');
  const sides = sidesFor(image(s, 'omb'));
  assert.equal(computeRarity([cube(s)], sides).cubes[0].collection, 'omb');
  sides[s[0]].collection = 'nodemonkes';
  const mixed = computeRarity([cube(s)], sides).cubes[0];
  assert.equal(mixed.collection, null);
  assert.deepEqual(mixed.collections, ['nodemonkes', 'omb']);
  sides[s[0]].collection = null;
  assert.equal(computeRarity([cube(s)], sides).cubes[0].collection, null);
});

test('popularity counts scored cubes showing the collection; cursed cubes do not count', () => {
  const a = sixSides('a');
  const b = sixSides('b');
  const c = sixSides('c');
  c[5] = c[0]; // cursed
  const sides = sidesFor({ ...image(a, 'omb'), ...image(b, 'omb'), ...image(c, 'omb') });
  sides[b[0]].collection = 'frogs'; // b is mixed but still shows omb
  const result = computeRarity([cube(a), cube(b), cube(c)], sides);
  assert.deepEqual(result.collections, [
    { symbol: 'omb', cubes: 2, points: 100 },
    { symbol: 'frogs', cubes: 1, points: 50 },
  ]);
  assert.equal(result.cubes[0].popularity, 2);
});

test('popularity points: full scale for the most popular collection, proportional below, none for mixed', () => {
  const cubes = [];
  const sides = {};
  for (let i = 0; i < 4; i++) { const s = sixSides(`omb${i}`); cubes.push(cube(s)); Object.assign(sides, sidesFor(image(s, 'omb'))); }
  const f = sixSides('frogs'); cubes.push(cube(f)); Object.assign(sides, sidesFor(image(f, 'frogs')));
  const m = sixSides('mixed'); cubes.push(cube(m)); Object.assign(sides, sidesFor(image(m, 'omb'))); sides[m[0]].collection = 'frogs';
  const result = computeRarity(cubes, sides);
  assert.equal(result.cubes[0].popularityPoints, RULES.popularityScale);
  assert.equal(rowOf(result, cubes[4]).popularityPoints, Math.round((RULES.popularityScale * 2) / 5));
  assert.equal(rowOf(result, cubes[5]).popularityPoints, 0);
  assert.equal(rowOf(result, cubes[5]).score, rowOf(result, cubes[5]).tierBonus);
});

test('tiers follow the ordinal among scored cubes with the published boundaries', () => {
  const cubes = [];
  const sides = {};
  const boundaries = [1, 100, 101, 1000, 1001, 5000, 5001, 10000, 10001];
  for (let n = 1; n <= 10001; n++) {
    const s = sixSides(`t${n}`);
    cubes.push(cube(s, { blockHeight: 800000 + n, inscriptionNumber: n }));
    for (const sideId of s) sides[sideId] = { renderable: true, collection: 'omb' };
  }
  const result = computeRarity(cubes, sides);
  const at = (n) => result.cubes[n - 1];
  assert.deepEqual(boundaries.map((n) => [n, at(n).status, at(n).tier, at(n).tierBonus]), [
    [1, 'scored', 1, 100],
    [100, 'scored', 1, 100],
    [101, 'scored', 2, 50],
    [1000, 'scored', 2, 50],
    [1001, 'scored', 3, 25],
    [5000, 'scored', 3, 25],
    [5001, 'scored', 4, 0],
    [10000, 'scored', 4, 0],
    [10001, 'after-close', null, null],
  ]);
  assert.equal(result.afterCloseCubes, 1);
});

test('a cursed cube does not consume an ordinal', () => {
  const a = sixSides('a'); a[1] = a[0];
  const b = sixSides('b');
  const result = computeRarity([cube(a), cube(b)], sidesFor({ ...image(a, 'omb'), ...image(b, 'omb') }));
  assert.equal(result.cubes[1].validOrdinal, 1);
});

test('rank: higher score first, older cube wins a tie, ranks are strict 1..n', () => {
  const late = sixSides('late');
  const earlyMixed = sixSides('early');
  const earlyTwin = sixSides('twin');
  const cubes = [
    cube(earlyMixed, { blockHeight: 800000, inscriptionNumber: 1 }),
    cube(earlyTwin, { blockHeight: 800000, inscriptionNumber: 2 }),
    cube(late, { blockHeight: 800001, inscriptionNumber: 3 }),
  ];
  const sides = sidesFor({ ...image(earlyMixed, 'omb'), ...image(earlyTwin, 'omb'), ...image(late, 'omb') });
  sides[earlyMixed[0]].collection = 'frogs';
  const result = computeRarity(cubes, sides);
  const [mixed, twin, lateRow] = result.cubes;
  assert.equal(twin.score, lateRow.score);
  assert.equal(twin.rank, 1);
  assert.equal(lateRow.rank, 2);
  assert.equal(mixed.rank, 3);
  assert.equal(mixed.score, twin.score - RULES.popularityScale);
});

test('output is in canonical cube order and deterministic', () => {
  const a = sixSides('a');
  const b = sixSides('b');
  const older = cube(a, { blockHeight: 800000, inscriptionNumber: 9 });
  const newer = cube(b, { blockHeight: 800001, inscriptionNumber: 3 });
  const sides = sidesFor({ ...image(a, 'omb'), ...image(b, 'omb') });
  const once = computeRarity([newer, older], sides);
  const twice = computeRarity([older, newer], sides);
  assert.deepEqual(once.cubes.map((r) => r.inscriptionId), [older.inscriptionId, newer.inscriptionId]);
  assert.deepEqual(once, twice);
  assert.equal(once.cubes[0].position, 0);
});
