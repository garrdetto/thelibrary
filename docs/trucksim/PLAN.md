# Truck Simulator — design

Module id `trucksim`, title **Truck Simulator**, page `public/modules/trucksim.html` built from `modules-src/trucksim/`.
An open-world trucking learning module on Babylon.js 9.34 (WebGPU, WebGL2 fallback) with Rapier 0.14 physics. You start with
a paid-off dump truck and a little cash, haul loads around a 4 km × 4 km county, earn your way into semi-trucks and trailers,
customise them, and build up your own truck lot with a sims-style builder. The ordered build prompts that produced it are in
`docs/trucksim/PROMPTS.md`.

## Rules that apply everywhere

- Visible copy never says game, gaming or entertainment (site rule). "Truck Simulator", "haul", "career", "job" are fine.
- Every make and model is original (site rule: no real makes, models or logos). The styles the owner asked for are kept:
  - Dump trucks, three brands: **Ridgeline RD-10** (set-forward tandem, the starter), **Ironhaul DX** (tri-axle with a lift axle),
    **Bedrock Quad** (quad-axle).
  - Semis: **Kestrel CX** cab-over (day cab, sleeper), **Pinnacle Classic** long-hood conventional in the square-hood, chrome,
    long-nose style (day cab, flat-top sleeper, long-wheelbase raised sleeper), **Northstar Aerodyne** aero conventional in the
    sloped-hood, faired style (day cab, raised sleeper, long-wheelbase sleeper).
  - Trailers: oil/gas **tanker**, **flatbed**, **grain hopper**, **reefer**, and a removable-gooseneck **lowboy** for construction
    equipment.
- Gloss rule: no gloss on ground, roads, concrete, gravel, wood, cloth, rubber; about 15 % of normal gloss on paint and metal;
  glass is the only exception.
- Babylon is imported by path. No CDN. Custom shaders are avoided; if one is ever needed it is written in GLSL and WGSL.
- Persistence is D1 through `/api/trucksim` (signed in). Guests play on an in-memory profile with the same rules.
- Font stacks start with `'TL Fox Dollar', ` so every `$` is the fox dollar.

## Coordinates

Metres, Y up, right-handed (`scene.useRightHandedSystem = true`), so Rapier and Babylon share numbers. A heading `h` faces
`(sin h, 0, cos h)`; in this frame +X is the driver's left when facing +Z, so a positive heading change and a positive steer are
both a left turn. Vehicle local frame: origin on the ground under the front axle (trucks) or under the kingpin (trailers), +Z
forward, +X left.

## World (`shared/WorldLayout.ts`, `shared/Terrain.ts`)

- 4,096 m square, −2,048…2,048, streamed in 256 m chunks.
- Highway loop (rounded square at ±1,500, 4 lanes), Main Street (z = 0) and County Road (x = 0) crossing at the town of
  Millbrook, gravel and paved connectors to every site.
- Terrain: low rolling hills (≤ 4 % grades) plus fine detail that fades out near roads and site pads; roads follow the smooth
  surface; sites and lots are flat pads.
- Sites (every one axis-aligned, with zones for the work done there): Big Rig Motors (dealership), Crossroads Travel Center and
  Main Street Fuel & Go (diesel, tanker drop), Bluestone Quarry (dump loading by excavator and wheel loader), three construction
  sites (Oak Hollow Subdivision, Route 9 Overpass, Riverside Plaza: dump drop, equipment drop, material drop), Heavy Iron Rentals
  (equipment pickup), Prairie Gulf Refinery (tanker loading rack), Hansen Farms and Miller Grain Farm (grain bins with spouts),
  County Co-op Elevator (grain pit), Northland Cold Storage and Fresh Market Distribution (reefer docks), Ironworks Steel and Pine
  Valley Lumber (flatbed loading), Builders Depot (flatbed drop).
- **Haulers Row**: 16 player lots of 120 m × 90 m (eight each side of a 12 m road). Each signed-in player is given one free lot on
  arrival; lots of players not seen for 45 days are released. Everyone sees everyone's lot.

## Trucks and trailers (`shared/Catalog.ts`)

Each truck model carries real-ish numbers (mass, power, torque, gear ratios, axles with steer/drive/dual/lift, fuel tank,
consumption, fifth-wheel position or dump body) that drive both physics and visuals. Looks are paint (primary, secondary, accent,
finish, stripe) plus parts (stacks, visor, bumper, light bar, wheels, mudflaps, horn) bought in the garage.

