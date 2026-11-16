/**
 * VIZ-01 — DNA double helix with a live "sequencing" read head.
 *
 * Scene graph:
 *   root (tilt, responsive)
 *    ├─ spin (slow rotation about the helix axis)
 *    │   ├─ backbone tubes ×2   (GPU unzip displacement)
 *    │   ├─ phosphates          (InstancedMesh, 2N)
 *    │   └─ base slabs          (InstancedMesh, 2N; colour per base / scan state)
 *    └─ read head             (light-sheet disc + torus; does not spin)
 *   dust (bokeh points), backdrop plate
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VizApp } from '../../shared/app';
import { baseColors, colors } from '../../shared/tokens';
import { createBackdrop, createDust, holoMaterial } from '../../shared/materials';
import { clamp, damp, smoothstep, window4 } from '../../shared/math';
import { BDNA, HelixModel, StrandCurve, rungMatrix, unzipAt, type Unzip } from './helix';
import { PURINE, Sequencer, type VariantEvent } from './sequencer';
import { drawDnaHud, type DnaHudState, type ScreenPoint } from './dnaHud';
import backboneVert from './glsl/backbone.vert.glsl?raw';
import backboneFrag from './glsl/backbone.frag.glsl?raw';
import ringVert from './glsl/scanring.vert.glsl?raw';
import ringFrag from './glsl/scanring.frag.glsl?raw';

const app = new VizApp({
  name: 'dna',
  camera: new THREE.PerspectiveCamera(30, 1, 0.1, 400),
  post: { bloomStrength: 1.05, bloomRadius: 0.6, bloomThreshold: 0.7, grain: 0.045, aberration: 2.2 },
});
const high = app.params.quality === 'high';
const camera = app.camera as THREE.PerspectiveCamera;

// ───────────────────────────── model ─────────────────────────────
const N = high ? 150 : 110;
const model = new HelixModel(N);
const seq = new Sequencer(N);
const unzip: Unzip = { center: 0, halfWidth: 3.4, amount: 0, sep: 0.95 };

// ───────────────────────────── scene ─────────────────────────────
const root = new THREE.Group();
const spin = new THREE.Group();
root.add(spin);
app.scene.add(root);

const backdrop = createBackdrop(colors.violet, 1);
app.scene.add(backdrop.mesh);
backdrop.mesh.visible = !app.params.transparent; // keep ?bg=transparent truly clear

// backbones
const scanColor = new THREE.Color(colors.cyan);
function backboneMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uScanColor: { value: scanColor },
      uFogColor: { value: new THREE.Color(colors.bg) },
      uFog: { value: new THREE.Vector2(22, 46) },
      uScanX: { value: -999 },
      uScanOn: { value: 0 },
      uIntensity: { value: 0.75 },
      uUnzipC: { value: 0 },
      uUnzipW: { value: unzip.halfWidth },
      uUnzipAmt: { value: 0 },
      uUnzipSep: { value: unzip.sep },
    },
    vertexShader: backboneVert,
    fragmentShader: backboneFrag,
  });
}
const strandColors = [colors.cyan, colors.blue];
const backbones = ([0, 1] as const).map((k) => {
  const geo = new THREE.TubeGeometry(new StrandCurve(model, k), N * (high ? 10 : 5), 0.115, high ? 12 : 7, false);
  const mesh = new THREE.Mesh(geo, backboneMaterial(strandColors[k]));
  spin.add(mesh);
  return mesh;
});

// phosphates (one per nucleotide per strand)
const phosphates = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(0.17, high ? 2 : 1),
  holoMaterial({ intensity: 1, rim: 1.2, fog: [22, 46] }),
  2 * N,
);
phosphates.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2 * N * 3), 3);
spin.add(phosphates);

// base slabs (two halves per pair)
const rungs = new THREE.InstancedMesh(
  new RoundedBoxGeometry(1, 1, 1, 2, 0.18),
  holoMaterial({ intensity: 1, rim: 0.9, fog: [22, 46] }),
  2 * N,
);
rungs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2 * N * 3), 3);
spin.add(rungs);

// read head: light sheet + torus, perpendicular to the axis
const head = new THREE.Group();
const ringMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(colors.cyan) }, uTime: { value: 0 }, uOpacity: { value: 0 } },
  vertexShader: ringVert,
  fragmentShader: ringFrag,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), ringMat);
sheet.rotation.y = Math.PI / 2;
head.add(sheet);
const torusMat = holoMaterial({ color: colors.cyan, intensity: 2.6, rim: 1, additive: true, transparent: true, opacity: 1 });
const torus = new THREE.Mesh(new THREE.TorusGeometry(2.42, 0.022, 8, 128), torusMat);
torus.rotation.y = Math.PI / 2;
head.add(torus);
root.add(head);

// floating dust with fake depth of field
const dust = createDust({
  count: high ? 1600 : 500,
  box: [34, 14, 16],
  color: colors.cyan,
  size: 1.1,
  focus: 24,
  aperture: 0.09,
  drift: 0.5,
});
app.scene.add(dust);

// ───────────────────────────── layout ─────────────────────────────
let tilt = -0.2;
let sweepHalf = 10;
const DIST = 24;
app.onResize = (w, h) => {
  const aspect = w / h;
  // landscape: gentle diagonal; portrait: near-vertical so the helix still fills the frame
  tilt = aspect >= 1 ? -0.2 : -Math.PI / 2 + 0.22;
  root.rotation.z = tilt;
  const halfH = DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfW = halfH * aspect;
  const along = Math.min(halfW / Math.abs(Math.cos(tilt)), halfH / Math.abs(Math.sin(tilt)));
  sweepHalf = clamp(along * 0.82, 5, model.x(N - 1) - 2);
  unzip.center = sweepHalf * 0.42;
  dust.material.uniforms.uPixelRatio.value = app.pixelRatio;
};
app.onResize(app.width, app.height);

// ───────────────────────────── state ─────────────────────────────
const SCAN_SPEED = 1.55; // nm / s ≈ 4.6 bp/s
const RESET_TIME = 1.8;
const HOLD_TIME = 2.6;
let phase: 'scan' | 'hold' | 'reset' = 'scan';
let phaseT = 0;
let scanX = -sweepHalf;
let ringOpacity = 0;
let rate = 0;
let lastCalled = -1;
const callouts: Array<{ ev: VariantEvent; born: number }> = [];

const mat4 = new THREE.Matrix4();
const col = new THREE.Color();
const dim = new THREE.Color('#1a2742');
const white = new THREE.Color(1, 1, 1);
const amber = new THREE.Color(colors.amber);
const baseCol = Object.fromEntries(Object.entries(baseColors).map(([k, v]) => [k, new THREE.Color(v)])) as Record<string, THREE.Color>;
const strandCol = strandColors.map((c) => new THREE.Color(c));

function bpIndexAt(x: number): number {
  return x / BDNA.rise + (N - 1) / 2;
}

/** Instance transforms only change while the bubble moves; colours change every frame. */
function updateInstances(t: number): void {
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const x = model.x(i);
    const push = unzipAt(unzip, x);
    const shown = seq.shown(i);
    const isVar = seq.variantAt.has(i) && seq.isCalled(i);
    const d = x - scanX;
    const glow = Math.exp(-d * d * 6) * ringOpacity;
    const rev = seq.reveal[i];

    for (const k of [0, 1] as const) {
      // phosphate
      model.point(i, k, BDNA.radius, v);
      const a = model.angle(i, k);
      v.y += Math.cos(a) * push;
      v.z += Math.sin(a) * push;
      mat4.makeTranslation(v.x, v.y, v.z);
      phosphates.setMatrixAt(i * 2 + k, mat4);
      col.copy(strandCol[k]).multiplyScalar(0.5 + 0.2 * rev).lerp(white, glow * 0.35).multiplyScalar(1 + glow * 1.2);
      phosphates.setColorAt(i * 2 + k, col);

      // base half: strand A shows the base, strand B its Watson–Crick partner
      const b = k === 0 ? shown : ({ A: 'T', T: 'A', G: 'C', C: 'G' } as const)[shown];
      rungMatrix(model, i, k, PURINE[b], unzip, mat4);
      rungs.setMatrixAt(i * 2 + k, mat4);
      if (isVar) {
        const pulse = 1.6 + 0.9 * Math.sin(t * 7);
        col.copy(amber).multiplyScalar(pulse);
      } else {
        col.copy(dim).lerp(baseCol[b], rev).multiplyScalar(0.45 + 0.35 * rev);
        col.lerp(white, glow * 0.25).multiplyScalar(1 + glow * 1.6);
      }
      rungs.setColorAt(i * 2 + k, col);
    }
  }
  phosphates.instanceMatrix.needsUpdate = true;
  phosphates.instanceColor!.needsUpdate = true;
  rungs.instanceMatrix.needsUpdate = true;
  rungs.instanceColor!.needsUpdate = true;
}

