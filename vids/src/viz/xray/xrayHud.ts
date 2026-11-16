/**
 * X-ray HUD: query panel chrome, scan readout, Grad-CAM callout,
 * embedding-space scatter (the particles fly through it), match cards.
 */
import type { Hud } from '../../shared/hud';
import { colors, rgba } from '../../shared/tokens';
import { clamp, rng, smoothstep } from '../../shared/math';
import type { CaseDef } from './cases';

interface Rect { x: number; y: number; w: number; h: number }

export interface XrayHudState {
  ready: boolean;
  def: CaseDef | null;
  main: Rect;
  sims: Rect[];
  via: { x: number; y: number; r: number };
  portrait: boolean;
  phase: string;
  ct: number;
  scan: number;
  heat: number;
  simReveal: number[];
  scores: number[];
  flow: number;
  caseNo: number;
  caseCount: number;
  source: string;
  time: number;
}

// ── embedding scatter: fixed clusters per class (t-SNE-like layout)
const CLASSES: Array<{ key: string; color: string; c: [number, number] }> = [
  { key: 'pneumonia', color: colors.amber, c: [-0.45, -0.35] },
  { key: 'effusion', color: colors.magenta, c: [0.42, -0.4] },
  { key: 'cardiomegaly', color: colors.violet, c: [0.5, 0.35] },
  { key: 'nodule', color: colors.mint, c: [-0.1, 0.55] },
  { key: 'pneumothorax', color: colors.red, c: [-0.6, 0.25] },
  { key: 'normal', color: colors.cyan, c: [0.05, -0.02] },
];
const POINTS = (() => {
  const r = rng(4242);
  const pts: Array<{ x: number; y: number; color: string }> = [];
  for (const cl of CLASSES) {
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 0.2;
      pts.push({ x: cl.c[0] + Math.cos(a) * d, y: cl.c[1] + Math.sin(a) * d * 0.8, color: cl.color });
    }
  }
  return pts;
})();
const classOf = (label: string) => CLASSES.find((c) => label.toLowerCase().includes(c.key)) ?? CLASSES[5];

export function drawXrayHud(h: Hud, st: XrayHudState): void {
  h.frame({
    code: 'VIZ-04 // RADIOLOGY AI · CONTENT-BASED RETRIEVAL',
    title: 'CHEST X-RAY · SIMILAR CASES',
    subtitle: `PA RADIOGRAPH · GRAD-CAM ATTENTION · TOP-3 NEIGHBOURS · ${st.source}`,
    footerRight: 'SYNTHETIC / DEMO IMAGES · NOT FOR DIAGNOSIS',
  });
  if (!st.ready || !st.def) {
    h.text('LOADING STUDIES…', h.w / 2, h.h / 2, { size: 12, align: 'center', color: colors.cyan, spacing: 3 });
    return;
  }
  drawMain(h, st);
  if (!st.portrait && st.via.r > 40 * h.s) drawEmbedding(h, st);
  st.sims.forEach((r, i) => drawMatch(h, st, r, i));
}

