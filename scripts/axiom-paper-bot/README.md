# Axiom paper-trading bot

A Python bot that trades the Axiom Radar feed with pretend SOL. It pulls the Radar from the site every few seconds, buys coins that pass your rules, and sells them by your exit rules. It keeps a pretend SOL account with cash, positions, fees and slippage, and shows every amount as SOL with the dollar value in brackets, for example `0.2500 SOL ($17.64)`. Nothing here places a real order, and the bot holds no wallet or exchange keys.

It needs Python 3.11 or newer and nothing else: no packages to install.

## Run it

From the repo, on the PC that runs the tracker:

```bash
python scripts/axiom-paper-bot/run.py
```

The bot reads `AXIOM_RADAR_TOKEN` and `AXIOM_SITE_ORIGIN` from `.env` in the repo (the file the tracker uses). To use a `.env` somewhere else:

```bash
python scripts/axiom-paper-bot/run.py --env ../thelibrary-axiom-radar/.env
```

The live view shows the account, open positions, the last trades, the coins closest to a buy with what is holding each one back, and an activity log. Keys: **P** pauses or resumes buying, **F** closes every position, **Q** quits.

## Commands

Every action is also a command, and each works whether or not the bot is running:

| Command | What it does |
| --- | --- |
| `run.py status` | The account, open positions and recent trades |
| `run.py settings` | Every dial and its value |
| `run.py set <dial> <value> ...` | Change dials, for example `set buy.max_coins 3 sell.stop_loss_pct 25`. A running bot picks the change up within seconds |
| `run.py pause` / `run.py resume` | Stop or allow new buys. Open positions are still managed while paused |
| `run.py flatten` | Sell every coin the bot holds |
| `run.py reset [--sol 10] [--yes]` | Wipe every pretend trade and start the account again, with that many SOL when given |
| `run.py logs [lines]` | The bot's recent PM2 log lines |
| `run.py console` | Open the prompt console (below) |

`flatten` and `reset` reach a running bot through `data/paper-bot.inbox.json`, which the bot reads once and removes.

## Running in the background

`scripts/axiom-paper-bot/ecosystem.config.cjs` runs the bot (`axiom-paper-bot`, one log line per event) and the prompt console (`axiom-bot-console`) under PM2. Set `AXIOM_BOT_ENV` to the tracker's `.env` first when that file is not in this repo:

```bash
pm2 start scripts/axiom-paper-bot/ecosystem.config.cjs
```

```bash
pm2 save
```

Start PM2 processes from your own terminal, not from inside another tool: PM2 keeps a copy of the environment it was started from.

## Prompt console

A local page where you say what you want in plain words and Claude writes the commands:

```bash
python scripts/axiom-paper-bot/run.py console
```

It opens `http://127.0.0.1:8793/` in your browser. Type a request such as "be more careful and only hold three coins" or "show the last 30 log lines". Claude answers with the commands, and each one appears with its output, like a terminal.

- **Runs straight away:** reading the account, settings and logs, changing dials, pausing and resuming.
- **Waits for your click:** selling everything, resetting the account, starting, stopping or restarting a PM2 process, and any command that is not one of the bot's own (those run in PowerShell).
- **Typing commands yourself:** `bot status`, `bot set buy.max_coins 3`, `pm2 status`, or `!` followed by any command. These do not need Claude.
- **Ask me before every command** makes every command wait.

Claude is reached through the Claude Code command line (`claude`) already on the PC, with every tool turned off: it only writes text, and the console checks and runs the commands. It needs a one-time sign-in: run `claude`, type `/login`, and finish in the browser. Set `AXIOM_CONSOLE_MODEL` to change the model (default `haiku`).

The console listens on this PC only, and its requests need a private key kept in `data/console-key.json`, so other websites and other machines cannot use it. Anyone who can already use your PC and read that file can.

## The dials

Every dial lives in two places, and the most recent change wins:

- **On your PC:** `data/paper-bot.toml`. Edit and save; the running bot picks the change up within a few seconds and sends it to the site.
- **On the Radar page:** the **Trading bot** tab. Pick a style (Careful, Balanced, Bold) or set any dial, then Save. The bot picks the change up on its next pull, rewrites the file to match, and the Save bar says when it is active.

The Trading bot tab also has the terminal's actions as buttons: pause or resume buying, close every position, reset the account. The Paper trades tab shows the bot's account, positions and trades.

There are about twenty dials, each with a plain description on the Radar page and in the settings file:

| Group | Dials |
| --- | --- |
| Buying | Score to buy on (Score, DexScreener, Quality or Blend), buy when the score reaches, how picky (strict, normal, loose), SOL per buy, most coins held at once, stop buying for the day after losing, Wallet Score needed to buy |
| Selling | Profit target, stay in while momentum is strong (on or off), while staying in sell this far off the high, stop loss, longest hold |
| Learning | Learn from trades and watched coins, learn the best moment to buy, learn from bad buys |
| Fees | Network fee (auto with a speed and max fee, or your own priority fee and bribe) |
| Account | Starting balance in SOL for the next reset |

