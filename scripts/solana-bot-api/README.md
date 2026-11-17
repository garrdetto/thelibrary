# Axiom Bot

A Solana buy bot with two modes, controlled from the library's admin console (Site → Tools → **Axiom Bot**),
the standalone panel at `/`, or the terminal.

- **Sniper**: watches the pump.fun program. It reads pump.fun's own launch and trade events straight from the
  logs as each block confirms (`pumpevents.py`, no extra RPC call), keeps every new coin's trades
  (`market.py`), and with a **ruleset** (`rules.json`) looks at each new coin a set time after launch, buys only
  the ones that pass, then sells by the ruleset's exit rule. Without a ruleset it buys every new classic coin at
  once and never sells (the old behaviour).
- **Copy-Trade**: watches one wallet and buys whatever coin it buys (token in, SOL out). Selling is up to you.

Every buy and sell goes Jupiter quote → build → sign → simulate → send → confirm, and each step streams to the UI
with its latency. **Dry Run is the default**: it quotes and simulates with your real wallet but never sends; with
a ruleset, dry-run positions are kept on paper, priced on the bonding curve, and their sells report the profit or
loss after fees.

## Rulesets

`rules.json` (or the file in `RULES_PATH`; an empty `RULES_PATH` turns rules off):

```json
{
  "name": "cand2",
  "decide_after_s": 10,
  "filters": [["mom5", ">=", 0.000835], ["raised", "<=", 0.465859]],
  "exit": {"tp": 0, "sl": 0.2, "trail": 0, "arm": 0, "hold_s": 60, "dev_exit": true}
}
```

- `decide_after_s`: how long after launch the coin is scored. The score uses only trades up to that moment.
- `filters`: every one must pass. Features are listed in `strategy.py` (creator's launch buy, buys, sells,
  different buyers, SOL raised, whether the creator sold, the biggest buyer's share, launch-slot snipers, SOL added
  in the last 5 s, sell share, seconds since the last trade, price change, SOL from other buyers, 1+ SOL buys).
- `exit`: profit target `tp`, stop loss `sl`, trailing stop `trail` once up `arm` (fractions: 0.2 = 20 %), the
  longest hold `hold_s`, and `dev_exit` to sell when the creator sells. 0 turns a part off.

The same `strategy.py` scores coins in the backtests, so a ruleset runs exactly as it was tested.

## Finding rulesets: `lab/`

| File | What it does |
| --- | --- |
| `lab/recorder.py` | Records every new pump.fun coin and all its trades from the chain into SQLite, over three staggered WebSockets (the public RPC drops each one about every 17 s; together they miss well under 1 % of the time) |
| `lab/sim.py` | Replays a coin: the buy lands `L` slots after the decision on the curve as other traders left it, constant-product fills, 1.25 % pump.fun fee each way, a network fee per transaction |
| `lab/processor.py` | Once a coin's trading window is over, stores its features and the result of every exit rule at each decision time and delay |
| `lab/search.py` | Walk-forward: picks a ruleset from earlier blocks only and scores it on the next two blocks it never saw |
| `lab/loop.py` | Every 20 minutes freezes a ruleset (chosen on the earlier two thirds of the coins, confirmed on the last third) into `freezes/`, and scores every earlier freeze on coins launched after it; PASS = its first two fresh 20-minute blocks both profitable at 2.4 s and 4.8 s delay with 30+ trades each (`loop.log`) |
| `lab/copytest.py` | Learns wallets that made money on new coins in one window and copies their buys (at the bot's delay, selling when they sell) in the next |
| `lab/ecosystem.config.cjs` | Runs the recorder, processor and loop under PM2 (the recorder keeps 24 h, the processor 12 h; `KEEP_HOURS` changes either) |

```bash
cd scripts/solana-bot-api/lab
python recorder.py pump.db        # leave running
python processor.py               # leave running; writes outcomes.pkl
python search.py 20               # 20-minute blocks
python loop.py --every 1200       # freeze and forward-test every 20 minutes
```

Or all three under PM2: `pm2 start lab/ecosystem.config.cjs` (needs `pip install numpy websockets`).

A round trip at 0.1 SOL costs about 5 % before the price moves (2.5 % pump.fun fees, 2 % network fees at the
0.001 SOL priority cap, the buy's own price impact), so a ruleset has to beat that on every trade it takes.

## Safety rails

| Rail | Setting | Default |
| --- | --- | --- |
| Biggest buy the UI or API can ask for | `MAX_BUY_AMOUNT_SOL` | 0.1 SOL |
| Live buys per start, then it only watches | `MAX_TRADES_PER_RUN` | 5 |
| SOL always left for fees | `MIN_SOL_RESERVE` | 0.02 SOL |
| Skip if the quote's price impact is higher | `MAX_PRICE_IMPACT_PCT` | 25 % |
| Skip signals older than | `MAX_SIGNAL_AGE_S` | 20 s |
| Skip pump.fun curve variants (rugged most often in testing) | `SKIP_CURVE_VARIANTS` | on |
| Priority fee cap per trade | `PRIORITY_FEE_MAX_LAMPORTS` | 0.001 SOL |

Plus: one buy per coin per run, a failed simulation is never sent, it refuses to sign a transaction whose fee
payer isn't your wallet, and LIVE won't start without a key (and needs a tick-box in the UIs).
Use a **dedicated hot wallet** holding only what the bot may spend.

## Files

| File | What it is |
| --- | --- |
| `config.py` | Every setting, from `.env` |
| `rpc_client.py` | Shared Solana JSON-RPC client and the wallet (signing, balance) |
| `pumpcurve.py` | Reads a pump.fun bonding curve (reserves, SOL raised) and tells classic curves from variants |
| `jupiter.py` | Jupiter Swap API v1 `/quote` + `/swap` (needs a free `JUPITER_API_KEY`) |
| `pumpevents.py` | Decodes pump.fun's launch, trade and migration events from the program logs |
| `market.py` | Live trade books for new coins and held coins, fed by the listener |
| `strategy.py` | The ruleset: features, filters, exit rule, curve maths, positions |
| `listener.py` | `run_listener`: RPC WebSocket `logsSubscribe` with reconnect, pump.fun events, the ruleset's buy decision, copy-trade parsing |
| `executor.py` | `run_executor`: the buy pipeline and the rails above, positions and sells for a ruleset |
| `main.py` | Terminal runner: `python main.py --mode sniper --buy 0.01` (add `--live` for real trades) |
| `bot_manager.py` | `BotManager`: start/stop, validation, event ring buffer, broadcaster |
| `bot_adapter.py` | Wires `BotManager` to the modules above and checks keys before starting |
| `api.py` | FastAPI: `/api/health`, `/api/status`, `/api/start`, `/api/stop`, `/ws/stream`, `/` panel, `/sdk/*` |
| `static/index.html` | Standalone control panel |
| `web/solana-bot-client.js` (+ `.d.ts`), `web/ReactWidgetExample.tsx` | SDK and widget for other sites |
| `tests/` | Parsing, every rail, event decoding, features, exits, a ruleset buying and selling on paper end to end, a local WebSocket listener run and a full API pipeline run |
| `DEPLOYMENT.md` | Setup, local run, VPS with HTTPS |

## Quick start

```bash
cd scripts/solana-bot-api
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # RPC_URL, PRIVATE_KEY, JUPITER_API_KEY, DASHBOARD_PASSWORD
.venv/bin/python main.py --mode sniper --buy 0.01            # dry run in the terminal
.venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000         # or control it from the admin tab
```

Tests: `.venv/bin/python -m unittest discover -s tests -v` (not part of `pnpm test`).
