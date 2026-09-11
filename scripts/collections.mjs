// Inscription id → Magic Eden collection symbol, from the frozen
// magic-eden-ordinals-archive. Its `by-id/<3-hex>.csv.gz` shards are a
// reverse index keyed by the first three hex characters of the id, so a
// lookup downloads one small shard instead of scanning 5,466 collections.
// Every id is in at most one collection there (the archive build checks
// that), so the first row wins.
//
// `ARCHIVE_BASE` overrides the archive location; a `file://` value reads
// the shards from a local checkout (used for the one-time backfill).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const ARCHIVE_BASE =
  process.env.ARCHIVE_BASE || 'https://ordpool-space.github.io/magic-eden-ordinals-archive';

const PREFIX_LENGTH = 3;

/** Shard key of an id: its first three hex characters. */
export function shardPrefix(id) {
  return id.slice(0, PREFIX_LENGTH);
}

/** `id,symbol` rows → Map(id → symbol). The header line is skipped. */
export function parseShard(text) {
  const map = new Map();
  let pos = text.indexOf('\n') + 1;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const line = text.slice(pos, nl === -1 ? text.length : nl);
    pos = nl === -1 ? text.length : nl + 1;
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    map.set(line.slice(0, comma), line.slice(comma + 1));
  }
  return map;
}

async function fetchShard(prefix) {
  const url = `${ARCHIVE_BASE}/by-id/${prefix}.csv.gz`;
  let bytes;
  if (url.startsWith('file://')) {
    try {
      bytes = await readFile(fileURLToPath(url));
    } catch (err) {
      if (err.code === 'ENOENT') return new Map();
      throw err;
    }
  } else {
    const res = await fetch(url);
    if (res.status === 404) return new Map();
    if (!res.ok) throw new Error(`archive ${url} → HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  return parseShard(gunzipSync(bytes).toString('utf8'));
}

/**
 * Resolves the collection symbol of every id. Ids the archive does not
 * know map to `null`. Shards are fetched once per distinct prefix.
 */
export async function lookupCollections(ids) {
  const byPrefix = new Map();
  for (const id of ids) {
    const prefix = shardPrefix(id);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(id);
  }
  const result = new Map();
  for (const [prefix, members] of byPrefix) {
    const shard = await fetchShard(prefix);
    for (const id of members) result.set(id, shard.get(id) ?? null);
  }
  return result;
}
