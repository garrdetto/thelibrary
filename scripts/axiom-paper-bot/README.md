# Axiom paper-trading bot

A Python bot that trades the Axiom Radar feed with pretend money. It pulls the Radar from the site every few seconds, buys coins that pass your rules, and sells them by your exit rules. It keeps a pretend account with cash, positions, fees and slippage. Nothing here places a real order, and the bot holds no wallet or exchange keys.

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
| `run.py set <dial> <value> ...` | Change dials, for example `set risk.strength 7 exit.stop_loss_pct 30`. A running bot picks the change up within seconds |
| `run.py pause` / `run.py resume` | Stop or allow new buys. Open positions are still managed while paused |
| `run.py flatten` | Sell every coin the bot holds |
| `run.py reset [--cash 2500] [--yes]` | Wipe every pretend trade and start the account again |
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
- **Typing commands yourself:** `bot status`, `bot set risk.strength 7`, `pm2 status`, or `!` followed by any command. These do not need Claude.
- **Ask me before every command** makes every command wait.

Claude is reached through the Claude Code command line (`claude`) already on the PC, with every tool turned off: it only writes text, and the console checks and runs the commands. It needs a one-time sign-in: run `claude`, type `/login`, and finish in the browser. Set `AXIOM_CONSOLE_MODEL` to change the model (default `haiku`).

The console listens on this PC only, and its requests need a private key kept in `data/console-key.json`, so other websites and other machines cannot use it. Anyone who can already use your PC and read that file can.

## The dials

Every dial lives in two places, and the most recent change wins:

- **On your PC:** `data/paper-bot.toml`. Edit and save; the running bot picks the change up within a few seconds and sends it to the site.
- **On the Radar page:** the **Trading bot** tab. Pick a style (Careful, Balanced, Bold) or set any dial, then Save. The bot picks the change up on its next pull, rewrites the file to match, and the Save bar says when it is active.

The Trading bot tab also has the terminal's actions as buttons: pause or resume buying, close every position, reset the account. The Paper trades tab shows the bot's account, positions and trades.

| Group | What it controls |
| --- | --- |
| Bot | Buying on or off, how often to pull, the fast feed, live price checks |
| Account | Starting cash for the next reset |
| When to buy | Radar signal, score, price gains, viewers, liquidity, market cap, volume, buy share, age, safety, quality, warnings, the Radar's buy advice, rebuys only above the old high, confirmation pulls, cooldown |
| Learned predictions | Runner, could-explode and big-winner chances, and crash timing from the Radar's learner |
| Risk and bet size | Risk strength, bet per trade, caps, open coins, exposure, daily loss limit, drawdown stop, loss-streak break, buys per hour |
| When to sell | Stop loss, profit target and share sold, entry protection, trailing stop, time limits, score, viewers, warnings, the Radar's exit advice, fading momentum, coins that leave the Radar |
| Costs and realism | Trading fee, network fee, price impact, extra slippage, extra slippage on stop sells |

**Risk strength** (1 to 10) scales every bet and how much of the account can be in coins at once. 5 uses the numbers as written, 10 doubles them, 1 uses a fifth. The largest-single-bet cap and the liquidity cap still apply at any strength.

## The Radar's advice

Each coin carries `advice` from the tracker's own study of which warning signs came before falls (see `AXIOM_RADAR.md`, Exit and rebuy advice). The bot reads it and never hardcodes which signs matter:

- `exit: 'exit'` sells the position (**Sell when the Radar says exit**).
- `exit: 'tighten'`, or a held coin leaving the Radar, puts the position on the tighter **Trailing stop while tightened** at once (or sells it, or does nothing, by the dials). The bot never adds to a position.
- `rebuy: 'never'` blocks a buy; `rebuy: 'wait'`, `exit` and `tighten` block it too under the default **Radar buy advice**. This applies to first buys as well as rebuys.
- After the bot sells a coin it buys it again only above its high at the time of that sale (**Rebuy only above the old high**).

That study found coins often bounce after a price dip and that stops rarely sell where they are set, so the default stop loss and trailing stop are wide (25%), the default bet is small (2% of the account), and stop sells pay extra slippage (5%).

The learned rules use `outlook`, `explode` and `maker` on each coin. When the tracker does not send them, those rules pass or skip the coin according to **When a prediction is not ready**.

## How trades are priced

- A buy spends the bet in total, fees included. The price paid is the market price plus price impact plus extra slippage.
- Price impact follows a constant-product pool: a buy of $B against a pool with $Q on the quote side pays `spot x (1 + B/Q)`, and a sale worth $V receives `spot / (1 + V/Q)`. Q is half the coin's liquidity figure. A pulled pool pays almost nothing.
- With **Live prices for open positions** on, the bot checks the price on DexScreener at the moment of a buy and every few seconds while it holds a coin, so stops react between pulls. A buy is cancelled when the live price is already 15% under the Radar's reading.
- Stop loss, trailing stop, Radar exit and warning sells pay **Extra slippage on stop and exit sells** on top, because these coins fall faster than prices arrive.
- Stops and targets measure the market price move since the buy. Profit and loss count everything: fees, impact and slippage on both sides.
- Open positions are valued at what they would fetch if sold now.

## Safety stops

The bot stops buying (and keeps managing what it holds) when: buying is paused, the Radar is older than **Oldest data to buy on** or the tracker is not live, the daily loss limit or drawdown stop is reached, a run of losses triggers a break, the most coins are held, or the hourly buy limit is reached. The live view and the Radar page say which one applies.

## Files

| File | What it is |
| --- | --- |
| `axiom_paper/dials.json` | Every dial: label, range, default. Also read by the site (`src/lib/axiom-bot.ts`) |
| `axiom_paper/strategy.py` | The buy rules, bet sizing and sell rules |
| `axiom_paper/broker.py` | Simulated fills: fees, price impact, slippage |
| `axiom_paper/engine.py` | The loop: pull, mark prices, sell, buy, sync dials, report |
| `axiom_paper/ledger.py` | The account in SQLite at `data/axiom-paper.db` |
| `axiom_paper/site.py`, `prices.py` | The site sync call and DexScreener prices |
| `axiom_paper/dashboard.py`, `cli.py` | The live view and the commands |
| `axiom_paper/console.py`, `console.html` | The prompt console: local server, Claude translator, command checks, and the page |
| `ecosystem.config.cjs` | PM2 processes for the bot and the console |
| `tests/test_bot.py`, `tests/test_console.py` | `python -m unittest discover -s scripts/axiom-paper-bot/tests` |

`data/paper-bot.toml`, `data/axiom-paper.db*`, `data/axiom-paper.lock`, `data/paper-bot.inbox.json` and `data/console-key.json` are git-ignored. Delete the database to start with no history, or use `reset`.

## Site requests

By default the bot pulls every 10 seconds (about 8,600 requests a day) and leaves the tracker on its 20-second idle cadence. **Fast feed** makes the tracker send every 3 seconds while the bot runs, which is fresher but adds about 29,000 tracker requests a day; lower **Pull the Radar every** to match if you turn it on.
