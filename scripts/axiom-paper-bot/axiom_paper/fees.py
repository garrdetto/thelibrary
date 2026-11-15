"""Network fees per trade, in SOL: your own priority fee and bribe, or an auto fee estimated from live network levels.

Auto fee stands in for the auto fee on trading terminals such as Axiom, whose formula is not public. The bribe is
what recently landed Jito tips cost at a chosen percentile, and the priority fee is what recent blocks charged
per compute unit for the swap program most Radar coins trade through, times a typical swap's compute units."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

JITO_TIPS = "https://bundles.jito.wtf/api/v1/bundles/tip_floor"
SOLANA_RPC = "https://api.mainnet-beta.solana.com"
SWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
COMPUTE_UNITS = 200_000
MICRO_LAMPORTS_PER_SOL = 1e15
BASE_FEE = 0.000005
LEVELS = ("low", "normal", "high")
TIP_KEYS = {"low": "landed_tips_75th_percentile", "normal": "landed_tips_95th_percentile", "high": "landed_tips_99th_percentile"}
PRIORITY_QUANTILES = {"low": 0.5, "normal": 0.9, "high": 0.99}


@dataclass(frozen=True)
class FeeLevels:
    """SOL per trade at each auto fee speed."""
    priority: dict[str, float]
    bribe: dict[str, float]


@dataclass(frozen=True)
class FeeQuote:
    priority: float
    bribe: float
    source: str

    @property
    def total(self) -> float:
        return self.priority + self.bribe + BASE_FEE


def _json(url: str, body: dict[str, Any] | None, timeout: float) -> Any:
    request = urllib.request.Request(
        url,
        data=None if body is None else json.dumps(body).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "axiom-paper-bot"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def fetch_levels(timeout: float = 4.0) -> FeeLevels | None:
    """Live fee levels, or None when neither source answers. One source alone still gives its half."""
    failures = (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError)
    bribe: dict[str, float] | None = None
    priority: dict[str, float] | None = None
    try:
        tips = _json(JITO_TIPS, None, timeout)[0]
        bribe = {level: max(0.0, float(tips[key])) for level, key in TIP_KEYS.items()}
    except failures:
        pass
    try:
        recent = _json(SOLANA_RPC, {"jsonrpc": "2.0", "id": 1, "method": "getRecentPrioritizationFees", "params": [[SWAP_PROGRAM]]}, timeout)["result"]
        per_unit = sorted(float(slot["prioritizationFee"]) for slot in recent)
        if per_unit:
            priority = {level: per_unit[min(len(per_unit) - 1, int(len(per_unit) * quantile))] * COMPUTE_UNITS / MICRO_LAMPORTS_PER_SOL for level, quantile in PRIORITY_QUANTILES.items()}
    except failures:
        pass
    if bribe is None and priority is None:
        return None
    nothing = dict.fromkeys(LEVELS, 0.0)
    return FeeLevels(priority or nothing, bribe or nothing)


def quote(settings: Mapping[str, Any], levels: FeeLevels | None) -> FeeQuote:
    """What one trade pays the network right now."""
    manual = FeeQuote(settings["costs.priority_fee_sol"], settings["costs.bribe_sol"], "manual")
    if settings["costs.fee_mode"] != "auto":
        return manual
    if levels is None:
        return FeeQuote(manual.priority, manual.bribe, "manual, because auto fee has no live data")
    level = settings["costs.auto_fee_level"]
    priority, bribe = levels.priority.get(level, 0.0), levels.bribe.get(level, 0.0)
    cap = settings["costs.max_fee_sol"]
    if priority + bribe > cap:
        scale = cap / (priority + bribe)
        priority, bribe = priority * scale, bribe * scale
    return FeeQuote(priority, bribe, "auto")