## Physics (`sim/`, Rapier, renderer-free)

- `SimWorld`: Rapier world at 60 Hz, terrain heightfield colliders streamed per chunk around the vehicles, static box colliders
  for site buildings and lot buildings near the player.
- `TruckRig`: chassis body + Rapier ray-cast vehicle controller with one wheel per axle side, engine torque curve, automatic or
  manual gearbox, service brakes, parking brake, engine (jake) brake, fuel burn, payload via additional mass.
- `TrailerRig`: its own body and wheels, landing gear that holds it up when uncoupled, payload mass, brakes driven by the tractor
  when air lines are connected. The lowboy's gooseneck detaches so the deck drops to the ground as a ramp, and re-attaches.
- `Coupling`: back the fifth wheel under the kingpin (≤ 0.35 m, height window, ≤ 25° yaw, ≤ 1 m/s) and the jaws lock with a
  spherical joint; then connect air lines and raise the landing gear. Uncoupling reverses it.
- `DumpBody`: payload, bed angle (hydraulic raise and lower), tailgate, material flow out over 28°.
- `LoaderAI`: an excavator or wheel loader at a loading zone cycles dig → swing → dump → swing back, each bucket adding payload
  until the truck is full; the player waits with the parking brake set.
- `ExcavatorRig`: a drivable tracked excavator for lowboy jobs: drive it up onto the deck, then it is chained down and rides as
  trailer payload.

## Jobs (`shared/Jobs.ts`, `game/Procedures.ts`)

Jobs are generated deterministically per 30-minute slot so the Worker can check them. Each job names cargo, mass, pickup and drop
zones, distance and pay. The realistic loading and unloading steps:

| Haul | Loading | Unloading |
| --- | --- | --- |
| Dump | Stop in the loading zone, set the parking brake, wait while the excavator or loader fills the bed | Stop in the drop zone, raise the bed until it is empty, lower it |
| Tanker | Stop at the rack, connect the loading arm (E), wait for the fill | At the station, connect the hose (E), wait for the drain |
| Flatbed | Stop at the bay, wait for the forklift/crane, strap down every tie point (E) | Release straps, wait for unloading |
| Grain | Line the hopper up under the spout, open the tarp, wait for the fill, close the tarp | Line up over the pit, open the hopper gates, wait |
| Reefer | Back square into a dock (≤ 1 m, ≤ 5°), open the doors, wait for the forklift, close the doors; the reefer unit keeps the load cold | Back into the receiving dock, open, unload |
| Lowboy | At the yard: park level, lower the deck, detach the gooseneck, pull forward, drive the excavator onto the deck, back the tractor in to reconnect, raise the deck, chain four points | Lower the deck, detach, drive the excavator off into the drop zone, reconnect |

Pay grows with distance and mass, loses up to 40 % for cargo damage, and adds 15 % for on-time delivery.

## Economy (`shared/Economy.ts`, `shared/Actions.ts`)

One authority, `applyAction(profile, action, now)`, runs in the Worker and in the page for guests: buy/sell trucks and trailers,
customise, select the active rig, accept/complete/abandon jobs, refuel, repair, build/demolish on the lot. Start: $3,000 and a
paid-off Ridgeline RD-10.

## Lot builder (`shared/Lots.ts`, `ui/BuilderBar.ts`, `game/BuildMode.ts`, `render/Lots.ts`)

A sims-style build mode on your lot with a top-down orbit camera and a 1 m grid: drag paving (gravel, asphalt, concrete), drag a
building footprint (steel shop with roll-up doors, pole barn, office), place add-ons (office trailer, fuel island, wash bay, parts
shed, tire rack, light poles, sign, dumpster, air station, flag pole), draw fences; rotate, recolour, demolish (50 % refund). A
shop on your lot repairs and refuels your trucks at cost.

- **Paving** is textured: crushed-stone gravel, asphalt with painted stalls and saw-cut concrete, procedural tileable maps
  (albedo plus bump) shared by every lot and laid in world metres so slabs join seamlessly.
- **More land**: a lot starts 120 m × 90 m and can grow by up to four 30 m strips at the back (away from Haulers Row), each
  dearer than the last (`landStripPrice`). Build mode shows the next strip for sale; west-side lots keep their buildings in
  place as they grow (items are shifted in lot-local terms by the rules). The Row's level pad covers fully grown lots.

## Truck wash (`render/models/DirtLayer.ts`, `game/WashMode.ts`, `game/WashScore.ts`, `ui/WashHud.ts`)

