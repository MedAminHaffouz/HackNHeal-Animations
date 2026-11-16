/**
 * DNA HUD: basecaller stats, helix geometry panel, Sanger-style
 * chromatogram with a scrolling base ticker, variant callouts.
 */
import type { Hud } from '../../shared/hud';
import { baseColors, colors, rgba } from '../../shared/tokens';
import { clamp, fmtInt, pad } from '../../shared/math';
import type { Base, Sequencer, VariantEvent } from './sequencer';

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface DnaHudState {
  seq: Sequencer;
  /** 0..1 progress between the last called base and the next one (smooth scroll). */
  frac: number;
  scanning: boolean;
  scanOpacity: number;
  /** Projected read-head anchor, current genomic position. */
  head: ScreenPoint;
  headPos: number;
  rate: number;
  unzip: number;
  unzipLabel: number;
  unzipAnchor: ScreenPoint;
  grooves: { minor: ScreenPoint; major: ScreenPoint; alpha: number };
  /** Active variant callouts with their projected anchors. */
  callouts: Array<{ ev: VariantEvent; p: ScreenPoint; alpha: number }>;
  time: number;
}

const BASES: Base[] = ['A', 'C', 'G', 'T'];

export function drawDnaHud(h: Hud, st: DnaHudState): void {
  const s = h.s;
  const compact = h.w / s < 980;
  const inset = h.frame({
    code: 'VIZ-01 // GENOMICS · LIVE BASECALLING',
    title: 'DNA SEQUENCING',
    subtitle: 'B-FORM DOUBLE HELIX · 10.5 bp/TURN · READ HEAD ACTIVE',
    footerRight: 'SIMULATED DATA · NOT FOR CLINICAL USE',
  });

  drawCallouts(h, st);
  drawBasecaller(h, st, inset, compact);
  if (!compact) drawGeometry(h, st, inset);
  drawChromatogram(h, st, inset, compact);
}

function drawCallouts(h: Hud, st: DnaHudState): void {
  const s = h.s;
  // read head label
  if (st.scanOpacity > 0.05 && st.head.visible) {
    h.ctx.save();
    h.ctx.globalAlpha = st.scanOpacity;
    h.text('READ HEAD', st.head.x, st.head.y - 18 * s, { size: 9, color: colors.cyan, align: 'center', spacing: 2, weight: 600 });
    h.text(`chr17:${fmtInt(st.headPos)}`, st.head.x, st.head.y - 6 * s, { size: 9, color: colors.text, align: 'center' });
    h.ctx.restore();
  }
  // groove annotations
  const g = st.grooves;
  if (g.alpha > 0.01) {
    if (g.minor.visible) h.callout(g.minor.x, g.minor.y, ['MINOR GROOVE', '≈ 12 Å wide'], colors.cyan, -1, 46, 70, g.alpha * 0.9);
    if (g.major.visible) h.callout(g.major.x, g.major.y, ['MAJOR GROOVE', '≈ 22 Å wide'], colors.cyan, 1, -52, 70, g.alpha * 0.9);
  }
  // strand separation
  if (st.unzipLabel > 0.02 && st.unzipAnchor.visible) {
    h.callout(st.unzipAnchor.x, st.unzipAnchor.y, ['STRAND SEPARATION', `helicase · ${Math.round(st.unzip * 100)}% open`, 'transcription bubble'], colors.magenta, 1, -58, 80, st.unzipLabel);
  }
  // variants
  for (const c of st.callouts) {
    if (!c.p.visible) continue;
    const e = c.ev;
    const blink = 0.75 + 0.25 * Math.sin(st.time * 10);
    h.callout(c.p.x, c.p.y, [
      '▲ VARIANT DETECTED',
      `SNV chr17:${fmtInt(e.chrPos)} ${e.ref}>${e.alt}`,
      `BRCA1 · QUAL ${e.qual} · AF ${e.af.toFixed(2)}`,
    ], colors.amber, -1, -64, 90, c.alpha * blink);
  }
}

