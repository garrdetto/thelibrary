"""
API + BotManager checks with a stand-in bot (no network, no real transactions).

    cd scripts/solana-bot-api
    .venv/bin/python -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["MAX_BUY_AMOUNT_SOL"] = "0.5"

from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from api import WS_AUTH_FAILED, create_app  # noqa: E402
from bot_manager import BotConfigError, BotManager, validate_settings  # noqa: E402

PASSWORD = "correct-horse-battery-staple"
AUTH = {"Authorization": f"Bearer {PASSWORD}"}
WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
MINT = "So11111111111111111111111111111111111111112"


class FakeHooks:
    """Behaves like the real listener/executor pair: detect → quote → simulate → trade."""

    def __init__(self, crash_listener: bool = False):
        self.crash_listener = crash_listener
        self.cancelled = set()
        self.closed = False

    async def run_listener(self, settings, detections, emit):
        try:
            await asyncio.sleep(0.05)
            if self.crash_listener:
                raise RuntimeError("websocket dropped")
            emit("detection", "New pool detected", mint=MINT, latency_ms=12.3)
            await detections.put({"mint": MINT})
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.add("listener")
            raise

    async def run_executor(self, settings, detections, emit):
        try:
            while True:
                item = await detections.get()
                emit("quote", "Jupiter quote", mint=item["mint"], latency_ms=40)
                emit("simulation", "Simulation ok", mint=item["mint"], latency_ms=55)
                if settings.dry_run:
                    emit("trade", "DRY RUN buy", level="success", mint=item["mint"])
                else:
                    emit("broadcast", "Sent", mint=item["mint"], signature="5" * 88)
                    emit("trade", "Bought", level="success", mint=item["mint"], signature="5" * 88)
        except asyncio.CancelledError:
            self.cancelled.add("executor")
            raise

    async def wallet_info(self):
        return {"address": WALLET, "balance_sol": 1.2345}

    async def aclose(self):
        self.closed = True


def make_client(hooks=None, **kwargs):
    hooks = hooks or FakeHooks()
    app = create_app(BotManager(hooks=hooks), password=PASSWORD, allowed_origins="https://mysite.example", heartbeat_s=0.2, **kwargs)
    return TestClient(app), hooks


def receive_until(ws, predicate, limit=50):
    for _ in range(limit):
        msg = ws.receive_json()
        if predicate(msg):
            return msg
    raise AssertionError("expected event never arrived")


class ApiTests(unittest.TestCase):
    def test_health_is_public(self):
        client, _ = make_client()
        with client:
            self.assertEqual(client.get("/api/health").json(), {"status": "ok"})

    def test_protected_endpoints_reject_bad_passwords(self):
        client, _ = make_client()
        with client:
            for method, path in (("get", "/api/status"), ("post", "/api/start"), ("post", "/api/stop")):
                self.assertEqual(getattr(client, method)(path).status_code, 401, path)
                self.assertEqual(getattr(client, method)(path, headers={"Authorization": "Bearer nope"}).status_code, 401, path)
                self.assertEqual(getattr(client, method)(path, headers={"Authorization": f"Basic {PASSWORD}"}).status_code, 401, path)

    def test_missing_password_config_refuses(self):
        app = create_app(BotManager(hooks=FakeHooks()), password="", allowed_origins="*")
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/status", headers={"Authorization": "Bearer "}).status_code, 503)

    def test_status(self):
        client, _ = make_client()
        with client:
            data = client.get("/api/status", headers=AUTH).json()
            self.assertFalse(data["running"])
            self.assertEqual(data["wallet"], {"address": WALLET, "balance_sol": 1.2345})
            self.assertEqual(data["max_buy_amount_sol"], 0.5)
            self.assertEqual(data["recent_trades"], [])

    def test_start_validation(self):
        client, _ = make_client()
        with client:
            over = client.post("/api/start", headers=AUTH, json={"buy_amount_sol": 0.75, "slippage_bps": 300})
            self.assertEqual(over.status_code, 400)
            self.assertIn("MAX_BUY_AMOUNT_SOL", over.json()["detail"])
            no_target = client.post("/api/start", headers=AUTH, json={"mode": "copytrade", "buy_amount_sol": 0.1, "slippage_bps": 300})
            self.assertEqual(no_target.status_code, 400)
            bad_body = client.post("/api/start", headers=AUTH, json={"buy_amount_sol": -1, "slippage_bps": 300})
            self.assertEqual(bad_body.status_code, 422)
            extra = client.post("/api/start", headers=AUTH, json={"buy_amount_sol": 0.1, "slippage_bps": 300, "rpc": "x"})
            self.assertEqual(extra.status_code, 422)

    def test_start_stop_cycle(self):
        client, hooks = make_client()
        with client:
            started = client.post("/api/start", headers=AUTH, json={"mode": "copytrade", "target_wallet": WALLET, "buy_amount_sol": 0.1, "slippage_bps": 250, "dry_run": True})
            self.assertEqual(started.status_code, 200, started.text)
            self.assertTrue(started.json()["running"])
            self.assertEqual(started.json()["settings"]["target_wallet"], WALLET)
            self.assertEqual(client.post("/api/start", headers=AUTH, json={"buy_amount_sol": 0.1, "slippage_bps": 250}).status_code, 409)

            deadline = time.time() + 3
            while time.time() < deadline:
                status = client.get("/api/status", headers=AUTH).json()
                if status["trades_executed"]:
                    break
                time.sleep(0.05)
            self.assertEqual(status["trades_executed"], 1)
            self.assertEqual(status["recent_trades"][0]["mint"], MINT)

            stopped = client.post("/api/stop", headers=AUTH)
            self.assertFalse(stopped.json()["running"])
            self.assertEqual(hooks.cancelled, {"listener", "executor"})
            self.assertFalse(hooks.closed, "stop() must keep shared sessions open")
            self.assertFalse(client.post("/api/stop", headers=AUTH).json()["running"])
        self.assertTrue(hooks.closed, "app shutdown closes sessions")

    def test_missing_bot_modules_fail_fast(self):
        from bot_adapter import ProjectHooks

        app = create_app(BotManager(hooks=ProjectHooks()), password=PASSWORD, allowed_origins="*")
        with TestClient(app) as client:
            res = client.post("/api/start", headers=AUTH, json={"buy_amount_sol": 0.1, "slippage_bps": 250})
            self.assertEqual(res.status_code, 400)
            self.assertIn("listener.py", res.json()["detail"])
            self.assertFalse(client.get("/api/status", headers=AUTH).json()["running"])

    def test_crashed_task_stops_bot(self):
        client, _ = make_client(FakeHooks(crash_listener=True))
        with client:
            client.post("/api/start", headers=AUTH, json={"buy_amount_sol": 0.1, "slippage_bps": 250})
            deadline = time.time() + 3
            while time.time() < deadline and client.get("/api/status", headers=AUTH).json()["running"]:
                time.sleep(0.05)
            status = client.get("/api/status", headers=AUTH).json()
            self.assertFalse(status["running"])
            self.assertTrue(any("crashed" in e["message"] for e in status["recent_events"]))

    def test_websocket_rejects_bad_token(self):
        client, _ = make_client()
        with client:
            for url in ("/ws/stream", "/ws/stream?token=wrong"):
                with client.websocket_connect(url) as ws:
                    with self.assertRaises(WebSocketDisconnect) as caught:
                        ws.receive_json()
                    self.assertEqual(caught.exception.code, WS_AUTH_FAILED)

    def test_websocket_streams_events_and_heartbeats(self):
        client, _ = make_client()
        with client:
            with client.websocket_connect(f"/ws/stream?token={PASSWORD}") as ws:
                hello = ws.receive_json()
                self.assertEqual(hello["event_type"], "hello")
                self.assertFalse(hello["running"])
                beat = receive_until(ws, lambda m: m["event_type"] == "heartbeat")
                self.assertIn("running", beat)

                client.post("/api/start", headers=AUTH, json={"buy_amount_sol": 0.1, "slippage_bps": 250})
                detection = receive_until(ws, lambda m: m["event_type"] == "detection")
                self.assertEqual(set(detection), {"timestamp", "level", "event_type", "mint", "signature", "latency_ms", "message"})
                self.assertEqual(detection["mint"], MINT)
                self.assertEqual(detection["latency_ms"], 12.3)
                trade = receive_until(ws, lambda m: m["event_type"] == "trade")
                self.assertEqual(trade["level"], "success")

                ws.send_text("ping")
                receive_until(ws, lambda m: m["event_type"] == "pong")
                client.post("/api/stop", headers=AUTH)
                receive_until(ws, lambda m: m["event_type"] == "status" and "stopped" in m["message"])

    def test_cors_preflight_for_allowed_origin_only(self):
        client, _ = make_client()
        with client:
            headers = {"Origin": "https://mysite.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
            ok = client.options("/api/start", headers=headers)
            self.assertEqual(ok.headers.get("access-control-allow-origin"), "https://mysite.example")
            bad = client.options("/api/start", headers={**headers, "Origin": "https://evil.example"})
            self.assertNotEqual(bad.headers.get("access-control-allow-origin"), "https://evil.example")

    def test_brute_force_lockout(self):
        client, _ = make_client()
        with client:
            for _ in range(10):
                client.get("/api/status", headers={"Authorization": "Bearer wrong"})
            self.assertEqual(client.get("/api/status", headers=AUTH).status_code, 429)

    def test_index_and_sdk_are_served(self):
        client, _ = make_client()
        with client:
            page = client.get("/")
            self.assertEqual(page.status_code, 200)
            self.assertIn("Axiom Bot", page.text)
            self.assertIn("class SolanaBotClient", client.get("/sdk/solana-bot-client.js").text)


class ManagerTests(unittest.TestCase):
    def test_validate_settings(self):
        self.assertEqual(validate_settings({"buy_amount_sol": 0.5, "slippage_bps": 100}).buy_amount_sol, 0.5)
        for bad in ({"buy_amount_sol": 0.51}, {"buy_amount_sol": 0}, {"slippage_bps": 0}, {"slippage_bps": 9000},
                    {"mode": "yolo"}, {"mode": "copytrade", "target_wallet": "0OIl"}, {"dry_run": "yes"}, {"nope": 1}):
            with self.assertRaises(BotConfigError, msg=str(bad)):
                validate_settings(bad)
        self.assertEqual(validate_settings({"mode": "sniper", "target_wallet": WALLET}).target_wallet, "")

    def test_broadcast_ring_buffer_and_threads(self):
        async def scenario():
            manager = BotManager(hooks=FakeHooks(), subscriber_queue_size=5)
            queue = manager.subscribe()
            for i in range(150):
                manager.emit("info", f"event {i}")
            self.assertEqual(len(manager.recent_events), 100)
            self.assertEqual(manager.recent_events[0]["message"], "event 50")
            self.assertEqual(queue.qsize(), 5)
            self.assertEqual(queue.get_nowait()["message"], "event 145")

            while not queue.empty():
                queue.get_nowait()
            worker = threading.Thread(target=lambda: manager.emit("trade", "from thread", level="success"))
            worker.start()
            worker.join()
            event = await asyncio.wait_for(queue.get(), 1)
            self.assertEqual(event["message"], "from thread")
            self.assertEqual(manager.trades_executed, 1)
            manager.unsubscribe(queue)
            self.assertEqual(manager.subscriber_count, 0)

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
