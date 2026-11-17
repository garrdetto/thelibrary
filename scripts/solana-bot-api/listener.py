"""
listener.py — finds buy signals and puts them on the detections queue.

Sniper:     every new pump.fun coin (`create` / `create_v2`), from a logsSubscribe
            on the pump.fun program. The new mint is read from the transaction.
Copy-Trade: every successful transaction that mentions the target wallet; when
            the target's balance of a token goes up while its SOL goes down,
            that token is a buy signal.

Both keep one WebSocket open with reconnect + backoff, fetch transactions in
parallel (bounded), and never close the shared RPC client.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

import config
from rpc_client import RpcClient, get_client

CREATE_MARKERS = ("Instruction: Create", "Instruction: CreateV2")

Emit = Callable[..., Any]


# --------------------------------------------------------------------------- #
# Transaction parsing (pure functions, unit-tested)
# --------------------------------------------------------------------------- #
def is_pump_create(logs: List[str]) -> bool:
    return any(marker in line for line in logs for marker in CREATE_MARKERS)


def _account_keys(tx: Dict[str, Any]) -> List[str]:
    message = tx.get("transaction", {}).get("message", {})
    keys = list(message.get("accountKeys", []))
    loaded = (tx.get("meta") or {}).get("loadedAddresses") or {}
    return keys + list(loaded.get("writable", [])) + list(loaded.get("readonly", []))


def new_mints(tx: Dict[str, Any]) -> List[str]:
    """Mints that have token balances after the transaction but none before it."""
    meta = tx.get("meta") or {}
    if meta.get("err") is not None:
        return []
    before = {b.get("mint") for b in meta.get("preTokenBalances") or []}
    found: List[str] = []
    for bal in meta.get("postTokenBalances") or []:
        mint = bal.get("mint")
        if mint and mint != config.WSOL_MINT and mint not in before and mint not in found:
            found.append(mint)
    return found


def wallet_buys(tx: Dict[str, Any], wallet: str) -> List[Dict[str, Any]]:
    """Tokens `wallet` gained in this transaction while spending SOL (or WSOL)."""
    meta = tx.get("meta") or {}
    if meta.get("err") is not None:
        return []

    def by_mint(balances: List[Dict[str, Any]]) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for bal in balances or []:
            if bal.get("owner") == wallet and bal.get("mint"):
                out[bal["mint"]] = out.get(bal["mint"], 0) + int(bal.get("uiTokenAmount", {}).get("amount", "0"))
        return out

    pre, post = by_mint(meta.get("preTokenBalances")), by_mint(meta.get("postTokenBalances"))
    keys = _account_keys(tx)
    sol_delta = 0
    if wallet in keys:
        i = keys.index(wallet)
        pre_sol, post_sol = meta.get("preBalances") or [], meta.get("postBalances") or []
        if i < len(pre_sol) and i < len(post_sol):
            sol_delta = int(post_sol[i]) - int(pre_sol[i])
    wsol_delta = post.get(config.WSOL_MINT, 0) - pre.get(config.WSOL_MINT, 0)
    spent_sol = sol_delta + wsol_delta < 0
    if not spent_sol:
        return []
    buys = []
    for mint in set(pre) | set(post):
        if mint == config.WSOL_MINT:
            continue
        gained = post.get(mint, 0) - pre.get(mint, 0)
        if gained > 0:
            buys.append({"mint": mint, "amount": gained, "sol_spent": -(sol_delta + wsol_delta) / config.LAMPORTS_PER_SOL})
    return buys


async def fetch_tx(rpc: RpcClient, signature: str) -> Optional[Dict[str, Any]]:
    """getTransaction with short retries (the node may not have it the instant the log arrives)."""
    for attempt in range(config.TX_FETCH_RETRIES):
        tx = await rpc.get_transaction(signature)
        if tx:
            return tx
        await asyncio.sleep(config.TX_FETCH_DELAY_S * (attempt + 1))
    return None


# --------------------------------------------------------------------------- #
# WebSocket log subscription with reconnect
# --------------------------------------------------------------------------- #
async def subscribe_logs(
    mention: str,
    on_log: Callable[[Dict[str, Any], float], Awaitable[None]],
    emit: Emit,
    *,
    ws_url: Optional[str] = None,
    connect: Optional[Callable[..., Any]] = None,
) -> None:
    import websockets

    connect = connect or websockets.connect
    url = ws_url or config.RPC_WS_URL
    attempt = 0
    while True:
        try:
            async with connect(url, ping_interval=config.WS_PING_S, ping_timeout=config.WS_PING_S, max_size=8 * 1024 * 1024) as ws:
                await ws.send(json.dumps({
                    "jsonrpc": "2.0", "id": 1, "method": "logsSubscribe",
                    "params": [{"mentions": [mention]}, {"commitment": config.COMMITMENT}],
                }))
                ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
                if "error" in ack:
                    raise RuntimeError(ack["error"].get("message", "logsSubscribe refused"))
                emit("info", f"Listening to {short(mention)} on the RPC WebSocket", level="success" if attempt else "info")
                attempt = 0
                async for raw in ws:
                    received = time.perf_counter()
                    msg = json.loads(raw)
                    value = msg.get("params", {}).get("result", {}).get("value")
                    if value:
                        await on_log(value, received)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            attempt += 1
            delay = min(30.0, 0.5 * 2 ** attempt) * (0.7 + random.random() * 0.6)
            emit("error", f"WebSocket dropped ({type(exc).__name__}: {exc}); reconnecting in {delay:.1f}s", level="warning")
            await asyncio.sleep(delay)


def short(value: str, keep: int = 4) -> str:
    return value if len(value) <= keep * 2 + 3 else f"{value[:keep]}…{value[-keep:]}"


# --------------------------------------------------------------------------- #
# Entry point used by bot_adapter / BotManager
# --------------------------------------------------------------------------- #
async def run_listener(settings, detections: asyncio.Queue, emit: Emit, *, rpc: Optional[RpcClient] = None, connect=None) -> None:
    rpc = rpc or get_client()
    gate = asyncio.Semaphore(config.LISTENER_CONCURRENCY)
    seen: Set[str] = set()
    pending: Set[asyncio.Task] = set()
    copy = settings.mode == "copytrade"
    target = settings.target_wallet

    async def handle(value: Dict[str, Any], received: float) -> None:
        signature = value.get("signature")
        if not signature or value.get("err") is not None or signature in seen:
            return
        if not copy and not is_pump_create(value.get("logs") or []):
            return
        seen.add(signature)
        if len(seen) > 5000:
            seen.clear()
        async with gate:
            try:
                tx = await fetch_tx(rpc, signature)
            except Exception as exc:
                emit("error", f"Could not read {short(signature, 6)}: {exc}", level="warning", signature=signature)
                return
        if tx is None:
            return
        latency = (time.perf_counter() - received) * 1000
        if copy:
            for buy in wallet_buys(tx, target):
                emit("detection", f"Target bought {buy['sol_spent']:.4f} SOL of a coin", mint=buy["mint"], signature=signature, latency_ms=latency)
                await detections.put({"mint": buy["mint"], "source": "copytrade", "signature": signature, "detected_at": received})
        else:
            for mint in new_mints(tx)[:1]:
                emit("detection", "New pump.fun coin", mint=mint, signature=signature, latency_ms=latency)
                await detections.put({"mint": mint, "source": "pumpfun", "signature": signature, "detected_at": received})

    async def on_log(value: Dict[str, Any], received: float) -> None:
        task = asyncio.create_task(handle(value, received))
        pending.add(task)
        task.add_done_callback(pending.discard)

    try:
        await subscribe_logs(target if copy else config.PUMP_FUN_PROGRAM, on_log, emit, connect=connect)
    finally:
        for task in list(pending):
            task.cancel()
