from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from axiom_paper.site import LocalFeedSite


class FakeSite:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def sync(self, body: dict) -> dict:
        self.calls.append(body)
        return {"ok": True, "now": 1000, "payloadAt": 900, "payload": {"tokens": [{"mint": "site"}]}, "settings": {"updatedAt": 5}}


class LocalFeedTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t = 100.0
        self.local: dict | None = {"generatedAt": 123456, "tokens": [{"mint": "local"}]}
        self.site = FakeSite()
        self.feed = LocalFeedSite(self.site, "https://example.org", clock=lambda: self.t, fetch=lambda: self.local, site_seconds=5)

    def test_reads_the_tracker_every_call_and_the_site_every_few_seconds(self) -> None:
        first = self.feed.sync({"have": 0})
        self.assertEqual(first["payload"]["tokens"][0]["mint"], "local")
        self.assertEqual(first["payloadAt"], 123456)
        self.assertEqual(first["settings"], {"updatedAt": 5})
        self.assertEqual(len(self.site.calls), 1)
        self.t += 1
        second = self.feed.sync({"have": 123456})
        self.assertEqual(second["payload"]["tokens"][0]["mint"], "local")
        self.assertNotIn("settings", second)
        self.assertEqual(len(self.site.calls), 1)
        self.t += 5
        self.feed.sync({"have": 123456})
        self.assertEqual(len(self.site.calls), 2)
        self.assertEqual(self.site.calls[1]["have"], 900)

    def test_reports_and_settings_always_reach_the_site(self) -> None:
        self.feed.sync({"have": 0})
        self.t += 1
        self.feed.sync({"have": 0, "report": {"x": 1}})
        self.assertEqual(len(self.site.calls), 2)

    def test_falls_back_to_the_site_copy_when_the_tracker_is_down(self) -> None:
        self.local = None
        reply = self.feed.sync({"have": 0})
        self.assertEqual(reply["payload"]["tokens"][0]["mint"], "site")


if __name__ == "__main__":
    unittest.main()
