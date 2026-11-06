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
- `src/components/AnglerRecordBoard.tsx` — Northwoods Angler record book: the top 3 of every species with when each was caught (species filter, admin reset), refreshes on `tl-angler` — `index.tsx`. `src/lib/angler.ts` — its types and fetch client.
- `src/lib/fairway.ts` — browser-safe Fairway Nine board types, limits, formatting and the fetch client (`fetchFairwayBoard`, `saveFairwayRecord`) — `FairwayRecordBoard.tsx`, `routes/fairway.ts`.
- `src/components/AdminRecordReset.tsx` — admin-only reset of the selected board — boards and `index.tsx`.
- `src/components/PoolAccount.tsx`, `SignInRibbon.tsx` — sign-in form and ribbon — `index.tsx`, `PoolTable.tsx`, `Racing.tsx`.
- `src/components/GroupChat.tsx`, `SitePresence.tsx` — floating chat, invites (`meta.invite`), online presence — `index.tsx`, `Racing.tsx`.
- `src/components/AdminPanel.tsx`, `WorkspaceAdmin.tsx`, `SiteChanges.tsx` — admin tabs: people, site-change chat — `index.tsx`.
- `public/modules/module-scores.js` — `tlScores.submit(module, value)` → `/api/module-scores`, then `tl-score-saved` to the parent — 2048, Chopper Cave, BotWreck 3D and the single-file score modules.

### Tooling and delivery

