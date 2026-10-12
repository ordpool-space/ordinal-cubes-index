// Where the index files live. `data/` beside the scripts by default, which is
// what GitHub Pages serves. `DATA_DIR` points every script at another
// directory, so the same code can index a different chain (a regtest stack)
// without touching the published files.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
