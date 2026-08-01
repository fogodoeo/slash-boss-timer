from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock

from band_local_dashboard import load_env_file, request_row


class LocalEnvironmentTests(unittest.TestCase):
    def test_load_env_file_does_not_override_existing_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.band-local"
            path.write_text("SYNC_TEST=from-file\nNEW_SYNC_TEST='loaded'\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"SYNC_TEST": "existing"}, clear=False):
                os.environ.pop("NEW_SYNC_TEST", None)
                load_env_file(path)
                self.assertEqual(os.environ["SYNC_TEST"], "existing")
                self.assertEqual(os.environ["NEW_SYNC_TEST"], "loaded")
                os.environ.pop("NEW_SYNC_TEST", None)


class DashboardRowTests(unittest.TestCase):
    def test_row_shows_profile_and_band_phone_separately(self) -> None:
        monitor = SimpleNamespace(
            profile_matcher=SimpleNamespace(match=lambda _name: SimpleNamespace(name="홍길동", phone="01012345678")),
            _member_sync_results={"stable": {"success": True}},
        )
        request = SimpleNamespace(
            sequence=3,
            stable_key="stable",
            status="APPROVED",
            display_name="홍길동/010-1234-5678",
            verified_phone="01012345678",
            phone_verified=True,
            eligible=True,
        )
        row = request_row(monitor, request)
        self.assertEqual(row[2:6], ["홍길동", "01012345678", "01012345678", "인증"])
        self.assertEqual(row[-1], "완료")


if __name__ == "__main__":
    unittest.main()
