// Minimal esplora client for our own ordpool-backend
// (https://api.ordpool.space). No auth, no rate limit (it's ours).
//
// Used to fetch a transaction's historical vout scriptpubkey_address —
// which never changes once the tx is on-chain, so results cache forever.
// This is what backs the `firstOwner` field on each cube: vout[0] of the
// reveal tx is the mint recipient's ordinals address, immutable.
//
// Retry policy: network errors, 5xx, AND 404 — the last one because
// api.ordpool.space is backed by our own electrs, so a 404 on a real
// on-chain txid means electrs hasn't ingested it yet (mining race). All
// other non-2xx statuses (403, 429, …) throw immediately with no retry.

export const ESPLORA_BASE = process.env.ESPLORA_BASE || 'https://api.ordpool.space/api';

const UA = 'ordinal-cubes-index/1.0 (https://github.com/ordpool-space/ordinal-cubes-index)';

const RETRY_ATTEMPTS = Number(process.env.ESPLORA_RETRY_ATTEMPTS ?? 3);
const RETRY_BASE_MS = Number(process.env.ESPLORA_RETRY_BASE_MS ?? 750);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status) {
  return status === 404 || (status >= 500 && status <= 599);
}

async function getJson(path) {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let status;
    try {
      const res = await fetch(`${ESPLORA_BASE}${path}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': UA },
      });
      status = res.status;
      if (res.ok) {
        // await ensures a malformed JSON body's rejection is caught by
        // this try/catch and retried, not thrown past the loop.
        return await res.json();
      }
      if (!isRetryableStatus(status)) {
        throw new Error(`esplora ${path} → HTTP ${status}`);
      }
      lastReason = `HTTP ${status}`;
    } catch (err) {
      // Non-retryable HTTP: rethrow immediately.
      if (status !== undefined && !isRetryableStatus(status)) throw err;
      // Network error / DNS / socket reset / JSON parse failure: retry.
      lastReason = err.message ?? String(err);
    }
    if (attempt === RETRY_ATTEMPTS) {
      throw new Error(`esplora ${path} — ${lastReason} (exhausted ${RETRY_ATTEMPTS} attempts)`);
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    console.warn(`  esplora ${path} — attempt ${attempt}/${RETRY_ATTEMPTS} failed (${lastReason}); retrying in ${delay}ms`);
    await sleep(delay);
  }
  throw new Error(`esplora ${path} — unreachable`);
}

/**
 * /tx/{txid} → esplora tx JSON. `vout[i].scriptpubkey_address` is
 * the bech32/bech32m address of that output, or absent for
 * scripts esplora can't decode (unusual for cube reveals).
 */
export const getTx = (txid) => getJson(`/tx/${txid}`);

/**
 * Extract the first-owner address from a cube reveal txid.
 * By SDK contract every cube reveal has vout[0] = inscription
 * recipient at 546 sats. Returns lowercase for case-insensitive
 * comparison against wallet-provided addresses. Returns null when
 * esplora can't decode the output's address.
 */
export async function getFirstOwnerAddress(revealTxid) {
  const tx = await getTx(revealTxid);
  const addr = tx?.vout?.[0]?.scriptpubkey_address;
  return typeof addr === 'string' ? addr.toLowerCase() : null;
}

/**
 * Given an inscription id like `<txid>i0`, strip the `i<n>` suffix
 * to return the reveal txid. The cube-inscription contract always
 * uses `i0`, but the extractor is permissive about the index for
 * robustness.
 */
export function revealTxidFromInscriptionId(inscriptionId) {
  const m = inscriptionId.match(/^([0-9a-f]{64})i\d+$/i);
  if (!m) throw new Error(`not a valid inscription id: ${inscriptionId}`);
  return m[1].toLowerCase();
}
