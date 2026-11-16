# Fox Lake (source)

Source for `public/modules/foxlake.html`, module id `foxlake`. Fox Lake is Montello, Wisconsin: Tello's baked map of the real city and the country three miles round it (`modules-src/tello/`), with Rack & Reel's fishing, hunting, Wild Man and carp bowfishing moved onto Lake Montello and its woods. It is one shared world with lots, houses, cars and neighbors built by the same rules as classic Fox Plains. There is no Fox Plains town, county road, interstate or Bear Paw Lake country in it any more (classic Fox Plains at `#module-maplestreet` and standalone Rack & Reel keep theirs). It replaced Fox Plains 2 (`#module-foxplains2` redirects here). Every player starts fresh: Fox Lake has its own shared world (storage generation `fl1:`), its own money and its own Rack & Reel profile.

Design and decisions: `docs/superpowers/specs/2026-11-11-fox-lake-design.md` (the original two-place design). Performance and leak results: `docs/foxlake/PERF.md`.

## How it is put together

Fox Lake **is** Rack & Reel's game (`modules-src/rackreel/game/Game.ts`) with a host-world extension. Everything Rack & Reel does works here unchanged, because it is the same code: the renderer and its tone mapping, cached sun and moon shadows, sky and fog, the skinned hunter and the character creator, fishing, hunting, the boat, UTV and quad, Wild Man's carp bowfishing, wildlife, the record books and the hunting party.

`index.ts` loads Montello's map (the build's packed copy in `foxlake-map/`, streets already fixed, see Loading below; Tello's own files when it is missing) with the World Editor's edits replayed on it (`foxLakeLand`; see World edits below), finds where the lake gameplay stands (`findLakeSite`) and starts `new Game(canvas, { terrain: new TelloTerrain(land), extension: new FoxLakeTown({ land, site, ... }), bowfishAnyHour: true, gearAtCabin: true, profile: 'foxlake', site, ridesBought: true, homeName: 'the outfitter', look, shadows })`:

- `terrain`: Tello's `TelloTerrain` (`tello/region.ts`): Montello's land beyond Rack & Reel's square, the water depth from Montello's own levels, the ground types from its cover. Rack & Reel's 1024 m lake country still stands in its square around the scene's origin, sealed by its rim of hills and switched off (`LAKE_COUNTRY_MESHES`, `RegionCuller`); Montello's land lies more than 600 m clear of it (about 7.8 km from the origin), so none of Bear Paw Lake is ever drawn or reachable.
- `extension`: `FoxLakeTown` (`town/FoxLakeTown.ts`), Rack & Reel's `GameExtension` hook (build, ready, update, collide, obstacle, interact, prompt, spawn, place name, minimap; the shared world drives the clock).
- `site` (`LakeSiteConfig`, `rackreel/world/LakeSite.ts`; built by `lake/LakeSite.ts`): the dock, the boat, the UTV, the start, Wild Man's loops, the hunting stands and the wild land, all on Lake Montello and in the woods round it. See Lake Montello below.
- `ridesBought`: the UTV, the quad and the boat are not there until the account owns them (`Account.rides`, bought at the dealership). `GameHost.setRides` shows each one at the shore or the dock once owned.
- `homeName`: what the toasts call the gear rack's place (there is no cabin and no Fox Outfitters building).
- `bowfishAnyHour`: Wild Man takes you carp bowfishing at any hour. Fox Lake shares one clock with everyone, so nobody can skip to dark.
- `profile: 'foxlake'`: Rack & Reel's progress (character, gear, cash) is a separate profile (`/api/rackreel?game=foxlake`, stored as `foxlake:<user id>`), so Fox Lake starts fresh and standalone Rack & Reel is untouched.

### Coordinates (`region.ts`)

