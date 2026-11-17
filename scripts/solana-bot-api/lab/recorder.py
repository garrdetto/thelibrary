"""Record every new pump.fun coin and all of its trades from the chain, as they confirm.

Two staggered WebSocket logsSubscribe connections to the Solana RPC (the public node drops a
connection about every 17 s), de-duplicated by signature. Writes SQLite: coins, trades, gaps.
Times: recv_ms = when this machine got the event (ms), ts = on-chain block time (s).
"""
import asyncio, json, os, sqlite3, sys, time
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pumpevents import decode_line  # noqa: E402

PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
URL = os.environ.get("RPC_WS", "wss://api.mainnet-beta.solana.com")
DB = sys.argv[1] if len(sys.argv) > 1 else "pump.db"
FOLLOW_S = 40 * 60  # keep recording a coin's trades for 40 min after launch
KEEP_S = float(os.environ.get("KEEP_HOURS", "24")) * 3600  # delete coins older than this

db = sqlite3.connect(DB, isolation_level=None)
db.execute("PRAGMA journal_mode=WAL")
db.executescript("""
CREATE TABLE IF NOT EXISTS coins (mint TEXT PRIMARY KEY, recv_ms INTEGER, ts INTEGER, slot INTEGER, creator TEXT, name TEXT, sym TEXT, vs INTEGER, vt INTEGER, classic INTEGER, sig TEXT);
CREATE TABLE IF NOT EXISTS trades (sig TEXT, i INTEGER, mint TEXT, recv_ms INTEGER, ts INTEGER, slot INTEGER, buy INTEGER, sol INTEGER, tok INTEGER, user TEXT, vs INTEGER, vt INTEGER, rs INTEGER, PRIMARY KEY (sig, i));
CREATE INDEX IF NOT EXISTS trades_mint ON trades(mint, slot);
CREATE TABLE IF NOT EXISTS completes (mint TEXT PRIMARY KEY, recv_ms INTEGER, slot INTEGER);
CREATE TABLE IF NOT EXISTS gaps (conn INTEGER, down_ms INTEGER, up_ms INTEGER);
""")
followed = {m: t for m, t in db.execute("select mint, recv_ms from coins where recv_ms > ?", (int(time.time() * 1000) - FOLLOW_S * 1000,))}
seen_sigs: dict[str, float] = {}
stats = {"tx": 0, "trades": 0, "coins": 0, "dup": 0}
pending = []


def handle(value, slot, now_ms):
    sig = value.get("signature")
    if not sig or value.get("err") is not None:
        return
    if sig in seen_sigs:
        stats["dup"] += 1
        return
    seen_sigs[sig] = now_ms
    stats["tx"] += 1
    i = 0
    for line in value.get("logs") or ():
        e = decode_line(line)
        if not e:
            continue
        i += 1
        if e["kind"] == "create":
            pending.append(("c", (e["mint"], now_ms, e["ts"], slot, e["creator"], e["name"][:40], e["symbol"][:16], e["vs"], e["vt"], int(e["classic"]), sig)))
            followed[e["mint"]] = now_ms
            stats["coins"] += 1
        elif e["kind"] == "trade":
            if e["mint"] in followed:
                pending.append(("t", (sig, i, e["mint"], now_ms, e["ts"], slot, int(e["buy"]), e["sol"], e["tok"], e["user"], e["vs"], e["vt"], e["rs"])))
                stats["trades"] += 1
        elif e["kind"] == "complete" and e["mint"] in followed:
            pending.append(("x", (e["mint"], now_ms, slot)))


def flush():
    if not pending:
        return
    rows = list(pending)
    pending.clear()
    db.execute("BEGIN")
    db.executemany("INSERT OR IGNORE INTO coins VALUES (?,?,?,?,?,?,?,?,?,?,?)", [r for k, r in rows if k == "c"])
    db.executemany("INSERT OR IGNORE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [r for k, r in rows if k == "t"])
    db.executemany("INSERT OR IGNORE INTO completes VALUES (?,?,?)", [r for k, r in rows if k == "x"])
    db.execute("COMMIT")


async def conn(cid, delay):
    await asyncio.sleep(delay)
    down = None
    while True:
        try:
            async with websockets.connect(URL, max_size=None, ping_interval=None, open_timeout=10) as ws:
                await ws.send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe", "params": [{"mentions": [PUMP]}, {"commitment": "confirmed"}]}))
                await asyncio.wait_for(ws.recv(), 10)
                if down:
                    db.execute("INSERT INTO gaps VALUES (?,?,?)", (cid, down, int(time.time() * 1000)))
                    down = None
                async for raw in ws:
                    now = int(time.time() * 1000)
                    r = json.loads(raw).get("params", {}).get("result", {})
                    if r:
                        handle(r["value"], r["context"]["slot"], now)
        except asyncio.CancelledError:
            raise
        except Exception:
            down = down or int(time.time() * 1000)
            await asyncio.sleep(0.2)


async def housekeeping():
    last = time.time()
    while True:
        await asyncio.sleep(0.5)
        flush()
        now = time.time()
        if now - last > 60:
            last = now
            cut = now * 1000 - 120_000
            for s in [s for s, t in seen_sigs.items() if t < cut]:
                del seen_sigs[s]
            old = now * 1000 - FOLLOW_S * 1000
            for m in [m for m, t in followed.items() if t < old]:
                del followed[m]
            print(time.strftime("%H:%M:%S"), stats, "following", len(followed), flush=True)
            if int(now) // 3600 != int(now - 60) // 3600:
                gone = int(now * 1000 - KEEP_S * 1000)
                db.execute("DELETE FROM trades WHERE mint IN (SELECT mint FROM coins WHERE recv_ms < ?)", (gone,))
                db.execute("DELETE FROM coins WHERE recv_ms < ?", (gone,))
                db.execute("DELETE FROM gaps WHERE up_ms < ?", (gone,))


async def main():
    await asyncio.gather(conn(0, 0), conn(1, 8), conn(2, 4), housekeeping())

asyncio.run(main())
