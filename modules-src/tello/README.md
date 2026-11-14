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
- `world/Storefronts.ts` + `data/Downtown.ts`: downtown's storefronts on West and East Montello Street and Main Street. Every store on those streets gets a commercial front over the wall that faces it (`planFronts`; a corner building can have one on each street): brick, stucco, paint or rock-faced block upstairs with tall windows under arched or flat hoods (or bricked in), a bracketed or corbelled cornice, bay windows, a corner turret with a spire, and a street storey of display windows, vertical boards, a log front or stone veneer, a raised stone terrace with a railing, iron balconies, shingled, striped or ribbed-metal awnings, sign boards and hanging signs (`world/SignAtlas.ts`, plain lettering, real business names). Fronts matched to the owner's own photos and videos are `KNOWN_FRONTS` (the south side of West Montello between West Street and the supper club), `MAIN_STREET_FRONTS` (the turreted corner of Montello and Main on both streets, the three fronts south of it, the long buff block and the rock-faced block by the alley on the east side), `WEST_MONTELLO_DRIVE_FRONTS` (the realty office, the mural building and the north side, and the three south-side fronts by the river), `MAIN_SOUTH_FRONTS` (H A Freitag & Son and the three fronts past the car alley) and `EAST_MONTELLO_FRONTS` (the theatre, the white building and the two porch houses); the rest are picked from each building's seed (`defaultFront`). Shop fronts put an entry in the middle of each shop bay (one per seven or eight metres) and a narrow stair door at one end of two-storey fronts (`entryPlan`), unless the photos place them (`doors`, `stairDoor`). Photos of Street View are never used.
- `world/StreetDressing.ts`: black acorn lamp posts along the downtown street (`lampSpots`, clear of corners and alleys) with the blue MONTELLO banner or a hanging painted bass, and a basket of petunias each; and the water tower on its single column at its mapped spot, painted as it is: navy below, cream above with "City of Montello", a gold cap.
- `data/Streets.ts`: corrections made at load on top of the baked map (renderer-free, so tests see them): West Montello, East Montello and Main Street are one lane each way with a parking lane along both curbs, at full width wherever the buildings leave room for a sidewalk (`streetProfiles`, which also marks the wider pavement in the pavement field); Main Street's two overlapping OpenStreetMap ways at its north end become one street up to a grass island and a lane each side of it to the light (`fixMainSplit`, `mainIsland`); the West Montello Street bridge is set level with the street, widened over both sidewalks, its approaches filled and the Montello River dug out under it (`fixBridge`); buildings the lidar measured low are raised and three the footprints miss on Main Street are added (`fixBuildings`); and the light's cycle (`signalPhase`).
- `world/StreetPaint.ts`: raised sidewalks with a curb along both sides of every downtown street (ten feet from the fronts to the curb on Main and East Montello Street; on West Montello Street a five-foot walk along the curb with the storefront apron behind it up to the fronts), dropping to curb cuts at alleys and driveways; every other sidewalk in town is raised with a curb face too (`Roads.ts`). And the paint on those streets: double yellow centre line, the white parking-lane line with stall ticks (or an edge line where there's no room to park), gaps at cross streets and driveways, and stop bars and ladder crosswalks at the light.
- `world/Intersection.ts`: the light at Main Street and State Highway 23: the island's yellow curb and grass with the keep-right sign, mast-arm signals on the north corners and post signals (animated on `signalPhase`), the route sign assembly and two-way arrow in front of the falls, the green guide sign on Main Street, and the stone parapets with iron railings on the West Montello Street bridge.
- `world/Falls.ts`: the falls across the highway from the light: red granite in blocky tiers with three cascades streaming down chutes into a dark pool behind a cut-stone wall, a wishing well and iron fence; and the granite park's quarry faces along every steep shore of the river pool and the quarry pond (as tall as the bank, facing the water) with a small falls at each of the park's other mapped waterfalls. The falls, faces and small falls are Blender models; if they can't load, the built-in falls stand in and the quarry faces are left out.
- `tools/build-montello.py` + `world/Kit.ts`: the Blender builds (run with `blender -b -P modules-src/tello/tools/build-montello.py`, or `python3` with the `bpy` module, then `pnpm assets` and commit `public/models/tello/`): `downtown-kit.glb` (bracketed cornice with modillions and dentils, scroll brackets, arched hoods with keystones, flat hoods, double-hung window frames, stone sills, cast-iron pilasters, a panelled shop door, a bell-cast turret roof with finial) and `quarry.glb` (the falls, three quarry faces, the small falls). Each root node is a part and each material name a slot (trim, stone, door, shingle, metal, granite, wetrock, wallstone, water, foam, pool, wood); `ModelKit.put` lays a part's triangles into the merged builders, scaled to each window, front and turret and coloured by slot (or by the part's own vertex colours), so the detail adds no draw calls. The storefronts use the kit when it loads and their simpler shapes when it doesn't.
- `world/Landmarks.ts`: the municipal building on Underwood Avenue from the owner's photos (brown brick, MONTELLO MUNICIPAL BUILDING on its raised panel, the glass entry, the Police Dept. bay and porch, the fire station's three white bay doors with MONTELLO, the cross and FIRE, bollards, flagpoles and iron fence), the welcome mural on the river wall west of the bridge (our own painting: pines, a lake, a leaping bass, "Welcome to Montello") and the realty office's marquee with its three green pines.
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
- **From photos and video:** the storefronts and street furniture of West Montello, East Montello and Main Street, the light, the falls, the island and the street paint, the bridge's level and parapets, and the water tower, from the owner's photos and drives.
- **Not real:** what walls, windows and doors look like elsewhere (no open data has facades, so they wear Fox Lake's finishes by type; the rest of downtown gets fronts in the same spirit), roof colours, dormers, porches and chimneys, road widths where OpenStreetMap has none (set by class), tree species beyond conifer or broadleaf, lake depths (a bed sloped from the shore), signs (except downtown's, which carry the real business names in plain lettering), fences and street furniture outside downtown. Anything built or cut down since 2018 is as it was then; 38 footprints had no building under them in 2018 and keep a roof by their kind.
- **Bounds:** a 4,096 m square that holds the whole city limits. The edge is a wall.

## Controls

Rack & Reel's walking and driving, plus E (drive), V (bring out the next vehicle), H (back to Main Street), Ctrl (map and directions), N (corner map zoom). The Esc menu lists them.

## Checks

- `node scripts/tello-tests.mjs` (in `pnpm test`): the map files, the frame and projection, water levels, road beds, bridges, buildings, measured roofs, trees and their heights, triangulation and routing.
- `node scripts/tello-capture.mjs [baseUrl] [outDir] [spots]`: loads the built page in Chrome and saves screenshots with frame times at fixed spots.
- `window.__tello.town.debug()`.
