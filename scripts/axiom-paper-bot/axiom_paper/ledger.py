"""The pretend account on disk (SQLite): cash, positions, every fill, the equity curve and an activity log."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .broker import Fill
from .models import Position

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, symbol TEXT NOT NULL, pair TEXT,
  opened_at INTEGER NOT NULL, entry_spot REAL NOT NULL, entry_price REAL NOT NULL, qty REAL NOT NULL, qty_open REAL NOT NULL,
  cost_usd REAL NOT NULL, proceeds_usd REAL NOT NULL DEFAULT 0, fees_usd REAL NOT NULL DEFAULT 0,
  entry_liquidity REAL, last_liquidity REAL, peak_price REAL NOT NULL, peak_viewers REAL,
  last_price REAL NOT NULL, last_price_at INTEGER NOT NULL, target_done INTEGER NOT NULL DEFAULT 0, score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', closed_at INTEGER, exit_reason TEXT, exit_high REAL, entry_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS positions_status ON positions (status, closed_at);
CREATE INDEX IF NOT EXISTS positions_mint ON positions (mint, opened_at);
CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL, at INTEGER NOT NULL, side TEXT NOT NULL,
  spot REAL NOT NULL, price REAL NOT NULL, qty REAL NOT NULL, gross_usd REAL NOT NULL, fee_usd REAL NOT NULL, net_usd REAL NOT NULL,
  impact_pct REAL NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equity (t INTEGER PRIMARY KEY NOT NULL, equity REAL NOT NULL, cash REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
"""

POSITION_COLUMNS = (
    "mint", "symbol", "pair", "opened_at", "entry_spot", "entry_price", "qty", "qty_open", "cost_usd", "proceeds_usd", "fees_usd",
    "entry_liquidity", "last_liquidity", "peak_price", "peak_viewers", "last_price", "last_price_at", "target_done", "score",
    "status", "closed_at", "exit_reason", "exit_high",
)


def _position(row: sqlite3.Row) -> Position:
    values = {column: row[column] for column in POSITION_COLUMNS}
    values["target_done"] = bool(values["target_done"])
    try:
        entry = json.loads(row["entry_json"])
    except ValueError:
        entry = {}
    return Position(id=row["id"], entry=entry if isinstance(entry, dict) else {}, **values)


