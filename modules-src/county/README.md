# Kestrel County (source)

Source for `public/modules/county.html`, module id `county` (working title). A new, separate open world in the Fox Plains family: a 4 × 4 km county with a town, an airport, flyable helicopters, Fox Plains' driving physics and its lawn mowing. It is drawn in a glossy, realistic 3D-clipart style with HDR lighting. It runs on PlayCanvas (`playcanvas` 2.23.3, bundled) and reuses Fox Plains 2's code by import instead of copying it.

It is not in the library yet (`src/lib/modules.ts`); open `/modules/county.html` directly.

## Phase 1: the world slice (this folder today)

The page opens straight into the county. You start on the lawn of your house on Juniper Street with the Maple Hauler in the driveway.

- **Ground:** `shared/Base.ts` is the natural terrain (farm country, a gentler bowl for the town, a level airport plateau, hills to the north, a backdrop past the map edge). `shared/Terrain.ts` grades it around everything built: under a right of way it sits below the hard surfaces, just outside it meets the sidewalk's outer edge, lots are levelled to their pad and open ground beside a road becomes an embankment.
- **Roads:** `shared/Layout.ts` is the street plan; `shared/Roads.ts` derives the rest. Every street is graded (at most 6 %, flat through junctions), trimmed where its junction's curb returns start, and shares one cross-section: carriageway, a 15 cm curb, a grass verge, a sidewalk with a 2 % crossfall. Junctions are one flat surface plus the same layers swept round each corner. Driveways and crosswalk ramps cut the curb with flared wings and turn the verge into a concrete apron; the sidewalk runs through at its own height. `tests/roads.test.ts` fails the build on overlaps, seam gaps, grade breaks, cuts too close to junctions or each other, and ground poking through a sidewalk.
- **Streaming:** `src/world/Chunks.ts` loads 256 m chunks at three levels round you and your vehicles, with heights from worker threads and meshes built under a per-frame budget.
- **Walking and driving:** Fox Plains 2's `Character`, `Vehicle`, `VehicleModels` and `CameraRig`, imported unchanged, on Rapier heightfield and road colliders. WASD, Shift to run, E to get in or out, Space handbrake, R to reset a car, right-drag to look.
- **Developer panel (F8, or `?panel=1`):** every vehicle in the shared registry with Spawn and Drive: built-in, bundled and published from the admin vehicle editor, plus the admin's drafts with `?dev=1`. It also shows telemetry, teleports and the time of day, and links to the vehicle editor for making new ones.

Address-bar options: `?hour=0–24`, `?quality=low|medium|high`, `?dev=1`, `?panel=1`, `?ui=0`, and `?lookdev=1` for the Phase 0 scene (with its own `?view=` and `?rotor=1`). `window.county` exposes `game`, `chunks`, `net`, `setHour`, `teleport` and `info()`.
## The look

- **Realistic proportions and silhouettes:** real-world sizes (an 11 × 8.5 m house, a 4.4 m lamp post, a 10 m helicopter). Nothing inflated, blocky or caricatured.
- **Detail is modelled, not painted:** window frames, muntins, sills, shutters, lap siding, corner boards, fascia, gutters and downspouts, shingle courses, panel doors, ribbed hangar walls and standing-seam roofs.
- **Softened edges everywhere:** small bevels on every edge so highlights run along them (`bevelBox`, `prism`, `sweep` in `src/core/Shapes.ts`).
- **Materials:** clean colours on the vertices with a handful of finishes (`src/style/Kit.ts`: matte, satin, plastic, clear-coated paint, glass, metal, foliage, ground). There are no noise textures.
- **Light:** Neutral tone mapping and gentle grading (`GRADE` in `config.ts`), soft cascaded shadows, sky reflections from a baked env atlas, aerial haze, and warm glow materials that brighten after dark.
- **Foliage:** trees are many small leaf clumps on visible branches, with species outlines (oak, maple, spruce), never one big ball.

## Files

See the county section of `docs/ENGINE-MAP.md` for every file. In short: `shared/` holds the renderer-free rules (terrain, layout, roads), `src/world/` the streamed scene, `src/game/` walking, driving and the developer panel, and `src/models/` the clipart models from Phase 0.
## Reused from other modules

- **Fox Plains 2:** `MeshBuilder` and `meshEntity` (`core/Geo.ts`), `Assets`, `AvatarKits`, `CameraRig`, and the physics (`Physics`, `Vehicle`, `VehicleModels`, `Character`). Change those there, for both modules.
- **Fox Plains:** `Input`, `store`, `Wardrobe`, `Economy` and the vehicle registry (`shared/Vehicles.ts`, `CustomVehicles.ts`), so published vehicles drive the same everywhere.

## Next phases

2. Helicopter flight model and flight assist.
3. The airport and AI air traffic; the module appears in the library.
4. Mowing at scale.
5. The shared online world.
6. Homes and the house builder, on Fox Plains' `shared/BuildRules.ts` and `Catalog.ts`.
7. Content, and an optional clipart bake for published vehicles.
8. Later: flyable small planes, sling loads, touch controls.

The full plan is kept with the project notes.
