# Maple Street (source)

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

## Start screen

The start screen shows your name and you can't change it: signed in to the library it's your username, otherwise a guest name made once for this browser (`Guest-xxxxx`, also used by the server). There are two modes, **Enter Maple Street** (the shared open world) and **Solo mode** (a private neighborhood on this device with unlimited money).

## Characters and wardrobe

- New neighbors make their character once, in the wardrobe panel that opens on arrival: male or female (final), hair, face and a starter outfit. The two scanned models (`public/modules/maplestreet/{male,female}.glb`) are rebuilt from the raw scans by `tools/build-characters.mjs` (simplified mesh, auto-rigged skeleton, clothing-region mask `*-mask.png`); run it with `@gltf-transform/*`, `meshoptimizer` and `sharp` installed.
- `src/avatar/`: `AvatarAssets` (loading, hair pressed flat for buzz/long/hats), `AvatarMaterial` (TSL recolor shader: skin, hair, eyes, jacket, tee, pants, shoes, patterns), `HairAndHats` (long hair, buns, beanie/cap/bucket hat), `AvatarModel` (pose: walk, idle, seated). `Character.ts` shows a stand-in until the model loads.
- Wardrobe (C): `src/game/WardrobeUI.ts`. Catalog and look validation: `shared/Wardrobe.ts`. After creation, hair, eyes and skin stay free to change, but the outfit is locked: clothes only change at **Maple Threads** downtown, where you try pieces on, buy them (kept in `account.wardrobe`) or put owned ones back on. `RoomLogic` enforces this on `{t:'look'}`: the body can only be set while `account.look` is still null, and the clothing fields (`OUTFIT_KEYS`, `keepOutfit`) only change while you stand at the Maple Threads door. The worn look is `account.look`, sent to everyone in player snapshots.

## Admin-published items

The site admin can add Buy-mode items without a code change: **Admin → Maple Street items** opens a dev-mode editor (React Three Fiber) where a .glb/.gltf is previewed on a 1 m grid, scaled with drag handles, named, priced and published. `/api/maplestreet-items` stores the model in KV and the record in D1.

- `shared/CustomItems.ts` turns each record into a `custom:<uuid>` catalog entry (`registerCustomItems`). The shared-world Durable Object registers them before it loads the world, and `src/build/CustomModels.ts` does the same in the page before any mode starts (the list is cached in `localStorage` for offline solo play), so `RoomLogic` validates and prices them like any other item.
- A placed copy is drawn as yaw (quarter turns) > the published `{x,y,z}` scale > an offset that centers the model's unscaled bounds and puts its bottom on the floor. The editor preview uses the same layout, so what the admin sees is what spawns.
- The footprint (cells) and collider height come from the scaled bounds (`footprintFromSize`). Custom items are floor items, never tintable, and have no needs interaction.
- Retired items leave the Buy catalog but stay valid, so houses that own them keep them (and can still move or sell them).
- New items appear the next time a player loads the module. The optional Colyseus server does not load published items.

## World and economy

- **Lots:** 80 lots. 60 are 32 × 40 m on ten residential streets between West and East Avenue: N1–N10 and S1–S10 face Main Street and North/South Street; N11–N30 and S11–S30 sit one row per street on Birch, Cedar, Elm and Hazel (north) and Aspen, Dogwood, Fir and Juniper (south). Six come with furnished starter houses (`shared/Seed.ts`), and simulated drivers and walkers move around them (`shared/Npc.ts`).
- **Willow Bend:** west of West Ave, two winding streets — Willow Bend (south) and Lakeview Dr (north) — loop around through the sweeping Hollow Bend, which Main Street runs into. Their 20 lots (W1–W20) come in mixed sizes from 26 × 36 m up to 60 × 60 m estates. Each sits just behind the curb at its nearest point, with a lawn strip and a longer driveway where the street curves away. Lot prices scale with area (`lotPrice`: $20,000 for a standard lot, $14,500–$56,500 here). Curves are `CURVES` in `shared/WorldLayout.ts` (centerlines sampled every metre, `curveDistance` for a fast distance lookup), drawn by `Roads.curves()` with curbs, gutters, a dashed center line and stop signs, and rasterised into the minimap's route grid.
- **Civic block** on Commerce St behind downtown: Maple Street Fire Station 1 (three apparatus bays with red bay lights that glow at night) and Maple Street Police, both on the town map and minimap.
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
  - You start with a pickup, a trailer and a riding mower.
  - The dealer sells a heavy-duty crew-cab pickup, a muscle coupe, a sedan, a golf cart, a four-wheeler and a zero-turn mower. These are original designs.
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

## Modes

| Mode | How | Authority |
| --- | --- | --- |
| Open world (default) | "Enter Maple Street", `?world=1` or `?room=WORLD` | Durable Object `MapleStreetWorld` (`src/server/maplestreet-world.ts`), state in D1 `maplestreet_world` |
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
