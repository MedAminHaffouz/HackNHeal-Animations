# TODO / open items

What uses a fallback, what you can supply, and what I couldn't verify.

## Data you can supply (all optional, everything already runs without it)

### X-ray (VIZ-04): real radiographs
- **Fallback in use:** procedural chest radiographs (`src/viz/xray/cxrGen.ts`).
- Add PNG/JPGs to `public/xray/`, then copy `public/xray/manifest.example.json` to `manifest.json` and fill in labels, Grad-CAM blob positions and similar-case scores. The format is in the README.
- Use public-domain or properly licensed images only, and strip any patient identifiers or burned-in text.

### MRI (VIZ-03): real T1 template
- **Fallback in use:** procedural brain phantom.
- To use real data: put a T1 NIfTI in `public/mri/` (e.g. an MNI152 1 mm or 2 mm T1, `.nii` or `.nii.gz`), then open `mri.html?nifti=mri/<file>.nii.gz`.
- The synthetic glioma is still injected. In real-data mode T2 is synthesised from T1 and labelled as synthetic contrast. Orientation is inferred from the affine diagonal: if your file shows up flipped, check its sform/qform.
- Licence: check the template's licence before publishing recordings (the MNI ICBM152 licence asks for attribution).

### Protein (VIZ-02)
- Nothing needed: real PDB 1HSG is bundled. Other structures load via `?pdb=` / `?ligand=`.

## Not verified here
- **Real-GPU frame rate.** All checks ran in headless Chromium with software WebGL (SwiftShader), because headless GPU access wasn't available. Things to check on the RTX 4060 and an integrated-GPU laptop:
  - `mri.html` is the heaviest (two raymarched volumes). If it dips, try `?quality=low`, or lower `STEPS` (150) or `VOL_SCALE` (0.75) in `src/viz/mri/main.ts`.
  - Everything else is light (instanced meshes, a few thousand points).
- **Browsers other than Chromium.** Safari ignores Canvas2D `filter: blur()`, so procedural X-rays there will look sharper. MediaRecorder WebM support also varies on Safari.

## Possible next steps
- MRI: mass effect, i.e. compress the right lateral ventricle and add a slight midline shift on the lesion side.
- MRI: FLAIR as a third sequence (edema bright, CSF dark).
- X-ray: real model output. The manifest already carries per-case heatmap blobs, so a small script could fill them from an actual Grad-CAM.
- A `?loop=` param to choose the default cycle length per visual for timed projection slots.
