"""A local page for driving the bot in plain words. Claude, through the Claude Code command line on this PC, turns a
request into commands; the page shows each command and its output. It listens on this PC only, behind a private key."""

from __future__ import annotations

import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import VERSION
from . import settings as dials

RUN_PY = Path(__file__).resolve().parents[1] / "run.py"
PAGE = Path(__file__).with_name("console.html")
PM2_NAMES = ("axiom-paper-bot", "axiom-worker")
OUTPUT_LIMIT = 30_000
COMMAND_SECONDS = 120
ASK_SECONDS = 90
MAX_COMMANDS = 8
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
NOT_SIGNED_IN = "Claude is not signed in on this PC. In a terminal run: claude  then type /login and finish the sign-in in the browser. You can still type commands yourself, for example: bot status"
NOT_INSTALLED = "The Claude Code command line (claude) was not found on this PC, so requests in plain words cannot be turned into commands. You can still type commands yourself, for example: bot status"
BOT_HELP = "That is not a bot command. The bot's commands are: bot status, bot set <dial> <value>, bot pause, bot resume, bot flatten, bot reset, bot settings, bot logs."
ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"say": {"type": "string"}, "commands": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_COMMANDS}},
    "required": ["say", "commands"],
    "additionalProperties": False,
}


class TranslatorError(Exception):
    def __init__(self, message: str, sign_in: bool = False):
        super().__init__(message)
        self.sign_in = sign_in


@dataclass
class Step:
    command: str
    kind: str
    argv: list[str] = field(default_factory=list)
    approval: bool = False
    note: str = ""

    def public(self) -> dict[str, Any]:
        return {"command": self.command, "kind": self.kind, "approval": self.approval, "note": self.note}


