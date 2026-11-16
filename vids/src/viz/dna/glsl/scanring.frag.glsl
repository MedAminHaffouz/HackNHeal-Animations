// Read-head "light sheet": a thin translucent disc around the helix with a
// bright rim, rotating tick marks and a soft radial falloff.
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);

  float rim = smoothstep(0.90, 0.985, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float inner = smoothstep(0.66, 0.68, r) * (1.0 - smoothstep(0.68, 0.70, r));
  // 72 rotating ticks between the rings
  float ticks = step(0.5, fract((ang + uTime * 0.6) / 6.2831 * 72.0)) * smoothstep(0.80, 0.82, r) * (1.0 - smoothstep(0.86, 0.88, r));
  // sweeping wedge
  float wedge = pow(max(0.0, cos(ang - uTime * 2.2)), 18.0) * smoothstep(0.55, 0.95, r) * 0.45;
  float sheet = 0.025 * (1.0 - r);

  float a = rim * 1.0 + inner * 0.45 + ticks * 0.35 + wedge + sheet;
  gl_FragColor = vec4(uColor * a * 1.3 * uOpacity, a * uOpacity);
}
