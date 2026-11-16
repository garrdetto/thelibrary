"""Looks back at every closed trade and works out why a losing buy was bought at the wrong time: what the chart, the
volume, the liquidity and the holders looked like at the moment of the buy, and what the price did afterwards. Each
buy gets mistake tags that could have been read before buying. When one tag keeps losing, coins that show it are
skipped until it clears (a spike cools off, volume picks up again), so the bot stops repeating the same mistake."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from .models import Coin, Position, number

WINDOW_MS = 7 * 86_400_000
MIN_TRADES = 5
LOSS_SHARE = 0.65
MAX_AVG_PCT = -4.0
NEVER_ROSE_PCT = 3.0
REFRESH_MS = 60_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS trade_reviews (
  position_id INTEGER NOT NULL, mint TEXT NOT NULL, symbol TEXT NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER NOT NULL,
  pnl_pct REAL NOT NULL, peak_pct REAL, tags TEXT NOT NULL, findings TEXT NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (position_id, opened_at)
);
CREATE INDEX IF NOT EXISTS trade_reviews_closed ON trade_reviews (closed_at);
"""


class Mistake(NamedTuple):
    label: str
    test: Callable[[Mapping[str, Any]], bool]
    say: Callable[[Mapping[str, Any]], str]


def _n(facts: Mapping[str, Any], key: str) -> float | None:
    return number(facts.get(key))


def _share(facts: Mapping[str, Any], top: str, bottom: str) -> float | None:
    upper, lower = _n(facts, top), _n(facts, bottom)
    return None if upper is None or not lower or lower <= 0 else upper / lower * 100


def _at_least(key: str, edge: float) -> Callable[[Mapping[str, Any]], bool]:
    return lambda facts: (_n(facts, key) or float("-inf")) >= edge


def _under(key: str, edge: float) -> Callable[[Mapping[str, Any]], bool]:
    return lambda facts: _n(facts, key) is not None and (_n(facts, key) or 0.0) < edge


MISTAKES: dict[str, Mistake] = {
    "chased_spike": Mistake(
        "Bought right after a 20%+ minute", _at_least("gain1m", 20),
        lambda f: f"bought right after a {_n(f, 'gain1m'):+.0f}% minute",
    ),
    "late_run": Mistake(
        "Bought late in the run", lambda f: (_n(f, "gain5m") or 0) >= 75 or f.get("phase") in ("late", "overdue"),
        lambda f: "bought late in the run (" + ", ".join(part for part in (
            f"up {_n(f, 'gain5m'):.0f}% in 5 minutes" if (_n(f, "gain5m") or 0) >= 75 else "",
            f"Radar said {f.get('phase')}" if f.get("phase") in ("late", "overdue") else "",
        ) if part) + ")",
    ),
    "at_high": Mistake(
        "Bought at its 10-minute high after a climb", lambda f: _n(f, "belowHighPct") is not None and (_n(f, "belowHighPct") or 0) < 3 and (_n(f, "gain5m") or 0) >= 15,
        lambda f: f"bought within {_n(f, 'belowHighPct'):.0f}% of its 10-minute high after a {_n(f, 'gain5m'):+.0f}% climb",
    ),
    "fading_volume": Mistake(
        "Volume was shrinking", _under("volumeTrend", -15),
        lambda f: f"5-minute volume was shrinking ({_n(f, 'volumeTrend'):+.0f}% over the last minute)",
    ),
    "liquidity_pulled": Mistake(
        "Liquidity was being pulled", _under("liquidityTrend", -5),
        lambda f: f"liquidity was falling ({_n(f, 'liquidityTrend'):+.0f}% over 2 minutes)",
    ),
    "thin_liquidity": Mistake(
        "Liquidity under 15% of market cap", lambda f: (_share(f, "liquidity", "marketCap") or 100) < 15,
        lambda f: f"liquidity was only {_share(f, 'liquidity', 'marketCap'):.0f}% of market cap",
    ),
    "quiet_trading": Mistake(
        "Little trading for its size", lambda f: (_share(f, "volume5m", "marketCap") or 100) < 20,
        lambda f: f"5-minute volume was only {_share(f, 'volume5m', 'marketCap'):.0f}% of market cap",
    ),
    "sellers_even": Mistake(
        "Sellers nearly matched buyers", _under("buySharePct", 53),
        lambda f: f"only {_n(f, 'buySharePct'):.0f}% of trades were buys",
    ),
    "weak_holders": Mistake(
        "Holders tied to coins that died", _under("walletScore", 40),
        lambda f: f"its holders were tied to coins that died (Wallet Score {_n(f, 'walletScore'):.0f})",
    ),
    "no_whales": Mistake(
        "No whale holding $1k+", lambda f: _n(f, "whales") is not None and (_n(f, "whales") or 0) < 1,
        lambda _f: "no whale had $1k+ in it",
    ),
}


def mistakes_in(facts: Mapping[str, Any]) -> list[str]:
    """The mistake tags a coin shows right now, from its facts at the moment of a buy."""
    return [name for name, mistake in MISTAKES.items() if mistake.test(facts)]


@dataclass
class Lesson:
    tag: str
    trades: int
    losses: int
    avg_pct: float

    @property
    def active(self) -> bool:
        return self.trades >= MIN_TRADES and self.losses / self.trades >= LOSS_SHARE and self.avg_pct <= MAX_AVG_PCT

    def text(self) -> str:
        return f"{MISTAKES[self.tag].label.lower()}: {self.losses} of {self.trades} such buys lost, {self.avg_pct:+.0f}% on average"


