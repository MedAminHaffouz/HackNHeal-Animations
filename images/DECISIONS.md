# DECISIONS

Decisions made autonomously while building the HackNHeal poster set, logged as I went.

## Setup / infrastructure
- **No existing animated-visuals project in this repo** (directory was empty), so the design tokens were defined from the brief in `assets/tokens.css` and `lib/poster.js` (`C` / `FONT` constants). If the animated project lives elsewhere, swap the values there and every poster follows.
- **Fonts are vendored, not loaded from Google Fonts**: full JetBrains Mono 2.304 (Regular/Medium/Bold) and Space Grotesk (variable) TTFs in `assets/fonts/` (OFL licences included). Reason: the Google/fontsource web subsets lack ℝ, ∇, √, ∈, θ, which the formulas need, and exports must not depend on the network. Space Grotesk has no Greek/math glyphs, so **all formulas are set in JetBrains Mono**.
- **Lowercase Greek is set in STIX Two Text Italic** (vendored Greek subset, OFL). In JetBrains Mono, α is drawn like "a" and η like "n" (identical outlines, upright *and* italic, checked with fontTools), which would make α_j and η read as a_j and n. `Poster.mathText` reroutes any α–ω character automatically at 1.18× size to match the mono x-height. Uppercase Σ/Ω, ∇, √ and ℝ stay in JetBrains Mono, which draws them well.
- **Sub/superscripts are real `<tspan>`s** (`_{k}`, `^{T}` mini-markup in `Poster.mathText`), not Unicode sub/superscript characters: JetBrains Mono lacks ᵀ ₖ ₜ ₋ ₙ, and tspans stay editable in the SVG. Sub/sup size is clamped to the 28 px floor.
- **Classic `<script>` tags, not ES modules**, so each poster opens straight from disk; `npm run serve` is there too (some browsers block local font loading from `file://`).
- **PRNG**: cyrb128 hash → sfc32. Seed comes from `?seed=` (default `42`) and is salted with the poster id, so `seed=42` yields different but reproducible randomness per poster. Sub-systems use `rng.fork(label)` so that changing one part of a poster does not shift the random draws of another.
- **Variant via `?variant=bg`** (default `full`). bg = content group at `opacity 0.35` and an elliptical feathered mask that clears the centre, plus a per-poster bg layout that pushes the content outward (wider spread, no title block, labels dropped). The frame/footer stay at 45 % so the poster is still identifiable.
- **Output paths**: the brief's `/out/png/` and `/out/svg/` are read as project-relative (`./out/...`), not filesystem root. Filenames: `<poster>--<variant>--seed<seed>--<WxH>.png` and `<poster>--<variant>--seed<seed>.svg`.
- **1080p export** = same 3840×2160 layout rendered at `deviceScaleFactor 0.5` (pixel-identical composition, natively rasterised, not a downscaled bitmap).
- **SVG export** is the live DOM serialised, with an `@font-face` block pointing at `../../assets/fonts/` so it renders correctly in a browser from `out/svg/`. In Inkscape/Illustrator, install the two fonts first.
- **Automated layout audit** runs in every export (`out/report.json`): flags text under 28 px (after transforms), text within 70 px of the edge, and text-on-text overlap. Visual PNG review is still done for text-over-graphics issues the audit can't see.
- **`out/` is git-ignored** (≈100 MB of 4K PNGs, fully reproducible with `npm run export`).
- Glow filters use `filterUnits="userSpaceOnUse"`: object-bounding-box filters render nothing on perfectly horizontal/vertical lines (zero-height bbox).

## 01 — Deep Neural Network (MLP)
- **Node values are pre-activations z, not post-ReLU activations.** The brief asks for values in [−1, 1] with magenta for negatives and also labels the hidden layers `ReLU`, but ReLU outputs are ≥ 0, so a hidden "activation" of −0.47 would be wrong. Showing z keeps the magenta/cyan diverging map honest: magenta units are the ones ReLU zeroes, cyan units fire. The legend says "pre-activation z".
- Input nodes = standardised features (can be negative); given clinical names (HbA1c, glucose, BMI, age, CRP, LDL) and the 3 outputs = healthy / pre-diabetic / type 2 diabetes for a bio flavour.
- Output nodes show logits; **ŷ is the exact softmax of those logits**, rounded with the largest-remainder method so the printed probabilities sum to exactly 1.00.
- Weight-matrix shapes are printed between layers (`W₁ ∈ ℝ^{10×6}` …), using the PyTorch / maths convention `out × in`. Parameter count in the HUD (419 = Σ out·in + out) is computed by hand from 6-10-12-10-6-3.
- Values are illustrative (sampled), not the result of an actual forward pass: printing a real forward pass would need unbounded values outside [−1, 1].
- Firing pattern: exactly one "path" unit plus one other strongly positive unit per hidden layer; the highlighted path follows those units over positive weights.

