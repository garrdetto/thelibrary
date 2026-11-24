# Truck Simulator on Montello

The owner's direction (2026-11-22): Truck Simulator plays on Life Sim's map of Montello instead of its own county, the
driver can climb out of the cab and walk as Life Sim's person, the truck lots sit just out of town to the east past Foxtails,
and deliveries go to existing places or to new places on the outskirts, so the main part of Montello is left as it is.
Alongside the move comes a realism pass: animations, gravel and the quarry, the excavator visibly loading the dump truck,
physics, curbs and guardrails, trees and houses you cannot drive through, and working headlights.

This follows the seam the module was built with (`PLAN.md`, "Built to drop into Life Sim later"): a `TruckSession` runs in
any `TruckHost`, jobs read a `HaulWorld`, rigs take a `PhysicsHost` whose collision groups equal Life Sim's.

## Places (map coordinates: x east, z north, metres; town frame is `(x, y, -z)`)

- Foxtails Lounge & Casino stands at about (1700, 419) on State Highway 23 at 16th Road (`MONTELLO_CASINO`).
- **Truck lots:** a row along State Highway 23 east of Foxtails, past the city limits, each lot fronting the highway with
  its gate and driveway on it (same lot-local build rules as Haulers Row).
- **Deliveries:** existing businesses where they are real (fuel stations, the tire shop, farms), and new outskirts sites for
  the rest: a gravel quarry, a ready-mix / building-supply yard, a grain elevator, a fuel depot, a cold-storage dock, a
  lumber and steel yard. New sites stand outside the city limits; nothing downtown moves.

## Phases (each its own pull request)

1. **Montello haul world.** `shared/MontelloWorld.ts`: the lots and outskirts sites with their work zones, a road graph built
   from the baked map's roads for route distance and the GPS line, a `HaulWorld` with id `montello`. Worker: a
   `HAUL_WORLDS.montello` entry with its own profile key (`montello:<user>`), and a world column (or key prefix) for
   `trucksim_lots` so Montello lots don't collide with Haulers Row lots. Tests: every zone on dry ground and reachable by road,
   every new site outside the city limits, lots clear of buildings.
2. **Life Sim host.** A `GameExtension` in `modules-src/foxlake/` implementing `TruckHost`: the town root as `frameRoot`,
   the town `Physics` as `PhysicsHost`, Montello's land for `heightAt`, Rack & Reel's keys and HUD root. The truck joins
   Life Sim's driving through `VehicleController.addExternal`, so getting in and out (E) and walking are Life Sim's own,
   with Life Sim's tailored person and rig. The lots, outskirts sites and work-zone equipment are drawn into Montello.
3. **Truck Simulator page on Montello (done).** The Truck Simulator page boots Montello in trucking mode (`foxlake/boot.ts`
   with `trucking`, `foxlake/trucks/TruckingMode.ts`): you start in your rig at your Haulers Lane lot with Truck Simulator's
   dash, job board, dealer, fleet and garage, a Montello map and the lot builder; `?world=county` still opens the county.
4. **Realism.** The excavator swings, digs and dumps each bucket into the bed with the load growing per bucket; the quarry gets
   benches, haul road, stockpiles and a crusher with real gravel textures; Rapier tuning toward real mass, load transfer and
   tyre grip; curbs on town streets and guardrails on embankments and bridges; trees and buildings solid for the truck;
   headlights that light the road (spot lights within the light budget, lamps on the lenses).

## Not doing

- Moving or changing downtown Montello's streets and buildings.
- Deleting county saves: Montello careers use their own profile key, so county profiles stay in D1.
