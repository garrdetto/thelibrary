# Engine map

The index of every file the learning modules depend on. Read `AGENTS.md`, then this file, at the start of every session; update it in the same pull request whenever a file listed here is added, moved, renamed or removed. One line per file: `path — what it owns — who imports it`. Keep it under 300 lines.

## Site shell

- `src/routes/__root.tsx` — document shell, metadata, favicon, theme bootstrap — TanStack route tree (`routeTree.gen.ts`).
- `src/routes/index.tsx` — the whole app view: sidebar, hub, studio tabs, hash routing (`#module-<id>`, `#racing`, `#oval`, `#park`), module iframe `.play-frame` — route tree.
- `src/router.tsx` — TanStack router factory — TanStack Start.
- `src/styles.css` — all styling, `--lib-*` theme tokens, responsive and reduced-motion rules — `__root.tsx`.
- `src/lib/modules.ts` — module catalog: ids, titles, `src` paths of embedded modules, thumbnails, accents — `index.tsx`, `ModuleHub.tsx`, `ModuleScoreboard.tsx`, `Racing.tsx`, `scripts/perf-baseline.mjs` (parsed).
- `src/lib/module-scores.ts` — which modules have leaderboards and their board settings — `index.tsx`, `ModuleScoreboard.tsx`, `routes/scores.ts`.
- `src/lib/site-themes.ts` — site theme list and legacy id mapping — `__root.tsx`, `index.tsx`.
- `src/lib/studio-types.ts` — browser-safe studio types — `index.tsx`, `server/lyrics.ts`, `routes/studio.ts`.
- `src/lib/use-blinking-favicon.ts` — unread-message favicon blink — `GroupChat.tsx`.
- `src/components/ModuleHub.tsx` — homepage library grid and featured module — `index.tsx`.
- `src/components/ModuleScoreboard.tsx` — top-10 board under scored iframes, refreshes on `tl-score-saved` — `index.tsx`.
- `src/components/LapRecordBoard.tsx` — lap-record tabs for racing and Short Track Showdown, refreshes on `tl-lap` — `Racing.tsx`, `index.tsx`.
- `src/components/FairwayRecordBoard.tsx` — Fairway Nine record book (Round / Closest to the pin / Match history tabs, admin reset), refreshes on `tl-fairway` — `index.tsx`.
- `src/lib/fairway.ts` — browser-safe Fairway Nine board types, limits, formatting and the fetch client (`fetchFairwayBoard`, `saveFairwayRecord`) — `FairwayRecordBoard.tsx`, `routes/fairway.ts`.
- `src/components/AdminRecordReset.tsx` — admin-only reset of the selected board — boards and `index.tsx`.
- `src/components/PoolAccount.tsx`, `SignInRibbon.tsx` — sign-in form and ribbon — `index.tsx`, `PoolTable.tsx`, `Racing.tsx`.
- `src/components/GroupChat.tsx`, `SitePresence.tsx` — floating chat, invites (`meta.invite`), online presence — `index.tsx`, `Racing.tsx`.
- `src/components/AdminPanel.tsx`, `WorkspaceAdmin.tsx`, `SiteChanges.tsx` — admin tabs: people, site-change chat — `index.tsx`.
- `public/modules/module-scores.js` — `tlScores.submit(module, value)` → `/api/module-scores`, then `tl-score-saved` to the parent — 2048, Chopper Cave, BotWreck 3D pages.

### Tooling and delivery

- `package.json` — scripts `dev`, `build` (learning modules, then the site), `assets` (no-op until Phase 2), `test` (engine + fairway type-check via `tsconfig.engine.json`, park, Maple Street and Fairway Nine node suites), `gate`, `engine:smoke`; pins the engine versions below — CI and developers.
- `vite.config.ts` — site build; runs `learningModules()` first (watch mode under `pnpm dev`) so `pnpm build` stays the single command — Vite.
- `vite.modules.ts` — learning-module build: each `modules-src/<id>/` with `index.ts` + `index.html` → `public/modules/<id>.html` plus hashed `public/modules/chunks/`, shared vendor chunks via `manualChunks`; `_`-prefixed folders are shared code — `vite.config.ts`.
- `tsconfig.engine.json` — strict type-check of `engine/`, `modules-src/_template/` and `modules-src/fairway/` (tests excluded; they run through esbuild) — `pnpm test`.
- `scripts/fairway-tests.mjs` — bundles `modules-src/fairway/tests/*.test.ts` with esbuild and runs them with `node --test` — `pnpm test`.
- `scripts/engine-smoke.mjs` — Vite-builds `_template`, embeds it in a hub-like iframe, checks boot, 60 Hz loop, `--lib-*` tokens, same-origin Draco/KTX2 decoders, `dispose()`, console errors and CDN requests; `--out` saves a screenshot — `pnpm engine:smoke`.
- `.gitignore` — ignores the generated `public/modules/<id>.html` pages and `public/modules/chunks/` — git.
- `.github/workflows/modules.yml` — required `modules` check: install, `pnpm assets`, `pnpm build`, `pnpm test`, `node scripts/perf-baseline.mjs --check` — pull requests to `main`.
- `scripts/module-gate.mjs` — Playwright gate: every embedded module in the hub iframe via `vite preview`, console errors, screenshots to `--out` — `pnpm gate`.
- `scripts/perf-baseline.mjs` — Playwright Chromium perf run against `pnpm dev`: first frame, avg and 1% low FPS, JS heap, draw calls, bytes; writes `docs/PERF-BASELINE.md`, `--compare` flags regressions, `--check` validates the table — CI (`--check`), each phase.
- `docs/AUDIT.md` — Phase 0 audit of every playable module: renderer, model source, physics, multiplayer path, leaderboard hook, CDN loads, contracts, builder functions with line ranges for Phase 2 extraction — every revamp phase.
- `docs/PERF-BASELINE.md` — the numbers every later phase must beat (table plus a `perf-data` JSON block) — `perf-baseline.mjs --check/--compare`.
- `docs/screenshots/<phase>-<step>/` — before/after module screenshots attached to each revamp pull request — PR bodies.
- `.github/workflows/site-change.yml`, `.github/site-changes/run.mjs` — admin site-change runs: Claude Code headless → `site-change/<job>` PR → auto-merge — `/api/site-changes`.
- `.github/workflows/claude-runner.yml`, `scripts/claude-edit.sh` — manually dispatched Claude task runner — Actions.
- `.github/workflows/update-lockfile.yml`, `deploy-cloudflare-proxy.yml`, `cloudflare-proxy/` — lockfile refresh and the proxy Worker — Actions.
- Repository settings relied on (owner-only): auto-merge allowed, squash merge, delete head branches, branch protection on `main` requiring `modules`; labels `needs-owner`, `phase-0` … `phase-8`.

## Worker API

