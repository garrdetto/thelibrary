# the library

TanStack Start / React 19 site on Cloudflare Workers ("the library"): learning modules (3D modules built from `modules-src/`, single-file modules in `public/modules/`, and React views such as Thrill Park and Lens Creator), creative studios (AI chat, images, lyrics, voices), accounts and the admin console, plus owner-only tools (Axiom Radar, GSPro Analyzer). Live multiplayer for pool, racing, Thrill Park and Vector Arena runs on the Node service in `server/` (Railway); other online rooms use Durable Objects or PeerJS. The initial route must render this product, never a starter demo.

## Keeping these instructions small

This file loads into every session, so it holds only what applies everywhere. Details live in `docs/agents/<topic>.md`; each area's folder has a `CLAUDE.md` that imports its topic file, so it loads automatically when files there are read. Before changing an area, read its topic file if it hasn't loaded. When you change an area, update its topic file, never this one. Add to this file only rules that apply site-wide, and keep it under 25 KB. Use current names (Life Sim, not Fox Lake; the folder `modules-src/foxlake/` keeps its old name) and leave out the history of what things used to be.

## Where things are

| Area | Main code | Details |
| --- | --- | --- |
| Site shell, styles, fox dollar sign, mobile full screen, chat, themes, record resets | `src/routes/`, `src/components/`, `src/styles.css` | `docs/agents/site-ui.md` |
| Admin console, Meshy panel, image editor, clipart | `src/components/AdminPanel.tsx`, `src/components/admin/` | `docs/agents/admin-console.md` |
| Leaderboards and knocked-out notices | `src/lib/module-scores.ts`, `src/server/routes/scores.ts` | `docs/agents/leaderboards.md` |
| Studios (server side) | `src/server/studio-ai.ts`, `src/server/routes/studio.ts`, `voice.ts` | `docs/agents/studios.md` |
| Data: D1 tables, KV keys, secrets | `migrations/`, `wrangler.jsonc` | `docs/agents/data.md` |
| Site changes (admin asks Claude) | `.github/site-changes/`, `src/server/routes/site-changes.ts` | `docs/agents/site-changes.md` |
| Axiom Radar, paper bot, Solana bot | `scripts/axiom-*`, `scripts/solana-bot-api/`, `src/components/axiom-radar/` | `docs/agents/axiom.md` |
| Module build pipeline, models, Sandlot Sluggers | `vite.modules.ts`, `scripts/assets.mjs`, `modules-src/sandlot*` | `docs/agents/modules-build.md` |
| Single-file modules, Spin Rally, Skill Party, Song Maker | `public/modules/`, `modules-src/pingpong/`, `modules-src/party/` | `docs/agents/single-file-modules.md` |
| Racing (Max Secure Circuit, Oval Speedway) and pool | `src/components/Racing.tsx`, `server/racing-engine.mjs` | `docs/agents/racing.md` |
| Music player and radio | `src/components/music/` | `docs/agents/music.md` |
| GSPro Analyzer | `src/components/gspro/`, `src/lib/gspro/` | `docs/agents/gspro.md` |
| Lens Creator | `src/components/LensCreator.tsx`, `src/lib/lens-*.ts` | `docs/agents/lens.md` |
| Life Sim and the Montello builder | `modules-src/foxlake/`, `modules-src/tello/`, `src/components/world/` | `docs/agents/modules/lifesim.md` |
| Rack & Reel | `modules-src/rackreel/` | `docs/agents/modules/rackreel.md` |
| Fox Plains (classic) | `modules-src/maplestreet/` | `docs/agents/modules/maplestreet.md` |
| Thrill Park and Thrill Park 2 | `server/park/`, `src/lib/park/`, `src/lib/park2/` | `docs/agents/modules/park.md` |
| Short Track Showdown | `modules-src/shorttrack/` | `docs/agents/modules/shorttrack.md` |
| Darts | `modules-src/darts/` | `docs/agents/modules/darts.md` |
| The Hood | `modules-src/hood/` | `docs/agents/modules/hood.md` |
| Bush League Baseball | `modules-src/bushleague/` | `docs/agents/modules/bushleague.md` |
| Demo Derby | `modules-src/demoderby/` | `docs/agents/modules/demoderby.md` |
| Fairway Nine | `modules-src/fairway/` | `docs/agents/modules/fairway.md` |
| Northwoods Angler | `modules-src/angler/` | `docs/agents/modules/angler.md` |
| Vector Arena | `modules-src/arena/`, `server/arena/` | `docs/agents/modules/arena.md` |
| Kestrel County | `modules-src/county/` | `docs/agents/modules/county.md` |
| Pro Skater AI | `modules-src/proskater/` | `docs/agents/modules/proskater.md` |
| Bridge Builder | `modules-src/bridge/` | `docs/agents/modules/bridge.md` |
| Truck Simulator | `modules-src/trucksim/`, `src/server/routes/trucksim.ts` | `docs/agents/modules/trucksim.md` |
| Sun Vault, Beanstalk Bounty, Mo' Dollaz | `modules-src/sunvault/`, `beanstalk/`, `modollaz/` | `docs/agents/modules/slots.md` |

