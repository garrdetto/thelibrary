"""
main.py — run the Axiom Bot from a terminal, without the web API.

    python main.py --mode sniper --buy 0.01 --slippage 3           # dry run (default)
    python main.py --mode copytrade --target <wallet> --buy 0.02
    python main.py --mode sniper --buy 0.01 --live                  # real transactions

Ctrl+C stops it cleanly. For the website / admin tab use: uvicorn api:app
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys

from bot_manager import BotConfigError, BotManager

COLORS = {"error": "\033[31m", "warning": "\033[33m", "success": "\033[32m", "info": "\033[0m", "debug": "\033[2m"}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Axiom Bot: Solana sniper / copy-trader")
    parser.add_argument("--mode", choices=("sniper", "copytrade"), default="sniper")
    parser.add_argument("--target", default="", help="wallet to copy (copytrade mode)")
    parser.add_argument("--buy", type=float, required=True, help="SOL per buy")
    parser.add_argument("--slippage", type=float, default=3.0, help="slippage in percent (3 = 3%%)")
    parser.add_argument("--live", action="store_true", help="sign and send real transactions (default: dry run)")
    return parser.parse_args(argv)


async def main(argv=None) -> int:
    args = parse_args(argv)
    manager = BotManager()
    queue = manager.subscribe()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    if args.live:
        print("\033[31mLIVE MODE: real SOL will be spent.\033[0m Starting in 5 seconds, Ctrl+C to cancel.")
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
            return 0
        except asyncio.TimeoutError:
            pass

    try:
        await manager.start({
            "mode": args.mode,
            "target_wallet": args.target,
            "buy_amount_sol": args.buy,
            "slippage_bps": int(round(args.slippage * 100)),
            "dry_run": not args.live,
        })
    except BotConfigError as exc:
        print(f"Can't start: {exc}", file=sys.stderr)
        await manager.aclose()
        return 2

    async def printer():
        while True:
            e = await queue.get()
            extra = "".join(f" {k}={e[k]}" for k in ("mint", "signature") if e.get(k))
            lat = f" ({e['latency_ms']:.0f} ms)" if e.get("latency_ms") is not None else ""
            print(f"{COLORS.get(e['level'], '')}{e['timestamp'][11:19]} {e['event_type']:<10} {e['message']}{extra}{lat}\033[0m", flush=True)
            if e["event_type"] == "status" and "stopped" in e["message"]:
                stop.set()

    printer_task = asyncio.create_task(printer())
    await stop.wait()
    await manager.aclose()
    await asyncio.sleep(0.05)
    printer_task.cancel()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
