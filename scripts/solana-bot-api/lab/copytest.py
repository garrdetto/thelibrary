"""Smart-wallet copy test: learn wallets that made money on new coins in one window, copy them in the next.

Wallet profit per coin = SOL from sells - SOL spent + what its leftover tokens would fetch on the curve
at the end of the recording. Copy: when a listed wallet buys a coin, the bot decides at that slot and
its buy lands L slots later; it sells when that wallet sells (also L slots later), at a stop, or at a
time limit, whichever comes first. Costs as in sim.py.
"""
from __future__ import annotations

import sqlite3, sys
from collections import defaultdict
import numpy as np
import sim

DB = "pump.db"
FEE = sim.FEE


def wallet_book(coins):
    """wallet -> list of per-coin profit (SOL)."""
    out = defaultdict(list)
    first_slot = defaultdict(list)
    for c in coins:
        per = defaultdict(lambda: [0.0, 0.0, 0.0])  # spent, got, tokens held
        for i in range(len(c.slot)):
            u = c.users[i]
            if u == c.creator:
                continue
            s = per[u]
            if c.buy[i]:
                s[0] += c.sol[i] * (1 + FEE) / 1e9
                s[2] += c.tok[i]
                first_slot[u].append(c.slot[i] - c.cslot)
            else:
                s[1] += c.sol[i] * (1 - FEE) / 1e9
                s[2] -= c.tok[i]
        vs, vt = c.vs[-1], c.vt[-1]
        for u, (spent, got, held) in per.items():
            if spent <= 0:
                continue
            left = sim.sell_sol(vs, vt, max(0.0, held)) / 1e9 if held > 0 else 0.0
            out[u].append(got + left - spent)
    return out, first_slot


def pick_wallets(book, first_slot, min_coins=3, min_pnl=0.5, min_win=0.5, min_entry_slots=3):
    smart = {}
    for u, pnls in book.items():
        if len(pnls) < min_coins:
            continue
        tot = sum(pnls)
        win = np.mean([p > 0 for p in pnls])
        # skip launch-slot snipers: copying them with a delay makes us their exit
        if np.median(first_slot[u]) < min_entry_slots:
            continue
        if tot >= min_pnl and win >= min_win:
            smart[u] = (tot, len(pnls), win)
    return smart


def copy_trades(coins, smart, lat=6, spend=0.1, net_fee=0.001005, hold_s=120, sl=0.35, min_buy_sol=0.05):
    res = []
    for c in coins:
        idx = None
        for i in range(len(c.slot)):
            if c.buy[i] and c.users[i] in smart and c.users[i] != c.creator and c.sol[i] >= min_buy_sol * 1e9:
                idx = i
                break
        if idx is None:
            continue
        leader = c.users[idx]
        d = int(c.slot[idx])
        k = sim.state_at(c, d + lat)
        q = sim.buy_tokens(c.vs[k], c.vt[k], spend * 1e9)
        p_in = c.vs[k] / c.vt[k]
        end = d + lat + int(hold_s / sim.SLOT_S)
        decide, why = end, "time"
        for i in range(k + 1, len(c.slot)):
            if c.slot[i] > end:
                break
            p = c.vs[i] / c.vt[i]
            if p / p_in - 1 <= -sl:
                decide, why = int(c.slot[i]), "stop"
                break
            if c.users[i] == leader and not c.buy[i]:
                decide, why = int(c.slot[i]), "leader sold"
                break
        j = sim.state_at(c, decide + lat)
        out = sim.sell_sol(c.vs[j], c.vt[j], q)
        res.append(((out - spend * 1e9) / 1e9 - 2 * net_fee, why, c.recv_ms))
    return res


if __name__ == "__main__":
    coins = sim.load(DB)
    import time
    cutoff = int(time.time() * 1000) - (600 + 60) * 1000
    coins = [c for c in coins if c.recv_ms < cutoff]
    t0 = coins[0].recv_ms
    span = coins[-1].recv_ms - t0
    print(f"{len(coins)} coins over {span/60000:.0f} min")
    # rolling: learn on [start, mid), copy on [mid, mid+test)
    TEST = 15 * 60_000
    mid = t0 + 30 * 60_000
    while mid + TEST <= coins[-1].recv_ms:
        train = [c for c in coins if c.recv_ms < mid]
        test = [c for c in coins if mid <= c.recv_ms < mid + TEST]
        book, fs = wallet_book(train)
        for params in ({"min_coins": 3, "min_pnl": 0.5, "min_win": 0.5}, {"min_coins": 5, "min_pnl": 1.0, "min_win": 0.6}, {"min_coins": 2, "min_pnl": 2.0, "min_win": 0.5}):
            smart = pick_wallets(book, fs, **params)
            for hold in (60, 300):
                r = copy_trades(test, smart, hold_s=hold)
                v = np.array([x[0] for x in r]) if r else np.array([0.0])
                print(f"learn to {(mid-t0)/60000:.0f} min, wallets {len(smart):4d} {params} hold {hold}: {len(r):3d} copies, {v.sum():+.3f} SOL, win {np.mean(v>0):.0%}, median {np.median(v)*1000:+.1f} mSOL")
        mid += TEST
