# Decisions log

Autonomous-mode choices, each with a short rationale. Newest sections are at the bottom.

## Project / shared layer

| # | Decision | Why |
|---|----------|-----|
| 1 | **Vite 8 + vanilla TS + Three r187.** No React. | Every visual is one canvas plus an overlay, so React would add weight and nothing else. |
| 2 | **No GSAP.** HUD transitions use small easing helpers in `src/shared/math.ts` (`smoothstep`, `window4`, `damp`, `easeOutBack`). | The spec made GSAP optional. All animation is time-driven from one clock, which keeps `?speed`, pause, `?t=` and 2× PNG export deterministic. A tween library would bring a second clock. |
| 3 | **The HUD is drawn with Canvas2D on an overlay canvas, not with DOM.** | The **R** recording and **S** 2× PNG have to include the HUD. A canvas composites onto the WebGL frame with one `drawImage`, and DOM text can't. The only DOM UI is the REC badge, toasts and the `?` help, and those are deliberately left out of captures. |
| 4 | Post stack: `RenderPass → UnrealBloomPass → OutputPass → FinalPass`. The final pass is custom GLSL (radial chromatic aberration, luma-weighted grain, vignette, faint scanlines). | Grain and aberration run in display space after sRGB conversion, so they look the same on every visual. The render target is HalfFloat with 4× MSAA on `quality=high`, so HDR emissive values above 1 drive the bloom. |
| 5 | `?bg=transparent`: the final pass derives alpha from pixel brightness (`a = max(r,g,b)`, colour clamped to premultiplied range). | UnrealBloomPass doesn't preserve alpha. Brightness-as-alpha keeps glows soft over any background, which is what you want for OBS or page compositing. |
| 6 | Extra params beyond the spec: `?t=<sec>` (start time, for stills), `?motion=full|reduced` (override the OS setting). Extra keys: **H** HUD toggle, **Space** pause, **?** help. | Useful for recording and for debugging stills. |
| 7 | Reduced motion: time runs at 0.5×, camera drift/orbit amplitude drops to 0.35×, and grain is static (no flicker). | The visuals stay recognisable without large motion. |
| 8 | `quality=low` caps the pixel ratio at 1, turns MSAA and chromatic aberration off, runs bloom at half resolution, and uses fewer instances, particles and raymarch steps. `quality=high` (default) caps DPR at 2. | Target: 60 fps on an RTX 4060 at high, and acceptable on integrated GPUs at low. |
| 9 | Vite `base: './'` and assets resolved with `assetUrl()` against `document.baseURI`. | `dist/` then works from any sub-path or static host, and iframes work as-is. |
| 10 | Colour tokens live in `src/shared/tokens.ts`, mirrored to CSS variables by `applyTokens()`. Two secondary hues were added: violet `#8a6bff` and mint `#3dffb5`. | One source of truth for TS, GLSL uniforms and CSS. The DNA viz needs 4 base colours, and amber is reserved for alerts. |
| 11 | Visual verification used headless Chromium (SwiftShader) via a CDP screenshot script kept outside the repo. | Each visual was checked by eye at 1600×900 and in portrait before committing. |

## VIZ-01 DNA

| # | Decision | Why |
|---|----------|-----|
| 12 | 1 unit = 1 nm. Rise 0.338, 10.5 bp/turn, P radius 1.0. Strand B is offset by **0.38 turn** instead of 0.5. | This produces a real minor groove (~12 Å) and major groove (~22 Å), not a symmetric twist. |
| 13 | Base colours: A cyan, T violet, G mint, C magenta. **Amber is only used for variant calls.** | A flagged base always stands out. |
| 14 | Purines take ~56% of the rung and pyrimidines ~44%, with an H-bond gap in the middle. Rungs are flat slabs stacked perpendicular to the axis. | Small credibility details that bio students will notice. |
| 15 | Unzipping is shared math: the GLSL `unzip()` in `backbone.vert.glsl` mirrors `unzipAt()` in `helix.ts`. The tube is displaced on the GPU, while phosphates and bases are moved on the CPU. | The tube never needs rebuilding. |
| 16 | The read head sweeps only the visible span (computed from the camera frustum and tilt), then holds 2.6 s, fades, and starts a new read. Variants (1–2 per read, transitions twice as likely as transversions) are placed inside the visible span. | Every read on screen produces something to see. |
| 17 | The HUD includes a Sanger-style **chromatogram** (4 traces, peaks per called base, Q bars) under the ACGT ticker. The locus is fictional but uses BRCA1's real GRCh38 range (chr17:43,044,295–43,125,483). | The spec asked for a BRCA1 flavour. A chromatogram reads as "real sequencing" to bio students. |
| 18 | Portrait viewports switch the helix to near-vertical. Narrow viewports drop the geometry panel. | Keeps the layout responsive. |

## VIZ-02 Protein–ligand