Trucks pick up dirt as they drive (2.2 points per km, 0–100) and it shows as grime on the body. A wash bay you build on your
lot (water only) or the public wash lane at the travel center ($60) starts a hands-on wash: orbit the truck, lay foam with the
foam cannon, let it soak, rinse top to bottom with the pressure wand and scrub the wheels, against the clock, for a star
rating. Delivering with a clean truck (dirt under 25) pays a 5 % clean-rig bonus.

## Memory and performance (`systems/`)

- Every Babylon resource is created under a `Scope`; scopes dispose children on teardown and on `pagehide`.
- `ChunkStreamer` loads and unloads terrain, roads, sites, props and physics ground around the camera within a per-frame time
  budget and a maximum loaded count.
- `MemoryGuard` samples meshes, materials, textures, geometries, draw calls and the JS heap every 2 s. A count that keeps setting
  new highs (Rack & Reel's `ResourceTrend`) or a budget overrun raises pressure: streamers shrink their radius, caches trim, and
  at critical pressure the quality drops a tier. `?perf=1` shows the overlay; `window.__truckMem()` returns the report.
- Shared materials (paint cached by colour and finish), thin instances for trees and props, merged static meshes per chunk,
  pooled particles and pile meshes, no per-frame allocations in hot loops.
- Node tests build and dispose every visual and world chunk many times on a `NullEngine` and require the counts to return to
  the baseline.

## Built to drop into Life Sim later

The owner wants Truck Simulator added to Life Sim (`modules-src/foxlake/`) eventually. Life Sim is Rack & Reel's `Game`
started with host-world options (`GameExtension` / `GameHost` in `modules-src/rackreel/game/Game.ts`); its Babylon scene is
left-handed, but its Rapier cars live in a right-handed **town frame** under a root node mirrored in z (`region.ts`,
`FoxLakeTown` `root.scaling.set(1, 1, -1)`), they join Rack & Reel's driving through `VehicleController.addExternal` with an
`ExternalDriver`, keys arrive as a `Set` of `KeyboardEvent.code`, and money is the shared wallet (`RoomLogic.adjustMoney`).
So Truck Simulator is split into a reusable core and a standalone host:

- **Frame.** Everything Truck Simulator draws hangs under a `frameRoot` node in the right-handed sim frame. Standalone uses a
  right-handed scene with an identity root; inside Life Sim the root is the town root, so the same meshes come out correctly.
- **Physics.** Rigs take a `PhysicsHost` (`sim/PhysicsHost.ts`: Rapier, a world, collision groups, `heightAt`, `gripAt`), not a
  concrete world. The groups use Life Sim's `CG`/`MASK` bit layout (a test keeps them equal), so a truck can be added to Life
  Sim's town `Physics` world as it is.
- **Haul world.** Jobs, procedures and pay read a `HaulWorld` (`shared/HaulWorld.ts`: sites, zones, route distance) instead of
  the county constants, so Montello's real places (the freight depot, the fuel stations, the farms round town) can become a
  second haul world.
- **Lots.** Build items are lot-local and validated against a lot size, not the Haulers Row list, so a Life Sim parcel can be a
  truck lot.
- **Money.** `applyAction` reports each action's cash change. The Worker applies it to the profile's own cash today; for Life
  Sim it will apply it to the shared wallet exactly as `/api/rackreel?game=foxlake` does (profile key `lifesim:<user>`).
- **Session.** `game/TruckSession.ts` owns rigs, jobs, procedures and the work-zone machines and talks to a `TruckHost`
  (scene, `frameRoot`, `PhysicsHost`, `HaulWorld`, key set, UI root, progress client, shadow casters, toasts). The standalone
  page (`index.ts` + `game/Standalone.ts`) is one host; a Life Sim `GameExtension` can be another, seating the hunter through
  `addExternal` and letting Rack & Reel's camera follow.
- **Kept standalone-only:** the county terrain, roads and site scenery (`render/world/`), the sky, lighting and post chain, the
  cameras and the start screen. Work-zone equipment (loading rack, grain spout, docks, the AI excavator and loader, forklifts)
  lives in `render/work/` and takes any zone list, so it can be placed in Montello too.

## Online

Profiles and lots live in D1 (`trucksim_profiles`, `trucksim_lots`, migration 0049). GET `/api/trucksim?lots=1` lists every
claimed lot with its owner and build so the whole Row is shared. Live presence of other drivers is a later phase.
