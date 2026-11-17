"""
market.py — live trade books for new pump.fun coins, fed by the listener's log stream.

Keeps a CoinBook (strategy.py) for every classic-curve launch seen in the last few minutes and for
any coin the bot holds, so the ruleset can score a coin and open positions can be marked on every
trade as it confirms. One Market per running bot; the listener sets `ACTIVE` so the executor can
find it.
"""

from __future__ import annotations

import time
from typing import Callable, Dict, Iterable, Optional, Set

from strategy import CoinBook, LaunchHistory

ACTIVE: Optional["Market"] = None
KEEP_S = 5 * 60  # forget coins this long after launch unless one is held


class Market:
    def __init__(self, keep_s: float = KEEP_S) -> None:
        self.books: Dict[str, CoinBook] = {}
        self.latest_slot = 0
        self.keep_s = keep_s
        self.held: Set[str] = set()
        self.listeners: Dict[str, Callable[[CoinBook, Dict], None]] = {}
        self.history = LaunchHistory()
        self._last_prune = time.monotonic()

    def apply(self, events: Iterable[Dict], slot: int) -> list:
        """Feed one transaction's decoded events. Returns the new classic launches it contained."""
        launches = []
        self.latest_slot = max(self.latest_slot, slot)
        for e in events:
            kind = e["kind"]
            if kind == "create":
                if e["mint"] in self.books:
                    continue
                dev_n, sym_n = self.history.record(e["creator"], e.get("symbol", ""), time.time())
                if e.get("classic"):
                    book = CoinBook(e["mint"], e["creator"], slot, created_at=time.monotonic(), dev_launches=dev_n, sym_dupes=sym_n)
                    self.books[e["mint"]] = book
                    launches.append(book)
            elif kind == "trade":
                book = self.books.get(e["mint"])
                if book is not None:
                    book.add(slot, bool(e["buy"]), int(e["sol"]), int(e["tok"]), e["user"], int(e["vs"]), int(e["vt"]), int(e["rs"]))
                    cb = self.listeners.get(e["mint"])
                    if cb:
                        cb(book, e)
            elif kind == "complete":
                book = self.books.get(e["mint"])
                if book is not None:
                    book.completed = True
                    cb = self.listeners.get(e["mint"])
                    if cb:
                        cb(book, e)
        self._prune()
        return launches

    def watch(self, mint: str, callback: Callable[[CoinBook, Dict], None]) -> None:
        self.held.add(mint)
        self.listeners[mint] = callback

    def unwatch(self, mint: str) -> None:
        self.held.discard(mint)
        self.listeners.pop(mint, None)

    def _prune(self) -> None:
        now = time.monotonic()
        if now - self._last_prune < 10:
            return
        self._last_prune = now
        for mint in [m for m, b in self.books.items() if now - b.created_at > self.keep_s and m not in self.held]:
            del self.books[mint]
