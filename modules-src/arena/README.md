# Vector Arena (`arena`)

A symmetrical military sci-fi arena in an outdoor valley, built from simple Babylon.js primitives: a first-person shooter that plays solo or online on the shared multiplayer service.

## Look

Bright daytime: a painted blue sky with cumulus clouds and a warm sun, blue-grey haze, rolling green hills and a hazy mountain ring around the arena. The arena is painted steel, concrete deck plating, ribbed light panels and olive cover crates (PBR with canvas-painted albedo and normal maps), with painted team markings and a few small blue and red lights instead of neon strips. Chest-high bulwarks (with an invisible barrier above) let you see out over the valley. The HUD is a segmented health bar, ammo count with round ticks, a ring reticle and a motion tracker. It takes broad cues from early-2000s military sci-fi shooters; no map, model, logo or name from any game is copied.

## Folders

- `index.html`, `index.ts`: the page `vite.modules.ts` builds into `public/modules/arena.html`; `index.ts` only starts the client. A loading overlay stays up until the scene is ready.
- `client/`: everything that runs in the browser.
  - `main.ts`: Babylon `Engine` (WebGL2), scene, gravity (`scene.gravity`), collisions (`scene.collisionsEnabled`), terrain, post-processing, render loop, online connection.
  - `scene/Environment.ts`: daytime cube sky painted on canvases (gradient, sun glow, fbm clouds), used as the skybox and as `scene.environmentTexture` for PBR reflections; hemispheric fill, warm directional sun with a 2048 high-quality PCF `ShadowGenerator`, exponential haze.
  - `scene/Materials.ts`, `scene/Textures.ts`, `scene/Noise.ts`: `PBRMaterial`s (deck floor, hull plates, panels, cover crates, trim, markings, team lights, soldier armour) with procedural albedo and normal maps that tile every 4 m.
  - `scene/Terrain.ts`: the valley around the arena (flat at the walls, hills, mountains; grass, dry patches, rock and snow by vertex colour). No collisions and not pickable.
  - `scene/PostProcess.ts`: `DefaultRenderingPipeline` with 4× MSAA, FXAA, bloom, ACES tone mapping, vignette and a light sharpen.
  - `scene/Arena.ts`: the map, mirrored across z = 0 (bases) and x = 0 (sides): floor with painted lines, chest-high bulwarks with buttresses and an invisible barrier, gate arches at z = ±30, two elevated bases with ramps, cover, bridges and a canopy, side catwalks with ramps, a raised centre platform with four ramps and an energy pylon, scattered cover blocks, pillars and crates. Every visible map mesh has `checkCollisions` and receives shadows; solid pieces cast them.
  - `player/FirstPerson.ts`: first-person walker. A hidden body with an ellipsoid moves through `moveWithCollisions` (Babylon's collision system) and falls with `scene.gravity`; ground snapping on ramps, coyote time and a jump buffer; `UniversalCamera` mouse look with pointer lock and a pitch clamp; recoil kicks that recover on their own. The ellipsoid (0.45 m) is wider than the camera's near plane (0.05 m), so the view never clips into walls.
  - `assets/ModelLoader.ts`: `loadModel` imports .glb/.gltf (Blender and Meshy exports, meshopt-compressed outputs of `pnpm assets`) with `SceneLoader.AppendAsync` and returns the new meshes and animation clips under one root; `fitModel` scales and turns it.
  - `weapons/`: `WeaponState.ts` (fire modes, magazine, reload), `ViewModel.ts` (rifles attached to the camera, drawn on their own layer so they never poke into walls; idle, firing, reload and switch motion, and the model's own `idle`/`fire`/`reload` clips if it has them), `Effects.ts` (muzzle flash, impact sparks, tracers), `WeaponSystem.ts` (input, centre-screen raycast with spread, recoil, network shots). Assault Rifle: automatic, 10 rounds a second, wider spread. Battle Rifle: 3-round bursts with a pause, one burst per click, tight spread. Stats in `server/arena/weapons.mjs`. Models: `assets-src/models/arena/weapons/assault-rifle.glb` and `battle-rifle.glb` (Meshy, records in the `.meshy.json` beside them) → `pnpm assets` → `public/models/arena/weapons/`.
  - `ui/Hud.ts`: health, ammo, reload, hit marker, damage flash, kill feed, respawn overlay. `ui/Tracker.ts`: 25 m motion tracker (allies always, enemies while sprinting or firing).
  - `net/Connection.ts` (socket.io-client), `net/RemotePlayers.ts` and `net/Soldier.ts`: sends the pose (position, yaw, pitch, action, weapon) 20 times a second and draws other players as team-coloured armoured soldiers on invisible capsule hitboxes.

## Multiplayer

Matches run on the same Railway service as pool, racing and Thrill Park (`/server`), as the `/arena` Socket.IO namespace: `server/arena.mjs` (`attachArena`), with the events, tick rate, health, spawns and rifle stats shared with this client in `server/arena/protocol.mjs` and `server/arena/weapons.mjs`. The server assigns teams, validates poses, broadcasts every player 20 times a second, rate-limits shots per weapon, checks hits (the hit point must lie on the shot's ray, in range, on the target), applies damage and headshots, and respawns eliminated players after 3 s.

The client connects to `VITE_POOL_SERVER_URL` (the production Railway URL when unset). `?server=<origin>` points it at another server and `?solo=1` keeps it offline. If the server can't be reached, or is an older version without the namespace, the page shows "Multiplayer offline · solo practice" and solo play continues. Tests: `server/arena/arena.test.mjs` (part of `pnpm test`).
