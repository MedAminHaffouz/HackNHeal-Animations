/**
 * Cartoon (ribbon) geometry from a Cα trace.
 *
 *  - Catmull-Rom spline through Cα positions (β-strands are pre-smoothed to
 *    remove the pleat, as molecular viewers do).
 *  - Ribbon orientation from the peptide plane (C=O direction), flipped for
 *    continuity, so β-sheets lie flat and helices twist naturally.
 *  - Elliptical cross-section whose width/thickness depends on secondary
 *    structure: helix ribbon, β-strand with an arrowhead, thin coil tube.
 *
 * Extra attribute `aDisp` (vec3) carries a per-vertex displacement used to
 * animate the protease flaps opening/closing in the vertex shader.
 */
import * as THREE from 'three';
import type { Atom, SSRange } from './pdb';

export type SS = 'H' | 'E' | 'C';

export interface Residue {
  chain: string;
  seq: number;
  name: string;
  ca: THREE.Vector3;
  c?: THREE.Vector3;
  o?: THREE.Vector3;
  ss: SS;
}

/** Group protein (non-HET) atoms into residues per chain with SS assignment. */
export function residuesByChain(atoms: Atom[], ss: SSRange[]): Residue[][] {
  const chains = new Map<string, Map<number, Residue>>();
  for (const a of atoms) {
    if (a.het) continue;
    let ch = chains.get(a.chain);
    if (!ch) chains.set(a.chain, (ch = new Map()));
    let r = ch.get(a.resSeq);
    const v = new THREE.Vector3(a.x, a.y, a.z);
    if (!r) {
      if (a.name !== 'CA' && a.name !== 'C' && a.name !== 'O') continue;
      r = { chain: a.chain, seq: a.resSeq, name: a.resName, ca: v.clone(), ss: 'C' };
      ch.set(a.resSeq, r);
    }
    if (a.name === 'CA') r.ca = v;
    else if (a.name === 'C') r.c = v;
    else if (a.name === 'O') r.o = v;
  }
  const out: Residue[][] = [];
  for (const ch of chains.values()) {
    const list = [...ch.values()].sort((a, b) => a.seq - b.seq);
    for (const r of list) {
      const hit = ss.find((s) => s.chain === r.chain && r.seq >= s.start && r.seq <= s.end);
      if (hit) r.ss = hit.kind === 'helix' ? 'H' : 'E';
    }
    out.push(list);
  }
  return out;
}

export interface CartoonOptions {
  subdiv: number;
  radial: number;
  color: (r: Residue) => THREE.Color;
  disp: (r: Residue) => THREE.Vector3;
}

const PROFILE: Record<SS, [number, number]> = {
  H: [1.35, 0.26],
  E: [1.55, 0.28],
  C: [0.3, 0.3],
};

function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

