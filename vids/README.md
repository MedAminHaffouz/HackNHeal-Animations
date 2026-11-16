# HackNHeal — visual systems

Four animated, scientifically grounded web visuals for **HackNHeal**, an AI × Bio/Health event by Android Club INSAT × Symbio INSAT. They're built for the website, projection screens and social clips, in a futuristic biotech HUD aesthetic.

| Page | Visual | Data |
|------|--------|------|
| `index.html` | Gallery with live previews, params and hotkeys reference | — |
| `dna.html` | **VIZ-01 DNA sequencing.** B-DNA helix with true major/minor grooves, a read head, a chromatogram + ACGT ticker, BRCA1-flavoured SNV calls, and strand separation | procedural |
| `protein.html` | **VIZ-02 Protein–ligand docking.** HIV-1 protease cartoon, indinavir pose search → snap → H-bonds, ΔG/RMSD/Ki HUD | **real PDB 1HSG** (bundled) |
| `mri.html` | **VIZ-03 MRI healthy vs glioma.** Synced raymarched 3D brains with a sweeping slice plane, T1/T2 slices, segmentation | procedural phantom, optional NIfTI |
| `xray.html` | **VIZ-04 Chest X-ray retrieval.** Scan → Grad-CAM → particles through embedding space → top-3 similar cases | procedural, optional real images |

Stack: Vite + vanilla TypeScript, Three.js (r187) with EffectComposer (UnrealBloom + a custom grain/chromatic-aberration pass), custom GLSL in separate `.glsl` files. No backend.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (gallery; each visual at /dna.html, /protein.html, …)
npm run build      # typecheck + static build into dist/
npm run preview    # serve dist/ locally
```

`dist/` is fully static, with relative paths. You can drop it on any host or sub-folder (GitHub Pages, Netlify, an S3 bucket, the event site). Serve it over HTTP rather than `file://`, because the PDB and the optional data files are fetched.

---

## URL parameters

Every visual accepts these:

| Param | Effect |
|-------|--------|
| `?bg=transparent` | Transparent canvas. Solid geometry keeps its alpha and glows are "unmultiplied", for OBS / compositing / overlays. |
| `?hud=0` | Clean render with no overlay text (MRI and X-ray layouts also use the freed margins). |
| `?speed=0.5` | Global time scale (`0`–`10`). |
| `?quality=low` / `high` | GPU budget. `low`: pixel ratio ≤ 1, no MSAA / aberration, half-res bloom, fewer particles and raymarch steps. Default `high`. |
| `?t=12` | Start the timeline at 12 s (handy for stills). |
| `?motion=full` / `reduced` | Override the OS `prefers-reduced-motion`. Reduced motion means 0.5× time, ~⅓ camera drift, static grain. |

Visual-specific:

| Visual | Param | Effect |
|--------|-------|--------|
| protein | `?pdb=pdb/xxxx.pdb` | Load another structure from `public/pdb/` |
| protein | `?ligand=RES` | Pick the ligand by HET residue name (default: largest non-solvent HET group) |
| mri | `?plane=axial\|sagittal\|coronal` | Slice plane (default axial) |
| mri | `?seq=t1\|t2` | Lock the sequence (default alternates each sweep) |
| mri | `?cycle=1` | Also rotate the slice plane every sweep |
| mri | `?nifti=mri/file.nii.gz` | Use a real T1 volume (see below) |

Params combine: `mri.html?hud=0&bg=transparent&quality=low&plane=coronal`.

## Hotkeys

