# Axiom Radar

A private, admin-only page that ranks coins by live Axiom viewers and shows price moves over 30 seconds, 1, 5 and 10 minutes, holder-quality checks from the Axiom Pulse cards, smart-holder tracking, and Buy and Watch signals from rules you set. A paper-trading loop scores the signals and tunes the score weights. It is signals only: nothing places a real order.

It is a standalone page at `/admin/axiom-radar` with its own header and none of the site's navigation. The **Axiom Radar** entry in the admin console (Site → Tools) opens it.

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

## 2. Get Axiom viewer counts

Axiom sits behind Cloudflare, which challenges browsers that are driven by automation. The radar does not try to get around that. There are two ways to collect viewer counts:

### Recommended: the Axiom Radar Bridge extension in your own Chrome

1. Set `AXIOM_COLLECTOR=extension` in `.env` and restart the worker. The automated browser is not started. The tracker listens on `127.0.0.1:8791` (`AXIOM_EXTENSION_PORT`) and accepts reports only from a Chrome extension.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the `extensions/axiom-radar-bridge` folder.
3. Open https://axiom.trade yourself (you pass Cloudflare as a person) and keep the Pulse page or token pages open. Every second the extension sends what each visible Pulse card shows (viewers, holders, dev record, holder percentages, fees, trades) to the tracker. It never clicks or navigates.

The extension's toolbar popup shows when it last sent and which coins the tracker is watching. Counts only arrive for coins whose data your open Axiom tabs receive, so keep the Pulse page and the token pages you care about open. Chrome only draws the Pulse cards that fit on screen and slows hidden tabs, so keep Pulse visible in its own window (a taller window shows more cards) for the freshest counts.

### Automated browser (`AXIOM_COLLECTOR=browser`, the default)

```bash
pnpm axiom:login
```

A visible browser opens at https://axiom.trade using the persistent profile in `./axiom-session`. Sign in, then close the window; the collector reuses that session headlessly. If Windows refuses to start Playwright's downloaded Chromium (`spawn UNKNOWN`), set `AXIOM_BROWSER_CHANNEL=chrome` (or `msedge`). If Cloudflare challenges the automated browser, the **axiom-collector** chip on the radar shows `cloudflare-challenge` and snapshots continue with market data only; switch to the extension.

Axiom does not document its WebSocket messages, so viewer counts are found heuristically: viewer-count fields next to a tracked mint or pair address, or the visible "viewers" label on a token page. If counts stay empty, set `AXIOM_DEBUG_WS=1` (browser mode) and inspect `data/axiom-ws-debug.log` to adjust `viewerKeyPattern` in `scripts/axiom-tracker/axiom-collector.ts`.

## 3. Run the worker

Foreground, for a quick check:

```bash
pnpm axiom:worker
```

Each module can also run alone with `npx tsx scripts/axiom-tracker/<module>.ts` (`discovery`, `axiom-collector`, `wallet-tracker`, `scoring`, `site-publisher`, `extension-intake`).

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

## The page

- **Gaining viewers fastest**: the three coins whose viewer count is climbing fastest right now, with live counts. A coin is flagged "gaining viewers quickly" when its viewers-per-minute gain is large for its own size (at least 10% and +5 a minute on Normal) or far above the other tracked coins. Sensitivity is a setting, not a fixed threshold.
- **Picks**: Recommended buys (coins passing every buy rule), Coins to watch, and Warnings (liquidity pulled, a sharp dump, risky authorities).
- **All coins**: every tracked coin ranked by viewers, with viewers per minute, the four price-change windows, score, quality and filters. The star pins a coin so it is always tracked.
- **Top movers**: biggest price gainers per window and biggest viewer gainers.
- **Smart wallets**: wallets among the top holders of several good coins (and, with a Helius key, early buyers of runners).
- **Paper trades**: simulated trades opened on each Buy signal, win rate and the adaptive weights.
- **Settings**: toggle and tune every requirement and rule. Saved to D1 on the site; the tracker picks them up on its next push (seconds while the page is open).
- Clicking a coin opens details: a live price-and-viewers chart from 1-second ticks, DexScreener candles, the quality checklist, score breakdown and smart holders.
- Sound and desktop alerts fire for new viewer surges and new Buy signals.
- **Chart previews**: every coin shows a small live price chart. The 30s / 1m / 5m / 10m switch beside the tabs sets the time span for all previews, and the details panel has its own switch for the live chart.
- **Appearance** (in Settings, or the palette menu at the top): follow the site theme, or use Dark blue & light blue, Dark blue & neon green, Black & light grey, or your own eight colours. Saved with the other settings.

### Update speed

The tracker refreshes prices from DexScreener and records viewers every second. When the page is open in a browser **on the PC running the tracker**, it reads `http://127.0.0.1:8791/live/stream` directly and updates every second (Chrome may ask once for permission to reach local apps; allow it). Anywhere else it falls back to the site relay, which updates every 3 seconds. The local feed only answers this site's origin and only GET requests.

## Model reference

- **Which coins are tracked**: DexScreener (latest profiles, boosts, takeovers, searches), GeckoTerminal (new and trending Solana pools) and every coin on your Axiom Pulse feed a watchlist. Coins must pass the enabled requirements in Settings (defaults: 5 m volume ≥ $3k, ≥ 40 trades, liquidity ≥ $3k, buys > 40%; no age or viewer limit). Pulse coins skip the market requirements by default. Up to 60 coins (setting) are kept, ranked by live viewers; pinned coins are always kept.
- **Pulse card data** (through the bridge, every second): viewers, holders, the dev's migrated/created record, top-10 %, dev % (or dev sold), snipers %, insiders %, bundlers %, fees paid, trades, volume and market cap.
- **Quality checklist**: top 10 under 25% (fail over 40%), dev under 5%, snipers under 10%, insiders under 10%, bundlers under 10%, fees paid of at least 3 SOL per $100K market cap (under 1 fails: likely fake volume), dev record (fails when under 5% of 10+ coins migrated), holders ≥ 500, and mint/freeze authority revoked (RugCheck). These are common trader rules of thumb, not guarantees.
- **Setup score (0–100)**: weighted average of viewer growth, active viewers, smart holders, 5 m buy pressure, and safety & holder quality. Missing features are left out.
- **Buy signal**: score, 1 m gain, 5 m gain and viewers all above the buy rules, no warnings, and (optionally) no red flags. **Watch**: surging viewers, score, 5 m gain or smart holders.
- **Smart holders**: RugCheck's top holders are stored per coin. A coin becomes "good" at $500K market cap with $20K liquidity, 2.5x since first tracked, or a paper-trade win. Wallets holding the set number of good coins are smart holders.
- **Paper trades**: opened once per mint on a Buy signal (or score ≥ 75); price checked at +5, +15 and +30 minutes; +15% at 15 minutes is a win. Every 10 decided trades the weights shift toward features stronger in winners.
- Snapshots older than 24 h and holder records older than 7 days are pruned hourly.

## Data files

`data/*.db*`, `data/*.log*`, `axiom-session/` and `.env` are git-ignored. Delete `data/axiom-tracker.db*` to start fresh. Delete `axiom-session/` to sign out of Axiom.
