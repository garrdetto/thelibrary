from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper import rules, settings as dials
from test_bot import Harness, token


class RebuyTest(unittest.TestCase):
    def test_dial_reaches_the_rules(self) -> None:
        self.assertEqual(rules.expand({**dials.defaults(), "buy.rebuy_gain_1m_pct": 7})["entry.rebuy_gain_1m_pct"], 7)
        self.assertEqual(rules.expand(dials.defaults())["entry.rebuy_gain_1m_pct"], 5)

    def test_volume_minimum_is_its_own_dial(self) -> None:
        for picky in ("strict", "normal", "loose"):
            self.assertEqual(rules.expand({**dials.defaults(), "buy.picky": picky})["entry.min_volume_5m_usd"], 1000)
        self.assertEqual(rules.expand({**dials.defaults(), "buy.min_volume_5m_usd": 2500})["entry.min_volume_5m_usd"], 2500)

    def test_a_traded_coin_is_bought_again_only_while_up_5_percent_in_a_minute(self) -> None:
        bot = Harness(**{"entry.rebuy_gain_1m_pct": 5})
        bot.pull(token("MintA"))
        self.assertEqual(len(bot.engine.positions), 1)
        bot.engine.flatten("Test")
        bot.pull(token("MintA", priceChange={"s30": 1, "m1": 2, "m5": 10}))
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("last minute", bot.engine.candidates[0]["reason"])
        bot.pull(token("MintA", priceChange={"s30": 3, "m1": 6, "m5": 10}))
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()


if __name__ == "__main__":
    unittest.main()
