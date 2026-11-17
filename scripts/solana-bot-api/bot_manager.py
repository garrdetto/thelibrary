"""
bot_manager.py — lifecycle + event broadcasting for the Solana bot.

`BotManager` owns the bot's background asyncio tasks (listener + executor) so the
bot can be started / stopped cleanly from web requests, and fans out every
structured event to all connected WebSocket subscribers.

Event schema (every event pushed to subscribers / kept in `recent_events`):
    {
      "timestamp":  "2026-11-16T22:37:01.123Z",   # ISO-8601 UTC
      "level":      "debug|info|success|warning|error",
      "event_type": "detection|quote|simulation|broadcast|trade|error|status|info",
      "mint":       str | None,
      "signature":  str | None,
      "latency_ms": float | None,
      "message":    str,
    }

`emit()` is safe to call from the event loop *or* from any worker thread.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Protocol, Set

log = logging.getLogger("bot_manager")

LEVELS = ("debug", "info", "success", "warning", "error")
EVENT_TYPES = ("detection", "quote", "simulation", "broadcast", "trade", "error", "status", "info")
MODES = ("sniper", "copytrade")

# Solana base58 public key: 32–44 chars, no 0/O/I/l.
_BASE58_PUBKEY = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")

MAX_SLIPPAGE_BPS = 5000  # 50% hard ceiling — anything above is almost certainly a typo.
TASK_STOP_TIMEOUT_S = 10.0
WALLET_INFO_TIMEOUT_S = 5.0


# --------------------------------------------------------------------------- #
# Settings / config helpers
# --------------------------------------------------------------------------- #
def setting(name: str, default: Any = None) -> Any:
    """Read a setting from the environment first, then from the bot's config.py."""
    value = os.getenv(name)
    if value not in (None, ""):
        return value
    try:
        import config  # the bot's existing config.py

        return getattr(config, name, default)
    except Exception:  # config.py missing or failing to import
        return default


def max_buy_amount_sol() -> float:
    return float(setting("MAX_BUY_AMOUNT_SOL", 1.0))


class BotConfigError(ValueError):
    """Invalid start parameters (maps to HTTP 400)."""


class BotAlreadyRunning(RuntimeError):
    """start() called while the bot is running (maps to HTTP 409)."""


@dataclass
class BotSettings:
    mode: str = "sniper"
    target_wallet: str = ""
    buy_amount_sol: float = 0.01
    slippage_bps: int = 300
    dry_run: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def validate_settings(overrides: Optional[Dict[str, Any]], base: Optional[BotSettings] = None) -> BotSettings:
    """Merge overrides onto `base` and validate. Raises BotConfigError."""
    merged = (base or BotSettings()).to_dict()
    for key, value in (overrides or {}).items():
        if key not in merged:
            raise BotConfigError(f"Unknown setting: {key}")
        if value is not None:
            merged[key] = value

    mode = str(merged["mode"]).lower()
    if mode not in MODES:
        raise BotConfigError(f"mode must be one of {MODES}")

    target = (merged["target_wallet"] or "").strip()
    if mode == "copytrade":
        if not _BASE58_PUBKEY.match(target):
            raise BotConfigError("copytrade mode requires a valid base58 target_wallet")
    else:
        target = ""

    try:
        buy = float(merged["buy_amount_sol"])
    except (TypeError, ValueError):
        raise BotConfigError("buy_amount_sol must be a number") from None
    cap = max_buy_amount_sol()
    if not (buy > 0):
        raise BotConfigError("buy_amount_sol must be greater than 0")
    if buy > cap:
        raise BotConfigError(f"buy_amount_sol {buy} exceeds MAX_BUY_AMOUNT_SOL ({cap})")

    try:
        slippage = int(merged["slippage_bps"])
    except (TypeError, ValueError):
        raise BotConfigError("slippage_bps must be an integer") from None
    if not (1 <= slippage <= MAX_SLIPPAGE_BPS):
        raise BotConfigError(f"slippage_bps must be between 1 and {MAX_SLIPPAGE_BPS}")

    dry_run = merged["dry_run"]
    if not isinstance(dry_run, bool):
        raise BotConfigError("dry_run must be a boolean")

    return BotSettings(mode=mode, target_wallet=target, buy_amount_sol=buy, slippage_bps=slippage, dry_run=dry_run)


