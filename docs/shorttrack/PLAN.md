# Short Track Showdown on Babylon.js — build plan

Module id `shorttrack`, source `modules-src/shorttrack/`, built to `public/modules/shorttrack.html`, embedded at `#module-shorttrack`. The module moves from three.js/WebGL to Babylon.js 9.34 on WebGPU (WebGL2 fallback), with Havok physics (WebAssembly) for contact and a new tire and suspension model. It is built in place behind `?engine=next`; the classic module stays the default until Phase 6.

Visible copy follows the site rules: everything is a "learning module", never game, games, gaming or entertainment. New art carries no real makes, badges or sponsor logos.

## Architecture

```
modules-src/shorttrack/
  index.ts        loads render-three/main.js; with ?engine=next it draws through next/render/ (?engine=next&scene=test: the boot test scene)
  tests/          node --test suites (scripts/shorttrack-tests.mjs): golden.test.ts, track.test.ts, protocol.test.ts; fixtures/ recorded from the pre-port code
  next/           the Babylon module
    boot.ts       createEngine (WebGPU, WebGL2 fallback), createPhysics (Havok), the ?scene=test scene
    sim/dynamics.ts (Phase 4, done) the next vehicle model; render/debris.ts: Havok debris (chassis and walls stay in sim/, see Phase 4)
    render/       (Phase 2, done) presenter.ts, bridge.ts, sky.ts: Babylon draws the classic scene graph
    sim/          (Phase 1, done) config, track, car state, vehicle step, contacts, damage, AI, race control: no DOM, no Math.random, no clock
    net/          (Phase 1, done) the PeerJS protocol version in hello
    ui/           (Phase 2) the existing menus and HUD, split out when the Babylon renderer needs them
  render-three/   main.js: the classic three.js renderer, menus, HUD and netcode drawing next/sim/; removed after the cut-over
```

- Babylon is imported by path only (`AGENTS.md`). Havok (`@babylonjs/havok`, pinned) is bundled; its WASM is emitted into `/modules/chunks/` and found through a Vite `?url` import, never a CDN.
- Physics engine registration needs both `Physics/joinedPhysicsEngineComponent` and `Physics/v2/physicsEngineComponent` side-effect imports; without the first, `scene.getPhysicsEngine()` is missing and every `PhysicsBody` throws.
- WebGPU is used only when an adapter is returned; if the device is lost and Babylon cannot restore it, the module tears the scene down and rebuilds it on WebGL2 (`status.fellBack`). `?gpu=webgl` forces WebGL2.
- `window.__stNext` exposes `{ backend, physics, frames, fps, error, fellBack }` for tests.
- Rapier 0.14 (already pinned for Fox Plains) is the fallback physics engine if Havok fails a gate.

## Phases (one pull request each; the next starts when the current one is green and merged)

### 0. Baseline and scaffolding (this PR)
- `@babylonjs/havok` 1.3.14 pinned in `dependencies`.
- `?engine=next` boots `next/boot.ts`: Babylon engine, Havok, a test scene of falling bodies, a backend and FPS readout.
- `scripts/shorttrack-next-smoke.mjs` loads the built page in Playwright three ways (WebGPU request on SwiftShader, forced WebGL2, classic), fails if Havok is not running or frames stall, and records any request to another origin.
- `next/` added to `tsconfig.engine.json`.
- Moved to Phase 1: the recorded classic AI lap-time and speed traces, because recording them headless needs the sim extracted from `main.js` first.

