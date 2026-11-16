/**
 * MRI HUD: panel chrome, slice frame with radiological orientation
 * markers, crosshair, scanner metadata, segmentation callouts.
 */
import type { Hud } from '../../shared/hud';
import { colors, rgba } from '../../shared/tokens';
import { clamp, pad } from '../../shared/math';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MriHudState {
  panels: Array<{ panel: Rect; vol: Rect; slice: Rect; info: Rect }>;
  plane: 'axial' | 'sagittal' | 'coronal';
  seq: number; // 0 = T1, 1 = T2
  pos: number;
  sliceIndex: number;
  sliceCount: number;
  posMm: number;
  pass: number; // 0..1 slice intersects the lesion
  tumorSlice: { x: number; y: number; r: number } | null;
  tumorVol: { x: number; y: number } | null;
  areaMm2: number;
  volCm3: number;
  edemaCm3: number;
  dataLabel: string;
  axes: Array<{ label: string; x: number; y: number }>;
  time: number;
  planeFade: number;
}

const ORIENT: Record<MriHudState['plane'], [string, string, string, string]> = {
  // left, right, top, bottom
  axial: ['R', 'L', 'A', 'P'],
  sagittal: ['A', 'P', 'S', 'I'],
  coronal: ['R', 'L', 'S', 'I'],
};
const AXIS_LETTER: Record<MriHudState['plane'], string> = { axial: 'z', sagittal: 'x', coronal: 'y' };

export function drawMriHud(h: Hud, st: MriHudState): void {
  h.frame({
    code: 'VIZ-03 // NEURO-IMAGING · 3T MRI',
    title: 'BRAIN MRI · HEALTHY vs GLIOMA',
    subtitle: `${st.plane.toUpperCase()} SWEEP · ${st.seq < 0.5 ? 'T1-WEIGHTED (+Gd)' : 'T2-WEIGHTED'} · ${st.dataLabel}`,
    footerRight: 'SYNTHETIC PHANTOM · NOT FOR DIAGNOSIS',
  });
  st.panels.forEach((r, i) => drawPanel(h, st, r, i === 1));
}

