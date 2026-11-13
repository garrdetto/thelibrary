# Vector Arena (`arena`)

A symmetrical sci-fi arena built from simple Babylon.js primitives, the starting point for a multiplayer first-person module.

## Folders

- `index.html`, `index.ts`: the page `vite.modules.ts` builds into `public/modules/arena.html`; `index.ts` only starts the client.
- `client/`: everything that runs in the browser.
  - `main.ts`: Babylon `Engine` (WebGL2), scene, gravity (`scene.gravity`), collisions (`scene.collisionsEnabled`), render loop, optional online connection.
  - `scene/Environment.ts`: procedural cube skybox (painted on canvases, star field), hemispheric fill, directional sun with a 2048 PCF `ShadowGenerator`, `GlowLayer` for the energy accents, fog.
  - `scene/Materials.ts`: hull, panel, cover, trim and emissive energy materials (blue team, red team, white neutral).
  - `scene/Arena.ts`: the map, mirrored across z = 0 (bases) and x = 0 (sides): floor and perimeter walls with glowing trim, two elevated bases with ramps, cover and bridges, side catwalks with ramps, a raised centre platform with four ramps and an energy pylon, scattered cover blocks, pillars and crates, overhead beams. Every map mesh has `checkCollisions` and receives shadows; solid pieces cast them.
  - `player/FirstPerson.ts`: first-person walker. A hidden body with an ellipsoid moves through `moveWithCollisions` (Babylon's collision system) and falls with `scene.gravity`; ground snapping on ramps, coyote time and a jump buffer; `UniversalCamera` mouse look with pointer lock and a pitch clamp; recoil kicks that recover on their own. The ellipsoid (0.45 m) is wider than the camera's near plane (0.05 m), so the view never clips into walls.
  - `assets/ModelLoader.ts`: `loadModel` imports .glb/.gltf (Blender and Meshy exports, meshopt-compressed outputs of `pnpm assets`) with `SceneLoader.AppendAsync` and returns the new meshes and animation clips under one root; `fitModel` scales and turns it.
  - `weapons/`: `WeaponState.ts` (fire modes, magazine, reload), `ViewModel.ts` (rifles attached to the camera, drawn on their own layer so they never poke into walls; idle, firing, reload and switch motion, and the model's own `idle`/`fire`/`reload` clips if it has them), `Effects.ts` (muzzle flash, impact sparks, tracers), `WeaponSystem.ts` (input, centre-screen raycast with spread, recoil, network shots). Assault Rifle: automatic, 10 rounds a second, wider spread. Battle Rifle: 3-round bursts with a pause, one burst per click, tight spread. Stats in `shared/weapons.mjs`. Models: `assets-src/models/arena/weapons/assault-rifle.glb` and `battle-rifle.glb` (Meshy, records in the `.meshy.json` beside them) → `pnpm assets` → `public/models/arena/weapons/`.
  - `ui/Hud.ts`: health, ammo, reload, hit marker, damage flash, kill feed, respawn overlay.
  - `net/Connection.ts` (socket.io-client) and `net/RemotePlayers.ts`: only used when the page is opened with `?server=<origin>`; sends the pose (position, yaw, pitch, action, weapon) 20 times a second and draws other players as team-coloured capsules (also their hitboxes).
- `shared/protocol.mjs` and `shared/weapons.mjs` (+ `.d.mts`): events, tick rate, health, spawns and weapon stats used by both sides.
- `server/arena.mjs`: `attachArena(io, origins, options)` adds the `/arena` Socket.IO namespace: unique ids, team assignment, pose validation, a 20 Hz tick that broadcasts every player's position, rotation, action, weapon and health, shot relay with per-weapon rate limits, hit checks (the hit point must lie on the shot's ray, in range, on the target), damage and headshots, deaths, kills and respawns after 3 s.
- `server/index.mjs`: a standalone Express + Socket.IO server around it (`pnpm arena:server`; `PORT`, default 3010, and `FRONTEND_ORIGIN`, a comma list of allowed site origins). Open the module with `?server=https://<that host>` to play online. It is not part of the Railway service in `/server`.
- `tests/server.test.mjs`: hit rules and a two-player run through the real server (part of `pnpm test`).
