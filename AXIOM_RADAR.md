# Axiom Radar

A page that ranks coins by live Axiom viewers and shows price moves over 30 seconds, 1, 5 and 10 minutes, holder-quality checks from the Axiom Pulse cards, smart-holder tracking, and Buy and Watch signals from rules you set. A paper-trading loop scores the signals. It is signals only: nothing places a real order.

It is a standalone page at `/axiom-radar` with its own header. The **Axiom Radar** tab pinned to the bottom-left corner of the base site opens it, and so does the entry in the admin console (Site → Tools); the old `/admin/axiom-radar` address redirects. Anyone can watch it, signed in or not. Pinning coins, saving settings and controlling the paper-trading bot stay with the administrator: other visitors see those read-only, and the site refuses the changes.

## How it fits together

```
Your machine:   axiom-worker (PM2)
                  ├─ discovery        DexScreener + RugCheck + Jupiter movers, every 20 s
                  ├─ jupiter          holder counts and growth, top-holder and dev shares, who is trading, every 4 s
                  ├─ axiom-collector  Playwright, Axiom viewer counts, snapshots every 10 s
                  ├─ wallet-tracker   Helius, runner wallets
                  ├─ scoring          mover score, paper trades
                  ├─ data/axiom-tracker.db (SQLite, WAL)
                  └─ site-publisher   POST https://thelibrary.garrdetto.workers.dev/api/admin/axiom/ingest
                                       Authorization: Bearer AXIOM_RADAR_TOKEN
                     ▼
Cloudflare Worker  stores the latest update in D1 axiom_radar_state
                     ▼
Browser (anyone) ──► /api/admin/axiom/data | /stream  (same origin; saving settings and bot commands need the admin session)
```

| Piece | Where |
| --- | --- |
| Worker suite | `scripts/axiom-tracker/` (`index.ts` runs everything; `site-publisher.ts` pushes to the site) |
| Site routes | `src/server/routes/axiom-radar.ts` and `src/server/axiom-radar-store.ts` (registered in `src/server/api.ts`) |
| Page | `src/components/axiom-radar/` (`access.ts` says who may change things), `src/routes/axiom-radar.tsx`, the corner tab in `src/routes/index.tsx`, and the redirect in `src/routes/admin.axiom-radar.tsx` |
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
3. Open https://axiom.trade yourself (you pass Cloudflare as a person) and keep the Pulse page or token pages open. After the bridge's files change, click its reload arrow on `chrome://extensions`. Every second the extension sends what each visible Pulse card shows (viewers, holders, dev record, holder percentages, fees, trades) to the tracker. It never clicks or navigates.

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
- **All coins**: every tracked coin ranked by viewers, with the score (and how far it moved in the last minute), the quality score beside it (both sortable), viewers per minute, the four price-change windows and filters. The star pins a coin so it is always tracked.
- **Top movers**: biggest price gainers per window and biggest viewer gainers.
- **Smart wallets**: wallets among the top holders of several good coins (and, with a Helius key, early buyers of runners).
- **Paper trades**: the paper-trading bot's account, positions and trades (see Paper-trading bot below), then the Radar's own signal scoring: a simulated trade opened on each Buy signal, win rate and the adaptive weights.
- **Settings**: toggle and tune every requirement and rule. Saved to D1 on the site; the tracker picks them up on its next push (seconds while the page is open).
- Clicking a coin opens details: **Why it scores N** (the live score ledger: every gate, rule, adjustment and cap with its current reading, the score over the last 15 minutes and what moved it), a live price-and-viewers chart from 1-second ticks, DexScreener candles, the quality checklist, the safety plan and smart holders.
- Sound and desktop alerts fire for new viewer surges and new Buy signals.
- **Chart previews**: every coin shows a small live price chart. The 30s / 1m / 5m / 10m switch beside the tabs sets the time span for all previews, and the details panel has its own switch for the live chart.
- **Appearance** (in Settings, or the palette menu at the top): follow the site theme, or use Dark blue & light blue, Dark blue & neon green, Black & light grey, or your own eight colours. Saved with the other settings.

### Update speed

The tracker refreshes prices from DexScreener and records viewers every second. When the page is open in a browser **on the PC running the tracker**, it reads `http://127.0.0.1:8791/live/stream` directly and updates every second (Chrome may ask once for permission to reach local apps; allow it). Anywhere else it falls back to the site relay, which updates every 3 seconds. The local feed only answers this site's origin and only GET requests.

## Exit and rebuy advice (for trading bots)

Every coin in the payload carries `advice`, re-computed every 3 seconds and sent with the per-second `live` figures. It is `null` for the first minute after the tracker starts.

