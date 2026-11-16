/**
 * Procedural B-DNA geometry.
 *
 * Units: 1 scene unit = 1 nm. The helix axis is local +X.
 *   rise          0.338 nm / bp
 *   twist         360° / 10.5 = 34.29° per bp (right-handed)
 *   P radius      ~1.0 nm (phosphate backbone)
 *   grooves       the two strands are NOT 180° apart: strand B is offset
 *                 by ~0.38 of a turn, which opens a narrow minor groove
 *                 (~12 Å) and a wide major groove (~22 Å).
 */
import * as THREE from 'three';

export const BDNA = {
  rise: 0.338,
  bpPerTurn: 10.5,
  radius: 1.0,
  /** Fraction of a turn between the strands across the minor groove. */
  minorFrac: 0.38,
  /** Radius at which bases attach (C1' of the sugar). */
  baseRadius: 0.9,
} as const;

export const TWIST = (Math.PI * 2) / BDNA.bpPerTurn;
export const STRAND_OFFSET = BDNA.minorFrac * Math.PI * 2;

/** Unzip bubble, shared by CPU (instances) and GPU (backbone tube). */
export interface Unzip {
  center: number;
  halfWidth: number;
  amount: number;
  sep: number;
}

/** Must match unzip() in backbone.vert.glsl. */
export function unzipAt(u: Unzip, x: number): number {
  const d = Math.abs(x - u.center);
  const a = u.halfWidth * 0.45;
  const b = u.halfWidth;
  const t = Math.min(1, Math.max(0, (d - a) / (b - a)));
  return u.amount * (1 - t * t * (3 - 2 * t)) * u.sep;
}

export class HelixModel {
  readonly count: number;
  constructor(count: number) {
    this.count = count;
  }
  /** Local x of base pair i (helix centred on the origin). */
  x(i: number): number {
    return (i - (this.count - 1) / 2) * BDNA.rise;
  }
  angle(i: number, strand: 0 | 1): number {
    return i * TWIST + (strand ? STRAND_OFFSET : 0);
  }
  /** Point on a strand at (fractional) base-pair index i and radius r. */
  point(i: number, strand: 0 | 1, r: number = BDNA.radius, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.angle(i, strand);
    return out.set(this.x(i), r * Math.cos(a), r * Math.sin(a));
  }
}

/** THREE.Curve following one backbone, extended slightly past the ends. */
export class StrandCurve extends THREE.Curve<THREE.Vector3> {
  private m: HelixModel;
  private strand: 0 | 1;
  private pad: number;
  constructor(m: HelixModel, strand: 0 | 1, pad = 1.5) {
    super();
    this.m = m;
    this.strand = strand;
    this.pad = pad;
  }
  getPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const i = -this.pad + t * (this.m.count - 1 + 2 * this.pad);
    return this.m.point(i, this.strand, BDNA.radius, out);
  }
}

/**
 * Position + orientation of one half of a base pair ("rung").
 * The pair spans the chord between the two C1' attachment points; purines
 * (A, G) take ~56% of it, pyrimidines (C, T) ~44%, with a small gap for the
 * hydrogen bonds in between.
 */
export function rungMatrix(
  m: HelixModel,
  i: number,
  strand: 0 | 1,
  purine: boolean,
  unzip: Unzip,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const x = m.x(i);
  const pa = m.point(i, 0, BDNA.baseRadius);
  const pb = m.point(i, 1, BDNA.baseRadius);
  // separate along each strand's own radial direction
  const push = unzipAt(unzip, x);
  const aA = m.angle(i, 0);
  const aB = m.angle(i, 1);
  pa.y += Math.cos(aA) * push;
  pa.z += Math.sin(aA) * push;
  pb.y += Math.cos(aB) * push;
  pb.z += Math.sin(aB) * push;

  const from = strand === 0 ? pa : pb;
  const to = strand === 0 ? pb : pa;
  const chord = new THREE.Vector3().subVectors(to, from);
  const full = chord.length();
  const dir = chord.divideScalar(full);
  const gap = 0.07;
  const frac = purine ? 0.56 : 0.44;
  // if strands are pulled apart, the bases stay roughly their natural length
  const natural = new THREE.Vector3().subVectors(m.point(i, 1, BDNA.baseRadius), m.point(i, 0, BDNA.baseRadius)).length();
  const len = Math.max(0.05, natural * frac - gap);
  const center = from.clone().addScaledVector(dir, len / 2 + 0.02);

  const axis = new THREE.Vector3(1, 0, 0);
  const width = new THREE.Vector3().crossVectors(dir, axis).normalize();
  // box: x = length along chord, y = thickness along helix axis, z = width
  out.makeBasis(dir.multiplyScalar(len), axis.multiplyScalar(0.11), width.multiplyScalar(0.34));
  out.setPosition(center);
  return out;
}
