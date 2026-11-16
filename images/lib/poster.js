/* HackNHeal poster kit — shared frame, tokens, seeded PRNG and text helpers.
 * Classic script (no modules) so posters also open straight from disk.
 * Exposes window.Poster. Requires d3 (v7) loaded before it.
 */
(function () {
  'use strict';

  const W = 3840, H = 2160;
  const C = {
    bg: '#05070d', cyan: '#00e5ff', magenta: '#ff2bd6', amber: '#ffb300',
    white: '#ffffff', panel: '#080d18', dim: '#0d1426',
  };
  const FONT = {
    mono: "'JetBrains Mono', ui-monospace, monospace",
    title: "'Space Grotesk', 'JetBrains Mono', sans-serif",
    greek: "'STIX Two Text', serif",
  };
  const MIN_TEXT = 28; // px at 4K, legibility floor

  // ---------- seeded PRNG (cyrb128 hash -> sfc32) ----------
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  }
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const s = cyrb128(String(seed));
    const next = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 16; i++) next(); // warm-up
    let spare = null;
    const r = {
      random: next,
      uniform: (a = 0, b = 1) => a + (b - a) * next(),
      int: (a, b) => Math.floor(a + (b - a + 1) * next()), // inclusive
      normal(m = 0, sd = 1) {
        if (spare !== null) { const v = spare; spare = null; return m + sd * v; }
        let u, v, s2;
        do { u = 2 * next() - 1; v = 2 * next() - 1; s2 = u * u + v * v; } while (s2 >= 1 || s2 === 0);
        const f = Math.sqrt(-2 * Math.log(s2) / s2);
        spare = v * f;
        return m + sd * u * f;
      },
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
      },
      // independent child stream, so adding draws in one part doesn't shift another
      fork: (label) => makeRng(String(seed) + '/' + label),
    };
    return r;
  }

  function readParams() {
    const p = new URLSearchParams(location.search);
    const seed = p.get('seed') || '42';
    const variant = p.get('variant') === 'bg' ? 'bg' : 'full';
    return { seed, variant };
  }

  const GREEK = /([α-ωᾱ])/; // ᾱ (U+1FB1) is drawn as α + overline (no font here has the glyph)
  // ---------- math-ish text: supports _{sub} and ^{sup} ----------
  // Writes tspans into a d3 <text> selection. fs = base font size (px).
  function mathText(sel, str, fs) {
    sel.text(null);
    const re = /([_^])\{([^}]*)\}/g;
    let last = 0, m, offset = 0;
    const segs = [];
    while ((m = re.exec(str))) {
      if (m.index > last) segs.push({ t: str.slice(last, m.index), k: 'n' });
      segs.push({ t: m[2], k: m[1] === '_' ? 'sub' : 'sup' });
      last = re.lastIndex;
    }
    if (last < str.length) segs.push({ t: str.slice(last), k: 'n' });
    for (const s of segs) {
      if (!s.t) continue;
      const target = s.k === 'sub' ? 0.32 * fs : s.k === 'sup' ? -0.42 * fs : 0;
      const dy = target - offset;
      const segFs = s.k === 'n' ? fs : Math.max(MIN_TEXT, Math.round(fs * 0.72));
      // lowercase Greek goes to STIX Two italic: JetBrains Mono draws α like "a" and η like "n"
      s.t.split(GREEK).filter((x) => x !== '').forEach((part, i) => {
        const bar = part === 'ᾱ';
        const ts = sel.append('tspan').text(bar ? 'α' : part);
        if (bar) ts.attr('data-bar', 1);
        if (i === 0 && Math.abs(dy) > 0.01) ts.attr('dy', dy.toFixed(2));
        if (GREEK.test(part) && part.length === 1) {
          ts.attr('font-family', FONT.greek).attr('font-style', 'italic').attr('font-size', Math.round(segFs * 1.18));
        } else if (s.k !== 'n') ts.attr('font-size', segFs);
      });
      offset = target;
    }
    // overlines for ᾱ: measured from the rendered glyph box
    const node = sel.node();
    if (node && node.isConnected) {
      sel.selectAll('tspan[data-bar]').each(function () {
        const b = this.getBBox();
        const fill = sel.attr('fill') || '#fff';
        d3.select(node.parentNode).insert('line', () => node.nextSibling)
          .attr('x1', b.x + b.width * 0.22).attr('x2', b.x + b.width * 0.98)
          .attr('y1', b.y + b.height * 0.2).attr('y2', b.y + b.height * 0.2)
          .attr('stroke', fill).attr('stroke-opacity', sel.attr('fill-opacity') || 1)
          .attr('stroke-width', Math.max(2, fs * 0.06)).attr('transform', sel.attr('transform'));
      });
    }
    return sel;
  }

  // ---------- poster scaffold ----------
  async function loadFonts() {
    const specs = [
      `400 40px 'JetBrains Mono'`, `500 40px 'JetBrains Mono'`, `700 40px 'JetBrains Mono'`,
      `400 40px 'Space Grotesk'`, `500 40px 'Space Grotesk'`, `700 40px 'Space Grotesk'`,
      `italic 400 40px 'STIX Two Text'`, `italic 700 40px 'STIX Two Text'`,
    ];
    try { await Promise.all(specs.map((s) => document.fonts.load(s, 'Aa0ℝ√∇θαη'))); } catch (e) { /* fallback fonts */ }
    await document.fonts.ready;
  }

  // ---------- viewer: fullscreen, navigation, idle cursor (screen use) ----------
  const POSTERS = ['01-mlp', '02-transformer', '03-embeddings', '04-unet', '05-self-attention', '06-loss-landscape', '07-diffusion'];
  function setupViewer() {
    const root = document.documentElement;
    const toggleFs = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen?.().catch(() => {});
    };
    const go = (step) => {
      const here = location.pathname.split('/').pop().replace('.html', '');
      const i = POSTERS.indexOf(here);
      if (i < 0) return;
      const next = POSTERS[(i + step + POSTERS.length) % POSTERS.length];
      location.href = `${next}.html${location.search}`;
    };
    const flipVariant = () => {
      const p = new URLSearchParams(location.search);
      p.set('variant', p.get('variant') === 'bg' ? 'full' : 'bg');
      location.search = p.toString();
    };
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F' || e.key === 'Enter') { e.preventDefault(); toggleFs(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'b' || e.key === 'B') flipVariant();
    });
    document.addEventListener('dblclick', toggleFs);

    // hint + cursor: only appear on mouse movement, so exports never contain them
    const hint = document.createElement('div');
    hint.textContent = 'F fullscreen · ← → poster · B full/bg';
    hint.setAttribute('aria-hidden', 'true');
    Object.assign(hint.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
      font: '500 14px "JetBrains Mono", monospace', letterSpacing: '.08em', color: '#fff',
      background: 'rgba(5,7,13,.85)', border: '1px solid rgba(0,229,255,.5)', borderRadius: '999px',
      padding: '8px 16px', opacity: '0', transition: 'opacity .3s', pointerEvents: 'none', zIndex: 10,
    });
    document.body.appendChild(hint);
    let idle;
    document.addEventListener('mousemove', () => {
      root.style.cursor = '';
      hint.style.opacity = document.fullscreenElement ? '0' : '1';
      clearTimeout(idle);
      idle = setTimeout(() => { hint.style.opacity = '0'; root.style.cursor = 'none'; }, 2000);
    });
  }

  async function create(opts) {
    await loadFonts();
    setupViewer();
    const { seed, variant } = readParams();
    const isBg = variant === 'bg';
    const rng = makeRng(seed + ':' + opts.id);

    document.title = `${opts.num} ${opts.title} — HackNHeal`;
    const svg = d3.select(document.body).append('svg')
      .attr('class', 'poster')
      .attr('xmlns', 'http://www.w3.org/2000/svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', W).attr('height', H)
      .attr('data-poster', opts.id).attr('data-seed', seed).attr('data-variant', variant);

    const defs = svg.append('defs');
    buildDefs(defs);

    // background + grid (grid is never dimmed further; it is already faint)
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', C.bg);
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#grid-minor)');
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#grid-major)');
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#vignette)');

    // content: in bg mode dimmed to 35% and masked so the centre stays clear
    const stage = svg.append('g').attr('class', 'stage');
    if (isBg) stage.attr('opacity', 0.35).attr('mask', 'url(#center-clear)');
    const g = stage.append('g').attr('class', 'content');

    const chrome = svg.append('g').attr('class', 'chrome');
    if (isBg) chrome.attr('opacity', 0.45);
    buildFrame(chrome, opts, seed, isBg);

    const P = {
      W, H, C, FONT, MIN_TEXT, svg, defs, g, chrome, rng, seed, variant, isBg, opts,
      text(parent, x, y, str, o = {}) {
        const fs = o.size || 32;
        const t = parent.append('text')
          .attr('x', x).attr('y', y)
          .attr('font-family', o.font === 'title' ? FONT.title : FONT.mono)
          .attr('font-size', fs)
          .attr('font-weight', o.weight || 400)
          .attr('fill', o.fill || C.white)
          .attr('text-anchor', o.anchor || 'start');
        if (o.opacity != null) t.attr('fill-opacity', o.opacity);
        if (o.baseline) t.attr('dominant-baseline', o.baseline);
        if (o.spacing) t.attr('letter-spacing', o.spacing);
        if (o.cls) t.attr('class', o.cls);
        if (o.filter) t.attr('filter', `url(#${o.filter})`);
        mathText(t, String(str), fs);
        return t;
      },
      done() {
        window.__POSTER_READY = true;
        document.documentElement.setAttribute('data-ready', '1');
      },
    };
    return P;
  }

  function buildDefs(defs) {
    const minor = defs.append('pattern').attr('id', 'grid-minor')
      .attr('width', 48).attr('height', 48).attr('patternUnits', 'userSpaceOnUse');
    minor.append('path').attr('d', 'M48 0H0V48').attr('fill', 'none')
      .attr('stroke', C.white).attr('stroke-opacity', 0.035).attr('stroke-width', 1.5);
    const major = defs.append('pattern').attr('id', 'grid-major')
      .attr('width', 240).attr('height', 240).attr('patternUnits', 'userSpaceOnUse');
    major.append('path').attr('d', 'M240 0H0V240').attr('fill', 'none')
      .attr('stroke', C.white).attr('stroke-opacity', 0.075).attr('stroke-width', 2);
    // tiny crosses on major intersections
    major.append('path').attr('d', 'M-10 0H10M0 -10V10').attr('stroke', C.cyan)
      .attr('stroke-opacity', 0.18).attr('stroke-width', 2);

    const vg = defs.append('radialGradient').attr('id', 'vignette')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '75%');
    vg.append('stop').attr('offset', '0%').attr('stop-color', C.bg).attr('stop-opacity', 0);
    vg.append('stop').attr('offset', '70%').attr('stop-color', C.bg).attr('stop-opacity', 0.25);
    vg.append('stop').attr('offset', '100%').attr('stop-color', '#000').attr('stop-opacity', 0.75);

    // glow filters in user space (safe for zero-height lines)
    for (const [id, sd] of [['glow-s', 5], ['glow-m', 12], ['glow-l', 28]]) {
      const f = defs.append('filter').attr('id', id).attr('filterUnits', 'userSpaceOnUse')
        .attr('x', 0).attr('y', 0).attr('width', W).attr('height', H)
        .attr('color-interpolation-filters', 'sRGB');
      f.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', sd).attr('result', 'b');
      const mg = f.append('feMerge');
      mg.append('feMergeNode').attr('in', 'b');
      mg.append('feMergeNode').attr('in', 'SourceGraphic');
    }
    // blur-only (for halos drawn underneath)
    const halo = defs.append('filter').attr('id', 'halo').attr('filterUnits', 'userSpaceOnUse')
      .attr('x', 0).attr('y', 0).attr('width', W).attr('height', H);
    halo.append('feGaussianBlur').attr('stdDeviation', 22);

    // bg variant: elliptical hole in the middle, feathered
    const cg = defs.append('radialGradient').attr('id', 'center-clear-g')
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('cx', W / 2).attr('cy', H / 2).attr('r', W * 0.34)
      .attr('gradientTransform', `translate(${W / 2} ${H / 2}) scale(1 ${(H / W) * 1.25}) translate(${-W / 2} ${-H / 2})`);
    cg.append('stop').attr('offset', '0%').attr('stop-color', '#000');
    cg.append('stop').attr('offset', '55%').attr('stop-color', '#000');
    cg.append('stop').attr('offset', '100%').attr('stop-color', '#fff');
    const mask = defs.append('mask').attr('id', 'center-clear').attr('maskUnits', 'userSpaceOnUse')
      .attr('x', 0).attr('y', 0).attr('width', W).attr('height', H);
    mask.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#center-clear-g)');

    // arrowheads
    for (const [id, col] of [['arr-cyan', C.cyan], ['arr-magenta', C.magenta], ['arr-amber', C.amber], ['arr-white', C.white]]) {
      defs.append('marker').attr('id', id).attr('viewBox', '0 0 10 10')
        .attr('refX', 8).attr('refY', 5).attr('markerWidth', 7).attr('markerHeight', 7)
        .attr('markerUnits', 'strokeWidth').attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0 0L10 5L0 10z').attr('fill', col);
    }
  }

  function buildFrame(chrome, opts, seed, isBg) {
    const m = 64, L = 130;
    const br = chrome.append('g').attr('fill', 'none').attr('stroke', C.cyan)
      .attr('stroke-width', 4).attr('stroke-opacity', 0.85);
    const corners = [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]];
    for (const [x, y, sx, sy] of corners) {
      br.append('path').attr('d', `M${x} ${y + sy * L}V${y}H${x + sx * L}`);
      br.append('path').attr('d', `M${x + sx * 22} ${y + sy * 44}V${y + sy * 22}H${x + sx * 44}`)
        .attr('stroke-width', 2).attr('stroke-opacity', 0.5);
    }
    // edge ticks (hairlines)
    const ticks = chrome.append('g').attr('stroke', C.white).attr('stroke-opacity', 0.22).attr('stroke-width', 2);
    for (let x = 480; x < W - 300; x += 240) {
      ticks.append('line').attr('x1', x).attr('x2', x).attr('y1', m).attr('y2', m + (x % 960 === 0 ? 26 : 14));
      ticks.append('line').attr('x1', x).attr('x2', x).attr('y1', H - m).attr('y2', H - m - (x % 960 === 0 ? 26 : 14));
    }
    for (let y = 480; y < H - 300; y += 240) {
      ticks.append('line').attr('y1', y).attr('y2', y).attr('x1', m).attr('x2', m + 14);
      ticks.append('line').attr('y1', y).attr('y2', y).attr('x1', W - m).attr('x2', W - m - 14);
    }

    const mono = (x, y, s, o = {}) => {
      const t = chrome.append('text').attr('x', x).attr('y', y)
        .attr('font-family', FONT.mono).attr('font-size', o.size || 30)
        .attr('font-weight', o.weight || 400)
        .attr('fill', o.fill || C.white).attr('fill-opacity', o.opacity ?? 0.6)
        .attr('text-anchor', o.anchor || 'start')
        .attr('letter-spacing', o.spacing || 2);
      mathText(t, s, o.size || 30);
      return t;
    };

    // footer
    mono(150, H - 104, 'HackNHeal // AI × Bio', { size: 32, opacity: 0.85, weight: 500, fill: C.white, spacing: 3 });
    mono(W - 150, H - 104, `FIG.${opts.num} · seed=${seed} · ${isBg ? 'bg' : 'full'}`, { anchor: 'end', opacity: 0.5 });
    chrome.append('circle').attr('cx', 128).attr('cy', H - 115).attr('r', 7).attr('fill', C.cyan);

    if (!isBg) {
      // title block, top-left
      mono(150, 196, `AI × BIO // FIG.${opts.num}`, { size: 34, fill: C.cyan, opacity: 0.95, weight: 500, spacing: 8 });
      const t = chrome.append('text').attr('x', 146).attr('y', 330)
        .attr('font-family', FONT.title).attr('font-size', opts.titleSize || 124).attr('font-weight', 700)
        .attr('fill', C.white).attr('letter-spacing', -1).text(opts.title);
      if (opts.subtitle) {
        const s = chrome.append('text').attr('x', 150).attr('y', 404)
          .attr('font-family', FONT.title).attr('font-size', 46).attr('font-weight', 400)
          .attr('fill', C.white).attr('fill-opacity', 0.62);
        mathText(s, opts.subtitle, 46);
      }
      chrome.append('line').attr('x1', 150).attr('x2', 470).attr('y1', 232).attr('y2', 232)
        .attr('stroke', C.cyan).attr('stroke-width', 3).attr('stroke-opacity', 0.6);
      // HUD readout top-right
      if (opts.hud !== false) {
        mono(W - 150, 170, opts.hudTop || 'SYS.NOMINAL', { anchor: 'end', opacity: 0.5 });
        mono(W - 150, 214, opts.hudSub || '3840×2160 · VECTOR', { anchor: 'end', opacity: 0.35 });
      }
    } else {
      mono(150, 176, `FIG.${opts.num} // ${opts.title.toUpperCase()}`, { size: 32, fill: C.cyan, opacity: 0.9, spacing: 6 });
    }
  }

  // ---------- small shared helpers ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // diverging magenta (−) → near-black (0) → cyan (+)
  const diverging = (v) => {
    const t = clamp(v, -1, 1);
    return t < 0 ? d3.interpolateRgb('#121628', C.magenta)(Math.pow(-t, 0.8))
      : d3.interpolateRgb('#121628', C.cyan)(Math.pow(t, 0.8));
  };
  // round a probability vector to `dp` decimals so it sums exactly to 1 (largest remainder)
  function roundToSum(p, dp = 2) {
    const k = Math.pow(10, dp);
    const raw = p.map((v) => v * k);
    const fl = raw.map(Math.floor);
    let rem = k - fl.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < rem; i++) fl[order[i % order.length][1]] += 1;
    return fl.map((v) => v / k);
  }
  const softmax = (z) => {
    const m = Math.max(...z);
    const e = z.map((v) => Math.exp(v - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  };

  window.Poster = { create, makeRng, mathText, lerp, clamp, diverging, roundToSum, softmax, W, H, C, FONT };
})();
