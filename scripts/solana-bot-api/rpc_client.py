"""
rpc_client.py — one shared Solana JSON-RPC client (HTTP) and the bot's wallet.

The httpx client is created once and reused for every call; BotManager.stop()
never closes it. bot_adapter calls aclose() once when the server shuts down.
"""

from __future__ import annotations

import base64
import itertools
from typing import Any, Dict, List, Optional

import httpx

import config


class RpcError(RuntimeError):
    def __init__(self, method: str, message: str, code: Optional[int] = None):
        super().__init__(f"{method}: {message}")
        self.code = code


class RpcClient:
    def __init__(self, url: Optional[str] = None, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.url = url or config.RPC_URL
        self._ids = itertools.count(1)
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(config.RPC_TIMEOUT_S),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            transport=transport,
        )

    async def call(self, method: str, params: Optional[List[Any]] = None) -> Any:
        payload = {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params or []}
        resp = await self._http.post(self.url, json=payload)
        if resp.status_code == 429:
            raise RpcError(method, "rate limited by the RPC provider (429)", 429)
        resp.raise_for_status()
        body = resp.json()
        if body.get("error"):
            err = body["error"]
            raise RpcError(method, err.get("message", "RPC error"), err.get("code"))
        return body.get("result")

    async def get_balance_lamports(self, address: str) -> int:
        result = await self.call("getBalance", [address, {"commitment": config.COMMITMENT}])
        return int(result["value"])

    async def get_transaction(self, signature: str) -> Optional[Dict[str, Any]]:
        return await self.call(
            "getTransaction",
            [signature, {"encoding": "json", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}],
        )

    async def simulate(self, tx_bytes: bytes) -> Dict[str, Any]:
        result = await self.call(
            "simulateTransaction",
            [
                base64.b64encode(tx_bytes).decode(),
                {"encoding": "base64", "commitment": "processed", "sigVerify": False, "replaceRecentBlockhash": True},
            ],
        )
        return result["value"]

    async def send(self, tx_bytes: bytes) -> str:
        return await self.call(
            "sendTransaction",
            [base64.b64encode(tx_bytes).decode(), {"encoding": "base64", "skipPreflight": True, "maxRetries": 3}],
        )

    async def signature_status(self, signature: str) -> Optional[Dict[str, Any]]:
        result = await self.call("getSignatureStatuses", [[signature], {"searchTransactionHistory": False}])
        return (result or {}).get("value", [None])[0]

    async def aclose(self) -> None:
        await self._http.aclose()


class Wallet:
    """The hot wallet. The secret key stays inside the solders Keypair."""

    def __init__(self, keypair=None) -> None:
        self.keypair = keypair
        self.address: Optional[str] = str(keypair.pubkey()) if keypair else (config.WALLET_PUBLIC_KEY or None)

    @property
    def can_sign(self) -> bool:
        return self.keypair is not None

    def sign(self, unsigned_tx: bytes) -> bytes:
        from solders.transaction import VersionedTransaction

        if not self.keypair:
            raise RuntimeError("No PRIVATE_KEY / KEYPAIR_PATH configured")
        tx = VersionedTransaction.from_bytes(unsigned_tx)
        if tx.message.account_keys[0] != self.keypair.pubkey():
            raise RuntimeError("Transaction fee payer is not this wallet; refusing to sign")
        return bytes(VersionedTransaction(tx.message, [self.keypair]))


_client: Optional[RpcClient] = None
_wallet: Optional[Wallet] = None


def get_client() -> RpcClient:
    global _client
    if _client is None:
        _client = RpcClient()
    return _client


def get_wallet() -> Wallet:
    global _wallet
    if _wallet is None:
        _wallet = Wallet(config.load_keypair())
    return _wallet


def set_test_doubles(client: Optional[RpcClient] = None, wallet: Optional[Wallet] = None) -> None:
    global _client, _wallet
    if client is not None:
        _client = client
    if wallet is not None:
        _wallet = wallet


async def get_wallet_info() -> Dict[str, Any]:
    wallet = get_wallet()
    if not wallet.address:
        return {"address": None, "balance_sol": None}
    lamports = await get_client().get_balance_lamports(wallet.address)
    return {"address": wallet.address, "balance_sol": lamports / config.LAMPORTS_PER_SOL}


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
