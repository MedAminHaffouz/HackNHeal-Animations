/**
 * Protein–ligand HUD: docking engine readouts (ΔG, RMSD, pose counter, Ki),
 * score sparkline, binding-site contact list and on-structure H-bond labels.
 */
import type { Hud } from '../../shared/hud';
import { colors, rgba } from '../../shared/tokens';
import { clamp, fmtInt, pad } from '../../shared/math';

export interface ProteinHudState {
  ready: boolean;
  error: string;
  stage: 'APPROACH' | 'POSE SEARCH' | 'REFINING' | 'BOUND' | 'RESET';
  pose: number;
  poses: number;
  sampled: number;
  run: number;
  dG: number;
  rmsd: number;
  hbonds: number;
  history: number[];
  bound: number;
  labels: Array<{ text: string; dist: number; x: number; y: number; alpha: number }>;
  ligandScreen?: { x: number; y: number };
  ligandName: string;
  target: string;
  pdbId: string;
  formula: string;
  mw: number;
  time: number;
}

const STAGE_COLOR: Record<ProteinHudState['stage'], string> = {
  APPROACH: colors.cyan,
  'POSE SEARCH': colors.cyan,
  REFINING: colors.magenta,
  BOUND: colors.amber,
  RESET: colors.textDim,
};

export function drawProteinHud(h: Hud, st: ProteinHudState): void {
  const s = h.s;
  const compact = h.w / s < 980;
  const inset = h.frame({
    code: 'VIZ-02 // DRUG DISCOVERY · MOLECULAR DOCKING',
    title: 'PROTEIN–LIGAND BINDING',
    subtitle: `${st.target} · PDB ${st.pdbId} · ${st.ligandName}`,
    footerRight: 'CRYSTAL POSE FROM PDB · SCORES ILLUSTRATIVE',
  });
  if (!st.ready) {
    h.text(st.error || 'LOADING STRUCTURE…', h.w / 2, h.h / 2, { size: 12, align: 'center', color: st.error ? colors.red : colors.cyan, spacing: 2 });
    return;
  }

  drawLabels(h, st);
  drawEngine(h, st, inset, compact);
  if (!compact) drawSite(h, st, inset);
  drawStageBanner(h, st, inset);
}

function drawLabels(h: Hud, st: ProteinHudState): void {
  // one callout per protein residue (waters are listed in the side panel only)
  const seen = new Set<string>();
  const cx = h.w / 2;
  const cy = st.ligandScreen?.y ?? h.h / 2;
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const hits = (b: { x: number; y: number; w: number; h: number }) =>
    placed.some((p) => b.x < p.x + p.w + 6 && b.x + b.w + 6 > p.x && b.y < p.y + p.h + 4 && b.y + b.h + 4 > p.y);
  let n = 0;
  for (const l of st.labels) {
    if (l.alpha < 0.02 || l.text.startsWith('HOH') || n >= 5) continue;
    const res = l.text.split(' ')[0];
    if (seen.has(res)) continue;
    seen.add(res);
    n++;
    const lines = [res, `${l.dist.toFixed(1)} Å · H-bond`];
    const dir = l.x < cx ? -1 : 1;
    const away = l.y < cy ? -1 : 1;
    // push the label further out (vertically) until it no longer overlaps another one
    let rise = away * 48;
    for (let k = 0; k < 6 && hits(h.calloutBox(l.x, l.y, lines, dir, rise, 120)); k++) rise += away * 34;
    placed.push(h.calloutBox(l.x, l.y, lines, dir, rise, 120));
    h.callout(l.x, l.y, lines, colors.amber, dir, rise, 120, l.alpha * 0.95);
  }
}

