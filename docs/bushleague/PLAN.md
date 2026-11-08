# Bush League Baseball — build plan

Module id `bushleague`, source `modules-src/bushleague/`, built to `public/modules/bushleague.html`, embedded at `#module-bushleague`. Built on `engine/` like Fairway Nine and Demo Derby. `sandlot` and `sandlot3d` are not touched.

Visible copy follows the site rules: everything is a "learning module"; a contest is a *matchup*, *contest*, *season*, *first pitch*, *final* and *box score*. Never *game*, *games*, *gaming*, *entertainment* or *ballgame*. Code identifiers are free.

## Architecture

```
modules-src/bushleague/
  sim/        deterministic rules + physics core: no DOM, no Math.random, no clock.
              Runs in the page, in node tests and (Phase 5) in the BushLeagueMatch Durable Object.
  systems/    browser-side controllers: contest driver, play playback, camera, input meters
  view/       three.js scene: field, stadium, players, ball
  ui/         DOM screens: setup, score bug, box score, play-by-play
  tests/      node --test suites bundled by scripts/bushleague-tests.mjs
```

The sim is driven by intents. A pitch is two calls: `preparePitch(intent?)` returns the actual pitch (location after control error, velocity, movement, trajectory) and `resolvePitch(swing?)` returns the play with a timeline for the renderer. `null` intents are filled by the AI. Two RNG streams (`ai` for decisions, `play` for outcomes) mean a recorded log of resolved intents replays bit for bit with the AI skipped, which is what replays, anti-cheat and the server need.

Coordinates: metres, home plate's back point at the origin, `x` toward the first-base side, `y` up, `z` toward center field. The renderer maps sim `(x, y, z)` to three.js `(x, y, -z)`.

## Phases (one pull request each, the next starts when the current one is green)

### 1. Foundation (this PR)
- Files: `modules-src/bushleague/**`, `scripts/bushleague-tests.mjs`, `package.json` (`test`), `tsconfig.engine.json`, `src/lib/modules.ts`, `public/images/modules/bushleague.webp`, `scripts/module-gate.mjs`, `docs/ENGINE-MAP.md`, `AGENTS.md`, this file.
- `sim/`: seeded PRNG, 32 teams in two leagues and four divisions, seeded name generator (400+ names), rosters and ratings, 9 pitch types, pitch and batted-ball flight (drag, Magnus lift from spin axis and rpm, wind, altitude, per-park gravity), park geometry (fence distance and height by spray angle, foul poles), contact model (timing + PCI cursor, contact / power / bunt), fielding (intercept times, catch chances, throws, errors), baserunning, the contest state machine and scorekeeping.
- Rules in Phase 1: 3/6/9 innings, extras with the optional runner on second, mercy rule, skip the bottom of the last inning when the home side leads, walk-offs; balls, strikes, fouls, two-strike fouls, foul tips, foul bunt strike three, walks, HBP, strikeouts, dropped third strike; fair/foul by landing or by passing the bag, foul pole is fair, ground-rule doubles, home runs, infield fly; force and tag plays, double plays, sacrifice bunts and flies, tag-ups, fielder's choice, steals and caught stealing, pickoffs, balks, wild pitches and passed balls, fielding and throwing errors; pitch count, fatigue, velocity drop, the bullpen warm-up, AI pitching changes and mound visits; DH on or off; pinch hitters and runners with the no re-entry rule; line score, box score, play-by-play, earned and unearned runs, W/L/S/H, quality starts.
- Deferred inside the rules list (tracked here, not silently dropped): appeals on missed bases, catcher's interference, obstruction and interference, double switches, rundown sequences (resolved as one throw), coach-adjustable runner aggressiveness in the UI.
- Gray-box field in WebGPU (WebGL2 fallback) with capsule players, ball, bases and fences; behind-the-plate batting view and center-field pitching view; play playback from the sim timeline.
- Play: Quick Play vs AI for 3, 6 or 9 innings, either side, plus "watch the AI" spectating. Batting: timing + PCI cursor, contact / power / bunt swings, steal call. Pitching: pitch select, aim and a three-press meter (start, effort, accuracy). Fielding and throws are automatic in Phase 1.
- Tests: rule unit tests, determinism (record and replay a contest to the same box score), 10,000-contest league averages.

