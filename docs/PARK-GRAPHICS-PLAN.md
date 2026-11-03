# Thrill Park graphics plan

Renderer-only revamp of `src/lib/park/`: realistic materials, physically plausible lighting and shadows, and higher-fidelity
ride geometry, with frame time, draw calls, memory and download size held at or below today's. Nothing in `server/park/`,
`session.ts`, `api.ts`, the save/snapshot formats or any gameplay number changes.

## Tooling (Phase 0)

- `scripts/park-scene.mjs` builds a deterministic sandbox park through the real command handlers: a steel looper
  (Coil Spring) and a wooden coaster (Knot Hollow), Ferris wheel, carousel, Top Spin, Zipper, drop tower, a 9×6 Wave Pool,
  Tube Slides and Aqua Loop, a ten-floor Skyline Tower and a Timber Lodge, a pond with a sloped shoreline, ~100 trees and
  path furniture, and 400 guests walking the paths. `node scripts/park-scene.mjs` prints what it built.
- `scripts/park-shots.mjs --out <dir> [--quality low|medium|high] [--no-perf]` opens Thrill Park from `pnpm dev` in
  headless Chromium with SwiftShader at 1280×800, swaps in that scene, and writes:
  - matched JPEG screenshots at fixed cameras (`station`, `flat`, `waterRide`, `wavePool`, `hotel`, `shoreline`) from
    `src/lib/park/shotCams.ts` rendered at 1280×800, plus `overview.jpg` from `captureOverview` (1600×1000);
  - `audit.json` (vertex counts per mesh kind, ride model, coaster track and hotel, instance counts);
  - `split.json` (per-pass draws and vertices, instance upload bytes, GPU-synchronised frame time with and without the
    shadow pass, measured with a 1-pixel `readPixels` after each frame);
  - `perf.json` (every animation frame of the running park for 20 s after a 5 s warm-up: avg FPS, 1% low, draws per
    frame, JS heap).
- `?shotCam=<name>` opens any park at one of those cameras (`overview` uses the `captureOverview` framing).
- `ParkRenderer.renderShot(cam, w, h, mime, dayFraction?)` is the shared off-screen capture used by `captureOverview`.
- `Gl.stats` counts draws and vertices per pass and instance upload bytes each frame (integer increments only).
- Fix found while auditing: in development React mounts the HUD twice, and the first unmount's `loseContext()` killed
  the canvas's only WebGL context, so dev builds drew nothing. `dispose()` now defers the context loss and skips it when
  a new renderer has taken the canvas. Production is unaffected (single mount).

## Audit of the current renderer (before)

Scene above, default camera (`focusPark`, 70 m), SwiftShader, canvas 1035×721 (the HUD viewport at 1280×800, DPR 1).

| Measure | Value |
| --- | ---: |
| GPU draws / frame | 262 (98 shadow + 162 main + sky + water + overlays) |
| Vertices / frame | 1,011,294 shadow + 1,410,960 main |
| Instance upload / frame | 8.4 KB (guests and litter) |
| Frame time (GPU-synchronised) | 965 ms: main pass 685 ms, shadow pass 280 ms |
| Running park | 0.59–0.81 FPS avg (two runs), 1% low 0.2–0.5 FPS, heap 22.4 MB |
| Vertex format | 40 bytes (3 pos, 3 normal, 3 color, 1 tint as floats), non-indexed `drawArrays` |

Vertex counts per mesh (`audit.json`): guests 3,000–6,500 per look/frame/LOD (144 meshes, 541 k vertices resident),
oak 3,276 (131 instances, 430 k vertices drawn), bush 1,080 (149 instances), fountain 9,744, steel coaster track 79,200,
wooden coaster track 64,668, terrain 101,382, Zipper 15,912, Tube Slides 10,086, Aqua Loop 8,388, Wave Pool 7,092,
Ferris wheel 3,780, Top Spin 3,240, hotels 864–2,754.

Findings:

