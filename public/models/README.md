# Module models (.glb)

glTF binary exports of the 3D models drawn by the learning modules in `public/modules/`. Each file was produced by running the module's own model-building code in a headless browser (same three.js version the module loads) and saving it with three.js `GLTFExporter`. Units are the module's world units; +Y is up.

Modules without 3D models (chess, checkers, 2048, Chopper Cave, the 2D Sandlot Sluggers) have no folder.

## shorttrack/ — Short Track Showdown (`shorttrack.html`, three.js r160)
- `truck_default.glb`, `truck_pace.glb`, `truck_livery_1..3.glb`: the race truck with liveries, door/roof/tailgate numbers and wheels, at the in-race scale.
- `truck_unpainted.glb`: the bare truck model (`TM.buildTruck`) without liveries.
- `track_<bullring|dells|dirt>.glb`: each track's surface, walls, grandstands, pits, lights and ground.
- `crowd_<track>.glb`, `trees_<track>.glb`: the instanced crowd and tree line (`EXT_mesh_gpu_instancing`).

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
