// Run with: node --test scripts/collections.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShard, shardPrefix } from './collections.mjs';

test('shardPrefix is the first three hex characters of the id', () => {
  assert.equal(shardPrefix('3d228390e86dd1f02fc010b5b0273280f9576583313711aad5f884bd43b2e363i0'), '3d2');
});

test('parseShard skips the header and maps id to symbol', () => {
  const map = parseShard('id,symbol\naaa1,omb\naaa2,bitcoin-frogs\n\naaa3,name,with,commas\n');
  assert.equal(map.get('aaa1'), 'omb');
  assert.equal(map.get('aaa2'), 'bitcoin-frogs');
  assert.equal(map.get('aaa3'), 'name,with,commas');
  assert.equal(map.has('id'), false);
  assert.equal(map.size, 3);
});