def _after_buy(position: Position) -> list[str]:
    """What the price did after the buy, in plain words."""
    found: list[str] = []
    peak = (position.peak_price / position.entry_spot - 1) * 100 if position.entry_spot else None
    if peak is not None and peak < NEVER_ROSE_PCT:
        found.append(f"it never rose more than {max(0.0, peak):.0f}% after the buy, so it was bought at the top")
    elif peak is not None and position.pnl() < 0:
        found.append(f"it rose {peak:.0f}% after the buy, then fell back before it could be sold for a profit")
    if position.entry_liquidity and position.last_liquidity is not None and position.last_liquidity < position.entry_liquidity * 0.8:
        found.append(f"liquidity fell {(1 - position.last_liquidity / position.entry_liquidity) * 100:.0f}% while it was held")
    reason = position.exit_reason or ""
    if reason.startswith("Radar warning"):
        found.append(f"the Radar warned: {reason.split(':', 1)[-1].strip().rstrip('.')}")
    return found


@dataclass
class Reviewer:
    db: sqlite3.Connection
    lessons: dict[str, Lesson] = field(default_factory=dict)
    next_refresh: int = 0

    def __post_init__(self) -> None:
        self.db.executescript(SCHEMA)

    def review(self, position: Position) -> str | None:
        """Writes the post-mortem of a closed trade and returns it, or None for a trade too old to have the facts."""
        facts = position.entry or {}
        if not position.cost or position.closed_at is None or not isinstance(facts, dict) or "gain1m" not in facts:
            return None
        pnl = position.pnl_pct()
        peak = (position.peak_price / position.entry_spot - 1) * 100 if position.entry_spot else None
        tags = mistakes_in(facts)
        findings = [MISTAKES[tag].say(facts) for tag in tags]
        after = _after_buy(position)
        if pnl < 0:
            text = f"Why {position.symbol} lost {pnl:.0f}%: " + ("; ".join(after) if after else "it fell after the buy") + "."
            if findings:
                text += " At the buy: " + "; ".join(findings) + "."
            known = [self.lessons[tag] for tag in tags if tag in self.lessons and self.lessons[tag].trades >= 2]
            if known:
                worst = min(known, key=lambda lesson: lesson.avg_pct)
                text += f" So far {worst.text()}."
        else:
            text = f"{position.symbol} made {pnl:+.0f}%" + (f" despite: {'; '.join(findings)}." if findings else " with no warning signs at the buy.")
        self.db.execute(
            "INSERT OR REPLACE INTO trade_reviews (position_id, mint, symbol, opened_at, closed_at, pnl_pct, peak_pct, tags, findings, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (position.id, position.mint, position.symbol, position.opened_at, position.closed_at, pnl, peak, json.dumps(tags), json.dumps(findings + after), text),
        )
        self.refresh(position.closed_at)
        return text

    def backfill(self, positions: list[Position]) -> int:
        """Reviews closed trades that have no review yet, such as the ones made before this existed."""
        done = set(self.db.execute("SELECT position_id, opened_at FROM trade_reviews"))
        added = 0
        for position in sorted(positions, key=lambda item: item.closed_at or 0):
            if (position.id, position.opened_at) not in done and self.review(position) is not None:
                added += 1
        return added

    def refresh(self, now: int) -> None:
        self.next_refresh = now + REFRESH_MS
        totals: dict[str, list[float]] = {}
        for tags, pnl in self.db.execute("SELECT tags, pnl_pct FROM trade_reviews WHERE closed_at >= ?", (now - WINDOW_MS,)):
            for tag in json.loads(tags):
                if tag in MISTAKES:
                    totals.setdefault(tag, []).append(pnl)
        self.lessons = {tag: Lesson(tag, len(results), sum(1 for pnl in results if pnl <= 0), sum(results) / len(results)) for tag, results in totals.items()}

    def check(self, facts: Mapping[str, Any], now: int) -> str | None:
        """Why a coin would repeat a mistake that keeps losing, or None."""
        if now >= self.next_refresh:
            self.refresh(now)
        active = [self.lessons[tag] for tag in mistakes_in(facts) if tag in self.lessons and self.lessons[tag].active]
        if not active:
            return None
        worst = min(active, key=lambda lesson: lesson.avg_pct)
        return f"learned from bad buys: {MISTAKES[worst.tag].say(facts)}, and {worst.text()}"

    def summary(self, enabled: bool) -> dict[str, Any]:
        """What the Radar page shows about the bot's mistakes."""
        lessons = sorted(self.lessons.values(), key=lambda lesson: lesson.avg_pct)
        recent = [
            {"symbol": symbol, "mint": mint, "closedAt": closed, "pnlPct": round(pnl, 1), "peakPct": None if peak is None else round(peak, 1), "tags": json.loads(tags), "text": text}
            for symbol, mint, closed, pnl, peak, tags, text in self.db.execute(
                "SELECT symbol, mint, closed_at, pnl_pct, peak_pct, tags, text FROM trade_reviews ORDER BY closed_at DESC LIMIT 8"
            )
        ]
        reviewed = self.db.execute("SELECT COUNT(*) FROM trade_reviews").fetchone()[0]
        return {
            "enabled": enabled, "reviewed": reviewed, "minTrades": MIN_TRADES,
            "lessons": [{"tag": lesson.tag, "label": MISTAKES[lesson.tag].label, "trades": lesson.trades, "losses": lesson.losses, "avgPct": round(lesson.avg_pct, 1), "active": enabled and lesson.active} for lesson in lessons],
            "recent": recent,
        }


def entry_facts(coin: Coin, market: Mapping[str, float | None] | None) -> dict[str, Any]:
    """The coin's facts at a buy, plus the volume and liquidity trends from the bot's own pulls."""
    market = market or {}
    return {**coin.entry_facts(), "volumeTrend": market.get("volume_trend"), "liquidityTrend": market.get("liquidity_trend")}
