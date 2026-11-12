# Fox Lake — design

Date: 2026-11-11. Status: draft for owner review.

## Goal

Fox Lake is one Babylon.js game that joins the Fox Plains town and Rack & Reel's lake country into a single continuous world, with Rack & Reel's character, environment rendering and full fishing and hunting gameplay. It replaces Fox Plains 2. Rack & Reel stays a standalone game, and classic Fox Plains keeps sharing the town with Fox Lake.

### What the owner decided

| Topic | Decision |
| --- | --- |
| Name | Fox Lake, module id `foxlake`. It replaces Fox Plains 2 in the library. |
| World | One continuous world, with no loading screen between town and country (approach A). |
| Town layout | Unchanged: same lots, streets, downtown grid and buildings as `modules-src/maplestreet/shared/WorldLayout.ts`. |
| Country | Rack & Reel's map (lake, island, back bay, interstate bridge, trails, cabin, Wild Man's camp) becomes the country part of the map. |
| Shared world | The town stays shared with classic Fox Plains (same Durable Object, lots, houses, neighbors). Only Fox Lake has the country. |
| Gameplay | Full Rack & Reel gameplay in the country: fishing, hunting, boat, UTV, quad, bowfishing with Wild Man, wildlife, records. |
| Character | Every Fox Lake player is the Rack & Reel hunter, with the look and outfit saved in their Rack & Reel profile. |
| Clothing | More plain, everyday outfits in addition to the hunting and fishing ones. |
| Money | One merged wallet everywhere: Fox Plains money and Rack & Reel cash become one balance, in Fox Lake, classic Fox Plains and standalone Rack & Reel. |
| Rendering | Rack & Reel's environment methods and renderer, and the town rebuilt the way Rack & Reel's world is built, so the whole map looks consistent. |
| Assets | Vehicles and world objects remade with Blender and Meshy (they look low quality, have broken geometry and render with bad materials). |
| Quality bar | Kept optimized, and every phase checks for leaks and bottlenecks. |

## Architecture

### Module layout

```
modules-src/
  rrkit/          NEW  shared Rack & Reel kit, imported by rackreel and foxlake
    core/         engine setup, backend, resolution, shadow layers and policy, skinned model, model library
    world/        terrain (region-aware), water and waves, foliage, grass, weeds, surfaces, lighting, shaders, highway
    character/    hunter, head paint, face shape, appearance, character creator, locomotion, arm reach, grips
    play/         fishing, bowfishing, hunting, wildlife and herd, encounters, loot, records, boat, UTV, quad, Wild Man, voice
    ui/           shared HUD pieces, panels, pause-menu sections
  rackreel/       standalone game: a thin composition over rrkit (its own Game.ts, start screen, party lobby)
  foxlake/        NEW  the combined game (grown from foxplains2/babylon, which it replaces)
    core/         Fox Lake boot, region registry, streaming, budgets
    town/         the town drawn with rrkit methods (ground, roads, lots, houses, downtown, lamps, signs)
    country/      the Rack & Reel region placed in the world, plus the seam and the connector road
    physics/      the Fox Plains Rapier controllers (unchanged numbers), plus terrain heightfields
    net/          shared-world client plus the Rack & Reel party bridge
    game/         composition root, HUD, camera
  foxplains2/src/ KEPT unchanged: Kestrel County imports its PlayCanvas classes
  maplestreet/    classic Fox Plains: rules, protocol and world server, still the single authority for the town
```

- `modules-src/foxplains2/babylon/` moves into `modules-src/foxlake/`. `foxplains2/src/` stays because Kestrel County imports it.
- `src/lib/modules.ts` replaces the `foxplains2` entry with `foxlake` ("Fox Lake"). `#module-foxplains2` redirects to `#module-foxlake`. A new thumbnail goes in `public/images/modules/foxlake.webp`. `scripts/module-gate.mjs` gets `foxlake` in place of `foxplains2`.
- The rule that nothing which doesn't draw gets forked still holds: Fox Lake imports `maplestreet/shared/` and the `rrkit` play systems. It never copies them.

### World coordinates