Two frames, one translation apart (`TOWN_OFFSET` = `(-4200, 0, -6600)`; `MONTELLO_AT` = `(-4608, -6108)` is where the middle of Tello's baked frame sits):

```
scene  x east, z north, left-handed (Babylon); Lake Montello's surface is y = 0.01
town   the shared world's frame: (map.x, y, -map.z), right-handed; scene = (town.x - 4200, town.y, -6600 - town.z)
```

Every number the shared world sends (lots, shop doors, pumps, players, vehicles) is in the town frame, so `MontelloPlaces.ts` (written by `scripts/montello-places.mjs`) is Montello's map with z turned. The script keeps its own copy of both constants and `tests/region.test.ts` keeps them equal. Snapshots to the shared world are in the town frame.

`lake/Rebase.ts` (`rebaseLand`, `LAKE_LEVEL` 10.7) moves every height in Montello's baked map down by Lake Montello's level, after Tello's own street levelling ran on the survey's heights: grids, building floors, bridge decks and lots. That puts the lake's water surface at y = 0 like Bear Paw Lake's, which every Rack & Reel system assumes (the bobber, the splash, the boat's waterline, the dock deck at 0.55, the carp). Other waters (Buffalo Lake, the Fox River) sit at their own levels, below it, and are not fishable properly. `lake/Land.ts` (`foxLakeLand`) is the one place the land is placed and rebased; the page and the tests both use it. The rebase rewrites the ground and water grids as signed values in their own memory, so they are not held twice.

### Loading

`lake/MapPack.ts` (`packFoxLakeMap`) and `tools/bake-map.ts` run at build time (`vite.modules.ts`, `thelibrary:foxlake-map`, whenever Fox Lake is built; skipped when nothing it reads changed): Tello's map with `fixStreets` already run (about 3 s of work the page used to do on every load), its grids stored as differences from their neighbours so gzip packs them to 16 MB instead of 23.5 MB, in `public/modules/foxlake-map/` (generated, git-ignored) as `montello.<hash>.json` and `.bin` named by `manifest.json`. The hashed files are cached for a year (`public/_headers`) and the manifest is revalidated, so a return visit downloads nothing. The heights stay the survey's: World Editor edits and the rebase still run on the page. `tests/map-pack.test.ts` checks the packed map builds exactly the same land, site and start as Tello's files. The grid file is unpacked straight into one buffer of its final size (`loadMap`), and PeerJS loads only when a hunting party is hosted or joined.

### World edits

The administrator's World Editor (admin panel) changes Montello: terrain, water, rivers, roads, buildings, parking lots, trees, guardrails, lights and walls (`tello/edits/`; how they are replayed and built is in `modules-src/tello/README.md`). `index.ts` fetches the published edits from `GET /api/world-edits` (same origin, 5 s timeout) while the map loads and passes them to `foxLakeLand(doc, grids, edits)`, which replays them after Tello's street fixes and before the rebase, so they are in map metres on the surveyed heights. The last published copy is kept on the device (`foxlake/world-edits/v1`) for when the site can't be reached; with neither, Montello is as baked. Edits that no longer fit the map are skipped and listed with `console.warn`.

- `?edits=draft` loads the administrator's saved draft (`GET /api/world-edits?draft=1`; for anyone else, or on any failure, the published edits). `?edits=none` loads none.
- `?at=<x>,<z>` (Montello map metres; the editor's "Open in Life Sim" button) puts you on foot there as play starts (`FoxLakeTown.jumpToStart`) with the developer panel's teleport (`FoxLakeDev.goTo`: the nearest dry spot within 16 m clear of trunks and solids). It runs before Montello's build starts, so the ground and trees go up round that spot first; once the buildings are solid, a player who is still standing there inside one is moved to safe ground again. A point outside the playable area gets a toast and no move.
- The shared world doesn't replay edits: the doors, pumps, lots for sale and other places in `MontelloPlaces.ts` stay where the baked map has them.

### The town (`fp/`, `town/`)

- `fp/` is Fox Plains 2's Babylon code (it moved here when Fox Lake replaced Fox Plains 2): `world/Houses.ts` (every lot's house from the shared build data), `core/` (mesh building, procedural PBR surfaces, the ground material plugin, glTF assets), `physics/` (Rapier, the Fox Plains raycast cars with the same numbers, parking, vehicle views). Its builders draw through `setRenderer` (any `GfxHost`) and hang their roots under `setHostRoot`. The Fox Plains town builders (`world/Town.ts`, `Downtown.ts`) are no longer used here.
- Montello itself is Tello's builder (`tello/world/Montello.ts`) with a zero shift: the ground, every road and bridge, the water, every building on its real footprint, the storefronts and the trees. Its solid ground, walls and the lakes' beds go up during loading (`buildSolids`); its buildings, ground mesh, water and trees go up 1.5 s after play starts, in slices of about 8 ms with a frame between them (`FoxLakeTown.startMontello`), so driving and turning stay smooth while it builds. Roads that leave the three-mile ring end at barricades (`tello/world/Barricades.ts`; Highway 23 leaves east).
- Fox Lake has no sun or moon shadows at all, for everyone (`FOX_LAKE_SHADOWS` in `look.ts`, passed as `GameOptions.shadows: false`): Rack & Reel's shadow layers stay off, the town builds no shadow proxies (`setShadowProxies` in `fp/core/Geo.ts`) and the Esc menu has no Shadows switch (`PauseHooks.graphicsLocked`). Tello keeps its shadows.
- Fox Lake's own picture is `FOX_LAKE_LOOK` in `look.ts` (shared with Tello), passed to Rack & Reel as `GameOptions.look` (`LightingLook` in `rackreel/world/Lighting.ts`): a gentler sun, shaded sides lifted by a sky fill, a night about 32 % brighter and matte characters.
- `town/TownGfx.ts` is the host inside Rack & Reel's renderer: static casters go to the shadow layer by 128 m cell near the player when shadows are on, moving ones (vehicles) through `host.addCaster`, and the town's PBR materials light from an environment cube baked from Rack & Reel's sky.
- `town/Cars.ts`: your vehicles (the starter pickup and trailer, the riding mower, V for the next one you own) are Fox Plains Rapier cars driven through Rack & Reel's `VehicleController` as external vehicles (`addExternal`), so seats, camera, enter and exit, HUD and audio are Rack & Reel's. Montello's land is not level, so a parked car is set down on the ground (`Cars.ground`, `setDown`; `Parking.find` takes the ground height).
- `town/Neighbors.ts`: other players, as Rack & Reel hunters (an everyday outfit and a face picked from their name), and their vehicles, interpolated 120 ms behind. The world has no simulated neighbors or traffic.
- The maps are Tello's (`tello/town/TelloMap.ts`): the corner map (turned with the camera, N cycles its range) and the full map (Ctrl) over Montello's whole three-mile area with directions along the real road network. `FoxLakeTown.drawMinimap` hands Rack & Reel's corner map over to it. Lots are not drawn on them yet.
- `town/Wading.ts`: a car in Montello's water is dragged in proportion to the depth past 25 cm; at 85 cm (over the doors) the engine floods (no throttle) and 1.6 s later it is towed back to the last spot where it stood on dry ground. Trailers and parked cars that roll in are towed out the same way.
- `town/TownHud.ts`: the wallet chip, who is around, the place you are in and the connection.
- `core/RegionCuller.ts`: far town cells and the sealed lake country's meshes are switched off beyond 860 m (`CULL_REACH`; at 640 m the day fog still let about 9 % of a building through, so distant buildings popped in and out), and Babylon is handed only the meshes of groups that are on and in view each frame instead of walking all ten thousand.

### Lake Montello (`lake/`)

`lake/LakeSite.ts` (`findLakeSite`, renderer-free and tested) lays the lake gameplay out on the rebased land, in scene coordinates:

- **The dock**: found by scanning the park shore west of downtown nearest the launch ramp (map (-35, 458)): 18 m of dock out from level, open bank into water at least a metre deep, the boat 2.6 m beside its end, the start 7 m inland and the UTV 14 m inland, all clear of pavement, woods and houses (map (34, 329) to (16, 329) today). `rackreel/world/World.ts` `siteLandmarks` turns that into the landmarks `buildDock`, the boat and the UTV use.
- **Wild Man's loops** (`rackreel/systems/BowRoutes.ts` `setLakeShape`): the shore loop round a centre out in the water, `radius(angle)` from rays to the shore (open water counts as 700 m, so on this long lake the loop closes over open water); there is no island, bay or channel, so the island and bay routes are the shore loop and there is no home stunt. His launch and camp are found by Rack & Reel's own `findLaunch` on the new lake.
- **Hunting**: three ladder stands and a box blind in the woods 160 m to 1.5 km out, well apart, each facing the openest ground (`StandPlan`; `TreeStand.standSiteAt`). `site.wild(x, z)` is woods (Tello's cover) 30 m or more from pavement and walls, 70 m from any building and 90 m inside the ring's edge; `Wildlife.wild` makes deer and bear spawn, roam and turn only there (spots are chosen round the players instead of across a square).
- **Fishing and the record books**: Rack & Reel's own, on any Montello water at the lake's level; the profile is `foxlake`.
- **The sealed square**: the cabin, Bear Paw Lake's own dock, boat, UTV, stands and wildlife still exist at the origin, hidden by `RegionCuller` and unreachable.

### Rides, gear, lots and the start

- **Rides** (`Account.rides`, `shared/Economy.ts` `LAKE_RIDE_ITEMS`): the side-by-side UTV, the quad and the fishing boat are bought at the dealership on Main Street (H A Freitag & Son, kind `dealer` in `MontelloPlaces.ts`). A `buy` for `ride-utv`, `ride-quad` or `ride-boat` at that door is checked by the authority (`RoomLogic.handleBuy`: at the door, enough money, once each) and the account keeps it. `shopItems(kind, foxLake)` is the list a counter sells (the dealership adds the rides in Fox Lake only). `FoxLakeTown.setAccount` calls `host.setRides(...)`; until owned, each ride is out of sight at the sealed square.
- **Gear rack, wardrobe and catalog**: there is no cabin and no Fox Outfitters building. `FoxLakeTown.gear` (`GearHooks`) is what a store counter calls: `gear.atRack(true)` while the player stands at the rack (1 and 2 then take or swap the rod and the rifle), `gear.open('rack' | 'wardrobe' | 'desk')` for the gear panel, the wardrobe and the order desk (the catalog, paid in Rack & Reel cash). The cabin's own rack, wardrobe and desk sit in the sealed square.
- **Casino**: the code in `casino/` is kept; its Fox Plains placement is gone. `FoxLakeTown.mountCasino` is the clean entry point (it builds `CasinoHost` and sets `casinoMounted`); today it mounts nothing.
- **Lots**: `MONTELLO_LOTS` (`MontelloPlaces.ts`, `LotDef`, generated by `scripts/montello-places.mjs`): the house parcels up Forest Lane and west of the fire department (`M…`, with `scan`: the scanned house comes down when bought, `Montello.clearHouse`) and vacant parcels on open, level ground along the east-west residential streets across the map (`V…`, nearest the city first). `LotDef.y` is the parcel's floor (Lake Montello's surface is 0); the owner builds at that level. The world is Montello's lots only (no Fox Plains lots, seeded neighbors or traffic); its storage generation is `FOX_LAKE_GENERATION` (`fl1:`), so old Fox Plains-town saves are never read.
- **Start and home**: players start on Main Street's kerb by the dealership (`lake/Spawn.ts` `findMainStreet`); H goes to your lot's front (every 15 minutes), or back to Main Street when you own none.

### Money

A signed-in player has one Fox Lake balance: Fox Lake's world holds it (`RoomLogic.adjustMoney`, the Durable Object's `/wallet`), town jobs pay into it, and `/api/rackreel?game=foxlake` (bounties, the catalog) and `/api/casino` pay and charge it (`src/server/shared-wallet.ts`). The Fox Lake profile's starting cash moves in once. Classic Fox Plains and standalone Rack & Reel money are separate. Guests play the casino with their town cash (by this browser's guest key); their lake cash is kept in the tab.

