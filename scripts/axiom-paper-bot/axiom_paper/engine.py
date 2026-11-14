"""The loop: pull the Radar, mark open positions, sell what a rule says to sell, buy what passes."""

from __future__ import annotations

import dataclasses
import threading
import time
import tomllib
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from . import VERSION, broker, strategy
from . import settings as dials
from .ledger import Ledger
from .models import Coin, Position, number
from .prices import Quote, fetch_prices
from .site import SiteError

COMMAND_WINDOW_MS = 10 * 60_000
REPORT_SECONDS = 15.0
EQUITY_SECONDS = 60.0
PriceSource = Callable[[dict[str, str | None]], dict[str, Quote]]


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _signed(value: float) -> str:
    return f"{'+' if value >= 0 else '-'}${abs(value):,.2f}"


Sent = tuple[int | None, int | None]


class _Call:
    """One site call on its own thread, so a slow site never holds up price checks and sells."""

    def __init__(self, function: Callable[[dict[str, Any]], dict[str, Any]], body: dict[str, Any], sent: Sent):
        self.sent = sent
        self.result: dict[str, Any] = {}
        self.error: Exception | None = None
        self.done = threading.Event()
        threading.Thread(target=self._run, args=(function, body), daemon=True, name="axiom-site-sync").start()

    def _run(self, function: Callable[[dict[str, Any]], dict[str, Any]], body: dict[str, Any]) -> None:
        try:
            self.result = function(body)
        except Exception as error:
            self.error = error
        self.done.set()


