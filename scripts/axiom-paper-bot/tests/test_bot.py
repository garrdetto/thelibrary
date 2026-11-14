"""Run with: python -m unittest discover -s scripts/axiom-paper-bot/tests"""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from axiom_paper import broker, strategy
from axiom_paper import settings as dials
from axiom_paper.engine import Engine
from axiom_paper.ledger import Ledger
from axiom_paper.models import Coin, Position
from axiom_paper.prices import Quote


def token(mint: str = "MintA", **changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "mint": mint, "pairAddress": f"pair-{mint}", "symbol": mint.upper(), "priceUsd": 0.001, "score": 80, "signal": "buy",
        "viewers": 120, "viewersPerMin": 6, "liquidityUsd": 60_000, "marketCap": 150_000, "volume5m": 12_000, "buyRatio": 0.62,
        "ageMinutes": 30, "priceChange": {"s30": 1, "m1": 3, "m5": 9, "m10": 12}, "safety": {"level": "safe"},
        "quality": {"score": 90, "checks": [{"label": "Holders", "status": "pass"}]}, "alerts": [], "runnerWallets": 1, "lastSnapshotAt": None,
    }
    base.update(changes)
    return base


def position(**changes: Any) -> Position:
    base: dict[str, Any] = dict(
        id=1, mint="MintA", symbol="MINTA", pair=None, opened_at=0, entry_spot=1.0, entry_price=1.02, qty=100.0, qty_open=100.0,
        cost_usd=103.0, proceeds_usd=0.0, fees_usd=1.0, entry_liquidity=50_000.0, last_liquidity=50_000.0, peak_price=1.0,
        peak_viewers=100.0, last_price=1.0, last_price_at=0, target_done=False, score=80.0,
    )
    base.update(changes)
    return Position(**base)


class Clock:
    def __init__(self) -> None:
        self.t = 1_800_000_000.0

    def __call__(self) -> float:
        return self.t


class FakeSite:
    def __init__(self, clock: Clock):
        self.clock = clock
        self.tokens: list[dict[str, Any]] = []
        self.at = 0
        self.status = "live"
        self.settings: dict[str, Any] | None = None
        self.command = {"flatten": 0, "reset": 0}
        self.bodies: list[dict[str, Any]] = []
        self.delay = 0.0

    def publish(self, *tokens: dict[str, Any]) -> None:
        self.tokens = list(tokens)
        self.at = int(self.clock() * 1000)

    def sync(self, body: dict[str, Any]) -> dict[str, Any]:
        time.sleep(self.delay)
        self.bodies.append(body)
        pushed = body.get("settings")
        if pushed and pushed["updatedAt"] > (self.settings or {"updatedAt": 0})["updatedAt"]:
            self.settings = pushed
        now = int(self.clock() * 1000)
        payload = None if body["have"] == self.at or not self.at else {"status": self.status, "generatedAt": self.at, "tokens": self.tokens}
        newer = self.settings if self.settings and self.settings["updatedAt"] > body["settingsStamp"] else None
        return {"ok": True, "now": now, "payloadAt": self.at or None, "payload": payload, "settings": newer, "command": self.command}


class Harness:
    def __init__(self, **overrides: Any):
        self.folder = tempfile.TemporaryDirectory()
        self.settings_path = Path(self.folder.name) / "paper-bot.toml"
        values = dials.defaults()
        values.update({"entry.confirm_pulls": 1, "bot.poll_seconds": 3})
        values.update(overrides)
        dials.save_file(self.settings_path, dials.normalize(values))
        self.clock = Clock()
        self.site = FakeSite(self.clock)
        self.quotes: dict[str, Quote] = {}
        self.ledger = Ledger(":memory:")
        self.engine = self.start()

    def start(self, background: bool = False) -> Engine:
        return Engine(self.ledger, self.site, self.settings_path, price_source=lambda wanted: {mint: self.quotes[mint] for mint in wanted if mint in self.quotes}, clock=self.clock, background=background)

    def pull(self, *tokens: dict[str, Any], seconds: float = 5) -> None:
        self.clock.t += seconds
        self.site.publish(*tokens)
        self.engine.step()

    def tick(self, seconds: float = 5) -> None:
        self.clock.t += seconds
        self.engine.step()

    def close(self) -> None:
        self.ledger.close()
        self.folder.cleanup()


