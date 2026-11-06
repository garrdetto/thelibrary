# Build prompt — Bush League Baseball (3D, WebGPU, multiplayer, career)

> Paste everything below the line into the site-building agent (Site Changes chat, Claude Code, or any coding agent with repo access to `garrdetto/thelibrary`). It is written to be followed in phases, one pull request per phase.

---

## Role

You are a senior graphics engineer and technical director building a AAA-quality 3D baseball learning module for **the library** (repo `garrdetto/thelibrary`). You write production TypeScript, WGSL/TSL shaders, Blender Python and Cloudflare Worker code. You ship in small, tested pull requests, and you never leave the build red.

## Before writing any code

1. Read `AGENTS.md`, then `docs/ENGINE-MAP.md`, `docs/ASSETS.md`, `docs/PERF-BASELINE.md`, `modules-src/_template/` and `modules-src/sandlot3d/`. Follow every rule in `AGENTS.md`. Where this prompt and `AGENTS.md` disagree, `AGENTS.md` wins.
2. Write a short plan to `docs/bushleague/PLAN.md` listing the phases below, the files each phase touches, and the risks. Then start Phase 1.

## Non-negotiable repo rules (from AGENTS.md)

- **Wording:** visible text, titles and metadata never use the words *game, games, gaming* or *entertainment*. The site calls everything a "Learning Module." In the UI, use *matchup*, *contest*, *season*, *first pitch*, *final* and *box score*; note that *ballgame* contains "game" and is not allowed either. Code identifiers may use any names.
- **Module layout:** the new module lives in `modules-src/bushleague/` (`index.html`, `index.ts`, `module.json`, `config.ts`, `systems/`). `vite.modules.ts` builds it into `public/modules/bushleague.html`, it is embedded in the iframe at `#module-bushleague`, and it is registered in `src/lib/modules.ts` with a thumbnail in `public/images/modules/`. Leave the existing `sandlot` and `sandlot3d` modules untouched.
- **Shared engine:** build on `engine/`: `App.ts` (three.js `WebGPURenderer` with WebGL2 fallback, a 60 Hz fixed-step loop, visibility pause, GPU teardown), `render/Quality.ts` tiers, `physics/World.ts` (Rapier WASM), `core/Input.ts`, `core/Assets.ts`. Extend the engine rather than forking it, and update `docs/ENGINE-MAP.md` in the same PR.
- **Pinned libraries only:** three.js 0.186.1, Rapier 0.14.0, meshoptimizer, colyseus.js and the rest as pinned in `package.json`, all bundled. Never load anything from a CDN. Add a dependency only with an exact version and a reason in the PR.
- **Assets:** source models go in `assets-src/models/bushleague/`; `pnpm assets` writes optimized output to `public/models/bushleague/`. Commit both. Never hand-edit `public/models/`. CI's `pnpm assets:check` must pass.
- **Data:** structured data goes in D1, binary data in KV/R2. No browser storage for anything that must persist. Schema changes go in new numbered migrations, starting at `migrations/0022_bushleague_*.sql`.
- **Secrets and AI:** every Meshy call runs server-side through `src/server/meshy.ts` using `MESHY_API_KEY`, and is admin-only. Never expose a key to the browser or to the repo.
- **Originality:** no real MLB teams, players, logos, uniforms, ballparks or broadcast branding. Everything is original.
- Non-GET endpoints check same origin. Never return `user_id` in API responses.

## Technology stack

