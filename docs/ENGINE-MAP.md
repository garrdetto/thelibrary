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
- `src/components/AdminRecordReset.tsx` — admin-only reset of the selected board — boards and `index.tsx`.
- `src/components/PoolAccount.tsx`, `SignInRibbon.tsx` — sign-in form and ribbon — `index.tsx`, `PoolTable.tsx`, `Racing.tsx`.
- `src/components/GroupChat.tsx`, `SitePresence.tsx` — floating chat, invites (`meta.invite`), online presence — `index.tsx`, `Racing.tsx`.
- `src/components/AdminPanel.tsx`, `WorkspaceAdmin.tsx`, `SiteChanges.tsx` — admin tabs: people, site-change chat — `index.tsx`.
- `public/modules/module-scores.js` — `tlScores.submit(module, value)` → `/api/module-scores`, then `tl-score-saved` to the parent — 2048, Chopper Cave, BotWreck 3D pages.

### Tooling and delivery

- `package.json` — scripts `dev`, `build`, `assets` (no-op until Phase 2), `test` (no-op until Phase 8), `gate` — CI and developers.
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
- `src/server/routes/park.ts` — `/api/park` tickets, gzip saves (slots 0–6), net-worth boards — `api.ts`.
- `src/server/routes/maplestreet.ts` — `/api/maplestreet` WebSocket upgrade to the shared world — `api.ts`.
- `src/server/maplestreet-world.ts` — Durable Object running `shared/WorldServer.ts`, saves to D1 `maplestreet_world` — `server.ts`.
- `src/server/routes/scores.ts` — `/api/module-scores` GET `?module=`, POST `score` / `reset-records` — `api.ts`.
- `src/server/routes/chat.ts` — `/api/group-chat` messages, presence, reads, `?count` — `api.ts`.
- `src/server/routes/studio.ts` — `/api/studio`, `/api/library`, `/api/asset`, `/api/learning`, `/api/lyric-presets` — `api.ts`.
- `src/server/routes/site-changes.ts` — `/api/site-changes` jobs and workflow dispatch — `api.ts`.
- `migrations/0001…0009_*.sql` — D1 schema (users … site_changes) — `wrangler d1 migrations apply`.

## Shared engine

Empty until Phase 1 pins one three.js version in `package.json`, served from the Vite build. Every shared renderer, loader, input, loop and quality-tier file goes here.

## Models

Empty until models move into `modules-src/<game>/models/` (one factory per file, no game-rule imports).

## Games

Renderers in use at Phase 0 (Phase 1 unifies them):

| Module id | Renderer | Served from |
| --- | --- | --- |
| `sandlot3d` | three.js r128, global `THREE` | cdnjs |
| `botwreck` | three.js 0.160 ESM + cannon-es 0.20 | jsdelivr |
| `shorttrack` | three.js 0.160 ESM + addons (Sky, RoomEnvironment, bloom) | jsdelivr |
| `maplestreet` | three.js 0.172 WebGPU build (WebGL2 fallback), Rapier 0.14 | unpkg import map |
| `park` | hand-written WebGL2 | Vite bundle |
| `racing`, `oval`, `pool` | 2D canvas | Vite bundle |
| `sandlot`, `chess`, `checkers`, `2048`, `helicopter` | 2D canvas / DOM | inline in the page |

Known baseline issues: `maplestreet` throws `Buffer is not defined` in the hub iframe; `shorttrack` is too busy under software WebGL for Playwright screenshots (gate note, not failure).

### sandlot3d — Sandlot Sluggers 3D
- `public/modules/sandlot3d.html` — whole module: inline three.js r128 scene, `class Rig` athletes (`LimbTube`, `PLAYER_LOOK`, `UNIFORMS`), four ballparks, `window.__ss` — hub iframe.
- `public/modules/sprites/` (34 files), `public/modules/faces.png` — roster and batter-card art — `sandlot3d.html`.

