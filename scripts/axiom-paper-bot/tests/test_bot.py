"""Run with: python -m unittest discover -s scripts/axiom-paper-bot/tests"""

from __future__ import annotations

import io
import sys
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from axiom_paper import broker, cli, fees, strategy
from axiom_paper import settings as dials
from axiom_paper.engine import Engine
from axiom_paper.ledger import Ledger
from axiom_paper.models import Coin, Position
from axiom_paper.prices import SOL_MINT, Quote


PINNED = {
    "risk.position_pct": 3, "exit.stop_loss_pct": 12, "exit.trailing_stop_pct": 15, "exit.trailing_start_pct": 10, "costs.stop_slippage_pct": 0,
    "risk.buy_mode": "percent", "risk.max_per_coin_sol": 0, "risk.min_position_sol": 10, "account.starting_sol": 1000,
    "costs.fee_mode": "manual", "costs.priority_fee_sol": 0.1, "costs.bribe_sol": 0.099995,
    "entry.signal": "buy", "entry.radar_advice": "follow", "learned.skip_phase": "overdue", "verify.enabled": False,
}
FEE = 0.2


def pinned() -> dict[str, Any]:
    """The defaults with the dials these tests do their sums on held still, so retuning a default does not break them."""
    return dials.normalize({**dials.defaults(), **PINNED})


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
        cost=103.0, proceeds=0.0, fees=1.0, entry_liquidity=50_000.0, last_liquidity=50_000.0, peak_price=1.0,
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
        values = pinned()
        values.update({"entry.confirm_pulls": 1, "bot.poll_seconds": 3})
        values.update(overrides)
        dials.save_file(self.settings_path, dials.normalize(values))
        self.clock = Clock()
        self.site = FakeSite(self.clock)
        self.quotes: dict[str, Quote] = {SOL_MINT: Quote(1.0, None)}
        self.fee_levels: fees.FeeLevels | None = None
        self.ledger = Ledger(":memory:")
        self.engine = self.start()

    def start(self, background: bool = False) -> Engine:
        return Engine(self.ledger, self.site, self.settings_path, price_source=lambda wanted: {mint: self.quotes[mint] for mint in wanted if mint in self.quotes}, fee_source=lambda: self.fee_levels, clock=self.clock, background=background)

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
        values = dials.normalize({"risk.strength": 99, "mode.score_buy_at": "high", "bot.enabled": "yes", "entry.signal": "moon", "exit.stop_loss_pct": 7.5})
        self.assertEqual(values["risk.strength"], 10)
        self.assertEqual(values["mode.score_buy_at"], 70)
        self.assertIs(values["bot.enabled"], True)
        self.assertEqual(values["entry.signal"], "any")
        self.assertEqual(values["exit.stop_loss_pct"], 7.5)

    def test_a_renamed_dial_keeps_the_old_value(self) -> None:
        self.assertEqual(dials.normalize({"entry.min_score": 82})["mode.score_buy_at"], 82)
        self.assertEqual(dials.normalize({"entry.min_score": 82, "mode.score_buy_at": 64})["mode.score_buy_at"], 64)
        self.assertNotIn("entry.min_score", dials.normalize({"entry.min_score": 82}))

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


class OutputTests(unittest.TestCase):
    def test_coin_names_in_any_script_survive_a_piped_log(self) -> None:
        raw = io.BytesIO()
        piped = io.TextIOWrapper(raw, encoding="cp1252")
        with mock.patch.object(sys, "stdout", piped), mock.patch.object(sys, "stderr", io.TextIOWrapper(io.BytesIO(), encoding="cp1252")):
            cli.use_utf8_output()
            print("Bought 猫币🚀: $20.00")
            piped.flush()
        self.assertEqual(raw.getvalue().decode("utf-8").strip(), "Bought 猫币🚀: $20.00")


class BrokerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s = pinned()

    def test_stop_sells_pay_extra_slippage(self) -> None:
        calm = broker.sell(1.0, 100.0, 50_000.0, True, self.s, FEE)
        self.s["costs.stop_slippage_pct"] = 5
        self.assertAlmostEqual(broker.sell(1.0, 100.0, 50_000.0, True, self.s, FEE).net, calm.net)
        rushed = broker.sell(1.0, 100.0, 50_000.0, True, self.s, FEE, urgent=True)
        self.assertAlmostEqual(rushed.gross, calm.gross * 0.95)

    def test_buy_pays_fees_impact_and_slippage(self) -> None:
        fill = broker.buy(1.0, 100.0, 20_000.0, self.s, FEE)
        assert fill is not None
        self.assertAlmostEqual(fill.fee, 1.2)
        self.assertAlmostEqual(fill.impact_pct, 98.8 / 10_000 * 100)
        self.assertAlmostEqual(fill.price, 1.0 * (1 + 98.8 / 10_000) * 1.01)
        self.assertAlmostEqual(fill.qty * fill.price, 98.8)

    def test_round_trip_at_the_same_price_loses_money(self) -> None:
        bought = broker.buy(1.0, 100.0, 20_000.0, self.s, FEE)
        assert bought is not None
        sold = broker.sell(1.0, bought.qty, 20_000.0, True, self.s, FEE)
        self.assertLess(sold.net, 97.0)
        self.assertGreater(sold.net, 93.0)

    def test_pulled_liquidity_pays_almost_nothing(self) -> None:
        self.assertEqual(broker.sell(1.0, 100.0, 0.0, True, self.s, FEE).net, 0.0)
        self.assertLess(broker.sell(1.0, 100.0, 40.0, True, self.s, FEE).net, 20.0)

    def test_tiny_bets_are_refused_when_fees_eat_them(self) -> None:
        self.assertIsNone(broker.buy(1.0, 0.2, 20_000.0, self.s, FEE))


class StrategyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s = pinned()

    def fired(self, held: Position, coin: Coin | None, now: int, left_radar: bool = False) -> tuple[str, float] | None:
        signal = strategy.exit_signal(held, coin, self.s, now, left_radar)
        return None if signal is None else (signal.reason, signal.share)

    def test_radar_advice_blocks_buys(self) -> None:
        never = {"exit": "hold", "rebuy": "never", "rebuyReasons": ["Fell 80% from its high"], "exitReasons": []}
        wait = {"exit": "hold", "rebuy": "wait", "rebuyReasons": ["Viewers are 30% below their high"], "exitReasons": []}
        fading = {"exit": "tighten", "rebuy": "ok", "rebuyReasons": [], "exitReasons": ["Buys fell 35% in 2 minutes"]}
        self.assertIsNone(self.block(advice={"exit": "hold", "rebuy": "ok"}))
        self.assertEqual(self.block(advice=never), "Radar says never rebuy: Fell 80% from its high")
        self.assertEqual(self.block(advice=wait), "Radar says wait: Viewers are 30% below their high")
        self.assertIn("momentum is fading", self.block(advice=fading) or "")
        self.assertIn("Radar says exit", self.block(advice={"exit": "exit", "rebuy": "ok"}) or "")
        self.s["entry.radar_advice"] = "never_only"
        self.assertIsNone(self.block(advice=wait))
        self.assertIsNone(self.block(advice=fading))
        self.assertIn("never rebuy", self.block(advice=never) or "")
        self.s["entry.radar_advice"] = "ignore"
        self.assertIsNone(self.block(advice=never))

    def test_radar_advice_sells_and_tightens(self) -> None:
        minute = 60_000
        leave = Coin.from_token(token(advice={"exit": "exit", "rebuy": "never", "exitReasons": ["Viewers fell 25% in 2 minutes"]}))
        signal = strategy.exit_signal(position(last_price=1.05, last_price_at=minute), leave, self.s, minute)
        assert signal is not None
        self.assertEqual((signal.reason, signal.share, signal.urgent), ("Radar says exit: Viewers fell 25% in 2 minutes", 1.0, True))
        fading = Coin.from_token(token(advice={"exit": "tighten", "rebuy": "wait", "exitReasons": ["Buys fell 35% in 2 minutes"]}))
        self.assertIsNone(self.fired(position(last_price=1.03, peak_price=1.08, last_price_at=minute), fading, minute))
        tight = self.fired(position(last_price=0.97, peak_price=1.08, last_price_at=minute), fading, minute)
        self.assertEqual(tight, ("Tightened trailing stop. Radar says momentum is fading: Buys fell 35% in 2 minutes", 1.0))
        self.assertIsNone(self.fired(position(last_price=0.97, peak_price=1.08, last_price_at=minute), Coin.from_token(token()), minute))
        self.s["exit.on_tighten"] = "sell_all"
        self.assertEqual(self.fired(position(last_price=1.03, peak_price=1.08, last_price_at=minute), fading, minute), ("Radar says momentum is fading: Buys fell 35% in 2 minutes", 1.0))
        self.s["exit.follow_radar_advice"] = False
        self.assertIsNone(self.fired(position(last_price=1.05, last_price_at=minute), leave, minute))

    def test_a_coin_that_leaves_the_radar_is_tightened_or_sold(self) -> None:
        minute = 60_000
        held = position(last_price=0.96, peak_price=1.08, last_price_at=minute)
        self.assertIsNone(self.fired(held, None, minute))
        self.assertEqual(self.fired(held, None, minute, left_radar=True), ("Tightened trailing stop. Left the Radar", 1.0))
        self.assertIsNone(self.fired(position(last_price=1.05, peak_price=1.08, last_price_at=minute), None, minute, left_radar=True))
        self.s["exit.left_radar"] = "sell"
        self.assertEqual(self.fired(position(last_price=1.05, peak_price=1.08, last_price_at=minute), None, minute, left_radar=True), ("Left the Radar", 1.0))
        self.s["exit.left_radar"] = "ignore"
        self.assertIsNone(self.fired(held, None, minute, left_radar=True))

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
        self.assertIsNone(self.fired(position(), None, minute))
        self.assertEqual(self.fired(position(last_price=0.87), None, minute), ("Stop loss", 1.0))
        self.assertEqual(self.fired(position(last_price=1.45, peak_price=1.45), None, minute), ("Profit target", 0.5))
        self.assertEqual(self.fired(position(last_price=1.2, peak_price=1.45), None, minute), ("Trailing stop", 1.0))
        self.assertEqual(self.fired(position(last_price=0.99, peak_price=1.05, target_done=True), None, minute), ("Back to entry after target", 1.0))
        self.assertEqual(self.fired(position(last_price=1.01, last_price_at=16 * minute), None, 16 * minute), ("Stalled", 1.0))
        self.assertEqual(self.fired(position(last_price=1.06, peak_price=1.08, last_price_at=61 * minute), None, 61 * minute), ("Held too long", 1.0))
        self.assertEqual(self.fired(position(last_price=1.06, last_price_at=0), None, 6 * minute), ("No price", 1.0))
        warned = Coin.from_token(token(alerts=["Price dumped 25% in 30s"]))
        self.assertEqual(self.fired(position(last_price=1.06), warned, minute), ("Radar warning: Price dumped 25% in 30s", 1.0))
        self.s["exit.viewer_drop_pct"] = 50
        self.assertEqual(self.fired(position(last_price=1.06), Coin.from_token(token(viewers=40)), minute), ("Viewers fell", 1.0))


