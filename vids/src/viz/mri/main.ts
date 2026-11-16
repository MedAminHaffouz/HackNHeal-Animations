/**
 * VIZ-03 — MRI brain: healthy vs glioma, side by side.
 *
 * 1. A procedural brain (WM / GM / CSF fractions + tumour field) is baked
 *    once on the GPU into an RGBA8 3D render target (one draw per Z layer).
 *    Optionally the tissue classes come from a real NIfTI T1 (?nifti=...).
 * 2. Each panel draws, in a single orthographic pixel-space scene:
 *      - a raymarched holographic 3D brain with the slice plane at true depth
 *      - the 2D MRI slice at the plane position (T1 / T2 contrast model)
 *    Both panels share the volume, camera orbit, slice position and sequence.
 *    Only the lesion panel reads the tumour channel.
 */
import * as THREE from 'three';
import { VizApp, assetUrl } from '../../shared/app';
import { colors } from '../../shared/tokens';
import { damp, smoothstep } from '../../shared/math';
import { drawMriHud, type MriHudState, type Rect } from './mriHud';
import { loadNifti } from './nifti';
import noiseGlsl from './glsl/noise.glsl?raw';
import brainGlsl from './glsl/brain.glsl?raw';
import quadVert from './glsl/quad.vert.glsl?raw';
import bakeFrag from './glsl/bake.frag.glsl?raw';
import volumeFrag from './glsl/volume.frag.glsl?raw';
import sliceFrag from './glsl/slice.frag.glsl?raw';

export const PLANES = ['axial', 'sagittal', 'coronal'] as const;
export type Plane = (typeof PLANES)[number];
/** Sweep range per plane (normalised cube coords). */
const SWEEP: Record<Plane, [number, number]> = { axial: [-0.4, 0.68], sagittal: [-0.66, 0.66], coronal: [-0.8, 0.82] };
/** Tumour centre (RAS, right frontoparietal deep white matter) and core radius. */
const TUMOR_C = new THREE.Vector3(0.3, 0.2, 0.18);
const TUMOR_R = 0.145;

const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
const app = new VizApp({
  name: 'mri',
  camera,
  post: { bloomStrength: 0.85, bloomRadius: 0.5, bloomThreshold: 0.78, grain: 0.04, aberration: 1.6, scanlines: 0.8 },
  keys: {
    '1': ['axial plane', () => setPlane('axial')],
    '2': ['sagittal plane', () => setPlane('sagittal')],
    '3': ['coronal plane', () => setPlane('coronal')],
    p: ['cycle slice plane', () => setPlane(PLANES[(PLANES.indexOf(plane) + 1) % 3])],
    t: ['toggle T1 / T2', () => { seqLock = true; seqTarget = seqTarget > 0.5 ? 0 : 1; }],
  },
});
const high = app.params.quality === 'high';
const renderer = app.renderer;

// ───────────────────────────── params ─────────────────────────────
let plane: Plane = (PLANES as readonly string[]).includes(app.params.get('plane') ?? '') ? (app.params.get('plane') as Plane) : 'axial';
const seqParam = app.params.get('seq');
let seqLock = seqParam === 't1' || seqParam === 't2';
let seqTarget = seqParam === 't2' ? 1 : 0;
let seq = seqTarget;
/** ?cycle=1 also rotates the slice plane every sweep (good for long recordings). */
const cyclePlanes = app.params.get('cycle') === '1';
let planeFade = 1;

function setPlane(p: Plane): void {
  plane = p;
  planeFade = 0;
}

// ───────────────────────────── volume bake ─────────────────────────────
const N = high ? 160 : 96;
const volumeRT = new THREE.WebGL3DRenderTarget(N, N, N, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
});
volumeRT.texture.minFilter = THREE.LinearFilter;
volumeRT.texture.magFilter = THREE.LinearFilter;

const emptyRaw = new THREE.Data3DTexture(new Uint8Array([0]), 1, 1, 1);
emptyRaw.format = THREE.RedFormat;
emptyRaw.needsUpdate = true;
const rawUniforms = {
  uRaw: { value: emptyRaw as THREE.Data3DTexture },
  uReal: { value: 0 },
  uRawScale: { value: new THREE.Vector3(1, 1, 1) },
  uRawFlip: { value: new THREE.Vector3(1, 1, 1) },
};
const tumorUniforms = { uTumorC: { value: TUMOR_C }, uTumorR: { value: TUMOR_R } };
const lib = `${noiseGlsl}\n${brainGlsl}\n`;

