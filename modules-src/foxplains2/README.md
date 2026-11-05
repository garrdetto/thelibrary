# Fox Plains 2 (source)

Source for `public/modules/foxplains2.html`, module id `foxplains2`: the Fox Plains neighborhood rebuilt on the **PlayCanvas** engine (`playcanvas` 2.23.3, pinned in the root `package.json` and bundled into `public/modules/chunks/vendor-playcanvas-*.js`; nothing loads from a CDN). It runs next to Fox Plains (`modules-src/maplestreet/`), in the **same shared world**: same Durable Object (`/api/maplestreet`), same protocol, same accounts, lots, houses, money, garages and neighbors. People in either version see each other.

This first pass covers walking and driving with upgraded visuals. Build and Buy, shops, the bank, the dealer, the body shop and the town map stay in Fox Plains (classic) for now; the side panel links to it.

## What it reuses from Fox Plains

Everything that doesn't draw is imported from `../maplestreet/` rather than copied, so the rules can never drift apart:

- `shared/` — layout (`WorldLayout`, `DowntownGrid`), build rules, catalog, economy, protocol, vehicles and published-vehicle registry, wardrobe, mowing, body shop zones.
- `src/net/` — `WorldTransport` (shared world), `OfflineTransport` + `Host` (solo, and the fallback when the world can't be reached).
- `src/core/Input.ts`, `src/core/Storage.ts`, `src/avatar/Gait.ts`, `src/avatar/RigData.ts`.
- `src/game/MiniMap.ts` (minimap and delivery route) and `src/game/WardrobeUI.ts` (character creator and Maple Threads).

Identity keys are the same `localStorage` keys as Fox Plains (`maplestreet/identity`, `maplestreet/guest-key`, the Go Home cooldown), so one browser is one neighbor in both versions.

## Files

| File | What it does |
| --- | --- |
| `index.html` | page shell, HUD and wardrobe markup, styles |
| `src/main.ts` | boot: username or guest name, published vehicles and Buy items (same offline caches as Fox Plains), then the shared world (`?solo=1` for solo) |
| `src/core/Renderer.ts` | WebGL2 device, `AppBase`, camera, the `FoxSky` layer, `CameraFrame` post (TAA, SSAO, bloom, grading, vignette), quality tiers and adaptive render scale |
| `src/core/Assets.ts` | glTF containers with EXT_meshopt_compression (meshoptimizer's decoder via the parser's `bufferView.processAsync` hook) and EXT_texture_webp |
| `src/core/Geo.ts` | `MeshBuilder` (boxes, ribbons, cylinders, blobs, vertex colors, second UV) and per-128 m-chunk merging |
| `src/core/Tex.ts` | procedural PBR surfaces with normal maps (asphalt, concrete, brick, siding, shingles, floors…), facades with randomly lit windows, glass, night glow |
| `src/world/Sky.ts` | clock, sky dome shader (sun, moon, clouds, stars), sun/moon light with cascaded shadows, env atlas re-baked every quarter hour, fog, exposure |
| `src/world/Town.ts` | ground, roads with lane lines and crosswalks, curved streets, sidewalks with curb cuts, driveways, lawns (one atlas for every lot's mow state), instanced trees, street lamps with a pool of real lights, for-sale signs |
| `src/world/Downtown.ts` | shops and grid buildings, storefronts and lit signs, civic block, gas station, Maple Body & Wheel, freight depot, Maple Commons, door and pump rings |
| `src/world/Houses.ts` | every lot's house from the build data: floors, walls with finishes, doors and windows, fences, roofs, pools, furniture (`public/models/maplestreet/furniture/` or published .glb), colliders |
| `src/physics/Physics.ts`, `Character.ts`, `Vehicle.ts`, `Parking.ts` | Rapier world, on-foot controller and raycast vehicle: the same numbers and logic as Fox Plains, so cars handle identically |
| `src/physics/VehicleModels.ts` | vehicle views: built-in bodies from `public/models/maplestreet/vehicles/` (wheel pivots found at the axles), published bodies placed by their record, paint, lamps |
| `src/avatar/Avatar.ts` | the scanned bodies with a recolor shader chunk (rest positions in the vertex color stream, per-instance look parameters) and procedural poses |
| `src/net/Remotes.ts` | other players, neighbor traffic and their vehicles, interpolated 120 ms behind, kinematic colliders, name tags |
| `src/game/Game.ts` | composition root: fixed 60 Hz step inside PlayCanvas's update, networking, garage, interactions, mowing, deliveries, wardrobe |
| `src/game/CameraRig.ts`, `Hud.ts` | third-person camera with collision; DOM HUD |

## Controls

WASD walk or drive, Shift run, Space jump or handbrake, click to walk (click your car to get in), right-drag or arrows to turn the camera, wheel to zoom, E get in or out and use things, F fill up at a pump, T hitch the trailer, R flip a vehicle upright, H go home (every 15 minutes), J delivery job, C wardrobe, Q graphics quality.

## Quality

`?quality=low|medium|high` (or Q, or the status-bar button; remembered per browser). High: TAA with sharpening, SSAO, bloom, four 2048 px shadow cascades. Medium: 4x MSAA, lighter SSAO, three cascades. Low: no AA or SSAO, two 1024 px cascades, 80% render scale. Slow frames lower the render scale a step at a time.

## Debugging

`window.fp2.debug()` in the console; `?hour=21` pins the sky to a time of day for lighting checks (the authority's clock is untouched). `pnpm gate --only foxplains2` loads it in the hub iframe.

## Next

Build and Buy mode, shops, bank, dealer and body shop windows, the town map, vehicle doors and dents, hair styles and hats on avatars.
