# Short Track Showdown on Babylon.js — build plan

Module id `shorttrack`, source `modules-src/shorttrack/`, built to `public/modules/shorttrack.html`, embedded at `#module-shorttrack`. The module moves from three.js/WebGL to Babylon.js 9.34 on WebGPU (WebGL2 fallback), with Havok physics (WebAssembly) for contact and a new tire and suspension model. It is built in place behind `?engine=next`; the classic module stays the default until Phase 6.

Visible copy follows the site rules: everything is a "learning module", never game, games, gaming or entertainment. New art carries no real makes, badges or sponsor logos.

## Architecture

```
modules-src/shorttrack/
  index.ts        picks the path: ?engine=next → next/boot.ts, otherwise render-three/main.js
  tests/          node --test suites (scripts/shorttrack-tests.mjs): golden.test.ts, track.test.ts, protocol.test.ts; fixtures/ recorded from the pre-port code
  next/           the Babylon module
    boot.ts       engine (WebGPU, WebGL2 fallback incl. on device loss), Havok init, render loop
    physics/      (Phase 4) Havok bodies for chassis, walls (continuous collision) and debris
    render/       (Phase 2) Babylon scene drawing interpolated sim state
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

### 3. Visual upgrade
HDR float16, physical sky, per-track IBL, Khronos PBR Neutral tone mapping (ACES option); clear-coat paint with flake; four-cascade shadows, contact shadows, SSAO2, TAA, bloom, motion blur on high; clustered lights for night towers, volumetric light for the prison searchlights; asphalt detail normals and a rubber line; compute particles on WebGPU; decal skid marks; thin-instanced crowd and props. Tiers `low`/`medium`/`high`/`ultra` (`?quality=`) with `_shared/adaptive-resolution.js`. Medium holds 60 fps at 1080p with 20 cars on a mid-range laptop GPU; low runs on WebGL2. `docs/PERF-BASELINE.md` row.

### 4. Physics upgrade
Havok chassis, walls and debris; four raycast wheels with spring-damper suspension, combined-slip tires with load sensitivity, weight transfer, drag, downforce, drafting and side-draft, true banking normals, a dirt surface model, damage from contact impulses feeding grip, power and aero. Retune `AI_LEVELS`, `FORM_V` and the rolling start. AI laps within 3 % of the Phase 1 traces on asphalt, 5 % on dirt; a 20-car, 25-lap soak finishes with no NaN, no wall tunnelling, no stuck car; physics ≤ 3 ms per frame for 20 cars.

### 5. Blender assets
Headless scripts in `scripts/blender/shorttrack/` (pattern of `scripts/blender/bushleague/cleanup.py`) into `assets-src/models/shorttrack/`, then `pnpm assets`. Budgets (LOD0/1/2): super late model 60k/18k/4k keeping the livery atlas regions and number spots; truck 50k/15k/4k keeping its texture layout; original pace car 40k/12k/3k; shared wheel 6k/2k/400 with `Wheel_*`/`Tire_*` hub pivots; instanced prop kits.

### 6. Cut-over
`next` becomes the default, `?engine=classic` stays one release; net protocol version bumped. Lap records move to versioned track keys (`prison-v2` …) with the old boards read-only under a Classic tab; nothing is deleted. Docs and thumbnail updated. The owner approves this merge. A follow-up removes the classic path.

## Checks for every phase
`pnpm assets:check`, `pnpm build`, `pnpm test`, `node scripts/shorttrack-next-smoke.mjs` against `pnpm preview`, `node scripts/shorttrack-play.mjs` (two autopilot laps per track through the menus and a two-tab PeerJS race), `pnpm gate --only shorttrack`, and play on the preview build. Headless Chromium here has no real GPU: SwiftShader WebGPU loses its device and the module falls back to WebGL2, so WebGPU itself is verified on real hardware after deploy.
