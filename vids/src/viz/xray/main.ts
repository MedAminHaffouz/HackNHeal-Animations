/**
 * VIZ-04 — Chest X-ray with similar-case retrieval.
 *
 * Per case (~10.5 s): dissolve in → scan line → Grad-CAM heatmap →
 * particles flow through the embedding plot to the 3 most similar cases,
 * whose scores count up → hold → next case.
 *
 * Everything is drawn in one orthographic pixel-space scene so bloom/grain
 * apply uniformly. Images come from public/xray/manifest.json when present,
 * otherwise from the procedural generator (cxrGen.ts).
 */
import * as THREE from 'three';
import { VizApp } from '../../shared/app';
import { colors } from '../../shared/tokens';
import { clamp, easeOutCubic, rng, smoothstep, window4 } from '../../shared/math';
import quadVert from '../../shared/glsl/fullscreen.vert.glsl?raw';
import imageFrag from './glsl/image.frag.glsl?raw';
import flowVert from './glsl/flow.vert.glsl?raw';
import flowFrag from './glsl/flow.frag.glsl?raw';
import { PROCEDURAL_CASES, loadManifest, materialize, type CaseDef, type LoadedCase } from './cases';
import { drawXrayHud, type XrayHudState } from './xrayHud';

const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
const app = new VizApp({
  name: 'xray',
  camera,
  post: { bloomStrength: 0.8, bloomRadius: 0.45, bloomThreshold: 0.8, grain: 0.05, aberration: 1.8, scanlines: 1 },
  keys: { n: ['next case', () => skip()] },
});
const high = app.params.quality === 'high';
const CASE_T = 10.5;

// ───────────────────────────── panels ─────────────────────────────
function imageMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tImage: { value: null },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uScan: { value: -1 },
      uHeat: { value: 0 },
      uBlobs: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uBlobCount: { value: 0 },
      uGlow: { value: 0 },
      uRes: { value: new THREE.Vector2(512, 512) },
      uDim: { value: 0 },
    },
    vertexShader: quadVert,
    fragmentShader: imageFrag,
    depthTest: false,
    depthWrite: false,
  });
}
const quad = new THREE.PlaneGeometry(1, 1);
const mainMesh = new THREE.Mesh(quad, imageMaterial());
const simMeshes = [0, 1, 2].map(() => new THREE.Mesh(quad, imageMaterial()));
app.scene.add(mainMesh, ...simMeshes);
mainMesh.visible = false;
simMeshes.forEach((m) => (m.visible = false));

