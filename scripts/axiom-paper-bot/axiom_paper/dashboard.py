"""The live terminal view, redrawn in place, and the plain log used when there is no terminal."""

from __future__ import annotations

import os
import shutil
import sys
import time
from datetime import datetime
from typing import Any

from .engine import Engine
from .money import both, signed, small_sol, sol, usd

RESET = "\x1b[0m"
STYLES = {"dim": "\x1b[2m", "bold": "\x1b[1m", "up": "\x1b[32m", "down": "\x1b[31m", "warn": "\x1b[33m", "accent": "\x1b[36m", "": ""}
Segment = tuple[str, str]


def enable_ansi() -> bool:
    if not sys.stdout.isatty():
        return False
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if os.name != "nt":
        return True
    try:
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = kernel.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not kernel.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(kernel.SetConsoleMode(handle, mode.value | 0x0004))
    except (OSError, AttributeError):
        return False


def clock(timestamp: int | float, seconds: bool = False) -> str:
    return datetime.fromtimestamp(timestamp / 1000).strftime("%H:%M:%S" if seconds else "%H:%M")


def price(value: float | None) -> str:
    if value is None:
        return "-"
    if value >= 1:
        return f"${value:,.4f}"
    return f"${value:.10f}".rstrip("0") if value > 0 else "$0"


def tone(value: float) -> str:
    return "up" if value > 0 else "down" if value < 0 else ""


def minutes(value: float) -> str:
    return f"{value:.0f}m" if value < 90 else f"{value / 60:.1f}h"


def fit(text: str, width: int, right: bool = False) -> str:
    text = text if len(text) <= width else text[: max(0, width - 1)] + "…"
    return text.rjust(width) if right else text.ljust(width)


class Screen:
    def __init__(self, color: bool):
        self.color = color

    def render(self, lines: list[list[Segment]]) -> str:
        width = shutil.get_terminal_size((110, 40)).columns
        height = shutil.get_terminal_size((110, 40)).lines
        output = ["\x1b[H"]
        for segments in lines[: max(1, height - 1)]:
            room = width - 1
            for text, style in segments:
                if room <= 0:
                    break
                text = text[:room]
                room -= len(text)
                output.append(f"{STYLES[style]}{text}{RESET}" if self.color and style else text)
            output.append("\x1b[K\n")
        output.append("\x1b[J")
        return "".join(output)


def buy_plan(values: dict[str, Any]) -> str:
    if values["risk.buy_mode"] == "fixed":
        cap = values["risk.max_per_coin_sol"]
        return f"{sol(values['risk.buy_amount_sol'])} a buy" + (f", {sol(cap)} a coin at most" if cap > 0 else "")
    return f"{values['risk.position_pct']}% of the account a buy, at risk strength {values['risk.strength']}/10"


