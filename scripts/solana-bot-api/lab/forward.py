"""Score the frozen rulesets on coins launched after they were frozen, in 20-minute blocks."""
import json, pickle, datetime
import numpy as np
fz = json.load(open("frozen.locked.json"))
d = pickle.load(open("outcomes.pkl", "rb"))
rows = sorted((r for r in d["rows"].values() if r["t"] > fz["data_until_launch_ms"]), key=lambda r: r["t"])
BLOCK = 20 * 60_000
if not rows:
    print("no fresh coins yet"); raise SystemExit
T = np.array([r["t"] for r in rows]); F = np.stack([r["f"] for r in rows]); P = np.stack([r["p"] for r in rows], axis=1)
blk = (T - fz["data_until_launch_ms"]) // BLOCK
full = [b for b in range(blk.max() + 1)]  # last block may still be filling
W, ex, feats = d["W"], d["exits"], d["features"]
print(f"fresh coins: {len(T)} launched {datetime.datetime.fromtimestamp(T[0]/1000):%H:%M}–{datetime.datetime.fromtimestamp(T[-1]/1000):%H:%M}; blocks of 20 min (last one may be partial)")
summary = {}
for c in fz["candidates"]:
    wi = W.index(c["decide_after_s"])
    e = [i for i, x in enumerate(ex) if (x.tp, x.sl, x.trail, x.arm, x.hold_s, x.dev_exit) == tuple(c["exit"][k] for k in ("tp", "sl", "trail", "arm", "hold_s", "dev_exit"))][0]
    m = np.ones(len(T), bool)
    for n, op, th in c["filters"]:
        col = F[:, wi, feats.index(n)]
        m &= (col >= th) if op == ">=" else (col <= th)
    line = []
    for li in (0, 1):
        p = P[li, :, wi, e]; mm = m & ~np.isnan(p)
        per = [(int((mm & (blk == b)).sum()), float(p[mm & (blk == b)].sum())) for b in full]
        line.append(per)
    tag = " (primary)" if c["name"] == fz["primary"] else ""
    tot0 = sum(s for _, s in line[0]); tot1 = sum(s for _, s in line[1]); n = sum(k for k, _ in line[0])
    print(f"{c['name']}{tag}: {n} trades, total {tot0:+.3f} SOL at 2.4 s delay, {tot1:+.3f} at 4.8 s")
    print("   blocks (trades, SOL @2.4s / @4.8s): " + " | ".join(f"{a[0]}: {a[1]:+.3f} / {b[1]:+.3f}" for a, b in zip(line[0], line[1])))
    summary[c["name"]] = line
json.dump({"blocks": summary, "coins": len(T)}, open("forward.json", "w"))
