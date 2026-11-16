// Dotted van-der-Waals surface (classic "dot surface" look).
// Pocket-lining dots light up when the ligand is bound.
attribute vec3 aDisp;
attribute float aPocket;
uniform float uDisp;
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform float uPocketGlow;
uniform vec3 uColor;
uniform vec3 uPocketColor;
uniform vec2 uFog;
varying vec3 vCol;
varying float vA;

void main() {
  vec3 p = position + aDisp * uDisp;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float wave = 0.5 + 0.5 * sin(uTime * 5.0 - length(p) * 0.6);
  float pg = aPocket * uPocketGlow;
  gl_PointSize = uSize * uPixelRatio * (40.0 / dist) * (1.0 + pg * 0.6);
  float fog = smoothstep(uFog.x, uFog.y, dist);
  vA = mix(0.16, 0.55 + 0.45 * wave, pg) * (1.0 - fog * 0.85);
  vCol = mix(uColor, uPocketColor * (1.4 + 1.6 * wave), pg);
  gl_Position = projectionMatrix * mv;
}
