// Background plate: soft radial haze + a very faint hexagonal grid.
// Gives depth behind the 3D subject without competing with it.
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uTime;
uniform float uGrid;   // grid visibility 0..1
uniform float uAspect;
varying vec2 vUv;

float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

vec4 hexCoords(vec2 uv) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  vec3 col = uColor * 0.035 * smoothstep(0.9, 0.0, r) + vec3(0.004, 0.008, 0.02) * smoothstep(1.0, 0.2, r);
  col += uColor2 * 0.025 * smoothstep(0.7, 0.0, length(p - vec2(0.35, -0.2)));

  vec4 h = hexCoords(p * 26.0);
  float edge = smoothstep(0.47, 0.5, hexDist(h.xy));
  float pulse = 0.5 + 0.5 * sin(h.z * 0.4 + h.w * 0.3 - uTime * 0.5);
  col += uColor * edge * uGrid * 0.022 * (0.4 + 0.6 * pulse) * smoothstep(0.75, 0.1, r);
  gl_FragColor = vec4(col, 1.0);
}