function visibleRange(): [number, number] {
  return [Math.ceil(bpIndexAt(-sweepHalf)), Math.floor(bpIndexAt(sweepHalf))];
}

// ───────────────────────────── frame ─────────────────────────────
const proj = new THREE.Vector3();
function project(local: THREE.Vector3, obj: THREE.Object3D): ScreenPoint {
  proj.copy(local).applyMatrix4(obj.matrixWorld).project(camera);
  return {
    x: (proj.x * 0.5 + 0.5) * app.width,
    y: (-proj.y * 0.5 + 0.5) * app.height,
    visible: proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05,
  };
}

let unzipCycle = 0;
const hudState: DnaHudState = {
  seq,
  frac: 0,
  scanning: true,
  scanOpacity: 0,
  head: { x: 0, y: 0, visible: false },
  headPos: 0,
  rate: 0,
  unzip: 0,
  unzipLabel: 0,
  unzipAnchor: { x: 0, y: 0, visible: false },
  grooves: { minor: { x: 0, y: 0, visible: false }, major: { x: 0, y: 0, visible: false }, alpha: 0 },
  callouts: [],
  time: 0,
};

app.update = (dt, t) => {
  const m = app.motion;
  // ── read head timeline
  phaseT += dt;
  if (phase === 'scan') {
    scanX = -sweepHalf + phaseT * SCAN_SPEED;
    ringOpacity = smoothstep(0, 0.6, phaseT) * (1 - smoothstep(sweepHalf - 0.8, sweepHalf, scanX));
    // call every base pair the head has passed
    const idx = Math.floor(bpIndexAt(scanX));
    const [lo, hi] = visibleRange();
    for (let i = Math.max(lo, lastCalled + 1); i <= Math.min(idx, hi); i++) {
      const ev = seq.call(i, t);
      lastCalled = i;
      if (ev) callouts.push({ ev, born: t });
    }
    rate = damp(rate, SCAN_SPEED / BDNA.rise, 3, dt);
    if (scanX >= sweepHalf) {
      phase = 'hold';
      phaseT = 0;
    }
  } else if (phase === 'hold') {
    ringOpacity = 0;
    rate = damp(rate, 0, 4, dt);
    if (phaseT >= HOLD_TIME) {
      phase = 'reset';
      phaseT = 0;
    }
  } else {
    ringOpacity = 0;
    rate = damp(rate, 0, 4, dt);
    seq.fade(dt, 1.4);
    if (phaseT >= RESET_TIME) {
      const [lo, hi] = visibleRange();
      seq.newRead(lo, hi);
      seq.reveal.fill(0);
      phase = 'scan';
      phaseT = 0;
      lastCalled = lo - 1;
      scanX = -sweepHalf;
    }
  }

  // ── strand separation bubble (independent ~32 s cycle)
  unzipCycle = (unzipCycle + dt) % 32;
  unzip.amount = window4(unzipCycle, 9, 12.5, 21, 24.5);

  // ── animate
  spin.rotation.x = t * 0.16;
  head.position.x = scanX;
  head.rotation.x = -t * 0.5;
  ringMat.uniforms.uTime.value = t;
  ringMat.uniforms.uOpacity.value = ringOpacity;
  torusMat.uniforms.uOpacity.value = ringOpacity;
  torusMat.uniforms.uIntensity.value = 1.8 * ringOpacity;
  for (const b of backbones) {
    const u = (b.material as THREE.ShaderMaterial).uniforms;
    u.uScanX.value = scanX;
    u.uScanOn.value = ringOpacity;
    u.uUnzipC.value = unzip.center;
    u.uUnzipAmt.value = unzip.amount;
  }
  updateInstances(t);

  // ── camera: slow drift along the axis + gentle orbit
  const cx = Math.sin(t * 0.06) * 3.2 * m;
  camera.position.set(cx, 1.2 + Math.sin(t * 0.09) * 0.8 * m, DIST + Math.sin(t * 0.05) * 1.2 * m);
  camera.lookAt(cx * 0.55, 0, 0);
  dust.material.uniforms.uTime.value = t;
  dust.rotation.y = t * 0.004;
  backdrop.update(camera, t);

  // ── HUD bookkeeping (projections need fresh matrices)
  app.scene.updateMatrixWorld();
  hudState.time = t;
  hudState.scanning = phase === 'scan';
  hudState.scanOpacity = ringOpacity;
  hudState.frac = clamp(bpIndexAt(scanX) - Math.floor(bpIndexAt(scanX)));
  hudState.head = project(new THREE.Vector3(scanX, 2.45, 0), root);
  hudState.headPos = seq.readStart + Math.max(0, Math.floor(bpIndexAt(scanX)));
  hudState.rate = rate;
  hudState.unzip = unzip.amount;
  // hide the bubble callout while the read head passes through it (labels would collide)
  hudState.unzipLabel = clamp(unzip.amount * 1.5) * (1 - window4(Math.abs(scanX - unzip.center), -1, 0, 3, 4.5) * ringOpacity);
  {
    // anchor on whichever separated strand is higher on screen; label goes upward
    const i = Math.round(bpIndexAt(unzip.center));
    const r = BDNA.radius + unzipAt(unzip, unzip.center);
    const a = project(model.point(i, 0, r), spin);
    const b = project(model.point(i, 1, r), spin);
    hudState.unzipAnchor = a.y < b.y ? a : b;
  }
  // groove callouts during the first seconds of each read
  hudState.grooves.alpha = phase === 'scan' ? window4(phaseT, 1.2, 2.2, 7.5, 8.5) * (1 - smoothstep(0, 0.1, unzip.amount)) : 0;
  if (hudState.grooves.alpha > 0) {
    hudState.grooves.minor = grooveAnchor(sweepHalf * 0.02, true);
    hudState.grooves.major = grooveAnchor(sweepHalf * 0.62, false);
  }
  while (callouts.length && t - callouts[0].born > 6.5) callouts.shift();
  hudState.callouts = callouts.map((c) => {
    const i = c.ev.index;
    const p = model.point(i, 0, BDNA.baseRadius * 0.5).lerp(model.point(i, 1, BDNA.baseRadius * 0.5), 0.5);
    return { ev: c.ev, p: project(p, spin), alpha: window4(t - c.born, 0, 0.25, 5.5, 6.5) };
  });
};

