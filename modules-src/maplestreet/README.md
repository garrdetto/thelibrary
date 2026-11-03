# Maple Street (source)

Source for `public/modules/maplestreet.html`, a 3D neighborhood simulation. You pick a plot on the town map, build and furnish a house with Sims-style Build and Buy tools, and drive around town. There are lawns to mow, deliveries to haul, shops and a gas station downtown, and a bank with a capped loan. Everyone shares one persistent world, so you can come and go as you please.

three.js 0.186.1 (WebGPU with automatic WebGL2 fallback), Rapier 0.14 (`@dimforge/rapier3d-compat`, with `await RAPIER.init()` before the loop starts), PeerJS 1.5.4 and colyseus.js 0.15.28 (loaded on demand) are npm packages pinned in the root `package.json` and bundled by Vite; nothing loads from a CDN.

## Build

`pnpm build` (or `pnpm dev`) at the repository root builds this module with every other learning module: `index.html` and `index.ts` here are the Vite entry, and the result is `public/modules/maplestreet.html` plus shared chunks in `public/modules/chunks/` (see `vite.modules.ts` and `docs/ENGINE-MAP.md`).

Edit the TypeScript and `index.html`, not the generated page. This folder is excluded from the site `tsconfig.json`, so its bare imports (`three/webgpu`, Rapier) don't affect the site's type check.

## Controls

| Live mode | |
| --- | --- |
| WASD | Walk, or drive. S brakes and then reverses, and Space is the handbrake. |
| Click | Walk to the spot. Clicking a vehicle, shop door or usable item at home walks you there and uses it. |
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

## Characters and wardrobe

- The start screen asks whether your character is male or female. The two scanned models (`public/modules/maplestreet/{male,female}.glb`) are rebuilt from the raw scans by `tools/build-characters.mjs` (simplified mesh, auto-rigged skeleton, clothing-region mask `*-mask.png`); run it with `@gltf-transform/*`, `meshoptimizer` and `sharp` installed.
- `src/avatar/`: `AvatarAssets` (loading, hair pressed flat for buzz/long/hats), `AvatarMaterial` (TSL recolor shader: skin, hair, eyes, jacket, tee, pants, shoes, patterns), `HairAndHats` (long hair, buns, beanie/cap/bucket hat), `AvatarModel` (pose: walk, idle, seated). `Character.ts` shows a stand-in until the model loads.
- Wardrobe (C): `src/game/WardrobeUI.ts`. Catalog and look validation: `shared/Wardrobe.ts`. Hair, eyes and skin are free; clothing is bought at **Maple Threads** downtown and kept in `account.wardrobe`; the worn look is `account.look`, validated by `RoomLogic` (`{t:'look'}`) and sent to everyone in player snapshots.

## Admin-published items

The site admin can add Buy-mode items without a code change: **Admin → Maple Street items** opens a dev-mode editor (React Three Fiber) where a .glb/.gltf is previewed on a 1 m grid, scaled with drag handles, named, priced and published. `/api/maplestreet-items` stores the model in KV and the record in D1.

## Drafts and the developer instance

Every admin-published asset (Buy items and vehicles today) lives in one D1 table, `maplestreet_assets`, with a status: `draft`, `published` or `retired` (`shared/Assets.ts`). Both editors have **Save as draft** next to Publish, and the list shows a Draft badge with Publish and "Try in game".

- Drafts are listed only to the signed-in administrator, and only when the request asks for them (`?drafts=1`). The shared-world Durable Object never loads them, so players can't see or place them.
- **Developer instance:** `/modules/maplestreet.html?dev=1` (`src/core/DevMode.ts`). The start screen offers only a private solo game with its own save (`maplestreet/dev/v1`), loads the admin's drafts as real catalog and dealer entries, and says how many came in. A DEV badge stays on screen. Add `&solo=1` to skip the start screen.
- Drafts are never written to the offline caches, so a later normal session can't pick them up.

