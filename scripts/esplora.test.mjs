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

test('getFirstOwnerAddress throws on esplora HTTP error', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(getFirstOwnerAddress('deadbeef'.repeat(8)), /HTTP 500/);
});