class Ledger:
    def __init__(self, path: Path | str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def _transaction(self) -> Iterator[None]:
        self.db.execute("BEGIN")
        try:
            yield
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        self.db.execute("COMMIT")

    def get(self, key: str, fallback: Any = None) -> Any:
        row = self.db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        if row is None:
            return fallback
        try:
            return json.loads(row["value"])
        except ValueError:
            return fallback

    def set(self, key: str, value: Any) -> None:
        self.db.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))

    @property
    def cash(self) -> float:
        return float(self.get("cash", 0.0))

    def started(self) -> bool:
        return self.get("starting_cash") is not None

    def reset(self, starting_cash: float, now: int) -> None:
        """Wipe every trade and start again with fresh pretend cash."""
        with self._transaction():
            for table in ("positions", "fills", "equity", "events"):
                self.db.execute(f"DELETE FROM {table}")
            for key in ("loss_streak", "pause_until", "day", "day_start_equity"):
                self.db.execute("DELETE FROM meta WHERE key = ?", (key,))
        self.set("starting_cash", starting_cash)
        self.set("cash", starting_cash)
        self.set("peak_equity", starting_cash)
        self.set("account_started_at", now)
        self.event(now, "account", f"Account reset with ${starting_cash:,.2f} of pretend cash")

    def open_positions(self) -> list[Position]:
        return [_position(row) for row in self.db.execute("SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at")]

    def closed_positions(self, limit: int = 60) -> list[Position]:
        return [_position(row) for row in self.db.execute("SELECT * FROM positions WHERE status = 'closed' ORDER BY closed_at DESC, id DESC LIMIT ?", (limit,))]

    def buys_since(self, since: int, mint: str | None = None) -> int:
        if mint is None:
            return self.db.execute("SELECT COUNT(*) FROM positions WHERE opened_at >= ?", (since,)).fetchone()[0]
        return self.db.execute("SELECT COUNT(*) FROM positions WHERE opened_at >= ? AND mint = ?", (since, mint)).fetchone()[0]

    def last_closed_at(self, mint: str) -> int | None:
        return self.db.execute("SELECT MAX(closed_at) FROM positions WHERE mint = ? AND status = 'closed'", (mint,)).fetchone()[0]

    def last_exit_high(self, mint: str) -> float | None:
        row = self.db.execute("SELECT exit_high FROM positions WHERE mint = ? AND status = 'closed' ORDER BY closed_at DESC, id DESC LIMIT 1", (mint,)).fetchone()
        return row["exit_high"] if row else None

    def record_buy(self, position: Position, fill: Fill, now: int) -> Position:
        with self._transaction():
            cursor = self.db.execute(
                f"INSERT INTO positions ({', '.join(POSITION_COLUMNS)}, entry_json) VALUES ({', '.join('?' for _ in POSITION_COLUMNS)}, ?)",
                (*[int(getattr(position, column)) if column == "target_done" else getattr(position, column) for column in POSITION_COLUMNS], json.dumps(position.entry)),
            )
            position.id = int(cursor.lastrowid or 0)
            self._fill(position.id, now, "buy", position.entry_spot, fill, "Buy")
            self.set("cash", self.cash - fill.net_usd)
        return position

    def record_sell(self, position: Position, fill: Fill, spot: float, reason: str, now: int) -> None:
        position.qty_open = max(0.0, position.qty_open - fill.qty)
        position.proceeds_usd += fill.net_usd
        position.fees_usd += fill.fee_usd
        if position.qty_open <= position.qty * 1e-9:
            position.qty_open = 0.0
            position.status = "closed"
            position.closed_at = now
            position.exit_reason = reason
        with self._transaction():
            self._fill(position.id, now, "sell", spot, fill, reason)
            self.set("cash", self.cash + fill.net_usd)
            self._save(position)

    def save(self, position: Position) -> None:
        self._save(position)

    def _save(self, position: Position) -> None:
        self.db.execute(
            "UPDATE positions SET qty_open = ?, proceeds_usd = ?, fees_usd = ?, last_liquidity = ?, peak_price = ?, peak_viewers = ?, last_price = ?, last_price_at = ?, target_done = ?, status = ?, closed_at = ?, exit_reason = ?, exit_high = ? WHERE id = ?",
            (position.qty_open, position.proceeds_usd, position.fees_usd, position.last_liquidity, position.peak_price, position.peak_viewers, position.last_price, position.last_price_at, int(position.target_done), position.status, position.closed_at, position.exit_reason, position.exit_high, position.id),
        )

    def _fill(self, position_id: int, now: int, side: str, spot: float, fill: Fill, reason: str) -> None:
        self.db.execute(
            "INSERT INTO fills (position_id, at, side, spot, price, qty, gross_usd, fee_usd, net_usd, impact_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (position_id, now, side, spot, fill.price, fill.qty, fill.gross_usd, fill.fee_usd, fill.net_usd, fill.impact_pct, reason),
        )

    def event(self, now: int, kind: str, text: str) -> None:
        self.db.execute("INSERT INTO events (t, kind, text) VALUES (?, ?, ?)", (now, kind, text))
        self.db.execute("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - 500")

    def events(self, limit: int = 40) -> list[dict[str, Any]]:
        return [dict(row) for row in self.db.execute("SELECT id, t, kind, text FROM events ORDER BY id DESC LIMIT ?", (limit,))]

    def events_after(self, event_id: int) -> list[dict[str, Any]]:
        return [dict(row) for row in self.db.execute("SELECT id, t, kind, text FROM events WHERE id > ? ORDER BY id", (event_id,))]

    def equity_point(self, now: int, equity: float, cash: float) -> None:
        self.db.execute("INSERT OR REPLACE INTO equity (t, equity, cash) VALUES (?, ?, ?)", (now, equity, cash))

    def equity_curve(self, limit: int = 120) -> list[dict[str, float]]:
        rows = self.db.execute("SELECT t, equity FROM equity ORDER BY t").fetchall()
        if len(rows) > limit:
            step = len(rows) / limit
            rows = [rows[min(len(rows) - 1, round(index * step))] for index in range(limit - 1)] + [rows[-1]]
        return [{"t": row["t"], "equity": round(row["equity"], 2)} for row in rows]

    def stats(self) -> dict[str, Any]:
        rows = self.db.execute("SELECT cost_usd, proceeds_usd, opened_at, closed_at FROM positions WHERE status = 'closed'").fetchall()
        returns = [(row["proceeds_usd"] - row["cost_usd"]) / row["cost_usd"] * 100 for row in rows if row["cost_usd"]]
        profits = [row["proceeds_usd"] - row["cost_usd"] for row in rows]
        wins = sum(1 for profit in profits if profit > 0)
        gained = sum(profit for profit in profits if profit > 0)
        lost = -sum(profit for profit in profits if profit < 0)
        fees = self.db.execute("SELECT COALESCE(SUM(fee_usd), 0) FROM fills").fetchone()[0]
        return {
            "trades": len(rows),
            "wins": wins,
            "losses": len(rows) - wins,
            "winRate": wins / len(rows) if rows else None,
            "realizedPnl": round(sum(profits), 2),
            "averageReturnPct": round(sum(returns) / len(returns), 2) if returns else None,
            "bestPct": round(max(returns), 2) if returns else None,
            "worstPct": round(min(returns), 2) if returns else None,
            "profitFactor": round(gained / lost, 2) if lost > 0 else None,
            "averageHoldMinutes": round(sum((row["closed_at"] - row["opened_at"]) / 60_000 for row in rows) / len(rows), 1) if rows else None,
            "feesPaid": round(fees, 2),
        }
