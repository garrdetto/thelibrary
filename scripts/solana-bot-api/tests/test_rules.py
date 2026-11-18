"""
Ruleset, event decoding, live market and paper selling — against hand-built pump.fun events and a
local WebSocket. No network, nothing sent.
"""

import asyncio
import base64
import os
import struct
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("JUPITER_API_KEY", "test-key")

from solders.keypair import Keypair  # noqa: E402

import config  # noqa: E402
import executor as executor_mod  # noqa: E402
import listener  # noqa: E402
import market as market_mod  # noqa: E402
import pumpevents  # noqa: E402
import strategy  # noqa: E402
from test_bot import FakeChain, FakeLogsServer, Recorder, settings  # noqa: E402

CREATOR = Keypair().pubkey()
BUYER = Keypair().pubkey()
MINT = Keypair().pubkey()
CURVE = Keypair().pubkey()


def _s(text: str) -> bytes:
    raw = text.encode()
    return struct.pack("<I", len(raw)) + raw


def create_line(mint=MINT, creator=CREATOR, vs=30_000_000_000, vt=1_073_000_000_000_000) -> str:
    body = _s("Test Coin") + _s("TEST") + _s("ipfs://x") + bytes(mint) + bytes(CURVE) + bytes(creator) + bytes(creator)
    body += struct.pack("<qQQQQ", 1_700_000_000, vt, vs, 793_100_000_000_000, 1_000_000_000_000_000) + bytes(33)
    return "Program data: " + base64.b64encode(pumpevents.CREATE + body).decode()


class Curve:
    """A classic curve to make consistent trade events."""

    def __init__(self):
        self.vs, self.vt, self.rs = 30_000_000_000, 1_073_000_000_000_000, 0

    def trade(self, user, sol_lamports, buy=True, mint=MINT) -> str:
        k = self.vs * self.vt
        if buy:
            tok = self.vt - k // (self.vs + sol_lamports)
            self.vs += sol_lamports
            self.vt -= tok
            self.rs += sol_lamports
        else:
            tok = sol_lamports  # here: tokens to sell
            out = self.vs - k // (self.vt + tok)
            self.vs -= out
            self.vt += tok
            self.rs -= out
            sol_lamports = out
        body = bytes(mint) + struct.pack("<QQ", sol_lamports, tok) + bytes([1 if buy else 0]) + bytes(user)
        body += struct.pack("<qQQQQ", 1_700_000_000, self.vs, self.vt, self.rs, 700_000_000_000_000)
        body += bytes(32) + struct.pack("<QQ", 95, 0) + bytes(CREATOR) + struct.pack("<QQ", 30, 0)
        return "Program data: " + base64.b64encode(pumpevents.TRADE + body).decode()


class DecodeTests(unittest.TestCase):
    def test_create_and_trade_round_trip(self):
        c = pumpevents.decode_line(create_line())
        self.assertEqual((c["kind"], c["mint"], c["creator"], c["classic"]), ("create", str(MINT), str(CREATOR), True))
        variant = pumpevents.decode_line(create_line(vs=9_000_000_000))
        self.assertFalse(variant["classic"])
        t = pumpevents.decode_line(Curve().trade(BUYER, 500_000_000))
        self.assertEqual((t["kind"], t["mint"], t["user"], t["buy"], t["sol"]), ("trade", str(MINT), str(BUYER), True, 500_000_000))
        self.assertEqual(t["vs"], 30_500_000_000)
        self.assertEqual(t["creator"], str(CREATOR))

    def test_junk_lines_ignored(self):
        self.assertIsNone(pumpevents.decode_line("Program log: Instruction: Buy"))
        self.assertIsNone(pumpevents.decode_line("Program data: !!notbase64"))
        self.assertIsNone(pumpevents.decode_line("Program data: " + base64.b64encode(b"12345678short").decode()))

    def test_base58_matches_solders(self):
        for _ in range(20):
            pk = Keypair().pubkey()
            self.assertEqual(pumpevents.b58(bytes(pk)), str(pk))


def book_with(trades, create_slot=100):
    b = strategy.CoinBook("m", "dev", create_slot)
    for t in trades:
        b.add(*t)
    return b