The 3D code index is `docs/ENGINE-MAP.md`; the shared 3D engine is `engine/`.

### Core files
- `src/routes/__root.tsx`: document shell, metadata, favicon.
- `src/routes/index.tsx`: navigation, studio tabs (chat, image, lyrics, voice), saved lyric styles, theme picker; mounts pool, account, admin, and lazy-loads racing.
- `src/lib/site-themes.ts`: site theme list. `public/`: favicon and images.
- `src/server.ts`: Worker entry. `/api/*` goes to `src/server/api.ts`; everything else to TanStack Start.
- `src/server/api.ts`: route table and error handling.
- `src/server/auth.ts`: PIN hashing (PBKDF2), sessions (`tl_session` cookie), lockouts, admin constant.
- `src/server/routes/account.ts`: `/api/pool-account` (login, logout, multiplayer tickets, ticket redeem), `/api/workspace-access`, `/api/account-settings`, `/api/workspace-admin`.
- `src/server/routes/pool.ts`: `/api/pool-practice`, `/api/pool-preferences`, `/api/pool-cue-overlay`.
- `src/server/routes/racing.ts`: `/api/racing` tickets, lap records, paint profiles, AI skins.
- Cloudflare D1 `thelibrary-db` (binding `DB`) for records, Workers KV `thelibrary-files` (binding `FILES`) for binary files; every table, key and secret is listed in `docs/agents/data.md`.
- `server/index.mjs`, `server/racing.mjs` and `server/park.mjs` verify players by redeeming tickets at `<site>/api/pool-account?action=redeem`, `<site>/api/racing?action=redeem` and `<site>/api/park?action=redeem`. `FRONTEND_ORIGIN` must list the site origin.
- `empire/` is The King's Empire, a separate project with its own rules in `empire/CLAUDE.md`: a plan and Claude Code kit for an AI-agent business and its Command Center console. Nothing in the site builds, tests or imports it. The console is deployed on its own Cloudflare Worker `kingdom` (`empire/wrangler.jsonc`, `empire/worker.js`; static assets from `empire/prototype/`, no bindings), which Workers Builds runs from root `/empire` with watch path `empire/*`. Keep site code, bindings and Durable Objects out of it.

## Learning modules

