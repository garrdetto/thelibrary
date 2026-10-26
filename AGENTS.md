# myWorkHelper

TanStack Start / React 19 site on Cloudflare Workers with four areas: a creative studio (AI chat, images, lyrics), an 8-ball/9-ball pool game, a racing game with two tracks, and accounts/admin. Live multiplayer for pool and racing runs on a separate Node service in `server/` (Railway). The initial route must render this product, never a starter demo.

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
- `src/server/routes/studio.ts` + `src/server/lyrics.ts`: `/api/studio`, `/api/library?id=` (version history only), `/api/asset`, `/api/learning`, `/api/lyric-presets`.
- `src/server/gemini.ts`: Gemini client from the `GEMINI_API_KEY` secret.
- `src/lib/studio-types.ts`: browser-safe studio types.

### Learning modules
- Site-facing copy calls everything "Learning Modules" on a site named The Library. Never use the words game(s), gaming or entertainment in visible text, titles or metadata.
- `src/lib/modules.ts`: module catalog (titles, subjects, thumbnails in `public/images/modules/`). `src/components/ModuleHub.tsx`: the homepage library.
- `public/modules/*.html`: standalone modules (Sandlot Sluggers, BotWreck 3D, chess, checkers, 2048, Chopper Cave) embedded in an iframe at `#module-<id>`. Online play in these uses PeerJS room codes, not the `server/` service.
- `src/components/PoolTable.tsx`, `PoolLobby.tsx`, `CueArtwork.tsx`, `src/lib/pool-*.ts`, `src/lib/cue-design.ts`: pool.
- `src/components/Racing.tsx`, `src/lib/racing.ts`, `server/racing-engine.mjs`: racing.

### Accounts and admin UI
- `src/components/PoolAccount.tsx`: sign-in form. `src/components/WorkspaceAdmin.tsx`: admin panel.

### Data
- Cloudflare D1 `thelibrary-db` (binding `DB`); schema in `migrations/`. Tables: users, sessions, login_failures, tickets, pool_preferences, pool_practice_records, racing_profiles, racing_laps, creations, lyric_corrections, lyric_presets.
- Workers KV `thelibrary-files` (binding `FILES`) for binary files: `cue/<userId>`, `skin/<userId>/<asset>`, `image/<userId>/<creationId>`.
- Secrets: `ADMIN_PASSWORD`, `GEMINI_API_KEY`. Config in `wrangler.jsonc`.

### Multiplayer server (`server/`)
- `server/index.mjs` and `server/racing.mjs` verify players by redeeming tickets at `<site>/api/pool-account?action=redeem` and `<site>/api/racing?action=redeem`. `FRONTEND_ORIGIN` must list the site origin.

## Conventions

Use TypeScript, descriptive identifiers, React hooks, and type-only imports. Keep provider SDKs and database imports out of client modules. Server and database relative imports use `.js` extensions. Validate runtime input with Zod. Preserve the CSS token system, responsive layouts, reduced-motion support, keyboard accessibility, and loading, empty, and error states. Do not add inline comments unless requested. Prefer adding new modules over growing the already large files.

## Platform rules

- All AI runs server-side with the Gemini API key secret. Text uses `gemini-3-flash-preview`; images use `gemini-3.1-flash-image`. Never expose environment values or provider errors.
- Use D1 for structured records and KV for binary data. Never use local files, browser storage, or in-memory persistence for data that must persist.
- Schema changes go in a new numbered file in `migrations/` and are applied with `wrangler d1 migrations apply thelibrary-db --remote`.
- Non-GET endpoints check same origin. Ticket redeem endpoints are server-to-server and skip it.

## Accounts and access

- Accounts are a username (3–20 letters, numbers, `_`, `-`, stored lowercase) and an exactly 3-digit password, hashed with a per-user salt. No registration page, email or recovery: an unknown username creates the account; a known username with the wrong digits returns "Invalid password."
- Wrong passwords lock the username after 5 attempts (15 minutes, doubling each time up to 24 hours) and the network after 25. Each network can create 10 accounts per day.
- The administrator is `stoegbauer`, whose password is the `ADMIN_PASSWORD` secret (not 3 digits). The admin can rename accounts, grant studio pages, reset a password (next sign-in sets new digits) and delete accounts.
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
- Lap records are stored per track and mode.

## Development

Install with `pnpm install`; develop with `pnpm dev`. Pushes to `main` build and deploy automatically through Workers Builds.