/** Point on the groove surface near local x, choosing the turn that faces the camera. */
function grooveAnchor(x: number, minor: boolean): ScreenPoint {
  const i0 = Math.round(bpIndexAt(x));
  let best: ScreenPoint = { x: 0, y: 0, visible: false };
  let bestZ = -Infinity;
  const w = new THREE.Vector3();
  for (let i = i0 - 5; i <= i0 + 5; i++) {
    const a = model.angle(i, 0) + (minor ? Math.PI * BDNA.minorFrac : Math.PI * (1 + BDNA.minorFrac));
    const p = new THREE.Vector3(model.x(i), Math.cos(a) * 0.95, Math.sin(a) * 0.95);
    w.copy(p).applyMatrix4(spin.matrixWorld);
    const toCam = camera.position.clone().sub(w).normalize();
    const nrm = new THREE.Vector3(0, Math.cos(a), Math.sin(a)).transformDirection(spin.matrixWorld);
    const facing = nrm.dot(toCam);
    if (facing > bestZ) {
      bestZ = facing;
      best = project(p, spin);
    }
  }
  return best;
}

app.drawHud = (h) => drawDnaHud(h, hudState);
{
  // first read: place its variants inside the visible sweep
  const [lo, hi] = visibleRange();
  seq.newRead(lo, hi);
  lastCalled = lo - 1;
}
app.start();
