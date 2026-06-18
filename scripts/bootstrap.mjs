// Phase A — one-time bootstrap.
//
// Takes the 530 cube IDs Magic Eden had on file for the
// `ordinal-cubes-by-haus-hoppe` collection (frozen in our public archive),
// independently validates each one against our own ord instance, and emits
// the canonical `data/cubes.json` plus a `data/cursor.json` pointing at the
// most recent known cube.
//
//   npm run bootstrap
//
// Safe to re-run — output is fully derived from the ME archive + current ord.

import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getInscription, getContent, getStatus } from './ord.mjs';
import { parseCube } from './parse-cube.mjs';
import { applyPositionalNames } from './sort.mjs';

const ME_ARCHIVE_URL =
  'https://ordpool-space.github.io/magic-eden-ordinals-archive/inscriptions/ordinal-cubes-by-haus-hoppe.csv.gz';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

const CONCURRENCY = 12;

// ---------------------------------------------------------------------------

async function downloadMeCubeIds() {
  console.log(`Fetching ME archive: ${ME_ARCHIVE_URL}`);
  const res = await fetch(ME_ARCHIVE_URL);
  if (!res.ok) throw new Error(`ME archive fetch failed: HTTP ${res.status}`);
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf-8');
  const lines = csv.trim().split('\n').slice(1); // skip header
  const ids = lines.map((l) => l.split(',')[0].trim()).filter(Boolean);
  console.log(`  → ${ids.length} cube IDs from ME archive`);
  return ids;
}

async function validateOne(id) {
  const meta = await getInscription(id);
  const body = await getContent(id);
  const attributes = parseCube(body);
  return { meta, body, attributes };
}

/** Process `items` with at most `n` requests in flight. Preserves input order. */
async function withPool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const slot = i++;
      if (slot >= items.length) return;
      try {
        results[slot] = { ok: true, value: await fn(items[slot], slot) };
      } catch (err) {
        results[slot] = { ok: false, error: err.message ?? String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function buildCube(id, meta, attributes) {
  return {
    inscriptionId: id,
    inscriptionNumber: meta.number,
    blockHeight: meta.height,
    timestamp: meta.timestamp,
    contentLength: meta.content_length,
    attributes,
  };
}

async function main() {
  const startedAt = Date.now();

  const ids = await downloadMeCubeIds();

  console.log(`Validating ${ids.length} cubes via ord.ordpool.space (concurrency=${CONCURRENCY})…`);
  let done = 0;
  const results = await withPool(ids, CONCURRENCY, async (id) => {
    const r = await validateOne(id);
    done++;
    if (done % 50 === 0 || done === ids.length) {
      console.log(`  ${done}/${ids.length}`);
    }
    return { id, ...r };
  });

  // Triage results
  const cubes = [];
  const fetchErrors = [];
  const parseFailures = [];
  for (const r of results) {
    if (!r.ok) {
      fetchErrors.push({ error: r.error });
      continue;
    }
    const { id, meta, attributes } = r.value;
    if (!attributes) {
      parseFailures.push({ id, number: meta.number, contentType: meta.content_type, contentLength: meta.content_length });
      continue;
    }
    cubes.push(buildCube(id, meta, attributes));
  }

  // Sort by (blockHeight, inscriptionNumber) and assign "Ordinal Cube #N"
  // labels from the sorted position. This is the canonical numbering — must
  // match the historical genesis CubeService labels exactly.
  const finalCubes = applyPositionalNames(cubes);

  const tip = (await getStatus()).blessed_inscriptions;
  const latest = finalCubes[finalCubes.length - 1];

  const cursor = {
    lastScannedId: latest.inscriptionId,
    lastScannedNumber: latest.inscriptionNumber,
    blessedTipAtLastRun: tip,
    lastScanAt: new Date().toISOString(),
    source: 'bootstrap',
  };

  const validation = {
    source: ME_ARCHIVE_URL,
    fetchedAt: new Date().toISOString(),
    meArchiveSize: ids.length,
    validatedCount: finalCubes.length,
    fetchErrorCount: fetchErrors.length,
    parseFailureCount: parseFailures.length,
    parseFailures,
    fetchErrors,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'cubes.json'), JSON.stringify(finalCubes, null, 2) + '\n');
  await writeFile(path.join(DATA_DIR, 'cursor.json'), JSON.stringify(cursor, null, 2) + '\n');
  await writeFile(path.join(DATA_DIR, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');

  console.log('');
  console.log('='.repeat(60));
  console.log('BOOTSTRAP DONE');
  console.log('='.repeat(60));
  console.log(`  Cubes written:   ${finalCubes.length}`);
  console.log(`  Fetch errors:    ${fetchErrors.length}`);
  console.log(`  Parse failures:  ${parseFailures.length}`);
  console.log(`  Genesis (#0):    ${finalCubes[0].inscriptionId}  (number ${finalCubes[0].inscriptionNumber})`);
  console.log(`  Latest (#${finalCubes.length - 1}):  ${latest.inscriptionId}  (number ${latest.inscriptionNumber})`);
  console.log(`  Tip:             ${tip}  (gap = ${(tip - latest.inscriptionNumber).toLocaleString()})`);
  console.log(`  Took:            ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
