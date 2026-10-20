// Cube content shape, the cheap metadata-only pre-filter that both the walker
// (grind) and the parallel scan (backfill) run before fetching an
// inscription's body. Narrow enough to skip the vast majority of inscriptions
// on `content_type` and `content_length` alone; a survivor still has to match
// the cube marker in `parse-cube.mjs` on its actual content.

export const HTML_CONTENT_TYPES = new Set(['text/html;charset=utf-8', 'text/html']);
export const MIN_LEN = 400;
export const MAX_LEN = 900;

export function looksLikeCubeShape(meta) {
  if (!HTML_CONTENT_TYPES.has((meta.content_type ?? '').toLowerCase())) return false;
  const len = meta.content_length;
  return typeof len === 'number' && len >= MIN_LEN && len <= MAX_LEN;
}
