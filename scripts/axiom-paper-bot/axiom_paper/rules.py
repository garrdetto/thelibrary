"""The bot's working rules. The owner sets a short list of dials (dials.json); `expand` turns them into the full rule set
(rules.json) that the strategy reads, with the fine rules taken from the chosen picky level."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .settings import Schema, Values

SCHEMA = Schema(Path(__file__).with_name("rules.json"))
PASSED_THROUGH = ("bot.enabled", "account.starting_sol", "costs.fee_mode", "costs.auto_fee_level", "costs.max_fee_sol", "costs.priority_fee_sol", "costs.bribe_sol")

COMMON: Values = {
    "bot.poll_seconds": 5,
    "bot.fast_feed": True,
    "bot.live_prices": True,
    "bot.price_seconds": 3,
    "risk.strength": 5,
    "risk.buy_mode": "fixed",
    "risk.max_position_pct": 100,
    "risk.max_exposure_pct": 100,
    "risk.scale_with_conviction": False,
    "risk.max_drawdown_pct": 0,
    "risk.loss_streak": 4,
    "risk.loss_streak_pause_minutes": 20,
    "risk.max_buys_per_hour": 20,
    "entry.min_gain_1m_pct": -100,
    "entry.min_gain_5m_pct": -100,
    "entry.min_market_cap_usd": 0,
    "entry.max_market_cap_usd": 0,
    "entry.max_age_minutes": 0,
    "entry.min_smart_holders": 0,
    "entry.min_viewers_per_min": 0,
    "entry.rebuy_above_high": True,
    "entry.cooldown_minutes": 15,
    "entry.max_buys_per_coin": 2,
    "entry.max_data_age_seconds": 90,
    "learned.min_runner_chance_pct": 0,
    "learned.min_explode_chance_pct": 0,
    "learned.min_maker_chance_pct": 0,
    "learned.skip_phase": "none",
    "learned.min_minutes_left": 0,
    "learned.missing": "pass",
    "mode.dex_quick_exits": False,
    "mode.score_sell_below": 0,
    "mode.score_drop_points": 0,
    "mode.quality_sell_below": 0,
    "mode.quality_drop_points": 0,
    "mode.dex_sell_below": 0,
    "mode.dex_drop_points": 0,
    "mode.blend_sell_below": 0,
    "mode.blend_drop_points": 0,
    "mode.score_trend": "any",
    "mode.quality_trend": "any",
    "mode.dex_trend": "any",
    "mode.blend_trend": "any",
    "exit.take_profit_sell_pct": 100,
    "exit.breakeven_after_target": False,
    "exit.trailing_stop_pct": 0,
    "exit.stall_minutes": 15,
    "exit.stall_min_gain_pct": 3,
    "exit.viewer_drop_pct": 0,
    "exit.sell_on_warning": True,
    "exit.follow_radar_advice": True,
    "exit.sell_when_overdue": False,
    "exit.no_price_minutes": 5,
    "costs.fee_pct": 1,
    "costs.price_impact": True,
    "costs.extra_slippage_pct": 1,
    "costs.stop_slippage_pct": 5,
}

PICKY: dict[str, Values] = {
    "strict": {
        "entry.signal": "buy", "entry.safety": "safe", "entry.max_failed_checks": 0, "entry.skip_warnings": True, "entry.radar_advice": "follow",
        "entry.min_viewers": 50, "entry.min_liquidity_usd": 15_000, "entry.min_volume_5m_usd": 5_000, "entry.min_buy_share_pct": 55,
        "entry.min_age_minutes": 3, "entry.max_gain_5m_pct": 100, "entry.confirm_pulls": 2, "mode.dex_confirm_pulls": 2, "mode.dex_skip_viewers": False,
        "verify.enabled": True, "verify.max_live_drop_pct": 8, "verify.max_drop_from_high_pct": 20, "verify.max_drop_30s_pct": 6,
        "verify.max_holder_age_seconds": 120, "verify.skip_holders_falling": True, "verify.live_market": True,
        "exit.on_tighten": "tighten_stop", "exit.tighten_trailing_pct": 12, "exit.left_radar": "tighten",
    },
    "normal": {
        "entry.signal": "any", "entry.safety": "caution", "entry.max_failed_checks": 1, "entry.skip_warnings": True, "entry.radar_advice": "never_only",
        "entry.min_viewers": 20, "entry.min_liquidity_usd": 8_000, "entry.min_volume_5m_usd": 3_000, "entry.min_buy_share_pct": 50,
        "entry.min_age_minutes": 2, "entry.max_gain_5m_pct": 150, "entry.confirm_pulls": 1, "mode.dex_confirm_pulls": 1, "mode.dex_skip_viewers": True,
        "verify.enabled": True, "verify.max_live_drop_pct": 10, "verify.max_drop_from_high_pct": 25, "verify.max_drop_30s_pct": 8,
        "verify.max_holder_age_seconds": 180, "verify.skip_holders_falling": True, "verify.live_market": True,
        "exit.on_tighten": "ignore", "exit.tighten_trailing_pct": 12, "exit.left_radar": "ignore",
    },
    "loose": {
        "entry.signal": "any", "entry.safety": "any", "entry.max_failed_checks": 2, "entry.skip_warnings": True, "entry.radar_advice": "never_only",
        "entry.min_viewers": 0, "entry.min_liquidity_usd": 5_000, "entry.min_volume_5m_usd": 1_500, "entry.min_buy_share_pct": 45,
        "entry.min_age_minutes": 1, "entry.max_gain_5m_pct": 300, "entry.confirm_pulls": 1, "mode.dex_confirm_pulls": 1, "mode.dex_skip_viewers": True,
        "verify.enabled": True, "verify.max_live_drop_pct": 15, "verify.max_drop_from_high_pct": 35, "verify.max_drop_30s_pct": 12,
        "verify.max_holder_age_seconds": 0, "verify.skip_holders_falling": False, "verify.live_market": True,
        "exit.on_tighten": "ignore", "exit.tighten_trailing_pct": 15, "exit.left_radar": "ignore",
    },
}


def defaults() -> Values:
    return SCHEMA.defaults()


def normalize(raw: Mapping[str, Any] | None) -> Values:
    return SCHEMA.normalize(raw)


def expand(dials: Mapping[str, Any]) -> Values:
    """The full rule set for the owner's dials."""
    rules = {**SCHEMA.defaults(), **COMMON, **PICKY.get(dials["buy.picky"], PICKY["normal"])}
    for key in PASSED_THROUGH:
        rules[key] = dials[key]
    buy_at = dials["buy.buy_at"]
    amount = dials["buy.amount_sol"]
    rules.update({
        "mode.pick_by": dials["buy.pick_by"],
        **{f"mode.{mode}_buy_at": buy_at for mode in ("score", "quality", "dex", "blend")},
        "risk.buy_amount_sol": amount,
        "risk.max_per_coin_sol": amount * 2,
        "risk.min_position_sol": min(0.02, amount),
        "risk.max_open_positions": dials["buy.max_coins"],
        "risk.daily_loss_limit_pct": dials["buy.daily_loss_pct"],
        "exit.take_profit_pct": dials["sell.target_pct"],
        "exit.ride_momentum": dials["sell.ride_momentum"],
        "exit.ride_trail_pct": dials["sell.ride_trail_pct"],
        "exit.stop_loss_pct": dials["sell.stop_loss_pct"],
        "exit.max_hold_minutes": dials["sell.max_hold_minutes"],
    })
    return normalize(rules)