class ModeTests(unittest.TestCase):
    """Score mode and quality mode each decide when to buy and when to sell."""

    def setUp(self) -> None:
        self.s = pinned()

    def block(self, trend: float | None = None, **changes: Any) -> str | None:
        return strategy.entry_block(Coin.from_token(token(**changes)), self.s, 5, trend)

    def fired(self, held: Position, **changes: Any) -> str | None:
        signal = strategy.exit_signal(held, Coin.from_token(token(**changes)), self.s, 60_000)
        return None if signal is None else signal.reason

    def test_quality_mode_buys_on_quality_not_score(self) -> None:
        self.assertIn("score 40 under 70", self.block(score=40) or "")
        self.s["mode.pick_by"] = "quality"
        self.assertIsNone(self.block(score=40))
        self.assertIn("quality score 60 under 70", self.block(quality={"score": 60, "checks": []}) or "")
        self.assertEqual(self.block(quality={"score": None, "checks": []}), "no quality score yet")

    def test_bet_size_follows_the_mode_number(self) -> None:
        self.s["mode.pick_by"] = "quality"
        weak, _ = strategy.position_size(Coin.from_token(token(score=100, quality={"score": 70, "checks": []})), self.s, 1000, 1000, 0)
        strong, _ = strategy.position_size(Coin.from_token(token(score=0, quality={"score": 100, "checks": []})), self.s, 1000, 1000, 0)
        self.assertAlmostEqual(weak, 15)
        self.assertAlmostEqual(strong, 45)

    def test_trend_rules(self) -> None:
        self.assertIsNone(self.block(None))
        self.assertIsNone(self.block(0))
        self.assertEqual(self.block(-4), "score fell 4 in the last minute")
        self.s["mode.score_trend"] = "rising"
        self.assertEqual(self.block(None), "waiting to see the score climb")
        self.assertIn("not climbing", self.block(0) or "")
        self.assertIsNone(self.block(3))
        self.s["mode.score_trend"] = "any"
        self.assertIsNone(self.block(-30))
        self.s["mode.pick_by"] = "quality"
        self.assertEqual(self.block(-10), "quality score fell 10 in the last minute")

    def test_score_mode_sells(self) -> None:
        self.assertIsNone(self.fired(position(peak_mode=85.0), score=80))
        self.assertEqual(self.fired(position(peak_mode=85.0), score=45), "Score fell to 45, under 50")
        self.assertEqual(self.fired(position(peak_mode=90.0), score=70), "Score fell 20 points from its best of 90")
        self.s["mode.score_drop_points"] = 0
        self.s["mode.score_sell_below"] = 0
        self.assertIsNone(self.fired(position(peak_mode=90.0), score=10))

    def test_quality_mode_sells(self) -> None:
        self.s["mode.pick_by"] = "quality"
        held = position(peak_mode=95.0, entry={"mode": "quality", "failedLabels": ["Fees"]})
        self.assertIsNone(self.fired(held, score=5, quality={"score": 90, "checks": [{"label": "Fees", "status": "fail"}]}))
        self.assertEqual(self.fired(held, quality={"score": 40, "checks": []}), "Quality score fell to 40, under 50")
        self.assertEqual(self.fired(held, quality={"score": 75, "checks": []}), "Quality score fell 20 points from its best of 95")
        bundled = {"score": 90, "checks": [{"label": "Fees", "status": "fail"}, {"label": "Bundlers", "status": "fail"}]}
        self.assertEqual(self.fired(held, quality=bundled), "Quality check failed: Bundlers")
        self.s["mode.quality_sell_on_new_fail"] = False
        self.assertIsNone(self.fired(held, quality=bundled))

    def test_a_position_keeps_the_mode_it_was_bought_in(self) -> None:
        held = position(peak_mode=90.0, entry={"mode": "quality"})
        self.assertIsNone(self.fired(held, score=5, quality={"score": 90, "checks": []}))
        self.s["mode.pick_by"] = "quality"
        old = position(peak_mode=90.0, entry={"mode": "score"})
        self.assertEqual(self.fired(old, score=45, quality={"score": 90, "checks": []}), "Score fell to 45, under 50")


    def test_dex_mode_buys_on_the_dexscreener_score(self) -> None:
        self.s["mode.pick_by"] = "dex"
        self.assertEqual(self.block(), "no DexScreener score yet")
        self.assertIn("DexScreener score 50 under 55", self.block(dex={"score": 50}) or "")
        self.assertIsNone(self.block(score=10, viewers=None, viewersPerMin=None, dex={"score": 70}))
        self.s["mode.dex_skip_viewers"] = False
        self.assertIn("viewers", self.block(viewers=None, dex={"score": 70}) or "")
        self.assertEqual(strategy.confirm_pulls(self.s), 1)

    def test_blend_mode_averages_both_scores(self) -> None:
        self.s["mode.pick_by"] = "blend"
        self.assertIn("blended score 60 under 65", self.block(score=80, dex={"score": 40}) or "")
        self.assertIsNone(self.block(score=80, dex={"score": 60}))
        self.assertIsNone(self.block(score=70))

    def test_dex_buys_get_out_quickly(self) -> None:
        quick = position(peak_mode=80.0, entry={"mode": "dex"})
        self.assertEqual(self.fired(quick, dex={"score": 80}, priceUsd=1), None)
        self.assertEqual(strategy.exit_signal(position(last_price=0.89, entry={"mode": "dex"}), Coin.from_token(token(dex={"score": 80})), self.s, 60_000).reason, "Stop loss")
        self.assertIsNone(strategy.exit_signal(position(last_price=0.89, entry={"mode": "score"}), Coin.from_token(token()), self.s, 60_000))
        target = strategy.exit_signal(position(last_price=1.26, peak_price=1.26, entry={"mode": "dex"}), Coin.from_token(token(dex={"score": 80})), self.s, 60_000)
        self.assertEqual((target.reason, target.share), ("Profit target", 0.75))
        late = strategy.exit_signal(position(last_price=1.03, peak_price=1.03, last_price_at=11 * 60_000, entry={"mode": "dex"}), Coin.from_token(token(dex={"score": 80})), self.s, 11 * 60_000)
        self.assertEqual(late.reason, "Held too long")
        self.assertEqual(self.fired(position(peak_mode=85.0, entry={"mode": "dex"}), dex={"score": 25}), "DexScreener score fell to 25, under 30")
        self.s["mode.dex_quick_exits"] = False
        self.assertIsNone(strategy.exit_signal(position(last_price=0.89, entry={"mode": "dex"}), Coin.from_token(token(dex={"score": 80})), self.s, 60_000))


