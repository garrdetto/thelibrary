"""The simple dials, the price gate, selling at the target or riding momentum, and the learner.
Run with: python -m unittest discover -s scripts/axiom-paper-bot/tests"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper import strategy
from axiom_paper import settings as dials
from axiom_paper.engine import Engine
from axiom_paper.learner import MIN_SEEN, VETO_SEEN, Learner
from axiom_paper.models import Coin
from axiom_paper.pricegate import PriceGate
from axiom_paper.prices import Quote
from test_bot import Harness, position, token

CLEAN = {"entry.rebuy_gain_1m_pct": -1, "verify.enabled": False, "bot.poll_seconds": 3, "costs.fee_mode": "manual", "costs.priority_fee_sol": 0.0, "costs.bribe_sol": 0.0}


class SimpleHarness(Harness):
    """The bot run on the owner's simple dials, with only the live chart check and network fees held still."""

    def __init__(self, **simple: Any):
        self.simple = {"learn.enabled": False, **simple}
        super().__init__()

    def start(self, background: bool = False) -> Engine:
        dials.save_file(self.settings_path, dials.normalize({**dials.defaults(), **self.simple}))
        return Engine(self.ledger, self.site, self.settings_path, price_source=lambda wanted: {mint: self.quotes[mint] for mint in wanted if mint in self.quotes}, fee_source=lambda: self.fee_levels, clock=self.clock, background=background, rule_overrides=CLEAN)


def climbing(price: float, **changes: Any) -> dict[str, Any]:
    return token(priceUsd=price, priceChange={"s30": 3, "m1": 20, "m5": 40}, buyRatio=0.7, **changes)


def fading(price: float) -> dict[str, Any]:
    return token(priceUsd=price, priceChange={"s30": -4, "m1": -2, "m5": 20}, buyRatio=0.45)


class PriceGateTests(unittest.TestCase):
    def test_one_stale_quote_is_ignored(self) -> None:
        gate = PriceGate()
        self.assertIsNone(gate.offer(1, 1.0, 0.6, 1_000, "live"))
        self.assertEqual(gate.offer(1, 1.0, 0.98, 4_000, "radar"), 0.98)
        self.assertIsNone(gate.offer(1, 0.98, 0.6, 7_000, "live"))
        self.assertEqual(gate.offer(1, 0.98, 1.01, 9_000, "radar"), 1.01)

    def test_a_real_drop_is_taken_once_it_lasts(self) -> None:
        gate = PriceGate()
        self.assertIsNone(gate.offer(1, 1.0, 0.5, 0, "radar"))
        self.assertIsNone(gate.offer(1, 1.0, 0.48, 8_000, "live"))
        self.assertEqual(gate.offer(1, 1.0, 0.47, 16_000, "radar"), 0.5)

    def test_small_moves_pass_straight_through(self) -> None:
        self.assertEqual(PriceGate().offer(1, 1.0, 0.9, 0, "live"), 0.9)

    def test_a_frozen_quote_cannot_cancel_a_real_move(self) -> None:
        gate = PriceGate()
        for at in range(0, 60_000, 5_000):
            gate.offer(1, 1.0, 1.0, at, "live")
        self.assertIsNone(gate.offer(1, 1.0, 0.5, 60_000, "radar"))
        self.assertIsNone(gate.offer(1, 1.0, 1.0, 63_000, "live"))
        self.assertEqual(gate.offer(1, 1.0, 0.5, 76_000, "radar"), 0.5)


