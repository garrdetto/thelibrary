"""Learning from bad buys (review.py), the Wallet Score rule, and the volume and liquidity trends the bot reads itself.
Run with: python -m unittest discover -s scripts/axiom-paper-bot/tests"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper.learner import features
from axiom_paper.models import Coin
from axiom_paper.review import MIN_TRADES, Reviewer, mistakes_in
from test_bot import position, token
from test_simple import SimpleHarness

WALLETS = {"score": 22, "whales": 0, "goodWhales": 0, "badWhales": 4, "smartUsd": None, "summary": "4 tied to coins that died"}


def facts(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "gain1m": 3, "gain5m": 9, "phase": "running", "belowHighPct": 8, "volumeTrend": 5, "liquidityTrend": 0,
        "liquidity": 40_000, "marketCap": 150_000, "volume5m": 60_000, "buySharePct": 62, "walletScore": 60, "whales": 2,
    }
    base.update(changes)
    return base


def closed(pid: int, pnl_pct: float, entry: dict[str, Any], peak: float = 1.0, closed_at: int = 1_000_000, **changes: Any):
    cost = 100.0
    return position(id=pid, status="closed", opened_at=closed_at - 60_000, closed_at=closed_at, cost=cost, proceeds=cost * (1 + pnl_pct / 100), peak_price=peak, exit_reason="Stop loss", entry=entry, **changes)


class MistakeTagTests(unittest.TestCase):
    def test_a_clean_buy_has_no_mistakes(self) -> None:
        self.assertEqual(mistakes_in(facts()), [])

    def test_each_mistake_is_read_from_the_facts_at_the_buy(self) -> None:
        tags = mistakes_in(facts(gain1m=44, gain5m=90, belowHighPct=1, volumeTrend=-30, liquidityTrend=-8, liquidity=15_000, volume5m=20_000, buySharePct=51, walletScore=21, whales=0))
        self.assertEqual(tags, ["chased_spike", "late_run", "at_high", "fading_volume", "liquidity_pulled", "thin_liquidity", "quiet_trading", "sellers_even", "weak_holders", "no_whales"])

    def test_missing_facts_never_count_as_a_mistake(self) -> None:
        self.assertEqual(mistakes_in({"gain1m": None, "phase": None}), [])


class ReviewerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.reviewer = Reviewer(sqlite3.connect(":memory:"))

    def test_a_loss_says_why_in_plain_words(self) -> None:
        text = self.reviewer.review(closed(1, -25, facts(gain1m=44, volumeTrend=-30), peak=1.01))
        self.assertIn("Why MINTA lost -25%", text or "")
        self.assertIn("never rose more than 1% after the buy, so it was bought at the top", text or "")
        self.assertIn("bought right after a +44% minute", text or "")
        self.assertIn("5-minute volume was shrinking (-30% over the last minute)", text or "")

    def test_a_mistake_that_keeps_losing_blocks_coins_that_would_repeat_it(self) -> None:
        for index in range(MIN_TRADES):
            self.reviewer.review(closed(index + 1, -15, facts(gain1m=30 + index), closed_at=1_000_000 + index))
        blocked = self.reviewer.check(facts(gain1m=35), 1_100_000)
        self.assertIsNotNone(blocked)
        self.assertIn("learned from bad buys: bought right after a +35% minute", blocked or "")
        self.assertIn(f"{MIN_TRADES} of {MIN_TRADES} such buys lost", blocked or "")
        self.assertIsNone(self.reviewer.check(facts(gain1m=5), 1_100_000))

    def test_a_mistake_that_still_pays_is_not_a_lesson(self) -> None:
        for index in range(MIN_TRADES):
            self.reviewer.review(closed(index + 1, -15 if index < 2 else 30, facts(gain1m=30), closed_at=1_000_000 + index))
        self.assertIsNone(self.reviewer.check(facts(gain1m=30), 1_100_000))

    def test_too_few_trades_teach_nothing(self) -> None:
        for index in range(MIN_TRADES - 1):
            self.reviewer.review(closed(index + 1, -20, facts(walletScore=20), closed_at=1_000_000 + index))
        self.assertIsNone(self.reviewer.check(facts(walletScore=20), 1_100_000))

    def test_old_trades_are_reviewed_once(self) -> None:
        trades = [closed(index + 1, -10, facts(gain5m=120)) for index in range(3)] + [closed(9, -10, {"score": 70})]
        self.assertEqual(self.reviewer.backfill(trades), 3)
        self.assertEqual(self.reviewer.backfill(trades), 0)
        self.assertEqual(self.reviewer.summary(True)["reviewed"], 3)


class WalletAndTrendTests(unittest.TestCase):
    def test_the_coin_reads_the_wallet_score(self) -> None:
        coin = Coin.from_token(token(wallets=WALLETS))
        self.assertEqual((coin.wallet_score, coin.whales, coin.bad_whales), (22, 0, 4))
        self.assertEqual(coin.entry_facts()["walletScore"], 22)
        self.assertEqual(features(coin, 80, 0)["wallets"], "a Wallet Score under 35")

    def test_a_low_wallet_score_is_not_bought(self) -> None:
        bot = SimpleHarness(**{"buy.min_wallet_score": 35})
        self.addCleanup(bot.close)
        bot.pull(token(wallets=WALLETS))
        self.assertEqual(bot.engine.positions, [])
        self.assertTrue(any("Wallet Score 22 under 35" in (row["reason"] or "") for row in bot.engine.candidates))
        bot.pull(token(wallets={**WALLETS, "score": 70}))
        self.assertEqual(len(bot.engine.positions), 1)
        self.assertEqual(bot.engine.positions[0].entry["walletScore"], 70)

    def test_coins_without_a_wallet_score_still_pass(self) -> None:
        bot = SimpleHarness(**{"buy.min_wallet_score": 35})
        self.addCleanup(bot.close)
        bot.pull(token())
        self.assertEqual(len(bot.engine.positions), 1)

    def test_volume_and_liquidity_trends_come_from_the_bot_s_own_pulls(self) -> None:
        bot = SimpleHarness(**{"bot.enabled": False})
        self.addCleanup(bot.close)
        for second in range(0, 125, 5):
            bot.pull(token(volume5m=20_000 - second * 100, liquidityUsd=60_000 - second * 50))
        market = bot.engine.market("MintA")
        self.assertAlmostEqual(market["volume_trend"] or 0, -42.9, delta=1)
        self.assertAlmostEqual(market["liquidity_trend"] or 0, -10.0, delta=1)

    def test_a_losing_trade_writes_its_review_to_the_log(self) -> None:
        bot = SimpleHarness(**{"sell.stop_loss_pct": 20, "buy.min_wallet_score": 0})
        self.addCleanup(bot.close)
        bot.pull(token(priceUsd=1.0, priceChange={"s30": 1, "m1": 40, "m5": 60}))
        self.assertEqual(len(bot.engine.positions), 1)
        for _ in range(6):
            bot.pull(token(priceUsd=0.7, priceChange={"s30": -10, "m1": -30, "m5": -10}))
        self.assertEqual(bot.engine.positions, [])
        lessons = [event["text"] for event in bot.ledger.events(20) if event["kind"] == "learn"]
        self.assertTrue(any("bought right after a +40% minute" in text for text in lessons), lessons)
        self.assertEqual(bot.engine.report()["learning"]["mistakes"]["reviewed"], 1)


if __name__ == "__main__":
    unittest.main()
