// Run with: node --test scripts/probe.test.mjs
//
// Pure parts of the image probe: the page it feeds Chrome and the parser
// for what comes back. The browser round trip itself is exercised by
// `npm run rarity` against live ord.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProbeHtml, INSCRIPTION_ID, parseProbeOutput } from './probe.mjs';

const ID = 'df58fbb44dbb2a9b17405f944c8ff966fd120cccda87873f3206f012ea239bebi0';

test('INSCRIPTION_ID accepts the renderer-loadable shape and rejects the rest', () => {
  assert.equal(INSCRIPTION_ID.test(ID), true);
  assert.equal(INSCRIPTION_ID.test('7f06d41d3660200b412e86e0ee264adbaee049b761752227225e35a3eb2838b0i07'), true);
  assert.equal(INSCRIPTION_ID.test('not an id'), false);
  assert.equal(INSCRIPTION_ID.test(ID.slice(0, -2)), false);
  assert.equal(INSCRIPTION_ID.test(''), false);
});

test('buildProbeHtml embeds the ids and base and cannot be broken out of with a <', () => {
  const html = buildProbeHtml([ID, 'x</script><script>alert(1)'], 'https://ord.ordpool.space');
  assert.ok(html.includes(`"${ID}"`));
  assert.ok(html.includes('"https://ord.ordpool.space"'));
  assert.equal(html.includes('</script><script>alert'), false);
  assert.ok(html.includes('\\u003c/script>'));
});

test('parseProbeOutput maps load with a size to renderable and error to not renderable', () => {
  const dom = `<html><head></head><body><pre id="r">[{"id":"a","ev":"load","w":150,"h":150,"tex":true},{"id":"b","ev":"error","w":0,"h":0,"tex":null},{"id":"c","ev":"load","w":0,"h":0,"tex":null}]</pre></body></html>`;
  assert.deepEqual(parseProbeOutput(dom), {
    a: { renderable: true, width: 150, height: 150, texture: true },
    b: { renderable: false, width: 0, height: 0, texture: null },
    c: { renderable: false, width: 0, height: 0, texture: null },
  });
});

test('parseProbeOutput keeps the texture fact apart from decoding', () => {
  // The Chrome case: the image decodes, but the browser refuses it as a
  // texture source, so the face renders only where it is rasterised.
  const dom = `<html><body><pre id="r">[{"id":"svg","ev":"load","w":203,"h":150,"tex":false}]</pre></body></html>`;
  assert.deepEqual(parseProbeOutput(dom), { svg: { renderable: true, width: 203, height: 150, texture: false } });
});

test('parseProbeOutput records an unknown texture fact as null, never as a refusal', () => {
  const dom = `<html><body><pre id="r">[{"id":"x","ev":"load","w":10,"h":10}]</pre></body></html>`;
  assert.equal(parseProbeOutput(dom).x.texture, null);
});

test('parseProbeOutput reports an unsettled batch as null instead of guessing', () => {
  assert.equal(parseProbeOutput('<html><body><pre id="r"></pre></body></html>'), null);
  assert.equal(parseProbeOutput(''), null);
});