### 2. Graphics
HDR float16 targets, AgX tone mapping (ACES option), exposure adaptation; physical sun and sky, per-park HDRI, light banks with cookies, 4-cascade shadows, contact shadows, light probes; TAA, GTAO, SSR, bloom, lens flare, motion blur, DoF (replays only), grain and vignette; compute grass and mowing stripes, parallax dirt with a runtime scuff decal target, worn chalk; instanced impostor crowd with VAT reactions; seamed ball with spin and pitch trail. First two parks (Sandlot Classic, The Outhouse). Quality tiers `low`/`medium`/`high`/`ultra` and adaptive resolution. `docs/PERF-BASELINE.md` row.
- Engine changes expected: HDR/tone-mapping options in `engine/config.ts` and `engine/core/App.ts`, a fuller `engine/render/Post.ts`. Every other module must keep rendering the same.

### 3. Assets and animation
Meshy rigging and animation endpoints in `src/server/meshy.ts` / `routes/meshy.ts` (`TASK_PATHS`, `meshy_jobs`), a Bush League batch tab in the admin Meshy panel, prompts in `assets-src/models/bushleague/prompts.json`, Blender scripts in `scripts/blender/bushleague/` (remesh to 25k/8k/2k, shared skeleton, uniform slots, AO, glTF), `pnpm assets` output in `public/models/bushleague/`, budgets in `docs/ASSETS.md`. Animation state machine, blend trees, IK (foot, glove, bat), root motion with intercept correction, team uniforms as shader parameters for all 32 teams.

### 4. Presentation and controls
Broadcast cameras, deterministic instant replay with slow motion, score bug, lower-thirds, stats overlay, Gutter Report ticker, Web Audio (bat crack by contact quality, glove pop, crowd by leverage, PA, organ, park ambience), subtitles, colorblind palettes, reduced motion, remappable controls, single-button batting assist; manual throws with an accuracy meter, full manual fielding option, per-runner advance/retreat, five difficulties plus custom sliders, hot-seat.

### 5. Multiplayer
`BushLeagueMatch` Durable Object (SQLite, hibernating WebSockets, `wrangler.jsonc` + migration tag) running `sim/`; intents only from clients; server release timestamps, 150 ms clamped lag compensation, 20 Hz snapshots with prediction for your own fielder; Elo ranking, reconnect window with AI takeover, AFK timer, spectators, emotes and quick chat, rematch; D1 migration `0022_bushleague_*.sql` for ranked results; module scores; private lobbies through chat `meta.invite`.

### 6. Career ("Road to the Bigs")
Player or manager creation, Rookie Ball → AA → AAA → the Bush Leagues, ratings progression, XP, streaks, injuries, contracts, trades, free agency, All-Star break, playoffs and the Bush League World Series, Hall of Fame; 20/40/81/162-contest seasons simulated headlessly; D1 saves per account (new migration).

### 7. Content
The remaining eight parks, Home Run Derby, news ticker copy, polish and a final performance pass.

## Risks
- **League calibration.** Batting average, runs and HR/FB come out of the contact model, the flight model and the fielding model together. The 10,000-contest test pins them; tuning lives in `sim/tuning.ts` so it is one place to adjust.
- **Test time.** 10,000 contests must stay well inside CI time; flight integration uses a fixed 1/120 s step and fielding samples the trajectory once.
- **Determinism across runtimes.** Only `+ - * /`, `Math.sqrt`, `Math.exp`, trig and integer PRNG; V8 in the browser and workerd agree. Human intents are quantized to integers before they enter the sim.
- **Scope.** Phases 2–7 are each large; each lands as its own PR with its own checks rather than one long-lived branch.
- **Local installs.** `pnpm install` in a fresh worktree is currently refused by pnpm's minimum-release-age policy for `@babylonjs/core@9.34.0` (published 2026-11-05); CI installs as usual.
- **Content tone.** Team and player names are PG-13 innuendo by request; the name tables avoid slurs and real people, and a test checks no generated name repeats a banned fragment list.

