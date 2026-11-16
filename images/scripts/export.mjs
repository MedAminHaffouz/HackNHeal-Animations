#!/usr/bin/env node
// Export every poster (full + bg) to PNG (3840x2160 and 1920x1080) and raw SVG.
// Usage: npm run export [-- --seed 42 --only 01,03 --variants full,bg]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PNG = path.join(ROOT, 'out', 'png');
const OUT_SVG = path.join(ROOT, 'out', 'svg');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : process.env[name.toUpperCase()] || def;
};
const SEED = arg('seed', '42');
const ONLY = arg('only', '').split(',').filter(Boolean);
const VARIANTS = arg('variants', 'full,bg').split(',');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// In-page layout audit: font floor, clipping, text/text overlap.
function audit(minText) {
  const svg = document.querySelector('svg.poster');
  const sr = svg.getBoundingClientRect();
  const k = 3840 / sr.width;
  const issues = [];
  const boxes = [];
  const texts = [...svg.querySelectorAll('text')].filter((t) => !t.closest('.no-check') && !t.closest('defs'));
  for (const t of texts) {
    const label = (t.textContent || '').trim().slice(0, 40);
    if (!label) continue;
    const els = [t, ...t.querySelectorAll('tspan')];
    for (const e of els) {
      const fs = parseFloat(getComputedStyle(e).fontSize);
      const m = e.getScreenCTM();
      const scale = m ? Math.hypot(m.a, m.b) * k : 1;
      if (fs * scale < minText - 0.5) issues.push({ type: 'small-text', label, px: +(fs * scale).toFixed(1) });
    }
    const r = t.getBoundingClientRect();
    const b = { x0: (r.left - sr.left) * k, y0: (r.top - sr.top) * k, x1: (r.right - sr.left) * k, y1: (r.bottom - sr.top) * k, label };
    if (b.x0 < 70 || b.y0 < 70 || b.x1 > 3770 || b.y1 > 2090) issues.push({ type: 'clipped', label, box: [b.x0, b.y0, b.x1, b.y1].map(Math.round) });
    if (!t.closest('.allow-overlap')) boxes.push(b);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      const w = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0);
      const h = Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0);
      // font boxes include ascender/descender padding; ignore tiny touches
      if (w > 4 && h > 10) issues.push({ type: 'overlap', a: a.label, b: c.label, w: Math.round(w), h: Math.round(h) });
    }
  }
  return { texts: texts.length, issues };
}

async function main() {
  fs.mkdirSync(OUT_PNG, { recursive: true });
  fs.mkdirSync(OUT_SVG, { recursive: true });
  const posters = fs.readdirSync(path.join(ROOT, 'posters'))
    .filter((f) => /^\d\d-.*\.html$/.test(f))
    .filter((f) => !ONLY.length || ONLY.some((o) => f.startsWith(o)))
    .sort();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx4k = await browser.newContext({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
  const ctxHd = await browser.newContext({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 0.5 });
  const fontCss = fs.readFileSync(path.join(ROOT, 'assets', 'tokens.css'), 'utf8')
    .split('\n').filter((l) => l.startsWith('@font-face')).join('\n')
    .replaceAll('url(fonts/', 'url(../../assets/fonts/');

  const report = {};
  let problems = 0;
  for (const file of posters) {
    const id = file.replace(/\.html$/, '');
    for (const variant of VARIANTS) {
      const url = `${base}/posters/${file}?seed=${encodeURIComponent(SEED)}&variant=${variant}`;
      const name = `${id}--${variant}--seed${SEED}`;
      const t0 = Date.now();
      for (const [ctx, suffix] of [[ctx4k, '3840x2160'], [ctxHd, '1920x1080']]) {
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto(url);
        await page.waitForFunction(() => window.__POSTER_READY === true, null, { timeout: 60000 });
        await page.screenshot({ path: path.join(OUT_PNG, `${name}--${suffix}.png`), clip: { x: 0, y: 0, width: 3840, height: 2160 } });
        if (suffix === '3840x2160') {
          const svgText = await page.evaluate(() => new XMLSerializer().serializeToString(document.querySelector('svg.poster')));
          const withFonts = svgText.replace(/<defs>/, `<defs><style>${fontCss}</style>`);
          fs.writeFileSync(path.join(OUT_SVG, `${name}.svg`), '<?xml version="1.0" encoding="UTF-8"?>\n' + withFonts);
          const a = await page.evaluate(audit, 28);
          a.errors = errors;
          report[name] = a;
          const n = a.issues.length + errors.length;
          problems += n;
          console.log(`${n ? '!!' : 'ok'} ${name}  texts=${a.texts} issues=${a.issues.length} errors=${errors.length}  ${Date.now() - t0}ms`);
          for (const i of a.issues.slice(0, 25)) console.log('     ', JSON.stringify(i));
          for (const e of errors) console.log('      ERROR', e);
        }
        await page.close();
      }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'out', 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
  console.log(problems ? `\n${problems} layout issue(s) — see out/report.json` : '\nall clean');
}

main().catch((e) => { console.error(e); process.exit(1); });