class StaleQuoteTests(unittest.TestCase):
    def test_the_mana_trade_is_not_stopped_out_by_a_minute_old_price(self) -> None:
        """2026-11-15, MANA: bought at $0.000213 after a 68% minute. DexScreener then read $0.000127 (the price before the
        run) for several pulls while the Radar read $0.00018 to $0.000197. The old bot sold in 5 seconds at -46%."""
        bot = SimpleHarness(**{"sell.stop_loss_pct": 20})
        bot.pull(token(priceUsd=0.000213))
        self.assertEqual(len(bot.engine.positions), 1)
        bot.quotes["MintA"] = Quote(0.000127, 60_000.0)
        bot.tick(seconds=3)
        bot.pull(token(priceUsd=0.000127), seconds=3)
        for radar in (0.00018, 0.000181, 0.000197, 0.000197):
            bot.tick(seconds=3)
            bot.pull(token(priceUsd=radar), seconds=3)
        self.assertEqual(len(bot.engine.positions), 1, bot.engine.trade_rows())
        self.assertGreater(bot.engine.positions[0].last_price, 0.00017)
        bot.close()

    def test_a_quote_lagging_behind_a_pump_does_not_cancel_the_buy(self) -> None:
        pumping = token(priceUsd=0.000213, priceChange={"s30": 20, "m1": 68, "m5": 70}, pulse={"seenAt": 1_800_000_000_000})
        rules = {**strategy_rules(), "verify.max_holder_age_seconds": 0}
        coin = Coin.from_token(pumping)
        self.assertTrue(strategy.quote_lags(coin, 0.000127))
        self.assertIsNone(strategy.verify_block(coin, Quote(0.000127, 40_000.0, 50_000.0, 600, 400), rules, 1_800_000_000_000, 1.0))
        bot = SimpleHarness()
        bot.engine.rule_overrides["verify.enabled"] = True
        bot.engine.rule_overrides["verify.max_holder_age_seconds"] = 0
        bot.engine._rules_for = None
        bot.quotes["MintA"] = Quote(0.000127, 60_000.0, 50_000.0, 600, 400)
        bot.pull(pumping)
        self.assertEqual(len(bot.engine.positions), 1, bot.engine.candidates)
        self.assertAlmostEqual(bot.engine.positions[0].entry_spot, 0.000213)
        bot.close()

    def test_a_real_dump_still_cancels_the_buy(self) -> None:
        coin = Coin.from_token(token(priceUsd=0.000213, priceChange={"s30": 1, "m1": 10, "m5": 20}))
        self.assertFalse(strategy.quote_lags(coin, 0.00015))
        rules = {**strategy_rules(), "verify.max_holder_age_seconds": 0}
        self.assertIn("price fell", strategy.verify_block(coin, Quote(0.00015, 40_000.0, 50_000.0, 600, 400), rules, 0, 1.0) or "")


class SettingsFileTests(unittest.TestCase):
    def test_an_old_settings_file_is_rewritten_once_in_the_new_layout(self) -> None:
        bot = SimpleHarness()
        bot.engine.ledger.close()
        bot.settings_path.write_text('[mode]\npick_by = "dex"\ndex_buy_at = 55\n[risk]\nmax_open_positions = 6\n', encoding="utf-8")
        bot.ledger = bot.ledger.__class__(":memory:")
        engine = Engine(bot.ledger, bot.site, bot.settings_path, price_source=lambda wanted: {}, fee_source=lambda: None, clock=bot.clock)
        self.assertEqual((engine.values["buy.pick_by"], engine.values["buy.buy_at"], engine.values["buy.max_coins"]), ("dex", 55, 6))
        self.assertTrue(dials.is_current(bot.settings_path))
        self.assertIn("[sell]", bot.settings_path.read_text(encoding="utf-8"))
        bot.close()


class RideTests(unittest.TestCase):
    def test_strong_momentum_at_the_target_keeps_the_coin_until_it_fades(self) -> None:
        bot = SimpleHarness(**{"sell.target_pct": 30, "sell.ride_momentum": True})
        bot.pull(token())
        bot.pull(climbing(0.00135))
        bot.pull(climbing(0.00135), seconds=16)
        held = bot.engine.positions[0]
        self.assertTrue(held.target_done)
        self.assertAlmostEqual(held.qty_open, held.qty)
        self.assertEqual(bot.ledger.events(1)[0]["kind"], "ride")
        self.assertTrue(bot.engine.report()["positions"][0]["riding"])
        bot.pull(climbing(0.0016))
        bot.pull(climbing(0.0018))
        self.assertEqual(len(bot.engine.positions), 1)
        bot.pull(fading(0.00179))
        self.assertEqual(len(bot.engine.positions), 1)
        bot.pull(fading(0.00178))
        self.assertEqual(bot.engine.positions, [])
        trade = bot.engine.trade_rows()[0]
        self.assertIn("Momentum faded", trade["reason"])
        self.assertGreater(trade["pnlPct"], 40)
        bot.close()

    def test_a_ride_never_gives_back_the_target(self) -> None:
        bot = SimpleHarness(**{"sell.target_pct": 30, "sell.ride_momentum": True, "sell.ride_trail_pct": 40})
        bot.pull(token())
        bot.pull(climbing(0.00135))
        bot.pull(climbing(0.00135), seconds=16)
        bot.pull(climbing(0.0014))
        bot.pull(climbing(0.00128))
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("back to the +30% target", bot.engine.trade_rows()[0]["reason"])
        bot.close()

    def test_the_trailing_amount_ends_a_ride(self) -> None:
        bot = SimpleHarness(**{"sell.target_pct": 30, "sell.ride_momentum": True, "sell.ride_trail_pct": 10})
        bot.pull(token())
        bot.pull(climbing(0.00135))
        bot.pull(climbing(0.00135), seconds=16)
        bot.pull(climbing(0.0015))
        bot.pull(climbing(0.00168))
        bot.pull(climbing(0.00148))
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("off its high", bot.engine.trade_rows()[0]["reason"])
        bot.close()

    def test_weak_momentum_at_the_target_sells_everything(self) -> None:
        bot = SimpleHarness(**{"sell.target_pct": 30, "sell.ride_momentum": True})
        bot.pull(token())
        bot.pull(fading(0.00135))
        bot.pull(fading(0.00135), seconds=16)
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.trade_rows()[0]["reason"], "Profit target")
        bot.close()

    def test_with_riding_off_the_target_sells_everything(self) -> None:
        bot = SimpleHarness(**{"sell.target_pct": 30, "sell.ride_momentum": False})
        bot.pull(token())
        bot.pull(climbing(0.00135))
        bot.pull(climbing(0.00135), seconds=16)
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.trade_rows()[0]["reason"], "Profit target")
        bot.close()

    def test_momentum_reads_the_chart(self) -> None:
        strong = strategy.momentum(Coin.from_token(climbing(1.0)), 2.0, 5.0)
        self.assertTrue(strong.strong)
        self.assertIn("+20% in 1m", strong.why)
        self.assertFalse(strategy.momentum(Coin.from_token(fading(1.0)), -1.0, -12.0).strong)
        self.assertFalse(strategy.momentum(Coin.from_token(climbing(1.0)), -8.0, None).strong)

    def test_a_ride_is_not_cut_by_the_hold_limit(self) -> None:
        s = {**strategy_rules(), "exit.ride_momentum": True, "exit.max_hold_minutes": 10, "exit.take_profit_pct": 30}
        riding = position(target_done=True, last_price=1.5, peak_price=1.55, last_price_at=60 * 60_000)
        self.assertIsNone(strategy.exit_signal(riding, Coin.from_token(climbing(1.5)), s, 60 * 60_000, flow=strategy.Momentum(True, "")))
        normal = position(last_price=1.1, peak_price=1.1, last_price_at=60 * 60_000)
        self.assertEqual(strategy.exit_signal(normal, Coin.from_token(climbing(1.1)), s, 60 * 60_000).reason, "Held too long")