Lots are bought in Fox Lake itself: walk onto a lot for sale and press E.

### Physics

The town and your cars are on Rapier (`fp/physics/Physics.ts`): Montello's ground as a heightfield with its edge walls (`Montello.buildSolids`), every building, house and tree trunk as streamed static colliders. On foot, the hunter walks Rack & Reel's way and is pushed out of the town's solids (`Physics.pushOut`), out of every tree trunk (`Montello.pushTrees`) and out of every vehicle, yours and the neighbours' (`Physics.pushOutVehicles`); the UTV and quad bump into the solids (`Physics.blocked`). The boat stays on the lake.

### Life Sim's vehicles and the vehicle creator

The admin panel's vehicle creator (Life Sim → Vehicles, `src/components/maplestreet/vehicle/`) makes vehicles for Life Sim only: every save from it is tagged `game: 'lifesim'` (the Worker stamps it on `/api/maplestreet-vehicles` POST and PATCH). Life Sim registers them (`vehicles/LifeSimVehicles.ts` `forLifeSim`, in the page and in `FoxLakeWorld`) and its dealership sells them (`LIFE_SIM_DEALER` in `maplestreet/shared/Economy.ts`). Fox Plains (classic, Fox Plains 2 and Kestrel County: `forFoxPlains`) still registers them so an owner keeps one, but Maple Motors never sells them and they never drive in traffic; a Life Sim save over a bundled vehicle (`bundled-*`) changes it in Life Sim only. Bundled vehicles re-published in Fox Plains' days (untagged) still change Fox Plains only.