| Layer | Choice |
|---|---|
| Renderer | three.js `WebGPURenderer` with TSL node materials and compute shaders, through `engine/core/App.ts`. Automatic WebGL2 fallback using the same materials at a lower quality tier. |
| WebAssembly | Rapier (collisions: ball vs. bat, wall, foul pole, fielder glove volumes, stadium geometry), meshoptimizer and KTX2/Basis decoders, all WASM. If profiling shows the ball-flight or AI kernels above 1 ms per frame, port them to Rust and compile them to WASM (`wasm-pack`, bundled, also loadable inside the Durable Object). Don't do that preemptively. |
| Simulation | A deterministic, pure-TypeScript rules and physics core in `modules-src/bushleague/sim/`, with no DOM, no `Math.random` (use a seeded PRNG) and no wall-clock time. The same code runs in the browser and in the Durable Object, following the pattern of `server/racing-engine.mjs` and `server/park/`. |
| Multiplayer | A new Cloudflare Durable Object class `BushLeagueMatch` (SQLite-backed, added to `wrangler.jsonc` with a migration tag), using WebSockets with hibernation, modeled on `MapleStreetWorld` and `AnglerLake`. |
| Persistence | D1: career saves, rosters, seasons, stats, ranked results. KV/R2: generated uniforms and logos. |
| Assets | Blender 4.x (headless Python scripts in `scripts/blender/bushleague/`) and the Meshy API (text-to-3D, image-to-3D, remesh, retexture, rigging, animation). |

## Graphics: target "broadcast HDR"

The module should look like a night-game TV broadcast, rendered in linear HDR.

- **Pipeline:** linear HDR float16 render targets. Tone mapping is AgX (ACES as an option), with exposure adaptation for day, dusk and night. Output is sRGB, with an HDR canvas (`toneMapping` plus `rec2100`/extended range) when the browser supports it.
- **Lighting:** physically based sun and sky (day, golden hour, night), IBL from prefiltered HDRI environment maps per stadium, and stadium light banks as instanced area or spot lights with light cookies. Cascaded shadow maps (4 cascades on high and ultra), contact shadows on players, and baked lightmaps or light probes for the static stadium.
- **Post-processing:** TAA, GTAO, SSR on wet dugout floors and scoreboard glass, physically based bloom, lens flare off the light towers, depth of field for replays and cutscenes only, per-object motion blur on the bat and ball, film grain and vignette as broadcast options. Each effect can be toggled per quality tier.
- **Field:** compute-shader grass (GPU instanced blades with wind) on high and ultra, plus a mowing-stripe pattern in the turf shader. The infield dirt uses parallax occlusion mapping, with cleat scuffs and slide marks written into a runtime decal render target. Chalk lines get worn by play.
- **Crowd:** 20–45k fans built from GPU-instanced impostors (octahedral impostors at a distance, low-poly animated meshes near the field), with team-color clothing, reactions driven by game state (stand, cheer, boo, the wave) and vertex animation textures.
- **Ball:** a high-detail ball with seams, spin visible through seam rotation, a broadcast-style pitch trail that can be toggled, and a dust puff on bounces and catches.
- **Quality tiers:** `low`, `medium`, `high` and `ultra` in `config.ts`, chosen automatically per backend (`engine/render/Quality.ts`), plus adaptive resolution (`modules-src/_shared/adaptive-resolution.js`). Budgets: ultra holds 60 fps at 1440p on a desktop RTX 3060-class GPU, and low holds 60 fps at 720p on integrated graphics and recent phones. Use one draw call per material where possible, through `static-batch.js` and instancing.

## Assets: Blender and Meshy pipeline

1. **Generate with Meshy (admin only):** extend `src/server/meshy.ts` and `src/server/routes/meshy.ts` (`TASK_PATHS`, the `meshy_jobs` table) with the rigging (`/openapi/v1/rigging`) and animation endpoints. Add a "Bush League" tab to the existing admin Meshy panel for batch jobs: player body types (lean, stocky, big-belly, tall, short), mascots, stadium props (scoreboards, light towers, dugouts, foul poles, concession stands), bats, gloves, helmets, catcher gear and bases. Keep every Meshy prompt in `assets-src/models/bushleague/prompts.json` so the generated set is reproducible.
2. **Clean up in Blender:** scripts in `scripts/blender/bushleague/` run with `blender -b -P` on the admin's machine. They remesh to budget (players under 25k triangles at LOD0, 8k at LOD1, 2k at LOD2), face +Z and stand 1.85 m tall for rigging, standardize on one shared humanoid skeleton, create uniform material slots (jersey base, trim, numbers, cap, socks) driven by team-color parameters in the shader so one mesh serves all 32 teams, bake AO, and export glTF 2.0.
3. **Rigging:** rig through Meshy, then retarget in Blender onto the shared skeleton, so every animation clip plays on every body type.
4. **Optimize:** `pnpm assets` applies meshopt compression, KTX2 textures and LOD chains. Record budgets in `docs/ASSETS.md`.

