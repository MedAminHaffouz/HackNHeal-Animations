/**
 * Case library for the retrieval demo.
 *
 * Real images: put PNG/JPGs in public/xray/ plus a manifest.json (see README
 * and public/xray/manifest.example.json). Without a manifest, every image
 * is generated procedurally by cxrGen.ts.
 */
import * as THREE from 'three';
import { assetUrl } from '../../shared/app';
import { generateCxr, type Finding } from './cxrGen';

/** Grad-CAM blob: centre (x, y) in image uv (y down), radius, weight. */
export type HeatBlob = [number, number, number, number];

export interface SimilarCase {
  label: string;
  score: number;
  id: string;
  image?: string;
  finding?: Finding;
  seed?: number;
}

export interface CaseDef {
  id: string;
  label: string;
  finding: string;
  prob: number;
  region: string;
  heat: HeatBlob[];
  similar: SimilarCase[];
  image?: string;
  gen?: Finding;
  seed?: number;
}

export const PROCEDURAL_CASES: CaseDef[] = [
  {
    id: 'CXR-26-0142', label: 'Pneumonia – RLL', finding: 'CONSOLIDATION', prob: 0.93, region: 'RLL', gen: 'pneumonia-rll', seed: 11,
    heat: [[0.3, 0.63, 0.11, 1], [0.36, 0.55, 0.06, 0.4]],
    similar: [
      { label: 'Pneumonia – RLL', score: 0.94, id: 'CXR-19-8812', finding: 'pneumonia-rll', seed: 101 },
      { label: 'Pneumonia – RML', score: 0.91, id: 'CXR-21-0457', finding: 'pneumonia-rml', seed: 102 },
      { label: 'Effusion – R', score: 0.88, id: 'CXR-20-3391', finding: 'effusion-r', seed: 103 },
    ],
  },
  {
    id: 'CXR-26-0187', label: 'Pleural effusion – L', finding: 'EFFUSION', prob: 0.95, region: 'L BASE', gen: 'effusion-l', seed: 12,
    heat: [[0.78, 0.7, 0.1, 1], [0.7, 0.74, 0.07, 0.6]],
    similar: [
      { label: 'Effusion – L', score: 0.95, id: 'CXR-18-2204', finding: 'effusion-l', seed: 111 },
      { label: 'Effusion – bilat.', score: 0.9, id: 'CXR-22-1189', finding: 'effusion-bilat', seed: 112 },
      { label: 'Cardiomegaly', score: 0.86, id: 'CXR-17-6630', finding: 'cardiomegaly', seed: 113 },
    ],
  },
  {
    id: 'CXR-26-0203', label: 'Cardiomegaly', finding: 'CARDIOMEGALY', prob: 0.91, region: 'CARDIAC', gen: 'cardiomegaly', seed: 13,
    heat: [[0.58, 0.6, 0.15, 1], [0.44, 0.6, 0.08, 0.5]],
    similar: [
      { label: 'Cardiomegaly', score: 0.93, id: 'CXR-20-7715', finding: 'cardiomegaly', seed: 121 },
      { label: 'Cardiomegaly + effusion', score: 0.89, id: 'CXR-19-0932', finding: 'cardiomegaly', seed: 122 },
      { label: 'Normal', score: 0.84, id: 'CXR-21-4471', finding: 'normal', seed: 123 },
    ],
  },
  {
    id: 'CXR-26-0219', label: 'Nodule – RUL', finding: 'NODULE', prob: 0.88, region: 'RUL', gen: 'nodule-rul', seed: 14,
    heat: [[0.32, 0.28, 0.06, 1]],
    similar: [
      { label: 'Nodule – RUL', score: 0.92, id: 'CXR-18-5520', finding: 'nodule-rul', seed: 131 },
      { label: 'Nodule – LUL', score: 0.88, id: 'CXR-22-0815', finding: 'nodule-lul', seed: 132 },
      { label: 'Normal', score: 0.85, id: 'CXR-20-2268', finding: 'normal', seed: 133 },
    ],
  },
  {
    id: 'CXR-26-0234', label: 'Pneumothorax – L', finding: 'PNEUMOTHORAX', prob: 0.9, region: 'L APEX', gen: 'pneumothorax-l', seed: 15,
    heat: [[0.81, 0.33, 0.09, 1], [0.78, 0.45, 0.06, 0.5]],
    similar: [
      { label: 'Pneumothorax – L', score: 0.93, id: 'CXR-19-3307', finding: 'pneumothorax-l', seed: 141 },
      { label: 'Normal', score: 0.87, id: 'CXR-21-9902', finding: 'normal', seed: 142 },
      { label: 'Nodule – LUL', score: 0.82, id: 'CXR-17-1146', finding: 'nodule-lul', seed: 143 },
    ],
  },
];

export interface LoadedCase {
  def: CaseDef;
  main: THREE.Texture;
  similar: THREE.Texture[];
}

function canvasTexture(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

const loader = new THREE.TextureLoader();
function imageTexture(url: string): Promise<THREE.Texture> {
  return new Promise((res, rej) =>
    loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      },
      undefined,
      rej,
    ),
  );
}

/** Try public/xray/manifest.json; resolve null if absent or invalid. */
export async function loadManifest(): Promise<CaseDef[] | null> {
  try {
    const r = await fetch(assetUrl('xray/manifest.json'), { cache: 'no-cache' });
    if (!r.ok) return null;
    const m = await r.json();
    const cases = (m.cases ?? []) as CaseDef[];
    if (!Array.isArray(cases) || !cases.length) return null;
    return cases.map((c, i) => ({
      id: c.id ?? `CXR-${String(i + 1).padStart(4, '0')}`,
      label: c.label ?? 'Finding',
      finding: (c.finding ?? c.label ?? 'FINDING').toUpperCase(),
      prob: c.prob ?? 0.9,
      region: c.region ?? '',
      heat: c.heat?.length ? c.heat : [[0.5, 0.5, 0.15, 1]],
      image: c.image,
      similar: (c.similar ?? []).slice(0, 3).map((s, k) => ({ ...s, id: s.id ?? `REF-${k + 1}` })),
    }));
  } catch {
    return null;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Build textures for one case (procedural or from files), one image per frame. */
export async function materialize(def: CaseDef, mainSize: number, thumbSize: number): Promise<LoadedCase> {
  await nextFrame();
  const main = def.image
    ? await imageTexture(assetUrl(`xray/${def.image}`))
    : canvasTexture(generateCxr({ size: mainSize, seed: def.seed ?? 1, finding: def.gen ?? 'normal' }));
  const similar: THREE.Texture[] = [];
  for (const s of def.similar) {
    await nextFrame();
    similar.push(
      s.image
        ? await imageTexture(assetUrl(`xray/${s.image}`))
        : canvasTexture(generateCxr({ size: thumbSize, seed: s.seed ?? 7, finding: s.finding ?? 'normal' })),
    );
  }
  return { def, main, similar };
}
