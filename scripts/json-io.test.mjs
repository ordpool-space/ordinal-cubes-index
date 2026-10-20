// Run with: node --test scripts/json-io.test.mjs
//
// The on-disk format is load-bearing: two-space indent and a trailing newline
// keep the committed index files line-oriented, so a one-cube change is a
// small diff on GitHub rather than a whole-file rewrite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from './json-io.mjs';

test('writeJson then readJson round-trips the value', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cubes-json-io-'));
  try {
    const p = path.join(dir, 'x.json');
    const value = { cubes: [{ n: 1 }, { n: 2 }], tip: 'abc' };
    await writeJson(p, value);
    assert.deepEqual(await readJson(p), value);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeJson emits two-space indent and a single trailing newline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cubes-json-io-'));
  try {
    const p = path.join(dir, 'x.json');
    await writeJson(p, [1, 2]);
    assert.equal(await readFile(p, 'utf-8'), '[\n  1,\n  2\n]\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
