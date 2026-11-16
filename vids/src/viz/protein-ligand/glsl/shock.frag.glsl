// Expanding ring "shockwave" billboard fired when the ligand locks in.
uniform float uProgress; // 0..1
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  if (uProgress <= 0.0) discard;
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.80, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float inner = smoothstep(0.55, 0.6, r) * (1.0 - smoothstep(0.6, 0.63, r)) * 0.4;
  float fade = 1.0 - uProgress;
  float a = (ring + inner) * fade * fade;
  gl_FragColor = vec4(uColor * a * 2.5, a);
}
