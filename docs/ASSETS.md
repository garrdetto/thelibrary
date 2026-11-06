# Model pipeline report

Output of `pnpm assets:report` after `pnpm assets --force` on the sources in `assets-src/models/`. Sizes are the .glb files; primitives approximate draw calls. Regenerate this file whenever a source changes.

| Output | Before (MB) | After (MB) | Primitives | Materials |
| --- | ---: | ---: | ---: | ---: |
| sandlot3d/players.glb | 63.79 | 6.12 | 2710 → 340 | 1013 → 89 |
| shorttrack/track_dirt.glb | 11.81 | 2.22 | 120 → 22 | 48 → 16 |
| shorttrack/track_bullring.glb | 11.57 | 2.53 | 174 → 26 | 58 → 18 |
| shorttrack/track_dells.glb | 11.52 | 2.52 | 126 → 24 | 52 → 18 |
| maplestreet/town/neighborhood.glb | 8.57 | 1.50 | 214 → 41 | 71 → 29 |
| maplestreet/houses/house_N4.glb | 5.40 | 0.63 | 66 → 15 | 55 → 15 |
| maplestreet/houses/house_N2.glb | 5.39 | 0.59 | 63 → 16 | 55 → 16 |
| maplestreet/houses/house_N8.glb | 5.32 | 0.61 | 60 → 14 | 49 → 14 |
| maplestreet/houses/house_S5.glb | 5.28 | 0.56 | 57 → 13 | 49 → 13 |
| maplestreet/houses/house_S2.glb | 4.92 | 0.55 | 58 → 14 | 52 → 14 |
| maplestreet/houses/house_S7.glb | 4.83 | 0.54 | 58 → 14 | 52 → 14 |
| maplestreet/town/downtown.glb | 4.43 | 0.83 | 93 → 46 | 86 → 46 |
| sandlot3d/ballpark_dome.glb | 4.03 | 1.63 | 92 → 19 | 52 → 15 |
| sandlot3d/ballpark_stadium.glb | 3.29 | 1.22 | 64 → 19 | 43 → 14 |
| shorttrack/truck_livery_1.glb | 2.98 | 0.62 | 187 → 36 | 25 → 16 |
| shorttrack/truck_livery_3.glb | 2.77 | 0.55 | 187 → 36 | 25 → 16 |
| shorttrack/truck_livery_2.glb | 2.77 | 0.55 | 187 → 36 | 25 → 16 |
| shorttrack/truck_default.glb | 2.23 | 0.50 | 187 → 36 | 25 → 16 |
| shorttrack/truck_pace.glb | 2.20 | 0.49 | 183 → 32 | 24 → 15 |
| sandlot3d/ballpark_sandlot.glb | 2.10 | 0.38 | 188 → 28 | 114 → 13 |
| sandlot3d/ballpark_park.glb | 1.90 | 0.36 | 74 → 19 | 51 → 12 |
| shorttrack/truck_unpainted.glb | 1.84 | 0.41 | 180 → 27 | 20 → 12 |
| shorttrack/car_slm_lod0.glb | 1.24 | 0.35 | 12 → 8 | 6 → 4 |
| shorttrack/crowd_bullring.glb | 1.07 | 1.06 | 4 → 4 | 4 → 1 |
| shorttrack/crowd_dells.glb | 1.07 | 1.06 | 4 → 4 | 4 → 1 |
| shorttrack/crowd_dirt.glb | 1.07 | 1.06 | 4 → 4 | 4 → 1 |
<<<<<<< HEAD
<<<<<<< HEAD
| shorttrack/car_slm_lod1.glb | 0.68 | 0.21 | 12 → 8 | 6 → 4 |
=======
=======
| sandlot3d/field_detail.glb | 2.74 | 0.81 | 2 → 2 | 2 → 2 |
>>>>>>> 3031467 (Sandlot Sluggers 3D: WebGPU renderer, HDR grade and PBR turf)
| sandlot3d/athlete.glb | 0.92 | 0.23 | 12 → 12 | 12 → 12 |
>>>>>>> ac9415b (Sandlot Sluggers 3D: skinned Blender athlete body)
| maplestreet/vehicles/sedan.glb | 0.50 | 0.09 | 19 → 9 | 9 → 5 |
| maplestreet/vehicles/coupe.glb | 0.49 | 0.09 | 19 → 9 | 9 → 5 |
| maplestreet/vehicles/hdtruck.glb | 0.43 | 0.07 | 21 → 10 | 10 → 6 |
| maplestreet/vehicles/truck.glb | 0.40 | 0.07 | 20 → 9 | 9 → 5 |
| shorttrack/wheel_race_lod0.glb | 0.25 | 0.09 | 4 → 4 | 4 → 4 |
| shorttrack/car_slm_lod2.glb | 0.19 | 0.07 | 12 → 8 | 6 → 4 |
| maplestreet/vehicles/zeroturn.glb | 0.18 | 0.02 | 18 → 7 | 8 → 3 |
| maplestreet/furniture/flowerBed.glb | 0.18 | 0.03 | 38 → 6 | 7 → 3 |
| maplestreet/vehicles/golfcart.glb | 0.17 | 0.02 | 20 → 8 | 10 → 4 |
| maplestreet/vehicles/atv.glb | 0.15 | 0.02 | 19 → 8 | 8 → 4 |
| maplestreet/vehicles/mower.glb | 0.14 | 0.02 | 18 → 7 | 8 → 3 |
| maplestreet/characters/resident.glb | 0.10 | 0.03 | 12 → 5 | 5 → 1 |
| shorttrack/wheel_race_lod1.glb | 0.10 | 0.04 | 4 → 4 | 4 → 4 |
| botwreck/crates.glb | 0.09 | 0.01 | 49 → 2 | 2 → 2 |
| maplestreet/furniture/plant.glb | 0.09 | 0.01 | 11 → 3 | 3 → 3 |
| maplestreet/vehicles/trailer.glb | 0.08 | 0.01 | 10 → 5 | 7 → 3 |
| maplestreet/furniture/bookshelf.glb | 0.08 | 0.01 | 44 → 2 | 6 → 1 |
| maplestreet/furniture/diningSet.glb | 0.08 | 0.01 | 30 → 8 | 3 → 3 |
| botwreck/arena.glb | 0.08 | 0.03 | 11 → 6 | 7 → 6 |
| maplestreet/furniture/tree.glb | 0.07 | 0.01 | 9 → 2 | 2 → 2 |
| botwreck/bot_rocket.glb | 0.07 | 0.02 | 26 → 11 | 23 → 4 |
| maplestreet/furniture/stairs.glb | 0.06 | 0.01 | 33 → 5 | 3 → 3 |
| maplestreet/furniture/trampoline.glb | 0.05 | 0.01 | 8 → 3 | 3 → 3 |
| maplestreet/furniture/shrub.glb | 0.05 | 0.01 | 6 → 1 | 1 → 1 |
| maplestreet/furniture/piano.glb | 0.05 | 0.01 | 28 → 3 | 2 → 2 |
| shorttrack/trees_bullring.glb | 0.05 | 0.05 | 2 → 2 | 2 → 2 |
| shorttrack/trees_dells.glb | 0.05 | 0.05 | 2 → 2 | 2 → 2 |
| shorttrack/trees_dirt.glb | 0.05 | 0.05 | 2 → 2 | 2 → 2 |
| maplestreet/furniture/court.glb | 0.05 | 0.01 | 16 → 3 | 9 → 2 |
| maplestreet/furniture/chandelier.glb | 0.05 | 0.01 | 14 → 3 | 3 → 3 |
| botwreck/bot_speedster.glb | 0.05 | 0.02 | 27 → 11 | 24 → 3 |
| botwreck/bot_tank.glb | 0.05 | 0.02 | 27 → 11 | 24 → 3 |
| maplestreet/furniture/computer.glb | 0.03 | 0.01 | 13 → 3 | 6 → 2 |
| maplestreet/furniture/swingSet.glb | 0.03 | 0.01 | 11 → 3 | 3 → 3 |
| maplestreet/furniture/hoop.glb | 0.03 | 0.01 | 6 → 2 | 6 → 2 |
| maplestreet/furniture/nightstand.glb | 0.03 | 0.01 | 9 → 4 | 4 → 4 |
| maplestreet/furniture/stove.glb | 0.03 | 0.01 | 8 → 2 | 2 → 2 |
| maplestreet/furniture/desk.glb | 0.03 | 0.01 | 9 → 2 | 5 → 1 |
| maplestreet/furniture/patioSet.glb | 0.03 | 0.01 | 8 → 2 | 2 → 2 |
| maplestreet/furniture/bunkBed.glb | 0.03 | 0.01 | 14 → 3 | 3 → 3 |
| maplestreet/furniture/dresser.glb | 0.02 | 0.01 | 11 → 3 | 3 → 3 |
| maplestreet/furniture/endTable.glb | 0.02 | 0.01 | 7 → 4 | 4 → 4 |
| maplestreet/furniture/tallPlant.glb | 0.02 | 0.01 | 10 → 2 | 2 → 2 |
| maplestreet/furniture/coffeeTable.glb | 0.02 | 0.01 | 7 → 3 | 3 → 3 |
| shorttrack/wheel_race_lod2.glb | 0.02 | 0.01 | 4 → 4 | 4 → 4 |
| maplestreet/furniture/bed.glb | 0.02 | 0.01 | 10 → 4 | 4 → 4 |
| maplestreet/furniture/armchair.glb | 0.02 | 0.01 | 10 → 2 | 2 → 2 |
| maplestreet/furniture/twinBed.glb | 0.02 | 0.01 | 9 → 4 | 4 → 4 |
| maplestreet/furniture/sideboard.glb | 0.02 | 0.01 | 8 → 3 | 3 → 3 |
| maplestreet/furniture/sofa.glb | 0.02 | 0.01 | 10 → 3 | 3 → 3 |
| maplestreet/furniture/lampPost.glb | 0.02 | 0.01 | 4 → 2 | 2 → 2 |
| maplestreet/furniture/island.glb | 0.02 | 0.01 | 5 → 3 | 3 → 3 |
| maplestreet/furniture/floorLamp.glb | 0.02 | 0.01 | 3 → 3 | 3 → 3 |
| maplestreet/furniture/fireplace.glb | 0.02 | 0.01 | 6 → 5 | 5 → 5 |
| maplestreet/furniture/lounger.glb | 0.02 | 0.00 | 7 → 2 | 2 → 2 |
| maplestreet/furniture/doubleVanity.glb | 0.02 | 0.01 | 6 → 4 | 4 → 4 |
| maplestreet/furniture/grill.glb | 0.02 | 0.00 | 7 → 2 | 2 → 2 |
| maplestreet/furniture/loveseat.glb | 0.02 | 0.01 | 9 → 3 | 3 → 3 |
| maplestreet/furniture/barStool.glb | 0.02 | 0.00 | 3 → 2 | 2 → 2 |
| maplestreet/furniture/shower.glb | 0.02 | 0.01 | 5 → 3 | 3 → 3 |
| maplestreet/furniture/sinkCounter.glb | 0.01 | 0.01 | 6 → 4 | 4 → 4 |
| maplestreet/furniture/ceilingLight.glb | 0.01 | 0.00 | 2 → 2 | 2 → 2 |
| maplestreet/furniture/toyChest.glb | 0.01 | 0.01 | 3 → 3 | 3 → 3 |
| maplestreet/furniture/hotTub.glb | 0.01 | 0.00 | 6 → 3 | 3 → 3 |
| maplestreet/furniture/wallClock.glb | 0.01 | 0.00 | 3 → 2 | 2 → 2 |
| maplestreet/furniture/vanity.glb | 0.01 | 0.01 | 4 → 4 | 4 → 4 |
| maplestreet/furniture/tvStand.glb | 0.01 | 0.00 | 5 → 3 | 3 → 3 |
| maplestreet/furniture/toilet.glb | 0.01 | 0.00 | 3 → 1 | 1 → 1 |
| maplestreet/furniture/recliner.glb | 0.01 | 0.00 | 5 → 1 | 1 → 1 |
| maplestreet/furniture/bathtub.glb | 0.01 | 0.00 | 3 → 3 | 3 → 3 |
| maplestreet/furniture/wardrobe.glb | 0.01 | 0.00 | 4 → 3 | 3 → 3 |
| maplestreet/furniture/counter.glb | 0.01 | 0.00 | 4 → 3 | 3 → 3 |
| maplestreet/furniture/fridge.glb | 0.01 | 0.00 | 4 → 2 | 2 → 2 |
| maplestreet/furniture/bench.glb | 0.01 | 0.00 | 4 → 2 | 2 → 2 |
| maplestreet/furniture/painting.glb | 0.01 | 0.00 | 2 → 2 | 2 → 2 |
| maplestreet/furniture/shelf.glb | 0.01 | 0.00 | 3 → 3 | 3 → 3 |
| maplestreet/furniture/dishwasher.glb | 0.01 | 0.00 | 3 → 3 | 3 → 3 |
| maplestreet/furniture/doghouse.glb | 0.01 | 0.00 | 3 → 3 | 3 → 3 |
| maplestreet/furniture/rugLarge.glb | 0.01 | 0.00 | 3 → 2 | 2 → 2 |
| maplestreet/furniture/rugSmall.glb | 0.01 | 0.00 | 3 → 2 | 2 → 2 |
| botwreck/crate_single.glb | 0.01 | 0.00 | 1 → 1 | 1 → 1 |
| maplestreet/furniture/divingBoard.glb | 0.00 | 0.00 | 2 → 2 | 2 → 2 |
| maplestreet/furniture/mirror.glb | 0.00 | 0.00 | 2 → 2 | 2 → 2 |
| maplestreet/furniture/wallTv.glb | 0.00 | 0.00 | 2 → 2 | 2 → 2 |
| **Total (111)** | **179.40** | **30.94** | | |

## Bush League Baseball budgets

Sources go in `assets-src/models/bushleague/` (with every Meshy prompt in `prompts.json`), cleaned by `scripts/blender/bushleague/cleanup.py`, then optimised by `pnpm assets` into `public/models/bushleague/`.

| Asset | LOD0 | LOD1 | LOD2 | Notes |
| --- | ---: | ---: | ---: | --- |
| Player body (any of the five body types) | 25,000 | 8,000 | 2,000 | 1.85 m, shared skeleton (`players/Rig.ts`), `_slot` uniform attribute, AO in `COLOR_0` |
| Mascot | 25,000 | 8,000 | 2,000 | Same skeleton and slots as players |
| Prop (scoreboard, tower, dugout, gear) | 15,000 | 5,000 | 1,500 | Original designs, no text or logos |

Start-up budget for the first contest: under 6 MB on `low`, under 25 MB on `ultra`; anything beyond streams in after first pitch. Until generated models land, the module draws procedural players on the same skeleton and slots (`players/BodyMesh.ts`), about 2,500 triangles each.