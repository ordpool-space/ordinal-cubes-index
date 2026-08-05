// Minimal esplora client for our own ordpool-backend
// (https://api.ordpool.space). No auth, no rate limit (it's ours).
//
// Used to fetch a transaction's historical vout scriptpubkey_address —
// which never changes once the tx is on-chain, so results cache forever.
// This is what backs the `firstOwner` field on each cube: vout[0] of the
// reveal tx is the mint recipient's ordinals address, immutable.

export const ESPLORA_BASE = process.env.ESPLORA_BASE || 'https://api.ordpool.space/api';

const UA = 'ordinal-cubes-index/1.0 (https://github.com/ordpool-space/ordinal-cubes-index)';

const RETRY_ATTEMPTS = Number(process.env.ESPLORA_RETRY_ATTEMPTS ?? 3);
const RETRY_BASE_MS = Number(process.env.ESPLORA_RETRY_BASE_MS ?? 750);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry policy: network errors, 5xx, AND 404. api.ordpool.space is
// backed by our own electrs — the txid we're asking about is a real
// on-chain reveal, so a 404 means electrs hasn't ingested this tx yet
// (race with mining) and a short retry usually resolves it. Non-404/5xx
// (403, 429, …) don't retry.
async function getJson(path) {
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${ESPLORA_BASE}${path}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': UA },
      });
      if (res.ok) return res.json();
      const retryable = res.status === 404 || (res.status >= 500 && res.status <= 599);
      if (!retryable || attempt === RETRY_ATTEMPTS) {
        throw new Error(`esplora ${path} → HTTP ${res.status}`);
      }
      lastErr = new Error(`esplora ${path} → HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_ATTEMPTS || (err.message && err.message.startsWith('esplora '))) {
        if (attempt === RETRY_ATTEMPTS) throw err;
        // else fall through to backoff (retryable HTTP status caught above)
      }
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    console.warn(`  esplora ${path} — attempt ${attempt}/${RETRY_ATTEMPTS} failed (${lastErr?.message ?? 'unknown'}); retrying in ${delay}ms`);
    await sleep(delay);
  }
  throw lastErr ?? new Error(`esplora ${path} — exhausted ${RETRY_ATTEMPTS} attempts`);
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
 * recipient at 546 sats (per `cat21-transfer.helper.ts` line 116
 * "Cat ordinal travels here via FIFO"). Returns lowercase for
 * case-insensitive comparison against wallet-provided addresses.
 * Returns null when esplora can't decode the output's address.
 *
 * @param {string} revealTxid — 64-hex reveal tx id (no `i0` suffix)
 * @returns {Promise<string | null>}
 */
export async function getFirstOwnerAddress(revealTxid) {
  const tx = await getTx(revealTxid);
  const addr = tx?.vout?.[0]?.scriptpubkey_address;
  return typeof addr === 'string' ? addr.toLowerCase() : null;
}

/**
 * Given an inscription id like `<txid>i0`, strip the `i<n>` suffix
 * to return the reveal txid. The cube-inscription contract always
 * uses `i0` (see parse-cube.mjs — CUBE_RENDERER_IDS all end with i0)
 * but the extractor is permissive about the index for robustness.
 */
export function revealTxidFromInscriptionId(inscriptionId) {
  const m = inscriptionId.match(/^([0-9a-f]{64})i\d+$/i);
  if (!m) throw new Error(`not a valid inscription id: ${inscriptionId}`);
  return m[1].toLowerCase();
}