| # | Decision | Why |
|---|----------|-----|
| 19 | **Real data: PDB 1HSG** (HIV-1 protease + indinavir/MK1, 168 KB) downloaded once from RCSB and bundled in `public/pdb/1hsg.pdb`. It is fetched same-origin at runtime, with no third-party network access. Other structures load via `?pdb=pdb/xxxx.pdb&ligand=RES`. No procedural fold was built, since the real one is available and more credible. | The spec preferred real data. |
| 20 | Custom PDB parser (fixed columns). Ligand = the requested HET residue, else the largest non-solvent HET group. Ligand bonds come from CONECT, with a distance fallback (<1.9 Å). | Works on any standard PDB file. |
| 21 | Cartoon built from the Cα trace: Catmull-Rom spline, peptide-plane (C=O) ribbon orientation with continuity flips, strands pre-smoothed to remove pleating, β-arrowheads, elliptical cross-sections per SS type. Colour by chain (cyan / blue-violet), helices magenta, loops dimmed. | This is what PyMOL/ChimeraX users expect a cartoon to look like. |
| 22 | **Everything shown as chemistry is computed from the crystal structure:** pocket residues (<4.2 Å from the ligand), H-bonds (ligand N/O ↔ protein N/O at 2.5–3.3 Å, plus bridging waters), and RMSD against the crystal pose. The labels that come out are Asp25/Asp25′ (catalytic dyad), Ile50/Ile50′ (flaps, via water) and Arg8′, which matches the literature for this complex. | Credibility with a bio audience. |
| 23 | **ΔG is illustrative:** `ΔG = −1.2 − 8.3·exp(−RMSD²/18)` plus noise, so it trends down to about −9.5 at the crystal pose, as the spec asked. The HUD footer says "SCORES ILLUSTRATIVE". Ki is derived from ΔG (RT ln Ki, 298 K). | The spec asked for about −9.x. Indinavir's real ΔG is closer to −12, so it isn't presented as measured. |
| 24 | **Flap closing:** residues 43–58 of each chain carry a displacement vector (sin-bump peaking at Ile50) applied in the vertex shader (`aDisp * uDisp`). Flaps are semi-open during the search and close on binding. Only enabled when the structure looks like HIV protease (Ile50 in both chains). | A real mechanistic detail of protease inhibition. |
| 25 | Camera: "up" is the flap direction. The azimuth is chosen automatically by sampling 48 views and counting protein atoms near the ligand→camera rays (least occlusion), then a slow ±18° orbit. The ligand also gets a faint additive, depth-test-off "X-ray ghost" so it stays readable behind loops. | Works for any loaded PDB without hand-tuning. |
| 26 | Extras: dotted vdW surface (buried dots culled with a spatial hash), with pocket-lining dots glowing amber when bound; a shockwave ring on lock-in; a pose-search "SAMPLED" counter. | HUD flavour that stays scientifically grounded. |

## VIZ-03 MRI

| # | Decision | Why |
|---|----------|-----|
| 27 | **Procedural phantom by default; no MNI152 bundled.** MNI templates aren't strictly public domain (they carry a permissive MNI/McConnell licence) and are several MB, and the instructions said not to fetch large datasets. A NIfTI path exists: `mri.html?nifti=mri/<file>.nii.gz` loads it with nifti-reader-js (gzip handled), normalises to the 99.5th percentile, and orients by the affine diagonal signs. | Licence and size. The real-data path still works once you supply a file. |
| 28 | The volume is **baked once on the GPU** into an RGBA8 `WebGL3DRenderTarget` (160³ high / 96³ low), one draw per Z layer. Channels: R = WM, G = GM, B = CSF, A = tumour field. Both panels, the raymarch and the slices all sample the same texture. | Fast startup (well under 1 s), and the 3D view and the 2D slice can never disagree. |
| 29 | Anatomy (`brain.glsl`): ellipsoid hemispheres with narrower frontal/occipital poles, temporal lobes, an interhemispheric fissure that is shallow above the corpus callosum and deep in front of and behind it, a foliated cerebellum with WM arbor vitae, a brainstem with pons, butterfly lateral ventricles plus atria, temporal horns, a 3rd ventricle, thalami/caudate/putamen. Gyri come from domain-warped ridged simplex noise at two scales: CSF in sulcal crevices, a 2.8 mm GM ribbon that follows the folds, and WM cores in the gyri. | It needed to read as a brain to med students, not as a noisy blob. |
| 30 | Glioma: irregular (noise-modulated) mass in right frontoparietal deep WM, with a necrotic core, an enhancing rim, and vasogenic edema out to 2.2× radius that spreads preferentially along WM. T1+Gd gives ring enhancement; T2 makes edema and necrosis bright. | Matches the textbook glioblastoma appearance. |
| 31 | 3D view: emission–absorption raymarch with **first-hit isosurface shading** (gradient normals, fresnel rim, sulcal cavity darkening), then a fainter interior so ventricles (magenta) and the lesion (amber, pulsing) show through. The slice plane is composited at its true ray depth, with a grid and glowing edges. | Glassy hologram look, with gyri visible. |
| 32 | 2D slice: radiological convention (patient right = image left) with R/L/A/P/S/I markers. Smooth-ellipsoid head with scalp, fat, skull and diploë. Static Rician-like grain (MR noise is per-acquisition, not per-frame). Smooth bias field. 50 mm scale bar. | Credibility details. |
| 33 | **T1 ↔ T2 switches by a top-down "acquisition wipe"** at each end of the sweep, not a cross-fade. A cross-fade passes through a contrast-free grey. `T` locks/toggles manually, and `?seq=t1|t2` locks from the URL. | Keeps tissue contrast readable at every frame. |
| 34 | Planes: axial by default. `1`/`2`/`3` or `P` switch planes; `?plane=sagittal`; `?cycle=1` rotates the plane every sweep. | The spec asked for axial by default with a toggle. |
| 35 | Segmentation overlay: amber contour at the enhancing boundary (screen-space `fwidth` iso-line), amber pulsing fill, and a magenta dashed animated edema contour. Tumour volume, edema volume and slice area come from the analytic tumour radius. Slice area updates live, and the "Confidence 0.97" is cosmetic. | The spec asked for `Tumor vol` and `Confidence 0.97`. |
| 36 | Rendering uses a single orthographic pixel-space scene of quads (raymarch, slice), so bloom/grain apply globally and layout is just rectangles. Landscape puts panels side by side; portrait stacks them with the 3D view beside the slice. | Simple, responsive, one post stack. |

