"""The bot's dials: one list (dials.json) shared with the Radar page, plus the settings file on this PC."""

from __future__ import annotations

import difflib
import json
import math
import os
import re
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

Values = dict[str, Any]

FILE_HEADER = (
    "# Axiom paper-trading bot settings.\n"
    "# Edit and save: the running bot picks changes up within a few seconds.\n"
    "# The same dials are on the Radar page (Trading bot tab). The most recent change wins.\n"
)
TRUE_WORDS = {"true", "on", "yes", "1"}
FALSE_WORDS = {"false", "off", "no", "0"}
_TEMPLATE = re.compile(r"\{([^}]+)\}")


class Schema:
    """A list of dials read from a JSON file: groups, dials with ranges and defaults, and renamed keys."""

    def __init__(self, path: Path):
        data = json.loads(path.read_text(encoding="utf-8"))
        self.groups: list[dict[str, str]] = data["groups"]
        self.dials: list[dict[str, Any]] = data["dials"]
        self.by_key: dict[str, dict[str, Any]] = {dial["key"]: dial for dial in self.dials}
        self.renamed: dict[str, str] = data.get("renamed", {})

    def defaults(self) -> Values:
        return {dial["key"]: dial["default"] for dial in self.dials}

    def clean(self, key: str, value: Any) -> Any:
        """One dial's value, clamped to its range, or its default when the value is missing or the wrong kind."""
        dial = self.by_key[key]
        kind = dial["type"]
        if kind == "toggle":
            return value if isinstance(value, bool) else dial["default"]
        if kind == "choice":
            return value if any(value == choice[0] for choice in dial["choices"]) else dial["default"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return dial["default"]
        number = min(dial["max"], max(dial["min"], value))
        return int(number) if float(number).is_integer() else float(number)

    def normalize(self, raw: Mapping[str, Any] | None) -> Values:
        """Every dial, cleaned. A renamed dial takes the old key's value when only that is present.
        An old key may name another value in braces, as in mode.{mode.pick_by}_buy_at."""
        source = dict(raw) if isinstance(raw, Mapping) else {}
        for key, old in self.renamed.items():
            if key in source:
                continue
            old_key = _TEMPLATE.sub(lambda match: str(source.get(match.group(1), "score")), old)
            if old_key in source:
                source[key] = source[old_key]
        return {dial["key"]: self.clean(dial["key"], source.get(dial["key"])) for dial in self.dials}


DIAL_SCHEMA = Schema(Path(__file__).with_name("dials.json"))
GROUPS = DIAL_SCHEMA.groups
DIALS = DIAL_SCHEMA.dials
DIAL_BY_KEY = DIAL_SCHEMA.by_key
RENAMED = DIAL_SCHEMA.renamed


def defaults() -> Values:
    return DIAL_SCHEMA.defaults()


def clean(key: str, value: Any) -> Any:
    return DIAL_SCHEMA.clean(key, value)


def parse_value(key: str, text: str) -> Any:
    """A dial's value from what someone typed (8, 30%, on, strict), cleaned and clamped. Raises ValueError with a plain reason."""
    dial = DIAL_BY_KEY.get(key)
    if dial is None:
        close = difflib.get_close_matches(key, list(DIAL_BY_KEY), n=3, cutoff=0.5)
        raise ValueError(f"There is no dial called {key}." + (f" Did you mean {', '.join(close)}?" if close else ""))
    word = text.strip().casefold()
    if dial["type"] == "toggle":
        if word in TRUE_WORDS:
            return True
        if word in FALSE_WORDS:
            return False
        raise ValueError(f"{dial['label']} takes on or off.")
    if dial["type"] == "choice":
        for choice, label in dial["choices"]:
            if word in (choice.casefold(), label.casefold(), label.split(":")[0].casefold()):
                return choice
        raise ValueError(f"{dial['label']} takes one of: {', '.join(choice for choice, _ in dial['choices'])}.")
    try:
        number = float(word.replace(",", "").replace("$", "").rstrip("%"))
    except ValueError:
        number = math.nan
    if not math.isfinite(number):
        raise ValueError(f"{dial['label']} takes a number from {dial['min']} to {dial['max']}.")
    return clean(key, number)


def normalize(raw: Mapping[str, Any] | None) -> Values:
    return DIAL_SCHEMA.normalize(raw)


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
        lines.append(f"# {group['label']}: {group['caption'][:1].lower()}{group['caption'][1:]}.")
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


def is_current(path: Path) -> bool:
    """True when the settings file holds exactly today's dials, so an older layout can be rewritten once."""
    try:
        with path.open("rb") as handle:
            return set(flatten(tomllib.load(handle))) == set(DIAL_BY_KEY)
    except (OSError, tomllib.TOMLDecodeError):
        return True


def save_file(path: Path, values: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(to_toml(values), encoding="utf-8")
    os.replace(temporary, path)


def _shown(value: Any) -> Any:
    return ("on" if value else "off") if isinstance(value, bool) else value


def describe_changes(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    changes = []
    for dial in DIALS:
        key = dial["key"]
        if before.get(key) != after.get(key):
            changes.append(f"{dial['label']}: {_shown(before.get(key))} to {_shown(after.get(key))}")
    return changes
