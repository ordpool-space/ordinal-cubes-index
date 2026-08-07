// Run with: node --test scripts/ord.test.mjs
//
// Pure-logic tests for ord.mjs helpers. The retry wrapper is
// exercised transitively by the esplora tests (same shape) and by
// the live grind runs. Here we only pin the classifier used by
// grind's cursor-404 graceful-exit branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotFoundError } from './ord.mjs';

test('isNotFoundError returns true for an ord 404 error message', () => {
  const err = new Error('ord /inscription/deadbeefi0 → HTTP 404');
  assert.equal(isNotFoundError(err), true);
});

test('isNotFoundError returns false for non-404 HTTP errors', () => {
  assert.equal(isNotFoundError(new Error('ord /status → HTTP 500')), false);
  assert.equal(isNotFoundError(new Error('ord /status → HTTP 429')), false);
  assert.equal(isNotFoundError(new Error('ord /status → HTTP 403')), false);
});

test('isNotFoundError returns false for network errors', () => {
  assert.equal(isNotFoundError(new Error('fetch failed')), false);
  assert.equal(isNotFoundError(new Error('ECONNRESET')), false);
});

test('isNotFoundError returns false for non-Error inputs', () => {
  assert.equal(isNotFoundError(null), false);
  assert.equal(isNotFoundError(undefined), false);
  assert.equal(isNotFoundError('HTTP 404'), false);
  assert.equal(isNotFoundError({ message: 'HTTP 404' }), false);
});

// Regression: cursor genuinely 404s but the last retry lands a network
// glitch, so the exhausted-attempts message no longer contains 'HTTP 404'.
// The classifier must still recognise the reorg via the metadata.
test('isNotFoundError returns true when any attempt in the run saw a 404', async () => {
  const { ORD_BASE } = await import('./ord.mjs');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls <= 2) return { ok: false, status: 404 };
    throw new Error('fetch failed');
  };
  process.env.ORD_RETRY_BASE_MS = '1';
  try {
    const { getInscription, isNotFoundError: isNotFound } = await import(`./ord.mjs?t=${Date.now()}`);
    try {
      await getInscription('deadbeef'.repeat(8) + 'i0');
      assert.fail('expected throw');
    } catch (err) {
      // Message shouldn't contain HTTP 404 (last attempt was a network error)
      // but saw404 metadata must be true so isNotFoundError recognises it.
      assert.equal(/HTTP 404/.test(err.message), false, 'sanity: last-attempt reason is not 404');
      assert.equal(isNotFound(err), true, 'saw404 metadata should mark this as a 404');
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ORD_RETRY_BASE_MS;
  }
});
