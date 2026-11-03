# Fox Plains (source)

Source for `public/modules/maplestreet.html`, a 3D neighborhood simulation. You pick a plot on the town map, build and furnish a house with Sims-style Build and Buy tools, and drive around town. There are lawns to mow, deliveries to haul, shops and a gas station downtown, and a bank with a capped loan. Everyone shares one persistent world, so you can come and go as you please.

three.js 0.186.1 (WebGPU with automatic WebGL2 fallback), Rapier 0.14 (`@dimforge/rapier3d-compat`, with `await RAPIER.init()` before the loop starts) are npm packages pinned in the root `package.json` and bundled by Vite; nothing loads from a CDN.

## Build

`pnpm build` (or `pnpm dev`) at the repository root builds this module with every other learning module: `index.html` and `index.ts` here are the Vite entry, and the result is `public/modules/maplestreet.html` plus shared chunks in `public/modules/chunks/` (see `vite.modules.ts` and `docs/ENGINE-MAP.md`).

Edit the TypeScript and `index.html`, not the generated page. This folder is excluded from the site `tsconfig.json`, so its bare imports (`three/webgpu`, Rapier) don't affect the site's type check.

## Controls

| Live mode | |
| --- | --- |
| WASD | Walk, or drive. S brakes and then reverses, and Space is the handbrake. |
| Click | Walk to the spot. Clicking a vehicle, shop door or usable item at home walks you there and uses it. |
| Right-click | On a vehicle: your own shows **Drive** (walks to the driver's door and gets in) and **Open/Close doors**; anyone else's just says whose it is. Right-drag still orbits. |
| Shift | Run. |
| H | **Go home**: back to your driveway, once every 15 real minutes (also the HUD button and the town map). Your vehicles stay where you parked them. |
| Arrow keys | Orbit (← →: the camera swings left or right around you) and tilt (↑ ↓) the camera. Right-drag also orbits. |
| E / F / T / R | E gets in or out, shops or uses an item. F fills up at a pump, or calls a tow when the tank is empty. T hitches the trailer, and R flips a vehicle upright. |
| M / B / J | M opens the town map, B opens Build and Buy mode, and J takes a delivery job. The minimap in the bottom-right corner turns with your view and draws the street route to your current delivery stop. |

**Build mode** follows The Sims 4:

- **Build tab:** rooms; full and half walls; picket, privacy and railing fences; 10 floors; wall finishes (paint one side, or Shift-click to paint the whole room); doors (panel door, glass entry door with transom, French doors, sliding patio door, sectional garage door) and windows (double-hung, tall with shutters, picture, clerestory strip, small frosted); sliding doors, garage doors and clerestories placed side by side join into one wide unit; gable, hip and flat roofs plus Auto-roof; pools; stairs; buying a lot.
- **Buy tab:** about 60 items. Browse by room or by function. Thumbnails are rendered from the real models, and swatches recolor items.
- **Placing items:** `,` rotates counter-clockwise and `.` clockwise. Wall décor snaps to the nearest wall.
- **Tools:**
  - Move (H), Eyedropper (E), Design tool (R) and Sledgehammer (K)
  - Undo/redo with Ctrl+Z / Ctrl+Y
  - Levels with PageUp/PageDown
  - Walls up, cutaway or down with Home
- **Money:** everything refunds 100%.

## Arriving

Fox Plains is one open world, so there is no name prompt or mode picker: the page goes straight into the shared world while a short "Walking over to Fox Plains…" card shows. Signed in to the library you play under your username, otherwise under a guest name made once for this browser (`Guest-xxxxx`, also used by the server). If the world can't be reached it falls back to solo, and if the renderer can't start the card offers **Try again**. `?solo=1` still opens the private neighborhood with unlimited money (tests and the developer instance use it).

## Characters and wardrobe

- New neighbors make their character once, in the wardrobe panel that opens on arrival: male or female (final), hair, face and a starter outfit. The two scanned models (`public/modules/maplestreet/{male,female}.glb`) are rebuilt from the raw scans by `tools/build-characters.mjs` (simplified mesh, auto-rigged skeleton, clothing-region mask `*-mask.png`); run it with `@gltf-transform/*`, `meshoptimizer` and `sharp` installed.
- `src/avatar/`: `AvatarAssets` (loading, hair pressed flat for buzz/long/hats), `AvatarMaterial` (TSL recolor shader: skin, hair, eyes, jacket, tee, pants, shoes, patterns), `HairAndHats` (long hair, buns, beanie/cap/bucket hat), `AvatarModel` (pose: walk, run, idle, seated) and `Gait` (walk and run cycles shared by both bodies: cadence comes from speed and stride length so the planted foot keeps pace with the ground, the knee is straight at heel strike and tucks through the swing, and running adds a forward lean, pumping bent arms and a flight-phase bounce). The gait follows how fast the body actually moves, so walking into a wall doesn't run in place. `Character.ts` shows a stand-in until the model loads.
- Wardrobe (C): `src/game/WardrobeUI.ts`. Catalog and look validation: `shared/Wardrobe.ts`. After creation, hair, eyes and skin stay free to change, but the outfit is locked: clothes only change at **Maple Threads** downtown, where you try pieces on, buy them (kept in `account.wardrobe`) or put owned ones back on. `RoomLogic` enforces this on `{t:'look'}`: the body can only be set while `account.look` is still null, and the clothing fields (`OUTFIT_KEYS`, `keepOutfit`) only change while you stand at the Maple Threads door. The worn look is `account.look`, sent to everyone in player snapshots.

## Admin-published items

The site admin can add Buy-mode items without a code change: **Admin → Fox Plains items** opens a dev-mode editor (React Three Fiber) where a .glb/.gltf is previewed on a 1 m grid, scaled with drag handles, named, priced and published. `/api/maplestreet-items` stores the model in KV and the record in D1.

## Drafts and the developer instance

Every admin-published asset (Buy items and vehicles today) lives in one D1 table, `maplestreet_assets`, with a status: `draft`, `published` or `retired` (`shared/Assets.ts`). Both editors have **Save as draft** next to Publish, and the list shows a Draft badge with Publish and "Try in game".

- Drafts are listed only to the signed-in administrator, and only when the request asks for them (`?drafts=1`). The shared-world Durable Object never loads them, so players can't see or place them.
- **Developer instance:** `/modules/maplestreet.html?dev=1` (`src/core/DevMode.ts`). The start screen offers only a private solo game with its own save (`maplestreet/dev/v1`), loads the admin's drafts as real catalog and dealer entries, and says how many came in. A DEV badge stays on screen. Add `&solo=1` to skip the start screen.
- **Dev panel (F8)** (`src/game/DevPanel.ts`): every published and draft item and vehicle, drafts first. **Place** opens Buy mode on your lot with that item; **Drive** starts a test drive of the vehicle in front of Maple Motors, owned or not. Editing and publishing stay in the admin editors.
- Drafts are never written to the offline caches, so a later normal session can't pick them up.

- `shared/CustomItems.ts` turns each record into a `custom:<uuid>` catalog entry (`registerCustomItems`). The shared-world Durable Object registers them before it loads the world, and `src/build/CustomModels.ts` does the same in the page before any mode starts (the list is cached in `localStorage` for offline solo play), so `RoomLogic` validates and prices them like any other item.
- A placed copy is drawn as yaw (quarter turns) > the published `{x,y,z}` scale > an offset that centers the model's unscaled bounds and puts its bottom on the floor. The editor preview uses the same layout, so what the admin sees is what spawns.
- The footprint (cells) and collider height come from the scaled bounds (`footprintFromSize`). Custom items are floor items, never tintable, and have no needs interaction.
- Retired items leave the Buy catalog but stay valid, so houses that own them keep them (and can still move or sell them).
- New items appear the next time a player loads the module. The optional Colyseus server does not load published items or vehicles.
- **Generate with Meshy** (below the item and vehicle editors) creates models with Meshy's API through the admin-only `/api/meshy` route: text → 3D previews, pick one and refine it for textures, remesh to a polygon target, retexture or remesh any published model, then open the result in the editor. Jobs live in D1 `meshy_jobs`, so the list survives reloads. The key is the Worker secret `MESHY_API_KEY`; without it the panel says Meshy isn't connected. For local work, `node scripts/meshy-mock.mjs` is a stand-in API (set `MESHY_API_BASE=http://localhost:8790/openapi` and the test key in `.dev.vars`). `node scripts/maplestreet-vehicles-e2e.mjs` runs the whole pipeline against `pnpm dev` and the stand-in: Meshy jobs, the editor, the test drive, publishing, buying and driving in solo, traffic, and the shared world.

## Admin-published vehicles

**Admin → Fox Plains vehicles** publishes vehicles without a code change. A vehicle can be sold at Maple Motors, drive around town as neighbor traffic, or both.

- `shared/Vehicles.ts` is the vehicle registry: built-in tuning is plain data there, and `VehicleKind` is a built-in name or `custom:<uuid>`. `shared/CustomVehicles.ts` registers published records into the tuning registry, `VEHICLES` (dealer, fuel) and the traffic list. The Durable Object registers them before it loads the world (and on every publish), and `src/physics/CustomVehicleModels.ts` does the same in the page before any mode starts (cached in `localStorage` for offline solo play), so every authority prices, sells and validates them like built-ins.
- Every mode drives a vehicle with the same `Vehicle` class and the same tuning numbers, so single-player and every online mode handle identically.
- The published model sits in the chassis frame (x forward, y up, z right): rotate by `model.yaw`, scale by `model.scale`, then move by `model.x/y/z`. The game adds its own spinning, steering wheels, lamps (glowing at night, brake lights) and paint. The editor cuts the model's baked-in wheels out before upload.
- Top speed and 0–60 are what the car actually does. `shared/VehicleDrive.ts` integrates the same longitudinal model as `Vehicle.ts` (pedal ramp, torque curve, aero drag, damping) and solves engine force and the torque cutoff for the targets. `src/physics/Dyno.ts` runs a full-throttle pull on the real physics; `?vehicleTest=1` (`src/game/VehicleTestDrive.ts`) is the editor's test drive.
- Garages keep `custom:` entries even if the list hasn't loaded, and retired vehicles stay registered, so owners keep them.
- Vehicles are original designs: names containing real makes or models are refused (`BRAND_PATTERN`).

Measured on the dyno, the built-in vehicles top out at: pickup 63 mph (0–60 in 16.4 s), sedan 65 mph (17.4 s), muscle coupe 79 mph (9.3 s), heavy-duty 66 mph (13.8 s), golf cart 18 mph, four-wheeler 42 mph. Their `topSpeed` preset values are torque-curve cutoffs, not speeds the cars reach.

## World and economy

- **Lots:** 80 lots. 60 are 32 × 40 m on ten residential streets between West and East Avenue: N1–N10 and S1–S10 face Main Street and North/South Street; N11–N30 and S11–S30 sit one row per street on Birch, Cedar, Elm and Hazel (north) and Aspen, Dogwood, Fir and Juniper (south). 28 lots have simulated neighbors with furnished houses (`shared/Seed.ts`), and simulated drivers and walkers move around them (`shared/Npc.ts`); the rest are for sale.
- **Willow Bend:** west of West Ave, two winding streets — Willow Bend (south) and Lakeview Dr (north) — loop around through the sweeping Hollow Bend, which Main Street runs into. Their 20 lots (W1–W20) come in mixed sizes from 26 × 36 m up to 60 × 60 m estates. Each sits just behind the curb at its nearest point, with a lawn strip and a longer driveway where the street curves away. Lot prices scale with area (`lotPrice`: $20,000 for a standard lot, $14,500–$56,500 here). Curves are `CURVES` in `shared/WorldLayout.ts` (centerlines sampled every metre, `curveDistance` for a fast distance lookup), drawn by `Roads.curves()` with curbs, gutters, a dashed center line and stop signs, and rasterised into the minimap's route grid.
- **Starter houses** (`shared/HousePlans.ts`): seven plans (the original classic, a ranch with an attached two-car garage, a two-storey colonial with stairs, a craftsman bungalow with a deep front porch, a flat-roofed modern house, a steep-roofed cape with a front picket fence, and a duplex), each with its own wall palette, interior, patio, fence and yard extras. Plans are written in lot-local coordinates (`Plot`) and emitted as ordinary build ops through `validateOp`. `SEED_VERSION` marks the roster: loading an older world rebuilds the houses neighbors already own and moves new neighbors onto lots that are unowned and empty, once; player-owned lots are never touched.
- **Sidewalks** line the back-yard side of every grid residential street and the lot side of West and East Ave (`residentialSidewalks()` in `shared/WorldLayout.ts`); each has a `road` side so `Roads.ts` curbs the right edge.
- **Trees:** each street's corner trees share one species (maple or linden), back yards mix in spruce, and the woods outside town are mostly spruce.
- **Downtown grid** (`shared/DowntownGrid.ts`): east of Market Ave, Second Ave, Third Ave and Shoreline Dr cross Mill St, Commerce St, Main St, South St and Park St, making twelve blocks with 4 m sidewalks, planters, benches and street lamps. Eleven blocks are lined on both street fronts with about 90 generated buildings (shops, apartments and offices, plus the Town Hall, Northwoods Cinema, Public Library, Lakeside Hotel and two office towers). They are scenery for now, and lighter than the original strip: only the street front and ends facing an avenue get detailed facades (12 px/m, no gloss map). The world is 1,280 m across (`WORLD_HALF` 640), and new traffic loops and pedestrians use the grid (`shared/Npc.ts`).
- **Maple Commons** (`src/world/TownSquare.ts`): the town square south of Main St between Market and Second Ave, with a lawn, cross and diagonal paths, a white gazebo on a round plaza, a brick clock tower on the Main St corner, benches, flower beds, shade trees, globe lamps that glow at night and a name plaque.
- **Civic block** on Commerce St behind downtown: Fox Plains Fire Station 1 (three apparatus bays with red bay lights that glow at night) and Fox Plains Police, both on the town map and minimap.
- **Starting cash:** new neighbors start with $105,000 in the open world. Solo mode has unlimited money (`unlimitedMoney` in `RoomLogic`; the HUD shows "Unlimited", and no loans or mowing pay are needed).
- **Lawns and mowing** (`shared/Mowing.ts`, `src/world/Lawn.ts`, `src/world/Grass.ts`):
  - Each 1 m cell of a lot stores when it was last cut and which way the mower pushed the blades. Grass grows back over **five in-game days** (`GROW_DAYS`): about 3.5 cm just cut, about 11 cm at full height. Five days after a cut it's due again.
  - Stripes are real lean, not paint. Blades leaning away from the camera look light and blades leaning toward it look dark, so the stripes swap shade as you walk around and soften when you look straight down. The 3D blades lean the same way.
  - A pass at an angle keeps part of the old lean (`KEEP_OLD_LEAN`), so crossing earlier stripes diagonally leaves a diamond (checkerboard) pattern.
  - Stripes fade as the grass grows and are gone at full height.
  - Mowing pay is weighted by how grown each cell was. Grass cut less than a day ago doesn't pay again.
  - The authority keeps the 1 m cells (run-length encoded, untouched lawns are empty). The client also paints each pass into a 4 texel/m data texture so its own stripes have clean edges.
  - Blades in open fields grow to meadow height. The public verges along Willow Bend are kept short.
- **Minimap** (`src/game/MiniMap.ts`, routing in `src/game/RoadRoute.ts`): heading-up, about 200 m across. With a delivery job it routes along the streets (A* on a 2 m road grid) to the pickup or drop-off and shows the distance; an arrow on the rim points to stops off the map.
- **Downtown** (`src/world/Downtown.ts`):
  - Maple Motors: buy vehicles, or take a free test drive.
  - Corner Diner, Bean There Café and Fresh Market: groceries become home-cooked meals at your fridge.
  - Maple Hardware: permanent upgrades.
  - The Savings & Loan.
  - Gas & Go, with four pumps.
- **Needs** (hunger, energy, fun) drop only while you're in town. Your bed, fridge, grill, tub and other items refill them.
- **Vehicles:**
  - You start with the **Maple Hauler** (a red compact pickup, `STARTER_TRUCK` in `shared/Economy.ts`, model `public/modules/maplestreet/vehicles/maple-hauler.glb`), a trailer and a riding mower. It hauls deliveries, tows the trailer and can be repainted like any car. Older accounts keep their Work Pickup and get the Hauler too.
  - Nothing is ever brought to you. On arrival your truck and trailer are parked on your driveway; after that every vehicle stays wherever you leave it. The Garage's **Take out** parks one more vehicle on your driveway (or in front of Maple Motors before you own a home), and **Put away** returns it. Test drives wait in front of Maple Motors.
  - Every spot a vehicle is put in is checked against buildings, props and every other vehicle (`src/physics/Parking.ts`), and a parked vehicle that ends up inside or on top of another is moved to the nearest free spot. Wheels never ride on other cars (only on trailer beds), vehicle bodies are rounded so they slide apart instead of snagging, and NPC drivers stop a bumper-length short of anything in their lane. A reconnect replaces your old session, so its truck can't linger where your new one appears.
  - Enclosed vehicles (pickup, heavy-duty crew cab, sedan, coupe) have opening doors (`src/physics/VehicleDoors.ts`): the driver's door swings open as anyone gets in or out, and the right-click menu opens or closes them all. Open-air vehicles have none, and admin-published vehicles keep the doors baked into their model.
  - Published and bundled vehicles open too: their doors, hood and trunk are marked as boxes in the vehicle editor (`parts`, suggested by AI), and `src/physics/CutParts.ts` cuts those regions out of the model into hinged leaves. The right-click menu opens the doors, the hood and the trunk; a pickup tailgate (`drop`) folds down. The Meridian Sedan, Bulwark 4x4 and Ironhorn Crew Cab ship with theirs marked.
  - The dealer sells a heavy-duty crew-cab pickup, a muscle coupe, a sedan, a golf cart, a four-wheeler and a zero-turn mower, the bundled Meridian Sedan, Bulwark 4x4, Ironhorn Crew Cab and Lakeshore Coupe (`shared/BundledVehicles.ts`, models in `public/modules/maplestreet/vehicles/`), plus any admin-published vehicles marked for sale. These are original designs.
  - Neighbor traffic includes six Lakeshore Coupes in silver, red, blue, black, white and green on the downtown loop and both rings. A vehicle record's `traffic.count`, `traffic.routes` and `traffic.colors` put a fleet on the road; each car's color travels in its snapshot `style` and is painted onto the model's paint region (`paint.mode: 'color'`).
  - Fuel burns as you drive and is saved with your account.
  - Drivers sit visibly in the seat, both your own and other players'.

`shared/RoomLogic.ts` is the single authority. It handles:

- lot ownership (you can never edit another player's lot)
- build validation
- batched build gestures, applied in order (`{t:'builds'}`)
- money and the $50,000 loan cap
- interest, charged only on days you're present
- mowing pay and delivery checks
- shop, pump and item proximity checks
- fuel levels, which client reports can only lower

## Performance

What a frame costs, and why (measured headless at the spawn point, Nov 2026, before → after):

| | Before | After |
| --- | ---: | ---: |
| GPU draw calls per frame (main + shadow + post) | ~1,560 | ~630 |
| Rapier step (`world.step`) | ~8–10 ms | ~2 ms |
| Catch-up physics steps after a slow frame | up to 6 | up to 4 |

- **Physics streaming** (`Physics.stream`, called from `Game.fixed`). The town has about 9,800 static colliders, and Rapier pays for every enabled one on every 60 Hz step, so physics alone could eat half a frame and snowball into the next. Only static colliders within `STREAM_RADIUS` (160 m) of you, each of your vehicles and the camera are enabled, re-checked every 0.2 s and at once after a teleport; `Physics.wake` switches on the ones around a spot checked from afar (parking). Gameplay never touches the far ones; the ground stays on everywhere.
- **Batching** (`src/core/Merge.ts`). Static content is drawn as one mesh per material: houses per 64 m cell (`HouseManager`, re-batched once per burst of edits), the neighborhood's scenery per chunk part, downtown, roads, vehicle bodies and wheels. Plain finishes (no texture, opaque, not glowing) all share one node material that reads color, roughness and metalness from the vertices, so they shade exactly as before but cost one draw. Anything that changes on its own (lawns, custom models that load later, vehicle bodies from .glb files) is marked `userData.keep` and left alone. Quantized glTF data is unpacked before merging (it used to be clamped to ±1, which squashed published vehicles).
- **Adaptive resolution** (`Engine.adapt`). Full sharpness (device pixel ratio up to 2) whenever the device keeps up; below ~45 fps for two seconds the render resolution steps down by 0.25 (never below 1), and back up after a stretch above ~57 fps.
- **Fixed-step cap** (`src/core/Loop.ts`, `MAX_STEPS`): a long frame slows the simulation instead of queueing more physics work for the next one.
- **Culling** (`WorldChunks.update` and `WorldChunks.cull`, called from `Game.frame`). Distance: every chunk part (neighborhood scenery, houses, and now downtown, which is batched per cell too) is detached from the scene graph once the *camera* is farther than its view distance (160–720 m by size, with hysteresis). View: every frame, after the camera and sun have moved, each attached part is tested against the camera frustum; parts outside it are made invisible so three.js never walks their children, except shadow casters inside the sun's shadow box, whose shadows can fall into view from behind you. Avatars have a fixed bounding sphere, so skinned bodies are frustum-culled too (they were always drawn before).
- **Level of detail** (`src/core/Lod.ts`). One registry, `lods`, updated each frame with the camera; an entry is an anchor, switch distances and a swap. Published and bundled vehicles show the full model (and opening doors) within 35 m, an ~8k-triangle copy to 90 m, a ~1.6k copy to 250 m and a box impostor beyond (`VEHICLE_LOD_DISTANCES`). Avatars swap their skinned geometry for ~6k and ~1.5k triangles past 12 m and 35 m (`AVATAR_LOD_DISTANCES`), keeping skeleton, pose and look. Coarser levels are made at runtime with meshoptimizer from the loaded model and share its vertex buffers (only a smaller index buffer is added, cached per model). Levels switch 12 % past each threshold so nothing flickers.
- **No garbage in the loop.** The render and physics paths reuse scratch objects (`CameraRig`, `Character`, `Vehicle`, `Game`, `Physics`, `Npc`, `Grass`, `Neighborhood`, `DayNight`): no `new Vector3`, `clone()`, closures or array copies per frame or per step. NPC footprints are updated in place, the camera ray is one reused `RAPIER.Ray`, `Character.position` is one shared vector (copy it to keep it), and the interaction prompt refreshes at 10 Hz. Remote vehicle views are pooled per kind; avatars of a body share one compiled material whose colors are per-object uniforms; the town map caches its static and lot layers.
- **Shader warm-up** (`src/core/Prewarm.ts`). New avatar models and remote vehicle bodies are compiled with `renderer.compileAsync` before they are shown (the stand-in or the 200 m spawn radius covers the wait), and procedural textures are built without reading a canvas back from the GPU.

### World chunking and traffic

Two systems share one focus point each frame (the character, the vehicle you drive, or the build-mode target; `Game.frame`):

- **World chunks** (`src/world/WorldChunks.ts`). The neighborhood's scenery and every lot's house are moved into a 64 m grid. Each object gets a view distance from its size (`SCREEN_K`, about 4 px tall), rounded up to `VIEW_TIERS` (160, 320, 480, 720 m), so mailboxes drop out early and houses late. The woodland and street lamps, which were three world-wide `InstancedMesh`es, are split per 256 m cell (`INSTANCE_CELL`) so frustum and shadow culling can skip the trees behind you. A (cell, view distance) bucket is a `THREE.Group` that is attached to or removed from the scene; new buckets are compiled with `renderer.compileAsync` first and attached a few per frame, with 24 m of hysteresis. Ground, road and sidewalk slabs (town-wide merged meshes) and downtown (already one merged batch per material) are always drawn. Each part is merged into one mesh per material once adopted; houses arrive pre-batched per cell with the view distance of the pieces they came from, so furniture still drops out early.
- **Traffic** (`src/net/RemoteEntities.ts`). Neighbor traffic is simulated as data by the authority (`shared/Npc.ts`) and arrives in snapshots for the whole town. A remote vehicle only gets its 3D shell, wheels, lights and kinematic collider within 200 m (`VEHICLE_SPAWN_R`) and gives them back to a per-kind pool past 240 m; when it comes back it is placed at the interpolated position, heading, steering and speed for that moment. Its driver goes with it. Neighbor walkers do the same within 110 m. Real players on foot are always drawn.

`?nochunks` turns the chunk grid off for comparisons, and `maple.worldDebug()` in the console prints chunk and traffic counts. Measured headless (estimated per-frame work at five spots, Nov 2026): main-pass triangles fell 38–76 % and shadow-pass triangles 62–89 %, with draw calls between −11 % and +16 %; in the woods only 0 of 9 neighbor cars and 0 of 8 walkers are drawn.

## Modes

| Mode | How | Authority |
| --- | --- | --- |
| Open world (default) | "Enter Fox Plains", `?world=1` or `?room=WORLD` | Durable Object `MapleStreetWorld` (`src/server/maplestreet-world.ts`), state in D1 `maplestreet_world` |
| Solo, unlimited money | "Solo mode", `?solo=1` | `src/net/Host.ts` in the page (save `maplestreet/solo/v3`) |

In the shared world:

- Signed-in members are identified by their session, and guests by a random key kept in the browser; guests are always named `Guest-` plus the start of that key.
- **Resetting everyone:** the world's D1 keys are prefixed with `WORLD_GENERATION` in `shared/WorldServer.ts` (currently `g2:`, the November 2026 reset). Bump it to start every lot, house, account and lawn over; older rows are simply never read again.
- Progress autosaves every 5 minutes (`AUTOSAVE_EVERY_MS` in `shared/Protocol.ts`) and shows a "Progress autosaved" notice. It also saves when you leave: closing the tab or disconnecting from the shared world, or hiding the page in solo.
- New neighbors pick a plot on the overview map. Returning ones start on their own driveway.
- If the open world can't be reached, the module falls back to solo mode and shows a notice.

URL flags: `?webgl` forces WebGL2, `?noao` turns off GTAO, and `?norender` runs the simulation without drawing (for headless tests).

## Colyseus server (optional)

```sh
cd modules-src/maplestreet/colyseus-server && npm install && npm run dev   # ws://localhost:2567
```

It isn't deployed and the page no longer connects to it (the start screen only offers the open world and solo). It's kept as a reference Node host for `RoomLogic`.
