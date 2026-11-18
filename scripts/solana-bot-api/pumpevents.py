"""
pumpevents.py — read pump.fun's own events straight out of the program logs.

Every pump.fun buy, sell and launch writes an Anchor event into its transaction logs
("Program data: <base64>"). Decoding them from the logsSubscribe stream gives each trade,
with the curve's reserves after it, the moment it confirms: no getTransaction round trip.

Layouts (after the 8-byte discriminator, little-endian):
  TradeEvent:  mint 32 | sol u64 | token u64 | is_buy u8 | user 32 | timestamp i64 |
               virtual_sol u64 | virtual_token u64 | real_sol u64 | real_token u64 | ... | creator 32 (at 169)
  CreateEvent: name str | symbol str | uri str | mint 32 | bonding_curve 32 | user 32 | creator 32 |
               timestamp i64 | virtual_token u64 | virtual_sol u64 | real_token u64 | supply u64 | ...
  CompleteEvent: user 32 | mint 32 | ...   (the curve filled and the coin moved to an AMM)
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import struct
from typing import Any, Dict, Iterator, List, Optional

TRADE = hashlib.sha256(b"event:TradeEvent").digest()[:8]
CREATE = hashlib.sha256(b"event:CreateEvent").digest()[:8]
COMPLETE = hashlib.sha256(b"event:CompleteEvent").digest()[:8]

CLASSIC_VIRTUAL_SOL = 30_000_000_000
CLASSIC_VIRTUAL_TOKENS = 1_073_000_000_000_000
CLASSIC_SUPPLY = 1_000_000_000_000_000

_ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = bytearray()
    while n:
        n, r = divmod(n, 58)
        out.append(_ALPHABET[r])
    pad = len(data) - len(data.lstrip(b"\0"))
    return (_ALPHABET[0:1] * pad + bytes(reversed(out))).decode()


def _string(b: bytes, o: int):
    n = struct.unpack_from("<I", b, o)[0]
    return b[o + 4:o + 4 + n].decode("utf-8", "replace"), o + 4 + n


def decode_line(line: str) -> Optional[Dict[str, Any]]:
    """One log line → {"kind": "trade"|"create"|"complete", ...} or None."""
    if not line.startswith("Program data: "):
        return None
    try:
        raw = base64.b64decode(line[14:])
    except (binascii.Error, ValueError):
        return None
    tag, b = raw[:8], raw[8:]
    try:
        if tag == TRADE:
            sol, tok = struct.unpack_from("<QQ", b, 32)
            ts, vs, vt, rs, rt = struct.unpack_from("<qQQQQ", b, 81)
            return {"kind": "trade", "mint": b58(b[0:32]), "sol": sol, "tok": tok, "buy": b[48] == 1,
                    "user": b58(b[49:81]), "ts": ts, "vs": vs, "vt": vt, "rs": rs, "rt": rt,
                    "creator": b58(b[169:201]) if len(b) >= 201 else None}
        if tag == CREATE:
            name, o = _string(b, 0)
            symbol, o = _string(b, o)
            _uri, o = _string(b, o)
            ts, vt, vs, rt, supply = struct.unpack_from("<qQQQQ", b, o + 128)
            return {"kind": "create", "mint": b58(b[o:o + 32]), "curve": b58(b[o + 32:o + 64]), "user": b58(b[o + 64:o + 96]),
                    "creator": b58(b[o + 96:o + 128]), "name": name, "symbol": symbol, "ts": ts, "vs": vs, "vt": vt, "supply": supply,
                    "classic": vs == CLASSIC_VIRTUAL_SOL and vt == CLASSIC_VIRTUAL_TOKENS and supply == CLASSIC_SUPPLY}
        if tag == COMPLETE:
            return {"kind": "complete", "user": b58(b[0:32]), "mint": b58(b[32:64])}
    except (struct.error, IndexError):
        return None
    return None


def decode_logs(logs: List[str]) -> Iterator[Dict[str, Any]]:
    for line in logs or ():
        event = decode_line(line)
        if event:
            yield event
