/*!
 * QR Code Designer for YOURLS: core logic without UI.
 * https://github.com/Waterproof-Web-Wizard-GmbH/yourls-qr-code-designer
 * MIT License, Waterproof Web Wizard GmbH
 *
 * Works in the browser (window.QrcdCore) and in Node (require / import) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QrcdCore = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  /* Alignment pattern centres per QR version (ISO/IEC 18004, Annex E). Index = version - 1. */
  const ALIGNMENT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
    [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];

  /* Share of all modules a logo box may cover. Error correction H restores 30 %, we use half of it. */
  const MAX_COVER = 0.15;
  /* Smallest module that prints and scans reliably, in millimetres. */
  const MIN_MODULE_MM = 0.4;

  /**
   * Modules a logo must never cover: finder patterns with separators and format information,
   * timing patterns, version information and alignment patterns (except one in the very centre,
   * which the standard centred logo has always covered).
   * @returns {Uint8Array} n*n, 1 = protected
   */
  function protectedMask(n) {
    const mask = new Uint8Array(n * n);
    const mark = (r0, r1, c0, c1) => {
      for (let r = Math.max(0, r0); r <= Math.min(n - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(n - 1, c1); c++) mask[r * n + c] = 1;
      }
    };
    mark(0, 8, 0, 8);
    mark(0, 8, n - 8, n - 1);
    mark(n - 8, n - 1, 0, 8);
    mark(6, 6, 0, n - 1);
    mark(0, n - 1, 6, 6);
    const version = (n - 17) / 4;
    if (version >= 7) {
      mark(0, 5, n - 11, n - 9);
      mark(n - 11, n - 9, 0, 5);
    }
    const centres = ALIGNMENT[version - 1] || [];
    const mid = Math.floor(n / 2);
    centres.forEach((r) => centres.forEach((c) => {
      const onFinder = (r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6);
      const coversCentre = Math.abs(r - mid) <= 2 && Math.abs(c - mid) <= 2;
      if (!onFinder && !coversCentre) mark(r - 2, r + 2, c - 2, c + 2);
    }));
    return mask;
  }

  /**
   * Where a logo box may go: protected modules, one module of air around them, and the outer ring.
   * The extra module costs little and keeps scanners that are strict about pattern edges happy.
   * @returns {Uint8Array} n*n, 1 = keep out
   */
  function keepOutMask(n) {
    const base = protectedMask(n);
    const out = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (r === 0 || c === 0 || r === n - 1 || c === n - 1) { out[r * n + c] = 1; continue; }
        for (let dr = -1; dr <= 1 && !out[r * n + c]; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (base[(r + dr) * n + (c + dc)]) { out[r * n + c] = 1; break; }
          }
        }
      }
    }
    return out;
  }

  /**
   * Logo box size in modules.
   * @param {number} n module count
   * @param {number} size longer logo side as share of the code width (0.1 to 0.4)
   * @param {number} aspect logo width / height
   * @param {number} margin free modules around the logo
   */
  function logoBox(n, size, aspect, margin = 1) {
    const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
    let long = Math.max(2, Math.round(size * n));
    let limited = false;
    for (;;) {
      const w = ratio >= 1 ? long : Math.max(1, Math.round(long * ratio));
      const h = ratio >= 1 ? Math.max(1, Math.round(long / ratio)) : long;
      const box = { w, h, W: w + 2 * margin, H: h + 2 * margin, margin, limited };
      if (box.W * box.H <= MAX_COVER * n * n || long <= 2) return box;
      long -= 1;
      limited = true;
    }
  }

  /**
   * Place a box as close as possible to the requested offset without touching protected modules.
   * dx and dy are -1..1 (share of the free travel left and right of the centre).
   * @returns {{x:number,y:number,clamped:boolean}|null}
   */
  function placeBox(n, W, H, dx, dy, mask = keepOutMask(n)) {
    if (W > n || H > n) return null;
    const cx = Math.floor((n - W) / 2);
    const cy = Math.floor((n - H) / 2);
    const tx = Math.round(cx + clamp(dx, -1, 1) * cx);
    const ty = Math.round(cy + clamp(dy, -1, 1) * cy);
    let best = null;
    for (let y = 0; y + H <= n; y++) {
      for (let x = 0; x + W <= n; x++) {
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (best && d > best.d) continue;
        if (!fits(mask, n, x, y, W, H)) continue;
        const tie = (x - cx) ** 2 + (y - cy) ** 2;
        if (!best || d < best.d || tie < best.tie) best = { x, y, d, tie };
      }
    }
    return best ? { x: best.x, y: best.y, clamped: best.x !== tx || best.y !== ty } : null;
  }

  function fits(mask, n, x, y, W, H) {
    for (let r = y; r < y + H; r++) {
      for (let c = x; c < x + W; c++) if (mask[r * n + c]) return false;
    }
    return true;
  }

  function clamp(v, lo, hi) {
    const num = Number(v);
    return Number.isFinite(num) ? Math.min(hi, Math.max(lo, num)) : 0;
  }

  /** Geometry used by qr-code-styling 1.9 (dotsOptions.roundSize = true). */
  function geometry(options, n) {
    const size = Math.min(options.width, options.height);
    const dot = Math.floor((size - 2 * options.margin) / n);
    return { dot, ox: Math.floor((options.width - n * dot) / 2), oy: Math.floor((options.height - n * dot) / 2) };
  }

  /** Top left corner of a drawn module element, in pixels. */
  function elementOrigin(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') return [Number(el.getAttribute('x')), Number(el.getAttribute('y'))];
    if (tag === 'circle') {
      const r = Number(el.getAttribute('r'));
      return [Number(el.getAttribute('cx')) - r, Number(el.getAttribute('cy')) - r];
    }
    const m = /^\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/i.exec(el.getAttribute('d') || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  /**
   * qr-code-styling extension: dot gap, logo at any safe position, hidden dots behind the logo.
   * Runs on the SVG before PNG and JPG are rasterised, so every format gets the same result.
   *
   * @param {() => number} moduleCount returns the module count of the instance being drawn
   * @param {object} s { gap: 0..0.45, logo: {href} | null, box: {x,y,w,h,margin} | null, hideDots: bool }
   */
  function extension(moduleCount, s) {
    return (svg, options) => {
      const n = moduleCount();
      if (!n) return;
      const { dot, ox, oy } = geometry(options, n);
      const doc = svg.ownerDocument;
      const clip = svg.querySelector('clipPath[id^="clip-path-dot-color-"]');
      const box = s.logo ? s.box : null;
      const k = 1 - clamp(s.gap, 0, 0.45);

      if (clip && dot > 0) {
        Array.from(clip.children).forEach((el) => {
          const origin = elementOrigin(el);
          if (!origin) return;
          const col = Math.round((origin[0] - ox) / dot);
          const row = Math.round((origin[1] - oy) / dot);
          if (box && s.hideDots && col >= box.x && col < box.x + box.W && row >= box.y && row < box.y + box.H) {
            el.remove();
            return;
          }
          if (k < 1) {
            const cx = ox + (col + 0.5) * dot;
            const cy = oy + (row + 0.5) * dot;
            const prev = el.getAttribute('transform');
            el.setAttribute('transform', `translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})${prev ? ` ${prev}` : ''}`);
          }
        });
      }

      if (box && s.logo.href) {
        const img = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('x', String(ox + (box.x + box.margin) * dot));
        img.setAttribute('y', String(oy + (box.y + box.margin) * dot));
        img.setAttribute('width', String(box.w * dot));
        img.setAttribute('height', String(box.h * dot));
        img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        img.setAttribute('href', s.logo.href);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', s.logo.href);
        svg.appendChild(img);
      }
    };
  }

  /**
   * Print check. Uses the same geometry as qr-code-styling: the module size in pixels is rounded
   * down and the remainder goes into the quiet zone, so the real module is a little smaller than
   * width / (n + 2 * quiet).
   * @param {object} p { cm, dpi, distanceCm, n, quiet, box, logoWidthPx, logoIsVector, maxPx }
   */
  function printCheck(p) {
    const out = { px: 0, exportPx: 0, moduleMm: 0, minCm: 0, logoPxNeeded: 0, warnings: [] };
    const cm = Number(p.cm);
    if (!(cm > 0) || !(p.n > 0)) return out;
    const dpi = Number(p.dpi) || 300;
    const quiet = Number(p.quiet) || 0;
    const maxPx = Number(p.maxPx) || 6000;
    out.px = Math.ceil((cm / 2.54) * dpi);
    out.exportPx = Math.min(maxPx, Math.max(200, out.px));
    if (out.px > maxPx) out.warnings.push({ code: 'maxSize', px: out.px, max: maxPx });

    const margin = quiet ? Math.round((out.exportPx * quiet) / (p.n + 2 * quiet)) : 0;
    const { dot } = geometry({ width: out.exportPx, height: out.exportPx, margin }, p.n);
    const mmPerPx = (cm * 10) / out.exportPx;
    out.moduleMm = Math.floor(dot * mmPerPx * 100) / 100;
    if (out.moduleMm < MIN_MODULE_MM) {
      out.warnings.push({ code: 'module', mm: out.moduleMm, minCm: Math.ceil((p.n + 2 * quiet) * MIN_MODULE_MM * 1.1) / 10 });
    }
    const distance = Number(p.distanceCm);
    if (distance > 0) {
      out.minCm = Math.ceil(distance) / 10;
      if (cm < out.minCm) out.warnings.push({ code: 'distance', minCm: out.minCm });
    }
    if (p.box && !p.logoIsVector && p.logoWidthPx > 0) {
      const logoCm = (p.box.w * dot * mmPerPx) / 10;
      out.logoPxNeeded = Math.ceil((logoCm / 2.54) * dpi);
      if (p.logoWidthPx < out.logoPxNeeded) {
        out.warnings.push({ code: 'logo', have: p.logoWidthPx, need: out.logoPxNeeded });
      }
    }
    return out;
  }

  /* WCAG relative luminance and contrast ratio. */
  function luminance(hex) {
    const v = parseInt(String(hex).slice(1), 16) || 0;
    const [r, g, b] = [v >> 16, (v >> 8) & 255, v & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Replace %1$s, %2$s ... (and plain %s) like PHP sprintf. */
  function fmt(text, ...args) {
    let i = 0;
    return String(text || '').replace(/%(?:(\d+)\$)?s/g, (_, pos) => String(args[pos ? pos - 1 : i++] ?? ''));
  }

  return { ALIGNMENT, MAX_COVER, MIN_MODULE_MM, protectedMask, keepOutMask, logoBox, placeBox, extension, printCheck, luminance, contrast, fmt, geometry };
}));
