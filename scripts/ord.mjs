// Minimal client for our own ord instance (https://ord.ordpool.space).
// JSON API is enabled. No auth, no rate limit (it's ours).

export const ORD_BASE = process.env.ORD_BASE || 'https://ord.ordpool.space';

const UA = 'ordinal-cubes-index/1.0 (https://github.com/ordpool-space/ordinal-cubes-index)';

async function getJson(path) {
  const res = await fetch(`${ORD_BASE}${path}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`ord ${path} → HTTP ${res.status}`);
  return res.json();
}

async function getText(path) {
  const res = await fetch(`${ORD_BASE}${path}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`ord ${path} → HTTP ${res.status}`);
  return res.text();
}

/**
 * /inscription/{id_or_number} → metadata. The JSON shape includes:
 *   { id, number, height, timestamp, content_type, content_length,
 *     next, previous, address, sat, ... }
 *
 * Note: `next`/`previous` are inscription IDs (the linked-list cursor we walk).
 */
export const getInscription = (idOrNumber) =>
  getJson(`/inscription/${idOrNumber}`);

/** /content/{id} → raw inscription body, returned as text. */
export const getContent = (id) =>
  getText(`/content/${id}`);

/** /status → node status. `blessed_inscriptions` is the tip. */
export const getStatus = () =>
  getJson('/status');
