"""The bot's dials: one list (dials.json) shared with the Radar page, plus the settings file on this PC."""

from __future__ import annotations

import json
import math
import os
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

_SCHEMA = json.loads(Path(__file__).with_name("dials.json").read_text(encoding="utf-8"))
GROUPS: list[dict[str, str]] = _SCHEMA["groups"]
DIALS: list[dict[str, Any]] = _SCHEMA["dials"]
DIAL_BY_KEY: dict[str, dict[str, Any]] = {dial["key"]: dial for dial in DIALS}

Values = dict[str, Any]

FILE_HEADER = (
    "# Axiom paper-trading bot settings.\n"
    "# Edit and save: the running bot picks changes up within a few seconds.\n"
    "# The same dials are on the Radar page (Trading bot tab). The most recent change wins.\n"
)


def defaults() -> Values:
    return {dial["key"]: dial["default"] for dial in DIALS}


def clean(key: str, value: Any) -> Any:
    """One dial's value, clamped to its range, or its default when the value is missing or the wrong kind."""
    dial = DIAL_BY_KEY[key]
    kind = dial["type"]
    if kind == "toggle":
        return value if isinstance(value, bool) else dial["default"]
    if kind == "choice":
        return value if any(value == choice[0] for choice in dial["choices"]) else dial["default"]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return dial["default"]
    number = min(dial["max"], max(dial["min"], value))
    return int(number) if float(number).is_integer() else float(number)


def normalize(raw: Mapping[str, Any] | None) -> Values:
    source = raw if isinstance(raw, Mapping) else {}
    return {dial["key"]: clean(dial["key"], source.get(dial["key"])) for dial in DIALS}


def flatten(nested: Mapping[str, Any]) -> Values:
    """Turn TOML tables ([entry] min_score = 70) into dotted keys (entry.min_score)."""
    flat: Values = {}
    for group, table in nested.items():
        if isinstance(table, Mapping):
            for name, value in table.items():
                flat[f"{group}.{name}"] = value
    return flat


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value)
    return repr(value)


def to_toml(values: Mapping[str, Any]) -> str:
    lines = [FILE_HEADER]
    for group in GROUPS:
        lines.append(f"# {group['label']}: {group['caption'].lower()}.")
        lines.append(f"[{group['id']}]")
        for dial in DIALS:
            prefix, name = dial["key"].split(".", 1)
            if prefix != group["id"]:
                continue
            note = dial["label"]
            if dial.get("unit"):
                note += f" ({dial['unit']})"
            if dial.get("help"):
                note += f". {dial['help']}"
            lines.append(f"# {note}")
            if dial["type"] == "choice":
                lines.append("#   " + ", ".join(f"{json.dumps(choice[0])} = {choice[1]}" for choice in dial["choices"]))
            lines.append(f"{name} = {_toml_value(values[dial['key']])}")
        lines.append("")
    return "\n".join(lines)


def load_file(path: Path) -> Values:
    with path.open("rb") as handle:
        return normalize(flatten(tomllib.load(handle)))


def save_file(path: Path, values: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(to_toml(values), encoding="utf-8")
    os.replace(temporary, path)


def describe_changes(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    changes = []
    for dial in DIALS:
        key = dial["key"]
        if before.get(key) != after.get(key):
            changes.append(f"{dial['label']}: {before.get(key)} to {after.get(key)}")
    return changes
