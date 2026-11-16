/**
 * Procedural PA chest radiograph generator (Canvas2D), used until real
 * public-domain CXRs are dropped into public/xray/.
 *
 * Radiograph convention: dense = white, air = black, and the patient's
 * right is on the image LEFT. Coordinates below are normalised [0,1] image
 * coordinates (x to the right, y down).
 *
 * Layers: soft-tissue body → abdomen/diaphragm → mediastinum + heart →
 * lungs (darkened) → vascular markings → spine → ribs (posterior + anterior)
 * → clavicles / scapulae / humeral heads → pathology → marker, blur, grain.
 */
import { rng } from '../../shared/math';

export type Finding = 'normal' | 'pneumonia-rll' | 'pneumonia-rml' | 'pneumonia-lll' | 'effusion-l' | 'effusion-r' | 'effusion-bilat' | 'cardiomegaly' | 'nodule-rul' | 'nodule-lul' | 'pneumothorax-l';

export interface CxrOptions {
  size: number;
  seed: number;
  finding: Finding;
}

type C2D = CanvasRenderingContext2D;

/** `heart` = how far the cardiac border reaches from the midline on this side. */
function lungPath(ctx: C2D, S: number, side: -1 | 1, j: (n: number) => number, domeY: number, heart: number): void {
  // side −1 = patient right (image left), +1 = patient left (image right)
  const cx = 0.5;
  const med = cx + side * (side < 0 ? 0.075 : 0.085);
  const lat = cx + side * (0.355 + j(0.015));
  const apexX = cx + side * 0.2;
  const P = (x: number, y: number): [number, number] => [x * S, y * S];
  ctx.beginPath();
  ctx.moveTo(...P(med, 0.24));
  ctx.bezierCurveTo(...P(med - side * 0.01, 0.16), ...P(apexX - side * 0.06, 0.12), ...P(apexX, 0.13));
  ctx.bezierCurveTo(...P(apexX + side * 0.11, 0.14), ...P(lat, 0.3), ...P(lat, 0.52));
  ctx.bezierCurveTo(...P(lat + side * 0.005, 0.66), ...P(lat - side * 0.01, domeY + 0.06), ...P(lat - side * 0.025, domeY + 0.085)); // costophrenic angle
  const hb = cx + side * heart; // lung meets the cardiac border at the base
  ctx.bezierCurveTo(...P(cx + side * 0.27, domeY - 0.01), ...P(hb + side * 0.06, domeY - 0.03), ...P(hb, domeY - 0.005)); // diaphragm dome
  ctx.bezierCurveTo(...P(hb + side * 0.03, 0.6), ...P(med + side * 0.01, 0.45), ...P(med, 0.24)); // cardiac / mediastinal border
  ctx.closePath();
}

