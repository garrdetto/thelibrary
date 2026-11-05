# Fox Plains 2 (source)

Source for `public/modules/foxplains2.html`, module id `foxplains2`: the Fox Plains neighborhood rebuilt on **Babylon.js** 9.34 (`@babylonjs/core` and `@babylonjs/loaders`, pinned in the root `package.json` and bundled into `public/modules/chunks/`; nothing loads from a CDN). It renders with **WebGPU** and falls back to WebGL2 when the browser has no WebGPU adapter (or with `?gpu=webgl`); physics is Rapier (WebAssembly). It runs next to Fox Plains (`modules-src/maplestreet/`), in the **same shared world**: same Durable Object (`/api/maplestreet`), same protocol, same accounts, lots, houses, money, garages and neighbors. People in either version see each other.

This first pass covers walking and driving with upgraded visuals. Build and Buy, shops, the bank, the dealer, the body shop and the town map stay in Fox Plains (classic) for now; the side panel links to it.

## Layout

- `babylon/` — the module (everything below).
- `src/` — the earlier PlayCanvas version with the same file names. It is not built into the page; it stays, unchanged, because Kestrel County (`modules-src/county/`) imports its `MeshBuilder`, physics, avatar, assets and camera classes. Don't edit it for Fox Plains 2.

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
| `babylon/main.ts` | boot: username or guest name, published vehicles and Buy items (same offline caches as Fox Plains), then the shared world (`?solo=1` for solo) |
| `babylon/core/Renderer.ts` | WebGPU engine (WebGL2 fallback), one right-handed scene so positions and quaternions from the rules and Rapier carry over unchanged, the camera, HDR post (`DefaultRenderingPipeline`: Khronos neutral tone mapping, bloom, MSAA or FXAA, sharpen, vignette; exposure lives in the post's own settings so it never dirties a material), `SSAO2RenderingPipeline`, quality tiers, adaptive render scale, shader warm-up, shadow caster registry |
| `babylon/core/Assets.ts` | Babylon's glTF loader with meshopt (the bundled `meshoptimizer` decoder, not Babylon's CDN one), WebP, mesh quantization, clearcoat and GPU instancing; one container per URL, clones share geometry, materials and textures |
| `babylon/core/Geo.ts` | `MeshBuilder` (boxes, ribbons, cylinders, blobs, lathe, loft, tube, torus, vertex colors, second UV), per-chunk merging into static meshes, and `ShadowProxies` |
| `babylon/core/Tex.ts` | procedural PBR surfaces with normal and roughness maps (asphalt, concrete, brick, siding, shingles, floors…), the ground macro noise, facades with randomly lit windows, glass, night glow, canvas textures |
| `babylon/core/GroundShader.ts` | `GroundPlugin`, a material plugin in WGSL and GLSL for grass, lawns, asphalt and concrete: each map read twice (own UV and a rotated, rescaled copy) and blended by world-space noise so no repeat shows, dry or worn patches, and lawn mowing stripes |
| `babylon/world/Sky.ts` | clock, sky dome shader (sun, moon, clouds, stars; WGSL and GLSL), sun/moon light with cascaded shadows, a half-float environment cube re-baked in place every quarter hour with its irradiance as spherical harmonics, fog, exposure |
| `babylon/world/Town.ts` | ground, roads with lane lines and crosswalks, curved streets, sidewalks with curb cuts, driveways, lawns (one atlas for every lot's mow state), thin-instanced trees with a far level of detail, street lamps sharing a pool of clustered point lights, for-sale signs |
| `babylon/world/Downtown.ts` | shops and grid buildings, storefronts and one atlas for every lit sign, civic block, gas station, Maple Body & Wheel, freight depot, Maple Commons, door and pump rings |
| `babylon/world/Houses.ts` | every lot's house from the build data (floors, walls with finishes, doors and windows, fences, roofs, pools), merged per 128 m cell; furniture (`public/models/maplestreet/furniture/` or published .glb) cloned in near you; colliders per lot |
| `babylon/physics/Physics.ts`, `Character.ts`, `Vehicle.ts`, `Parking.ts` | Rapier world, on-foot controller and raycast vehicle: the same numbers and logic as Fox Plains, so cars handle identically |
| `babylon/physics/VehicleModels.ts` | vehicle views: published and bundled bodies placed by their record and drawn as uploaded (8x anisotropic textures); the built-in sedan, coupe, pickup and heavy-duty truck draw with the realistic bundled scans scaled to the built-in's length and set on its axles, physics unchanged; other built-ins use `public/models/maplestreet/vehicles/` (wheel pivots found at the axles); paint, lamps, closed procedural tires and rims. glTF materials are fixed on load (opaque parts opaque with back-face culling; glass a tinted dielectric whose reflections don't fade with its alpha), and up-facing faces of a built-in greenhouse draw as a painted roof (a second submesh) |
| `babylon/physics/MowerModel.ts` | the riding mower from primitives in the chassis frame; the deck paint takes the owner's color |
| `babylon/avatar/Avatar.ts`, `AvatarShader.ts` | the scanned bodies as skinned clones, recolored by `AvatarPlugin` (WGSL and GLSL; rest positions in a `restPos` vertex stream), one material per look shared by everyone wearing it, procedural poses |
| `babylon/net/Remotes.ts` | other players, neighbor traffic and their vehicles, interpolated 120 ms behind, kinematic colliders, name tags |
| `babylon/game/Game.ts` | composition root: fixed 60 Hz step inside the render loop, the warm-up before play, networking, garage, interactions, mowing, deliveries, wardrobe |
| `babylon/game/CameraRig.ts`, `Hud.ts` | third-person camera with collision; DOM HUD |