1. **Vertex-bound.** Both passes are dominated by vertex work: the shadow pass costs 280 ms for 1.0 M vertices with an
   empty fragment shader, so roughly 0.28 µs per vertex, which also accounts for ~400 ms of the 685 ms main pass. Every
   triangle carries three unique vertices because meshes are uploaded unindexed, so the post-transform vertex cache never
   hits: smooth spheres and tubes are shaded ~6× per unique vertex.
2. **Fragment cost** is the remaining ~290 ms: four-octave `fbm` (16 sin-hashes) on every ground and path pixel, a 9-tap
   PCF loop on every lit pixel, and full-precision Blinn-Phong everywhere.
3. **Bandwidth.** 40-byte float vertices; normals and colors need far less precision.
4. **Shadows** use a 230 m-wide square centred on the orbit target regardless of what is visible, so close-up views waste
   most of the 2048² map and far views lose shadows at the edges; the bias is constant.
5. **Color pipeline** mixes gamma and linear: vertex colors are lit directly and pushed through a custom curve, so
   highlights clip and metals cannot look metallic. The overview reads hazy: linear fog reaches 40% at the overview
   camera distance.

## Budget strategy

The vertex finding pays for everything else. Uploading meshes **indexed and deduplicated** (bit-identical vertices
merged, normals quantised to 8 bits) in a **24-byte vertex** (3 × f32 position, 4 × snorm8 normal + baked AO, 4 × unorm8
sRGB color + tint, 4 × uint8 material id + wind weight + spare) cuts vertex shader invocations several-fold and GPU vertex
memory by ~40%, with the same number of draw calls (`drawElements` replaces `drawArrays`). The `low` tier spends that
saving on nothing and simply gets faster; `medium` and `high` spend it on shading and geometry.

## Material model

Each vertex carries a material id (0–23) in its fourth attribute. A uniform table (`uMatA`, `uMatB`, vec4 × 24 each) is
read once in the vertex shader and passed flat to the fragment shader:

- `uMatA` = base roughness, metalness, detail layer (−1 for none), detail scale (tiles per metre)
- `uMatB` = clearcoat, wrap (subsurface-style diffuse wrap), detail normal strength, specular F0 for dielectrics

Lighting is Lambert diffuse plus GGX/Smith/Schlick specular, energy-conserving ((1 − F)(1 − metalness) diffuse), with an
optional clearcoat lobe (fixed roughness 0.08, F0 0.04) for ride paint and fiberglass, and wrap diffuse for foliage, skin
and cloth. Ambient is a hemisphere (sky above, warm ground bounce below) plus a horizon band, multiplied by the normal-based
AO, a per-vertex baked AO and the detail map's cavity; specular ambient reflects the sky gradient through a
split-sum approximation so steel and glass pick up the sky.

| Id | Material | Roughness / metal | Detail layer | Used by |
| ---: | --- | --- | --- | --- |
| 0 | Painted (default) | 0.55 / 0 | painted metal | anything not tagged |
| 1 | Ride paint, clearcoat | 0.4 / 0 + coat 0.6 | painted metal | ride bodies, gondolas, cars, sweeps, booths |
| 2 | Brushed steel | 0.32 / 1 | brushed steel | coaster rails, ride arms and hubs, railings, lamp posts |
| 3 | Structural steel (galvanised) | 0.5 / 0.85 | brushed steel | supports, trusses, towers, catwalks |
| 4 | Concrete | 0.9 / 0 | concrete | footings, platforms, pool decks, station bases |
| 5 | Wood | 0.75 / 0 | wood plank | wooden coaster structure, decking, benches, boardwalks |
| 6 | Fiberglass gelcoat | 0.22 / 0 + coat 0.8 | gelcoat | water slides, tubes, rafts, boats |
| 7 | Glass | 0.05 / 0, F0 0.08 | — | hotel windows, booth glazing, lamp lenses |
| 8 | Foliage | 0.8 / 0, wrap 0.5 | grass/leaf | tree canopies, bushes, hedges, flowers (wind weight) |
| 9 | Bark | 0.9 / 0 | wood plank | trunks, branches |
| 10 | Canvas / cloth | 0.95 / 0, wrap 0.25 | painted (coarse) | awnings, umbrellas, guest clothing |
| 11 | Skin | 0.6 / 0, wrap 0.45 | — | guest skin |
| 12 | Rubber / black plastic | 0.85 / 0 | — | tyres, seats, restraints, chain lift |
| 13 | Terrain | 0.95 / 0 | grass/dirt + macro | terrain (ground path in the shader) |
| 14 | Paving / asphalt | 0.85 / 0 | asphalt/paver | footpaths, queues, kart tracks |
| 15 | Water | 0.04 / 0 | water normals + foam | ponds, pools (water path in the shader) |
| 16 | Stone | 0.85 / 0 | concrete | rocks, statues, castle walls, fountains |
| 17 | Chrome / polished | 0.15 / 1 | brushed steel | trims, flanges, bolts, poles |
| 18 | Lamp emissive | 0.3 / 0 | — | lamp heads, ride lights |
| 19 | Roofing | 0.7 / 0 | concrete | hotel and stall roofs |