# --------------------------------------------------------------------------- #
# Hooks into the bot's own modules
# --------------------------------------------------------------------------- #
class BotHooks(Protocol):
    """What BotManager needs from the bot. See bot_adapter.ProjectHooks."""

    async def run_listener(self, settings: BotSettings, detections: asyncio.Queue, emit: "Emit") -> None: ...

    async def run_executor(self, settings: BotSettings, detections: asyncio.Queue, emit: "Emit") -> None: ...

    async def wallet_info(self) -> Dict[str, Any]: ...  # {"address": str|None, "balance_sol": float|None}

    async def aclose(self) -> None: ...


class Emit(Protocol):
    def __call__(
        self,
        event_type: str,
        message: str,
        *,
        level: str = "info",
        mint: Optional[str] = None,
        signature: Optional[str] = None,
        latency_ms: Optional[float] = None,
    ) -> Dict[str, Any]: ...


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# BotManager
# --------------------------------------------------------------------------- #
class BotManager:
    def __init__(
        self,
        hooks: Optional[BotHooks] = None,
        *,
        ring_size: int = 100,
        trade_history_size: int = 50,
        subscriber_queue_size: int = 500,
    ) -> None:
        self._hooks = hooks
        self._lifecycle_lock = asyncio.Lock()  # serialises start/stop
        self._state_lock = threading.Lock()  # guards buffers/counters across threads
        self._subscriber_queue_size = subscriber_queue_size
        self._subscribers: Set[asyncio.Queue] = set()
        self._tasks: List[asyncio.Task] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        self.is_running: bool = False
        self.started_at: Optional[float] = None
        self.settings: BotSettings = BotSettings()
        self.trades_executed: int = 0
        self.recent_events: Deque[Dict[str, Any]] = deque(maxlen=ring_size)
        self.trade_history: Deque[Dict[str, Any]] = deque(maxlen=trade_history_size)

    # ---- convenience accessors (spec field names) -------------------------
    @property
    def mode(self) -> str:
        return self.settings.mode

    @property
    def target_wallet(self) -> str:
        return self.settings.target_wallet

    @property
    def buy_amount_sol(self) -> float:
        return self.settings.buy_amount_sol

    @property
    def slippage_bps(self) -> int:
        return self.settings.slippage_bps

    @property
    def dry_run(self) -> bool:
        return self.settings.dry_run

    @property
    def hooks(self) -> BotHooks:
        if self._hooks is None:
            from bot_adapter import ProjectHooks  # lazy: only import the bot when first needed

            self._hooks = ProjectHooks()
        return self._hooks

    # ---- broadcaster -------------------------------------------------------
    def subscribe(self, maxsize: Optional[int] = None) -> asyncio.Queue:
        """Register a new subscriber queue. Must be called from the event loop."""
        self._loop = self._loop or asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize or self._subscriber_queue_size)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def emit(
        self,
        event_type: str,
        message: str,
        *,
        level: str = "info",
        mint: Optional[str] = None,
        signature: Optional[str] = None,
        latency_ms: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Record + broadcast an event. Thread-safe."""
        if level not in LEVELS:
            level = "info"
        event = {
            "timestamp": _now_iso(),
            "level": level,
            "event_type": event_type if event_type in EVENT_TYPES else "info",
            "mint": mint,
            "signature": signature,
            "latency_ms": round(float(latency_ms), 2) if latency_ms is not None else None,
            "message": str(message),
        }
        loop = self._loop
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None

        if loop is not None and running is not loop and loop.is_running():
            loop.call_soon_threadsafe(self._publish, event)  # called from a worker thread
        else:
            self._publish(event)
        return event

    def _publish(self, event: Dict[str, Any]) -> None:
        with self._state_lock:
            self.recent_events.append(event)
            if event["event_type"] == "trade" and event["level"] != "error":
                self.trades_executed += 1
                self.trade_history.append(event)
        log.log(logging.ERROR if event["level"] == "error" else logging.INFO, "[%s] %s", event["event_type"], event["message"])
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # slow client: drop its oldest event, keep the newest
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    # ---- lifecycle ---------------------------------------------------------
    async def start(self, config_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        async with self._lifecycle_lock:
            if self.is_running:
                raise BotAlreadyRunning("Bot is already running")
            settings = validate_settings(config_overrides)  # raises BotConfigError (incl. MAX_BUY_AMOUNT_SOL)
            hooks = self.hooks
            preflight = getattr(hooks, "preflight", None)
            if preflight is not None:
                preflight()  # e.g. listener.py / executor.py importable — fail fast with HTTP 400
            self._loop = asyncio.get_running_loop()

            detections: asyncio.Queue = asyncio.Queue(maxsize=1000)
            self.settings = settings
            self.trades_executed = 0
            self.started_at = time.time()
            self.is_running = True

            self._tasks = [
                asyncio.create_task(hooks.run_listener(settings, detections, self.emit), name="bot-listener"),
                asyncio.create_task(hooks.run_executor(settings, detections, self.emit), name="bot-executor"),
            ]
            for task in self._tasks:
                task.add_done_callback(self._on_task_done)

            mode_label = "Copy-Trade → " + settings.target_wallet if settings.mode == "copytrade" else "Sniper"
            self.emit(
                "status",
                f"Bot started ({mode_label}, {settings.buy_amount_sol} SOL, "
                f"{settings.slippage_bps / 100:.2f}% slippage, {'DRY RUN' if settings.dry_run else 'LIVE'})",
                level="warning" if not settings.dry_run else "success",
            )
            return self.snapshot()

    async def stop(self, reason: str = "Stopped by user") -> Dict[str, Any]:
        """Cancel listener/executor tasks. Shared HTTP/RPC sessions stay open (closed in aclose())."""
        async with self._lifecycle_lock:
            if not self.is_running:
                return self.snapshot()
            tasks, self._tasks = self._tasks, []
            self.is_running = False
            for task in tasks:
                task.cancel()
            if tasks:
                _, pending = await asyncio.wait(tasks, timeout=TASK_STOP_TIMEOUT_S)
                for task in pending:
                    log.warning("Task %s did not stop within %.0fs", task.get_name(), TASK_STOP_TIMEOUT_S)
            self.started_at = None
            self.emit("status", f"Bot stopped: {reason}", level="info")
            return self.snapshot()

    def _on_task_done(self, task: asyncio.Task) -> None:
        if task.cancelled() or not self.is_running:
            return
        exc = task.exception()
        if exc is not None:
            log.error("Task %s crashed", task.get_name(), exc_info=exc)
            self.emit("error", f"{task.get_name()} crashed: {type(exc).__name__}: {exc}", level="error")
            reason = f"{task.get_name()} crashed"
        else:
            self.emit("error", f"{task.get_name()} exited unexpectedly", level="warning")
            reason = f"{task.get_name()} exited"
        asyncio.get_running_loop().create_task(self.stop(reason=reason))

    async def aclose(self) -> None:
        """App shutdown: stop the bot and close the bot's network sessions."""
        await self.stop(reason="Server shutting down")
        if self._hooks is not None:
            try:
                await self._hooks.aclose()
            except Exception:  # pragma: no cover
                log.exception("Error closing bot hooks")

    # ---- status ------------------------------------------------------------
    def snapshot(self) -> Dict[str, Any]:
        with self._state_lock:
            return {
                "running": self.is_running,
                "started_at": self.started_at,
                "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else 0,
                "settings": self.settings.to_dict(),
                "max_buy_amount_sol": max_buy_amount_sol(),
                "trades_executed": self.trades_executed,
                "recent_trades": list(self.trade_history)[::-1],
                "recent_events": list(self.recent_events)[::-1],
                "subscribers": len(self._subscribers),
            }

    async def status(self) -> Dict[str, Any]:
        data = self.snapshot()
        try:
            wallet = await asyncio.wait_for(self.hooks.wallet_info(), timeout=WALLET_INFO_TIMEOUT_S)
        except Exception as exc:
            log.warning("wallet_info failed: %s", exc)
            wallet = {"address": None, "balance_sol": None, "error": f"{type(exc).__name__}: {exc}"}
        data["wallet"] = wallet
        return data
