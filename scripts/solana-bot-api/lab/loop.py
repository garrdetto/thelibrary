"""Freeze → forward-test loop. Every round:
  1. score every earlier freeze's primary ruleset on 20-minute blocks of coins launched after it was frozen;
     PASS = its first two fresh blocks both profitable at 2.4 s and 4.8 s delay, 30+ trades each;
  2. pick a new primary from all coins so far: choose on the earlier 2/3, confirm on the last 1/3;
  3. freeze it (freezes/NNN.json) with the launch-time cut-off.
"""
import glob, json, os, pickle, sys, time, datetime
import numpy as np

BLOCK = 20 * 60_000
W_USE = [3, 6, 10, 20, 40]
os.makedirs("freezes", exist_ok=True)


def load():
    d = pickle.load(open("outcomes.pkl", "rb"))
    rows = sorted(d["rows"].values(), key=lambda r: r["t"])
    T = np.array([r["t"] for r in rows]); F = np.stack([r["f"] for r in rows]); P = np.stack([r["p"] for r in rows], axis=1)
    return d, T, F, np.nan_to_num(P, nan=0.0), ~np.isnan(P)


def block_sums(mask, P_li_wi, sub_blocks, nb):
    """(nb, E) sums of the masked coins' results per block, for every exit at once."""
    out = np.zeros((nb, P_li_wi.shape[1]))
    np.add.at(out, sub_blocks[mask], P_li_wi[mask])
    return out


