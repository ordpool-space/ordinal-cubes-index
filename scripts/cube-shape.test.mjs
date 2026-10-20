// Run with: node --test scripts/cube-shape.test.mjs
//
// The shape pre-filter runs on metadata alone before any content fetch, so its
// content-type match and length bounds are what keep the walk from reading the
// body of millions of non-cube inscriptions. The bounds are load-bearing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCubeShape, MIN_LEN, MAX_LEN } from './cube-shape.mjs';

test('accepts an HTML inscription whose length is inside the bounds', () => {
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: 600 }), true);
  assert.equal(looksLikeCubeShape({ content_type: 'text/html;charset=utf-8', content_length: 600 }), true);
});

test('matches the content type case-insensitively', () => {
  assert.equal(looksLikeCubeShape({ content_type: 'TEXT/HTML', content_length: 600 }), true);
});

test('rejects a non-HTML content type', () => {
  assert.equal(looksLikeCubeShape({ content_type: 'image/png', content_length: 600 }), false);
  assert.equal(looksLikeCubeShape({ content_type: 'text/plain', content_length: 600 }), false);
});

test('rejects a missing content type without throwing', () => {
  assert.equal(looksLikeCubeShape({ content_length: 600 }), false);
});

test('length bounds are inclusive at both ends and exclusive just outside', () => {
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: MIN_LEN }), true);
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: MAX_LEN }), true);
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: MIN_LEN - 1 }), false);
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: MAX_LEN + 1 }), false);
});

test('rejects a non-numeric or absent length', () => {
  assert.equal(looksLikeCubeShape({ content_type: 'text/html' }), false);
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: '600' }), false);
  assert.equal(looksLikeCubeShape({ content_type: 'text/html', content_length: null }), false);
});
