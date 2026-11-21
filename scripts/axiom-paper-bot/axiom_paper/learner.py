"""The bot's notebook. It samples every coin near its buy level, follows each sample until it would have hit the
profit target or the stop loss (or the hold time runs out), and keeps its own trades the same way. From those results
it learns which setups and which moments lose, so it can skip them, wait for a better moment, and raise its buy level
after a run of losing trades."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from .models import Coin, Position
from .pricegate import PriceGate

NEAR_POINTS = 20
SPACING_MS = 120_000
SAMPLES_PER_COIN_DAY = 12
GONE_MS = 120_000
WINDOW_MS = 3 * 86_400_000
KEEP_MS = 7 * 86_400_000
MIN_SEEN = 20
TRADE_WEIGHT = 3
REFRESH_MS = 120_000
RECENT_TRADES = 20


class Feature(NamedTuple):
    label: str
    timing: bool
    edges: tuple[float, ...]
    bands: tuple[str, ...]


FEATURES: dict[str, Feature] = {
    "score": Feature("Score", False, (60, 70, 80, 90), ("a score under 60", "a score of 60–69", "a score of 70–79", "a score of 80–89", "a score of 90+")),
    "age": Feature("Coin age", False, (5, 15, 60), ("under 5 minutes old", "5–15 minutes old", "15–60 minutes old", "over an hour old")),
    "buys": Feature("Buy share", False, (50, 60), ("under 50% buys", "50–60% buys", "over 60% buys")),
    "liquidity": Feature("Liquidity", False, (10_000, 30_000), ("under $10k liquidity", "$10k–30k liquidity", "over $30k liquidity")),
    "viewers": Feature("Axiom viewers", False, (50, 150), ("under 50 viewers", "50–150 viewers", "over 150 viewers")),
    "run1m": Feature("Last minute", True, (0, 10, 30, 60), ("falling over the last minute", "up 0–10% in a minute", "up 10–30% in a minute", "up 30–60% in a minute", "up 60%+ in a minute")),
    "run5m": Feature("Last 5 minutes", True, (0, 25, 75), ("falling over 5 minutes", "up 0–25% in 5 minutes", "up 25–75% in 5 minutes", "up 75%+ in 5 minutes")),
    "dip": Feature("Below its 10-minute high", True, (5, 15), ("at its 10-minute high", "5–15% under its 10-minute high", "over 15% under its 10-minute high")),
    "top10": Feature("Top 10 holders", False, (20, 30, 45), ("top 10 holders own under 20%", "top 10 holders own 20–30%", "top 10 holders own 30–45%", "top 10 holders own over 45%")),
    "bundlers": Feature("Bundlers", False, (5, 15, 30), ("bundlers hold under 5%", "bundlers hold 5–15%", "bundlers hold 15–30%", "bundlers hold over 30%")),
    "protraders": Feature("Pro traders", False, (5, 15, 30), ("pro traders hold under 5%", "pro traders hold 5–15%", "pro traders hold 15–30%", "pro traders hold over 30%")),
    "snipers": Feature("Snipers", False, (5, 15), ("snipers hold under 5%", "snipers hold 5–15%", "snipers hold over 15%")),
    "insiders": Feature("Insiders", False, (5, 15), ("insiders hold under 5%", "insiders hold 5–15%", "insiders hold over 15%")),
    "devhold": Feature("Dev holding", False, (1, 5), ("the dev holds under 1%", "the dev holds 1–5%", "the dev holds over 5%")),
    "freshwallets": Feature("Fresh wallets", False, (5, 15), ("fresh wallets hold under 5%", "fresh wallets hold 5–15%", "fresh wallets hold over 15%")),
    "holdrate": Feature("Holder growth", True, (0, 5, 20), ("losing holders", "0–5 new holders a minute", "5–20 new holders a minute", "over 20 new holders a minute")),
    "wallets": Feature("Wallet Score", False, (35, 50, 65, 80), ("a Wallet Score under 35", "a Wallet Score of 35–49", "a Wallet Score of 50–64", "a Wallet Score of 65–79", "a Wallet Score of 80+")),
    "whales": Feature("Whales holding", False, (1, 3), ("no whale holding $1k+", "1–2 whales holding $1k+", "3+ whales holding $1k+")),
    "liqshare": Feature("Liquidity vs market cap", False, (15, 30), ("liquidity under 15% of market cap", "liquidity 15–30% of market cap", "liquidity over 30% of market cap")),
    "turnover": Feature("Trading volume", False, (20, 60, 150), ("5-minute volume under 20% of market cap", "5-minute volume 20–60% of market cap", "5-minute volume 60–150% of market cap", "5-minute volume over 150% of market cap")),
    "voltrend": Feature("Volume trend", True, (-20, 10), ("volume shrinking over the last minute", "volume steady over the last minute", "volume growing over the last minute")),
    "liqtrend": Feature("Liquidity trend", True, (-5, 3), ("liquidity being pulled", "liquidity steady", "liquidity growing")),
}
COLUMNS = tuple(f"f_{name}" for name in FEATURES)

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS learn_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, mint TEXT NOT NULL, symbol TEXT NOT NULL, t INTEGER NOT NULL,
  price REAL NOT NULL, target REAL NOT NULL, stop REAL NOT NULL, horizon_ms INTEGER NOT NULL,
  high REAL NOT NULL, low REAL NOT NULL, last REAL NOT NULL, last_at INTEGER NOT NULL, outcome REAL, resolved_at INTEGER,
  {", ".join(f"{column} TEXT" for column in COLUMNS)}
);
CREATE INDEX IF NOT EXISTS learn_samples_resolved ON learn_samples (resolved_at);
CREATE INDEX IF NOT EXISTS learn_samples_open ON learn_samples (outcome, t);
"""


