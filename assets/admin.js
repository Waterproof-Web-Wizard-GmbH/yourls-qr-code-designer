/*!
 * QR Code Designer for YOURLS: admin page.
 * https://github.com/Waterproof-Web-Wizard-GmbH/yourls-qr-code-designer
 * MIT License, Waterproof Web Wizard GmbH
 *
 * Renders QR codes in the browser with qr-code-styling, checks them with jsQR.
 * Nothing is sent to a server.
 */
(() => {
  'use strict';

  const root = document.getElementById('qrcd');
  const configEl = document.getElementById('qrcd-config');
  const Core = window.QrcdCore;
  const QR = window.QRCodeStyling;
  if (!root || !configEl || !Core || typeof QR !== 'function') return;

  const cfg = JSON.parse(configEl.textContent || '{}');
  const t = cfg.i18n || {};
  const $ = (id) => document.getElementById(`qrcd-${id}`);
  const STORAGE_KEY = 'qrcd-default';
  const MAX_STORED_LOGO = 1500000;
  const PREVIEW = 320;
  const SCAN_SIZES = [300, 400, 600, 800];
  const MIN_PX = 200;
  const MAX_PX = 6000;
  const MAX_LOGO_PX = 2048;
  const FIELDS = ['fg', 'fggrad', 'fg2', 'corner', 'cornergrad', 'corner2', 'bg', 'transparent', 'dots', 'cornersq',
    'cornerdot', 'gap', 'logosize', 'logomargin', 'hidedots', 'logox', 'logoy', 'size', 'quiet', 'ecc', 'printcm',
    'dpi', 'distance'];

  const read = (f) => {
    const el = $(f);
    return el.type === 'checkbox' ? el.checked : el.value;
  };
  const num = (f) => Number(read(f)) || 0;
  const snapshot = () => Object.fromEntries(FIELDS.map((f) => [f, read(f)]));
  const DEFAULTS = snapshot();

  /** Set fields; unknown select values (e.g. from an older saved default) fall back to the defaults. */
  function write(values) {
    FIELDS.forEach((f) => {
      if (values[f] === undefined) return;
      const el = $(f);
      if (el.type === 'checkbox') el.checked = Boolean(values[f]);
      else el.value = values[f];
      if (el.tagName === 'SELECT' && el.selectedIndex === -1) el.value = DEFAULTS[f];
    });
  }

  let logo = null; // { href, width, aspect, vector }
  let layout = null;
  let n = 21;
  let frame = 0;
  let scanTimer = 0;
  let scanRun = 0;
  let scanState = 'idle';
  const live = { gap: 0, logo: null, box: null, hideDots: true };
  const countCache = new Map();

  const data = () => $('data').value.trim();
  const exportSize = () => Math.min(MAX_PX, Math.max(MIN_PX, num('size') || 1000));
  const ecc = () => (logo ? 'H' : read('ecc'));

  /** Module count for the current content and error correction (cached, tiny probe render). */
  function moduleCount() {
    const key = `${ecc()}|${data()}`;
    if (!countCache.has(key)) {
      let count = 21;
      try {
        const probe = new QR({ type: 'svg', width: 60, height: 60, data: data() || ' ', qrOptions: { errorCorrectionLevel: ecc() } });
        count = probe._qr.getModuleCount();
      } catch (e) { /* keep the fallback */ }
      countCache.set(key, count);
    }
    return countCache.get(key);
  }

  function computeLayout() {
    n = moduleCount();
    if (!logo) return null;
    const box = Core.logoBox(n, num('logosize'), logo.aspect, num('logomargin'));
    const pos = Core.placeBox(n, box.W, box.H, num('logox') / 100, num('logoy') / 100);
    return pos ? { ...box, ...pos } : { ...box, noRoom: true };
  }

  const gradient = (a, b) => ({ type: 'linear', rotation: Math.PI / 4, colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }] });

  function options(size, { jpeg = false, svg = false } = {}) {
    const quiet = num('quiet');
    const fg = read('fg');
    const corner = read('corner');
    const cornerGradient = read('cornergrad') ? gradient(corner, read('corner2')) : undefined;
    return {
      width: size,
      height: size,
      type: svg ? 'svg' : 'canvas',
      data: data() || ' ',
      margin: quiet ? Math.round((size * quiet) / (n + 2 * quiet)) : 0,
      qrOptions: { errorCorrectionLevel: ecc() },
      dotsOptions: { type: read('dots'), color: fg, gradient: read('fggrad') ? gradient(fg, read('fg2')) : undefined },
      cornersSquareOptions: { type: read('cornersq'), color: corner, gradient: cornerGradient },
      cornersDotOptions: { type: read('cornerdot'), color: corner, gradient: cornerGradient },
      backgroundOptions: { color: read('transparent') && !jpeg ? 'transparent' : read('bg') },
    };
  }

  function extensionState() {
    const placed = Boolean(layout && !layout.noRoom);
    return { gap: num('gap'), logo: placed ? { href: logo.href } : null, box: placed ? layout : null, hideDots: read('hidedots') };
  }

  /** Fresh instance for downloads, copy and the scan test. Drawn once, with the extension. */
  function build(size, flags) {
    const opts = options(size, flags);
    const inst = new QR({ ...opts, data: '' });
    inst.applyExtension(Core.extension(() => (inst._qr ? inst._qr.getModuleCount() : 0), extensionState()));
    inst.update(opts);
    return inst;
  }

  const preview = new QR({ ...options(PREVIEW), data: '' });
  preview.applyExtension(Core.extension(() => (preview._qr ? preview._qr.getModuleCount() : 0), live));
  preview.append($('preview'));

  /** Update a live region only when something changed, so screen readers do not repeat it. */
  function status(el, text, warn) {
    if (el.textContent === text && el.classList.contains('is-warning') === warn) return;
    el.textContent = text;
    el.classList.toggle('is-warning', warn);
  }

  function warnings() {
    const w = [];
    if (!data()) w.push(t.empty);
    if (read('transparent')) {
      w.push(t.transparent);
    } else {
      const bg = read('bg');
      const low = (colours) => colours.some((c) => Core.contrast(c, bg) < 4);
      if (low(read('fggrad') ? [read('fg'), read('fg2')] : [read('fg')])) w.push(t.contrastDots);
      if (low(read('cornergrad') ? [read('corner'), read('corner2')] : [read('corner')])) w.push(t.contrastCorners);
      if (Core.luminance(read('fg')) > Core.luminance(bg)) w.push(t.inverted);
    }
    if (layout && layout.noRoom) w.push(t.logoNoRoom);
    if (layout && !layout.noRoom && layout.limited) w.push(t.logoLimited);
    if (layout && !layout.noRoom && layout.clamped) w.push(t.logoClamped);
    return w.filter(Boolean);
  }

  function printInfo() {
    const el = $('printinfo');
    const placed = layout && !layout.noRoom ? layout : null;
    const res = Core.printCheck({
      cm: num('printcm'), dpi: num('dpi'), distanceCm: num('distance'), n, quiet: num('quiet'), maxPx: MAX_PX,
      box: placed, logoWidthPx: logo ? logo.width : 0, logoIsVector: logo ? logo.vector : false,
    });
    if (!res.px) {
      status(el, '', false);
      return;
    }
    if (num('size') !== res.exportPx) $('size').value = String(res.exportPx);
    const lines = [Core.fmt(t.printPx, res.px, num('dpi')), Core.fmt(t.printModule, res.moduleMm)];
    res.warnings.forEach((w) => {
      if (w.code === 'maxSize') lines.push(Core.fmt(t.warnMaxSize, w.max));
      if (w.code === 'module') lines.push(Core.fmt(t.warnModule, w.mm, w.minCm));
      if (w.code === 'distance') lines.push(Core.fmt(t.warnDistance, w.minCm));
      if (w.code === 'logo') lines.push(Core.fmt(t.warnLogo, w.have, w.need));
    });
    status(el, lines.join(' '), res.warnings.length > 0);
  }

  function render() {
    frame = 0;
    layout = computeLayout();
    Object.assign(live, extensionState());
    stage.classList.toggle('has-logo', Boolean(logo));
    try {
      preview.update(options(PREVIEW));
    } catch (e) {
      // qr-code-styling throws when the content exceeds the capacity of version 40.
      status($('status'), t.tooLong, true);
      root.querySelectorAll('[data-ext], #qrcd-copy').forEach((b) => { b.disabled = true; });
      return;
    }
    $('gap-out').value = `${Math.round(num('gap') * 100)} %`;
    $('logosize-out').value = `${Math.round(num('logosize') * 100)} %`;
    $('ecc').disabled = Boolean(logo);
    if (logo) $('ecc').value = 'H';
    const w = warnings();
    status($('status'), w.join(' '), w.length > 0);
    printInfo();
    const hasData = data() !== '';
    root.querySelectorAll('[data-ext], #qrcd-copy').forEach((b) => { b.disabled = !hasData; });
    scheduleScan();
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }

  /* Scan test: decode the rendered code at four sizes, like a phone at different distances. */
  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanRun += 1;
    if (!data() || typeof window.jsQR !== 'function') {
      scanState = 'idle';
      status($('scan'), '', false);
      return;
    }
    scanState = 'running';
    status($('scan'), t.scanRunning, false);
    scanTimer = window.setTimeout(runScan, 400);
  }

  async function runScan() {
    const id = scanRun;
    const expected = data();
    let found = null;
    try {
      const bitmap = await createImageBitmap(await build(800).getRawData('png'));
      for (const size of SCAN_SIZES) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(bitmap, 0, 0, size, size);
        const r = window.jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'attemptBoth' });
        if (r && r.data === expected) {
          found = r.data;
          break;
        }
      }
    } catch (e) {
      found = null;
    }
    if (id !== scanRun) return;
    scanState = found ? 'ok' : 'fail';
    status($('scan'), found ? Core.fmt(t.scanOk, found) : t.scanFail, !found);
  }

  function download(ext) {
    if (scanState === 'fail' && !window.confirm(t.scanFailConfirm)) return;
    build(exportSize(), { jpeg: ext === 'jpeg', svg: ext === 'svg' }).download({ name: cfg.file || 'qr-code', extension: ext });
  }

  async function copyPng() {
    try {
      // Pass the promise itself: Safari drops the user gesture after an await.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': build(exportSize()).getRawData('png') })]);
      status($('status'), t.copied, false);
    } catch (e) {
      status($('status'), t.copyFail, true);
    }
  }

  /* Logo */
  function svgSize(href) {
    try {
      const comma = href.indexOf(',');
      const head = href.slice(0, comma);
      const body = head.includes(';base64') ? atob(href.slice(comma + 1)) : decodeURIComponent(href.slice(comma + 1));
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(body);
      return vb ? { width: Number(vb[1]), height: Number(vb[2]) } : null;
    } catch (e) {
      return null;
    }
  }

  /** Large raster logos are scaled to MAX_LOGO_PX once, so the preview stays fast. */
  function downscale(img, href) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h || Math.max(w, h) <= MAX_LOGO_PX) return href;
    const k = MAX_LOGO_PX / Math.max(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  function loadLogo(href) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const vector = href.startsWith('data:image/svg');
        const size = (vector && svgSize(href)) || { width: img.naturalWidth || 300, height: img.naturalHeight || 300 };
        // width = pixels that end up in the export (after downscaling), aspect = original proportions
        const scale = vector ? 1 : Math.min(1, MAX_LOGO_PX / Math.max(size.width, size.height));
        logo = { href: vector ? href : downscale(img, href), width: Math.round(size.width * scale), aspect: size.width / size.height, vector };
        schedule();
        resolve(true);
      };
      img.onerror = () => {
        status($('status'), t.logoLoadFail, true);
        resolve(false);
      };
      img.src = href;
    });
  }

  const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  async function loadLogoUrl(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      await loadLogo(await readAsDataUrl(await res.blob()));
    } catch (e) {
      status($('status'), t.logoLoadFail, true);
    }
  }

  function removeLogo() {
    logo = null;
    $('logo').value = '';
    $('ecc').value = DEFAULTS.ecc;
    schedule();
  }

  /* Drag the logo in the preview. The safe area is enforced by Core.placeBox on render. */
  function dragTo(event) {
    const drawn = $('preview').querySelector('canvas, svg');
    if (!drawn || !layout || layout.noRoom) return;
    const rect = drawn.getBoundingClientRect();
    const { dot, ox, oy } = Core.geometry(options(PREVIEW), n);
    const mx = (((event.clientX - rect.left) / rect.width) * PREVIEW - ox) / dot;
    const my = (((event.clientY - rect.top) / rect.height) * PREVIEW - oy) / dot;
    const cx = (n - layout.W) / 2;
    const cy = (n - layout.H) / 2;
    const toSlider = (pos, centre) => Math.max(-100, Math.min(100, Math.round(((pos - centre) / (centre || 1)) * 20) * 5));
    $('logox').value = String(toSlider(mx - layout.W / 2, cx));
    $('logoy').value = String(toSlider(my - layout.H / 2, cy));
    schedule();
  }

  const stage = $('preview');
  stage.addEventListener('pointerdown', (e) => {
    if (!logo) return;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
    dragTo(e);
  });
  stage.addEventListener('pointermove', (e) => {
    if (stage.hasPointerCapture(e.pointerId)) dragTo(e);
  });
  const endDrag = (e) => {
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  /* Presets and defaults */
  function presetSelect() {
    const select = $('preset');
    Object.entries(cfg.presets || {}).forEach(([id, p]) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = p.label;
      select.append(o);
    });
    select.addEventListener('change', () => {
      const p = (cfg.presets || {})[select.value];
      if (!p) return;
      write({
        ...p,
        fggrad: Boolean(p.fg2), fg2: p.fg2 || DEFAULTS.fg2,
        cornergrad: Boolean(p.corner2), corner2: p.corner2 || DEFAULTS.corner2,
        transparent: false,
      });
      if (p.logo) loadLogoUrl(p.logo);
      schedule();
    });
  }

  function storage(action, value) {
    try {
      if (action === 'get') return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (action === 'set') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      if (action === 'del') window.localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return null;
    }
  }

  $('save').addEventListener('click', () => {
    const values = snapshot();
    const withLogo = Boolean(logo) && logo.href.length <= MAX_STORED_LOGO;
    if (withLogo) values.logo = logo.href;
    if (!storage('set', values)) status($('status'), t.storageFail, true);
    else status($('status'), logo && !withLogo ? t.logoNotSaved : t.saved, false);
  });

  $('reset').addEventListener('click', () => {
    storage('del');
    write(DEFAULTS);
    $('preset').value = '';
    removeLogo();
  });

  /* Wire up */
  presetSelect();
  root.addEventListener('input', (e) => {
    const id = e.target.id || '';
    if (!id.startsWith('qrcd-') || ['qrcd-k', 'qrcd-preset', 'qrcd-logo'].includes(id)) return;
    if (!['qrcd-printcm', 'qrcd-dpi', 'qrcd-distance', 'qrcd-data'].includes(id)) $('preset').value = '';
    schedule();
  });
  $('logo').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await loadLogo(await readAsDataUrl(file));
  });
  $('logo-del').addEventListener('click', removeLogo);
  $('logo-centre').addEventListener('click', () => {
    $('logox').value = '0';
    $('logoy').value = '0';
    schedule();
  });
  root.querySelectorAll('[data-ext]').forEach((b) => b.addEventListener('click', () => download(b.dataset.ext)));
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    $('copy').hidden = false;
    $('copy').addEventListener('click', copyPng);
  }

  const saved = storage('get');
  if (saved && typeof saved === 'object') {
    write(saved);
    if (typeof saved.logo === 'string' && saved.logo.startsWith('data:image/')) loadLogo(saved.logo);
  }
  render();
})();