- `src/server.ts` — Worker entry: `/api/*` → `handleApi`, else TanStack Start; exports Durable Object `MapleStreetWorld` — Cloudflare (`wrangler.jsonc`).
- `src/server/api.ts` — `/api/*` route table and error handling — `server.ts`.
- `src/server/env.ts` — `Env` bindings type (DB, FILES, MAPLE_WORLD, secrets) — every server file.
- `src/server/http.ts` — JSON responses, same-origin checks, body parsing — every route.
- `src/server/auth.ts` — PIN/password hashing, `tl_session` sessions, lockouts, admin — every route needing a user.
- `src/server/records.ts` — shared leaderboard helpers — `routes/pool.ts`, `racing.ts`, `scores.ts`, `park.ts`.
- `src/server/gemini.ts`, `lyrics.ts` — Gemini client and lyric generation — `routes/studio.ts`, `pool.ts`, `racing.ts`.
- `src/server/routes/account.ts` — `/api/pool-account`, `/api/workspace-access`, `/api/account-settings`, `/api/workspace-admin`, tickets — `api.ts`, `routes/racing.ts`, `routes/park.ts`.
- `src/server/routes/pool.ts` — `/api/pool-practice`, `/api/pool-preferences`, `/api/pool-cue-overlay` — `api.ts`.
- `src/server/routes/racing.ts` — `/api/racing` tickets, lap records (incl. Short Track tracks), paint, AI skins — `api.ts`.
- `src/server/routes/fairway.ts` — `/api/fairway`: GET `?board=round|pin|match` (top 20 ascending plus the caller's best), POST `record` (Zod, same-origin, signed in, id `<user>:<run>`) and `reset-records` (admin); D1 `fairway_records` (migration 0018, also created on first use) — `api.ts`.
- `src/server/routes/park.ts` — `/api/park` tickets, gzip saves (slots 0–6), company-value boards with park screenshots (`?shot=`) — `api.ts`.
- `src/server/routes/maplestreet.ts` — `/api/maplestreet` WebSocket upgrade to the shared world — `api.ts`.
- `src/server/maplestreet-world.ts` — Durable Object running `shared/WorldServer.ts`, saves to D1 `maplestreet_world`; registers published items and vehicles before loading the world and again on `POST /catalog` — `server.ts`.
- `src/server/routes/maplestreet-items.ts` — `/api/maplestreet-items`: public list (drafts only for the admin with `?drafts=1`), `?model=<id>` serves the .glb from KV, admin multipart publish (POST, `status` draft or published) and status changes (PATCH `status`, or the older `active`) — `api.ts`. Helpers in `src/server/maplestreet-items.ts` and `src/server/gltf-check.ts`.
- `src/server/maplestreet-assets.ts` — D1 `maplestreet_assets` (migration 0016, also created on first use and back-filled from `maplestreet_items` / `maplestreet_vehicles` with `INSERT OR IGNORE`): one row per published asset with `kind`, `status`, JSON `spec` and `files`; list/get/insert/update and the admin-only draft check — `maplestreet-items.ts`, `maplestreet-vehicles.ts`.
- `src/server/routes/maplestreet-vehicles.ts` — `/api/maplestreet-vehicles`: public list (retired included with `active: false`), `?model=<id>` / `?wheel=<id>` serve KV `maplestreet-vehicle/<id>[/wheel]`, admin multipart publish (`name`, `spec` JSON, `model`, optional `wheel`) and PATCH (`active`, `name`, `spec`) — `api.ts`. Zod `vehicleSpecSchema` and D1 `maplestreet_vehicles` (migration 0014) in `src/server/maplestreet-vehicles.ts`; `requireMapleAdmin` / `refreshWorldCatalog` in `src/server/maplestreet-admin.ts`.
- `src/server/routes/meshy.ts` — `/api/meshy` (admin only): `?status` (connected, balance, credit table), job list (refreshes unfinished tasks from Meshy), `?model=<job>` (KV `meshy-model/<job>`), POST actions `text`, `image`, `refine`, `remesh`, `retexture`, `cancel`, `hide` — `api.ts`. Meshy client, friendly error mapping and D1 `meshy_jobs` (migration 0015) in `src/server/meshy.ts`; secret `MESHY_API_KEY`, dev-only `MESHY_API_BASE`.
- `src/server/routes/scores.ts` — `/api/module-scores` GET `?module=`, POST `score` / `reset-records` — `api.ts`.
- `src/server/routes/chat.ts` — `/api/group-chat` messages, presence, reads, `?count` — `api.ts`.
- `src/server/routes/studio.ts` — `/api/studio`, `/api/library`, `/api/asset`, `/api/learning`, `/api/lyric-presets` — `api.ts`.
- `src/server/routes/site-changes.ts` — `/api/site-changes` jobs and workflow dispatch — `api.ts`.
- `migrations/0001…0009_*.sql` — D1 schema (users … site_changes) — `wrangler d1 migrations apply`.
- `migrations/0018_fairway_records.sql` — `fairway_records` (board `round`/`pin`/`match`, value, JSON detail) with (board, value) and (board, user_id) indexes — `wrangler d1 migrations apply`.

## Shared engine

Pinned exactly in `package.json`, bundled by Vite, never loaded from a CDN (Phase 1):

| Package | Version | Used by |
| --- | --- | --- |
| `three` (+ `three/addons/*`, `three/webgpu`, `three/tsl`) | **0.186.1** | sandlot3d, botwreck, shorttrack, maplestreet |
| `@types/three` | 0.186.0 | type checking |
| `@dimforge/rapier3d-compat` | 0.14.0 | maplestreet |
| `postprocessing` | 6.39.5 | any module (peer range `three >=0.168 <0.187`, hence three 0.186.1, not 0.187.0) |
| `cannon-es` | 0.20.0 | botwreck |
| `peerjs` | 1.5.4 | sandlot, chess, checkers, shorttrack |
| `colyseus.js` | 0.15.28 | (no longer used by a module; maplestreet's optional `colyseus-server/` is server-side) |

Vendor chunks, each emitted once and cached across modules: `vendor` (three core + addons + postprocessing), `vendor-webgpu` (three's WebGPU/TSL build and the addons that need it), `vendor-rapier`, `vendor-net` (PeerJS).

- `modules-src/_shared/peer-global.ts` — imports the bundled PeerJS and sets `window.Peer` — sandlot, chess, checkers, shorttrack entries.

Engine code imports three only as `three/webgpu` (addons from `three/addons/*` share its core); modules import the engine through `engine/index.ts`.

- `engine/index.ts` — barrel export of everything below — module `index.ts` files.
- `engine/config.ts` — typed config shapes (`EngineConfig`, `InputBinding`, `ActionBindings`, `QualityTier`, `LayerName` …) and `ENGINE_DEFAULTS` — module `config.ts`, every engine file.
- `engine/core/App.ts` — `App.create`: WebGPURenderer with WebGL2 fallback (`?webgl` forces it), 60 Hz fixed step + display-rate render with alpha, ResizeObserver for the iframe, visibility pause, `own()` + `dispose()` freeing every GPU resource — module `index.ts`, `render/Post.ts`.
- `engine/core/FixedStep.ts` — accumulator returning `{steps, alpha}` with a sub-step cap — `App`.
- `engine/core/Scene.ts` — `SceneGraph`: layers `world`, `props`, `characters`, `fx`, `ui`; add/remove/clear/find/setVisible — `App`.
- `engine/core/Input.ts` — `Input<Action>`: keyboard, mouse, touch regions, gamepad buttons/axes through a rebindable action map; `pressed`/`released` latched per fixed step — module `index.ts`.
- `engine/core/Assets.ts` — `Assets<Manifest>`: GLTF/GLB with Draco + KTX2 + meshopt (decoders emitted by the Vite build), textures, audio, JSON; `progress` events; cache keyed by URL — module `index.ts`.
- `engine/core/disposeObject.ts` — frees geometries, materials, textures and shadow maps under an object — `App`, `Scene`, `Assets`.
- `engine/render/Lighting.ts` — `createLighting`: hemisphere + shadow sun with `follow()` (Phase 3 fills in) — module `index.ts`.
- `engine/render/Environment.ts` — `applyEnvironment`: background and fog (Phase 3 adds IBL) — module `index.ts`.
- `engine/render/Post.ts` — `createPost`: installs the App render pass (Phase 3 adds passes) — module `index.ts`.
- `engine/render/Quality.ts` — `resolveQuality`: `auto` tier per backend, `?quality=` override — module `index.ts`.
- `engine/physics/World.ts` — `PhysicsWorld`: lazy-loaded Rapier, fixed `step(dt)`, `track` + interpolated `syncMesh(body, mesh, alpha)`, `setDebug(parent)` line draw — module `index.ts`.
- `engine/ui/Hud.ts` — `Hud`: DOM overlay panels, stats, buttons, toasts styled with `--lib-*` tokens mirrored live from the hub page — module `index.ts`.
- `engine/net/HubBridge.ts` — same-origin `postMessage`: `tl-room`, `tl-score-saved`, `tl-lap`, `tl-fairway` out, `tl-host` in — `Peer`, `Scores`, fairway `index.ts`.
- `engine/net/RoomFormats.ts` — production room-code formats (prefix, alphabet, length, wire case) for sandlot, chess, checkers, maplestreet, fairway, shorttrack — `Peer` callers.
- `engine/net/Peer.ts` — `PeerRoom`: host with retry on taken ids, join, broadcast, guest rejoin, `bridgeHub()` (`tl-host` → `tl-room`), `autoJoinFromQuery()` (`?room=`) — modules with online modes.
- `engine/net/Scores.ts` — `Scores.submit` (same contract as `tlScores.submit` → `/api/module-scores`, then `tl-score-saved`), `Scores.lapSaved` (`tl-lap`), `installGlobal()` — modules with boards.

## Models

One factory per file under `modules-src/<game>/models/`; no game-rule imports.

### _template — copy this folder to start a new module (`_` prefix: not built into `public/modules`, not in `modules.ts`)
- `modules-src/_template/module.json` — id, title, accent, modes — `config.ts`.
- `modules-src/_template/config.ts` — every tunable: engine overrides, action bindings, sizes, colors, physics — `index.ts`.
- `modules-src/_template/index.ts` — boots `App`, lighting, environment, post, `Input`, `Hud`, `PhysicsWorld` and the models; disposes on `pagehide` — `index.html`.
- `modules-src/_template/index.html` — page shell (`#stage`); drop the `_` when copying so `vite.modules.ts` builds it — `scripts/engine-smoke.mjs`.
- `modules-src/_template/models/Ground.ts`, `models/Crate.ts` — example model factories — `index.ts`.
- `modules-src/_template/models/README.md`, `systems/README.md` — rules for the models and systems folders — developers.

## Games

Renderers after Phase 1 step 1 (all served from the Vite build):

| Module id | Renderer | Source |
| --- | --- | --- |
| `sandlot3d` | three.js 0.186.1 WebGL behind an r128-compatible global `THREE` | `modules-src/sandlot3d/` |
| `botwreck` | three.js 0.186.1 ESM + cannon-es 0.20 | `modules-src/botwreck/` |
| `shorttrack` | three.js 0.186.1 ESM + addons (Sky, RoomEnvironment, bloom) | `modules-src/shorttrack/` |
| `maplestreet` | three.js 0.186.1 WebGPU build (WebGL2 fallback), Rapier 0.14 | `modules-src/maplestreet/` |
| `fairway` | three.js 0.186.1 WebGPU build (WebGL2 fallback) via `engine/`, TSL node materials | `modules-src/fairway/` |
| `park` | hand-written WebGL2 | `src/lib/park/` |
| `racing`, `oval`, `pool` | 2D canvas | `src/components/` |
| `sandlot`, `chess`, `checkers` | 2D canvas / DOM, bundled PeerJS | `modules-src/<id>/` |
| `2048`, `helicopter` | 2D canvas / DOM | `public/modules/<id>.html` (static) |

Known baseline issues: `shorttrack` is too busy under software WebGL for Playwright screenshots (gate note, not failure). The `maplestreet` `Buffer is not defined` error is gone now that colyseus.js is bundled.

### sandlot3d — Sandlot Sluggers 3D
- `modules-src/sandlot3d/index.html` — page shell: screens, HUD markup, styles — `vite.modules.ts` (→ `public/modules/sandlot3d.html`).
- `modules-src/sandlot3d/index.ts` — entry: installs the legacy `window.THREE`, then loads `main.js` as a classic script — `index.html`.
- `modules-src/sandlot3d/three-legacy.ts` — r128-compatible `THREE` over 0.186.1: color management off, linear output, legacy light-intensity scale — `index.ts`.
- `modules-src/sandlot3d/main.js` — whole module script: scene, `class Rig` athletes (`LimbTube`, `PLAYER_LOOK`, `UNIFORMS`), four ballparks, `window.__ss` — `index.ts` (`?url`).
- `public/modules/sprites/` (34 files), `public/modules/faces.png` — roster and batter-card art — `main.js` at runtime.

### maplestreet — Maple Street (`modules-src/maplestreet/`)
- `modules-src/maplestreet/index.html` — page shell (start screen, HUD markup, styles), no CDN scripts — `vite.modules.ts` (→ `public/modules/maplestreet.html`).
- `modules-src/maplestreet/index.ts` — entry; imports `src/main.ts` — `index.html`.
- `modules-src/maplestreet/README.md` — module notes — developers.
- `src/main.ts` — boot: locked name (library username, or a fixed guest name), two modes (shared world, solo with unlimited money); waits for the published-item catalog and published vehicles before starting; `?vehicleTest=1` opens the admin test drive instead — `index.ts`.
- `src/core/Engine.ts` — renderer, scene, camera, resize (WebGPU/WebGL2) — `Game`, `BuildController`, `DayNight`, `Neighborhood`, `RemoteEntities`.
- `src/core/Loop.ts` — fixed-step update/render loop — `Game`.
- `src/core/Input.ts` — keyboard, mouse, touch — `Game`, `CameraRig`, `BuildController`.
- `src/core/Materials.ts` — shared PBR materials, procedural textures — `Game`, `Mesher`, `Neighborhood`, `Downtown`.
- `src/core/Merge.ts` — geometry merge helpers — `Downtown`, `RemoteEntities`, `Vehicle`, `VehiclePresets`.
- `src/core/DevMode.ts` — developer instance flag (`?dev=1`), its save key and draft counts — `main`, `OfflineTransport`, `CustomModels`, `CustomVehicleModels`.
- `src/core/Storage.ts` — per-device settings — `main`, `Game`, `BuildController`, `Host`, `WorldTransport`.
- `src/game/Game.ts` — client: player, vehicles, lots, needs, HUD wiring, command dispatch; vehicles are parked at home (never brought to you), Go Home every 15 minutes, the parked-vehicle unstack watchdog and the right-click vehicle menu — `main`.
- `src/game/ContextMenu.ts` — right-click menu panel (title + actions, Escape/outside click closes, arrow keys) — `Game`.
- `src/game/CameraRig.ts` — third-person and build cameras — `Game`.
- `src/game/Hud.ts` — HUD, menus, notifications — `Game`.
- `src/game/PlotMap.ts` — town map overlay (bounds from `MAP_BOUNDS`, civic buildings included) — `Hud`.
- `src/game/MiniMap.ts` — heading-up corner minimap with the street route to the current objective — `Game`.
- `src/game/RoadRoute.ts` — A* street routing on a 2 m road grid — `MiniMap`.
- `src/build/BuildController.ts` — build/buy tools, batched `builds` gestures — `Game`, `Hud`.
- `src/build/Mesher.ts` — walls, floors, roofs, pools to meshes — `Game`, `BuildController`, `HouseManager`.
- `src/build/Openings.ts` — door and window geometry per wall segment (door, glass entry door, French doors, sliding patio door, garage door, window, tall shuttered window, picture, clerestory, frosted); sliders, garage doors and clerestories join across adjacent segments — `Mesher`, `BuildController`, `Hud`.
- `src/build/HouseManager.ts` — per-lot house meshes — `Game`, `BuildController`.
- `src/build/Furniture.ts` — furniture and fixture models; hands `custom:` items to `CustomModels` — `Game`, `BuildController`, `Mesher`, `Thumbs`.
- `src/build/CustomModels.ts` — admin-published items: fetches `/api/maplestreet-items` (cached for offline), registers them, loads each .glb with `GLTFLoader` and clones it per placement with the published `{x,y,z}` scale; custom items are added to the lot group unmerged — `main`, `Furniture`, `Thumbs`.
- `src/build/Thumbs.ts` — off-screen catalog thumbnails — `Game`.
- `src/world/Neighborhood.ts` — terrain, road slabs, lots, trees, street lamps; hands its scenery to `WorldChunks` — `Game`.
- `src/world/WorldChunks.ts` — distance-based world chunking: 64 m grid, per-object view distance from its size (160/320/480/720 m), world-wide instanced trees and lamps split per 256 m cell, async (`compileAsync`) attach queue with hysteresis; houses are tracked per lot — `Game`, `Neighborhood`, `HouseManager`.
- `src/world/Roads.ts` — curbs, gutters, junction-aware markings, crosswalks, stop bars, stop signs, street-name blades, manholes, drains, wheel-path wear; the curved Willow Bend streets as ribbons with curbs, gutters, center dashes and stop signs — `Neighborhood`.
- `src/world/TownSquare.ts` — Maple Commons: lawn, paths, gazebo, clock tower, benches, beds, trees, lamps, plaque — `Downtown`.
- `src/world/Downtown.ts` — downtown buildings (parapets, cornices, awnings, sign cabinets), fire and police stations (apparatus bays, bay lights, flagpoles), depot, streetscape, showroom cars — `Neighborhood`.
- `src/world/Facades.ts` — facade styles and window/storefront layouts shared by the painted textures (albedo, night glow, roughness/metalness) and the 3D trim — `Downtown`.
- `src/world/GasStation.ts` — Gas & Go forecourt, canopy, islands, dispensers, pylon price sign, canopy light — `Downtown`.
- `src/world/Lawn.ts` — mowable lawns: per-lot data texture (blade lean + growth, 4 texels/m) and the view-dependent stripe shader; diamond patterns from crossed passes; grass grows back over five in-game days — `Neighborhood`, `Grass`.
- `src/world/Grass.ts` — instanced grass: thin four-blade clumps; on lawns they follow the lawn's growth (≈4 → 11 cm) and lean the way they were mowed, shaded by lean vs. camera so stripes read in 3D; short verges along the curves, meadow elsewhere — `Game`.
- `src/world/DayNight.ts` — sun and moon, physical sky (`SkyMesh` colorNode scaled by `SKY_GAIN`, plus a moonlit night tint), hemisphere fill, night exposure, PMREM environment bake (`fromScene` options form) — `Game`.
- `src/physics/Physics.ts` — Rapier world and colliders; rounded vehicle colliders (`vehicleShape`); wheel rays hit trailer beds (`CG.DECK`) but never other cars — `Game`, `CameraRig`, `Character`, `Vehicle`, world and build files.
- `src/physics/Parking.ts` — free-spot search for placing vehicles (buildings, props, every vehicle) and the stacked-vehicle check — `Game`.
- `src/physics/VehicleDoors.ts` — hinged door leaves for enclosed built-ins (`DOOR_SPECS`), driver-door pulse on getting in/out, open/close all — `Vehicle`, `RemoteEntities`.
- `src/physics/Character.ts` — kinematic character controller and `Avatar` (scanned model, stand-in while loading) — `Game`, `RemoteEntities`.
- `src/physics/Vehicle.ts` — raycast vehicle: grip-limited, rate-limited steering with Ackermann front wheels, pedal ramps, torque curve, handbrake rear slide; built from any `PRESETS` entry, built-in or published — `Game`, `Dyno`, `VehicleTestDrive`.
- `src/physics/CustomVehicleModels.ts` — published vehicles: fetches `/api/maplestreet-vehicles` (cached for offline), registers them with `shared/CustomVehicles.ts`, adds `PRESETS` entries whose body is the .glb in the chassis frame with game wheels, lamps and paint (material or color-mask recolor) — `main`, `VehicleTestDrive`.
- `src/physics/Dyno.ts` — full-throttle pull on the real physics (0–target time, top speed) — `VehicleTestDrive`, `tests/vehicles.test.ts`.
- `src/game/VehicleTestDrive.ts` — `?vehicleTest=1`: the admin editor posts a draft record; runs the dyno, reports `tl-vehicle-test-result`, then lets the admin drive on a flat pad — `main`.
- `src/avatar/AvatarAssets.ts` — loads `public/modules/maplestreet/{male,female}.glb` + region masks, flattened-hair variant — `Character.ts`.
- `src/avatar/AvatarMaterial.ts` — TSL wardrobe recolor shader — `AvatarModel`.
- `src/avatar/AvatarModel.ts` — skeleton clone, look, procedural walk/run/idle/seated pose — `Character.ts`.
- `src/avatar/Gait.ts` — speed-matched walk and run cycles (cadence from stride length so planted feet don't slide; running lean, swing-knee tuck, arm pump) — `AvatarModel`, `Character.ts` stand-in.
- `src/avatar/HairAndHats.ts` — long hair, buns, hats on the head bone — `AvatarModel`.
- `src/avatar/RigData.ts` — scan measurements (region means, scalp ellipsoids).
- `src/game/DevPanel.ts` — developer instance panel (F8): published and draft items and vehicles with Place and Drive — `main` (only with `?dev=1`), `Game.devPlace` / `devDrive`.
- `src/game/WardrobeUI.ts` — one-time character creator (male/female, hair, face, starter outfit), wardrobe (hair and face only; outfit locked) and the Maple Threads shop panel — `Game`.
- `shared/Wardrobe.ts` — looks, clothing catalog, `cleanLook` validation, `keepOutfit` (clothes only change at Maple Threads) — `RoomLogic`, `Economy`, `Npc`, client.
- `tools/build-characters.mjs` — offline scan → rigged avatar + mask pipeline (not part of the build).
- `src/physics/VehiclePresets.ts` — procedural bodies of the built-in vehicles (tuning comes from `shared/Vehicles.ts`); `PRESETS` also holds published vehicles; `wheelFor` picks a published wheel model or the procedural wheel; `makePaint`/`paintFor` build the paint for a finish or an owned car's style — `Vehicle`, `Downtown`, `RemoteEntities`, `Hud`.
- `src/net/Transport.ts` — transport interface — every transport, `Game`.
- `src/net/WorldTransport.ts` — shared world over `/api/maplestreet` — `Game`.
- `src/net/OfflineTransport.ts` — solo mode (unlimited money, save `maplestreet/solo/v3`) and fallback — `Game`.
- `src/net/Host.ts` — in-browser authority for solo mode — `OfflineTransport`.
- `src/net/RemoteEntities.ts` — remote player and vehicle interpolation; vehicles are data (snapshot buffers) with a pooled 3D view + collider only within 200 m (released past 240 m), neighbor walkers likewise within 110 m; a pooled view is repainted (paint, dents, tint, rims, lift) whenever it shows a car with a different snapshot `style`; remote doors swing when their driver gets in or out; `pickVehicle` for the right-click menu — `Game`.
- `shared/RoomLogic.ts` — single rules authority (ownership, builds, money, loans, mowing, deliveries, shops, fuel, needs); a newer connection for the same account supersedes the old one so its player and vehicles leave the world — `Game`, `Host`, `WorldServer`, `NeighborhoodRoom`, `maplestreet-world.ts`.
- `shared/WorldServer.ts` — persistent world loop; storage keys are prefixed with `WORLD_GENERATION` (bump it to reset everyone) — `maplestreet-world.ts`.
- `shared/WorldLayout.ts` — town layout: 60 grid lots on ten residential streets plus 20 Willow Bend lots of mixed sizes (26 × 36 to 60 × 60 m) on the curved streets (`CURVES`, `curveDistance`, `bendCurbZ`), roads and `ROAD_NAMES`, `lotPrice`, shops, civic buildings (`CIVIC`: fire and police), gas station, `MAP_BOUNDS` — sidewalks (with their road side, `residentialSidewalks()`), `RoomLogic`, `Game`, world files, `PlotMap`, `MiniMap`, `RoadRoute`.
- `shared/DowntownGrid.ts` — the downtown grid east of Market Ave: `GRID_X` / `GRID_Z`, `GRID_BLOCKS`, `TOWN_SQUARE`, `GRID_ROADS`, `GRID_SIDEWALKS`, `GRID_BUILDINGS` (parcels and landmarks) — `WorldLayout`, `Downtown`, `Neighborhood`, `Npc`.
- `shared/Seed.ts` — simulated neighbors' roster, `seedNeighborhood`, `upgradeSeed` (once per `SEED_VERSION`) — `RoomLogic`.
- `shared/HousePlans.ts` — seven house plans in lot-local coordinates (`Plot`) emitted as build ops — `Seed`.
- `shared/Assets.ts` — asset status (`draft`, `published`, `retired`) — `CustomItems`, `CustomVehicles`, `src/server/maplestreet-assets.ts`, the admin editors.
- `shared/Npc.ts` — simulated neighbors; drivers follow arc-smoothed lanes, stop at stop lines, keep a bumper-to-bumper gap to oriented vehicle footprints (`obstaclesFrom`, `pathGap`; junction tie-break) and lean in turns; published vehicles with traffic on join as extra drivers (`syncCustomTraffic`) — `Host`, `WorldServer`.
- `shared/Catalog.ts` — build/buy catalog (`custom` and `hidden` fields for published items) — `RoomLogic`, `BuildRules`, `Furniture`, `Mesher`, `Thumbs`, `Hud`.
- `shared/CustomItems.ts` — published-item records, limits, `footprintFromSize`, `registerCustomItems` (adds `custom:<id>` entries to `CATALOG`) — `CustomModels`, `maplestreet-world.ts`, `src/server/maplestreet-items.ts`, the admin editor.
- `shared/BuildRules.ts` — build validation — `RoomLogic`, build files, `Hud`, `PlotMap`.
- `shared/Economy.ts` — prices, loan cap, pay; `VEHICLES` (built-ins + published, `paintable` false for published vehicles that keep their own colors), `refreshDealer`, `normalizeAccount` keeps `custom:` garage entries and fills `Account.cars` — `RoomLogic`, `WorldServer`, `Game`, `Hud`.
- `shared/Cars.ts` — each owned car's look (`OwnedCar`: paint color and gloss/metallic/matte finish, crash `damage` 0–1 and up to `MAX_DENTS` dents in chassis space), dealer `PAINT_SWATCHES`, `cleanCar` validation, `crashDamage`/`addCrash` (crashes start at `CRASH_MIN_DV` 4 m/s of horizontal speed change in one step, a ~30 mph wall hit costs about a quarter), `conditionEffects` (up to −35% engine, −20% grip, a slight pull), `carStyleKey` for rebuilds — `Economy`, `RoomLogic` (buy, crash, snapshots), `Vehicle`, `RemoteEntities`, `Hud`.
- `shared/BodyShop.ts` — Maple Body & Wheel: layout (`BODY_SHOP`, three `BODY_SHOP_BAYS`, `inBay`, `atBodyShop`), the menu (rims, tint, lift, performance parts) and every price (`repairPrice`, `quote`), `cleanOrder`/`applyOrder` — `RoomLogic` (`service`), `BodyShopUI`, `Downtown`, `MiniMap`, `PlotMap`.
- `src/world/BodyShop.ts` — the three-bay garage building: open bays, dividers, lifts, sign, apron; only walls, dividers and posts collide — `Downtown`.
- `src/game/BodyShopUI.ts` — the body shop window (repairs, paint, tint, wheels, lift, performance) with a live itemized quote — `Game`.
- `src/physics/CutParts.ts` — opening doors, hood and trunk for published vehicles: `cutParts` moves the model's triangles inside each `CustomVehicleSpec.parts` box into a hinged leaf (doors at their front edge, mirrored; hood at its back edge; trunk at its front edge, or a `drop` tailgate at its bottom edge), and `PartRig` swings them with the same calls as `VehicleDoors` plus `setHood`/`setTrunk` — `CustomVehicleModels`, `Vehicle`, `RemoteEntities`, `Game` (right-click menu).
- `src/physics/Dents.ts` — `applyDents` pushes a body's vertices in around each stored dent (geometry cloned first), `impactPoint` finds where a hit landed on the chassis outline — `Vehicle`, `RemoteEntities`.
- `shared/Vehicles.ts` — `VehicleKind` (built-ins plus `custom:<uuid>`), built-in tuning as plain data, `TUNING` registry, `rideHeight`, `wheelbaseOf`, `vehicleRole`, `BODY_EXTENTS` (reference outlines) — everything that handles vehicles.
- `shared/CustomVehicles.ts` — published-vehicle records, limits, `BRAND_PATTERN`, `registerCustomVehicles` (tuning, dealer, traffic; always adds the bundled vehicles) — `CustomVehicleModels`, `Npc`, `maplestreet-world.ts`, `src/server/maplestreet-vehicles.ts`, the vehicle editor.
- `shared/BundledVehicles.ts` — vehicle records that ship with the game (Meridian Sedan, Bulwark 4x4, Ironhorn Crew Cab), models in `public/modules/maplestreet/vehicles/`; a published record with the same id replaces one — `CustomVehicles`.
- `shared/VehicleDrive.ts` — `predictDrive` / `solveDrive`: top speed and 0–60 targets → engine force and torque cutoff, matching the physics — the vehicle editor, tests.
- `shared/PaintMask.ts` — color-mask recolor shared by the game and the editor preview.
- `tests/vehicles.test.ts` — registry, drive model vs. real physics, traffic, garages; `tests/town.test.ts` — lot/road/building/sidewalk layout and minimap routing; `tests/houses.test.ts` — every house plan on both lot orientations, seeding and the seed upgrade; `tests/movement.test.ts` — gait foot speed and knee timing, NPC gaps and no gridlock, reconnect superseding; `tests/suggest.test.ts` — the vehicle editor's Suggest points wheel finder (`src/components/maplestreet/vehicle/suggest.ts`) and view-to-metre conversion; `tests/cars.test.ts` — car paint on accounts, dealer purchases with a color and finish, snapshots carrying the owner's paint, and crash damage (thresholds, dents, which cars the authority will damage); `tests/bodyshop.test.ts` — the body shop's placement and bays, prices, order validation, upgrade effects and paid service only for a car parked in a bay; `tests/parts.test.ts` — cutting part boxes out of a mesh into hinged leaves, how each part swings, and part validation (`node scripts/maplestreet-tests.mjs`, part of `pnpm test`).
- `shared/Mowing.ts` — lawn cells (cut time + blade lean per m²), lean blending, growth (`GROW_DAYS` = 5), mowing pay, run-length encoding — `RoomLogic`, `Game`, `Lawn`, `Grass`.
- `shared/Protocol.ts` — message protocol types — every transport, `RoomLogic`, `WorldServer`.
- `colyseus-server/index.ts`, `NeighborhoodRoom.ts` — optional Node room on the shared logic — run separately.

### fairway — Fairway Nine (`modules-src/fairway/`, built from `_template`)
- `modules-src/fairway/module.json` — id `fairway`, title, accent `#4fd27a`, modes — `config.ts`.
- `modules-src/fairway/tuning.ts` — pure tunables shared by systems and tests: air, ball, clubs, surface contact, lies, trees, cup, flight, terrain shape, wind, meter, camera, match rules, timing, hole data — `config.ts`, `systems/*`.
- `modules-src/fairway/config.ts` — `tuning` plus engine overrides (`net.maxPeers` 3), action bindings, terrain/water/tree/grass/flag/ball/gauge looks, HUD and lobby copy, room format — `index.ts`, `view/*`, `session/*`, `ui/*`.
- `modules-src/fairway/data/holes.json` — the nine original holes: tee, pin, route, tee box, fairway, green, bunker, water and cart-path polygons in world metres, hills, green tilt, trees, OOB bounds, drop zones — `tuning.ts`.
- `modules-src/fairway/index.html` — page shell: `#stage`, start screen with mode picker and record-book tabs, lobby, scorecard, pause, meter canvas, turn banner; `--lib-*` tokens only — `vite.modules.ts` (→ `public/modules/fairway.html`).
- `modules-src/fairway/index.ts` — entry: App, quality, environment, lighting, post, `Input<Action>`, Hud, sky/balls/tracer/aim guide/grass, steps `Play` each fixed step, moves meshes each frame, `__tlModule`, disposes on `pagehide` — `index.html`.
- `modules-src/fairway/models/Terrain.ts` — heightfield mesh with zone attributes and a TSL grass shader (two-octave noise, mow stripes) — `view/HoleScene.ts`.
- `modules-src/fairway/models/Water.ts` — pond plane with a TSL Gerstner `positionNode` and fresnel `colorNode` — `view/HoleScene.ts`.
- `modules-src/fairway/models/Trees.ts` — instanced oak, conifer and birch: bent branching trunks, noise-sculpted foliage clumps, alpha-cut leaf cards, TSL wind sway — `view/HoleScene.ts`.
- `modules-src/fairway/models/Grass.ts` — instanced tapered grass blades with a colour ramp and TSL sway — `view/GrassField.ts`.
- `modules-src/fairway/models/Flag.ts` — cup, flagstick and cloth with a sine flutter node and celebration boost — `view/HoleScene.ts`.
- `modules-src/fairway/models/TeeMarkers.ts`, `models/Ball.ts`, `models/Tracer.ts`, `models/AimGuide.ts`, `models/Sky.ts` — tee posts, ball, shot tracer line, instanced aim dots, gradient sky dome — `view/HoleScene.ts`, `index.ts`.
- `modules-src/fairway/view/HoleScene.ts` — samples a `Course` into terrain, water, tree, flag and tee-marker specs and disposes them per hole — `index.ts`.
- `modules-src/fairway/view/GrassField.ts` — plants grass blades on a world-anchored grid around the ball by surface — `index.ts`.
- `modules-src/fairway/session/Play.ts` — session controller: match and round state, swing launch, solo/host authority, guest replay, records, camera stepping — `index.ts`.
- `modules-src/fairway/session/OnlineRoom.ts` — `PeerRoom<FairwayMessage>` glue: roster handshake, sender checks, late join, drops, `bridgeHub`, `autoJoinFromQuery` — `Play.ts`.
- `modules-src/fairway/session/Presenters.ts` — HUD, scorecard and record-book display models — `Play.ts`, `index.ts`.
- `modules-src/fairway/ui/Screens.ts`, `ui/HudView.ts`, `ui/Gauge.ts` — DOM screens and board tabs, engine-Hud panels with touch buttons, the curved swing gauge and numeric readout — `index.ts`.
- `modules-src/fairway/systems/BallFlight.ts` — deterministic semi-implicit Euler flight (gravity, drag, Magnus lift, wind), bounce, roll, cup, water and OOB; `simulateShot(params, seed)` — `Match`, `Play`, tests.
- `modules-src/fairway/systems/Course.ts` — hole heightfield, gradient, normals, surfaces, bounds, tee/forward tee, pin and drops — `BallFlight`, `Match`, `view/*`.
- `modules-src/fairway/systems/Surfaces.ts` — polygon tests, surface priority, lie power/spin factors, contact properties — `Course`, `BallFlight`.
- `modules-src/fairway/systems/Wind.ts` — seeded hole wind and its height profile — `BallFlight`, `Match`.
- `modules-src/fairway/systems/SwingMeter.ts` — three-click meter state machine and accuracy curve — `Round`, `ui/Gauge.ts`.
- `modules-src/fairway/systems/Camera.ts` — follow/preview/tracking/green camera state machine with the critically damped spring — `Play`.
- `modules-src/fairway/systems/Match.ts` — match authority: holes, strokes, penalties, farthest-first turns, shot seeds, placements — `Play`, tests.
- `modules-src/fairway/systems/Round.ts` — `RoundState` union and reducer/ticker for every mode — `Play`.
- `modules-src/fairway/systems/Protocol.ts` — Zod-validated `FairwayMessage` union (hello, roster, start, shot, state, turn, finish) — `OnlineRoom`.
- `modules-src/fairway/systems/Records.ts` — `/api/fairway` save/load client with an injected hub notifier — `Play`, `ui/Screens.ts`.
- `modules-src/fairway/systems/ClubAdvice.ts`, `systems/Random.ts`, `systems/Vector.ts` — club reach table and suggestion, seeded RNG and hashing, vector math — systems, `Play`.
- `modules-src/fairway/tests/fairway.test.ts` — flight (carry range, wind, spin, curve, bunker, rough, water, OOB, putting), meter, spring, match, protocol and round tests — `scripts/fairway-tests.mjs`.
- `public/images/modules/fairway.webp` — hub thumbnail rendered from the module — `modules.ts`.

### sandlot — Sandlot Sluggers
- `modules-src/sandlot/index.html` — whole 2D module, PeerJS rooms `sandlot-<code>` — `vite.modules.ts` (→ `public/modules/sandlot.html`).
- `modules-src/sandlot/index.ts` — entry; provides `window.Peer` — `index.html`.

### botwreck — BotWreck 3D
- `modules-src/botwreck/index.html` — page shell, loads `module-scores.js` — `vite.modules.ts` (→ `public/modules/botwreck.html`).
- `modules-src/botwreck/index.ts` — entry; imports `main.js` — `index.html`.
- `modules-src/botwreck/main.js` — whole module: three.js + cannon-es crash lab, `tlScores.submit` — `index.ts`.

### chess — Chess
- `modules-src/chess/index.html` — board, CPU worker, PeerJS rooms `tl-chess-<code>` — `vite.modules.ts` (→ `public/modules/chess.html`).
- `modules-src/chess/index.ts` — entry; provides `window.Peer` — `index.html`.

### checkers — Checkers
- `modules-src/checkers/index.html` — board, CPU, PeerJS rooms `tl-checkers-<code>` — `vite.modules.ts` (→ `public/modules/checkers.html`).
- `modules-src/checkers/index.ts` — entry; provides `window.Peer` — `index.html`.

### 2048 — 2048
- `public/modules/2048.html` — whole module, `tlScores.submit` — hub iframe.

### helicopter — Chopper Cave
- `public/modules/helicopter.html` — whole module, `tlScores.submit` — hub iframe.

### shorttrack — Short Track Showdown
- `modules-src/shorttrack/index.html` — page shell: menus, HUD markup, styles — `vite.modules.ts` (→ `public/modules/shorttrack.html`).
- `modules-src/shorttrack/index.ts` — entry; provides `window.Peer`, imports `main.js` — `index.html`.
- `modules-src/shorttrack/main.js` — whole module: three.js scene, trucks (`TM`), `buildStockCar`, liveries, `?track=`, lap posts, `tl-lap`, PeerJS `sts-oval-race-<code>` — `index.ts`.
- `modules-src/shorttrack/shorttrack-numbers.js` — race-number fonts and styles — `main.js`.
- `modules-src/shorttrack/iconic-schemes.js` — the AI field: iconic NASCAR look-alike schemes per car number (`ICONIC_FIELD`, `ICONIC`), knockoff logos (`LOGOS`, `logoCanvas`) and the side/hood painters (`drawSchemeSide`, `drawSchemeHood`) — `main.js`.
- `modules-src/shorttrack/prison-speedway.js` — Prison Speedway scenery (`buildPrisonSet`: guard towers, curtain wall, razor wire, searchlights, name board; `buildPrisonInfield`: the walled infield cell house with two three-storey cell blocks, four round towers, a barred front gate, barred windows with inmates (instanced) and a `setNight` hook that lights the cells) and the inmate crowd and stand colors — `main.js`.
- `public/modules/shorttrack-car.bin` — decimated super late model with atlas UV regions — fetched by `buildStockCar`.

### pool — 8-Ball Pool
- `src/components/PoolTable.tsx` — table, physics, shots, practice and live 1v1 — `index.tsx`.
- `src/components/PoolLobby.tsx` — lobby, challenges, `usePoolLobby` — `index.tsx`, `PoolTable.tsx`, `SitePresence.tsx`.
- `src/components/CueArtwork.tsx` — cue rendering — `PoolTable.tsx`.
- `src/lib/cue-design.ts` — cue design model — `PoolTable`, `CueArtwork`, `PoolLobby`, `pool-network`.
- `src/lib/pool-computer.ts` — CPU shot planner — `PoolTable.tsx`.
- `src/lib/pool-effects.ts` — sounds and effects — `PoolTable.tsx`.
- `src/lib/pool-network.ts` — socket.io client to the Railway service — `PoolTable`, `PoolLobby`, `Racing`, `SitePresence`.
- `server/index.mjs` — Railway service entry: pool rooms, `/version`, mounts racing and park — Railway.

### racing, oval — Max Secure Circuit, Oval Speedway
- `src/components/Racing.tsx` — 2D canvas client, paint profiles, mounted with `fixedTrack` — `index.tsx`.
- `src/lib/racing.ts` — tracks, tickets, lap-record client — `Racing.tsx`, `routes/racing.ts`.
- `server/racing-engine.mjs` (+ `.d.mts`) — shared physics for browser and server — `Racing.tsx`, `lib/racing.ts`, `server/racing.mjs`.
- `server/racing.mjs` — multiplayer race rooms — `server/index.mjs`.

### park — Thrill Park
- `src/components/park/ParkGame.tsx` — menu and lobby — `index.tsx` (lazy).
- `src/components/park/ParkScoreboard.tsx` — per-map company-value leaderboard with View buttons — `ParkGame.tsx`.
- `src/components/park/ParkShotDialog.tsx` — screenshot viewer for a leaderboard park — `ParkScoreboard.tsx`.
- `src/components/park/ParkHud.tsx` — in-game interface, park naming gate, ride-category tabs, staff repair-job selection, daily staff/electricity finances, drag-anywhere quick draw for ground paths, coaster-style path builder (turn/section rows, Build piece, Remove last, Auto-finish via `pathFinish`) for stairs and raised walkways, Level land from the drag's start corner, custom footpath colors, drag-to-buy land with a price confirmation, arrow-key camera orbit, graphics quality button and canvas — `ParkGame.tsx`.
- `src/components/park/GuestCapacity.tsx` — guest cap readout (rides and shops, land, what is limiting) — `ParkHud.tsx`.
- `src/lib/park/gl.ts` — WebGL2 helpers: mesh builder (auto materials, baked vertex AO, swept tubes), indexed 24-byte vertex packing, GGX/clearcoat lighting with ACES tonemap, fitted sun shadow map with rotated PCF, GPU-generated detail texture array with triplanar sampling and derivative bump, procedural terrain and water detail, height fog, wind sway, quality-level shader variants and the GPU probe — `models.ts`, `renderer.ts`.
- `src/lib/park/materials.ts` — material ids and the roughness/metalness/clearcoat/wrap/detail table — `gl.ts`, `models.ts`, `renderer.ts`.
- `src/lib/park/quality.ts` — `low`/`medium`/`high` tiers (`?quality=`, software-renderer detection, probe × DPR) — `renderer.ts`, `ParkHud.tsx`.
- `src/lib/park/models.ts` — guests (`addPerson`), scenery, stalls and flat-ride models including the enclosed Gravitron drum and oblong Zipper boom — `renderer.ts`.
- `src/lib/park/renderer.ts` — terrain, shadow pass, elevated footpaths and stair ramps, boardwalks, smoothly banked custom kart tracks, side-by-side compact karts, customizable ride colors, flat rides, overhead signs where entrance queues meet the footpath (`queueSignModel`), and clearance-aware supports, `captureOverview` (whole-park leaderboard screenshot) and `renderShot` (off-screen capture at any camera) — `ParkHud.tsx`.
- `src/lib/park/waterModels.ts` — Wave Pool model sized to its footprint (wave machine house, beach entry, moving swells set by the wave setting, loungers, lifeguard stand) — `renderer.ts`.
- `src/lib/park/waterRides.ts` — models for the 15 water park rides (slide towers, tubes, rafts, bowl, funnel, half-pipe, trapdoor, mat racer, loop, surf sheet, splash pad, lagoon, bucket fort, lily pads, cliff jump) and their default tints — `renderer.ts`.
- `src/components/park/ResortPanel.tsx` — Resorts tab cards and the hotel window (rooms, occupancy, income, colors, roof, add-ons, demolish) — `ParkHud.tsx`.
- `src/lib/park/hotelModels.ts` — hotel meshes for the eight styles with floors, colors, roofs and add-ons (rooftop pool, sign, balconies, entrance canopy) — `renderer.ts`.
- `src/components/park/RideComments.tsx` — "What guests are saying" in the ride window: mood bar and the latest comments — `ParkHud.tsx`.
- `src/components/park/WaveControl.tsx` — wave setting picker in the ride window — `ParkHud.tsx`.
- `src/lib/park/culling.ts` — view-frustum tests: off-screen guests before instancing, and frustum planes/sphere tests for static instances and whole rides — `renderer.ts`.
- `src/lib/park/shotCams.ts` — fixed debug cameras (`?shotCam=station|flat|waterRide|wavePool|hotel|shoreline|overview`) for matched screenshots — `ParkHud.tsx`, `scripts/park-shots.mjs`.
- `scripts/park-scene.mjs`, `scripts/park-shots.mjs` — deterministic graphics test park and the screenshot / in-park perf / renderer audit harness (`docs/PARK-GRAPHICS-PLAN.md`) — run by hand.
- `src/lib/park/session.ts` — local and online sessions — `ParkGame.tsx`, `ParkHud.tsx`.
- `src/lib/park/api.ts` — saves, tickets, scores and screenshot client — `ParkGame`, `ParkHud`, `ParkScoreboard`.
- `server/park/index.mjs` (+ `index.d.mts`) — shared simulation entry — park UI files, `renderer.ts`, `session.ts`, `server/park.mjs`.
- `server/park/state.mjs`, `terrain.mjs`, `catalog.mjs`, `track.mjs`, `autotrack.mjs`, `commands.mjs`, `guests.mjs`, `sim.mjs`, `snapshot.mjs`, `util.mjs`, `land.mjs`, `flatspec.mjs`, `thrill.mjs`, `comments.mjs`, `hotels.mjs`, `park.test.mjs` — expanded maps and purchasable park land on the sides and behind the entrance, stable park IDs, saved elevated paths and stair navigation, walkable path types and colors, auto-facing shop placement, customizable coaster catalog with loops and corkscrews, two-train coasters with up to 10 cars each, 14-car side-by-side kart fleets, coaster and custom-ride physics, mechanic dispatch through footpaths or queue lines, exit lines laid with queue-line tiles (`exitLine`, kept apart from entrance queues), commands, guest/staff AI, $50 daily wages and $1-per-tile electricity, ten-day months, guest cap from rides, shops and owned land (`spawnRate`, `ownedTileCount`), area land purchases (`landAreaPlan`, `buyLandArea`), resizable flat rides priced by area (`flatSpec`, Wave Pool wave settings), compact ready-made coasters with declared footprints, raised Suspended Looper stations, thrill-seeking guests who warm up and follow friends onto intense rides, per-ride guest comments, hotels and resort districts, a persistent guest index, snapshots, regression tests, helpers — `server/park/index.mjs` and each other.
- `migrations/0011_park_scores_by_park.sql` — migrate high scores to one durable record per named park — `/api/park`.
- `server/park.mjs` — online park rooms — `server/index.mjs`.

## Contracts

Every phase keeps these exactly (sources: `AGENTS.md`, `docs/AUDIT.md` §1, verified against the module sources).

- Module ids and `src` paths: `embeddedModules` and `learningModules` in `src/lib/modules.ts`; hub routes `#module-<id>`, `#racing`, `#oval`, `#park` (pool opens from its hub card); iframe selector `.play-frame iframe`; the hub appends `?name=<username>&room=<code>` to every embedded `src`.
- `tlScores.submit(module, value)` from `public/modules/module-scores.js`.
- `postMessage` child → parent `{type:'tl-score-saved', module, saved}` — refreshes `ModuleScoreboard`.
- `postMessage` child → parent `{type:'tl-lap', track, mode}` — refreshes `LapRecordBoard`.
- `postMessage` child → parent `{type:'tl-fairway', board}` (`round`, `pin`, `match`) — refreshes `FairwayRecordBoard`.
- `postMessage` parent → child `{type:'tl-host'}`; child answers `{type:'tl-room', code}` — sandlot, chess, checkers, shorttrack, maplestreet, fairway.
- Query params: `?room=<code>` (auto-join), `?name=<username>` (sandlot, chess, checkers, shorttrack, maplestreet, fairway; fairway falls back to a fixed `Guest-xxxxx` per browser), `?track=shorttrack|dells|dellswide|prison|dirt` (Short Track Showdown), `?world=`, `?solo=` (Maple Street).
- PeerJS room codes: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (Maple Street also allows `L`), shown upper-case; peer ids lower-case the code: `sandlot-`, `tl-chess-`, `tl-checkers-`, `tl-fairway-` (host plus up to three guests). Short Track Showdown: 5 letters A–Z without I/O, peer id `sts-oval-race-<CODE>`.
- Group-chat invites `meta.invite = {module, label, code}`.
- `/api/*`: `pool-account`, `workspace-access`, `workspace-admin`, `site-changes`, `account-settings`, `pool-practice`, `pool-preferences`, `pool-cue-overlay`, `racing`, `fairway`, `park`, `maplestreet`, `maplestreet-items`, `maplestreet-vehicles`, `meshy`, `group-chat`, `module-scores`, `studio`, `library`, `asset`, `learning`, `lyric-presets`.
- Railway service: socket.io default namespace (pool), `/racing`, `/park`; tickets from `/api/pool-account?action=ticket`, `/api/racing`, `/api/park`; client URL env `VITE_POOL_SERVER_URL`; pool header `X-Pool-Player`.
- Ticket redeem: `/api/pool-account?action=redeem`, `/api/racing?action=redeem`, `/api/park?action=redeem` (server-to-server).
- Server-shared files: `server/racing-engine.mjs`, `server/park/` (deterministic commands); changes redeploy Railway and bump `/version` in `server/index.mjs`.
- Maple Street: `shared/RoomLogic.ts` is the only rules authority; Durable Object binding `MAPLE_WORLD`, D1 table `maplestreet_world`.

## Conventions

1. One three.js version for the whole site, pinned in `package.json` and served from the Vite build, never a CDN.
2. Every 3D model is its own file under `modules-src/<game>/models/` exporting a factory; no geometry built inline in a loop file; models never import game rules, game rules never import three.js.
3. Every tunable (colors, sizes, counts, physics constants, quality tier, key bindings) lives typed in `modules-src/<game>/config.ts` or `data/*.json`; no magic numbers in scene or system code.
4. Keep the contracts above intact.
5. Visible copy says "learning module" on a site named "the library" (lowercase); never game, gaming or entertainment in visible text or metadata.
6. Keep every name, vehicle, ride and asset original; no brand names, logos or copied designs.
7. After each change `pnpm build` passes, the module loads in the hub iframe with no console errors, and this file describes any new file in one line.
8. Delivery is a pull request from `revamp/<phase>-<step>` with `phase<N>-step<M>:` commits, gate results and before/after screenshots, squash auto-merge on a green `modules` check; never force-push `main`; owner-only settings get the `needs-owner` label.
