varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = smoothstep(1.0, 0.3, length(c)) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, a);
}
