/**
 * HUD layer — drawn with Canvas2D on an overlay canvas every frame.
 *
 * Why Canvas2D instead of DOM: the HUD must end up in WebM recordings and
 * 2× PNG exports. A canvas can be composited over the WebGL frame with a
 * single drawImage(); DOM text cannot.
 *
 * All sizes are expressed in "HUD units" multiplied by `this.s`, a scale
 * derived from the viewport so the HUD reads the same on a laptop and on a
 * 4K projector.
 */
import { colors, fonts, rgba } from './tokens';
import { clamp, pad } from './math';

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: number | string;
  font?: 'mono' | 'display';
  alpha?: number;
  spacing?: number; // letter spacing in HUD units
  glow?: number; // shadow blur in HUD units
}

export interface FrameOpts {
  title: string;
  subtitle?: string;
  code?: string;
  accent?: string;
  footerLeft?: string;
  footerRight?: string;
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

export class Hud {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  /** CSS pixel size. */
  w = 1;
  h = 1;
  /** Device pixel ratio actually used for the backing store. */
  dpr = 1;
  /** HUD unit → CSS px scale. */
  s = 1;
  enabled: boolean;
  /** Seconds since start (unscaled) — drives blinking etc. */
  clock = 0;
  frameCount = 0;

  constructor(parent: HTMLElement, enabled: boolean) {
    this.enabled = enabled;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')! as Ctx;
    if (!enabled) this.canvas.style.display = 'none';
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.s = clamp(Math.min(w / 1440, h / 820), 0.55, 2.4);
  }

  begin(): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  // ───────────────────────────── primitives ─────────────────────────────

  font(size: number, weight: number | string = 400, family: 'mono' | 'display' = 'mono'): string {
    return `${weight} ${(size * this.s).toFixed(2)}px ${fonts[family]}`;
  }

