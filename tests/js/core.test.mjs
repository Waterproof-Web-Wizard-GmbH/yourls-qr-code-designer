// Tests for assets/qrcd-core.js. Run: npm test
// Renders real QR codes with the bundled qr-code-styling and decodes them with jsQR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import nodeCanvas from 'canvas';

const require = createRequire(import.meta.url);
const core = require('../../assets/qrcd-core.js');
const QRCodeStyling = require('../../vendor/qr-code-styling/qr-code-styling.js');
const jsQR = require('../../vendor/jsqr/jsQR.js');

const URL_SHORT = 'https://go.example.com/termin';
const URL_LONG = 'https://go.example.com/kampagne-herbst?utm_source=print&utm_medium=flyer&utm_campaign=messe-2026-halle-b';
const LOGO = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><rect width="300" height="100" rx="12" fill="#c00"/><text x="150" y="68" font-size="56" text-anchor="middle" fill="#fff">LOGO</text></svg>'
).toString('base64');

async function render(data, s, { size = 600, dots = 'square', type = 'canvas', quiet = 4, ecc = 'H' } = {}) {
  let inst;
  const opts = (margin) => ({
    jsdom: JSDOM, nodeCanvas, type, width: size, height: size, margin, data,
    qrOptions: { errorCorrectionLevel: ecc },
    dotsOptions: { type: dots, color: '#111111' },
    cornersSquareOptions: { type: 'rounded', color: '#a00000' },
    cornersDotOptions: { type: 'rounded', color: '#a00000' },
    backgroundOptions: { color: '#ffffff' },
  });
  inst = new QRCodeStyling(opts(0));
  const n = inst._qr.getModuleCount();
  const margin = Math.round((size * quiet) / (n + 2 * quiet));
  const state = { ...s };
  if (state.logo) {
    const box = core.logoBox(n, state.size ?? 0.3, state.aspect ?? 3, state.margin ?? 1);
    const pos = core.placeBox(n, box.W, box.H, state.dx ?? 0, state.dy ?? 0);
    assert.ok(pos, 'logo box must fit');
    state.box = { ...box, ...pos };
  }
  inst = new QRCodeStyling(opts(margin));
  inst.applyExtension(core.extension(() => inst._qr.getModuleCount(), state));
  return { inst, n, state, raw: await inst.getRawData(type === 'svg' ? 'svg' : 'png') };
}

// Same rule as the in-browser scan test: readable at one of four sizes counts as a pass.
const SCAN_SIZES = [300, 400, 600, 800];
async function decode(png) {
  const img = await nodeCanvas.loadImage(png);
  for (const size of SCAN_SIZES) {
    const c = nodeCanvas.createCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const r = jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'attemptBoth' });
    if (r) return r.data;
  }
  return null;
}

test('protected mask covers finders, timing and format but not the centre', () => {
  const n = 25; // version 2
  const m = core.protectedMask(n);
  assert.equal(m[0], 1);
  assert.equal(m[8 * n + 8], 1, 'format information next to top left finder');
  assert.equal(m[0 * n + (n - 1)], 1);
  assert.equal(m[(n - 1) * n + 0], 1);
  assert.equal(m[6 * n + 12], 1, 'horizontal timing pattern');
  assert.equal(m[12 * n + 6], 1, 'vertical timing pattern');
  assert.equal(m[12 * n + 12], 0, 'centre is free');
  assert.equal(m[18 * n + 18], 1, 'alignment pattern of version 2');
});

test('version information is protected from version 7 on', () => {
  const n = 45;
  const m = core.protectedMask(n);
  assert.equal(m[0 * n + (n - 10)], 1);
  assert.equal(m[(n - 10) * n + 0], 1);
  assert.equal(m[22 * n + 22], 0, 'central alignment pattern may be covered');
});

test('keep-out mask adds one module of air and the outer ring', () => {
  const n = 25;
  const m = core.keepOutMask(n);
  assert.equal(m[9 * n + 9], 1, 'next to the format information');
  assert.equal(m[12 * n + 0], 1, 'outer ring');
  assert.equal(m[12 * n + 12], 0);
});

test('logo box keeps within 15 % of the modules', () => {
  const box = core.logoBox(25, 0.6, 1, 1);
  assert.ok(box.W * box.H <= 0.15 * 25 * 25);
  assert.equal(box.limited, true);
  const wide = core.logoBox(33, 0.3, 3.6, 1);
  assert.ok(wide.w > wide.h);
  assert.equal(wide.limited, false);
});

