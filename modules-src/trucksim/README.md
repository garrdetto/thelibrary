# Truck Simulator

An open-world trucking module for the library, played on Montello, Life Sim's map of Montello, Wisconsin (the page boots it in
trucking mode: `foxlake/boot.ts`, `foxlake/trucks/TruckingMode.ts`). You start in a paid-off Ridgeline RD-10 dump truck with $3,000
at your lot on Haulers Lane, east of Foxtails off State Highway 23, haul loads with the real loading and unloading steps for each
trailer, earn your way into semis, paint and part them, build up your lot (16 lots shared by every signed-in player), and can climb
out of the cab and walk the town. `?world=county` still opens the original 4 km × 4 km county with Haulers Row on `game/Standalone.ts`. Babylon.js 9.34 (WebGPU, WebGL2 fallback
through Rack & Reel's `createEngine`) draws it, Rapier 0.14 drives it, and money, jobs and lots go through one rule set that runs in
the Worker (`/api/trucksim`, D1) and in the page for guests. Every make and model is original.

Design: `docs/trucksim/PLAN.md`. The ordered prompts it was built from: `docs/trucksim/PROMPTS.md`. File list: `docs/ENGINE-MAP.md`
under trucksim.

## Run it

```
pnpm dev
```

then open `/modules/trucksim.html` (the library embeds it as module id `trucksim`). Query options:

- `?quality=low|medium|high|ultra` picks the graphics tier (default from the backend and device, `render/Quality.ts`).
- `?tonemap=neutral` uses Khronos PBR Neutral instead of ACES.
- `?perf=1` shows the memory and frame overlay; `window.__truckMem()` returns the memory report.
- Signed in, progress saves to D1 through `/api/trucksim`; guests play on an in-memory profile.

## Controls (`systems/Keys.ts` `BINDINGS`)

| Keys | Action |
| --- | --- |
| W / Up, S / Down | Accelerate, brake and reverse |
| A / Left, D / Right | Steer |
| Space | Parking brake |
| B | Engine brake |
| Left Shift / Page Up, Left Ctrl / Page Down | Shift up, shift down |
| H, L | Horn, headlights |
| C | Change camera (chase, cab; drag to look, wheel to zoom) |
| E | Interact, get in or out, and every procedure step (arms, hoses, straps, doors, chains) |
| T | Couple or uncouple the trailer |
| G | Landing gear |
| R, F | Raise and lower the dump bed |
| X | Lift or lower spare axles |
| J, M, O | Job board, map, fleet and garage |
| Y | Build mode on your lot |
| Esc | Pause menu |

In build mode: middle-drag turns, right-drag pans, wheel zooms, Q/E spin the view, R rotates the piece. Gravel and asphalt are
textured (`render/lots/PavingTexture.ts`), and the Land tab buys the next 30 m strip of land (up to four, `landStripPrice`), shading
it while the button is hovered; the lot grows away from its gate.

Trucks gather grime as they drive (`DIRT_PER_KM`, shown by `render/models/DirtLayer.ts`). Stop in the Crossroads Travel Center wash
lane ($60) or inside your own wash bay (water only) and press E: the camera circles the truck, hold the left mouse button to spray
the mud off with the wand, and E, Esc or Done finishes (`game/WashMode.ts`). The `wash` action takes off the share you cleaned, and
a truck under `CLEAN_DIRT_LIMIT` earns `CLEAN_BONUS` on its next delivery.

## Architecture

```
                 index.ts  ->  game/Standalone.ts  (TruckHost: engine, scene, sky, post chain, cameras, HUD, sound)
                                   |
        +--------------------------+---------------------------+
        |                          |                           |
 render/world/*              game/TruckSession.ts         render/Lots.ts
 terrain, roads, props,      rigs + visuals, driving,     Haulers Row lots
 sites, sky, pipeline        coupling, dump, jobs,        game/BuildMode.ts
 (standalone only)           procedures, loaders, dealer  ui/BuilderBar.ts
                                   |
        +--------------+-----------+-------------+-----------------+
        |              |                         |                 |
   sim/* (Rapier)  render/models/*          render/work/*      net/Progress.ts
   TruckRig,       trucks, trailers,        zone equipment     /api/trucksim or
   TrailerRig,     machines, cargo          (racks, docks,     local applyAction
   Coupling, Dump,                          forklifts, AI
   ExcavatorRig,                            loaders)
   LoaderAI
        |                                                            |
   PhysicsHost                                            shared/*  (Worker and page)
   (SimWorld here)                                        Catalog, Economy, Actions, Jobs, Lots,
                                                          WorldLayout, Terrain, RoadGraph, HaulWorld
 systems/*: Keys, Scope, Streamer, Pool, MemoryGuard, Audio        ui/*: HUD, panels, shops
```

Rules that hold everywhere: coordinates are metres, Y up, right-handed, heading `h` faces `(sin h, 0, cos h)`, vehicles have their
origin on the ground under the front axle (trucks) or kingpin (trailers), +Z forward, +X the driver's left. `sim/` never imports
Babylon and `render/` and `ui/` never import Rapier; `sim/types.ts` is the plain-data boundary. Babylon is imported by path, there
are no custom shaders, and ground, roads, rubber, wood and cloth never shine (`render/Materials.ts`).

## Memory and performance

- Every mesh, material, texture, observer and listener belongs to one `Scope` (`systems/Scope.ts`); disposing a scope disposes its
  children first, and the page disposes everything on `pagehide`.
- `ChunkStreamer` loads 256 m chunks nearest first within a per-frame time budget and never above its maximum.
- `MemoryGuard` samples meshes, materials, textures, geometries, draw calls and the JS heap every couple of seconds. Counts that keep
  setting new highs (Rack & Reel's `ResourceTrend`) or budget overruns raise pressure; streamers shrink, caches trim, and at critical
  pressure the quality drops a tier. In the console, `window.__truckMem()` returns the report; `?perf=1` shows it on screen.
- Shared materials come from `MaterialLibrary`; trees, poles and wheels are thin instances; static scenery is merged per material.
  Hot paths allocate nothing per frame.
- A leak check for a long drive: open `?perf=1`, drive a loop for a few minutes and watch that `__truckMem()` counts stay flat.

## Tests

```
pnpm exec tsc -p modules-src/trucksim/tsconfig.json
node scripts/trucksim-tests.mjs            # all of tests/*.test.ts
node scripts/trucksim-tests.mjs sim-truck  # only files whose name contains the filter
```

Both run inside `pnpm test`. Tests cover the shared rules (economy, jobs, lots, procedures, road graph, layout), the Rapier rigs,
the collision groups (kept equal to Life Sim's), scopes, streaming, the memory guard, and build-and-dispose cycles of every visual
on a `NullEngine` that must return the resource counts to baseline.

## Server

`src/server/routes/trucksim.ts` + `src/server/trucksim.ts` serve `/api/trucksim`: GET returns the signed-in profile (assigning the
first free lot; lots unseen for 45 days are released) and the public lots, `?lots=1` only the lots; POST runs one action through
`shared/Actions.ts` `applyAction` and saves to D1 (`trucksim_profiles`, `trucksim_lots`, migration 0049). `?world=<id>` selects a
haul world from `HAUL_WORLDS`.

## Life Sim integration plan

The core is built to be mounted inside Life Sim (`modules-src/foxlake/`) later; nothing in `foxlake` imports it yet.

1. **Host.** `modules-src/foxlake/town/TruckSim.ts` implements `TruckHost` (`game/TruckHost.ts`) over Life Sim's `GameHost`: the town
   root (right-handed, mirrored in z under Babylon's left-handed scene) is `frameRoot`, the host key set is `keys`, and trucks are
   seated through `VehicleController.addExternal` so Rack & Reel's camera follows.
2. **Physics.** The town `Physics` world is wrapped as a `PhysicsHost` (`sim/PhysicsHost.ts`). The collision groups already equal
   Life Sim's `CG`/`MASK`, and `tests/groups.test.ts` keeps them that way.
3. **Haul world.** A Montello `HaulWorld` (`shared/HaulWorld.ts`) built from `MontelloPlaces` (freight depot, fuel stations, farms)
   supplies sites, zones and `routeDistance`; jobs, procedures and pay read only that interface.
4. **Lots.** Build items are lot-local and validated against a lot size (`shared/Lots.ts`), so a Life Sim parcel can be a truck lot.
5. **Money and server.** `applyAction` reports each action's cash `delta`. A `lifesim` entry in `HAUL_WORLDS` (`src/server/trucksim.ts`)
   with profile key `lifesim:<user>` lets `/api/trucksim?world=lifesim` apply it to the shared wallet the way `/api/rackreel?game=foxlake`
   does; `Progress.load(world)` already passes `?world=`.
6. **Standalone only.** County terrain, roads and site scenery (`render/world/`), the sky and post chain, the cameras and the start
   screen stay in the standalone host. Work-zone equipment (`render/work/`) takes any zone list and can be placed in Montello too.

Later phases: live presence of other drivers (a Durable Object relaying rigs at 5 Hz), AI traffic, and walking round the rig.
