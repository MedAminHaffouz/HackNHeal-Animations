/**
 * Design tokens — the single source of truth for colour + type.
 * `applyTokens()` mirrors them into CSS custom properties on :root so the
 * DOM (gallery, overlays) and WebGL/Canvas code read the very same values.
 */
export const colors = {
  bg: '#05070d',
  bgElevated: '#0a0f1c',
  panel: 'rgba(8, 16, 30, 0.55)',
  line: 'rgba(0, 229, 255, 0.28)',
  cyan: '#00e5ff',
  magenta: '#ff2bd6',
  amber: '#ffb300',
  // secondary hues, kept inside the cyan→magenta family so the palette stays coherent
  violet: '#8a6bff',
  mint: '#3dffb5',
  blue: '#3d7bff',
  red: '#ff3b5c',
  text: '#d6f7ff',
  textDim: 'rgba(214, 247, 255, 0.55)',
  textFaint: 'rgba(214, 247, 255, 0.28)',
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  display: '"Space Grotesk", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

/**
 * Nucleotide colours (DNA viz). Amber is deliberately NOT used here: it is
 * reserved for alerts (variant calls), so a flagged base always pops.
 */
export const baseColors = {
  A: colors.cyan,
  T: colors.violet,
  G: colors.mint,
  C: colors.magenta,
} as const;

/** CPK-ish element colours adapted to the palette (protein viz). */
export const elementColors: Record<string, string> = {
  C: '#cfe9ff',
  N: colors.blue,
  O: colors.magenta,
  S: colors.amber,
  P: colors.amber,
  H: '#ffffff',
};

/** Write all tokens as CSS variables (`--c-cyan`, `--f-mono`, …) on :root. */
export function applyTokens(root: HTMLElement = document.documentElement): void {
  const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  for (const [k, v] of Object.entries(colors)) root.style.setProperty(`--c-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(fonts)) root.style.setProperty(`--f-${kebab(k)}`, v);
}

/** '#rrggbb' → 'rgba(r,g,b,a)' for Canvas2D strokes/fills. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