**The Kestrel helicopter** (`LIFE_SIM_VEHICLES`, $95,000 at the dealership, gas, 30 gal): a Meshy text-to-3D model cut into its body, main rotor and tail fan by `tools/build-helicopter.py` (Blender) into `assets-src/models/foxlake/helicopter.glb`, optimized by `pnpm assets` into `public/models/foxlake/helicopter.glb`. Its tuning has `flight` (`maplestreet/shared/Vehicles.ts` `FlightTuning`: climb rate, turn rate, agility, nose tilt and the rotor hubs), and `fp/physics/Flight.ts` flies it: the skids are the raycast wheels it rests on with the brakes on; Space lifts it off, and in the air its body has no gravity and is flown toward the velocity asked for (W/S forward speed up to its top speed, A/D turn rate, Space climb, Shift descend, nothing holds the altitude), changing by at most its agility each step and leaning nose down with speed and banking into turns. Descending onto the ground below 4 m/s lands it; with nobody aboard, or out of fuel, it sinks to the ground. Fuel burns while it flies. `fp/physics/Rotors.ts` spins the rotors (the asset pipeline moves node origins, so each rotor hangs on a pivot placed at its hub from the tuning), for your own and neighbors' helicopters. Water only floods it when the skids are actually in it (`Wading.depthUnder`).

**The Bumblebee** (`LIFE_SIM_VEHICLES`, $48,000, gas, 20 gal) is the little two-seat bubble ("bug") chopper: a glass-bubble cabin, an exposed engine and fuel tanks, an open yellow truss tail boom and a tail rotor at its end (a Meshy design image turned into a model with image-to-3D, `build-helicopter.py -- bubble` into `assets-src/models/foxlake/bubble-helicopter.glb`). It flies by the same rules, slower (about 85 mph) but quicker to turn and to answer the stick.

### Vehicle look

Fox Lake draws the game's own bundled vehicles (the Maple Hauler starter truck and the other `bundled-*` scans) unless the vehicle creator saved over one since it became Life Sim's (see above).

`fp/physics/ScanGlass.ts`: scanned bodies have their windows painted into the texture; they become clear glass. Each body triangle is classified by the shared detector (`maplestreet/shared/WindowDetect.ts`, the same one the vehicle editor uses): a window when the texture under it is glass-coloured (`glassTexel`: dark and grey, or a grey-blue sky reflection), it sits between 55 % and 95 % of the body's height, faces sideways rather than up or down, and on the sides faces outward; lone hits are dropped, patches smaller than 0.06 m² (dark trim, shadows) are dropped and holes smaller than 0.25 m² inside a pane (reflections painted into the glass) are filled, so panes come out whole. When the administrator traced the windows (Developer panel → Trace windows), the vehicle's saved `glass` list is used instead of the detector. The window triangles move to the end of the index buffer (once per geometry; `rememberTriangles` keeps the file's triangle order first, which is what traced glass refers to) and draw as a second submesh in clear glass, and a clone of the body draws only its back faces in a dark upholstery colour: the cab's interior seen through the glass. Why windows could look like broken triangles: the detector only sees colour, and a scan's triangles are large and cross the painted window edge, so reflections left holes in a windshield and dark trim, grille or shadow made specks of see-through glass on the body; the hole filling and speck dropping fix most of it, and Trace windows fixes the rest by hand. Built-in low-poly bodies (golf cart, ATV, mowers, trailer) have modelled glass materials and are not traced; the sedan, coupe, truck and HD truck draw with bundled scans, so tracing them saves on that bundled vehicle.

`fp/physics/VehicleModels.ts`: paint finishes keep little metal (`FINISH`: 0.02 gloss, 0.16 metallic, 0 matte) under a soft clear coat (intensity 0.6, roughness 0.22, specular anti-aliasing on; `PAINT_FINISH` in `CarPaint.ts` likewise): a near-mirror coat over the grain bump made single bright pixels blink on cars as they or the camera moved, and authored body panels keep at most `BODY_METAL_CAP` (0.25) metal. Every window (blended glass materials, and opaque materials named glass, window or windshield, but not glowing lamp lenses) is replaced by clear glass (`clearGlass`: nearly colourless, alpha 0.14, sky reflections kept over the alpha).

### Shops, fuel and work (`places/`)

Every Fox Plains and Fox Outfitters feature is a counter at a real Montello place (`places/Places.ts`, `PLACES`): walk up and
press E for its window (`places/PlacePanel.ts`). They come from OpenStreetMap (`maplestreet/shared/MontelloPlaces.ts`,
generated by `scripts/montello-places.mjs`; coordinates in `docs/tello/MONTELLO-PLACES.md`). Plain lettering only; no logos.
The shared world checks you are at the door for every purchase and service.

- **Gas stations**: Kwik Trip, BP and Mobil (the three real stations; Gas & Go is gone) sell snacks and have pumps; True Value's
  shopping centre shares BP's door and is not a second counter.
- **Groceries**: Freitag's Food Center sells a week of meals for the fridge and a deli sandwich; its two lots are the parking
  lot and the service yard the freight depot uses behind it.
- **Bars and food**: Rivers Edge Saloon & Eatery, Tambears, Weezie's Town Pump, Yahooz Sports Bar & Grill and Drew's Lakeside Bar &
  Grill pour a draft, a brandy old fashioned, curds and the Friday fish fry; Cafe Hilltop, Oyster Crackers, the candy store and
  Dollar General feed you.
- **Dealership** (H A Freitag & Son, Main Street, `places/Dealer.ts`): Maple Motors' vehicles with the paint picker (the choice goes
  with `buy` as `car`) and the UTV, quad and fishing boat (`Account.rides`).
