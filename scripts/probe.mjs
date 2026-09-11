// Image probe: does a side inscription render on a cube face?
//
// The cube renderer loads every side through three.js' TextureLoader,
// which is a plain `<img src="/content/<id>">`. A face is black exactly
// when that image fails to decode: a missing inscription (404), a
// non-image body (text, HTML, JSON, a 3D model) or bytes the browser
// cannot decode. Nothing about that is visible in a content type alone,
// so the probe asks a real browser the same question the renderer asks:
// load the image, report `naturalWidth` / `naturalHeight`.
//
// Runs headless Chrome without any npm dependency: a temporary HTML page
// loads a batch of images, writes the outcome into a <pre> once every
// image has fired `load` or `error`, and `--dump-dom` prints the page.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ORD_BASE } from './ord.mjs';

const execFileAsync = promisify(execFile);

/** Inscription id shape the renderer can request at all; anything else is black without a probe. */
export const INSCRIPTION_ID = /^[0-9a-f]{64}i\d+$/;

const BATCH_SIZE = Number(process.env.PROBE_BATCH_SIZE ?? 50);
const BUDGET_MS = Number(process.env.PROBE_BUDGET_MS ?? 60_000);

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
];

/** Path of a Chrome / Chromium binary, or throws. `CHROME_BIN` wins. */
export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate) continue;
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const found = execFileSync('which', [candidate], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (found) return found;
    } catch {
      // not on PATH, try the next one
    }
  }
  throw new Error('No Chrome or Chromium binary found; set CHROME_BIN');
}

/** The probe page for one batch. Ids are pattern-checked by the caller; `<` is escaped anyway. */
export function buildProbeHtml(ids, base) {
  const json = JSON.stringify({ ids, base }).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><pre id="r"></pre>
<script>
const { ids, base } = ${json};
const out = [];
let pending = ids.length;
const finish = () => { document.getElementById('r').textContent = JSON.stringify(out); };
if (pending === 0) finish();
for (const id of ids) {
  const img = new Image();
  const done = (ev) => {
    out.push({ id, ev, w: img.naturalWidth, h: img.naturalHeight });
    if (--pending === 0) finish();
  };
  img.onload = () => done('load');
  img.onerror = () => done('error');
  img.src = base + '/content/' + id;
}
</script>
`;
}

/**
 * Parses `--dump-dom` output into `{ id → { renderable, width, height } }`.
 * An empty <pre> means not every image had settled inside the time budget;
 * the batch is reported incomplete so the caller leaves those ids unprobed
 * and a later run retries them, instead of recording a wrong answer.
 */
export function parseProbeOutput(dom) {
  const match = dom.match(/<pre id="r">([\s\S]*?)<\/pre>/);
  if (!match || !match[1].trim()) return null;
  const text = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const result = {};
  for (const entry of JSON.parse(text)) {
    result[entry.id] = {
      renderable: entry.ev === 'load' && entry.w > 0 && entry.h > 0,
      width: entry.w,
      height: entry.h,
    };
  }
  return result;
}

async function runChrome(chrome, html) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cube-probe-'));
  try {
    const page = path.join(dir, 'probe.html');
    await writeFile(page, html);
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${path.join(dir, 'profile')}`,
      `--virtual-time-budget=${BUDGET_MS}`,
      ...(process.env.CHROME_EXTRA_ARGS ? process.env.CHROME_EXTRA_ARGS.split(' ') : []),
      '--dump-dom',
      `file://${page}`,
    ];
    const { stdout } = await execFileAsync(chrome, args, {
      timeout: BUDGET_MS + 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Probes `ids` in batches. Resolves to `{ id → { renderable, width, height } }`
 * for every id that settled; ids of an incomplete batch are absent.
 */
export async function probeImages(ids, { base = ORD_BASE, log = () => {} } = {}) {
  const result = {};
  if (ids.length === 0) return result;
  const chrome = findChrome();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const dom = await runChrome(chrome, buildProbeHtml(batch, base));
    const parsed = parseProbeOutput(dom);
    if (!parsed) {
      log(`  probe batch ${i / BATCH_SIZE + 1}: incomplete after ${BUDGET_MS}ms, ${batch.length} ids left unprobed`);
      continue;
    }
    Object.assign(result, parsed);
    log(`  probe batch ${i / BATCH_SIZE + 1}: ${Object.keys(parsed).length} ids settled`);
  }
  return result;
}
