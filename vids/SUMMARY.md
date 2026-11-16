# Summary — HackNHeal visual systems

Built autonomously in one session. Each piece is committed separately, so you can roll back any of them (`git log --oneline`).

## How to run
```bash
npm install
npm run dev       # gallery at http://localhost:5173, visuals at /dna.html /protein.html /mri.html /xray.html
npm run build     # typecheck + static build → dist/ (deploy anywhere, relative paths)
npm run preview   # serve dist/
```
Hotkeys: **R** record WebM (HUD included), **S** 2× PNG, **H** HUD, **Space** pause, **?** help. The MRI adds **1/2/3/P/T**, and the X-ray adds **N**.
Params: `?bg=transparent ?hud=0 ?speed=0.5 ?quality=low|high ?t=12 ?motion=full|reduced`, plus per-visual ones (see the README).

## What's done

| | Visual | Status | Data |
|-|--------|--------|------|
| 01 | **DNA sequencing.** B-DNA (10.5 bp/turn, real major/minor grooves), purine/pyrimidine-sized base slabs, read-head scan that reveals bases, Sanger-style chromatogram + ACGT ticker, BRCA1-range SNV callouts in amber, strand-separation bubble, groove annotations, bokeh dust | ✅ | procedural (by design) |
| 02 | **Protein–ligand docking.** Cartoon from the real Cα trace with β-arrows, indinavir ball-and-stick, approach → 5-pose search → snap (real RMSD) → H-bonds to Asp25/Asp25′/Ile50 (computed from the crystal), flap closing, dot surface with a glowing pocket, ΔG/Ki/RMSD HUD with sparkline | ✅ | **real PDB 1HSG**, bundled |
| 03 | **MRI healthy vs glioma.** GPU-baked anatomical phantom (gyri/sulci, ventricles, deep GM, cerebellum, brainstem), glass-cortex raymarch with slice plane at true depth, synced T1+Gd/T2 slices with skull/scalp and radiological orientation, glioma (necrotic core, enhancing rim, edema), segmentation contours + `Tumor vol / Confidence 0.97`, scanner metadata, axial/sagittal/coronal | ✅ | **fallback:** procedural phantom (NIfTI loader ready) |
| 04 | **Chest X-ray retrieval.** Procedural PA radiographs (10 findings), dissolve-in, scan line, Grad-CAM with iso-contours, particles through a t-SNE "embedding space" to 3 similar cases, counting cosine scores, 10.5 s case cycle | ✅ | **fallback:** procedural images (manifest loader ready) |
| — | Gallery page with lazy live previews, params/hotkeys/embed reference | ✅ | |
| — | Shared layer: tokens → CSS vars, URL params, Canvas2D HUD kit, bloom + grain/CA/vignette/scanline post, WebM/PNG capture, reduced motion, responsive (portrait layouts for all four), transparent mode with correct alpha | ✅ | |

## Verified
- `npm run build` (strict TypeScript + Vite) passes with no errors. It was run after every visual and after every polish change.
- Each visual was checked by eye in headless Chromium at 1600×900 and/or 1280×720, in portrait (420×860), with `?quality=low`, `?hud=0` and `?bg=transparent` (composited over a coloured page).
- **S** produced a 2× PNG (including the HUD) and **R** produced a WebM, tested via CDP.

## What's fallback / what I need from you
1. **X-ray images (optional):** drop public-domain CXRs into `public/xray/` and write `manifest.json` (template: `manifest.example.json`).
2. **MRI T1 template (optional):** put a NIfTI in `public/mri/` and use `mri.html?nifti=mri/<file>`. MNI152 wasn't bundled for licence and size reasons.
3. **A quick check on real hardware:** I couldn't measure frame rate on the RTX 4060 (headless GPU access wasn't available, so all checks used software WebGL). If `mri.html` dips below 60 fps, use `?quality=low` or tune `STEPS` / `VOL_SCALE` in `src/viz/mri/main.ts`.

## Where to look
- `DECISIONS.md`: 48 numbered decisions with reasons (stack, palette, the science, performance, alpha handling…).
- `TODO.md`: data to supply, unverified items, next-step ideas.
- `README.md`: params, hotkeys, embedding, swapping in real data, structure, credits.