function bake(): void {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 }, ...rawUniforms, ...tumorUniforms },
    vertexShader: quadVert,
    fragmentShader: lib + bakeFrag,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const prevTarget = renderer.getRenderTarget();
  for (let z = 0; z < N; z++) {
    mat.uniforms.uZ.value = ((z + 0.5) / N) * 2 - 1;
    renderer.setRenderTarget(volumeRT, z);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prevTarget);
  mat.dispose();
}
bake();

const niftiPath = app.params.get('nifti');
let dataLabel = 'PROCEDURAL PHANTOM';
if (niftiPath) {
  loadNifti(assetUrl(niftiPath))
    .then((r) => {
      rawUniforms.uRaw.value = r.texture;
      rawUniforms.uReal.value = 1;
      rawUniforms.uRawScale.value.copy(r.scale);
      rawUniforms.uRawFlip.value.copy(r.flip);
      dataLabel = `NIfTI ${r.dims.join('×')}`;
      bake();
    })
    .catch((e) => {
      console.warn('NIfTI load failed, using procedural phantom:', e);
      dataLabel = 'PROCEDURAL (NIfTI FAILED)';
    });
}

// ───────────────────────────── panels ─────────────────────────────
const C = (hex: string) => new THREE.Color(hex);
function makeVolumeMat(tumor: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { STEPS: high ? 150 : 72 },
    uniforms: {
      uVol: { value: volumeRT.texture },
      uCamPos: { value: new THREE.Vector3() },
      uCamRight: { value: new THREE.Vector3() },
      uCamUp: { value: new THREE.Vector3() },
      uCamFwd: { value: new THREE.Vector3() },
      uTanFov: { value: 0.25 },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uTumor: { value: tumor },
      uPulse: { value: 0 },
      uAxis: { value: 0 },
      uPos: { value: 0 },
      uDensity: { value: 4.0 },
      uVoxel: { value: 1 / N },
      cCortex: { value: C(colors.cyan).multiplyScalar(0.55) },
      cWM: { value: C(colors.blue).multiplyScalar(0.35) },
      cCSF: { value: C(colors.magenta).multiplyScalar(0.5) },
      cTumor: { value: C(colors.amber) },
      cEdema: { value: C(colors.magenta).multiplyScalar(0.8) },
      cPlane: { value: C('#bff8ff') },
    },
    vertexShader: quadVert,
    fragmentShader: volumeFrag,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  });
}
function makeSliceMat(tumor: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uVol: { value: volumeRT.texture },
      ...rawUniforms,
      ...tumorUniforms,
      uAxis: { value: 0 },
      uPos: { value: 0 },
      uSeq: { value: 0 },
      uTumor: { value: tumor },
      uPulse: { value: 0 },
      uReveal: { value: 0 },
      uTime: { value: 0 },
      uFade: { value: 1 },
      uRes: { value: new THREE.Vector2(256, 256) },
      cSeg: { value: C(colors.amber) },
      cEdema: { value: C(colors.magenta) },
    },
    vertexShader: quadVert,
    fragmentShader: lib + sliceFrag,
    depthTest: false,
    depthWrite: false,
  });
}

interface Panel {
  tumor: boolean;
  vol: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  slice: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}
const quad = new THREE.PlaneGeometry(1, 1);

// The raymarched views are the expensive part: render them into an offscreen
// target at reduced resolution, then composite that over the main scene.
const VOL_SCALE = high ? 0.75 : 0.5;
const volScene = new THREE.Scene();
const volRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const volDisplay = new THREE.Mesh(
  quad,
  new THREE.ShaderMaterial({
    uniforms: { tVol: { value: volRT.texture } },
    vertexShader: quadVert,
    fragmentShader: 'uniform sampler2D tVol; varying vec2 vUv; void main() { gl_FragColor = texture2D(tVol, vUv); }',
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  }),
);
volDisplay.renderOrder = -1;
app.scene.add(volDisplay);

const panels: Panel[] = [0, 1].map((i) => {
  const vol = new THREE.Mesh(quad, makeVolumeMat(i));
  const slice = new THREE.Mesh(quad, makeSliceMat(i));
  volScene.add(vol);
  app.scene.add(slice);
  return { tumor: i === 1, vol, slice };
});

// ───────────────────────────── layout ─────────────────────────────
const hud: MriHudState = {
  panels: [],
  plane,
  seq: 0,
  pos: 0,
  sliceIndex: 0,
  sliceCount: 182,
  posMm: 0,
  pass: 0,
  tumorSlice: null,
  tumorVol: null,
  areaMm2: 0,
  volCm3: 0,
  edemaCm3: 0,
  dataLabel,
  axes: [],
  time: 0,
  planeFade: 1,
};

function place(mesh: THREE.Mesh, r: Rect, H: number): void {
  mesh.position.set(r.x + r.w / 2, H - (r.y + r.h / 2), 0);
  mesh.scale.set(r.w, r.h, 1);
}