## Animation: full body, broadcast-grade

- **Sources:** Meshy's animation library for locomotion (idle, walk, jog, sprint), plus baseball-specific clips keyed or retargeted in Blender: pitching windup and stretch for each pitch type, pickoff throws, every swing type (normal, power, contact, check swing, bunt, squared bunt), catcher framing, blocking and throwing from the knees, every infielder and outfielder action (ready crouch, backhand, dive, slide, jump catch, wall climb, barehand, crow-hop throw, sidearm, relay), baserunning (lead, secondary lead, slide head-first and feet-first, pop-up slide, tag-up return), umpire calls, and celebrations (bat flip, dugout high-fives, the walk-off pile, and an angry manager arguing with the umpire).
- **Runtime:** an animation state machine per player with blend trees for locomotion, additive layers (glove arm, head look-at), foot IK and ground alignment, two-bone IK for the glove reaching the ball and the bat contact point, root motion for fielders with procedural correction toward the intercept point, and motion matching for fielding if the budget allows.
- **Physical layer:** bat-ball contact time from the swing animation curve, so timing feels exact; cloth or jiggle for jerseys on high and ultra.
- **Broadcast cameras and replays:** a center-field pitch cam, a behind-the-plate cam, dynamic follow cams on hits, a home-run trot cam, and instant replay (record sim inputs and re-simulate deterministically) with slow motion and depth of field.

## Complete baseball rules engine (`sim/`)

Implement the full Official Baseball Rules subset that a full contest needs, with unit tests for each:

- **Contest length:** 3, 6 or 9 innings, chosen at setup. Extra innings continue to a winner, with an optional automatic runner on second (house rule, on by default for 3- and 6-inning contests). Optional mercy rule (10 runs after 60% of innings). Home team doesn't bat in the bottom of the final inning when leading, and walk-offs end the contest immediately.
- **Count and plate appearances:** balls, strikes, fouls (two-strike foul rule, foul tips, foul bunt with two strikes is strike three), walks, hit-by-pitch, strikeouts including dropped third strike with first base open (or two outs), catcher's interference.
- **Batted balls:** fair and foul by first contact or bounce location, the foul pole counts as fair, ground-rule doubles, home runs, the infield fly rule (fewer than two outs, runners on first and second or bases loaded), line drives, pop-ups and fly balls with full 3D flight (drag, Magnus lift from spin axis and rpm, wind and altitude per stadium).
- **Baserunning and defense:** force and tag plays, appeals on missed bases and tag-ups leaving early, double and triple plays, sacrifice bunts and flies, fielder's choice, stolen bases and caught stealing, pickoffs, balks, wild pitches and passed balls, rundowns, obstruction and interference (simplified), errors (fielding and throwing, weighted by ratings), runner advancement AI with coach-adjustable aggressiveness.
- **Pitching:** pitch types (four-seam, two-seam, cutter, slider, sweeper, curve, changeup, splitter, knuckleball), each with velocity, spin, movement and a release-point model; pitch count, fatigue, a velocity drop, mound visits and the bullpen warm-up timer.
- **Managing:** lineups, the DH (on or off), pinch hitters and runners, defensive substitutions, double switches, pitching changes, re-entry rules.
- **Scorekeeping:** a full box score and line score, play-by-play log, scorer's decisions (hits vs. errors, earned vs. unearned runs, wins, losses, saves, holds, quality starts), and all standard batting, pitching and fielding stats.
- **Determinism:** each contest is a seeded PRNG plus a list of inputs. Replaying the inputs reproduces the contest bit for bit (this powers replays, anti-cheat and the multiplayer server). Add a test that simulates 10,000 AI-vs-AI contests headlessly and checks that league-wide averages land in realistic ranges (batting average .240–.260, roughly 4.5 runs per team per 9 innings, home runs per fly ball 10–14%).

## Controls and play modes

