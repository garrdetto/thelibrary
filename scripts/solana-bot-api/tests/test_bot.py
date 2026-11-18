"""
Bot logic checks against fake Solana RPC, fake Jupiter and a local WebSocket
server. No network, no real keys, nothing is ever sent to mainnet.

    .venv/bin/python -m unittest discover -s tests -v
"""

import asyncio
import base64
import json
import os
import sys
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.update({"MAX_BUY_AMOUNT_SOL": "0.5", "JUPITER_API_KEY": "test-key", "MAX_TRADES_PER_RUN": "2",
                   "QUOTE_RETRY_DELAY_S": "0.01", "TX_FETCH_DELAY_S": "0.01", "CONFIRM_TIMEOUT_S": "2"})

import httpx  # noqa: E402
from solders.hash import Hash  # noqa: E402
from solders.keypair import Keypair  # noqa: E402
from solders.message import MessageV0  # noqa: E402
from solders.null_signer import NullSigner  # noqa: E402
from solders.pubkey import Pubkey  # noqa: E402
from solders.system_program import TransferParams, transfer  # noqa: E402
from solders.transaction import VersionedTransaction  # noqa: E402

import config  # noqa: E402
import pumpcurve  # noqa: E402
import executor as executor_mod  # noqa: E402
import listener  # noqa: E402
import rpc_client  # noqa: E402
from bot_manager import BotSettings  # noqa: E402
from jupiter import Jupiter  # noqa: E402

KP = Keypair()
WALLET = str(KP.pubkey())
TARGET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
MINT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"
SIG = "5" * 88


def unsigned_swap(payer=KP.pubkey()) -> bytes:
    ix = transfer(TransferParams(from_pubkey=payer, to_pubkey=Pubkey.default(), lamports=1))
    return bytes(VersionedTransaction(MessageV0.try_compile(payer, [ix], [], Hash.default()), [NullSigner(payer)]))


def curve_bytes(variant=0, real_sol=2_000_000_000):
    import struct
    head = bytes(8) + struct.pack("<5Q", 1_000_000_000_000_000, 30_000_000_000 + real_sol, 700_000_000_000_000, real_sol, 10**15)
    return head + b"\x00" + bytes(32) + bytes([variant]) + bytes(166 - 82)


def create_tx(mint=MINT):
    return {"slot": 1, "meta": {"err": None, "preTokenBalances": [], "postTokenBalances": [
        {"accountIndex": 3, "mint": mint, "owner": "BondingCurve111", "uiTokenAmount": {"amount": "1000000000000000"}},
    ], "preBalances": [], "postBalances": []}, "transaction": {"message": {"accountKeys": ["Creator1"]}}}


def copy_tx(wallet=TARGET, mint=MINT, gained=5000, sol_delta=-100_000_000):
    return {"meta": {"err": None,
                     "preBalances": [2_000_000_000, 0], "postBalances": [2_000_000_000 + sol_delta, 0],
                     "preTokenBalances": [],
                     "postTokenBalances": [{"mint": mint, "owner": wallet, "uiTokenAmount": {"amount": str(gained)}}]},
            "transaction": {"message": {"accountKeys": [wallet, "Other"]}}}