function layout(w: number, h: number): void {
  const s = app.hud.s;
  camera.left = 0;
  camera.right = w;
  camera.top = h;
  camera.bottom = 0;
  camera.updateProjectionMatrix();
  const clean = !app.params.hud;
  const top = (clean ? 24 : 108) * s;
  const bottom = (clean ? 24 : 58) * s;
  const side = Math.max(16, (clean ? 20 : 34) * s);
  const gap = 26 * s;
  const head = 34 * s;
  const rects: MriHudState['panels'] = [];
  if (w / h >= 1.15) {
    const pw = (w - 2 * side - gap) / 2;
    const ph = h - top - bottom;
    for (let i = 0; i < 2; i++) {
      const P = { x: side + i * (pw + gap), y: top, w: pw, h: ph };
      const inner = ph - head;
      const vol = { x: P.x, y: P.y + head, w: P.w, h: inner * 0.56 };
      const size = Math.min(inner * 0.44 - 12 * s, P.w * 0.5);
      const slice = { x: P.x + 10 * s, y: P.y + P.h - size - 6 * s, w: size, h: size };
      const info = { x: slice.x + size + 16 * s, y: slice.y, w: P.x + P.w - (slice.x + size + 16 * s) - 8 * s, h: size };
      rects.push({ panel: P, vol, slice, info });
    }
  } else {
    const pw = w - 2 * side;
    const ph = (h - top - bottom - gap) / 2;
    for (let i = 0; i < 2; i++) {
      const P = { x: side, y: top + i * (ph + gap), w: pw, h: ph };
      const inner = ph - head;
      const size = Math.min(inner - 8 * s, pw * 0.5);
      const slice = { x: P.x + P.w - size - 6 * s, y: P.y + head + (inner - size) / 2, w: size, h: size };
      const vol = { x: P.x, y: P.y + head, w: P.w - size - 12 * s, h: inner };
      const info = { x: P.x, y: P.y + P.h - 6 * s, w: 0, h: 0 };
      rects.push({ panel: P, vol, slice, info });
    }
  }
  hud.panels = rects;
  panels.forEach((p, i) => {
    place(p.vol, rects[i].vol, h);
    place(p.slice, rects[i].slice, h);
    p.vol.material.uniforms.uAspect.value = rects[i].vol.w / rects[i].vol.h;
    p.slice.material.uniforms.uRes.value.set(rects[i].slice.w * app.pixelRatio * 0.5, rects[i].slice.h * app.pixelRatio * 0.5);
  });
}
app.onResize = (w, h) => {
  layout(w, h);
  volRT.setSize(Math.max(1, Math.round(w * app.pixelRatio * VOL_SCALE)), Math.max(1, Math.round(h * app.pixelRatio * VOL_SCALE)));
  volDisplay.position.set(w / 2, h / 2, 0);
  volDisplay.scale.set(w, h, 1);
};
app.onResize(app.width, app.height);

// ───────────────────────────── frame ─────────────────────────────
const vcam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
vcam.up.set(0, 0, 1);
const SWEEP_PERIOD = 16;
let sweepT = app.params.startTime;
let lastHalf = Math.floor((app.params.startTime / SWEEP_PERIOD) * 2);
let pass = 0;
const axisIdx: Record<Plane, number> = { axial: 0, sagittal: 1, coronal: 2 };
const axisComp = (v: THREE.Vector3, p: Plane) => (p === 'axial' ? v.z : p === 'sagittal' ? v.x : v.y);
const tmp = new THREE.Vector3();
const clearTmp = new THREE.Color();

function sliceUV(p: THREE.Vector3, pl: Plane): [number, number] {
  if (pl === 'axial') return [(1 - p.x) / 2, (p.y + 1) / 2];
  if (pl === 'sagittal') return [(1 - p.y) / 2, (p.z + 1) / 2];
  return [(1 - p.x) / 2, (p.z + 1) / 2];
}

