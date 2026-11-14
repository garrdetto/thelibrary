"""Live prices for the coins the bot holds, from DexScreener's public API (the tracker's own price source)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass

API = "https://api.dexscreener.com/tokens/v1/solana/"


@dataclass(frozen=True)
class Quote:
    price: float
    liquidity: float | None


def fetch_prices(pairs_by_mint: dict[str, str | None], timeout: float = 4.0) -> dict[str, Quote]:
    """Price and liquidity per mint. The coin's own pair is used when listed, otherwise its deepest pool."""
    quotes: dict[str, Quote] = {}
    mints = list(pairs_by_mint)
    for start in range(0, len(mints), 30):
        group = mints[start:start + 30]
        request = urllib.request.Request(API + ",".join(group), headers={"Accept": "application/json", "User-Agent": "axiom-paper-bot"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                listed = json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            continue
        if not isinstance(listed, list):
            continue
        best: dict[str, tuple[bool, float, Quote]] = {}
        for pair in listed:
            try:
                mint = pair["baseToken"]["address"]
                price = float(pair["priceUsd"])
            except (KeyError, TypeError, ValueError):
                continue
            if mint not in pairs_by_mint or not price > 0:
                continue
            liquidity = (pair.get("liquidity") or {}).get("usd")
            liquidity = float(liquidity) if isinstance(liquidity, (int, float)) else None
            rank = (pair.get("pairAddress") == pairs_by_mint[mint], liquidity or 0.0)
            if mint not in best or rank > best[mint][:2]:
                best[mint] = (*rank, Quote(price, liquidity))
        quotes.update({mint: entry[2] for mint, entry in best.items()})
    return quotes
