# myWorkHelper

TanStack Start / React 19 site on Netlify with four areas: a creative studio (AI chat, images, lyrics), an 8-ball/9-ball pool game, a racing game with two tracks, and accounts/admin. Live multiplayer for pool and racing runs on a separate Node service in `server/`. The initial route must render this product, never a starter demo.

## File map

### Shell and shared UI
- `src/routes/__root.tsx`: document shell, metadata, favicon.
- `src/routes/index.tsx`: top-level navigation, studio tabs (chat, image, lyrics), library, browser exports; mounts the pool table, account, admin, and lazy-loads racing.
- `src/styles.css`: all styling, CSS tokens, site themes, CSS illustrations, responsive layouts, reduced-motion and focus states.
- `src/lib/site-themes.ts`: site theme list.
- `public/favicon.svg`: brand mark. `public/images/`: track art, pool backdrops, cue and vehicle sprites.

### Studio
- `netlify/functions/studio.mts`: `/api/studio`, `/api/library`, `/api/asset`, `/api/learning`, plus pool `/api/pool-preferences` and `/api/pool-cue-overlay`.
- `src/lib/studio-types.ts`: browser-safe studio types, no server dependencies.

### Pool
- `src/components/PoolTable.tsx`: table, physics (matter-js), rules, practice modes, room/cue customization.
- `src/components/PoolLobby.tsx`: multiplayer lobby and invites over Socket.io.
- `src/components/CueArtwork.tsx`, `src/lib/cue-design.ts`, `src/lib/pool-effects.ts`: cue art and effects.
- `src/lib/pool-computer.ts`: computer opponent. `src/lib/pool-network.ts`: client networking helpers.
- `netlify/functions/pool-practice.mts`: `/api/pool-practice` practice-time records.

### Racing
- `src/components/Racing.tsx`: race UI, rendering, garage, single player and multiplayer client.
- `src/lib/racing.ts`: tracks (`circuit` = Max Secure Circuit, `oval` = Oval Speedway), vehicles, paint presets, stock-car paint.
- `server/racing-engine.mjs` (+ `.d.mts`): shared physics and AI driver, imported by both the browser and the multiplayer server.
- `netlify/functions/racing.mts`: `/api/racing` tickets, lap records, profiles/paint, AI paint generation.

### Accounts and admin
- `src/components/PoolAccount.tsx`: sign-in/sign-up UI. `src/lib/account-password.ts`: password derivation.
- `netlify/functions/pool-account.mts`: `/api/pool-account` connect and multiplayer tickets.
- `netlify/functions/lib/game-account.ts`: current user, tester account, account reset.
- `netlify/functions/lib/workspace-access.ts`: admin check and per-user studio page permissions.
- `netlify/functions/workspace-admin.mts`: `/api/workspace-access`, `/api/workspace-admin`.
- `src/components/WorkspaceAdmin.tsx`: admin UI for granting studio pages.
- `netlify/functions/lib/pool-owner.ts`: signed-in owner ID for pool data.
- `netlify/functions/identity.mts`: Identity signup validation hook.

### Data
- `db/schema.ts`: Drizzle tables: `creations`, `lyric_corrections`, `pool_preferences`, `pool_practice_records`, `racing_profiles`, `racing_tickets`, `racing_laps`, `account_resets`.
- `db/index.ts`: lazy Netlify Database adapter.
- `netlify/database/migrations/`: generated migrations, applied by Netlify at deploy.
- Blobs stores: `studio-images`, `pool-cue-overlays`, `racing-skins`.

### Multiplayer server (`server/`)
- `server/index.mjs`: Socket.io pool lobby, invites, rooms, matches; verifies players through `/api/pool-account`.
- `server/racing.mjs`: racing rooms; verifies through `/api/racing`; uses `racing-engine.mjs`.
- `server/README.md`, `server/render.yaml`: deployment docs. Deployed separately (Render/Railway), not by Netlify.

## Conventions

Use TypeScript, descriptive identifiers, React hooks, and type-only imports. Keep provider SDKs and database imports out of client modules. Server and database relative imports use `.js` extensions. Validate runtime input with Zod. Preserve the CSS token system, responsive layouts, reduced-motion support, keyboard accessibility, and loading, empty, and error states. Do not add inline comments unless requested. Prefer adding new modules over growing the already large files.

## Platform rules

- All AI runs server-side through Netlify AI Gateway. Read the `netlify-ai-gateway` skill before choosing another model. Text uses `gemini-3-flash-preview`; images use `gemini-3.1-flash-image`. Build the Gemini client inside the handler from the injected gateway configuration. Never expose environment values or provider errors.
- Use Netlify Database for structured records and Netlify Blobs for binary data. Never use local files, browser storage, external databases, or in-memory persistence for data that must persist.
- Drizzle packages stay on the beta release required by the Netlify adapter. Generate a migration after changing `db/schema.ts`; never apply migrations manually or edit applied ones.
- Function endpoints use same-origin checks and platform rate rules.

## Accounts and access

- Accounts are username/password Netlify Identity users (`<username>@players.invalid`). There is no email recovery.
- The shared tester account `test` / `garrett2341` exists on every deploy, including production; the account endpoint creates it or resets its password on demand, even when signup is disabled.
- Studio pages (chat, image, lyrics) require sign-in and a per-user grant from the workspace admin; the admin has all pages.
- Pool preferences and cue overlays use the verified account ID when signed in and the guest cookie otherwise. Racing and pool records require sign-in.
- Studio creations and lyric corrections are scoped to the opaque HTTP-only browser cookie. Never include the `owner` field in API responses.

## Studio rules

- Never claim chat includes live browsing or personal document retrieval.
- New lyrics, fine-tunes (`revise`), full rewrites (`revamp`), and manual edits are distinct. Fine-tunes are surgical, accumulate in `tuning`, and keep untouched lines. Revamps rewrite every line with current settings and keep the topic. Every derived version stores `parentId`; preserve the original topic.
- Explicit mode (default on) allows profanity but never slurs against protected groups.
- Artist influence and custom genres are researched server-side (Search grounding, model-knowledge fallback) and cached in `research`, which is never public.
- Prompt text is ideas only: lyrics copying 4–5 word runs of prompts are regenerated once, then rejected. New songs use previous lyrics only as a negative reference. The validator requires bracketed sections and forbids intro lyrics; repeated titles or exact substantial lines trigger one retry.
- The `style` action writes a Suno "Style of Music" prompt (comma-separated tags, no real artist names, max 1000 characters) in place to `style_prompt`.
- Teach-AI corrections persist per owner; "Forget previous prompts" clears client state only.
- Image downloads are re-encoded through canvas to PNG, JPEG, or WebP. Serve stored images through the ownership-checked endpoint, never a public Image CDN or object URL.

## Games rules

- `server/racing-engine.mjs` is shared by browser and server. Any change to it, or to server lobby/race code, requires redeploying the multiplayer service; bump the `/version` string in `server/index.mjs` and note it in `server/README.md`.
- Keep single-player and multiplayer physics identical by changing the shared engine rather than duplicating logic in `Racing.tsx`.
- Lap records are stored per track and mode.

## Development

Install with `pnpm install`; develop with `netlify dev --port 8889`. The platform installs, builds, and applies migrations at deploy. In the hosted build workflow, do not run builds, tests, type-checks, or dev servers unless the user's request permits them. Never inspect `.git` or create commits.