### maplestreet — Maple Street (generated from `modules-src/maplestreet/`)
- `public/modules/maplestreet.html` — generated bundle; never edit by hand — hub iframe.
- `modules-src/maplestreet/build.mjs` — bundles `src/main.ts` into the page with `index.html` as shell — run by hand (`bun …/build.mjs`).
- `modules-src/maplestreet/index.html` — page shell and unpkg import map — `build.mjs`.
- `modules-src/maplestreet/README.md` — module notes — developers.
- `src/main.ts` — boot, transport choice (shared world, offline, PeerJS, tabs, Colyseus) — `build.mjs` entry.
- `src/core/Engine.ts` — renderer, scene, camera, resize (WebGPU/WebGL2) — `Game`, `BuildController`, `DayNight`, `Neighborhood`, `RemoteEntities`.
- `src/core/Loop.ts` — fixed-step update/render loop — `Game`.
- `src/core/Input.ts` — keyboard, mouse, touch — `Game`, `CameraRig`, `BuildController`.
- `src/core/Materials.ts` — shared PBR materials, procedural textures — `Game`, `Mesher`, `Neighborhood`, `Downtown`.
- `src/core/Merge.ts` — geometry merge helpers — `Downtown`, `RemoteEntities`, `Vehicle`, `VehiclePresets`.
- `src/core/Storage.ts` — per-device settings — `main`, `Game`, `BuildController`, `Host`, `LocalTransport`, `WorldTransport`.
- `src/game/Game.ts` — client: player, vehicles, lots, needs, HUD wiring, command dispatch — `main`.
- `src/game/CameraRig.ts` — third-person and build cameras — `Game`.
- `src/game/Hud.ts` — HUD, menus, notifications — `Game`.
- `src/game/PlotMap.ts` — town map overlay — `Hud`.
- `src/build/BuildController.ts` — build/buy tools, batched `builds` gestures — `Game`, `Hud`.
- `src/build/Mesher.ts` — walls, floors, roofs, pools to meshes — `Game`, `BuildController`, `HouseManager`.
- `src/build/HouseManager.ts` — per-lot house meshes — `Game`, `BuildController`.
- `src/build/Furniture.ts` — furniture and fixture models — `Game`, `BuildController`, `Mesher`, `Thumbs`.
- `src/build/Thumbs.ts` — off-screen catalog thumbnails — `Game`.
- `src/world/Neighborhood.ts` — roads, lots, trees, street furniture — `Game`.
- `src/world/Downtown.ts` — shops and gas station — `Neighborhood`.
- `src/world/Lawn.ts` — mowable lawns and stripes — `Neighborhood`, `Grass`.
- `src/world/Grass.ts` — instanced grass — `Game`.
- `src/world/DayNight.ts` — sun, sky, night lighting — `Game`.
- `src/physics/Physics.ts` — Rapier world and colliders — `Game`, `CameraRig`, `Character`, `Vehicle`, world and build files.
- `src/physics/Character.ts` — kinematic character controller — `Game`, `RemoteEntities`.
- `src/physics/Vehicle.ts` — raycast vehicle — `Game`.
- `src/physics/VehiclePresets.ts` — original pickup, coupe, mower bodies and tuning — `Vehicle`, `Downtown`, `RemoteEntities`.
- `src/net/Transport.ts` — transport interface — every transport, `Game`.
- `src/net/WorldTransport.ts` — shared world over `/api/maplestreet` — `Game`.
- `src/net/OfflineTransport.ts` — solo play and fallback — `Game`, `main`.
- `src/net/LocalTransport.ts` — same-device tabs — `Game`.
- `src/net/PeerTransport.ts` — PeerJS rooms `tl-maplestreet-<code>` — `Game`, `main`.
- `src/net/ColyseusTransport.ts` — optional Colyseus room — `Game`.
- `src/net/Host.ts` — in-browser authority for offline, tabs and PeerJS hosts — `OfflineTransport`, `LocalTransport`, `PeerTransport`.
- `src/net/RemoteEntities.ts` — remote player and vehicle interpolation — `Game`.
- `shared/RoomLogic.ts` — single rules authority (ownership, builds, money, loans, mowing, deliveries, shops, fuel, needs) — `Game`, `Host`, `WorldServer`, `NeighborhoodRoom`, `maplestreet-world.ts`.
- `shared/WorldServer.ts` — persistent world loop — `maplestreet-world.ts`.
- `shared/WorldLayout.ts` — town layout: lots, roads, shops, gas station — `RoomLogic`, `Game`, world files, `PlotMap`.
- `shared/Seed.ts` — starter houses — `RoomLogic`.
- `shared/Npc.ts` — simulated neighbors — `Host`, `WorldServer`.
- `shared/Catalog.ts` — build/buy catalog — `RoomLogic`, `BuildRules`, `Furniture`, `Mesher`, `Thumbs`, `Hud`.
- `shared/BuildRules.ts` — build validation — `RoomLogic`, build files, `Hud`, `PlotMap`.
- `shared/Economy.ts` — prices, loan cap, pay — `RoomLogic`, `WorldServer`, `Game`, `Hud`.
- `shared/Mowing.ts` — mowing pay — `RoomLogic`, `Game`, `Lawn`.
- `shared/Protocol.ts` — message protocol types — every transport, `RoomLogic`, `WorldServer`.
- `colyseus-server/index.ts`, `NeighborhoodRoom.ts` — optional Node room on the shared logic — run separately.

