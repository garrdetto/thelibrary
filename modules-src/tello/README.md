# Tello (source)

Source for `public/modules/tello.html`, module id `tello`. Tello is Montello, Wisconsin at 1:1, built from real survey data: the lidar ground, every mapped road, bridge, lake, river and pond, and every building on its real footprint. You walk it or drive it and get directions on the map. It runs on this device only (no shared world).

## How it is put together

Tello runs on Fox Lake's engine. `index.ts` starts Rack & Reel's `Game` with `{ terrain: new TelloTerrain(land), extension: new TelloTown(land), gearAtCabin: true, profile: 'tello', look, shadowMapSize }` (the same look and shadow map Fox Lake passes), so these are the same code as Fox Lake and are never forked here:

- the renderer, tone mapping, sky, sun and moon, fog and cached shadows (`rackreel/core`, `rackreel/world/Lighting.ts`)
- the skinned hunter, his animations, the character creator and wardrobe (`rackreel/game/Avatar.ts`)
- the meadow grass and the trees (`rackreel/world/Foliage.ts`, `plantTrees`)
- the water shader (`rrWater` in `rackreel/world/Shaders.ts`)
- the building finishes, facades and Rapier world (`foxlake/fp/`)
- the vehicles: the bundled Maple Hauler pickup and the other Fox Plains vehicles, with Fox Lake's clear glass and paint (`foxlake/fp/physics/`, driven through `foxlake/town/Cars.ts`)

Rack & Reel's own lake country still stands in its square around the scene's origin, sealed by its rim of hills. Montello lies a kilometre and a half north of it, out of sight and out of reach, and the lake country's scenery is switched off (`RegionCuller`). The player has no rod or rifle here (`gearAtCabin`).

### Frames (`region.ts`)

- **map**: x east, z north, metres from the origin near City Hall (UTM zone 16N, 1 unit = 1 m), y metres above `frame.base` (228 m). The baked files and `TelloLand` use it.
- **scene**: map + `land.offset`. The map's centre is at scene (0, 4096): a whole map width from the origin, so Rack & Reel's water shader reads Tello's depth map through a repeating texture.
- **town**: (map.x, y, −map.z), right-handed, for Fox Lake's builders and car physics; it hangs under a root at `land.offset` with z mirrored.

`TelloLand` answers for the ground (`groundAt`), bridge decks (`deckAt`, `heightAt`), water (`waterAt`, `depthAt`), cover, tree crowns and the distance to pavement (`clearAt`). `TelloTerrain` is Rack & Reel's `Terrain` with Montello as the land beyond the square and depth taken from Montello's own water levels.

### The world (`world/`, `town/`)

- `world/Ground.ts`: vertex-coloured ground 4 m apart in 256 m meshes, coloured by the lake country's palette from the real ground cover.
- `world/Water.ts`: a surface mesh over the wet cells that follows the level grid (Buffalo Lake 234.81 m, Lake Montello 238.71 m, the Fox River below the dam 233.28 m), drawn with `rrWater`.
- `world/Roads.ts`: ribbons for every road by class (lined highway asphalt, plain streets and driveways, gravel, concrete walks, dirt trails), junction patches, parking lots, and bridge decks with railings.
- `world/Buildings.ts`: walls from each footprint; gable, flat or metal roofs and colliders from the rectangles the bake covered it with; windows and doors; merged per material and 128 m cell.
- `town/TelloTown.ts`: the `GameExtension`: builds all of the above, the Rapier heightfield and edge walls, trees and their trunks, the cars, wading and towing, place names, keys.
- `town/TelloMap.ts`, `town/Routes.ts`: the corner map, the full map (Ctrl) and directions over the real road network.

## The map data (`tools/bake_map.py`)

`public/modules/tello/montello.bin` and `montello.json` are baked and committed; the page never reaches an outside service. Re-bake with:

```sh
python3 modules-src/tello/tools/bake_map.py            # needs numpy, scipy, pillow, pyproj, shapely
```

It downloads into `.tello-cache/` (git-ignored) and writes both files. `--debug <dir>` also writes a picture of the cover, roads and buildings.

| Layer | Source |
| --- | --- |
| Roads, water outlines, land use, places, some buildings | OpenStreetMap (© OpenStreetMap contributors, ODbL) |
| Ground height and water levels | USGS 3DEP bare-earth lidar |
| Tree crowns and ground cover | USDA NAIP aerial imagery with near infrared |
| Most building footprints and heights | Microsoft Global ML Building Footprints (ODbL) |

What the bake does: finds each water body's level in the lidar and carves a bed under it; lays every road's bed level across the road and smooths it along; makes long water crossings bridges and short ones culverts; levels a yard under every building and parking lot; merges OpenStreetMap's buildings with Microsoft's and covers each footprint with rectangles for roofs and colliders; marks tree crowns in the photo (green in near infrared and rough with crown shadows) and plants a tree under them, thinner in the far woods.

### What is exact and what is not

- **Exact to the data:** the lie of the land (lidar, sampled 4 m apart), water levels, every mapped road's line and class, shorelines, each building's place, footprint and approximate height, where the woods are.
- **Not real:** what buildings look like (no open data has facades, so they wear Fox Lake's finishes by type), road widths where OpenStreetMap has none (set by class), individual trees (placed under real crowns, species guessed), lake depths (a bed sloped from the shore), signs, fences and street furniture.
- **Bounds:** a 4,096 m square that holds the whole city limits. The edge is a wall.

## Controls

Rack & Reel's walking and driving, plus E (drive), V (bring out the next vehicle), H (back to Main Street), Ctrl (map and directions), N (corner map zoom). The Esc menu lists them.

## Checks

- `node scripts/tello-tests.mjs` (in `pnpm test`): the map files, the frame and projection, water levels, road beds, bridges, buildings, trees, triangulation and routing.
- `node scripts/tello-capture.mjs [baseUrl] [outDir] [spots]`: loads the built page in Chrome and saves screenshots with frame times at fixed spots.
- `window.__tello.town.debug()`.