export function buildCartoon(chains: Residue[][], o: CartoonOptions): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const colr: number[] = [];
  const disp: number[] = [];
  const idx: number[] = [];

  for (const res of chains) {
    const n = res.length;
    if (n < 2) continue;
    // 1. control points (straighten strands)
    const P = res.map((r, i) => {
      if (r.ss === 'E' && i > 0 && i < n - 1 && res[i - 1].ss === 'E' && res[i + 1].ss === 'E') {
        return r.ca.clone().multiplyScalar(0.5).addScaledVector(res[i - 1].ca, 0.25).addScaledVector(res[i + 1].ca, 0.25);
      }
      return r.ca.clone();
    });
    // 2. peptide-plane side vectors, flipped for continuity
    const D: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const r = res[i];
      const a = (i < n - 1 ? res[i + 1].ca.clone().sub(r.ca) : r.ca.clone().sub(res[i - 1].ca)).normalize();
      let d: THREE.Vector3;
      if (r.c && r.o) {
        const b = r.o.clone().sub(r.c);
        const c = new THREE.Vector3().crossVectors(a, b);
        d = new THREE.Vector3().crossVectors(c, a).normalize();
      } else {
        const prev = res[Math.max(0, i - 1)].ca;
        const next = res[Math.min(n - 1, i + 1)].ca;
        d = prev.clone().add(next).multiplyScalar(0.5).sub(r.ca).normalize();
      }
      if (!Number.isFinite(d.x) || d.lengthSq() < 1e-6) d = D[i - 1]?.clone() ?? new THREE.Vector3(0, 1, 0);
      if (i > 0 && d.dot(D[i - 1]) < 0) d.negate();
      D.push(d);
    }
    // 3. sample the spline
    const S = o.subdiv;
    const samples: Array<{ p: THREE.Vector3; side: THREE.Vector3; w: number; h: number; col: THREE.Color; disp: THREE.Vector3 }> = [];
    const isStrandEnd = (i: number) => res[i].ss === 'E' && (i === n - 1 || res[i + 1].ss !== 'E');
    for (let i = 0; i < n - 1; i++) {
      const last = i === n - 2;
      for (let j = 0; j <= (last ? S : S - 1); j++) {
        const t = j / S;
        const p = catmull(P[Math.max(0, i - 1)], P[i], P[i + 1], P[Math.min(n - 1, i + 2)], t, new THREE.Vector3());
        const side = D[i].clone().lerp(D[i + 1], t).normalize();
        const [w0, h0] = PROFILE[res[i].ss];
        const [w1, h1] = PROFILE[res[i + 1].ss];
        const k = THREE.MathUtils.smoothstep(t, 0.25, 0.75);
        let w = THREE.MathUtils.lerp(w0, w1, k);
        let h = THREE.MathUtils.lerp(h0, h1, k);
        if (isStrandEnd(i)) {
          // arrowhead: wide at the last strand residue, tapering to a point at the next one
          w = THREE.MathUtils.lerp(2.3, 0.25, t);
          h = PROFILE.E[1];
        } else if (res[i + 1].ss === 'E' && res[i].ss !== 'E') {
          w = THREE.MathUtils.lerp(w0, PROFILE.E[0], k);
        }
        const col = o.color(res[i]).clone().lerp(o.color(res[i + 1]), t);
        const dv = o.disp(res[i]).clone().lerp(o.disp(res[i + 1]), t);
        samples.push({ p, side, w, h, col, disp: dv });
      }
    }
    // 4. frames + rings
    const R = o.radial;
    const base = pos.length / 3;
    const T = new THREE.Vector3();
    const N = new THREE.Vector3();
    for (let k = 0; k < samples.length; k++) {
      const s = samples[k];
      const a = samples[Math.max(0, k - 1)].p;
      const b = samples[Math.min(samples.length - 1, k + 1)].p;
      T.subVectors(b, a).normalize();
      const side = s.side.clone().addScaledVector(T, -s.side.dot(T)).normalize();
      N.crossVectors(T, side).normalize();
      for (let r = 0; r < R; r++) {
        const th = (r / R) * Math.PI * 2;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        pos.push(
          s.p.x + side.x * c * s.w + N.x * sn * s.h,
          s.p.y + side.y * c * s.w + N.y * sn * s.h,
          s.p.z + side.z * c * s.w + N.z * sn * s.h,
        );
        const nx = side.x * (c / s.w) + N.x * (sn / s.h);
        const ny = side.y * (c / s.w) + N.y * (sn / s.h);
        const nz = side.z * (c / s.w) + N.z * (sn / s.h);
        const l = Math.hypot(nx, ny, nz) || 1;
        nrm.push(nx / l, ny / l, nz / l);
        colr.push(s.col.r, s.col.g, s.col.b);
        disp.push(s.disp.x, s.disp.y, s.disp.z);
      }
    }
    for (let k = 0; k < samples.length - 1; k++) {
      for (let r = 0; r < R; r++) {
        const a = base + k * R + r;
        const b = base + k * R + ((r + 1) % R);
        const c = a + R;
        const d = b + R;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('aDisp', new THREE.Float32BufferAttribute(disp, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
