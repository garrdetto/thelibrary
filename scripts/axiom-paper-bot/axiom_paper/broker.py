"""Simulated fills. Prices move against the bot the way they would in a constant-product pool:
a buy of $B against a pool holding $Q on the quote side pays spot x (1 + B/Q) on average, and a sale
worth $V receives spot / (1 + V/Q). Q is half of the liquidity figure, which counts both sides."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .models import Position


@dataclass(frozen=True)
class Fill:
    qty: float
    price: float
    gross_usd: float
    fee_usd: float
    net_usd: float
    impact_pct: float


def _quote_side(liquidity: float | None) -> float | None:
    return None if liquidity is None else max(0.0, liquidity) / 2


def buy(spot: float, spend_usd: float, liquidity: float | None, settings: Mapping[str, Any]) -> Fill | None:
    """Spend `spend_usd` in total, fees included. None when fees would eat the whole bet."""
    fee = spend_usd * settings["costs.fee_pct"] / 100 + settings["costs.network_fee_usd"]
    into_pool = spend_usd - fee
    if into_pool <= 0 or spot <= 0:
        return None
    quote = _quote_side(liquidity)
    impact = into_pool / quote if settings["costs.price_impact"] and quote else 0.0
    price = spot * (1 + impact) * (1 + settings["costs.extra_slippage_pct"] / 100)
    return Fill(qty=into_pool / price, price=price, gross_usd=into_pool, fee_usd=fee, net_usd=spend_usd, impact_pct=impact * 100)


def sell(spot: float, qty: float, liquidity: float | None, modelled: bool, settings: Mapping[str, Any], urgent: bool = False) -> Fill:
    """Sell `qty` coins. `modelled` is false for coins bought with no liquidity figure, which skip price impact.
    `urgent` sells (stops and exits into a falling market) pay the extra stop slippage as well."""
    value = qty * spot
    impact = 0.0
    price = spot
    if settings["costs.price_impact"] and modelled:
        quote = _quote_side(liquidity)
        if quote is not None and quote <= 0:
            price = 0.0
            impact = 1.0
        elif quote:
            impact = value / quote
            price = spot / (1 + impact)
    price *= 1 - settings["costs.extra_slippage_pct"] / 100
    if urgent:
        price *= 1 - settings["costs.stop_slippage_pct"] / 100
    gross = qty * price
    fee = min(gross, gross * settings["costs.fee_pct"] / 100 + settings["costs.network_fee_usd"])
    return Fill(qty=qty, price=price, gross_usd=gross, fee_usd=fee, net_usd=gross - fee, impact_pct=impact * 100)


def open_value(position: Position, settings: Mapping[str, Any]) -> float:
    """What the open part of a position would fetch if sold now, after fees and slippage."""
    if position.qty_open <= 0:
        return 0.0
    return sell(position.last_price, position.qty_open, position.last_liquidity, bool(position.entry_liquidity), settings).net_usd
