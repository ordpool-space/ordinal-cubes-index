// Run with: node --test scripts/parse-cube.test.mjs
//
// The renderer id decides whether a body is a cube at all and which version it
// is. The override is read once at module load, so each case imports the
// module in a fresh process with its own environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'parse-cube.mjs');
const MAINNET_V3 = 'fed0eb2d943b1b6ce83c1d7bfb4639d3d44c7fdb161b1037c2fadaf630e55a55i0';
const OTHER_V3 = `${'e'.repeat(64)}i0`;
const SIDES = Array.from({ length: 6 }, (_, i) => `${String(i + 1).repeat(64)}i0`);

const body = (renderer) =>
  `<html><!--cubes.haushoppe.art--><body><script>t='${SIDES.join('|')}'</script><script src=/content/${renderer}></script>`;

/** parseCube(body) in a child process with `env` added. */
function parseWith(env, html) {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import { parseCube } from ${JSON.stringify(MODULE)}; console.log(JSON.stringify(parseCube(process.argv[1])));`, html],
    { env: { ...process.env, CUBE_RENDERER_ID_V3: '', ...env } },
  );
  return JSON.parse(out.toString());
}

const version = (traits) => traits?.find((t) => t.trait_type === 'Version')?.value ?? null;

test('without an override the mainnet v3 renderer is a v3 cube', () => {
  assert.equal(version(parseWith({}, body(MAINNET_V3))), 'v3');
});

test('without an override another renderer id is not a cube', () => {
  assert.equal(parseWith({}, body(OTHER_V3)), null);
});

test('CUBE_RENDERER_ID_V3 takes the v3 slot: its cubes read as v3', () => {
  const traits = parseWith({ CUBE_RENDERER_ID_V3: OTHER_V3 }, body(OTHER_V3));
  assert.equal(version(traits), 'v3');
  assert.deepEqual(traits.slice(0, 6).map((t) => t.value), SIDES);
});

test('CUBE_RENDERER_ID_V3 replaces the mainnet v3 renderer rather than adding to it', () => {
  assert.equal(parseWith({ CUBE_RENDERER_ID_V3: OTHER_V3 }, body(MAINNET_V3)), null);
});