The detail atlas is a `TEXTURE_2D_ARRAY` of eight 256×256 RGBA8 layers with full mip chains (2.7 MB), generated on the GPU
at startup by a single fragment shader (tileable periodic noise, no images): brushed steel, painted metal with
micro-scratches, concrete, wood plank, fiberglass gelcoat, grass/dirt, asphalt/paver and water. R = height (normals are
derived in-shader from `dFdx/dFdy` of the sampled height, so no tangents or UVs), G = albedo variation, B = roughness
variation, A = cavity. The water layer instead stores a precomputed normal in RG and foam in B. Sampling is triplanar in
world space: 3 reads at `medium`, 1 (dominant axis) at `low`, 3 + a macro read at `high`.

## Quality tiers

`src/lib/park/quality.ts` resolves `low` / `medium` / `high` from `?quality=` (like `engine/render/Quality.ts`), else
from DPR and a one-frame GPU timing probe at startup; the HUD settings let the player override it. `captureOverview`
always renders at `high`.

| | low | medium | high |
| --- | --- | --- | --- |
| Shading | GGX, 1 detail read, 4-tap shadow | GGX + clearcoat, triplanar (3 reads), 9-tap rotated shadow | medium + macro detail read, anisotropic filtering, wider soft shadows |
| Geometry | far LODs closer | default | high-density coaster track |
| Post | none | none | FXAA when DPR < 2 (Phase 4) |
| Max DPR | 1 | 1.5 | 2 |

## Phases

Numbers for each phase are recorded below as they are measured.

### Phase 0 — Audit and plan
Tooling, audit and this document. Renderer output unchanged. Screenshots: `docs/park-graphics/before/`.

### Phase 1 — Lighting and color pipeline
- Indexed, deduplicated 24-byte vertices (`packMesh` in `gl.ts`); `drawElements` replaces `drawArrays`. Dedup ratio is
  ~5× on smooth meshes (oak 3,276 → 655 unique vertices, near guest 5,832 → 1,279).
- Shadow pass culls back faces and uses a stripped depth-only vertex shader.
- GGX (Smith-Schlick visibility, Schlick Fresnel) + Lambert, energy-conserving with metalness; clearcoat lobe at
  `medium`/`high`; wrap diffuse for foliage, skin and cloth. Per-vertex material id (`materials.ts`), tagged automatically
  from the model palette (`MeshBuilder.autoMaterial` in `models.ts`) with explicit overrides (guests: skin/cloth/rubber,
  trees: foliage/bark with a wind weight, wooden coaster structure: wood, terrain/paths/water set by the renderer).
- Vertex colors are treated as sRGB and linearised in the vertex shader; lighting is linear; ACES fitted tonemap with
  exposure; sRGB encode (exact at `medium`/`high`, `sqrt` at `low`). The sky is a view-direction gradient with a sun disc
  and glow through the same tonemap, so the horizon, fog and far terrain match.
