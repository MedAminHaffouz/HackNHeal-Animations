// 2D MRI slice sampled from the same volume, with a T1 / T2 contrast model,
// analytic scalp + skull, static Rician-like noise, and (lesion panel only)
// a glowing segmentation overlay.
precision highp sampler3D;
uniform sampler3D uVol;
uniform sampler3D uRaw;
uniform float uReal;
uniform vec3 uRawScale;
uniform vec3 uRawFlip;
uniform float uAxis;
uniform float uPos;
uniform float uSeq;      // T1 → T2 wipe progress: 0 = all T1, 1 = all T2 (top-down)
uniform float uTumor;
uniform float uPulse;
uniform float uReveal;   // 0..1 segmentation overlay strength
uniform float uTime;
uniform float uFade;     // brief fade when the plane changes
uniform vec2 uRes;       // quad size in px (for the noise grain)
uniform vec3 cSeg;
uniform vec3 cEdema;
varying vec2 vUv;

vec3 slicePoint(vec2 uv) {
  // radiological convention: patient right on image left
  if (uAxis < 0.5) return vec3(1.0 - 2.0 * uv.x, uv.y * 2.0 - 1.0, uPos);  // axial: anterior up
  if (uAxis < 1.5) return vec3(uPos, 1.0 - 2.0 * uv.x, uv.y * 2.0 - 1.0);  // sagittal: anterior left
  return vec3(1.0 - 2.0 * uv.x, uPos, uv.y * 2.0 - 1.0);                    // coronal
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 p = slicePoint(vUv);
  vec4 v = texture(uVol, p * 0.5 + 0.5);
  float wm = v.r, gm = v.g, csf = v.b;
  float T = v.a * uTumor;

  // head: smooth ellipsoid shell (scalp, fat, skull with diploë), independent of brain lobes
  float dh = sdBrainHull(p);
  float dHead = sdEllipsoid(p - vec3(0.0, -0.03, 0.08), vec3(0.80, 0.98, 0.74)) + 0.006 * snoise(p * 6.0);
  float inHead = 1.0 - smoothstep(-0.003, 0.003, dHead);
  float scalp = inHead * smoothstep(-0.062, -0.056, dHead);
  float fat = inHead * smoothstep(-0.05, -0.044, dHead) * (1.0 - smoothstep(-0.012, -0.006, dHead));
  float bone = (1.0 - smoothstep(-0.062, -0.056, dHead)) * smoothstep(-0.112, -0.106, dHead);
  float diploe = smoothstep(-0.094, -0.088, dHead) * (1.0 - smoothstep(-0.078, -0.072, dHead));
  float intra = 1.0 - smoothstep(-0.112, -0.106, dHead);   // inside the skull
  // non-brain intracranial space: thin CSF next to the brain, skull-base soft tissue further away
  float near = 1.0 - smoothstep(0.015, 0.05, dh);
  float brainSum = clamp(wm + gm + csf, 0.0, 1.0);
  float extra = 1.0 - brainSum;

  // T1: WM bright, GM mid, CSF dark, fat bright.  T2: CSF bright, WM dark.
  float other1 = intra * mix(0.30, 0.07, near) + bone * mix(0.03, 0.42, diploe) + scalp * mix(0.36, 0.92, fat);
  float other2 = intra * mix(0.28, 0.95, near) + bone * mix(0.03, 0.35, diploe) + scalp * mix(0.24, 0.62, fat);
  float t1 = wm * 0.80 + gm * 0.50 + csf * 0.07 + extra * other1;
  float t2 = wm * 0.30 + gm * 0.50 + csf * 0.95 + extra * other2;
  if (uReal > 0.5) {
    vec3 uvw = (p * uRawFlip) * uRawScale * 0.5 + 0.5;
    float I = (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) ? texture(uRaw, uvw).r : 0.0;
    t1 = I * 0.95;
    t2 = I > 0.02 ? clamp(1.05 - I * 1.1 + wm * 0.1, 0.0, 1.0) * smoothstep(0.02, 0.08, I) : 0.0; // synthetic contrast
  }

  // lesion contrast
  float nec = smoothstep(0.78, 0.81, T);
  float rim = smoothstep(0.53, 0.56, T) * (1.0 - nec);
  float ede = smoothstep(0.03, 0.12, T) * (1.0 - rim - nec);
  t1 = mix(t1, 0.40, ede * 0.8); t1 = mix(t1, 0.97, rim); t1 = mix(t1, 0.20, nec);
  t2 = mix(t2, 0.86, ede * 0.9); t2 = mix(t2, 0.62, rim); t2 = mix(t2, 0.93, nec);

  // sequence change as a top-down acquisition wipe (a cross-fade would wash out contrast)
  float wy = 1.0 - vUv.y;
  float I = wy < uSeq ? t2 : t1;
  float wipeEdge = (uSeq > 0.001 && uSeq < 0.999) ? 1.0 - smoothstep(0.0, 0.006, abs(wy - uSeq)) : 0.0;
  // smooth bias field + static grain (MR noise is per-acquisition, not per-frame)
  I *= 0.94 + 0.08 * snoise(p * 1.3);
  vec2 px = floor(vUv * uRes);
  float n = hash12(px) - 0.5;
  I = abs(I + n * 0.035 * (0.35 + I));
  I = clamp(I, 0.0, 1.0) * 0.74;
  vec3 col = vec3(I) * vec3(0.96, 0.99, 1.0) + vec3(0.6, 1.0, 1.0) * wipeEdge * 1.6;

  // segmentation overlay (lesion panel)
  if (uTumor > 0.5 && uReveal > 0.0) {
    float fw = fwidth(T) * 1.4 + 1e-4;
    float coreLine = 1.0 - smoothstep(0.0, fw, abs(T - 0.545));
    float edemaLine = 1.0 - smoothstep(0.0, fw, abs(T - 0.06));
    vec2 sp = vUv * uRes;
    float dash = step(0.5, fract((sp.x + sp.y) * 0.08 - uTime * 1.5));
    float coreFill = smoothstep(0.53, 0.56, T);
    float edemaFill = smoothstep(0.04, 0.10, T) * (1.0 - coreFill);
    col = mix(col, col * 0.6 + cSeg * 0.35, coreFill * uReveal * (0.45 + 0.35 * uPulse));
    col += cEdema * edemaFill * 0.10 * uReveal;
    col += cSeg * coreLine * 2.4 * uReveal;
    col += cEdema * edemaLine * dash * 1.4 * uReveal;
  }
  gl_FragColor = vec4(col * uFade, 1.0);
}