## Controls

WASD walk or drive, Shift run, Space jump or handbrake, click to walk (click your car to get in), right-drag or arrows to turn the camera, wheel to zoom, E get in or out and use things, F fill up at a pump, T hitch the trailer, R flip a vehicle upright, H go home (every 15 minutes), J delivery job, C wardrobe, Q graphics quality.

## Quality

`?quality=low|medium|high` (or Q, or the status-bar button; remembered per browser). High: 4x MSAA, SSAO, bloom, sharpen, three 2048 px shadow cascades. Medium (the default on integrated GPUs and phones): FXAA, lighter SSAO, bloom, three 1536 px cascades. Low: FXAA, no SSAO or bloom, two 1024 px cascades, 80% render scale. Frames that stay slow lower the render scale a step at a time.

## No lag when you drive or turn

- **Shaders are compiled before play.** `Game.prewarm` builds one of every vehicle kind neighbors drive, both resident bodies and every furniture model in town out of sight, then `Renderer.ready` draws the whole scene with frustum culling (and shadow culling) off until every material and shadow shader is compiled. Turning the camera or meeting a neighbor reuses compiled shaders.
- **Few draws.** Static town pieces are merged per material into 256 m chunks with frozen world matrices; houses are merged per 128 m cell; trees are thin instances per species per 160 m cell with a 60-triangle far version beyond 190 m; all shop signs are one atlas.
- **Cheap shadows.** Static casters cast through merged depth-only proxies (one per cell, invisible to the camera), every cascade only draws casters inside its light-space rectangle, and caster bounds are frozen to the town.
- **Physics.** Static colliders are streamed on within 72 m of you, your vehicles and the camera (about 400 of 13,800), keeping a Rapier step near 1 ms.
- **Nothing per frame dirties materials.** Exposure follows the sky in the post's own settings; night glow, lamps and bloom change only when their value does.
- **Memory.** Per-vehicle paint and per-look avatar materials share their textures (`shallowClone`) and are freed with the vehicle or the last wearer; furniture models are dropped when you walk away; no CPU copies of textures or buffers are kept (`doNotHandleContextLost`, so a lost GPU device reloads the page). Neighbors coming and going leave the scene's mesh, material and texture counts flat.

## Mowing stripes

`Lawn.paint` (Town.ts) writes one atlas texel per 1 m cell from the shared lawn data (`shared/Mowing.ts`): R is how freshly cut (fading over the five-day regrowth), G/B the blade lean in world XZ. `GroundPlugin` compares that lean with the view direction: blades leaning away from the camera are lighter, toward it darker, so back-and-forth passes leave alternating stripes that swap shade as you walk around them and fade when you look across them. Cut grass also gets a flatter, lean-tilted normal and a little more sheen. Bilinear filtering keeps stripe edges soft; the atlas uploads at most ten times a second while someone mows.

## Debugging

`window.fp2.debug()` in the console (includes the backend, active meshes and render scale); `?hour=21` pins the sky to a time of day for lighting checks (the authority's clock is untouched); `?gpu=webgl` forces the WebGL2 backend. `pnpm gate --only foxplains2` loads it in the hub iframe.

## Next

Build and Buy mode, shops, bank, dealer and body shop windows, the town map, vehicle doors and dents, hair styles and hats on avatars.
