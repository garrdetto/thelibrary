# Fox Lake (source)

Source for `public/modules/foxlake.html`, module id `foxlake`. Fox Lake is one world made of two places: a Fox Plains town (lots, houses, cars and neighbors, built by the same rules as classic Fox Plains) and Rack & Reel's Bear Paw Lake country south of it, joined by a county road. It replaced Fox Plains 2 (`#module-foxplains2` redirects here). Every player starts fresh in Fox Lake: it has its own shared world, its own money and its own Rack & Reel profile, and classic Fox Plains and standalone Rack & Reel keep theirs.

Design and decisions: `docs/superpowers/specs/2026-11-11-fox-lake-design.md`. Performance and leak results: `docs/foxlake/PERF.md`.

## How it is put together

Fox Lake **is** Rack & Reel's game (`modules-src/rackreel/game/Game.ts`) with a host-world extension. Everything the lake country does in Rack & Reel works here unchanged, because it is the same code: the renderer and its tone mapping, cached sun and moon shadows, sky and fog, terrain, water, foliage and grass, the skinned hunter and the character creator, fishing, hunting, the boat, UTV and quad, Wild Man's carp bowfishing, wildlife, the record books and the hunting party.

`index.ts` starts `new Game(canvas, { terrain, extension, bowfishAnyHour: true, gearAtCabin: true, profile: 'foxlake', outfitters: true })`:

- `terrain`: `new Terrain(FOX_LAKE_SHAPE)` (`region.ts`). The lake country's north edge has no rim of hills; it blends down to the town's ground (`TOWN_Y`), and land beyond the square is the town's (`TOWN_LAND`). Standalone Rack & Reel uses `STANDALONE_SHAPE` (every edge rimmed), so its heights are unchanged.
- `extension`: `FoxLakeTown` (`town/FoxLakeTown.ts`), Rack & Reel's `GameExtension` hook (build, ready, update, collide, obstacle, interact, prompt, spawn, place name; the shared world drives the clock).
- `bowfishAnyHour`: Wild Man takes you carp bowfishing at any hour. Fox Lake shares one clock with everyone, so nobody can skip to dark.
- `profile: 'foxlake'`: Rack & Reel's progress (character, gear, cash) is a separate profile (`/api/rackreel?game=foxlake`, stored as `foxlake:<user id>`), so Fox Lake starts fresh and standalone Rack & Reel is untouched.
- `outfitters`: Fox Outfitters (`world/Cabin.ts` `FOX_OUTFITTERS`, model `outfitters`) replaces the cabin: a bigger log store with shelving, the gear rack, wardrobe and counter, and an open garage bay on the east side where the side-by-side is parked on a concrete floor the wheels ride on. The FOX OUTFITTERS board over the bay is `world/StoreSign.ts`.

### Coordinates (`region.ts`)

The scene uses Rack & Reel's coordinates (left-handed, +x east, +z north, the lake country is the 1024 m square around the origin). The town keeps the shared world's right-handed coordinates and hangs under one node that moves it north of the square and mirrors z, so it reads exactly as classic Fox Plains shows it:

```
scene = (town.x - 356, town.y + 2, 1152 - town.z)
```

East Ave (town x = 87) runs south out of town and becomes the county road (`CONNECTOR`, `town/TownGround.ts`), which meets the interstate where it leaves the lake country's north edge. Snapshots sent to the shared world are in town coordinates. Fox Lake's world is its own Durable Object (`FoxLakeWorld`, `/api/maplestreet?world=foxlake`, saved in the `foxlake_world` table), so its players never appear in classic Fox Plains.

### The town (`fp/`, `town/`)

