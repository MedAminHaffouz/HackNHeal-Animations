/**
 * URL parameter parser shared by every visual.
 *
 *   ?bg=transparent      transparent canvas (for compositing / OBS / iframes)
 *   ?hud=0               clean render, no overlay text
 *   ?speed=0.5           global time scale
 *   ?quality=low|high    GPU budget (default: high)
 *   ?motion=full|reduced force or ignore prefers-reduced-motion
 *   ?t=12                start the timeline at t seconds (handy for stills)
 *
 * Each visual may read extra params through `params.get(name)`.
 */
export type Quality = 'low' | 'high';

export interface VizParams {
  transparent: boolean;
  hud: boolean;
  speed: number;
  quality: Quality;
  reducedMotion: boolean;
  startTime: number;
  /** Raw access for visual-specific options. */
  get(name: string): string | null;
}

function num(v: string | null, fallback: number, min: number, max: number): number {
  const n = v === null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function parseParams(search: string = window.location.search): VizParams {
  const q = new URLSearchParams(search);
  const motion = q.get('motion');
  const prefersReduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reducedMotion = motion === 'reduced' || (motion !== 'full' && prefersReduced);
  const hud = q.get('hud');
  return {
    transparent: q.get('bg') === 'transparent',
    hud: !(hud === '0' || hud === 'false' || hud === 'off'),
    speed: num(q.get('speed'), 1, 0, 10),
    quality: q.get('quality') === 'low' ? 'low' : 'high',
    reducedMotion,
    startTime: num(q.get('t'), 0, 0, 1e6),
    get: (name) => q.get(name),
  };
}
