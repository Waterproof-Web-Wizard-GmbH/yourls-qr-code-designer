// Headless smoke test of the real admin page: PHP-rendered HTML + all four scripts in jsdom with node-canvas.
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '.');
const html = fs.readFileSync(path.join(dir, 'tests/smoke/page.html'), 'utf8').replace(/<script defer src="[^"]*"><\/script>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="215" height="59" viewBox="0 0 215 59"><rect width="215" height="59" fill="#c00"/></svg>';
const logoHref = 'data:image/svg+xml;base64,' + Buffer.from(logoSvg).toString('base64');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
vc.on('error', (e) => errors.push(String(e)));

const dom = new JSDOM(html, {
  runScripts: 'outside-only', resources: 'usable', pretendToBeVisual: true, url: 'https://sho.rt/admin/plugins.php?page=qr_code_designer&k=smoke', virtualConsole: vc,
  beforeParse(window) {
    window.localStorage.setItem('qrcd-default', JSON.stringify({ fg: '#000000', corner: '#9b0202', cornergrad: true, corner2: '#bc0a0a', cornersq: 'rounded', cornerdot: 'rounded', gap: '0.2', logo: logoHref, logox: '100', logoy: '0' }));
    // jsdom has no createImageBitmap: decode the blob through an <img>, which jsdom draws with node-canvas.
    window.createImageBitmap = (blob) => new Promise((resolve, reject) => {
      const r = new window.FileReader();
      r.onload = () => { const img = new window.Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = r.result; };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  },
});
const { window } = dom;
for (const f of ['vendor/qr-code-styling/qr-code-styling.js', 'vendor/jsqr/jsQR.js', 'assets/qrcd-core.js', 'assets/admin.js']) {
  window.eval(fs.readFileSync(path.join(dir, f), 'utf8'));
}
const $ = (id) => window.document.getElementById(`qrcd-${id}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return false; };
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`);

check('preview canvas drawn', await until(() => $('preview').querySelector('canvas')));
check('content preloaded', /\/smoke$/.test($('data').value), $('data').value);
check('presets listed', $('preset').options.length === 5, String($('preset').options.length));
check('saved default restored (gap, corner gradient)', $('gap').value === '0.2' && $('cornergrad').checked);
check('logo forces error correction H', await until(() => $('ecc').disabled && $('ecc').value === 'H'));
check('logo pushed right stops at the safe area', await until(() => /safe area/.test($('status').textContent)), $('status').textContent);
check('scan test passes with logo, gap and gradient', await until(() => /passed/.test($('scan').textContent), 15000), $('scan').textContent);

$('printcm').value = '3';
$('distance').value = '50';
$('printcm').dispatchEvent(new window.Event('input', { bubbles: true }));
check('print check sets export size', await until(() => $('size').value === '355'), $('size').value);
check('print check warns about distance', /at least 5 cm/.test($('printinfo').textContent), $('printinfo').textContent);

$('fg').value = '#eeeeee';
$('fg').dispatchEvent(new window.Event('input', { bubbles: true }));
check('contrast warning for light dots', await until(() => /Low contrast between dots/.test($('status').textContent)), $('status').textContent);
check('scan test fails for unreadable code', await until(() => /failed/.test($('scan').textContent), 15000), $('scan').textContent);

$('logo-del').click();
$('fg').value = '#000000';
$('fg').dispatchEvent(new window.Event('input', { bubbles: true }));
check('logo removed, ECC selectable again', await until(() => !$('ecc').disabled));
check('scan passes again', await until(() => /passed/.test($('scan').textContent), 15000), $('scan').textContent);

$('preset').value = 'dots';
$('preset').dispatchEvent(new window.Event('change', { bubbles: true }));
check('preset applies shapes', await until(() => $('dots').value === 'dots' && $('cornersq').value === 'dot'));

check('no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
window.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