## VIZ-04 Chest X-ray

| # | Decision | Why |
|---|----------|-----|
| 37 | **Procedural CXRs by default.** Real images are used only when `public/xray/manifest.json` exists (format in `manifest.example.json`). Browsers can't list a directory, so a manifest is the only reliable way to pick up your files and their labels, heatmap regions and similar-case scores. | Static hosting has no directory listing. |
| 38 | The generator (`cxrGen.ts`) follows radiographic conventions: dense = white, patient right on image left, a radiopaque "R" marker, a heart that extends to patient-left with the left lung's medial border wrapping it, a higher right hemidiaphragm, a gastric bubble under the left dome, posterior ribs with cortical margins plus fainter anterior ribs, clavicles, scapular edges, humeral heads, a faint spine, and hilar vascular trees. Findings: consolidation with air bronchograms, effusion meniscus, cardiomegaly (CTR > 0.5), nodules, pneumothorax with a visceral pleural line. | The images have to pass a quick look from med students. |
| 39 | **Performance:** each group of shapes is drawn sharp into a scratch layer, then composited once with a blur filter (about 20 blurs per image instead of about 100), and each image is generated on its own animation frame. Cases are prepared one ahead, and textures more than one case away are disposed. | First version froze for seconds in software rendering and caused hitches on real GPUs. |
| 40 | Grad-CAM is drawn in the shader from per-case Gaussian blobs, with value-noise breakup, iso-contours, and an "inferno" ramp restricted to the palette (deep violet → magenta → amber → white). | It looks like Grad-CAM without needing a model. |
| 41 | "Embedding space" mini t-SNE plot placed in the gap between the query and the matches. The particles (GPU Bézier paths, 1100 high / 380 low) fly from the heat peak, through the plot, to each match. Neighbour links appear as each match is revealed and its cosine score counts up. Cases cycle every 10.5 s, and **N** skips ahead. | It makes "retrieving from embedding space" literal. |
| 42 | The similar cases are clinically plausible neighbours: same finding first, then related or confusable findings. | A retrieval demo should look like a sensible retrieval. |

## Polish / cross-cutting (after all four visuals)

| # | Decision | Why |
|---|----------|-----|
| 43 | **MRI raymarch renders offscreen at 0.75× (high) / 0.5× (low)** resolution and is upsampled. It's visually identical because volume rendering is soft. | Keeps 60 fps on HiDPI/4K, where DPR 2 would otherwise quadruple the cost of two raymarched panels. |
| 44 | `?bg=transparent` final alpha = `max(pre-bloom coverage alpha, brightest channel)`, using a SavePass snapshot taken before bloom. Backdrop plates are hidden in this mode. | Solid geometry stays opaque, glows stay luminous, and there are no dark halos. A pure luminance-alpha approach made mid-tone objects see-through. |
| 45 | `?hud=0` also tightens the MRI/X-ray layouts (title margins removed). | Clean renders use the whole frame. |
| 46 | Protein labels use simple collision avoidance: each label is pushed further out vertically until its box clears the previous ones. | Labels used to overlap (Asp25 / Arg8′). |
| 47 | A WebGL failure shows a readable message instead of a blank page. | Robustness on locked-down machines. |
| 48 | Hotkeys verified headless via CDP: **S** produced a 2× PNG (1920×696 from a 960×348 canvas) including the HUD, and **R** produced a valid WebM. | |
