"""Holds back a sudden price move until it lasts, so one stale or wrong quote cannot trigger a sale.

The Radar and DexScreener sometimes hand back a price from a minute earlier: on 2026-11-15 a coin up 68% in a minute
read 40% lower for one pull, and the stop loss sold it. A move bigger than JUMP from the price the bot is using is only
taken once every reading for HOLD_MS agrees with it, and then at the mildest of those readings, since stale quotes mixed
in tend to be the extreme ones. A reading back near the old price cancels the move, unless that source has shown the
same price for FROZEN_MS (a quote that stopped updating proves nothing either way)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Hashable

JUMP = 0.15
HOLD_MS = 15_000
FROZEN_MS = 45_000
FLAT = 0.005


@dataclass
class _Pending:
    first_at: int
    price: float
    up: bool
    readings: int = 1


class PriceGate:
    def __init__(self) -> None:
        self.pending: dict[Hashable, _Pending] = {}
        self.flat: dict[tuple[Hashable, str], tuple[float, int]] = {}

    def _frozen(self, key: Hashable, source: str, price: float, at: int) -> bool:
        seen = self.flat.get((key, source))
        if seen is None or abs(price / seen[0] - 1) > FLAT:
            self.flat[(key, source)] = (price, at)
            return False
        return at - seen[1] >= FROZEN_MS

    def offer(self, key: Hashable, current: float, price: float, at: int, source: str) -> float | None:
        """The price to use now, or None to keep `current` for the moment. `key` names the position or sample."""
        frozen = self._frozen(key, source, price, at)
        if current <= 0 or price <= 0:
            return price if price > 0 else None
        move = price / current - 1
        if abs(move) <= JUMP:
            if key in self.pending:
                if frozen:
                    return None
                del self.pending[key]
            return price
        pending = self.pending.get(key)
        if pending is not None and pending.up == (move > 0):
            pending.readings += 1
            pending.price = min(pending.price, price) if pending.up else max(pending.price, price)
            if pending.readings >= 2 and at - pending.first_at >= HOLD_MS:
                del self.pending[key]
                return pending.price
            return None
        if frozen:
            return None
        self.pending[key] = _Pending(at, price, move > 0)
        return None

    def forget(self, key: Hashable) -> None:
        self.pending.pop(key, None)
        for flat_key in [flat_key for flat_key in self.flat if flat_key[0] == key]:
            del self.flat[flat_key]
