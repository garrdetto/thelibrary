# myWorkHelper

A creative workspace with AI chat, image generation, a lyric studio, 8-ball/9-ball pool, racing, Thrill Park (a 3D theme-park builder) and more, running on Cloudflare Workers.

## Accounts

Sign in with any username (3–20 letters, numbers, `_` or `-`) and a password of 3 or more characters. A new username creates the account; an existing one signs back in, and a wrong password shows "Invalid password." There is no email or recovery. Repeated wrong passwords lock the username for a while. The administrator account `stoegbauer` uses the `ADMIN_PASSWORD` secret and can grant studio access, rename, reset passwords and delete accounts.

Game appearance, cue art, car paint, lobby sound, site theme, saved lyric styles and lyric corrections follow the account. There is no saved creation library.

## Stack

TanStack Start and React 19 built with Vite and the Cloudflare Vite plugin. `src/server.ts` is the Worker entry: `/api/*` is handled in `src/server/`, everything else by TanStack Start. Data lives in D1 (`thelibrary-db`), files in Workers KV (`thelibrary-files`). The AI chat, Image Studio and Lyric Studio run on Claude (the Claude API). Images are planned and checked by Claude and drawn by Gemini, since Claude models don't output pictures. Song Maker, cue art and car skins use the Gemini API. None of the studios accept or write code.

## Setup

Secrets (Cloudflare dashboard → Workers & Pages → thelibrary → Settings → Variables and Secrets, type **Secret**):

- `ADMIN_PASSWORD`: password for the `stoegbauer` administrator.
- `ANTHROPIC_API_KEY`: Claude API key from platform.claude.com for the AI chat, Image Studio and Lyric Studio.
- `GEMINI_API_KEY`: key from Google AI Studio for drawing images, Song Maker, cue art and car skins.
- Optional plain-text variables `CLAUDE_CHAT_MODEL` and `CLAUDE_LYRICS_MODEL` to change the chat model (default `claude-sonnet-5-5`) or lyric model (default `claude-opus-5-5`).

Pushes to `main` build and deploy through Workers Builds. Schema changes go in a new file in `migrations/` and are applied with:

```sh
pnpm exec wrangler d1 migrations apply thelibrary-db --remote
```

Local development:

```sh
pnpm install
pnpm dev
```

3D model sources are the `.glb` exports in `assets-src/models/`. `pnpm assets` (also run automatically by `pnpm dev` and `pnpm build`) compresses them into `public/models/`, which is committed so deploys don't rebuild it; `pnpm assets:report` prints the before/after table in `docs/ASSETS.md`.

## Site changes (ask Claude from the admin panel)

Admin → **Site changes** is a chat with Claude. Each message starts a GitHub Actions run. Claude edits the code there and builds the site. Then the change is either published to `main` (it goes live through Workers Builds) or opened as a pull request, if you untick *Publish automatically*. Every change it published has an **Undo** button. The panel also shows how much of your credit balance is left.

One-time setup:

1. **Pick a shared secret.** Use any long random string, for example from `openssl rand -hex 32`.
2. **GitHub → this repository → Settings → Secrets and variables → Actions:**
   - `SITE_CHANGES_SECRET`: the shared secret.
   - `ANTHROPIC_API_KEY`: from platform.claude.com. Runs draw down your API credits. Alternatively, set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) to run on a Claude Pro/Max subscription instead.
   - Optional: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, so new database migrations are applied automatically.
   - Optional repository variable `SITE_CHANGES_MODEL` to override the model. Site changes run on Claude Opus 5.5 (`claude-opus-5-5`) by default; set it to, for example, `claude-sonnet-5-5` for cheaper runs.
3. **Create a GitHub fine-grained personal access token** for this repository only, with *Actions: Read and write*.
4. **Cloudflare → Workers & Pages → thelibrary → Settings → Variables and Secrets** (type Secret):
   - `SITE_CHANGES_GITHUB_TOKEN`: the token from step 3.
   - `SITE_CHANGES_SECRET`: the same shared secret.
   - Optional `ANTHROPIC_ADMIN_KEY`: an Admin API key (`sk-ant-admin…`) to show your total API spend this month.
5. **If you want review-first changes as pull requests:** go to GitHub → Settings → Actions → General and turn on *Allow GitHub Actions to create and approve pull requests*. If `main` has branch protection that blocks direct pushes, use review-first mode.

**Run on my laptop:** tick this box under the message box to run requests on your own computer through a self-hosted GitHub Actions runner. Untick it to run on GitHub as before. If the laptop is offline, requests run on GitHub instead. Setup is in [`scripts/laptop-runner/README.md`](scripts/laptop-runner/README.md).

Anthropic doesn't expose your remaining prepaid balance through any API. Enter it once in the panel (and again after you top up), and the panel subtracts the exact cost of each request.

## Thrill Park

A 3D theme-park builder and management game. Sculpt land and water, lay footpaths and queue lines, build eight kinds of flat rides, design roller coasters piece by piece (four track styles with chain lifts, boosters, brakes and loops, physics-based test runs with excitement, intensity and nausea ratings), and run shops and stalls. You also hire handymen, mechanics and entertainers, set prices, take out loans, run marketing campaigns, and ride your coasters with an on-ride camera. Guests have needs, preferences and thoughts. There are six solo scenarios with objectives, plus a sandbox.

Multiplayer runs on the same Node service: co-op parks for up to four players (start fresh or from a save), and versus matches for two to four players on mirrored valleys. Signed-in players get six cloud save slots. Saving needs the `park_saves` table from `migrations/0006_park_saves.sql`.

## Fox Plains

A 3D neighborhood simulation in one persistent shared world. New neighbors pick a plot on the town map. They can build and furnish a house with Sims-style Build and Buy tools:

- rooms, walls, half walls and fences
- floors and wall finishes
- doors and windows, and gable, hip or flat roofs (with auto-roof)
- pools, stairs, and about 60 pieces of furniture and décor, plus basketball courts
- move, eyedropper, recolor and sledgehammer tools, with undo and redo

Around town you can drive pickups (with a trailer), a heavy-duty crew cab, a muscle coupe, a sedan, a golf cart, a four-wheeler and riding or zero-turn mowers, mow striped lawns, haul deliveries, eat downtown, fill up at the gas station and borrow from a bank with a $50,000 loan cap. Other players can never change your lot. The shared world runs on a Durable Object with its state in D1. Solo play works fully offline, and private rooms use a PeerJS code. The page is generated from `modules-src/maplestreet/`; rebuild it with `bun modules-src/maplestreet/build.mjs`.

## Multiplayer

Live pool and racing run on the Node service in `server/` (deployed on Railway). Set its `FRONTEND_ORIGIN` to this site's origin, for example `https://thelibrary.garrdetto.workers.dev`. The site's `VITE_POOL_SERVER_URL` build variable points at the Railway URL.
