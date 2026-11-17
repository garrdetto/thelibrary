"""The "Check DexScreener before buying" dial."""

import unittest

from axiom_paper import rules
from axiom_paper import settings as dials


class DexCheckDial(unittest.TestCase):
    def test_on_by_default_keeps_the_live_check(self):
        values = dials.defaults()
        self.assertTrue(values["buy.dex_check"])
        expanded = rules.expand(values)
        self.assertTrue(expanded["verify.enabled"])
        self.assertTrue(expanded["bot.live_prices"])
        self.assertEqual(expanded["bot.poll_seconds"], 5)

    def test_off_trades_on_the_radar_feed_alone(self):
        for picky in ("strict", "normal", "loose"):
            expanded = rules.expand({**dials.defaults(), "buy.picky": picky, "buy.dex_check": False})
            self.assertFalse(expanded["verify.enabled"], picky)
            self.assertFalse(expanded["bot.live_prices"], picky)
            self.assertEqual(expanded["bot.poll_seconds"], 2, picky)
            self.assertEqual(expanded["entry.confirm_pulls"], 1, picky)

    def test_older_settings_files_get_the_check_on(self):
        values = dials.normalize({"buy.buy_at": 70})
        self.assertTrue(values["buy.dex_check"])


if __name__ == "__main__":
    unittest.main()
