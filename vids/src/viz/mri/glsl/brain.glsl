// Procedural brain anatomy. Coordinates are RAS (+x right, +y anterior,
// +z superior) in a cube [-1,1]^3 that spans 200 mm (1 unit = 100 mm).
// Requires noise.glsl.

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Cerebral hemispheres (smooth hull, no folds)
float sdCerebrum(vec3 p) {
  vec3 q = p - vec3(0.0, -0.03, 0.10);
  q.x *= 1.0 + 0.14 * smoothstep(0.0, 0.85, q.y);   // frontal poles narrower
  q.x *= 1.0 + 0.08 * smoothstep(-0.4, -0.9, q.y);  // occipital poles narrower
  float d = sdEllipsoid(q, vec3(0.67, 0.85, 0.60));
  d = smax(d, -(q.z + 0.34), 0.10);                  // basal surface
  // temporal lobes hang lower, lateral and anterior
  vec3 tq = vec3(abs(p.x), p.y, p.z) - vec3(0.46, 0.06, -0.24);
  d = smin(d, sdEllipsoid(tq, vec3(0.19, 0.36, 0.16)), 0.09);
  // interhemispheric fissure: gap above the corpus callosum, full depth in front/behind it
  float zb = mix(0.21, -0.40, smoothstep(0.30, 0.48, abs(p.y + 0.03)));
  float carve = max(abs(p.x) - 0.009 - 0.004 * smoothstep(0.3, 0.7, p.z), zb - p.z);
  d = smax(d, -carve, 0.012);
  return d;
}

float sdCerebellum(vec3 p) {
  vec3 q = p - vec3(0.0, -0.57, -0.40);
  float d = sdEllipsoid(q, vec3(0.45, 0.25, 0.19));
  // shallow vermis notch at the posterior midline
  d = smax(d, -sdEllipsoid(q - vec3(0.0, -0.24, 0.02), vec3(0.04, 0.08, 0.2)), 0.03);
  return d;
}

float sdBrainstem(vec3 p) {
  float d = sdCapsule(p, vec3(0.0, -0.20, -0.12), vec3(0.0, -0.33, -1.05), 0.095);
  d = smin(d, sdEllipsoid(p - vec3(0.0, -0.20, -0.36), vec3(0.13, 0.12, 0.12)), 0.05); // pons
  return d;
}

float sdBrainHull(vec3 p) {
  return smin(smin(sdCerebrum(p), sdCerebellum(p), 0.04), sdBrainstem(p), 0.04);
}

// Lateral ventricles (butterfly in axial slices), 3rd ventricle, temporal horns
float sdVentricles(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 b = q - vec3(0.085, -0.02, 0.15);
  b.z += 0.42 * b.y * b.y;                          // C-shaped body
  b.x -= 0.06 * smoothstep(0.0, -0.4, b.y);          // atria splay laterally
  float rx = 0.032 + 0.035 * smoothstep(-0.05, -0.38, b.y) + 0.012 * smoothstep(0.1, 0.32, b.y);
  float d = sdEllipsoid(b, vec3(rx, 0.38, 0.05 + 0.02 * smoothstep(0.0, -0.35, b.y)));
  // temporal horns
  d = min(d, sdEllipsoid(q - vec3(0.36, -0.02, -0.17), vec3(0.025, 0.15, 0.022)));
  // 3rd ventricle (thin midline slit)
  d = min(d, sdEllipsoid(p - vec3(0.0, -0.06, -0.03), vec3(0.012, 0.13, 0.09)));
  return d;
}

// Deep grey nuclei: thalami, caudate heads, putamina
float sdDeepGM(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float d = sdEllipsoid(q - vec3(0.09, -0.11, 0.0), vec3(0.075, 0.13, 0.075));
  d = min(d, sdEllipsoid(q - vec3(0.15, 0.20, 0.11), vec3(0.045, 0.12, 0.07)));
  d = min(d, sdEllipsoid(q - vec3(0.25, 0.05, 0.02), vec3(0.045, 0.16, 0.085)));
  return d;
}

// Tissue fractions: x = white matter, y = grey matter, z = CSF
vec3 brainTissue(vec3 p) {
  float dC = sdCerebrum(p);
  float dB = sdCerebellum(p);
  float dS = sdBrainstem(p);
  float wm = 0.0, gm = 0.0, csf = 0.0;

  if (dC < 0.01 && dC < dB) {
    float g = -dC;
    vec3 w = p + 0.05 * vec3(snoise(p * 2.7), snoise(p * 2.7 + 11.3), snoise(p * 2.7 + 23.1));
    float n1 = 1.0 - abs(snoise(w * 4.6));
    float n2 = 1.0 - abs(snoise(w * 8.4 + 5.0));
    float fold = 0.12 * smoothstep(0.55, 0.97, n1) + 0.055 * smoothstep(0.72, 0.97, n2);
    float crev = max(smoothstep(0.915, 0.965, n1), smoothstep(0.93, 0.975, n2) * 0.9);
    float inside = smoothstep(0.004, -0.004, dC);
    float sulc = crev * (1.0 - smoothstep(fold - 0.012, fold + 0.004, g));
    float th = 0.028;
    float gmBand = 1.0 - smoothstep(fold + th - 0.007, fold + th + 0.007, g);
    gm = inside * gmBand * (1.0 - sulc);
    csf = inside * sulc;
    wm = inside * (1.0 - gmBand) * (1.0 - sulc);
    // deep structures
    float v = smoothstep(0.006, -0.006, sdVentricles(p)) * inside;
    float dg = smoothstep(0.012, -0.012, sdDeepGM(p)) * inside * 0.85;
    gm = max(gm * (1.0 - v), dg * (1.0 - v));
    wm *= (1.0 - v) * (1.0 - dg);
    csf = max(csf, v);
  } else if (dB < 0.01) {
    // cerebellum: thin folia (parallel GM leaves) around a WM "arbor vitae"
    float g = -dB;
    float inside = smoothstep(0.004, -0.004, dB);
    float fol = 0.5 + 0.5 * sin((p.z * 1.0 - p.y * 0.55) * 135.0 + snoise(p * 7.0) * 4.0);
    float arbor = smoothstep(0.05, 0.11, g + 0.04 * snoise(p * 11.0));
    csf = inside * smoothstep(0.86, 0.97, fol) * (1.0 - arbor);
    wm = inside * arbor * 0.9;
    gm = inside * (1.0 - csf) * (1.0 - wm);
  }
  if (dS < 0.0 && dS < dC) {
    float inside = smoothstep(0.004, -0.004, dS);
    wm = max(wm, inside * 0.75);
    gm = max(gm * (1.0 - inside), inside * 0.25);
    csf *= 1.0 - inside;
  }
  return vec3(wm, gm, csf);
}

// Synthetic glioma: irregular enhancing mass, necrotic core, WM-tracking edema.
// Returns T in [0,1]: >0.795 necrosis, 0.545..0.795 enhancing rim, 0.03..0.545 edema.
uniform vec3 uTumorC;
uniform float uTumorR;
float tumorField(vec3 p, float brain, float wm) {
  vec3 d = p - uTumorC;
  float r = length(d);
  vec3 dir = d / max(r, 1e-4);
  float irr = 1.0 + 0.28 * snoise(dir * 1.7 + 3.7) + 0.10 * snoise(p * 9.0);
  float q = r / (uTumorR * irr);
  float T = clamp(1.0 - q / 2.2, 0.0, 1.0);
  float edemaZone = 1.0 - smoothstep(0.50, 0.56, T);
  T *= mix(1.0, mix(0.35, 1.0, wm), edemaZone);
  return T * brain;
}
