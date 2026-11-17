"""Walk-forward ruleset search on processed coins.

Coins are cut into time blocks by launch time. For each step the search sees only earlier blocks,
picks one ruleset by a fixed procedure, then that ruleset is scored on the next two blocks it never
saw. PASS = net profit on both unseen blocks with enough trades.
"""
from __future__ import annotations

import json, pickle, sys
import numpy as np

rng = np.random.default_rng(7)
BLOCK_MIN = float(sys.argv[1]) if len(sys.argv) > 1 else 20
MIN_TRAIN_TRADES = 40
MIN_TEST_TRADES = 8
N_SAMPLES = 30000
LAT = 0  # index into LATS (2.4 s); index 1 = 4.8 s used as a robustness check


def load():
    d = pickle.load(open("outcomes.pkl", "rb"))
    rows = sorted(d["rows"].values(), key=lambda r: r["t"])
    T = np.array([r["t"] for r in rows])
    F = np.stack([r["f"] for r in rows])            # n, W, nf
    P = np.stack([r["p"] for r in rows], axis=1)    # L, n, W, E
    return d, T, F, P


# a filter = list of (feature index, op, threshold)
def mask_of(F_w, flt):
    m = ~np.isnan(F_w[:, 0])
    for fi, op, th in flt:
        col = F_w[:, fi]
        m &= (col >= th) if op == ">=" else (col <= th)
    return m


def sample_config(F, nW, nE, feats, idx):
    wi = int(rng.integers(nW))
    k = int(rng.integers(0, 5))
    flt = []
    for fi in rng.choice(len(feats), size=k, replace=False):
        col = F[idx, wi, fi]
        col = col[~np.isnan(col)]
        if len(col) == 0:
            continue
        th = float(np.quantile(col, rng.uniform(0.05, 0.95)))
        flt.append((int(fi), ">=" if rng.random() < 0.5 else "<=", th))
    return wi, flt, int(rng.integers(nE))


def evaluate(P, F, idx, cfg, lat=LAT):
    wi, flt, ei = cfg
    m = mask_of(F[idx, wi], flt)
    pnl = P[lat, idx, wi, ei][m]
    pnl = pnl[~np.isnan(pnl)]
    return pnl


def pick(P, F, idx, block_of, feats, nW, nE, samples=N_SAMPLES):
    """Fixed selection rule: among rulesets with enough trades and profit in every training block,
    the best t-statistic of per-trade profit."""
    best, best_score = None, -1e9
    blocks = np.unique(block_of[idx])
    for _ in range(samples):
        cfg = sample_config(F, nW, nE, feats, idx)
        pnl = evaluate(P, F, idx, cfg)
        if len(pnl) < MIN_TRAIN_TRADES or pnl.mean() <= 0:
            continue
        wi, flt, ei = cfg
        m = mask_of(F[idx, wi], flt)
        ok = True
        for b in blocks:
            sel = idx[(block_of[idx] == b) & m]
            v = P[LAT, sel, wi, ei]
            v = v[~np.isnan(v)]
            if len(v) and v.sum() <= 0:
                ok = False
                break
        if not ok:
            continue
        score = pnl.mean() / (pnl.std(ddof=1) / np.sqrt(len(pnl)) + 1e-9)
        if score > best_score:
            best, best_score = cfg, score
    return best, best_score


def describe(d, cfg):
    wi, flt, ei = cfg
    ex = d["exits"][ei]
    f = " and ".join(f"{d['features'][fi]} {op} {th:.3g}" for fi, op, th in flt) or "every coin"
    return f"decide {d['W'][wi]}s after launch, buy if {f}; sell: tp {ex.tp:.0%} sl {ex.sl:.0%} trail {ex.trail:.0%}@{ex.arm:.0%} hold {ex.hold_s:.0f}s"


def main():
    d, T, F, P = load()
    feats = d["features"]
    nW, nE = F.shape[1], P.shape[3]
    block_of = ((T - T[0]) // int(BLOCK_MIN * 60_000)).astype(int)
    nb = block_of.max() + 1
    print(f"{len(T)} coins, {nb} blocks of {BLOCK_MIN:.0f} min")
    # Baselines on everything
    every = P[LAT, :, 0, :]
    print("baseline: buy every coin 1 s after launch, best single exit over all data:",
          f"{np.nanmax(np.nansum(every, axis=0)):+.3f} SOL over {len(T)} trades;",
          f"median exit {np.nanmedian(np.nansum(every, axis=0)):+.3f} SOL")
    results = []
    for k in range(3, nb - 1):
        train = np.where(block_of < k)[0]
        cfg, score = pick(P, F, train, block_of, feats, nW, nE)
        if cfg is None:
            print(f"step {k}: no ruleset passed the training checks")
            results.append({"k": k, "pass": False})
            continue
        tests = []
        for b in (k, k + 1):
            idx = np.where(block_of == b)[0]
            pnl = evaluate(P, F, idx, cfg)
            pnl_slow = evaluate(P, F, idx, cfg, lat=1)
            tests.append((len(pnl), float(pnl.sum()), float(pnl_slow.sum())))
        passed = all(n >= MIN_TEST_TRADES and s > 0 for n, s, _ in tests)
        tr = evaluate(P, F, train, cfg)
        print(f"step {k}: train {len(tr)} trades {tr.sum():+.3f} SOL (t={score:.1f}) | unseen A {tests[0][0]} trades {tests[0][1]:+.3f} SOL (slow {tests[0][2]:+.3f})"
              f" | unseen B {tests[1][0]} trades {tests[1][1]:+.3f} SOL (slow {tests[1][2]:+.3f}) | {'PASS' if passed else 'fail'}")
        print("   ", describe(d, cfg))
        results.append({"k": k, "pass": passed, "cfg": describe(d, cfg), "tests": tests})
    json.dump(results, open("walkforward.json", "w"), indent=1)


if __name__ == "__main__":
    main()