## 02 — Transformer
- Block order follows Fig. 1 of Vaswani et al. (2017) exactly, **post-LN** as in the original paper (`LayerNorm(x + Sublayer(x))`), with residual lanes drawn on the left of the encoder and the right of the decoder, as in the paper. The diagram reads bottom → top, as in the original.
- Q/K/V wiring: self-attention blocks fork the stream into V, K, Q. In decoder cross-attention, **K and V come from the encoder output ("memory") and Q comes from the decoder stream**.
- Dimensions are the paper's base model: N = 6, d_model = 512, h = 8, d_k = d_v = 64, d_ff = 2048, so the FFN is 512 → 2048 → 512 with ReLU.
- Bio framing: the task is posed as seq2seq **codon → amino-acid translation**. Encoder input `ATG GCC TTA GAA …` and decoder input `<s> M A L …` are correct under the standard genetic code (ATG = Met, GCC = Ala, TTA = Leu, GAA = Glu).
- The heatmap is an illustrative encoder self-attention head over 12 codons (rows = queries, columns = keys). Each row is an exact softmax, so rows sum to 1. Logits = noise + diagonal + previous-token bias + an ATG(start) ↔ TAA(stop) pair + 3 seeded long-range hotspots. Values ≥ 0.30 are printed in-cell.
- The PE formula uses `10000^{2i/512}` (d_model substituted) to avoid a sub-in-superscript that would fall below the 28 px text floor.
- bg variant: encoder hugs the left edge and decoder the right edge; the memory link crosses the masked centre. The insets are dropped.

## 03 — Embedding space & similarity
- **Cluster directions are defined in the view basis** (screen angle φ + a tilt toward the viewer), then mapped back to 3D. A true isometric view looks down (1,1,1), so clusters placed in the positive octant collapsed onto the origin and the vectors looked stubby. The axes are therefore drawn in both directions (negative half dashed): embeddings have signed coordinates.
- **cos θ = 0.93 is exact**: **b** is built by rotating **a** by exactly arccos(0.93) = 21.6° in the plane spanned by **a** and the oncogene direction. The amber arc is a projected 3D slerp between **a** and **b**, so it is the true angle, not a screen-space angle.
- **k-NN is computed**: top-5 points by cosine similarity to the query (JAK2) over the whole cloud. Printed scores are those cosines (3 decimals). BRAF (b) is listed under the top-5 to show that 0.930 does not make the cut.
- Cluster angular spread and query offset were tuned so the neighbour scores differ visibly (0.99x rather than all 1.000). A 3D toy can't reproduce typical high-dimensional cosine ranges (≈ 0.7–0.95), and the poster doesn't claim to.
- Bio labels: kinases (CDK2, MAPK1, PLK1, AURKA, CDK4, JAK2: all genuine kinases), BRAF as the "b" vector (a kinase that is also a classic oncogene, which is why it sits between the two clusters). Ligands use hollow markers so the palette stays at cyan/magenta/amber/white.
- Background "UMAP vibe": seeded random-walk filaments of faint dots in screen space.
- A keep-out zone stops cloud points from drawing over the title. Labels inside the cloud get dark backing plates.
- Global bg mask softened slightly (hole radius 0.34·W, fully clear to 55 %) after this poster's bg looked too empty.

## 04 — U-Net
- **Every feature-map size and channel count is from Ronneberger et al. (2015), Fig. 1**: 572² × 1 input → valid 3×3 convs (−2 px each) → 568² × 64 … bottleneck 28² × 1024 → up-conv 2×2 (halves channels) → concat with the **cropped** encoder map (568²→392², 280²→200², 136²→104², 64²→56²) → … → 388² × 64 → conv 1×1 → **388² × 2**. The "23 conv layers" note is the paper's own count.
- Concatenation bars are drawn as two halves (dashed white = cropped copy, amber = upsampled), labelled with the **summed** channel count (e.g. 128 at the top decoder level, 1024 at the lowest).
- Bar height scales monotonically with resolution, but it is **stylised** (not linear): linear would make the 28² bottleneck invisible. Bar width ∝ log₂(channels).
- Skip connections are the brief's "glowing arcs" (dashed cyan, glow). The level-3 arc is too short for a caption; its 64² → 56² crop can be read from the bar labels.
- **Input/output consistency**: the MRI is a seeded procedural FLAIR-like phantom (canvas raster, embedded as PNG in the SVG) and is labelled "phantom". The output mask is **vector**: d3-contours of the *same* tumour field, sampled over the central 388/572 crop. The dashed amber square on the input marks that region, which is why the lesion looks larger on the output.
- Output = 2 classes (background / tumour), matching the 388² × 2 head. Loss formulas are the paper's (pixel-wise softmax + weighted cross-entropy with w(x)).
- No Dice or other metric is printed: any number would be invented.

