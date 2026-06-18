// Port of apps/shared/ordinals/parse-cube.ts (genesis repo). Behaviour is
// preserved byte-for-byte so the grinder's output matches the cubes-frontend's
// historical expectations.

const CUBE_REGEX = /^<html><!--cubes\.haushoppe\.art-->(<head><title>([^<>]*)<\/title><\/head>)?<body><script>t='([^']*)'<\/script><script src=\/content\/([^>]*)><\/script>$/;

export const CUBE_RENDERER_IDS = [
  '9475aa8df559d569f7284ce59e97014f28be758e832e212fdbba0202699dd035i0', // v1
  '4c5b32a1bd0dc43b3540097bf0135de6b0389f55fe6fe06910e5393bf6591a42i0', // v2
  'fed0eb2d943b1b6ce83c1d7bfb4639d3d44c7fdb161b1037c2fadaf630e55a55i0', // v3
];

/**
 * Returns the array of cube traits when the body is a valid cube, `null` otherwise.
 * @param {string} cubeHtmlRaw
 * @returns {{ trait_type: string, value: string }[] | null}
 */
export function parseCube(cubeHtmlRaw) {
  if (!cubeHtmlRaw) return null;

  // Trim trailing newline — cube 0dace1ce…7b50157i0 has one for some reason.
  cubeHtmlRaw = cubeHtmlRaw.trim();

  // Strip any trailing Cloudflare beacon. A few cubes were uploaded through a
  // service whose Cloudflare config injected `<script defer …beacon.min.js…>`
  // into the response — so the inscribed bytes literally include it. Genesis
  // CubeService had the same workaround.
  cubeHtmlRaw = cubeHtmlRaw.replace(/<script defer[\s\S]*$/, '').trim();

  const m = cubeHtmlRaw.match(CUBE_REGEX);
  if (!m) return null;

  const titleMatch = m[2];
  const data = m[3].split('|');
  const scriptId = m[4];

  const versionIndex = CUBE_RENDERER_IDS.indexOf(scriptId);
  if (versionIndex === -1) return null;

  const traits = [
    { trait_type: 'Side 1', value: data[0] },
    { trait_type: 'Side 2', value: data[1] },
    { trait_type: 'Side 3', value: data[2] },
    { trait_type: 'Side 4', value: data[3] },
    { trait_type: 'Side 5', value: data[4] },
    { trait_type: 'Side 6', value: data[5] },
    { trait_type: 'Version', value: 'v' + (versionIndex + 1) },
  ];

  if (titleMatch) {
    // Match the original .replace (not .replaceAll) — historical compatibility.
    const title = titleMatch.replace('&lt;', '<').replace('&gt;', '>');
    traits.push({ trait_type: 'Title', value: title });
  }

  return traits;
}