- **Batting:** timing and placement (a PCI cursor), with contact, power and bunt swings; a pitch-recognition mechanic tied to the batter's ratings; optional "zone" assist for newcomers.
- **Pitching:** pitch select, then a meter (or a pinpoint gesture on ultra difficulty) for location and effort, with fatigue widening the error cone.
- **Fielding:** auto-fielding with manual throws (button-per-base throws with an accuracy meter) by default, and full manual fielding as an option. Baserunning uses per-runner and all-runner advance and retreat.
- **Inputs:** keyboard and mouse, gamepad and touch through `engine/core/Input.ts`, with fully rebindable controls. Five difficulty levels plus a fully custom slider.
- **Modes:** Quick Play (vs. AI), Local Hot-Seat, Online Quick Match, Online Ranked, Private Lobby (invite through the site's chat `meta.invite`), Home Run Derby, and Career.

## Career mode ("Road to the Bigs")

- Create a player (position, body type, batting and throwing hand, face presets, walk-up song from a royalty-free list, a goofy nickname generator) or a manager (franchise mode).
- Progress from the sandlot draft through Rookie Ball, AA and AAA to the Bush Leagues (the majors). Players have an attribute progression (contact, power, eye, speed, arm, fielding, stamina, plus pitch ratings), an XP/training system, slumps and hot streaks, injuries, contract negotiations with a funny agent, trades, free agency, an All-Star break, the playoffs (wild card, division series, league championship, the "Bush League World Series") and a Hall of Fame.
- Season lengths: 20, 40, 81 or 162 contests. Unplayed contests are simulated with the headless `sim/` engine. Season stats, awards (MVP, Cy Young parody: "The Golden Spittoon"), records and news headlines are written as funny ticker items.
- Saves are server-side in D1 per account (sign-in required, using the site's existing accounts), so there is no browser-storage persistence.

## Multiplayer (Durable Object `BushLeagueMatch`)

- The server is authoritative and runs the same `sim/` code. Clients send only intents (pitch selection plus meter result, swing timing plus cursor, throw target, runner commands) with a client timestamp.
- **Latency handling:** the pitch is scheduled on both clients from the server's release timestamp. The swing timing is judged against the pitch as the batter saw it (lag compensation up to 150 ms, clamped). Field play uses snapshot interpolation at 20 Hz with client-side prediction for your own fielder.
- **Matchmaking and ranks:** Elo-based ranking stored in D1, a reconnect window of 60 seconds with AI taking over, an AFK timer, spectators, emotes and quick-chat lines (all original and funny), and a rematch button.
- **Anti-cheat:** server re-simulates from inputs and rejects impossible timings.
- Record ranked results in D1 and post module scores to the site's scoreboard (`public/modules/module-scores.js`).

## League: 32 original teams, cheeky names

Make the names PG-13 innuendo and gross-out humor, never slurs or targeted at real groups. Two leagues, four divisions, eight teams each. Each team gets an original logo (vector, generated in-house), home and away uniforms, a mascot, and a home park:

**Lowbrow League:** Uranus Astronauts · Butte Cheeks · Fartsville Thunder · Climax Closers · Intercourse Buggy Whips · Boring Bores · Hell Hot Flashes · Wet Willies · Skidmark Speedsters · Big Dumpers · Sack Lunch Sluggers · Dingleberry Dingers · Moist Towelettes · Balk Naked · Jock Itch Jackals · Swamp Butt Gators

**Gutter League:** Backdoor Sliders · Grand Salamis · Plumber's Crackers · Beer Gut Bombers · Wedgie Warriors · Mullet Mafia · Drunk Uncles · Sweaty Palms · Pitch Slaps · Hot Dog Water · Muffin Tops · Gassy Gulls · Cocktail Weenies · Spit Swappers · Toe Jam Toucans · Hung Jury

Add 400+ generated player names in the same spirit (for example "Biff Wankowski," "Moose Chowderhead," "Dusty Crotchfield," "Ricky Bobble"), built from a name-part table so the list is endlessly reproducible from a seed.

## Signature stadiums (minimum 10, each team gets one or a re-skin)

1. **The Outhouse** (Fartsville): wooden bleachers, a giant port-a-potty scoreboard that "flushes" on home runs, green fog.
2. **Uranus Orbital Dome** (Uranus): a low-gravity novelty park inside a glass dome under a ringed planet, with a hover-car parking lot and a slightly lower gravity constant (a house rule).
3. **Hellfire Yard** (Hell): a lava moat beyond the outfield wall with heat shimmer, flames shooting from the scoreboard on home runs, a pitchfork foul pole.
4. **Bayou Butt Bowl** (Swamp Butt): a swamp with live gators in the outfield pond, Spanish moss, fireflies at night, fog rolling over the outfield.
5. **Grand Salami Deli Park**: a giant sandwich-shaped scoreboard, a mustard-yellow foul pole, a hot dog cannon.
6. **Climax Carnival Field**: a Ferris wheel beyond left field and a roller coaster that loops over the bleachers.
7. **The Plumbing Supply Co. Yard**: a pipe-organ outfield wall, a geyser that erupts on home runs.
8. **Sweaty Palms Oasis**: a desert park at sunset with palm trees, a pool beyond right field, heat haze.
9. **Gutter Bowl**: a gritty industrial park under elevated train tracks, with a train that rumbles by at night.
10. **Sandlot Classic**: a small-town ballpark with a wooden fence, a cornfield beyond center, and fireflies.

Each stadium has unique dimensions (fence distances and heights, foul territory size), altitude and wind settings that affect ball flight, its own HDRI, day and night lighting presets, three LODs, light probes and a baked lightmap.

## Presentation and audio

- A broadcast HUD (score bug, count, outs, pitch speed, pitch type, base runners) in original styling; animated lower-thirds for player intros; a stats overlay; the "Gutter Report" news ticker.
- Spatial audio through Web Audio: bat crack graded by contact quality, glove pop, crowd swells tied to leverage, PA announcer lines (pre-generated, royalty-free or original), an organist, vendors, and stadium-specific ambience (gators hissing, trains, lava bubbling).
- Accessibility: colorblind-safe palettes for meters and HUD, subtitles for every voice line, reduced motion (respects `prefers-reduced-motion`), remappable controls, and a single-button batting assist.

## Performance budgets and verification

- Start-up: under 6 MB for the first contest on low, under 25 MB on ultra (stream the rest). Time to first pitch under 8 seconds on a broadband connection.
- Frame budget at ultra 1440p on an RTX 3060-class GPU: under 16.6 ms total, with sim under 1 ms, animation under 2 ms and the rest rendering. Record the figures in `docs/PERF-BASELINE.md` using `scripts/perf-baseline.mjs`.
- Memory: no leaks across 10 back-to-back contests (`engine/core/disposeObject.ts` teardown verified).
- Tests: the rules unit tests, the 10,000-contest statistical test, a determinism test (the same seed and inputs give the same box score in browser and Durable Object), a Playwright smoke test that loads the module on both WebGPU and WebGL2 and plays one 3-inning contest against AI, and `pnpm test`, `pnpm gate`, `pnpm assets:check` and `pnpm build` all passing.

## Phases (one PR each; don't start the next until the current one is green)

1. **Foundation:** module scaffold, catalog entry, `sim/` core with full rules and its tests, a gray-box field in WebGPU with placeholder capsules, playable 3/6/9-inning contests vs. AI.
2. **Graphics:** HDR pipeline, lighting, post-processing, grass, dirt, crowd, the first two stadiums, quality tiers and the performance baseline.
3. **Assets and animation:** Meshy and Blender pipeline, rigged players on the shared skeleton, the animation state machine and IK, team uniforms driven by shader parameters for all 32 teams.
4. **Presentation:** broadcast cameras, replays, HUD, audio, accessibility.
5. **Multiplayer:** the `BushLeagueMatch` Durable Object, matchmaking, ranked play in D1, lag compensation, reconnect.
6. **Career mode:** creation, progression, seasons, simulation, playoffs, saves.
7. **Content:** the remaining eight stadiums, Home Run Derby, name generator, news ticker, polish and a final performance pass.

After each phase: update `docs/ENGINE-MAP.md`, `docs/ASSETS.md`, `AGENTS.md` (add a Bush League section under Learning modules and Games rules) and `docs/bushleague/PLAN.md`, add screenshots to `docs/screenshots/bushleague/`, and list in the PR description what was built, what was tested, what's left and any Meshy credits used.
