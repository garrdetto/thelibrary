# Truck Simulator — build prompts, in order

These are the prompts Truck Simulator was built from, run top to bottom without stopping for questions. Each names who runs it
(the director is the main session; **Opus** agents take the large or quality-critical parts; **Sonnet (medium effort)** agents take
the smaller, well-bounded ones), the files it owns, the interfaces it consumes and produces, and how it is checked. Design:
`docs/trucksim/PLAN.md`. Prompts in one wave run in parallel; a wave starts when the one before it is merged into the branch.

## Rules every prompt follows

- Read `AGENTS.md` (Conventions, Platform rules, Development), `docs/trucksim/PLAN.md` and the contract files listed in
  your prompt before writing code.
- Touch only the files your prompt owns. Do not commit (the director commits each wave). Do not run `pnpm build` (6 GB, the
  director runs it once).
- Type-check with `pnpm exec tsc -p modules-src/trucksim/tsconfig.json 2>&1 | grep -E '<your paths>'` (other agents' files may be
  mid-edit) and run only your tests with `node scripts/trucksim-tests.mjs <name>`.
- TypeScript, type-only imports, descriptive names, a one-paragraph doc comment at the top of each file and on exports, no
  inline comments. Babylon imported by path (`@babylonjs/core/Meshes/mesh`), never the package root, never a CDN. No custom
  shaders. Rapier is `@dimforge/rapier3d-compat` 0.14.
- Coordinates: right-handed, Y up, metres; heading `h` faces `(sin h, 0, cos h)`; vehicle frame origin on the ground under the
  front axle (trucks) or kingpin (trailers), +Z forward, +X the driver's left.
- Memory: nothing allocated per frame in hot paths (reuse vectors and arrays); every mesh, material, texture and observer has an
  owner that disposes it; shared materials come from `MaterialLibrary`; thin instances or merged meshes for repeated things.
- Gloss rule (owner): no gloss on ground, roads, concrete, gravel, wood, cloth, rubber; about 15 % of normal gloss on paint and
  metal; only glass and water may shine.
- Visible copy never says game, gaming or entertainment. No real makes, models, logos or brand colours.
- Life Sim readiness: render code parents everything under the `parent`/`frameRoot` it is given (never the scene root), sim
  code talks to a `PhysicsHost`, and rules read a `HaulWorld`, so the core can later be mounted inside Life Sim.

---

## Prompt 0 — Design (director)

Write `docs/trucksim/PLAN.md`: the module's rules, coordinates, the county map, trucks and trailers, physics, jobs and the
realistic loading steps, economy, lot builder, memory strategy, online, and how it will drop into Life Sim. Then this file.

## Prompt 1 — Scaffold (director)

Create `modules-src/trucksim/` (`module.json`, `tsconfig.json` like Sun Vault's), `scripts/trucksim-tests.mjs` (esbuild bundle of
`modules-src/trucksim/tests/*.test.ts`, optional name filters, `node --test --test-concurrency=1`), and add
`tsc -p modules-src/trucksim/tsconfig.json && node scripts/trucksim-tests.mjs` to `pnpm test`.

## Prompt 2 — Contracts (director)

Write the files every later prompt compiles against, with `tests/layout.test.ts`:
- `shared/Catalog.ts`: 3 dump trucks (Ridgeline RD-10 starter, Ironhaul DX tri-axle, Bedrock Quad), 8 semis (Kestrel CX cab-over
  day/sleeper, Pinnacle Classic long hood day/63" sleeper/LWB 80" raised, Northstar Aerodyne day/raised/LWB), 5 trailers
  (tanker, flatbed, grain hopper, reefer, RGN lowboy), cargo, `TruckLook` options and prices, lot `BUILDINGS`.
- `shared/WorldLayout.ts`: roads, sites and zones, 16 lots on Haulers Row, `FIELDS`, `DISTRICT`, helpers.
- `shared/Terrain.ts`: `getTerrain()`, `heightAt`, `smoothAt`, `surfaceAt`, `roadAt`, `padAt`, `normalAt`, `sampleGrid`,
  `SURFACE_GRIP`. Roads stay under 8 % grade, site pads are flat.