app.update = (dt, t) => {
  const m = app.motion;
  // sweep: smooth ping-pong; one full back-and-forth per SWEEP_PERIOD
  sweepT += dt;
  const ph = (sweepT % SWEEP_PERIOD) / SWEEP_PERIOD;
  const half = Math.floor((sweepT / SWEEP_PERIOD) * 2);
  if (half !== lastHalf) {
    lastHalf = half;
    if (!seqLock) seqTarget = seqTarget > 0.5 ? 0 : 1;
    if (cyclePlanes && half % 2 === 0) setPlane(PLANES[(PLANES.indexOf(plane) + 1) % 3]);
  }
  // linear wipe between sequences (~1.2 s)
  seq += Math.sign(seqTarget - seq) * Math.min(Math.abs(seqTarget - seq), dt / 1.2);
  planeFade = damp(planeFade, 1, 4, dt);
  const [lo, hi] = SWEEP[plane];
  const pos = lo + (hi - lo) * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));

  // tumour cross-section at this slice
  const d = Math.abs(axisComp(TUMOR_C, plane) - pos);
  const target = smoothstep(TUMOR_R * 1.25, TUMOR_R * 0.55, d);
  pass = damp(pass, target, 6, dt);
  const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);

  // shared virtual camera for both volume views
  const az = t * 0.16 * m + 0.6;
  const el = 0.32 + 0.08 * Math.sin(t * 0.11) * m;
  const dist = 4.0;
  vcam.position.set(Math.sin(az) * Math.cos(el) * dist, -Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist);
  vcam.lookAt(0, 0, 0.02);
  vcam.updateMatrixWorld();
  const e = vcam.matrixWorld.elements;
  const right = new THREE.Vector3(e[0], e[1], e[2]);
  const up = new THREE.Vector3(e[4], e[5], e[6]);
  const fwd = new THREE.Vector3(-e[8], -e[9], -e[10]);
  const tanFov = Math.tan(THREE.MathUtils.degToRad(vcam.fov / 2));

  panels.forEach((p) => {
    const vu = p.vol.material.uniforms;
    vu.uCamPos.value.copy(vcam.position);
    vu.uCamRight.value.copy(right);
    vu.uCamUp.value.copy(up);
    vu.uCamFwd.value.copy(fwd);
    vu.uTanFov.value = tanFov;
    vu.uTime.value = t;
    vu.uAxis.value = axisIdx[plane];
    vu.uPos.value = pos;
    vu.uPulse.value = p.tumor ? pulse * (0.4 + 0.6 * pass) : 0;
    const su = p.slice.material.uniforms;
    su.uAxis.value = axisIdx[plane];
    su.uPos.value = pos;
    su.uSeq.value = seq;
    su.uTime.value = t;
    su.uPulse.value = pulse;
    su.uReveal.value = p.tumor ? pass : 0;
    su.uFade.value = planeFade;
  });

  // ── raymarch both volume views into the reduced-resolution target
  const prevTarget = renderer.getRenderTarget();
  const prevAlpha = renderer.getClearAlpha();
  renderer.getClearColor(clearTmp);
  renderer.setRenderTarget(volRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(volScene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(clearTmp, prevAlpha);

  // ── HUD state
  const counts: Record<Plane, number> = { axial: 182, sagittal: 182, coronal: 218 };
  const [mn, mx] = [-1, 1];
  hud.plane = plane;
  hud.seq = seq;
  hud.pos = pos;
  hud.sliceCount = counts[plane];
  hud.sliceIndex = Math.round(((pos - mn) / (mx - mn)) * (counts[plane] - 1)) + 1;
  hud.posMm = pos * 100;
  hud.pass = pass;
  hud.time = t;
  hud.planeFade = planeFade;
  hud.dataLabel = dataLabel;
  const rEff = Math.sqrt(Math.max(0, TUMOR_R * TUMOR_R - d * d));
  hud.areaMm2 = Math.PI * (rEff * 100) ** 2 * 0.86;
  hud.volCm3 = ((4 / 3) * Math.PI * (TUMOR_R * 100) ** 3) / 1000 * 0.93;
  hud.edemaCm3 = ((4 / 3) * Math.PI * (TUMOR_R * 220) ** 3 - (4 / 3) * Math.PI * (TUMOR_R * 100) ** 3) / 1000 * 0.52;

  const r1 = hud.panels[1];
  if (r1) {
    const [u, v] = sliceUV(TUMOR_C, plane);
    hud.tumorSlice = { x: r1.slice.x + u * r1.slice.w, y: r1.slice.y + (1 - v) * r1.slice.h, r: (rEff / 2) * r1.slice.w };
    vcam.aspect = r1.vol.w / r1.vol.h;
    vcam.updateProjectionMatrix();
    tmp.copy(TUMOR_C).project(vcam);
    hud.tumorVol = { x: r1.vol.x + (tmp.x * 0.5 + 0.5) * r1.vol.w, y: r1.vol.y + (0.5 - tmp.y * 0.5) * r1.vol.h };
    // orientation gizmo axes (R, A, S) in screen space
    hud.axes = (['R', 'A', 'S'] as const).map((k, j) => {
      const dir = new THREE.Vector3(j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0).transformDirection(vcam.matrixWorldInverse);
      return { label: k, x: dir.x, y: -dir.y };
    });
  }
};

app.drawHud = (h) => drawMriHud(h, hud);
app.start();