class SettingsTests(unittest.TestCase):
    def test_values_are_clamped_and_wrong_kinds_fall_back(self) -> None:
        values = dials.normalize({"risk.strength": 99, "entry.min_score": "high", "bot.enabled": "yes", "entry.signal": "moon", "exit.stop_loss_pct": 7.5})
        self.assertEqual(values["risk.strength"], 10)
        self.assertEqual(values["entry.min_score"], 70)
        self.assertIs(values["bot.enabled"], True)
        self.assertEqual(values["entry.signal"], "buy")
        self.assertEqual(values["exit.stop_loss_pct"], 7.5)

    def test_file_round_trip_keeps_every_dial(self) -> None:
        values = dials.normalize({"risk.strength": 8, "entry.signal": "any", "bot.fast_feed": True, "costs.fee_pct": 1.25})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bot.toml"
            dials.save_file(path, values)
            self.assertEqual(dials.load_file(path), values)
            self.assertIn("# Risk strength", path.read_text(encoding="utf-8"))

    def test_every_default_is_inside_its_own_range(self) -> None:
        self.assertEqual(dials.normalize(dials.defaults()), dials.defaults())
        self.assertEqual(len(dials.DIAL_BY_KEY), len(dials.DIALS))
        groups = {group["id"] for group in dials.GROUPS}
        self.assertTrue(all(dial["key"].split(".")[0] in groups for dial in dials.DIALS))


class BrokerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s = dials.defaults()

    def test_buy_pays_fees_impact_and_slippage(self) -> None:
        fill = broker.buy(1.0, 100.0, 20_000.0, self.s)
        assert fill is not None
        self.assertAlmostEqual(fill.fee_usd, 1.2)
        self.assertAlmostEqual(fill.impact_pct, 98.8 / 10_000 * 100)
        self.assertAlmostEqual(fill.price, 1.0 * (1 + 98.8 / 10_000) * 1.01)
        self.assertAlmostEqual(fill.qty * fill.price, 98.8)

    def test_round_trip_at_the_same_price_loses_money(self) -> None:
        bought = broker.buy(1.0, 100.0, 20_000.0, self.s)
        assert bought is not None
        sold = broker.sell(1.0, bought.qty, 20_000.0, True, self.s)
        self.assertLess(sold.net_usd, 97.0)
        self.assertGreater(sold.net_usd, 93.0)

    def test_pulled_liquidity_pays_almost_nothing(self) -> None:
        self.assertEqual(broker.sell(1.0, 100.0, 0.0, True, self.s).net_usd, 0.0)
        self.assertLess(broker.sell(1.0, 100.0, 40.0, True, self.s).net_usd, 20.0)

    def test_tiny_bets_are_refused_when_fees_eat_them(self) -> None:
        self.assertIsNone(broker.buy(1.0, 0.2, 20_000.0, self.s))


class StrategyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s = dials.defaults()

    def block(self, **changes: Any) -> str | None:
        return strategy.entry_block(Coin.from_token(token(**changes)), self.s, 5)

    def test_a_good_coin_passes(self) -> None:
        self.assertIsNone(self.block())

    def test_each_rule_names_what_failed(self) -> None:
        self.assertEqual(self.block(signal="watch"), "not a recommended buy")
        self.assertIn("score 60 under 70", self.block(score=60) or "")
        self.assertIn("liquidity", self.block(liquidityUsd=2_000) or "")
        self.assertEqual(self.block(liquidityUsd=None), "no liquidity yet")
        self.assertEqual(self.block(safety={"level": "risky"}), "safety is risky")
        self.assertIn("warning", self.block(alerts=["Liquidity fell 40% in 1m"]) or "")
        self.assertIn("already up", self.block(priceChange={"m1": 5, "m5": 400}) or "")
        self.assertIn("failed quality checks", self.block(quality={"score": 90, "checks": [{"status": "fail"}, {"status": "fail"}]}) or "")
        self.assertIn("old", strategy.entry_block(Coin.from_token(token()), self.s, 400) or "")

    def test_learned_rules_only_apply_when_turned_on(self) -> None:
        self.assertIsNone(self.block(outlook={"runnerChance": 0.1, "phase": "running", "minutesLeft": 20}))
        self.s["learned.min_runner_chance_pct"] = 50
        self.assertIn("runner chance 10% under 50%", self.block(outlook={"runnerChance": 0.1}) or "")
        self.assertIsNone(self.block())
        self.s["learned.missing"] = "skip"
        self.assertEqual(self.block(), "no runner chance yet")
        self.assertIn("usual crash time", self.block(outlook={"runnerChance": 0.9, "phase": "overdue"}) or "")

    def test_risk_strength_scales_the_bet(self) -> None:
        coin = Coin.from_token(token(score=70))
        self.s["risk.scale_with_conviction"] = False
        normal, _ = strategy.position_size(coin, self.s, 1000, 1000, 0)
        self.s["risk.strength"] = 10
        doubled, _ = strategy.position_size(coin, self.s, 1000, 1000, 0)
        self.s["risk.strength"] = 1
        fifth, _ = strategy.position_size(coin, self.s, 1000, 1000, 0)
        self.assertAlmostEqual(normal, 30)
        self.assertAlmostEqual(doubled, 60)
        self.assertAlmostEqual(fifth, 0)

    def test_bet_is_capped_by_liquidity_exposure_and_cash(self) -> None:
        self.s["risk.strength"] = 10
        self.s["risk.position_pct"] = 20
        size, limit = strategy.position_size(Coin.from_token(token(liquidityUsd=2_000)), self.s, 1000, 1000, 0)
        self.assertAlmostEqual(size, 30)
        self.assertEqual(limit, "coin's liquidity")
        size, limit = strategy.position_size(Coin.from_token(token()), self.s, 1000, 1000, 0)
        self.assertAlmostEqual(size, 100)
        self.assertEqual(limit, "largest single bet")
        size, limit = strategy.position_size(Coin.from_token(token()), self.s, 1000, 1000, 760)
        self.assertAlmostEqual(size, 40)
        self.assertEqual(limit, "account exposure limit")
        size, limit = strategy.position_size(Coin.from_token(token()), self.s, 1000, 25, 0)
        self.assertAlmostEqual(size, 25)
        self.assertEqual(limit, "cash on hand")

    def test_stronger_setups_get_bigger_bets(self) -> None:
        weak, _ = strategy.position_size(Coin.from_token(token(score=70)), self.s, 1000, 1000, 0)
        strong, _ = strategy.position_size(Coin.from_token(token(score=100)), self.s, 1000, 1000, 0)
        learned, _ = strategy.position_size(Coin.from_token(token(score=70, explode={"chance": 1.0, "learned": True})), self.s, 1000, 1000, 0)
        self.assertAlmostEqual(weak, 15)
        self.assertAlmostEqual(strong, 45)
        self.assertAlmostEqual(learned, 45)

    def test_exit_rules(self) -> None:
        minute = 60_000
        self.assertIsNone(strategy.exit_signal(position(), None, self.s, minute))
        self.assertEqual(strategy.exit_signal(position(last_price=0.87), None, self.s, minute), ("Stop loss", 1.0))
        self.assertEqual(strategy.exit_signal(position(last_price=1.45, peak_price=1.45), None, self.s, minute), ("Profit target", 0.5))
        self.assertEqual(strategy.exit_signal(position(last_price=1.2, peak_price=1.45), None, self.s, minute), ("Trailing stop", 1.0))
        self.assertEqual(strategy.exit_signal(position(last_price=0.99, peak_price=1.05, target_done=True), None, self.s, minute), ("Back to entry after target", 1.0))
        self.assertEqual(strategy.exit_signal(position(last_price=1.01, last_price_at=16 * minute), None, self.s, 16 * minute), ("Stalled", 1.0))
        self.assertEqual(strategy.exit_signal(position(last_price=1.06, peak_price=1.08, last_price_at=61 * minute), None, self.s, 61 * minute), ("Held too long", 1.0))
        self.assertEqual(strategy.exit_signal(position(last_price=1.06, last_price_at=0), None, self.s, 6 * minute), ("No price", 1.0))
        warned = Coin.from_token(token(alerts=["Price dumped 25% in 30s"]))
        self.assertEqual(strategy.exit_signal(position(last_price=1.06), warned, self.s, minute), ("Radar warning: Price dumped 25% in 30s", 1.0))
        self.s["exit.viewer_drop_pct"] = 50
        self.assertEqual(strategy.exit_signal(position(last_price=1.06), Coin.from_token(token(viewers=40)), self.s, minute), ("Viewers fell", 1.0))