class EngineModeTests(unittest.TestCase):
    def test_quality_mode_buys_by_quality_and_remembers_its_mode(self) -> None:
        bot = Harness(**{"mode.pick_by": "quality", "risk.max_open_positions": 1})
        bot.pull(token("Low", score=99, quality={"score": 75, "checks": []}), token("High", score=10, quality={"score": 95, "checks": []}))
        self.assertEqual([held.mint for held in bot.engine.positions], ["High"])
        held = bot.engine.positions[0]
        self.assertEqual(held.entry["mode"], "quality")
        self.assertEqual(held.peak_mode, 95)
        bot.close()

    def test_score_trend_comes_from_the_bots_own_pulls(self) -> None:
        bot = Harness(**{"mode.score_trend": "rising", "entry.confirm_pulls": 1})
        bot.pull(token(score=80))
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("climb", bot.engine.candidates[0]["reason"])
        bot.pull(token(score=79), seconds=20)
        self.assertEqual(bot.engine.positions, [])
        bot.pull(token(score=84), seconds=20)
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_score_drop_from_its_best_sells(self) -> None:
        bot = Harness(**{"exit.trailing_stop_pct": 0, "exit.stall_minutes": 0})
        bot.pull(token(score=80))
        bot.pull(token(score=92))
        self.assertEqual(bot.engine.positions[0].peak_mode, 92)
        bot.pull(token(score=71))
        self.assertEqual(bot.engine.positions, [])
        reason = bot.ledger.db.execute("SELECT exit_reason FROM positions").fetchone()["exit_reason"]
        self.assertEqual(reason, "Score fell 21 points from its best of 92")
        bot.close()

    def test_dex_mode_buys_on_the_first_pull_without_viewers(self) -> None:
        bot = Harness(**{"mode.pick_by": "dex", "risk.max_open_positions": 1})
        bot.pull(token("Slow", score=95, viewers=None, dex={"score": 50}), token("Fast", score=5, viewers=None, viewersPerMin=None, dex={"score": 82}))
        self.assertEqual([held.mint for held in bot.engine.positions], ["Fast"])
        held = bot.engine.positions[0]
        self.assertEqual(held.entry["mode"], "dex")
        self.assertEqual(held.peak_mode, 82)
        bot.close()

    def test_an_old_account_gets_the_peak_column(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "old.db"
            first = Ledger(path)
            first.db.execute("ALTER TABLE positions DROP COLUMN peak_mode")
            first.close()
            again = Ledger(path)
            columns = {row["name"] for row in again.db.execute("PRAGMA table_info(positions)")}
            again.close()
            self.assertIn("peak_mode", columns)


class EngineTests(unittest.TestCase):
    def test_buys_after_the_coin_passes_enough_pulls_in_a_row(self) -> None:
        bot = Harness(**{"entry.confirm_pulls": 2})
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("confirming", bot.engine.candidates[0]["reason"])
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        held = bot.engine.positions[0]
        self.assertAlmostEqual(held.cost, 1000 * 0.03 * (0.5 + 1 / 3))
        self.assertAlmostEqual(bot.ledger.cash, 1000 - held.cost)
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
        self.assertGreater(held.proceeds, held.cost * 0.6)
        bot.pull(token(priceUsd=0.00099))
        self.assertEqual(bot.engine.positions, [])
        trade = bot.engine.trade_rows()[0]
        self.assertEqual(trade["reason"], "Back to entry after target")
        self.assertGreater(trade["pnl"], 0)
        self.assertAlmostEqual(bot.ledger.cash, 1000 + trade["pnl"], places=1)
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
        bot = Harness(**{"risk.loss_streak": 2, "entry.cooldown_minutes": 0, "entry.max_buys_per_coin": 9, "risk.daily_loss_limit_pct": 0, "entry.rebuy_above_high": False})
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

    def test_radar_exit_advice_sells_and_blocks_the_rebuy(self) -> None:
        bot = Harness(**{"entry.cooldown_minutes": 0, "entry.max_buys_per_coin": 9, "costs.stop_slippage_pct": 5})
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)
        bot.pull(token(priceUsd=0.00105, advice={"exit": "exit", "rebuy": "never", "exitReasons": ["Viewers fell 25% in 2 minutes"], "highPrice": 0.0011}))
        self.assertEqual(bot.engine.positions, [])
        trade = bot.engine.trade_rows()[0]
        self.assertEqual(trade["reason"], "Radar says exit: Viewers fell 25% in 2 minutes")
        self.assertLess(trade["pnlPct"], -4)
        bot.pull(token(priceUsd=0.00105, advice={"exit": "hold", "rebuy": "never", "rebuyReasons": ["It crashed"]}))
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.candidates[0]["reason"], "Radar says never rebuy: It crashed")
        bot.pull(token(priceUsd=0.00108, advice={"exit": "hold", "rebuy": "ok"}))
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.candidates[0]["reason"], "still below its high from when the bot sold it")
        bot.pull(token(priceUsd=0.00112, advice={"exit": "hold", "rebuy": "ok"}))
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_a_held_coin_that_leaves_the_radar_goes_on_a_tight_stop(self) -> None:
        bot = Harness()
        bot.pull(token("MintA"), token("MintB", score=50))
        self.assertEqual([held.mint for held in bot.engine.positions], ["MintA"])
        bot.quotes["MintA"] = Quote(0.00108, 60_000.0)
        bot.pull(token("MintB", score=50))
        self.assertEqual(bot.engine.position_rows()[0]["advice"], "left")
        self.assertEqual(len(bot.engine.positions), 1)
        bot.quotes["MintA"] = Quote(0.00096, 60_000.0)
        bot.pull(token("MintB", score=50))
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.trade_rows()[0]["reason"], "Tightened trailing stop. Left the Radar")
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
