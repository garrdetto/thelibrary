"""The trading rules: which coins pass, how big the bet is, and when a position is sold."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, NamedTuple

from .models import Coin, Position

Settings = Mapping[str, Any]

SAFETY_ALLOWED = {"safe": {"safe"}, "caution": {"safe", "caution"}}
PHASES_SKIPPED = {"overdue": {"overdue"}, "late": {"late", "overdue"}}


class Exit(NamedTuple):
    reason: str
    share: float
    urgent: bool = False


def _money(value: float) -> str:
    return f"${value:,.0f}" if abs(value) >= 100 else f"${value:,.2f}"


def _below(value: float | None, minimum: float, label: str, unit: str = "", off_at: float = 0) -> str | None:
    if minimum <= off_at:
        return None
    if value is None:
        return f"no {label} yet"
    if value < minimum:
        return f"{label} {value:,.0f}{unit} under {minimum:,.0f}{unit}"
    return None


def _learned(value: float | None, minimum_pct: float, label: str, settings: Settings) -> str | None:
    if minimum_pct <= 0:
        return None
    if value is None:
        return f"no {label} yet" if settings["learned.missing"] == "skip" else None
    if value * 100 < minimum_pct:
        return f"{label} {value * 100:.0f}% under {minimum_pct:.0f}%"
    return None


def entry_block(coin: Coin, settings: Settings, data_age_seconds: float) -> str | None:
    """Why this coin is not bought, or None when it passes every rule."""
    s = settings
    if coin.price is None:
        return "no price"
    if data_age_seconds > s["entry.max_data_age_seconds"]:
        return f"data is {data_age_seconds:.0f}s old"
    if s["entry.signal"] == "buy" and coin.signal != "buy":
        return "not a recommended buy"
    if s["entry.signal"] == "buy_or_watch" and coin.signal is None:
        return "no buy or watch signal"
    if s["entry.skip_warnings"] and coin.alerts:
        return f"warning: {coin.alerts[0]}"
    if s["entry.radar_advice"] != "ignore":
        if coin.advice_rebuy == "never":
            return f"Radar says never rebuy: {coin.rebuy_advice_reason or 'it crashed or has a warning'}"
        if s["entry.radar_advice"] == "follow":
            if coin.advice_exit == "exit":
                return f"Radar says exit: {coin.exit_advice_reason or 'a warning sign is on'}"
            if coin.advice_rebuy == "wait":
                return f"Radar says wait: {coin.rebuy_advice_reason or 'warning signs are on'}"
            if coin.advice_exit == "tighten":
                return f"Radar says momentum is fading: {coin.exit_advice_reason or 'a warning sign is on'}"
    allowed = SAFETY_ALLOWED.get(s["entry.safety"])
    if allowed is not None and coin.safety not in allowed:
        return f"safety is {coin.safety}"
    if coin.failed_checks > s["entry.max_failed_checks"]:
        return f"{coin.failed_checks} failed quality checks"
    if s["entry.max_gain_5m_pct"] > 0 and coin.gain_5m is not None and coin.gain_5m > s["entry.max_gain_5m_pct"]:
        return f"already up {coin.gain_5m:.0f}% in 5m"
    if s["entry.max_market_cap_usd"] > 0 and coin.market_cap is not None and coin.market_cap > s["entry.max_market_cap_usd"]:
        return f"market cap {_money(coin.market_cap)} over the limit"
    if s["entry.max_age_minutes"] > 0 and coin.age_minutes is not None and coin.age_minutes > s["entry.max_age_minutes"]:
        return f"{coin.age_minutes:.0f} minutes old, over the limit"
    checks = (
        _below(coin.score, s["entry.min_score"], "score"),
        _below(coin.gain_1m, s["entry.min_gain_1m_pct"], "1m gain", "%", off_at=-100),
        _below(coin.gain_5m, s["entry.min_gain_5m_pct"], "5m gain", "%", off_at=-100),
        _below(coin.viewers, s["entry.min_viewers"], "viewers"),
        _below(coin.viewers_per_min, s["entry.min_viewers_per_min"], "viewer growth"),
        _below(coin.liquidity, s["entry.min_liquidity_usd"], "liquidity"),
        _below(coin.market_cap, s["entry.min_market_cap_usd"], "market cap"),
        _below(coin.volume_5m, s["entry.min_volume_5m_usd"], "5m volume"),
        _below(coin.buy_share_pct, s["entry.min_buy_share_pct"], "buy share", "%"),
        _below(coin.age_minutes, s["entry.min_age_minutes"], "age in minutes"),
        _below(coin.quality, s["entry.min_quality_score"], "quality score"),
        _below(float(coin.smart_holders), s["entry.min_smart_holders"], "smart holders"),
        _learned(coin.runner_chance, s["learned.min_runner_chance_pct"], "runner chance", s),
        _learned(coin.explode_chance, s["learned.min_explode_chance_pct"], "could-explode chance", s),
        _learned(coin.maker_chance, s["learned.min_maker_chance_pct"], "big-winner chance", s),
    )
    for reason in checks:
        if reason:
            return reason
    skipped = PHASES_SKIPPED.get(s["learned.skip_phase"])
    if skipped is not None:
        if coin.phase is None and s["learned.missing"] == "skip":
            return "no crash timing yet"
        if coin.phase in skipped:
            return "past its usual crash time" if coin.phase == "overdue" else "near its usual crash time"
    if s["learned.min_minutes_left"] > 0:
        if coin.minutes_left is None:
            if s["learned.missing"] == "skip":
                return "no crash timing yet"
        elif coin.minutes_left < s["learned.min_minutes_left"]:
            return f"{coin.minutes_left:.0f} minutes left before the usual crash"
    return None


def conviction(coin: Coin, settings: Settings) -> float:
    """0 at the minimum score, 1 at a perfect score; a learned chance can lift it."""
    floor = settings["entry.min_score"]
    from_score = 1.0 if floor >= 100 else min(1.0, max(0.0, (coin.score - floor) / (100 - floor)))
    chances = [chance for chance in (coin.runner_chance, coin.explode_chance, coin.maker_chance) if chance is not None]
    return max([from_score, *(min(1.0, max(0.0, chance)) for chance in chances)])


def strength_factor(settings: Settings) -> float:
    return settings["risk.strength"] / 5


def exposure_limit(equity: float, settings: Settings) -> float:
    return equity * min(100.0, settings["risk.max_exposure_pct"] * strength_factor(settings)) / 100


def position_size(coin: Coin, settings: Settings, equity: float, cash: float, exposure: float, spent_on_coin: float = 0.0) -> tuple[float, str]:
    """SOL to buy with and what set or limited the amount. A size of 0 means skip, with the reason.
    `spent_on_coin` is what the last 24 hours of buys already put into this coin."""
    s = settings
    if s["risk.buy_mode"] == "fixed":
        size = s["risk.buy_amount_sol"]
        limit = "buy amount"
    else:
        scale = 0.5 + conviction(coin, s) if s["risk.scale_with_conviction"] else 1.0
        size = equity * s["risk.position_pct"] / 100 * strength_factor(s) * scale
        limit = "risk strength"
    caps = [(equity * s["risk.max_position_pct"] / 100, "largest single bet")]
    if s["risk.max_per_coin_sol"] > 0:
        caps.append((s["risk.max_per_coin_sol"] - spent_on_coin, "most SOL in one coin"))
    if coin.liquidity_sol:
        caps.append((coin.liquidity_sol * s["risk.max_pool_share_pct"] / 100, "coin's liquidity"))
    caps.append((exposure_limit(equity, s) - exposure, "account exposure limit"))
    caps.append((cash, "cash on hand"))
    for cap, name in caps:
        if cap < size:
            size, limit = cap, name
    if size < s["risk.min_position_sol"]:
        return 0.0, f"buy of {max(0.0, size):.3f} SOL is too small ({limit})"
    return size, limit


def tightened(coin: Coin | None, settings: Settings, left_radar: bool) -> bool:
    """True while the position should be held on the tighter trailing stop."""
    if left_radar:
        return settings["exit.left_radar"] == "tighten"
    return bool(coin and settings["exit.follow_radar_advice"] and coin.advice_exit == "tighten")


def exit_signal(position: Position, coin: Coin | None, settings: Settings, now: int, left_radar: bool = False) -> Exit | None:
    """The reason and the share of the open position to sell when a sell rule fires, else None."""
    s = settings
    gain_pct = position.gain() * 100
    peak_gain_pct = (position.peak_price / position.entry_spot - 1) * 100
    held = position.held_minutes(now)
    if (now - position.last_price_at) / 60_000 >= s["exit.no_price_minutes"]:
        return Exit("No price", 1.0)
    if s["exit.sell_on_warning"] and coin and coin.alerts:
        return Exit(f"Radar warning: {coin.alerts[0]}", 1.0, True)
    if s["exit.follow_radar_advice"] and coin and coin.advice_exit == "exit":
        return Exit(f"Radar says exit: {coin.exit_advice_reason or 'a warning sign is on'}", 1.0, True)
    if left_radar and s["exit.left_radar"] == "sell":
        return Exit("Left the Radar", 1.0, True)
    if s["exit.stop_loss_pct"] > 0 and gain_pct <= -s["exit.stop_loss_pct"]:
        return Exit("Stop loss", 1.0, True)
    if position.target_done and s["exit.breakeven_after_target"] and gain_pct <= 0:
        return Exit("Back to entry after target", 1.0, True)
    if tightened(coin, s, left_radar) and s["exit.on_tighten"] != "ignore":
        why = "Left the Radar" if left_radar else f"Radar says momentum is fading: {coin.exit_advice_reason or 'a warning sign is on'}" if coin else "Momentum is fading"
        if s["exit.on_tighten"] == "sell_all":
            return Exit(why, 1.0)
        if position.last_price <= position.peak_price * (1 - s["exit.tighten_trailing_pct"] / 100):
            return Exit(f"Tightened trailing stop. {why}", 1.0, True)
    if s["exit.take_profit_pct"] > 0 and not position.target_done and gain_pct >= s["exit.take_profit_pct"]:
        return Exit("Profit target", s["exit.take_profit_sell_pct"] / 100)
    if s["exit.trailing_stop_pct"] > 0 and peak_gain_pct >= s["exit.trailing_start_pct"]:
        if position.last_price <= position.peak_price * (1 - s["exit.trailing_stop_pct"] / 100):
            return Exit("Trailing stop", 1.0, True)
    if coin:
        if s["exit.min_score"] > 0 and coin.score < s["exit.min_score"]:
            return Exit(f"Score fell to {coin.score:.0f}", 1.0)
        if s["exit.viewer_drop_pct"] > 0 and coin.viewers is not None and position.peak_viewers:
            if coin.viewers <= position.peak_viewers * (1 - s["exit.viewer_drop_pct"] / 100):
                return Exit("Viewers fell", 1.0)
        if s["exit.sell_when_overdue"] and coin.phase == "overdue":
            return Exit("Past the usual crash time", 1.0)
    if s["exit.stall_minutes"] > 0 and held >= s["exit.stall_minutes"] and gain_pct < s["exit.stall_min_gain_pct"]:
        return Exit("Stalled", 1.0)
    if s["exit.max_hold_minutes"] > 0 and held >= s["exit.max_hold_minutes"]:
        return Exit("Held too long", 1.0)
    return None