class EngineTests(unittest.TestCase):
    def test_buys_after_the_coin_passes_enough_pulls_in_a_row(self) -> None:
        bot = Harness(**{"entry.confirm_pulls": 2})
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("confirming", bot.engine.candidates[0]["reason"])
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        held = bot.engine.positions[0]
        self.assertAlmostEqual(held.cost_usd, 1000 * 0.03 * (0.5 + 1 / 3))
        self.assertAlmostEqual(bot.ledger.cash, 1000 - held.cost_usd)
        self.assertLess(bot.engine.account()["equity"], 1000)
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_profit_target_sells_half_then_protects_the_entry(self) -> None:
        bot = Harness(**{"exit.trailing_stop_pct": 0})
        bot.pull(token())
        bot.pull(token(priceUsd=0.00145))
        held = bot.engine.positions[0]
        self.assertTrue(held.target_done)
        self.assertAlmostEqual(held.qty_open, held.qty / 2)
        self.assertGreater(held.proceeds_usd, held.cost_usd * 0.6)
        bot.pull(token(priceUsd=0.00099))
        self.assertEqual(bot.engine.positions, [])
        trade = bot.engine.trade_rows()[0]
        self.assertEqual(trade["reason"], "Back to entry after target")
        self.assertGreater(trade["pnlUsd"], 0)
        self.assertAlmostEqual(bot.ledger.cash, 1000 + trade["pnlUsd"], places=1)
        bot.close()

    def test_stop_loss_uses_live_prices_between_pulls(self) -> None:
        bot = Harness()
        bot.pull(token())
        bot.quotes["MintA"] = Quote(0.0008, 60_000.0)
        bot.tick(seconds=4)
        self.assertEqual(bot.engine.positions, [])
        trade = bot.engine.trade_rows()[0]
        self.assertEqual(trade["reason"], "Stop loss")
        self.assertLess(trade["pnlPct"], -20)
        self.assertEqual(bot.ledger.get("loss_streak"), 1)
        bot.close()

    def test_a_falling_live_price_cancels_the_buy(self) -> None:
        bot = Harness()
        bot.quotes["MintA"] = Quote(0.0007, 60_000.0)
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("price fell 30%", bot.engine.candidates[0]["reason"])
        bot.close()

    def test_stale_or_offline_radar_stops_buying(self) -> None:
        bot = Harness()
        bot.site.status = "stale"
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.buy_block, "The tracker is not live")
        bot.site.status = "live"
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        bot.tick(seconds=200)
        self.assertIn("old", bot.engine.buy_block or "")
        bot.close()

    def test_limits_on_open_coins_and_cooldown(self) -> None:
        bot = Harness(**{"risk.max_open_positions": 2})
        bot.pull(token("MintA"), token("MintB"), token("MintC"))
        self.assertEqual(len(bot.engine.positions), 2)
        self.assertEqual(bot.engine.buy_block, "Holding the most coins allowed")
        bot.engine.flatten("Test")
        bot.pull(token("MintA"), token("MintB"), token("MintC", score=60))
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("cooldown", bot.engine.candidates[0]["reason"])
        bot.close()

    def test_daily_loss_limit_blocks_new_buys(self) -> None:
        bot = Harness(**{"risk.daily_loss_limit_pct": 1, "risk.position_pct": 20, "risk.max_position_pct": 50})
        bot.pull(token("MintA"))
        bot.pull(token("MintA", priceUsd=0.0005), token("MintB"))
        self.assertEqual(bot.engine.buy_block, "Daily loss limit reached")
        self.assertEqual(bot.engine.positions, [])
        bot.close()

    def test_loss_streak_takes_a_break(self) -> None:
        bot = Harness(**{"risk.loss_streak": 2, "entry.cooldown_minutes": 0, "entry.max_buys_per_coin": 9, "risk.daily_loss_limit_pct": 0})
        for _ in range(2):
            bot.pull(token())
            bot.pull(token(priceUsd=0.0008, signal=None))
        self.assertIn("break", bot.engine.buy_block or "")
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        bot.tick(seconds=31 * 60)
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_dials_saved_on_the_radar_page_reach_the_bot_and_its_file(self) -> None:
        bot = Harness()
        values = dials.defaults()
        values["risk.strength"] = 9
        bot.site.settings = {"values": values, "updatedAt": int(bot.clock() * 1000) + 60_000}
        bot.tick()
        self.assertEqual(bot.engine.values["risk.strength"], 9)
        self.assertEqual(dials.load_file(bot.settings_path)["risk.strength"], 9)
        sent = len(bot.site.bodies)
        bot.tick(seconds=15)
        self.assertEqual(len(bot.site.bodies), sent + 1)
        self.assertNotIn("settings", bot.site.bodies[-1])
        self.assertEqual(bot.site.settings["values"]["risk.strength"], 9)
        bot.close()

    def test_edits_to_the_file_reach_the_radar_page(self) -> None:
        bot = Harness()
        bot.tick()
        edited = dict(bot.engine.values)
        edited["exit.stop_loss_pct"] = 20
        bot.clock.t += 5
        dials.save_file(bot.settings_path, edited)
        bot.tick()
        self.assertEqual(bot.engine.values["exit.stop_loss_pct"], 20)
        self.assertEqual((bot.site.settings or {})["values"]["exit.stop_loss_pct"], 20)
        bot.close()

    def test_a_broken_settings_file_keeps_the_last_good_dials(self) -> None:
        bot = Harness(**{"risk.strength": 7})
        bot.tick()
        bot.settings_path.write_text("[risk\nstrength = ", encoding="utf-8")
        bot.tick()
        self.assertEqual(bot.engine.values["risk.strength"], 7)
        self.assertIn("mistake", bot.engine.settings_error or "")
        bot.close()

    def test_commands_from_the_radar_page(self) -> None:
        bot = Harness()
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        bot.site.command = {"flatten": int(bot.clock() * 1000), "reset": 0}
        bot.tick()
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.trade_rows()[0]["reason"], "Closed from the Radar page")
        bot.tick()
        self.assertEqual(len(bot.engine.trade_rows()), 1)
        bot.site.command = {"flatten": bot.site.command["flatten"], "reset": int(bot.clock() * 1000)}
        bot.tick()
        self.assertEqual(bot.engine.trade_rows(), [])
        self.assertEqual(bot.ledger.cash, 1000)
        bot.close()

    def test_old_commands_are_ignored(self) -> None:
        bot = Harness()
        bot.pull(token())
        bot.site.command = {"flatten": int(bot.clock() * 1000) - 3_600_000, "reset": 0}
        bot.tick()
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_restart_keeps_the_account_and_positions(self) -> None:
        bot = Harness()
        bot.pull(token())
        cash = bot.ledger.cash
        bot.clock.t += 120
        again = bot.start()
        self.assertEqual(len(again.positions), 1)
        self.assertEqual(again.ledger.cash, cash)
        again.step()
        self.assertEqual(len(again.positions), 1)
        bot.close()

    def test_a_slow_site_does_not_hold_up_the_loop(self) -> None:
        bot = Harness()
        engine = bot.start(background=True)
        bot.site.delay = 0.4
        bot.clock.t += 5
        bot.site.publish(token())
        started = time.perf_counter()
        engine.step()
        engine.step()
        self.assertLess(time.perf_counter() - started, 0.2)
        self.assertEqual(engine.positions, [])
        time.sleep(0.8)
        engine.step()
        self.assertEqual(len(engine.positions), 1)
        self.assertIsNone(engine.error)
        bot.close()

    def test_report_carries_what_the_radar_page_shows(self) -> None:
        bot = Harness()
        bot.pull(token())
        bot.tick()
        report = [body["report"] for body in bot.site.bodies if "report" in body][-1]
        self.assertEqual(report["status"], "running")
        self.assertEqual(len(report["positions"]), 1)
        self.assertEqual(report["positions"][0]["symbol"], "MINTA")
        self.assertIn("equity", report["account"])
        self.assertTrue(report["events"])
        bot.close()


if __name__ == "__main__":
    unittest.main()