- The town keeps its coordinates. The town square is at the origin, and the built-up area spans x ≈ −392…565 and z ≈ ±313.
- The Rack & Reel region keeps its local coordinates (a 1024 m square around its own origin). It is placed by translation only, with no rotation, at world offset `COUNTRY_ORIGIN = { x: 356, z: −1152 }`. The region then covers x −156…868 and z −1664…−640.
- At that offset, the interstate leaves the region's town-facing edge at world (87, −640), in line with East Ave (`AVE_X = 87`).
- A new two-lane county road (`foxlake/country/Connector.ts`) runs from East Ave's end of the built-up area (z ≈ −313) through the forest ring to the interstate at z = −640. It uses the interstate's grade and road cross-section.
- `rrkit/world/Terrain` takes a `Region` (origin plus edge rules). Standalone Rack & Reel uses origin (0, 0) and every edge rimmed, exactly as today. Fox Lake turns off the 42 m rim on the town-facing edge (z = +512 local) and blends heights over 96 m down to the town's ground level, so the seam has no wall or step.
- One world bound covers both areas. The fixed `WORLD_HALF` ground and caster bounds in the Fox Plains 2 code become `WORLD_BOUNDS` from the region registry.

### Rendering (Rack & Reel's methods everywhere)

- **Engine:** `rrkit/core/EngineSetup` (WebGPU, WebGL2 fallback): ACES tone mapping, fog, the cached fixed-caster and mover shadow layers following the player, and resolution adaptation.
- **Retired in Fox Lake:** Fox Plains 2's `Sky.ts`, `GroundShader.ts` and the separate lighting rig. `AvatarShader.ts` goes too, since the hunter replaces the scanned bodies.
- **Sky and clock:** `rrkit` time of day (sun, then moon) is driven by the shared world's clock in Fox Lake, and by its own 4 PM, 75-second-hour clock in standalone Rack & Reel.
- **Town ground:** Rack & Reel's vertex-coloured terrain with the tiling detail texture, over a flat heightfield in town.
  - Roads, sidewalks, curbs and driveways are built the way `rrkit/world/Highway.ts` builds the interstate: ribbons on the ground with procedural surfaces.
  - Lawns use Rack & Reel's grass field. Mowing stripes stay: the lawn atlas from `shared/Mowing.ts` feeds the grass shader's lean and cut height.
- **Trees and foliage:** Rack & Reel's foliage system (hardwood, birch, pine, ferns, weeds, cattails), with its own far versions, fills the forest ring, parks and yards. Placement rules keep it off roads, lots' building footprints and driveways.
- **Buildings and props:**
  - Downtown buildings, the gas station, Maple Body & Wheel, the freight depot, civic block, street lamps, signs, fences, mailboxes and hydrants become procedural Blender builds in Rack & Reel's pipeline: `rrkit/tools` builders produce `.rrm` models that `rrkit/core/ModelLibrary` loads.
  - Player houses stay generated at runtime from the shared build data. They use `rrkit/world/Surfaces` procedural materials and the same shader set, so they match the Blender-built town.
- **Kept from Fox Plains 2:** merged static chunks with frozen world matrices, one atlas for all shop signs, and the pool of clustered street lights at night. Each is ported onto the rrkit material set.
- **Water:** the lake, bay and channel use Rack & Reel's water and waves. The town has no water of its own.

### Physics