- `fp/` is Fox Plains 2's Babylon code for the town (it moved here when Fox Lake replaced Fox Plains 2): `world/Town.ts` (roads, sidewalks, driveways, lawns with mowing stripes, lamps, for-sale signs), `world/Downtown.ts` (shops and signs atlas), `world/Houses.ts` (every lot's house from the shared build data), `core/` (mesh building, procedural PBR surfaces, the ground material plugin, glTF assets), `physics/` (Rapier, the Fox Plains raycast cars with the same numbers, parking, vehicle views). Its builders draw through `setRenderer` (any `GfxHost`) and hang their roots under `setHostRoot`.
- Fox Lake's own picture is `FOX_LAKE_LOOK` in `index.ts`, passed to Rack & Reel as `GameOptions.look` (`LightingLook` in `rackreel/world/Lighting.ts`): sun and moon shadows half as dark as before (darkness 0.87; Rack & Reel's is 0.62), a night 15 % brighter (exposure scales with the night amount) and matte characters (no specular, a softer fill). Standalone Rack & Reel passes none of it. `FOX_LAKE_SHADOW_MAP` (1024, `GameOptions.shadowMapSize`) halves Rack & Reel's 2048 shadow map, with the blur kernel scaled to match so shadows stay as soft; the town has far more casters than the lake country.
- `town/TownGfx.ts` is that host inside Rack & Reel's renderer: static casters (merged shadow proxies) go to Rack & Reel's cached shadow layer by 128 m cell near the player, moving ones (vehicles) to its moving layer through `host.addCaster`; only those within the shadow frame's reach of the player cast (`Game.hostCasters`), and they are marked tight (`ShadowLayers.markTight`) so a car's own shadow on its body is redrawn at the near slack at any distance instead of lagging and jumping, and the town's PBR materials light from an environment cube baked from Rack & Reel's sky.
- `town/TownGround.ts` lays the ground north of the square the way Rack & Reel lays its own (one vertex-coloured mesh over its detail texture), the county road in the interstate's asphalt, and trees on the strip east of town. The town's yard and forest-ring trees are planted as Rack & Reel foliage (`Foliage.plantTrees`) at the spots the town layout picks.
- `town/Cars.ts`: your vehicles (the starter pickup and trailer, the riding mower, V for the next one you own) are Fox Plains Rapier cars driven through Rack & Reel's `VehicleController` as external vehicles (`addExternal`), so seats, camera, enter and exit, HUD and audio are Rack & Reel's. A stand-in node in scene coordinates follows each car so the hunter sits upright in it.
- `town/Neighbors.ts`: other players and the simulated neighbors, as Rack & Reel hunters (an everyday outfit and a face picked from their name), and their vehicles, interpolated 120 ms behind.
- `town/TownHud.ts`: the wallet chip, who is around, the zone and connection, and the Fox Plains street map in the corner while you're in town.
- `core/RegionCuller.ts`: far town cells and far lake-country tree stands are switched off (beyond 640 m the fog hides them), so the town costs nothing at the lake and the woods cost nothing in town.

### Physics

The town and your cars are on Rapier (`fp/physics/Physics.ts`): the flat town ground, every building, house and tree as streamed static colliders, and the lake country as a heightfield, so a car can drive down the county road to the lake. On foot, the hunter walks Rack & Reel's way and is pushed out of the town's solids (`Physics.pushOut`); the UTV and quad bump into them (`Physics.blocked`). The boat stays on the lake.

### Money

A signed-in player has one Fox Lake balance: Fox Lake's world holds it (`RoomLogic.adjustMoney`, the Durable Object's `/wallet`), town jobs pay into it, and `/api/rackreel?game=foxlake` (bounties, the catalog) and `/api/casino` pay and charge it (`src/server/shared-wallet.ts`). The Fox Lake profile's starting cash moves in once. Classic Fox Plains and standalone Rack & Reel money are separate. Guests play the casino with their town cash (by this browser's guest key); their lake cash is kept in the tab.

Lots are bought in Fox Lake itself: walk onto a lot for sale and press E.

## Northwoods Lodge Casino & Bar (`casino/`)

A walk-in casino on the north-east corner of East Ave and South St (town coordinates in `CasinoLayout.ts`), Fox Lake only (classic Fox Plains has woods there).

