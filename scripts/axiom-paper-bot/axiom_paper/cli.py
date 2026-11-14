"""Command line: run the bot, show its account, change its dials, send it orders, and open the prompt console."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from . import VERSION
from . import settings as dials
from .dashboard import Keys, PlainLog, Screen, build, enable_ansi, money, signed_money
from .engine import Engine
from .ledger import Ledger
from .site import FileSite, Site, find_credentials

REPO = Path(__file__).resolve().parents[3]
DEFAULT_SETTINGS = REPO / "data" / "paper-bot.toml"
DEFAULT_DB = REPO / "data" / "axiom-paper.db"


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="axiom-paper-bot", description="Trades the Axiom Radar feed with pretend money. Nothing here places a real order.")
    parser.add_argument("command", nargs="?", default="run", choices=["run", "status", "settings", "set", "pause", "resume", "flatten", "reset", "logs", "console"], help="run (default), status, settings, set <dial> <value>, pause, resume, flatten, reset, logs [lines] or console")
    parser.add_argument("rest", nargs="*", help="with set: pairs of dial and value; with logs: how many lines")
    parser.add_argument("--env", type=Path, help="a .env file holding AXIOM_RADAR_TOKEN and AXIOM_SITE_ORIGIN (default: .env here or in the repo)")
    parser.add_argument("--origin", help="the site to pull from (overrides AXIOM_SITE_ORIGIN)")
    parser.add_argument("--settings", type=Path, default=DEFAULT_SETTINGS, help=f"the settings file (default {DEFAULT_SETTINGS})")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"the account database (default {DEFAULT_DB})")
    parser.add_argument("--offline", type=Path, help="use a saved Radar payload (JSON) instead of the site")
    parser.add_argument("--no-dashboard", action="store_true", help="print one line per event instead of the live view")
    parser.add_argument("--once", action="store_true", help="pull once, act on it, print the account and stop")
    parser.add_argument("--cash", type=float, help="with reset: the new starting cash")
    parser.add_argument("--yes", action="store_true", help="with reset: do not ask first")
    parser.add_argument("--port", type=int, default=8793, help="with console: the local port (default 8793)")
    parser.add_argument("--no-open", action="store_true", help="with console: do not open the browser")
    parser.add_argument("--version", action="version", version=VERSION)
    return parser.parse_args(argv)


def hold_lock(db: Path) -> Any:
    """Keep a second copy of the bot from trading the same account. The lock goes when the process ends."""
    path = db.with_suffix(".lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def print_account(engine: Engine) -> None:
    account = engine.account()
    stats = engine.ledger.stats()
    print(f"Account {money(account['equity'])}  {signed_money(account['totalPnl'])} ({account['totalPnlPct']:+.1f}%)  cash {money(account['cash'])}")
    win_rate = "-" if stats["winRate"] is None else f"{stats['winRate'] * 100:.0f}%"
    print(f"Closed trades {stats['trades']}  wins {win_rate}  fees {money(stats['feesPaid'])}  drawdown {account['drawdownPct']:.1f}%")
    for row in engine.position_rows():
        print(f"  open   {row['symbol']:<12} cost {money(row['costUsd']):>10}  value {money(row['valueUsd']):>10}  {signed_money(row['pnlUsd'])} ({row['pnlPct']:+.1f}%)")
    for trade in engine.trade_rows(10):
        print(f"  closed {trade['symbol']:<12} {signed_money(trade['pnlUsd']):>10} ({trade['pnlPct']:+.1f}%)  {trade['reason']}")
    if engine.candidates:
        print("Closest to a buy:")
        for candidate in engine.candidates[:6]:
            print(f"  {candidate['symbol']:<12} score {candidate['score']:>3}  {candidate['reason']}")


def run(args: argparse.Namespace) -> int:
    if args.offline:
        site: Any = FileSite(args.offline)
    else:
        origin, token = find_credentials([path for path in (args.env, Path.cwd() / ".env", REPO / ".env") if path])
        if len(token) < 24:
            print("AXIOM_RADAR_TOKEN was not found. Put it in .env (the file the tracker uses) or point at that file with --env.", file=sys.stderr)
            return 2
        site = Site(args.origin or origin, token)
    lock = hold_lock(args.db)
    if lock is None:
        print("The bot is already running on this account. Stop the other copy first.", file=sys.stderr)
        return 2
    ledger = Ledger(args.db)
    engine = Engine(ledger, site, args.settings, background=not args.once)
    try:
        if args.once:
            engine.step()
            if not engine.error:
                engine.report_due = True
                engine.sync()
            if engine.error:
                print(engine.error, file=sys.stderr)
            print_account(engine)
            return 1 if engine.error else 0
        live = not args.no_dashboard and enable_ansi()
        if not live:
            log = PlainLog(engine)
            print(f"Axiom paper bot {VERSION} started. Settings: {args.settings}", flush=True)
            while True:
                engine.step()
                log.tick()
                time.sleep(0.5)
        screen = Screen(color="NO_COLOR" not in os.environ)
        sys.stdout.write("\x1b[?1049h\x1b[?25l")
        try:
            with Keys() as keys:
                while True:
                    engine.step()
                    key = keys.read()
                    if key == "q":
                        break
                    if key == "p":
                        engine.change_setting("bot.enabled", not engine.values["bot.enabled"])
                    if key == "f":
                        engine.flatten("Closed from the dashboard")
                    sys.stdout.write(screen.render(build(engine, str(args.settings), keys.active)))
                    sys.stdout.flush()
                    time.sleep(0.5)
        finally:
            sys.stdout.write("\x1b[?25h\x1b[?1049l")
            sys.stdout.flush()
        print_account(engine)
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        ledger.close()
        lock.close()


def status(args: argparse.Namespace) -> int:
    if not args.db.exists():
        print("There is no account yet. Start the bot first.")
        return 0
    ledger = Ledger(args.db)
    try:
        print_account(Engine(ledger, None, args.settings if args.settings.exists() else None, observer=True))
    finally:
        ledger.close()
    return 0


def send_to_running_bot(settings: Path, order: dict[str, Any]) -> None:
    """Leave an order where the running bot looks on every pass. It reads the file once and removes it."""
    path = settings.with_suffix(".inbox.json")
    try:
        orders = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        orders = {}
    if not isinstance(orders, dict):
        orders = {}
    orders.update(order)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(orders), encoding="utf-8")
    os.replace(temporary, path)


def reset(args: argparse.Namespace) -> int:
    values = dials.load_file(args.settings) if args.settings.exists() else dials.defaults()
    cash = dials.clean("account.starting_cash", args.cash) if args.cash is not None else values["account.starting_cash"]
    if not args.yes and input("This wipes every pretend trade and starts the account again. Type RESET to go ahead: ").strip() != "RESET":
        print("Nothing was changed.")
        return 0
    now = int(time.time() * 1000)
    lock = hold_lock(args.db)
    if lock is None:
        send_to_running_bot(args.settings, {"reset": now, "cash": cash})
        print(f"Sent. The running bot starts the account again with {money(cash)} within a second or two.")
        return 0
    ledger = Ledger(args.db)
    try:
        ledger.reset(cash, now)
        print(f"The account starts again with {money(cash)}.")
    finally:
        ledger.close()
        lock.close()
    return 0


def flatten(args: argparse.Namespace) -> int:
    lock = hold_lock(args.db)
    if lock is None:
        send_to_running_bot(args.settings, {"flatten": int(time.time() * 1000)})
        print("Sent. The running bot sells every coin it holds within a second or two.")
        return 0
    try:
        if not args.db.exists():
            print("There is no account yet. Start the bot first.")
            return 0
        ledger = Ledger(args.db)
        try:
            closed = Engine(ledger, None, args.settings if args.settings.exists() else None, observer=True).flatten("Closed from the command line")
            print(f"Sold {closed} position{'' if closed == 1 else 's'} at the last known prices." if closed else "The bot holds no coins.")
        finally:
            ledger.close()
    finally:
        lock.close()
    return 0


def set_dials(args: argparse.Namespace, pairs: list[tuple[str, str]] | None = None) -> int:
    if pairs is None:
        if not args.rest or len(args.rest) % 2:
            print("Give pairs of dial and value, for example: set risk.strength 7 exit.stop_loss_pct 30", file=sys.stderr)
            return 2
        pairs = list(zip(args.rest[0::2], args.rest[1::2]))
    values = dials.load_file(args.settings) if args.settings.exists() else dials.defaults()
    before = dict(values)
    for key, text in pairs:
        try:
            values[key] = dials.parse_value(key, text)
        except ValueError as error:
            print(error, file=sys.stderr)
            return 2
    changes = dials.describe_changes(before, values)
    if not changes:
        print("Nothing changed: the dials already have those values.")
        return 0
    dials.save_file(args.settings, values)
    for change in changes:
        print(change)
    print("Saved. A running bot picks this up within a few seconds.")
    return 0


def logs(args: argparse.Namespace) -> int:
    count = int(args.rest[0]) if args.rest and args.rest[0].isdigit() else 30
    folder = Path.home() / ".pm2" / "logs"
    shown = False
    for name, title in (("axiom-paper-bot-out.log", ""), ("axiom-paper-bot-error.log", "Errors")):
        path = folder / name
        if not path.exists() or not path.stat().st_size:
            continue
        with path.open("rb") as handle:
            handle.seek(max(0, path.stat().st_size - 200_000))
            lines = handle.read().decode("utf-8", "replace").splitlines()[-count:]
        if title:
            print(f"--- {title}")
        print("\n".join(lines))
        shown = True
    if not shown:
        print("There is no PM2 log for the bot yet. It appears once the bot runs under PM2 as axiom-paper-bot.")
    return 0


def console(args: argparse.Namespace) -> int:
    from .console import serve
    return serve(args.settings, args.db, args.port, not args.no_open)


def show_settings(args: argparse.Namespace) -> int:
    if not args.settings.exists():
        dials.save_file(args.settings, dials.defaults())
    print(f"Settings file: {args.settings}\n")
    print(dials.to_toml(dials.load_file(args.settings)))
    return 0


def use_utf8_output() -> None:
    """Coin names can hold any characters. A piped log (PM2, a file) on Windows would otherwise fail on them."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv: list[str] | None = None) -> int:
    use_utf8_output()
    args = parse(argv)
    commands = {
        "run": run, "status": status, "settings": show_settings, "set": set_dials, "reset": reset, "flatten": flatten, "logs": logs, "console": console,
        "pause": lambda a: set_dials(a, [("bot.enabled", "off")]),
        "resume": lambda a: set_dials(a, [("bot.enabled", "on")]),
    }
    return commands[args.command](args)
