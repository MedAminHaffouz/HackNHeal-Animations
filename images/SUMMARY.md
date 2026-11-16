# HackNHeal poster set: summary

Seven static, seeded AI × Bio posters at exactly 3840×2160, each in a `full` (hero) and a `bg` (35 % opacity, clear centre) variant, exported to 4K PNG, 1080p PNG and editable SVG.

## Quick start

```bash
npm install                    # playwright + d3
npx playwright install chromium
npm run export                 # → out/png/*.png (3840×2160 + 1920×1080), out/svg/*.svg, out/report.json
npm run export -- --seed 7     # another reproducible variant set
npm run export -- --only 02,05 --variants bg
npm run serve                  # http://127.0.0.1:8137/  (gallery = index.html)
```

Open any poster live: `posters/03-embeddings.html?seed=42&variant=bg`.

### Showing them on a screen (fullscreen)

| Where | Keys |
|---|---|
| **Gallery → ▶ SLIDESHOW** (recommended for screens) | opens fullscreen on the 4K PNGs · `←` `→` / Space / PageUp-Down = previous/next · `B` = full ↔ bg · `F` or double-click = toggle fullscreen · `Esc` = exit |
| **Any poster page** (live SVG) | `F` / Enter / double-click = fullscreen · `←` `→` = previous/next poster · `B` = full ↔ bg |

The cursor hides after 2 s idle. A key hint appears only on mouse movement outside fullscreen, so it never shows up in exports. Moving to another *poster page* reloads it, which makes the browser leave fullscreen (browser rule), so use the gallery slideshow for an uninterrupted loop. Presentation clickers send PageUp/PageDown, which both viewers accept.
Gallery: `index.html` (full/background toggle, click for 4K, links to SVG and the live page).

## The posters

| # | Poster | What is computed (not drawn by hand) |
|---|---|---|
| 01 | **Deep Neural Network**, MLP 6→10→12→10→6→3 | Pre-activation z per node in [−1, 1] on a diverging magenta/cyan map, glow ∝ \|z\|. Edge opacity ∝ \|w\|, coloured by sign, with one glowing forward path. ŷ = exact softmax of the output logits (sums to 1.00). Weight-matrix shapes and the 419-parameter count. |
| 02 | **Transformer** (Vaswani et al. 2017) | Exact Fig. 1 block order (post-LN, N = 6, d_model 512, h 8, d_ff 2048; cross-attention K, V from the encoder). Codon → amino-acid framing with correct codon table. 12-codon attention heatmap, row-softmaxed, with a start↔stop-codon hotspot. Attention formula inset. |
| 03 | **Embedding Space** | Isometric 3D cloud of 5 bio clusters. **cos θ = 0.93 is exact** (b built by rotating a by arccos 0.93); the arc is a projected 3D slerp. Top-5 k-NN by real cosine similarity, with scores. UMAP-style background filaments. |
| 04 | **U-Net** (Ronneberger et al. 2015) | Every feature-map size and channel count from the paper (572² → 568² … 28²×1024 … 388²×2), plus copy-and-crop sizes. Procedural FLAIR-like MRI phantom; the output mask is a vector contour of the *same* lesion, cropped to the 388/572 region. |
| 05 | **Self-Attention** close-up | Query "mutation" → 9 keys. Scores printed, α = exact softmax of the printed scores, rounded with largest remainder so the printed α values sum to exactly 1.00. Line width ∝ α. |
| 06 | **Gradient Descent** / loss landscape | Analytic loss surface (wireframe + lifted cyan level sets) and a real heavy-ball momentum run (η 0.06, β 0.86, 70 epochs). The epoch markers and loss-curve inset come from the same run. ∇L arrow = true tangent of steepest ascent. |
| 07 | **Diffusion Model** (bonus) | Cα backbone with correct helix/strand geometry (≈ 3.8 Å Cα–Cα). Each frame is the DDPM closed form x_t = √ᾱ_t x₀ + √(1−ᾱ_t) ε under a cosine schedule with one shared ε. Ho et al. arrow conventions for p_θ and q. |

## Quality checks performed

- **Visual review**: after every poster, both variants' PNGs were read back (and 4K crops for small text). Overlaps, clipped labels and arrow-on-label collisions were fixed before moving on. The fix history is in the git log.
- **Automated layout audit** runs on every export (`out/report.json`): no text below 28 px at 4K (sub/superscripts included), no text within 70 px of the edge, no text-on-text overlap. **Current state: 14/14 renders clean for seed 42, and also clean for seeds 7 and 2026.**
- **Reproducibility**: re-exporting seed 42 yields a byte-identical SVG (verified with `cmp`).
- **Math spot-checks by hand**: softmax values on 01 and 05, U-Net dimension chain, codon table, cosine-schedule ᾱ values.
- **Exported SVG renders standalone** in a browser, fonts included (via `../../assets/fonts`).

## Layout of the repo

```
assets/tokens.css         palette + @font-face (vendored fonts, OFL licences in assets/fonts/)
assets/vendor/            d3 v7.9.0
lib/poster.js             frame, grid, glow filters, seeded PRNG, math text (sub/sup, Greek, ᾱ), bg mask
posters/0N-*.html         one standalone page per poster
scripts/export.mjs        Playwright export + layout audit
scripts/serve.mjs         static preview server
index.html                gallery
DECISIONS.md              every judgement call, per poster
```

## Things worth knowing

- **No animated-visuals project was found in this repo** (it was empty), so the tokens were built from the brief. If that project lives elsewhere, aligning them is one edit in `assets/tokens.css` and `lib/poster.js`.
- **Fonts**: JetBrains Mono's α and η are visually identical to "a" and "n", so lowercase Greek in formulas is set in **STIX Two Text Italic** automatically. Titles use Space Grotesk; everything else uses JetBrains Mono.
- **Deliberate deviations from the brief** (all for accuracy, details in DECISIONS.md):
  - MLP node values are labelled as **pre-activations z**, because ReLU outputs can't be negative.
  - The loss-landscape local minimum exists but isn't labelled, because it read ambiguously in the chosen camera.
  - The diffusion poster diffuses a Cα point cloud rather than the residue frames that real protein models use.
- `out/` is git-ignored (≈ 27 MB for seed 42). Run `npm run export` to regenerate it.
- For SVG editing in Inkscape/Illustrator, install the fonts from `assets/fonts/` first. The U-Net MRI phantom is the only raster element (an embedded PNG).
