# Tello (source)

Source for `public/modules/tello.html`, module id `tello`. Tello is Montello, Wisconsin at 1:1, built from real survey data: the lidar ground, every mapped road, bridge, lake, river and pond, every building on its real footprint under its measured roof, and every tree at its measured height. You walk it or drive it and get directions on the map. It runs on this device only (no shared world).

## How it is put together

Tello runs on Fox Lake's engine. `index.ts` starts Rack & Reel's `Game` with `{ terrain: new TelloTerrain(land), extension: new TelloTown(land), gearAtCabin: true, profile: 'tello', look, shadowMapSize }` (`FOX_LAKE_LOOK` and `FOX_LAKE_SHADOW_MAP` imported from `foxlake/look.ts`, so Tello's lighting always matches Fox Lake's), so these are the same code as Fox Lake and are never forked here:

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
- `world/Buildings.ts`: walls from each footprint up to each block's measured eave; the measured roof on each rectangle (gable along either axis, hip, single slope or flat); colliders from the same rectangles; windows and doors sized to the wall; merged per material and 128 m cell.
- `town/TelloTown.ts`: the `GameExtension`: builds all of the above, the Rapier heightfield and edge walls, trees and their trunks, the cars, wading and towing, place names, keys.
- `town/TelloMap.ts`, `town/Routes.ts`: the corner map, the full map (Ctrl) and directions over the real road network.

## The map data (`tools/bake_map.py`)

`public/modules/tello/montello.bin` and `montello.json` are baked and committed; the page never reaches an outside service. Re-bake with:

```sh
python3 modules-src/tello/tools/bake_map.py            # needs numpy, scipy, pillow, pyproj, shapely, laspy[lazrs]
```

It downloads into `.tello-cache/` (git-ignored, about 800 MB with the point cloud) and writes both files. `--debug <dir>` also writes a picture of the cover, roads and buildings.

| Layer | Source |
| --- | --- |
| Roads, water outlines, land use, places, some buildings | OpenStreetMap (© OpenStreetMap contributors, ODbL) |
| Ground height and water levels | USGS 3DEP bare-earth lidar |
| Roof shape, eave and ridge height of each building; buildings no footprint source has; bridge deck heights; every tree and its height | The 2018 FEMA/USGS lidar point cloud of Marquette County (25 one-kilometre tiles, about 4 points per square metre, from NOAA Digital Coast's open bucket) |
| Ground cover | USDA NAIP aerial imagery with near infrared |
| Most building footprints | Microsoft Global ML Building Footprints (ODbL) |

What the bake does: finds each water body's level in the lidar and carves a bed under it; lays every road's bed level across the road and smooths it along; makes long water crossings bridges (at the deck height the point cloud shows) and short ones culverts; levels a yard under every building and parking lot; merges OpenStreetMap's buildings with Microsoft's and covers each footprint with rectangles for roofs and colliders.

From the point cloud (`load_lidar`, one-metre rasters plus the last returns over buildings):

- **Roofs** (`measure_roofs`, `fit_roof`): the last returns on each rectangle are fitted with a flat roof, a gable along either axis (the ridge tried at nine offsets), a hip and a single slope; the best fit gives the roof type and the eave and ridge heights. 1,617 of 1,680 buildings are measured; the rest (built since 2018, or hidden) get a roof by their kind.
- **Missing buildings** (`find_buildings`): patches at least 2.2 m up whose surface is solid (one return per pulse) and planar, clear of mapped footprints, roads and water: 31 outbuildings the footprint sources lack.
- **Trees** (`detect_trees`): one tree at every crown top in the canopy height model, with its real height (median 16 m, tallest 34 m). Crowns that let little through to the ground in the leaf-off survey are conifers. Every tree near buildings is kept; farther out only the tallest in each patch, so the far woods stay drawable: 67,999 trees.
- **Woods on the ground**: ground cover under crowns comes from the same canopy model.

### City limits

Only the City of Montello is built. The bake reads the city's boundary from OpenStreetMap (relation, admin level 8,
holes filled) and ships it with the playable area, the limits widened by 30 m plus County Highway F out to the map's
south edge (where Fox Lake's County Road F comes in): `limits` in the JSON (`city`, `play`, the road `exits`, the
`link`) and the signed-distance grid `play` in the bin. Buildings outside the limits are dropped; ground, water, roads
and the lidar woods are drawn only `seen` (240 m) past the playable edge (`TelloLand.seen`); invisible walls follow the
edge (`Montello.addWalls`), and every road that leaves it ends at a striped barricade (`world/Barricades.ts`). Every
roof takes its colour from the NAIP aerial photo (`rc`, the median of the bare pixels inside the footprint, darkened a
fifth for the haze by `aerialRoof`).

### What is exact and what is not

- **Exact to the data:** the lie of the land (lidar, sampled 4 m apart), water levels, every mapped road's line and class, shorelines, each building's place and footprint, its roof type and its eave and ridge heights as they stood in spring 2018, bridge deck heights, and each tree's place and height.
- **Not real:** what walls, windows and doors look like (no open data has facades, so they wear Fox Lake's finishes by type), roof colours, dormers, porches and chimneys, road widths where OpenStreetMap has none (set by class), tree species beyond conifer or broadleaf, lake depths (a bed sloped from the shore), signs, fences and street furniture. Anything built or cut down since 2018 is as it was then; 38 footprints had no building under them in 2018 and keep a roof by their kind.
- **Bounds:** a 4,096 m square that holds the whole city limits. The edge is a wall.

## Controls

Rack & Reel's walking and driving, plus E (drive), V (bring out the next vehicle), H (back to Main Street), Ctrl (map and directions), N (corner map zoom). The Esc menu lists them.

## Checks

- `node scripts/tello-tests.mjs` (in `pnpm test`): the map files, the frame and projection, water levels, road beds, bridges, buildings, measured roofs, trees and their heights, triangulation and routing.
- `node scripts/tello-capture.mjs [baseUrl] [outDir] [spots]`: loads the built page in Chrome and saves screenshots with frame times at fixed spots.
- `window.__tello.town.debug()`.
