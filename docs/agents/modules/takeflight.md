# Take Flight

Career flight simulator (`modules-src/takeflight/`, module id `takeflight`, page `public/modules/takeflight.html`, thumbnail `public/images/modules/takeflight.webp`). Babylon.js 9.34 on WebGPU with the WebGL2 fallback (Rack & Reel's `createEngine`), reverse depth buffer, right-handed scene. Design, milestones and architecture decisions: `docs/takeflight/PLAN.md`. Files: `docs/ENGINE-MAP.md` under takeflight. Keep this file current; never AGENTS.md.

## Status

Milestone 1 is in (flight model, Wren T4 trainer, Harrow Field, terrain, chase/cockpit/tower cameras, dev overlay). Milestones 2–8 (scoring and replays, careers and saves, the 200 km region, more aircraft, airlines and ATC, leaderboards with re-simulation, optimisation) are listed in the plan.

## Rules that matter

- **Determinism.** Everything under `sim/` and `shared/` is renderer-free and uses only `sim/SimMath.ts` (`sin`, `cos`, `atan2`, `exp`, `ln`, `pow`, ...) plus `+ - * /`, `Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.imul`. Never `Math.sin`/`Math.pow`/`Math.hypot`/`**` in sim code: engines may differ in the last bit, and the Worker re-flies recorded flights to check scores. The only randomness is `SimRandom` seeded per flight. `tests/determinism.test.ts` replays a recorded input log and requires bit-identical state.
- **Fixed step.** `sim/Simulation.ts` runs the model at 120 Hz (`SIM_DT`); the renderer interpolates between the last two ticks. Inputs are quantised to bytes (`sim/Controls.ts`) before the model sees them, so a 12-byte-per-tick log replays exactly.
- **Axes.** World x east, y up, z south (heading 0 = north = -z). Body x forward, y up, z right. Positive inputs: pitch = back stick (nose up), roll = right, yaw = right pedal. Control-surface hinge rotations in `render/AircraftVisual.ts`: about body +z a positive angle moves the trailing edge down.
- **Aircraft data** is JSON checked by `shared/AircraftSpec.ts` (Zod). Coefficients are per unit input in the conventions above. After changing aero numbers, run `node scripts/takeflight-tests.mjs flight` (envelope: roll 180–330 m, Vy climb 450–850 fpm, full-power level 104–128 kt, stall near Vs1, trimmed 3° approach).
- **Models.** Aircraft are built by Blender Python: `blender -b --factory-startup -P modules-src/takeflight/tools/blender/build_wren.py -- assets-src/models/takeflight [preview.png]` (Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2`). `tools/blender/export_aircraft.py` validates names, scale, size, triangle budgets per LOD, materials, textures and UV overlaps, and fails the build on any violation; it writes `<name>_lod0..2.glb` and `<name>_cockpit.glb`. Then `node scripts/assets.mjs` (the `takeflight/` preset keeps every node, empty `light_*` nodes and UVs). Author with nose +X, left wing +Y, up +Z in Blender; that exports straight onto body axes. Materials need backface culling on (the cockpit view relies on the outer fuselage being invisible from inside).
- **Reused code.** Sky, sun, fog, shadows and the HDR post chain are Truck Simulator's (`trucksim/render/world/Atmosphere.ts`, `Pipeline.ts`, `render/Quality.ts` tier names); `Scope` is `trucksim/systems/Scope.ts`; the engine boot and resolution control are Rack & Reel's. Changes there affect Take Flight.
- **Faces.** Hand-built meshes (terrain tiles, runway quads) wind so the right-handed cross product of (b-a)×(c-a) points down; the other way they are culled. Copy the existing index order.
- **Cockpit panel.** `render/Instruments.ts` paints the gauges into a dynamic texture on `panel_screen`; the texture is flipped with `vScale = -1` and needs `WRAP` addressing.
- No visible copy says game; every maker, carrier and airline is invented.

## Local testing

The in-app preview often has no free server slots; use the light Vite config and headless Edge:

- Server: `node node_modules/vite/bin/vite.js --config node_modules/.cache/vite.takeflight.config.mjs --port 3091` in the worktree (root `modules-src/takeflight`, public dir `public/`).
- Shots: `Q="?quality=medium" STEPS='[{"eval":"window.__takeflight.debug.fly({start:\"final09\"})"},{"wait":4000,"shot":"final"}]' node node_modules/.cache/tf-shot.mjs C:/dev/tf` (Playwright, Edge, WebGPU). `window.__takeflight.debug` has `fly(options)`, `view(mode)` and the `sim`.
- `?perf=1` or the backquote key opens the performance overlay.
- Tests: `node scripts/takeflight-tests.mjs [filter]` (esbuild bundle, `node --test`), also in `pnpm test` after `tsc -p modules-src/takeflight/tsconfig.json`.