class StrategyTests(unittest.TestCase):
    def test_features(self):
        b = book_with([
            (100, True, 1_000_000_000, 10, "dev", 31_000_000_000, 1_000, 1_000_000_000),
            (101, True, 500_000_000, 5, "a", 31_500_000_000, 990, 1_500_000_000),
            (105, True, 2_000_000_000, 20, "b", 33_500_000_000, 970, 3_500_000_000),
            (106, False, 100_000_000, 2, "a", 33_400_000_000, 972, 3_400_000_000),
            (130, False, 50_000_000, 1, "dev", 33_350_000_000, 973, 3_350_000_000),
        ])
        f = dict(zip(strategy.FEATURES, strategy.features(b, 110)))
        self.assertEqual(f["dev_buy"], 1.0)
        self.assertEqual((f["n_buy"], f["n_sell"], f["uniq"]), (2, 1, 2))
        self.assertAlmostEqual(f["raised"], 3.4)
        self.assertEqual(f["dev_sold"], 0.0)
        self.assertAlmostEqual(f["top_share"], 20 / 25)
        self.assertEqual(f["early_snipe"], 1)
        self.assertAlmostEqual(f["buy_sol"], 2.5)
        self.assertEqual(f["big_buys"], 1)
        self.assertAlmostEqual(f["quiet"], 4 * 0.4)
        self.assertEqual(strategy.features(b, 131)[strategy.FEATURES.index("dev_sold")], 1.0)
        self.assertIsNone(strategy.features(b, 99))

    def test_out_of_order_trade_is_sorted(self):
        b = book_with([(10, True, 1, 1, "a", 1, 1, 1), (12, True, 1, 1, "b", 3, 1, 3), (11, True, 1, 1, "c", 2, 1, 2)], create_slot=10)
        self.assertEqual(b.slot, [10, 11, 12])
        self.assertEqual(b.last_at(11), 1)

    def test_rules_parse_and_filters(self):
        rules = strategy.parse_rules({"name": "t", "decide_after_s": 6, "filters": [["n_buy", ">=", 2], ["top_share", "<=", 0.5]],
                                      "exit": {"tp": 0.5, "sl": 0.2, "hold_s": 30}})
        feats = [0.0] * len(strategy.FEATURES)
        feats[strategy.FEATURES.index("n_buy")] = 3
        feats[strategy.FEATURES.index("top_share")] = 0.4
        self.assertTrue(rules.passes(feats)[0])
        feats[strategy.FEATURES.index("top_share")] = 0.9
        ok, why = rules.passes(feats)
        self.assertFalse(ok)
        self.assertIn("top_share", why)
        with self.assertRaises(ValueError):
            strategy.parse_rules({"filters": [["nope", ">=", 1]]})
        with self.assertRaises(ValueError):
            strategy.parse_rules({"exit": {"sl": 1.5}})

    def test_exit_reasons_in_order(self):
        rule = strategy.ExitRule(tp=0.5, sl=0.2, trail=0.1, arm=0.2, hold_s=30, dev_exit=True)
        p = strategy.Position("m", 100, 1e8, entry_price=1.0, entry_slot=0, opened_at=0.0)
        self.assertIsNone(strategy.exit_reason(p, rule, 1.1, now=1))
        self.assertIn("stop", strategy.exit_reason(p, rule, 0.79, now=1))
        p = strategy.Position("m", 100, 1e8, entry_price=1.0, entry_slot=0, opened_at=0.0)
        self.assertIn("profit", strategy.exit_reason(p, rule, 1.6, now=1))
        p = strategy.Position("m", 100, 1e8, entry_price=1.0, entry_slot=0, opened_at=0.0)
        self.assertIsNone(strategy.exit_reason(p, rule, 1.3, now=1))
        self.assertIn("trailing", strategy.exit_reason(p, rule, 1.15, now=2))
        p = strategy.Position("m", 100, 1e8, entry_price=1.0, entry_slot=0, opened_at=0.0)
        self.assertIn("creator", strategy.exit_reason(p, rule, 1.0, now=1, dev_sold=True))
        self.assertIn("time", strategy.exit_reason(p, rule, 1.0, now=31))
        self.assertIn("migrated", strategy.exit_reason(p, rule, 1.0, now=1, completed=True))

    def test_curve_math_round_trip_costs_fees(self):
        vs, vt = 30e9, 1.073e15
        q = strategy.buy_tokens(vs, vt, 1e8)
        vs2, vt2 = vs + 1e8 / 1.0125, vt - q
        back = strategy.sell_lamports(vs2, vt2, q)
        self.assertAlmostEqual(back / 1e8, (1 - 0.0125) / 1.0125, places=6)

    def test_load_rules_missing_file(self):
        self.assertIsNone(strategy.load_rules(""))
        self.assertIsNone(strategy.load_rules("/nonexistent/rules.json"))


