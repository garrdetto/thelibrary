"""
executor.py — turns detections into buys: Jupiter quote → build → sign → simulate
→ (dry run stops here) → send → confirm.

Safety rails, all enforced here as well as in the UI:
  * MAX_BUY_AMOUNT_SOL (also checked by BotManager on start)
  * MAX_TRADES_PER_RUN live buys per start, then it only watches
  * MIN_SOL_RESERVE always left in the wallet for fees
  * MAX_PRICE_IMPACT_PCT, MAX_SIGNAL_AGE_S
  * one buy per coin per run; the transaction's fee payer must be this wallet
  * a failed simulation never gets sent
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional, Set

import config
from jupiter import Jupiter, JupiterError
from listener import short
from rpc_client import RpcClient, Wallet, get_client, get_wallet


def _ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000


class Executor:
    def __init__(self, settings, emit, *, rpc: Optional[RpcClient] = None, wallet: Optional[Wallet] = None, jupiter: Optional[Jupiter] = None) -> None:
        self.settings = settings
        self.emit = emit
        self.rpc = rpc or get_client()
        self.wallet = wallet or get_wallet()
        self.jupiter = jupiter or Jupiter()
        self._own_jupiter = jupiter is None
        self.bought: Set[str] = set()
        self.live_trades = 0
        self._gate = asyncio.Semaphore(max(1, config.EXECUTOR_CONCURRENCY))
        self._lock = asyncio.Lock()

    async def run(self, detections: asyncio.Queue) -> None:
        pending: Set[asyncio.Task] = set()
        if not self.settings.dry_run and not self.wallet.can_sign:
            raise RuntimeError("LIVE mode needs PRIVATE_KEY or KEYPAIR_PATH in .env")
        if not self.wallet.can_sign:
            self.emit("info", "No wallet key configured: dry run will quote only, without simulating.", level="warning")
        try:
            while True:
                item = await detections.get()
                task = asyncio.create_task(self._guarded(item))
                pending.add(task)
                task.add_done_callback(pending.discard)
        finally:
            for task in list(pending):
                task.cancel()
            if self._own_jupiter:
                await self.jupiter.aclose()

    async def _guarded(self, item: Dict[str, Any]) -> None:
        mint = item.get("mint", "")
        try:
            async with self._gate:
                await self.handle(item)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.emit("error", f"Buy failed: {type(exc).__name__}: {exc}", level="error", mint=mint)

    async def handle(self, item: Dict[str, Any]) -> Optional[str]:
        settings, emit = self.settings, self.emit
        mint: str = item["mint"]
        detected_at: float = item.get("detected_at", time.perf_counter())

        async with self._lock:
            if mint in self.bought:
                return None
            if not settings.dry_run and self.live_trades >= config.MAX_TRADES_PER_RUN:
                emit("info", f"Skipped: reached MAX_TRADES_PER_RUN ({config.MAX_TRADES_PER_RUN}). Restart the bot to allow more.", level="warning", mint=mint)
                return None
            self.bought.add(mint)

        age = time.perf_counter() - detected_at
        if age > config.MAX_SIGNAL_AGE_S:
            emit("info", f"Skipped: signal is {age:.0f}s old", level="warning", mint=mint)
            return None

        lamports = int(round(settings.buy_amount_sol * config.LAMPORTS_PER_SOL))

        if not settings.dry_run and self.wallet.address:
            balance = await self.rpc.get_balance_lamports(self.wallet.address)
            needed = lamports + int(config.MIN_SOL_RESERVE * config.LAMPORTS_PER_SOL)
            if balance < needed:
                emit("error", f"Skipped: wallet has {balance / config.LAMPORTS_PER_SOL:.4f} SOL, needs {needed / config.LAMPORTS_PER_SOL:.4f} (buy + reserve)", level="error", mint=mint)
                self.bought.discard(mint)
                return None

        quote = None
        start = time.perf_counter()
        for attempt in range(max(1, config.QUOTE_RETRIES)):
            try:
                quote = await self.jupiter.quote_buy(mint, lamports, settings.slippage_bps)
                break
            except JupiterError as exc:
                if not exc.no_route or attempt == config.QUOTE_RETRIES - 1:
                    emit("quote", f"No quote: {exc}", level="error", mint=mint, latency_ms=_ms(start))
                    return None
                await asyncio.sleep(config.QUOTE_RETRY_DELAY_S)
        assert quote is not None
        emit("quote", f"Jupiter quote: {settings.buy_amount_sol} SOL → {quote.out_amount:,} units via {quote.route}, impact {quote.price_impact_pct:.2f}%", mint=mint, latency_ms=_ms(start))

        if quote.price_impact_pct > config.MAX_PRICE_IMPACT_PCT:
            emit("quote", f"Skipped: price impact {quote.price_impact_pct:.1f}% is over {config.MAX_PRICE_IMPACT_PCT:.0f}%", level="warning", mint=mint)
            return None

        if not self.wallet.address:
            emit("trade", "DRY RUN: quote only (no wallet configured)", level="success", mint=mint, latency_ms=_ms(detected_at))
            return None

        start = time.perf_counter()
        built = await self.jupiter.build_swap(quote, self.wallet.address)
        if not self.wallet.can_sign:
            emit("trade", "DRY RUN: swap built, not simulated (no key)", level="success", mint=mint, latency_ms=_ms(detected_at))
            return None
        signed = self.wallet.sign(built["tx_bytes"])

        sim = await self.rpc.simulate(signed)
        if sim.get("err") is not None:
            logs = sim.get("logs") or []
            hint = next((line for line in reversed(logs) if "Error" in line or "failed" in line), "")
            emit("simulation", f"Simulation failed: {sim['err']} {hint}".strip(), level="error", mint=mint, latency_ms=_ms(start))
            return None
        units = sim.get("unitsConsumed")
        emit("simulation", f"Simulation ok{f' ({units:,} CU)' if units else ''}", mint=mint, latency_ms=_ms(start))

        if settings.dry_run:
            emit("trade", f"DRY RUN buy {settings.buy_amount_sol} SOL (not sent)", level="success", mint=mint, latency_ms=_ms(detected_at))
            return None

        start = time.perf_counter()
        signature = await self.rpc.send(signed)
        async with self._lock:
            self.live_trades += 1
        emit("broadcast", "Transaction sent", mint=mint, signature=signature, latency_ms=_ms(start))

        status = await self.confirm(signature)
        if status == "confirmed":
            emit("trade", f"Bought {settings.buy_amount_sol} SOL of {short(mint)}", level="success", mint=mint, signature=signature, latency_ms=_ms(detected_at))
        else:
            emit("trade", f"Buy not confirmed: {status}", level="error", mint=mint, signature=signature, latency_ms=_ms(detected_at))
        return signature

    async def confirm(self, signature: str) -> str:
        deadline = time.monotonic() + config.CONFIRM_TIMEOUT_S
        while time.monotonic() < deadline:
            try:
                status = await self.rpc.signature_status(signature)
            except Exception:
                status = None
            if status:
                if status.get("err") is not None:
                    return f"failed on-chain ({status['err']})"
                if status.get("confirmationStatus") in ("confirmed", "finalized"):
                    return "confirmed"
            await asyncio.sleep(0.8)
        return f"timed out after {config.CONFIRM_TIMEOUT_S:.0f}s (check Solscan)"


async def run_executor(settings, detections: asyncio.Queue, emit, **kwargs: Any) -> None:
    await Executor(settings, emit, **kwargs).run(detections)