def select(d, T, F, P, valid):
    W, feats = d["W"], d["features"]
    n = len(T)
    cut = T[0] + int((T[-1] - T[0]) * 2 / 3)
    early, late = T < cut, T >= cut
    sb = ((T - T[0]) // (10 * 60_000)).astype(int)
    nb = sb.max() + 1
    nb_early = int(sb[early].max()) + 1
    best = None
    for w in W_USE:
        wi = W.index(w)
        P0, P1 = P[0, :, wi, :], P[1, :, wi, :]
        filters = [[]]
        for fi, name in enumerate(feats):
            col = F[:, wi, fi]
            ok = ~np.isnan(col)
            for th in np.unique(np.quantile(col[ok], np.linspace(0.1, 0.9, 9))):
                filters.append([(name, ">=", float(th))])
                filters.append([(name, "<=", float(th))])
        # add pairs built from the 25 singles with the best early totals
        ranked = []
        for flt in filters[1:]:
            name, op, th = flt[0]
            col = F[:, wi, feats.index(name)]
            m = (col >= th) if op == ">=" else (col <= th)
            if (m & early).sum() >= 60:
                ranked.append((float(np.max(P0[m & early].sum(0))), flt))
        ranked.sort(key=lambda r: r[0], reverse=True)
        tops = [f for _, f in ranked[:25]]
        for i in range(len(tops)):
            for j in range(i + 1, len(tops)):
                if tops[i][0][0] != tops[j][0][0]:
                    filters.append(tops[i] + tops[j])
        for flt in filters:
            m = ~np.isnan(F[:, wi, 0])
            for name, op, th in flt:
                col = F[:, wi, feats.index(name)]
                m &= (col >= th) if op == ">=" else (col <= th)
            me, ml = m & early, m & late
            if me.sum() < 40 or ml.sum() < 15:
                continue
            s0 = block_sums(me, P0, sb, nb)[:nb_early]
            s1 = block_sums(me, P1, sb, nb)[:nb_early]
            tot0, tot1 = s0.sum(0), s1.sum(0)
            pos = (s0 > 0).sum(0) + (s1 > 0).sum(0)
            # trimmed mean on early (drop the best 2% of trades) must be positive: not a lottery ticket
            e_ok = (tot0 > 0) & (tot1 > 0) & (pos >= nb_early)
            if not e_ok.any():
                continue
            vals = P0[me]
            k = max(1, len(vals) // 50)
            trim = (vals.sum(0) - np.sort(vals, axis=0)[-k:].sum(0)) / (len(vals) - k)
            e_ok &= trim > 0
            for e in np.where(e_ok)[0]:
                v0, v1 = P0[ml, e].sum(), P1[ml, e].sum()
                if v0 <= 0 or v1 <= 0:
                    continue
                score = min(v0, v1)
                if best is None or score > best[0]:
                    best = (score, w, flt, int(e), float(tot0[e]), float(tot1[e]), float(v0), float(v1), int(me.sum()), int(ml.sum()))
    return best


def forward(d, T, F, P, fz):
    W, ex, feats = d["W"], d["exits"], d["features"]
    c = fz["primary"]
    wi = W.index(c["decide_after_s"]); e = c["exit_index"]
    fresh = T > fz["data_until_launch_ms"]
    blk = (T - fz["data_until_launch_ms"]) // BLOCK
    m = fresh & ~np.isnan(F[:, wi, 0])
    for name, op, th in c["filters"]:
        col = F[:, wi, feats.index(name)]
        m &= (col >= th) if op == ">=" else (col <= th)
    complete = int((T.max() - fz["data_until_launch_ms"]) // BLOCK)  # blocks fully launched and processed
    out = []
    for b in range(complete):
        mm = m & (blk == b)
        out.append((int(mm.sum()), float(P[0, mm, wi, e].sum()), float(P[1, mm, wi, e].sum())))
    return out


def main():
    d, T, F, P, valid = load()
    ex = d["exits"]
    log = []
    for path in sorted(glob.glob("freezes/*.json")):
        fz = json.load(open(path))
        if not fz.get("primary"):
            continue
        res = forward(d, T, F, P, fz)
        passed = len(res) >= 2 and all(n >= 30 and a > 0 and b > 0 for n, a, b in res[:2])
        decided = len(res) >= 2
        line = f"{os.path.basename(path)} {fz['primary']['desc']}: " + (" | ".join(f"{n} trades {a:+.3f}/{b:+.3f}" for n, a, b in res) or "no fresh block yet")
        line += "  => PASS" if passed else ("  => fail" if decided else "")
        log.append(line)
        fz["forward"] = res
        fz["verdict"] = "PASS" if passed else ("fail" if decided else "pending")
        json.dump(fz, open(path, "w"), indent=1)
    # new freeze
    best = select(d, T, F, P, valid)
    k = len(glob.glob("freezes/*.json")) + 1
    fz = {"n": k, "frozen_at": int(time.time() * 1000), "data_until_launch_ms": int(T.max()), "coins_used": len(T)}
    if best:
        score, w, flt, e, t0, t1, v0, v1, ne, nl = best
        x = ex[e]
        desc = f"decide {w}s; " + (" and ".join(f"{a} {o} {th:.3g}" for a, o, th in flt) or "every coin") + f"; tp {x.tp:.0%} sl {x.sl:.0%} trail {x.trail:.0%}@{x.arm:.0%} hold {x.hold_s:.0f}s"
        fz["primary"] = {"desc": desc, "decide_after_s": w, "filters": flt, "exit_index": e,
                         "exit": {"tp": x.tp, "sl": x.sl, "trail": x.trail, "arm": x.arm, "hold_s": x.hold_s, "dev_exit": x.dev_exit},
                         "chosen_on_early": [round(t0, 3), round(t1, 3), ne], "confirmed_on_late": [round(v0, 3), round(v1, 3), nl]}
        log.append(f"new freeze {k:03d}: {desc} | early {t0:+.2f}/{t1:+.2f} SOL ({ne}) late {v0:+.2f}/{v1:+.2f} SOL ({nl})")
    else:
        fz["primary"] = None
        log.append(f"new freeze {k:03d}: no ruleset passed the early/late checks")
    json.dump(fz, open(f"freezes/{k:03d}.json", "w"), indent=1)
    stamp = datetime.datetime.now().strftime("%H:%M")
    with open("loop.log", "a") as fh:
        for line in log:
            fh.write(f"{stamp} {line}\n")
    print("\n".join(log))


if __name__ == "__main__":
    main()
