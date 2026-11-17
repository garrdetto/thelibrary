"""Pick a few simple rulesets from the data so far and freeze them (frozen.json) with the cut-off time.

Simple on purpose (one filter, or two), and picked for consistency across blocks at both delays, not
for the biggest total, so the lottery-ticket runs don't drive the choice.
"""
import itertools, json, pickle, sys, time
import numpy as np

d = pickle.load(open("outcomes.pkl", "rb"))
rows = sorted(d["rows"].values(), key=lambda r: r["t"])
T = np.array([r["t"] for r in rows]); F = np.stack([r["f"] for r in rows]); P = np.stack([r["p"] for r in rows], axis=1)
W, ex, feats = d["W"], d["exits"], d["features"]
BLOCK = 6 * 60_000
blk = (T - T[0]) // BLOCK
nb = blk.max() + 1
W_USE = [3, 6, 10, 20]


def score(mask, wi, e):
    out = []
    for li in (0, 1):
        p = P[li, :, wi, e]
        m = mask & ~np.isnan(p)
        if m.sum() < 80:
            return None
        per = np.array([p[m & (blk == b)].sum() for b in range(nb)])
        out.append((per, p[m]))
    (per0, v0), (per1, v1) = out
    pos = int((per0 > 0).sum() + (per1 > 0).sum())
    s = np.sort(v0)
    trim = s[:-max(1, len(s) // 50)].mean()
    return pos, float(v0.sum()), float(v1.sum()), float(trim), int(len(v0))


cands = []
for w in W_USE:
    wi = W.index(w)
    for fi, name in enumerate(feats):
        col = F[:, wi, fi]
        ok = ~np.isnan(col)
        qs = np.unique(np.quantile(col[ok], np.linspace(0.1, 0.9, 9)))
        for th in qs:
            for op in (">=", "<="):
                mask = ok & ((col >= th) if op == ">=" else (col <= th))
                for e in range(len(ex)):
                    r = score(mask, wi, e)
                    if r and r[1] > 0 and r[2] > 0:
                        cands.append((r, w, [(name, op, float(th))], e))
cands.sort(key=lambda c: (c[0][0], c[0][1] + c[0][2]), reverse=True)
top = cands[:400]
# try adding a second filter to the best singles
pairs = []
for r, w, flt, e in top[:60]:
    wi = W.index(w)
    base = np.ones(len(T), bool)
    for name, op, th in flt:
        col = F[:, wi, feats.index(name)]
        base &= (col >= th) if op == ">=" else (col <= th)
    for fi, name in enumerate(feats):
        if name == flt[0][0]:
            continue
        col = F[:, wi, fi]
        ok = ~np.isnan(col)
        for th in np.unique(np.quantile(col[ok], [0.2, 0.4, 0.6, 0.8])):
            for op in (">=", "<="):
                mask = base & ok & ((col >= th) if op == ">=" else (col <= th))
                r2 = score(mask, wi, e)
                if r2 and r2[1] > 0 and r2[2] > 0 and r2[0] > r[0]:
                    pairs.append((r2, w, flt + [(name, op, float(th))], e))
allc = sorted(top + pairs, key=lambda c: (c[0][0], c[0][1] + c[0][2]), reverse=True)


def desc(w, flt, e):
    x = ex[e]
    return {"decide_after_s": w, "filters": [[n, o, round(t, 6)] for n, o, t in flt],
            "exit": {"tp": x.tp, "sl": x.sl, "trail": x.trail, "arm": x.arm, "hold_s": x.hold_s, "dev_exit": x.dev_exit}}


chosen, seen = [], set()
for r, w, flt, e in allc:
    key = (w, tuple(n for n, _, _ in flt))
    if key in seen:
        continue
    seen.add(key)
    chosen.append({"name": f"cand{len(chosen) + 1}", **desc(w, flt, e),
                   "fit": {"blocks_positive_of": f"{r[0]}/{2 * nb}", "sol_2.4s": round(r[1], 3), "sol_4.8s": round(r[2], 3),
                           "trimmed_mean_msol": round(r[3] * 1000, 2), "trades": r[4]}})
    if len(chosen) == 5:
        break
frozen = {"frozen_at": int(time.time() * 1000), "data_until_launch_ms": int(T.max()), "coins_used": len(T), "block_min": BLOCK / 60000,
          "primary": "cand1", "candidates": chosen}
json.dump(frozen, open("frozen.json", "w"), indent=1)
for c in chosen:
    print(c["name"], json.dumps({k: c[k] for k in ("decide_after_s", "filters", "exit")}), c["fit"])
