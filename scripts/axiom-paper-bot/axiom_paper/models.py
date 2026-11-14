"""Plain records: a coin as the Radar reports it, and a position the bot holds."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any


def number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _chance(source: Any, key: str) -> float | None:
    return number(source.get(key)) if isinstance(source, dict) else None


def _first(values: Any) -> str | None:
    return str(values[0])[:140] if isinstance(values, list) and values else None


@dataclass(frozen=True)
class Coin:
    mint: str
    symbol: str
    pair: str | None
    price: float | None
    score: float
    signal: str | None
    viewers: float | None
    viewers_per_min: float | None
    liquidity: float | None
    market_cap: float | None
    volume_5m: float | None
    buy_share_pct: float | None
    age_minutes: float | None
    gain_1m: float | None
    gain_5m: float | None
    safety: str
    quality: float | None
    failed_checks: int
    alerts: tuple[str, ...]
    smart_holders: int
    snapshot_at: float | None
    runner_chance: float | None
    explode_chance: float | None
    maker_chance: float | None
    phase: str | None
    minutes_left: float | None
    advice_exit: str | None = None
    advice_rebuy: str | None = None
    exit_advice_reason: str | None = None
    rebuy_advice_reason: str | None = None
    high_price: float | None = None

    @staticmethod
    def from_token(token: dict[str, Any]) -> "Coin":
        change = token.get("priceChange") if isinstance(token.get("priceChange"), dict) else {}
        safety = token.get("safety") if isinstance(token.get("safety"), dict) else {}
        quality = token.get("quality") if isinstance(token.get("quality"), dict) else {}
        checks = quality.get("checks") if isinstance(quality.get("checks"), list) else []
        outlook = token.get("outlook") if isinstance(token.get("outlook"), dict) else {}
        advice = token.get("advice") if isinstance(token.get("advice"), dict) else {}
        buy_ratio = number(token.get("buyRatio"))
        price = number(token.get("priceUsd"))
        return Coin(
            mint=str(token.get("mint", "")),
            symbol=str(token.get("symbol") or "?")[:16],
            pair=token.get("pairAddress") if isinstance(token.get("pairAddress"), str) else None,
            price=price if price and price > 0 else None,
            score=number(token.get("score")) or 0.0,
            signal=token.get("signal") if token.get("signal") in ("buy", "watch") else None,
            viewers=number(token.get("viewers")),
            viewers_per_min=number(token.get("viewersPerMin")),
            liquidity=number(token.get("liquidityUsd")),
            market_cap=number(token.get("marketCap")),
            volume_5m=number(token.get("volume5m")),
            buy_share_pct=None if buy_ratio is None else buy_ratio * 100,
            age_minutes=number(token.get("ageMinutes")),
            gain_1m=number(change.get("m1")),
            gain_5m=number(change.get("m5")),
            safety=str(safety.get("level") or "unknown"),
            quality=number(quality.get("score")),
            failed_checks=sum(1 for check in checks if isinstance(check, dict) and check.get("status") == "fail"),
            alerts=tuple(str(alert) for alert in token.get("alerts") or [] if alert),
            smart_holders=int(number(token.get("runnerWallets")) or 0),
            snapshot_at=number(token.get("lastSnapshotAt")),
            runner_chance=_chance(outlook, "runnerChance"),
            explode_chance=_chance(token.get("explode"), "chance"),
            maker_chance=_chance(token.get("maker"), "chance"),
            phase=outlook.get("phase") if outlook.get("phase") in ("early", "running", "late", "overdue") else None,
            minutes_left=number(outlook.get("minutesLeft")),
            advice_exit=advice.get("exit") if advice.get("exit") in ("hold", "tighten", "exit") else None,
            advice_rebuy=advice.get("rebuy") if advice.get("rebuy") in ("ok", "wait", "never") else None,
            exit_advice_reason=_first(advice.get("exitReasons")),
            rebuy_advice_reason=_first(advice.get("rebuyReasons")),
            high_price=number(advice.get("highPrice")),
        )

    def entry_facts(self) -> dict[str, Any]:
        """What the Radar said at the moment of a buy, kept with the trade for later study."""
        return {
            "score": self.score, "signal": self.signal, "viewers": self.viewers, "viewersPerMin": self.viewers_per_min,
            "liquidity": self.liquidity, "marketCap": self.market_cap, "volume5m": self.volume_5m, "buySharePct": self.buy_share_pct,
            "ageMinutes": self.age_minutes, "gain1m": self.gain_1m, "gain5m": self.gain_5m, "safety": self.safety,
            "quality": self.quality, "failedChecks": self.failed_checks, "smartHolders": self.smart_holders,
            "runnerChance": self.runner_chance, "explodeChance": self.explode_chance, "makerChance": self.maker_chance,
            "phase": self.phase, "minutesLeft": self.minutes_left, "adviceExit": self.advice_exit, "adviceRebuy": self.advice_rebuy,
        }


@dataclass
class Position:
    id: int
    mint: str
    symbol: str
    pair: str | None
    opened_at: int
    entry_spot: float
    entry_price: float
    qty: float
    qty_open: float
    cost_usd: float
    proceeds_usd: float
    fees_usd: float
    entry_liquidity: float | None
    last_liquidity: float | None
    peak_price: float
    peak_viewers: float | None
    last_price: float
    last_price_at: int
    target_done: bool
    score: float
    status: str = "open"
    closed_at: int | None = None
    exit_reason: str | None = None
    exit_high: float | None = None
    entry: dict[str, Any] = field(default_factory=dict)

    def gain(self, price: float | None = None) -> float:
        """Market move since the buy, as a fraction (0.25 is +25%)."""
        return (self.last_price if price is None else price) / self.entry_spot - 1

    def held_minutes(self, now: int) -> float:
        return ((self.closed_at or now) - self.opened_at) / 60_000

    def pnl_usd(self, open_value: float = 0.0) -> float:
        return self.proceeds_usd + open_value - self.cost_usd

    def pnl_pct(self, open_value: float = 0.0) -> float:
        return self.pnl_usd(open_value) / self.cost_usd * 100 if self.cost_usd else 0.0