Everything else the bot checks is set for you by **How picky**. `axiom_paper/rules.py` turns the dials into the full rule set (`rules.json`: Radar signal, safety rating, failed checks, liquidity, volume, buy share, age, the chart check before each buy, the Radar's advice, cooldowns, slippage). Normal buys any coin that reaches the score with the usual safety checks; Strict also needs the Radar's own buy call, clean holders and more liquidity; Loose lets thinner coins through. Settings files and site settings saved before this change are read into the new dials (`renamed` in `dials.json`; the buy level comes from the old mode's buy level).

## Selling at the target

The bot sells the whole position at the **Profit target**. With **Stay in while momentum is strong** on, it reads the chart when the target is reached: its own price change over the last 30 seconds, the Radar's 30-second and 1-minute change, the share of buys, and the DexScreener score's trend. When most of those point up it keeps holding (the log says "staying in" and the Paper trades tab tags the coin "riding momentum"), and it sells as soon as momentum fades on two readings in a row, the price falls back to the target, or it drops **While staying in, sell this far off the high**. A ride is never cut by the longest-hold limit.

## Stale prices

The Radar and DexScreener sometimes return a price from a minute earlier. On 2026-11-15 the bot bought MANA right after a 68% minute, DexScreener then read the price from before the run, and the stop loss sold at -46% five seconds after the buy. `axiom_paper/pricegate.py` now holds back any move of more than 15% from the price the bot is using until every reading for 15 seconds agrees, and then takes the mildest of those readings. A reading back near the old price cancels the move, unless its source has shown the same price for 45 seconds (a quote that stopped updating). Radar warnings, such as liquidity being pulled, still sell at once.

## Learning

`axiom_paper/learner.py` keeps a notebook in the same database (`learn_samples`), kept through account resets:

- Every coin within 20 points of the buy level is sampled every 2 minutes (at most 12 times a day per coin) and followed until it would have hit the profit target or the stop loss on two readings in a row, or the longest hold runs out, or it leaves the Radar for 2 minutes.
- Every closed trade is added with the bands it was bought in and counts three times.
- Each sample records its band of score, coin age, buy share, liquidity and viewers, and (timing) the last minute's move, the last 5 minutes' move, how far under its 10-minute high it was, and the time of day.
- From the last three days of results, a band seen at least 20 times that averages worse than -2% after costs and wins under 40% blocks a buy. A timing band makes the bot wait instead, and names the band that pays best, so a coin right after a spike is bought on the dip if dips are what pay.
- After 8 or more recent trades, a win rate under 40% raises the buy level 5 points (10 under 25%); over 60% lowers it 3. Each losing trade writes a lesson to the activity log.

- The bands also cover the coin's holders (Wallet Score, whales holding $1k+), liquidity and volume as a share of market cap, and (timing) whether 5-minute volume grew or shrank over the last minute and liquidity over the last two minutes. The bot reads those trends from its own pulls.

The Trading bot tab shows what it has learned under Learning.

## Learning from bad buys

`axiom_paper/review.py` looks back at every closed trade (`trade_reviews`, kept through account resets; trades made before it existed are reviewed on the first start). It records what the coin looked like at the moment of the buy and what the price did afterwards, and writes the reason to the activity log, for example: "Why BANK lost -24%: it never rose more than 0% after the buy, so it was bought at the top. At the buy: bought late in the run (Radar said overdue)."

Each buy gets the mistake tags that could have been read before buying: right after a 20%+ minute, late in the run (up 75%+ in 5 minutes or the Radar's phase late or overdue), at its 10-minute high after a climb, 5-minute volume shrinking 15%+ over the last minute, liquidity falling 5%+ over two minutes, liquidity under 15% of market cap, 5-minute volume under 20% of market cap, under 53% buys, a Wallet Score under 40, and no whale holding $1k+. Over the last 7 days, a tag seen on at least 5 trades that lost on 65% or more of them and averaged -4% or worse becomes a lesson: with **Learn from bad buys** on, coins that show it are skipped ("learned from bad buys: ...") until the sign clears. The Trading bot tab lists every tag with its record and the latest reviews.

## Wallet Score

The tracker (`scripts/axiom-tracker/wallet-score.ts`) scores who holds each coin from its latest top holders. Every wallet gets a record from the coins it held a real stake in before (0.3% of supply or more): a coin that grew 3x to $50k+ counts for it only if it held before the peak, and a coin that ended without that counts against it. Bigger stakes count more (2% of supply counts in full). Each holder with $100 or more in the coin moves the score by how much better or worse than average its earlier coins did; tiny holders are ignored and pools are skipped. 50 means no holder has a record yet. On the tracker's history, coins scoring 88+ grew 3x about 26% of the time against 5.6% for all coins, and coins under 27 about 3%. A whale is a holder with $1,000+ in the coin. The coin's drawer on the Radar page shows the score and its biggest holders with their records; **Wallet Score needed to buy** (default 35, 0 turns it off) skips coins under it, and coins not scored yet still pass.

## The SOL account

The account, every buy and every fee are in SOL, as they would be on Axiom. Coin prices from the Radar and DexScreener are in dollars, so the bot divides them by the live SOL price (DexScreener, refreshed every 30 seconds) to price coins in SOL. A coin that is flat in dollars therefore loses SOL value when SOL rises, as it would in a real wallet. Dollar amounts in brackets are the SOL amounts at the current SOL price.

An account made before this change was kept in dollars. The first time the new bot runs, it converts every amount once at the current SOL price and sets **Starting balance** to match. The bot buys nothing while it has no SOL price.

## Network fees

Every buy and every sell pays the network a priority fee and a bribe, in SOL, on top of the trading fee.

- **Auto fee** (the default) follows the network. The bribe is what recently landed Jito tips cost, and the priority fee is what recent blocks charged for the swap program most Radar coins trade through, times a typical swap's compute units. **Auto fee speed** picks how far up those ranges to pay (low, normal, high), and **Max fee** caps the two together. Axiom does not publish how its own auto fee works, so this is a close stand-in, not a copy.
- **My own priority fee and bribe** uses the two amounts you set, as on an Axiom trading preset.
- When auto fee has no live data, the bot uses your own amounts and says so.

The terminal view, `status` and the Radar page show what one trade pays right now.

## How trades are priced

- A buy spends the buy amount in total, fees included. The price paid is the market price plus price impact plus extra slippage.
- Price impact follows a constant-product pool: a buy of B against a pool with Q on the quote side pays `spot x (1 + B/Q)`, and a sale worth V receives `spot / (1 + V/Q)`. Q is half the coin's liquidity figure. A pulled pool pays almost nothing.
- With **Live prices for open positions** on, the bot checks the price on DexScreener at the moment of a buy and every few seconds while it holds a coin, so stops react between pulls. A buy is cancelled when the live price is already 15% under the Radar's reading (10% with **Before buying** on).
- Stop loss, trailing stop, Radar exit and warning sells pay **Extra slippage on stop and exit sells** on top, because these coins fall faster than prices arrive.
- Stops and targets measure the market price move since the buy. Profit and loss count everything: fees, impact and slippage on both sides.
- Open positions are valued at what they would fetch if sold now.

## Safety stops

The bot stops buying (and keeps managing what it holds) when: buying is paused, the Radar is older than **Oldest data to buy on** or the tracker is not live, the daily loss limit or drawdown stop is reached, a run of losses triggers a break, the most coins are held, or the hourly buy limit is reached. The live view and the Radar page say which one applies.

## Files

| File | What it is |
| --- | --- |
| `axiom_paper/dials.json` | The owner's dials: label, help, range, default. Also read by the site (`src/lib/axiom-bot.ts`) |
| `axiom_paper/rules.json`, `rules.py` | The full rule set the strategy reads, filled in from the dials and the picky level |
| `axiom_paper/pricegate.py` | Holds back sudden price moves until they last |
| `axiom_paper/learner.py` | The notebook: watched coins, trades, lessons and the buy-level adjustment |
| `axiom_paper/strategy.py` | The buy rules, bet sizing and sell rules |
| `axiom_paper/broker.py` | Simulated fills: fees, price impact, slippage |
| `axiom_paper/fees.py` | Network fees per trade: auto fee from live Jito tip and Solana priority fee levels, or your own |
| `axiom_paper/money.py` | How amounts are written: SOL first, dollars in brackets |
| `axiom_paper/engine.py` | The loop: pull, mark prices, sell, buy, sync dials, report |
| `axiom_paper/ledger.py` | The account in SQLite at `data/axiom-paper.db`, in SOL, and the one-time conversion of a dollar account |
| `axiom_paper/site.py`, `prices.py` | The site sync call and DexScreener prices |
| `axiom_paper/dashboard.py`, `cli.py` | The live view and the commands |
| `axiom_paper/console.py`, `console.html` | The prompt console: local server, Claude translator, command checks, and the page |
| `ecosystem.config.cjs` | PM2 processes for the bot and the console |
| `tests/test_bot.py`, `tests/test_simple.py`, `tests/test_chart_check.py`, `tests/test_console.py`, `tests/test_sol.py` | `python -m unittest discover -s scripts/axiom-paper-bot/tests` |

`data/paper-bot.toml`, `data/axiom-paper.db*`, `data/axiom-paper.lock`, `data/paper-bot.inbox.json` and `data/console-key.json` are git-ignored. Delete the database to start with no history, or use `reset`.

## Site requests

The bot pulls every 5 seconds (about 17,000 requests a day) with the fast feed on, so the tracker sends every 3 seconds while the bot runs (about 29,000 tracker requests a day). Both are set in `rules.py`.