### sandlot — Sandlot Sluggers
- `public/modules/sandlot.html` — whole 2D module, PeerJS rooms `sandlot-<code>` — hub iframe.

### botwreck — BotWreck 3D
- `public/modules/botwreck.html` — whole module: three.js 0.160 + cannon-es crash lab, `tlScores.submit` — hub iframe.

### chess — Chess
- `public/modules/chess.html` — board, CPU worker, PeerJS rooms `tl-chess-<code>` — hub iframe.

### checkers — Checkers
- `public/modules/checkers.html` — board, CPU, PeerJS rooms `tl-checkers-<code>` — hub iframe.

### 2048 — 2048
- `public/modules/2048.html` — whole module, `tlScores.submit` — hub iframe.

### helicopter — Chopper Cave
- `public/modules/helicopter.html` — whole module, `tlScores.submit` — hub iframe.

### shorttrack — Short Track Showdown
- `public/modules/shorttrack.html` — whole module: three.js 0.160 scene, trucks (`TM`), `buildStockCar`, liveries, `?track=`, lap posts, `tl-lap`, PeerJS `sts-oval-race-<code>` — hub iframe.
- `public/modules/shorttrack-car.bin` — decimated super late model with atlas UV regions — `buildStockCar`.
- `public/modules/shorttrack-numbers.js` — race-number fonts and styles — `shorttrack.html`.

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
- `src/components/park/ParkHud.tsx` — in-game interface and canvas — `ParkGame.tsx`.
- `src/components/park/ParkScoreboard.tsx` — net-worth board — `ParkGame.tsx`.
- `src/lib/park/gl.ts` — WebGL2 helpers: mesh builder, shadow map, lighting, ground and water — `models.ts`, `renderer.ts`.
- `src/lib/park/models.ts` — guests (`addPerson`), scenery — `renderer.ts`.
- `src/lib/park/renderer.ts` — terrain, shadow pass, `drawWorld` — `ParkHud.tsx`.
- `src/lib/park/session.ts` — local and online sessions — `ParkGame.tsx`, `ParkHud.tsx`.
- `src/lib/park/api.ts` — saves, tickets, scores client — `ParkGame`, `ParkHud`, `ParkScoreboard`.
- `server/park/index.mjs` (+ `index.d.mts`) — shared simulation entry — park UI files, `renderer.ts`, `session.ts`, `server/park.mjs`.
- `server/park/state.mjs`, `terrain.mjs`, `catalog.mjs`, `track.mjs`, `autotrack.mjs`, `commands.mjs`, `guests.mjs`, `sim.mjs`, `snapshot.mjs`, `util.mjs` — state, land, catalog, coaster physics, commands, guest/staff AI, step, snapshots, helpers — `server/park/index.mjs` and each other.
- `server/park.mjs` — online park rooms — `server/index.mjs`.

## Contracts

Every phase keeps these exactly (sources: `AGENTS.md`, `docs/AUDIT.md` §1, verified against the module sources).

- Module ids and `src` paths: `embeddedModules` and `learningModules` in `src/lib/modules.ts`; hub routes `#module-<id>`, `#racing`, `#oval`, `#park` (pool opens from its hub card); iframe selector `.play-frame iframe`; the hub appends `?name=<username>&room=<code>` to every embedded `src`.
- `tlScores.submit(module, value)` from `public/modules/module-scores.js`.
- `postMessage` child → parent `{type:'tl-score-saved', module, saved}` — refreshes `ModuleScoreboard`.
- `postMessage` child → parent `{type:'tl-lap', track, mode}` — refreshes `LapRecordBoard`.
- `postMessage` parent → child `{type:'tl-host'}`; child answers `{type:'tl-room', code}` — sandlot, chess, checkers, shorttrack, maplestreet.
- Query params: `?room=<code>` (auto-join), `?name=<username>` (sandlot, chess, checkers, shorttrack, maplestreet), `?track=shorttrack|dells|dellswide|dirt` (Short Track Showdown), `?world=`, `?host=`, `?server=` (Colyseus URL), `?solo=` (Maple Street).
- PeerJS room codes: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (Maple Street also allows `L`), shown upper-case; peer ids lower-case the code: `sandlot-`, `tl-chess-`, `tl-checkers-`, `tl-maplestreet-`. Short Track Showdown: 5 letters A–Z without I/O, peer id `sts-oval-race-<CODE>`.
- Group-chat invites `meta.invite = {module, label, code}`.
- `/api/*`: `pool-account`, `workspace-access`, `workspace-admin`, `site-changes`, `account-settings`, `pool-practice`, `pool-preferences`, `pool-cue-overlay`, `racing`, `park`, `maplestreet`, `group-chat`, `module-scores`, `studio`, `library`, `asset`, `learning`, `lyric-presets`.
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