function drawEngine(h: Hud, st: ProteinHudState, inset: number, compact: boolean): void {
  const s = h.s;
  const w = (compact ? 210 : 250) * s;
  const x = h.w - inset - w;
  const y = inset + 58 * s;
  const ph = 300 * s;
  const o = h.panel(x, y, w, ph, 'DOCKING ENGINE');
  const cw = w - 20 * s;
  const sc = STAGE_COLOR[st.stage];

  // big ΔG readout
  h.text('ΔG BIND', o.x, o.y + 6 * s, { size: 8.5, color: colors.textDim, spacing: 1.6 });
  const dgCol = st.dG < -8.5 ? colors.amber : colors.text;
  const dgStr = st.dG < -0.05 ? st.dG.toFixed(2) : '—';
  h.text(dgStr, o.x, o.y + 38 * s, { size: 32, font: 'display', weight: 600, color: dgCol, glow: st.dG < -8.5 ? 14 : 0, spacing: 0 });
  h.text('kcal/mol', o.x + h.measure(dgStr, 32, 600, 'display', 0) + 8 * s, o.y + 38 * s, { size: 9, color: colors.textDim });

  // sparkline of the score during this run
  const sy = o.y + 50 * s;
  const sh = 40 * s;
  h.rect(o.x, sy, cw, sh, rgba(colors.cyan, 0.15), 'rgba(0,0,0,0.25)');
  // reference line at −9
  const yRef = sy + sh * (9 / 10.5);
  h.line(o.x, yRef, o.x + cw, yRef, rgba(colors.amber, 0.35), 1, [2, 3]);
  h.text('−9', o.x + cw - 2 * s, yRef - 3 * s, { size: 7.5, color: rgba(colors.amber, 0.7), align: 'right' });
  const hist = st.history.length ? st.history.map((v) => -v) : [0, 0];
  h.sparkline(o.x, sy + 2 * s, cw, sh - 4 * s, hist, st.bound > 0.5 ? colors.amber : colors.cyan, 0, 10.5);

  // Ki from ΔG = RT ln Ki  (T = 298 K)
  const ki = Math.exp((st.dG * 1000) / (1.987 * 298));
  const kiStr = st.dG < -4 ? (ki < 1e-6 ? `${(ki * 1e9).toFixed(ki * 1e9 < 10 ? 1 : 0)} nM` : `${(ki * 1e6).toFixed(1)} µM`) : '—';
  const rows: Array<[string, string, string?]> = [
    ['STAGE', st.stage, sc],
    ['POSE', `${pad(st.pose, 2)} / ${pad(st.poses, 2)}`],
    ['SAMPLED', fmtInt(st.sampled)],
    ['RMSD', st.rmsd < 40 ? `${st.rmsd.toFixed(2)} Å` : '—', st.rmsd < 1 ? colors.mint : undefined],
    ['Ki (est.)', kiStr, st.bound > 0.5 ? colors.amber : undefined],
    ['H-BONDS', String(st.hbonds), st.hbonds ? colors.amber : undefined],
    ['RUN', `#${pad(st.run, 4)}`],
  ];
  h.kv(o.x, sy + sh + 18 * s, cw, rows, 9.5, 15);
  // affinity bar
  const by = sy + sh + 18 * s + rows.length * 15 * s + 4 * s;
  h.text('AFFINITY', o.x, by + 6 * s, { size: 8, color: colors.textFaint, spacing: 1.6 });
  h.bar(o.x + 62 * s, by, cw - 62 * s, 7 * s, clamp(-st.dG / 10.5), st.bound > 0.5 ? colors.amber : colors.cyan, 24);
}

function drawSite(h: Hud, st: ProteinHudState, inset: number): void {
  const s = h.s;
  const w = 232 * s;
  const rows: Array<[string, string, string?]> = [
    ['LIGAND', st.ligandName.split(' ')[0]],
    ['FORMULA', st.formula],
    ['MW', `${st.mw.toFixed(1)} g/mol`],
    ['SITE', 'CATALYTIC DYAD D25/D25′'],
    ['FLAPS', st.bound > 0.5 ? 'CLOSED' : 'SEMI-OPEN', st.bound > 0.5 ? colors.amber : colors.textDim],
  ];
  const contacts = [...new Map(st.labels.filter((l) => l.alpha > 0.5).map((l) => [l.text.split(' ')[0], l])).values()].slice(0, 6);
  const ph = (32 + rows.length * 14 + 18 + Math.max(1, contacts.length) * 13 + 6) * s;
  const x = inset;
  const y = h.h - inset - ph - 34 * s;
  const o = h.panel(x, y, w, ph, 'BINDING SITE');
  let yy = h.kv(o.x, o.y + 4 * s, w - 20 * s, rows, 9, 14);
  yy += 8 * s;
  h.text('CONTACTS', o.x, yy, { size: 8.5, color: colors.amber, spacing: 1.6 });
  if (!contacts.length) h.text('— awaiting pose —', o.x, yy + 14 * s, { size: 9, color: colors.textFaint });
  contacts.forEach((c, i) => {
    h.text(c.text, o.x, yy + (14 + i * 13) * s, { size: 9, color: colors.text });
    h.text(`${c.dist.toFixed(2)} Å`, o.x + w - 20 * s, yy + (14 + i * 13) * s, { size: 9, color: colors.amber, align: 'right' });
  });
}

function drawStageBanner(h: Hud, st: ProteinHudState, inset: number): void {
  const s = h.s;
  const y = h.h - inset - 44 * s;
  const cx = h.w / 2;
  const label = st.stage === 'BOUND' ? 'BINDING CONFIRMED · LOWEST-ENERGY POSE' : st.stage === 'POSE SEARCH' ? `SCORING POSE ${st.pose}/${st.poses}` : st.stage;
  const col = STAGE_COLOR[st.stage];
  const tw = h.measure(label, 11, 600, 'mono', 3) + 40 * s;
  h.rect(cx - tw / 2, y - 16 * s, tw, 24 * s, rgba(col, 0.6), 'rgba(4,8,16,0.65)');
  h.brackets(cx - tw / 2, y - 16 * s, tw, 24 * s, 6, col, 1.4);
  h.text(label, cx, y, { size: 11, weight: 600, color: col, align: 'center', spacing: 3, glow: st.stage === 'BOUND' ? 10 : 0 });
  // progress ticks for the pose search
  for (let i = 0; i < st.poses; i++) {
    const px = cx - (st.poses - 1) * 9 * s + i * 18 * s;
    const on = i < st.pose || st.stage === 'BOUND' || st.stage === 'REFINING';
    h.rect(px - 5 * s, y + 14 * s, 10 * s, 3 * s, undefined, on ? col : rgba(col, 0.2));
  }
}
