# Engine map

One line per file that renders, simulates or ships a 3D learning module, plus the
delivery pipeline every revamp step goes through. Read `AGENTS.md` first; this
file is the index of the 3D code and must be updated whenever a file listed here
is added, moved or removed.

## Delivery pipeline (Phase 0)

- `.github/workflows/modules.yml`: the `modules` check on every pull request to `main`: checkout, pnpm install (cached), `pnpm assets`, `pnpm build`, `pnpm test`, then `node scripts/perf-baseline.mjs --check` once that script exists.
- `package.json` scripts: `assets` (no-op until Phase 2 adds the asset pipeline), `build`, `test` (no-op until Phase 8), `gate` (module gate below).
- `scripts/module-gate.mjs`: Playwright gate: serves the build with `vite preview`, opens every embedded module inside the hub iframe (`/#module-<id>`), fails on console or page errors from our own pages (third-party and `/api/*` failures are listed as notes), and saves a screenshot per module plus `report.txt` under `--out` (default `docs/gate`, not committed).
- `.github/workflows/site-change.yml` + `.github/site-changes/run.mjs`: admin-requested changes from the site's Site changes panel. The runner now always pushes a `site-change/<job>` branch and opens a pull request; with "publish automatically" it enables squash auto-merge and waits for the `modules` check, reporting the squash commit on `main` so Undo (`git revert`) keeps working. Needs the `CLAUDE_GITHUB_TOKEN` repository secret so the pull request triggers checks (the built-in token cannot start workflows).
- `.github/workflows/claude-runner.yml` + `scripts/claude-edit.sh`: manually dispatched Claude task runner; unchanged, already opens a pull request with auto-merge.
- Repository settings this pipeline relies on (owner-only; see the Phase 0 pull request): auto-merge allowed, squash merge with the pull request title as the commit message, delete head branches on merge, branch protection on `main` requiring the `modules` status check with no required reviews.
- Labels: `needs-owner`, `phase-0` … `phase-8`.
- `docs/screenshots/<phase>-<step>/`: before/after module-gate screenshots committed as pull-request evidence.

## Renderers in use today (Phase 1 unifies these)

| Module | Renderer | Served from | Entry |
| --- | --- | --- | --- |
| Sandlot Sluggers 3D (`sandlot3d`) | three.js r128 (global `THREE`) | cdnjs | `public/modules/sandlot3d.html` |
| BotWreck 3D (`botwreck`) | three.js 0.160 (ESM) + cannon-es 0.20 | jsdelivr | `public/modules/botwreck.html` |
| Short Track Showdown (`shorttrack`) | three.js 0.160 (ESM) + addons (Sky, RoomEnvironment, bloom post-processing) | jsdelivr | `public/modules/shorttrack.html` |
| Maple Street (`maplestreet`) | three.js 0.172 WebGPU build (WebGL2 fallback), TSL, Rapier 0.14 compat | unpkg import map | `public/modules/maplestreet.html` (generated) |
| Thrill Park (`park`) | hand-written WebGL2 (no library) | Vite bundle | `src/components/park/ParkGame.tsx` |
| Max Secure Circuit / Oval Speedway (`racing`, `oval`) | 2D canvas sprites | Vite bundle | `src/components/Racing.tsx` |
| Pool (`pool`) | 2D canvas | Vite bundle | `src/components/PoolTable.tsx` |

Four different three.js builds from three CDNs, one bespoke WebGL2 renderer. Rule 1 of the revamp is one pinned version served from the Vite build; Rule 2 moves every model into `modules-src/<game>/models/`.

## Known baseline issues (found by the module gate on `main`)

