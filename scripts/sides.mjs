// Per-side facts behind the rarity score, cached in data/sides.json.
//
// A side inscription is immutable, so each id is resolved once and the
// answer is kept forever:
//
//   {
//     "contentType": "image/png",   // as served for /content/<id>; null when missing
//     "exists": true,               // /content/<id> answers 200
//     "renderable": true,           // decodes as an image in Chrome (probe.mjs)
//     "width": 600, "height": 600,  // decoded size, 0 when not renderable
//     "texture": true,              // the browser takes it as a WebGL texture
//     "collection": "omb"           // Magic Eden symbol, null when unknown
//   }
//
// `texture: false` is the side that decodes but is refused as a texture source
// (an SVG without an intrinsic size). Those faces went black in every viewer
// after Chrome tightened this, although the cubes rendered when they were
// minted; cubes.haushoppe.art rasterises them back into view. `null` means the
// fact was not established.
//
// `renderable` is the fact the score needs: a cube face is black exactly
// when its side is not renderable. Content type and bytes come from our
// own backend (`CONTENT_BASE`, api.ordpool.space), which serves every
// inscription straight from the transaction witness with the envelope's
// content type and encoding, and resolves delegates like ord does.
//
// Only settled answers are recorded. A transient failure (network, 5xx)
// aborts the run instead of writing a wrong fact, and a negative probe is
// repeated once and only recorded when both passes agree. Ids that do not
// even have the inscription-id shape are recorded without a round trip.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupCollections } from './collections.mjs';
import { INSCRIPTION_ID, probeImages } from './probe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SIDES_PATH = path.resolve(__dirname, '..', 'data', 'sides.json');

export const CONTENT_BASE = process.env.CONTENT_BASE || 'https://api.ordpool.space';
const HEAD_CONCURRENCY = Number(process.env.HEAD_CONCURRENCY ?? 4);
const UA = 'ordinal-cubes-index/1.0 (https://github.com/ordpool-space/ordinal-cubes-index)';

const SIDE_TRAITS = ['Side 1', 'Side 2', 'Side 3', 'Side 4', 'Side 5', 'Side 6'];

/** The six side ids of a cube in face order (fewer when a trait is absent). */
export function sidesOf(cube) {
  const values = [];
  for (const trait of SIDE_TRAITS) {
    const attr = cube.attributes?.find((a) => a.trait_type === trait);
    if (attr && typeof attr.value === 'string') values.push(attr.value);
  }
  return values;
}

/** Every distinct side id across all cubes. */
export function collectSideIds(cubes) {
  const ids = new Set();
  for (const cube of cubes) for (const id of sidesOf(cube)) ids.add(id);
  return ids;
}

export async function loadSides() {
  try {
    return JSON.parse(await readFile(SIDES_PATH, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/** Writes sides.json with sorted keys so reruns produce byte-identical files. */
export async function saveSides(sides) {
  const sorted = {};
  for (const id of Object.keys(sides).sort()) sorted[id] = sides[id];
  await writeFile(SIDES_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

const UNREACHABLE = Object.freeze({
  contentType: null,
  exists: false,
  renderable: false,
  width: 0,
  height: 0,
  texture: null,
  collection: null,
});

/**
 * `HEAD /content/<id>` → `{ exists, contentType }`. 200 is an inscription
 * with content; 404 means unknown to the index; 400 (no content type in
 * the envelope) and 451 exist but cannot render. Anything else throws.
 */
export async function headContent(id, base = CONTENT_BASE) {
  const res = await fetch(`${base}/content/${id}`, { method: 'HEAD', headers: { 'User-Agent': UA } });
  if (res.status === 200) return { exists: true, contentType: res.headers.get('content-type') };
  if (res.status === 404) return { exists: false, contentType: null };
  if (res.status === 400 || res.status === 451) return { exists: true, contentType: null };
  throw new Error(`content ${base}/content/${id} → HTTP ${res.status}`);
}

async function headAll(ids) {
  const meta = new Map();
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: HEAD_CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        meta.set(id, await headContent(id));
      }
    }),
  );
  return meta;
}

/**
 * Probes `ids`; a negative answer is confirmed by a second pass. Returns
 * only settled ids: positives, and negatives both passes agree on.
 */
async function probeTwice(ids, log) {
  const first = await probeImages(ids, { base: CONTENT_BASE, log });
  const negatives = ids.filter((id) => first[id] && !first[id].renderable);
  if (negatives.length === 0) return first;
  log(`sides: re-probing ${negatives.length} negative(s) to confirm`);
  const second = await probeImages(negatives, { base: CONTENT_BASE, log });
  const settled = { ...first };
  for (const id of negatives) {
    if (!second[id] || second[id].renderable) delete settled[id];
  }
  return settled;
}

/**
 * Fills the `texture` fact on entries resolved before it existed. Only the
 * image probe runs; the entry's other facts are kept.
 */
async function topUpTexture(ids, sides, log) {
  const todo = ids.filter((id) => sides[id] && sides[id].texture === undefined && INSCRIPTION_ID.test(id));
  const malformed = ids.filter((id) => sides[id] && sides[id].texture === undefined && !INSCRIPTION_ID.test(id));
  for (const id of malformed) sides[id].texture = null;
  if (todo.length === 0) return malformed.length;
  log(`sides: filling the texture fact on ${todo.length} entr${todo.length === 1 ? 'y' : 'ies'}`);
  const probed = await probeImages(todo, { base: CONTENT_BASE, log });
  let filled = malformed.length;
  for (const id of todo) {
    if (probed[id]) { sides[id].texture = probed[id].texture; filled++; }
  }
  return filled;
}

/**
 * Resolves every side id that has no entry yet and adds it to `sides`
 * (mutated in place). Returns `{ resolved, unsettled }`: ids whose image
 * probe did not settle are left out, so the caller can keep the progress
 * and retry them on a later run.
 */
export async function ensureSides(cubes, sides, { log = console.log } = {}) {
  const all = [...collectSideIds(cubes)];
  const toppedUp = await topUpTexture(all, sides, log);
  const missing = all.filter((id) => !sides[id]);
  if (missing.length === 0) return { resolved: toppedUp, unsettled: 0 };

  const malformed = missing.filter((id) => !INSCRIPTION_ID.test(id));
  for (const id of malformed) sides[id] = { ...UNREACHABLE };

  const toResolve = missing.filter((id) => INSCRIPTION_ID.test(id));
  log(`sides: ${missing.length} unresolved (${malformed.length} malformed ids recorded directly)`);
  if (toResolve.length === 0) return { resolved: toppedUp + malformed.length, unsettled: 0 };

  const meta = await headAll(toResolve);
  const probed = await probeTwice(toResolve, log);
  const collections = await lookupCollections(toResolve);

  let resolved = 0;
  for (const id of toResolve) {
    const image = probed[id];
    if (!image) continue;
    sides[id] = {
      ...meta.get(id),
      renderable: image.renderable,
      width: image.width,
      height: image.height,
      texture: image.texture,
      collection: collections.get(id) ?? null,
    };
    resolved++;
  }
  const unsettled = toResolve.length - resolved;
  log(`sides: ${resolved} resolved, ${unsettled} left for a later run`);
  return { resolved: toppedUp + malformed.length + resolved, unsettled };
}
