"""Plain records: a coin as the Radar reports it, and a position the bot holds. The bot's money and coin prices are in SOL."""

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


def _count(source: dict[str, Any], key: str) -> int | None:
    value = number(source.get(key))
    return None if value is None else int(value)


def _first(values: Any) -> str | None:
    return str(values[0])[:140] if isinstance(values, list) and values else None


RECENT_HIGH_MS = 600_000


def _recent_high(token: dict[str, Any]) -> float | None:
    """The coin's highest dollar price over about the last 10 minutes, from the Radar's chart points."""
    prices: list[float] = []
    history = token.get("history") if isinstance(token.get("history"), list) else []
    points = [(number(point.get("t")), number(point.get("priceUsd"))) for point in history if isinstance(point, dict)]
    stamps = [stamp for stamp, _ in points if stamp]
    if stamps:
        latest = max(stamps)
        prices += [price for stamp, price in points if stamp and price and price > 0 and stamp >= latest - RECENT_HIGH_MS]
    spark = token.get("spark") if isinstance(token.get("spark"), dict) else {}
    for series in (spark.get("slow"), spark.get("fast")):
        if isinstance(series, list):
            prices += [price for price in (number(value) for value in series) if price and price > 0]
    return max(prices) if prices else None


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
    price_usd: float | None = None
    liquidity_sol: float | None = None
    advice_exit: str | None = None
    advice_rebuy: str | None = None
    exit_advice_reason: str | None = None
    rebuy_advice_reason: str | None = None
    high_price: float | None = None
    failed_labels: tuple[str, ...] = ()
    recent_high: float | None = None
    gain_30s: float | None = None
    holders: float | None = None
    holders_per_min: float | None = None
    holders_seen_at: float | None = None
    dex_score: float | None = None
    wallet_score: float | None = None
    whales: int | None = None
    good_whales: int | None = None
    bad_whales: int | None = None
    smart_usd: float | None = None
    wallet_summary: str | None = None
    top10_pct: float | None = None
    bundlers_pct: float | None = None
    pro_traders_pct: float | None = None
    snipers_pct: float | None = None
    insiders_pct: float | None = None
    dev_pct: float | None = None
    fresh_pct: float | None = None

    def below_high_pct(self) -> float | None:
        """How far under its 10-minute high the coin is, in percent."""
        if self.price is None or not self.recent_high or self.recent_high <= 0:
            return None
        return max(0.0, (1 - self.price / self.recent_high) * 100)

    def liquidity_share_pct(self) -> float | None:
        """Liquidity as a share of market cap: how much a seller can take out before the price caves."""
        if self.liquidity is None or not self.market_cap or self.market_cap <= 0:
            return None
        return self.liquidity / self.market_cap * 100

    def turnover_pct(self) -> float | None:
        """The last 5 minutes' volume as a share of market cap."""
        if self.volume_5m is None or not self.market_cap or self.market_cap <= 0:
            return None
        return self.volume_5m / self.market_cap * 100

    @staticmethod
    def from_token(token: dict[str, Any], sol_usd: float = 1.0) -> "Coin":
        """`sol_usd` turns the Radar's dollar price, liquidity and high into SOL. The dollar figures stay for the buy rules."""
        change = token.get("priceChange") if isinstance(token.get("priceChange"), dict) else {}
        safety = token.get("safety") if isinstance(token.get("safety"), dict) else {}
        quality = token.get("quality") if isinstance(token.get("quality"), dict) else {}
        checks = quality.get("checks") if isinstance(quality.get("checks"), list) else []
        failed = tuple(str(check.get("label") or "a check")[:40] for check in checks if isinstance(check, dict) and check.get("status") == "fail")
        outlook = token.get("outlook") if isinstance(token.get("outlook"), dict) else {}
        advice = token.get("advice") if isinstance(token.get("advice"), dict) else {}
        buy_ratio = number(token.get("buyRatio"))
        price = number(token.get("priceUsd"))
        price = price if price and price > 0 else None
        liquidity = number(token.get("liquidityUsd"))
        high = number(advice.get("highPrice"))
        recent_high = _recent_high(token)
        traits = token.get("holderTraits") if isinstance(token.get("holderTraits"), dict) else {}
        pulse = token.get("pulse") if isinstance(token.get("pulse"), dict) else {}
        gains = token.get("gains") if isinstance(token.get("gains"), dict) else {}
        holder_gains = gains.get("holders") if isinstance(gains.get("holders"), dict) else {}
        seen = [stamp for stamp in (number(traits.get("checkedAt")), number(pulse.get("seenAt"))) if stamp]
        holders_per_min = number(holder_gains.get("m1"))
        dex = token.get("dex") if isinstance(token.get("dex"), dict) else {}
        wallets = token.get("wallets") if isinstance(token.get("wallets"), dict) else {}
        return Coin(
            mint=str(token.get("mint", "")),
            symbol=str(token.get("symbol") or "?")[:16],
            pair=token.get("pairAddress") if isinstance(token.get("pairAddress"), str) else None,
            price=None if price is None else price / sol_usd,
            price_usd=price,
            score=number(token.get("score")) or 0.0,
            signal=token.get("signal") if token.get("signal") in ("buy", "watch") else None,
            viewers=number(token.get("viewers")),
            viewers_per_min=number(token.get("viewersPerMin")),
            liquidity=liquidity,
            liquidity_sol=None if liquidity is None else liquidity / sol_usd,
            market_cap=number(token.get("marketCap")),
            volume_5m=number(token.get("volume5m")),
            buy_share_pct=None if buy_ratio is None else buy_ratio * 100,
            age_minutes=number(token.get("ageMinutes")),
            gain_1m=number(change.get("m1")),
            gain_5m=number(change.get("m5")),
            safety=str(safety.get("level") or "unknown"),
            quality=number(quality.get("score")),
            failed_checks=len(failed),
            failed_labels=failed,
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
            high_price=None if high is None else high / sol_usd,
            recent_high=None if recent_high is None else recent_high / sol_usd,
            gain_30s=number(change.get("s30")),
            holders=number(pulse.get("holders")) or number(traits.get("holders")),
            holders_per_min=holders_per_min if holders_per_min is not None else number(token.get("holdersPerMin")),
            holders_seen_at=max(seen) if seen else None,
            dex_score=number(dex.get("score")),
            wallet_score=number(wallets.get("score")),
            whales=_count(wallets, "whales"),
            good_whales=_count(wallets, "goodWhales"),
            bad_whales=_count(wallets, "badWhales"),
            smart_usd=number(wallets.get("smartUsd")),
            wallet_summary=str(wallets["summary"])[:160] if isinstance(wallets.get("summary"), str) else None,
            top10_pct=number(traits.get("top10")),
            bundlers_pct=number(traits.get("bundlers")),
            pro_traders_pct=number(traits.get("proTraders")),
            snipers_pct=number(traits.get("snipers")),
            insiders_pct=number(traits.get("insiders")),
            dev_pct=number(traits.get("dev")),
            fresh_pct=number(traits.get("fresh")),
        )

    def entry_facts(self) -> dict[str, Any]:
        """What the Radar said at the moment of a buy, kept with the trade for later study."""
        return {
            "score": self.score, "dexScore": self.dex_score, "signal": self.signal, "viewers": self.viewers, "viewersPerMin": self.viewers_per_min,
            "liquidity": self.liquidity, "marketCap": self.market_cap, "volume5m": self.volume_5m, "buySharePct": self.buy_share_pct,
            "ageMinutes": self.age_minutes, "gain1m": self.gain_1m, "gain5m": self.gain_5m, "safety": self.safety,
            "quality": self.quality, "failedChecks": self.failed_checks, "failedLabels": list(self.failed_labels), "smartHolders": self.smart_holders,
            "runnerChance": self.runner_chance, "explodeChance": self.explode_chance, "makerChance": self.maker_chance,
            "phase": self.phase, "minutesLeft": self.minutes_left, "adviceExit": self.advice_exit, "adviceRebuy": self.advice_rebuy,
            "gain30s": self.gain_30s, "belowHighPct": self.below_high_pct(), "holdersPerMin": self.holders_per_min,
            "walletScore": self.wallet_score, "whales": self.whales, "goodWhales": self.good_whales, "badWhales": self.bad_whales,
            "smartUsd": self.smart_usd, "walletSummary": self.wallet_summary,
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
    cost: float
    proceeds: float
    fees: float
    entry_liquidity: float | None
    last_liquidity: float | None
    peak_price: float
    peak_viewers: float | None
    last_price: float
    last_price_at: int
    target_done: bool
    score: float
    peak_mode: float | None = None
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

    def pnl(self, open_value: float = 0.0) -> float:
        return self.proceeds + open_value - self.cost

    def pnl_pct(self, open_value: float = 0.0) -> float:
        return self.pnl(open_value) / self.cost * 100 if self.cost else 0.0