- `maplestreet`: `pageerror: Buffer is not defined` when the module loads in the hub iframe (something in the bundle or its unpkg dependencies expects Node's `Buffer`). Tracked for the Maple Street step of Phase 1.
- `shorttrack`: under software WebGL (CI, no GPU) the page is busy enough that Playwright screenshots time out; the gate records this as a note, not a failure.

## Standalone module pages (`public/modules/`)

- `public/modules/sandlot3d.html`: Sandlot Sluggers 3D; inline three.js r128 scene, `class Rig` athletes, four ballparks, PeerJS rooms.
- `public/modules/sandlot.html`: Sandlot Sluggers (2D canvas); PeerJS rooms.
- `public/modules/botwreck.html`: BotWreck 3D; three.js 0.160 scene with cannon-es rigid bodies; posts scores with `tlScores.submit`.
- `public/modules/shorttrack.html`: Short Track Showdown; three.js 0.160 scene, tracks picked with `?track=`, lap records posted to `/api/racing`, `tl-lap` messages to the parent, PeerJS rooms.
- `public/modules/shorttrack-car.bin`: decimated super late model mesh with atlas UV regions, loaded by `buildStockCar`.
- `public/modules/shorttrack-numbers.js`: race-number fonts and styles shared by the truck and car liveries.
- `public/modules/maplestreet.html`: generated bundle of `modules-src/maplestreet/`; never edit by hand.
- `public/modules/chess.html`, `checkers.html`, `2048.html`, `helicopter.html`: 2D modules (no 3D), PeerJS rooms for chess and checkers.
- `public/modules/module-scores.js`: `tlScores.submit(module, value)` → `/api/module-scores` and `{type:'tl-score-saved'}` to the parent.
- `public/modules/sprites/`, `public/modules/faces.png`: roster and batter-card art for Sandlot Sluggers 3D.

## Maple Street sources (`modules-src/maplestreet/`)

- `build.mjs`: bundles `src/main.ts` with Bun or esbuild into `public/modules/maplestreet.html` using `index.html` as the shell; three.js, Rapier, PeerJS and colyseus.js stay external.
- `index.html`: page shell with the unpkg import map (three 0.172 WebGPU, TSL, addons, Rapier 0.14, PeerJS 1.5.4, colyseus.js 0.15).
- `src/main.ts`: boot: picks the transport (shared world, offline, PeerJS, local tabs, Colyseus) and starts the game.
- `src/core/Engine.ts`: renderer, scene, camera and resize handling (WebGPU with WebGL2 fallback).
- `src/core/Loop.ts`: fixed-step update and render loop.
- `src/core/Input.ts`: keyboard, mouse and touch state.
- `src/core/Materials.ts`: shared PBR materials and procedural textures.
- `src/core/Merge.ts`: geometry merge helpers for static batches.
- `src/core/Storage.ts`: per-device local settings.
- `src/game/Game.ts`: the client game: player, vehicles, lots, needs, HUD wiring and command dispatch.
- `src/game/CameraRig.ts`: third-person and build cameras.
- `src/game/Hud.ts`: HUD, menus and notifications.
- `src/game/PlotMap.ts`: town map overlay.
- `src/build/BuildController.ts`: Sims-style build and buy tools; emits batched `builds` gestures.
- `src/build/Mesher.ts`: walls, floors, roofs and pools into meshes.
- `src/build/HouseManager.ts`: per-lot house meshes and rebuilds.
- `src/build/Furniture.ts`: furniture and fixture models from the catalog.
- `src/build/Thumbs.ts`: catalog thumbnails rendered off-screen.
- `src/world/Neighborhood.ts`: roads, lots, trees and street furniture from `WorldLayout`.
- `src/world/Downtown.ts`: shops and the gas station.
- `src/world/Lawn.ts`: mowable lawn surfaces and stripes.
- `src/world/Grass.ts`: instanced grass.
- `src/world/DayNight.ts`: sun, sky and night lighting.
- `src/physics/Physics.ts`: Rapier world and colliders.
- `src/physics/Character.ts`: kinematic character controller.
- `src/physics/Vehicle.ts`: raycast vehicle model.
- `src/physics/VehiclePresets.ts`: original pickup, coupe and mower bodies and tuning.
- `src/net/Transport.ts`, `OfflineTransport.ts`, `LocalTransport.ts`, `PeerTransport.ts`, `WorldTransport.ts`, `ColyseusTransport.ts`, `Host.ts`, `RemoteEntities.ts`: transports to the shared world, same-device tabs, PeerJS rooms (`tl-maplestreet-<code>`) and Colyseus, plus remote player and vehicle interpolation.
- `shared/RoomLogic.ts`: the single rules authority (ownership, build validation, money, loans, mowing, deliveries, shops, fuel, needs).
- `shared/WorldServer.ts`, `WorldLayout.ts`, `Seed.ts`, `Npc.ts`, `Catalog.ts`, `BuildRules.ts`, `Economy.ts`, `Mowing.ts`, `Protocol.ts`: world server loop, town layout, starter houses, simulated neighbors, catalog, build rules, economy, mowing pay and the message protocol.
- `colyseus-server/`: optional Node room running the same shared logic.

## Thrill Park (`src/lib/park/`, `src/components/park/`, `server/park/`)

- `src/lib/park/gl.ts`: WebGL2 helpers: smooth-normal mesh builder, sun shadow map with PCF, specular/fresnel lighting, ground and water shading.
- `src/lib/park/models.ts`: guests (`addPerson`, 8 walk frames, 8 looks, near/far detail), organic scenery.
- `src/lib/park/renderer.ts`: blended terrain with ambient occlusion and shorelines; shadow pass then main pass via `drawWorld`.
- `src/lib/park/session.ts`: local and online sessions (server-authoritative command replay, snapshots).
- `src/lib/park/api.ts`: saves and tickets client for `/api/park`.
- `src/components/park/ParkGame.tsx`, `ParkHud.tsx`, `ParkScoreboard.tsx`: menu and lobby, in-game interface, net-worth leaderboard.
- `server/park/*.mjs` (+ `index.d.mts`): shared simulation: terrain, catalog, coaster track physics, commands, guest and staff AI, finances, snapshots. Shared by browser and the Railway service; keep commands deterministic.

## Racing (`src/components/Racing.tsx`, `src/lib/racing.ts`, `server/racing-engine.mjs`)

- `src/components/Racing.tsx`: Max Secure Circuit and Oval Speedway client (2D canvas sprites, paint profiles), mounts with `fixedTrack`.
- `src/lib/racing.ts`: tracks, tickets and lap-record client.
- `server/racing-engine.mjs` (+ `racing-engine.d.mts`): physics shared by browser and the multiplayer service; bump `/version` in `server/index.mjs` after changes.

## Contracts that every phase keeps

- Module ids and `src` paths in `src/lib/modules.ts`; the hub iframe at `#module-<id>`.
- `tlScores.submit`; `postMessage` types `tl-score-saved`, `tl-lap`, `tl-host`, `tl-room`.
- `?room=` and `?track=` query params; PeerJS room-code format.
- `/api/*` routes; `server/racing-engine.mjs` and `server/park/` simulations.
