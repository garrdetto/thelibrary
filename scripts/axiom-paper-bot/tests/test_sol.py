"""Run with: python -m unittest discover -s scripts/axiom-paper-bot/tests"""

from __future__ import annotations

import contextlib
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper import cli, dashboard, fees, money
from axiom_paper import settings as dials
from axiom_paper.engine import Engine
from axiom_paper.ledger import Ledger
from axiom_paper.prices import SOL_MINT, Quote
from test_bot import Clock, FakeSite, Harness, token

REAL_FEES = {"costs.priority_fee_sol": 0.001, "costs.bribe_sol": 0.001}
FIXED = {"risk.buy_mode": "fixed", "risk.buy_amount_sol": 0.25, "risk.min_position_sol": 0.02, "account.starting_sol": 10, **REAL_FEES}
LEVELS = fees.FeeLevels({"low": 1e-5, "normal": 5e-5, "high": 1e-3}, {"low": 1e-5, "normal": 2e-4, "high": 2e-3})

LEGACY_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, symbol TEXT NOT NULL, pair TEXT,
  opened_at INTEGER NOT NULL, entry_spot REAL NOT NULL, entry_price REAL NOT NULL, qty REAL NOT NULL, qty_open REAL NOT NULL,
  cost_usd REAL NOT NULL, proceeds_usd REAL NOT NULL DEFAULT 0, fees_usd REAL NOT NULL DEFAULT 0,
  entry_liquidity REAL, last_liquidity REAL, peak_price REAL NOT NULL, peak_viewers REAL,
  last_price REAL NOT NULL, last_price_at INTEGER NOT NULL, target_done INTEGER NOT NULL DEFAULT 0, score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', closed_at INTEGER, exit_reason TEXT, exit_high REAL, entry_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL, at INTEGER NOT NULL, side TEXT NOT NULL,
  spot REAL NOT NULL, price REAL NOT NULL, qty REAL NOT NULL, gross_usd REAL NOT NULL, fee_usd REAL NOT NULL, net_usd REAL NOT NULL,
  impact_pct REAL NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE equity (t INTEGER PRIMARY KEY NOT NULL, equity REAL NOT NULL, cash REAL NOT NULL);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
INSERT INTO meta (key, value) VALUES ('starting_cash', '1000'), ('cash', '900'), ('peak_equity', '1000');
INSERT INTO positions (mint, symbol, opened_at, entry_spot, entry_price, qty, qty_open, cost_usd, fees_usd, entry_liquidity, last_liquidity, peak_price, last_price, last_price_at)
  VALUES ('MintA', 'MINTA', 1800000000000, 0.001, 0.00102, 98000, 98000, 100, 1.2, 60000, 60000, 0.001, 0.001, 1800000000000);
