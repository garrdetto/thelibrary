"""The trading rules: which coins pass, how big the bet is, and when a position is sold."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, NamedTuple

from .models import Coin, Position
from .prices import Quote

Settings = Mapping[str, Any]

SAFETY_ALLOWED = {"safe": {"safe"}, "caution": {"safe", "caution"}}
PHASES_SKIPPED = {"overdue": {"overdue"}, "late": {"late", "overdue"}}
MODES = ("score", "quality", "dex", "blend")
MODE_LABELS = {"score": "score", "quality": "quality score", "dex": "DexScreener score", "blend": "blended score"}
QUICK_EXITS = ("stop_loss_pct", "take_profit_pct", "take_profit_sell_pct", "trailing_stop_pct", "trailing_start_pct", "max_hold_minutes")


class Exit(NamedTuple):
    reason: str
    share: float
    urgent: bool = False
    ride: bool = False


class Momentum(NamedTuple):
    strong: bool
    why: str


def momentum(coin: Coin | None, live_30s_pct: float | None, dex_trend: float | None) -> Momentum:
    """Whether the chart still looks like it is climbing. `live_30s_pct` is the bot's own price change over about 30 seconds,
    `dex_trend` how far the DexScreener score moved over the last minute of pulls."""
    votes = 0
    parts: list[str] = []
    falling_hard = False
    if live_30s_pct is not None:
        parts.append(f"{live_30s_pct:+.0f}% in 30s")
        votes += 1 if live_30s_pct >= 0 else -1 if live_30s_pct <= -3 else 0
        falling_hard = live_30s_pct <= -6
    if coin is not None:
        if coin.gain_30s is not None:
            if live_30s_pct is None:
                parts.append(f"{coin.gain_30s:+.0f}% in 30s")
            votes += 1 if coin.gain_30s > 0 else -1 if coin.gain_30s <= -3 else 0
        if coin.gain_1m is not None:
            parts.append(f"{coin.gain_1m:+.0f}% in 1m")
            votes += 1 if coin.gain_1m >= 2 else -1 if coin.gain_1m < 0 else 0
        if coin.buy_share_pct is not None:
            parts.append(f"{coin.buy_share_pct:.0f}% buys")
            votes += 1 if coin.buy_share_pct >= 55 else -1 if coin.buy_share_pct < 48 else 0
    if dex_trend is not None:
        parts.append(f"DexScreener score {dex_trend:+.0f}")
        votes += 1 if dex_trend >= 0 else -1 if dex_trend <= -10 else 0
    return Momentum(votes >= 2 and not falling_hard, ", ".join(parts) or "no chart data")


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


def mode_of(settings: Settings, position: Position | None = None) -> str:
    """The number the bot picks coins by. A position keeps the mode it was bought in."""
    if position is not None and position.entry.get("mode") in MODES:
        return position.entry["mode"]
    return settings["mode.pick_by"]


def mode_value(coin: Coin, mode: str) -> float | None:
    if mode == "quality":
        return coin.quality
    if mode == "dex":
        return coin.dex_score
    if mode == "blend":
        return coin.score if coin.dex_score is None else (coin.score + coin.dex_score) / 2
    return coin.score


def confirm_pulls(settings: Settings) -> int:
    """Passing pulls in a row needed before a buy in the current mode."""
    return int(settings["mode.dex_confirm_pulls"] if settings["mode.pick_by"] == "dex" else settings["entry.confirm_pulls"])


def exit_dials(settings: Settings, position: Position) -> Settings:
    """The sell settings for this position: a DexScreener-mode buy uses the quick-trade numbers when they are on."""
    if mode_of(settings, position) != "dex" or not settings["mode.dex_quick_exits"]:
        return settings
    return {**settings, **{f"exit.{name}": settings[f"mode.dex_{name}"] for name in QUICK_EXITS}}


def trend_block(change: float | None, mode: str, settings: Settings) -> str | None:
    """`change` is how far the mode's number moved over the last minute of pulls, or None before there are two readings."""
    wanted = settings[f"mode.{mode}_trend"]
    label = MODE_LABELS[mode]
    if wanted == "rising":
        if change is None:
            return f"waiting to see the {label} climb"
        if change <= 0:
            return f"{label} is not climbing ({change:+.0f} in the last minute)"
    if wanted == "steady" and change is not None and change < 0:
        return f"{label} fell {-change:.0f} in the last minute"
    return None