```
advice: {
  exit: 'hold' | 'tighten' | 'exit'
  exitReasons: string[]        // plain-English, with the numbers behind each one
  rebuy: 'ok' | 'wait' | 'never'
  rebuyReasons: string[]
  signs: string[]              // keys of the warning signs that are on, see adviceStudy.signs
  highPrice: number | null     // highest price held for two readings while tracked
  drawdownPct: number | null   // how far the price is below highPrice
  crashed: boolean             // fell 75% from its high or had liquidity pulled, and is still 30%+ down
}
```

How to use it:

- `exit: 'exit'`: sell. The coin crashed, has a Radar warning, or shows a sign that at least doubled the chance of a 20% fall in the next 5 minutes in the tracker's own history.
- `exit: 'tighten'`: momentum is fading. Take profit or pull stops in; do not add.
- `rebuy: 'never'`: the coin crashed or has a warning. Do not buy it again, whatever the score says.
- `rebuy: 'wait'`: it shows warning signs now, or it is far enough below its high that most coins like it did not make a new high. Wait for `ok`.
- A held coin that disappears from the payload has left the radar. Treat that as `tighten` at least: the tracker stopped seeing the volume, trades or liquidity it requires.

`payload.adviceStudy` lists every warning sign with how often it was seen, what share of coins fell or rose 20% in the next 5 minutes, and whether it is in use (`level`). `advice.ts` re-tests all of them every 15 minutes, so a sign that stops predicting falls drops out, and one that starts working is picked up. Price dips alone are tested and currently not used: in this history coins bounced after them more often than they kept falling.

What the history says about stops: price stops rarely sell where they are set. When a stop did trigger in a backtest of the tracker's past picks, the sale averaged about 70% below the entry, because these coins fall faster than prices arrive. Size positions for that, and lean on `advice.exit` rather than a tight stop.

`follow-up.ts` keeps reading prices for up to 150 coins after they leave the radar (every 30 seconds, no viewer counts), so the research can see what happened after a sale. Until a day of that has built up, treat the advice as an early read.

## Model reference