test('placement stays centred by default and never touches protected modules', () => {
  const n = 33;
  const mask = core.keepOutMask(n);
  const box = core.logoBox(n, 0.3, 3, 1);
  const centre = core.placeBox(n, box.W, box.H, 0, 0, mask);
  assert.equal(centre.clamped, false);
  assert.equal(centre.x, Math.floor((n - box.W) / 2));
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [0, -1]]) {
    const p = core.placeBox(n, box.W, box.H, dx, dy, mask);
    assert.ok(p, `position for ${dx},${dy}`);
    for (let r = p.y; r < p.y + box.H; r++) {
      for (let c = p.x; c < p.x + box.W; c++) assert.equal(mask[r * n + c], 0, `cell ${r},${c} for ${dx},${dy}`);
    }
  }
});

test('print check uses the real rendered geometry', () => {
  // 3 cm at 300 dpi = 355 px; qr-code-styling draws 25 modules of floor((355 - 2 * 43) / 25) = 10 px.
  const r = core.printCheck({ cm: 3, dpi: 300, distanceCm: 50, n: 25, quiet: 4, box: { w: 9 }, logoWidthPx: 80, logoIsVector: false });
  assert.equal(r.px, 355);
  assert.equal(r.exportPx, 355);
  assert.equal(r.moduleMm, 0.84);
  assert.equal(r.minCm, 5);
  assert.equal(r.logoPxNeeded, 90);
  assert.deepEqual(r.warnings.map((w) => w.code), ['distance', 'logo']);
  const tiny = core.printCheck({ cm: 1, dpi: 300, n: 57, quiet: 4 });
  assert.equal(tiny.warnings[0].code, 'module');
  assert.equal(core.printCheck({ cm: 3, n: 25, quiet: 4, box: { w: 9 }, logoWidthPx: 50, logoIsVector: true }).warnings.length, 0);
});

test('print check caps the export size and says so', () => {
  const r = core.printCheck({ cm: 30, dpi: 600, n: 25, quiet: 4 });
  assert.equal(r.px, 7087);
  assert.equal(r.exportPx, 6000);
  assert.equal(r.warnings[0].code, 'maxSize');
});

test('print check module size matches a real render', async () => {
  const size = 355;
  const inst = new QRCodeStyling({ jsdom: JSDOM, nodeCanvas, type: 'svg', width: size, height: size, margin: 43, data: 'https://go.example.com/termin', qrOptions: { errorCorrectionLevel: 'H' } });
  const svg = (await inst.getRawData('svg')).toString();
  const w = Number(/<clipPath id="clip-path-dot-color-\d+"><rect [^>]*width="([\d.]+)"/.exec(svg)[1]);
  const n = inst._qr.getModuleCount();
  const r = core.printCheck({ cm: 3, dpi: 300, n, quiet: 4 });
  assert.equal(r.moduleMm, Math.floor(w * (30 / size) * 100) / 100);
});

test('fmt and contrast helpers', () => {
  assert.equal(core.fmt('%1$s of %2$s', 3, 4), '3 of 4');
  assert.equal(core.fmt('a %s b %s', 1, 2), 'a 1 b 2');
  assert.ok(core.contrast('#000000', '#ffffff') > 20);
  assert.ok(core.contrast('#ffff00', '#ffffff') < 2);
});

const cases = [
  ['plain', URL_SHORT, {}, {}],
  ['dot gap 25 %', URL_SHORT, { gap: 0.25 }, {}],
  ['circles with gap', URL_SHORT, { gap: 0.1 }, { dots: 'dots' }],
  ['rounded dots, logo centred', URL_SHORT, { logo: { href: LOGO }, hideDots: true }, { dots: 'rounded' }],
  ['logo far right', URL_SHORT, { logo: { href: LOGO }, hideDots: true, dx: 1 }, {}],
  ['logo top left with gap', URL_SHORT, { logo: { href: LOGO }, hideDots: true, dx: -1, dy: -1, gap: 0.2 }, {}],
  ['long URL, logo bottom', URL_LONG, { logo: { href: LOGO }, hideDots: true, dy: 1, aspect: 1, size: 0.25 }, {}],
  ['long URL, classy rounded, logo right', URL_LONG, { logo: { href: LOGO }, hideDots: true, dx: 1 }, { dots: 'classy-rounded' }],
];

for (const [name, data, state, opts] of cases) {
  test(`scannable: ${name}`, async () => {
    const { raw, state: s, n } = await render(data, state, opts);
    assert.equal(await decode(raw), data);
    if (s.box) {
      const mask = core.protectedMask(n);
      for (let r = s.box.y; r < s.box.y + s.box.H; r++) {
        for (let c = s.box.x; c < s.box.x + s.box.W; c++) assert.equal(mask[r * n + c], 0);
      }
    }
  });
}

test('svg export contains the logo and shrunk dots', async () => {
  const { raw } = await render(URL_SHORT, { logo: { href: LOGO }, hideDots: true, dx: 1, gap: 0.2 }, { type: 'svg' });
  const svg = raw.toString();
  assert.match(svg, /<image [^>]*href="data:image\/svg\+xml;base64,/);
  assert.match(svg, /scale\(0\.8\)/);
});
