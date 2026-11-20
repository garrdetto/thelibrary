"""Axiom-only mode (the default): the bot trades on the Axiom tracker's feed alone and asks no other website for prices or fees.

DexScreener quotes, DexScreener's SOL price and the live Jito and Solana fee levels are switched off, not removed:
set AXIOM_SOURCES=all to turn them back on. Fees then come from the priority fee and bribe dials, and the SOL price
from the tracker's feed (or the last one the bot saw, or AXIOM_PAPER_SOL_USD).
"""

from __future__ import annotations

import os

AXIOM_ONLY = os.environ.get("AXIOM_SOURCES", "axiom").strip().lower() != "all"
FALLBACK_SOL_USD = 69.4


def fallback_sol_usd() -> float:
    try:
        value = float(os.environ.get("AXIOM_PAPER_SOL_USD", ""))
        return value if value > 0 else FALLBACK_SOL_USD
    except ValueError:
        return FALLBACK_SOL_USD


def no_prices(_wanted: dict[str, str | None]) -> dict:
    return {}


def no_fee_levels():
    return None


def sol_from_payload(payload: object) -> float | None:
    """The SOL price the tracker put in its feed: a top-level solUsd, else any coin's Wallet Score solUsd."""
    if not isinstance(payload, dict):
        return None
    candidates = [payload.get("solUsd")]
    tokens = payload.get("tokens")
    if isinstance(tokens, list):
        for token in tokens:
            wallets = token.get("wallets") if isinstance(token, dict) else None
            if isinstance(wallets, dict):
                candidates.append(wallets.get("solUsd"))
    for value in candidates:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 1 < value < 100_000:
            return float(value)
    return None
