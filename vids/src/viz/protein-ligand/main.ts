/**
 * VIZ-02 — Protein–ligand docking.
 *
 * Default data: PDB 1HSG (HIV-1 protease + indinavir/MK1), bundled in
 * public/pdb/. Swap with ?pdb=pdb/xxxx.pdb&ligand=RES (see README).
 *
 * Loop (~20 s): APPROACH → POSE SEARCH (5 poses) → SNAP into the crystal
 * pose (flaps close) → BOUND (H-bonds appear, pocket glows) → RESET.
 * RMSD is computed for real against the crystal pose; ΔG is a smooth
 * function of RMSD plus noise (a stand-in for a scoring function).
 */
import * as THREE from 'three';
import { VizApp, assetUrl } from '../../shared/app';
import { colors, elementColors } from '../../shared/tokens';
import { createBackdrop, createDust, holoMaterial } from '../../shared/materials';
import { clamp, damp, easeInOutCubic, easeOutBack, easeOutCubic, rng, smoothstep } from '../../shared/math';
import { inferBonds, parsePDB, VDW, type Atom } from './pdb';
import { buildCartoon, residuesByChain, type Residue } from './cartoon';
import { BallStick, spherePoints } from './molecule';
import { drawProteinHud, type ProteinHudState } from './proteinHud';
import dotsVert from './glsl/surfdots.vert.glsl?raw';
import dotsFrag from './glsl/surfdots.frag.glsl?raw';
import shockVert from './glsl/shock.vert.glsl?raw';
import shockFrag from './glsl/shock.frag.glsl?raw';

const app = new VizApp({
  name: 'protein',
  camera: new THREE.PerspectiveCamera(30, 1, 1, 1000),
  post: { bloomStrength: 0.95, bloomRadius: 0.55, bloomThreshold: 0.7, grain: 0.045, aberration: 2.0 },
});
const high = app.params.quality === 'high';
const camera = app.camera as THREE.PerspectiveCamera;
const backdrop = createBackdrop(colors.magenta, 1);
app.scene.add(backdrop.mesh);
backdrop.mesh.visible = !app.params.transparent; // keep ?bg=transparent truly clear

const hud: ProteinHudState = {
  ready: false,
  error: '',
  stage: 'APPROACH',
  pose: 0,
  poses: 5,
  sampled: 0,
  run: 1,
  dG: 0,
  rmsd: 0,
  hbonds: 0,
  history: [],
  bound: 0,
  labels: [],
  ligandName: 'MK1',
  target: 'HIV-1 PROTEASE',
  pdbId: '1HSG',
  formula: '',
  mw: 0,
  time: 0,
};
app.drawHud = (h) => drawProteinHud(h, hud);
app.start();

