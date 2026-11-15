"""How amounts are written: SOL first, with the dollar value in brackets."""

from __future__ import annotations


def sol(value: float) -> str:
    size = abs(value)
    places = 2 if size >= 100 else 3 if size >= 1 else 4
    return f"{value:,.{places}f} SOL"


def small_sol(value: float) -> str:
    """Fee-sized amounts, down to a millionth of a SOL."""
    return (f"{value:.6f}".rstrip("0").rstrip(".") or "0") + " SOL"


def usd(value: float) -> str:
    return f"${value:,.2f}"


def both(value: float, sol_usd: float | None) -> str:
    return f"{sol(value)} ({usd(value * sol_usd)})" if sol_usd else sol(value)


def signed(value: float, sol_usd: float | None) -> str:
    return ("+" if value >= 0 else "-") + both(abs(value), sol_usd)