- Ambient: hemisphere + horizon band, normal AO × baked per-vertex AO (`MeshBuilder.bakeAO`, a voxel-occlusion bake run on
  flat/water ride models, hotels, stalls and coaster tracks) and a split-sum sky reflection for specular ambient.
- Shadows: light frustum fitted to the camera frustum slice (texel-snapped), slope-scaled depth bias plus slope-scaled
  normal offset, 9-tap Poisson kernel rotated per pixel by interleaved gradient noise (`medium`/`high`), 4 bilinear taps
  at `low`. The sun path is capped at ~53° elevation so midday still models form.
- Height-exponential fog with sun in-scattering (one `mix`).
- Wind sway for tree and bush canopies in the vertex shader (scaled by weather).
- Frustum culling of static instances (scenery, stalls, path furniture; re-uploaded only when the camera moves) and of
  whole rides, coasters and hotels, with a sun-direction margin so off-screen casters still cast.
- Quality tiers (`quality.ts`): `?quality=`, else software renderer → `low`, else a one-frame fragment probe × DPR. The
  HUD's gauge button cycles the tier. `captureOverview` always renders at `high`.

Measured (SwiftShader, scene above, auto tier = `low`):

| | Before | Phase 1 |
| --- | ---: | ---: |
| GPU draws / frame | 262 | 194 |
| Vertices / frame (shadow + main) | 1,011,294 + 1,410,960 | 440,676 + 757,350 |
| Frame time, GPU-synchronised (min of 5) | 919–997 ms | 770–836 ms |
| Running park avg / 1% low FPS | 0.59–0.81 / 0.2–0.5 | 1.21 / 0.70 |
| JS heap (running park) | 22.4 MB | 22.9 MB |
| `medium` / `high` frame (same scene) | — | 1,227 / 1,303 ms (real-GPU tiers) |
| Park chunk (`ParkGame-*.js`, production) | 368,866 B (124,940 gzip) | 390,216 B (132,867 gzip) |

`node scripts/perf-baseline.mjs --compare --only park` against a same-machine run of the base commit: avg FPS
60.0 → 60.0, 1% low 59.5 → 59.5, heap 16.57 → 16.68 MB (+0.7%), JS 11,981 → 12,112 KB (+1.1%, dev server, unminified),
transferred 12,749 → 12,877 KB. No regressions. Screenshots: `docs/park-graphics/phase1/`.

### Phase 2 — Procedural material system
- `Gl.initDetail` renders the eight detail layers into a 256×256×8 RGBA8 `TEXTURE_2D_ARRAY` at startup with one
  fragment shader (`DETAIL_FRAG`: periodic, tileable value noise; brushed steel, painted metal with orange peel and
  micro-scratches, concrete with aggregate and pits, wood planks with grain and seams, fiberglass gelcoat, grass/dirt,
  offset pavers with mortar, and water normals/foam), then mipmaps it. 2.8 MB of GPU memory, nothing downloaded.
  Anisotropic filtering (`EXT_texture_filter_anisotropic`, when present) is 1×/2×/8× by tier.
- The material table now also drives the detail layer, tiles per metre and bump strength. Objects sample it triplanar in
  world space (3 reads at `medium`/`high`, the dominant axis only at `low`); albedo variation, roughness variation and
  cavity feed the lighting, and at `medium`/`high` the height channel bends the normal through `dFdx/dFdy` (surface
  gradient, no tangents or UVs).
- Terrain samples the grass layer from above plus a macro read at `medium`/`high`: large-scale tone variation, dry
  patches and dirt where the grass is thin; footpaths get pavers through the same path (`uGround` still tints them).
  The per-pixel `fbm` noise is gone.
- Water: two scrolling normal layers (one at `low`), sky reflection through Schlick Fresnel, depth-based tint and
  transparency from the terrain under each water vertex (stored in the AO channel), and shoreline foam.