- **Maple Threads** (building on East Montello Street): clothes (`SHOP_ITEMS.clothing`) and a fitting room that opens Rack & Reel's
  wardrobe; clothes only change here, as in Fox Plains (`RoomLogic` `look`).
- **Montello Body & Wheel** (a shop on Main Street, `places/BodyShop.ts`): repairs, paint, tint, rims, lift and performance parts for
  a car parked in the lot out front (`RoomLogic.handleService` in Fox Lake: you at the door, the car within `BODY_SHOP_REACH` + 12 m;
  Fox Plains' bays are not used).
- **Bank**: National Exchange Bank & Trust lends and takes repayments.
- **Fox Outfitters**: the counter is Rendezvous Paddle & Sports on Main Street (gear rack, wardrobe, order desk through
  `FoxLakeTown.gear`; `setGearRackHere` lets 1 and 2 take the rod and rifle while you stand at it).
- **Sheriff and fire**: the Marquette County Sheriff Department on West Park Street is the police station (a window, no work); the
  Montello Fire Department on Underwood Avenue takes volunteers. Fox Plains' town hall, library, hotel and cinema had no function.
- **Map**: `places/MapPlaces.ts` adds the counters that have no mapped business (Maple Threads, the body shop, the freight depot,
  Fox Outfitters, the casino) to the map's places, so the Ctrl map lists them and gives directions.
- **Fuel** (`places/Fuel.ts`): your vehicles burn fuel as in classic Fox Plains (`FUEL_SCALE`), the page reports it
  every 5 s and the authority only lets it go down. Stand at a pump (Kwik Trip, Mobil, BP) with your car beside
  it and press E to fill up. Run dry and press E beside the car: a tow drops it at the nearest pump.
- **Work** (`places/Jobs.ts`): the freight depot behind Freitag's on the south side of town (deliveries to any of
  Montello's houses, in the pickup) and the Montello Fire Department (fire calls: gear up, drive to the house on fire,
  get out and hold E on the hose until it is out, about 12 s). The job shows on a HUD chip and a beacon, with directions
  on the map. Fires burn the nearest real
  house's roof (`places/FireFx.ts`); only the firefighter sees them for now.

## People: tailored clothes, hairstyles and feet

Life Sim starts Rack & Reel with `tailored: true`, so every person (you, neighbors, party members) is the scanned hunter
refitted and dressed by `rackreel/game/Tailor.ts`:

- **The body.** The scan was modelled in a padded jacket, so every shirt sat on thick, wrinkled sleeves. At load the
  upper and lower garments are welded by position (face, hands and feet held still), their wrinkles relaxed with Taubin
  smoothing (it keeps the volume), the sleeves slimmed toward the arm bones (`ARM_SLIM`), the trunk taken in a little
  (`TRUNK_SLIM`), and the jacket's standing collar drawn in to the neck and painted as skin above a crew neckline.
- **The clothes.** Every garment is a shade function of a point on the body (`rackreel/game/Garments.ts`: sleeve length,
  armholes, necklines, collars, plackets, pockets, plaid, camo, denim, knit, mesh, shoes and socks), painted into the
  body's texture atlas a few milliseconds at a time. Patterns come from the 3D position, so nothing smears across the
  atlas's seams (the Meshy retextures smeared, which made outfits look glitchy). Top and trousers meet at one straight
  waist line. The scanned hands and boots are copied from the scan's own texture. The player's clothes are painted at
  2048 px (sharp up to a 1440-line frame), other people's at 1024 (High) or 512 (Standard); textures are shared per
  garment and freed when the last wearer takes it off. Materials are matte (no specular, no metal) and people receive
  no shadows.
- **New clothes** (Life Sim only, `tailored` items in `rackreel/shared/Economy.ts`, hidden from standalone Rack & Reel):
  red, white and blue basketball jerseys with numbers front and back, matching basketball shorts with high-tops and
  crew socks, gym shorts, jean shorts, a baseball tee and an olive long-sleeve. They are in the character creator, the
  catalog and the wardrobe.