- `shared/CustomItems.ts` turns each record into a `custom:<uuid>` catalog entry (`registerCustomItems`). The shared-world Durable Object registers them before it loads the world, and `src/build/CustomModels.ts` does the same in the page before any mode starts (the list is cached in `localStorage` for offline solo play), so `RoomLogic` validates and prices them like any other item.
- A placed copy is drawn as yaw (quarter turns) > the published `{x,y,z}` scale > an offset that centers the model's unscaled bounds and puts its bottom on the floor. The editor preview uses the same layout, so what the admin sees is what spawns.
- The footprint (cells) and collider height come from the scaled bounds (`footprintFromSize`). Custom items are floor items, never tintable, and have no needs interaction.
- Retired items leave the Buy catalog but stay valid, so houses that own them keep them (and can still move or sell them).
- New items appear the next time a player loads the module. The optional Colyseus server does not load published items or vehicles.
- **Generate with Meshy** (below the item and vehicle editors) creates models with Meshy's API through the admin-only `/api/meshy` route: text → 3D previews, pick one and refine it for textures, remesh to a polygon target, retexture or remesh any published model, then open the result in the editor. Jobs live in D1 `meshy_jobs`, so the list survives reloads. The key is the Worker secret `MESHY_API_KEY`; without it the panel says Meshy isn't connected. For local work, `node scripts/meshy-mock.mjs` is a stand-in API (set `MESHY_API_BASE=http://localhost:8790/openapi` and the test key in `.dev.vars`). `node scripts/maplestreet-vehicles-e2e.mjs` runs the whole pipeline against `pnpm dev` and the stand-in: Meshy jobs, the editor, the test drive, publishing, buying and driving in solo, traffic, and the shared world.

## Admin-published vehicles

**Admin → Maple Street vehicles** publishes vehicles without a code change. A vehicle can be sold at Maple Motors, drive around town as neighbor traffic, or both.

- `shared/Vehicles.ts` is the vehicle registry: built-in tuning is plain data there, and `VehicleKind` is a built-in name or `custom:<uuid>`. `shared/CustomVehicles.ts` registers published records into the tuning registry, `VEHICLES` (dealer, fuel) and the traffic list. The Durable Object registers them before it loads the world (and on every publish), and `src/physics/CustomVehicleModels.ts` does the same in the page before any mode starts (cached in `localStorage` for offline solo play), so every authority prices, sells and validates them like built-ins.
- Every mode drives a vehicle with the same `Vehicle` class and the same tuning numbers, so single-player and every online mode handle identically.
- The published model sits in the chassis frame (x forward, y up, z right): rotate by `model.yaw`, scale by `model.scale`, then move by `model.x/y/z`. The game adds its own spinning, steering wheels, lamps (glowing at night, brake lights) and paint. The editor cuts the model's baked-in wheels out before upload.
- Top speed and 0–60 are what the car actually does. `shared/VehicleDrive.ts` integrates the same longitudinal model as `Vehicle.ts` (pedal ramp, torque curve, aero drag, damping) and solves engine force and the torque cutoff for the targets. `src/physics/Dyno.ts` runs a full-throttle pull on the real physics; `?vehicleTest=1` (`src/game/VehicleTestDrive.ts`) is the editor's test drive.
- Garages keep `custom:` entries even if the list hasn't loaded, and retired vehicles stay registered, so owners keep them.
- Vehicles are original designs: names containing real makes or models are refused (`BRAND_PATTERN`).

Measured on the dyno, the built-in vehicles top out at: pickup 63 mph (0–60 in 16.4 s), sedan 65 mph (17.4 s), muscle coupe 79 mph (9.3 s), heavy-duty 66 mph (13.8 s), golf cart 18 mph, four-wheeler 42 mph. Their `topSpeed` preset values are torque-curve cutoffs, not speeds the cars reach.

## World and economy

