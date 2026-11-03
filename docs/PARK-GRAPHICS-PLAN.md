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