- **Hairstyles** (`HAIRSTYLES` in `rackreel/shared/Appearance.ts`, `rackreel/game/Hair.ts`): Natural (the scan's own
  painted hair), short crop, quiff, spiky, curly top, afro, mohawk, man bun, ponytail and shoulder length, in the picked
  hair colour. The shell grows over the scalp marked by the heads' hair mask, follows the face sliders and is hidden
  under a hat (a ponytail stays out the back). `APPEARANCE_VERSION` 3 offers everyone one free makeover to pick one.
  Neighbors take a hairstyle from their name and wear one painted head whole (one shared head texture per head).
- **The throat.** Every head texture is cleaned once at load (`cleanThroat`): the scan's painted jacket collar under
  the beard becomes skin.
- **Feet.** The clips' hips sit a few centimetres lower than the model's, which sank the soles into the ground.
  `Avatar.plantFeet` lifts the hips each frame so the lower sole (toe or heel) meets the ground; for the player it
  samples the ground under each foot, so the uphill foot no longer sinks on a slope.

## Detail levels (`core/Detail.ts`)

Everyone loads on **Standard**: the frame is drawn at up to 1080 lines (High: 1440), town cells and woods are switched
off past 700 m (High: 860 m), grass reaches 70 % as far, trees swap to their low models at 80 m and are gone at 520 m
(High: 115 m and 640 m), there is no bloom and other people's clothes are painted at half size. The Esc menu's
**High detail** switch changes it at once and the choice is kept on the device (`tl-lifesim-detail`; `?detail=high`
or `?detail=standard` for one visit). The player's own character looks the same at both levels.

## Memory

Checked with a read-through of the play-time paths and `scripts/foxlake-perf.mjs`; fixed in this pass:

- Neighbors each made their own mixed 1024 px head texture (about 10 MB of GPU and canvas each); they now wear one
  painted head whole, one shared texture per head.
- Each neighbor wearing a hat copied the 10,783-vertex face to tuck its hair in; unshaped faces now share one tucked
  face per hat.
- Tree stands Montello plants after loading (one per 384 m of woods explored) were never culled, so the draw list
  grew with exploration; they now join `RegionCuller` as they are planted (`Foliage.onStand`).
- Real players were never despawned by distance; they now go past 140 m like simulated walkers (name tags too).
- `RegionCuller` rebuilt its list of ungrouped meshes (filtering ~9,500 meshes) whenever any mesh was added or removed;
  it now keeps that list one mesh at a time.
- Montello's forest streaming ran its stand search (allocating and sorting) for every car on every physics step; it
  now runs only when a car enters a new tree cell.
- The corner map built its marker list every frame for a 10 Hz draw and read its size from the layout every draw;
  both now happen only on drawing frames, and the size only after a resize.
- A despawned helicopter kept its rotors' node graph referenced.

## Foxtails Lounge & Casino (`casino/`)

A walk-in casino inside Foxtails Gentlemen's Club, east of Montello on State Highway 23. The layout in `CasinoLayout.ts` stays in the
casino's own 32 by 24 m frame; `SITE` (`MONTELLO_CASINO`, found by `scripts/montello-places.mjs`) says where it stands in the town frame
(the nearest floor to the mapped club that clears every other building and street, turned so the doorway faces the highway), and
`localToTown`, `townToLocal` and `siteYaw` carry points across; `CasinoHost` builds under a rotated frame node and moves the colliders
(`PlacedColliders`). The club's own scanned building (a 184 m2 footprint, too small for the floor) is taken down (`lotHouses` +
`Montello.clearHouse`), Tello draws only the club's pole sign (`REPLACED_BUILDINGS`) and `FoxLakeTown.mountCasino` mounts it. Its
neon signs read FOXTAILS CASINO and FOXTAILS BAR. Not placed by eye: the floor is built on the lot at the mean ground height and trees
baked there are not cleared.