- Town vehicles and walking keep the Fox Plains Rapier controllers with the same numbers, so handling matches classic Fox Plains.
- The ground becomes Rapier heightfields: flat in town, and the Rack & Reel terrain in the country. Heightfields stream in 128 m tiles near the player and their vehicles, the same way Fox Plains 2 streams static colliders now.
- The boat, UTV and quad keep `rrkit` `VehicleController` (Rack & Reel's own tuning) against the same terrain heights. A town car can drive onto country roads and trails. The boat stays on water.
- The Rack & Reel cabin, stands, blinds, dock and trees get static colliders from the same tile streamer.

### Character and clothing

- `rrkit/character` (the skinned hunter, head atlas, face-shape and body sliders, creator) replaces the Fox Plains 2 avatar.
- The look and outfit are read from `/api/rackreel` (`rackreel_profiles`). A signed-in player with no character makes one in the Rack & Reel creator when they first arrive. Guests get a default look kept for the session.
- In Fox Lake, Maple Threads opens Rack & Reel's clothing catalog, paid from the merged wallet.
- **New plain outfits:** Meshy retextures of the hunter base, using the existing `HUNTER_COMBOS` approach in `builders_meshy_hunter.py`. Short sleeves and shorts use the tank-top trick of repainting exposed skin in the base tone.
  - Tops: plain white, black, heather and navy T-shirts; a graphic T-shirt; a hoodie (grey, black); an Oxford button-down; a polo; a denim jacket; a sweater.
  - Bottoms: dark and light jeans, chinos, joggers, cargo shorts.
  - Hats: plain ball cap (navy, black), beanie.
  - Each is a catalog item in `rrkit/play` Economy with group "Everyday", so it's also buyable in standalone Rack & Reel.
- Classic Fox Plains still sees Fox Lake players as Fox Plains bodies. Fox Lake sends a classic look (body and colours) with its join, alongside the Rack & Reel look id.

### Multiplayer

- Fox Lake joins the shared world (`/api/maplestreet`, Durable Object `MapleStreetWorld`) with the same protocol, identity keys and accounts. Lots, houses, money, garages and neighbors stay shared with classic Fox Plains.
- **Country positions:** `WorldServer` accepts player and vehicle positions anywhere inside `WORLD_BOUNDS`. Snapshots add `zone: 'town' | 'country'`. Classic Fox Plains hides anyone with `zone: 'country'`, since it has no terrain there. Classic players can't leave the town bounds, as today.
- **Seeing each other in the country:** everyone in the country sees everyone else there through the shared world: walking, driving, boat and UTV poses, held gear.
- **Group play:** shared boats, Wild Man's night bowfishing tours and a party's deer herd keep Rack & Reel's party system (`rrkit/play` Online over PeerJS, up to 4, invite codes, open lobbies). Fox Lake's Esc menu offers Invite, Open lobby and Join by code like Rack & Reel's, and a party only forms among Fox Lake players. Outside a party, wildlife is local to each player, as in solo Rack & Reel.
- **Time of day:** the country uses the shared world's clock. Wild Man's tours start after dark on that clock, and the "skip to dark" shortcut is removed in Fox Lake, because the shared clock can't be skipped for one player.

### Merged wallet

- **Authority:** the Fox Plains world's money for each member (held by `MapleStreetWorld`, with the $50,000 loan cap and existing rules) becomes the single balance for signed-in players.
- **Rack & Reel on the server:** `src/server/routes/rackreel.ts` stops keeping its own `cash` for signed-in players. Payouts (`fish`, `game`) and purchases (`buy`) call the Durable Object (a new internal `wallet` RPC: credit or debit by username, refusing to overdraw). All of Rack & Reel's checks stay: same-origin, Zod, cooldowns, impossible-size rejection and catalog prices.
- **One-time migration:** the first time a signed-in user's Rack & Reel profile is read after release, their R&R `cash` is credited to their Fox Plains balance. The profile records `walletMerged: true`, and the old `cash` field is zeroed. A D1 migration adds the flag; the credit is idempotent, keyed on the flag.
- **Guests:** they can't share a wallet, because Fox Plains guests are keyed by browser and Rack & Reel guests are in memory only. Guests keep today's separate balances. The merged wallet needs sign-in, and the UI says so.
- **Display:** standalone Rack & Reel, classic Fox Plains and Fox Lake all show the same balance. Rack & Reel's payouts and prices keep their current numbers. The Fox Plains starting balance ($105,000) means Rack & Reel gear is cheap by comparison, and that's accepted.
- **Records:** the record books (`rackreel_records`) are unchanged and shared by both games.

### Assets: Blender first, then Meshy

1. **Audit:** list every model in `public/models/maplestreet/` (vehicles, houses, town, characters, furniture) and the Fox Plains 2 primitive builds (mower, tires, rims), with its defects: scale against the physics spec, wheel and axle pivots, holes and normals, materials.
2. **Blender repair:** scripted fixes in `assets-src/foxlake/tools/` for scale to the physics dimensions, wheel separation and pivots at the axles, closed meshes, recalculated normals, and glass and paint material slots. Output goes to `assets-src/models/foxlake/`, then `pnpm assets`.
3. **Meshy for what can't be repaired:** a priced list goes to the owner before any credits are spent. Hero vehicles use meshy-7.1 geometry with meshy-7 textures (about 30 credits each); props use meshy-t2 with meshy-n1 (about 15 each); outfit retextures cost 10 each. Each Meshy model is cleaned in Blender to the same dimensions and pivots, so physics and handling don't change. Task ids are recorded next to the sources, as `hunter.meshy.json` does today.
4. **Rough budget, for planning only:** about 9 vehicles × 30 = 270, about 20 plain outfits × 10 = 200, about 15 props × 15 = 225, so about 700 credits. The real number comes with the priced list.

## Performance, leaks and bottlenecks

These gates apply to every phase, not only the end.

**Budgets** (desktop reference GPU on high; integrated GPU on medium):
- Frame time p95 ≤ 16.7 ms on high and ≤ 25 ms on medium, both in town and at the lake.
- Draw calls ≤ 900 on high and ≤ 600 on medium.
- Rapier step ≤ 1.5 ms.
- No shader compile after play starts (the warm-up covers town, country, every vehicle kind, the hunter with every outfit, boats, animals and gear).

**Streaming:**
- Country terrain, foliage cells, colliders and furniture load and unload by distance.
- Crossing from town to lake and back must not grow any count (see below).
- Neither area is fully resident while you're in the other, beyond the far versions.

**Leak checks** (scripted, run in `pnpm test` where possible and by a browser gate):
- After 5 round trips town → lake → town, 20 neighbors joining and leaving, 10 outfit changes, and entering and leaving every vehicle, the scene's mesh, material, texture and geometry counts and the JS heap return to within 2 % of the first lap.
- GPU memory reported by the engine stays flat.
- Event listeners and observables registered by each system are removed on dispose. A test checks each system's dispose.

**Bottleneck pass:** a performance trace at five fixed spots (downtown at dusk, the dock at night with lamps, the bridge, the forest ring, a busy street with neighbors). Results go in `docs/foxlake/PERF.md`, the way `docs/PERF-BASELINE.md` records them today.

**Tools:** `window.foxlake.debug()` (backend, active meshes, draw calls, counts, render scale, streamed tiles), the parallax memcheck and diff skills, Chrome DevTools heap snapshots, and `pnpm gate --only foxlake`.

## Phases

Each phase is its own implementation plan and pull request, merged only with the `modules` check passing.

1. **rrkit extraction.** Move the shared code out of `modules-src/rackreel/` with no behaviour change. Add `Region` to terrain. Rack & Reel's tests pass, and before/after screenshots at fixed spots and hours match.
2. **Fox Lake shell.** Rename and move Fox Plains 2 to `foxlake`, add the module entry and redirect, boot on `rrkit` EngineSetup with the shared clock, and register both regions with streaming, the seam and the connector road. The town is still drawn with the old pieces at this point. Perf and leak gates are established here.
3. **Town rebuilt with Rack & Reel methods.** Blender builders for the downtown and town props, ground, roads, lawns with mowing, foliage, houses on rrkit surfaces, lamps and signs. The Fox Plains 2 sky, ground plugin and lighting are removed.
4. **Character and clothing.** The hunter and creator in Fox Lake, looks read from the Rack & Reel profile, the classic look sent for classic Fox Plains, and Maple Threads selling the Rack & Reel catalog. The everyday outfits come after the owner approves the priced Meshy list.
5. **Country gameplay and multiplayer.** Fishing, hunting, boats, UTV, quad, Wild Man and wildlife running in the world. `zone` in snapshots and hiding in classic. The party bridge.
6. **Merged wallet.** The Durable Object wallet RPC, `/api/rackreel` switched over, the one-time migration, and the same balance shown in all three games.
7. **Assets.** Audit, Blender repair, priced Meshy list, then Meshy remakes with Blender clean-up.

Phases 3 and 4 can run in parallel after phase 2. Phase 6 doesn't depend on rendering and can run any time after phase 1.

## Testing

- **Unit tests** (node, in `pnpm test`):
  - Region transforms and the seam blend.
  - Connector road grade continuity.
  - `zone` classification.
  - Wallet RPC rules: no overdraw, loan cap, idempotent migration.
  - Rack & Reel's existing economy, loot and records tests against the merged wallet.
  - Each system's dispose.
- **Visual checks:** fixed-camera screenshots for Rack & Reel (must not change in phase 1) and Fox Lake (town, seam, lake, night).
- **Browser gate:** `pnpm gate --only foxlake` and `--only rackreel`.
- **Shared-world check:** classic Fox Plains and Fox Lake connected at the same time. They see each other in town, classic doesn't show country players, and money changes made in one appear in the other.

## Risks

| Risk | Mitigation |
| --- | --- |
| Rack & Reel regresses during extraction | Phase 1 changes nothing on screen, has screenshot comparison and existing tests, and merges on its own. |
| Two worlds' worth of content costs frames and memory | Distance streaming, far versions, merged chunks, cached shadow layers, and budgets checked every phase. |
| The wallet merge changes live balances | Idempotent, flag-keyed migration that only credits (never debits); covered by tests; the Durable Object remains the one authority. |
| The shared clock and Rack & Reel's timing differ | The clock source is a parameter of rrkit time of day; standalone keeps its clock, Fox Lake follows the world. |
| Classic Fox Plains sees out-of-bounds players | `zone` field plus hiding in classic; covered by the shared-world check. |
| Meshy spending | Nothing is spent without the owner approving a priced list. |

## Out of scope

- Build and Buy, shops, bank, dealer, body shop windows and the town map inside Fox Lake. These still live in classic Fox Plains, as they do for Fox Plains 2 now, and the side panel keeps linking to it.
- Kestrel County changes.
- Changes to standalone Rack & Reel gameplay, other than the shared wallet and the new Everyday outfits.