## 05 — Self-attention close-up
- Sentence: `[CLS] the BRCA1 mutation raises breast cancer risk [SEP]`, query = "mutation". Keys are on an elliptical arc below the query, and the query's line to itself is included (self-attention attends to every position, itself too).
- **Numbers are internally consistent**: scaled scores s_j = q·k_j/√d_k are rounded to 2 dp and printed under each key, **α is the exact softmax of those printed scores**, then α is rounded to 2 dp with the largest-remainder method so the printed weights sum to exactly 1.00. The full sum is written out under the formula. (Checked by hand for seed 42: exact α = .044, .042, .363, .125, .057, .099, .128, .113, .029 → printed .04 .04 .36 .13 .06 .10 .13 .11 .03.)
- Line stroke width = 3 + 80·α px. The top-3 keys are cyan with glow, the rest white with opacity rising with α.
- The score logits have a hand-set semantic prior (BRCA1, cancer, risk and self high; stop-words/specials low) plus seeded noise, so the pattern is plausible for every seed.
- Output panel shows z = Σ α_j v_j with the top-3 terms expanded.
- bg variant: query on the top edge, keys on a large arc along the sides and bottom.

## 06 — Loss landscape & gradient descent
- The surface is an analytic 2-parameter loss: a gentle quadratic bowl + a rotated elongated Gaussian valley (global minimum) + a shallower Gaussian well (local minimum) + two ridges + small ripples. A narrow rotated valley is the classic case where momentum oscillates across the valley as it descends, which gives the "spiralling in" look honestly.
- **The trajectory is a real simulation**: heavy-ball momentum `v ← βv + ∇L(θ)`, `θ ← θ − ηv` with η = 0.06, β = 0.86, 70 full-batch steps (so 1 step = 1 epoch; the HUD says so). The gradient is computed by central differences. The loss-curve inset plots the same trajectory's L values, and L(θ*) comes from a grid search plus GD refinement.
- The start point is seeded on a ring of radius 2.65. Starts that end in the local minimum are rejected deterministically (retry with the next seeded angle), so every seed still tells the "finds the minimum" story. The local minimum is real; it just isn't labelled, because in this camera it sits on the near slope and read ambiguously.
- **`∇L(θ₀)` arrow** = the 3D tangent of steepest ascent at the start, (g_x, g_y, ‖g‖²), pointing uphill, as the gradient should. The legend notes that the step goes along −∇L.
- Wireframe = white hairlines with depth-faded opacity (no hidden-line removal; the blueprint look tolerates the transparency). Cyan = level sets from d3-contours, lifted to their own height on the surface and projected faintly onto the floor. Contour rings that d3 closes along the grid border are cut at the border; they otherwise drew false square outlines.
- Epoch labels (0, 10, 20, 30, 40, 70) are placed greedily with collision checks and backing plates.
- bg variant: camera shifted so the basin and trajectory sit lower-right, outside the cleared centre.

## 07 — Diffusion model (bonus)
- **x₀ is a Cα trace with real secondary-structure geometry**: α-helices with 2.3 Å radius, 1.5 Å rise and 100°/residue (Cα–Cα ≈ 3.8 Å), an antiparallel β-hairpin (3.3 Å/residue zig-zag, strands 4.8 Å apart), and loops resampled at 3.8 Å. Topology: helix → hairpin → helix. Coordinates are centred and scaled to unit variance, as diffusion models assume. The residue count is computed (50 for this build) and written into the HUD, not hard-coded.
- **Every frame is the DDPM closed form** x_t = √ᾱ_t·x₀ + √(1−ᾱ_t)·ε with **one fixed seeded ε** shared across frames (stated on the poster), at t = 1000, 800, 600, 400, 200, 0. The schedule is the cosine schedule (Nichol & Dhariwal 2021, s = 0.008), so ᾱ_T is exactly 0 (pure noise). ᾱ, √ᾱ and √(1−ᾱ) are printed per frame, with a signal/noise bar.
- Arrow conventions follow Ho et al. (2020), Fig. 2: x_T on the left, x₀ on the right. Solid cyan **p_θ(x_{t−1} | x_t)** = learned reverse process pointing toward x₀; dashed magenta **q(x_t | x_{t−1}) = N(√(1−β_t) x_{t−1}, β_t I)** = fixed forward process pointing toward x_T. The training objective shown is DDPM's L_simple (noise prediction).
- Points are coloured by each residue's secondary structure **in x₀** across all frames, so viewers can watch the same residues assemble. The projection scale is identical in every frame (no per-frame zoom), which is why x₀ looks compact next to the noise.
- Simplification, stated here rather than on the poster: real protein diffusion models (e.g. RFdiffusion) diffuse residue frames (rotations + translations) rather than a raw Cα point cloud. The poster says "Cα coords" and does not name a specific model.
- ᾱ has no glyph in any vendored font, so `mathText` draws ᾱ as italic α plus a measured overline.
- bg variant: 3 frames along the top edge and 3 along the bottom (reading order x_T → x₀), with the centre clear.