def strategy_rules() -> dict[str, Any]:
    from axiom_paper import rules
    return rules.expand(dials.defaults())


def spike(mint: str, price: float, **changes: Any) -> Coin:
    """A coin right after a 60%+ minute, at its 10-minute high."""
    return Coin.from_token(token(mint, priceUsd=price, priceChange={"s30": 5, "m1": 70, "m5": 90}, history=[{"t": 1, "priceUsd": price}], **changes))


def dipped(mint: str, price: float) -> Coin:
    return Coin.from_token(token(mint, priceUsd=price, priceChange={"s30": 1, "m1": 4, "m5": 30}, history=[{"t": 1, "priceUsd": price * 1.1}]))


class LearnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.learner = Learner(self.db)
        self.now = 1_800_000_000_000

    def tearDown(self) -> None:
        self.db.close()

    def teach(self, make: Any, end_price: float, count: int, prefix: str) -> None:
        """`count` coins seen in one state, each then moving to `end_price` times where it was seen."""
        coins = {f"{prefix}{index}": make(f"{prefix}{index}", 0.001) for index in range(count)}
        self.learner.watch(coins, {mint: 80.0 for mint in coins}, 70, 30, 20, 30, self.now)
        later = {mint: Coin.from_token(token(mint, priceUsd=0.001 * end_price)) for mint in coins}
        for step in (20_000, 40_000, 60_000):
            self.learner.watch(later, {mint: 80.0 for mint in later}, 70, 30, 20, 30, self.now + step)
        self.now += 90_000

    def test_watched_coins_reach_their_target_or_stop(self) -> None:
        self.teach(spike, 0.7, 5, "down")
        self.teach(dipped, 1.4, 5, "up")
        outcomes = dict(self.db.execute("SELECT mint, outcome FROM learn_samples"))
        self.assertAlmostEqual(outcomes["down0"], -0.2)
        self.assertAlmostEqual(outcomes["up0"], 0.3)
        self.assertEqual(self.learner.open, {})

    def test_it_waits_for_a_better_moment_after_spikes_keep_failing(self) -> None:
        self.teach(spike, 0.7, VETO_SEEN + 2, "down")
        self.teach(dipped, 1.4, VETO_SEEN + 2, "up")
        self.learner.refresh(self.now)
        reason = self.learner.check(spike("new", 0.002), 80.0, self.now, timing=True) or ""
        self.assertIn("waiting for a better moment", reason)
        self.assertIn("up 60%+ in a minute", reason)
        self.assertIn("waiting until it is", reason)
        self.assertIsNone(self.learner.check(dipped("calm", 0.002), 80.0, self.now, timing=True))

    def test_timing_lessons_only_apply_when_timing_is_on(self) -> None:
        self.teach(spike, 0.7, MIN_SEEN + 2, "down")
        self.teach(dipped, 1.4, MIN_SEEN + 2, "up")
        self.learner.refresh(self.now)
        self.assertIsNone(self.learner.check(spike("new", 0.002), 80.0, self.now, timing=False))

    def test_too_few_samples_teach_nothing(self) -> None:
        self.teach(spike, 0.7, 5, "down")
        self.learner.refresh(self.now)
        self.assertIsNone(self.learner.check(spike("new", 0.002), 80.0, self.now, timing=True))

    def test_a_run_of_losing_trades_raises_the_buy_level(self) -> None:
        for index in range(10):
            held = position(id=index + 1, mint=f"L{index}", cost=1.0, proceeds=0.8, qty_open=0.0, status="closed", entry={"bands": {"age": "15–60 minutes old"}})
            self.learner.record_trade(held, self.now + index)
        self.assertEqual(self.learner.adjust, 10)
        self.assertEqual(self.learner.summary(True, True)["adjust"], 10)
        lesson = self.learner.describe_loss(position(cost=1.0, proceeds=0.8, exit_reason="Stop loss", entry={"bands": {"run1m": "up 60%+ in a minute", "age": "under 5 minutes old"}})) or ""
        self.assertIn("Lesson from MINTA", lesson)
        self.assertIn("raised 10 points", lesson)

    def test_samples_survive_a_restart(self) -> None:
        self.learner.watch({"A": spike("A", 0.001)}, {"A": 80.0}, 70, 30, 20, 30, self.now)
        again = Learner(self.db)
        self.assertEqual(len(again.open["A"]), 1)


