# Vector Arena (`arena`)

A symmetrical sci-fi arena built from simple Babylon.js primitives, the starting point for a multiplayer first-person module.

## Folders

- `index.html`, `index.ts`: the page `vite.modules.ts` builds into `public/modules/arena.html`; `index.ts` only starts the client.
- `client/`: everything that runs in the browser.
  - `main.ts`: Babylon `Engine` (WebGL2), scene, gravity (`scene.gravity`), collisions (`scene.collisionsEnabled`), render loop, optional online connection.
  - `scene/Environment.ts`: procedural cube skybox (painted on canvases, star field), hemispheric fill, directional sun with a 2048 PCF `ShadowGenerator`, `GlowLayer` for the energy accents, fog.
  - `scene/Materials.ts`: hull, panel, cover, trim and emissive energy materials (blue team, red team, white neutral).
  - `scene/Arena.ts`: the map, mirrored across z = 0 (bases) and x = 0 (sides): floor and perimeter walls with glowing trim, two elevated bases with ramps, cover and bridges, side catwalks with ramps, a raised centre platform with four ramps and an energy pylon, scattered cover blocks, pillars and crates, overhead beams. Every map mesh has `checkCollisions` and receives shadows; solid pieces cast them.
  - `player/FirstPerson.ts`: first-person walker. A hidden body with an ellipsoid moves through `moveWithCollisions` (Babylon's collision system) and falls with `scene.gravity`; `UniversalCamera` mouse look with pointer lock; WASD/arrows, Shift sprint, Space jump.
  - `net/Connection.ts` (socket.io-client) and `net/RemotePlayers.ts`: only used when the page is opened with `?server=<origin>`; sends the pose 10 times a second and draws other players as team-coloured capsules.
- `shared/protocol.mjs` (+ `.d.mts`): namespace, event names and limits used by both sides.
- `server/arena.mjs`: `attachArena(io, origins)` adds the `/arena` Socket.IO namespace (team assignment, pose validation, 10 Hz state broadcast). It is not wired into the Railway service in `server/` yet; to go live, call it from `server/index.mjs`, bump `/version` and redeploy.
