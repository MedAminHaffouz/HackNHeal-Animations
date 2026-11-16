// Floating dust / plankton points with a fake depth-of-field:
// points far from the focus distance grow and fade like bokeh discs.
attribute float aSeed;
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform float uFocus;     // focus distance (view space)
uniform float uAperture;  // how quickly blur grows away from focus
uniform float uDrift;
varying float vAlpha;
varying float vBlur;

void main() {
  vec3 p = position;
  float s = aSeed * 6.2831;
  p += uDrift * vec3(sin(uTime * 0.11 + s), cos(uTime * 0.07 + s * 1.7), sin(uTime * 0.09 + s * 2.3));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.1);
  float coc = abs(dist - uFocus) * uAperture;
  float size = uSize * (0.6 + fract(aSeed * 13.7)) * (1.0 + coc * 2.5);
  gl_PointSize = min(size * uPixelRatio * (20.0 / dist), 96.0 * uPixelRatio);
  float twinkle = 0.7 + 0.3 * sin(uTime * (0.6 + fract(aSeed * 7.0)) + s);
  vAlpha = twinkle * (0.35 + 0.65 * fract(aSeed * 3.1)) / (1.0 + coc * coc * 4.0);
  vBlur = clamp(coc, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}
