# Kestrel County (source)

Source for `public/modules/county.html`, module id `county` (working title). A new, separate open world in the Fox Plains family: a 4 × 4 km county with a town, an airport, flyable helicopters, Fox Plains' driving physics and its lawn mowing. It is drawn in a glossy, realistic 3D-clipart style with HDR lighting. It runs on PlayCanvas (`playcanvas` 2.23.3, bundled) and reuses Fox Plains 2's code by import instead of copying it.

It is in the library as Kestrel County (`src/lib/modules.ts`, thumbnail `public/images/modules/county.webp`).

## Phase 3: the airport

- **Buildings (`src/models/AirportBuildings.ts`):** the terminal (two storeys, a glass curtain wall onto the apron, a landside canopy and a rooftop name board), the control tower (tapered shaft, eight-sided glass cab, gallery, rotating green-and-white beacon), the ribbed hangar from look development facing its own pad, and a windsock that swings downwind and fills with the wind. All have colliders.
- **Air traffic (`shared/AirTraffic.ts`):** three original aircraft (a regional turboprop, a business jet and the flying club's Skylark) each fly a 15-minute cycle as a pure function of real time: a straight-in final on a 3° glide slope into the wind, flare, rollout to the first connector they can make, taxi to their stand, turnaround, pushback, taxi to the departure end, hold short, line up, take-off and climb out. Departures wait at the hold-short line until the runway is clear of every arrival and earlier departure. Every visitor computes the same traffic, so it needs no network traffic.
- **In the page (`src/flight/TrafficManager.ts`):** models from `src/models/Traffic.ts` posed every frame, kinematic colliders that move with them, spinning propellers, and go-arounds: if you're on the runway when an arrival is 35 s out, it climbs away instead of landing.
- **Wind:** the windsock, the helicopter and the trainer all feel the same wind (`windAt`, real time).
- **Tests (`tests/traffic.test.ts`):** determinism, smooth motion (no jumps or heading snaps), the 3° glide slope, one plane on the runway at a time over a whole day, on the paving whenever on the ground, stands clear of each other, and go-arounds.

## Phase 2: flying

Two flyable aircraft wait at the airport east of town, reached by Airport Road at the end of Main Street: the five-seat utility helicopter on a helipad and the Skylark, an original two-seat high-wing trainer, on the apron. Walk up and press E to climb aboard.

- **Flight models (`shared/`, renderer-free and tested):** `HeliFlight.ts` (rotor thrust from collective and rotor speed, inflow, ground effect, translational lift, vortex ring state, disc tilt with flapping lag and blowback, torque against the tail rotor, fin and stabiliser, autorotation) and `PlaneFlight.ts` (lift that rounds off and stalls with a wing drop, flaps, induced drag and ground effect, sideslip, roll, pitch and yaw moments from rates and surfaces, a propeller whose thrust falls with speed, P-factor and torque). `FlightAssist.ts` sits between the keys and the controls; `Aircraft.ts` holds the two specs; `Landing.ts` grades touchdowns.
- **Easy assist (default):** helicopter: W/S set a speed and it hovers when released near zero, A/D turn, Q/E slide, Space/Shift climb and descend, height and heading held hands-off, a cushioned touchdown. Plane: W/S nose down/up and it holds that attitude, A/D bank and level the wings when released, rudder coordinated, automatic trim, stall protection, and it tracks the runway heading on the ground. **Pro** (M): direct cyclic, pedals, elevator, ailerons and rudder.
- **Other keys:** Space/Shift throttle (plane), F flaps, B brakes, V cockpit view, R reset, E get out once landed and stopped.
- **In the page:** `src/flight/Flyer.ts` puts each model on a Rapier body (helicopter skids; the trainer's tricycle gear on a Rapier vehicle controller), checks rotor strikes and grades landings. `src/game/FlightHud.ts` shows airspeed, altitude, climb, heading, power, rotor or engine speed, flaps, fuel, warnings and an attitude indicator.
- **Airport (`shared/Airport.ts`, `src/world/AirportMesh.ts`):** runway 09/27 (1,360 × 30 m) with threshold bars, numbers, aiming points, centre and edge lines and lights; a parallel taxiway with connectors, centre lines, hold-short bars and blue edge lights; the apron with a parking stand and three lit helipads. The terminal, tower and hangars come in Phase 3.
- **Developer panel:** "Fly the helicopter here" and "Fly the trainer here", plus teleports to the apron and runway 09.
- **Tests (`tests/flight.test.ts`):** hover hold, ground effect and translational lift, assist recovery, forward flight, soft touchdown and landing grades, autorotation, determinism; trainer stall speeds with and without flaps, hands-off cruise, take-off distance and climb, glide ratio, stall recovery and weathervaning.

## Phase 1: the world slice

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

4. Mowing at scale.
5. The shared online world.
6. Homes and the house builder, on Fox Plains' `shared/BuildRules.ts` and `Catalog.ts`.
7. Content, and an optional clipart bake for published vehicles.
8. Later: more flyable planes, sling loads, touch controls.

The full plan is kept with the project notes.