class HistoryTests(unittest.TestCase):
    def test_counts_creator_and_ticker_history_in_their_windows(self):
        h = strategy.LaunchHistory()
        self.assertEqual(h.record("dev1", "CAT", 0), (0, 0))
        self.assertEqual(h.record("dev1", "cat ", 60), (1, 1), "same creator, same ticker (case and spaces ignored)")
        self.assertEqual(h.record("dev2", "CAT", 120), (0, 2))
        self.assertEqual(h.record("dev2", "CAT", 120 + strategy.SYM_HISTORY_S + 1), (1, 0), "tickers older than 30 min drop out")
        self.assertEqual(h.record("dev1", "DOG", strategy.DEV_HISTORY_S + 61), (0, 0), "creator launches older than 6 h drop out")

    def test_market_stamps_new_books(self):
        m = market_mod.Market()
        m.apply(pumpevents.decode_logs([create_line()]), 1)
        second = Keypair().pubkey()
        books = m.apply(pumpevents.decode_logs([create_line(mint=second)]), 2)
        self.assertEqual((books[0].dev_launches, books[0].sym_dupes), (1, 1))
        f = dict(zip(strategy.FEATURES, strategy.features(book_with([(2, True, 1, 1, "a", 1, 1, 1)], 2), 2)))
        self.assertEqual((f["dev_launches"], f["sym_dupes"]), (0.0, 0.0))


class MarketTests(unittest.TestCase):
    def test_tracks_classic_launches_and_their_trades(self):
        m = market_mod.Market()
        launches = m.apply(pumpevents.decode_logs([create_line()]), 50)
        self.assertEqual([b.mint for b in launches], [str(MINT)])
        variant_mint = Keypair().pubkey()
        self.assertEqual(m.apply(pumpevents.decode_logs([create_line(mint=variant_mint, vs=9_000_000_000)]), 50), [])
        curve = Curve()
        seen = []
        m.watch(str(MINT), lambda b, e: seen.append(e["kind"]))
        m.apply(pumpevents.decode_logs([curve.trade(BUYER, 200_000_000)]), 51)
        book = m.books[str(MINT)]
        self.assertEqual(len(book.slot), 1)
        self.assertEqual(seen, ["trade"])


class RulesPipelineTests(unittest.TestCase):
    """A coin launches, buyers pile in, the ruleset buys it on paper, the price hits the target, it sells."""

    def test_rules_dry_run_buys_and_sells_on_paper(self):
        curve = Curve()
        dev_buy = curve.trade(CREATOR, 1_000_000_000)
        notes = [{"signature": "c", "err": None, "logs": [create_line(), dev_buy], "_slot_": 100}]
        for i in range(4):
            notes.append({"signature": f"b{i}", "err": None, "logs": [curve.trade(Keypair().pubkey(), 300_000_000)]})
        server = FakeLogsServer(notes)
        rules = strategy.parse_rules({"name": "test", "decide_after_s": 0.3, "filters": [["n_buy", ">=", 3]],
                                      "exit": {"tp": 0.3, "sl": 0.5, "hold_s": 30}})

        async def scenario():
            chain = FakeChain()
            rpc, wallet, jup = chain.doubles()
            rec, queue = Recorder(), asyncio.Queue()
            lst = asyncio.create_task(listener.run_listener(settings(), queue, rec, rpc=rpc, rules=rules, ws_url=server.url))
            ex = executor_mod.Executor(settings(buy_amount_sol=0.1), rec, rpc=rpc, wallet=wallet, jupiter=jup)
            ex.rules = rules
            exe = asyncio.create_task(ex.run(queue))
            deadline = time.time() + 5
            while time.time() < deadline and not ex.positions:
                await asyncio.sleep(0.05)
            self.assertTrue(ex.positions, "the ruleset should have bought on paper")
            # a big buyer pushes the price past +30%
            m = market_mod.ACTIVE
            m.apply(pumpevents.decode_logs([curve.trade(Keypair().pubkey(), 6_000_000_000)]), 200)
            deadline = time.time() + 5
            while time.time() < deadline and ex.closed == 0:
                await asyncio.sleep(0.05)
            for t in (lst, exe):
                t.cancel()
            await asyncio.gather(lst, exe, return_exceptions=True)
            await rpc.aclose()
            await jup.aclose()
            return ex, rec, chain

        try:
            ex, rec, chain = asyncio.run(scenario())
        finally:
            server.close()
        self.assertEqual(ex.closed, 1)
        self.assertGreater(ex.realized_sol, 0)
        sells = [e for e in rec.events if e["event_type"] == "trade" and "DRY RUN sell" in e["message"]]
        self.assertEqual(len(sells), 1)
        self.assertIn("profit target", sells[0]["message"])
        self.assertNotIn("sendTransaction", chain.calls)
        self.assertNotIn("getAccountInfo", chain.calls, "the launch event already says the curve is classic")


if __name__ == "__main__":
    unittest.main()
