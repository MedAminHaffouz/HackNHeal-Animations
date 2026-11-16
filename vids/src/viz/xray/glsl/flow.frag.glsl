uniform vec3 uColor;
uniform vec3 uHeadColor;
varying float vAlpha;
varying float vHead;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float a = smoothstep(1.0, 0.0, r);
  a *= a * vAlpha;
  if (a < 0.003) discard;
  vec3 c = mix(uColor, uHeadColor, vHead) * (1.4 + vHead);
  gl_FragColor = vec4(c * a, a);
}