INSERT INTO fills (position_id, at, side, spot, price, qty, gross_usd, fee_usd, net_usd, impact_pct, reason) VALUES (1, 1, 'buy', 0.001, 0.00102, 98000, 98.8, 1.2, 100, 0.3, 'Buy');
INSERT INTO equity (t, equity, cash) VALUES (1, 1000, 900);
"""


class MoneyTests(unittest.TestCase):
    def test_sol_comes_first_with_dollars_in_brackets(self) -> None:
        self.assertEqual(money.sol(0.25), "0.2500 SOL")
        self.assertEqual(money.sol(13.871), "13.871 SOL")
        self.assertEqual(money.sol(1234.5), "1,234.50 SOL")
        self.assertEqual(money.both(0.25, 72), "0.2500 SOL ($18.00)")
        self.assertEqual(money.both(1, None), "1.000 SOL")
        self.assertEqual(money.signed(-0.01, 100), "-0.0100 SOL ($1.00)")
        self.assertEqual(money.signed(0.5, 100), "+0.5000 SOL ($50.00)")
        self.assertEqual(money.small_sol(0.000305), "0.000305 SOL")
        self.assertEqual(money.small_sol(0), "0 SOL")


class FeeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s = dials.normalize({**dials.defaults(), "costs.fee_mode": "manual", "costs.priority_fee_sol": 0.001, "costs.bribe_sol": 0.002})

    def test_your_own_fees_are_used_as_set(self) -> None:
        quote = fees.quote(self.s, LEVELS)
        self.assertEqual((quote.priority, quote.bribe, quote.source), (0.001, 0.002, "manual"))
        self.assertAlmostEqual(quote.total, 0.003005)

    def test_auto_fee_follows_the_network_at_the_chosen_speed(self) -> None:
        self.s["costs.fee_mode"] = "auto"
        normal = fees.quote(self.s, LEVELS)
        self.assertEqual((normal.priority, normal.bribe, normal.source), (5e-5, 2e-4, "auto"))
        self.s["costs.auto_fee_level"] = "low"
        self.assertAlmostEqual(fees.quote(self.s, LEVELS).total, 2e-5 + fees.BASE_FEE)

    def test_auto_fee_never_pays_more_than_the_max_fee(self) -> None:
        self.s.update({"costs.fee_mode": "auto", "costs.auto_fee_level": "high", "costs.max_fee_sol": 0.0015})
        quote = fees.quote(self.s, LEVELS)
        self.assertAlmostEqual(quote.priority + quote.bribe, 0.0015)
        self.assertAlmostEqual(quote.bribe / quote.priority, 2.0)

    def test_auto_fee_without_live_data_falls_back_to_your_own_fees(self) -> None:
        self.s["costs.fee_mode"] = "auto"
        quote = fees.quote(self.s, None)
        self.assertEqual((quote.priority, quote.bribe), (0.001, 0.002))
        self.assertIn("no live data", quote.source)

    def test_live_levels_are_read_from_jito_and_solana(self) -> None:
        tips = [{"landed_tips_75th_percentile": 1.4e-5, "landed_tips_95th_percentile": 2.4e-4, "landed_tips_99th_percentile": 2.4e-3}]
        slots = {"result": [{"prioritizationFee": fee} for fee in (0, 0, 0, 0, 0, 100_000, 200_000, 300_000, 400_000, 5_000_000)]}

        def answers(url: str, body: Any, timeout: float) -> Any:
            return tips if url == fees.JITO_TIPS else slots

        with mock.patch.object(fees, "_json", answers):
            levels = fees.fetch_levels()
        assert levels is not None
        self.assertEqual(levels.bribe, {"low": 1.4e-5, "normal": 2.4e-4, "high": 2.4e-3})
        self.assertAlmostEqual(levels.priority["low"], 100_000 * 200_000 / 1e15)
        self.assertAlmostEqual(levels.priority["normal"], 5_000_000 * 200_000 / 1e15)

        def only_jito(url: str, body: Any, timeout: float) -> Any:
            if url != fees.JITO_TIPS:
                raise OSError("down")
            return tips

        with mock.patch.object(fees, "_json", only_jito):
            partial = fees.fetch_levels()
        assert partial is not None
        self.assertEqual(partial.priority, {"low": 0.0, "normal": 0.0, "high": 0.0})
        with mock.patch.object(fees, "_json", mock.Mock(side_effect=OSError("down"))):
            self.assertIsNone(fees.fetch_levels())


class SolAccountTests(unittest.TestCase):
    def test_buys_are_in_sol_and_the_report_carries_both_units(self) -> None:
        bot = Harness(**FIXED)
        bot.quotes[SOL_MINT] = Quote(100.0, None)
        bot.pull(token())
        held = bot.engine.positions[0]
        self.assertAlmostEqual(held.cost, 0.25)
        self.assertAlmostEqual(held.entry_spot, 0.001 / 100)
        self.assertAlmostEqual(held.entry_liquidity or 0, 600.0)
        self.assertAlmostEqual(held.fees, 0.25 * 0.01 + 0.002005)
        self.assertAlmostEqual(bot.ledger.cash, 9.75)
        bot.tick()
        report = [body["report"] for body in bot.site.bodies if "report" in body][-1]
        self.assertEqual(report["solUsd"], 100.0)
        self.assertEqual((report["positions"][0]["costSol"], report["positions"][0]["costUsd"]), (0.25, 25.0))
        self.assertAlmostEqual(report["positions"][0]["entryPrice"], 0.001)
        self.assertEqual((report["accountSol"]["cash"], report["account"]["cash"]), (9.75, 975.0))
        self.assertEqual(report["fees"]["source"], "manual")
        self.assertAlmostEqual(report["fees"]["totalSol"], 0.002005)
        self.assertIn("sol", report["equity"][-1])
        bot.close()

    def test_a_coin_flat_in_dollars_loses_sol_value_when_sol_rises(self) -> None:
        bot = Harness(**FIXED)
        bot.quotes[SOL_MINT] = Quote(100.0, None)
        bot.pull(token())
        bot.quotes[SOL_MINT] = Quote(200.0, None)
        bot.tick(seconds=31)
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        trade = bot.engine.trade_rows()[0]
        self.assertEqual(trade["reason"], "Stop loss")
        self.assertLess(trade["pnlPct"], -45)
        bot.close()

    def test_nothing_is_bought_until_the_sol_price_is_known(self) -> None:
        bot = Harness(**FIXED)
        del bot.quotes[SOL_MINT]
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        self.assertEqual(bot.engine.buy_block, "Waiting for the SOL price")
        bot.quotes[SOL_MINT] = Quote(100.0, None)
        bot.tick(seconds=31)
        self.assertEqual(len(bot.engine.positions), 1)
        bot.close()

    def test_fixed_buy_amount_and_the_most_sol_in_one_coin(self) -> None:
        bot = Harness(**{**FIXED, "risk.max_per_coin_sol": 0.4, "entry.cooldown_minutes": 0, "entry.max_buys_per_coin": 9, "entry.rebuy_above_high": False})
        bot.pull(token())
        self.assertAlmostEqual(bot.engine.positions[0].cost, 0.25)
        self.assertEqual(bot.engine.positions[0].entry["sizeLimit"], "buy amount")
        bot.engine.flatten("Test")
        bot.pull(token())
        self.assertAlmostEqual(bot.engine.positions[0].cost, 0.15)
        self.assertEqual(bot.engine.positions[0].entry["sizeLimit"], "most SOL in one coin")
        bot.engine.flatten("Test")
        bot.pull(token())
        self.assertEqual(bot.engine.positions, [])
        self.assertIn("too small (most SOL in one coin)", bot.engine.candidates[0]["reason"])
        bot.close()

    def test_auto_fee_is_what_a_buy_pays(self) -> None:
        bot = Harness(**{**FIXED, "costs.fee_mode": "auto"})
        bot.fee_levels = LEVELS
        bot.pull(token())
        held = bot.engine.positions[0]
        self.assertAlmostEqual(held.fees, 0.25 * 0.01 + 5e-5 + 2e-4 + fees.BASE_FEE)
        self.assertEqual(bot.engine.fee().source, "auto")
        self.assertIn("network fee 0.000255 SOL, auto", bot.ledger.events(1)[0]["text"])
        bot.close()

    def test_the_terminal_view_and_status_show_sol_with_dollars(self) -> None:
        bot = Harness(**FIXED)
        bot.quotes[SOL_MINT] = Quote(100.0, None)
        bot.pull(token())
        screen = "\n".join("".join(text for text, _ in line) for line in dashboard.build(bot.engine, "paper-bot.toml", True))
        self.assertIn("SOL ($", screen)
        self.assertIn("0.2500 SOL a buy", screen)
        self.assertIn("Network fee 0.002005 SOL a trade", screen)
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            cli.print_account(bot.engine)
        self.assertIn("cost 0.2500 SOL ($25.00)", printed.getvalue())
        self.assertIn("Account 9.986 SOL ($998.58)", printed.getvalue())
        bot.close()


class ConversionTests(unittest.TestCase):
    def test_an_account_kept_in_dollars_is_converted_once(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / "paper.db"
            settings = Path(folder) / "paper-bot.toml"
            settings.write_text("[account]\nstarting_cash = 1000\n\n[risk]\nstrength = 7\n", encoding="utf-8")
            legacy = sqlite3.connect(db)
            legacy.executescript(LEGACY_SCHEMA)
            legacy.commit()
            legacy.close()
            ledger = Ledger(db)
            try:
                self.assertFalse(ledger.in_sol)
                clock = Clock()
                engine = Engine(ledger, FakeSite(clock), settings, price_source=lambda wanted: {SOL_MINT: Quote(100.0, None)} if SOL_MINT in wanted else {}, fee_source=lambda: None, clock=clock)
                self.assertEqual(engine.values["risk.strength"], 7)
                clock.t += 5
                engine.step()
                self.assertTrue(ledger.in_sol)
                self.assertAlmostEqual(ledger.cash, 9.0)
                held = ledger.open_positions()[0]
                self.assertAlmostEqual(held.cost, 1.0)
                self.assertAlmostEqual(held.entry_spot, 1e-5)
                self.assertAlmostEqual(held.entry_liquidity or 0, 600.0)
                self.assertAlmostEqual(held.fees, 0.012)
                self.assertAlmostEqual(ledger.equity_curve()[0]["equity"], 10.0)
                self.assertEqual(dials.load_file(settings)["account.starting_sol"], 10)
                self.assertTrue(any("moved from dollars to SOL at $100.00" in event["text"] for event in ledger.events(10)))
                engine.step()
                self.assertAlmostEqual(ledger.cash, 9.0)
            finally:
                ledger.close()


if __name__ == "__main__":
    unittest.main()
