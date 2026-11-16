// Radiograph panel: film/CRT look, dissolve-in, scan line, Grad-CAM overlay.
uniform sampler2D tImage;
uniform float uTime;
uniform float uReveal;   // 0..1 dissolve-in
uniform float uScan;     // scan line progress 0..1 (top→bottom); <0 = off
uniform float uHeat;     // heatmap opacity 0..1
uniform vec4 uBlobs[4];  // (x, y, radius, weight) in uv, y down
uniform float uBlobCount;
uniform float uGlow;     // frame highlight (similar panels on arrival)
uniform vec2 uRes;       // panel size in px
uniform float uDim;      // 0..1 darken (inactive)
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

// palette-constrained "inferno": transparent → magenta → amber → near white
vec3 heatColor(float h) {
  vec3 a = vec3(0.35, 0.02, 0.45);
  vec3 b = vec3(1.0, 0.17, 0.84);
  vec3 c = vec3(1.0, 0.70, 0.0);
  vec3 d = vec3(1.0, 0.97, 0.8);
  return h < 0.4 ? mix(a, b, h / 0.4) : h < 0.75 ? mix(b, c, (h - 0.4) / 0.35) : mix(c, d, (h - 0.75) / 0.25);
}

void main() {
  vec2 uv = vUv;
  vec2 iuv = vec2(uv.x, 1.0 - uv.y); // image space, y down
  // tiny horizontal jitter while dissolving in (signal locking)
  float lock = 1.0 - uReveal;
  iuv.x += (hash12(vec2(floor(iuv.y * 90.0), floor(uTime * 24.0))) - 0.5) * 0.02 * lock * lock;

  // textures are uploaded with flipY, so sample in GL space (y up)
  float g = texture2D(tImage, vec2(iuv.x, 1.0 - iuv.y)).r;
  vec3 col = vec3(g) * vec3(0.93, 0.98, 1.0) * 0.78;

  // scan: already-scanned area slightly cool-tinted, bright line + trailing glow
  if (uScan >= 0.0 && uScan <= 1.0) {
    float dy = iuv.y - uScan;
    float line = exp(-dy * dy * 40000.0);
    float trail = dy < 0.0 ? exp(dy * 18.0) : 0.0;
    col += vec3(0.0, 0.9, 1.0) * (line * 1.8 + trail * 0.12);
    col = mix(col, col * vec3(0.85, 1.0, 1.05), step(dy, 0.0) * 0.5);
  }

  // Grad-CAM style heatmap with soft iso-contours
  if (uHeat > 0.0) {
    float h = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uBlobCount) break;
      vec4 b = uBlobs[i];
      vec2 d = (iuv - b.xy) / b.z;
      h += b.w * exp(-dot(d, d) * 1.6);
    }
    h *= 0.8 + 0.4 * vnoise(iuv * 9.0 + uTime * 0.15);
    h = clamp(h, 0.0, 1.0);
    float a = smoothstep(0.12, 0.85, h) * 0.62 * uHeat;
    col = mix(col, heatColor(h) * (0.9 + 0.25 * h), a);
    float iso = 1.0 - smoothstep(0.0, 0.05, abs(fract(h * 5.0) - 0.5) - 0.44);
    col += heatColor(h) * iso * smoothstep(0.15, 0.4, h) * 0.25 * uHeat;
  }

  // film / CRT finish: faint scanlines, vignette, grain
  col *= 0.94 + 0.06 * sin(uv.y * uRes.y * 1.4);
  vec2 c = uv - 0.5;
  col *= smoothstep(0.8, 0.25, length(c * vec2(1.0, 1.1)));
  col += (hash12(uv * uRes + fract(uTime) * 300.0) - 0.5) * 0.03;
  col *= 1.0 - uDim * 0.7;

  // dissolve-in with a cyan burn edge
  float n = vnoise(uv * uRes / 14.0) * 0.7 + hash12(floor(uv * uRes / 3.0)) * 0.3;
  float vis = step(n, uReveal);
  float edge = smoothstep(uReveal - 0.06, uReveal, n) * vis * step(0.001, uReveal) * (1.0 - step(0.999, uReveal));
  col = col * vis + vec3(0.2, 1.0, 1.0) * edge * 1.6;

  // frame glow on arrival
  vec2 e = min(uv, 1.0 - uv) * uRes;
  float border = 1.0 - smoothstep(0.0, 3.0, min(e.x, e.y));
  col += vec3(0.0, 0.9, 1.0) * border * uGlow * 1.5;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
