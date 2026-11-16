// Retrieval particles: each one rides a quadratic Bézier from the query image,
// through the embedding plot, to one of the three similar cases.
attribute float aTarget; // 0, 1, 2
attribute float aPhase;
attribute float aSeed;
uniform vec2 uFrom;
uniform vec2 uVia;
uniform vec2 uTo[3];
uniform float uTime;
uniform float uFlow;     // 0..1 global intensity
uniform float uSpread;   // px
uniform float uPixelRatio;
uniform float uSize;
varying float vAlpha;
varying float vHead;

void main() {
  int k = int(aTarget + 0.5);
  vec2 to = k == 0 ? uTo[0] : (k == 1 ? uTo[1] : uTo[2]);
  float t = fract(aPhase + uTime * (0.32 + 0.18 * aSeed));
  vec2 ctrl = mix(uVia, (uFrom + to) * 0.5, 0.35);
  vec2 p = mix(mix(uFrom, ctrl, t), mix(ctrl, to, t), t);
  // perpendicular wobble, widest mid-flight
  vec2 tan = normalize(mix(ctrl - uFrom, to - ctrl, t) + 1e-4);
  vec2 nrm = vec2(-tan.y, tan.x);
  float w = sin(t * 3.14159);
  p += nrm * (aSeed - 0.5) * uSpread * w + nrm * sin(uTime * 3.0 + aSeed * 40.0) * 3.0 * w;
  vAlpha = uFlow * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.88, 1.0, t)) * (0.4 + 0.6 * fract(aSeed * 7.3));
  vHead = step(0.93, fract(aSeed * 13.1));
  gl_PointSize = uSize * uPixelRatio * (0.7 + 0.8 * fract(aSeed * 3.7)) * (1.0 + vHead);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}