function drawPanel(h: Hud, st: MriHudState, r: MriHudState['panels'][number], lesion: boolean): void {
  const s = h.s;
  const P = r.panel;
  const alert = lesion && st.pass > 0.3;
  const accent = lesion ? colors.amber : colors.cyan;

  // panel chrome
  h.rect(P.x, P.y, P.w, P.h, rgba(accent, 0.16));
  h.brackets(P.x, P.y, P.w, P.h, 14, rgba(accent, 0.9), 1.5);
  const ty = P.y + 21 * s;
  h.rect(P.x, P.y, 4 * s, 30 * s, undefined, accent);
  if (lesion) {
    const blink = alert ? 0.6 + 0.4 * Math.sin(st.time * 8) : 1;
    h.text('GLIOMA DETECTED', P.x + 14 * s, ty, { size: 15, font: 'display', weight: 600, color: colors.amber, spacing: 2, alpha: blink, glow: alert ? 12 : 0 });
    h.text('SUBJECT 02 · LESION', P.x + P.w - 12 * s, ty - 1 * s, { size: 9, color: colors.textDim, align: 'right', spacing: 1.4 });
  } else {
    h.text('HEALTHY', P.x + 14 * s, ty, { size: 15, font: 'display', weight: 600, color: colors.cyan, spacing: 2 });
    h.text('SUBJECT 01 · CONTROL', P.x + P.w - 12 * s, ty - 1 * s, { size: 9, color: colors.textDim, align: 'right', spacing: 1.4 });
  }
  h.line(P.x + 8 * s, P.y + 31 * s, P.x + P.w - 8 * s, P.y + 31 * s, rgba(accent, 0.25));

  // 3D view label + orientation gizmo
  const V = r.vol;
  h.text('3D VOLUME · RAYMARCHED', V.x + 14 * s, V.y + 18 * s, { size: 8.5, color: colors.textFaint, spacing: 1.6 });
  const gx = V.x + 34 * s;
  const gy = V.y + V.h - 30 * s;
  for (const a of st.axes) {
    const col = a.label === 'R' ? colors.magenta : a.label === 'A' ? colors.mint : colors.cyan;
    h.line(gx, gy, gx + a.x * 18 * s, gy + a.y * 18 * s, col, 1.2);
    h.text(a.label, gx + a.x * 25 * s, gy + a.y * 25 * s + 3 * s, { size: 8.5, color: col, align: 'center', weight: 600 });
  }
  if (lesion && st.tumorVol) {
    const a = 0.55 + 0.45 * clamp(st.pass * 1.5);
    h.callout(st.tumorVol.x, st.tumorVol.y, ['LESION', 'R frontoparietal WM'], colors.amber, 1, -34, 70, a);
  }

  // slice frame
  const S = r.slice;
  h.rect(S.x, S.y, S.w, S.h, rgba(accent, 0.45));
  h.brackets(S.x - 4 * s, S.y - 4 * s, S.w + 8 * s, S.h + 8 * s, 10, accent, 1.5);
  const [L, R, T, B] = ORIENT[st.plane];
  const om = 10 * s;
  h.text(L, S.x + om, S.y + S.h / 2 + 4 * s, { size: 10, color: colors.amber, weight: 600 });
  h.text(R, S.x + S.w - om, S.y + S.h / 2 + 4 * s, { size: 10, color: colors.amber, weight: 600, align: 'right' });
  h.text(T, S.x + S.w / 2, S.y + om + 6 * s, { size: 10, color: colors.amber, weight: 600, align: 'center' });
  h.text(B, S.x + S.w / 2, S.y + S.h - om + 2 * s, { size: 10, color: colors.amber, weight: 600, align: 'center' });
  h.text(`${st.plane.slice(0, 3).toUpperCase()} ${pad(st.sliceIndex, 3)}/${st.sliceCount}`, S.x + 6 * s, S.y + 14 * s, { size: 8.5, color: colors.text });
  h.text(`${AXIS_LETTER[st.plane]} = ${st.posMm >= 0 ? '+' : ''}${st.posMm.toFixed(1)} mm`, S.x + S.w - 6 * s, S.y + 14 * s, { size: 8.5, color: colors.text, align: 'right' });
  h.text(st.seq < 0.5 ? 'T1 MPRAGE +Gd' : 'T2 TSE', S.x + 6 * s, S.y + S.h - 8 * s, { size: 8.5, color: colors.textDim });
  h.text('W 1200 / L 600', S.x + S.w - 6 * s, S.y + S.h - 8 * s, { size: 8.5, color: colors.textDim, align: 'right' });
  // scale bar: 50 mm = quarter of the 200 mm field
  const sb = S.w / 4;
  h.line(S.x + S.w - 8 * s - sb, S.y + S.h - 22 * s, S.x + S.w - 8 * s, S.y + S.h - 22 * s, colors.text, 1.2);
  h.text('50 mm', S.x + S.w - 8 * s - sb / 2, S.y + S.h - 26 * s, { size: 7.5, color: colors.textDim, align: 'center' });

  // crosshair: centre on healthy, tracks the lesion centroid on the lesion panel
  let cx = S.x + S.w / 2;
  let cy = S.y + S.h / 2;
  if (lesion && st.tumorSlice && st.pass > 0.05) {
    cx += (st.tumorSlice.x - cx) * clamp(st.pass * 1.4);
    cy += (st.tumorSlice.y - cy) * clamp(st.pass * 1.4);
  }
  h.crosshair(cx, cy, 16, lesion && st.pass > 0.3 ? colors.amber : colors.cyan, 6, 0.85);
  h.ctx.save();
  h.ctx.beginPath();
  h.ctx.rect(S.x, S.y, S.w, S.h);
  h.ctx.clip();
  h.line(S.x, cy, cx - 20 * s, cy, rgba(colors.cyan, 0.22), 1, [2, 4]);
  h.line(cx + 20 * s, cy, S.x + S.w, cy, rgba(colors.cyan, 0.22), 1, [2, 4]);
  h.line(cx, S.y, cx, cy - 20 * s, rgba(colors.cyan, 0.22), 1, [2, 4]);
  h.line(cx, cy + 20 * s, cx, S.y + S.h, rgba(colors.cyan, 0.22), 1, [2, 4]);
  h.ctx.restore();

  // lesion callout on the slice
  if (lesion && st.tumorSlice && st.pass > 0.08) {
    const tsx = st.tumorSlice.x;
    const dir = tsx < S.x + S.w / 2 ? -1 : 1;
    h.callout(tsx + dir * st.tumorSlice.r * 0.9, st.tumorSlice.y - st.tumorSlice.r * 0.4, [
      'SEGMENTATION',
      `Tumor vol: ${st.volCm3.toFixed(1)} cm³`,
      `Confidence ${(0.95 + 0.02 * clamp(st.pass)).toFixed(2)}`,
    ], colors.amber, dir, -30, 44, clamp(st.pass * 1.6));
  }

  // info column (landscape only)
  const I = r.info;
  if (I.w > 120 * s) drawInfo(h, st, I, lesion);
}