- `shared/HaulWorld.ts`, `sim/types.ts` (poses and inputs), `sim/PhysicsHost.ts` (host interface, Life Sim's `CG`/`MASK`).

**Check:** `node scripts/trucksim-tests.mjs layout` passes.

---

## Wave 1 (parallel)

### Prompt 3 — Rules and the Worker API (Sonnet, medium effort)

**Owns:** `modules-src/trucksim/shared/{RoadGraph,Economy,Jobs,Lots,Actions}.ts`, `modules-src/trucksim/tests/{roadgraph,economy,jobs,lots}.test.ts`,
`src/server/trucksim.ts`, `src/server/routes/trucksim.ts`, `migrations/0048_trucksim.sql`, the `/api/trucksim` line in
`src/server/api.ts`.

Build the single authority for money, jobs and lots, shared by the Worker and the page.
- `RoadGraph`: graph of every `ROADS` polyline (split segments where another road's end point lies on them, merge nodes within
  0.5 m), A* `route(fromX, fromZ, toX, toZ): { points: [number, number][]; length: number }` that walks onto the nearest road
  point at each end, and `COUNTY: HaulWorld` (id `county`) whose `routeDistance` uses it.
- `Economy`: `OwnedTruck { uid, model, look: TruckLook, odometerKm, damage (0–100), fuelL }`, `OwnedTrailer { uid, model, color,
  damage }`, `ActiveJob { job: Job; acceptedAt: number; truck: string; trailer: string | null }`, `Profile { version: 1; cash;
  company; trucks; trailers; activeTruck; activeTrailer; lot: number | null; build: BuildItem[]; job: ActiveJob | null; stats:
  { jobs, earned, km, tonnes }; xp }`, `defaultProfile()` ($3,000 + a full-tank `STARTER_TRUCK` with `defaultLook`),
  `normalizeProfile(raw: unknown)` (drops unknown models, clamps numbers, never throws), `level(xp)`.
- `Jobs`: `Job { id, world, cargo, haul, massKg, from, to, distanceM, pay, minutes }`, `JOB_SLOT_MS` = 30 min, `jobSlot(now)`,
  `generateJobs(world, slot, count = 16)` deterministic from a seeded hash of `world.id` and `slot` (pickup and drop zones of
  the right kinds for each haul: dump `dumpLoad→dumpUnload`, tanker `tankLoad→tankUnload`, flatbed `flatLoad→flatUnload`, grain
  `grainLoad→grainUnload`, reefer dock→dock at the other site, lowboy `equipPickup→equipDrop` and back), ids `<world>-<slot>-<n>`,
  `findJob(world, id)` regenerates one from its id, pay = `baseFee + ratePerTonKm × tonnes × km` rounded to $10, `minutes` from
  distance at 45 km/h plus loading time, `minimumMs(job)` (distance at 90 km/h), `jobPayout(job, { damage: 0–1, elapsedMs })` →
  `{ pay, bonus, penalty }` (up to 40 % off for damage scaled by cargo `fragile`, +15 % on time).
- `Lots`: `BuildItem { id; def; x; z; w; d; rot: 0 | 1 | 2 | 3; color; color2? }` in lot-local metres, (x, z) the footprint's
  minimum corner, w/d its axis-aligned size, `rot` the side the front faces (+z, +x, −z, −x); a `line` item runs `w` metres from
  (x, z) in the `rot` direction with thickness `d`. `itemFootprint`, `itemCost(item)`, `validateItem(item, existing, lot: { w, d })
  → string | null` (inside the lot, sizes within the def's limits, structures and add-ons may not overlap other solids, paving may
  sit under anything), `hasService(build)`, `PublicLot { index, owner, company, build }`, `MAX_ITEMS` = 160.
- `Actions`: the union `TruckAction` (`buy-truck {model, look?}`, `buy-trailer {model, color?}`, `sell-truck {uid}`,
  `sell-trailer {uid}`, `customize {uid, look}`, `select {truck, trailer}`, `accept-job {job}`, `complete-job {job, damage}`,
  `abandon-job`, `refuel {uid, litres}`, `repair {uid}`, `build {items}`, `demolish {ids}`, `rename {company}`, `claim-lot {index}`,
  `odometer {uid, km, fuelUsedL}`) and `applyAction(profile, action, ctx: { now; world: HaulWorld; lotFree?(index): boolean })
  → ActResult { ok; profile; delta; message; paid? }` (`delta` is the cash change, so a host can route money to a shared wallet;
  a refused action returns the profile unchanged with a plain message). Refuel and repair are free of labour (fuel at cost) when
  the build has a service building. You can't sell the active truck or the last truck.
- Worker: D1 `trucksim_profiles (user_id PK, username, data, updated_at)` and `trucksim_lots (lot_index PK, user_id UNIQUE,
  username, seen_at)` created on first use and in migration 0048. GET `/api/trucksim` → `{ signedIn, username?, profile?, lots }`
  (a signed-in player without a lot is given the first free lot, releasing lots unseen for 45 days); GET `?lots=1` public lots
  list; POST (signed in, same-origin, Zod discriminated union matching `TruckAction`, body ≤ 16 KB) runs `applyAction` with the
  county world and saves; `claim-lot` checks `trucksim_lots`. Profile key is the user id now; leave a `world`/`game` parameter
  seam for Life Sim (`lifesim:<user>` with the shared wallet later) without implementing it. Never return user ids.

**Check:** `node scripts/trucksim-tests.mjs roadgraph economy jobs lots` passes; `pnpm exec tsc -p tsconfig.json --noEmit` shows no
errors in the server files (the site tsconfig includes `src/`).

### Prompt 4 — Physics (Opus)

**Owns:** `modules-src/trucksim/sim/{SimWorld,Drivetrain,TruckRig,TrailerRig,Coupling,Dump,LoaderAI,ExcavatorRig}.ts`,
`modules-src/trucksim/tests/sim-*.test.ts`.

Renderer-free Rapier physics against `PhysicsHost`.
- `SimWorld implements PhysicsHost` (`static create(terrain: Terrain)`): Rapier init, gravity −9.81, 60 Hz fixed step with
  `step(dt): number` (accumulator, at most 5 steps) and `alpha`, terrain heightfield colliders per 256 m chunk at 4 m spacing
  streamed around `stream(points)` within 1 chunk ring (unload beyond 2), static boxes `addStaticBox / removeStatic`, world-edge
  walls, `gripAt` from `SURFACE_GRIP`, `dispose()`.
- `Drivetrain`: engine torque curve (peak torque 1,100–1,500 rpm, power limited above), 10/13-speed automated manual with shift
  time and a governor at `topSpeedKph`, reverse, engine brake, fuel burn from power output and `fuelLPer100Km`.
- `TruckRig(host, model, spawn)`: chassis body with mass `massKg` and a centre of mass low and toward the rear, one Rapier wheel
  per axle side from `axles` and `track`, steer on steer axles (lock falls off with speed), drive on drive axles, service brakes,
  parking brake, lift axles (raised under 30 % load), `setPayload(kg)` via additional mass, `dump: DumpBody | null`, `pose():
  TruckPose`, `fifthWheelWorld()`, `speed`/`speedKph`/`rpm`/`gear`/`fuelL`, `teleport`, impact detection (velocity change
  > 3 m/s in a step → `onImpact(dv)`), `dispose()`. Grip from `host.gripAt` under each wheel.
- `TrailerRig(host, model, spawn)`: body, wheels on every axle, landing gear collider that holds the kingpin plate at
  `kingpinHeight` while down and uncoupled, `gearTarget`/`gear` (3 s travel), payload, brakes from the tractor when lines are
  connected and parked brake otherwise, `doorsTarget`/`doors`, `pose(): TrailerPose`. Lowboy: `neckAttached`; detached, the deck
  front rests on the ground as a ramp and the neck rides on the tractor (`pose().gooseneck` follows the fifth wheel).
- `Coupling`: `checkCouple(truck, trailer): { ok, distance, heightError, angleDeg, reason? }` (≤ 0.35 m, plate within −0.06…
  +0.12 m, ≤ 25°, ≤ 1 m/s), `couple` (spherical joint at the kingpin), `uncouple` (refused while the landing gear is up),
  `checkNeck / detachNeck / attachNeck` for the RGN (reattach lifts the deck back over 1.5 s, then joins).
- `DumpBody`: capacity, `loadKg`, `material`, `add(kg, material)`, `angle` with `target` −1/0/1 (6°/s, max `maxAngleDeg`),
  tailgate opens past 8°, material flows out past 28° at up to 2,500 kg/s, `update(dt): number` (kg dumped).
- `LoaderAI({ kind: 'excavator' | 'loader', bucketKg })`: phases idle → waiting → dig → swing → dump → return → done, `update(dt,
  truckReady, wantKg): number` (kg delivered), `armPose()` for the renderer.
- `ExcavatorRig(host, spawn)`: 20.5 t tracked machine (body, track drive by ray-cast ground contact, pivot turns), arm angles
  from `MachineInput`, `pose(): ExcavatorPose`, `secureTo(trailer)` (on the well deck, stopped → becomes trailer payload and
  rides along), `release(spawn)`.

**Check:** `node scripts/trucksim-tests.mjs sim` passes, including: a starter dump truck reaches 60 km/h on flat ground in under
40 s and stops from it in under 60 m; a semi couples to each trailer kind and pulls it through a 90° turn without the trailer
flipping; uncoupled trailers stay up on their landing gear; a loaded dump empties when raised; the loader fills a truck to
capacity; the excavator climbs onto a detached RGN deck and secures; disposing a world leaves no bodies.

### Prompt 5 — Memory, streaming, input and sound (Sonnet, medium effort)

**Owns:** `modules-src/trucksim/systems/{Scope,MemoryGuard,Streamer,Pool,Keys,Audio}.ts`, `tests/{scope,streamer,memory}.test.ts`.

- `Scope(name, parent?)`: `track(item)`, `defer(fn)`, `child(name)`, `dispose()` (children first, reverse order, idempotent,
  errors logged not thrown), `size`, `disposed`.
- `ChunkStreamer<T>({ chunkSize, radius, load(cx, cz), unload(item, cx, cz), budgetMs = 2, maxLoaded })`: `update(x, z, nowMs)`
  loads the nearest missing chunks first within the time budget, unloads chunks beyond `radius + 1`, never exceeds
  `maxLoaded`, `setRadius`, `forEach`, `clear`, `loaded`.
- `Pool<T>(create, reset, max)`: `acquire`, `release`, `drain(dispose)`.
- `MemoryGuard(scene, { budget, sampleMs = 2000 })`: samples meshes, materials, textures, geometries, active indices / draw calls
  and `performance.memory.usedJSHeapSize` when present, feeds Rack & Reel's `ResourceTrend` (`modules-src/rackreel/core/PerfTrend.ts`),
  `registerGauge(name, read)`, `onPressure(cb)` with `'warn'` (growth streak or 85 % of a budget) and `'critical'` (over budget),
  `report(): MemoryReport`, exposes `window.__truckMem`, optional overlay with `?perf=1`, `dispose()`.
- `Keys(target)`: tracks `KeyboardEvent.code` (the same codes Life Sim's `GameHost.keys` holds), `down`, `pressed(code)` edges,
  `released(code)`, `endFrame()`, clears on blur, `dispose()`; `BINDINGS` (action → codes) for drive, dump, coupling, menus.
- `TruckAudio`: Web Audio synthesis only (no files): diesel engine (rpm and load), turbo whistle, jake brake, air-brake hiss,
  backup beeper, horn (stock or air), hydraulic whine, `start()` on a user gesture, `setVolume`, `dispose()`.

**Check:** `node scripts/trucksim-tests.mjs scope streamer memory` passes (streamer never exceeds `maxLoaded`, unloads every
chunk on `clear`; Scope disposes children; MemoryGuard on a `NullEngine` reports growth after a scripted leak).

### Prompt 6 — Truck models and materials (Opus)

**Owns:** `modules-src/trucksim/render/Materials.ts`, `modules-src/trucksim/render/models/{TruckVisual,TruckParts,Wheels}.ts`,
`tests/visual-truck.test.ts`.

- `MaterialLibrary(scene)`: PBR materials cached by key, following the gloss rule: `paint(hex, finish)` (gloss ≈ roughness 0.55,
  metallic flake ≈ 0.5 metallic / 0.5 roughness, matte 0.85), `get(name)` for `chrome`, `steel`, `darkSteel`, `aluminum`,
  `rubber`, `glass`, `glassTint`, `plastic`, `grille`, `lampWhite`, `lampRed`, `lampAmber` (emissive), `deck`, `cargo:<hex>`;
  `trim(maxPaints)` disposes least-recently-used paints nobody holds; `dispose()`.
- `buildTruckVisual(scene, parent, model, look, mats): TruckVisual { root; meshes; update(pose: TruckPose); setLook(look);
  setLoad(fill, color | null); dispose() }`. Procedural, detailed and accurate to each style: frame rails, cab (cab-over flat face
  tilted cab; square long hood with tall grille, cowl, round headlights; aero sloped hood, swept bumper, fairings), day or sleeper
  or raised roof by `cab`/`sleeperLength`/`roofHeight`, doors with windows, mirrors, steps, fuel and DEF tanks, battery box, air
  tanks, fifth wheel with deck plate, mud flaps, exhaust stacks and visor and light bar by `look`, bumper options, steer and dual
  wheels with hubs and lug detail per `look.wheels`, lift axles that rise, working head/brake/reverse lamps (emissive), dump body
  hinged at `hingeZ` with a tailgate and a load heap sized by `setLoad`. Paint: primary body, secondary on the lower panels/hood
  band, accent on the trim, stripes as separate thin meshes per `paint.stripe`. Merge static parts per material (a truck under
  ~40 draw calls), keep wheels, steering knuckles, dump bed and tailgate as moving nodes. No original branding beyond the
  brand's plain name lettering on the grille badge drawn as geometry blocks (no textures needed).

**Check:** `node scripts/trucksim-tests.mjs visual-truck` passes: every catalog truck builds on a `NullEngine` with every look
option, `update` moves wheels and the bed, and 30 build/dispose cycles return mesh, material, geometry and texture counts to the
baseline (paints held in the library aside).

---

## Wave 2 (parallel)

### Prompt 7 — Trailers, machines, cargo and work zones (Sonnet, medium effort)

**Owns:** `modules-src/trucksim/render/models/{TrailerVisual,MachineVisual,CargoVisual}.ts`, `modules-src/trucksim/render/work/WorkZones.ts`,
`tests/visual-trailer.test.ts`.

- `buildTrailerVisual(scene, parent, model, color, mats): TrailerVisual { root; meshes; update(pose: TrailerPose); setCargo(cargo:
  { visual: CargoVisual; fill: number; color: string } | null); setStraps(done: number, total: number); dispose() }`: polished
  tanker with compartments, walkway and valves; flatbed with stake pockets and tie points; grain hopper with two hoppers, gates
  and a roll tarp (`doors` opens it); reefer box with the cooling unit and swing doors (`doors`); RGN lowboy with the detachable
  gooseneck (placed from `pose.gooseneck`), well deck and rear deck; landing gear legs that extend with `landingGear`; lamps.
- `MachineVisual`: `buildExcavator` (`update(pose: ExcavatorPose)`: tracks, house, cab, boom, stick, bucket), `buildWheelLoader`
  (`update(pose: LoaderPose)`), `buildForklift` (`update(pose, mast, forks)`). Original yellow and grey liveries, no brands.
- `CargoVisual`: meshes per cargo visual (beams, coils, rebar, lumber, plywood, trusses, pipe, pallets) sized by fill, plus pooled
  falling-material particles for dumping and grain.
- `createWorkZones(scene, parent, mats, zones, heightAt): WorkZones { update(dt, activity: ReadonlyMap<string, ZoneActivity>);
  highlight(zoneIds: ReadonlySet<string>); dispose() }` with `ZoneActivity { phase: string; progress: number; machine?:
  ExcavatorPose | LoaderPose; arm?: number; flow?: number }`: painted zone outlines and cones, refinery rack with a swinging arm,
  station fill post with a hose, bin with a spout, pit grate, dock doors with bumpers and lights, crane bay beam, forklift; the AI
  excavator and loader at `dumpLoad` zones drawn from `activity.machine`.

**Check:** `node scripts/trucksim-tests.mjs visual-trailer` passes (every trailer, machine, cargo and the work zones build and
dispose back to the baseline on a `NullEngine`).

### Prompt 8 — World rendering, sky and the HDR chain (Opus)

**Owns:** `modules-src/trucksim/render/Quality.ts`, `modules-src/trucksim/render/world/{Atmosphere,Pipeline,TerrainChunks,Roads,Props,WorldRenderer}.ts`,
`tests/visual-world.test.ts`.

- `Quality.ts`: tiers `low | medium | high | ultra` with render-line cap, shadow map size and cascades, streaming radius,
  MSAA, bloom, SSAO, prop density; `resolveTier(search, backend)` (`?quality=`).
- `createAtmosphere(scene, { tier }): Atmosphere { sun; hemi; shadows; setTime(hours); night; addCaster; removeCaster;
  setQuality; update(cameraPos); dispose() }`: gradient sky dome and sun disc without custom shaders, cascaded soft shadows,
  hemispheric fill, exponential fog, an environment texture for PBR reflections built from the sky (no downloaded files; see
  `modules-src/foxlake/fp/physics/CarEnv.ts` for how Life Sim makes one), time of day from dawn to night with warm low sun.
- `createPipeline(scene, camera, tier)`: `DefaultRenderingPipeline` with HDR, ACES or neutral tone mapping, exposure and contrast
  tuned for daylight, bloom on lamps only, FXAA or MSAA by tier, sharpen, SSAO only on high and ultra (follow Rack & Reel's
  `core/EngineSetup.ts` choices so it works on WebGPU and WebGL2).
- `createWorldRenderer(scene, parent, terrain, guard, tier, layers: ChunkLayer[])`: owns its world materials (terrain, roads,
  foliage) in its own `Scope`; a `ChunkStreamer` of 256 m chunks;
  `ChunkLayer { build(cx, cz, ctx): Disposable | null }`; built-in layers: `TerrainChunks` (2 m grid near, 8 m far, vertex
  colours from `surfaceAt` with grass, dirt, gravel, field rows and site pads, normals from the height function so chunk edges
  match), `Roads` (ribbon meshes with shoulders, lane lines and edge lines as thin quads, intersections without z-fighting, lifted
  2 cm), `Props` (thin-instanced trees in clumps away from roads, sites and lots, power poles along roads, road signs at sites
  named with the site). Registers its loaded chunk count with the guard and shrinks its radius on pressure.

**Check:** `node scripts/trucksim-tests.mjs visual-world` passes: chunks build on a `NullEngine`, adjacent chunk edge heights
match, a streamer pass over 40 chunk moves and back leaves counts at the baseline.

### Prompt 9 — Site scenery and lot rendering (Sonnet, medium effort)

**Owns:** `modules-src/trucksim/render/world/Sites.ts`, `modules-src/trucksim/render/Lots.ts`, `tests/visual-sites.test.ts`.

- `createSiteLayer(scene, mats: MaterialLibrary, terrain): ChunkLayer`: for each site whose rectangle meets the chunk, original buildings by kind:
  dealership showroom with a glass front and display pad, travel center with a canopy over the pumps and a store, fuel station,
  quarry pit walls, stockpiles and a crusher, construction sites with dirt mounds, fencing and a half-built frame, equipment
  yard with a shed, refinery tanks, columns, pipe racks and a flare stack, farm house, barn and grain bins, the co-op elevator
  with concrete silos and a leg, cold storage and distribution warehouses with dock doors on the docks' face, steel mill sheds and
  stacks, lumber yard stacks and sheds, building supply store; town buildings for Millbrook along its streets. Merge per
  material per chunk. Return also `staticBoxes(siteId)` for the physics colliders of solid buildings.
- `LotRenderer(scene, parent, mats, terrain)`: `setLot(lot: LotSpec, owner: { name; company } | null, items: BuildItem[])`
  (paving, steel shop with roll-up doors every 5 m of front, pole barn, office, every add-on, fences; the lot's sign shows the
  company name on a `DynamicTexture`), `clear(index)`, `preview(lot | null, item | null, valid)` (translucent green or red
  ghost), `staticBoxes(index)`, `dispose()`.

**Check:** `node scripts/trucksim-tests.mjs visual-sites` passes (every site and every building def builds and disposes back to
the baseline).

### Prompt 10 — Interface (Sonnet, medium effort)

**Owns:** `modules-src/trucksim/ui/*`.

Plain DOM + one stylesheet (`ui/styles.css`, imported by `index.ts`), every font stack starting `'TL Fox Dollar', `, keyboard
reachable, visible focus, reduced motion respected, 44 px touch targets in menus. Each panel mounts into a root element it is
given, so Life Sim can host them.
- `Hud(root)`: speedometer and tachometer dial (canvas, drawn only when values change), gear, fuel, damage, cash, clock, the
  current job card (cargo, from → to, distance left, pay), the step list for the current procedure (done/active/next with key
  hints and a progress bar), a context prompt line, toasts, a minimap canvas the game draws into, `setVisible`, `dispose`.
- Panels returning `{ close() }`: `showStart(root, { signedIn, username, company, onStart })`, `openJobBoard(root, { jobs, profile,
  haulFor(job) → string | null, onAccept, onAbandon })`, `openDealer(root, { profile, onBuyTruck, onBuyTrailer })` (cards with
  stats, price and paint pick), `openGarage(root, { profile, truck, onSave(look), price(look) })` (live preview callback
  `onPreview(look)`), `openFleet(root, { profile, onSelect, onSell, onRepair, onRefuel })`, `openMap(root, { draw(ctx, w, h) })`,
  `openPause(root, { controls, tier, onTier, volume, onVolume, onResume })`, `openHelp(root)` (the realistic steps for every
  haul), and `BuilderBar(root, { defs, cash, onPick(def), onRotate, onColor, onDemolish, onDone })`.

**Check:** `pnpm exec tsc -p modules-src/trucksim/tsconfig.json` shows no errors in `ui/`.

---

## Wave 3 (director)

### Prompt 11 — Procedures and the job runner

**Owns:** `modules-src/trucksim/game/{Procedures,JobRunner}.ts`, `tests/procedures.test.ts`.

The realistic steps per haul as data plus checks over a `ProcedureContext` (truck, trailer, zone, key edges, LoaderAI): dump
load/unload, tanker arm connect and fill, flatbed forklift and straps, grain spout line-up and tarp, reefer dock back-in and doors,
lowboy lower/detach/drive on/reconnect/raise/chain and the reverse. `JobRunner` takes an `ActiveJob`, tracks pickup → travel →
drop, accumulates cargo damage from impacts, and calls `complete-job` when unloaded.

### Prompt 12 — Session, standalone host and the lot builder

**Owns:** `modules-src/trucksim/game/{TruckHost,TruckSession,Cameras,BuildMode,Standalone}.ts`, `modules-src/trucksim/net/Progress.ts`,
`modules-src/trucksim/index.{html,ts}`.

`TruckSession(host: TruckHost)` spawns the fleet at the lot, drives the active rig, couples and uncouples, runs the job runner and
the work-zone machines, fuel and refuelling, damage, and the dealer, garage and fleet hooks. `Standalone` builds the engine with
Rack & Reel's `createEngine` and `attachResolution`, a right-handed scene, the atmosphere, pipeline, world renderer with the
site layer, lot renderer with every claimed lot, chase/cab/build cameras, the HUD and panels, `MemoryGuard` wired to the
streamers, and disposes everything on `pagehide`. `BuildMode` is the sims-style builder over the player's own lot (top-down
orbit camera, 1 m snap, drag/place/line tools, rotate, colour, demolish, batched `build` actions). `Progress` loads and posts
`/api/trucksim` when signed in and runs `applyAction` locally for guests.

### Prompt 13 — Registration and docs (Sonnet, medium effort)

**Owns:** `src/lib/modules.ts` (catalog entries), `public/images/modules/trucksim.webp`, `docs/ENGINE-MAP.md` (new section),
`AGENTS.md` (module, route and D1 table entries), `modules-src/trucksim/README.md`.

### Prompt 14 — Verification (director, then a fresh Opus reviewer)

`pnpm assets:check`, `pnpm build`, `pnpm test`; open the module in a headless browser, drive a scripted loop for three minutes and
check `window.__truckMem()` shows no growing counts; a fresh reviewer reads the whole branch against this file and the plan;
fix everything found.

### Prompt 15 — Ship (director)

Merge `origin/main` into the branch and resolve conflicts, open the pull request with `gh api`, wait for `modules`, read and fix
any failure, squash-merge, and check `Workers Builds: thelibrary` on the new `main` commit.

---

## Later phases (not in the first release)

1. **Life Sim extension**: `modules-src/foxlake/town/TruckSim.ts` implementing `TruckHost` over `GameHost` (town root as
   `frameRoot`, the town `Physics` as `PhysicsHost`, trucks through `VehicleController.addExternal`), a Montello `HaulWorld` from
   `MontelloPlaces`, and `/api/trucksim?game=lifesim` on the shared wallet.
2. **Live presence**: a `TruckRow` Durable Object relaying other drivers' rigs at 5 Hz (stores nothing), drawn as remote rigs.
3. **AI traffic** on the highway and Main Street as a pure function of time.
4. **On foot**: walk around the rig to connect lines and chains in person.
