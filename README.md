# myWorkHelper

A creative workspace with AI chat, image generation, a lyric studio, 8-ball/9-ball pool, racing and Thrill Park (a 3D theme-park builder), running on Cloudflare Workers.

## Accounts

Sign in with any username (3–20 letters, numbers, `_` or `-`) and a 3-digit password. A new username creates the account; an existing one signs back in, and wrong digits show "Invalid password." There is no email or recovery. Repeated wrong passwords lock the username for a while. The administrator account `stoegbauer` uses the `ADMIN_PASSWORD` secret and can grant studio access, rename, reset passwords and delete accounts.

Game appearance, cue art, car paint, lobby sound, site theme, saved lyric styles and lyric corrections follow the account. There is no saved creation library.

## Stack

TanStack Start and React 19 built with Vite and the Cloudflare Vite plugin. `src/server.ts` is the Worker entry: `/api/*` is handled in `src/server/`, everything else by TanStack Start. Data lives in D1 (`thelibrary-db`), files in Workers KV (`thelibrary-files`). AI uses the Gemini API.

## Setup

Secrets (Cloudflare dashboard → Workers & Pages → thelibrary → Settings → Variables and Secrets, type **Secret**):

- `ADMIN_PASSWORD`: password for the `stoegbauer` administrator.
- `GEMINI_API_KEY`: key from Google AI Studio for chat, images, lyrics, cue art and car skins.

Pushes to `main` build and deploy through Workers Builds. Schema changes go in a new file in `migrations/` and are applied with:

```sh
pnpm exec wrangler d1 migrations apply thelibrary-db --remote
```

Local development:

```sh
pnpm install
pnpm dev
```

## Thrill Park

A 3D theme-park builder and management game. Sculpt land and water, lay footpaths and queue lines, build eight kinds of flat rides, design roller coasters piece by piece (four track styles with chain lifts, boosters, brakes and loops, physics-based test runs with excitement, intensity and nausea ratings), and run shops and stalls. You also hire handymen, mechanics and entertainers, set prices, take out loans, run marketing campaigns, and ride your coasters with an on-ride camera. Guests have needs, preferences and thoughts. There are six solo scenarios with objectives, plus a sandbox.

Multiplayer runs on the same Node service: co-op parks for up to four players (start fresh or from a save), and versus matches for two to four players on mirrored valleys. Signed-in players get six cloud save slots. Saving needs the `park_saves` table from `migrations/0002_park_saves.sql`.

## Multiplayer

Live pool and racing run on the Node service in `server/` (deployed on Railway). Set its `FRONTEND_ORIGIN` to this site's origin, for example `https://thelibrary.garrdetto.workers.dev`. The site's `VITE_POOL_SERVER_URL` build variable points at the Railway URL.
