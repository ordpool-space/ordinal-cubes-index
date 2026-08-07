// Run with: node --test scripts/esplora.test.mjs
//
// Tests the pure logic in esplora.mjs. The network-touching
// getFirstOwnerAddress is exercised by real grind runs; we only pin
// the two things that would silently misattribute cubes if broken:
//   1. txid extraction from `<64hex>i<n>` strips the suffix correctly
//   2. lowercase normalisation happens (or is preserved) so the value
//      is directly comparable to wallet-provided ordinals addresses

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFirstOwnerAddress, revealTxidFromInscriptionId } from './esplora.mjs';

test('revealTxidFromInscriptionId strips i0 suffix', () => {
  const id = 'f1997166547da9784a3e7419d2b248551565211811d4f5e705b685efa244451fi0';
  assert.equal(
    revealTxidFromInscriptionId(id),
    'f1997166547da9784a3e7419d2b248551565211811d4f5e705b685efa244451f',
  );
});

test('revealTxidFromInscriptionId handles non-zero suffix (i5) — cubes are always i0 but the extractor is permissive', () => {
  const id = 'a'.repeat(64) + 'i5';
  assert.equal(revealTxidFromInscriptionId(id), 'a'.repeat(64));
});

test('revealTxidFromInscriptionId lowercases the txid', () => {
  const id = 'F'.repeat(64) + 'i0';
  assert.equal(revealTxidFromInscriptionId(id), 'f'.repeat(64));
});

test('revealTxidFromInscriptionId throws on invalid ids', () => {
  assert.throws(() => revealTxidFromInscriptionId('not-an-id'), /not a valid inscription id/);
  assert.throws(() => revealTxidFromInscriptionId('deadbeefi0'), /not a valid inscription id/);
  assert.throws(() => revealTxidFromInscriptionId('a'.repeat(64)), /not a valid inscription id/);
});

test('getFirstOwnerAddress returns lowercased vout[0].scriptpubkey_address', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      vout: [
        { scriptpubkey_address: 'BC1PABCDEF' },
        { scriptpubkey_address: 'bc1qother' },
      ],
    }),
  });
  const addr = await getFirstOwnerAddress('deadbeef'.repeat(8));
  assert.equal(addr, 'bc1pabcdef');
});

test('getFirstOwnerAddress returns null when vout[0] has no address (e.g. undecodable script)', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ vout: [{ scriptpubkey: '6a20...' }] }),
  });
  const addr = await getFirstOwnerAddress('deadbeef'.repeat(8));
  assert.equal(addr, null);
});

test('getFirstOwnerAddress retries on 5xx and throws after exhausted attempts', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 500 }; };
  await assert.rejects(getFirstOwnerAddress('deadbeef'.repeat(8)), /HTTP 500/);
  assert.equal(calls, 3, 'should retry the default 3 attempts on 5xx');
});

test('getFirstOwnerAddress throws IMMEDIATELY on non-retryable status (403), no retry', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 403 }; };
  await assert.rejects(getFirstOwnerAddress('deadbeef'.repeat(8)), /HTTP 403/);
  assert.equal(calls, 1, 'non-retryable status must throw on the first attempt');
});

test('getFirstOwnerAddress retries on transient 404 (electrs ingest race), then succeeds', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 404 };
    return {
      ok: true,
      json: async () => ({ vout: [{ scriptpubkey_address: 'bc1phello' }] }),
    };
  };
  const addr = await getFirstOwnerAddress('deadbeef'.repeat(8));
  assert.equal(addr, 'bc1phello');
  assert.equal(calls, 2, 'should have retried after the transient 404');
});