### 1. Split and port, behaviour unchanged
Landed in two PRs: **1a** (#164) track layouts and geometry, checked exactly against `tests/fixtures/track-classic.json`, with the smoke test also loading classic Prison and Dirt and checking they draw frames through `window.__stClassic`; then the rest of the phase (#165, below), which moved that geometry into `next/sim/` with everything else.
`main.js` into the TS layers above, still drawn by the classic three.js renderer (`render-three/`). `scripts/shorttrack-tests.mjs` (esbuild + `node --test`) in `pnpm test`. Fixtures: AI lap times and speed-by-track-position traces per track and AI level in `modules-src/shorttrack/tests/fixtures/`. Golden test: same seed and inputs reproduce the classic car states within 1e-6 over 3 laps.

Done in this phase:
- **Reference recordings.** The classic page routes every random draw and clock read its simulation makes through one `SIM` object (players see no change) and `?record=1` exposes `recordRace`: an all-AI race with `SIM.rand` seeded and `SIM.now` on the sim clock, where one tick is `simulate(STEP)`, the forward-speed refresh the render pass did every frame, `raceControl(STEP)` and `updateBoosts(STEP)` (the classic loop at exactly 120 fps). The host car is driven by the AI at the level's middle settings. `scripts/shorttrack-reference.mjs` records, per track and AI level (seed 20261105, 19 AI plus the host, 5 laps, the live Time Attack baselines of 2026-11-05 frozen in the script: prison 11.666 s, bullring 13.708 s, dells 12.812 s, dellswide 12.317 s, dirt 15.138 s), every car's lap times and the mean speed per 2 m of track, plus the golden states (every car every 0.5 s through the leader's third lap) on medium. Reruns are byte-identical. It also writes the day and night reference screenshots `docs/screenshots/shorttrack/classic-<track>-<day|night>.webp` from the same race frozen at 20 s.
- **Classic AI mean lap times** (easy / medium / hard, s): prison 12.88 / 12.79 / 12.62, bullring 15.11 / 14.84 / 14.60, dells 14.21 / 13.77 / 13.51, dellswide 13.72 / 13.46 / 13.15, dirt 17.29 / 16.87 / 16.52. These are the Phase 4 targets (3 % asphalt, 5 % dirt).
- **The port.** `next/sim/` is the simulation ported operation for operation (same expression order, same random draws, same tick), and `render-three/main.js` (the old `main.js`) now draws it; sim events (sparks, impacts, damage, laps) come back through `World.events`. `next/net/protocol.ts` adds `pv` to `hello`. Menus, HUD and the renderer stay in `render-three/main.js` for now: `ui/` is split out in Phase 2, when the Babylon renderer needs the same screens.
- **Golden test.** `tests/golden.test.ts` replays the recordings on `next/sim/`: every car's position, heading, velocities, yaw rate, steering, lap count, progress, damage, boost and pace factor within 1e-6 at every golden frame on all five tracks, and all 100 lap times of the prison race.
- Live play keeps the classic per-frame race control and pack boost; only the recorder uses the fixed reference tick.

### 2. Babylon renderer at parity
Every track and theme by day and night, trucks, stock car and admin custom cars (glTF + bundled meshopt decoder), liveries and numbers through `DynamicTexture` with the existing canvas painters, skid marks, wear, sparks, smoke. Draw calls ≤ the classic 459; screenshots match the Phase 1 set.

Done in this phase (approach changed from the plan, see below):
- **Approach.** `?engine=next` runs the same classic module (`render-three/main.js`: sim, menus, HUD, netcode, every scene builder) and swaps only the drawing: `next/render/presenter.ts` creates the Babylon engine on the module's canvas (WebGPU, WebGL2 fallback, reload onto WebGL2 if WebGPU loses its device or draws nothing for 6 s) and `next/render/bridge.ts` mirrors the three.js scene graph into Babylon each frame (transforms; visibility; geometry, instance and point buffers by attribute version; material values; canvas textures by version as `DynamicTexture` with the existing painters untouched). Every track, theme, truck, stock car, admin custom car (still loaded by three's GLTFLoader + meshopt), livery, number, skid mark, rubber wear layer, spark and smoke puff is therefore the classic one by construction. Rebuilding every scene builder natively is not needed for parity; Phase 3 replaces pieces with native Babylon where it upgrades them.
- **Presenter.** HDR `DefaultRenderingPipeline` with ACES and bloom (night), three's Preetham sky ported to JS and baked into a half-float dome (`sky.ts`) with its irradiance (including the sun disc) as the day environment's spherical polynomial and a reflection probe for specular, the sun's shadow map culled to three's ±55 m shadow box, linear fog, and the rear-view mirror (a render target culled to the mirror camera, tone-mapped in its overlay quad).
- **Calibration** (`CAL` in `presenter.ts`) was fitted region by region against the Phase 1 screenshots: road, paint, stands, wall and sky land within a few sRGB levels of classic on all five tracks by day and night (`docs/screenshots/shorttrack/next-<track>-<day|night>.webp`).
- **Draw calls** (counted on the GPU APIs, headless Edge, RTX 4060 Laptop GPU): menu 196 (classic 207), mid-race 668 (classic 800), the same on WebGPU and WebGL2.
- **Not at parity yet:** the crowd's cheer animation (a three `onBeforeCompile` vertex hook) is static; sparks are small diamonds and window nets thin quads (WebGPU has no point size or wide lines); paint at night reflects the day environment at 0.6 instead of three's room environment; the dirt surface at night is darker (44 vs 70 sRGB in the reference frame). Admin custom cars could not be checked locally (no D1 in the static preview).

### 3. Visual upgrade
HDR float16, physical sky, per-track IBL, Khronos PBR Neutral tone mapping (ACES option); clear-coat paint with flake; four-cascade shadows, contact shadows, SSAO2, TAA, bloom, motion blur on high; clustered lights for night towers, volumetric light for the prison searchlights; asphalt detail normals and a rubber line; compute particles on WebGPU; decal skid marks; thin-instanced crowd and props. Tiers `low`/`medium`/`high`/`ultra` (`?quality=`) with `_shared/adaptive-resolution.js`. Medium holds 60 fps at 1080p with 20 cars on a mid-range laptop GPU; low runs on WebGL2. `docs/PERF-BASELINE.md` row.

Done in this phase:
- **Tiers** (`next/render/quality.ts`): `?quality=low|medium|high|ultra` or the module's own Graphics quality (low/med/high map to low/medium/high); `?fx=-taa,+ssao` switches single effects for comparisons.
  - low: FXAA, no shadows, no extras (also the WebGL2 floor);
  - medium: 4× MSAA, the single fitted shadow map, surface detail, night tower lights, crowd motion;
  - high: four-cascade shadows with contact-hardening (soft) edges limited to 180 m and to casters in that range, TAA, plus medium's extras;
  - ultra: high with 4096 cascades.

  Adaptive resolution is the classic `createAdaptiveResolution`, which already drives the presenter's pixel ratio.
- **Tone mapping**: Khronos PBR Neutral by default, ACES with `?tonemap=aces` (the classic-matched look).
- **Image-based light, fixed.** In Phase 2 the reflection probe never filled on WebGPU (the dome sampled the cube it was rendering), so reflections were missing. The probe now renders the dome with a copy of its material that points at a tiny dummy cube, and the cube is marked linear (it was being read as gamma, which blew reflections out). The calibration was refitted: car paint reflects at `CAL.paint` (0.4), and every surface stays within a few sRGB levels of classic with `?tonemap=aces`.
- **Surface detail** (`next/render/surface.ts`):
  - metallic flake under clear-coated paint, as a fine random normal map on the base layer with the coat kept smooth;
  - sheen on tires;
  - a tiled detail map (albedo, normal and roughness noise) on surfaces that already have a normal map (asphalt, concrete);
  - the rubber line that builds over a race is the classic wear layer, already drawn.
- **Night**: a spot light at each of the ten tower heads, aimed at the track and held in a `ClusteredLightContainer` so all ten light every material.
- **Crowd**: the classic cheer (a three `onBeforeCompile` hook) is back as `CrowdPlugin`, a Babylon material plugin for GLSL and WGSL driven by the classic uniforms and a per-fan phase buffer.
- **Performance fixes found on the way:**
  - bridged materials carry their own image-processing settings, so the pre-pass renderer's per-pass toggling no longer marks every material dirty;
  - render lists change only when their contents do;
  - WebGPU starts with the adapter's maximum limits.
- **Deferred, each with an `?fx=` switch to test:**
  - SSAO2: with the cascaded shadows it darkens the mirror's render target;
  - motion blur: it misreads the three-driven camera's history and streaks a still frame.
- **Not done:**
  - compute particles: Babylon's GPU particle systems emit continuously from one emitter and cannot burst at scattered points, so sparks and smoke stay the classic-matched ones;
  - volumetric searchlight beams;
  - SSR.
- **Frame rate** (live 20-car race, headless Edge on an RTX 4060 Laptop GPU, where classic runs 24 fps):
  - WebGPU: low 29, medium 17.5, high 11.5, ultra 10;
  - WebGL2: medium 25.5, high 5.9.

  The 60 fps at 1080p medium target on a mid-range laptop GPU could not be measured here: this harness throttles classic itself to 24 fps. It has to be checked on real hardware in a visible browser.

### 4. Physics upgrade
Havok chassis, walls and debris; four raycast wheels with spring-damper suspension, combined-slip tires with load sensitivity, weight transfer, drag, downforce, drafting and side-draft, true banking normals, a dirt surface model, damage from contact impulses feeding grip, power and aero. Retune `AI_LEVELS`, `FORM_V` and the rolling start. AI laps within 3 % of the Phase 1 traces on asphalt, 5 % on dirt; a 20-car, 25-lap soak finishes with no NaN, no wall tunnelling, no stuck car; physics ≤ 3 ms per frame for 20 cars.

Done in this phase (approach changed from the plan, see the first point):
- **Chassis and walls stay in the deterministic sim, not Havok.** The race must replay identically from a seed (golden tests, the reference recorder, the AI pace trim and lap checks), and online cars are simulated on every peer from the same `next/sim/` code; a WASM rigid-body solver stepping on each peer's own frame clock would drift between peers and could not be checked against the Phase 1 recordings. The new vehicle model is therefore strict TypeScript in `next/sim/dynamics.ts`, on the same 120 Hz tick, and the existing swept wall and car-to-car contacts (`physics.ts`) are shared by both models. Havok, already running in the presenter, simulates cosmetic debris only (`next/render/debris.ts`: panel chips for hits of 7 m/s and more, on a short-lived slab tilted to the track normal); debris never touches a car and may differ between peers.
- **Vehicle model** (`World.model = 'next'`, picked by `?engine=next`; `&physics=classic` keeps the old model): a planar body with four wheels; slip angles with a relaxation length; magic-formula side force with load sensitivity (a broader, lower peak and longer relaxation on dirt); drive and brakes take only the grip each tire has left (traction control and ABS), then the friction ellipse; a sprung body whose pitch and roll follow the tire forces through damped springs and move load between the wheels, with 55 % static left-side weight; banking from the true surface normal (the in-plane force toward the bottom of the banking changes the normal load); aero drag, downforce split front and rear, drafting and side-draft from cars ahead and alongside; damage that costs grip, power and aero. Yaw kicks from contacts carry through `avOut`.
- **Stability.** The first field runs crashed into pile-ups after the green: the AI's on/off throttle swung the full CG height of load front to back on every lift, and at the arcade grip levels (around 1.8 g in the turns) the full roll transfer lifted the inside wheels, so cars spun on turn entry. The effective transfer heights are now 25 % (pitch) and 60 % (roll) of the CG height, and the rear tires carry 1.2× grip, which keeps the AI's lift-off neutral.
- **Calibration** (`NEXT_TUNE.grip` 1.65, `TRACK_GRIP.dellswide` 1.04) against the Phase 1 traces, mean AI lap of a 20-car 5-lap race, error against classic (seed 20261105 / seed 777), easy · medium · hard:
  - prison +1.8 / +1.0 · +0.6 / +0.7 · −0.4 / +0.4 %
  - bullring −1.0 / −0.6 · −1.1 / −0.6 · −1.7 / −1.4 %
  - dells −0.8 / −0.2 · +2.7 / +2.3 · +0.4 / +1.8 %
  - dellswide +2.2 / +0.8 · 0.0 / +0.7 · +2.9 / +2.7 % (with the trim)
  - dirt −0.7 / −0.6 · +1.1 / +0.1 · +2.0 / +2.0 %

  `AI_LEVELS`, `FORM_V` and the rolling start needed no change: the AI pace trim (`aiPace`) already holds each car to its lap target, and the formation speed comes from the track's centerline limit, which the next model holds with room to spare.
- **Soak** (20 cars, 25 laps, hard AI, every track): every race finishes with no NaN, no car past the walls and no car stopped for 5 s under green; physics costs about 0.58 ms per 120 Hz tick for 20 cars (1.2 ms per 60 fps frame) on the Node runner.
- **Online and records.** `hello` carries the model as `ph`, and a host refuses a guest on the other model with `PHYSICS_MISMATCH`. Laps driven on the next model are not posted to the record boards until the cut-over (Phase 6), so the boards stay comparable.
- **Tests.** `tests/physics.test.ts` checks the medium AI on every track against the fixtures and runs the prison soak; `tests/physicsRun.ts` is the headless race shared by both. The golden tests still pin the classic model exactly.

### 5. Blender assets
**5a (done):** the pipeline and the first assets. `scripts/blender/shorttrack/stock_car.py` turns the classic `shorttrack-car.bin` into `car_slm_lod0..2.glb` (35k / 18k / 4k triangles; classic material slots, livery atlas UVs and regions, the baked shade as `ao`, hub-pivoted `Wheel_*`/`Tire_*`), and `wheel.py` models a new 15 in steel race wheel with beadlock ring and slick tyre at the stock size (6k / 2k / 400). Both run in headless Blender or with `pip install bpy`. `tests/assets.test.ts` checks the optimised outputs: budgets, wheel hubs against the classic file, regions and material order, and tyre size. Still to come in Phase 5: the truck, an original pace car and the track prop kits.
**5b (done):** the rest of the Phase 5 assets.
- **Race truck.** The truck is the owner's procedural design (`TM`), so it moved out of `render-three/main.js` into `modules-src/shorttrack/truck-model.js` unchanged. `scripts/shorttrack-truck-export.mjs` builds it in Node with three.js and writes a glTF. `truck.py` imports that export and joins everything outside the wheels into `Body`, keeping the classic material names as `truck_<name>`. Each wheel becomes a `Tire_<..>` under a `Wheel_<..>` pivot on the truck's own axles (`DIM.FA`, `DIM.RA`). The body has no texture atlas to keep: liveries and numbers are separate decal meshes in the classic renderer. LODs are 49k / 15k / 3.9k triangles.
- **Original pace car.** `pace_car.py` builds a low two-door coupe of the module's own design, with no make, badge or logo:
  - a closed loft of superellipse sections with tumblehome, a long hood and a ducktail deck;
  - wheel arches cut by booleans and lined;
  - a greenhouse loft with a paint roof, plus a red and blue roof light bar;
  - its own five-spoke wheels, built at each LOD's resolution so the tyre survives at LOD2.

  LODs are 33k / 12k / 2.9k triangles. It isn't drawn yet: the classic pace vehicle stays a truck until a renderer uses it.
- **Prop kit.** `props.py` writes `props_kit.glb`, one `Prop_<name>` node per prop, each standing on its origin for instancing: cone, three-tyre stack, round hay bale, concrete barrier, infield light tower and pit board. The six props total 2.5k triangles, the largest 1.5k.
- **Shared steps.** `common.py` holds arguments, materials, the AO bake and decimation. AO is baked within 0.25 m and lifted to 0.55–1, because body vertices hidden under the truck's cab otherwise smear dark bands along the beltline. Wheels are decimated first and the body gets what is left of the budget.
- **Pipeline.** A `vehicle` preset in `scripts/assets.mjs` (`palette: false`, `flatten: false`) keeps material names and pivots for runtime paint tinting, and `Prop_` joins `KEEP_NODE_NAMES` so the kit's props are never merged. `tests/assets.test.ts` checks every LOD's budget, the pivots on the axles with the tyre on every `Tire_*`, the named paint, glass and light materials, and the six props within budget.
- **Windows note.** The lockfile has two `sharp` versions (0.34.5 direct, 0.35.5 through `ndarray-pixels`), and on Windows only one libvips can load per process, so `pnpm assets` fails there. These outputs were made with a local resolve hook that points every `sharp` import at 0.34.5; none of these models has textures, so the output does not depend on it. Linux CI is unaffected (`assets:check` does not load sharp).
Headless scripts in `scripts/blender/shorttrack/` (pattern of `scripts/blender/bushleague/cleanup.py`) into `assets-src/models/shorttrack/`, then `pnpm assets`. Budgets (LOD0/1/2): super late model 60k/18k/4k keeping the livery atlas regions and number spots; truck 50k/15k/4k keeping its texture layout; original pace car 40k/12k/3k; shared wheel 6k/2k/400 with `Wheel_*`/`Tire_*` hub pivots; instanced prop kits.

### 6. Cut-over
`next` becomes the default, `?engine=classic` stays one release; net protocol version bumped. Lap records move to versioned track keys (`prison-v2` …) with the old boards read-only under a Classic tab; nothing is deleted. Docs and thumbnail updated. The owner approves this merge. A follow-up removes the classic path.

Done in this phase:
- **Default engine.** `render-three/main.js` reads `ENGINE` (`next` unless `?engine=classic`). The next engine runs Babylon and the next vehicle model, and `&physics=classic` still swaps only the model. If the Babylon presenter cannot start at all (no WebGL2, a failed import), the page falls back to the classic three.js renderer instead of failing, and keeps the next physics. `?engine=next&scene=test` still opens the Phase 0 test scene.
- **Protocol 2.** `PROTOCOL_VERSION` is 2, so a cached old page can never join a room on the new rules (it gets the version message). Within version 2, `ph` still keeps `?engine=classic` guests out of next rooms and the reverse.
- **Records.**
  - Next-model laps post to `<track>-v2` (`prison-v2`, `shorttrack-v2`, `dells-v2`, `dellswide-v2`, `dirt-v2`, same minimum lap times).
  - `/api/racing` refuses new laps on the five classic Short Track keys. Their rows stay, are still served, and the admin can still reset them.
  - `?engine=classic` posts no laps.
  - The board under the iframe opens the `-v2` books and has a Current/Classic switch (`LapRecordBoard` `archive`) for the read-only classic books.
  - The module's own board and `tl-lap` messages use the `-v2` key.
  - While a new board has fewer than 3 Time Attack laps, the AI pace baseline borrows the classic board's (the next model laps within 3 % of it).
- **Scripts.** Anything that needs classic asks for it: the reference recorder (`&engine=classic`), the smoke test's classic runs, and `shorttrack-play.mjs` (default engine now `next`). The gate's default load is now the next engine.
- **Thumbnail.** `public/images/modules/shorttrack.webp` is a frame of the next engine at Prison Speedway.

## Checks for every phase
`pnpm assets:check`, `pnpm build`, `pnpm test`, `node scripts/shorttrack-next-smoke.mjs` against `pnpm preview`, `node scripts/shorttrack-play.mjs` (two autopilot laps per track through the menus and a two-tab PeerJS race), `pnpm gate --only shorttrack`, and play on the preview build. Headless Chromium here has no real GPU: SwiftShader WebGPU loses its device and the module falls back to WebGL2, so WebGPU itself is verified on real hardware after deploy.