- **Lots:** 60 lots of 32 × 40 m on ten residential streets between West and East Avenue. The original 20 (N1–N10, S1–S10) face Main Street and North/South Street; N11–N30 and S11–S30 sit one row per street on Birch, Cedar, Elm and Hazel (north) and Aspen, Dogwood, Fir and Juniper (south). Saved worlds pick up the new lots as empty lots. 28 lots have simulated neighbors with furnished houses (`shared/Seed.ts`), and simulated drivers and walkers move around them (`shared/Npc.ts`); the rest are for sale.
- **Starter houses** (`shared/HousePlans.ts`): seven plans (the original classic, a ranch with an attached two-car garage, a two-storey colonial with stairs, a craftsman bungalow with a deep front porch, a flat-roofed modern house, a steep-roofed cape with a front picket fence, and a duplex), each with its own wall palette, interior, patio, fence and yard extras. Plans are written in lot-local coordinates (`Plot`) and emitted as ordinary build ops through `validateOp`. `SEED_VERSION` marks the roster: loading an older world rebuilds the houses neighbors already own and moves new neighbors onto lots that are unowned and empty, once; player-owned lots are never touched.
- **Sidewalks** line the back-yard side of every residential street and the lot side of West and East Ave (`residentialSidewalks()` in `shared/WorldLayout.ts`); each has a `road` side so `Roads.ts` curbs the right edge.
- **Trees:** each street's corner trees share one species (maple or linden), back yards mix in spruce, and the woods outside town are mostly spruce.
- **Downtown grid** (`shared/DowntownGrid.ts`): east of Market Ave, Second Ave, Third Ave and Shoreline Dr cross Mill St, Commerce St, Main St, South St and Park St, making twelve blocks with 4 m sidewalks, planters, benches and street lamps. Eleven blocks are lined on both street fronts with about 90 generated buildings (shops, apartments and offices, plus the Town Hall, Northwoods Cinema, Public Library, Lakeside Hotel and two office towers). They are scenery for now, and lighter than the original strip: only the street front and ends facing an avenue get detailed facades (12 px/m, no gloss map). The world is 1,280 m across (`WORLD_HALF` 640), and new traffic loops and pedestrians use the grid (`shared/Npc.ts`).
- **Maple Commons** (`src/world/TownSquare.ts`): the town square south of Main St between Market and Second Ave, with a lawn, cross and diagonal paths, a white gazebo on a round plaza, a brick clock tower on the Main St corner, benches, flower beds, shade trees, globe lamps that glow at night and a name plaque.
- **Civic block** on Commerce St behind downtown: Maple Street Fire Station 1 (three apparatus bays with red bay lights that glow at night) and Maple Street Police, both on the town map and minimap.
- **Starting cash:** new neighbors start with $105,000 (existing accounts keep their balance).
- **Grass** (`src/world/Grass.ts`): thin four-blade clumps at realistic heights (mowed lawn about 4–5 cm, uncut lawn 8–13 cm, open fields up to knee-high), dark roots to lighter tips, a gentle breeze and slow lush/dry color patches.
- **Minimap** (`src/game/MiniMap.ts`, routing in `src/game/RoadRoute.ts`): heading-up, about 200 m across. With a delivery job it routes along the streets (A* on a 2 m road grid) to the pickup or drop-off and shows the distance; an arrow on the rim points to stops off the map.
- **Downtown** (`src/world/Downtown.ts`):
  - Maple Motors: buy vehicles, or take a free test drive.
  - Corner Diner, Bean There Café and Fresh Market: groceries become home-cooked meals at your fridge.
  - Maple Hardware: permanent upgrades.
  - The Savings & Loan.
  - Gas & Go, with four pumps.
- **Needs** (hunger, energy, fun) drop only while you're in town. Your bed, fridge, grill, tub and other items refill them.
- **Vehicles:**
  - You start with a pickup, a trailer and a riding mower.
  - The dealer sells a heavy-duty crew-cab pickup, a muscle coupe, a sedan, a golf cart, a four-wheeler and a zero-turn mower, plus any admin-published vehicles marked for sale. These are original designs.
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

## Connection modes

| Mode | How | Authority |
| --- | --- | --- |
| Shared world (default) | "Enter Maple Street", `?world=1` or `?room=WORLD` | Durable Object `MapleStreetWorld` (`src/server/maplestreet-world.ts`), state in D1 `maplestreet_world` |
| Solo (Local Offline Simulation) | "Explore solo", `?solo=1` | `src/net/Host.ts` in the page |
| Online room | "Host a room" gives a 6-letter code; others join with it or `?room=CODE` | the host's browser (`PeerTransport`), up to 8 neighbors |
| Same-device tabs | More options → Same-device tabs | the tab holding the Web Lock (`LocalTransport`) |
| Colyseus | More options → server URL, or `?server=wss://…` | `colyseus-server/` (Node) |

In the shared world:

- Signed-in members are identified by their session, and guests by a random key kept in the browser. When you're signed in to the library, the start screen fills in your username and locks the name field; every mode (shared world, solo, rooms, tabs) uses it, and progress saved in this browser under an earlier typed name moves over to it.
- Progress autosaves every 5 minutes in every mode (`AUTOSAVE_EVERY_MS` in `shared/Protocol.ts`) and shows a "Progress autosaved" notice. It also saves when you leave: closing the tab or disconnecting from the shared world, or hiding the page in solo, rooms and tabs.
- New neighbors pick a plot on the overview map. Returning ones start on their own driveway.
- If anything online can't be reached, the module falls back to the offline simulation and shows a notice.

URL flags: `?webgl` forces WebGL2, `?noao` turns off GTAO, and `?norender` runs the simulation without drawing (for headless tests).

## Colyseus server (optional)

```sh
cd modules-src/maplestreet/colyseus-server && npm install && npm run dev   # ws://localhost:2567
```

It isn't deployed. The shared world runs on the site's Worker, and online rooms over PeerJS need no backend.
