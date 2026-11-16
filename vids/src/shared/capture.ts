/**
 * Capture helpers:
 *   R → start/stop a WebM recording (MediaRecorder on a composite canvas: WebGL frame + HUD)
 *   S → export a PNG at 2× the current resolution
 */
import { colors } from './tokens';

export interface CaptureHost {
  name: string;
  glCanvas: HTMLCanvasElement;
  hudCanvas: HTMLCanvasElement;
  hudVisible(): boolean;
  transparent: boolean;
  /** Re-render the current frame at `scale`× pixel ratio and call `done` while that frame is on the canvases. */
  renderScaled(scale: number, done: () => void): void;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export class Capture {
  private host: CaptureHost;
  private comp: HTMLCanvasElement;
  private cctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private badge: HTMLDivElement;
  private recStart = 0;

  constructor(host: CaptureHost) {
    this.host = host;
    this.comp = document.createElement('canvas');
    this.cctx = this.comp.getContext('2d', { alpha: host.transparent })!;
    this.badge = document.createElement('div');
    this.badge.className = 'capture-badge';
    document.body.appendChild(this.badge);
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  /** Draw WebGL + HUD into `target` at the size of the GL canvas. */
  private composite(target: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const { glCanvas, hudCanvas } = this.host;
    if (target.width !== glCanvas.width || target.height !== glCanvas.height) {
      target.width = glCanvas.width;
      target.height = glCanvas.height;
    }
    ctx.clearRect(0, 0, target.width, target.height);
    if (!this.host.transparent) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, target.width, target.height);
    }
    ctx.drawImage(glCanvas, 0, 0);
    if (this.host.hudVisible()) ctx.drawImage(hudCanvas, 0, 0, target.width, target.height);
  }

  /** Called by the app right after each frame is rendered. */
  afterFrame(): void {
    if (!this.recorder) return;
    this.composite(this.comp, this.cctx);
    const secs = (performance.now() - this.recStart) / 1000;
    this.badge.textContent = `● REC ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  }

  toggleRecording(): void {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      this.toast('MediaRecorder not supported in this browser');
      return;
    }
    this.composite(this.comp, this.cctx);
    const stream = this.comp.captureStream(60);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: Math.min(40e6, Math.max(8e6, this.comp.width * this.comp.height * 8)),
    });
    this.chunks = [];
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      download(new Blob(this.chunks, { type: 'video/webm' }), `hacknheal-${this.host.name}-${stamp()}.webm`);
      this.recorder = null;
      this.badge.classList.remove('rec');
      this.toast('Recording saved');
    };
    rec.start(250);
    this.recorder = rec;
    this.recStart = performance.now();
    this.badge.classList.add('rec');
  }

  snapshot(scale = 2): void {
    this.host.renderScaled(scale, () => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d', { alpha: this.host.transparent })!;
      this.composite(c, ctx);
      c.toBlob((b) => {
        if (b) download(b, `hacknheal-${this.host.name}-${stamp()}@${scale}x.png`);
        this.toast(`PNG ${c.width}×${c.height} saved`);
      }, 'image/png');
    });
  }

  toast(msg: string): void {
    const t = document.createElement('div');
    t.className = 'capture-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2400);
  }
}