## Decisions made in Phase 1
- **Authoritative physics is the TypeScript sim, not Rapier.** Ball flight, the fence, foul poles, wall caroms and fielder reach are analytic and deterministic in `sim/`, so the same code runs in node tests and in the Durable Object without a WASM physics world. Rapier joins in Phase 2/3 for visual-only secondary physics (dust, props, cloth) where determinism does not matter.
- **Fixed 0.02 s flight step.** It matches a 0.01 s step within 2–3 feet of carry and keeps the 10,000-contest test inside CI time (about 3 minutes on 12 cores; worker threads scale it to the runner).
- **Pitch flight in the headless sim is analytic;** the full spin-integrated path (`pitchPath`) is only computed for the screen.
- **Calibration** (10,000 contests, seed 20261105): AVG .250, 4.37 runs per nine, HR/FB 13.1 %, K 21.4 %, BB 8.9 %, BABIP .295.

## Decisions made in Phase 2
- **Engine extended, opt-in.** `RendererConfig.toneMapping` and `PostConfig.effects` are optional; every other module keeps ACES and a direct render. GTAO and TRAA force a non-MSAA scene pass (WebGPU cannot gather from a multisampled depth texture; TRAA replaces MSAA).
- **Crowd attributes are packed** into two vec4 instance attributes: WebGPU caps a pipeline at 8 vertex buffers.
- **Grass is instanced, not compute-generated.** Blades are placed once on the CPU and swayed in the vertex stage; a compute pass buys nothing until blades need per-frame culling or trampling (Phase 7 polish).
- **Dirt uses single-step parallax and bump, not multi-step POM**, plus a runtime canvas for chalk and scuffs; steep POM is a Phase 7 polish item if the close-up camera needs it.
- **Crowd is low-poly instanced fans with vertex-stage reactions**, not octahedral impostors with VAT; at 45,000 fans it is still one draw call. Impostors and VAT clips come with the Phase 3 character pipeline.
- **Per-park lighting is a preset sky dome baked to a PMREM**, not an HDRI file per park; HDRIs, light probes and baked lightmaps arrive with the Phase 3 asset pipeline.
- **Deferred from the Phase 2 list:** HDR canvas output (`rec2100`), SSR, per-object motion blur, depth of field (with Phase 4 replays), automatic exposure from scene luminance (exposure eases between presets instead), and the real-GPU budget check (60 fps at 1440p ultra on an RTX 3060-class card) — software rendering here cannot measure it.

## Decisions made in Phase 3
- **Procedural bodies first, generated bodies second.** Meshy credits are spent by the admin from the Bush League tab, not by CI or a build, so the module ships procedural skinned players built on the exact skeleton and slot layout the generated ones will use; a loader swaps them in once `public/models/bushleague/` has bodies.
- **Animation is procedural keyframes on the shared skeleton** (idle, ready, crouch, run, stance, swing, bunt, pitch, throw, catch high/low, slide, celebrate) blended in Euler space with an action layer, two-bone IK for the glove and ground alignment. Meshy library clips (rigging and animation tasks are wired up) and Blender-keyed clips replace them per move as they are produced.
- **Uniform slots by height band in Blender** are a first pass; the README says to check them per body.
- **Meshy animation credit cost is an estimate** (3 per clip) until checked against Meshy's pricing page.
- **Deferred from the Phase 3 list:** motion matching, root motion from clips (fielders follow the sim's paths with stride-matched cycles), cloth and jiggle, foot IK on uneven ground (fields are flat; ground alignment covers it), the glTF player loader (no generated bodies exist yet), faces and number decals on jerseys.

## Decisions made in Phase 4
- **Replays re-run the play's timeline**, which the deterministic sim already produced, at 0.4× from a side camera with depth of field on the ball; nothing is re-simulated or recorded on the GPU.
- **Voice is the browser's speech engine with original lines**, always mirrored as subtitles; no voice files ship. Sound effects and music are synthesised.
- **Difficulty lives in the contest setup** (`aiSkill`, `pciScale` per side) so it is deterministic and replays; the calibrated league is the zero point and the 10,000-contest test is unchanged.
- **Split for review:** manual throws with an accuracy meter, full manual fielding and per-runner advance/retreat need the sim to pause a play at the fielding decision; they land as Phase 4b with their own sim tests.
- **Deferred:** motion blur on bat and ball, touch layouts for the batting cursor and meter, gamepad rebinding in the controls dialog (keys only; pads keep their defaults).

## Decisions made in Phase 5
- **Lockstep input records, not state snapshots.** The sim is deterministic, so the `BushLeagueMatch` Durable Object runs the authoritative `Contest` (`shared/Online.ts` `MatchCore`) and relays each resolved intent; both pages apply the same records with the same sim. Only the owner of a decision may send it (the batting side's pre-pitch call and swing, the fielding side's pitch); AI parts of a decision (bullpen moves, pickoffs) come from the server's own suggestion. Each record carries a state digest so a page whose maths ever drifted (another browser engine's `Math` in the last bit) notices; the stored result always comes from the server. 20 Hz snapshots and fielder prediction wait for Phase 4b, when a human controls fielders mid-play.
- **Lag compensation is local timing plus a release floor.** The batter's timing and cursor are measured on their own playback of the pitch, so latency never moves a swing. A swing that reaches the server before the pitch could have reached the plate on screen (windup plus flight at the online pace, less 10 %) is held until then, so a modified page cannot act on a pitch sooner than a person could see it. The pitcher's page waits for the swing record at the plate.
- **One fixed online difficulty:** Pro pitch speed and contact cursor for both sides, no batting assist. Ranked matchups are three innings with the DH and the extra-inning runner; private rooms take length and rules from the host's setup card.
- **Deadlines instead of AI takeover:** a silent owner gets the safe default (no steal, the AI pitch, a take) after 30 s, 45 s or 20 s past the plate. A disconnected player's decisions wait; their seat is held 90 s (the page rejoins on its own and resends a decision it had in flight), then the matchup is forfeited. Players can concede.
- **In-memory rooms like `AnglerLake`, not hibernating WebSockets.** A room holds two sockets for a few minutes; only the result is stored (D1 `bushleague_matches`, Elo in `bushleague_ratings`, migration 0022, K = 32, start 1200). Ranked needs two signed-in members; private rooms are open to guests and stored unranked.
- **Deferred from the Phase 5 list:** spectators, emotes and quick chat, AI takeover for a dropped player, a module-scores board (the ranked ladder replaces it).