function drawInfo(h: Hud, st: MriHudState, I: Rect, lesion: boolean): void {
  const s = h.s;
  const t1 = st.seq < 0.5;
  const rows: Array<[string, string, string?]> = [
    ['FIELD', '3.0 T · 32ch'],
    ['SEQ', t1 ? 'MPRAGE +Gd' : 'T2 TSE'],
    ['TR / TE', t1 ? '2300 / 2.98 ms' : '5000 / 100 ms'],
    [t1 ? 'TI' : 'ETL', t1 ? '900 ms' : '16'],
    ['FLIP', t1 ? '9°' : '150°'],
    ['VOXEL', '1.0 mm iso'],
    ['MATRIX', '256 × 256'],
  ];
  const cw = Math.min(I.w, 230 * s);
  let y = I.y + 10 * s;
  h.text('ACQUISITION', I.x, y, { size: 8.5, color: lesion ? colors.amber : colors.cyan, spacing: 1.8, weight: 600 });
  y = h.kv(I.x, y + 16 * s, cw, rows, 9, 14) + 8 * s;

  h.text('AI SEGMENTATION · 3D U-NET', I.x, y, { size: 8.5, color: lesion ? colors.amber : colors.cyan, spacing: 1.8, weight: 600 });
  const seg: Array<[string, string, string?]> = lesion
    ? [
        ['FINDING', 'GLIOMA (pred.)', colors.amber],
        ['TUMOR VOL', `${st.volCm3.toFixed(1)} cm³`, colors.amber],
        ['EDEMA VOL', `${st.edemaCm3.toFixed(1)} cm³`, colors.magenta],
        ['SLICE AREA', st.areaMm2 > 1 ? `${st.areaMm2.toFixed(0)} mm²` : '—'],
        ['CONFIDENCE', '0.97', colors.amber],
      ]
    : [
        ['FINDING', 'NO LESION', colors.mint],
        ['BRAIN VOL', '1,182 cm³'],
        ['GM / WM', '1.21'],
        ['MIDLINE SHIFT', '0.0 mm'],
        ['CONFIDENCE', '0.99', colors.mint],
      ];
  y = h.kv(I.x, y + 16 * s, cw, seg, 9, 14);
  // tumour presence meter along the sweep
  if (lesion && y + 16 * s < I.y + I.h) {
    h.text('LESION IN SLICE', I.x, y + 10 * s, { size: 8, color: colors.textFaint, spacing: 1.4 });
    h.bar(I.x + 100 * s, y + 4 * s, cw - 100 * s, 6 * s, st.pass, colors.amber, 20);
  }
}
