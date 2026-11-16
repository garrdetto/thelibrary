"""The loop: pull the Radar, mark open positions, sell what a rule says to sell, buy what passes."""

from __future__ import annotations

import dataclasses
import json
import threading
import time
import tomllib
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from . import VERSION, broker, fees, rules, strategy
from . import settings as dials
from .learner import Learner
from .learner import features as learner_bands
from .ledger import Ledger
from .pricegate import PriceGate
from .review import Reviewer
from .review import entry_facts as buy_facts
from .models import Coin, Position, number
from .money import both, signed, small_sol, usd
from .prices import SOL_MINT, Quote, fetch_prices
from .site import SiteError

COMMAND_WINDOW_MS = 10 * 60_000
TREND_WINDOW_MS = 60_000
VOLUME_WINDOW_MS = 60_000
LIQUIDITY_WINDOW_MS = 120_000
READINGS_KEPT_MS = 5 * 60_000
REPORT_SECONDS = 15.0
EQUITY_SECONDS = 60.0
MARKET_SECONDS = 30.0
PriceSource = Callable[[dict[str, str | None]], dict[str, Quote]]


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


class _Worker:
    """Runs one slow lookup off the main loop and hands back its latest answer."""

    def __init__(self, function: Callable[[], Any]):
        self.function = function
        self.thread: threading.Thread | None = None
        self.result: Any = None
        self.ready = False

    def start(self) -> None:
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self._run, daemon=True, name="axiom-market")
            self.thread.start()

    def _run(self) -> None:
        try:
            self.result = self.function()
        except Exception:
            self.result = None
        self.ready = True

    def take(self) -> Any:
        if not self.ready:
            return None
        self.ready = False
        return self.result


