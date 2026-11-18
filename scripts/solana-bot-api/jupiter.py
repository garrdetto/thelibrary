"""
jupiter.py — Jupiter Swap API (v1: /quote then /swap) for SOL → token buys.

Uses https://api.jup.ag/swap/v1 with the JUPITER_API_KEY header (free key at
portal.jup.ag). The base URL is configurable in case Jupiter moves it again.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

import config


class JupiterError(RuntimeError):
    def __init__(self, message: str, *, no_route: bool = False, status: int = 0):
        super().__init__(message)
        self.no_route = no_route
        self.status = status


@dataclass
class Quote:
    raw: Dict[str, Any]
    in_lamports: int
    out_amount: int
    price_impact_pct: float
    route: str


class Jupiter:
    def __init__(self, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        headers = {"Accept": "application/json"}
        if config.JUPITER_API_KEY:
            headers["x-api-key"] = config.JUPITER_API_KEY
        self._http = httpx.AsyncClient(base_url=config.JUPITER_API_URL, headers=headers, timeout=httpx.Timeout(8.0), transport=transport)

    async def quote_buy(self, mint: str, lamports: int, slippage_bps: int) -> Quote:
        resp = await self._http.get(
            "/quote",
            params={
                "inputMint": config.WSOL_MINT,
                "outputMint": mint,
                "amount": str(lamports),
                "slippageBps": str(slippage_bps),
                "restrictIntermediateTokens": "true",
            },
        )
        body = _json(resp)
        if resp.status_code != 200 or "outAmount" not in body:
            message = str(body.get("error") or body.get("message") or f"HTTP {resp.status_code}")
            no_route = resp.status_code in (400, 404) and any(s in message.lower() for s in ("route", "tradable", "not found", "liquidity"))
            if resp.status_code == 401:
                message = "Jupiter rejected the API key (set JUPITER_API_KEY from portal.jup.ag)"
            raise JupiterError(message, no_route=no_route, status=resp.status_code)
        labels = [step.get("swapInfo", {}).get("label", "?") for step in body.get("routePlan", [])]
        return Quote(
            raw=body,
            in_lamports=int(body["inAmount"]),
            out_amount=int(body["outAmount"]),
            price_impact_pct=float(body.get("priceImpactPct") or 0) * 100,
            route=" → ".join(labels) or "direct",
        )

    async def quote_sell(self, mint: str, token_amount: int, slippage_bps: int) -> Quote:
        resp = await self._http.get(
            "/quote",
            params={
                "inputMint": mint,
                "outputMint": config.WSOL_MINT,
                "amount": str(token_amount),
                "slippageBps": str(slippage_bps),
                "restrictIntermediateTokens": "true",
            },
        )
        body = _json(resp)
        if resp.status_code != 200 or "outAmount" not in body:
            message = str(body.get("error") or body.get("message") or f"HTTP {resp.status_code}")
            raise JupiterError(message, no_route=resp.status_code in (400, 404), status=resp.status_code)
        labels = [step.get("swapInfo", {}).get("label", "?") for step in body.get("routePlan", [])]
        return Quote(
            raw=body,
            in_lamports=int(body["outAmount"]),
            out_amount=int(body["inAmount"]),
            price_impact_pct=float(body.get("priceImpactPct") or 0) * 100,
            route=" → ".join(labels) or "direct",
        )

    async def build_swap(self, quote: Quote, user_public_key: str) -> Dict[str, Any]:
        resp = await self._http.post(
            "/swap",
            json={
                "quoteResponse": quote.raw,
                "userPublicKey": user_public_key,
                "wrapAndUnwrapSol": True,
                "dynamicComputeUnitLimit": True,
                "dynamicSlippage": False,
                "prioritizationFeeLamports": {
                    "priorityLevelWithMaxLamports": {
                        "maxLamports": config.PRIORITY_FEE_MAX_LAMPORTS,
                        "priorityLevel": config.PRIORITY_LEVEL,
                    }
                },
            },
        )
        body = _json(resp)
        if resp.status_code != 200 or "swapTransaction" not in body:
            raise JupiterError(str(body.get("error") or body.get("message") or f"HTTP {resp.status_code}"), status=resp.status_code)
        return {
            "tx_bytes": base64.b64decode(body["swapTransaction"]),
            "last_valid_block_height": body.get("lastValidBlockHeight"),
            "priority_fee_lamports": body.get("prioritizationFeeLamports"),
        }

    async def aclose(self) -> None:
        await self._http.aclose()


def _json(resp: httpx.Response) -> Dict[str, Any]:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}