const pdbPath = app.params.get('pdb') ?? 'pdb/1hsg.pdb';
fetch(assetUrl(pdbPath))
  .then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${pdbPath}`);
    return r.text();
  })
  .then(init)
  .catch((e) => {
    hud.error = `PDB LOAD FAILED · ${String(e.message ?? e)}`;
    console.error(e);
  });

const IGNORE_HET = new Set(['HOH', 'WAT', 'SO4', 'PO4', 'GOL', 'EDO', 'CL', 'NA', 'MG', 'ZN', 'CA', 'K', 'ACT', 'DMS', 'PEG']);
const v3 = (a: Atom) => new THREE.Vector3(a.x, a.y, a.z);
const elColor = (el: string) => new THREE.Color(elementColors[el] ?? '#cfe9ff');

function principalAxis(pts: THREE.Vector3[]): THREE.Vector3 {
  const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const m = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const e = m.elements;
  for (const p of pts) {
    const d = p.clone().sub(c);
    e[0] += d.x * d.x; e[1] += d.x * d.y; e[2] += d.x * d.z;
    e[4] += d.y * d.y; e[5] += d.y * d.z; e[8] += d.z * d.z;
  }
  e[3] = e[1]; e[6] = e[2]; e[7] = e[5];
  const v = new THREE.Vector3(1, 0.3, 0.1);
  for (let i = 0; i < 30; i++) v.applyMatrix3(m).normalize();
  return v;
}

function init(text: string): void {
  const st = parsePDB(text);
  const prot = st.atoms.filter((a) => !a.het);
  if (prot.length === 0) throw new Error('no protein atoms');

  // ── ligand: requested residue name, else the largest non-solvent HET group
  const want = app.params.get('ligand')?.toUpperCase();
  const hetGroups = new Map<string, Atom[]>();
  for (const a of st.atoms) {
    if (!a.het || IGNORE_HET.has(a.resName) || a.element === 'H') continue;
    const k = `${a.resName}:${a.chain}:${a.resSeq}`;
    hetGroups.set(k, [...(hetGroups.get(k) ?? []), a]);
  }
  const groups = [...hetGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  const pick = (want && groups.find(([k]) => k.startsWith(want + ':'))) || groups[0];
  if (!pick) throw new Error('no ligand found (HETATM)');
  const lig = pick[1];
  hud.ligandName = lig[0].resName === 'MK1' ? 'INDINAVIR (MK1)' : lig[0].resName;
  const header = text.match(/^COMPND\s+\d*\s*MOLECULE: (.+?);?\s*$/m);
  hud.target = header ? header[1].replace(/;$/, '').trim() : 'TARGET PROTEIN';
  const idm = text.match(/^HEADER.{56}(\w{4})/m);
  hud.pdbId = idm ? idm[1] : pdbPath.split('/').pop()!.replace(/\.pdb$/i, '').toUpperCase();
  const counts: Record<string, number> = {};
  lig.forEach((a) => (counts[a.element] = (counts[a.element] ?? 0) + 1));
  const mass: Record<string, number> = { C: 12.011, N: 14.007, O: 15.999, S: 32.06, P: 30.974, F: 18.998, CL: 35.45 };
  // heavy-atom formula + implicit hydrogens for indinavir (C36H47N5O4)
  const hCount = lig[0].resName === 'MK1' ? 47 : 0;
  hud.formula = ['C', 'H', 'N', 'O', 'S', 'P'].map((e) => (e === 'H' ? (hCount ? `H${hCount}` : '') : counts[e] ? `${e}${counts[e] > 1 ? counts[e] : ''}` : '')).join('');
  hud.mw = lig.reduce((s, a) => s + (mass[a.element] ?? 12), 0) + hCount * 1.008;

  // ── recentre everything on the protein centroid
  const center = prot.reduce((s, a) => s.add(v3(a)), new THREE.Vector3()).divideScalar(prot.length);
  const P = (a: Atom) => v3(a).sub(center);
  const ligPos = lig.map(P);
  const ligC = ligPos.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(ligPos.length);
  const ligLocal = ligPos.map((p) => p.clone().sub(ligC));

  // ── flaps (HIV protease residues 43–58 of each chain) open along "up"
  const chains = residuesByChain(prot, st.ss).map((ch) => ch.map((r) => ({ ...r, ca: r.ca.clone().sub(center), c: r.c?.clone().sub(center), o: r.o?.clone().sub(center) })));
  const tips = chains.map((ch) => ch.find((r) => r.seq === 50)).filter(Boolean) as Residue[];
  const isProtease = tips.length === 2 && tips.every((r) => r.name === 'ILE');
  const up = isProtease
    ? tips.reduce((s, r) => s.add(r.ca.clone().sub(ligC).normalize()), new THREE.Vector3()).normalize()
    : ligC.clone().normalize();
  const flapDisp = new Map<string, THREE.Vector3>();
  if (isProtease) {
    for (const r of tips) {
      const dir = r.ca.clone().sub(ligC).normalize().lerp(up, 0.5).normalize();
      for (let s = 43; s <= 58; s++) {
        const w = Math.pow(Math.sin((Math.PI * (s - 42)) / 17), 1.5);
        flapDisp.set(`${r.chain}${s}`, dir.clone().multiplyScalar(5.5 * w));
      }
    }
  }
  const ZERO = new THREE.Vector3();
  const dispOf = (chain: string, seq: number) => flapDisp.get(`${chain}${seq}`) ?? ZERO;

  // ── cartoon
  const chainCol = [new THREE.Color('#12b9d8'), new THREE.Color('#6f7dff')];
  const chainIndex = new Map(chains.map((c, i) => [c[0]?.chain, i]));
  const helixCol = new THREE.Color(colors.magenta);
  const cartoonGeo = buildCartoon(chains, {
    subdiv: high ? 10 : 5,
    radial: high ? 14 : 8,
    color: (r) => {
      const base = chainCol[(chainIndex.get(r.chain) ?? 0) % 2];
      if (r.ss === 'H') return helixCol;
      return r.ss === 'E' ? base : base.clone().multiplyScalar(0.55);
    },
    disp: (r) => dispOf(r.chain, r.seq),
  });
  const cartoonMat = holoMaterial({ vertexColors: true, displace: true, intensity: 0.5, rim: 0.55, fog: [110, 190], opacity: 0.82, rimOpacity: 0.18, depthWrite: true });
  const cartoon = new THREE.Mesh(cartoonGeo, cartoonMat);
  app.scene.add(cartoon);

  // ── dotted vdW surface (buried dots removed with a spatial hash)
  const near = (p: THREE.Vector3, list: THREE.Vector3[], r: number) => list.some((q) => q.distanceToSquared(p) < r * r);
  const protPos = prot.map(P);
  const cell = 4;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  protPos.forEach((p, i) => {
    const k = key(p.x, p.y, p.z);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  const sph = spherePoints(high ? 18 : 9);
  const dotPos: number[] = [];
  const dotDisp: number[] = [];
  const dotPocket: number[] = [];
  const tmp = new THREE.Vector3();
  protPos.forEach((p, i) => {
    const a = prot[i];
    const r = VDW[a.element] ?? 1.7;
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    const nb: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) nb.push(...(grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []));
    const pocket = near(p, ligPos, 4.6) ? 1 : 0;
    const d = dispOf(a.chain, a.resSeq);
    for (const s of sph) {
      tmp.copy(s).multiplyScalar(r).add(p);
      let buried = false;
      for (const j of nb) {
        if (j === i) continue;
        const rj = VDW[prot[j].element] ?? 1.7;
        if (protPos[j].distanceToSquared(tmp) < rj * rj * 0.98) {
          buried = true;
          break;
        }
      }
      if (buried) continue;
      dotPos.push(tmp.x, tmp.y, tmp.z);
      dotDisp.push(d.x, d.y, d.z);
      dotPocket.push(pocket);
    }
  });
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3));
  dotGeo.setAttribute('aDisp', new THREE.Float32BufferAttribute(dotDisp, 3));
  dotGeo.setAttribute('aPocket', new THREE.Float32BufferAttribute(dotPocket, 1));
  const dotMat = new THREE.ShaderMaterial({
    uniforms: {
      uDisp: { value: 1 },
      uTime: { value: 0 },
      uSize: { value: high ? 2.6 : 3.0 },
      uPixelRatio: { value: app.pixelRatio },
      uPocketGlow: { value: 0 },
      uColor: { value: new THREE.Color(colors.cyan).multiplyScalar(0.8) },
      uPocketColor: { value: new THREE.Color(colors.amber) },
      uFog: { value: new THREE.Vector2(100, 180) },
    },
    vertexShader: dotsVert,
    fragmentShader: dotsFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dots = new THREE.Points(dotGeo, dotMat);
  dots.frustumCulled = false;
  app.scene.add(dots);

  // ── pocket residues as thin sticks (side chains + CA)
  const pocketRes = new Set<string>();
  prot.forEach((a, i) => near(protPos[i], ligPos, 4.2) && pocketRes.add(`${a.chain}${a.resSeq}`));
  const pocketAtoms = prot.filter((a) => pocketRes.has(`${a.chain}${a.resSeq}`) && !['N', 'C', 'O'].includes(a.name));
  const pocketBase = pocketAtoms.map(P);
  const pocketBonds: Array<[number, number]> = [];
  for (let i = 0; i < pocketAtoms.length; i++)
    for (let j = i + 1; j < pocketAtoms.length; j++)
      if (pocketAtoms[i].chain === pocketAtoms[j].chain && pocketAtoms[i].resSeq === pocketAtoms[j].resSeq && pocketBase[i].distanceTo(pocketBase[j]) < 1.9)
        pocketBonds.push([i, j]);
  const pocketSticks = new BallStick(pocketAtoms.map((a) => a.element), pocketBonds, {
    atomRadius: () => 0.2,
    bondRadius: 0.1,
    color: (el) => (el === 'C' ? new THREE.Color('#4a86a8') : elColor(el).multiplyScalar(0.8)),
    intensity: 0.45,
    detail: 1,
  });
  app.scene.add(pocketSticks.group);
  const pocketPos = pocketBase.map((p) => p.clone());

  // ── ligand
  const ligBonds = inferBonds(lig, st.conect);
  const ligand = new BallStick(lig.map((a) => a.element), ligBonds, {
    atomRadius: (el) => (el === 'C' ? 0.42 : 0.5),
    bondRadius: 0.16,
    color: elColor,
    intensity: 1.25,
    detail: high ? 2 : 1,
    transparent: true,
  });
  ligand.update(ligLocal);
  const ligGroup = new THREE.Group();
  ligGroup.add(ligand.group, ligand.createGhost(0.28));
  app.scene.add(ligGroup);

  // ── hydrogen bonds: ligand N/O ↔ protein N/O (or bridging water) within 2.5–3.3 Å
  const waters = st.atoms.filter((a) => a.het && (a.resName === 'HOH' || a.resName === 'WAT')).map((a) => ({ a, p: P(a) }));
  const polarProt = prot.map((a, i) => ({ a, p: protPos[i] })).filter((x) => x.a.element === 'N' || x.a.element === 'O');
  /** li = ligand atom index (-1 for water→protein bonds, which start at `from`). */
  interface HB { li: number; partner: THREE.Vector3; disp: THREE.Vector3; label: string; dist: number; water: boolean; from?: THREE.Vector3 }
  const hbs: HB[] = [];
  const prime = (c: string) => (c === chains[1]?.[0]?.chain ? '′' : '');
  lig.forEach((a, li) => {
    if (a.element !== 'N' && a.element !== 'O') return;
    for (const x of polarProt) {
      const d = x.p.distanceTo(ligPos[li]);
      if (d > 2.5 && d < 3.3) hbs.push({ li, partner: x.p, disp: dispOf(x.a.chain, x.a.resSeq), label: `${x.a.resName}${x.a.resSeq}${prime(x.a.chain)} ${x.a.name}`, dist: d, water: false });
    }
    for (const w of waters) {
      const d = w.p.distanceTo(ligPos[li]);
      if (d > 2.5 && d < 3.3 && polarProt.some((x) => x.p.distanceTo(w.p) < 3.3)) hbs.push({ li, partner: w.p, disp: ZERO, label: `HOH${w.a.resSeq}`, dist: d, water: true });
    }
  });
  hbs.sort((a, b) => a.dist - b.dist);
  const hbList = hbs.slice(0, 7);
  // bridging waters (e.g. the "flap water" W301 in HIV PR) + their protein contacts
  const bridge = [...new Set(hbList.filter((h) => h.water).map((h) => h.partner))];
  const waterMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 1), holoMaterial({ color: '#dff6ff', intensity: 1.2, rim: 1.2, transparent: true, opacity: 1 }), Math.max(1, bridge.length));
  bridge.forEach((p, i) => waterMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  waterMesh.count = bridge.length;
  app.scene.add(waterMesh);
  for (const w of bridge) {
    for (const x of polarProt) {
      const d = x.p.distanceTo(w);
      if (d > 2.5 && d < 3.3 && hbList.length < 10) hbList.push({ li: -1, partner: x.p, disp: dispOf(x.a.chain, x.a.resSeq), label: `${x.a.resName}${x.a.resSeq}${prime(x.a.chain)} ${x.a.name}`, dist: d, water: true, from: w });
    }
  }
  const DOTS_PER = 9;
  const hbDots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 1), holoMaterial({ color: colors.amber, intensity: 2.2, rim: 0.5 }), hbList.length * DOTS_PER);
  hbDots.frustumCulled = false;
  app.scene.add(hbDots);

  // ── shockwave ring at the moment of binding
  const shockMat = new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(colors.amber) } },
    vertexShader: shockVert,
    fragmentShader: shockFrag,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const shock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shockMat);
  shock.position.copy(ligC);
  app.scene.add(shock);

  // ── dust
  const dust = createDust({ count: high ? 900 : 300, box: [70, 45, 45], color: colors.cyan, size: 3, focus: 108, aperture: 0.025, drift: 2 });
  app.scene.add(dust);

  // ── camera basis: flaps up, then pick the azimuth around "up" from which the
  //    ligand is least occluded (count protein atoms near the ligand→camera rays)
  const L = principalAxis(ligPos);
  L.addScaledVector(up, -L.dot(up)).normalize();
  const baseDir = new THREE.Vector3().crossVectors(up, L).normalize();
  const occlusion = (d: THREE.Vector3) => {
    let hits = 0;
    const seg = new THREE.Vector3();
    for (let i = 0; i < ligPos.length; i += 2) {
      for (const q of protPos) {
        seg.subVectors(q, ligPos[i]);
        const along = seg.dot(d);
        if (along < 1 || along > 45) continue;
        if (seg.lengthSq() - along * along < 9) hits++;
      }
    }
    return hits;
  };
  let viewDir = baseDir.clone();
  let best = Infinity;
  for (let k = 0; k < 24; k++) {
    for (const el of [0.15, 0.4]) {
      const d = baseDir.clone().applyAxisAngle(up, (k / 24) * Math.PI * 2);
      d.applyAxisAngle(new THREE.Vector3().crossVectors(d, up).normalize(), -el);
      // prefer views close to the textbook one (ligand across the screen)
      const score = occlusion(d) * (1.2 - 0.2 * Math.abs(d.dot(baseDir)));
      if (score < best) {
        best = score;
        viewDir = baseDir.clone().applyAxisAngle(up, (k / 24) * Math.PI * 2);
      }
    }
  }
  const target = ligC.clone().multiplyScalar(0.85);
  const camDist = 108;
  app.onResize = (w, h) => {
    // narrow screens: widen the vertical FOV (keeps the fog ranges valid)
    const aspect = w / h;
    const hTan = Math.tan(THREE.MathUtils.degToRad(15)) * 1.25;
    camera.fov = aspect < 1.25 ? THREE.MathUtils.radToDeg(2 * Math.atan(hTan / aspect)) : 30;
    camera.updateProjectionMatrix();
    dotMat.uniforms.uPixelRatio.value = app.pixelRatio;
    dust.material.uniforms.uPixelRatio.value = app.pixelRatio;
  };
  app.onResize(app.width, app.height);

  // ─────────────────────────── docking timeline ───────────────────────────
  const T_APP = 3.0, NPOSE = 5, T_POSE = 1.55, T_SNAP = 1.3, T_BOUND = 6.2, T_RESET = 2.0;
  const T_SEARCH = NPOSE * T_POSE;
  const CYCLE = T_APP + T_SEARCH + T_SNAP + T_BOUND + T_RESET;
  hud.poses = NPOSE;

  interface Pose { pos: THREE.Vector3; rot: THREE.Quaternion }
  const perp = new THREE.Vector3().crossVectors(up, viewDir).normalize();
  let poses: Pose[] = [];
  let start: Pose = { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
  let cycleNo = -1;
  const crystal: Pose = { pos: ligC.clone(), rot: new THREE.Quaternion() };

  function planCycle(n: number): void {
    const r = rng(1000 + n * 17);
    const rq = (angle: number) =>
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), angle);
    start = {
      pos: ligC.clone().addScaledVector(up, 34).addScaledVector(perp, (r() - 0.5) * 30).addScaledVector(viewDir, 8),
      rot: rq(Math.PI * (0.5 + r())),
    };
    poses = Array.from({ length: NPOSE }, (_, k) => {
      const f = k / (NPOSE - 1);
      const mag = THREE.MathUtils.lerp(8.5, 2.2, f);
      const side = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      return {
        pos: ligC.clone().addScaledVector(up, mag * 0.75).addScaledVector(side, mag * 0.55),
        rot: rq(THREE.MathUtils.lerp(2.6, 0.45, f) * (0.7 + 0.3 * r())),
      };
    });
  }

  const cur: Pose = { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
  const lerpPose = (a: Pose, b: Pose, t: number, out: Pose) => {
    out.pos.copy(a.pos).lerp(b.pos, t);
    out.rot.copy(a.rot).slerp(b.rot, t);
    return out;
  };
  const world = ligLocal.map(() => new THREE.Vector3());
  const rmsdOf = (pose: Pose) => {
    let s = 0;
    ligLocal.forEach((p, i) => {
      world[i].copy(p).applyQuaternion(pose.rot).add(pose.pos);
      s += world[i].distanceToSquared(ligPos[i]);
    });
    return Math.sqrt(s / ligLocal.length);
  };

  let sampleT = 0;
  let dGs = 0;
  let noise = 0;
  const jitter = new THREE.Vector3();
  const jq = new THREE.Quaternion();
  const hbFrom = new THREE.Vector3();
  const hbTo = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const labelAnchors = hbList.map((h) => h.partner);

  app.update = (dt, t) => {
    const m = app.motion;
    const n = Math.floor(t / CYCLE);
    const ct = t - n * CYCLE;
    if (n !== cycleNo) {
      cycleNo = n;
      planCycle(n);
      hud.history = [];
      hud.run = n + 1;
      sampleT = 0;
    }
    let flap = 1;
    let opacity = 1;
    let poseIdx = 0;
    let bound = 0;
    let shockP = 0;
    if (ct < T_APP) {
      hud.stage = 'APPROACH';
      const e = easeInOutCubic(ct / T_APP);
      lerpPose(start, poses[0], e, cur);
      cur.rot.multiply(jq.setFromAxisAngle(up, (1 - e) * 2.5));
      opacity = smoothstep(0, 0.6, ct);
    } else if (ct < T_APP + T_SEARCH) {
      hud.stage = 'POSE SEARCH';
      const st2 = ct - T_APP;
      poseIdx = Math.min(NPOSE - 1, Math.floor(st2 / T_POSE));
      const local = st2 - poseIdx * T_POSE;
      const prev = poseIdx === 0 ? poses[0] : poses[poseIdx - 1];
      lerpPose(prev, poses[poseIdx], easeInOutCubic(local / 0.55), cur);
      // thermal jitter while a pose is being scored
      jitter.set(Math.sin(t * 23.1), Math.sin(t * 19.7 + 1), Math.sin(t * 17.3 + 2)).multiplyScalar(0.18 * m);
      cur.pos.add(jitter);
      cur.rot.multiply(jq.setFromAxisAngle(perp, Math.sin(t * 13) * 0.05 * m));
      hud.sampled += Math.round(dt * 900 * (0.6 + Math.random() * 0.8));
    } else if (ct < T_APP + T_SEARCH + T_SNAP) {
      hud.stage = 'REFINING';
      poseIdx = NPOSE - 1;
      const k = (ct - T_APP - T_SEARCH) / T_SNAP;
      lerpPose(poses[NPOSE - 1], crystal, easeOutBack(clamp(k / 0.7), 1.2), cur);
      flap = 1 - easeInOutCubic(k * 1.1);
      bound = smoothstep(0.55, 1, k);
      shockP = smoothstep(0.55, 1, k);
    } else if (ct < T_APP + T_SEARCH + T_SNAP + T_BOUND) {
      hud.stage = 'BOUND';
      poseIdx = NPOSE - 1;
      const k = ct - T_APP - T_SEARCH - T_SNAP;
      lerpPose(crystal, crystal, 0, cur);
      cur.pos.addScaledVector(jitter.set(Math.sin(t * 9), Math.sin(t * 7.3), Math.sin(t * 8.1)), 0.04 * m);
      flap = 0;
      bound = 1;
      shockP = 1 + k;
    } else {
      hud.stage = 'RESET';
      poseIdx = NPOSE - 1;
      const k = (ct - T_APP - T_SEARCH - T_SNAP - T_BOUND) / T_RESET;
      lerpPose(crystal, crystal, 0, cur);
      cur.pos.addScaledVector(up, easeInOutCubic(k) * 6);
      flap = easeInOutCubic(k);
      opacity = 1 - smoothstep(0, 0.6, k);
      bound = 1 - smoothstep(0, 0.5, k);
    }
    hud.pose = poseIdx + 1;
    hud.bound = bound;

    // apply ligand pose
    ligGroup.position.copy(cur.pos);
    ligGroup.quaternion.copy(cur.rot);
    ligand.setOpacity(opacity);
    if (ligand.ghostMat) ligand.ghostMat.uniforms.uIntensity.value = 0.16 * opacity * (1 - 0.5 * bound);
    ligand.setIntensity(0.95 + bound * 0.15 + (hud.stage === 'REFINING' ? 0.35 * Math.max(0, Math.sin(t * 30)) : 0));

    // flaps + pocket
    cartoonMat.uniforms.uDisp.value = flap;
    dotMat.uniforms.uDisp.value = flap;
    dotMat.uniforms.uTime.value = t;
    dotMat.uniforms.uPocketGlow.value = bound * (0.75 + 0.25 * Math.sin(t * 3));
    pocketAtoms.forEach((a, i) => pocketPos[i].copy(pocketBase[i]).addScaledVector(dispOf(a.chain, a.resSeq), flap));
    pocketSticks.update(pocketPos);
    pocketSticks.setIntensity(0.4 + bound * 0.35);

    // score
    const rmsd = rmsdOf(cur);
    noise = damp(noise, (Math.random() - 0.5) * 0.9, 6, dt);
    const scoreTarget = -1.2 - 8.3 * Math.exp(-(rmsd * rmsd) / 18) + noise * (1 - bound) * (opacity > 0.5 ? 1 : 0);
    dGs = damp(dGs, opacity > 0.05 ? scoreTarget : 0, hud.stage === 'RESET' ? 3 : 8, dt);
    hud.dG = dGs;
    hud.rmsd = rmsd;
    sampleT += dt;
    if (sampleT > 0.1 && hud.stage !== 'RESET') {
      sampleT = 0;
      hud.history.push(dGs);
      if (hud.history.length > 160) hud.history.shift();
    }

    // H-bonds appear one after another once bound
    const boundT = ct - (T_APP + T_SEARCH + T_SNAP);
    let shown = 0;
    hbList.forEach((h, k) => {
      const vis = hud.stage === 'BOUND' ? smoothstep(0.2 + k * 0.28, 0.5 + k * 0.28, boundT) : hud.stage === 'RESET' ? bound : 0;
      if (vis > 0.5) shown++;
      if (h.from) hbFrom.copy(h.from);
      else hbFrom.copy(ligLocal[h.li]).applyQuaternion(cur.rot).add(cur.pos);
      hbTo.copy(h.partner).addScaledVector(h.disp, flap);
      for (let d = 0; d < DOTS_PER; d++) {
        const f = (d + 0.5) / DOTS_PER;
        const p = hbFrom.clone().lerp(hbTo, f);
        const sc = vis * (f <= vis ? 1 : 0);
        mtx.makeScale(sc, sc, sc).setPosition(p);
        hbDots.setMatrixAt(k * DOTS_PER + d, mtx);
      }
    });
    hbDots.instanceMatrix.needsUpdate = true;
    hud.hbonds = shown;
    waterMesh.visible = bound > 0.05;
    waterMesh.scale.setScalar(1);
    (waterMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = bound;

    // shockwave billboard
    shock.quaternion.copy(camera.quaternion);
    const sp = clamp(shockP - 0.0);
    shock.scale.setScalar(4 + easeOutCubic(sp) * 34);
    shockMat.uniforms.uProgress.value = shockP > 0 && shockP < 1.6 ? sp : 0;

    // camera: gentle orbit around the "up" axis
    const az = Math.sin(t * 0.07) * 0.32 * m;
    const el = 0.32 + Math.sin(t * 0.05) * 0.1 * m;
    const dir = viewDir.clone().applyAxisAngle(up, az);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    dir.applyAxisAngle(side, -el);
    camera.position.copy(target).addScaledVector(dir, camDist);
    camera.up.copy(up);
    camera.lookAt(target);
    backdrop.update(camera, t, 300);
    dust.material.uniforms.uTime.value = t;

    // HUD anchors
    app.scene.updateMatrixWorld();
    hud.time = t;
    hud.labels = hbList.map((h, k) => {
      const p = labelAnchors[k].clone().addScaledVector(h.disp, flap).project(camera);
      return {
        text: h.label,
        dist: h.dist,
        x: (p.x * 0.5 + 0.5) * app.width,
        y: (-p.y * 0.5 + 0.5) * app.height,
        alpha: hud.stage === 'BOUND' ? smoothstep(0.4 + k * 0.28, 0.8 + k * 0.28, boundT) : hud.stage === 'RESET' ? bound : 0,
      };
    });
    const lp = cur.pos.clone().project(camera);
    hud.ligandScreen = { x: (lp.x * 0.5 + 0.5) * app.width, y: (-lp.y * 0.5 + 0.5) * app.height };
  };
  hud.ready = true;
}
