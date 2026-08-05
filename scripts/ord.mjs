// Minimal client for our own ord instance (https://ord.ordpool.space).
// JSON API is enabled. No auth, no rate limit (it's ours).
//
// Retry policy: every request retries up to RETRY_ATTEMPTS times on
// network errors, 5xx, AND 404 — the last one because ord.ordpool.space
// scrapes ordinals.com, so a transient upstream hiccup surfaces here as
// a temporary 404 that resolves within seconds. Non-404/5xx status
// codes (403, 429, etc.) don't retry.

export const ORD_BASE = process.env.ORD_BASE || 'https://ord.ordpool.space';

const UA = 'ordinal-cubes-index/1.0 (https://github.com/ordpool-space/ordinal-cubes-index)';

const RETRY_ATTEMPTS = Number(process.env.ORD_RETRY_ATTEMPTS ?? 3);
const RETRY_BASE_MS = Number(process.env.ORD_RETRY_BASE_MS ?? 750);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shouldRetry(status, err) {
  if (err) return true;                      // network error, DNS, socket reset
  if (status === 404) return true;           // ord-proxy upstream hiccup
  if (status >= 500 && status <= 599) return true;
  return false;
}

async function fetchWithRetry(path, headers) {
  let lastErr = null;
  let lastStatus = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${ORD_BASE}${path}`, { headers });
      if (res.ok) return res;
      lastStatus = res.status;
      if (!shouldRetry(res.status, null) || attempt === RETRY_ATTEMPTS) {
        throw new Error(`ord ${path} → HTTP ${res.status}`);
      }
    } catch (err) {
      lastErr = err;
      // Re-throw immediately when the error message already says "HTTP"
      // (thrown from the block above on a non-retryable status).
      if (attempt === RETRY_ATTEMPTS || (err.message && err.message.startsWith('ord '))) {
        throw err;
      }
      if (!shouldRetry(null, err)) throw err;
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    console.warn(`  ord ${path} — attempt ${attempt}/${RETRY_ATTEMPTS} failed (${lastStatus ?? lastErr?.message ?? 'unknown'}); retrying in ${delay}ms`);
    await sleep(delay);
  }
  throw lastErr ?? new Error(`ord ${path} — exhausted ${RETRY_ATTEMPTS} attempts`);
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
  return err instanceof Error && / HTTP 404$/.test(err.message);
}
