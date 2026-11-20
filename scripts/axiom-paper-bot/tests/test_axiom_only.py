from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper import sources
from axiom_paper.engine import Engine
from axiom_paper.ledger import Ledger
from test_bot import Clock, FakeSite


class AxiomOnlyTest(unittest.TestCase):
    def test_sol_price_comes_from_the_feed(self) -> None:
        self.assertEqual(sources.sol_from_payload({"solUsd": 70.5}), 70.5)
        self.assertEqual(sources.sol_from_payload({"tokens": [{"wallets": {"solUsd": None}}, {"wallets": {"solUsd": 68.0}}]}), 68.0)
        self.assertIsNone(sources.sol_from_payload({"tokens": [{"wallets": {}}]}))
        self.assertIsNone(sources.sol_from_payload(None))

    def test_engine_asks_no_other_site(self) -> None:
        asked: list[str] = []
        with tempfile.TemporaryDirectory() as folder:
            ledger = Ledger(Path(folder) / "paper.db")
            try:
                clock = Clock()
                engine = Engine(ledger, FakeSite(clock), None, price_source=lambda wanted: asked.append("prices") or {}, fee_source=lambda: asked.append("fees"), clock=clock, axiom_only=True)
                self.assertFalse(engine.rules["verify.enabled"])
                self.assertFalse(engine.rules["bot.live_prices"])
                engine.refresh_market()
                self.assertEqual(asked, [])
                self.assertGreater(engine.sol_usd or 0, 0)
            finally:
                ledger.close()


if __name__ == "__main__":
    unittest.main()