- `package.json` — scripts `dev`, `build` (models, learning modules, then the site), `assets` / `assets:check` / `assets:report` (the model pipeline), `test` (engine + fairway type-check via `tsconfig.engine.json`, park, Fox Plains, Fairway Nine, Northwoods Angler and Bush League Baseball node suites), `gate`, `engine:smoke`; pins the engine versions below; build and deploy tooling (Vite, plugins, esbuild, sharp, wrangler) lives in `dependencies` because Workers Builds installs with `NODE_ENV=production` — CI and developers.
- `vite.config.ts` — site build; runs `modelAssets()` then `learningModules()` first (watch mode under `pnpm dev`) so `pnpm build` stays the single command — Vite.
- `vite.assets.ts` — Vite plugin that runs `scripts/assets.mjs` once before a build and when the dev server starts; under Workers Builds (`WORKERS_CI`) it only runs `--check`, and `SKIP_MODEL_ASSETS=1` skips it — `vite.config.ts`.
- `scripts/assets.mjs` — model pipeline: every `assets-src/models/**/*.glb` → `public/models/` (committed, with `.assets-cache.json`; `ASSETS_WORKERS` caps parallelism, default 4) through gltf-transform: dedup, instance, palette, flatten (not for `rig` presets, which keep wheel and part pivots), join by material (nodes named `Wheel_*`, `Tire_*`, `RaceNumber_*`, `Hitch*`, `Trailer*` and the file root stay separate), weld, optional simplify (houses), WebP textures (lossless ≤ 256 px, quality 92 above), quantize and meshopt; crowds and trees (`EXT_mesh_gpu_instancing`) skip quantize/meshopt; three.js's `EXT_materials_bump` is read and written by a custom extension so it survives; the 36 Sandlot Sluggers 3D player exports merge into one `sandlot3d/players.glb` (one scene per player, shared buffers); incremental via `public/models/.assets-cache.json`; `--force`, `--check` (CI), `--report` (the table in `docs/ASSETS.md`) — `vite.assets.ts`, CI.
- `assets-src/models/` — the `GLTFExporter` dumps of every module's models (the pipeline's sources; `assets-src/README.md` lists them) — `scripts/assets.mjs`.
- `public/_headers` — Workers static-asset caching: hashed `/modules/chunks/*` and `/assets/*` immutable for a year; `/models/*`, `/modules/maplestreet/*`, `/modules/sprites/*`, `/images/*` one day plus a week stale-while-revalidate — Cloudflare.
- `docs/ASSETS.md` — before/after size, primitive and material table from the last `pnpm assets:report` — this PR and later phases.
- `vite.modules.ts` — learning-module build: each `modules-src/<id>/` with `index.ts` + `index.html` → `public/modules/<id>.html` plus hashed `public/modules/chunks/`, shared vendor chunks via `manualChunks`; `_`-prefixed folders are shared code — `vite.config.ts`.
- `tsconfig.engine.json` — strict type-check of `engine/`, `modules-src/_template/`, `modules-src/fairway/`, `modules-src/demoderby/`, `modules-src/angler/`, `modules-src/foxplains2/`, `modules-src/county/` and `modules-src/bushleague/` (tests excluded; they run through esbuild) — `pnpm test`.
- `scripts/fairway-tests.mjs` — bundles `modules-src/fairway/tests/*.test.ts` with esbuild and runs them with `node --test` — `pnpm test`.
- `scripts/bushleague-tests.mjs` — bundles `modules-src/bushleague/tests/*.test.ts` with esbuild and runs them with `node --test`; optional name filters (`node scripts/bushleague-tests.mjs rules`) — `pnpm test`.
- `scripts/bushleague-smoke.mjs` — serves the built `public/`, plays a three-inning Bush League contest to the final on WebGPU and on forced WebGL2 (the page pitching through the meter and batting with the keyboard), fails on page errors; `--channel msedge|chrome`, `--out` for screenshots — developers.
- `scripts/demoderby-tests.mjs` — bundles `modules-src/demoderby/tests/*.test.ts` with esbuild (`models/CarBody` swapped for `tests/CarBodyStub.ts`, so no canvas is needed) and runs whole AI-only heats with `node --test` — `pnpm test`.
- `scripts/engine-smoke.mjs` — Vite-builds `_template`, embeds it in a hub-like iframe, checks boot, 60 Hz loop, `--lib-*` tokens, same-origin Draco/KTX2 decoders, `dispose()`, console errors and CDN requests; `--out` saves a screenshot — `pnpm engine:smoke`.
- `.gitignore` — ignores the generated `public/modules/<id>.html` pages and `public/modules/chunks/` — git.
- `.github/workflows/modules.yml` — required `modules` check: install, `pnpm assets:check` (committed models must match their sources), `pnpm build`, `pnpm test`, `node scripts/perf-baseline.mjs --check` — pull requests to `main`.
- `scripts/module-gate.mjs` — Playwright gate (`PLAYWRIGHT_CHROME=<path>` uses a system Chrome instead of Playwright's download; also honoured by `engine-smoke.mjs` and `perf-baseline.mjs`): every embedded module in the hub iframe via `vite preview`, console errors, screenshots to `--out` — `pnpm gate`.
- `scripts/perf-baseline.mjs` — Playwright Chromium perf run against `pnpm dev`: first frame, avg and 1% low FPS, JS heap, draw calls, bytes; writes `docs/PERF-BASELINE.md`, `--compare` flags regressions, `--check` validates the table — CI (`--check`), each phase.
- `docs/AUDIT.md` — Phase 0 audit of every playable module: renderer, model source, physics, multiplayer path, leaderboard hook, CDN loads, contracts, builder functions with line ranges for Phase 2 extraction — every revamp phase.
- `docs/PERF-BASELINE.md` — the numbers every later phase must beat (table plus a `perf-data` JSON block) — `perf-baseline.mjs --check/--compare`.
- `docs/screenshots/<phase>-<step>/` — before/after module screenshots attached to each revamp pull request — PR bodies.
- `.github/workflows/site-change.yml`, `.github/site-changes/run.mjs` — admin site-change runs: Claude Code headless → `site-change/<job>` PR → auto-merge — `/api/site-changes`.
- `.github/workflows/claude-runner.yml`, `scripts/claude-edit.sh` — manually dispatched Claude task runner — Actions.
- `.github/workflows/update-lockfile.yml`, `deploy-cloudflare-proxy.yml`, `cloudflare-proxy/` — lockfile refresh and the proxy Worker — Actions.
- Repository settings relied on (owner-only): auto-merge allowed, squash merge, delete head branches, branch protection on `main` requiring `modules`; labels `needs-owner`, `phase-0` … `phase-8`.

## Worker API

- `src/server.ts` — Worker entry: `/api/*` → `handleApi`, else TanStack Start; exports Durable Objects `MapleStreetWorld` and `AnglerLake` — Cloudflare (`wrangler.jsonc`).
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
- `src/server/routes/angler.ts` + `src/server/angler.ts` — `/api/angler`, Northwoods Angler profiles, anchored sessions, server-rolled catches and record boards (D1 `angler_*`); `start`/`tick`/`stop` carry the shared-lake `room`, so landed fish are announced to that lake instance and the Boat Party progress is checked against the instance's crew — `api.ts`.
- `src/server/routes/angler-lake.ts` — `/api/angler-lake`: GET counts boats out per lake; a WebSocket upgrade (same origin; members by session, guests by a zod-checked key) joins the invited instance or the first of eight per lake with room — `api.ts`.
- `src/server/angler-lake.ts` — Durable Object `AnglerLake` (binding `ANGLER_LAKE`, one per `<lake>:<instance>`): in-memory peers only (nothing stored), up to 4 boats and 8 connections, positions relayed at 4 Hz, fishing phases, crews of two (`board`, `leave`, `lock`, `kick`), member gear read from the saved profile and guest gear checked against the starter kit, internal `/catch` (delayed to the end of the fight) and `/crew` for the REST route — `server.ts`.
- `src/server/maplestreet-world.ts` — Durable Object running `shared/WorldServer.ts`, saves to D1 `maplestreet_world`; registers published items and vehicles before loading the world and again on `POST /catalog` — `server.ts`.
- `src/server/routes/maplestreet-items.ts` — `/api/maplestreet-items`: public list (drafts only for the admin with `?drafts=1`), `?model=<id>` serves the .glb from KV, admin multipart publish (POST, `status` draft or published) and status changes (PATCH `status`, or the older `active`) — `api.ts`. Helpers in `src/server/maplestreet-items.ts` and `src/server/gltf-check.ts`.
- `src/server/maplestreet-assets.ts` — D1 `maplestreet_assets` (migration 0016, also created on first use and back-filled from `maplestreet_items` / `maplestreet_vehicles` with `INSERT OR IGNORE`): one row per published asset with `kind`, `status`, JSON `spec` and `files`; list/get/insert/update and the admin-only draft check — `maplestreet-items.ts`, `maplestreet-vehicles.ts`.
- `src/server/routes/maplestreet-vehicles.ts` — `/api/maplestreet-vehicles`: public list (retired included with `active: false`), `?model=<id>` / `?wheel=<id>` serve KV `maplestreet-vehicle/<id>[/wheel]`, admin multipart publish (`name`, `spec` JSON, `model`, optional `wheel`; with `id` it saves over an existing vehicle and bumps the `&v=` on its model URL) and PATCH (`active`, `name`, `spec`) — `api.ts`. Zod `vehicleSpecSchema` and D1 `maplestreet_vehicles` (migration 0014) in `src/server/maplestreet-vehicles.ts`; `requireMapleAdmin` / `refreshWorldCatalog` in `src/server/maplestreet-admin.ts`.
- `src/server/routes/meshy.ts` — `/api/meshy` (admin only): `?status` (connected, balance, credit table), job list (refreshes unfinished tasks from Meshy), `?model=<job>` (KV `meshy-model/<job>`), POST actions `text`, `image`, `refine`, `remesh`, `retexture`, `cancel`, `hide` — `api.ts`. Meshy client, friendly error mapping and D1 `meshy_jobs` (migration 0015) in `src/server/meshy.ts`; secret `MESHY_API_KEY`, dev-only `MESHY_API_BASE`.
- `src/server/routes/scores.ts` — `/api/module-scores` GET `?module=`, POST `score` / `reset-records` — `api.ts`.
- `src/server/routes/songmaker.ts` — `/api/songmaker` AI songs (see songmaker above) — `api.ts`.
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
| `@dimforge/rapier3d-compat` | 0.14.0 | maplestreet, demoderby |
| `postprocessing` | 6.39.5 | any module (peer range `three >=0.168 <0.187`, hence three 0.186.1, not 0.187.0) |
| `cannon-es` | 0.20.0 | botwreck |
| `peerjs` | 1.5.4 | sandlot, chess, checkers, shorttrack |
| `colyseus.js` | 0.15.28 | (no longer used by a module; maplestreet's optional `colyseus-server/` is server-side) |

Vendor chunks, each emitted once and cached across modules: `vendor` (three core + addons + postprocessing), `vendor-webgpu` (three's WebGPU/TSL build and the addons that need it), `vendor-rapier`, `vendor-net` (PeerJS).

- `modules-src/_shared/peer-global.ts` — imports the bundled PeerJS and sets `window.Peer` — sandlot, chess, checkers, shorttrack entries.
- `modules-src/_shared/adaptive-resolution.js` — `createAdaptiveResolution({ max, min, step, apply })`: dynamic resolution with Fox Plains' thresholds (time-weighted frame time over 22 ms drops a 0.25 step and holds 8 s; under 17.5 ms for 6 s climbs back, never above `max`); `update(dt)` each frame, skipped while the tab is hidden — shorttrack `main.js` (max = the quality setting's ratio, `applyQuality` calls `setMax`), sandlot3d `index.ts` (as `window.__adaptiveResolution`) and `main.js` (max 1.75).
- `modules-src/_shared/static-batch.js` — `batchStatic(root, exclude)`: merges rigid meshes under a root into one mesh per material (same shadow flags, render order, culling, layers and vertex layout; root-relative transform baked in; skips instanced, skinned, morphing, multi-material and childed meshes; run before first render). Anything that moves, deforms or is toggled on its own must be outside the root or in `exclude`. `?batch=0` turns it off in both modules for comparisons — shorttrack `main.js` (scenery, truck shells excluding body/decals/wheel pivots, each wheel), sandlot3d `index.ts` (as `window.__batchStatic`) and `main.js` (ballpark excluding sky and landing ring; per rig: face features, non-crown hair, beard, cap, helmet, cleats, glove, the off hand and each glove-hand finger).

Engine code imports three only as `three/webgpu` (addons from `three/addons/*` share its core); modules import the engine through `engine/index.ts`.

- `engine/index.ts` — barrel export of everything below — module `index.ts` files.
- `engine/config.ts` — typed config shapes (`EngineConfig`, `InputBinding`, `ActionBindings`, `QualityTier`, `LayerName`, optional `RendererConfig.toneMapping` (`aces` default, `agx`, `neutral`) and `PostConfig.effects` (`PostEffects`: GTAO, TRAA, bloom, lens flare, vignette, grain) …) and `ENGINE_DEFAULTS` — module `config.ts`, every engine file.
- `engine/core/App.ts` — `App.create`: WebGPURenderer with WebGL2 fallback (`?webgl` forces it), tone mapping from `renderer.toneMapping`, 60 Hz fixed step + display-rate render with alpha, ResizeObserver for the iframe, visibility pause, `own()` + `dispose()` freeing every GPU resource — module `index.ts`, `render/Post.ts`.
- `engine/core/FixedStep.ts` — accumulator returning `{steps, alpha}` with a sub-step cap — `App`.
- `engine/core/Scene.ts` — `SceneGraph`: layers `world`, `props`, `characters`, `fx`, `ui`; add/remove/clear/find/setVisible — `App`.
- `engine/core/Input.ts` — `Input<Action>`: keyboard, mouse, touch regions, gamepad buttons/axes through a rebindable action map; `pressed`/`released` latched per fixed step — module `index.ts`.
- `engine/core/Assets.ts` — `Assets<Manifest>`: GLTF/GLB with Draco + KTX2 + meshopt (decoders emitted by the Vite build), textures, audio, JSON; `progress` events; cache keyed by URL — module `index.ts`.
- `engine/core/disposeObject.ts` — frees geometries, materials, textures and shadow maps under an object — `App`, `Scene`, `Assets`.
- `engine/render/Lighting.ts` — `createLighting`: hemisphere + shadow sun with `follow()` (Phase 3 fills in) — module `index.ts`.
- `engine/render/Environment.ts` — `applyEnvironment`: background and fog; `bakeEnvironment(renderer, scene, source, intensity)`: prefilters any source scene into a PMREM and installs it as `scene.environment` (no-op handle if the backend cannot bake) — module `index.ts`, `bushleague/view/Lights.ts`.
- `engine/render/Post.ts` — `createPost`: installs the App render pass; with `post.enabled`, a tier that allows post and some `effects` it builds a TSL `RenderPipeline` on the HDR scene colour (GTAO from packed MRT normals, TRAA from MRT velocity, both on a non-MSAA scene pass; bloom, lens flare off the bloom, vignette, film grain) before tone mapping, and falls back to a direct render if the pipeline cannot be built; modules without `effects` render exactly as before — module `index.ts`.
- `engine/render/Quality.ts` — `resolveQuality`: `auto` tier per backend, `?quality=` override — module `index.ts`.
- `engine/physics/World.ts` — `PhysicsWorld`: lazy-loaded Rapier, fixed `step(dt, events?)` (an optional `EventQueue` is drained by the caller for contact events), `track` + interpolated `syncMesh(body, mesh, alpha)`, `setDebug(parent)` line draw — module `index.ts`.
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
| `demoderby` | three.js 0.186.1 WebGPU build (WebGL2 fallback) via `engine/`, Rapier 0.14 raycast vehicles | `modules-src/demoderby/` |
| `bushleague` | three.js 0.186.1 WebGPU build (WebGL2 fallback) via `engine/`; deterministic TypeScript rules and ball physics in `sim/` | `modules-src/bushleague/` |
| `park` | hand-written WebGL2 | `src/lib/park/` |
| `county` | PlayCanvas 2.23.3 WebGL2 (CameraFrame HDR), Rapier via Fox Plains 2's physics | `modules-src/county/` |
| `park2` | Babylon.js 9.34.0 (WebGPU, WebGL2 fallback) behind the `park` renderer's backend interface | `src/lib/park2/` (models, simulation and HUD shared with `park`) |
| `racing`, `oval`, `pool` | 2D canvas | `src/components/` |
| `sandlot`, `chess`, `checkers` | 2D canvas / DOM, bundled PeerJS | `modules-src/<id>/` |
| `2048`, `helicopter`, `alphabet`, `wpm`, `tetradrop`, `bubbles`, `memory`, `simon`, `sudoku`, `minesweeper`, `mathrush`, `blockhead`, `songmaker` | 2D canvas / DOM | `public/modules/<id>.html` (static, shared `module-base.css`) |
| `party` | DOM + 2D canvas, bundled PeerJS | `modules-src/party/` |

Known baseline issues: `shorttrack` is too busy under software WebGL for Playwright screenshots (gate note, not failure). The `maplestreet` `Buffer is not defined` error is gone now that colyseus.js is bundled.

### demoderby — Demo Derby (`modules-src/demoderby/`)
- `modules-src/demoderby/module.json` — id, title, accent `#ff8c2a`, modes — `config.ts`.
- `modules-src/demoderby/config.ts` — every tunable: engine overrides (warm afternoon light), bindings, the 36 × 22 m arena, the two body specs (`wagon`, `sedan`), 16 flat paints, six spray fonts, number colours, vehicle physics, damage (`contactThreshold`, `hitThreshold`, `hitFull`, zones, dents, the 60 s no-contact rule), AI levels, scoring, heat, camera and particles — every file below.
- `modules-src/demoderby/index.html` — page shell: `#stage`, the garage card (body, paint, number, spray style, outline, field size, AI level), results card, countdown banner, body/engine bars, touch labels — `vite.modules.ts` (→ `public/modules/demoderby.html`).
- `modules-src/demoderby/index.ts` — entry: boots the engine, bakes the sky into a PMREM environment (`bakeEnvironment`, so paint, chrome and glass reflect it), the arena, sky and particles, the garage preview turntable, then a heat (player + AI field on a spawn ring), contact events → `Heat`, HUD, results, `Scores.submit('demoderby', points)`; disposes on pagehide — `index.html`.
- `modules-src/demoderby/models/Loft.ts` — `loft(stations)`: skins rings or open strips of (x, y) profile points along z into one welded, smooth-normal, vertex-coloured geometry (faces oriented away from the centroid), plus `mirror`, `bar` (tube between points) and `roundedBox` — `CarBody.ts`.
- `modules-src/demoderby/models/CarBody.ts` — `createCar`: lofted 1970s wagon/sedan shell (`lowerProfile` with fender arches, flares, rocker and belt creases, hood crown and door-seam stations; `upperRing` greenhouse with raked windshield and backlight), reflective glass, pillars, dark caged interior, chrome bumpers with guards, sealed-beam lamps and bezels, barred grille, taillights, hood pins, wagon roof rack, lathe tires and steel rims with lug nuts, the door/roof number decals, grime and streaky rust in vertex colour (never on the player's car) and a contact-shadow plane; `dent(point, direction, strength)` pushes shell and decal vertices in, caps depth and darkens paint; geometry is in the chassis frame (forward −Z, origin `centreHeight` up) — `systems/Vehicle.ts`.
- `modules-src/demoderby/models/Crowd.ts` — `createCrowd(seats)`: bleacher fans as four instanced meshes (torso with arms, head, legs, cap) with per-fan colours; `MeshStandardNodeMaterial` position nodes bob and cheer a share of them — `Arena.ts`.
- `modules-src/demoderby/models/Arena.ts` — `createArena`: dirt floor (canvas texture with ruts and pebbles plus a Sobel normal map, `normalFromHeight`), jersey-barrier ring with matching collider boxes, tire stacks, covered bleachers with the built crowd, pennant strings between the light towers (instanced triangles flapping through a position node), fair tents, light towers and a turning ferris wheel — `index.ts`.
- `modules-src/demoderby/models/Particles.ts` — CPU particle pool rendered as `Points` (tire dust, engine smoke) — `index.ts`.
- `modules-src/demoderby/models/Sky.ts` — gradient sky dome (same TSL shader as Fairway Nine) — `index.ts`.
- `modules-src/demoderby/systems/Look.ts` — `CarLook` (body, paint, number, font, number colour, outline), cleaning, the per-device save and seeded `opponentLook` — `index.ts`, `ui/Garage.ts`, `CarBody.ts`.
- `modules-src/demoderby/systems/Numbers.ts` — `paintNumber`: spray-painted number textures (overspray, drips, stencil bridges, outline, rough tilt) for the doors and roof — `CarBody.ts`.
- `modules-src/demoderby/systems/Vehicle.ts` — `Vehicle`: chassis body + Rapier `DynamicRayCastVehicleController` (rear drive, dirt grip), controls, engine-power falloff, `takeHit` (zone damage, engine share, dents), knock-out, stuck/flip clocks, `rightSelf`, `sync` — `index.ts`, `Heat.ts`, `Ai.ts`.
- `modules-src/demoderby/systems/Heat.ts` — `Heat`: countdown → running → finished; contact-force events → hits on both cars (per-pair cooldown), points, knockouts, the no-contact clock, placings from the back, winner and win bonus — `index.ts`.
- `modules-src/demoderby/systems/Ai.ts` — `driveAi`: target picking, nose or back-in approach, wreck and wall avoidance (`blocked`), stuck and no-progress escape manoeuvres; writes only `car.controls` — `index.ts`.
- `modules-src/demoderby/systems/Camera.ts` — spring chase camera with pointer orbit, grandstand view and the garage turntable — `index.ts`.
- `modules-src/demoderby/ui/Garage.ts` — garage and results screens bound to the DOM in `index.html` — `index.ts`.
- `modules-src/demoderby/tests/heat.test.ts`, `tests/CarBodyStub.ts` — headless six- and ten-car heats: cars stay inside the barriers and on the ground, hits dent and damage, every heat ends with one placed winner — `scripts/demoderby-tests.mjs`.
- `public/images/modules/demoderby.webp` — hub thumbnail — `src/lib/modules.ts`.

### bushleague — Bush League Baseball (`modules-src/bushleague/`, built from `_template`)

Phases 1–2 of `docs/bushleague/PLAN.md`: the full rules core, broadcast looks (HDR post, lighting presets, turf, dirt, crowd, two signature parks) and placeholder capsule players. `sim/` is renderer-free and deterministic (no DOM, no `Math.random`, no clock) so the same code can run in the page, the node tests and, from Phase 5, the `BushLeagueMatch` Durable Object. Sim frame: metres, home plate's back point at the origin, x toward first base, y up, z toward center field; `view/space.ts` flips z for three.js.
- `module.json` — id `bushleague`, title, accent `#e8b23a`, modes — `config.ts`.
- `config.ts` — engine overrides (camera, light, fog, quality tiers), action bindings (cursor WASD/arrows/stick, swing Space/click, power F/right-click, bunt B, steal R, pitches 1–5, skip Enter), field colours, actor sizes, pitch pace (Rookie/Pro/All-Star scale on the pitch's flight), timings, camera poses with their field of view, control hints — every file below.
- `index.html` — page shell: setup card (club, opponent, side, length, pitch speed, DH, extra-inning runner, mercy), score bug, pitch readout, banner, matchup strip, play-by-play, pitch picker and meter, final box score; `--lib-*` tokens only — `vite.modules.ts` (→ `public/modules/bushleague.html`).
- `index.ts` — entry: App with AgX tone mapping (`?tone=aces` for ACES), quality (`?quality=`) mapped to a `TIER_BUDGETS` entry (post effects, cascades, grass and crowd counts, pixel ratio), `createPost`, adaptive resolution (`_shared/adaptive-resolution.js`), `Input<Action>`, `Actors`, `Screens`; per contest the field, stadium lights for the chosen time of day, crowd and grass; the `Scenery` the `Director` drives; `window.__tlModule` and `window.__bushleague` (`start`, `contest`, `director`, `scene`, `react`) for tests; disposes on pagehide — `index.html`.
- `sim/random.ts` — `Rng` (Mulberry32 with `normal`, `weighted`, `fork`), `hashSeed`, `stringSeed` — every sim file.
- `sim/types.ts` — players, ratings, pitch grades, teams, parks, samples — every sim file.
- `sim/league.ts` — the 32 original clubs (Lowbrow and Gutter leagues, four divisions of eight, colours, home park names) and the ten park layouts (fence distance and height at five spray angles, foul ground, altitude, gravity, dome, prevailing wind) — `roster.ts`, `contest.ts`, `ui/Screens.ts`.
- `sim/names.ts` — seeded first/last/nickname part tables, `generateName`, `nameList(seed, count)` — `roster.ts`, tests.
- `sim/roster.ts` — `buildRoster(teamId)`: 13 hitters and 12 pitchers (5 starters, 7 relievers, the sixth arm is the closer) with position-shaped ratings and repertoires — `contest.ts`.
- `sim/pitches.ts` — nine pitch types: speed off the fastball, rpm, break tilt, spin efficiency, knuckleball wobble — `flight.ts`, `ai.ts`, UI.
- `sim/field.ts` — bases, mound, fielder depths, fair angle (`z ≥ |x|`, the pole is fair), beyond-the-bags test, fence distance and height by spray, playable foul ground, strike zone by height — `flight.ts`, `fielding.ts`, view.
- `sim/flight.ts` — semi-implicit Euler at 0.02 s: gravity, drag, Magnus lift from spin rate and tilt, wind by height, air density by altitude; `battedBallPath` (fence, wall carom, warning-track bounce, ground-rule double, seats, bounce and roll), `judgeFair`, `pitchPath` (aims the release so the spinning pitch crosses at its spot, plus its break), `releasePoint` — `contest.ts`, `fielding.ts`, `systems/Director.ts`.
- `sim/contact.ts` — swing vs. pitch: PCI radius by swing type, timing window, foul-off chance, exit speed, launch angle, spray (timing pulls, location pushes), spin — `contest.ts`.
- `sim/fielding.ts` — `resolveBallInPlay`: intercept times for all nine fielders, catches and diving catches, the infield fly, home runs, ground-rule doubles, grounders with forces, double plays, fielder's choice and the contact play, outfield hits with runner decisions and throws, tag-ups and sacrifice flies, doubled-off runners, fielding and throwing errors, PO/A/E credits and a `Timeline` (ball, fielder and runner tracks plus marks) — `contest.ts`, `systems/Playback.ts`.
- `sim/ai.ts` — AI pitch selection and location by count, AI swing decisions (pitch read by eye and movement, chase rates, timing bias from speed differential, swing type) — `contest.ts`.
- `sim/contest.ts` — `Contest`: `prePitch` (bullpen warm-up, pitching changes, pinch hitters, balks, pickoffs, steal calls) → `preparePitch` (control error, effort, fatigue, velocity) → `resolveSwing` (calls, HBP, fouls, two-strike rules, foul-tip and foul-bunt strikeouts, dropped third strike, walks, wild pitches and passed balls, steals, ball in play); half-innings, extras with the runner on second, mercy rule, skipped last bottom half, walk-offs, earned runs, W/L/S/H/BS and quality starts; `log` of every resolved intent and `replay(setup, log)`; `practice` setups put every pitch exactly on target — `stats.ts`, `systems/Director.ts`, tests.
- `sim/scorebook.ts` — batting, pitching and fielding lines, line score, play-by-play entries — `contest.ts`, `ui/Screens.ts`.
- `sim/stats.ts` — league totals over many contests (`simulateLeague`, `summarize`) — tests, later season simulation.
- `sim/tuning.ts` — every number that shapes league-wide results (contact, launch, fouls, AI reads, control, fatigue, runners, fielders, throws, errors, steals) — every sim file.
- `looks.ts` — `LIGHT_PRESETS` (day, golden hour, night: sky, sun, sky light, fog, exposure, environment strength, light-bank output, lamp glow), `TIER_BUDGETS` per quality tier (post effects, CSM cascades, grass blades, crowd size, light banks and their shadows, pixel ratio, adaptive resolution) and `PARK_THEMES` (mowing pattern, turf and dirt colours, fence style, stands, fog tint, signature) — `index.ts`, view.
- `view/Field.ts` — park from a `Park` and a `ParkTheme`: TSL turf, scuffable dirt (infield, mound, cut-outs, base paths, warning track), chalk outside the infield, bases, plate, mound, fence strip by spray angle (padded or plank texture), foul poles, the seating bowl (no outfield seats at Sandlot Classic) whose polylines feed the crowd, light towers whose lamp positions feed the light banks, scoreboard on posts unless the signature replaces it; `update`, `celebrate`, `strip()` and `plankTexture()` — `index.ts`.
- `view/Turf.ts` — `createTurfMaterial` (stripes, checkerboard or diamond mowing from world position, a view-dependent sheen, two-octave noise and bump, plain grass outside the park) and `createDirtMaterial` (noise colour and clods, speckle, bump, single-step parallax offset, the `DirtCanvas` paint); `DirtCanvas`: a 1024² canvas over the infield with the chalk lines and boxes, `scuff()` darkens patches and scrapes chalk, uploads at most every 0.35 s — `Field.ts`, `Director` via `Scenery`.
- `view/Grass.ts` — instanced tapered blades on turf near the plate (`zones.ts` keeps them off dirt and out of the stands) with a TSL gust sway and a root-to-tip colour ramp — `index.ts`.
- `view/Crowd.ts` — `createCrowd(bowl, count, home, away)`: one instanced mesh of low-poly fans in rows along the bowl, home-heavy shirt palette and skin tones packed with a seed and seat angle into two vec4 instance attributes (WebGPU allows 8 vertex buffers); vertex-stage sit, stand, bounce and the wave from `excitement` and `wavePhase` uniforms — `index.ts`, `Director` via `Scenery`.
- `view/Lights.ts` — `createStadiumLights`: applies a `LightPreset` to the engine sun and hemisphere, rebuilds the sky dome and bakes its environment (`bakeEnvironment`), stars at night, `CSMShadowNode` cascades on high and ultra, spot-light banks from the towers sharing a fixed total output, eased exposure — `index.ts`.
- `view/Signature.ts` — The Outhouse (port-a-potty scoreboard with a hinged door that opens, swirl particles on home runs and the final, drifting green fog sprites) and Sandlot Classic (instanced swaying cornfield beyond center, water tower, fireflies after sunset) — `Field.ts`.
- `view/zones.ts` — `isDirt`, `insidePark` in sim metres, matching the shapes `Field.ts` draws — `Grass.ts`.
- `view/Actors.ts` — capsule fielders, batter with a swinging bat, runners, umpire, a seamed ball (`spinBall` turns it at the pitch or batted rpm) with its shadow and the toggleable pitch trail, batting cursor, strike-zone frame, pitch ghost — `index.ts`, `Director`.
- `view/Sky.ts`, `view/space.ts` — gradient sky dome (recoloured per preset by `Lights.ts`); sim ↔ three.js coordinates — `Lights.ts`, view.
- `systems/Director.ts` — on-screen contest flow: pre-pitch, the human pitching meter (aim, effort, accuracy) or batting cursor and swing timing, the pitch in flight from `pitchPath` with ball spin and trail, AI turns, timeline play-back, half-inning banners, camera poses with their field of view and the follow camera, final box score; drives the `Scenery` (crowd excitement and the wave, park celebrations, scuffs where batters dig in, runners hit the bags and fielders run on the dirt) — `index.ts`.
- `modules-src/_shared/adaptive-resolution.d.ts` — types for `adaptive-resolution.js` so typed modules can import it — `bushleague/index.ts`.
- `systems/Playback.ts` — samples timeline tracks — `Director`.
- `ui/Screens.ts` — setup card, score bug, banner, matchup strip, play-by-play, pitch picker, meter, final line score and box score — `index.ts`, `Director`.
- `tests/rules.test.ts` — league, names, rosters, count rules, walks and forced runners, strikeouts, HBP, flight (altitude, gravity, wind), fair/foul and the foul pole, home runs, ground-rule doubles, infield fly, sacrifice flies, double plays, force-out run cancelling, 150-contest invariants (count limits, fouls, conservation of hits/runs, decisions, the home half), walk-offs, 3/6/9 innings with the extras runner, the mercy rule, no-DH and no re-entry, fatigue and the bullpen, steals, replay determinism — `scripts/bushleague-tests.mjs`.
- `tests/league.test.ts` — 10,000 AI-vs-AI nine-inning contests across worker threads; batting average .240–.260, 4.0–5.0 runs per nine, HR/FB 10–14 %, strikeout and walk rates in range — `scripts/bushleague-tests.mjs`.
- `public/images/modules/bushleague.webp` — hub thumbnail rendered from the module — `src/lib/modules.ts`.

### angler — Northwoods Angler (`modules-src/angler/`, PlayCanvas 2.23.3, not on `engine/`)

A PlayCanvas module (Fox Plains 2 is the other; Thrill Park 2 moved to Babylon.js): it bundles `playcanvas` from npm (pinned like three.js, never a CDN) and reuses nothing from `engine/`.
- `tools/build-models.mjs` (`fisherman.mjs`, `boat.mjs`, `meshbin.mjs`) — run by hand: turns the owner's Meshy exports in `assets-src/angler/` (`fisherman.fbx`, `bass-boat.glb`) into `public/modules/angler/`: `fisherman.bin` / `fisherman-lod.bin` (decimated scan, 19-bone auto rig and weights, per-vertex body part / along / around codes and cavity AO) and `bass-boat.bin` with `bass-boat-base.webp`, `bass-boat-paint.png` (hull / cowl / seat trim / carpet / plain classes plus hull livery coordinates; brand decals are painted out) and `bass-boat-rough.webp`. Outputs are committed; `pnpm assets` does not touch them.
- `shared/` — renderer-free rules also imported by the Worker and tests: `Lakes.ts` (five lakes, `heightAt`, `depthFeetAt`, `bottomAt`, spots, landing, water temperature), `Weather.ts`, `Astro.ts` (sun, moon, phase, Central time), `Clock.ts`, `Random.ts`, `Wardrobe.ts` (looks and palette), `Boats.ts` (boat specs, seats, fishing stations, paint), `Species.ts` (16 species: log-normal size curves, habitat, tiers), `Catch.ts` (conditions, species chances, bite activity and delay, `rollCatch`, credits), `Gear.ts` (rods, reels, presentations), `Profile.ts` (saved profile and stats), `Shop.ts` (catalog, `purchase`, `equip`), `Achievements.ts` (tiers, rewards, `evaluateAchievements`), `Online.ts` (shared-lake protocol, instance sizes, crew seats, six-character invite codes `<lake><instance><boat>`, `crowdAt`).
- `scene/` — `MeshBin.ts` (reader), `Character.ts` (skinned fisherman, two-bone IK, hats and sunglasses), `Outfit.ts` (look → fitted bind positions and vertex colours), `RigMath.ts`, `Boat.ts` (bass boat repaint, procedural jon boat and pontoon), `LakeScene.ts` (terrain, water, seasonal forest, reeds, pads, cabins, landing), `Sky.ts` (procedural cubemap sky + env atlas, sun/moon light, fog), `PostFx.ts` (medium/high quality: CameraFrame with ACES, soft bloom that grows after dark, grading, vibrance and a light vignette), `Geo.ts` (vertex-coloured mesh builder and instancing), `Textures.ts`.
- `systems/` — `BoatPhysics.ts` (planing hull, grounding), `CameraRig.ts`, `Input.ts`, `Audio.ts` (`LakeAudio`: Web Audio synthesis only — engine and hull rush by speed, lapping water, wind, loons after dusk, cast, plop, reel drag, splashes, catch chime; starts on the first gesture, silent while the tab is hidden, N toggles and the choice is a per-browser preference), `Poses.ts` (drive, sit, stand, fishing and holding-the-fish poses).
- `scene/FishModel.ts` (procedural species models with painted skins), `scene/Tackle.ts` (bending rod, line, bobber, ripples, `Splashes` droplet bursts), `scene/Wake.ts` (per-boat foam V at the Kelvin angle, prop wash and bow wave from a ring of stern samples; the player's boat in `World`, other boats in `Online`).
- `game/World.ts` (app, lake, boat, riders, frame loop, autopilot, background ticking while the tab is hidden), `game/Game.ts` (screens, HUD, catch cards), `game/Fishing.ts` (cast → wait → bite → fight → land/lose → show → release; Reel In — the HUD button or F — held while waiting powers up an aimed cast (7–31 yd) and tapped jigs the bait, sets the hook in a 1.3 s window, cranks the fish in against a tension meter with fish runs and a slipping drag, must be let go while a fish jumps (bowing to it), and is tapped to net the fish at the boat (a missed net lets it surge off once); untouched it still plays itself, and the authority alone decides what bites and whether it is landed), `game/Online.ts` (one WebSocket to `/api/angler-lake`: other boats interpolated from 4 Hz positions with dead reckoning, name tags, crowd count for the bite, crews — the player rides another boat through `World.board`/`disembark` and fishes whenever that captain anchors — catch news toasts, `tl-host` → `tl-room` invite codes and `?room=` joins, reconnect with backoff), `game/RemoteAngler.ts` (another angler on the LOD mesh at their seat or station with rod, line and held fish), `game/Authority.ts` (`ServerAuthority` posts to `/api/angler` with the instance as `room`; `LocalAuthority` runs the same rules for guests, nothing saved; `?preview=fast` speeds guest bites), `ui/LakeMap.ts`, `ui/Sonar.ts`, `ui/RecordBook.ts` (top 3 of every species with when each was caught), `ui/Celebrate.ts` (floating weight, confetti for trophies and personal bests, golden flash for legendary fish; skipped with reduced motion), `ui/CatchPhoto.ts` (catch card Photo button: `World.snapshot` plus a caption strip, saved as PNG), `ui/Almanac.ts` (Guide's Almanac tab, G: bite now and sun and moon times for everyone; the 24-hour outlook at the boat, every named spot ranked and species shares for the current rig once the shop's `almanac` item is owned — all from `shared/Catch.ts`), `ui/Panels.ts` (Wardrobe, Boat, Shop, Achievements, Almanac side panel with live previews; the scene renders beside it via `World.setViewportWidth`); tests `tests/*.test.ts` via `scripts/angler-tests.mjs`. `?clock=<ISO date>` previews another time of day (the server always uses real time); `?quality=low|medium|high`.

### sandlot3d — Sandlot Sluggers 3D
- `modules-src/sandlot3d/index.html` — page shell: screens, HUD markup, styles — `vite.modules.ts` (→ `public/modules/sandlot3d.html`).
- `modules-src/sandlot3d/index.ts` — entry: installs the legacy `window.THREE` and `window.__batchStatic`, then loads `main.js` as a classic script — `index.html`.
- `modules-src/sandlot3d/three-legacy.ts` — r128-compatible `THREE` over 0.186.1: color management off, linear output, legacy light-intensity scale — `index.ts`.
- `modules-src/sandlot3d/main.js` — whole module script: scene, `class Rig` athletes (`LimbTube`, `PLAYER_LOOK`, `UNIFORMS`), four ballparks, `window.__ss`; batting: `swing` maps timing and bat-aim error to contact quality (`q`, eased with a 0.65 power), launch angle (22° on a centred swing) and spray, and `newBall` carries balls with a speed-dependent factor (up to 0.6 for soft contact, 0.42 at the top end) so mid-speed liners reach the outfield; pitching: `PITCH_SPEED` (1.25) divides every pitch's travel time in `pitchBase`, the ball radius is `BALL_R` (0.189 ft, also the HUD ghost ball), and `isStrike` calls a strike when any part of the ball passes over the plate (zone half-width `ZW` = `PLATE_W`/2; the CPU's intended balls start clear of that); rules: extra innings start with the MLB automatic runner on second and never end tied, a non-home-run walk-off counts only the winning run, a batter thrown out stretching keeps the hit for the last base reached, and fielder's choice is scored only on force outs or infield plays; ballparks: Lakefront Dome (`domeProps`, the default; the choice is saved as `ss3dPark2`) recreates an open retractable-roof park with real fence distances (`PK.fence`, feet at -45/-22.5/0/22.5/45°, read by `fenceU`): three-deck navy bowl, left-field bleachers and slide tower with the home-run marquee, three right-field tiers, batter's eye, center-field video board (the `drawBoard` linescore) with side panels, ribbon boards and the arched name sign, glass curtain wall with steel columns, number plaques on the upper facade, fan roof panels on lattice arch trusses, the outfield rim truss and light banks; truss members are one `InstancedMesh` per finish; `catcherCam` returns the at-bat view and its own field of view (`f`, 31° landscape), which `camTick` eases to while batting or pitching — `index.ts` (`?url`).
- `public/modules/sprites/` (34 WebP files) — roster and batter-card art — `main.js` at runtime.

### maplestreet — Fox Plains (`modules-src/maplestreet/`)
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

### foxplains2 — Fox Plains 2 (`modules-src/foxplains2/`, PlayCanvas)
Same shared world and protocol as Fox Plains; everything that doesn't draw is imported from `modules-src/maplestreet/` (`shared/`, `src/net/`, `Input`, `Storage`, `Gait`, `RigData`, `MiniMap`, `WardrobeUI`). Details in `modules-src/foxplains2/README.md`.
- `modules-src/foxplains2/index.html` — page shell, HUD and wardrobe markup, styles — `vite.modules.ts` (→ `public/modules/foxplains2.html`).
- `index.ts` — entry; imports `src/main.ts`.
- `src/main.ts` — boot: username or guest name, published vehicles and items (Fox Plains' caches), shared world or `?solo=1` — `Game`.
- `src/core/Renderer.ts` — PlayCanvas WebGL2 device, `AppBase`, camera, `FoxSky` layer, `CameraFrame` (TAA, SSAO, bloom, grading), quality tiers, adaptive render scale — `Game`, `Sky`, `Remotes`.
- `src/core/Assets.ts` — glTF containers with meshopt and WebP hooks — `Houses`, `VehicleModels`, `AvatarKits`.
- `src/core/Geo.ts` — `MeshBuilder` (boxes, cylinders, blobs, ribbons, lathe, loft, tube, torus), `ChunkedBuilders`, `meshEntity` — every world builder, `VehicleModels`, `MowerModel`.
- `src/core/Tex.ts` — procedural PBR surfaces with normal and gloss (roughness) maps, the ground macro noise, facades, glass, night glow (`Mats`, `Mats.ground`) — `Town`, `Downtown`, `Houses`, `Game`.
- `src/core/GroundShader.ts` — diffuse/normal/gloss chunks for grass, lawns, asphalt and concrete: two-read anti-tiling blended by world-space macro noise, dry or worn patches, and view-dependent mowing stripes from the lawn atlas — `Tex`, `Town`.
- `src/world/Sky.ts` — clock, sky dome shader, sun/moon light and cascades, env atlas bake, fog, exposure — `Game`.
- `src/world/Town.ts` — ground, roads, markings, curves, sidewalks, driveways, lawn atlas (`Lawn`: cut freshness and blade lean per 1 m cell), instanced trees, lamps and light pool, for-sale signs — `Game`.
- `src/world/Downtown.ts` — downtown and grid buildings, storefronts, signs, civic, gas station, body shop, depot, town square, rings — `Game`.
- `src/world/Houses.ts` — lot meshing from `shared/BuildRules.ts`, furniture models, lot colliders — `Game`.
- `src/physics/Physics.ts`, `Character.ts`, `Vehicle.ts`, `Parking.ts` — Rapier world and the Fox Plains controllers ported line for line — `Game`, `Remotes`.
- `src/physics/VehicleModels.ts` — built-in and published vehicle views (sedan, coupe, truck and hdtruck draw with the realistic bundled scans as stand-ins, uploaded bodies untouched), paint, lamps, procedural tires and rims; fixes glTF materials (opaque parts `BLEND_NONE` with depth writes and back-face culling, glass as a tinted dielectric) and gives built-in cabs a solid painted roof — `Vehicle`, `Remotes`.
- `src/physics/MowerModel.ts` — the riding mower built from primitives (hood, deck and chute, seat, steering wheel, fenders, grass catcher with lid and handle, blower tube) — `VehicleModels`.
- `src/avatar/Avatar.ts` — scanned bodies, recolor shader chunk, procedural pose (`AvatarKits`, `Avatar`) — `Character`, `Remotes`.
- `src/net/Remotes.ts` — interpolated neighbors, traffic and their vehicles, name tags — `Game`.
- `src/game/Game.ts` — composition root and fixed step; `CameraRig.ts` — orbit/chase camera; `Hud.ts` — DOM HUD.

### county — Kestrel County (`modules-src/county/`, PlayCanvas, working title, not in `modules.ts` yet)
A separate 4 × 4 km world (airport and helicopters to come) in a glossy realistic-clipart style. Phase 1 streams the county with graded terrain, a generated road network and a town of houses, with Fox Plains 2's walking and driving imported unchanged; `?lookdev=1` keeps the Phase 0 look-development scene. It imports Fox Plains 2's `MeshBuilder`/`meshEntity`, physics (`Physics`, `Vehicle`, `VehicleModels`, `Character`), `Assets`, `AvatarKits` and `CameraRig`, and Fox Plains' `Input`, `store`, `Wardrobe`, `Economy` and vehicle registry (`CustomVehicles`, `Vehicles`) rather than copying them. Details in `modules-src/county/README.md`.
- `modules-src/county/index.html`, `index.ts` — page shell with the world HUD, developer panel styles and the look-dev panel — `vite.modules.ts` (→ `public/modules/county.html`).
- `config.ts` — palette, finishes, grading, light and fog, look-dev views and times — every file below.
- `shared/Noise.ts` — `rng`, `valueNoise`, `fbm` — `Base`, `Roads`, `Scatter`, `TerrainMesh`, models.
- `shared/Base.ts` — natural ground `baseHeight`/`smoothBase`, town bowl, airport plateau, backdrop past the map edge; `WORLD`, `TOWN`, `AIRPORT` — `Roads`, `Terrain`, `Chunks`, `Scatter`.
- `shared/Layout.ts` — the street plan (`LAYOUT`: named edges, classes, curves, lot runs) — `Roads`.
- `shared/Roads.ts` — `RoadNet`: centre lines, graded profiles (`MAX_GRADE`, flat junction zones), junction curb returns and trims, lots and driveway placement, crosswalk ramps and curb cuts, the cross-section (`crossHeight`, `walkEnd`, `rowHalf`), and right-of-way queries (`query`, `nearest`, `lotsNear`) — `Terrain`, `RoadMesh`, `Scatter`, `LotMesh`, `WorldMain`, tests.
- `shared/Terrain.ts` — `Terrain.heightAt` (ground graded under and around roads, lot pads, embankments) and `gridHeight` (the mesh's triangulation) — `County`, worker, tests.
- `shared/County.ts` — `county()`: the network and terrain built once — worker, `WorldMain`, tests.
- `tests/roads.test.ts` — determinism, connectivity, grades, junction seams, no overlaps (junctions, lots, right of way), curb-cut clearances, ground under sidewalks and meeting their outer edge — `scripts/county-tests.mjs` (`pnpm test`).
- `src/main.ts` — renderer, kit and sky, then `WorldMain` or `LookDevMain` (`?lookdev=1`) — `index.ts`.
- `src/WorldMain.ts` — boots physics, the vehicle registry, chunks and `Game`; spawn at home with the starter truck; day clock (`?hour=`), HUD, developer panel, `window.county` — `main`.
- `src/LookDevMain.ts` — Phase 0 scene controls, `?view=`/`?hour=`/`?rotor=1`/`?ui=0` — `main`.
- `src/core/Renderer.ts` — WebGL2 device, CameraFrame (Neutral tone mapping, TAA, SSAO, bloom, grading), quality tiers (`county/quality`), adaptive scale — `main`, `Sky`, `LookDev`.
- `src/core/Shapes.ts` — `bevelBox`, `prism`, `sweep`, `gridSurface`, `roundOutline`, `triangulate`, `contactShade`, `place` — every model.
- `src/core/Batch.ts` — one `MeshBuilder` per finish, `mark`/`contact`/`move`, `soup` (collider triangles), `meshes`, `build` → one entity — models, `Chunks`, `TreeKit`.
- `src/style/Kit.ts` — vertex-coloured finishes and night `glow` materials — `Batch`, `Chunks`, `LookDev`, `Helicopter`.
- `src/world/Sky.ts` — gradient dome, clouds, stars, sun/moon light with cascades, env atlas bake, haze, exposure — `main`.
- `src/world/Chunks.ts` — 256 m chunk streaming (far 8 m ground for all, mid roads/house massings/coarse trees, near 2 m ground/full houses/fine trees/lamps/mailboxes and colliders: Rapier heightfield, road trimesh, house boxes, trunks), budgeted build jobs, horizon backdrop — `WorldMain`, `Game`.
- `src/world/Heights.ts`, `heights.worker.ts` — height grids from a worker pool (main-thread fallback) — `Chunks`.
- `src/world/TerrainMesh.ts` — chunk ground mesh with colours and skirts, `groundColor`, `heightfieldData` — `Chunks`.
- `src/world/RoadMesh.ts` — carriageway, bevelled curb, verge or apron, jointed sidewalk and skirt from the cross-section; junction fans and curb-return layers; markings (centre and edge lines, crosswalks, stop bars) — `Chunks`.
- `src/world/LotMesh.ts` — full house with driveway and shrubs, distant massing, house collider boxes, seeded styles — `Chunks`.
- `src/world/Scatter.ts` — street, yard and country trees, lamps and mailboxes per chunk; `lotPoint` — `Chunks`, `WorldMain`.
- `src/world/TreeKit.ts` — instanced tree variants at two levels of detail — `Chunks`.
- `src/world/LookDev.ts` — the Phase 0 scene — `LookDevMain`.
- `src/game/Game.ts` — solo walking and driving on Fox Plains 2's classes: spawn after colliders exist, E in/out, R reset, teleport, rescue below ground, fixed step and chunk focus — `WorldMain`, `DevPanel`.
- `src/game/Vehicles.ts` — registers built-in, bundled, published and (with `?dev=1`, admin only) draft vehicles; `vehicleEntries` — `WorldMain`, `DevPanel`.
- `src/game/DevPanel.ts` — F8 panel: vehicle list with Spawn/Drive and specs, telemetry, teleports, time of day, stats, link to the vehicle editor — `WorldMain`.
- `src/game/OrbitCamera.ts` — orbit/pan/zoom with preset views, ground clamp — `LookDevMain`.
- `src/models/Parts.ts` (`sub`, `framedWindow`, `panelDoor`), `House.ts` (`buildHouse`, `buildDrive`), `Street.ts`, `Trees.ts` (`leafClump`, `broadleaf` with `lod`, `spruce`), `Airfield.ts`, `Helicopter.ts`, `Ground.ts` (look-dev ground) — `LookDev`, `LotMesh`, `TreeKit`, `Chunks`.
### fairway — Fairway Nine (`modules-src/fairway/`, built from `_template`)
- `modules-src/fairway/module.json` — id `fairway`, title, accent `#4fd27a`, modes — `config.ts`.
- `modules-src/fairway/tuning.ts` — pure tunables shared by systems and tests: air, ball, clubs, surface contact, lies, trees, cup, flight, terrain shape, wind, four-input meter, shot types (full/chip/flop/spinner launch and landing multipliers), short-game planner, camera, match rules, timing, hole data — `config.ts`, `systems/*`.
- `modules-src/fairway/config.ts` — `tuning` plus engine overrides (`net.maxPeers` 3), action bindings (power R/F, shot type 1–4/T), terrain/water/tree/grass/flag/ball/golfer/shot-preview/minimap/gauge/spin-dial/wind-dial looks, HUD and lobby copy, room format — `index.ts`, `view/*`, `session/*`, `ui/*`.
- `modules-src/fairway/data/holes.json` — the nine original holes: tee, pin, route, tee box, fairway, green, bunker, water and cart-path polygons in world metres, hills, green tilt, trees, OOB bounds, drop zones — `tuning.ts`.
- `modules-src/fairway/index.html` — page shell: `#stage`, start screen with mode picker and record-book tabs, lobby, scorecard, pause, meter and minimap canvases, turn banner, hole card, wind panel and shot dock styles; `--lib-*` tokens only — `vite.modules.ts` (→ `public/modules/fairway.html`).
- `modules-src/fairway/index.ts` — entry: App, quality, environment, lighting, post, `Input<Action>`, Hud, sky/balls/golfer/tracer/shot preview/grass, gauge and minimap, steps `Play` each fixed step, poses the golfer from `GolferRig` and moves meshes each frame, `__tlModule`, disposes on `pagehide` — `index.html`.
- `modules-src/fairway/models/Terrain.ts` — heightfield mesh with zone attributes and a TSL grass shader (two-octave noise, mow stripes) — `view/HoleScene.ts`.
- `modules-src/fairway/models/Water.ts` — pond plane with a TSL Gerstner `positionNode` and fresnel `colorNode` — `view/HoleScene.ts`.
- `modules-src/fairway/models/Trees.ts` — instanced oak, conifer and birch: bent branching trunks, noise-sculpted foliage clumps, alpha-cut leaf cards, TSL wind sway — `view/HoleScene.ts`.
- `modules-src/fairway/models/Grass.ts` — instanced tapered grass blades with a colour ramp and TSL sway — `view/GrassField.ts`.
- `modules-src/fairway/models/Flag.ts` — cup, flagstick and cloth with a sine flutter node and celebration boost — `view/HoleScene.ts`.
- `modules-src/fairway/models/TeeMarkers.ts`, `models/Ball.ts`, `models/Tracer.ts`, `models/Sky.ts` — tee posts, ball, shot tracer line, gradient sky dome — `view/HoleScene.ts`, `index.ts`.
- `modules-src/fairway/models/Golfer.ts` — one skinned golfer (lofted body, clothes and cap in vertex colours, smooth joint weights) on the `GolferRig` skeleton, plus a club with wood, iron and putter heads — `index.ts`.
- `modules-src/fairway/models/ShotPreview.ts` — faded ghost-ball trail and line along the perfect-strike flight and roll, landing-zone ellipse of discs, rest disc — `index.ts`.
- `modules-src/fairway/view/HoleScene.ts` — samples a `Course` into terrain, water, tree, flag and tee-marker specs and disposes them per hole — `index.ts`.
- `modules-src/fairway/view/GrassField.ts` — plants grass blades on a world-anchored grid around the ball by surface — `index.ts`.
- `modules-src/fairway/session/Play.ts` — session controller: match and round state, swing launch (path push, face curve, rhythm loss, shot type), solo/host authority, guest replay, records, camera stepping, the perfect-strike preview and the golfer view — `index.ts`.
- `modules-src/fairway/session/ShotPlan.ts` — local shot setup between swings: shot type, planned power toward the target, cached preview and landing zone — `Play.ts`.
- `modules-src/fairway/session/OnlineRoom.ts` — `PeerRoom<FairwayMessage>` glue: roster handshake, sender checks, late join, drops, `bridgeHub`, `autoJoinFromQuery` — `Play.ts`.
- `modules-src/fairway/session/Presenters.ts` — HUD, scorecard and record-book display models — `Play.ts`, `index.ts`.
- `modules-src/fairway/ui/Screens.ts`, `ui/HudView.ts`, `ui/Gauge.ts` — DOM screens and board tabs; the hole card, wind panel and bottom shot dock (club and bag, lie, shot types, spin, planned power, aim, help); the concentric four-input gauge (power ring with the planned marker, path and contact marks, rhythm ring) and its narrated readout — `index.ts`.
- `modules-src/fairway/ui/SpinDial.ts`, `ui/WindDial.ts`, `ui/Icons.ts` — spin ball with a direction arrow and a draggable vertical spin meter, wind compass, inline SVG club/shot/lie icons — `ui/HudView.ts`.
- `modules-src/fairway/ui/Minimap.ts` — hole map turned tee-to-pin up: surfaces, trees, pin, balls, perfect-strike path, landing-zone ellipse, rest spot, live flight — `index.ts`.
- `modules-src/fairway/systems/BallFlight.ts` — deterministic semi-implicit Euler flight (gravity, drag, Magnus lift, wind), bounce, roll, cup, water and OOB; push and shot type (launch angle, speed and spin, and landing: a chip releases, a flop lands soft, a spinner checks and can zip back); `simulateShot(params, seed)` — `Match`, `Play`, tests.
- `modules-src/fairway/systems/Course.ts` — hole heightfield, gradient, normals, surfaces, bounds, tee/forward tee, pin and drops — `BallFlight`, `Match`, `view/*`.
- `modules-src/fairway/systems/Surfaces.ts` — polygon tests, surface priority, lie power/spin factors, contact properties — `Course`, `BallFlight`.
- `modules-src/fairway/systems/Wind.ts` — seeded hole wind and its height profile — `BallFlight`, `Match`.
- `modules-src/fairway/systems/SwingMeter.ts` — four-input meter state machine: hold for power, tap for path (push/pull), click-and-hold for contact (face), release for rhythm (up to 7 % loss), then the strike — `Round`, `ui/Gauge.ts`.
- `modules-src/fairway/systems/ShotPlanner.ts` — perfect-strike preview, power-for-distance bisection, default shot type, landing-zone ellipse — `session/ShotPlan.ts`, tests.
- `modules-src/fairway/systems/GolferRig.ts` — golfer skeleton, per-club address setup, swing keyframes (address, back, top, down, follow, putting pendulum), swing-plane club and two-bone IK solver — `models/Golfer.ts`, `index.ts`, tests.
- `modules-src/fairway/systems/Camera.ts` — follow/preview/tracking/green camera state machine with the critically damped spring — `Play`.
- `modules-src/fairway/systems/Match.ts` — match authority: holes, strokes, penalties, farthest-first turns, shot seeds, placements — `Play`, tests.
- `modules-src/fairway/systems/Round.ts` — `RoundState` union and reducer/ticker for every mode — `Play`.
- `modules-src/fairway/systems/Protocol.ts` — Zod-validated `FairwayMessage` union (hello, roster, start, shot, state, turn, finish) — `OnlineRoom`.
- `modules-src/fairway/systems/Records.ts` — `/api/fairway` save/load client with an injected hub notifier — `Play`, `ui/Screens.ts`.
- `modules-src/fairway/systems/ClubAdvice.ts`, `systems/Random.ts`, `systems/Vector.ts` — club reach table and suggestion, seeded RNG and hashing, vector math — systems, `Play`.
- `modules-src/fairway/tests/fairway.test.ts` — flight (carry range, wind, spin, curve, bunker, rough, water, OOB, putting), four-input meter, shot types, planner, golfer rig, spring, match, protocol and round tests — `scripts/fairway-tests.mjs`.
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

### Single-file score modules
- `public/modules/module-base.css` — shared tokens, header/stat/panel/overlay/button styles (dark + light) — every page below.
- `public/modules/alphabet.html` — Alphabet Sprint: a–z run, wrong letters block until Backspace, `tlScores.submit('alphabet', ms)` (lower is better) — hub iframe.
- `public/modules/wpm.html` — Words Per Minute: 60 s random-word paragraph, net WPM — hub iframe.
- `public/modules/tetradrop.html` — Tetra Drop: falling-block line clears (7-bag, SRS kicks, hold, ghost), score — hub iframe.
- `public/modules/bubbles.html` — Bubble Shooter: hex grid, bank shots, drops, descending ceiling, score — hub iframe.
- `public/modules/memory.html` — Memory Match: 6 × 6 pairs, ms to clear — hub iframe.
- `public/modules/simon.html` — Echo Sequence: four tone pads, longest sequence — hub iframe.
- `public/modules/sudoku.html` — Sudoku: unique-solution generator, three levels, Hard no-hint solves are ranked (ms) — hub iframe.
- `public/modules/minesweeper.html` — Minesweeper: safe first click, chords, Intermediate clears ranked (ms) — hub iframe.
- `public/modules/mathrush.html` — Math Rush: 60 s scaling arithmetic with streak multipliers, score — hub iframe.
- `public/modules/blockhead.html` — Blockhead Siege: top-down wave survival, solo or two on one keyboard, score — hub iframe.

### songmaker — Song Maker
- `public/modules/songmaker.html` — lyrics editor, "Write lyrics" helper, sound options, Free (in-browser) / AI vocals engine choice, arrangement controls for the free engine, song list with lazy-loaded playback, MP3 download for AI songs and WAV download plus a speech-synthesis vocal guide for free songs (kept on the device, not saved) — hub iframe; calls `/api/songmaker`.
- `public/modules/songmaker-synth.js` — free engine, ES module imported on demand: `defaultArrangement` maps genre, mood, tempo and style words to an arrangement; `renderSong` renders the lyric sections with `OfflineAudioContext` (drums, bass, chords, melody, reverb, notes scheduled in 2 s chunks via `suspend`), returns the buffer and lyric cues; `encodeWav`.
- `src/server/keyless-lyrics.ts` — `write` fallback without a Gemini key: keyless Pollinations text API, then offline template lyrics.
- `src/server/routes/songmaker.ts` — `/api/songmaker`: GET list + daily quota, `?audio=<id>` (owner-checked KV `song/<userId>/<id>`), POST `create` (Lyria `lyria-3.5`, or `lyria-3-clip-preview` for 30 s clips, through the Gemini Interactions REST API), `write` (lyrics draft with the text model, falling back to `keyless-lyrics.ts`), `delete`; GET also returns `ai` (whether `GEMINI_API_KEY` is set). D1 `songmaker_songs` (migration 0019, also created on first use); 5 songs per user per 24 h, admin unlimited — `api.ts`.

### party — Skill Party
- `modules-src/party/index.html` — page shell and all styles — `vite.modules.ts` (→ `public/modules/party.html`).
- `modules-src/party/index.ts` — entry; provides `window.Peer`, imports `party.js` — `index.html`.
- `modules-src/party/party.js` — host-authoritative state machine (lobby → pick → intro → play → results → final), local hot-seat turns, CPU results, PeerJS rooms `tl-party-<code>`, `tl-host`/`tl-room` chat bridge, `?room=` auto-join — `index.ts`.
- `modules-src/party/contests.js` — the contest list (`CONTESTS`): Quick Draw, Crowd Count, Disc Toss, Type Dash plus `games-a.js` / `games-b.js` — `party.js`.
- `modules-src/party/games-a.js`, `games-b.js` — themed mini-games (`run({stage, rng, done, bag, who})`, `cpu(rng, skill)`, `fmt`) — `contests.js`.
- `modules-src/party/kit.js` — seeded `rngFrom`, lifecycle `makeBag`, canvas/keypad helpers, `avatarImage`, `blip` — contests.
- `modules-src/party/characters.js` — eight original characters and the SVG `avatar()` — `party.js`, contests.

### shorttrack — Short Track Showdown
- `modules-src/shorttrack/index.html` — page shell: menus, HUD markup, styles — `vite.modules.ts` (→ `public/modules/shorttrack.html`).
- `modules-src/shorttrack/index.ts` — entry; provides `window.Peer`, imports `main.js` — `index.html`.
- `modules-src/shorttrack/main.js` — whole module: three.js scene, trucks (`TM`), `buildStockCar`, liveries, `?track=`, lap posts, `tl-lap`, PeerJS `sts-oval-race-<code>` — `index.ts`.
- `modules-src/shorttrack/shorttrack-numbers.js` — race-number fonts and styles — `main.js`.
- `modules-src/shorttrack/iconic-schemes.js` — the AI field: iconic NASCAR look-alike schemes per car number (`ICONIC_FIELD`, `ICONIC`), knockoff logos (`LOGOS`, `logoCanvas`) and the side/hood painters (`drawSchemeSide`, `drawSchemeHood`) — `main.js`.
- `modules-src/shorttrack/prison-speedway.js` — Prison Speedway scenery (`buildPrisonSet`: guard towers, curtain wall, razor wire, searchlights, name board; `buildPrisonInfield`: the walled infield cell house with two three-storey cell blocks, four round towers, a barred front gate, barred windows with inmates (instanced) and a `setNight` hook that lights the cells) and the inmate crowd and stand colors — `main.js`.
- `public/modules/shorttrack-car.bin` — decimated super late model with atlas UV regions — fetched by `buildStockCar`.
- `modules-src/shorttrack/custom-cars.js` — admin-made bodies from `/api/shorttrack-cars`: `loadCustomCars` (adds `custom:<id>` entries to `VEHICLES`), `ensureCustomCar` (GLTFLoader + meshopt, bakes meshes into the stock car frame and merges per material), `buildCustomCar` (same shape as `buildStockCar`, stock-car wheels scaled to the spec, driver's primary color on the paint part, brake lights) and `mountCustomNumbers` — `main.js`.
- `modules-src/shorttrack/shared/CustomCars.ts` — custom car spec, record and limits, `STOCK_CAR` measurements, `carIdOf`, brand filter — `custom-cars.js`, `src/server/shorttrack-cars.ts`, the admin car editor.
- `modules-src/shorttrack/shared/carSurface.ts` — `placementMatrix`, `numberAnchors` (raycasts in from outside to find the door, roof and tail number surfaces) and `numberPlanes` — `custom-cars.js`, `CarStage.tsx`.

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
- `src/lib/park/neon.ts` — neon helpers: color slot weights (`SLOT`), chase bulbs, bulb rings and runs, neon tubes and frames, 5×7 bulb lettering — `models.ts`, `rideNeon.ts`, `renderer.ts`.
- `src/lib/park/rideNeon.ts` — `decorateRide`: moves each flat/water ride's parts onto color slots and adds its neon lights — `renderer.ts`.
- `src/lib/park/materials.ts` — material ids (including `neon`, emissive and chasing) and the roughness/metalness/clearcoat/wrap/detail table — `gl.ts`, `models.ts`, `renderer.ts`.
- `src/lib/park/quality.ts` — `low`/`medium`/`high` tiers (`?quality=`, software-renderer detection, probe × DPR) — `renderer.ts`, `ParkHud.tsx`.
- `src/lib/park/models.ts` — guests (`addPerson`), scenery (canopy AO, wind weights), stalls, flat-ride models including the Gravitron (diamond saucer behind a lit portal arch with chevron legs, marquee and bulb lettering) and oblong Zipper boom, coaster cars with a detailed near LOD, and the palette-to-material table (`autoMaterial`, `tag`) — `renderer.ts`, `hotelModels.ts`.
- `src/lib/park/renderer.ts` — terrain, shadow pass, coaster track near/far LODs (swept rails, ties, catwalks, flanged supports), elevated footpaths and stair ramps, boardwalks, queue lines railed on both sides with direction-following stripes and right-angle bends (`pathModels.ts`), smoothly banked custom kart tracks, karts waiting two abreast, customizable ride colors (color slots, park schemes and neon lights via `neon.ts`/`rideNeon.ts`), flat rides, overhead signs where entrance queues meet the footpath (`queueSignModel`), and clearance-aware supports, `captureOverview` (whole-park leaderboard screenshot) and `renderShot` (off-screen capture at any camera) — `ParkHud.tsx`.
- `src/lib/park/waterModels.ts` — Wave Pool model sized to its footprint (wave machine house, beach entry, moving swells set by the wave setting, loungers, lifeguard stand) — `renderer.ts`.
- `src/lib/park/waterRides.ts` — models for the 15 water park rides (slide towers, tubes, rafts, bowl, funnel, half-pipe, trapdoor, mat racer, loop, surf sheet, splash pad, lagoon, bucket fort, lily pads, cliff jump) and their default tints — `renderer.ts`.
- `src/components/park/ResortPanel.tsx` — Resorts tab cards, hotel portfolio table and the hotel window (nightly books, 30-night profit bars, ROI and payback, room rate with booking preview, service level, refurbish, resize, colors, roof, add-ons and amenities, demolish) — `ParkHud.tsx`.
- `src/lib/park/hotelModels.ts` — hotel meshes for the eight styles with floors, colors, roofs and add-ons (rooftop pool, sign, balconies, entrance canopy) — `renderer.ts`.
- `src/components/park/RideComments.tsx` — "What guests are saying" in the ride window: mood bar and the latest comments — `ParkHud.tsx`.
- `src/components/park/WaveControl.tsx` — wave setting picker in the ride window — `ParkHud.tsx`.
- `src/lib/park/culling.ts` — view-frustum tests: off-screen guests before instancing, and frustum planes/sphere tests for static instances and whole rides — `renderer.ts`.
- `src/lib/park/shotCams.ts` — fixed debug cameras (`?shotCam=station|flat|waterRide|wavePool|hotel|shoreline|overview`) for matched screenshots — `ParkHud.tsx`, `scripts/park-shots.mjs`.
- `scripts/park-scene.mjs`, `scripts/park-shots.mjs` — deterministic graphics test park and the screenshot / in-park perf / renderer audit harness (`docs/PARK-GRAPHICS-PLAN.md`; `--edition 2` for Thrill Park 2) — run by hand.
- `src/lib/park/backend.ts` — `RenderBackend`, everything `ParkRenderer` asks of the GPU; `gl.ts`'s `Gl` (Thrill Park) and `park2/babylonBackend.ts` (Thrill Park 2) implement it, and `ParkRenderer` takes a backend factory — `renderer.ts`, `ParkHud.tsx`.
- `src/lib/park/pathBuilder.ts` — coaster-style path builder planning; level boardwalk pieces are planned as the flat decks the server builds (`planBoardwalk`), and every planned piece is checked against the `path` command's side-neighbour step rule (`stepsTooHigh`) so refusals show on the ghost — `ParkHud.tsx`, `server/park/builders.test.mjs`.
- `src/lib/park2/index.ts` — `createBackend`, loaded with a dynamic import by `ParkGame` (`edition={2}`) so Babylon.js stays out of Thrill Park's bundle — `ParkGame.tsx`.
- `src/lib/park2/babylonBackend.ts` — Thrill Park 2's Babylon.js backend (`@babylonjs/core` 9.34.0, bundled and imported by path, never from the package root, which pulls in the whole library: the regular (non-`.pure`) modules keep their registrations, `Meshes/thinInstanceMesh` adds thin instances and `Engines/WebGPU/Extensions/engine.multiRender` gives SSAO its multiple render targets on WebGPU; built-in post-process shaders load on demand): `WebGPUEngine` when `navigator.gpu` has an adapter, otherwise the WebGL2 `Engine`, created asynchronously after the synchronous factory returns (uploads are kept on the CPU and draws are skipped until the engine is ready). The scene is right-handed and z-up, so park coordinates are used unchanged; the camera is a `FreeCamera` subclass handed the renderer's view matrix, with fov and clip planes read from its projection. The park renderer's draws are replayed into pooled `Mesh`es sharing one `Geometry` per uploaded mesh (classic 24-byte packed vertices as `position`, `pnormal`, `color`, `misc` kinds), each with its own `ShaderMaterial` whose uniform arrays (`uG` globals shared by all, `uD` per draw, material tables, lamps) are Float32Arrays mutated in place each frame. Instanced meshes are Babylon thin instances (`matrix` and `instanceColor` buffers built from the InstanceList layout). Soft shadows: the renderer's own light matrix is cascade 0 (`shadowsAvailable`, the shadow pass collects casters into depth-material meshes), and tiers add nearer cascades zoomed 3.2× and 10× around the point the camera looks at; each cascade is a `RenderTargetTexture` holding 24-bit packed depth in RGBA8 and the receiving shader does rotated-disk PCF (4/8/12 taps). Night lamp lights are a uniform list of the nearest lamp heads (10/20/32 per tier; warm and amber lamps alternate, with glossy highlights and a 14 m reach when `fx` ≥ 1). Post: `DefaultRenderingPipeline` (HDR, MSAA 2×/4×, bloom on neon, ACES, contrast/saturation/vignette) on medium and high, `SSAO2RenderingPipeline` on high (switched off for good if it throws), nothing on low, where the shader tonemaps itself. Render-scale adaptation shrinks the canvas backing store while frames run slow. Shaders are not shared between APIs: GLSL for WebGL2 and WGSL for WebGPU, in `babylonShaders.ts` (the WebGPU engine would fetch glslang/twgsl from a CDN for any GLSL shader, so none may be used there) — `index.ts`.
- `src/lib/park2/babylonShaders.ts` — the GLSL and WGSL sources for the main surface (classic lighting: GGX sun, hemisphere ambient, envColor reflections, detail layers, ground, water, neon, fog, cascaded shadow lookup, lamps), the cascade depth writer and the analytic sky, plus the `uG`/`uD` uniform layout documented at the top — `babylonBackend.ts`. WGSL has no derivatives in non-uniform control flow, so detail lookups use `textureSampleGrad` with gradients computed up front and bump uses finite differences. The richer look is one dynamic uniform, `uG[22].x` (`fx`: 0 plain, 1 rich, 2 full), taken from the quality tier (`TIERS[].fx`) and lowered by one while render-scale adaptation is below 0.75, so weak devices shed features without recompiling shaders. At `fx` ≥ 1: sunset horizon glow, night stars and drifting clouds in the sky (extra cloud octave at 2); distance haze with a sun-side glow (`TIERS[].haze`, thicker in rain); water and glass reflect the sky and sun through a Fresnel term (glass is recognised by its material values, F0 0.14); steep grass turns to rock and grass tufts vary in tone; foliage flutters on a second wind layer; lamps get highlights and neon a rim boost. At 2 water adds a third ripple octave. `models.ts` adds belts, collars and shoe soles to near-detail guests only, so far guests and the 6,400-guest load are unchanged.
- `src/lib/park2/scratch.ts` — throwaway WebGL2 context for the GPU probe, renderer name and the baked detail texture layers — `babylonBackend.ts`.
- `src/lib/park/session.ts` — local and online sessions — `ParkGame.tsx`, `ParkHud.tsx`.
- `src/lib/park/api.ts` — saves, tickets, scores and screenshot client — `ParkGame`, `ParkHud`, `ParkScoreboard`.
- `server/park/index.mjs` (+ `index.d.mts`) — shared simulation entry — park UI files, `renderer.ts`, `session.ts`, `server/park.mjs`.
- `server/park/state.mjs`, `terrain.mjs`, `catalog.mjs`, `track.mjs`, `autotrack.mjs`, `commands.mjs`, `guests.mjs`, `sim.mjs`, `snapshot.mjs`, `util.mjs`, `land.mjs`, `flatspec.mjs`, `thrill.mjs`, `comments.mjs`, `hotels.mjs`, `queues.mjs`, `park.test.mjs` — expanded maps and purchasable park land on the sides and behind the entrance, stable park IDs, saved elevated paths and stair navigation, walkable path types and colors, auto-facing shop placement, customizable coaster catalog with loops and corkscrews, two-train coasters with up to 10 cars each, kart fleets of four per station tile waiting two abreast (`kartCount`, `kartRestS`, `kartLane`, up to `KART_LIMIT`), coaster and custom-ride physics, mechanic dispatch through footpaths or queue lines, exit lines laid with queue-line tiles (`exitLine`, kept apart from entrance queues), queue lines that follow the order their tiles were laid (`map.pathOrder`, `queueLinks`, `queueStep`, `queueLayout` in `queues.mjs`), commands, guest/staff AI, $50 daily wages and $1-per-tile electricity, ten-day months, guest cap from rides, shops and owned land (`spawnRate`, `ownedTileCount`), area land purchases (`landAreaPlan`, `buyLandArea`), resizable flat rides priced by area (`flatSpec`, Wave Pool wave settings), compact ready-made coasters with declared footprints, raised Suspended Looper stations, thrill-seeking guests who warm up and follow friends onto intense rides, per-ride guest comments, hotels and resort districts, a persistent guest index, snapshots, regression tests, helpers — `server/park/index.mjs` and each other.
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
- Query params: `?room=<code>` (auto-join), `?name=<username>` (sandlot, chess, checkers, shorttrack, maplestreet, fairway; fairway falls back to a fixed `Guest-xxxxx` per browser), `?track=shorttrack|dells|dellswide|prison|dirt` (Short Track Showdown), `?world=`, `?solo=` (Fox Plains).
- PeerJS room codes: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (Fox Plains also allows `L`), shown upper-case; peer ids lower-case the code: `sandlot-`, `tl-chess-`, `tl-checkers-`, `tl-fairway-` (host plus up to three guests). Short Track Showdown: 5 letters A–Z without I/O, peer id `sts-oval-race-<CODE>`.
- Group-chat invites `meta.invite = {module, label, code}`.
- `/api/*`: `pool-account`, `workspace-access`, `workspace-admin`, `site-changes`, `account-settings`, `pool-practice`, `pool-preferences`, `pool-cue-overlay`, `racing`, `fairway`, `park`, `maplestreet`, `maplestreet-items`, `maplestreet-vehicles`, `meshy`, `group-chat`, `module-scores`, `studio`, `library`, `asset`, `learning`, `lyric-presets`.
- Railway service: socket.io default namespace (pool), `/racing`, `/park`; tickets from `/api/pool-account?action=ticket`, `/api/racing`, `/api/park`; client URL env `VITE_POOL_SERVER_URL`; pool header `X-Pool-Player`.
- Ticket redeem: `/api/pool-account?action=redeem`, `/api/racing?action=redeem`, `/api/park?action=redeem` (server-to-server).
- Server-shared files: `server/racing-engine.mjs`, `server/park/` (deterministic commands); changes redeploy Railway and bump `/version` in `server/index.mjs`.
- Fox Plains: `shared/RoomLogic.ts` is the only rules authority; Durable Object binding `MAPLE_WORLD`, D1 table `maplestreet_world`.

## Conventions

1. One three.js version for the whole site, pinned in `package.json` and served from the Vite build, never a CDN.
2. Every 3D model is its own file under `modules-src/<game>/models/` exporting a factory; no geometry built inline in a loop file; models never import game rules, game rules never import three.js.
3. Every tunable (colors, sizes, counts, physics constants, quality tier, key bindings) lives typed in `modules-src/<game>/config.ts` or `data/*.json`; no magic numbers in scene or system code.
4. Keep the contracts above intact.
5. Visible copy says "learning module" on a site named "the library" (lowercase); never game, gaming or entertainment in visible text or metadata.
6. Keep every name, vehicle, ride and asset original; no brand names, logos or copied designs.
7. After each change `pnpm build` passes, the module loads in the hub iframe with no console errors, and this file describes any new file in one line.
8. Delivery is a pull request from `revamp/<phase>-<step>` with `phase<N>-step<M>:` commits, gate results and before/after screenshots, squash auto-merge on a green `modules` check; never force-push `main`; owner-only settings get the `needs-owner` label.