## Decisions made in the texture pass (between Phases 5 and 6)
- **Textures are painted in the page, not shipped.** Grass, clay, seats, padding, wood, ball leather, markers, faces and jersey lettering are canvas-painted at load at the tier's size (512 px low to 2048 px high and ultra) and cached, so the module still downloads no images. Turf and clay pack colour and slopes into one RGBA map; computing normals on the CPU instead of `bumpMap` keeps the field shaders inside WebGPU's per-stage texture limit beside the shadow cascades (the first try lost the device on the high tier).
- **Budgets:** about 80 MB of textures on high (two 2048² detail maps with mips, wall, seat, wood and scoreboard sheets) plus 512² lettering per player; the chalk canvas stays 1024² because it re-uploads during play. One frame at the catcher's camera is 121 draw calls; measured GPU time on this machine's software adapter matched or beat the previous build in every view.
- **One plate camera.** Batting and pitching share the catcher's-eye pose (1.05 m high, 1.25 m behind the plate's back point, aimed at the middle of the strike zone); the catcher figure hides while it is up and returns for plays and replays.
- **The skin infield** now carries the 95 ft arc to both foul lines with a 1 m lip; the old wedge left first and third on grass.

## Decisions made for the Blender bodies
- **Bodies are built by a committed Blender script**, not hand-sculpted files, so every change is reproducible: `tools/build-ballplayer.py` writes three skinned bodies (lean, stocky, belly; tall and short reuse them scaled) of about 7,500 triangles and 230 KB each to `public/modules/bushleague/players/`. They ride the existing rig, animator and uniform shader unchanged; the procedural body stays as the fallback and behind `?athlete=0`.
- **Uniform slots are per face with split seams**, because an interpolated slot number passes through every slot between two neighbours (that was the red and black banding at the waist).
- **Skin weights are distance-based**, two bones per vertex, with the central torso kept off the shoulder bones so lowering the arms doesn't pinch the back.
- **Next for the bodies:** Meshy or hand-made detail swapped into the same script outputs, and face shapes per player (today the variety is in the painted sheet).

