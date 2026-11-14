# Axiom Radar

An admin-only tool that ranks Solana launches under five hours old by live Axiom viewer momentum, runner-wallet entries, buy pressure and RugCheck safety. It also runs a paper-trading loop that recalibrates its own scoring weights. It is signals only: nothing places a real order.

Open it in the admin console under **Site → Tools → Axiom Radar** (`/#admin/axiom-radar`), or full screen at `/admin/axiom-radar`.

## How it fits together

```
Your machine:   axiom-worker (PM2)
                  ├─ discovery        DexScreener + RugCheck, every 20 s
                  ├─ axiom-collector  Playwright, Axiom viewer counts, snapshots every 10 s
                  ├─ wallet-tracker   Helius, runner wallets
                  ├─ scoring          setup score, paper trades, weight recalibration
                  ├─ data/axiom-tracker.db (SQLite, WAL)
                  └─ site-publisher   POST https://thelibrary.garrdetto.workers.dev/api/admin/axiom/ingest
                                       Authorization: Bearer AXIOM_RADAR_TOKEN
                     ▼
Cloudflare Worker  stores the latest update in D1 axiom_radar_state
                     ▼
Browser (admin) ──► /api/admin/axiom/data | /stream  (tl_session admin check)
```

| Piece | Where |
| --- | --- |
| Worker suite | `scripts/axiom-tracker/` (`index.ts` runs everything; `site-publisher.ts` pushes to the site) |
| Site routes | `src/server/routes/axiom-radar.ts` and `src/server/axiom-radar-store.ts` (registered in `src/server/api.ts`) |
| Admin UI | `src/components/axiom-radar/`, the `axiom-radar` section in `src/components/AdminPanel.tsx`, and `src/routes/admin.axiom-radar.tsx` |
| Shared types | `src/lib/axiom-radar-types.ts` |

The tracker only makes outbound HTTPS requests, so nothing on your machine is exposed and no tunnel or domain is needed. The site keeps one copy of the latest radar data and per-coin details in D1 (`axiom_radar_state`, created on first use). While an administrator has the radar open, the tracker sends every 3 seconds; otherwise every 20 seconds.

## 1. Install

```bash
pnpm install
```

```bash
npx playwright install chromium
```

```bash
cp .env.example .env
```

In `.env`, set:

- `AXIOM_RADAR_TOKEN`: a long random secret (at least 24 characters), also set as a Worker secret in step 4. For example, generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- `HELIUS_API_KEY`: from https://dashboard.helius.dev. Without it, runner-wallet tracking is disabled and the rest still runs.
- `SOLANA_RPC_URL`: optional; defaults to Helius mainnet RPC.

`better-sqlite3` is a native module. pnpm is allowed to build it (`pnpm.onlyBuiltDependencies` in `package.json`). If it still fails to load, run `pnpm rebuild better-sqlite3`.

## 2. Save the Axiom session once

```bash
pnpm axiom:login
```

A visible Chromium window opens at https://axiom.trade using the persistent profile in `./axiom-session`. Sign in with your wallet or account, then close the window. The headless collector reuses that session. Run this again whenever the session expires.

Axiom sits behind Cloudflare, and Cloudflare may challenge headless browsers. When that happens, the worker logs a warning, the **axiom-collector** chip on the radar shows `cloudflare-challenge`, and snapshots continue with market data only (no viewer counts). If that keeps happening, run the collector in a visible window with your saved session by setting `AXIOM_HEADLESS=0` in `.env`. The radar does not try to bypass bot checks.

Axiom does not document its WebSocket messages, so the collector parses frames heuristically: it looks for viewer-count fields next to a tracked mint or pair address, and falls back to reading the visible "viewers" label on the token page. If the counts stay empty, set `AXIOM_DEBUG_WS=1`, let it run for a minute, and inspect `data/axiom-ws-debug.log` to adjust `viewerKeyPattern` in `scripts/axiom-tracker/axiom-collector.ts`.

## 3. Run the worker

Foreground, for a quick check:

```bash
pnpm axiom:worker
```

Each module can also run alone with `npx tsx scripts/axiom-tracker/<module>.ts` (`discovery`, `axiom-collector`, `wallet-tracker`, `scoring`, `site-publisher`).

Logs are one JSON object per line (`time`, `level`, `component`, `message`, plus fields). Set `AXIOM_DEBUG=1` for per-cycle debug lines.

## 4. Connect the site

Give the Worker the same token as `AXIOM_RADAR_TOKEN` in `.env`:

```bash
npx wrangler secret put AXIOM_RADAR_TOKEN
```

The tracker sends to `https://thelibrary.garrdetto.workers.dev` unless `AXIOM_SITE_ORIGIN` says otherwise. Until the first update arrives, the radar shows "The tracker has not sent any data yet."

## 5. Run the worker under PM2

```bash
npm install -g pm2
```

```bash
pm2 start ecosystem.axiom.config.js
```

```bash
pm2 save
```

This starts `axiom-worker` (`tsx scripts/axiom-tracker/index.ts`), restarted with exponential backoff.

Useful commands:

```bash
pm2 logs axiom-worker
```

```bash
pm2 restart axiom-worker
```

```bash
pm2 status
```

To start on boot: on Linux or macOS run `pm2 startup` and follow its printed command; on Windows use `npm install -g pm2-windows-startup` and then `pm2-startup install`.

The ecosystem file is an ES module that exports `apps`. PM2 loads it with `require()`, which needs Node 20.19+ or 22.12+.

## Model reference

- **Discovery** (every 20 s): DexScreener latest profiles, boosts, community takeovers and searches feed a watchlist. A pair must be younger than 5 h, with 5 m volume ≥ $15k, ≥ 150 transactions, liquidity ≥ $8k and buys > 45%. The top 30 by momentum are tracked. New candidates are enriched through RugCheck (`api.rugcheck.xyz/v1/tokens/<mint>/report/summary`, plus the full report for authorities and top-10 holders).
- **Collector** (every 10 s): writes a snapshot per tracked coin with viewers, price, market cap, liquidity, 5 m volume and buys/sells.
- **Wallet tracker**: when a tracked coin reaches $500k market cap or 3× its first recorded price, its first ~150 transactions are parsed through Helius and up to 40 early buyers are recorded in `smart_wallets` (`runner_hits + 1`). Wallets with `runner_hits ≥ 2` are polled for swaps, and buys of coins under 5 h old are stored in `wallet_entries`.
- **Setup score (0–100)**: a weighted average of five features in 0–1: 5 m viewer velocity (+50 viewers = 1), active viewers (log scale, 500 = 1), runner wallets (3 = 1), 5 m buy ratio (45% to 75%) and RugCheck safety. Features with no data are left out of the average.
- **Paper trades**: opened once per mint at score ≥ 75, at the latest price. The price is checked at +5, +15 and +30 minutes, and a return of +15% or more at 15 minutes is a win. Every 10 decided trades, each weight is multiplied by `exp(0.8 × (mean feature in wins − mean in losses))`, clamped to 0.2–3, and renormalised to sum to 5.
- Snapshots older than 24 h are pruned hourly.

## Data files

`data/*.db*`, `data/*.log*`, `axiom-session/` and `.env` are git-ignored. Delete `data/axiom-tracker.db*` to start fresh. Delete `axiom-session/` to sign out of Axiom.