  text(str: string, x: number, y: number, o: TextOpts = {}): number {
    const { ctx } = this;
    ctx.save();
    ctx.font = this.font(o.size ?? 11, o.weight ?? 400, o.font ?? 'mono');
    ctx.fillStyle = o.color ?? colors.text;
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.textAlign = o.align ?? 'left';
    ctx.textBaseline = o.baseline ?? 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${((o.spacing ?? 0.6) * this.s).toFixed(2)}px`;
    if (o.glow) {
      ctx.shadowColor = o.color ?? colors.cyan;
      ctx.shadowBlur = o.glow * this.s;
    }
    ctx.fillText(str, x, y);
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  measure(str: string, size = 11, weight: number | string = 400, family: 'mono' | 'display' = 'mono', spacing = 0.6): number {
    const { ctx } = this;
    ctx.save();
    ctx.font = this.font(size, weight, family);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(spacing * this.s).toFixed(2)}px`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string = colors.line, width = 1, dash?: number[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * Math.max(1, this.s * 0.8);
    if (dash) ctx.setLineDash(dash.map((d) => d * this.s));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  rect(x: number, y: number, w: number, h: number, stroke?: string, fill?: string, width = 1): void {
    const { ctx } = this;
    ctx.save();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width * Math.max(1, this.s * 0.8);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    ctx.restore();
  }

  /** Four L-shaped corner brackets around a rectangle. */
  brackets(x: number, y: number, w: number, h: number, len: number, color: string = colors.cyan, width = 1.5): void {
    const { ctx } = this;
    const L = Math.min(len * this.s, w / 2, h / 2);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * Math.max(1, this.s * 0.8);
    ctx.beginPath();
    ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
    ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
    ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
    ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
    ctx.stroke();
    ctx.restore();
  }

  /** Small tick marks along a horizontal or vertical edge (ruler look). */
  ruler(x: number, y: number, len: number, vertical: boolean, step: number, color: string = colors.line, major = 5): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const st = step * this.s;
    const n = Math.floor(len / st);
    for (let i = 0; i <= n; i++) {
      const t = (i % major === 0 ? 6 : 3) * this.s;
      if (vertical) {
        ctx.moveTo(x, y + i * st);
        ctx.lineTo(x + t, y + i * st);
      } else {
        ctx.moveTo(x + i * st, y);
        ctx.lineTo(x + i * st, y + t);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  crosshair(x: number, y: number, size: number, color: string = colors.cyan, gap = 6, alpha = 1): void {
    const { ctx } = this;
    const S = size * this.s;
    const G = gap * this.s;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, this.s);
    ctx.beginPath();
    ctx.moveTo(x - S, y); ctx.lineTo(x - G, y);
    ctx.moveTo(x + G, y); ctx.lineTo(x + S, y);
    ctx.moveTo(x, y - S); ctx.lineTo(x, y - G);
    ctx.moveTo(x, y + G); ctx.lineTo(x, y + S);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, G * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Translucent panel with a title strip and corner ticks. Returns content origin. */
  panel(x: number, y: number, w: number, h: number, title?: string, accent: string = colors.cyan): { x: number; y: number } {
    const s = this.s;
    this.rect(x, y, w, h, rgba(accent, 0.22), 'rgba(6, 12, 24, 0.55)');
    this.brackets(x, y, w, h, 8, accent, 1.25);
    let cy = y + 10 * s;
    if (title) {
      this.rect(x, y, 3 * s, 16 * s, undefined, accent);
      this.text(title, x + 10 * s, y + 12 * s, { size: 9.5, color: accent, weight: 600, spacing: 1.6 });
      this.line(x + 8 * s, y + 18 * s, x + w - 8 * s, y + 18 * s, rgba(accent, 0.25));
      cy = y + 32 * s;
    }
    return { x: x + 10 * s, y: cy };
  }

  /** Key/value rows. `cw` = width of the content column. */
  kv(x: number, y: number, cw: number, rows: Array<[string, string, string?]>, size = 10, lh = 15): number {
    const s = this.s;
    rows.forEach(([k, v, c], i) => {
      const yy = y + i * lh * s;
      this.text(k, x, yy, { size, color: colors.textDim, spacing: 1 });
      this.text(v, x + cw, yy, { size, color: c ?? colors.text, align: 'right', weight: 500 });
    });
    return y + rows.length * lh * s;
  }

  /** Horizontal meter bar. */
  bar(x: number, y: number, w: number, h: number, v: number, color: string = colors.cyan, segments = 0): void {
    const { ctx } = this;
    const vv = clamp(v);
    this.rect(x, y, w, h, undefined, rgba(color, 0.12));
    ctx.save();
    ctx.fillStyle = color;
    if (segments > 0) {
      const sw = w / segments;
      const n = Math.round(vv * segments);
      for (let i = 0; i < n; i++) ctx.fillRect(x + i * sw + 1, y, Math.max(1, sw - 2), h);
    } else {
      ctx.fillRect(x, y, w * vv, h);
    }
    ctx.restore();
  }

  sparkline(x: number, y: number, w: number, h: number, data: ArrayLike<number>, color: string, min: number, max: number, fill = true): void {
    const n = data.length;
    if (n < 2) return;
    const { ctx } = this;
    const px = (i: number) => x + (i / (n - 1)) * w;
    const py = (v: number) => y + h - clamp((v - min) / (max - min)) * h;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px(0), py(data[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(px(i), py(data[i]));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.25 * this.s);
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * this.s;
    ctx.stroke();
    if (fill) {
      ctx.shadowBlur = 0;
      ctx.lineTo(px(n - 1), y + h);
      ctx.lineTo(px(0), y + h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, rgba(color, 0.25));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
    }
    // head dot
    ctx.beginPath();
    ctx.arc(px(n - 1), py(data[n - 1]), 2.2 * this.s, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Where `callout()` would put its label box (no drawing). */
  calloutBox(ax: number, ay: number, lines: string[], dir = 1, rise = -40, run = 40): { x: number; y: number; w: number; h: number } {
    const s = this.s;
    const lx = ax + dir * run * s;
    const ey = ay + rise * s;
    const pw = Math.max(...lines.map((l, i) => this.measure(l, i === 0 ? 10.5 : 9.5, i === 0 ? 600 : 400))) + 16 * s;
    const ph = (lines.length * 14 + 8) * s;
    return { x: dir > 0 ? lx : lx - pw, y: ey - ph / 2, w: pw, h: ph };
  }

  /**
   * Callout: dot at (ax, ay), elbow line out to a label box.
   * `dir` = +1 label to the right, -1 to the left. Returns the label box rect.
   */
  callout(ax: number, ay: number, lines: string[], color: string, dir = 1, rise = -40, run = 40, alpha = 1): { x: number; y: number; w: number; h: number } {
    const { ctx } = this;
    const s = this.s;
    const ex = ax + dir * run * 0.6 * s;
    const ey = ay + rise * s;
    const lx = ex + dir * run * 0.4 * s;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.lineTo(lx, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ax, ay, 3 * s, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ax, ay, 7 * s, 0, Math.PI * 2);
    ctx.stroke();
    const pw = Math.max(...lines.map((l, i) => this.measure(l, i === 0 ? 10.5 : 9.5, i === 0 ? 600 : 400))) + 16 * s;
    const ph = (lines.length * 14 + 8) * s;
    const bx = dir > 0 ? lx : lx - pw;
    const by = ey - ph / 2;
    this.rect(bx, by, pw, ph, rgba(color, 0.7), 'rgba(6, 10, 20, 0.78)');
    lines.forEach((l, i) => {
      this.text(l, bx + 8 * s, by + (16 + i * 14) * s - 2 * s, {
        size: i === 0 ? 10.5 : 9.5,
        weight: i === 0 ? 600 : 400,
        color: i === 0 ? color : colors.text,
      });
    });
    ctx.restore();
    return { x: bx, y: by, w: pw, h: ph };
  }

  /** Blinking status dot. */
  dot(x: number, y: number, r: number, color: string, blinkHz = 1): void {
    const on = blinkHz <= 0 || Math.sin(this.clock * Math.PI * 2 * blinkHz) > -0.3;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha *= on ? 1 : 0.25;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 * this.s;
    ctx.beginPath();
    ctx.arc(x, y, r * this.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─────────────────────────── standard frame ───────────────────────────

  /**
   * Common chrome for every visual: corner brackets, title block,
   * timecode, footer tags. Returns the safe content inset in CSS px.
   */
  frame(o: FrameOpts): number {
    const s = this.s;
    const m = 18 * s;
    const accent = o.accent ?? colors.cyan;
    const { w, h } = this;
    this.brackets(m, m, w - 2 * m, h - 2 * m, 26, rgba(accent, 0.85), 1.5);
    // edge rulers
    this.ruler(m + 40 * s, m, Math.min(220 * s, w * 0.2), false, 8, rgba(accent, 0.35));
    this.ruler(m, m + 40 * s, Math.min(160 * s, h * 0.2), true, 8, rgba(accent, 0.35));

    // title block (top-left)
    const tx = m + 16 * s;
    let ty = m + 26 * s;
    if (o.code) {
      this.text(o.code, tx, ty, { size: 9.5, color: accent, spacing: 2.2, weight: 500 });
      ty += 22 * s;
    }
    this.text(o.title, tx, ty, { size: 20, font: 'display', weight: 600, spacing: 1.2, color: colors.text });
    if (o.subtitle) this.text(o.subtitle, tx, ty + 17 * s, { size: 9.5, color: colors.textDim, spacing: 1.4 });

    // top-right: live dot + timecode
    const rx = w - m - 16 * s;
    const t = this.clock;
    const tc = `${pad(t / 3600, 2)}:${pad((t / 60) % 60, 2)}:${pad(t % 60, 2)}.${pad((t * 100) % 100, 2)}`;
    this.text(tc, rx, m + 26 * s, { size: 11, align: 'right', color: colors.text, weight: 500 });
    const lw = this.measure(tc, 11, 500);
    this.dot(rx - lw - 12 * s, m + 22 * s, 3.2, colors.red, 0.8);
    this.text(`FRM ${pad(this.frameCount, 6)}`, rx, m + 42 * s, { size: 9, align: 'right', color: colors.textFaint });

    // footer
    const fy = h - m - 12 * s;
    this.text(o.footerLeft ?? 'HACKNHEAL · AI × BIO/HEALTH', tx, fy, { size: 9, color: colors.textFaint, spacing: 2 });
    if (o.footerRight) this.text(o.footerRight, rx, fy, { size: 9, color: colors.textFaint, spacing: 1.6, align: 'right' });
    return m + 16 * s;
  }
}