- Site-facing copy calls everything "Learning Modules" on a site named "the library" (always lowercase). Never use the words game(s), gaming or entertainment in visible text, titles or metadata.
- Engines (three.js 0.186.1, Babylon.js 9.34.0, PlayCanvas 2.23.3, Rapier, PeerJS, colyseus.js, cannon-es) are pinned in `package.json` and bundled; never load them from a CDN. Import Babylon.js by path (`@babylonjs/core/Engines/engine` and so on), never from the package root.
- Module pages are built from `modules-src/<id>/` into `public/modules/` by `vite.modules.ts` (generated files are git-ignored). Models in `assets-src/models/` are optimized into the committed `public/models/` by `pnpm assets`: after changing a source model, run it and commit `public/models/` too (CI's `pnpm assets:check` fails otherwise); never hand-edit `public/models/`.
- Keep each module's rules in its renderer-free, deterministic `shared/` or `sim/` code where it has one, because Durable Objects and tests run it too.
- Every module is embedded in an iframe at `#module-<id>`; the catalog is `src/lib/modules.ts`.

## Conventions

Use TypeScript, descriptive identifiers, React hooks, and type-only imports. Keep provider SDKs and database imports out of client modules. Server and database relative imports use `.js` extensions. Validate runtime input with Zod. Preserve the CSS token system, responsive layouts, reduced-motion support, keyboard accessibility, and loading, empty, and error states. Do not add inline comments unless requested. Prefer adding new modules over growing the already large files.

Gloss rule (all 3D modules, from the owner): never put a glossy finish or glossy texture on a surface that shouldn't shine (roads, asphalt, concrete, ground, grass, dirt, brick, stone, wood, roofing, cloth, skin, hair): give it no gloss and no specular highlight. On objects that should be glossy (tile, marble, varnish, metal, paint), use about 15 % of the gloss you would normally use. Water and clear glass are the only exceptions. In Fox Lake this is `GLOSS_SHARE`, `surfaceGloss` and `ruledRoughness` in `modules-src/foxlake/fp/core/Tex.ts`; new town materials go through them.

## Platform rules

- All AI runs server-side. The studios (AI chat, Image Studio, Lyric Studio) run on Gemini with the `GEMINI_API_KEY` Worker secret through `src/server/studio-ai.ts`: chat and lyrics are written by `gemini-3-flash-preview`, which also vets every image request and writes its render instruction before `gemini-3.1-flash-image` draws it. Claude (`ANTHROPIC_API_KEY`) is used only by the Short Track paint designer and the site-change runs. The Voice Generator uses ElevenLabs with the `ELEVENLABS_API_KEY` Worker secret. Studios never accept or produce code (see `src/server/code-guard.ts`); each studio is only for what its name says. The rest of the site uses Gemini with the Gemini API key secret, and Meshy 3D generation (admin only) with `MESHY_API_KEY`. Text uses `gemini-3-flash-preview`; images use `gemini-3.1-flash-image`; songs use Lyria (`lyria-3.5`, `lyria-3-clip-preview`). Song Maker exception: its free mode needs no key; `public/modules/songmaker-synth.js` builds the instrumental in the browser with Web Audio, and `write` falls back to the keyless Pollinations text API, then to the offline template writer in `src/server/keyless-lyrics.ts`. Never expose environment values or provider errors.
- Use D1 for structured records and KV for binary data. Never use local files, browser storage, or in-memory persistence for data that must persist.
- Axiom Radar exception: the self-hosted tracker and paper-trading bot keep their working data in SQLite on the owner's machine (`data/`); do not move other features onto it.
- Schema changes go in a new numbered file in `migrations/` and are applied with `wrangler d1 migrations apply thelibrary-db --remote`.
- Non-GET endpoints check same origin. Ticket redeem endpoints, the Axiom Radar ingest and the paper-trading bot's sync are server-to-server and skip it.

## Accounts and access

- Accounts are a username (3–20 letters, numbers, `_`, `-`, stored lowercase) and a password of 3 or more characters (up to 128), hashed with a per-user salt. Older accounts created with 3 digits keep working. No registration page, email or recovery: an unknown username creates the account (no access code; new accounts are limited per network per day by `NEW_ACCOUNTS_PER_NETWORK`); a known username with the wrong digits returns "Invalid password."
- Wrong passwords lock the username after 5 attempts (15 minutes, doubling each time up to 24 hours) and the network after 25. Each network can create 10 accounts per day.
- The owner is the account with `users.is_admin = 2` (first created as `stoegbauer`, migration 0033; a legacy `is_admin = 1` row named `stoegbauer` counts too and is upgraded on sign-in). The owner signs in with the `ADMIN_PASSWORD` secret under whatever username they have, can change their own username in People & permissions, and can make other accounts administrators (`is_admin = 1`, `set-admin` on `/api/workspace-admin`) or remove them. Signing in as `stoegbauer` with the owner password still reaches the owner after a rename, and nobody else can take that name. Administrators sign in with their own password and get the full console (`isAdmin`); only the owner (`isOwner`) can change, reset or delete another administrator, and nobody can reset, demote or delete the owner. Admins can rename accounts, grant studio pages, the music player and hidden modules, reset a password (next sign-in sets the new password) and delete accounts.
- Per-user access is the JSON grant list in `users.pages` (`src/lib/access.ts`, Zod-checked by `grantPattern`): studio pages (`chat`, `image`, `lyrics`, `voice`), `axiom-radar` (only the owner can grant it), `music` plus optional `music:<trackId>`, and `module:<id>` to show a module hidden in Module order to that person (the `/api/module-layout` GET drops granted modules from `hidden` for that viewer). `toSessionUser` exposes `pages`, `grants` and `radar`. People & permissions (`src/components/WorkspaceAdmin.tsx`) is a searchable list; clicking a person opens `src/components/admin/PersonAccess.tsx` (deep link `#admin/people/<userId>`), which saves everything with one `update` on `/api/workspace-admin`.
- Studio pages (chat, image, lyrics, voice) require a grant from the admin. Pool and Racing require sign-in for saved data.
- Pool appearance, cue overlay, racing paint, lobby sound, site theme, saved lyric styles and lyric corrections are stored per account. There is no creation library; creations are kept only so revisions and version history work. Never include `user_id` in API responses.

## Studio rules

- Never claim chat includes live browsing or personal document retrieval.
- No code in any studio: chat, images and lyrics refuse requests for code, scripts, commands or markup, reject inputs that contain code, and discard any output that looks like code. Each studio stays on its own purpose (chat converses, Image Studio makes and edits pictures, Lyric Studio writes lyrics).
- Lyrics are written in plain, literal, logical everyday language: no metaphors, similes, personification, invented phrases or forced rhymes; only common expressions people really say. `songwriterInstruction` holds these rules and `clichesIn` triggers one rewrite when stock phrasing slips through.
- New lyrics, fine-tunes (`revise`), full rewrites (`revamp`), and manual edits are distinct. Fine-tunes are surgical, accumulate in `tuning`, and keep untouched lines. Revamps rewrite every line with current settings and keep the topic. Every derived version stores `parent_id`.
- Saved lyric styles store the full song settings including `instructions`, the user's standing writing directions, which the model follows as preferences under the mandatory rules.
- Explicit mode (default on) allows profanity but never slurs against protected groups.
- Artist influence and custom genres are researched server-side and cached in `research`, which is never public.
- Prompt text and instructions are ideas only: lyrics copying 4–5 word runs are regenerated once, then rejected. The validator requires bracketed sections and forbids intro lyrics.
- Image downloads are re-encoded through canvas (older SVG pictures can also be saved as SVG). Serve stored images only through the ownership-checked `/api/asset`, with the sandbox CSP for SVG.
- The Voice Generator only designs voices and reads text aloud; it refuses code like the other studios. Deleting a voice removes it from the ElevenLabs account and can't be undone, so the page confirms first.

## Games rules

- Shared engines are the single authority, used by both browser and server: `server/racing-engine.mjs` (racing), `server/park/` (Thrill Park), `modules-src/bushleague/sim/` (Bush League). Change rules there, never in the UI. A change to `server/` needs the multiplayer service redeployed; bump `/version` in `server/index.mjs` and note it in `server/README.md`.
- Keep online simulations free of randomness outside their seeded streams so replays stay identical.
- Every module is original: no names, characters, art, logos, uniforms or branding from commercial games, real teams, real brands or vehicles.

## Development

Read docs/ENGINE-MAP.md before changing any module; keep it current. The shared 3D engine is `engine/` (barrel `engine/index.ts`); a new 3D module starts as a copy of `modules-src/_template/` renamed without the `_`, and `pnpm engine:smoke` checks the template in a hub-like iframe.

Install with `pnpm install`; develop with `pnpm dev`. Everything `pnpm build` and the deploy command need (Vite and its plugins, esbuild, sharp, wrangler) is in `dependencies`, not `devDependencies`, because Workers Builds installs with `NODE_ENV=production` and skips devDependencies; keep it that way when adding build tooling. `pnpm build` runs Vite with a 6 GB Node heap (`--max-old-space-size=6144`) as headroom on Workers Builds' 8 GB machines. Import Babylon.js by path (`@babylonjs/core/Engines/engine` and so on), never from `@babylonjs/core` itself: the package root pulls in the whole library and every shader (about 3,150 modules, a 7 MB chunk), which pushed the build past Node's default heap of about 2 GB; imported by path, the build fits in that default. Every change reaches `main` through a pull request: the `modules` workflow (`.github/workflows/modules.yml`) runs `pnpm assets:check`, `pnpm build` and `pnpm test`, and `main` requires it. `pnpm gate` (`scripts/module-gate.mjs`) loads every embedded module in the hub iframe with Playwright and reports console errors and screenshots. The 3D code index is `docs/ENGINE-MAP.md`; update it whenever a file it lists changes. Pushes to `main` build and deploy automatically through Workers Builds. When Workers Builds can't deploy, the manual `Deploy site` workflow (`.github/workflows/deploy-site.yml`, Actions → Run workflow) builds `main` and runs `wrangler deploy` with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
