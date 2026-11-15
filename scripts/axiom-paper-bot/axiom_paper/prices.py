"""Live prices for the coins the bot holds, from DexScreener's public API (the tracker's own price source)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass

API = "https://api.dexscreener.com/tokens/v1/solana/"
SOL_MINT = "So11111111111111111111111111111111111111112"


@dataclass(frozen=True)
class Quote:
    price: float
    liquidity: float | None
    volume_5m: float | None = None
    buys_5m: int | None = None
    sells_5m: int | None = None


def _figure(source: object, key: str) -> float | None:
    value = source.get(key) if isinstance(source, dict) else None
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


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
            trades = (pair.get("txns") or {}).get("m5")
            buys, sells = _figure(trades, "buys"), _figure(trades, "sells")
            quote = Quote(price, liquidity, _figure(pair.get("volume"), "m5"), None if buys is None else int(buys), None if sells is None else int(sells))
            rank = (pair.get("pairAddress") == pairs_by_mint[mint], liquidity or 0.0)
            if mint not in best or rank > best[mint][:2]:
                best[mint] = (*rank, quote)
        quotes.update({mint: entry[2] for mint, entry in best.items()})
    return quotes
