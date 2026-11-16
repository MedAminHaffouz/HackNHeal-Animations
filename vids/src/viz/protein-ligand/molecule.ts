/**
 * Ball-and-stick renderer built from two InstancedMeshes (atoms + half-bonds).
 * Half-bonds are coloured by the atom they start from, like CPK viewers do.
 */
import * as THREE from 'three';
import { holoMaterial } from '../../shared/materials';

export interface BallStickOptions {
  atomRadius: (el: string) => number;
  bondRadius: number;
  color: (el: string) => THREE.Color;
  intensity?: number;
  detail?: number;
  transparent?: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

export class BallStick {
  readonly group = new THREE.Group();
  readonly atoms: THREE.InstancedMesh;
  readonly bonds: THREE.InstancedMesh;
  readonly atomMat: THREE.ShaderMaterial;
  readonly bondMat: THREE.ShaderMaterial;
  private elements: string[];
  private pairs: Array<[number, number]>;
  private o: BallStickOptions;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(elements: string[], pairs: Array<[number, number]>, o: BallStickOptions) {
    this.elements = elements;
    this.pairs = pairs;
    this.o = o;
    const transparent = o.transparent ?? false;
    this.atomMat = holoMaterial({ intensity: o.intensity ?? 1, rim: 1.1, transparent, opacity: 1, depthWrite: true, fog: [120, 220] });
    this.bondMat = holoMaterial({ intensity: (o.intensity ?? 1) * 0.85, rim: 0.8, transparent, opacity: 1, depthWrite: true, fog: [120, 220] });
    this.atoms = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, o.detail ?? 2), this.atomMat, elements.length);
    this.bonds = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), this.bondMat, Math.max(1, pairs.length * 2));
    this.atoms.frustumCulled = false;
    this.bonds.frustumCulled = false;
    elements.forEach((el, i) => this.atoms.setColorAt(i, o.color(el)));
    pairs.forEach(([a, b], k) => {
      this.bonds.setColorAt(k * 2, o.color(elements[a]));
      this.bonds.setColorAt(k * 2 + 1, o.color(elements[b]));
    });
    this.group.add(this.bonds, this.atoms);
  }

  /** Lay out all instances from an array of positions (local to `group`). */
  update(positions: THREE.Vector3[]): void {
    const { m, q, v, s } = this;
    positions.forEach((p, i) => {
      const r = this.o.atomRadius(this.elements[i]);
      m.compose(p, q.identity(), s.set(r, r, r));
      this.atoms.setMatrixAt(i, m);
    });
    this.pairs.forEach(([a, b], k) => {
      const pa = positions[a];
      const pb = positions[b];
      const mid = v.copy(pa).add(pb).multiplyScalar(0.5);
      this.halfBond(k * 2, pa, mid);
      this.halfBond(k * 2 + 1, pb, mid);
    });
    this.atoms.instanceMatrix.needsUpdate = true;
    this.bonds.instanceMatrix.needsUpdate = true;
  }

  private halfBond(i: number, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    this.q.setFromUnitVectors(UP, dir.divideScalar(len || 1));
    const c = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    this.m.compose(c, this.q, this.s.set(this.o.bondRadius, len, this.o.bondRadius));
    this.bonds.setMatrixAt(i, this.m);
  }

  /**
   * "X-ray" copy that ignores depth, so the molecule stays readable when the
   * protein is in front of it. Shares instance buffers with the solid one.
   */
  createGhost(intensity = 0.3): THREE.Group {
    const g = new THREE.Group();
    const mat = holoMaterial({ intensity, rim: 0.6, additive: true, transparent: true, opacity: 1, depthWrite: false });
    mat.depthTest = false;
    const atoms = new THREE.InstancedMesh(this.atoms.geometry, mat, this.atoms.count);
    const bonds = new THREE.InstancedMesh(this.bonds.geometry, mat, this.bonds.count);
    for (const [ghost, solid] of [[atoms, this.atoms], [bonds, this.bonds]] as const) {
      ghost.instanceMatrix = solid.instanceMatrix;
      ghost.instanceColor = solid.instanceColor;
      ghost.frustumCulled = false;
      ghost.renderOrder = 5;
    }
    g.add(bonds, atoms);
    this.ghostMat = mat;
    return g;
  }
  ghostMat: THREE.ShaderMaterial | null = null;

  setIntensity(k: number): void {
    this.atomMat.uniforms.uIntensity.value = k;
    this.bondMat.uniforms.uIntensity.value = k * 0.85;
  }

  setOpacity(a: number): void {
    this.atomMat.uniforms.uOpacity.value = a;
    this.bondMat.uniforms.uOpacity.value = a;
    this.group.visible = a > 0.01;
  }
}

/** Golden-spiral unit sphere points (for dot surfaces). */
export function spherePoints(n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    pts.push(new THREE.Vector3(Math.cos(i * ga) * r, y, Math.sin(i * ga) * r));
  }
  return pts;
}