- **Building** (`CasinoBuilding.ts`, `CabinetModel.ts`): brick shell with the doorway and canopy on South St, carpet, a coffered ceiling with light panels, the bar (counter, brass rail, back bar with lit bottle shelves, pendant lamps, eight stools), the blackjack table and ten upright video-slot cabinets (plinth, lower door, bill acceptor, ticket printer, card reader, lit button deck, chrome-trimmed screen bezel with speaker grilles, topper, candle light, LED edges) with slot chairs. It is built with the town's builders and colliders, so it is culled, shadowed and solid like the rest of town.
- **Displays** (`screen/MachineDisplay.ts`): each cabinet's portrait screen and topper are self-lit textures in scene space: an attract page when idle; while playing, the header (title, meters), the reel window and CREDIT / BET / WIN; jackpot plaques on the topper at the current bet.
- **Math layer** (`math/`, no Babylon or DOM): `rng.ts` (crypto on the server, seeded for tests), `reels.ts` (strips, stops, 1,024/243-ways wins with multiplying wilds), `lines.ts` (25/20 lines), `machines.ts` (the ten machines; a spin resolves completely into a timeline the screen replays), `blackjack.ts` (six decks, S17, 3:2, double, one split). `node scripts/casino-sim.mjs [spins]` prints each machine's return, base share, feature frequency and average feature win; `scale` in each definition sets the return (about 94%).
- **The ten machines**, five game styles in two original themes each (rules researched from the real cabinets; names, symbols and art are this game's own): link Hold & Spin (Northern Lights Link, Gold Pan Link), house-building free games with a storm blowdown (Lodge Builders, Hay Day Barns), gold-head 1,024-ways free games (Moose Gold, Mustang Gold), the same with the Revolution wheel (Moose Gold Revolution, Mustang Gold Revolution), and gem collectors with Cash Collect, free games and a jackpot pick (Bigfoot Bucks, Lake Monster Loot).
- **Animation layer** (`screen/ReelSet.ts`, `screen/SlotSession.ts`): reels are strip textures moved by an `AnimationGroup` (wind-up, motion-blurred spin, staggered stops with overshoot, anticipation on reels that could complete a feature); wins pulse framed cells; features play on an overlay and on extra planes (the Revolution wheel is a disc rotated by an animation). `SlotSession.demo(kind)` plays a fun-money outcome with a given feature (debug and screenshots).
- **Money** (`CasinoClient.ts`, `src/server/routes/casino.ts`): everyone plays with their own Fox Lake money (signed in: the account's; guests: their town cash). Spins, hands and beers are decided and paid on the server (`/api/casino`: stake taken first, winnings after; blackjack tables and collector meters in D1). Solo town play runs the same rules in the page.
- **Limits** (`CasinoLayout.ts`): slots $0.40 to $5 a spin; blackjack $5 to $200 opening bets; a beer is $5.
- **Tables** (`TableSessions.ts`): blackjack and the bar as overlays while the camera looks at the table or the bartender; a beer ($5) appears on the counter.
- **Seating** uses Rack & Reel's host hooks: `setPerch` (sit, no walking), `setCameraShot` (fixed camera), and `data-host-modal` overlays (Rack & Reel's input pauses while one is open). At a machine the view is first person.

## Tyre marks and two-tracks

`rackreel/world/GroundWear.ts`: every wheel of every land vehicle presses the 33 cm cell under it on the lake country's ground, a 3072 x 3072 byte map uploaded in small rectangles. The terrain (`WearPlugin`) darkens and flattens pressed grass and turns it to bare dirt where wear is high, and the grass and weeds (`wear` foliage look) flatten and yellow over the same cells. One pass leaves two pressed tracks; dirt starts after about 17 passes over a line and the ruts are bare after about 40. Wear lasts for the session.

## World map

`docs/foxlake/map/index.html` is an interactive map of the whole world, drawn from the game's layout (`tools/map-data.ts`) and its landmarks (`docs/foxlake/map/landmarks.json`). Rebuild it with `node scripts/foxlake-map.mjs`.

## Gear and bounties

Fox Lake starts Rack & Reel with `gearAtCabin`: the rod and rifle hang on the gear rack in Fox Outfitters; 1 or 2 at the rack takes one (swapping the other back); away from the rack you carry only that one. Bounties are flat everywhere: $10 a carp, $50 a deer, $100 a bear (`shared/Economy.ts`).

## Controls

Rack & Reel's, plus E at your car (drive), at shops (Maple Threads opens the wardrobe), at a slot machine, bar stool or blackjack seat, V to bring out another of your vehicles, H to go home (every 15 minutes). 1 and 2 only work at the cabin's gear rack.

## Debugging

`window.__foxlake.town.debug()` (connection, neighbors, colliders, cars, culling), `window.__foxlake.game.host()`. `?solo=1` plays the town on this device; `?hour=21` pins the sky. `node scripts/foxlake-capture.mjs [baseUrl] [outDir]` loads the built page in Chrome, takes screenshots at fixed spots with frame-time and scene counts, and walks town → lake → town five times to check that mesh, material and texture counts stay flat.

## Assets

- Everyday outfits are Meshy retextures of the hunter (`assets-src/rackreel/meshy/hunter-everyday.meshy.json`), ingested with `modules-src/rackreel/tools/ingest-hunter.py` (`HUNTER_ONLY` limits it to named outfits) and mapped in `tools/builders_meshy_hunter.py`.
- The golf cart, ATV, zero-turn, riding mower and trailer are Meshy models (`assets-src/models/foxlake/vehicles.meshy.json`) turned, scaled and set on the built-in's wheels by `tools/build-vehicles.py` (Blender) into `assets-src/models/maplestreet/vehicles/`, then `pnpm assets`. `tools/build-vehicles.py` welds Meshy's triangle soup and smooths the shading (`scripts/blender/smooth_normals.py`: weld, smooth, creases over 40° sharp, weighted normals) and splits each wheel into a `wheel-<n>` node centred on its own axle (`scripts/blender/vehicle-fix.py` does the same to an existing body). `fp/physics/VehicleModels.ts` hangs each split wheel on the nearest steer/spin pivot moved to that centre (`hangSplitWheels`, `WheelView.lift`), so wheels spin and steer on their true axle where the model drew them. Vehicle models skip the glTF loader's handedness flip (`authoredFrame`: `__root__` turned 180° and mirrored is x → −x, which drew every body back to front inside the town's mirrored root); they now face the way the vehicle editor and Fox Plains show them. Lamp lenses draw with a polygon offset (`zOffset`) so the body never pokes through them, and glass has a depth pre-pass so its faces stop flickering against each other.