Measured (SwiftShader, auto tier = `low`): draws 194/frame, frame 866–892 ms (min of 5; base 919–997), running park
0.79–1.07 FPS avg (base 0.59–0.81), 1% low 0.58 (base 0.2–0.5), heap 22.8–22.9 MB. `medium` 1,103 ms, `high` 1,372 ms on
SwiftShader. Park chunk 398,168 B (134,974 gzip): +29.3 KB raw / +10.0 KB gzip over the base. `perf-baseline --compare`:
60.0/59.5 FPS unchanged, heap +1.0%, JS +1.3% (dev), transferred 12,900 KB; no regressions. Screenshots:
`docs/park-graphics/phase2/`.

### Phase 3 — Ride and structure geometry fidelity
- Coaster track near LOD (`trackGeometry(e, path, nearStep)`, built lazily, cached with the far mesh): rails and spine
  are continuous swept tubes (`MeshBuilder.sweep`) framed by the track's own up vector, so they never crack or twist,
  with smooth normals; steel ties become tubular connectors from each rail to the spine with a keel plate (wooden ties
  keep timber with steel rail plates); chain lift, booster and brake hardware; walkway plates with handrails along
  chain lifts and brake runs; flanged, bolted support bases and saddles. Segment density is every path sample at `high`,
  every second at `medium`. The far LOD is the original mesh, and it is always used at `low` and beyond
  `trackDetail` (70 m `medium`, 140 m `high`) from the coaster's bounds. Still one draw per coaster.
- Coaster cars near LOD (`carModel(..., near)`, one shared mesh per style/front/riders): rolled body edges, nose with
  headlight lenses, padded seat backs with headrests, chrome lap bars, three-wheel bogies (road, up-stop and guide
  wheels) with hubs, chassis rail; painted, chrome, rubber and cloth materials. Within 60% of `trackDetail`.
- Hotels: glazing is glass (high-F0, glossy, sky reflection) with mullions on the tower bands; pools are water, stone
  is stone.
- Trees and shrubs: per-vertex canopy AO (darker toward the canopy core and underside) on top of the Phase 1 wind sway
  and foliage wrap lighting; still instanced, same vertex count.
- Guests: unchanged meshes; cloth/skin/rubber materials since Phase 1.

Deferred: a second canopy shell and extra polygon density on flat-ride drums/booms and water-slide tubes. Every
added triangle is paid by every instance on SwiftShader, and the auto tier there cannot afford it; the material,
AO and shadow changes carry most of the visible gain on those rides.

Measured (SwiftShader, auto tier = `low`): draws 194/frame, frame 908 ms min of 5 (base 919–997), running park 1.22 FPS
avg (base 0.59–0.81), 1% low 0.63, heap 23.1 MB. `medium` 1,118 ms, `high` 1,335 ms. Screenshots:
`docs/park-graphics/phase3/`.

### Phase 4 — Optional post effects
- **FXAA over MSAA, shipped for captures only.** `Gl.beginPost/endPost` render the frame into a 4× multisampled
  target, resolve it with `blitFramebuffer` and run a single-pass FXAA (5 taps on edges, early-out elsewhere) to the
  canvas; `freePost` releases the targets right after. `renderShot`/`captureOverview` (always `high`) use it, which
  cleans thin rails, catwalk railings and spokes in the leaderboard JPEG. It is not used for live frames: on a real GPU
  the pass is well under 1 ms, but at 1080p the extra MSAA colour + depth targets cost ~60 MB of GPU memory next to the
  canvas's own MSAA buffer, far over the 8 MB budget, and FXAA without MSAA would be a quality step down from what the
  canvas already gives.
- **SSAO / contact shadows: skipped.** A half-resolution SSAO needs a depth pre-pass or depth texture plus a blur, at
  least two extra full-screen passes and draws; the baked per-vertex AO (Phase 1) and canopy AO (Phase 3) already cover
  the enclosed areas it would darken, and it could not meet the SwiftShader budget.
- **Bloom: skipped.** The park has a day/night cycle and lit lamp heads, but bloom needs a bright-pass and a blur chain
  (3+ passes and render targets) for a small gain on a handful of lamps; the emissive lamps already read at night.
