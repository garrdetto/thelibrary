# Fox Lake (source)

Source for `public/modules/foxlake.html`, module id `foxlake`. Fox Lake is one world made of two places: the shared Fox Plains town (every player's lot, house, car and neighbor, the same ones classic Fox Plains shows) and Rack & Reel's Bear Paw Lake country south of it, joined by a county road. It replaced Fox Plains 2 (`#module-foxplains2` redirects here). Rack & Reel stays a standalone game; classic Fox Plains keeps sharing the town.

Design and decisions: `docs/superpowers/specs/2026-11-11-fox-lake-design.md`. Performance and leak results: `docs/foxlake/PERF.md`.

## How it is put together

Fox Lake **is** Rack & Reel's game (`modules-src/rackreel/game/Game.ts`) with a host-world extension. Everything the lake country does in Rack & Reel works here unchanged, because it is the same code: the renderer and its tone mapping, cached sun and moon shadows, sky and fog, terrain, water, foliage and grass, the skinned hunter and the character creator, fishing, hunting, the boat, UTV and quad, Wild Man's carp bowfishing, wildlife, the record books and the hunting party.

`index.ts` starts `new Game(canvas, { terrain, extension, bowfishAnyHour: true })`:

- `terrain`: `new Terrain(FOX_LAKE_SHAPE)` (`region.ts`). The lake country's north edge has no rim of hills; it blends down to the town's ground (`TOWN_Y`), and land beyond the square is the town's (`TOWN_LAND`). Standalone Rack & Reel uses `STANDALONE_SHAPE` (every edge rimmed), so its heights are unchanged.
- `extension`: `FoxLakeTown` (`town/FoxLakeTown.ts`), Rack & Reel's `GameExtension` hook (build, ready, update, collide, obstacle, interact, prompt, spawn, place name; the shared world drives the clock).
- `bowfishAnyHour`: Wild Man takes you carp bowfishing at any hour. Fox Lake shares one clock with everyone, so nobody can skip to dark.

### Coordinates (`region.ts`)

The scene uses Rack & Reel's coordinates (left-handed, +x east, +z north, the lake country is the 1024 m square around the origin). The town keeps the shared world's right-handed coordinates and hangs under one node that moves it north of the square and mirrors z, so it reads exactly as classic Fox Plains shows it:

```
scene = (town.x - 356, town.y + 2, 1152 - town.z)
```

East Ave (town x = 87) runs south out of town and becomes the county road (`CONNECTOR`, `town/TownGround.ts`), which meets the interstate where it leaves the lake country's north edge. Snapshots sent to the shared world are in town coordinates; out in the lake country that is beyond the town's square, and classic Fox Plains hides anyone there (`inTownWorld` in `maplestreet/shared/WorldLayout.ts`).

### The town (`fp/`, `town/`)

- `fp/` is Fox Plains 2's Babylon code for the town (it moved here when Fox Lake replaced Fox Plains 2): `world/Town.ts` (roads, sidewalks, driveways, lawns with mowing stripes, lamps, for-sale signs), `world/Downtown.ts` (shops and signs atlas), `world/Houses.ts` (every lot's house from the shared build data), `core/` (mesh building, procedural PBR surfaces, the ground material plugin, glTF assets), `physics/` (Rapier, the Fox Plains raycast cars with the same numbers, parking, vehicle views). Its builders draw through `setRenderer` (any `GfxHost`) and hang their roots under `setHostRoot`.
- `town/TownGfx.ts` is that host inside Rack & Reel's renderer: static casters (merged shadow proxies) go to Rack & Reel's cached shadow layer by 128 m cell near the player, moving ones (vehicles) to its moving layer, and the town's PBR materials light from an environment cube baked from Rack & Reel's sky.
- `town/TownGround.ts` lays the ground north of the square the way Rack & Reel lays its own (one vertex-coloured mesh over its detail texture), the county road in the interstate's asphalt, and trees on the strip east of town. The town's yard and forest-ring trees are planted as Rack & Reel foliage (`Foliage.plantTrees`) at the spots the town layout picks.
- `town/Cars.ts`: your vehicles (the starter pickup and trailer, the riding mower, V for the next one you own) are Fox Plains Rapier cars driven through Rack & Reel's `VehicleController` as external vehicles (`addExternal`), so seats, camera, enter and exit, HUD and audio are Rack & Reel's. A stand-in node in scene coordinates follows each car so the hunter sits upright in it.
- `town/Neighbors.ts`: other players and the simulated neighbors, as Rack & Reel hunters (an everyday outfit and a face picked from their name), and their vehicles, interpolated 120 ms behind.
- `town/TownHud.ts`: the wallet chip, who is around, the zone and connection, and the Fox Plains street map in the corner while you're in town.
- `core/RegionCuller.ts`: far town cells and far lake-country tree stands are switched off (beyond 640 m the fog hides them), so the town costs nothing at the lake and the woods cost nothing in town.

### Physics

The town and your cars are on Rapier (`fp/physics/Physics.ts`): the flat town ground, every building, house and tree as streamed static colliders, and the lake country as a heightfield, so a car can drive down the county road to the lake. On foot, the hunter walks Rack & Reel's way and is pushed out of the town's solids (`Physics.pushOut`); the UTV and quad bump into them (`Physics.blocked`). The boat stays on the lake.

### Money

Signed-in players have one wallet shared by Fox Lake, classic Fox Plains and Rack & Reel: the Fox Plains world holds it (`RoomLogic.adjustMoney`, the Durable Object's `/wallet`), and `/api/rackreel` pays and charges it (`src/server/shared-wallet.ts`). A player's old Rack & Reel cash moves in once. Guests keep separate town and lake cash.

## Controls

Rack & Reel's, plus E at your car (drive), at shops (Maple Threads opens the wardrobe), V to bring out another of your vehicles, H to go home (every 15 minutes).

## Debugging

`window.__foxlake.town.debug()` (connection, neighbors, colliders, cars, culling), `window.__foxlake.game.host()`. `?solo=1` plays the town on this device; `?hour=21` pins the sky. `node scripts/foxlake-capture.mjs [baseUrl] [outDir]` loads the built page in Chrome, takes screenshots at fixed spots with frame-time and scene counts, and walks town → lake → town five times to check that mesh, material and texture counts stay flat.

## Assets

- Everyday outfits are Meshy retextures of the hunter (`assets-src/rackreel/meshy/hunter-everyday.meshy.json`), ingested with `modules-src/rackreel/tools/ingest-hunter.py` (`HUNTER_ONLY` limits it to named outfits) and mapped in `tools/builders_meshy_hunter.py`.
- The golf cart, ATV, zero-turn, riding mower and trailer are Meshy models (`assets-src/models/foxlake/vehicles.meshy.json`) turned, scaled and set on the built-in's wheels by `tools/build-vehicles.py` (Blender) into `assets-src/models/maplestreet/vehicles/`, then `pnpm assets`. Their wheels are part of the body.
