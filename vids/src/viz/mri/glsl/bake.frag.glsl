// Bakes one Z layer of the brain volume into an RGBA8 3D render target:
//   R = white matter, G = grey matter, B = CSF, A = tumour field.
// With uReal = 1 the tissue classes are estimated from a loaded NIfTI T1 instead.
precision highp sampler3D;
uniform float uZ;          // layer centre in [-1,1]
uniform float uReal;
uniform sampler3D uRaw;    // normalised T1 (only when uReal = 1)
uniform vec3 uRawScale;    // cube → raw texture coordinates
uniform vec3 uRawFlip;
varying vec2 vUv;

void main() {
  vec3 p = vec3(vUv * 2.0 - 1.0, uZ);
  vec3 t;
  float brain;
  if (uReal > 0.5) {
    vec3 uvw = (p * uRawFlip) * uRawScale * 0.5 + 0.5;
    float I = (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) ? texture(uRaw, uvw).r : 0.0;
    float mask = 1.0 - smoothstep(-0.02, 0.06, sdBrainHull(p) - 0.04);
    t = vec3(smoothstep(0.62, 0.78, I), smoothstep(0.32, 0.45, I) * (1.0 - smoothstep(0.62, 0.78, I)), (1.0 - smoothstep(0.12, 0.28, I))) * mask;
    brain = mask;
  } else {
    t = brainTissue(p);
    brain = clamp(t.x + t.y + t.z * 0.3, 0.0, 1.0);
  }
  float T = tumorField(p, smoothstep(0.2, 0.6, t.x + t.y), t.x);
  gl_FragColor = vec4(t, T);
}