export function generateCxr(o: CxrOptions): HTMLCanvasElement {
  const S = o.size;
  const r = rng(o.seed);
  const j = (n: number) => (r() * 2 - 1) * n;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const out = c.getContext('2d')!;
  // Every group of shapes is drawn sharp into a scratch layer, then composited
  // ONCE with a blur filter. (Per-shape filters are ~10× slower.)
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = S;
  const ctx = scratch.getContext('2d')!;
  let layerBlur = 0;
  let layerMode: GlobalCompositeOperation = 'source-over';
  const flush = () => {
    out.save();
    out.globalCompositeOperation = layerMode;
    out.filter = layerBlur > 0 ? `blur(${((layerBlur * S) / 1024).toFixed(2)}px)` : 'none';
    out.drawImage(scratch, 0, 0);
    out.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, S, S);
  };
  /** Start a new layer (flushing the previous one). */
  const blur = (px: number, mode: GlobalCompositeOperation = 'source-over') => {
    flush();
    layerBlur = px;
    layerMode = mode;
  };
  const P = (x: number, y: number): [number, number] => [x * S, y * S];
  const gray = (v: number, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;
  const cardio = o.finding === 'cardiomegaly';
  const domeR = 0.72 + j(0.015); // right hemidiaphragm sits higher (liver)
  const domeL = 0.75 + j(0.015);
  const hw = cardio ? 0.25 : 0.17 + j(0.01); // heart extends to patient left (image right)
  const rh = cardio ? 0.135 : 0.1;

  out.fillStyle = '#000';
  out.fillRect(0, 0, S, S);

  // ── body soft tissue (shoulders, torso, neck, arms)
  blur(14);
  ctx.fillStyle = gray(0.34);
  ctx.beginPath();
  ctx.moveTo(...P(0.42, -0.02));
  ctx.lineTo(...P(0.43, 0.07));
  ctx.bezierCurveTo(...P(0.3, 0.09), ...P(0.1, 0.1), ...P(0.03, 0.17));
  ctx.lineTo(...P(-0.02, 0.3));
  ctx.lineTo(...P(0.04, 1.02));
  ctx.lineTo(...P(0.96, 1.02));
  ctx.lineTo(...P(1.02, 0.3));
  ctx.lineTo(...P(0.97, 0.17));
  ctx.bezierCurveTo(...P(0.9, 0.1), ...P(0.7, 0.09), ...P(0.57, 0.07));
  ctx.lineTo(...P(0.58, -0.02));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = gray(0.28);
  ctx.fillRect(...P(-0.05, 0.18), 0.09 * S, 0.9 * S);
  ctx.fillRect(...P(0.96, 0.18), 0.09 * S, 0.9 * S);

  // ── abdomen below the diaphragm
  blur(10, 'lighter');
  ctx.fillStyle = gray(0.17);
  ctx.beginPath();
  ctx.moveTo(...P(0.08, domeR + 0.1));
  ctx.bezierCurveTo(...P(0.2, domeR - 0.03), ...P(0.4, domeR - 0.05), ...P(0.5, domeR));
  ctx.bezierCurveTo(...P(0.6, domeL - 0.04), ...P(0.8, domeL - 0.03), ...P(0.92, domeL + 0.1));
  ctx.lineTo(...P(0.94, 1.05));
  ctx.lineTo(...P(0.06, 1.05));
  ctx.closePath();
  ctx.fill();

  // ── mediastinum + heart
  blur(12, 'lighter');
  ctx.fillStyle = gray(0.2);
  ctx.beginPath();
  ctx.moveTo(...P(0.445, 0.06));
  ctx.lineTo(...P(0.555, 0.06));
  ctx.bezierCurveTo(...P(0.56, 0.2), ...P(0.6, 0.27), ...P(0.6, 0.33)); // aortic knob
  ctx.bezierCurveTo(...P(0.58, 0.38), ...P(0.58, 0.4), ...P(0.6, 0.42));
  ctx.bezierCurveTo(...P(0.5 + hw, 0.47), ...P(0.5 + hw + 0.02, 0.62), ...P(0.5 + hw - 0.03, domeL - 0.005));
  ctx.lineTo(...P(0.42, domeR + 0.01));
  ctx.bezierCurveTo(...P(0.5 - rh, 0.62), ...P(0.5 - rh, 0.5), ...P(0.43, 0.42)); // right heart border
  ctx.bezierCurveTo(...P(0.43, 0.3), ...P(0.44, 0.2), ...P(0.445, 0.06));
  ctx.closePath();
  ctx.fill();

  // ── lungs: darken with multiply
  blur(8, 'multiply');
  ctx.fillStyle = gray(0.3);
  lungPath(ctx, S, -1, j, domeR, rh + 0.005);
  ctx.fill();
  lungPath(ctx, S, 1, j, domeL, hw - 0.02);
  ctx.fill();
  // heart shadow overlapping the left lung field
  blur(18, 'lighter');
  ctx.fillStyle = gray(0.13);
  ctx.beginPath();
  ctx.ellipse(...P(0.5 + hw * 0.45, 0.6), hw * 0.75 * S, 0.15 * S, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // ── vascular markings: branching trees from each hilum
  blur(0.9, 'lighter');
  ctx.lineCap = 'round';
  ctx.strokeStyle = gray(0.075);
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number, side: number) => {
    if (depth <= 0 || w < 0.0008) return;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    if (Math.abs(x2 - 0.5) > 0.36 || y2 < 0.14 || y2 > (side < 0 ? domeR : domeL) + 0.02) return;
    ctx.lineWidth = w * S;
    ctx.beginPath();
    ctx.moveTo(x * S, y * S);
    ctx.quadraticCurveTo(((x + x2) / 2 + j(0.01)) * S, ((y + y2) / 2 + j(0.01)) * S, x2 * S, y2 * S);
    ctx.stroke();
    const n = r() < 0.75 ? 2 : 3;
    for (let k = 0; k < n; k++) branch(x2, y2, ang + j(0.55), len * (0.68 + r() * 0.16), w * 0.68, depth - 1, side);
  };
  for (const side of [-1, 1] as const) {
    const hx = 0.5 + side * 0.11;
    const hy = 0.42 + j(0.02);
    for (let k = 0; k < 7; k++) {
      const base = side < 0 ? Math.PI : 0;
      branch(hx, hy, base - side * (-1.1 + (k / 6) * 2.2) + j(0.15), 0.055 + r() * 0.03, 0.009, 6, side);
    }
  }
  blur(6, 'lighter');
  ctx.fillStyle = gray(0.16); // hilar density
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(...P(0.5 + side * 0.105, 0.43), 0.035 * S, 0.07 * S, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── spine (faint through the mediastinum)
  blur(2, 'lighter');
  ctx.fillStyle = gray(0.05);
  for (let k = 0; k < 15; k++) {
    const y = 0.05 + k * 0.058;
    ctx.fillRect(...P(0.468, y), 0.064 * S, 0.046 * S);
    ctx.beginPath();
    ctx.ellipse(...P(0.465, y + 0.02), 0.008 * S, 0.012 * S, 0, 0, Math.PI * 2); // pedicles
    ctx.ellipse(...P(0.535, y + 0.02), 0.008 * S, 0.012 * S, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── ribs: shafts, cortical margins, anterior arcs (three layers)
  const ribs: Array<{ y: number; spread: number; k: number }> = [];
  for (let k = 0; k < 10; k++) ribs.push({ y: 0.135 + k * 0.058 + j(0.004), spread: 0.24 + Math.min(k, 6) * 0.018, k });
  const ribPath = (y: number, spread: number, side: number, dy = 0) => {
    ctx.beginPath();
    ctx.moveTo((0.5 + side * 0.04) * S, (y + dy) * S);
    ctx.bezierCurveTo(...P(0.5 + side * 0.13, y - 0.045 + dy), ...P(0.5 + side * (spread + 0.04), y - 0.02 + dy), ...P(0.5 + side * (spread + 0.1), y + 0.09 + dy));
  };
  blur(1.4, 'lighter');
  ctx.lineCap = 'round';
  ctx.strokeStyle = gray(0.065);
  for (const rb of ribs) for (const side of [-1, 1]) {
    ctx.lineWidth = (0.02 + rb.k * 0.0009) * S;
    ribPath(rb.y, rb.spread, side);
    ctx.stroke();
  }
  blur(0.6, 'lighter');
  ctx.strokeStyle = gray(0.045);
  ctx.lineWidth = 0.003 * S;
  for (const rb of ribs) for (const side of [-1, 1]) for (const dy of [-0.009, 0.009]) {
    ribPath(rb.y, rb.spread, side, dy);
    ctx.stroke();
  }
  blur(2, 'lighter');
  ctx.strokeStyle = gray(0.03);
  ctx.lineWidth = 0.016 * S;
  for (const rb of ribs.slice(0, 7)) for (const side of [-1, 1]) {
    const lx = 0.5 + side * (rb.spread + 0.1);
    ctx.beginPath();
    ctx.moveTo(lx * S, (rb.y + 0.1) * S);
    ctx.quadraticCurveTo(...P(0.5 + side * (rb.spread - 0.02), rb.y + 0.1), ...P(0.5 + side * 0.13, rb.y + 0.2));
    ctx.stroke();
  }
  // clavicles
  blur(1.5, 'lighter');
  ctx.strokeStyle = gray(0.2);
  ctx.lineWidth = 0.022 * S;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(...P(0.5 + side * 0.035, 0.155));
    ctx.bezierCurveTo(...P(0.5 + side * 0.15, 0.17), ...P(0.5 + side * 0.22, 0.11), ...P(0.5 + side * 0.35, 0.115));
    ctx.stroke();
  }
  // scapular edges + humeral heads
  blur(3, 'lighter');
  ctx.strokeStyle = gray(0.07);
  ctx.lineWidth = 0.012 * S;
  ctx.fillStyle = gray(0.18);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(...P(0.5 + side * 0.4, 0.15));
    ctx.quadraticCurveTo(...P(0.5 + side * 0.33, 0.3), ...P(0.5 + side * 0.37, 0.45));
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(...P(0.5 + side * 0.465, 0.155), 0.05 * S, 0.06 * S, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── gastric bubble under the left hemidiaphragm (image right)
  blur(5, 'multiply');
  ctx.fillStyle = gray(0.55);
  ctx.beginPath();
  ctx.ellipse(...P(0.66, domeL + 0.07), 0.05 * S, 0.03 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── pathology
  const haze = (x: number, y: number, rx: number, ry: number, a: number) => {
    blur(9, 'lighter');
    for (let k = 0; k < 7; k++) {
      ctx.fillStyle = gray(a * (0.5 + r() * 0.5));
      ctx.beginPath();
      ctx.ellipse(...P(x + j(rx * 0.4), y + j(ry * 0.4)), rx * (0.5 + r() * 0.5) * S, ry * (0.5 + r() * 0.5) * S, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const bronchograms = (x: number, y: number) => {
    blur(1, 'multiply');
    ctx.strokeStyle = gray(0.7);
    ctx.lineWidth = 0.004 * S;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.moveTo(...P(x + j(0.03), y - 0.05));
      ctx.quadraticCurveTo(...P(x + j(0.04), y), ...P(x + j(0.06), y + 0.05));
      ctx.stroke();
    }
  };
  const effusion = (side: -1 | 1, dome: number, h: number) => {
    ctx.fillStyle = gray(0.3);
    ctx.beginPath();
    const lat = 0.5 + side * 0.37;
    ctx.moveTo(lat * S, (dome + 0.1) * S);
    ctx.lineTo(lat * S, (dome - h) * S); // meniscus climbs the lateral chest wall
    ctx.quadraticCurveTo(...P(0.5 + side * 0.25, dome - h * 0.25), ...P(0.5 + side * 0.08, dome));
    ctx.lineTo(...P(0.5 + side * 0.08, dome + 0.1));
    ctx.closePath();
    ctx.fill();
  };
  const nodule = (x: number, y: number, rad: number) => {
    blur(2.5, 'lighter');
    ctx.fillStyle = gray(0.3);
    ctx.beginPath();
    ctx.arc(...P(x + j(0.02), y + j(0.02)), rad * S, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (o.finding) {
    case 'pneumonia-rll': haze(0.3, 0.63, 0.1, 0.07, 0.18); bronchograms(0.3, 0.63); break;
    case 'pneumonia-rml': haze(0.33, 0.53, 0.09, 0.06, 0.16); bronchograms(0.33, 0.53); break;
    case 'pneumonia-lll': haze(0.7, 0.65, 0.09, 0.06, 0.16); break;
    case 'effusion-l': blur(11, 'lighter'); effusion(1, domeL, 0.11); break;
    case 'effusion-r': blur(11, 'lighter'); effusion(-1, domeR, 0.1); break;
    case 'effusion-bilat': blur(11, 'lighter'); effusion(1, domeL, 0.07); effusion(-1, domeR, 0.06); break;
    case 'nodule-rul': nodule(0.32, 0.28, 0.022); break;
    case 'nodule-lul': nodule(0.68, 0.3, 0.02); break;
    case 'pneumothorax-l':
      // collapsed lung edge: lucent rim without markings + thin visceral pleural line
      blur(3, 'multiply');
      ctx.fillStyle = gray(0.45);
      ctx.beginPath();
      ctx.ellipse(...P(0.82, 0.35), 0.08 * S, 0.2 * S, 0.1, 0, Math.PI * 2);
      ctx.fill();
      blur(0.8, 'lighter');
      ctx.strokeStyle = gray(0.25);
      ctx.lineWidth = 0.003 * S;
      ctx.beginPath();
      ctx.ellipse(...P(0.8, 0.36), 0.065 * S, 0.19 * S, 0.1, Math.PI * 0.55, Math.PI * 1.45);
      ctx.stroke();
      break;
    default:
      break;
  }

  // ── radiopaque side marker
  blur(0.6, 'lighter');
  ctx.fillStyle = gray(0.92);
  ctx.font = `700 ${Math.round(0.045 * S)}px Arial, sans-serif`;
  ctx.fillText('R', 0.07 * S, 0.1 * S);
  flush();

  // ── film grain + gentle tone curve
  const img = out.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] / 255;
    v = Math.pow(Math.min(1, v * 1.08), 0.92);
    v += (r() + r() - 1) * 0.035;
    const b = Math.max(0, Math.min(255, v * 255));
    d[i] = d[i + 1] = d[i + 2] = b;
  }
  out.putImageData(img, 0, 0);
  return c;
}
