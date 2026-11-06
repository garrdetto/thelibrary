# Model sources (.glb)

These are the pipeline's inputs. `pnpm assets` (`scripts/assets.mjs`) turns everything under `models/` into the optimized `public/models/` that the modules load; edit or replace files here, never in `public/models/`, then commit the regenerated outputs together with the change. The Sandlot Sluggers 3D player files become one `public/models/sandlot3d/players.glb` with a scene per player.

glTF binary exports of the 3D models drawn by the learning modules in `public/modules/`. Each file was produced by running the module's own model-building code in a headless browser (same three.js version the module loads) and saving it with three.js `GLTFExporter`. Units are the module's world units; +Y is up.

Modules without 3D models (chess, checkers, 2048, Chopper Cave, the 2D Sandlot Sluggers) have no folder.

## shorttrack/ — Short Track Showdown (`shorttrack.html`, three.js r160)
- `truck_default.glb`, `truck_pace.glb`, `truck_livery_1..3.glb`: the race truck with liveries, door/roof/tailgate numbers and wheels, at the in-race scale.
- `truck_unpainted.glb`: the bare truck model (`TM.buildTruck`) without liveries.
- `track_<bullring|dells|dirt>.glb`: each track's surface, walls, grandstands, pits, lights and ground.
- `crowd_<track>.glb`, `trees_<track>.glb`: the instanced crowd and tree line (`EXT_mesh_gpu_instancing`).
- `car_slm_lod<0|1|2>.glb`: the stock Super Late Model from `public/modules/shorttrack-car.bin` at 35k / 18k / 4k triangles, made by `scripts/blender/shorttrack/stock_car.py`: `Body` with the classic material slots and livery atlas UVs, `Wheel_<FL|FR|RL|RR>` hub pivots with `Tire_<..>`, and the livery regions as extras on `StockCar`.
- `wheel_race_lod<0|1|2>.glb`: a detailed 15 in steel race wheel with beadlock ring and slick tyre at the stock size (6k / 2k / 400 triangles), made by `scripts/blender/shorttrack/wheel.py`; hub at the origin, axle on Z, outer face +Z.

## botwreck/ — BotWreck 3D (`botwreck.html`, three.js r160)
- `bot_<speedster|tank|rocket>.glb`: each vehicle with chassis, wheels and bolt-on parts assembled, nose facing +Z.
- `arena.glb`, `crates.glb`, `crate_single.glb`.

## sandlot3d/ — Sandlot Sluggers 3D (`sandlot3d.html`, three.js r128)
- `player_00_home.glb` … `player_33_home.glb`: every roster player in the home uniform and cap, idle pose.
- `player_00_away.glb`, `batter_home.glb`, `batter_away.glb` (helmet, stance, bat), `catcher_home.glb`.
- `ballpark_<sandlot|park|dome|stadium>.glb`: each park (field, walls, stands, instanced crowd).
- Colors were converted from the module's linear-output color workflow to glTF's linear factors so they match the module on screen.

## maplestreet/ — Fox Plains (`modules-src/maplestreet`, three.js r172)
- `furniture/<catalog id>.glb`: every buy-mode catalog item (`buildFurniture`).
- `vehicles/<kind>.glb`: every vehicle preset with wheels; nose faces +X as in the module.
- `characters/resident.glb`: the player avatar.
- `houses/house_<lot>.glb`: the seeded neighbor houses, centered on their lot.
- `town/downtown.glb`, `town/neighborhood.glb` (ground, roads, lots, trees, lamps).

Not included: shader-only effects (skies, instanced lawn grass, post-processing, particles, sprites, name tags).