class Engine:
    def __init__(self, ledger: Ledger, site: Any, settings_path: Path | None, *, price_source: PriceSource = fetch_prices, fee_source: Callable[[], fees.FeeLevels | None] = fees.fetch_levels, clock: Callable[[], float] = time.time, background: bool = False, observer: bool = False, rule_overrides: dict[str, Any] | None = None):
        self.ledger = ledger
        self.rule_overrides = dict(rule_overrides or {})
        self._rules: dials.Values = {}
        self._rules_for: dials.Values | None = None
        self.gate = PriceGate()
        self.price_trail: dict[int, list[tuple[int, float]]] = {}
        self.weak_reads: dict[int, int] = {}
        self.site = site
        self.settings_path = settings_path
        self.inbox_path = settings_path.with_suffix(".inbox.json") if settings_path else None
        self.price_source = price_source
        self.fee_source = fee_source
        self.clock = clock
        self.sol_usd: float | None = number(ledger.get("sol_usd"))
        saved_levels = ledger.get("fee_levels")
        self.fee_levels: fees.FeeLevels | None = fees.FeeLevels(saved_levels["priority"], saved_levels["bribe"]) if isinstance(saved_levels, dict) and "priority" in saved_levels and "bribe" in saved_levels else None
        self.next_market = 0.0
        self._market_worker = _Worker(self._market)
        self.background = background
        self.observer = observer
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
        self.readings: dict[str, list[tuple[int, dict[str, float | None]]]] = {}
        self.market_readings: dict[str, list[tuple[int, float | None, float | None]]] = {}
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
            ledger.reset(self.rules["account.starting_sol"], self.now())
        self.chart_notes: dict[str, str] = {}
        self.learner = Learner(ledger.db, cost=self._round_trip_cost())
        self.reviewer = Reviewer(ledger.db)
        self.reviewer.backfill(ledger.closed_positions(500))
        self.positions = ledger.open_positions()
        for position in self.positions:
            position.last_price_at = max(position.last_price_at, self.now())

    def now(self) -> int:
        return int(self.clock() * 1000)

    @property
    def rules(self) -> dials.Values:
        """The full rule set for the current dials (see rules.py), plus any fixed overrides."""
        if self._rules_for is not self.values:
            self._rules = {**rules.expand(self.values), **self.rule_overrides}
            self._rules_for = self.values
        return self._rules

    def _round_trip_cost(self) -> float:
        """What a buy and a sale at the same price lose to fees and slippage, as a fraction."""
        return 2 * (self.rules["costs.fee_pct"] + self.rules["costs.extra_slippage_pct"]) / 100

    def buy_level(self) -> float:
        """The score a coin needs, with the learner's adjustment after a run of wins or losses."""
        base = self.rules[f"mode.{self.rules['mode.pick_by']}_buy_at"]
        if not self.values.get("learn.enabled"):
            return base
        return max(0.0, min(100.0, base + self.learner.adjust))

    def fee(self) -> fees.FeeQuote:
        """What one trade pays the network right now, in SOL."""
        return fees.quote(self.rules, self.fee_levels)

    def _market(self) -> tuple[float | None, fees.FeeLevels | None]:
        quote = self.price_source({SOL_MINT: None}).get(SOL_MINT)
        return (quote.price if quote else None), self.fee_source()

    def _take_market(self, sol_usd: float | None, levels: fees.FeeLevels | None) -> None:
        if sol_usd and sol_usd > 0:
            self.sol_usd = sol_usd
            self.ledger.set("sol_usd", sol_usd)
        if levels is not None:
            self.fee_levels = levels
            self.ledger.set("fee_levels", {"priority": levels.priority, "bribe": levels.bribe})

    def refresh_market(self) -> None:
        """Keep the SOL price and the network's fee levels current without holding up the loop."""
        if self.background:
            result = self._market_worker.take()
            if result is not None:
                self._take_market(*result)
            if self.clock() >= self.next_market:
                self._market_worker.start()
                self.next_market = self.clock() + MARKET_SECONDS
        elif self.clock() >= self.next_market:
            self._take_market(*self._market())
            self.next_market = self.clock() + MARKET_SECONDS

    def _convert_to_sol(self) -> None:
        """An account kept in dollars before the move to SOL is converted once, at the current SOL price."""
        rate = self.sol_usd
        if not rate:
            return
        self.ledger.convert_to_sol(rate)
        now = self.now()
        self.positions = self.ledger.open_positions()
        for position in self.positions:
            position.last_price_at = max(position.last_price_at, now)
        balance = float(self.ledger.get("starting_cash", 0.0))
        self.ledger.event(now, "account", f"Account moved from dollars to SOL at {usd(rate)} a SOL. Its starting balance is now {both(balance, rate)}.")
        if self.settings_path is not None:
            self.change_setting("account.starting_sol", round(balance, 2), "the move to SOL")
        self._report_soon()

    def site_time(self, local_ms: int | None = None) -> int:
        """A time on this PC expressed on the site's clock, so dial changes from both sides compare fairly."""
        return (self.now() if local_ms is None else local_ms) + self.site_offset

    def _load_settings(self) -> None:
        path = self.settings_path
        if path is None:
            return
        if self.observer:
            try:
                self.values = dials.load_file(path)
            except (OSError, tomllib.TOMLDecodeError):
                pass
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
            if self.settings_error is None and not dials.is_current(path):
                dials.save_file(path, self.values)
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

    def check_inbox(self) -> None:
        """Orders left for the running bot by the command line (flatten, reset), read once and removed."""
        path = self.inbox_path
        if path is None or not path.exists():
            return
        try:
            orders = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            orders = None
        try:
            path.unlink()
        except OSError:
            return
        if not isinstance(orders, dict):
            return
        now = self.now()

        def fresh(stamp: Any) -> bool:
            return isinstance(stamp, (int, float)) and not isinstance(stamp, bool) and 0 <= now - stamp <= COMMAND_WINDOW_MS

        if fresh(orders.get("flatten")):
            self.flatten("Closed from the command line")
        if fresh(orders.get("reset")):
            self.reset_account(number(orders.get("sol")))

    def feed_age(self) -> float | None:
        if self.feed_age_base is None:
            return None
        return self.feed_age_base + max(0.0, self.clock() - self.feed_age_from)

    def _report_soon(self) -> None:
        self.report_due = True
        self.report_seq += 1

    def _sync_request(self) -> tuple[dict[str, Any], Sent]:
        body: dict[str, Any] = {"have": self.payload_at, "fast": bool(self.rules["bot.fast_feed"]), "settingsStamp": self.settings_stamp}
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
            self.next_sync = self.clock() + self.rules["bot.poll_seconds"]
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
        if isinstance(payload, dict) and payload_at is not None and int(payload_at) != self.payload_at and self.sol_usd:
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
        coins = (Coin.from_token(token, self.sol_usd or 1.0) for token in tokens if isinstance(token, dict))
        self.coins = {coin.mint: coin for coin in coins if coin.mint}
        self.generated_at = number(payload.get("generatedAt")) or 0.0
        self.feed_live = payload.get("status") == "live"
        read_at = self.now() - int((self.feed_age() or 0.0) * 1000)
        self._remember_readings(read_at)
        for position in self.positions:
            coin = self.coins.get(position.mint)
            if coin is None:
                continue
            if coin.viewers is not None:
                position.peak_viewers = max(position.peak_viewers or 0.0, coin.viewers)
            value = strategy.mode_value(coin, strategy.mode_of(self.rules, position))
            if value is not None:
                position.peak_mode = value if position.peak_mode is None else max(position.peak_mode, value)
            if coin.price is not None:
                self._mark(position, coin.price, coin.liquidity_sol, read_at, "radar")
            else:
                self.ledger.save(position)
        if self.values["learn.enabled"]:
            mode = self.rules["mode.pick_by"]
            values = {mint: strategy.mode_value(coin, mode) for mint, coin in self.coins.items()}
            markets = {mint: self.market(mint) for mint in self.coins}
            self.learner.watch(self.coins, values, self.rules[f"mode.{mode}_buy_at"], self.rules["exit.take_profit_pct"], self.rules["exit.stop_loss_pct"], self.rules["exit.max_hold_minutes"], read_at, markets)

    def _remember_readings(self, read_at: int) -> None:
        """Each coin's score and quality on recent pulls, so the bot can tell which way they are moving."""
        kept: dict[str, list[tuple[int, dict[str, float | None]]]] = {}
        markets: dict[str, list[tuple[int, float | None, float | None]]] = {}
        for mint, coin in self.coins.items():
            history = [reading for reading in self.readings.get(mint, []) if read_at - reading[0] <= READINGS_KEPT_MS and reading[0] < read_at]
            history.append((read_at, {mode: strategy.mode_value(coin, mode) for mode in strategy.MODES}))
            kept[mint] = history
            market = [reading for reading in self.market_readings.get(mint, []) if read_at - reading[0] <= READINGS_KEPT_MS and reading[0] < read_at]
            market.append((read_at, coin.volume_5m, coin.liquidity))
            markets[mint] = market
        self.readings = kept
        self.market_readings = markets

    def market(self, mint: str) -> dict[str, float | None]:
        """The coin's 5-minute volume change over about the last minute and its liquidity change over about two minutes,
        in percent, from the bot's own pulls. None until the bot has watched the coin long enough."""
        history = self.market_readings.get(mint) or []

        def change(index: int, window: int) -> float | None:
            if len(history) < 2:
                return None
            latest_at, latest = history[-1][0], history[-1][index]
            earlier = next((reading for reading in reversed(history) if reading[0] <= latest_at - window), None)
            if earlier is None or latest is None or earlier[index] is None or (earlier[index] or 0) <= 0:
                return None
            return round((latest / (earlier[index] or 1) - 1) * 100, 1)

        return {"volume_trend": change(1, VOLUME_WINDOW_MS), "liquidity_trend": change(2, LIQUIDITY_WINDOW_MS)}

    def trend(self, coin: Coin, mode: str) -> float | None:
        """How far the mode's number moved over about the last minute of pulls, or None with fewer than two readings."""
        history = self.readings.get(coin.mint) or []
        if len(history) < 2:
            return None
        latest_at = history[-1][0]
        earlier = next((reading for reading in reversed(history) if reading[0] <= latest_at - TREND_WINDOW_MS), history[0])
        now_value, then_value = history[-1][1].get(mode), earlier[1].get(mode)
        if now_value is None or then_value is None:
            return None
        return now_value - then_value

    def _mark(self, position: Position, price: float, liquidity: float | None, read_at: int, source: str = "radar") -> None:
        """Take a price reading unless the position already has a newer one. A sudden jump or drop waits in the price gate
        until it lasts, so one stale quote cannot set off a stop."""
        if read_at < position.last_price_at:
            self.ledger.save(position)
            return
        taken = self.gate.offer(position.id, position.last_price, price, read_at, source)
        if taken is None:
            self.ledger.save(position)
            return
        position.last_price = taken
        position.last_price_at = read_at
        position.peak_price = max(position.peak_price, taken)
        if liquidity is not None:
            position.last_liquidity = liquidity
        trail = [point for point in self.price_trail.get(position.id, []) if read_at - point[0] <= 90_000]
        trail.append((read_at, taken))
        self.price_trail[position.id] = trail
        self.ledger.save(position)

    def live_change(self, position: Position, seconds: float = 30) -> float | None:
        """The position's price change over about the last `seconds`, from the prices the bot took, in percent."""
        trail = self.price_trail.get(position.id) or []
        if len(trail) < 2:
            return None
        latest_at, latest = trail[-1]
        earlier = next((point for point in reversed(trail) if point[0] <= latest_at - seconds * 1000), None)
        if earlier is None:
            if latest_at - trail[0][0] < seconds * 500:
                return None
            earlier = trail[0]
        return (latest / earlier[1] - 1) * 100

    def update_live_prices(self) -> None:
        quotes = self.price_source({**{position.mint: position.pair for position in self.positions}, SOL_MINT: None})
        if SOL_MINT in quotes:
            self._take_market(quotes[SOL_MINT].price, None)
        rate = self.sol_usd
        if not rate:
            return
        now = self.now()
        for position in self.positions:
            quote = quotes.get(position.mint)
            if quote is not None:
                self._mark(position, quote.price / rate, None if quote.liquidity is None else quote.liquidity / rate, now, "live")

    def account(self) -> dict[str, float]:
        cash = self.ledger.cash
        network = self.fee().total
        positions_value = sum(broker.open_value(position, self.rules, network) for position in self.positions)
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
            "exposureLimit": strategy.exposure_limit(equity, self.rules),
            "unrealizedPnl": sum(position.pnl(broker.open_value(position, self.rules, network)) for position in self.positions),
            "totalPnl": equity - starting,
            "totalPnlPct": (equity / starting - 1) * 100 if starting else 0.0,
            "peakEquity": peak,
            "drawdownPct": (1 - equity / peak) * 100 if peak else 0.0,
            "dayPnl": equity - day_start,
            "dayPnlPct": (equity / day_start - 1) * 100 if day_start else 0.0,
        }

    def buy_guard(self, account: dict[str, float]) -> str | None:
        """Why the bot is not buying anything right now, or None when it may."""
        s = self.rules
        now = self.now()
        if not s["bot.enabled"]:
            return "Buying is paused"
        if not self.sol_usd:
            return "Waiting for the SOL price"
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
        s = self.rules
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
        mode = self.rules["mode.pick_by"]
        s = {**self.rules, f"mode.{mode}_buy_at": self.buy_level()}
        now = self.now()
        guard = self.buy_guard(self.account())
        held = {position.mint for position in self.positions}
        feed_age = self.feed_age() or 0.0
        considered: list[tuple[Coin, str]] = []
        learning = bool(self.values["learn.enabled"])
        ranked = sorted(self.coins.values(), key=lambda item: (strategy.mode_value(item, mode) or -1.0, item.score), reverse=True)
        for coin in ranked:
            if coin.mint in held:
                continue
            lag = max(0.0, self.generated_at - coin.snapshot_at) / 1000 if coin.snapshot_at and self.generated_at else 0.0
            reason = strategy.entry_block(coin, s, feed_age + lag, self.trend(coin, mode)) or self._coin_limits(coin, now)
            if reason is None and learning:
                reason = self.learner.check(coin, strategy.mode_value(coin, mode), now, bool(self.values["learn.timing"]), self.market(coin.mint))
            if reason is None and self.values["learn.mistakes"]:
                reason = self.reviewer.check(buy_facts(coin, self.market(coin.mint)), now)
            if reason is not None:
                self.streaks.pop(coin.mint, None)
                considered.append((coin, reason))
                continue
            streak = self.streaks.get(coin.mint, 0) + 1
            self.streaks[coin.mint] = streak
            needed = strategy.confirm_pulls(s)
            if streak < needed:
                considered.append((coin, f"passes, confirming ({streak} of {needed} pulls)"))
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
        self.candidates = [{"mint": coin.mint, "symbol": coin.symbol, "score": round(coin.score), "dex": None if coin.dex_score is None else round(coin.dex_score), "quality": None if coin.quality is None else round(coin.quality), "reason": reason} for coin, reason in considered[:8]]

    def _buy(self, coin: Coin, now: int) -> str | None:
        """Buy the coin. Returns why not when the bet is refused."""
        s = self.rules
        rate = self.sol_usd
        spot, liquidity = coin.price, coin.liquidity_sol
        if spot is None or not rate:
            return "no price"
        quote = self.price_source({coin.mint: coin.pair}).get(coin.mint) if s["bot.live_prices"] or s["verify.enabled"] else None
        checked = strategy.verify_block(coin, quote, s, now, rate)
        if checked is not None:
            if self.chart_notes.get(coin.mint) != checked:
                self.chart_notes[coin.mint] = checked
                self.ledger.event(now, "skip", f"Skipped {coin.symbol} at score {coin.score:.0f}, chart check: {checked}")
            return f"chart check: {checked}"
        if quote is not None and not strategy.quote_lags(coin, quote.price / rate):
            if quote.price / rate < spot * 0.85:
                return f"price fell {(1 - quote.price / rate / spot) * 100:.0f}% since the Radar reading"
            spot = quote.price / rate
            liquidity = quote.liquidity / rate if quote.liquidity is not None else liquidity
        account = self.account()
        spent = self.ledger.spent_on(coin.mint, now - 86_400_000)
        size, limit = strategy.position_size(dataclasses.replace(coin, liquidity_sol=liquidity), s, account["equity"], account["cash"], account["exposure"], spent)
        if size <= 0:
            return limit
        network = self.fee()
        mode = s["mode.pick_by"]
        fill = broker.buy(spot, size, liquidity, s, network.total)
        if fill is None:
            return "fees would eat the whole buy"
        position = Position(
            id=0, mint=coin.mint, symbol=coin.symbol, pair=coin.pair, opened_at=now, entry_spot=spot, entry_price=fill.price,
            qty=fill.qty, qty_open=fill.qty, cost=fill.net, proceeds=0.0, fees=fill.fee,
            entry_liquidity=liquidity, last_liquidity=liquidity, peak_price=spot, peak_viewers=coin.viewers,
            last_price=spot, last_price_at=now, target_done=False, score=coin.score, peak_mode=strategy.mode_value(coin, mode),
            entry={**buy_facts(coin, self.market(coin.mint)), "mode": mode, "sizeLimit": limit, "impactPct": round(fill.impact_pct, 3), "bands": learner_bands(coin, strategy.mode_value(coin, mode), now, self.market(coin.mint))},
        )
        self.ledger.record_buy(position, fill, now)
        self.positions.append(position)
        self.ledger.event(now, "buy", f"Bought {coin.symbol}: {both(size, rate)} in {mode} mode at score {coin.score:.0f}{'' if coin.quality is None else f', quality {coin.quality:.0f}'} (size set by {limit}, price impact {fill.impact_pct:.1f}%, network fee {small_sol(network.total)}, {network.source})")
        self._after_trade()
        return None

    def left_radar(self, position: Position) -> bool:
        """True when the latest fresh Radar reading no longer lists a coin the bot holds."""
        age = self.feed_age()
        return bool(self.coins) and position.mint not in self.coins and age is not None and age <= self.rules["entry.max_data_age_seconds"]

    def flow(self, position: Position) -> strategy.Momentum | None:
        """The chart's momentum for a position at or past its target, steadied so one flat reading does not end a ride."""
        s = self.rules
        if not s["exit.ride_momentum"] or s["exit.take_profit_pct"] <= 0:
            return None
        if not position.target_done and position.gain() * 100 < s["exit.take_profit_pct"]:
            return None
        coin = self.coins.get(position.mint)
        read = strategy.momentum(coin, self.live_change(position), self.trend(coin, "dex") if coin and coin.dex_score is not None else None)
        if read.strong or not position.target_done:
            self.weak_reads[position.id] = 0
            return read
        self.weak_reads[position.id] = self.weak_reads.get(position.id, 0) + 1
        return read if self.weak_reads[position.id] >= 2 else strategy.Momentum(True, read.why)

    def manage_positions(self) -> None:
        now = self.now()
        for position in list(self.positions):
            signal = strategy.exit_signal(position, self.coins.get(position.mint), self.rules, now, self.left_radar(position), self.flow(position))
            if signal is None:
                continue
            if signal.ride:
                position.target_done = True
                self.ledger.save(position)
                self.ledger.event(now, "ride", f"{position.symbol} at {position.gain() * 100:+.0f}%. {signal.reason}.")
                self._report_soon()
                continue
            self._sell(position, signal.share, signal.reason, now, signal.urgent)

    def _sell(self, position: Position, share: float, reason: str, now: int, urgent: bool = False) -> None:
        whole = share >= 0.999
        qty = position.qty_open if whole else position.qty_open * share
        fill = broker.sell(position.last_price, qty, position.last_liquidity, bool(position.entry_liquidity), self.rules, self.fee().total, urgent)
        if reason == "Profit target":
            position.target_done = True
        if whole:
            coin = self.coins.get(position.mint)
            position.exit_high = max(position.peak_price, coin.high_price if coin and coin.high_price else 0.0)
        gain = position.gain() * 100
        self.ledger.record_sell(position, fill, position.last_price, reason, now)
        if position.status == "closed":
            self.positions.remove(position)
            profit = position.pnl()
            self._count_streak(profit, now)
            self.ledger.event(now, "sell", f"Sold {position.symbol}: {signed(profit, self.sol_usd)} ({round(position.pnl_pct(), 2):+.1f}%) after {position.held_minutes(now):.0f} min. {reason}.")
            self.gate.forget(position.id)
            self.price_trail.pop(position.id, None)
            self.weak_reads.pop(position.id, None)
            if self.values["learn.enabled"]:
                self.learner.record_trade(position, now)
            review = self.reviewer.review(position)
            lesson = review if review and profit < 0 else self.learner.describe_loss(position) if profit < 0 and self.values["learn.enabled"] else None
            if lesson:
                self.ledger.event(now, "learn", lesson)
        else:
            self.ledger.event(now, "sell", f"Sold {share * 100:.0f}% of {position.symbol} at {gain:+.0f}% for {both(fill.net, self.sol_usd)}. {reason}.")
        self._after_trade()

    def _count_streak(self, profit: float, now: int) -> None:
        s = self.rules
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

    def reset_account(self, cash: float | None = None) -> None:
        self.ledger.reset(self.rules["account.starting_sol"] if cash is None else dials.clean("account.starting_sol", cash), self.now())
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
        s = self.rules
        stops = []
        if s["exit.stop_loss_pct"] > 0:
            stops.append(position.entry_spot * (1 - s["exit.stop_loss_pct"] / 100))
        if position.target_done and s["exit.breakeven_after_target"]:
            stops.append(position.entry_spot)
        if s["exit.trailing_stop_pct"] > 0 and position.peak_price >= position.entry_spot * (1 + s["exit.trailing_start_pct"] / 100):
            stops.append(position.peak_price * (1 - s["exit.trailing_stop_pct"] / 100))
        if s["exit.on_tighten"] == "tighten_stop" and strategy.tightened(self.coins.get(position.mint), s, self.left_radar(position)):
            stops.append(position.peak_price * (1 - s["exit.tighten_trailing_pct"] / 100))
        if strategy.riding(position, s):
            stops.append(position.entry_spot * (1 + s["exit.take_profit_pct"] / 100))
            stops.append(position.peak_price * (1 - s["exit.ride_trail_pct"] / 100))
        return max(stops) if stops else None

    def position_rows(self) -> list[dict[str, Any]]:
        """Open positions with amounts and prices in SOL."""
        rows = []
        network = self.fee().total
        for position in self.positions:
            value = broker.open_value(position, self.rules, network)
            coin = self.coins.get(position.mint)
            rows.append({
                "advice": "left" if self.left_radar(position) else coin.advice_exit if coin else None,
                "id": position.id, "mint": position.mint, "symbol": position.symbol, "pairAddress": position.pair,
                "openedAt": position.opened_at, "entry": position.entry_spot, "price": position.last_price, "stop": self.stop_price(position),
                "cost": position.cost, "value": value, "pnl": position.pnl(value), "pnlPct": round(position.pnl_pct(value), 2),
                "gainPct": round(position.gain() * 100, 2), "peakGainPct": round((position.peak_price / position.entry_spot - 1) * 100, 2),
                "openPct": round(position.qty_open / position.qty * 100) if position.qty else 0,
                "targetDone": position.target_done, "score": round(position.score), "riding": strategy.riding(position, self.rules),
            })
        return rows

    def trade_rows(self, limit: int = 60) -> list[dict[str, Any]]:
        return [{
            "id": position.id, "mint": position.mint, "symbol": position.symbol, "pairAddress": position.pair,
            "openedAt": position.opened_at, "closedAt": position.closed_at,
            "cost": position.cost, "proceeds": position.proceeds, "pnl": position.pnl(), "pnlPct": round(position.pnl_pct(), 2),
            "reason": position.exit_reason, "score": round(position.score), "holdMinutes": round(position.held_minutes(position.closed_at or 0), 1),
        } for position in self.ledger.closed_positions(limit)]

    def status(self) -> tuple[str, str | None]:
        if not self.rules["bot.enabled"]:
            return "paused", "Buying is paused"
        return ("holding", self.buy_block) if self.buy_block else ("running", None)

    def report(self) -> dict[str, Any]:
        """What the Radar page shows. Dollar figures are the SOL amounts at the current SOL price."""
        account = self.account()
        state, note = self.status()
        age = self.feed_age()
        rate = self.sol_usd or 0.0
        fee = self.fee()
        stats = self.ledger.stats()
        money = ("id", "mint", "symbol", "pairAddress", "openedAt", "pnlPct", "score")
        positions = [{
            **{key: row[key] for key in (*money, "gainPct", "peakGainPct", "openPct", "targetDone", "advice", "riding")},
            "entryPrice": row["entry"] * rate, "price": row["price"] * rate, "stopPrice": None if row["stop"] is None else row["stop"] * rate,
            "costUsd": round(row["cost"] * rate, 2), "valueUsd": round(row["value"] * rate, 2), "pnlUsd": round(row["pnl"] * rate, 2),
            "costSol": round(row["cost"], 6), "valueSol": round(row["value"], 6), "pnlSol": round(row["pnl"], 6),
        } for row in self.position_rows()]
        trades = [{
            **{key: row[key] for key in (*money, "closedAt", "reason", "holdMinutes")},
            "costUsd": round(row["cost"] * rate, 2), "proceedsUsd": round(row["proceeds"] * rate, 2), "pnlUsd": round(row["pnl"] * rate, 2),
            "costSol": round(row["cost"], 6), "proceedsSol": round(row["proceeds"], 6), "pnlSol": round(row["pnl"], 6),
        } for row in self.trade_rows()]
        return {
            "version": VERSION,
            "at": self.now(),
            "startedAt": self.started_at,
            "status": state,
            "note": self.settings_error or note,
            "feed": {"ageSeconds": None if age is None else round(age), "live": self.feed_live, "coins": len(self.coins)},
            "solUsd": self.sol_usd,
            "fees": {"mode": self.rules["costs.fee_mode"], "source": fee.source, "prioritySol": round(fee.priority, 9), "bribeSol": round(fee.bribe, 9), "totalSol": round(fee.total, 9)},
            "account": {key: round(value if key.endswith("Pct") else value * rate, 2) for key, value in account.items()},
            "accountSol": {key: round(value, 6) for key, value in account.items() if not key.endswith("Pct")},
            "stats": {**stats, "realizedPnl": round(stats["realizedPnl"] * rate, 2), "feesPaid": round(stats["feesPaid"] * rate, 2), "realizedPnlSol": stats["realizedPnl"], "feesPaidSol": stats["feesPaid"]},
            "positions": positions,
            "trades": trades,
            "equity": [{"t": point["t"], "equity": round(point["equity"] * rate, 2), "sol": point["equity"]} for point in self.ledger.equity_curve()],
            "events": self.ledger.events(30),
            "candidates": self.candidates,
            "learning": {**self.learner.summary(bool(self.values["learn.timing"]), bool(self.values["learn.enabled"])), "buyLevel": round(self.buy_level(), 1), "mistakes": self.reviewer.summary(bool(self.values["learn.mistakes"]))},
            "strength": self.rules["risk.strength"],
            "settingsStamp": self.settings_stamp,
        }

    def step(self) -> None:
        """One pass of the loop. Safe to call as often as once or twice a second."""
        moment = self.clock()
        self.check_settings_file()
        self.check_inbox()
        self.refresh_market()
        if self.sol_usd and not self.ledger.in_sol:
            self._convert_to_sol()
        if self.background:
            fresh = self._sync_in_background()
        elif moment >= self.next_sync:
            fresh = self.sync()
            self.next_sync = self.clock() + self.rules["bot.poll_seconds"]
        else:
            fresh = False
        if not self.sol_usd or not self.ledger.in_sol:
            self.buy_block = "Waiting for the SOL price"
            return
        if self.positions and self.rules["bot.live_prices"] and self.clock() >= self.next_prices:
            self.update_live_prices()
            self.next_prices = self.clock() + self.rules["bot.price_seconds"]
        self.manage_positions()
        if fresh:
            self.consider_entries()
        else:
            self.buy_block = self.buy_guard(self.account())
        if self.clock() >= self.next_equity:
            account = self.account()
            self.ledger.equity_point(self.now(), account["equity"], account["cash"])
            self.next_equity = self.clock() + EQUITY_SECONDS