| Key | Action |
|-----|--------|
| **R** | Start / stop a **WebM recording** of the canvas, HUD included (downloads on stop) |
| **S** | Save a **PNG at 2×** the current resolution, HUD included |
| **H** | Toggle HUD |
| **Space** | Pause / resume |
| **?** | On-screen help (lists the visual's own keys) |
| MRI **1 / 2 / 3** | Axial / sagittal / coronal |
| MRI **P** | Cycle plane |
| MRI **T** | Toggle T1 / T2 |
| X-ray **N** | Next case |

Recording tips:
- Use Chrome or Edge for the best WebM (VP9).
- Convert for socials with `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4`.
- For a 1080×1920 story, resize the browser window (or use DevTools device mode) to that aspect. Every visual has a portrait layout.

---

## Embed with an iframe

```html
<iframe src="https://your-site/hacknheal/dna.html?hud=0"
        style="width:100%; aspect-ratio:16/9; border:0"
        loading="lazy" title="HackNHeal DNA visual"></iframe>
```

- Over a page background: add `bg=transparent` and set `allowtransparency` / `background: transparent` on the iframe.
- In OBS: add a **Browser Source** pointing at e.g. `…/mri.html?bg=transparent&hud=0`. It composites with true alpha.
- Several visuals on one page? Use `quality=low` for the smaller ones. The gallery mounts its preview iframes only while they're on screen.

---

## Swap in real data

### Protein (PDB)
1. Put the file in `public/pdb/`, e.g. `public/pdb/3oxc.pdb` (download from https://www.rcsb.org; PDB entries are CC0).
2. Open `protein.html?pdb=pdb/3oxc.pdb&ligand=<HET code>`.

Notes:
- Everything chemical is derived from the file: cartoon from Cα + C=O, secondary structure from HELIX/SHEET records, pocket residues within 4.2 Å, H-bonds at 2.5–3.3 Å (including bridging waters), and RMSD against the crystal pose.
- The flap-closing animation turns on only for HIV-protease-like dimers (Ile50 in both chains).
- The camera finds the least-occluded view of the pocket automatically.
- To change the default, edit `pdbPath` in `src/viz/protein-ligand/main.ts`.

### MRI (NIfTI)
1. Put a T1 volume in `public/mri/`, e.g. an MNI152 1 mm or 2 mm T1 template (`.nii` or `.nii.gz`).
2. Open `mri.html?nifti=mri/<file>.nii.gz`.

The volume is normalised (99.5th percentile), fit into a 200 mm cube, oriented using the signs of the affine diagonal, and baked into the same GPU volume the phantom uses. The synthetic glioma is still injected into the lesion panel. In real-data mode, T2 is synthesised from T1 and is labelled as such. If the file fails to load, the procedural phantom is used and the subtitle says so.

### Chest X-rays
1. Put PNG/JPG radiographs in `public/xray/`.
2. Copy `public/xray/manifest.example.json` to `public/xray/manifest.json` and describe each case:

```json
{ "cases": [ {
  "id": "CXR-0001", "image": "pneumonia_01.png",
  "label": "Pneumonia – RLL", "finding": "Consolidation", "prob": 0.93, "region": "RLL",
  "heat": [[0.30, 0.63, 0.11, 1.0]],
  "similar": [
    { "image": "pneumonia_07.png", "label": "Pneumonia – RLL", "score": 0.94 },
    { "image": "normal_03.png",    "label": "Normal",          "score": 0.91 },
    { "image": "effusion_02.png",  "label": "Effusion",        "score": 0.88 } ] } ] }
```

`heat` lists Grad-CAM blobs as `[x, y, radius, weight]` in image coordinates (0–1, y down; remember the patient's right is on the image **left**). Without a manifest, the procedural generator is used. Good public-domain sources: NIH ChestX-ray14 (check the per-dataset terms), or Wikimedia Commons PD images.

---

## Project structure

```
index.html, dna.html, protein.html, mri.html, xray.html   entry pages
src/shared/       tokens (colours/fonts), params, HUD kit (Canvas2D), post stack,
                  capture (R/S), app shell, shared shaders (holo, dust, backdrop, final)
src/gallery/      gallery page
src/viz/dna/      helix model, sequencer state, HUD, GLSL (backbone, read head)
src/viz/protein-ligand/  PDB parser, cartoon builder, ball-and-stick, HUD, GLSL
src/viz/mri/      brain anatomy + bake + raymarch + slice GLSL, NIfTI loader, HUD
src/viz/xray/     procedural CXR generator, case library/manifest, HUD, GLSL
public/pdb/1hsg.pdb   bundled structure (RCSB PDB, CC0)
DECISIONS.md      every judgement call made while building, with reasons
TODO.md           data you can supply / known limitations
```

The HUD is drawn with Canvas2D rather than DOM so that recordings and PNG exports include it. All colours live in `src/shared/tokens.ts` and are mirrored to CSS variables.

## Credits & licences
- Three.js (MIT), nifti-reader-js (MIT), Vite (MIT).
- 3D simplex noise: Ashima Arts / Stefan Gustavson (MIT), in `src/viz/mri/glsl/noise.glsl`.
- PDB 1HSG: Chen, Z. et al. (1994), *J. Biol. Chem.* 269:26344. Distributed by RCSB PDB under CC0.
- Fonts: JetBrains Mono, Space Grotesk (Google Fonts, OFL), with system fallbacks.

> All imaging and sequencing data shown is synthetic or illustrative and is **not for clinical use**. The HUDs say so in their footers.