function drawMain(h: Hud, st: XrayHudState): void {
  const s = h.s;
  const M = st.main;
  const d = st.def!;
  h.brackets(M.x - 6 * s, M.y - 6 * s, M.w + 12 * s, M.h + 12 * s, 18, colors.cyan, 1.6);
  h.rect(M.x, M.y, M.w, M.h, rgba(colors.cyan, 0.3));
  // header strip
  h.text(`QUERY · ${d.id}`, M.x + 10 * s, M.y + 18 * s, { size: 9.5, color: colors.cyan, weight: 600, spacing: 1.8 });
  h.text(`STUDY ${st.caseNo}/${st.caseCount}`, M.x + M.w - 10 * s, M.y + 18 * s, { size: 9, color: colors.textDim, align: 'right' });
  // phase indicator
  const busy = st.phase !== 'TOP-3 MATCHES';
  h.dot(M.x + 14 * s, M.y + M.h - 16 * s, 3, busy ? colors.cyan : colors.mint, busy ? 2.5 : 0);
  h.text(st.phase, M.x + 24 * s, M.y + M.h - 12 * s, { size: 9.5, color: busy ? colors.cyan : colors.mint, weight: 600, spacing: 2 });
  h.text('PA · 120 kVp · 2.5 mAs', M.x + M.w - 10 * s, M.y + M.h - 12 * s, { size: 8.5, color: colors.textDim, align: 'right' });

  // scan readout tracks the line
  if (st.scan >= 0 && st.scan <= 1) {
    const y = M.y + st.scan * M.h;
    const patch = Math.min(196, Math.floor(st.scan * 196) + 1);
    h.text(`ENCODING ▸ PATCH ${String(patch).padStart(3, '0')}/196`, M.x + M.w + 10 * s, y + 3 * s, { size: 8.5, color: colors.cyan, spacing: 1.2 });
    h.line(M.x + M.w, y, M.x + M.w + 6 * s, y, colors.cyan, 1);
  }

  // Grad-CAM finding
  if (st.heat > 0.05) {
    const b = d.heat[0];
    const ax = M.x + b[0] * M.w;
    const ay = M.y + b[1] * M.h;
    const dir = b[0] < 0.5 ? 1 : -1;
    const reach = Math.min(M.w * 0.35, 150 * s) / s;
    h.callout(ax + dir * b[2] * M.w * 0.6, ay - b[2] * M.h * 0.6, [
      d.finding,
      `${d.region ? d.region + ' · ' : ''}p = ${(d.prob * clamp(st.heat * 1.2)).toFixed(2)}`,
      'Grad-CAM · DenseNet-121',
    ], colors.amber, dir, -40, reach, clamp(st.heat * 1.4));
    // suggestion line under the header (inside the image frame)
    const sy = M.y + 38 * s;
    h.rect(M.x + 6 * s, sy - 13 * s, h.measure(d.label, 11, 600) + 124 * s, 19 * s, undefined, `rgba(4,8,16,${0.7 * st.heat})`);
    h.text('AI SUGGESTION', M.x + 12 * s, sy, { size: 8.5, color: colors.textDim, spacing: 1.6, alpha: st.heat });
    h.text(d.label, M.x + 112 * s, sy, { size: 11, color: colors.amber, weight: 600, alpha: st.heat, glow: 8 });
  }
}

function drawEmbedding(h: Hud, st: XrayHudState): void {
  const s = h.s;
  const { x: cx, y: cy, r: R } = st.via;
  const a = clamp(0.35 + st.flow + st.heat * 0.3);
  const { ctx } = h;
  ctx.save();
  ctx.globalAlpha = a;
  h.brackets(cx - R, cy - R, 2 * R, 2 * R, 8, rgba(colors.cyan, 0.7), 1.2);
  h.text('EMBEDDING SPACE', cx - R, cy - R - 18 * s, { size: 8.5, color: colors.cyan, spacing: 1.8, weight: 600 });
  h.text('768-d → t-SNE', cx - R, cy - R - 6 * s, { size: 8, color: colors.textDim });
  // axes
  h.line(cx - R + 6 * s, cy + R - 6 * s, cx + R - 6 * s, cy + R - 6 * s, rgba(colors.cyan, 0.25));
  h.line(cx - R + 6 * s, cy + R - 6 * s, cx - R + 6 * s, cy - R + 6 * s, rgba(colors.cyan, 0.25));
  const P = (p: [number, number] | { x: number; y: number }) => {
    const [px, py] = Array.isArray(p) ? p : [p.x, p.y];
    return [cx + px * R * 0.88, cy + py * R * 0.88] as const;
  };
  for (const p of POINTS) {
    const [x, y] = P(p);
    ctx.fillStyle = rgba(p.color, 0.55);
    ctx.fillRect(x - 1.2 * s, y - 1.2 * s, 2.4 * s, 2.4 * s);
  }
  // query + its three neighbours
  const d = st.def!;
  const qc = classOf(d.label);
  const q: [number, number] = [qc.c[0] + 0.05, qc.c[1] - 0.04];
  const [qx, qy] = P(q);
  d.similar.forEach((sim, i) => {
    const rv = st.simReveal[i];
    if (rv <= 0.01) return;
    const sc = classOf(sim.label);
    const n: [number, number] = [q[0] + (sc.c[0] - q[0]) * 0.18 + (i - 1) * 0.06, q[1] + (sc.c[1] - q[1]) * 0.18 + 0.05 * (i % 2 ? 1 : -1)];
    const [nx, ny] = P(n);
    h.line(qx, qy, qx + (nx - qx) * rv, qy + (ny - qy) * rv, rgba(colors.amber, 0.8), 1);
    ctx.beginPath();
    ctx.arc(nx, ny, 3.2 * s * rv, 0, Math.PI * 2);
    ctx.strokeStyle = colors.amber;
    ctx.stroke();
  });
  const pulse = 1 + 0.3 * Math.sin(st.time * 6);
  ctx.beginPath();
  ctx.arc(qx, qy, 4 * s * pulse, 0, Math.PI * 2);
  ctx.fillStyle = colors.text;
  ctx.shadowColor = colors.cyan;
  ctx.shadowBlur = 10 * s;
  ctx.fill();
  ctx.shadowBlur = 0;
  h.text('QUERY', qx + 7 * s, qy - 6 * s, { size: 8, color: colors.text, weight: 600 });
  ctx.restore();
  // legend
  CLASSES.forEach((c, i) => {
    const lx = cx - R + (i % 2) * R;
    const ly = cy + R + (14 + Math.floor(i / 2) * 11) * s;
    ctx.fillStyle = c.color;
    ctx.fillRect(lx, ly - 5 * s, 5 * s, 5 * s);
    h.text(c.key.toUpperCase(), lx + 8 * s, ly, { size: 7, color: colors.textDim, alpha: a });
  });
}