def build(engine: Engine, settings_path: str, keys: bool) -> list[list[Segment]]:
    account = engine.account()
    stats = engine.ledger.stats()
    state, note = engine.status()
    age = engine.feed_age()
    now = engine.now()
    rate = engine.sol_usd
    fee = engine.fee()
    lines: list[list[Segment]] = []
    label = {"running": ("● buying", "up"), "paused": ("● paused", "warn"), "holding": ("● not buying", "warn")}[state]
    radar = "waiting for the first reading" if age is None else f"{'live' if engine.feed_live else 'not live'}, {age:.0f}s old, {len(engine.coins)} coins"
    lines.append([(" AXIOM PAPER BOT ", "bold"), ("  ", ""), label, ("   Radar: ", "dim"), (radar, "" if engine.feed_live else "warn"), ("   SOL ", "dim"), (usd(rate) if rate else "waiting", "accent"), ("   ", ""), (clock(now, True), "dim")])
    problem = engine.error or engine.settings_error or note
    lines.append([(f" {problem}" if problem else " Pretend SOL only. No real orders are placed.", "warn" if problem else "dim")])
    lines.append([])
    lines.append([
        (" Account  ", "dim"), (both(account["equity"], rate), "bold"), ("  ", ""),
        (f"{signed(account['totalPnl'], rate)} ({account['totalPnlPct']:+.1f}%)", tone(account["totalPnl"])),
        ("   Today ", "dim"), (f"{signed(account['dayPnl'], rate)} ({account['dayPnlPct']:+.1f}%)", tone(account["dayPnl"])),
    ])
    lines.append([(" Cash     ", "dim"), (both(account["cash"], rate), ""), ("   In coins ", "dim"), (f"{sol(account['exposure'])} of {sol(account['exposureLimit'])} allowed", "")])
    win_rate = "-" if stats["winRate"] is None else f"{stats['winRate'] * 100:.0f}% wins"
    average = "-" if stats["averageReturnPct"] is None else f"{stats['averageReturnPct']:+.1f}%"
    best = "-" if stats["bestPct"] is None else f"{stats['bestPct']:+.1f}%"
    worst = "-" if stats["worstPct"] is None else f"{stats['worstPct']:+.1f}%"
    lines.append([
        (" Trades   ", "dim"), (f"{stats['trades']} closed", ""), ("   ", ""), (win_rate, ""),
        ("   average ", "dim"), (average, ""), ("   best ", "dim"), (best, "up" if stats["bestPct"] else ""), ("   worst ", "dim"), (worst, "down" if stats["worstPct"] else ""),
        ("   fees ", "dim"), (sol(stats["feesPaid"]), ""), ("   drawdown ", "dim"), (f"{account['drawdownPct']:.1f}%", ""),
    ])
    lines.append([
        (" Buys     ", "dim"), (buy_plan(engine.rules), ""),
        ("   Network fee ", "dim"), (f"{small_sol(fee.total)} a trade", ""), (f" ({fee.source}: priority {small_sol(fee.priority)}, bribe {small_sol(fee.bribe)})", "dim"),
    ])
    lines.append([])
    lines.append([(f" OPEN POSITIONS ({len(engine.positions)} of {engine.rules['risk.max_open_positions']})", "bold")])
    rows = engine.position_rows()
    if not rows:
        lines.append([("  None right now.", "dim")])
    else:
        lines.append([("  " + fit("Coin", 12) + fit("Held", 7) + fit("Cost", 13, True) + fit("Value", 13, True) + fit("Profit", 34, True) + fit("Move", 9, True) + fit("Peak", 9, True) + "   Stop", "dim")])
        for row in rows:
            held = minutes((now - row["openedAt"]) / 60_000)
            name = row["symbol"] + (" ½" if row["targetDone"] else "")
            radar = {"tighten": "  Radar: fading", "exit": "  Radar: exit", "left": "  left the Radar"}.get(row["advice"], "")
            lines.append([
                ("  " + fit(name, 12) + fit(held, 7) + fit(sol(row["cost"]), 13, True) + fit(sol(row["value"]), 13, True), ""),
                (fit(f"{signed(row['pnl'], rate)} ({row['pnlPct']:+.1f}%)", 34, True), tone(row["pnl"])),
                (fit(f"{row['gainPct']:+.1f}%", 9, True), tone(row["gainPct"])),
                (fit(f"{row['peakGainPct']:+.1f}%", 9, True), "dim"),
                ("   " + price(None if row["stop"] is None or not rate else row["stop"] * rate), "dim"),
                (radar, "warn"),
            ])
    lines.append([])
    lines.append([(" LAST TRADES", "bold")])
    trades = engine.trade_rows(6)
    if not trades:
        lines.append([("  None yet.", "dim")])
    for trade in trades:
        lines.append([
            ("  " + clock(trade["closedAt"]) + "  " + fit(trade["symbol"], 12), ""),
            (fit(f"{signed(trade['pnl'], rate)} ({trade['pnlPct']:+.1f}%)", 34, True), tone(trade["pnl"])),
            ("   " + fit(minutes(trade["holdMinutes"]), 7) + (trade["reason"] or ""), "dim"),
        ])
    lines.append([])
    lines.append([(" CLOSEST TO A BUY", "bold")])
    if not engine.candidates:
        lines.append([("  Nothing to show yet.", "dim")])
    for candidate in engine.candidates[:6]:
        lines.append([("  " + fit(candidate["symbol"], 12) + fit(str(candidate["score"]), 5, True) + "   ", ""), (candidate["reason"], "dim")])
    lines.append([])
    lines.append([(" ACTIVITY", "bold")])
    for event in engine.ledger.events(7):
        lines.append([("  " + clock(event["t"], True) + "  ", "dim"), (event["text"], "")])
    lines.append([])
    hint = " P pause or resume buying · F close all positions · Q quit   " if keys else " Ctrl+C to quit   "
    lines.append([(hint, "accent"), (f"Settings: {settings_path} (edit and save)", "dim")])
    return lines


class Keys:
    """Single key presses without Enter. Does nothing when there is no terminal."""

    def __init__(self) -> None:
        self.active = sys.stdin.isatty()
        self.saved: Any = None

    def __enter__(self) -> "Keys":
        if self.active and os.name != "nt":
            try:
                import termios
                import tty
                self.saved = termios.tcgetattr(sys.stdin)
                tty.setcbreak(sys.stdin.fileno())
            except (ImportError, OSError):
                self.active = False
        return self

    def __exit__(self, *_: Any) -> None:
        if self.saved is not None:
            import termios
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, self.saved)

    def read(self) -> str | None:
        if not self.active:
            return None
        if os.name == "nt":
            import msvcrt
            if not msvcrt.kbhit():
                return None
            key = msvcrt.getwch()
            if key in ("\x00", "\xe0"):
                msvcrt.getwch()
                return None
            return key.lower()
        import select
        if select.select([sys.stdin], [], [], 0)[0]:
            return sys.stdin.read(1).lower()
        return None


class PlainLog:
    """One line per event, for PM2 and other places without a terminal."""

    def __init__(self, engine: Engine):
        self.engine = engine
        events = engine.ledger.events(1)
        self.last_id = events[0]["id"] if events else 0
        self.next_summary = 0.0
        self.last_problem: str | None = None

    def tick(self) -> None:
        for event in self.engine.ledger.events_after(self.last_id):
            self.last_id = event["id"]
            print(f"[{clock(event['t'], True)}] {event['text']}", flush=True)
        problem = self.engine.error or self.engine.settings_error
        if problem != self.last_problem:
            self.last_problem = problem
            print(f"[{clock(self.engine.now(), True)}] {problem or 'Connected to the site again.'}", flush=True)
        if time.time() >= self.next_summary:
            self.next_summary = time.time() + 300
            account = self.engine.account()
            state, note = self.engine.status()
            print(f"[{clock(self.engine.now(), True)}] Account {both(account['equity'], self.engine.sol_usd)} ({account['totalPnlPct']:+.1f}%), {len(self.engine.positions)} open, {note or state}", flush=True)