class EngineLearningTests(unittest.TestCase):
    def test_the_bot_learns_from_coins_it_watches_and_reports_it(self) -> None:
        bot = SimpleHarness(**{"learn.enabled": True, "buy.max_coins": 1})
        bot.pull(token("MintA"), token("MintB", score=60))
        report = bot.engine.report()["learning"]
        self.assertTrue(report["enabled"])
        self.assertEqual(report["following"], 2)
        self.assertEqual(report["buyLevel"], 70)
        bot.close()

    def test_a_closed_trade_is_written_into_the_notebook(self) -> None:
        bot = SimpleHarness(**{"learn.enabled": True, "sell.stop_loss_pct": 20})
        bot.pull(token())
        self.assertIn("bands", bot.engine.positions[0].entry)
        bot.pull(token(priceUsd=0.0007))
        bot.pull(token(priceUsd=0.0007), seconds=16)
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.ledger.db.execute("SELECT COUNT(*) FROM learn_samples WHERE source = 'trade'").fetchone()[0], 1)
        self.assertTrue(any(event["kind"] == "learn" for event in bot.ledger.events(10)))
        bot.close()


if __name__ == "__main__":
    unittest.main()


class LiquidityGlitchTests(unittest.TestCase):
    def test_a_near_empty_pool_reading_while_the_price_holds_is_ignored(self) -> None:
        bot = SimpleHarness(**{"buy.dex_check": False, "sell.stop_loss_pct": 20})
        bot.pull(token(priceUsd=1.0, liquidityUsd=60_000))
        self.assertEqual(len(bot.engine.positions), 1)
        held = bot.engine.positions[0]
        bot.pull(token(priceUsd=1.03, liquidityUsd=0.06))
        self.assertGreater(held.last_liquidity, 50_000)
        sold = bot.engine.ledger.db.execute("SELECT proceeds, cost FROM positions WHERE status = 'closed'").fetchall()
        for proceeds, cost in sold:
            self.assertGreater(proceeds / cost, 0.9, "a glitch must not price a sale as if the pool were empty")

    def test_a_real_pull_that_crashes_the_price_still_counts(self) -> None:
        from axiom_paper.engine import liquidity_glitch
        self.assertTrue(liquidity_glitch(422.0, 0.06, 1.0, 1.06))
        self.assertFalse(liquidity_glitch(422.0, 0.06, 1.0, 0.2), "the price crashed too: a real pull")
        self.assertFalse(liquidity_glitch(422.0, 300.0, 1.0, 1.0), "an ordinary drop")
        self.assertFalse(liquidity_glitch(None, 0.06, 1.0, 1.0))


class ReportLimitTests(unittest.TestCase):
    def test_a_long_note_is_cut_so_the_site_still_takes_the_report(self) -> None:
        bot = SimpleHarness()
        bot.engine.ledger.event(bot.engine.now(), "learn", "x" * 5_000)
        events = bot.engine.report()["events"]
        self.assertTrue(all(len(event["text"]) <= 1_000 for event in events))
        bot.close()