// retrieval particles
const NP = high ? 1100 : 380;
const flowGeo = new THREE.BufferGeometry();
{
  const r = rng(99);
  const pos = new Float32Array(NP * 3);
  const target = new Float32Array(NP);
  const phase = new Float32Array(NP);
  const seed = new Float32Array(NP);
  for (let i = 0; i < NP; i++) {
    target[i] = i % 3;
    phase[i] = r();
    seed[i] = r();
  }
  flowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  flowGeo.setAttribute('aTarget', new THREE.BufferAttribute(target, 1));
  flowGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  flowGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
}
const flowMat = new THREE.ShaderMaterial({
  uniforms: {
    uFrom: { value: new THREE.Vector2() },
    uVia: { value: new THREE.Vector2() },
    uTo: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uSpread: { value: 40 },
    uPixelRatio: { value: 1 },
    uSize: { value: 3.2 },
    uColor: { value: new THREE.Color(colors.cyan) },
    uHeadColor: { value: new THREE.Color('#ffffff') },
  },
  vertexShader: flowVert,
  fragmentShader: flowFrag,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const flow = new THREE.Points(flowGeo, flowMat);
flow.frustumCulled = false;
flow.renderOrder = 5;
app.scene.add(flow);

// ───────────────────────────── layout ─────────────────────────────
interface Rect { x: number; y: number; w: number; h: number }
const hud: XrayHudState = {
  ready: false,
  def: null,
  main: { x: 0, y: 0, w: 0, h: 0 },
  sims: [],
  via: { x: 0, y: 0, r: 0 },
  portrait: false,
  phase: 'LOADING',
  ct: 0,
  scan: -1,
  heat: 0,
  simReveal: [0, 0, 0],
  scores: [0, 0, 0],
  flow: 0,
  caseNo: 0,
  caseCount: 0,
  source: 'PROCEDURAL',
  time: 0,
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
  const top = (clean ? 24 : 104) * s;
  const bottom = (clean ? 24 : 58) * s;
  const side = Math.max(16, (clean ? 20 : 34) * s);
  const availH = h - top - bottom;
  const gap = 14 * s;
  hud.portrait = w / h < 1.2;
  if (!hud.portrait) {
    const labelW = 200 * s;
    const thumb = Math.min((availH - 2 * gap) / 3, w * 0.16);
    const mainSize = Math.min(availH, w - 2 * side - labelW - thumb - 220 * s);
    hud.main = { x: side + 10 * s, y: top + (availH - mainSize) / 2, w: mainSize, h: mainSize };
    const colX = w - side - 10 * s - labelW - thumb;
    const colH = 3 * thumb + 2 * gap;
    hud.sims = [0, 1, 2].map((i) => ({ x: colX, y: top + (availH - colH) / 2 + i * (thumb + gap), w: thumb, h: thumb }));
    const gx0 = hud.main.x + hud.main.w;
    hud.via = { x: (gx0 + colX) / 2, y: top + availH / 2, r: Math.min(90 * s, (colX - gx0) / 2 - 24 * s) };
  } else {
    const labelH = 46 * s;
    const flowGap = 70 * s;
    const mainSize = Math.min(w - 2 * side, availH * 0.6);
    const thumb = Math.min((w - 2 * side - 2 * gap) / 3, availH - mainSize - labelH - flowGap);
    // centre the query + match row as one block
    const y0 = top + Math.max(0, (availH - (mainSize + flowGap + thumb + labelH)) / 2);
    hud.main = { x: (w - mainSize) / 2, y: y0, w: mainSize, h: mainSize };
    const rowW = 3 * thumb + 2 * gap;
    const rowY = y0 + mainSize + flowGap;
    hud.sims = [0, 1, 2].map((i) => ({ x: (w - rowW) / 2 + i * (thumb + gap), y: rowY, w: thumb, h: thumb }));
    hud.via = { x: w / 2, y: (y0 + mainSize + rowY) / 2, r: 0 };
  }
  place(mainMesh, hud.main, h);
  hud.sims.forEach((r, i) => place(simMeshes[i], r, h));
  mainMesh.material.uniforms.uRes.value.set(hud.main.w, hud.main.h);
  simMeshes.forEach((m, i) => m.material.uniforms.uRes.value.set(hud.sims[i].w, hud.sims[i].h));
  flowMat.uniforms.uPixelRatio.value = app.pixelRatio;
  flowMat.uniforms.uSpread.value = 46 * s;
  flowMat.uniforms.uSize.value = 3.2 * Math.max(0.8, s);
}
app.onResize = layout;
layout(app.width, app.height);

// ───────────────────────────── cases ─────────────────────────────
let defs: CaseDef[] = PROCEDURAL_CASES;
const cache = new Map<number, LoadedCase>();
const pending = new Set<number>();
let current: LoadedCase | null = null;
let currentIdx = -1;
let caseStart = app.params.startTime;
const MAIN_SIZE = high ? 1024 : 640;
const THUMB_SIZE = high ? 512 : 320;

function ensure(i: number): void {
  const k = ((i % defs.length) + defs.length) % defs.length;
  if (cache.has(k) || pending.has(k)) return;
  pending.add(k);
  materialize(defs[k], MAIN_SIZE, THUMB_SIZE)
    .then((c) => cache.set(k, c))
    .catch((e) => console.warn('case failed', e))
    .finally(() => pending.delete(k));
}

function show(i: number): void {
  const k = ((i % defs.length) + defs.length) % defs.length;
  const c = cache.get(k);
  if (!c) return;
  current = c;
  currentIdx = i;
  mainMesh.material.uniforms.tImage.value = c.main;
  const blobs = c.def.heat.slice(0, 4);
  blobs.forEach((b, n) => mainMesh.material.uniforms.uBlobs.value[n].set(...b));
  mainMesh.material.uniforms.uBlobCount.value = blobs.length;
  simMeshes.forEach((m, n) => (m.material.uniforms.tImage.value = c.similar[n] ?? c.main));
  mainMesh.visible = true;
  simMeshes.forEach((m) => (m.visible = true));
  hud.def = c.def;
  hud.caseNo = k + 1;
  hud.caseCount = defs.length;
  hud.ready = true;
  // free textures that are no longer near the playhead (real photos can be large)
  for (const [key, val] of cache) {
    const dist = Math.min(Math.abs(key - k), defs.length - Math.abs(key - k));
    if (dist > 1 && defs.length > 3) {
      val.main.dispose();
      val.similar.forEach((t) => t.dispose());
      cache.delete(key);
    }
  }
}

function skip(): void {
  caseStart = app.time - CASE_T + 0.6;
}

loadManifest().then((m) => {
  if (m) {
    defs = m;
    hud.source = `public/xray · ${m.length} CASES`;
    cache.clear();
  }
  ensure(0);
  ensure(1);
});

// ───────────────────────────── frame ─────────────────────────────
app.update = (dt, t) => {
  void dt;
  let ct = t - caseStart;
  if (ct >= CASE_T && current) {
    // advance only when the next case is ready
    const next = currentIdx + 1;
    ensure(next);
    if (cache.has(((next % defs.length) + defs.length) % defs.length)) {
      show(next);
      ensure(next + 1);
      caseStart = t;
      ct = 0;
    } else {
      ct = CASE_T - 0.001;
    }
  }
  if (!current) {
    ensure(0);
    if (cache.has(0)) {
      show(0);
      ensure(1);
      caseStart = t;
      ct = 0;
    } else return;
  }
  const cur = current!;

  // ── timeline
  const reveal = smoothstep(0, 0.9, ct) * (1 - smoothstep(CASE_T - 0.7, CASE_T, ct));
  const scan = ct > 0.9 && ct < 3.6 ? (ct - 0.9) / 2.6 : -1;
  const heat = window4(ct, 3.1, 4.3, CASE_T - 1.0, CASE_T - 0.3);
  const flowI = window4(ct, 4.2, 4.8, 7.6, 8.6);
  const arrive = [5.0, 5.45, 5.9];
  const simReveal = arrive.map((a) => smoothstep(a, a + 0.6, ct) * (1 - smoothstep(CASE_T - 0.7, CASE_T, ct)));
  const scores = arrive.map((a, i) => (cur.def.similar[i]?.score ?? 0) * easeOutCubic(clamp((ct - a - 0.1) / 0.9)));

  const mu = mainMesh.material.uniforms;
  mu.uTime.value = t;
  mu.uReveal.value = reveal;
  mu.uScan.value = scan;
  mu.uHeat.value = heat;
  simMeshes.forEach((m, i) => {
    const u = m.material.uniforms;
    u.uTime.value = t + i * 3.1;
    u.uReveal.value = simReveal[i];
    u.uGlow.value = window4(ct, arrive[i] + 0.2, arrive[i] + 0.5, arrive[i] + 1.0, arrive[i] + 2.2);
    u.uDim.value = 0;
  });

  // ── particle endpoints (three.js y is up)
  const H = app.height;
  const b0 = cur.def.heat[0];
  const from = { x: hud.main.x + b0[0] * hud.main.w, y: hud.main.y + b0[1] * hud.main.h };
  flowMat.uniforms.uFrom.value.set(from.x, H - from.y);
  flowMat.uniforms.uVia.value.set(hud.via.x, H - hud.via.y);
  hud.sims.forEach((r, i) => {
    const tx = hud.portrait ? r.x + r.w / 2 : r.x;
    const ty = hud.portrait ? r.y : r.y + r.h / 2;
    flowMat.uniforms.uTo.value[i].set(tx, H - ty);
  });
  flowMat.uniforms.uTime.value = t;
  flowMat.uniforms.uFlow.value = flowI;

  // ── HUD
  hud.ct = ct;
  hud.scan = scan;
  hud.heat = heat;
  hud.flow = flowI;
  hud.simReveal = simReveal;
  hud.scores = scores;
  hud.time = t;
  hud.phase = ct < 0.9 ? 'LOADING STUDY' : ct < 3.6 ? 'ENCODING' : ct < 4.3 ? 'ATTENTION MAP' : ct < 6.6 ? 'RETRIEVING' : 'TOP-3 MATCHES';
};

app.drawHud = (h) => drawXrayHud(h, hud);
app.start();
