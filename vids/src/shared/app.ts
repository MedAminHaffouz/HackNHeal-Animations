/**
 * VizApp — the shell every visual runs in.
 *
 * Owns the renderer, scene, camera, post stack, HUD canvas, capture
 * hotkeys and the frame loop. A visual plugs in through three hooks:
 *
 *   app.update   = (dt, t) => { ... }   // animate the scene (dt already speed-scaled)
 *   app.drawHud  = (hud)   => { ... }   // draw the Canvas2D overlay
 *   app.onResize = (w, h)  => { ... }   // layout-dependent work
 */
import * as THREE from 'three';
import { parseParams, type VizParams } from './params';
import { createPost, type PostOptions, type PostStack } from './post';
import { Hud } from './hud';
import { Capture } from './capture';
import { applyTokens, colors } from './tokens';
import { clamp } from './math';
import './base.css';

export interface VizAppOptions {
  /** Short id used in file names (`hacknheal-dna-….webm`). */
  name: string;
  camera?: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  post?: PostOptions;
  /** Extra hotkeys: key → [description, handler]. */
  keys?: Record<string, [string, () => void]>;
}

export class VizApp {
  readonly params: VizParams;
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly post: PostStack;
  readonly hud: Hud;
  readonly capture: Capture;

  width = 1;
  height = 1;
  pixelRatio = 1;
  /** Scaled timeline seconds (affected by ?speed, pause, reduced motion). */
  time: number;
  /** 1 normally, ~0.35 under prefers-reduced-motion: scale drift / shake amplitudes by this. */
  readonly motion: number;
  readonly speed: number;
  paused = false;
  hudVisible = true;

  update: (dt: number, t: number) => void = () => {};
  drawHud: (hud: Hud) => void = () => {};
  onResize: (w: number, h: number) => void = () => {};

  private last = performance.now();
  private keys: Record<string, [string, () => void]>;
  private helpEl: HTMLDivElement | null = null;

  constructor(opts: VizAppOptions) {
    applyTokens();
    this.params = parseParams();
    const p = this.params;
    this.motion = p.reducedMotion ? 0.35 : 1;
    this.speed = p.speed * (p.reducedMotion ? 0.5 : 1);
    this.time = p.startTime;
    if (p.transparent) document.documentElement.classList.add('is-transparent');

    this.container = document.getElementById('app') ?? document.body;
    this.container.classList.add('viz-root');

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false, // MSAA happens in the composer's render target
        alpha: p.transparent,
        premultipliedAlpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch (e) {
      this.container.innerHTML = `<div class="gl-error"><b>WebGL 2 is not available</b><br>
        Enable hardware acceleration in your browser settings, or try another browser.</div>`;
      throw e;
    }
    this.renderer.setClearColor(new THREE.Color(colors.bg), p.transparent ? 0 : 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.className = 'gl-canvas';
    this.container.appendChild(this.renderer.domElement);

    if (!p.transparent) this.scene.background = new THREE.Color(colors.bg);
    this.camera = opts.camera ?? new THREE.PerspectiveCamera(35, 1, 0.1, 500);

    this.post = createPost(this.renderer, this.scene, this.camera, p, opts.post);
    this.hud = new Hud(this.container, p.hud);

    this.capture = new Capture({
      name: opts.name,
      glCanvas: this.renderer.domElement,
      hudCanvas: this.hud.canvas,
      hudVisible: () => this.hud.enabled && this.hudVisible,
      transparent: p.transparent,
      renderScaled: (scale, done) => this.renderScaled(scale, done),
    });

    this.keys = {
      r: ['start / stop WebM recording', () => this.capture.toggleRecording()],
      s: ['save PNG at 2×', () => this.capture.snapshot(2)],
      h: ['toggle HUD', () => this.toggleHud()],
      ' ': ['pause / resume', () => (this.paused = !this.paused)],
      '?': ['show / hide this help', () => this.toggleHelp()],
      ...(opts.keys ?? {}),
    };
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = this.keys[e.key.toLowerCase()] ?? this.keys[e.key];
      if (k) {
        e.preventDefault();
        k[1]();
      }
    });

    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
  }

  /** CSS pixel ratio budget per quality level. */
  private targetPixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    return this.params.quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1);
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    this.applySize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)), this.targetPixelRatio());
  }

  private applySize(w: number, h: number, pr: number): void {
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, true);
    this.post.setSize(w, h, pr);
    this.hud.resize(w, h, pr);
    const cam = this.camera;
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.onResize(w, h);
  }

  /** Re-render one frame at a higher pixel ratio (PNG export), then restore. */
  private renderScaled(scale: number, done: () => void): void {
    const { width: w, height: h, pixelRatio: pr } = this;
    const maxSize = this.renderer.capabilities.maxTextureSize;
    const s = clamp(pr * scale, 0.5, maxSize / Math.max(w, h));
    this.applySize(w, h, s);
    this.renderFrame(0);
    done();
    this.applySize(w, h, pr);
    this.renderFrame(0);
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.hud.canvas.style.display = this.hud.enabled && this.hudVisible ? '' : 'none';
  }

  private toggleHelp(): void {
    if (this.helpEl) {
      this.helpEl.remove();
      this.helpEl = null;
      return;
    }
    const el = document.createElement('div');
    el.className = 'help-overlay';
    const rows = Object.entries(this.keys)
      .map(([k, [d]]) => `<tr><td><kbd>${k === ' ' ? 'Space' : k.toUpperCase()}</kbd></td><td>${d}</td></tr>`)
      .join('');
    el.innerHTML = `<h2>Hotkeys</h2><table>${rows}</table>
      <p>URL params: <code>?bg=transparent</code> <code>?hud=0</code> <code>?speed=0.5</code> <code>?quality=low|high</code> <code>?t=12</code></p>`;
    el.addEventListener('click', () => this.toggleHelp());
    document.body.appendChild(el);
    this.helpEl = el;
  }

  private renderFrame(dt: number): void {
    this.update(dt, this.time);
    this.post.render(this.time);
    if (this.hud.enabled && this.hudVisible) {
      this.hud.begin();
      this.drawHud(this.hud);
    }
    this.capture.afterFrame();
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const real = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const dt = this.paused ? 0 : real * this.speed;
    this.time += dt;
    this.hud.clock += real;
    this.hud.frameCount++;
    this.renderFrame(dt);
  };

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }
}

/** Resolve a file in /public relative to the page (works under any deploy sub-path). */
export function assetUrl(path: string): string {
  return new URL(path.replace(/^\//, ''), document.baseURI).href;
}
