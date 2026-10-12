// Run with: node --test scripts/data-dir.test.mjs
//
// DATA_DIR is read once at module load, so each case imports the module in a
// fresh process with its own environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.join(HERE, 'data-dir.mjs');

function dataDirWith(env) {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import { DATA_DIR } from ${JSON.stringify(MODULE)}; console.log(DATA_DIR);`],
    { env: { ...process.env, DATA_DIR: '', ...env } },
  );
  return out.toString().trim();
}

test('defaults to data/ beside the scripts, the directory GitHub Pages serves', () => {
  assert.equal(dataDirWith({}), path.resolve(HERE, '..', 'data'));
});

test('DATA_DIR points the scripts at another directory, resolved to an absolute path', () => {
  assert.equal(dataDirWith({ DATA_DIR: 'some/where' }), path.resolve('some/where'));
});