- **Building** (`CasinoBuilding.ts`, `CabinetModel.ts`): brick shell with the doorway and canopy, carpet, a coffered ceiling with light panels, the bar (counter, brass rail, back bar with lit bottle shelves, pendant lamps, eight stools), the blackjack table and ten upright video-slot cabinets (plinth, lower door, bill acceptor, ticket printer, card reader, lit button deck, chrome-trimmed screen bezel with speaker grilles, topper, candle light, LED edges) with slot chairs. It is built with the town's builders and colliders, so it is culled, shadowed and solid like the rest of town.
- **Displays** (`screen/MachineDisplay.ts`): each cabinet's portrait screen and topper are self-lit textures in scene space: an attract page when idle; while playing, the header (title, meters), the reel window and CREDIT / BET / WIN; jackpot plaques on the topper at the current bet.
- **Math layer** (`math/`, no Babylon or DOM): `rng.ts` (crypto on the server, seeded for tests), `reels.ts` (strips, stops, 1,024/243-ways wins with multiplying wilds), `lines.ts` (25/20 lines), `machines.ts` (the ten machines; a spin resolves completely into a timeline the screen replays), `blackjack.ts` (six decks, S17, 3:2, double, one split). `node scripts/casino-sim.mjs [spins]` prints each machine's return, base share, feature frequency and average feature win; `scale` in each definition sets the return (about 94%).
- **The ten machines**, five game styles in two original themes each (rules researched from the real cabinets; names, symbols and art are this game's own): link Hold & Spin (Northern Lights Link, Gold Pan Link), house-building free games with a storm blowdown (Lodge Builders, Hay Day Barns), gold-head 1,024-ways free games (Moose Gold, Mustang Gold), the same with the Revolution wheel (Moose Gold Revolution, Mustang Gold Revolution), and gem collectors with Cash Collect, free games and a jackpot pick (Bigfoot Bucks, Lake Monster Loot).
- **Animation layer** (`screen/ReelSet.ts`, `screen/SlotSession.ts`): reels are strip textures moved by an `AnimationGroup` (wind-up, motion-blurred spin, staggered stops with overshoot, anticipation on reels that could complete a feature); wins pulse framed cells; features play on an overlay and on extra planes (the Revolution wheel is a disc rotated by an animation). `SlotSession.demo(kind)` plays a fun-money outcome with a given feature (debug and screenshots).
- **Money** (`CasinoClient.ts`, `src/server/routes/casino.ts`): everyone plays with their own Fox Lake money (signed in: the account's; guests: their town cash). Spins, hands and beers are decided and paid on the server (`/api/casino`: stake taken first, winnings after; blackjack tables and collector meters in D1). Solo town play runs the same rules in the page.
- **Limits** (`CasinoLayout.ts`): slots $0.40 to $5 a spin; blackjack $5 to $200 opening bets; a beer is $5.
- **Tables** (`TableSessions.ts`): blackjack and the bar as overlays while the camera looks at the table or the bartender; a beer ($5) appears on the counter.
- **Seating** uses Rack & Reel's host hooks: `setPerch` (sit, no walking), `setCameraShot` (fixed camera), and `data-host-modal` overlays (Rack & Reel's input pauses while one is open). At a machine the view is first person.

## Tyre marks and two-tracks

`rackreel/world/GroundWear.ts` (works only on the lake country's own square, which is sealed off in Fox Lake, so Montello's ground gets no tyre marks): every wheel of every land vehicle presses the 33 cm cell under it on the lake country's ground, a 3072 x 3072 byte map uploaded in small rectangles. The terrain (`WearPlugin`) darkens and flattens pressed grass and turns it to bare dirt where wear is high, and the grass and weeds (`wear` foliage look) flatten and yellow over the same cells. One pass leaves two pressed tracks; dirt starts after about 17 passes over a line and the ruts are bare after about 40. Wear lasts for the session.

## Developer panel (`dev/`)

F8 opens it for a site administrator (the Esc menu lists the key for them; the Developer Panel button above the Fox Lake frame on the site (administrators only) toggles it with a same-origin `tl-dev-panel` message, and `?panel=1` opens it once you head out). For everyone else F8 does nothing. The shared world decides who that is: the Worker reads the session (`src/server/routes/maplestreet.ts`, `isAdmin`), the Durable Object carries it on the socket's identity, the world tells the page with `welcome.dev`, and it checks every `dev` message against the same flag (`maplestreet/shared/DevTools.ts`), so a hand-made message from anyone else is refused. Only Fox Lake's world turns the tools on (`FoxLakeWorld`, `WorldServer`'s `devTools`); classic Fox Plains ignores the messages.

- **Spawn a vehicle** (`FoxLakeDev.spawn`, `Placement.ts`): every registered vehicle that drives (built-in, bundled, published and retired; trailers are left out), a few metres in front of you or beside a chosen player. The page picks a clear, dry spot and lays the vehicle on the slope; the world accepts it within 30 m of that player, twelve at a time.
- **Spawned vehicles belong to nobody** and are in nobody's garage. The world keeps each one in its snapshots like any other vehicle (`owner` is the driver's session, or `shared` while parked), so `town/Neighbors.ts` draws it. E beside a parked one asks the world for it (`shared` `claim`); the world gives it to the first to ask within reach, one driver per vehicle and one spawned vehicle per driver. That player's page swaps the snapshot car for a real Fox Plains Rapier car driven through Rack & Reel's vehicle controller (`SharedCars.ts`) and reports its pose with each state message (`state.s`). Getting out lets it roll to a stop and hands it back (`release`); it stays parked there for everyone. A driver who disconnects leaves it parked where it was.
- **Five minutes**: the world removes a spawned vehicle five minutes after it was spawned, for everyone at once. One that is being driven then stays until its driver gets out. The panel lists the live ones with their time left and a Remove now button.
- **Teleport**: `Places.ts` is the list (`{ id, label, area, x, z }` in scene coordinates): Montello's places from the baked map (`montelloPlaces`) and the lake's (`lakePlaces`: the dock, the UTV, the boat and the stands), plus Home and every player in the world. It puts you on foot at the nearest safe ground the way H does; a vehicle you were in stays where it was.
- **Give cash**: a whole amount up to $1,000,000 to yourself or a player in the world, through `RoomLogic.adjustMoney`, so it is the same balance the lake country and the casino use; the world saves it at once and the recipient's wallet chip updates over the socket. A guest's town cash (kept under their browser's guest key) is changed the same way and the panel says so; their lake cash lives in their own tab and cannot be changed from here.
- **Trace windows** (`WindowTrace.ts`): fixes where the glass is on a scanned vehicle (published, bundled, or a built-in's bundled stand-in): the one you are in, or the nearest one within 25 m. The panel closes and the camera turns around the vehicle (right-drag or arrow keys, wheel or + and − to zoom). Drag a loop with the left mouse button over a window: the body triangles inside it that face the camera become glass (A, Adds glass) or stop being glass (R, Removes glass); "Also pick faces turned away" ignores the facing. Undo (Ctrl+Z), Tidy up (drops specks, fills small holes), Clear all glass and Start from automatic help; the glass is highlighted in blue and shown on every copy of the vehicle at once. Save for everyone sends `PATCH /api/maplestreet-vehicles` `{id, glass}` (administrator session, same origin; a bundled vehicle gets its override row first) and the list is stored in the vehicle's spec in D1 `maplestreet_assets` (`maplestreet/shared/VehicleGlass.ts`: per body mesh its place in the model, triangle and vertex counts, and the glass triangles as runs). Every page applies it from the vehicle record the next time it loads the vehicle. Remove saved tracing (`glass: null`) goes back to the automatic windows. Saving a new model in the vehicle editor drops the tracing, because it numbers the old model's triangles; a list whose counts don't match the model is ignored. Cancel or Esc puts back what was shown before.
- **Vehicle tuning** (`vehicles/Tuning.ts`, `TuningClient.ts`): pick any vehicle (or the one you are in) and change its top speed, engine power, grip, side grip, steering lock and brakes, or a helicopter's top speed, climb rate, turn rate and agility. Each change is applied at once to `TUNING` in place (cars on the road drive with it; `Vehicle.retune` sets grip per wheel), with the default shown under each field and Reset this vehicle to go back. Save for everyone posts the whole document to `/api/lifesim-tuning` (`src/server/routes/lifesim-tuning.ts`: public GET, administrator same-origin POST checked with Zod, D1 `library_settings` key `lifesim-vehicle-tuning`); every page loads it while the map loads (kept on the device as `foxlake/vehicle-tuning/v1`) and applies it before any vehicle is made. Fox Plains never reads it.
- **Solo** (`?solo=1`): the same rules run in the page, so the panel is open to whoever plays ("Solo: changes stay on this device"). Solo money is unlimited, so there is nothing to give.

Spawned vehicles carry no paint, damage, fuel or hitch, and a spawned mower does not cut grass or earn mowing pay.

## Gear and bounties

Fox Lake starts Rack & Reel with `gearAtCabin`: the rod and rifle are on a gear rack in town (the outfitter's counter, where the places work hooks `FoxLakeTown.gear`); 1 or 2 at the rack takes one (swapping the other back); away from the rack you carry only that one. Bounties are flat everywhere: $10 a carp, $50 a deer, $100 a bear (`shared/Economy.ts`).

## Controls

Rack & Reel's, plus Space to jump on foot (`GameOptions.jump`: about 0.6 m, not while crouched, aiming or fishing), E at your car (drive), Space and Shift to climb and descend in the helicopter, at shops, bars and the bank (Maple Threads opens the wardrobe), at a pump (fill up), at a fire (hold to spray), at the dealership (the UTV, the quad and the boat), V to bring out another of your vehicles, H to go home (every 15 minutes) or back to Main Street, Ctrl for the full map and directions, N to zoom the corner map. The Esc menu lists every control (`BASE_CONTROLS` in `rackreel/ui/Controls.ts`, then `FoxLakeTown.controls`).

## Debugging

`window.__foxlake.town.debug()` (connection, neighbors, colliders, cars, culling, Montello's build), `window.__foxlake.town.dev.debug()` (panel access, spawned vehicles, the one being driven), `window.__foxlake.game.host()`. `?solo=1` plays on this device (its own save, `foxlake/solo/v1`); `?hour=21` pins the sky; `?edits=none` shows Montello as baked and `?at=x,z` starts at a map point (see World edits). `node scripts/foxlake-capture.mjs` (screenshots at fixed spots) still lists the old Fox Plains spots and needs new ones.

## Assets

- Everyday outfits are Meshy retextures of the hunter (`assets-src/rackreel/meshy/hunter-everyday.meshy.json`), ingested with `modules-src/rackreel/tools/ingest-hunter.py` (`HUNTER_ONLY` limits it to named outfits) and mapped in `tools/builders_meshy_hunter.py`.
- The golf cart, ATV, zero-turn, riding mower and trailer are Meshy models (`assets-src/models/foxlake/vehicles.meshy.json`) turned, scaled and set on the built-in's wheels by `tools/build-vehicles.py` (Blender) into `assets-src/models/maplestreet/vehicles/`, then `pnpm assets`. `tools/build-vehicles.py` welds Meshy's triangle soup and smooths the shading (`scripts/blender/smooth_normals.py`: weld, smooth, creases over 40° sharp, weighted normals) and splits each wheel into a `wheel-<n>` node centred on its own axle (`scripts/blender/vehicle-fix.py` does the same to an existing body). `fp/physics/VehicleModels.ts` hangs each split wheel on the nearest steer/spin pivot moved to that centre (`hangSplitWheels`, `WheelView.lift`), so wheels spin and steer on their true axle where the model drew them. Vehicle models skip the glTF loader's handedness flip (`authoredFrame`: `__root__` turned 180° and mirrored is x → −x, which drew every body back to front inside the town's mirrored root); they now face the way the vehicle editor and Fox Plains show them. Lamp lenses draw with a polygon offset (`zOffset`) so the body never pokes through them, and glass has a depth pre-pass so its faces stop flickering against each other.