class FakeChain:
    """Answers Solana JSON-RPC and Jupiter HTTP calls."""

    def __init__(self, *, balance=5_000_000_000, sim_err=None, impact="0.01", no_route_times=0, swap_payer=KP.pubkey(), tx=None, curve=None):
        self.curve = curve if curve is not None else curve_bytes()
        self.calls = []
        self.balance, self.sim_err, self.impact = balance, sim_err, impact
        self.no_route_times, self.swap_payer = no_route_times, swap_payer
        self.tx = tx if tx is not None else create_tx()
        self.sent = []

    def rpc(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        method = body["method"]
        self.calls.append(method)
        result = {
            "getBalance": {"value": self.balance},
            "getTransaction": self.tx,
            "simulateTransaction": {"value": {"err": self.sim_err, "logs": ["Program log: Error: boom"] if self.sim_err else [], "unitsConsumed": 87000}},
            "getSignatureStatuses": {"value": [{"confirmationStatus": "confirmed", "err": None}]},
            "getAccountInfo": {"value": {"data": [base64.b64encode(self.curve).decode(), "base64"]}},
        }.get(method)
        if method == "sendTransaction":
            raw = base64.b64decode(body["params"][0])
            tx = VersionedTransaction.from_bytes(raw)
            assert tx.verify_with_results() == [True], "sent transaction must be signed by the wallet"
            self.sent.append(raw)
            result = SIG
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    def jupiter(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        assert request.headers.get("x-api-key") == "test-key"
        if request.url.path.endswith("/quote"):
            if self.no_route_times > 0:
                self.no_route_times -= 1
                return httpx.Response(400, json={"error": "Could not find any route"})
            return httpx.Response(200, json={"inAmount": request.url.params["amount"], "outAmount": "123456789",
                                             "priceImpactPct": self.impact, "routePlan": [{"swapInfo": {"label": "Pump.fun"}}]})
        body = json.loads(request.content)
        assert body["userPublicKey"] == WALLET
        return httpx.Response(200, json={"swapTransaction": base64.b64encode(unsigned_swap(self.swap_payer)).decode(), "lastValidBlockHeight": 100})

    def doubles(self, keypair=KP):
        rpc = rpc_client.RpcClient("http://rpc.test", transport=httpx.MockTransport(self.rpc))
        jup = Jupiter(transport=httpx.MockTransport(self.jupiter))
        return rpc, rpc_client.Wallet(keypair), jup


class Recorder:
    def __init__(self):
        self.events = []

    def __call__(self, event_type, message, **kw):
        self.events.append({"event_type": event_type, "message": message, **kw})

    def types(self):
        return [e["event_type"] for e in self.events]


def settings(**kw):
    base = dict(mode="sniper", buy_amount_sol=0.05, slippage_bps=300, dry_run=True)
    base.update(kw)
    return BotSettings(**base)


def run(coro):
    return asyncio.run(coro)


class ParsingTests(unittest.TestCase):
    def test_pump_create_logs(self):
        self.assertTrue(listener.is_pump_create(["Program log: Instruction: Create"]))
        self.assertTrue(listener.is_pump_create(["Program log: Instruction: CreateV2"]))
        self.assertFalse(listener.is_pump_create(["Program log: Instruction: Buy"]))

    def test_new_mints(self):
        self.assertEqual(listener.new_mints(create_tx()), [MINT])
        failed = create_tx()
        failed["meta"]["err"] = {"InstructionError": [0, "Custom"]}
        self.assertEqual(listener.new_mints(failed), [])
        existing = create_tx()
        existing["meta"]["preTokenBalances"] = [{"mint": MINT}]
        self.assertEqual(listener.new_mints(existing), [])

    def test_pick_launch_mint_prefers_pump_suffix(self):
        self.assertEqual(listener.pick_launch_mint(["OtherMint111", "AbcPUMPxyzpump"]), ["AbcPUMPxyzpump"])
        self.assertEqual(listener.pick_launch_mint(["OnlyOne111"]), ["OnlyOne111"])
        self.assertEqual(listener.pick_launch_mint([]), [])

    def test_get_transaction_asks_for_v1(self):
        seen = {}

        def handler(request):
            seen.update(json.loads(request.content))
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": None})

        async def scenario():
            rpc = rpc_client.RpcClient("http://rpc.test", transport=httpx.MockTransport(handler))
            await rpc.get_transaction("sig")
            await rpc.aclose()
        run(scenario())
        self.assertEqual(seen["params"][1]["maxSupportedTransactionVersion"], 1)

    def test_wallet_buys(self):
        self.assertEqual(listener.wallet_buys(copy_tx(), TARGET), [{"mint": MINT, "amount": 5000, "sol_spent": 0.1}])
        self.assertEqual(listener.wallet_buys(copy_tx(sol_delta=50_000_000), TARGET), [], "token in + SOL in is not a buy")
        self.assertEqual(listener.wallet_buys(copy_tx(wallet="Someone"), TARGET), [], "other wallets ignored")
        self.assertEqual(listener.wallet_buys(copy_tx(mint=config.WSOL_MINT), TARGET), [])


class CurveTests(unittest.TestCase):
    def test_classic_and_variant(self):
        self.assertTrue(pumpcurve.decode(curve_bytes()).classic)
        self.assertFalse(pumpcurve.decode(curve_bytes(variant=1)).classic)
        self.assertEqual(pumpcurve.decode(curve_bytes(real_sol=3_000_000_000)).raised_sol, 3.0)
        self.assertIsNone(pumpcurve.decode(b"short"))


class ExecutorTests(unittest.TestCase):
    def go(self, chain, s, items, keypair=KP):
        async def scenario():
            rpc, wallet, jup = chain.doubles(keypair)
            rec = Recorder()
            ex = executor_mod.Executor(s, rec, rpc=rpc, wallet=wallet, jupiter=jup)
            results = []
            for item in items:
                results.append(await ex.handle({"detected_at": time.perf_counter(), **item}))
            await rpc.aclose()
            await jup.aclose()
            return rec, results
        return run(scenario())

    def test_dry_run_quotes_simulates_never_sends(self):
        chain = FakeChain()
        rec, _ = self.go(chain, settings(), [{"mint": MINT}])
        self.assertEqual(rec.types(), ["quote", "simulation", "trade"])
        self.assertIn("DRY RUN", rec.events[-1]["message"])
        self.assertNotIn("sendTransaction", chain.calls)

    def test_live_sends_signed_and_confirms(self):
        chain = FakeChain()
        rec, results = self.go(chain, settings(dry_run=False), [{"mint": MINT}])
        self.assertEqual(rec.types(), ["quote", "simulation", "broadcast", "trade"])
        self.assertEqual(results[0], SIG)
        self.assertEqual(rec.events[-1]["level"], "success")
        self.assertEqual(len(chain.sent), 1)

    def test_one_buy_per_coin_and_trade_cap(self):
        chain = FakeChain()
        mints = [MINT, MINT, "Mint2222222222222222222222222222222222222222", "Mint3333333333333333333333333333333333333333"]
        rec, _ = self.go(chain, settings(dry_run=False), [{"mint": m} for m in mints])
        self.assertEqual(len(chain.sent), 2, "MAX_TRADES_PER_RUN=2")
        self.assertTrue(any("MAX_TRADES_PER_RUN" in e["message"] for e in rec.events))

    def test_reserve_blocks_buy(self):
        chain = FakeChain(balance=int(0.06 * 1e9))
        rec, _ = self.go(chain, settings(dry_run=False), [{"mint": MINT}])
        self.assertEqual(chain.sent, [])
        self.assertIn("reserve", rec.events[-1]["message"])

    def test_failed_simulation_is_never_sent(self):
        chain = FakeChain(sim_err={"InstructionError": [2, {"Custom": 6001}]})
        rec, _ = self.go(chain, settings(dry_run=False), [{"mint": MINT}])
        self.assertEqual(chain.sent, [])
        self.assertEqual(rec.events[-1]["event_type"], "simulation")
        self.assertEqual(rec.events[-1]["level"], "error")

    def test_price_impact_cap(self):
        chain = FakeChain(impact="0.40")
        rec, _ = self.go(chain, settings(dry_run=False), [{"mint": MINT}])
        self.assertEqual(chain.sent, [])
        self.assertIn("price impact", rec.events[-1]["message"])

    def test_no_route_retries_then_buys(self):
        chain = FakeChain(no_route_times=2)
        rec, _ = self.go(chain, settings(), [{"mint": MINT}])
        self.assertEqual(chain.calls.count("/swap/v1/quote"), 3)
        self.assertEqual(rec.events[-1]["event_type"], "trade")

    def test_refuses_foreign_fee_payer(self):
        chain = FakeChain(swap_payer=Keypair().pubkey())
        with self.assertRaisesRegex(RuntimeError, "fee payer"):
            self.go(chain, settings(dry_run=False), [{"mint": MINT}])
        self.assertEqual(chain.sent, [])

    def test_sniper_skips_curve_variants(self):
        chain = FakeChain(curve=curve_bytes(variant=1))
        rec, _ = self.go(chain, settings(), [{"mint": MINT, "source": "pumpfun"}])
        self.assertIn("variant", rec.events[-1]["message"])
        self.assertNotIn("/swap/v1/quote", chain.calls)
        chain = FakeChain()
        rec, _ = self.go(chain, settings(), [{"mint": MINT, "source": "pumpfun"}])
        self.assertEqual(rec.types(), ["quote", "simulation", "trade"])

    def test_stale_signal_skipped(self):
        chain = FakeChain()
        rec, _ = self.go(chain, settings(), [{"mint": MINT, "detected_at": time.perf_counter() - 999}])
        self.assertIn("old", rec.events[-1]["message"])
        self.assertNotIn("/swap/v1/quote", chain.calls)

    def test_live_without_key_refuses(self):
        async def scenario():
            chain = FakeChain()
            rpc, _, jup = chain.doubles()
            ex = executor_mod.Executor(settings(dry_run=False), Recorder(), rpc=rpc, wallet=rpc_client.Wallet(None), jupiter=jup)
            with self.assertRaises(RuntimeError):
                await ex.run(asyncio.Queue())
            await rpc.aclose()
        run(scenario())


class FakeLogsServer:
    """A local RPC WebSocket that acks logsSubscribe and then pushes notifications."""

    def __init__(self, notifications):
        from websockets.sync.server import serve

        self.notifications = notifications
        self.subscriptions = []
        self.server = serve(self.handler, "127.0.0.1", 0)
        self.url = f"ws://127.0.0.1:{self.server.socket.getsockname()[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def handler(self, ws):
        request = json.loads(ws.recv())
        self.subscriptions.append(request)
        ws.send(json.dumps({"jsonrpc": "2.0", "result": 7, "id": request["id"]}))
        for value in self.notifications:
            ws.send(json.dumps({"jsonrpc": "2.0", "method": "logsNotification",
                                "params": {"result": {"context": {"slot": 1}, "value": value}, "subscription": 7}}))
        try:
            ws.recv()
        except Exception:
            pass

    def close(self):
        self.server.shutdown()


class ListenerTests(unittest.TestCase):
    def test_sniper_listener_end_to_end(self):
        server = FakeLogsServer([
            {"signature": "buy-sig", "err": None, "logs": ["Program log: Instruction: Buy"]},
            {"signature": "failed-sig", "err": {"x": 1}, "logs": ["Program log: Instruction: Create"]},
            {"signature": "create-sig", "err": None, "logs": ["Program log: Instruction: Create"]},
        ])
        old = config.RPC_WS_URL
        config.RPC_WS_URL = server.url

        async def scenario():
            chain = FakeChain()
            rpc, _, jup = chain.doubles()
            rec, queue = Recorder(), asyncio.Queue()
            task = asyncio.create_task(listener.run_listener(settings(), queue, rec, rpc=rpc))
            item = await asyncio.wait_for(queue.get(), 5)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await rpc.aclose()
            await jup.aclose()
            return item, rec, chain

        try:
            item, rec, chain = run(scenario())
        finally:
            config.RPC_WS_URL = old
            server.close()
        self.assertEqual(item["mint"], MINT)
        self.assertEqual(item["signature"], "create-sig")
        self.assertEqual(chain.calls.count("getTransaction"), 1, "only the successful create was fetched")
        self.assertEqual(server.subscriptions[0]["params"][0], {"mentions": [config.PUMP_FUN_PROGRAM]})
        self.assertIn("detection", rec.types())

    def test_copytrade_subscribes_to_target(self):
        server = FakeLogsServer([{"signature": "t1", "err": None, "logs": ["anything"]}])
        old = config.RPC_WS_URL
        config.RPC_WS_URL = server.url

        async def scenario():
            chain = FakeChain(tx=copy_tx())
            rpc, _, jup = chain.doubles()
            queue = asyncio.Queue()
            task = asyncio.create_task(listener.run_listener(settings(mode="copytrade", target_wallet=TARGET), queue, Recorder(), rpc=rpc))
            item = await asyncio.wait_for(queue.get(), 5)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await rpc.aclose()
            await jup.aclose()
            return item

        try:
            item = run(scenario())
        finally:
            config.RPC_WS_URL = old
            server.close()
        self.assertEqual(item["mint"], MINT)
        self.assertEqual(server.subscriptions[0]["params"][0], {"mentions": [TARGET]})


class PipelineTests(unittest.TestCase):
    """Real ProjectHooks → listener → executor → BotManager → FastAPI WebSocket, all faked at the network edge."""

    def test_full_dry_run_through_api(self):
        from fastapi.testclient import TestClient

        from api import create_app
        from bot_adapter import ProjectHooks
        from bot_manager import BotManager

        server = FakeLogsServer([{"signature": "create-sig", "err": None, "logs": ["Program log: Instruction: CreateV2"]}])
        chain = FakeChain()
        old_ws, old_jup = config.RPC_WS_URL, executor_mod.Jupiter
        config.RPC_WS_URL = server.url
        executor_mod.Jupiter = lambda: Jupiter(transport=httpx.MockTransport(chain.jupiter))
        rpc_client._client, rpc_client._wallet = None, None
        rpc_client.set_test_doubles(rpc_client.RpcClient("http://rpc.test", transport=httpx.MockTransport(chain.rpc)), rpc_client.Wallet(KP))
        password = "pipeline-password-123"
        try:
            with TestClient(create_app(BotManager(hooks=ProjectHooks()), password=password, allowed_origins="*")) as client:
                auth = {"Authorization": f"Bearer {password}"}
                status = client.get("/api/status", headers=auth).json()
                self.assertEqual(status["wallet"], {"address": WALLET, "balance_sol": 5.0})
                live = client.post("/api/start", headers=auth, json={"buy_amount_sol": 0.05, "slippage_bps": 300, "dry_run": False})
                self.assertEqual(live.status_code, 400, "LIVE needs PRIVATE_KEY in .env")
                self.assertIn("PRIVATE_KEY", live.json()["detail"])
                with client.websocket_connect(f"/ws/stream?token={password}") as ws:
                    ws.receive_json()
                    self.assertEqual(client.post("/api/start", headers=auth, json={"buy_amount_sol": 0.05, "slippage_bps": 300, "dry_run": True}).status_code, 200)
                    seen = []
                    deadline = time.time() + 10
                    while time.time() < deadline and "trade" not in seen:
                        msg = ws.receive_json()
                        if msg.get("event_type") not in ("heartbeat", "status", "info"):
                            seen.append(msg["event_type"])
                    self.assertEqual(seen, ["detection", "quote", "simulation", "trade"])
                    client.post("/api/stop", headers=auth)
                self.assertNotIn("sendTransaction", chain.calls)
        finally:
            config.RPC_WS_URL = old_ws
            executor_mod.Jupiter = old_jup
            server.close()
            rpc_client._client, rpc_client._wallet = None, None


if __name__ == "__main__":
    unittest.main()
