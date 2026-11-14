# Montello landmarks and asset upgrade (Claude Code with Blender)

Paste this into Claude Code on a machine with Blender (the laptop runner: `scripts/laptop-runner/install-blender.sh`),
or into the admin console's Site changes with "Run on my laptop" ticked. Optional: `export MAPILLARY_TOKEN='MLY|…'`
first, so street photos can be used as reference.

---

Upgrade Montello's look in the garrdetto/thelibrary repo with real Blender-built models. Work end to end without
asking, following CLAUDE.md (branch `claude/montello-landmarks`, checks, pull request, squash-merge once `modules`
passes, confirm the deploy).

**Read first:** CLAUDE.md, AGENTS.md (the Tello and Fox Lake bullets and the gloss rule), docs/ENGINE-MAP.md (tello,
foxlake), docs/ASSETS.md, modules-src/tello/README.md.

**How Montello is built today:** `modules-src/tello/world/Montello.ts` builds the city inside its limits, both in Tello
and in Fox Lake (north of Fox Plains, along County Road F). Buildings are procedural shells from
`public/modules/tello/montello.json`: lidar footprints, roof type and eave/ridge heights, and roof colours from the
aerial photo (`rc`). Coordinates: map x east and z north, in metres from City Hall; scene = map + (452, 3608); y =
elevation − 228 m. The builders and physics use Tello's town frame (map x, height, −map z) and add colliders through
`StaticSink` (`world/Sink.ts`), which is what lets the same code run in Fox Lake.

**Reference sources (use these only):**
- Wikimedia Commons, "Category:Montello, Wisconsin": water tower, Municipal Building and Fire Department, downtown on
  WIS 23, Post Office, Public Library, the quarry, Granite House, the Montello Cottonwood.
- The Wisconsin Historical Society's photos, for historic shapes only.
- The lidar sizes in montello.json and the aerial roof colours.
- Mapillary, if `MAPILLARY_TOKEN` is set: the Graph API's images near each building, with their compass angle.
- Any owner photos in `assets-src/reference/tello/`.

Never use Google Street View, Maps or Earth: their terms forbid building models from them. Make the models similar,
not exact: original geometry and textures, never a traced photo. No logos, trademarks or brand colours. A business
name may appear in plain lettering only.

**Build these (Blender Python scripts in `modules-src/tello/tools/`, outputs in `assets-src/models/tello/`):**
1. **Water tower.** Add OSM `man_made=water_tower` and `waterway=waterfall` to the bake's places (`collect_pois` in
   `tools/bake_map.py`, kind `landmark`, keeping the OSM type), then rerun the bake. It uses the cache with
   `--cache .tello-cache`; the network is only needed if the cache is empty.
2. **Montello Junior-Senior High School**, on its hill (POI near map 622, 448): brick wings, main entrance, gym,
   window bands, sized to its lidar footprint and heights.
3. **Kwik Trip**: store (map 264, 45) and fuel canopy (254, 11) with pumps, the name in plain lettering.
4. **Civic buildings**: City Hall, Police and the Montello Fire Department (around map −130, 15), with apparatus bay
   doors; the Post Office (317, 2); the Public Library.
5. **The waterfalls at Montello Granite Park** (around 173, 113): granite ledges, a moving water sheet (UV-scrolled,
   Babylon-compatible material) and spray. Also the Montello Cottonwood (−187, 175) as a one-off giant tree.
6. **Downtown's historic commercial district** on Main St and West Montello St: two-storey brick storefronts with
   cornices, display windows and awnings, made as a kit fitted to each real footprint, plus the Montello Theatre
   marquee (name only).
7. **A house kit** for ordinary buildings: porches, dormers, chimneys, gutters, window and door trims, garage doors,
   better siding and brick. Buildings.ts assembles it per building from its lidar size, keeping batching.
8. **Street furniture**, placed in TypeScript from the road data: streetlights that glow at night, stop signs, street
   name signs with the real names from montello.json, power poles and lines, hydrants, mailboxes and benches.

**Wire it in:**
- **`modules-src/tello/world/Landmarks.ts`:** load the models with the glTF loader Fox Lake already uses (see
  `foxlake/fp/core/Assets.ts`). Place each on its building (match by name or by the nearest footprint to its place),
  scaled to the footprint and the lidar heights. Tell Buildings.ts to skip that building's procedural shell, and keep
  footprint colliders through `StaticSink`. It must work in Tello and in Fox Lake.
- **Assets pipeline:** `assets-src/models/tello/*.glb`, then `pnpm assets`, then commit `public/models/tello/`. Never
  hand-edit `public/models/`.
- **Scale and orientation:** metres, +Y up, origin at the footprint centre on the ground.
- **Budgets:** about 40k triangles per landmark, 2k per kit piece. Textures at most 2048², 1024² for small pieces.
- **Gloss rule:** brick, stone, concrete, roofing, wood and ground get no gloss at all. Metal, paint and tile get
  about 15 % of the usual gloss. Clear glass and water are the only exceptions.
- **Night:** windows and lamps glow at night (the `mats.nightGlow` pattern in Buildings.ts).
- **Performance:** merge by material, freeze world matrices, and register with the culler (`Montello.ready()`).

**Prove it:**
- Render a Blender preview of each model beside its reference photo to `docs/tello/landmarks/<id>.png`. Iterate until
  the proportions match the lidar.
- List every reference used, with author and licence, in `assets-src/models/tello/SOURCES.md`.
- Run `pnpm assets`, `pnpm assets:check`, `pnpm build` and `pnpm test`.
- Take screenshots with `node scripts/tello-capture.mjs` and `node scripts/foxlake-capture.mjs <url> <dir>
  montello-main-street,montello-downtown,county-road-f` (`TELLO_SOFTWARE=1` / `FOXLAKE_SOFTWARE=1` without a GPU).
  Look at each one and fix anything that floats, sinks, clips or shines.
- Update docs/ENGINE-MAP.md, modules-src/tello/README.md and AGENTS.md.
- Report what changed, the pull request link and whether it merged and deployed.