def _band(value: float | None, feature: Feature) -> str | None:
    if value is None:
        return None
    for edge, band in zip(feature.edges, feature.bands):
        if value < edge:
            return band
    return feature.bands[-1]


def features(coin: Coin, value: float | None, at_ms: int, market: Mapping[str, float | None] | None = None) -> dict[str, str | None]:
    """Which band of each feature the coin is in right now. `value` is the number the bot buys on; `market` holds the
    volume and liquidity trends from the bot's own pulls."""
    market = market or {}
    raw = {
        "score": value, "age": coin.age_minutes, "buys": coin.buy_share_pct, "liquidity": coin.liquidity, "viewers": coin.viewers,
        "run1m": coin.gain_1m, "run5m": coin.gain_5m, "dip": coin.below_high_pct(),
        "top10": coin.top10_pct, "bundlers": coin.bundlers_pct, "protraders": coin.pro_traders_pct, "snipers": coin.snipers_pct,
        "insiders": coin.insiders_pct, "devhold": coin.dev_pct, "freshwallets": coin.fresh_pct, "holdrate": coin.holders_per_min,
        "wallets": coin.wallet_score, "whales": None if coin.whales is None else float(coin.whales),
        "liqshare": coin.liquidity_share_pct(), "turnover": coin.turnover_pct(),
        "voltrend": market.get("volume_trend"), "liqtrend": market.get("liquidity_trend"),
    }
    return {name: _band(raw[name], feature) for name, feature in FEATURES.items()}


@dataclass
class Stat:
    seen: float
    mean: float
    won: float


@dataclass
class _Sample:
    id: int
    mint: str
    t: int
    price: float
    target: float
    stop: float
    horizon_ms: int
    high: float
    low: float
    last: float
    last_at: int
    ups: int = 0
    downs: int = 0


