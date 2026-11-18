"""
executor.py — turns detections into buys: Jupiter quote → build → sign → simulate
→ (dry run stops here) → send → confirm. With a ruleset loaded (strategy.py) every buy
becomes a position that is marked on each trade from market.py and sold by the ruleset's
exit rule through the same Jupiter → simulate → send path (token → SOL). In dry run the
position is on paper: priced on the bonding curve, never sent.

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
import market as market_mod
import pumpcurve
import strategy
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
        self.rules = strategy.load_rules() if settings.mode == "sniper" else None
        self.positions: Dict[str, strategy.Position] = {}
        self.closed = 0
        self.wins = 0
        self.realized_sol = 0.0
        self._tasks: Set[asyncio.Task] = set()
        self._gate = asyncio.Semaphore(max(1, config.EXECUTOR_CONCURRENCY))
        self._lock = asyncio.Lock()

    async def run(self, detections: asyncio.Queue) -> None:
        pending: Set[asyncio.Task] = set()
        if not self.settings.dry_run and not self.wallet.can_sign:
            raise RuntimeError("LIVE mode needs PRIVATE_KEY or KEYPAIR_PATH in .env")
        if not self.wallet.can_sign:
            self.emit("info", "No wallet key configured: dry run will quote only, without simulating.", level="warning")
        clock = asyncio.create_task(self._time_limits()) if self.rules else None
        try:
            while True:
                item = await detections.get()
                task = asyncio.create_task(self._guarded(item))
                pending.add(task)
                task.add_done_callback(pending.discard)
        finally:
            for task in list(pending) + list(self._tasks) + ([clock] if clock else []):
                task.cancel()
            live_left = [p for p in self.positions.values() if p.live]
            if live_left:
                self.emit("info", f"Stopped with {len(live_left)} coin(s) still in the wallet: "
                                  + ", ".join(short(p.mint) for p in live_left) + ". Sell them in your wallet or restart the bot.", level="warning")
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

        if item.get("source") in ("pumpfun", "rules") and config.SKIP_CURVE_VARIANTS:
            if "classic" in item:
                classic = bool(item["classic"])
            else:
                curve = await pumpcurve.fetch(self.rpc, mint)
                classic = curve is not None and curve.classic
            if not classic:
                emit("info", "Skipped: pump.fun curve variant (these rugged most often in testing)", level="info", mint=mint)
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
            self._open_position(mint, lamports)
            return None

        start = time.perf_counter()
        built = await self.jupiter.build_swap(quote, self.wallet.address)
        if not self.wallet.can_sign:
            emit("trade", "DRY RUN: swap built, not simulated (no key)", level="success", mint=mint, latency_ms=_ms(detected_at))
            self._open_position(mint, lamports)
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
            self._open_position(mint, lamports)
            return None

        start = time.perf_counter()
        signature = await self.rpc.send(signed)
        async with self._lock:
            self.live_trades += 1
        emit("broadcast", "Transaction sent", mint=mint, signature=signature, latency_ms=_ms(start))

        status = await self.confirm(signature)
        if status == "confirmed":
            emit("trade", f"Bought {settings.buy_amount_sol} SOL of {short(mint)}", level="success", mint=mint, signature=signature, latency_ms=_ms(detected_at))
            if self.rules:
                tokens = await self._token_balance(mint)
                self._open_position(mint, lamports, live_tokens=tokens if tokens else quote.out_amount)
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


    # ------------------------------------------------------------------ positions and selling
    def _open_position(self, mint: str, lamports: int, live_tokens: Optional[int] = None) -> None:
        market = market_mod.ACTIVE
        if not self.rules or market is None:
            return
        book = market.books.get(mint)
        if book is None or not book.slot:
            self.emit("info", "Bought, but the coin's trades aren't being followed; it won't be sold automatically", level="warning", mint=mint)
            return
        price = book.price()
        tokens = float(live_tokens) if live_tokens else strategy.buy_tokens(book.vs[-1], book.vt[-1], lamports)
        pos = strategy.Position(mint=mint, tokens=tokens, spend_lamports=float(lamports), entry_price=price, entry_slot=book.slot[-1],
                                opened_at=time.monotonic(), live=live_tokens is not None)
        self.positions[mint] = pos
        market.watch(mint, lambda b, e, pos=pos: self._on_trade(pos, b, e))

    def _on_trade(self, pos: strategy.Position, book: strategy.CoinBook, event: Dict[str, Any]) -> None:
        if pos.selling:
            return
        dev_sold = event.get("kind") == "trade" and not event.get("buy") and event.get("user") == book.creator
        reason = strategy.exit_reason(pos, self.rules.exit, book.price(), now=time.monotonic(), dev_sold=dev_sold, completed=book.completed)
        if reason:
            self._start_sell(pos, reason)

    async def _time_limits(self) -> None:
        while True:
            await asyncio.sleep(0.25)
            market = market_mod.ACTIVE
            for pos in list(self.positions.values()):
                if pos.selling:
                    continue
                book = market.books.get(pos.mint) if market else None
                price = book.price() if book and book.slot else pos.last_price
                reason = strategy.exit_reason(pos, self.rules.exit, price, now=time.monotonic(), completed=bool(book and book.completed))
                if reason:
                    self._start_sell(pos, reason)

    def _start_sell(self, pos: strategy.Position, reason: str) -> None:
        pos.selling = True
        task = asyncio.create_task(self._sell(pos, reason))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _net_fee_sol(self) -> float:
        return (config.PRIORITY_FEE_MAX_LAMPORTS + 5000) / config.LAMPORTS_PER_SOL

    async def _sell(self, pos: strategy.Position, reason: str) -> None:
        emit, mint = self.emit, pos.mint
        try:
            if not pos.live:
                market = market_mod.ACTIVE
                book = market.books.get(mint) if market else None
                if book is None or not book.slot:
                    out = 0.0
                else:
                    out = strategy.sell_lamports(book.vs[-1], book.vt[-1], pos.tokens)
                pnl = (out - pos.spend_lamports) / config.LAMPORTS_PER_SOL - 2 * self._net_fee_sol()
                self._closed(pos, pnl)
                emit("trade", f"DRY RUN sell ({reason}): {pnl:+.4f} SOL after fees · run total {self.realized_sol:+.4f} SOL over {self.closed} trades",
                     level="success" if pnl > 0 else "warning", mint=mint)
                return
            start = time.perf_counter()
            amount = await self._token_balance(mint) or int(pos.tokens)
            quote = await self.jupiter.quote_sell(mint, amount, self.settings.slippage_bps)
            built = await self.jupiter.build_swap(quote, self.wallet.address)
            signed = self.wallet.sign(built["tx_bytes"])
            sim = await self.rpc.simulate(signed)
            if sim.get("err") is not None:
                raise RuntimeError(f"sell simulation failed: {sim['err']}")
            signature = await self.rpc.send(signed)
            emit("broadcast", f"Sell sent ({reason})", mint=mint, signature=signature, latency_ms=_ms(start))
            status = await self.confirm(signature)
            if status != "confirmed":
                raise RuntimeError(f"sell not confirmed: {status}")
            pnl = (quote.in_lamports - pos.spend_lamports) / config.LAMPORTS_PER_SOL - 2 * self._net_fee_sol()
            self._closed(pos, pnl)
            emit("trade", f"Sold {short(mint)} ({reason}): about {pnl:+.4f} SOL · run total {self.realized_sol:+.4f} SOL over {self.closed} trades",
                 level="success" if pnl > 0 else "warning", mint=mint, signature=signature, latency_ms=_ms(start))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            pos.sell_attempts += 1
            emit("error", f"Sell failed ({type(exc).__name__}: {exc}); attempt {pos.sell_attempts}, retrying", level="error", mint=mint)
            await asyncio.sleep(min(10.0, 1.0 * pos.sell_attempts))
            pos.selling = False

    def _closed(self, pos: strategy.Position, pnl: float) -> None:
        self.positions.pop(pos.mint, None)
        if market_mod.ACTIVE:
            market_mod.ACTIVE.unwatch(pos.mint)
        self.closed += 1
        self.wins += pnl > 0
        self.realized_sol += pnl

    async def _token_balance(self, mint: str) -> Optional[int]:
        if not self.wallet.address:
            return None
        try:
            result = await self.rpc.call("getTokenAccountsByOwner", [self.wallet.address, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}])
        except Exception:
            return None
        total = 0
        for acct in (result or {}).get("value", []):
            info = acct.get("account", {}).get("data", {}).get("parsed", {}).get("info", {})
            total += int(info.get("tokenAmount", {}).get("amount", 0))
        return total or None


async def run_executor(settings, detections: asyncio.Queue, emit, **kwargs: Any) -> None:
    await Executor(settings, emit, **kwargs).run(detections)
