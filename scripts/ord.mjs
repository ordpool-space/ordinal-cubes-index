// Minimal client for our own ord instance (https://ord.ordpool.space).
// JSON API is enabled. No auth, no rate limit (it's ours).
//
// Retry policy: network errors, 5xx, AND 404 — the last one because
// ord.ordpool.space scrapes ordinals.com, so a transient upstream
// hiccup surfaces here as a temporary 404 that resolves within
// seconds. All other non-2xx statuses (403, 429, …) throw immediately
// with no retry.

export const ORD_BASE = process.env.ORD_BASE || 'https://ord.ordpool.space';

const UA = 'ordinal-cubes-index/1.0 (https://github.com/ordpool-space/ordinal-cubes-index)';

const RETRY_ATTEMPTS = Number(process.env.ORD_RETRY_ATTEMPTS ?? 3);
const RETRY_BASE_MS = Number(process.env.ORD_RETRY_BASE_MS ?? 750);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status) {
  return status === 404 || (status >= 500 && status <= 599);
}

async function fetchWithRetry(path, headers) {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let status;
    try {
      const res = await fetch(`${ORD_BASE}${path}`, { headers });
      if (res.ok) return res;
      status = res.status;
      if (!isRetryableStatus(status)) {
        throw new Error(`ord ${path} → HTTP ${status}`);
      }
      lastReason = `HTTP ${status}`;
    } catch (err) {
      if (status !== undefined && !isRetryableStatus(status)) throw err;
      lastReason = err.message ?? String(err);
    }
    if (attempt === RETRY_ATTEMPTS) {
      throw new Error(`ord ${path} — ${lastReason} (exhausted ${RETRY_ATTEMPTS} attempts)`);
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    console.warn(`  ord ${path} — attempt ${attempt}/${RETRY_ATTEMPTS} failed (${lastReason}); retrying in ${delay}ms`);
    await sleep(delay);
  }
  throw new Error(`ord ${path} — unreachable`);
}

async function getJson(path) {
  const res = await fetchWithRetry(path, { 'Accept': 'application/json', 'User-Agent': UA });
  return res.json();
}

async function getText(path) {
  const res = await fetchWithRetry(path, { 'User-Agent': UA });
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

/**
 * Returns true when an Error thrown by any exported function above
 * was ultimately a 404 (after retries). Callers that treat a
 * persistent 404 as "cursor stale, come back next run" can use this
 * to distinguish it from real crashes.
 */
export function isNotFoundError(err) {
  return err instanceof Error && /HTTP 404/.test(err.message);
}
