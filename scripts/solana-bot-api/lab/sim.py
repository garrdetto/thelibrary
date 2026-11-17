"""Replay recorded pump.fun coins through a buy rule and sell rule, with the bot's real costs.

Clock: Solana slots (~0.4 s). The bot decides at slot d and its transaction lands L slots later:
the fill uses the curve after every trade up to that slot, so anyone who got in first moves the
price against us. Fills use the bonding curve's own constant-product math (virtual reserves),
1.25% pump.fun fee each way (0.95% protocol + 0.30% creator, read from the chain), and a fixed
network fee per transaction (priority fee + base fee). A sell is always possible on the curve.
"""
from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import strategy  # noqa: E402

SLOT_S = 0.4
FEE = 0.0125
LAMPORTS = 1_000_000_000


@dataclass(eq=False)
class Coin:
    mint: str
    recv_ms: int
    cslot: int
    creator: str
    slot: np.ndarray   # per trade, slot it landed in
    buy: np.ndarray    # 1 buy / 0 sell
    sol: np.ndarray    # lamports
    tok: np.ndarray
    vs: np.ndarray     # virtual SOL after the trade
    vt: np.ndarray     # virtual tokens after the trade
    rs: np.ndarray     # real SOL in curve after the trade
    dev: np.ndarray    # trade by the creator
    users: list
    complete_slot: int | None


def load(path: str, t0_ms: int = 0, t1_ms: int = 1 << 62, follow_ms: int = 0) -> list[Coin]:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    coins = {}
    for mint, recv, slot, creator in db.execute(
            "select mint, recv_ms, slot, creator from coins where classic=1 and recv_ms>=? and recv_ms<?", (t0_ms, t1_ms)):
        coins[mint] = [mint, recv, slot, creator, []]
    if not coins:
        return []
    for row in db.execute("select mint, slot, i, buy, sol, tok, vs, vt, rs, user from trades where mint in (select mint from coins where classic=1 and recv_ms>=? and recv_ms<?) order by mint, slot, i", (t0_ms, t1_ms)):
        c = coins.get(row[0])
        if c:
            c[4].append(row[1:])
    done = dict(db.execute("select mint, slot from completes"))
    out = []
    for mint, recv, cslot, creator, rows in coins.values():
        if not rows:
            continue
        a = np.array([r[:8] for r in rows], dtype=np.float64)
        users = [r[8] for r in rows]
        out.append(Coin(mint, recv, cslot, creator, a[:, 0].astype(np.int64), a[:, 2].astype(np.int8), a[:, 3], a[:, 4], a[:, 5], a[:, 6], a[:, 7],
                        np.array([u == creator for u in users]), users, done.get(mint)))
    out.sort(key=lambda c: c.recv_ms)
    return out


def state_at(c: Coin, slot: int):
    """Index of the last trade at or before `slot` (-1 = none yet)."""
    return int(np.searchsorted(c.slot, slot, side="right")) - 1


def buy_tokens(vs, vt, spend_lamports):
    into = spend_lamports / (1 + FEE)
    return vt - vs * vt / (vs + into)


def sell_sol(vs, vt, q):
    return (vs - vs * vt / (vt + q)) * (1 - FEE)


# --------------------------------------------------------------------------- features
FEATURES = strategy.FEATURES


def book_of(c: Coin) -> "strategy.CoinBook":
    if getattr(c, "_book", None) is None:
        b = strategy.CoinBook(c.mint, c.creator, c.cslot)
        b.slot, b.buy, b.sol, b.tok = c.slot.tolist(), [bool(x) for x in c.buy], c.sol.tolist(), c.tok.tolist()
        b.user, b.vs, b.vt, b.rs = list(c.users), c.vs.tolist(), c.vt.tolist(), c.rs.tolist()
        c._book = b
    return c._book


def features(c: Coin, d: int):
    f = strategy.features(book_of(c), d)
    return None if f is None else np.array(f)


# --------------------------------------------------------------------------- exits
@dataclass(frozen=True)
class Exit:
    tp: float        # take profit on spot price, e.g. 0.5 = +50%  (0 = off)
    sl: float        # stop loss, e.g. 0.25 = -25%
    trail: float     # trailing stop from peak once up `arm` (0 = off)
    arm: float
    hold_s: float    # max hold
    dev_exit: bool   # sell when the creator sells


def run_trade(c: Coin, entry_slot: int, ex: Exit, lat: int, spend: float, net_fee: float):
    """Buy at `entry_slot` (decision) landing `lat` slots later, then sell by `ex`. Returns (pnl_sol, hold_s, reason)."""
    fill = entry_slot + lat
    k = state_at(c, fill)
    if k < 0:
        return None
    vs, vt = c.vs[k], c.vt[k]
    spend_l = spend * LAMPORTS
    q = buy_tokens(vs, vt, spend_l)
    p_in = vs / vt
    end_slot = fill + int(ex.hold_s / SLOT_S)
    i = k + 1
    n = len(c.slot)
    peak = p_in
    decide, reason = end_slot, "time"
    while i < n and c.slot[i] <= end_slot:
        p = c.vs[i] / c.vt[i]
        if c.complete_slot and c.slot[i] >= c.complete_slot:
            decide, reason = c.slot[i], "migrated"
            break
        peak = max(peak, p)
        r = p / p_in - 1
        if ex.sl and r <= -ex.sl:
            decide, reason = c.slot[i], "stop"
            break
        if ex.tp and r >= ex.tp:
            decide, reason = c.slot[i], "target"
            break
        if ex.trail and peak / p_in - 1 >= ex.arm and p <= peak * (1 - ex.trail):
            decide, reason = c.slot[i], "trail"
            break
        if ex.dev_exit and c.dev[i] and not c.buy[i]:
            decide, reason = c.slot[i], "dev sold"
            break
        i += 1
    j = state_at(c, decide + lat)
    out = sell_sol(c.vs[j], c.vt[j], q)
    if reason == "migrated":
        out *= 0.95
    pnl = (out - spend_l) / LAMPORTS - 2 * net_fee
    return pnl, (decide + lat - fill) * SLOT_S, reason