def shell_argv(text: str) -> list[str]:
    if os.name == "nt":
        return ["powershell", "-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + text]
    return ["bash", "-lc", text]


def _bot_step(text: str, words: list[str], settings: Path, db: Path) -> Step:
    base = [sys.executable, str(RUN_PY)]
    paths = ["--settings", str(settings), "--db", str(db)]
    command = words[0].casefold() if words else "status"
    rest = words[1:]
    if command in ("status", "settings", "pause", "resume") and not rest:
        return Step(text, "bot", [*base, command, *paths])
    if command == "logs" and len(rest) <= 1 and all(word.isdigit() for word in rest):
        return Step(text, "bot", [*base, "logs", *rest, *paths])
    if command == "set" and rest and len(rest) % 2 == 0:
        for key, value in zip(rest[0::2], rest[1::2]):
            try:
                dials.parse_value(key, value)
            except ValueError as error:
                return Step(text, "error", note=str(error))
        return Step(text, "bot", [*base, "set", *rest, *paths])
    if command == "flatten" and not rest:
        return Step(text, "bot", [*base, "flatten", *paths], True, "Sells every coin the bot holds.")
    if command == "reset":
        cash = [word.lstrip("$").replace(",", "") for word in rest if word != "--cash"]
        if len(cash) <= 1 and all(re.fullmatch(r"\d+(\.\d+)?", word) for word in cash):
            return Step(text, "bot", [*base, "reset", "--yes", *(["--cash", cash[0]] if cash else []), *paths], True, "Wipes every pretend trade and starts the account again.")
    return Step(text, "error", note=BOT_HELP)


def _pm2_step(text: str, words: list[str]) -> Step | None:
    pm2 = shutil.which("pm2")
    verb = words[0].casefold() if words else "status"
    known = verb in ("status", "list", "ls") and len(words) <= 1 or verb in ("logs", "restart", "stop", "start") and len(words) >= 2 and words[1] in PM2_NAMES
    if not known:
        return None
    if pm2 is None:
        return Step(text, "error", note="PM2 is not installed on this PC.")
    if verb in ("status", "list", "ls"):
        return Step(text, "pm2", [pm2, "status"])
    if verb == "logs":
        lines = next((word for word in words[2:] if word.isdigit()), "40")
        return Step(text, "pm2", [pm2, "logs", words[1], "--nostream", "--lines", lines])
    if len(words) == 2:
        return Step(text, "pm2", [pm2, verb, words[1]], True, f"{verb.capitalize()}s the background process {words[1]}.")
    return None


def build_step(text: str, settings: Path, db: Path) -> Step:
    """Turn one command line into something safe to run: a checked bot or PM2 command, or a shell line that waits for a go-ahead."""
    text = text.strip()
    try:
        words = shlex.split(text)
    except ValueError:
        words = []
    head = words[0].casefold() if words else ""
    if head == "bot":
        return _bot_step(text, words[1:], settings, db)
    if head == "pm2":
        step = _pm2_step(text, words[1:])
        if step is not None:
            return step
    if not text:
        return Step(text, "error", note="That command was empty.")
    return Step(text, "shell", shell_argv(text), True, "Not one of the bot's own commands, so it waits for your go-ahead.")


def run_step(step: Step) -> dict[str, Any]:
    if step.kind == "error":
        return {"ok": False, "exit": None, "output": step.note, "seconds": 0}
    started = time.time()
    environment = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "NO_COLOR": "1", "FORCE_COLOR": "0"}
    try:
        done = subprocess.run(step.argv, capture_output=True, timeout=COMMAND_SECONDS, cwd=str(RUN_PY.parent), env=environment, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
        code: int | None = done.returncode
        output = (done.stdout + done.stderr).decode("utf-8", "replace")
    except subprocess.TimeoutExpired as error:
        code = None
        output = ((error.stdout or b"") + (error.stderr or b"")).decode("utf-8", "replace") + f"\nStopped: it ran longer than {COMMAND_SECONDS} seconds."
    except OSError as error:
        code = None
        output = f"The command could not be started ({error})."
    output = ANSI.sub("", output).replace("\r\n", "\n").strip("\n")
    if len(output) > OUTPUT_LIMIT:
        output = output[:OUTPUT_LIMIT] + "\n… (the rest was cut off)"
    return {"ok": code == 0, "exit": code, "output": output or "(no output)", "seconds": round(time.time() - started, 1)}


def build_system(values: dials.Values) -> str:
    lines = []
    for dial in dials.DIALS:
        if dial["type"] == "toggle":
            allowed = "on or off"
        elif dial["type"] == "choice":
            allowed = " / ".join(f"{choice} ({label})" for choice, label in dial["choices"])
        else:
            allowed = f"{dial['min']} to {dial['max']} {dial.get('unit', '')}".strip()
        current = values.get(dial["key"], dial["default"])
        current = ("on" if current else "off") if isinstance(current, bool) else current
        lines.append(f"{dial['key']} | {dial['label']}. {dial.get('help', '')} | {allowed} | {current}")
    return f"""You turn one request from the owner of a paper-trading bot into commands that a local console runs on their Windows PC. The bot trades pretend money only and never places a real order.

Answer only through the structured output: "say" (one or two plain sentences telling the owner what the commands do, or the answer itself when no command is needed) and "commands" (zero to {MAX_COMMANDS} command lines, in the order to run them).

Commands you can use:
- bot status: show the account, open positions and recent trades.
- bot set <dial> <value> [<dial> <value> ...]: change one or more dials. Use the dial keys exactly as listed below.
- bot pause / bot resume: stop or allow new buys. Open positions are still managed while paused.
- bot flatten: sell every coin the bot holds.
- bot reset [--cash <dollars>]: wipe every pretend trade and start the account again.
- bot settings: print every dial and its value.
- bot logs [<lines>]: the bot's most recent log lines.
- pm2 status: show which background processes are running.
- pm2 logs <name> [<lines>], pm2 restart <name>, pm2 stop <name>, pm2 start <name>, where <name> is axiom-paper-bot (the bot) or axiom-worker (the Radar tracker).
Anything else must be one Windows PowerShell 5.1 command line (no && or ||). The owner is asked before such a line runs. Use the bot and pm2 commands whenever they can do the job.

Rules:
- Do only what was asked. Never add a reset, flatten, stop, delete or anything else that was not asked for.
- For a loose request such as "be more careful" or "more aggressive", change a few dials that fit and name them in "say".
- When the request is a question that the dial list below answers, answer it in "say" and leave "commands" empty.
- When the request is unclear, or no command can do it, say so in "say" and leave "commands" empty.
- Write "say" in plain words with no markdown.

Dials (key | what it is | allowed values | current value):
""" + "\n".join(lines)


def _claude_environment() -> dict[str, str]:
    """This PC's own Claude sign-in, without the markers a parent Claude session leaves in the environment."""
    inside_session = "CLAUDECODE" in os.environ
    keep = {"CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"}
    environment = {}
    for name, value in os.environ.items():
        upper = name.upper()
        if upper.startswith("CLAUDE") and upper not in keep:
            continue
        if inside_session and upper == "ANTHROPIC_BASE_URL":
            continue
        environment[name] = value
    return environment


class Translator:
    """Asks Claude, through the Claude Code command line with every tool turned off, to write the commands for a request."""

    def __init__(self, executable: str | None = None, model: str | None = None, runner: Callable[..., Any] = subprocess.run):
        self.executable = executable or os.environ.get("AXIOM_CONSOLE_CLAUDE") or shutil.which("claude")
        self.model = model or os.environ.get("AXIOM_CONSOLE_MODEL") or "haiku"
        self.runner = runner
        self.folder = Path(tempfile.mkdtemp(prefix="axiom-console-"))
        self.ready: bool | None = None
        self.detail = "Checking whether Claude is signed in…"

    def _call(self, prompt: str, system: str, schema: bool) -> dict[str, Any]:
        if not self.executable:
            self.ready, self.detail = False, NOT_INSTALLED
            raise TranslatorError(NOT_INSTALLED, True)
        system_file = self.folder / "system.txt"
        system_file.write_text(system, encoding="utf-8")
        argv = [
            self.executable, "-p", "--output-format", "json", "--model", self.model, "--tools", "", "--strict-mcp-config", "--setting-sources", "",
            "--disable-slash-commands", "--no-session-persistence", "--system-prompt-file", str(system_file),
        ]
        if schema:
            argv += ["--json-schema", json.dumps(ANSWER_SCHEMA)]
        try:
            done = self.runner(argv, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=ASK_SECONDS, cwd=str(self.folder), env=_claude_environment(), creationflags=NO_WINDOW)
        except subprocess.TimeoutExpired:
            raise TranslatorError(f"Claude took longer than {ASK_SECONDS} seconds to answer. Try again.") from None
        except OSError as error:
            raise TranslatorError(f"The Claude Code command line could not be started ({error}).") from None
        try:
            reply = json.loads(done.stdout)
        except ValueError:
            reply = {"is_error": True, "result": (done.stdout or done.stderr or "").strip()[:300]}
        text = str(reply.get("result") or "")
        if reply.get("is_error") or done.returncode != 0:
            if "not logged in" in text.casefold() or "/login" in text:
                self.ready, self.detail = False, NOT_SIGNED_IN
                raise TranslatorError(NOT_SIGNED_IN, True)
            raise TranslatorError(f"Claude could not answer ({text[:200] or 'no reason given'}).")
        self.ready, self.detail = True, f"Claude is ready ({self.model})."
        return reply

    def check(self) -> None:
        """Find out whether Claude is signed in. A failure leaves the reason in `detail`."""
        try:
            self._call("Reply with the single word ok.", "Reply with the single word ok.", False)
        except TranslatorError as error:
            if not error.sign_in:
                self.ready, self.detail = False, str(error)

    def ask(self, prompt: str, system: str) -> dict[str, Any]:
        reply = self._call(prompt, system, True)
        answer = reply.get("structured_output")
        if not isinstance(answer, dict):
            text = str(reply.get("result") or "").strip()
            start, end = text.find("{"), text.rfind("}")
            try:
                answer = json.loads(text[start:end + 1]) if start >= 0 and end > start else None
            except ValueError:
                answer = None
        if not isinstance(answer, dict):
            raise TranslatorError("Claude's answer could not be read. Try wording the request differently.")
        commands = answer.get("commands")
        commands = [str(command).strip() for command in commands if str(command).strip()][:MAX_COMMANDS] if isinstance(commands, list) else []
        return {"say": str(answer.get("say") or "").strip(), "commands": commands}


class Console:
    def __init__(self, settings: Path, db: Path, translator: Translator | None = None, key: str | None = None):
        self.settings = settings
        self.db = db
        self.translator = translator or Translator()
        self.key = key or secrets.token_urlsafe(24)
        self.plans: dict[str, list[Step]] = {}
        self.lock = threading.Lock()
        self.cache: tuple[float, dict[str, Any]] | None = None

    def values(self) -> dials.Values:
        try:
            return dials.load_file(self.settings) if self.settings.exists() else dials.defaults()
        except (OSError, ValueError):
            return dials.defaults()

    def ask(self, prompt: str) -> dict[str, Any]:
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("Type a request first.")
        first = prompt.split(None, 1)[0].casefold()
        if prompt.startswith("!"):
            say, commands, source = "", [prompt[1:]], "typed"
        elif first in ("bot", "pm2"):
            say, commands, source = "", [prompt], "typed"
        else:
            answer = self.translator.ask(prompt, build_system(self.values()))
            say, commands, source = answer["say"], answer["commands"], "claude"
        steps = [build_step(command, self.settings, self.db) for command in commands]
        plan = secrets.token_hex(8)
        with self.lock:
            self.plans[plan] = steps
            for old in list(self.plans)[:-60]:
                del self.plans[old]
        return {"id": plan, "say": say, "source": source, "steps": [step.public() for step in steps]}

    def run(self, plan: str, index: int) -> dict[str, Any]:
        with self.lock:
            steps = self.plans.get(plan)
        if steps is None or not 0 <= index < len(steps):
            raise ValueError("That command is no longer available. Ask again.")
        self.cache = None
        return run_step(steps[index])

    def state(self) -> dict[str, Any]:
        if self.cache and time.time() - self.cache[0] < 8:
            return {**self.cache[1], "claude": {"ready": self.translator.ready, "detail": self.translator.detail}}
        processes: dict[str, Any] = {name: None for name in PM2_NAMES}
        pm2 = shutil.which("pm2")
        if pm2:
            try:
                raw = subprocess.run([pm2, "jlist"], capture_output=True, timeout=20, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW).stdout.decode("utf-8", "replace")
                for process in json.loads(raw[raw.index("["):]):
                    details = process.get("pm2_env") or {}
                    if process.get("name") in processes:
                        processes[process["name"]] = {"status": details.get("status"), "restarts": details.get("restart_time"), "since": details.get("pm_uptime")}
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
        account = run_step(build_step("bot status", self.settings, self.db))
        state = {
            "version": VERSION,
            "bot": processes["axiom-paper-bot"],
            "tracker": processes["axiom-worker"],
            "pm2": bool(pm2),
            "paused": self.values()["bot.enabled"] is False,
            "account": "\n".join(account["output"].splitlines()[:2]) if account["ok"] else "",
        }
        self.cache = (time.time(), state)
        return {**state, "claude": {"ready": self.translator.ready, "detail": self.translator.detail}}


def handler_for(console: Console) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "AxiomConsole"

        def log_message(self, *_: Any) -> None:
            pass

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            self._send(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

        def _local(self) -> bool:
            port = self.server.server_address[1]
            host = (self.headers.get("Host") or "").lower()
            origin = (self.headers.get("Origin") or "").lower()
            return host in (f"127.0.0.1:{port}", f"localhost:{port}") and origin in ("", f"http://127.0.0.1:{port}", f"http://localhost:{port}")

        def _trusted(self) -> bool:
            return self._local() and secrets.compare_digest((self.headers.get("X-Console-Key") or "").encode(), console.key.encode())

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html") and self._local():
                self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            elif path == "/api/state" and self._trusted():
                self._json(200, console.state())
            elif path.startswith("/api/"):
                self._json(403, {"error": "This page's key did not match. Open the console again with: python scripts/axiom-paper-bot/run.py console"})
            else:
                self._send(404, b"Not found.", "text/plain; charset=utf-8")

        def do_POST(self) -> None:
            path = self.path.split("?", 1)[0]
            length = int(self.headers.get("Content-Length") or 0) if (self.headers.get("Content-Length") or "0").isdigit() else 0
            raw = self.rfile.read(length) if 0 < length <= 20_000 else b""
            if not self._trusted():
                self._json(403, {"error": "This page's key did not match. Open the console again with: python scripts/axiom-paper-bot/run.py console"})
                return
            try:
                if not (self.headers.get("Content-Type") or "").startswith("application/json") or not raw:
                    raise ValueError("The request could not be read.")
                body = json.loads(raw)
                if not isinstance(body, dict):
                    raise ValueError("The request could not be read.")
                if path == "/api/ask":
                    self._json(200, console.ask(str(body.get("prompt") or "")[:4000]))
                elif path == "/api/run":
                    self._json(200, console.run(str(body.get("id") or ""), int(body.get("index") if isinstance(body.get("index"), int) else -1)))
                elif path == "/api/check":
                    console.translator.check()
                    self._json(200, {"claude": {"ready": console.translator.ready, "detail": console.translator.detail}})
                else:
                    self._json(404, {"error": "Not found."})
            except TranslatorError as error:
                self._json(503, {"error": str(error), "signIn": error.sign_in})
            except ValueError as error:
                self._json(400, {"error": str(error) or "The request could not be read."})

    return Handler


def load_key(settings: Path) -> str:
    """The console's private key, made once and kept beside the settings so a saved link keeps working."""
    path = settings.with_name("console-key.json")
    try:
        key = json.loads(path.read_text(encoding="utf-8")).get("key")
        if isinstance(key, str) and len(key) >= 24:
            return key
    except (OSError, ValueError, AttributeError):
        pass
    key = secrets.token_urlsafe(24)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"key": key}), encoding="utf-8")
    return key


def already_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=3) as response:
            return b"axiom-bot-console" in response.read(4000)
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def serve(settings: Path, db: Path, port: int, open_browser: bool) -> int:
    key = load_key(settings)
    address = f"http://127.0.0.1:{port}/"
    if already_running(port):
        print(f"The console is already running at {address}")
        if open_browser:
            webbrowser.open(f"{address}#k={key}")
        return 0
    console = Console(settings, db, key=key)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(console))
    except OSError as error:
        print(f"The console could not start on port {port} ({error}). Try another with --port.", file=sys.stderr)
        return 2
    server.daemon_threads = True
    print(f"Axiom bot console {VERSION} is at {address} Open it with: python scripts/axiom-paper-bot/run.py console", flush=True)
    threading.Thread(target=console.translator.check, daemon=True).start()
    if open_browser:
        webbrowser.open(f"{address}#k={key}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
