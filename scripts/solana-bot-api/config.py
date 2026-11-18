"""
config.py — every setting the Axiom Bot reads, from .env (or the environment).

Secrets (PRIVATE_KEY, API keys) never leave this process: they are not logged,
not sent to the web UI and not written anywhere.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(float(os.getenv(name, default)))
    except ValueError:
        return default


def _ws_from_http(url: str) -> str:
    if url.startswith("https://"):
        return "wss://" + url[len("https://"):]
    if url.startswith("http://"):
        return "ws://" + url[len("http://"):]
    return url


WSOL_MINT = "So11111111111111111111111111111111111111112"
PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
LAMPORTS_PER_SOL = 1_000_000_000

# --- Solana RPC -------------------------------------------------------------
RPC_URL = _str("RPC_URL", "https://api.mainnet-beta.solana.com")
RPC_WS_URL = _str("RPC_WS_URL") or _ws_from_http(RPC_URL)
RPC_TIMEOUT_S = _float("RPC_TIMEOUT_S", 8.0)
COMMITMENT = _str("COMMITMENT", "confirmed")

# --- Wallet -----------------------------------------------------------------
# PRIVATE_KEY: base58 secret key (Phantom export) or a JSON byte array.
# KEYPAIR_PATH: path to a solana-keygen JSON file. PRIVATE_KEY wins if both are set.
PRIVATE_KEY = _str("PRIVATE_KEY")
KEYPAIR_PATH = _str("KEYPAIR_PATH")
WALLET_PUBLIC_KEY = _str("WALLET_PUBLIC_KEY")

# --- Jupiter ----------------------------------------------------------------
# Free key: https://portal.jup.ag (sent as the x-api-key header).
JUPITER_API_URL = _str("JUPITER_API_URL", "https://api.jup.ag/swap/v1").rstrip("/")
JUPITER_API_KEY = _str("JUPITER_API_KEY")
PRIORITY_LEVEL = _str("PRIORITY_LEVEL", "veryHigh")  # medium | high | veryHigh
PRIORITY_FEE_MAX_LAMPORTS = _int("PRIORITY_FEE_MAX_LAMPORTS", 1_000_000)  # 0.001 SOL cap per trade

# --- Risk limits (the web UI can never go past these) -----------------------
MAX_BUY_AMOUNT_SOL = _float("MAX_BUY_AMOUNT_SOL", 0.1)
MAX_TRADES_PER_RUN = _int("MAX_TRADES_PER_RUN", 5)
MIN_SOL_RESERVE = _float("MIN_SOL_RESERVE", 0.02)
MAX_PRICE_IMPACT_PCT = _float("MAX_PRICE_IMPACT_PCT", 25.0)
MAX_SIGNAL_AGE_S = _float("MAX_SIGNAL_AGE_S", 20.0)
# Skip pump.fun curve variants (most coins that later couldn't be sold were variants)
SKIP_CURVE_VARIANTS = os.getenv("SKIP_CURVE_VARIANTS", "1").strip().lower() not in ("0", "false", "no")

# --- Execution --------------------------------------------------------------
QUOTE_RETRIES = _int("QUOTE_RETRIES", 4)
QUOTE_RETRY_DELAY_S = _float("QUOTE_RETRY_DELAY_S", 0.6)
CONFIRM_TIMEOUT_S = _float("CONFIRM_TIMEOUT_S", 45.0)
EXECUTOR_CONCURRENCY = _int("EXECUTOR_CONCURRENCY", 2)

# --- Listener ---------------------------------------------------------------
LISTENER_CONCURRENCY = _int("LISTENER_CONCURRENCY", 8)
TX_FETCH_RETRIES = _int("TX_FETCH_RETRIES", 6)
TX_FETCH_DELAY_S = _float("TX_FETCH_DELAY_S", 0.35)
WS_PING_S = _float("WS_PING_S", 20.0)


def load_keypair():
    """Return a solders Keypair from PRIVATE_KEY / KEYPAIR_PATH, or None if neither is set."""
    from solders.keypair import Keypair

    raw: Optional[str] = PRIVATE_KEY or None
    if raw is None and KEYPAIR_PATH:
        raw = Path(KEYPAIR_PATH).expanduser().read_text().strip()
    if not raw:
        return None
    if raw.startswith("["):
        return Keypair.from_bytes(bytes(json.loads(raw)))
    return Keypair.from_base58_string(raw)
