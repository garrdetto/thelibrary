# myWorkHelper

TanStack Start / React 19 site on Cloudflare Workers with four areas: a creative studio (AI chat, images, lyrics), an 8-ball/9-ball pool game, a racing game with two tracks, Thrill Park (an original 3D theme-park builder), and accounts/admin. Live multiplayer for pool, racing and Thrill Park runs on a separate Node service in `server/` (Railway). The initial route must render this product, never a starter demo.

## File map

### Shell and shared UI
- `src/routes/__root.tsx`: document shell, metadata, favicon.
- `src/routes/index.tsx`: navigation, studio tabs (chat, image, lyrics), saved lyric styles, theme picker; mounts pool, account, admin, and lazy-loads racing.
- `src/styles.css`: all styling, CSS tokens, site themes, responsive layouts, reduced-motion and focus states.
- `src/lib/site-themes.ts`: site theme list. `public/`: favicon and images.

### Worker backend (`src/server.ts`, `src/server/`)
- `src/server.ts`: Worker entry. `/api/*` goes to `src/server/api.ts`; everything else to TanStack Start.
- `src/server/api.ts`: route table and error handling.
- `src/server/auth.ts`: PIN hashing (PBKDF2), sessions (`tl_session` cookie), lockouts, admin constant.
- `src/server/routes/account.ts`: `/api/pool-account` (login, logout, multiplayer tickets, ticket redeem), `/api/workspace-access`, `/api/account-settings`, `/api/workspace-admin`.
- `src/server/routes/pool.ts`: `/api/pool-practice`, `/api/pool-preferences`, `/api/pool-cue-overlay`.
- `src/server/routes/racing.ts`: `/api/racing` tickets, lap records, paint profiles, AI skins.
- `src/server/routes/park.ts`: `/api/park` multiplayer tickets (prefix `park:`), ticket redeem, gzip-compressed saves (slot 0 is the 5-minute autosave, slots 1–6 are manual), and per-map net-worth leaderboards (`?scores=<scenario>`, POST `score` keeps each player's best, admin `reset-scores`). The board is `src/components/park/ParkScoreboard.tsx`.
- `src/server/routes/scores.ts`: `/api/module-scores` leaderboards for embedded modules (GET `?module=`, POST `score` / `reset-records`). Board settings live in `src/lib/module-scores.ts`.
- `src/server/routes/studio.ts` + `src/server/lyrics.ts`: `/api/studio`, `/api/library?id=` (version history only), `/api/asset`, `/api/learning`, `/api/lyric-presets`.
- `src/server/gemini.ts`: Gemini client from the `GEMINI_API_KEY` secret.
- `src/lib/studio-types.ts`: browser-safe studio types.

### Learning modules
- Site-facing copy calls everything "Learning Modules" on a site named "the library" (always lowercase). Never use the words game(s), gaming or entertainment in visible text, titles or metadata.
- `src/lib/modules.ts`: module catalog (titles, subjects, thumbnails in `public/images/modules/`). `src/components/ModuleHub.tsx`: the homepage library.
- `public/modules/*.html`: standalone modules (Sandlot Sluggers 3D, Sandlot Sluggers, BotWreck 3D, chess, checkers, 2048, Chopper Cave, Short Track Showdown) embedded in an iframe at `#module-<id>`. Sandlot Sluggers 3D (`sandlot3d.html`) loads three.js r128 from cdnjs and its roster/batter-card art from `public/modules/sprites/`. Its 3D players are built in code with human proportions, sculpted faces (eyes, brows, nose, lips), hair caps and PBR materials (`STD`, `SKIN`, `HAIR` with procedural normal maps and a PMREM sky reflection); `public/modules/faces.png` is no longer drawn on the models. Online play in these uses PeerJS room codes, not the `server/` service.
- `src/components/PoolTable.tsx`, `PoolLobby.tsx`, `CueArtwork.tsx`, `src/lib/pool-*.ts`, `src/lib/cue-design.ts`: pool.
- `src/components/Racing.tsx`, `src/lib/racing.ts`, `server/racing-engine.mjs`: racing. Max Secure Circuit (`#racing`) and Oval Speedway (`#oval`) are separate modules; each mounts `Racing` with `fixedTrack`. Their page styling uses the `--lib-*` site tokens (scoped under `.racing-content`) and the module accent from `modules.ts`.
- Thrill Park (`#park`, module id `park`): `server/park/` is the shared simulation (terrain, catalog, coaster track physics, commands, guest and staff AI, finances, snapshots; types in `index.d.mts`). `src/lib/park/` holds the dependency-free WebGL2 renderer (`gl.ts`: smooth-normal mesh builder, sun shadow map with PCF, specular/fresnel lighting, procedural ground and water shading; `models.ts`: guests built by `addPerson` with 8 walk frames plus idle, 8 looks and a near/far detail level, organic scenery; `renderer.ts`: blended terrain with ambient occlusion and shorelines, a shadow pass then the main pass via `drawWorld`), the local and online sessions (`session.ts`) and the saves client (`api.ts`). `src/components/park/ParkGame.tsx` is the menu and lobby, and `ParkHud.tsx` is the in-game interface. Thumbnail: `public/images/modules/park.webp`.
- Leaderboards: 2048, Chopper Cave and BotWreck 3D load `public/modules/module-scores.js` and call `tlScores.submit(module, value)`; it posts to `/api/module-scores` and messages the parent `{type:'tl-score-saved'}` so `ModuleScoreboard.tsx` (shown under the module frame) refreshes. Boards list every saved result, top 10, so one player can hold several places. Short Track Showdown uses the racing lap records (`LapRecordBoard`) instead.

### Accounts and admin UI
- `src/components/PoolAccount.tsx`: sign-in form. Signed-out visitors see `src/components/SignInRibbon.tsx` pinned at the top of the main panel and a highlighted sign-in form (`signin-spotlight`) at the top of every view except pool and racing, which show their own. `src/components/WorkspaceAdmin.tsx`: admin panel.

### Data
- Cloudflare D1 `thelibrary-db` (binding `DB`); schema in `migrations/`. Tables: users, sessions, login_failures, tickets, pool_preferences, pool_practice_records, racing_profiles, racing_laps, module_scores, creations, lyric_corrections, lyric_presets, park_saves, park_scores.
- Workers KV `thelibrary-files` (binding `FILES`) for binary files: `cue/<userId>`, `skin/<userId>/<asset>`, `image/<userId>/<creationId>`.
- Secrets: `ADMIN_PASSWORD`, `GEMINI_API_KEY`. Config in `wrangler.jsonc`.

### Multiplayer server (`server/`)
- `server/index.mjs`, `server/racing.mjs` and `server/park.mjs` verify players by redeeming tickets at `<site>/api/pool-account?action=redeem`, `<site>/api/racing?action=redeem` and `<site>/api/park?action=redeem`. `FRONTEND_ORIGIN` must list the site origin.

## Conventions

Use TypeScript, descriptive identifiers, React hooks, and type-only imports. Keep provider SDKs and database imports out of client modules. Server and database relative imports use `.js` extensions. Validate runtime input with Zod. Preserve the CSS token system, responsive layouts, reduced-motion support, keyboard accessibility, and loading, empty, and error states. Do not add inline comments unless requested. Prefer adding new modules over growing the already large files.

## Platform rules

- All AI runs server-side with the Gemini API key secret. Text uses `gemini-3-flash-preview`; images use `gemini-3.1-flash-image`. Never expose environment values or provider errors.
- Use D1 for structured records and KV for binary data. Never use local files, browser storage, or in-memory persistence for data that must persist.
- Schema changes go in a new numbered file in `migrations/` and are applied with `wrangler d1 migrations apply thelibrary-db --remote`.
- Non-GET endpoints check same origin. Ticket redeem endpoints are server-to-server and skip it.

## Accounts and access

- Accounts are a username (3–20 letters, numbers, `_`, `-`, stored lowercase) and a password of 3 or more characters (up to 128), hashed with a per-user salt. Older accounts created with 3 digits keep working. No registration page, email or recovery: an unknown username creates the account; a known username with the wrong digits returns "Invalid password."
- Wrong passwords lock the username after 5 attempts (15 minutes, doubling each time up to 24 hours) and the network after 25. Each network can create 10 accounts per day.
- The administrator is `stoegbauer`, whose password is the `ADMIN_PASSWORD` secret . The admin can rename accounts, grant studio pages, reset a password (next sign-in sets the new password) and delete accounts.
- Studio pages (chat, image, lyrics) require a grant from the admin. Pool and Racing require sign-in for saved data.
- Pool appearance, cue overlay, racing paint, lobby sound, site theme, saved lyric styles and lyric corrections are stored per account. There is no creation library; creations are kept only so revisions and version history work. Never include `user_id` in API responses.

## Studio rules

- Never claim chat includes live browsing or personal document retrieval.
- New lyrics, fine-tunes (`revise`), full rewrites (`revamp`), and manual edits are distinct. Fine-tunes are surgical, accumulate in `tuning`, and keep untouched lines. Revamps rewrite every line with current settings and keep the topic. Every derived version stores `parent_id`.
- Saved lyric styles store the full song settings including `instructions`, the user's standing writing directions, which the model follows as preferences under the mandatory rules.
- Explicit mode (default on) allows profanity but never slurs against protected groups.
- Artist influence and custom genres are researched server-side and cached in `research`, which is never public.
- Prompt text and instructions are ideas only: lyrics copying 4–5 word runs are regenerated once, then rejected. The validator requires bracketed sections and forbids intro lyrics.
- Image downloads are re-encoded through canvas. Serve stored images only through the ownership-checked `/api/asset`.

## Games rules

- `server/racing-engine.mjs` is shared by browser and server. Any change to it, or to server lobby/race code, requires redeploying the multiplayer service; bump the `/version` string in `server/index.mjs` and note it in `server/README.md`.
- Keep single-player and multiplayer physics identical by changing the shared engine rather than duplicating logic in `Racing.tsx`.
- Lap records are stored per track and mode. Short Track Showdown (`public/modules/shorttrack.html`) posts to `/api/racing` with track `shorttrack` (Showdown Bullring) `dells` (Dells Short Track) or `dirt` (Dells Dirt Oval, dirt handling; picked in the module menu via `?track=`) and modes `time-attack`, `race` (solo vs AI) and `multiplayer`; every completed lap by the signed-in driver is sent (every time attack lap, and every race lap until that driver takes the checkered flag), and boards list every lap, so one driver can hold several places. The truck body is the owner's race-truck model (lofted body, greenhouse, roll cage, fascia, bed wing), embedded in the module as `TM` and scaled to the physics size; liveries are conforming decal meshes on the sides, hood and roof. Race numbers come from `public/modules/shorttrack-numbers.js` (20 Google Fonts digit subsets, 11 styles plus slant, size 60–150% with 125% default, fill/outline/accent colors) and sit on their own decals on the doors, roof and tailgate; `cleanLv` keeps older liveries and older peers working (`italic` becomes `block` plus slant). `src/components/LapRecordBoard.tsx` shows the all-time top 20 per mode (tabs) under each racing module page: Max Secure Circuit and Oval Speedway via `Racing.tsx`, Short Track Showdown under its iframe. `GET /api/racing?records` is public; the module posts `{type:'tl-lap',track}` to the parent after a saved lap so the board refreshes.
- `server/park/` is shared by browser and server in the same way: change park rules there, never in the UI, and redeploy the multiplayer service afterwards. Online parks are server-authoritative: clients replay structural commands in server order, and dynamic state arrives in snapshots. Keep commands free of randomness so the replay stays identical.
- Thrill Park is an original game. Keep its names, rides, scenarios and art original; do not copy assets, names or branding from commercial games.

## Development

Install with `pnpm install`; develop with `pnpm dev`. Pushes to `main` build and deploy automatically through Workers Builds.

- Chat: floating `GroupChat` component (src/components/GroupChat.tsx) polls `/api/group-chat` (D1 `chat_messages` + `chat_presence`, migrations 0002–0003). `thread` NULL = everyone; otherwise the sorted comma list of member usernames (private chat, up to 8). Presence (who's online) comes from these polls, not Railway. Read receipts: viewing a thread posts `{action:'read', thread, id}` to `/api/group-chat` (table `chat_reads`, migration 0005, also created on first use); polls return other members' read marks and your latest message shows Sent / Seen / Seen by. A thin bar attached under the chat button shows "x players online" with a green dot and opens the Online tab; signed-out visitors get the number from the public `GET /api/group-chat?count`. Invites: `meta.invite` {module,label,code}. Embedded modules with online rooms (sandlot, chess, checkers, shorttrack) answer `postMessage({type:'tl-host'})` with `{type:'tl-room', code}` and auto-join from `?room=`. No popups or sounds: while anything is unread the chat button flashes between pink and the accent color and the browser tab icon blinks a red dot (`src/lib/use-blinking-favicon.ts`), even with reduced motion on, until the messages are read.
- Themes: midnight / slate (label Gray) / light. Hub, sidebar and chat colors come from `--lib-*` variables per theme in styles.css; old theme ids map to these in site-themes.ts.
- Record resets: each high-score board registers its currently selected tab with `useRecordResetTarget` (`src/components/AdminRecordReset.tsx`). Only the admin sees the reset button, rendered at the very bottom right of every page by `AdminRecordResetButton`; it clears just the selected board. Reset endpoints accept the admin session (the old reset password still works server-side).