def entry_block(coin: Coin, settings: Settings, data_age_seconds: float, trend: float | None = None) -> str | None:
    """Why this coin is not bought, or None when it passes every rule. `trend` is the mode's one-minute change."""
    s = settings
    mode = s["mode.pick_by"]
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
    skip_viewers = mode == "dex" and s["mode.dex_skip_viewers"]
    checks = (
        _below(mode_value(coin, mode), s[f"mode.{mode}_buy_at"], MODE_LABELS[mode]),
        trend_block(trend, mode, s),
        _below(coin.gain_1m, s["entry.min_gain_1m_pct"], "1m gain", "%", off_at=-100),
        _below(coin.gain_5m, s["entry.min_gain_5m_pct"], "5m gain", "%", off_at=-100),
        None if skip_viewers else _below(coin.viewers, s["entry.min_viewers"], "viewers"),
        None if skip_viewers else _below(coin.viewers_per_min, s["entry.min_viewers_per_min"], "viewer growth"),
        _below(coin.liquidity, s["entry.min_liquidity_usd"], "liquidity"),
        _below(coin.market_cap, s["entry.min_market_cap_usd"], "market cap"),
        _below(coin.volume_5m, s["entry.min_volume_5m_usd"], "5m volume"),
        _below(coin.buy_share_pct, s["entry.min_buy_share_pct"], "buy share", "%"),
        _below(coin.age_minutes, s["entry.min_age_minutes"], "age in minutes"),
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


def quote_lags(coin: Coin, live: float) -> bool:
    """True when a live price under the Radar's looks like DexScreener still showing the price from before the coin's last
    minute of climbing, rather than a dump: it sits between where the coin was a minute ago and where it is now."""
    if coin.price is None or not coin.gain_1m or coin.gain_1m <= 0 or live >= coin.price:
        return False
    minute_ago = coin.price / (1 + coin.gain_1m / 100)
    return live >= minute_ago * 0.93 and (coin.gain_30s is None or coin.gain_30s > -3)


def verify_block(coin: Coin, quote: Quote | None, settings: Settings, now: int, sol_usd: float) -> str | None:
    """The last look before a buy: live price, volume, buys and liquidity, fresh holder figures, and no dump.
    `quote` is the live DexScreener reading in dollars; `now` is milliseconds on the tracker's clock."""
    s = settings
    if not s["verify.enabled"]:
        return None
    if quote is None or coin.price is None or not sol_usd:
        return "could not confirm the live price"
    live = quote.price / sol_usd
    if quote_lags(coin, live):
        live = coin.price
    fell = (1 - live / coin.price) * 100
    if fell > s["verify.max_live_drop_pct"]:
        return f"price fell {fell:.0f}% since the Radar reading"
    drop_from_high = s["verify.max_drop_from_high_pct"]
    if drop_from_high > 0:
        high = max(price for price in (coin.recent_high, coin.price, live) if price)
        below = (1 - live / high) * 100
        if below > drop_from_high:
            return f"already dumped {below:.0f}% from its 10-minute high"
    drop_30s = s["verify.max_drop_30s_pct"]
    if drop_30s > 0 and coin.gain_30s is not None and coin.gain_30s <= -drop_30s:
        return f"dropped {-coin.gain_30s:.0f}% in the last 30 seconds"
    holder_age = s["verify.max_holder_age_seconds"]
    if holder_age > 0:
        if coin.holders_seen_at is None:
            return "no holder figures yet"
        age = (now - coin.holders_seen_at) / 1000
        if age > holder_age:
            return f"holder figures are {age:.0f}s old"
    if s["verify.skip_holders_falling"] and coin.holders_per_min is not None and coin.holders_per_min < 0:
        return f"holders are falling ({coin.holders_per_min:g} in the last minute)"
    if s["verify.live_market"]:
        if s["entry.min_volume_5m_usd"] > 0:
            if quote.volume_5m is None:
                return "no live 5m volume"
            if quote.volume_5m < s["entry.min_volume_5m_usd"]:
                return f"live 5m volume {_money(quote.volume_5m)} under {_money(s['entry.min_volume_5m_usd'])}"
        trades = (quote.buys_5m or 0) + (quote.sells_5m or 0)
        if s["entry.min_buy_share_pct"] > 0 and quote.buys_5m is not None and trades:
            share = quote.buys_5m / trades * 100
            if share < s["entry.min_buy_share_pct"]:
                return f"live buy share {share:.0f}% under {s['entry.min_buy_share_pct']:.0f}%"
        if s["entry.min_liquidity_usd"] > 0 and quote.liquidity is not None and quote.liquidity < s["entry.min_liquidity_usd"]:
            return f"live liquidity {_money(quote.liquidity)} under {_money(s['entry.min_liquidity_usd'])}"
    return None


def conviction(coin: Coin, settings: Settings) -> float:
    """0 at the mode's buy level, 1 at a perfect score or quality; a learned chance can lift it."""
    mode = settings["mode.pick_by"]
    floor = settings[f"mode.{mode}_buy_at"]
    value = mode_value(coin, mode) or 0.0
    from_score = 1.0 if floor >= 100 else min(1.0, max(0.0, (value - floor) / (100 - floor)))
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


def riding(position: Position, settings: Settings) -> bool:
    """True once the position passed its target and is being held on momentum."""
    return bool(position.target_done and settings["exit.ride_momentum"] and position.qty_open >= position.qty * 0.999)


def exit_signal(position: Position, coin: Coin | None, settings: Settings, now: int, left_radar: bool = False, flow: Momentum | None = None) -> Exit | None:
    """The reason and the share of the open position to sell when a sell rule fires, else None.
    `flow` is the chart's momentum, read once the position reaches its target."""
    s = exit_dials(settings, position)
    gain_pct = position.gain() * 100
    peak_gain_pct = (position.peak_price / position.entry_spot - 1) * 100
    held = position.held_minutes(now)
    ride = riding(position, s)
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
    if ride:
        floor = position.entry_spot * (1 + s["exit.take_profit_pct"] / 100)
        trail = position.peak_price * (1 - s["exit.ride_trail_pct"] / 100)
        if position.last_price <= floor:
            return Exit(f"Momentum ride over: back to the +{s['exit.take_profit_pct']:g}% target", 1.0, True)
        if position.last_price <= trail:
            return Exit(f"Momentum ride over: {(1 - position.last_price / position.peak_price) * 100:.0f}% off its high of {peak_gain_pct:+.0f}%", 1.0, True)
        if flow is not None and not flow.strong:
            return Exit(f"Momentum faded at {gain_pct:+.0f}% ({flow.why})", 1.0)
    if s["exit.take_profit_pct"] > 0 and not position.target_done and gain_pct >= s["exit.take_profit_pct"]:
        if s["exit.ride_momentum"] and flow is not None and flow.strong and s["exit.take_profit_sell_pct"] >= 100:
            return Exit(f"Reached the +{s['exit.take_profit_pct']:g}% target with strong momentum ({flow.why}), staying in", 0.0, ride=True)
        return Exit("Profit target", s["exit.take_profit_sell_pct"] / 100)
    if s["exit.trailing_stop_pct"] > 0 and peak_gain_pct >= s["exit.trailing_start_pct"]:
        if position.last_price <= position.peak_price * (1 - s["exit.trailing_stop_pct"] / 100):
            return Exit("Trailing stop", 1.0, True)
    if coin:
        mode_exit = _mode_exit(position, coin, s)
        if mode_exit is not None:
            return mode_exit
        if s["exit.viewer_drop_pct"] > 0 and coin.viewers is not None and position.peak_viewers:
            if coin.viewers <= position.peak_viewers * (1 - s["exit.viewer_drop_pct"] / 100):
                return Exit("Viewers fell", 1.0)
        if s["exit.sell_when_overdue"] and coin.phase == "overdue":
            return Exit("Past the usual crash time", 1.0)
    if ride:
        return None
    if s["exit.stall_minutes"] > 0 and held >= s["exit.stall_minutes"] and gain_pct < s["exit.stall_min_gain_pct"]:
        return Exit("Stalled", 1.0)
    if s["exit.max_hold_minutes"] > 0 and held >= s["exit.max_hold_minutes"]:
        return Exit("Held too long", 1.0)
    return None


def _mode_exit(position: Position, coin: Coin, settings: Settings) -> Exit | None:
    """The sell rules of the mode the position was bought in."""
    mode = mode_of(settings, position)
    label = MODE_LABELS[mode][:1].upper() + MODE_LABELS[mode][1:]
    value = mode_value(coin, mode)
    if value is not None:
        floor = settings[f"mode.{mode}_sell_below"]
        if floor > 0 and value < floor:
            return Exit(f"{label} fell to {value:.0f}, under {floor:.0f}", 1.0)
        drop = settings[f"mode.{mode}_drop_points"]
        if drop > 0 and position.peak_mode is not None and value <= position.peak_mode - drop:
            return Exit(f"{label} fell {position.peak_mode - value:.0f} points from its best of {position.peak_mode:.0f}", 1.0)
    if mode == "quality" and settings["mode.quality_sell_on_new_fail"]:
        before = position.entry.get("failedLabels")
        if isinstance(before, list):
            new = [check for check in coin.failed_labels if check not in before]
        else:
            new = list(coin.failed_labels) if coin.failed_checks > int(position.entry.get("failedChecks") or 0) else []
        if new:
            return Exit(f"Quality check failed: {new[0]}", 1.0)
    return None
