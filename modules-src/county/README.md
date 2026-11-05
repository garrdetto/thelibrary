# Kestrel County (source)

Source for `public/modules/county.html`, module id `county` (working title). A new, separate open world in the Fox Plains family: a 4 × 4 km county with a town, an airport, flyable helicopters, Fox Plains' driving physics and its lawn mowing. It is drawn in a glossy, realistic 3D-clipart style with HDR lighting. It runs on PlayCanvas (`playcanvas` 2.23.3, bundled) and reuses Fox Plains 2's code by import instead of copying it.

It is not in the library yet (`src/lib/modules.ts`); open `/modules/county.html` directly.

## Phase 0: look development (this folder today)

A single scene to settle the look before the world is built:
- three houses on a residential street, with lawns (one freshly mowed), trees, lamps, mailboxes, a hydrant and a picket fence;
- the corner of the airfield: a hangar, the apron, a helipad, a windsock and a parked five-seat helicopter.

Use the panel to switch views (Street, Hangar, Helicopter, Aerial) and times of day (Morning, Noon, Dusk, Night), cycle the quality tier and spin the rotor.

Address-bar options:
- `?view=street|hangar|helicopter|aerial`
- `?hour=0–24`
- `?quality=low|medium|high`
- `?rotor=1`
- `?ui=0` hides the panel for screenshots.

From the console, `window.county` offers `setView`, `setHour`, `quality`, `rotor` and `info()` (fps, triangles per area, render scale).

## The look

- **Realistic proportions and silhouettes:** real-world sizes (an 11 × 8.5 m house, a 4.4 m lamp post, a 10 m helicopter). Nothing inflated, blocky or caricatured.
- **Detail is modelled, not painted:** window frames, muntins, sills, shutters, lap siding, corner boards, fascia, gutters and downspouts, shingle courses, panel doors, ribbed hangar walls and standing-seam roofs.
- **Softened edges everywhere:** small bevels on every edge so highlights run along them (`bevelBox`, `prism`, `sweep` in `src/core/Shapes.ts`).
- **Materials:** clean colours on the vertices with a handful of finishes (`src/style/Kit.ts`: matte, satin, plastic, clear-coated paint, glass, metal, foliage, ground). There are no noise textures.
- **Light:** Neutral tone mapping and gentle grading (`GRADE` in `config.ts`), soft cascaded shadows, sky reflections from a baked env atlas, aerial haze, and warm glow materials that brighten after dark.
- **Foliage:** trees are many small leaf clumps on visible branches, with species outlines (oak, maple, spruce), never one big ball.

## Files

| File | What it does |
| --- | --- |
| `config.ts` | palette, finishes, grading, light and fog, look-dev views and times |
| `src/main.ts` | boot, panel, keyboard, `window.county` |
| `src/core/Renderer.ts` | PlayCanvas device and app, CameraFrame (TAA, SSAO, bloom, grading), quality tiers, adaptive scale |
| `src/core/Shapes.ts` | `bevelBox`, `prism` (rounded extrusion), `sweep` (profile along a path), `gridSurface` (smooth lofted skins with per-quad colours), `roundOutline`, `triangulate`, `contactShade` |
| `src/core/Batch.ts` | one builder per finish, so each area is one draw per finish |
| `src/core/Noise.ts` | seeded random numbers and value noise |
| `src/style/Kit.ts` | the material kit and night glow materials |
| `src/world/Sky.ts` | gradient sky dome, clouds, stars, sun/moon light, env bake, haze |
| `src/world/LookDev.ts` | composes the look-development scene |
| `src/game/OrbitCamera.ts` | orbit, pan and zoom camera with preset views |
| `src/models/House.ts`, `Parts.ts` | house, windows, doors |
| `src/models/Street.ts` | road, curbs, sidewalks, lamps, mailbox, hydrant, fence, lawn stripes, shrubs |
| `src/models/Trees.ts` | `leafClump`, oak and maple (`broadleaf`), spruce |
| `src/models/Airfield.ts` | hangar, name board, apron, helipad, windsock |
| `src/models/Helicopter.ts` | the utility helicopter with separate main and tail rotors |
| `src/models/Ground.ts` | look-dev ground with hills (`groundHeight`) |

## Reused from other modules

- **Fox Plains 2:** `MeshBuilder`, `meshEntity` and the colour helpers (`../foxplains2/src/core/Geo.ts`).
- **Fox Plains:** `store` (`../maplestreet/src/core/Storage.ts`) for the per-browser quality setting (`county/quality`).

## Next phases

1. Terrain and chunk streaming, the town, walking and driving with the Fox Plains 2 physics.
2. Helicopter flight model and flight assist.
3. The airport and AI air traffic; the module appears in the library.
4. Mowing at scale.
5. The shared online world.
6. Content.

The full plan is kept with the project notes.