class Engine:
    def __init__(self, ledger: Ledger, site: Any, settings_path: Path | None, *, price_source: PriceSource = fetch_prices, clock: Callable[[], float] = time.time, background: bool = False):
        self.ledger = ledger
        self.site = site
        self.settings_path = settings_path
        self.price_source = price_source
        self.clock = clock
        self.background = background
        self._call: _Call | None = None
        self.values = dials.defaults()
        self.settings_stamp = int(ledger.get("settings_stamp", 0))
        self.site_offset = int(ledger.get("site_offset", 0))
        self.settings_error: str | None = None
        self.push_settings = False
        self.file_mtime: int | None = None
        self.coins: dict[str, Coin] = {}
        self.payload_at = 0
        self.generated_at = 0.0
        self.feed_live = False
        self.feed_age_base: float | None = None
        self.feed_age_from = 0.0
        self.streaks: dict[str, int] = {}
        self.candidates: list[dict[str, Any]] = []
        self.buy_block: str | None = "Waiting for the Radar"
        self.error: str | None = None
        self.started_at = self.now()
        self.next_sync = 0.0
        self.next_prices = 0.0
        self.next_report = 0.0
        self.next_equity = 0.0
        self.report_due = True
        self.report_seq = 0
        self._load_settings()
        if not ledger.started():
            ledger.reset(self.values["account.starting_cash"], self.now())
        self.positions = ledger.open_positions()
        for position in self.positions:
            position.last_price_at = max(position.last_price_at, self.now())

    def now(self) -> int:
        return int(self.clock() * 1000)

    def site_time(self, local_ms: int | None = None) -> int:
        """A time on this PC expressed on the site's clock, so dial changes from both sides compare fairly."""
        return (self.now() if local_ms is None else local_ms) + self.site_offset

    def _load_settings(self) -> None:
        path = self.settings_path
        if path is None:
            return
        if not path.exists():
            dials.save_file(path, self.values)
            self.settings_stamp = 0
        else:
            try:
                self.values = dials.load_file(path)
            except (OSError, tomllib.TOMLDecodeError) as error:
                self.settings_error = f"The settings file has a mistake ({error}). Using the defaults until it is fixed."
            if self.ledger.get("settings_mtime") != path.stat().st_mtime_ns:
                self.settings_stamp = self.site_time(int(path.stat().st_mtime * 1000))
                self.push_settings = self.settings_error is None
        self._remember_file()

    def _remember_file(self) -> None:
        if self.settings_path is None:
            return
        self.file_mtime = self.settings_path.stat().st_mtime_ns
        self.ledger.set("settings_mtime", self.file_mtime)
        self.ledger.set("settings_stamp", self.settings_stamp)

    def _write_settings_file(self) -> None:
        if self.settings_path is None:
            return
        dials.save_file(self.settings_path, self.values)
        self._remember_file()

    def _apply_settings(self, values: dials.Values, source: str) -> None:
        changes = dials.describe_changes(self.values, values)
        self.values = values
        if changes:
            shown = "; ".join(changes[:3]) + (f"; and {len(changes) - 3} more" if len(changes) > 3 else "")
            self.ledger.event(self.now(), "settings", f"Settings changed in {source}: {shown}")
            self._report_soon()

    def change_setting(self, key: str, value: Any, source: str = "the dashboard") -> None:
        values = dict(self.values)
        values[key] = dials.clean(key, value)
        self._apply_settings(values, source)
        self.settings_stamp = self.site_time()
        self.push_settings = True
        self._write_settings_file()

    def check_settings_file(self) -> None:
        path = self.settings_path
        if path is None:
            return
        try:
            mtime = path.stat().st_mtime_ns
        except OSError:
            self._write_settings_file()
            return
        if mtime == self.file_mtime:
            return
        self.file_mtime = mtime
        self.ledger.set("settings_mtime", mtime)
        try:
            loaded = dials.load_file(path)
        except (OSError, tomllib.TOMLDecodeError) as error:
            self.settings_error = f"The settings file has a mistake ({error}). Using the last good settings."
            return
        self.settings_error = None
        if loaded != self.values:
            self._apply_settings(loaded, "the settings file")
            self.settings_stamp = self.site_time()
            self.push_settings = True
            self.ledger.set("settings_stamp", self.settings_stamp)

    def feed_age(self) -> float | None:
        if self.feed_age_base is None:
            return None
        return self.feed_age_base + max(0.0, self.clock() - self.feed_age_from)

    def _report_soon(self) -> None:
        self.report_due = True
        self.report_seq += 1

    def _sync_request(self) -> tuple[dict[str, Any], Sent]:
        body: dict[str, Any] = {"have": self.payload_at, "fast": bool(self.values["bot.fast_feed"]), "settingsStamp": self.settings_stamp}
        pushed = self.settings_stamp if self.push_settings else None
        if pushed is not None:
            body["settings"] = {"values": dict(self.values), "updatedAt": pushed}
        reported = self.report_seq if self.report_due or self.clock() >= self.next_report else None
        if reported is not None:
            body["report"] = self.report()
        return body, (pushed, reported)

    def sync(self) -> bool:
        """One round trip with the site. True when it brought a new Radar reading."""
        body, sent = self._sync_request()
        try:
            reply = self.site.sync(body)
        except SiteError as error:
            self.error = str(error)
            return False
        return self._sync_reply(reply, sent)

    def _sync_in_background(self) -> bool:
        fresh = False
        call = self._call
        if call is not None and call.done.is_set():
            self._call = None
            if isinstance(call.error, SiteError):
                self.error = str(call.error)
            elif call.error is not None:
                self.error = f"The sync with the site failed ({call.error})."
            else:
                fresh = self._sync_reply(call.result, call.sent)
            self.next_sync = self.clock() + self.values["bot.poll_seconds"]
        if self._call is None and self.clock() >= self.next_sync:
            body, sent = self._sync_request()
            self._call = _Call(self.site.sync, body, sent)
        return fresh

    def _sync_reply(self, reply: dict[str, Any], sent: Sent) -> bool:
        pushed, reported = sent
        self.error = None
        if pushed is not None and pushed == self.settings_stamp:
            self.push_settings = False
        if reported is not None:
            self.next_report = self.clock() + REPORT_SECONDS
            if reported == self.report_seq:
                self.report_due = False
        server_now = number(reply.get("now"))
        payload_at = number(reply.get("payloadAt"))
        if server_now is not None and abs(server_now - self.now() - self.site_offset) > 1000:
            self.site_offset = int(server_now - self.now())
            self.ledger.set("site_offset", self.site_offset)
        if server_now is not None and payload_at is not None:
            self.feed_age_base = max(0.0, (server_now - payload_at) / 1000)
            self.feed_age_from = self.clock()
        fresh = False
        payload = reply.get("payload")
        if isinstance(payload, dict) and payload_at is not None and int(payload_at) != self.payload_at:
            self.payload_at = int(payload_at)
            self._take_payload(payload)
            fresh = True
        saved = reply.get("settings")
        if isinstance(saved, dict) and (number(saved.get("updatedAt")) or 0) > self.settings_stamp:
            self.settings_stamp = int(saved["updatedAt"])
            values = dials.normalize(saved.get("values"))
            if values != self.values:
                self._apply_settings(values, "the Radar page")
            self._write_settings_file()
        self._commands(reply.get("command"), server_now)
        return fresh

    def _take_payload(self, payload: dict[str, Any]) -> None:
        tokens = payload.get("tokens") if isinstance(payload.get("tokens"), list) else []
        coins = (Coin.from_token(token) for token in tokens if isinstance(token, dict))
        self.coins = {coin.mint: coin for coin in coins if coin.mint}
        self.generated_at = number(payload.get("generatedAt")) or 0.0
        self.feed_live = payload.get("status") == "live"
        read_at = self.now() - int((self.feed_age() or 0.0) * 1000)
        for position in self.positions:
            coin = self.coins.get(position.mint)
            if coin is None:
                continue
            if coin.viewers is not None:
                position.peak_viewers = max(position.peak_viewers or 0.0, coin.viewers)
            if coin.price is not None:
                self._mark(position, coin.price, coin.liquidity, read_at)
            else:
                self.ledger.save(position)

    def _mark(self, position: Position, price: float, liquidity: float | None, read_at: int) -> None:
        """Take a price reading unless the position already has a newer one."""
        if read_at < position.last_price_at:
            self.ledger.save(position)
            return
        position.last_price = price
        position.last_price_at = read_at
        position.peak_price = max(position.peak_price, price)
        if liquidity is not None:
            position.last_liquidity = liquidity
        self.ledger.save(position)

    def update_live_prices(self) -> None:
        quotes = self.price_source({position.mint: position.pair for position in self.positions})
        now = self.now()
        for position in self.positions:
            quote = quotes.get(position.mint)
            if quote is not None:
                self._mark(position, quote.price, quote.liquidity, now)

    def account(self) -> dict[str, float]:
        cash = self.ledger.cash
        positions_value = sum(broker.open_value(position, self.values) for position in self.positions)
        equity = cash + positions_value
        starting = float(self.ledger.get("starting_cash", equity))
        peak = float(self.ledger.get("peak_equity", equity))
        if equity > peak:
            peak = equity
            self.ledger.set("peak_equity", peak)
        day = datetime.fromtimestamp(self.clock()).strftime("%Y-%m-%d")
        if self.ledger.get("day") != day:
            self.ledger.set("day", day)
            self.ledger.set("day_start_equity", equity)
        day_start = float(self.ledger.get("day_start_equity", equity))
        return {
            "startingCash": starting,
            "cash": cash,
            "positionsValue": positions_value,
            "equity": equity,
            "exposure": sum(position.qty_open * position.last_price for position in self.positions),
            "exposureLimit": strategy.exposure_limit_usd(equity, self.values),
            "unrealizedPnl": sum(position.pnl_usd(broker.open_value(position, self.values)) for position in self.positions),
            "totalPnl": equity - starting,
            "totalPnlPct": (equity / starting - 1) * 100 if starting else 0.0,
            "peakEquity": peak,
            "drawdownPct": (1 - equity / peak) * 100 if peak else 0.0,
            "dayPnl": equity - day_start,
            "dayPnlPct": (equity / day_start - 1) * 100 if day_start else 0.0,
        }

    def buy_guard(self, account: dict[str, float]) -> str | None:
        """Why the bot is not buying anything right now, or None when it may."""
        s = self.values
        now = self.now()
        if not s["bot.enabled"]:
            return "Buying is paused"
        age = self.feed_age()
        if age is None:
            return "Waiting for the Radar"
        if not self.feed_live:
            return "The tracker is not live"
        if age > s["entry.max_data_age_seconds"]:
            return f"The Radar data is {age:.0f}s old"
        pause_until = self.ledger.get("pause_until", 0)
        if now < pause_until:
            return f"Taking a break after a run of losses ({(pause_until - now) / 60_000:.0f} min left)"
        if s["risk.daily_loss_limit_pct"] > 0 and -account["dayPnlPct"] >= s["risk.daily_loss_limit_pct"]:
            return "Daily loss limit reached"
        if s["risk.max_drawdown_pct"] > 0 and account["drawdownPct"] >= s["risk.max_drawdown_pct"]:
            return "Drawdown stop reached"
        if len(self.positions) >= s["risk.max_open_positions"]:
            return "Holding the most coins allowed"
        if s["risk.max_buys_per_hour"] > 0 and self.ledger.buys_since(now - 3_600_000) >= s["risk.max_buys_per_hour"]:
            return "Hourly buy limit reached"
        return None

    def _coin_limits(self, coin: Coin, now: int) -> str | None:
        s = self.values
        last_closed = self.ledger.last_closed_at(coin.mint)
        if last_closed and s["entry.cooldown_minutes"] > 0:
            left = s["entry.cooldown_minutes"] - (now - last_closed) / 60_000
            if left > 0:
                return f"sold recently, {left:.0f} min of cooldown left"
        if self.ledger.buys_since(now - 86_400_000, coin.mint) >= s["entry.max_buys_per_coin"]:
            return "bought the most times allowed in 24 hours"
        if s["entry.rebuy_above_high"] and last_closed:
            old_high = self.ledger.last_exit_high(coin.mint)
            if old_high and coin.price is not None and coin.price <= old_high:
                return "still below its high from when the bot sold it"
        return None

    def consider_entries(self) -> None:
        s = self.values
        now = self.now()
        guard = self.buy_guard(self.account())
        held = {position.mint for position in self.positions}
        feed_age = self.feed_age() or 0.0
        considered: list[tuple[Coin, str]] = []
        for coin in sorted(self.coins.values(), key=lambda item: item.score, reverse=True):
            if coin.mint in held:
                continue
            lag = max(0.0, self.generated_at - coin.snapshot_at) / 1000 if coin.snapshot_at and self.generated_at else 0.0
            reason = strategy.entry_block(coin, s, feed_age + lag) or self._coin_limits(coin, now)
            if reason is not None:
                self.streaks.pop(coin.mint, None)
                considered.append((coin, reason))
                continue
            streak = self.streaks.get(coin.mint, 0) + 1
            self.streaks[coin.mint] = streak
            if streak < s["entry.confirm_pulls"]:
                considered.append((coin, f"passes, confirming ({streak} of {s['entry.confirm_pulls']} pulls)"))
                continue
            if guard is not None:
                considered.append((coin, f"passes, but: {guard}"))
                continue
            refused = self._buy(coin, now)
            if refused is not None:
                considered.append((coin, refused))
                continue
            held.add(coin.mint)
            self.streaks.pop(coin.mint, None)
            guard = self.buy_guard(self.account())
        self.streaks = {mint: count for mint, count in self.streaks.items() if mint in self.coins}
        self.buy_block = guard
        self.candidates = [{"mint": coin.mint, "symbol": coin.symbol, "score": round(coin.score), "reason": reason} for coin, reason in considered[:8]]

    def _buy(self, coin: Coin, now: int) -> str | None:
        """Buy the coin. Returns why not when the bet is refused."""
        s = self.values
        spot, liquidity = coin.price, coin.liquidity
        if spot is None:
            return "no price"
        if s["bot.live_prices"]:
            quote = self.price_source({coin.mint: coin.pair}).get(coin.mint)
            if quote is not None:
                if quote.price < spot * 0.85:
                    return f"price fell {(1 - quote.price / spot) * 100:.0f}% since the Radar reading"
                spot = quote.price
                liquidity = quote.liquidity if quote.liquidity is not None else liquidity
        account = self.account()
        size, limit = strategy.position_size(dataclasses.replace(coin, liquidity=liquidity), s, account["equity"], account["cash"], account["exposure"])
        if size <= 0:
            return limit
        fill = broker.buy(spot, size, liquidity, s)
        if fill is None:
            return "fees would eat the whole bet"
        position = Position(
            id=0, mint=coin.mint, symbol=coin.symbol, pair=coin.pair, opened_at=now, entry_spot=spot, entry_price=fill.price,
            qty=fill.qty, qty_open=fill.qty, cost_usd=fill.net_usd, proceeds_usd=0.0, fees_usd=fill.fee_usd,
            entry_liquidity=liquidity, last_liquidity=liquidity, peak_price=spot, peak_viewers=coin.viewers,
            last_price=spot, last_price_at=now, target_done=False, score=coin.score,
            entry={**coin.entry_facts(), "sizeLimit": limit, "impactPct": round(fill.impact_pct, 3)},
        )
        self.ledger.record_buy(position, fill, now)
        self.positions.append(position)
        self.ledger.event(now, "buy", f"Bought {coin.symbol}: {_money(size)} at score {coin.score:.0f} (size set by {limit}, price impact {fill.impact_pct:.1f}%)")
        self._after_trade()
        return None

    def left_radar(self, position: Position) -> bool:
        """True when the latest fresh Radar reading no longer lists a coin the bot holds."""
        age = self.feed_age()
        return bool(self.coins) and position.mint not in self.coins and age is not None and age <= self.values["entry.max_data_age_seconds"]

    def manage_positions(self) -> None:
        now = self.now()
        for position in list(self.positions):
            signal = strategy.exit_signal(position, self.coins.get(position.mint), self.values, now, self.left_radar(position))
            if signal is not None:
                self._sell(position, signal.share, signal.reason, now, signal.urgent)

    def _sell(self, position: Position, share: float, reason: str, now: int, urgent: bool = False) -> None:
        whole = share >= 0.999
        qty = position.qty_open if whole else position.qty_open * share
        fill = broker.sell(position.last_price, qty, position.last_liquidity, bool(position.entry_liquidity), self.values, urgent)
        if reason == "Profit target":
            position.target_done = True
        if whole:
            coin = self.coins.get(position.mint)
            position.exit_high = max(position.peak_price, coin.high_price if coin and coin.high_price else 0.0)
        gain = position.gain() * 100
        self.ledger.record_sell(position, fill, position.last_price, reason, now)
        if position.status == "closed":
            self.positions.remove(position)
            profit = position.pnl_usd()
            self._count_streak(profit, now)
            self.ledger.event(now, "sell", f"Sold {position.symbol}: {_signed(profit)} ({round(position.pnl_pct(), 2):+.1f}%) after {position.held_minutes(now):.0f} min. {reason}.")
        else:
            self.ledger.event(now, "sell", f"Sold {share * 100:.0f}% of {position.symbol} at {gain:+.0f}% for {_money(fill.net_usd)}. {reason}.")
        self._after_trade()

    def _count_streak(self, profit: float, now: int) -> None:
        s = self.values
        streak = 0 if profit > 0 else int(self.ledger.get("loss_streak", 0)) + 1
        if s["risk.loss_streak"] > 0 and streak >= s["risk.loss_streak"]:
            self.ledger.set("pause_until", now + int(s["risk.loss_streak_pause_minutes"] * 60_000))
            self.ledger.event(now, "risk", f"{streak} losses in a row: no buys for {s['risk.loss_streak_pause_minutes']:.0f} minutes")
            streak = 0
        self.ledger.set("loss_streak", streak)

    def _after_trade(self) -> None:
        account = self.account()
        self.ledger.equity_point(self.now(), account["equity"], account["cash"])
        self._report_soon()

    def flatten(self, reason: str) -> int:
        now = self.now()
        positions = list(self.positions)
        for position in positions:
            self._sell(position, 1.0, reason, now)
        return len(positions)

    def reset_account(self) -> None:
        self.ledger.reset(self.values["account.starting_cash"], self.now())
        self.positions = []
        self.streaks = {}
        self._report_soon()

    def _commands(self, command: Any, server_now: float | None) -> None:
        if not isinstance(command, dict) or server_now is None:
            return
        for name in ("flatten", "reset"):
            stamp = number(command.get(name)) or 0
            if stamp <= self.ledger.get(f"command_{name}", 0):
                continue
            self.ledger.set(f"command_{name}", stamp)
            if server_now - stamp > COMMAND_WINDOW_MS:
                continue
            if name == "flatten":
                self.flatten("Closed from the Radar page")
            else:
                self.reset_account()

    def stop_price(self, position: Position) -> float | None:
        """The price at which a stop rule would sell this position now."""
        s = self.values
        stops = []
        if s["exit.stop_loss_pct"] > 0:
            stops.append(position.entry_spot * (1 - s["exit.stop_loss_pct"] / 100))
        if position.target_done and s["exit.breakeven_after_target"]:
            stops.append(position.entry_spot)
        if s["exit.trailing_stop_pct"] > 0 and position.peak_price >= position.entry_spot * (1 + s["exit.trailing_start_pct"] / 100):
            stops.append(position.peak_price * (1 - s["exit.trailing_stop_pct"] / 100))
        if s["exit.on_tighten"] == "tighten_stop" and strategy.tightened(self.coins.get(position.mint), s, self.left_radar(position)):
            stops.append(position.peak_price * (1 - s["exit.tighten_trailing_pct"] / 100))
        return max(stops) if stops else None

    def position_rows(self) -> list[dict[str, Any]]:
        rows = []
        for position in self.positions:
            value = broker.open_value(position, self.values)
            coin = self.coins.get(position.mint)
            rows.append({
                "advice": "left" if self.left_radar(position) else coin.advice_exit if coin else None,
                "id": position.id, "mint": position.mint, "symbol": position.symbol, "pairAddress": position.pair,
                "openedAt": position.opened_at, "entryPrice": position.entry_spot, "price": position.last_price,
                "costUsd": round(position.cost_usd, 2), "valueUsd": round(value, 2),
                "pnlUsd": round(position.pnl_usd(value), 2), "pnlPct": round(position.pnl_pct(value), 2),
                "gainPct": round(position.gain() * 100, 2), "peakGainPct": round((position.peak_price / position.entry_spot - 1) * 100, 2),
                "openPct": round(position.qty_open / position.qty * 100) if position.qty else 0,
                "stopPrice": self.stop_price(position), "targetDone": position.target_done, "score": round(position.score),
            })
        return rows

    def trade_rows(self, limit: int = 60) -> list[dict[str, Any]]:
        return [{
            "id": position.id, "mint": position.mint, "symbol": position.symbol, "pairAddress": position.pair,
            "openedAt": position.opened_at, "closedAt": position.closed_at,
            "costUsd": round(position.cost_usd, 2), "proceedsUsd": round(position.proceeds_usd, 2),
            "pnlUsd": round(position.pnl_usd(), 2), "pnlPct": round(position.pnl_pct(), 2),
            "reason": position.exit_reason, "score": round(position.score), "holdMinutes": round(position.held_minutes(position.closed_at or 0), 1),
        } for position in self.ledger.closed_positions(limit)]

    def status(self) -> tuple[str, str | None]:
        if not self.values["bot.enabled"]:
            return "paused", "Buying is paused"
        return ("holding", self.buy_block) if self.buy_block else ("running", None)

    def report(self) -> dict[str, Any]:
        account = self.account()
        state, note = self.status()
        age = self.feed_age()
        return {
            "version": VERSION,
            "at": self.now(),
            "startedAt": self.started_at,
            "status": state,
            "note": self.settings_error or note,
            "feed": {"ageSeconds": None if age is None else round(age), "live": self.feed_live, "coins": len(self.coins)},
            "account": {key: round(value, 2) for key, value in account.items()},
            "stats": self.ledger.stats(),
            "positions": self.position_rows(),
            "trades": self.trade_rows(),
            "equity": self.ledger.equity_curve(),
            "events": self.ledger.events(30),
            "candidates": self.candidates,
            "strength": self.values["risk.strength"],
            "settingsStamp": self.settings_stamp,
        }

    def step(self) -> None:
        """One pass of the loop. Safe to call as often as once or twice a second."""
        moment = self.clock()
        self.check_settings_file()
        if self.background:
            fresh = self._sync_in_background()
        elif moment >= self.next_sync:
            fresh = self.sync()
            self.next_sync = self.clock() + self.values["bot.poll_seconds"]
        else:
            fresh = False
        if self.positions and self.values["bot.live_prices"] and self.clock() >= self.next_prices:
            self.update_live_prices()
            self.next_prices = self.clock() + self.values["bot.price_seconds"]
        self.manage_positions()
        if fresh:
            self.consider_entries()
        else:
            self.buy_block = self.buy_guard(self.account())
        if self.clock() >= self.next_equity:
            account = self.account()
            self.ledger.equity_point(self.now(), account["equity"], account["cash"])
            self.next_equity = self.clock() + EQUITY_SECONDS
