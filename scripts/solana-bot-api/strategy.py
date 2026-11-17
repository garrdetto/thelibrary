"""
strategy.py — the ruleset: which new coins to buy, when, and when to sell.

The same code scores coins in the backtests (scripts/solana-bot-api/lab/) and in the live bot,
so what was tested is what runs.

A ruleset (rules.json, path from RULES_PATH) is:
  {
    "name": "...",
    "decide_after_s": 10,                      # look at each new coin this long after launch
    "filters": [["n_buy", ">=", 5], ...],      # every filter must pass to buy
    "exit": {"tp": 0.5, "sl": 0.2, "trail": 0.15, "arm": 0.15, "hold_s": 60, "dev_exit": true},
    "tested": {...}                            # what the walk-forward test found (shown, not used)
  }
Without a rules file the sniper keeps its old behaviour: buy every classic coin at once, never sell.

Feature meanings (all at the decision moment, creator's own trades excluded unless named):
  dev_buy      SOL the creator bought at launch
  n_buy/n_sell number of buys / sells by others
  uniq         different wallets that bought
  raised       SOL in the curve (real reserves)
  dev_sold     1 if the creator has sold any
  top_share    the biggest single buyer's share of tokens bought by others
  early_snipe  buys by others in the launch slot or the next one
  mom5         SOL added to the curve in the last 5 s (12 slots)
  sell_ratio   sells / (buys + sells)
  quiet        seconds since the last trade
  ret_since0   price change since the first trade
  buy_sol      SOL spent by other buyers
  big_buys     buys of 1 SOL or more by others
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SLOT_S = 0.4
LAMPORTS = 1_000_000_000
PUMP_FEE = 0.0125  # 0.95% protocol + 0.30% creator, each way, on classic curves

FEATURES = ["dev_buy", "n_buy", "n_sell", "uniq", "raised", "dev_sold", "top_share", "early_snipe", "mom5",
            "sell_ratio", "quiet", "ret_since0", "buy_sol", "big_buys"]
OPS = (">=", "<=")


# --------------------------------------------------------------------------- curve math
def buy_tokens(vs: float, vt: float, spend_lamports: float) -> float:
    into = spend_lamports / (1 + PUMP_FEE)
    return vt - vs * vt / (vs + into)


def sell_lamports(vs: float, vt: float, tokens: float) -> float:
    return (vs - vs * vt / (vt + tokens)) * (1 - PUMP_FEE)


# --------------------------------------------------------------------------- one coin's trades
@dataclass
class CoinBook:
    mint: str
    creator: str
    create_slot: int
    created_at: float = 0.0          # local clock (time.monotonic) when the launch was seen
    slot: List[int] = field(default_factory=list)
    buy: List[bool] = field(default_factory=list)
    sol: List[int] = field(default_factory=list)
    tok: List[int] = field(default_factory=list)
    user: List[str] = field(default_factory=list)
    vs: List[int] = field(default_factory=list)
    vt: List[int] = field(default_factory=list)
    rs: List[int] = field(default_factory=list)
    completed: bool = False

    def add(self, slot: int, buy: bool, sol: int, tok: int, user: str, vs: int, vt: int, rs: int) -> None:
        # trades arrive almost always in order; keep the lists sorted by slot if one doesn't
        i = len(self.slot)
        while i and self.slot[i - 1] > slot:
            i -= 1
        for name, value in (("slot", slot), ("buy", buy), ("sol", sol), ("tok", tok), ("user", user), ("vs", vs), ("vt", vt), ("rs", rs)):
            getattr(self, name).insert(i, value)

    def last_at(self, slot: int) -> int:
        """Index of the last trade at or before `slot`, -1 if none."""
        lo, hi = 0, len(self.slot)
        while lo < hi:
            mid = (lo + hi) // 2
            if self.slot[mid] <= slot:
                lo = mid + 1
            else:
                hi = mid
        return lo - 1

    def price(self, k: int = -1) -> Optional[float]:
        if not self.slot:
            return None
        return self.vs[k] / self.vt[k]


def features(c: CoinBook, d: int) -> Optional[List[float]]:
    """Feature vector (FEATURES order) at slot `d`, or None before the first trade."""
    k = c.last_at(d)
    if k < 0:
        return None
    dev_buy = 0.0
    n_buy = n_sell = early = big = 0
    buy_sol = 0.0
    dev_sold = 0.0
    by: Dict[str, float] = {}
    for i in range(k + 1):
        is_dev = c.user[i] == c.creator
        if c.buy[i]:
            if is_dev:
                if dev_buy == 0.0:
                    dev_buy = c.sol[i] / LAMPORTS
                continue
            n_buy += 1
            by[c.user[i]] = by.get(c.user[i], 0.0) + c.tok[i]
            s = c.sol[i] / LAMPORTS
            buy_sol += s
            if s >= 1.0:
                big += 1
            if c.slot[i] <= c.create_slot + 1:
                early += 1
        else:
            if is_dev:
                dev_sold = 1.0
            else:
                n_sell += 1
    tot = sum(by.values())
    top = max(by.values()) / tot if tot > 0 else 0.0
    raised = c.rs[k] / LAMPORTS
    j = c.last_at(d - 12)
    raised_5 = c.rs[j] / LAMPORTS if j >= 0 else 0.0
    p0 = c.vs[0] / c.vt[0]
    p = c.vs[k] / c.vt[k]
    return [dev_buy, float(n_buy), float(n_sell), float(len(by)), raised, dev_sold, top, float(early), raised - raised_5,
            n_sell / max(1, n_buy + n_sell), (d - c.slot[k]) * SLOT_S, p / p0 - 1, buy_sol, float(big)]


# --------------------------------------------------------------------------- rules
@dataclass(frozen=True)
class ExitRule:
    tp: float = 0.0       # sell when the price is up this much (0.5 = +50%); 0 = off
    sl: float = 0.2       # sell when it is down this much
    trail: float = 0.0    # once up `arm`, sell if it falls this far from its peak; 0 = off
    arm: float = 0.0
    hold_s: float = 60.0  # sell after this long whatever happens
    dev_exit: bool = True # sell as soon as the creator sells


@dataclass
class Ruleset:
    name: str
    decide_after_s: float
    filters: List[Tuple[str, str, float]]
    exit: ExitRule
    tested: Dict[str, Any] = field(default_factory=dict)

    def passes(self, feats: Optional[List[float]]) -> Tuple[bool, str]:
        if feats is None:
            return False, "no trades yet"
        values = dict(zip(FEATURES, feats))
        for name, op, th in self.filters:
            v = values[name]
            if (op == ">=" and v < th) or (op == "<=" and v > th):
                return False, f"{name} {v:.3g} not {op} {th:.3g}"
        return True, "passed " + (", ".join(f"{n} {op} {th:.3g}" for n, op, th in self.filters) or "no filters")


def parse_rules(data: Dict[str, Any]) -> Ruleset:
    filters = []
    for item in data.get("filters", []):
        name, op, th = item
        if name not in FEATURES or op not in OPS:
            raise ValueError(f"bad filter {item!r}")
        filters.append((name, op, float(th)))
    ex = data.get("exit", {})
    rule = ExitRule(tp=float(ex.get("tp", 0)), sl=float(ex.get("sl", 0.2)), trail=float(ex.get("trail", 0)), arm=float(ex.get("arm", 0)),
                    hold_s=float(ex.get("hold_s", 60)), dev_exit=bool(ex.get("dev_exit", True)))
    if rule.sl < 0 or rule.sl >= 1 or rule.hold_s <= 0:
        raise ValueError("exit.sl must be in [0, 1) and exit.hold_s above 0")
    return Ruleset(name=str(data.get("name", "ruleset")), decide_after_s=float(data.get("decide_after_s", 0)), filters=filters, exit=rule,
                   tested=dict(data.get("tested", {})))


def load_rules(path: Optional[str] = None) -> Optional[Ruleset]:
    path = path if path is not None else os.getenv("RULES_PATH", str(Path(__file__).resolve().parent / "rules.json"))
    if not path or not Path(path).exists():
        return None
    return parse_rules(json.loads(Path(path).read_text()))


# --------------------------------------------------------------------------- an open position
@dataclass
class Position:
    mint: str
    tokens: float
    spend_lamports: float
    entry_price: float
    entry_slot: int
    opened_at: float          # time.monotonic()
    peak: float = 0.0
    last_price: float = 0.0
    live: bool = False        # real tokens in the wallet (False = a dry-run paper position)
    selling: bool = False
    sell_attempts: int = 0

    def __post_init__(self):
        self.peak = self.peak or self.entry_price
        self.last_price = self.last_price or self.entry_price


def exit_reason(p: Position, rule: ExitRule, price: float, *, now: float, dev_sold: bool = False, completed: bool = False) -> Optional[str]:
    """Why to sell now, or None. Order matches the backtest: migrated, stop, target, trail, creator sold, time."""
    p.last_price = price
    if completed:
        return "migrated off the curve"
    p.peak = max(p.peak, price)
    r = price / p.entry_price - 1
    if rule.sl and r <= -rule.sl:
        return f"stop loss ({r:+.0%})"
    if rule.tp and r >= rule.tp:
        return f"profit target ({r:+.0%})"
    if rule.trail and p.peak / p.entry_price - 1 >= rule.arm and price <= p.peak * (1 - rule.trail):
        return f"trailing stop ({r:+.0%}, peak {p.peak / p.entry_price - 1:+.0%})"
    if rule.dev_exit and dev_sold:
        return "creator sold"
    if now - p.opened_at >= rule.hold_s:
        return f"time limit ({rule.hold_s:.0f}s)"
    return None