## Decisions made for the player detail pass
- **Hands, cleats, glove and bat are Blender-built too.** The hands are part of the body's skin cage (four three-jointed fingers and a thumb in a relaxed curl), decimated so a body stays near 15,000 triangles; the shoes get sole plates and eight metal spikes on two new uniform slots. The glove and bat are their own script (`tools/build-gear.py`) with vertex colours, about 3,400 and 1,700 triangles.
- **One face per player, from a seed.** `faceTexture` paints one of 48 sheets per player id (eye spacing, size and colour, brows, nose shading, lips, and facial hair for half of them), cached, so a contest holds a few dozen small canvases. The sheet is laid over the skin rather than multiplied, so eye whites read as white, and it now reaches the chin, which is where the mouth and beards had been cut off.
- **The neck sits in a crew collar.** The old flat shoulders read as a wide skin wedge; the neck is slimmer and only the column inside the collar is skin, with the collar region subdivided so the trim follows it.
- **Budget:** frame time on the software adapter stayed at or under the live build (about 37–44 ms against 52–61 ms in the same three views); WebGL2 and `?athlete=0` both run clean.

## Status
- Phase 1: done — rules core with 27 rule tests, determinism and the 10,000-contest calibration test; gray-box park, capsule players, human pitching and batting, AI and watch modes, box score; catalog entry and thumbnail. Screenshots in `docs/screenshots/bushleague/`.
- `scripts/bushleague-smoke.mjs` plays a three-inning contest to the final on WebGPU (watched) and forced WebGL2 (the page pitching and batting) after a build; it needs a local Chromium or `--channel msedge|chrome`, so it is not part of `pnpm test`.
- Phase 1 leftovers carried into later phases: appeals, catcher's interference, obstruction, double switches, multi-throw rundowns (Phase 4 with manual fielding); manual throws and per-runner baserunning (Phase 4). The `docs/PERF-BASELINE.md` row landed with Phase 1 (measured standalone; see the note there).
- Phase 2: done — AgX HDR output, the engine post chain (GTAO, TRAA, bloom, lens flare, vignette, grain), day/golden-hour/night presets with baked environment, cascaded shadows, light banks, mowed TSL turf, scuffable parallax dirt with worn chalk, instanced grass, a 4k–45k reactive crowd, seamed spinning ball and pitch trail, quality tiers with adaptive resolution, and the first two signature parks (The Outhouse, Sandlot Classic). Smoke passes on WebGPU (high tier) and WebGL2; screenshots `docs/screenshots/bushleague/phase2-*.png`.
- Phase 3: done — Meshy `rig` and `animate` tasks, the admin Bush League tab and committed prompt list, the Blender clean-up script (tested headless in Blender 5.2), rigged procedural players in club uniforms for all 32 clubs with the animation state machine and glove IK, budgets in `docs/ASSETS.md`. No Meshy credits spent; generating the set is an admin step. Screenshots `docs/screenshots/bushleague/phase3-*.png`.
- Phase 4: done (4b pending) — center-field and behind-the-plate views, home-run trot camera, automatic and on-demand replays with depth of field, lower-thirds, stats overlay, Gutter Report ticker, subtitles, synthesised sound and PA, five difficulty levels plus custom sliders, one-button batting assist, color-safe HUD, reduced-motion handling, key remapping, two players on one keyboard. Screenshots `docs/screenshots/bushleague/phase4-*.png`.
- Player detail: done — fingered hands, spiked cleats, a Blender glove and bat, a crew collar, and a seeded face per player. Screenshots `docs/screenshots/bushleague/detail-*.png`.
- Blender bodies: done — three Blender-built ballplayer bodies on the shared skeleton replace the procedural tubes. Screenshots `docs/screenshots/bushleague/blender-*.png`.
- Texture pass: done — HD painted surfaces, jersey lettering and faces, LED scoreboard, distance markers, catcher's-eye camera, full skin infield. Screenshots `docs/screenshots/bushleague/hd-*.png`.
- Phase 5: done — `BushLeagueMatch` Durable Object (ranked line and private rooms), `/api/bushleague` (WebSocket entry and the public ranked ladder), Elo and results in D1 (migration 0022), lockstep records with digests, reconnection, deadlines, forfeits, concessions, rematches, chat invites and `?room=` joins. Tests: `tests/online.test.ts` (two replicas stay identical to the authority over whole contests; ownership; early-swing hold; deadlines and pauses; Elo). Played end to end between two browser pages against the real route and Durable Object in a local harness, including a forced disconnect. Screenshots `docs/screenshots/bushleague/phase5-*.png`.
