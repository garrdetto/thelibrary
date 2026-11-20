"""Talks to the library site: one call pulls the Radar and the saved dials, and sends the bot's results back."""

from __future__ import annotations

import gzip
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_ORIGIN = "https://thelibrary.garrdetto.workers.dev"
SYNC_PATH = "/api/admin/axiom/bot/sync"


class SiteError(Exception):
    pass


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def find_credentials(env_paths: list[Path]) -> tuple[str, str]:
    """(site origin, tracker key) from the environment, then from the first .env file that has the key."""
    token = os.environ.get("AXIOM_RADAR_TOKEN", "").strip()
    origin = os.environ.get("AXIOM_SITE_ORIGIN", "").strip()
    for path in env_paths:
        if token and origin:
            break
        values = read_env_file(path)
        token = token or values.get("AXIOM_RADAR_TOKEN", "").strip()
        origin = origin or values.get("AXIOM_SITE_ORIGIN", "").strip()
    return (origin or DEFAULT_ORIGIN).rstrip("/"), token


class Site:
    def __init__(self, origin: str, token: str, timeout: float = 10.0):
        self.endpoint = origin.rstrip("/") + SYNC_PATH
        self.token = token
        self.timeout = timeout

    def sync(self, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "Authorization": f"Bearer {self.token}",
                "User-Agent": "axiom-paper-bot",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise SiteError("The site refused the key. AXIOM_RADAR_TOKEN must match the site's secret.") from None
            if error.code == 404:
                raise SiteError("The site does not have the bot's sync route yet. Deploy the latest site.") from None
            raise SiteError(f"The site answered with an error ({error.code}).") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise SiteError(f"Could not reach the site ({getattr(error, 'reason', error)}).") from None
        try:
            result = json.loads(raw)
        except ValueError:
            raise SiteError("The site's reply could not be read.") from None
        if not isinstance(result, dict) or not result.get("ok"):
            raise SiteError("The site's reply could not be read.")
        return result


class FileSite:
    """Stands in for the site with a saved Radar payload, for trying the bot without a connection."""

    def __init__(self, path: Path):
        self.payload = json.loads(path.read_text(encoding="utf-8"))
        self.calls = 0

    def sync(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls += 1
        now = int(time.time() * 1000)
        return {"ok": True, "now": now, "payloadAt": now, "payload": self.payload, "settings": None, "command": {"flatten": 0, "reset": 0}}


LOCAL_FEED = "http://127.0.0.1:8791/live/data"


class LocalFeedSite:
    """Reads the Radar straight from the tracker on this PC (its /live/data feed, built fresh on every request) and talks
    to the site only for settings, commands and the bot's report, at most every `site_seconds` unless there is something
    to send. The site's copy of the Radar trails the tracker by a few seconds; this one is current to the second.
    Falls back to the site's copy when the tracker does not answer."""

    def __init__(self, site: Any, origin: str, url: str = LOCAL_FEED, site_seconds: float = 5.0, timeout: float = 2.0, clock: Any = None, fetch: Any = None):
        import time as _time
        self.site = site
        self.origin = origin.rstrip("/")
        self.url = url
        self.site_seconds = site_seconds
        self.timeout = timeout
        self.clock = clock or _time.time
        self.fetch = fetch or self._fetch
        self.last_site_at = float("-inf")
        self.site_have = 0
        self.last_site_reply: dict[str, Any] = {}
        self.local_ok = False

    def _fetch(self) -> dict[str, Any] | None:
        request = urllib.request.Request(self.url, headers={"Origin": self.origin, "Accept": "application/json", "User-Agent": "axiom-paper-bot"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                result = json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            return None
        return result if isinstance(result, dict) and isinstance(result.get("tokens"), list) else None

    def sync(self, body: dict[str, Any]) -> dict[str, Any]:
        now = self.clock()
        local = self.fetch()
        self.local_ok = local is not None
        must_send = "settings" in body or "report" in body
        if must_send or now - self.last_site_at >= self.site_seconds or local is None:
            forward = dict(body)
            if local is not None:
                forward["have"] = self.site_have
            reply = dict(self.site.sync(forward))
            self.last_site_at = now
            if reply.get("payloadAt") is not None:
                self.site_have = reply["payloadAt"]
            self.last_site_reply = {key: value for key, value in reply.items() if key not in ("payload", "payloadAt", "settings", "command")}
        else:
            reply = {**self.last_site_reply, "ok": True}
            if isinstance(reply.get("now"), (int, float)):
                reply["now"] = int(now * 1000)
        if local is not None:
            generated = local.get("generatedAt")
            reply["payload"] = local
            reply["payloadAt"] = int(generated) if isinstance(generated, (int, float)) else int(now * 1000)
            reply["now"] = int(now * 1000)
        return reply