- **Which coins are tracked**: DexScreener (latest profiles, boosts, takeovers, searches), GeckoTerminal (new and trending Solana pools), Jupiter (trending, most traded and most organic over 5 minutes) and every coin on your Axiom Pulse feed a watchlist. Coins caught in a bot-driven climb are dropped for 30 minutes unless pinned. Coins must pass the enabled requirements in Settings (defaults: 5 m volume ≥ $3k, ≥ 40 trades, liquidity ≥ $3k, buys > 40%; no age or viewer limit). Pulse coins skip the market requirements by default. Up to 60 coins (setting) are kept, ranked by live viewers; pinned coins are always kept.
- **Pulse card data** (through the bridge, every second): viewers, holders, the dev's migrated/created record, top-10 %, dev % (or dev sold), snipers %, insiders %, bundlers %, fees paid, trades, volume and market cap.
- **Coin page data** (through the bridge, version 1.6 or later): when a coin's own Axiom page is open (`/meme/<pair>`, which Axiom now forwards to `/token/<mint>`), the bridge sends the holder percentages in its Token Info box, and `page-stats.ts` picks out top 10, dev, snipers, insiders, bundlers and fresh wallets by label. With "Fill in missing viewers and holder figures" ticked in the bridge popup, one background tab visits each tracked coin's page in turn (one page every 6 seconds), so every coin gets Axiom's own figures every few minutes. A page reading stands on its own for 2 minutes, is weighed with RugCheck and Jupiter (highest wins) until it is 8 minutes old, and its fresh-wallet figure is kept for 30. The **extension-intake** chip says how many coin pages were read and whether Axiom showed a fresh-wallet figure on them.
- **Jupiter data** (`jupiter.ts`, no key, every 4 seconds, works with the Pulse tab closed): holder count and holders gained per minute, top-10 % and dev %, and for the last 5 minutes how many wallets traded and how many of them only bought.
- **Holder limits** (`holderLimits` in `holder-limits.ts`, the same numbers as Step 1 of the runner score): a coin scores 0 and gets no signal when the dev holds over 5%, the top 10 over 25%, bundlers over 35%, fresh wallets over 10%, Axiom's Pro Traders Holding figure is over 50% (it must sit between 0 and 50%), or snipers, insiders or linked wallet groups hold over 30%. The numbers come from the Pulse card while it is fresh, then Axiom's coin page read in the last 2 minutes, otherwise the highest of an older page reading, RugCheck and Jupiter; Pro Traders Holding comes only from the coin page (bridge 1.6.2 or later). A coin with no holder numbers yet cannot score above 45. A coin that scores 0 also shows a 0% Millionaire Maker match and explode chance.
- **Fresh wallets** (`fresh-wallets.ts`): for each tracked coin's top 20 holders (RugCheck, pools excluded), the tracker reads the wallet's latest 250 transactions from a Solana node. A wallet is fresh when its whole history is shorter than that and began less than a day before the coin launched, or after. The fresh share is the supply those wallets hold. Recommended coins are re-checked about every 45 seconds and the rest every 3 minutes; wallets are remembered in `wallet_starts`, so a re-check only looks up new holders. Without `SOLANA_RPC_URL` or `HELIUS_API_KEY` it uses the free public node at about one wallet a second; with either it runs several times faster.
- When Axiom's own coin page shows a fresh-wallet figure, the bridge's reading of it (see Coin page data) is used ahead of the tracker's own count.
- **Research verdicts** (`research-verdict.ts`, `rise-traits.ts`, `price-shape.ts`): every coin that grew 3x to $50K+ is positive or negative. Nearly every coin dumps, so an ordinary dump is not held against it; it is judged on readings taken before its peak (readings wait and only count once the coin makes a new high after them). Negative when, before its peak, the top 10 held over 30%, fresh wallets over 10%, the dev over 5%, bundlers or insiders over 25%, snipers over 20% or linked groups over 25%; when it fell half below its peak within 15 minutes of its breakout (pump and dump); when it climbed and then slid in even, steady lines (rug pattern, from the 24-hour price history, stored in `shape_json`); when holders did not grow by half again to at least 100, or fewer than 50 wallets traded it in any 5 minutes (no organic demand); when its dev made 20+ coins with under 10% graduated (serial launcher); when its holders, top 10 or fresh wallets were never read before its peak; or with risky token settings. Only positive coins count as winners for the Millionaire Maker match score, the research findings and the winner-wallet count.
- **Quality checklist**: the same holder limits, plus fees paid of at least 3 SOL per $100K market cap (under 1 fails: likely fake volume), dev record (fails when under 5% of 10+ coins migrated), holders ≥ 500, and mint/freeze authority revoked (RugCheck). These are common trader rules of thumb, not guarantees.
- **Runner score (0–100)** (`runner-score.ts`, rebuilt every second): Step 1 makes it 0 for mint or freeze authority, dev over 5%, top 10 over 25%, bundles over 35%, pro traders over 50%, a serial launcher dev (20+ coins, under 10% graduated), a recycled launch (a ticker two earlier coins crashed under, or an X account, community or website an older coin used), a dead chart (no volume or under 5 buyers in 5 minutes), fresh wallets over 10%, snipers, insiders or linked groups over 30%, a bot-driven climb, RugCheck rugged, or holders selling right now. Step 2 adds distribution (30: top 10 under 15% 15, bundles under 5% 5, snipers out with the floor held 5, dev at 0% 5 or under 2% and not selling 3), multi-wave momentum (30: a 30-55% pullback won back with higher lows 15 or 8 while recovering; 100+ holders 3, fees over 0.75 SOL 3, organic buy volume above sells 4; market cap $12K-$45K before graduating or $60K-$250K after 5), hype (25: DexPaid 10 from DexScreener's orders feed; a real X account or community 6 or a linked tweet 3, Telegram 2, a real website 2, links copied from an older coin count nothing; 2+ smart wallets or viewers surging 5) and chart health (15: a staircase where most minutes rise and no one minute makes over half the move 10; liquidity deep enough that a sell of 1% of supply moves the price under 25% 5, under 40% 3). It then takes off one point for each percentage point the top 10 hold above 15%, adds what past alerts taught (see below), and caps a coin falling 25% in 5 minutes or 15% in 1 minute at 40. Jupiter supplies organic buyers, organic buy and sell volume, social links and whether a coin graduated; the Pulse card supplies fees and the dev's record.
- **Live score ledger** (`ledger` from `scoreRunner`, `score-trail.ts`): every coin carries the full working of its score, rebuilt every second: each Step 1 gate with its reading and limit (pass, fail or not read yet), each pillar's rules with the reading used and the points earned out of the points possible, the top 10 penalty and learned adjustments, and the three caps. The tracker keeps each coin's score for the last 15 minutes (a point whenever it moves, and every 15 seconds) and the last 25 moves with what changed (a gate failing or clearing, a rule gaining or losing points, a cap starting or lifting). Both travel in the per-second live update, so the coin drawer's **Why it scores N** section updates every second for everyone, highlights the lines that just changed, and the All coins table shows how far the score moved in the last minute next to it.
- **Chart backfill** (`chart-history.ts`): the pullback-recovery and staircase rules and the snipers' floor read the coin's price history, so a coin the radar had only just found used to miss those points until it had been tracked for a while. For coins followed for under 20 minutes, the tracker fetches the last hour of one-minute candles from GeckoTerminal (one coin every 3.5 seconds, each refreshed every 3 minutes) and puts them in front of the radar's own ticks, so how long the radar has watched a coin no longer changes its score. Coins not on GeckoTerminal yet are scored on the radar's own ticks.
- **Instant sell trackers** (`sell-watch.ts`): every reading of a coin's holder shares (every second from a fresh Pulse card, every few seconds from RugCheck and Jupiter, never comparing one source with another) is kept for 3 minutes. Bundlers dropping 2 points, insiders 3 points, the dev any point from 1%+, or the top 10 dropping 3 points while the price falls 5%, all within a minute and holding for 4 seconds, raise an alert for 5 minutes: the score goes to 0, the coin gets a warning, its advice turns to Get out (the paper bot sells) and the page pops up a sell alert. Every coin carries a safety plan: what the price would do if its bundlers sold everything or its top 10 sold half (constant-product pool, half its liquidity on each side), and the triggers above; coins with bundles of 5%+ or a top 10 of 20%+ get a Be careful advice.
- **Runner alerts and learning** (`runner-learning.ts`, `runner-state.ts`, table `runner_alerts`): a coin scoring the alert threshold (75) is alerted once an hour and followed for 4 hours: best multiple within 15 minutes, 1 hour and 4 hours, worst within 10 minutes, and when it fell 30% under the alert price. A 30% dump within 10 minutes is a false positive; 2x within 4 hours is a runner. Each scoring trait is graded on its last 14 days of alerts (needs 5): behind 3+ false positives that are half its alerts it costs 10 points, behind 3+ runners in half its alerts it earns 10, 2+ runners in 30% earns 5 (total between -20 and +15). When fewer than 40% of the last 20 decided alerts (needs 10) went +50% before -30%, the threshold rises to 80 until that recovers. The Runners tab shows live runners in the alert format (score, name, contract, stage and stats, thesis, learned edge), every alert's results, and the learned traits.
- **Bot-driven climbs**: a coin is flagged when, over 5 minutes, at least 85% of 50 or more trading wallets only bought (a handful of wallets do all the selling), or when 3 minutes of same-sized buys under $60 at a fixed buy share lift the price with no pullback. Flagged coins score 10 or less, get no signal, are never marked good coins, and are hidden unless pinned. In the tracker's first day these climbs made up a quarter to a half of the top-scored coins, because the tracker stopped following them before they were pulled.
- **Buy signal**: score, 1 m gain, 5 m gain and viewers all above the buy rules, no warnings, and (optionally) no red flags. **Watch**: surging viewers, score, 5 m gain or smart holders.
- **Smart holders**: RugCheck's top holders are stored per coin. A coin becomes "good" at $500K market cap with $20K liquidity, 2.5x since first tracked, or a paper-trade win. Wallets holding the set number of good coins are smart holders.
- **Paper trades**: opened once per mint on a Buy signal (or a runner score at the alert threshold, 75 or 80); price checked at +5, +15 and +30 minutes; +15% at 15 minutes is a win. Every 10 decided trades the weights shift toward features stronger in winners; they are shown for reference and no longer change the score.
- Snapshots older than 24 h and holder records older than 7 days are pruned hourly.

## Paper-trading bot

`scripts/axiom-paper-bot/` is a Python bot that trades this Radar with pretend SOL: its own SOL balance, buy amounts in SOL, automatic buys and sells, Axiom-style network fees (auto fee or your own priority fee and bribe), slippage and price impact. Amounts show as SOL with dollars in brackets. It never places a real order. Start it on the PC that runs the tracker:

```bash
python scripts/axiom-paper-bot/run.py
```

It pulls the Radar from the site with the tracker's `AXIOM_RADAR_TOKEN`, so there is nothing new to set up. Its dials (buy thresholds, risk strength, bet size, stops, costs) are in `data/paper-bot.toml` and on this page in the **Trading bot** tab, with Careful, Balanced and Bold starting styles, buttons to pause buying, close every position and reset the account, and a Save bar that says when the bot has the change; the most recent change wins. The **Paper trades** tab shows its account, positions and trades. Details are in `scripts/axiom-paper-bot/README.md`.

## Data files

`data/*.db*`, `data/*.log*`, `data/*.toml`, `axiom-session/` and `.env` are git-ignored. Delete `data/axiom-tracker.db*` to start fresh. Delete `axiom-session/` to sign out of Axiom.
