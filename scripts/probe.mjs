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

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ORD_BASE } from './ord.mjs';

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

/**
 * The probe page for one batch. Ids are pattern-checked by the caller; `<` is
 * escaped anyway.
 *
 * Two facts per id:
 *
 * - `ev` / `w` / `h`: does the browser decode it as an image at all? A side
 *   that does not is a black face for everyone.
 * - `tex`: does the browser accept that image as a WebGL texture source the
 *   way the cube renderer hands it over? An SVG without an intrinsic size
 *   decodes but is refused (`INVALID_VALUE`), which is why such cubes went
 *   black in every viewer; cubes.haushoppe.art rasterises them back into view.
 *   The upload needs an origin-clean image, so it runs on a second, CORS
 *   request; if that one fails the fact is simply unknown (`null`) and no
 *   claim is made.
 */
export function buildProbeHtml(ids, base) {
  const json = JSON.stringify({ ids, base }).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><pre id="r"></pre>
<script>
const { ids, base } = ${json};
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
function uploads(img) {
  if (!gl) return null;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  while (gl.getError() !== gl.NO_ERROR) {}
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); }
  catch (e) { gl.deleteTexture(tex); return null; }
  const err = gl.getError();
  gl.deleteTexture(tex);
  return err === gl.NO_ERROR;
}
function load(url, cors) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
(async () => {
  const out = [];
  for (const id of ids) {
    const url = base + '/content/' + id;
    const img = await load(url, false);
    if (!img) { out.push({ id, ev: 'error', w: 0, h: 0, tex: null }); continue; }
    const clean = await load(url, true);
    out.push({ id, ev: 'load', w: img.naturalWidth, h: img.naturalHeight, tex: clean ? uploads(clean) : null });
  }
  document.getElementById('r').textContent = JSON.stringify(out);
})();
</script>
`;
}

/**
 * Parses `--dump-dom` output into `{ id → { renderable, width, height, texture } }`.
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
      // true: the browser takes it as a texture. false: it is refused and only
      // renders because we rasterise it. null: not established.
      texture: entry.tex === undefined ? null : entry.tex,
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
      // Without it a headless Chrome has no WebGL at all (measured: both
      // contexts null), and the texture fact would stay unknown for every
      // side. With it the software renderer answers.
      '--enable-unsafe-swiftshader',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${path.join(dir, 'profile')}`,
      `--virtual-time-budget=${BUDGET_MS}`,
      ...(process.env.CHROME_EXTRA_ARGS ? process.env.CHROME_EXTRA_ARGS.split(' ') : []),
      '--dump-dom',
      `file://${page}`,
    ];
    // The DOM arrives on stdout within seconds; with a fresh profile dir
    // Chrome then lingers for about a minute and a half before it exits
    // (measured: 2 s to the dump, 100 s to exit). Resolve on the dump and
    // stop the process instead of waiting for it.
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const exited = new Promise((resolve) => child.on('close', resolve));
    try {
      return await new Promise((resolve, reject) => {
        let stdout = '';
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill();
          fn(value);
        };
        const timer = setTimeout(
          () => finish(reject, new Error(`chrome probe produced no DOM within ${BUDGET_MS + 30_000}ms`)),
          BUDGET_MS + 30_000,
        );
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
          if (stdout.includes('</html>')) finish(resolve, stdout);
        });
        child.on('error', (err) => finish(reject, err));
        child.on('close', () => finish(resolve, stdout));
      });
    } finally {
      // Let the process go before its profile dir is removed underneath it.
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000)).then(() => child.kill('SIGKILL'))]);
      await exited;
    }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
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
