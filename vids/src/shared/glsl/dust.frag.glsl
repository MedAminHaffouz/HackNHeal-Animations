uniform vec3 uColor;
varying float vAlpha;
varying float vBlur;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  // sharp core when in focus, flat bokeh disc with a brighter rim when blurred
  float core = smoothstep(1.0, 0.0, r);
  core *= core;
  float disc = smoothstep(1.0, 0.85, r) * (0.55 + 0.45 * smoothstep(0.5, 0.95, r));
  float a = mix(core, disc * 0.6, vBlur) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}
