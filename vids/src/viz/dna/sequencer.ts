/**
 * Sequencing state machine: which bases exist, which were already "called"
 * by the read head, which positions carry a variant, plus running stats for
 * the HUD. No rendering here.
 */
import { rng } from '../../shared/math';

export type Base = 'A' | 'C' | 'G' | 'T';
export const COMPLEMENT: Record<Base, Base> = { A: 'T', T: 'A', G: 'C', C: 'G' };
export const PURINE: Record<Base, boolean> = { A: true, G: true, C: false, T: false };

export interface Called {
  base: Base;
  q: number; // Phred quality
  variant: boolean;
}

export interface VariantEvent {
  index: number; // base-pair index in the helix
  ref: Base;
  alt: Base;
  chrPos: number;
  qual: number;
  af: number; // allele fraction
  time: number; // when it was called
}

// BRCA1 spans roughly chr17:43,044,295–43,125,483 (GRCh38).
const LOCUS_START = 43_044_295;
const LOCUS_END = 43_125_483;

export class Sequencer {
  readonly count: number;
  bases: Base[] = [];
  variantAt = new Map<number, Base>(); // index → alt base
  /** 0..1 per base pair: how "revealed" its colour is. */
  reveal: Float32Array;
  called: Called[] = [];
  events: VariantEvent[] = [];
  totalCalled = 0;
  totalVariants = 0;
  readNo = 0;
  /** Genomic coordinate of base-pair index 0 for the current read. */
  readStart = LOCUS_START + 12_000;
  gc = 0;
  qSum = 0;
  comp: Record<Base, number> = { A: 0, C: 0, G: 0, T: 0 };
  private calledMask: Uint8Array;
  private rand: () => number;

  constructor(count: number, seed = 1337) {
    this.count = count;
    this.reveal = new Float32Array(count);
    this.calledMask = new Uint8Array(count);
    this.rand = rng(seed);
    this.newRead(0, count);
    this.readNo = 0; // the owner starts read #1 once it knows the visible span
  }

  /** Fresh random sequence (~41% GC, like the human genome) + 1–2 variants within [lo, hi). */
  newRead(lo: number, hi: number): void {
    const r = this.rand;
    this.readNo++;
    this.bases = Array.from({ length: this.count }, () => {
      const gc = r() < 0.41;
      return (gc ? (r() < 0.5 ? 'G' : 'C') : r() < 0.5 ? 'A' : 'T') as Base;
    });
    this.variantAt.clear();
    const nVar = r() < 0.55 ? 1 : 2;
    const span = Math.max(1, hi - lo);
    for (let k = 0; k < nVar; k++) {
      // spread variants into separate halves of the visible span
      const idx = lo + Math.floor(span * (0.2 + 0.6 * ((k + r()) / nVar)));
      const ref = this.bases[idx];
      const alts = (['A', 'C', 'G', 'T'] as Base[]).filter((b) => b !== ref);
      // transitions (A<->G, C<->T) are ~2x more common than transversions
      const ts: Record<Base, Base> = { A: 'G', G: 'A', C: 'T', T: 'C' };
      const alt = r() < 0.66 ? ts[ref] : alts[Math.floor(r() * 3)];
      this.variantAt.set(idx, alt);
    }
    this.calledMask.fill(0);
    this.readStart = LOCUS_START + Math.floor(r() * (LOCUS_END - LOCUS_START - this.count));
  }

  /** Base shown at an index (the alt allele if a variant sits there). */
  shown(i: number): Base {
    return this.variantAt.get(i) ?? this.bases[i];
  }

  isCalled(i: number): boolean {
    return this.calledMask[i] === 1;
  }

  /** Mark base pair i as called by the read head. Returns a variant event if any. */
  call(i: number, time: number): VariantEvent | null {
    if (i < 0 || i >= this.count || this.calledMask[i]) return null;
    this.calledMask[i] = 1;
    this.reveal[i] = 1;
    const r = this.rand;
    const alt = this.variantAt.get(i);
    const base = alt ?? this.bases[i];
    const q = Math.round(30 + r() * 10 - (r() < 0.06 ? 14 : 0));
    this.called.push({ base, q, variant: !!alt });
    if (this.called.length > 96) this.called.shift();
    this.totalCalled++;
    this.qSum += q;
    this.comp[base]++;
    if (base === 'G' || base === 'C') this.gc++;
    if (!alt) return null;
    this.totalVariants++;
    const ev: VariantEvent = {
      index: i,
      ref: this.bases[i],
      alt,
      chrPos: this.readStart + i,
      qual: Math.round(48 + r() * 40),
      af: 0.42 + r() * 0.16,
      time,
    };
    this.events.push(ev);
    if (this.events.length > 6) this.events.shift();
    return ev;
  }

  /** Fade every revealed base back to "unknown" (between reads). */
  fade(dt: number, rate: number): void {
    for (let i = 0; i < this.count; i++) this.reveal[i] = Math.max(0, this.reveal[i] - dt * rate);
  }
}
