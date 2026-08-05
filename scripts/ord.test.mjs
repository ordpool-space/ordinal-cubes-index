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
