"""
pumpcurve.py — read a pump.fun bonding curve and decide whether it is a classic curve.

Classic curves start with 30 SOL of virtual reserves and hold the real SOL in the
curve, so their price follows constant-product math exactly. Newer curve variants
(a flag byte after the creator key) keep SOL elsewhere; in live tests nearly all of
the coins that later had no sell route were variants, so the sniper skips them.
"""

from __future__ import annotations

import base64
import struct
from dataclasses import dataclass
from typing import Optional

import config

VIRTUAL_SOL_START = 30_000_000_000
TOTAL_SUPPLY = 1_000_000_000_000_000
_SEED = b"bonding-curve"


@dataclass
class Curve:
    virtual_token: int
    virtual_sol: int
    real_token: int
    real_sol: int
    supply: int
    complete: bool
    variant_flag: int

    @property
    def classic(self) -> bool:
        return (
            self.variant_flag == 0
            and self.supply == TOTAL_SUPPLY
            and abs((self.virtual_sol - self.real_sol) - VIRTUAL_SOL_START) < 50_000_000
        )

    @property
    def raised_sol(self) -> float:
        return self.real_sol / config.LAMPORTS_PER_SOL


def curve_address(mint: str) -> str:
    from solders.pubkey import Pubkey

    program = Pubkey.from_string(config.PUMP_FUN_PROGRAM)
    return str(Pubkey.find_program_address([_SEED, bytes(Pubkey.from_string(mint))], program)[0])


def decode(data: bytes) -> Optional[Curve]:
    if len(data) < 49:
        return None
    vt, vs, rt, rs, supply = struct.unpack_from("<5Q", data, 8)
    complete = bool(data[48])
    flag = data[81] if len(data) > 81 else 0
    return Curve(vt, vs, rt, rs, supply, complete, flag)


async def fetch(rpc, mint: str) -> Optional[Curve]:
    result = await rpc.call("getAccountInfo", [curve_address(mint), {"encoding": "base64", "commitment": "confirmed"}])
    value = (result or {}).get("value")
    if not value:
        return None
    return decode(base64.b64decode(value["data"][0]))
