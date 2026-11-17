"""
bot_adapter.py — the one place that touches your existing bot modules.

BotManager calls four hooks. `ProjectHooks` wires them to config.py,
rpc_client.py, listener.py and executor.py.

CONTRACT your listener.py / executor.py need to expose (thin wrappers are fine):

    # listener.py
    async def run_listener(settings, detections: asyncio.Queue, emit) -> None:
        '''Run forever. For each new mint / copy-trade signal:
               emit("detection", "New pool", mint=mint, latency_ms=ms)
               await detections.put({"mint": mint, "detected_at": time.perf_counter(), ...})
        '''

    # executor.py
    async def run_executor(settings, detections: asyncio.Queue, emit) -> None:
        '''Run forever. For each item from `detections`:
               emit("quote", ..., mint=..., latency_ms=...)          # Jupiter quote
               emit("simulation", ..., mint=..., latency_ms=...)     # simulateTransaction
               if settings.dry_run: emit("trade", "DRY RUN buy", level="success", mint=...)
               else: emit("broadcast", ..., signature=sig); emit("trade", ..., signature=sig, level="success")
        '''

`settings` is a bot_manager.BotSettings: .mode, .target_wallet, .buy_amount_sol,
.slippage_bps, .dry_run. `emit` is thread-safe, so it can also be called from
worker threads. Both coroutines must let asyncio.CancelledError propagate
(that is how Stop works) and must NOT close shared HTTP/RPC sessions on cancel.

If the functions are named `run` instead, those are picked up too.
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import logging
from typing import Any, Callable, Dict, Optional

from bot_manager import BotConfigError, BotSettings, setting

log = logging.getLogger("bot_adapter")

LAMPORTS_PER_SOL = 1_000_000_000
_RPC_URL_NAMES = ("RPC_URL", "RPC_HTTP_URL", "SOLANA_RPC_URL", "HELIUS_RPC_URL", "HTTP_RPC_URL")
_PUBKEY_NAMES = ("WALLET_PUBLIC_KEY", "WALLET_ADDRESS", "PUBLIC_KEY")
_SECRET_NAMES = ("PRIVATE_KEY", "WALLET_PRIVATE_KEY", "SOLANA_PRIVATE_KEY")


def _find_entrypoint(module_name: str, candidates: tuple) -> Callable:
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:
        raise BotConfigError(f"Could not import {module_name}.py: {type(exc).__name__}: {exc}") from exc
    for name in candidates:
        fn = getattr(module, name, None)
        if fn is not None and inspect.iscoroutinefunction(fn):
            return fn
    raise BotConfigError(
        f"{module_name}.py must expose `async def {candidates[0]}(settings, detections, emit)` "
        f"(see bot_adapter.py for the contract)"
    )


class ProjectHooks:
    """Default hooks that drive the bot's own modules."""

    def __init__(self) -> None:
        self._http = None  # shared httpx.AsyncClient — survives stop(), closed in aclose()
        self._address: Optional[str] = None

    def preflight(self) -> None:
        _find_entrypoint("listener", ("run_listener", "run"))
        _find_entrypoint("executor", ("run_executor", "run"))

    async def run_listener(self, settings: BotSettings, detections: asyncio.Queue, emit) -> None:
        fn = _find_entrypoint("listener", ("run_listener", "run"))
        await fn(settings, detections, emit)

    async def run_executor(self, settings: BotSettings, detections: asyncio.Queue, emit) -> None:
        fn = _find_entrypoint("executor", ("run_executor", "run"))
        await fn(settings, detections, emit)

    # ---- wallet ------------------------------------------------------------
    async def wallet_info(self) -> Dict[str, Any]:
        # Prefer the bot's own helper if rpc_client.py has one.
        try:
            rpc_client = importlib.import_module("rpc_client")
            helper = getattr(rpc_client, "get_wallet_info", None)
            if helper is not None:
                result = helper()
                if inspect.isawaitable(result):
                    result = await result
                return {"address": result.get("address"), "balance_sol": result.get("balance_sol")}
        except ImportError:
            pass

        address = self._wallet_address()
        if not address:
            return {"address": None, "balance_sol": None, "error": "Wallet public key not configured"}
        rpc_url = next((setting(n) for n in _RPC_URL_NAMES if setting(n)), None)
        if not rpc_url:
            return {"address": address, "balance_sol": None, "error": "RPC URL not configured"}
        return {"address": address, "balance_sol": await self._get_balance(rpc_url, address)}

    def _wallet_address(self) -> Optional[str]:
        if self._address:
            return self._address
        for name in _PUBKEY_NAMES:
            if setting(name):
                self._address = str(setting(name))
                return self._address
        secret = next((setting(n) for n in _SECRET_NAMES if setting(n)), None)
        if secret:
            try:  # solders is what solana-py uses; derive the pubkey without exposing the key
                from solders.keypair import Keypair

                self._address = str(Keypair.from_base58_string(str(secret)).pubkey())
            except Exception as exc:
                log.warning("Could not derive wallet address from private key: %s", type(exc).__name__)
        return self._address

    async def _get_balance(self, rpc_url: str, address: str) -> Optional[float]:
        import httpx

        if self._http is None:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(4.0), http2=False)
        resp = await self._http.post(
            rpc_url,
            json={"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [address, {"commitment": "confirmed"}]},
        )
        resp.raise_for_status()
        payload = resp.json()
        if "error" in payload:
            raise RuntimeError(payload["error"].get("message", "RPC error"))
        return payload["result"]["value"] / LAMPORTS_PER_SOL

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None
        # Give the bot's own rpc_client a chance to close its sessions on shutdown.
        try:
            rpc_client = importlib.import_module("rpc_client")
            closer = getattr(rpc_client, "aclose", None) or getattr(rpc_client, "close", None)
            if closer is not None:
                result = closer()
                if inspect.isawaitable(result):
                    await result
        except ImportError:
            pass
        except Exception:  # pragma: no cover
            log.exception("rpc_client close failed")


__all__ = ["ProjectHooks", "LAMPORTS_PER_SOL"]
