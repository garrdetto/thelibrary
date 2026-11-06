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

## Status
- Phase 1: done — rules core with 27 rule tests, determinism and the 10,000-contest calibration test; gray-box park, capsule players, human pitching and batting, AI and watch modes, box score; catalog entry and thumbnail. Screenshots in `docs/screenshots/bushleague/`.
- `scripts/bushleague-smoke.mjs` plays a three-inning contest to the final on WebGPU (watched) and forced WebGL2 (the page pitching and batting) after a build; it needs a local Chromium or `--channel msedge|chrome`, so it is not part of `pnpm test`.
- Phase 1 leftovers carried into later phases: appeals, catcher's interference, obstruction, double switches, multi-throw rundowns (Phase 4 with manual fielding); manual throws and per-runner baserunning (Phase 4); the `docs/PERF-BASELINE.md` row via `scripts/perf-baseline.mjs` (Phase 2, once there is something to measure beyond the gray box).
