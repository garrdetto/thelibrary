"""The last look at the chart before a buy. Run with the other bot tests."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper import rules
from axiom_paper import settings as dials
from axiom_paper import strategy
from axiom_paper.models import Coin
from axiom_paper.prices import Quote
from test_bot import Harness, token

NOW = 1_800_000_000_000
CHECKING = {"verify.enabled": True, "entry.signal": "any", "entry.radar_advice": "never_only"}


def fresh(**changes: Any) -> dict[str, Any]:
    """A coin with holder figures read a few seconds ago and a chart that has not dumped."""
    base = token(
        holderTraits={"holders": 600, "checkedAt": NOW - 5_000}, pulse={"holders": 610, "seenAt": NOW - 3_000},
        gains={"holders": {"m1": 12}}, history=[{"t": NOW - 120_000, "priceUsd": 0.00095}, {"t": NOW - 60_000, "priceUsd": 0.001}],
        spark={"slow": [0.0009, 0.00098, 0.001], "fast": [0.001]},
    )
    base.update(changes)
    return base


def live(price: float = 0.001, **changes: Any) -> Quote:
    values: dict[str, Any] = {"liquidity": 60_000.0, "volume_5m": 15_000.0, "buys_5m": 300, "sells_5m": 200}
    values.update(changes)
    return Quote(price, **values)


class ChartCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s = rules.normalize({**rules.defaults(), **CHECKING})

    def check(self, quote: Quote | None = None, **changes: Any) -> str | None:
        return strategy.verify_block(Coin.from_token(fresh(**changes)), live() if quote is None else quote, self.s, NOW, 1.0)

    def test_a_clean_coin_passes(self) -> None:
        self.assertIsNone(self.check())

    def test_no_live_price_means_no_buy(self) -> None:
        self.assertEqual(strategy.verify_block(Coin.from_token(fresh()), None, self.s, NOW, 1.0), "could not confirm the live price")

    def test_a_coin_already_dumped_from_its_high_is_skipped(self) -> None:
        dumped = [{"t": NOW - 300_000, "priceUsd": 0.002}, {"t": NOW - 60_000, "priceUsd": 0.001}]
        self.assertEqual(self.check(history=dumped), "already dumped 50% from its 10-minute high")

    def test_a_high_older_than_ten_minutes_does_not_count(self) -> None:
        old = [{"t": NOW - 900_000, "priceUsd": 0.002}, {"t": NOW - 60_000, "priceUsd": 0.001}]
        self.assertIsNone(self.check(history=old, spark={}))

    def test_a_price_that_fell_since_the_radar_reading_is_skipped(self) -> None:
        self.assertEqual(self.check(live(0.00085)), "price fell 15% since the Radar reading")

    def test_a_dump_in_the_last_30_seconds_is_skipped(self) -> None:
        self.assertEqual(self.check(priceChange={"s30": -12, "m1": 3, "m5": 9}), "dropped 12% in the last 30 seconds")

    def test_stale_or_missing_holder_figures_are_skipped(self) -> None:
        self.assertEqual(self.check(holderTraits={"checkedAt": NOW - 400_000}, pulse={"seenAt": NOW - 300_000}), "holder figures are 300s old")
        self.assertEqual(self.check(holderTraits=None, pulse=None), "no holder figures yet")

    def test_falling_holders_are_skipped(self) -> None:
        self.assertEqual(self.check(gains={"holders": {"m1": -9}}), "holders are falling (-9 in the last minute)")

    def test_live_volume_buys_and_liquidity_must_still_meet_the_limits(self) -> None:
        self.assertEqual(self.check(live(volume_5m=1_000.0)), "live 5m volume $1,000 under $3,000")
        self.assertEqual(self.check(live(buys_5m=100, sells_5m=300)), "live buy share 25% under 50%")
        self.assertEqual(self.check(live(liquidity=2_000.0)), "live liquidity $2,000 under $8,000")

    def test_turning_it_off_skips_every_check(self) -> None:
        self.s = rules.normalize({**self.s, "verify.enabled": False})
        self.assertIsNone(strategy.verify_block(Coin.from_token(fresh()), None, self.s, NOW, 1.0))


class ScoreThresholdTests(unittest.TestCase):
    """A coin at the buy score is bought on the defaults even when the Radar has not called it a buy."""

    def run_bot(self, quote: Quote | None, **changes: Any) -> Harness:
        bot = Harness(**CHECKING)
        bot.clock.t = NOW / 1000 - 5
        if quote is not None:
            bot.quotes["MintA"] = quote
        bot.pull(fresh(signal=None, priceChange={"s30": 0, "m1": 1, "m5": 4}, **changes))
        return bot

    def test_the_defaults_no_longer_need_the_radars_own_buy_call(self) -> None:
        defaults = rules.expand(dials.defaults())
        self.assertEqual((defaults["entry.signal"], defaults["entry.radar_advice"], defaults["learned.skip_phase"], defaults["verify.enabled"]), ("any", "never_only", "none", True))

    def test_a_coin_over_the_threshold_with_a_clean_chart_is_bought(self) -> None:
        bot = self.run_bot(live())
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_a_dumped_coin_over_the_threshold_is_not_bought_and_the_reason_is_logged_once(self) -> None:
        dumped = [{"t": NOW - 200_000, "priceUsd": 0.003}, {"t": NOW - 60_000, "priceUsd": 0.001}]
        bot = self.run_bot(live(), history=dumped)
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("chart check: already dumped 67% from its 10-minute high", bot.engine.candidates[0]["reason"])
        bot.pull(fresh(signal=None, history=dumped))
        skips = [event for event in bot.ledger.events() if event["kind"] == "skip"]
        self.assertEqual(len(skips), 1)
        bot.close()

    def test_no_live_price_means_no_buy(self) -> None:
        bot = self.run_bot(None)
        self.assertEqual(bot.engine.positions, [])
        bot.close()


if __name__ == "__main__":
    unittest.main()