function drawMatch(h: Hud, st: XrayHudState, r: Rect, i: number): void {
  const s = h.s;
  const sim = st.def!.similar[i];
  if (!sim) return;
  const rv = st.simReveal[i];
  const col = rv > 0.5 ? colors.cyan : rgba(colors.cyan, 0.3);
  h.rect(r.x, r.y, r.w, r.h, rgba(colors.cyan, 0.25), rv < 0.02 ? 'rgba(0,10,20,0.6)' : undefined);
  h.brackets(r.x - 4 * s, r.y - 4 * s, r.w + 8 * s, r.h + 8 * s, 8, col, 1.3);
  if (rv < 0.02) {
    const dots = '.'.repeat(1 + (Math.floor(st.time * 3) % 3));
    h.text(st.flow > 0.1 ? `SEARCHING${dots}` : 'STANDBY', r.x + r.w / 2, r.y + r.h / 2, { size: 9, color: colors.textFaint, align: 'center', spacing: 2 });
  }
  h.text(`#${i + 1}`, r.x + 6 * s, r.y + 15 * s, { size: 10, color: colors.cyan, weight: 700, alpha: Math.max(0.3, rv) });

  const score = st.scores[i];
  const scoreCol = score > 0.9 ? colors.amber : colors.text;
  const scoreStr = score > 0.005 ? score.toFixed(2) : '—';
  if (!st.portrait) {
    const x = r.x + r.w + 16 * s;
    const a = smoothstep(0, 0.5, rv);
    h.text(`MATCH #${i + 1} · ${sim.id}`, x, r.y + 14 * s, { size: 8.5, color: colors.textDim, spacing: 1.2, alpha: Math.max(0.35, a) });
    h.text(sim.label, x, r.y + 34 * s, { size: 12, font: 'display', weight: 600, color: colors.text, alpha: Math.max(0.2, a) });
    h.text('SIMILARITY', x, r.y + 58 * s, { size: 8, color: colors.textFaint, spacing: 1.6 });
    h.text(scoreStr, x, r.y + 88 * s, { size: 30, font: 'display', weight: 600, color: scoreCol, glow: score > 0.9 ? 12 : 0, spacing: 0 });
    h.text('cosine', x + h.measure(scoreStr, 30, 600, 'display', 0) + 6 * s, r.y + 88 * s, { size: 8.5, color: colors.textDim });
    h.bar(x, r.y + 98 * s, 150 * s, 5 * s, score, scoreCol, 25);
  } else {
    const y = r.y + r.h + 16 * s;
    h.text(sim.label, r.x + r.w / 2, y, { size: 9.5, color: colors.text, align: 'center', weight: 600, alpha: Math.max(0.3, rv) });
    h.text(scoreStr, r.x + r.w / 2, y + 18 * s, { size: 14, color: scoreCol, align: 'center', weight: 700, glow: score > 0.9 ? 8 : 0 });
  }
}
