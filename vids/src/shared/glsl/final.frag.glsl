// Final grade: chromatic aberration, film grain, vignette, faint scanlines.
// Runs after OutputPass, i.e. in display (sRGB) space.
uniform sampler2D tDiffuse;
uniform vec2 uResolution;   // render target size in px
uniform float uTime;
uniform float uGrain;       // 0..~0.1
uniform float uAberration;  // px at the corners
uniform float uVignette;    // 0..1
uniform float uScanlines;   // 0..1
uniform float uTransparent; // 1 → ?bg=transparent
uniform sampler2D tScene;   // pre-bloom scene (its alpha = true coverage)
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // radial chromatic aberration, stronger toward the corners
  vec2 off = c * r2 * (uAberration / max(uResolution.x, 1.0)) * 4.0;
  vec4 base = texture2D(tDiffuse, uv);
  float rC = texture2D(tDiffuse, uv + off).r;
  float bC = texture2D(tDiffuse, uv - off).b;
  vec3 col = vec3(rC, base.g, bC);

  // vignette
  col *= mix(1.0, smoothstep(0.85, 0.15, r2 * 1.6), uVignette);

  // scanlines (very faint — reads as "display", not as an effect)
  float sl = 0.5 + 0.5 * sin(uv.y * uResolution.y * 1.5708);
  col *= 1.0 - uScanlines * 0.08 * sl;

  // animated film grain (luma-weighted so blacks stay black)
  float g = hash12(uv * uResolution + fract(uTime * 7.31) * 913.0) - 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.5, luma));

  float a = 1.0;
  if (uTransparent > 0.5) {
    // Solid geometry keeps its coverage alpha; glows/bloom outside it are
    // "unmultiplied" (alpha = brightest channel). Output stays premultiplied.
    col = clamp(col, 0.0, 1.0);
    float cover = clamp(texture2D(tScene, uv).a, 0.0, 1.0);
    a = max(cover, max(max(col.r, col.g), col.b));
  }
  gl_FragColor = vec4(max(col, 0.0), a);
}
