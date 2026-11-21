from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from axiom_paper.learner import FEATURES, features
from axiom_paper.models import Coin


class LearnMetricsTest(unittest.TestCase):
    def test_no_time_of_day_and_holder_shares_are_learned(self) -> None:
        self.assertNotIn("hour", FEATURES)
        token = {"mint": "m", "symbol": "M", "score": 70, "priceUsd": 1.0, "holderTraits": {"top10": 33, "bundlers": 2, "proTraders": 18, "snipers": 7, "insiders": 1, "dev": 0.5, "fresh": 20}, "holdersPerMin": 12}
        bands = features(Coin.from_token(token, 1.0), 70, 0)
        self.assertEqual(bands["top10"], "top 10 holders own 30–45%")
        self.assertEqual(bands["bundlers"], "bundlers hold under 5%")
        self.assertEqual(bands["protraders"], "pro traders hold 15–30%")
        self.assertEqual(bands["snipers"], "snipers hold 5–15%")
        self.assertEqual(bands["devhold"], "the dev holds under 1%")
        self.assertEqual(bands["freshwallets"], "fresh wallets hold over 15%")
        self.assertEqual(bands["holdrate"], "5–20 new holders a minute")


if __name__ == "__main__":
    unittest.main()
