"""Turn every recorded coin into features and sell outcomes once its trading window is over.

For each coin, for each decision time W (seconds after launch) and latency L (slots), stores the
features the bot would see at W and the SOL result of buying then and selling by each exit rule.
Results append to outcomes.pkl, so the search reads them instantly.
"""
import itertools, os, pickle, sys, time
import numpy as np
import sim

DB = "pump.db"
OUT = "outcomes.pkl"
W_LIST = [1, 3, 6, 10, 20, 40, 60, 120]
LATS = [6, 12]                     # 2.4 s and 4.8 s from decision to the buy landing
SPEND, NET_FEE = 0.1, 0.001005     # 0.1 SOL buys; 0.001 SOL priority cap + 5000 lamports base fee
EXITS = [sim.Exit(tp, sl, tr, arm, h, True)
         for tp in (0, 0.25, 0.5, 1.0, 2.0)
         for sl in (0.1, 0.2, 0.35, 0.6)
         for tr, arm in ((0, 0), (0.15, 0.15), (0.3, 0.3))
         for h in (20, 60, 180, 600)]
MATURE_MS = (600 + max(W_LIST) + 60) * 1000
KEEP_MS = float(os.environ.get("KEEP_HOURS", "12")) * 3_600_000  # outcomes kept for the search


def process(c):
    feats = np.full((len(W_LIST), len(sim.FEATURES)), np.nan)
    pnl = np.full((len(LATS), len(W_LIST), len(EXITS)), np.nan, dtype=np.float32)
    for wi, w in enumerate(W_LIST):
        d = c.cslot + int(round(w / sim.SLOT_S))
        f = sim.features(c, d)
        if f is None:
            continue
        feats[wi] = f
        for li, lat in enumerate(LATS):
            for ei, ex in enumerate(EXITS):
                r = sim.run_trade(c, d, ex, lat, SPEND, NET_FEE)
                if r:
                    pnl[li, wi, ei] = r[0]
    return feats, pnl


def main():
    done = {}
    if os.path.exists(OUT):
        with open(OUT, "rb") as fh:
            done = pickle.load(fh)["rows"]
    while True:
        now = int(time.time() * 1000)
        since = max((r["t"] for r in done.values()), default=0) - 5 * 60_000
        coins = [c for c in sim.load(DB, since, now - MATURE_MS) if c.mint not in done]
        t = time.time()
        for c in coins:
            f, p = process(c)
            done[c.mint] = {"t": c.recv_ms, "f": f, "p": p.astype(np.float16), "n": len(c.slot)}
        for m in [m for m, r in done.items() if r["t"] < now - KEEP_MS]:
            del done[m]
        if coins:
            tmp = OUT + ".tmp"
            with open(tmp, "wb") as fh:
                pickle.dump({"rows": done, "W": W_LIST, "L": LATS, "exits": EXITS, "features": sim.FEATURES}, fh)
            os.replace(tmp, OUT)
            print(time.strftime("%H:%M:%S"), f"processed {len(coins)} coins in {time.time() - t:.0f}s, total {len(done)}", flush=True)
        if "--once" in sys.argv:
            return
        time.sleep(60)


if __name__ == "__main__":
    main()
