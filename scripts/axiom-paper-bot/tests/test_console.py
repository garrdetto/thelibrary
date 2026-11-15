"""Run with: python -m unittest discover -s scripts/axiom-paper-bot/tests"""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from axiom_paper import cli, console
from axiom_paper import settings as dials
from axiom_paper.engine import Engine
from axiom_paper.ledger import Ledger
from axiom_paper.models import Position


def fake_claude(reply: dict[str, Any], code: int = 0) -> Any:
    calls: list[dict[str, Any]] = []

    def runner(argv: list[str], **options: Any) -> Any:
        calls.append({"argv": argv, **options})
        return types.SimpleNamespace(returncode=code, stdout=json.dumps(reply), stderr="")

    runner.calls = calls  # type: ignore[attr-defined]
    return runner


class Folder(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = tempfile.TemporaryDirectory()
        self.settings = Path(self.folder.name) / "paper-bot.toml"
        self.db = Path(self.folder.name) / "paper.db"

    def tearDown(self) -> None:
        self.folder.cleanup()

    def args(self, *words: str) -> Any:
        return cli.parse([*words, "--settings", str(self.settings), "--db", str(self.db)])


class DialCommandTests(Folder):
    def test_values_are_read_the_way_people_type_them(self) -> None:
        self.assertEqual(dials.parse_value("risk.strength", "8"), 8)
        self.assertEqual(dials.parse_value("exit.stop_loss_pct", "30%"), 30)
        self.assertEqual(dials.parse_value("exit.stop_loss_pct", "500"), 95)
        self.assertEqual(dials.parse_value("account.starting_sol", "2,500"), 2500)
        self.assertIs(dials.parse_value("bot.enabled", "Off"), False)
        self.assertEqual(dials.parse_value("entry.safety", "Safe only"), "safe")
        with self.assertRaisesRegex(ValueError, "Did you mean risk.strength"):
            dials.parse_value("risk.strenth", "8")
        with self.assertRaisesRegex(ValueError, "takes a number"):
            dials.parse_value("risk.strength", "banana")
        with self.assertRaisesRegex(ValueError, "takes one of"):
            dials.parse_value("entry.signal", "moon")

    def test_set_pause_and_resume_write_the_settings_file(self) -> None:
        self.assertEqual(cli.set_dials(self.args("set", "risk.strength", "7", "entry.signal", "any")), 0)
        saved = dials.load_file(self.settings)
        self.assertEqual((saved["risk.strength"], saved["entry.signal"]), (7, "any"))
        self.assertEqual(cli.main(["pause", "--settings", str(self.settings), "--db", str(self.db)]), 0)
        self.assertIs(dials.load_file(self.settings)["bot.enabled"], False)
        self.assertEqual(cli.main(["resume", "--settings", str(self.settings), "--db", str(self.db)]), 0)
        self.assertIs(dials.load_file(self.settings)["bot.enabled"], True)
        self.assertEqual(cli.set_dials(self.args("set", "risk.strength")), 2)
        self.assertEqual(cli.set_dials(self.args("set", "nope.nothing", "1")), 2)
        self.assertEqual(dials.load_file(self.settings)["risk.strength"], 7)


class InboxTests(Folder):
    def held(self) -> Position:
        return Position(
            id=0, mint="MintA", symbol="MINTA", pair=None, opened_at=0, entry_spot=1.0, entry_price=1.02, qty=20.0, qty_open=20.0, cost=20.6, proceeds=0.0,
            fees=0.4, entry_liquidity=50_000.0, last_liquidity=50_000.0, peak_price=1.0, peak_viewers=None, last_price=1.0, last_price_at=0, target_done=False, score=80.0,
        )

    def bot(self) -> Engine:
        ledger = Ledger(":memory:")
        self.addCleanup(ledger.close)
        engine = Engine(ledger, None, self.settings)
        fill = types.SimpleNamespace(qty=20.0, price=1.02, gross=20.2, fee=0.4, net=20.6, impact_pct=0.1)
        engine.positions.append(engine.ledger.record_buy(self.held(), fill, engine.now()))
        return engine

    def test_orders_left_by_the_command_line_reach_the_running_bot(self) -> None:
        engine = self.bot()
        cli.send_to_running_bot(self.settings, {"flatten": engine.now()})
        engine.check_inbox()
        self.assertEqual(engine.positions, [])
        self.assertEqual(engine.trade_rows()[0]["reason"], "Closed from the command line")
        self.assertFalse(self.settings.with_suffix(".inbox.json").exists())
        cli.send_to_running_bot(self.settings, {"reset": engine.now(), "sol": 2500})
        engine.check_inbox()
        self.assertEqual(engine.trade_rows(), [])
        self.assertEqual(engine.ledger.cash, 2500)

    def test_old_or_broken_orders_are_dropped(self) -> None:
        engine = self.bot()
        cli.send_to_running_bot(self.settings, {"flatten": engine.now() - 3_600_000})
        engine.check_inbox()
        self.assertEqual(len(engine.positions), 1)
        self.settings.with_suffix(".inbox.json").write_text("{not json", encoding="utf-8")
        engine.check_inbox()
        self.assertEqual(len(engine.positions), 1)
        self.assertFalse(self.settings.with_suffix(".inbox.json").exists())

    def test_looking_at_the_account_does_not_touch_the_dial_bookkeeping(self) -> None:
        ledger = Ledger(":memory:")
        self.addCleanup(ledger.close)
        Engine(ledger, None, self.settings)
        remembered = ledger.get("settings_mtime")
        time.sleep(0.05)
        cli.set_dials(self.args("set", "risk.strength", "9"))
        watcher = Engine(ledger, None, self.settings, observer=True)
        self.assertEqual(watcher.values["risk.strength"], 9)
        self.assertEqual(ledger.get("settings_mtime"), remembered)
        starting = Engine(ledger, None, self.settings)
        self.assertTrue(starting.push_settings)


class StepTests(Folder):
    def step(self, text: str) -> console.Step:
        return console.build_step(text, self.settings, self.db)

    def test_bot_commands_are_checked_and_safe_ones_run_straight_away(self) -> None:
        for text in ("bot status", "bot settings", "bot pause", "bot resume", "bot logs 50", "bot set risk.strength 8 exit.stop_loss_pct 30"):
            step = self.step(text)
            self.assertEqual((step.kind, step.approval), ("bot", False), text)
            self.assertEqual(step.argv[1], str(console.RUN_PY))
            self.assertEqual(step.argv[-4:], ["--settings", str(self.settings), "--db", str(self.db)])
        self.assertEqual(self.step("bot set risk.strength 8").argv[2:5], ["set", "risk.strength", "8"])

    def test_selling_wiping_and_process_changes_wait_for_a_click(self) -> None:
        self.assertTrue(self.step("bot flatten").approval)
        reset = self.step("bot reset --sol 2.5")
        self.assertTrue(reset.approval)
        self.assertEqual(reset.argv[2:6], ["reset", "--yes", "--sol", "2.5"])
        for text in ("pm2 restart axiom-paper-bot", "pm2 stop axiom-worker", "pm2 start axiom-paper-bot"):
            step = self.step(text)
            self.assertIn(step.kind, ("pm2", "error"), text)
            self.assertTrue(step.approval or step.kind == "error", text)

    def test_mistakes_are_explained_instead_of_run(self) -> None:
        self.assertEqual(self.step("bot set risk.strength banana").kind, "error")
        self.assertIn("Did you mean", self.step("bot set risk.strenth 8").note)
        self.assertEqual(self.step("bot dance").kind, "error")
        self.assertEqual(self.step("bot status; del important.txt").kind, "error")
        self.assertEqual(self.step("bot reset --sol lots").kind, "error")

    def test_anything_else_is_a_shell_line_that_always_waits(self) -> None:
        for text in ("Get-Process python", "pm2 delete axiom-worker", "pm2 restart all", "Remove-Item C:\\thing"):
            step = self.step(text)
            self.assertEqual((step.kind, step.approval), ("shell", True), text)
            self.assertIn(text, step.argv[-1])

    def test_a_checked_step_really_runs(self) -> None:
        result = console.run_step(self.step("bot set risk.strength 6"))
        self.assertTrue(result["ok"], result["output"])
        self.assertIn("Risk strength: 5 to 6", result["output"])
        self.assertEqual(dials.load_file(self.settings)["risk.strength"], 6)
        self.assertFalse(console.run_step(self.step("bot set risk.strength banana"))["ok"])


class TranslatorTests(Folder):
    def test_claude_is_asked_with_every_tool_off_and_its_answer_is_read(self) -> None:
        runner = fake_claude({"is_error": False, "result": "", "structured_output": {"say": "Raising risk strength to 8.", "commands": ["bot set risk.strength 8", "  ", "bot status"]}})
        translator = console.Translator(executable="claude", runner=runner)
        answer = translator.ask("be bolder", console.build_system(dials.defaults()))
        self.assertEqual(answer, {"say": "Raising risk strength to 8.", "commands": ["bot set risk.strength 8", "bot status"]})
        call = runner.calls[0]
        argv = call["argv"]
        self.assertEqual(argv[argv.index("--tools") + 1], "")
        self.assertIn("--json-schema", argv)
        self.assertEqual(call["input"], "be bolder")
        self.assertTrue(translator.ready)
        system = Path(argv[argv.index("--system-prompt-file") + 1]).read_text(encoding="utf-8")
        self.assertIn("risk.strength | Risk strength.", system)
        self.assertIn("bot flatten", system)

    def test_an_answer_in_plain_text_is_still_read(self) -> None:
        runner = fake_claude({"is_error": False, "result": "```json\n{\"say\": \"Your stop loss is 25%.\", \"commands\": []}\n```"})
        answer = console.Translator(executable="claude", runner=runner).ask("what is my stop loss", "system")
        self.assertEqual(answer, {"say": "Your stop loss is 25%.", "commands": []})

    def test_not_signed_in_is_said_plainly(self) -> None:
        translator = console.Translator(executable="claude", runner=fake_claude({"is_error": True, "result": "Not logged in · Please run /login"}, 1))
        with self.assertRaises(console.TranslatorError) as caught:
            translator.ask("pause", "system")
        self.assertTrue(caught.exception.sign_in)
        self.assertIn("/login", str(caught.exception))
        self.assertIs(translator.ready, False)
        missing = console.Translator(executable="", runner=fake_claude({}))
        missing.executable = None
        with self.assertRaisesRegex(console.TranslatorError, "not found"):
            missing.ask("pause", "system")


class ServerTests(Folder):
    def setUp(self) -> None:
        super().setUp()
        runner = fake_claude({"is_error": False, "result": "", "structured_output": {"say": "Setting risk strength to 4.", "commands": ["bot set risk.strength 4", "bot flatten"]}})
        self.console = console.Console(self.settings, self.db, console.Translator(executable="claude", runner=runner), key="k" * 32)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), console.handler_for(self.console))
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        super().tearDown()

    def call(self, path: str, body: dict[str, Any] | None = None, **headers: str) -> tuple[int, Any]:
        sent = {"X-Console-Key": "k" * 32, **({"Content-Type": "application/json"} if body is not None else {}), **headers}
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=None if body is None else json.dumps(body).encode(), headers=sent, method="GET" if body is None else "POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                return response.status, json.loads(raw) if response.headers.get("Content-Type", "").startswith("application/json") else raw
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    def test_the_page_is_served_and_the_api_needs_the_key(self) -> None:
        status, page = self.call("/")
        self.assertEqual(status, 200)
        self.assertIn(b"axiom-bot-console", page)
        self.assertEqual(self.call("/api/ask", {"prompt": "bot status"}, **{"X-Console-Key": "wrong"})[0], 403)
        self.assertEqual(self.call("/api/state", None, **{"X-Console-Key": ""})[0], 403)

    def test_requests_from_other_sites_are_refused(self) -> None:
        self.assertEqual(self.call("/api/ask", {"prompt": "bot status"}, Origin="https://evil.example")[0], 403)
        self.assertEqual(self.call("/api/ask", {"prompt": "bot status"}, Host="evil.example")[0], 403)
        self.assertEqual(self.call("/api/ask", {"prompt": "bot status"}, **{"Content-Type": "text/plain"})[0], 400)

    def test_a_request_in_plain_words_becomes_commands_that_run(self) -> None:
        status, plan = self.call("/api/ask", {"prompt": "be a bit more careful and sell everything"})
        self.assertEqual(status, 200)
        self.assertEqual(plan["source"], "claude")
        self.assertEqual([(step["command"], step["approval"]) for step in plan["steps"]], [("bot set risk.strength 4", False), ("bot flatten", True)])
        status, result = self.call("/api/run", {"id": plan["id"], "index": 0})
        self.assertTrue(result["ok"], result)
        self.assertEqual(dials.load_file(self.settings)["risk.strength"], 4)
        self.assertEqual(self.call("/api/run", {"id": plan["id"], "index": 9})[0], 400)
        self.assertEqual(self.call("/api/run", {"id": "nope", "index": 0})[0], 400)

    def test_typed_commands_skip_claude(self) -> None:
        status, plan = self.call("/api/ask", {"prompt": "!bot status"})
        self.assertEqual((status, plan["source"], plan["steps"][0]["kind"]), (200, "typed", "bot"))
        status, plan = self.call("/api/ask", {"prompt": "!Get-Date"})
        self.assertEqual((plan["steps"][0]["kind"], plan["steps"][0]["approval"]), ("shell", True))
        self.assertEqual(self.call("/api/ask", {"prompt": "   "})[0], 400)

    def test_not_signed_in_reaches_the_page_as_a_clear_message(self) -> None:
        self.console.translator.runner = fake_claude({"is_error": True, "result": "Not logged in · Please run /login"}, 1)
        status, body = self.call("/api/ask", {"prompt": "pause the bot"})
        self.assertEqual(status, 503)
        self.assertTrue(body["signIn"])
        self.assertIn("/login", body["error"])


if __name__ == "__main__":
    unittest.main()
