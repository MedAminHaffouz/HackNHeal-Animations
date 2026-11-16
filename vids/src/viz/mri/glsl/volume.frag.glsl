// Holographic volume rendering of the baked brain (emission–absorption raymarch)
// with the sweeping slice plane drawn at its true depth.
precision highp sampler3D;
uniform sampler3D uVol;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanFov;
uniform float uAspect;
uniform float uTime;
uniform float uTumor;     // 0 = healthy panel, 1 = lesion panel
uniform float uPulse;     // 0..1 tumour pulse
uniform float uAxis;      // 0 axial (z), 1 sagittal (x), 2 coronal (y)
uniform float uPos;       // slice position in [-1,1]
uniform float uDensity;
uniform float uVoxel;     // 1 / volume resolution (gradient step)
uniform vec3 cCortex;
uniform vec3 cWM;
uniform vec3 cCSF;
uniform vec3 cTumor;
uniform vec3 cEdema;
uniform vec3 cPlane;
varying vec2 vUv;

#ifndef STEPS
#define STEPS 128
#endif

float axisOf(vec3 p) { return uAxis < 0.5 ? p.z : (uAxis < 1.5 ? p.x : p.y); }
vec2 otherOf(vec3 p) { return uAxis < 0.5 ? p.xy : (uAxis < 1.5 ? p.yz : p.xz); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + ndc.x * uTanFov * uAspect * uCamRight + ndc.y * uTanFov * uCamUp);
  vec3 ro = uCamPos;
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-1.0 - ro) * inv;
  vec3 t1 = (1.0 - ro) * inv;
  vec3 tmn = min(t0, t1);
  vec3 tmx = max(t0, t1);
  float tn = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);
  float tf = min(min(tmx.x, tmx.y), tmx.z);
  if (tf <= tn) discard;

  float stepLen = 3.4641 / float(STEPS);
  float t = tn + hash12(gl_FragCoord.xy + fract(uTime) * 61.0) * stepLen;
  vec3 acc = vec3(0.0);
  float trans = 1.0;

  // slice plane intersection
  float ra = axisOf(rd);
  float tp = abs(ra) > 1e-4 ? (uPos - axisOf(ro)) / ra : -1.0;
  bool planeDone = !(tp > tn && tp < tf);

  bool surfaceDone = false;
  float interior = 1.0;
  for (int i = 0; i < STEPS; i++) {
    if (t > tf || trans < 0.02) break;
    if (!planeDone && t > tp) {
      planeDone = true;
      vec2 o = otherOf(ro + rd * tp);
      float e = max(abs(o.x), abs(o.y));
      float edge = smoothstep(0.972, 0.992, e);
      vec2 gl = abs(fract(o * 5.0) - 0.5);
      float grid = (1.0 - smoothstep(0.0, 0.03, min(gl.x, gl.y))) * 0.25;
      acc += trans * cPlane * (0.05 + grid * 0.12 + edge * 1.6);
      trans *= 1.0 - 0.06 - edge * 0.5;
    }
    vec3 p = ro + rd * t;
    vec4 v = texture(uVol, p * 0.5 + 0.5);
    float wm = v.r, gm = v.g, csf = v.b;
    float T = v.a * uTumor;
    float core = smoothstep(0.52, 0.60, T);
    float ede = smoothstep(0.04, 0.22, T) * (1.0 - core);
    float slab = 1.0 - smoothstep(0.0, 0.014, abs(axisOf(p) - uPos));

    // first hit on the cortical surface: shade it like glass so gyri/sulci read
    if (!surfaceDone && gm + wm > 0.42) {
      surfaceDone = true;
      vec3 uvw = p * 0.5 + 0.5;
      float e = uVoxel * 1.5;
      vec3 g = vec3(
        dot(texture(uVol, uvw + vec3(e, 0.0, 0.0)).rg - texture(uVol, uvw - vec3(e, 0.0, 0.0)).rg, vec2(1.0)),
        dot(texture(uVol, uvw + vec3(0.0, e, 0.0)).rg - texture(uVol, uvw - vec3(0.0, e, 0.0)).rg, vec2(1.0)),
        dot(texture(uVol, uvw + vec3(0.0, 0.0, e)).rg - texture(uVol, uvw - vec3(0.0, 0.0, e)).rg, vec2(1.0)));
      vec3 n = -normalize(g + 1e-5);
      float ndv = abs(dot(n, -rd));
      float rim = pow(1.0 - ndv, 2.2);
      float diff = max(dot(n, normalize(vec3(0.4, -0.5, 0.75))), 0.0);
      float cavity = smoothstep(0.1, 0.5, csf + (1.0 - gm - wm));  // sulcal crevices darken
      vec3 sc = cCortex * (0.18 + 0.55 * diff) * (1.0 - 0.6 * cavity) + mix(cCortex, vec3(0.8, 1.0, 1.0), 0.4) * rim * 1.3;
      float sa = 0.30 + 0.55 * rim;
      acc += trans * sa * sc;
      trans *= 1.0 - sa;
      interior = 0.35; // inner tissue becomes fainter so ventricles/lesion show through
    }
    float dens = (gm * 1.5 + wm * 0.22) * interior + csf * 0.35 + core * 4.0 + ede * 0.5 + slab * (gm + wm) * 3.0;
    if (dens > 0.001) {
      vec3 emis = (cCortex * gm * 1.5 + cWM * wm * 0.22) * interior + cCSF * csf * 0.35
                + cTumor * core * 4.0 * (1.6 + 1.4 * uPulse) + cEdema * ede * 0.5
                + cPlane * slab * (gm * 2.4 + wm * 3.0 + core * 3.0) * 1.4;
      float a = 1.0 - exp(-dens * stepLen * uDensity);
      acc += trans * a * (emis / dens);
      trans *= 1.0 - a;
    }
    t += stepLen;
  }
  gl_FragColor = vec4(acc, 1.0 - trans);
}
