"""
api.py — FastAPI bridge between your website and the Solana bot.

Run:  uvicorn api:app --host 0.0.0.0 --port 8000

Endpoints
  GET  /api/health               public
  GET  /api/status               Bearer auth
  POST /api/start                Bearer auth   {mode, target_wallet, buy_amount_sol, slippage_bps, dry_run}
  POST /api/stop                 Bearer auth
  WS   /ws/stream?token=...      token auth, live events + heartbeats
  GET  /                         static/index.html (control panel)
  GET  /static/*, /sdk/*         static assets, JS SDK
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Deque, Dict, List, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv is optional
    pass

from bot_manager import BotAlreadyRunning, BotConfigError, BotManager

log = logging.getLogger("api")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SDK_DIR = BASE_DIR / "web"

WS_AUTH_FAILED = 4401  # custom close code so clients stop reconnecting on a bad password


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
def parse_origins(raw: Optional[str]) -> List[str]:
    origins = [o.strip().rstrip("/") for o in (raw or "*").split(",") if o.strip()]
    return ["*"] if not origins or "*" in origins else origins


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["sniper", "copytrade"] = "sniper"
    target_wallet: Optional[str] = Field(default=None, max_length=64)
    buy_amount_sol: float = Field(gt=0)
    slippage_bps: int = Field(ge=1, le=5000)
    dry_run: bool = True


class LoginThrottle:
    """Per-IP brute-force protection: N failures inside a window → temporary lockout."""

    def __init__(self, max_failures: int = 10, window_s: float = 300, lockout_s: float = 300) -> None:
        self.max_failures, self.window_s, self.lockout_s = max_failures, window_s, lockout_s
        self._failures: Dict[str, Deque[float]] = defaultdict(deque)
        self._locked_until: Dict[str, float] = {}

    def check(self, ip: str) -> None:
        until = self._locked_until.get(ip, 0)
        if until > time.monotonic():
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many failed login attempts. Try again later.",
                headers={"Retry-After": str(int(until - time.monotonic()) + 1)},
            )

    def is_locked(self, ip: str) -> bool:
        return self._locked_until.get(ip, 0) > time.monotonic()

    def fail(self, ip: str) -> None:
        now = time.monotonic()
        q = self._failures[ip]
        q.append(now)
        while q and now - q[0] > self.window_s:
            q.popleft()
        if len(q) >= self.max_failures:
            self._locked_until[ip] = now + self.lockout_s
            q.clear()
            log.warning("Locking out %s after repeated auth failures", ip)

    def success(self, ip: str) -> None:
        self._failures.pop(ip, None)


def _password_ok(supplied: Optional[str], expected: str) -> bool:
    if not supplied or not expected:
        return False
    return secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


# --------------------------------------------------------------------------- #
# App factory
# --------------------------------------------------------------------------- #
def create_app(
    manager: Optional[BotManager] = None,
    *,
    password: Optional[str] = None,
    allowed_origins: Optional[str] = None,
    heartbeat_s: Optional[float] = None,
) -> FastAPI:
    dashboard_password = password if password is not None else os.getenv("DASHBOARD_PASSWORD", "")
    origins = parse_origins(allowed_origins if allowed_origins is not None else os.getenv("ALLOWED_ORIGINS", "*"))
    heartbeat = heartbeat_s if heartbeat_s is not None else float(os.getenv("WS_HEARTBEAT_SECONDS", "15"))
    mgr = manager or BotManager()
    throttle = LoginThrottle()

    if not dashboard_password:
        log.warning("DASHBOARD_PASSWORD is not set — all protected endpoints will refuse requests.")
    elif len(dashboard_password) < 16:
        log.warning("DASHBOARD_PASSWORD is shorter than 16 characters; use a long random value in production.")
    if origins == ["*"]:
        log.warning("ALLOWED_ORIGINS='*' — fine for local testing, set your website's domain in production.")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await mgr.aclose()

    app = FastAPI(title="Solana Bot API", version="1.0.0", lifespan=lifespan)
    app.state.manager = mgr

    # Bearer tokens (not cookies) → credentials stay off, which also makes "*" legal for local testing.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    bearer = HTTPBearer(auto_error=False)

    def require_auth(request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> None:
        if not dashboard_password:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DASHBOARD_PASSWORD is not configured on the server")
        ip = request.client.host if request.client else "unknown"
        throttle.check(ip)
        if creds is None or creds.scheme.lower() != "bearer" or not _password_ok(creds.credentials, dashboard_password):
            throttle.fail(ip)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing password", headers={"WWW-Authenticate": "Bearer"})
        throttle.success(ip)

    # ---- REST --------------------------------------------------------------
    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/status", dependencies=[Depends(require_auth)])
    async def get_status():
        return await mgr.status()

    @app.post("/api/start", dependencies=[Depends(require_auth)])
    async def start_bot(body: StartRequest):
        try:
            snapshot = await mgr.start(body.model_dump())
        except BotAlreadyRunning as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
        except BotConfigError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        return {"ok": True, **snapshot}

    @app.post("/api/stop", dependencies=[Depends(require_auth)])
    async def stop_bot():
        snapshot = await mgr.stop(reason="Emergency stop from dashboard")
        return {"ok": True, **snapshot}

    # ---- WebSocket ---------------------------------------------------------
    @app.websocket("/ws/stream")
    async def ws_stream(ws: WebSocket, token: str = ""):
        ip = ws.client.host if ws.client else "unknown"
        # Accept then close with 4401 so browsers can see *why* (a rejected handshake is an opaque 1006).
        await ws.accept()
        if not dashboard_password or throttle.is_locked(ip) or not _password_ok(token, dashboard_password):
            if dashboard_password and not throttle.is_locked(ip):
                throttle.fail(ip)
            await ws.close(code=WS_AUTH_FAILED, reason="unauthorized")
            return
        throttle.success(ip)

        queue = mgr.subscribe()
        try:
            snap = mgr.snapshot()
            await ws.send_json({"event_type": "hello", "running": snap["running"], "settings": snap["settings"],
                                "trades_executed": snap["trades_executed"], "backlog": snap["recent_events"][:50]})

            async def sender():
                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                    except asyncio.TimeoutError:
                        event = {"event_type": "heartbeat", "level": "debug", "timestamp": time.time(),
                                 "running": mgr.is_running}
                    await ws.send_json(event)

            async def receiver():
                while True:
                    msg = await ws.receive_text()
                    if msg.strip().lower() in ("ping", '{"type":"ping"}'):
                        await ws.send_json({"event_type": "pong", "timestamp": time.time()})

            tasks = {asyncio.create_task(sender()), asyncio.create_task(receiver())}
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            for t in pending:
                with suppress(asyncio.CancelledError, Exception):
                    await t
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, (WebSocketDisconnect, RuntimeError)):
                    log.warning("WebSocket stream error: %r", exc)
        finally:
            mgr.unsubscribe(queue)
            with suppress(Exception):
                await ws.close()

    # ---- Static ------------------------------------------------------------
    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    if SDK_DIR.is_dir():
        app.mount("/sdk", StaticFiles(directory=SDK_DIR), name="sdk")

    @app.get("/", include_in_schema=False)
    async def index():
        page = STATIC_DIR / "index.html"
        if not page.is_file():
            return JSONResponse({"detail": "static/index.html not found"}, status_code=404)
        return FileResponse(page, headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