function drawBasecaller(h: Hud, st: DnaHudState, inset: number, compact: boolean): void {
  const s = h.s;
  const seq = st.seq;
  const w = (compact ? 196 : 232) * s;
  const x = h.w - inset - w;
  const y = inset + 58 * s;
  const meanQ = seq.totalCalled ? seq.qSum / seq.totalCalled : 0;
  const gc = seq.totalCalled ? (seq.gc / seq.totalCalled) * 100 : 0;
  const rows: Array<[string, string, string?]> = [
    ['READ', `#${pad(seq.readNo, 4)} · 2×150 PE`],
    ['LOCUS', 'chr17 · BRCA1'],
    ['POSITION', fmtInt(st.headPos)],
    ['CALLED', `${fmtInt(seq.totalCalled)} bp`],
    ['MEAN Q', `Q${meanQ.toFixed(1)}`, meanQ > 30 ? colors.mint : colors.amber],
    ['GC', `${gc.toFixed(1)} %`],
    ['RATE', `${st.rate.toFixed(1)} bp/s`],
    ['VARIANTS', String(seq.totalVariants), seq.totalVariants ? colors.amber : undefined],
  ];
  const ph = (32 + rows.length * 15 + 62 + Math.min(3, seq.events.length) * 14 + (seq.events.length ? 22 : 0)) * s;
  const o = h.panel(x, y, w, ph, 'BASECALLER');
  const cw = w - 20 * s;
  let yy = h.kv(o.x, o.y + 4 * s, cw, rows, 9.5, 15);

  // base composition
  yy += 6 * s;
  h.text('COMPOSITION', o.x, yy, { size: 8.5, color: colors.textFaint, spacing: 1.6 });
  yy += 8 * s;
  const tot = Math.max(1, seq.comp.A + seq.comp.C + seq.comp.G + seq.comp.T);
  BASES.forEach((b, i) => {
    const by = yy + i * 11 * s;
    const f = seq.comp[b] / tot;
    h.text(b, o.x, by + 7 * s, { size: 9, color: baseColors[b], weight: 700 });
    h.bar(o.x + 14 * s, by + 1 * s, cw - 58 * s, 6 * s, f * 2.2, baseColors[b]);
    h.text(`${(f * 100).toFixed(1)}%`, o.x + cw, by + 7 * s, { size: 8.5, color: colors.textDim, align: 'right' });
  });
  yy += 48 * s;

  // variant log
  if (seq.events.length) {
    h.text('VARIANT LOG', o.x, yy + 6 * s, { size: 8.5, color: colors.amber, spacing: 1.6 });
    seq.events.slice(-3).reverse().forEach((e, i) => {
      h.text(`${fmtInt(e.chrPos)} ${e.ref}>${e.alt}`, o.x, yy + (22 + i * 14) * s, { size: 9, color: colors.text });
      h.text(`Q${e.qual}`, o.x + cw, yy + (22 + i * 14) * s, { size: 9, color: colors.amber, align: 'right' });
    });
  }
}

function drawGeometry(h: Hud, st: DnaHudState, inset: number): void {
  const s = h.s;
  const w = 200 * s;
  const rows: Array<[string, string, string?]> = [
    ['FORM', 'B-DNA'],
    ['RISE', '3.38 Å/bp'],
    ['TWIST', '34.3°/bp'],
    ['bp / TURN', '10.5'],
    ['PITCH', '35.5 Å'],
    ['DIAMETER', '20 Å'],
    ['MAJOR GROOVE', '22 Å'],
    ['MINOR GROOVE', '12 Å'],
    ['STRAND SEP', `${Math.round(st.unzip * 100)} %`, st.unzip > 0.05 ? colors.magenta : colors.textDim],
  ];
  const ph = (32 + rows.length * 14 + 4) * s;
  const x = inset;
  const y = h.h - inset - ph - 34 * s;
  const o = h.panel(x, y, w, ph, 'HELIX GEOMETRY');
  h.kv(o.x, o.y + 4 * s, w - 20 * s, rows, 9, 14);
}