@dataclass
class Learner:
    db: sqlite3.Connection
    cost: float = 0.04
    table: dict[str, dict[str, Stat]] = field(default_factory=dict)
    overall: Stat | None = None
    adjust: int = 0
    recent_win_rate: float | None = None
    recent_trades: int = 0
    next_refresh: int = 0
    open: dict[str, list[_Sample]] = field(default_factory=dict)
    last_sampled: dict[str, int] = field(default_factory=dict)
    gate: PriceGate = field(default_factory=PriceGate)

    def __post_init__(self) -> None:
        self.db.executescript(SCHEMA)
        have = {row[1] for row in self.db.execute("PRAGMA table_info(learn_samples)")}
        for column in COLUMNS:
            if column not in have:
                self.db.execute(f"ALTER TABLE learn_samples ADD COLUMN {column} TEXT")
        present = {row[1] for row in self.db.execute("PRAGMA table_info(learn_samples)")}
        for column in COLUMNS:
            if column not in present:
                self.db.execute(f"ALTER TABLE learn_samples ADD COLUMN {column} TEXT")
        for row in self.db.execute("SELECT id, mint, t, price, target, stop, horizon_ms, high, low, last, last_at FROM learn_samples WHERE outcome IS NULL"):
            sample = _Sample(*row)
            self.open.setdefault(sample.mint, []).append(sample)
            self.last_sampled[sample.mint] = max(self.last_sampled.get(sample.mint, 0), sample.t)

    def _samples_today(self, mint: str, now: int) -> int:
        return self.db.execute("SELECT COUNT(*) FROM learn_samples WHERE mint = ? AND t >= ? AND source = 'watch'", (mint, now - 86_400_000)).fetchone()[0]

    def watch(self, coins: Mapping[str, Coin], values: Mapping[str, float | None], buy_at: float, target_pct: float, stop_pct: float, horizon_minutes: float, now: int, markets: Mapping[str, Mapping[str, float | None]] | None = None) -> None:
        """Called with each new Radar reading. `values` is each coin's number in the buy mode."""
        horizon = int(max(5.0, min(60.0, horizon_minutes or 30.0)) * 60_000)
        target, stop = target_pct / 100, (stop_pct or 50) / 100
        for mint, coin in coins.items():
            if coin.price is None:
                continue
            for sample in list(self.open.get(mint, [])):
                self._follow(sample, coin.price, now)
            value = values.get(mint)
            if value is None or value < buy_at - NEAR_POINTS or now - self.last_sampled.get(mint, 0) < SPACING_MS:
                continue
            if self._samples_today(mint, now) >= SAMPLES_PER_COIN_DAY:
                continue
            self._add("watch", coin.mint, coin.symbol, now, coin.price, target, stop, horizon, features(coin, value, now, (markets or {}).get(mint)))
            self.last_sampled[mint] = now
        for mint, samples in list(self.open.items()):
            if mint in coins:
                continue
            for sample in list(samples):
                if now - sample.last_at >= GONE_MS:
                    self._resolve(sample, sample.last / sample.price - 1, now)
        if now >= self.next_refresh:
            self.refresh(now)

    def _add(self, source: str, mint: str, symbol: str, now: int, price: float, target: float, stop: float, horizon: int, bands: Mapping[str, str | None], outcome: float | None = None) -> None:
        cursor = self.db.execute(
            f"INSERT INTO learn_samples (source, mint, symbol, t, price, target, stop, horizon_ms, high, low, last, last_at, outcome, resolved_at, {', '.join(COLUMNS)}) "
            f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {', '.join('?' for _ in COLUMNS)})",
            (source, mint, symbol[:16], now, price, target, stop, horizon, price, price, price, now, outcome, None if outcome is None else now, *(bands.get(name) for name in FEATURES)),
        )
        if outcome is None:
            self.open.setdefault(mint, []).append(_Sample(int(cursor.lastrowid or 0), mint, now, price, target, stop, horizon, price, price, price, now))

    def _follow(self, sample: _Sample, price: float, now: int) -> None:
        taken = self.gate.offer(("sample", sample.id), sample.last, price, now, "radar")
        if taken is None:
            return
        sample.last, sample.last_at = taken, now
        sample.high, sample.low = max(sample.high, taken), min(sample.low, taken)
        gain = taken / sample.price - 1
        sample.ups = sample.ups + 1 if gain >= sample.target else 0
        sample.downs = sample.downs + 1 if gain <= -sample.stop else 0
        if sample.ups >= 2:
            self._resolve(sample, sample.target, now)
        elif sample.downs >= 2:
            self._resolve(sample, -sample.stop, now)
        elif now - sample.t >= sample.horizon_ms:
            self._resolve(sample, gain, now)

    def _resolve(self, sample: _Sample, outcome: float, now: int) -> None:
        self.db.execute("UPDATE learn_samples SET outcome = ?, resolved_at = ?, high = ?, low = ?, last = ?, last_at = ? WHERE id = ?", (outcome, now, sample.high, sample.low, sample.last, sample.last_at, sample.id))
        samples = self.open.get(sample.mint, [])
        if sample in samples:
            samples.remove(sample)
        if not samples:
            self.open.pop(sample.mint, None)
        self.gate.forget(("sample", sample.id))

    def record_trade(self, position: Position, now: int) -> None:
        """A closed trade, entered with the bands it was bought in. Its result counts three times a watched sample."""
        bands = position.entry.get("bands")
        if not isinstance(bands, dict) or not position.cost:
            return
        outcome = position.pnl() / position.cost + self.cost
        self._add("trade", position.mint, position.symbol, now, position.entry_spot, 0.0, 0.0, 0, bands, outcome)
        self.refresh(now)

    def refresh(self, now: int) -> None:
        """Rebuild the tables from the last three days of results."""
        self.next_refresh = now + REFRESH_MS
        self.db.execute("DELETE FROM learn_samples WHERE t < ?", (now - KEEP_MS,))
        weight = f"CASE source WHEN 'trade' THEN {TRADE_WEIGHT} ELSE 1 END"
        query = f"SELECT {{group}} SUM({weight}), SUM({weight} * outcome), SUM({weight} * (outcome > ?)) FROM learn_samples WHERE resolved_at >= ? {{by}}"
        since = now - WINDOW_MS
        row = self.db.execute(query.format(group="", by=""), (self.cost, since)).fetchone()
        self.overall = Stat(row[0], row[1] / row[0], row[2] / row[0]) if row and row[0] else None
        table: dict[str, dict[str, Stat]] = {}
        for name in FEATURES:
            column = f"f_{name}"
            rows = self.db.execute(query.format(group=f"{column},", by=f"AND {column} IS NOT NULL GROUP BY {column}"), (self.cost, since))
            table[name] = {band: Stat(seen, total / seen, won / seen) for band, seen, total, won in rows if seen}
        self.table = table
        self._adjust(now)

    def _adjust(self, now: int) -> None:
        outcomes = [row[0] for row in self.db.execute("SELECT outcome FROM learn_samples WHERE source = 'trade' AND resolved_at >= ? ORDER BY resolved_at DESC LIMIT ?", (now - WINDOW_MS, RECENT_TRADES))]
        self.recent_trades = len(outcomes)
        if len(outcomes) < 8:
            self.recent_win_rate, self.adjust = None, 0
            return
        rate = sum(1 for outcome in outcomes if outcome > self.cost) / len(outcomes)
        self.recent_win_rate = rate
        self.adjust = 10 if rate < 0.25 else 5 if rate < 0.4 else -3 if rate > 0.6 else 0

    def _bad(self, name: str, band: str | None) -> Stat | None:
        stat = self.table.get(name, {}).get(band) if band else None
        if stat is None or stat.seen < MIN_SEEN:
            return None
        return stat if stat.mean - self.cost < -0.02 and stat.won < 0.4 else None

    def _best(self, name: str) -> tuple[str, Stat] | None:
        good = [(band, stat) for band, stat in self.table.get(name, {}).items() if stat.seen >= MIN_SEEN and stat.mean - self.cost > 0]
        return max(good, key=lambda item: item[1].mean) if good else None

    def check(self, coin: Coin, value: float | None, now: int, timing: bool, market: Mapping[str, float | None] | None = None) -> str | None:
        """Why the notebook says not to buy this coin now, or None."""
        bands = features(coin, value, now, market)
        worst: tuple[str, str, Stat] | None = None
        for name, feature in FEATURES.items():
            if feature.timing and not timing:
                continue
            stat = self._bad(name, bands[name])
            if stat is not None and (worst is None or stat.mean < worst[2].mean):
                worst = (name, bands[name] or "", stat)
        if worst is None:
            return None
        name, band, stat = worst
        lesson = f"coins {band} made {(stat.mean - self.cost) * 100:+.0f}% on average ({stat.seen:.0f} seen, {stat.won * 100:.0f}% won)"
        if not FEATURES[name].timing:
            return f"learned: {lesson}"
        best = self._best(name)
        better = f"; waiting until it is {best[0]} ({(best[1].mean - self.cost) * 100:+.0f}% on average)" if best and best[0] != band else ""
        return f"waiting for a better moment: {lesson}{better}"

    def describe_loss(self, position: Position) -> str | None:
        """One line on what a losing trade had in common with others, for the activity log."""
        bands = position.entry.get("bands")
        if not isinstance(bands, dict):
            return None
        shown = [band for band in (bands.get("run1m"), bands.get("age"), bands.get("dip")) if band]
        text = f"Lesson from {position.symbol} ({position.pnl_pct():+.0f}%, {(position.exit_reason or 'sold').lower()}): bought {', '.join(shown)}." if shown else f"Lesson from {position.symbol} ({position.pnl_pct():+.0f}%)."
        stats = [(FEATURES[name].label, band, self.table.get(name, {}).get(band)) for name, band in bands.items() if name in FEATURES and band]
        known = [(label, band, stat) for label, band, stat in stats if stat is not None and stat.seen >= MIN_SEEN]
        if known:
            label, band, stat = min(known, key=lambda item: item[2].mean)
            text += f" Coins {band}: {stat.seen:.0f} seen, {(stat.mean - self.cost) * 100:+.0f}% on average."
        if self.adjust > 0:
            text += f" Buy level raised {self.adjust} points while the last trades keep losing."
        return text

    def summary(self, timing: bool, enabled: bool) -> dict[str, Any]:
        """What the Radar page shows about learning."""
        lessons: list[dict[str, Any]] = []
        for name, feature in FEATURES.items():
            if feature.timing and not timing:
                continue
            for band, stat in self.table.get(name, {}).items():
                if stat.seen >= MIN_SEEN:
                    lessons.append({"feature": feature.label, "band": band, "seen": round(stat.seen), "avgPct": round((stat.mean - self.cost) * 100, 1), "winPct": round(stat.won * 100), "timing": feature.timing})
        lessons.sort(key=lambda lesson: lesson["avgPct"])
        picked = lessons[:4] + [lesson for lesson in lessons[-4:] if lesson not in lessons[:4]][::-1]
        watched = self.db.execute("SELECT COUNT(*) FROM learn_samples WHERE source = 'watch' AND outcome IS NOT NULL").fetchone()[0]
        trades = self.db.execute("SELECT COUNT(*) FROM learn_samples WHERE source = 'trade'").fetchone()[0]
        return {
            "enabled": enabled, "timing": timing, "watched": watched, "following": sum(len(samples) for samples in self.open.values()), "trades": trades,
            "avgPct": None if self.overall is None else round((self.overall.mean - self.cost) * 100, 1),
            "winPct": None if self.overall is None else round(self.overall.won * 100),
            "adjust": self.adjust if enabled else 0, "recentWinPct": None if self.recent_win_rate is None else round(self.recent_win_rate * 100), "recentTrades": self.recent_trades,
            "minSeen": MIN_SEEN, "lessons": picked,
        }
