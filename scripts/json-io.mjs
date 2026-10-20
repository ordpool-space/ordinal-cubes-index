// Read and write the index files as pretty-printed JSON. Every file in `data/`
// is an array or object serialized with two-space indent and a trailing
// newline, so a diff stays line-oriented and GitHub Pages serves it verbatim.

import { readFile, writeFile } from 'node:fs/promises';

export async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf-8'));
}

export async function writeJson(p, v) {
  await writeFile(p, JSON.stringify(v, null, 2) + '\n');
}