function drawChromatogram(h: Hud, st: DnaHudState, inset: number, compact: boolean): void {
  const s = h.s;
  const { ctx } = h;
  const W = Math.min(660 * s, h.w - (compact ? 2 * inset : 2 * inset + 2 * 240 * s));
  const H = 74 * s;
  const x0 = (h.w - W) / 2;
  const y0 = h.h - inset - H - 52 * s;
  const seq = st.seq;
  const called = seq.called;
  const cell = 14 * s;
  const K = Math.min(called.length, Math.floor(W / cell) + 2);
  const frac = st.scanning ? st.frac : 0;

  // header
  h.text('BASECALL · CHROMATOGRAM', x0, y0 - 10 * s, { size: 9, color: colors.cyan, spacing: 2, weight: 600 });
  h.text(`READ #${pad(seq.readNo, 4)}   5′ → 3′`, x0 + W, y0 - 10 * s, { size: 9, color: colors.textDim, align: 'right' });
  h.rect(x0, y0, W, H + 34 * s, rgba(colors.cyan, 0.18), 'rgba(4, 8, 18, 0.6)');
  h.brackets(x0, y0, W, H + 34 * s, 8, colors.cyan, 1.2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 + 1, y0 + 1, W - 2, H + 34 * s - 2);
  ctx.clip();

  // base positions: newest sits at the right edge, everything scrolls left smoothly
  const xs: number[] = [];
  const startIdx = called.length - K;
  for (let j = 0; j < K; j++) xs.push(x0 + W - 18 * s - (K - 1 - j + frac) * cell);

  // four traces
  const baseY = y0 + H - 4 * s;
  const sig = cell * 0.3;
  for (const b of BASES) {
    ctx.beginPath();
    for (let px = x0; px <= x0 + W; px += 2) {
      let v = 0;
      // only nearby peaks contribute
      const jc = Math.round((px - xs[0]) / cell);
      for (let j = Math.max(0, jc - 3); j <= Math.min(K - 1, jc + 3); j++) {
        const c = called[startIdx + j];
        const d = (px - xs[j]) / sig;
        const amp = c.base === b ? 0.45 + 0.5 * clamp((c.q - 18) / 22) : 0.05 * (((startIdx + j) * 7 + b.charCodeAt(0)) % 5) / 4;
        v += amp * Math.exp(-d * d);
      }
      const yv = baseY - v * (H - 10 * s);
      if (px === x0) ctx.moveTo(px, yv);
      else ctx.lineTo(px, yv);
    }
    ctx.strokeStyle = baseColors[b];
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.shadowColor = baseColors[b];
    ctx.shadowBlur = 5 * s;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // letters + quality ticks
  for (let j = 0; j < K; j++) {
    const c = called[startIdx + j];
    const x = xs[j];
    const age = K - 1 - j + frac;
    const a = clamp(1 - age / (K * 0.95)) * 0.8 + 0.2;
    const col = c.variant ? colors.amber : baseColors[c.base];
    if (c.variant) {
      h.rect(x - cell * 0.45, y0 + 4 * s, cell * 0.9, H + 26 * s, rgba(colors.amber, 0.8), rgba(colors.amber, 0.12));
    }
    h.text(c.base, x, y0 + H + 14 * s, {
      size: 11,
      color: col,
      align: 'center',
      weight: 700,
      alpha: a,
      glow: j === K - 1 ? 10 : 0,
    });
    const qh = clamp((c.q - 10) / 30) * 6 * s;
    h.rect(x - 2 * s, y0 + H + 26 * s - qh, 4 * s, qh, undefined, rgba(col, 0.5 * a));
  }
  ctx.restore();

  // cursor at the newest base
  const cx = x0 + W - 18 * s;
  h.line(cx, y0 + 2 * s, cx, y0 + H + 32 * s, rgba(colors.cyan, 0.5), 1, [3, 3]);
}
