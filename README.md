# myWorkHelper

A creative workspace with AI chat, image generation, a lyric studio, 8-ball/9-ball pool and racing, running on Cloudflare Workers.

## Accounts

Sign in with any username (3–20 letters, numbers, `_` or `-`) and a password of 3 or more characters. A new username creates the account; an existing one signs back in, and a wrong password shows "Invalid password." There is no email or recovery. Repeated wrong passwords lock the username for a while. The administrator account `stoegbauer` uses the `ADMIN_PASSWORD` secret and can grant studio access, rename, reset passwords and delete accounts.

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

## Multiplayer

Live pool and racing run on the Node service in `server/` (deployed on Railway). Set its `FRONTEND_ORIGIN` to this site's origin, for example `https://thelibrary.garrdetto.workers.dev`. The site's `VITE_POOL_SERVER_URL` build variable points at the Railway URL.
