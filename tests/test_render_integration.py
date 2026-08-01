from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from unittest import mock
import urllib.request

import render_start


ROOT = Path(__file__).resolve().parents[1]


class RenderHealthIntegrationTests(unittest.TestCase):
    def test_disabled_status_describes_safe_runtime_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            status_path = Path(temp_dir) / "runtime.json"
            with mock.patch.object(render_start, "STATUS_PATH", status_path), mock.patch.dict(
                os.environ,
                {
                    "BAND_MEMBER_SYNC_ENABLED": "true",
                    "SUPABASE_URL": "https://project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "service-role-secret",
                    "BAND_MEMBER_TABLE": "band_members",
                },
                clear=False,
            ):
                render_start.write_disabled_status()

            payload = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertFalse(payload["monitor_enabled"])
            self.assertTrue(payload["auto_approve"])
            self.assertTrue(payload["auto_reject"])
            self.assertTrue(payload["phone_verification"]["require_number_match"])
            self.assertTrue(payload["member_sync"]["configured"])
            self.assertNotIn("service-role-secret", status_path.read_text(encoding="utf-8"))

    def test_supervisor_uses_configured_chrome(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            chrome = Path(temp_dir) / "chrome"
            chrome.write_bytes(b"test")
            resolved = render_start.resolve_chrome_executable(
                {"BAND_CHROME_EXECUTABLE": str(chrome)}
            )
            self.assertEqual(resolved, str(chrome))

    def test_supervisor_finds_render_puppeteer_chrome(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chrome = (
                root
                / "node_modules"
                / ".cache"
                / "puppeteer"
                / "chrome"
                / "linux-150.0.0.0"
                / "chrome-linux64"
                / "chrome"
            )
            chrome.parent.mkdir(parents=True)
            chrome.write_bytes(b"test")
            resolved = render_start.resolve_chrome_executable({}, root=root)
            self.assertEqual(resolved, str(chrome))

    @unittest.skipUnless(shutil.which("node"), "Node.js is required")
    def test_health_exposes_band_monitor_status(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            status_path = state_dir / "band-monitor-runtime.json"
            status_path.write_text(
                json.dumps(
                    {
                        "state": "CONNECTED",
                        "connected": True,
                        "headless": True,
                        "monitor_enabled": True,
                        "detail": "신청자 01012345678 확인",
                        "applications": {"tracked": 3, "eligible": 1},
                        "member_sync": {"enabled": True, "configured": True},
                        "private_secret": "must-not-leak",
                    }
                ),
                encoding="utf-8",
            )
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]

            environment = os.environ.copy()
            environment.update(
                {
                    "PORT": str(port),
                    "STATE_DIR": str(state_dir),
                    "BAND_MONITOR_STATUS_FILE": str(status_path),
                    "SLASH_CHECK_ADMIN_PASSWORD": "render-test-only",
                }
            )
            process = subprocess.Popen(
                ["node", str(ROOT / "slash-check-app.js")],
                cwd=ROOT,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                deadline = time.monotonic() + 8
                payload = None
                while time.monotonic() < deadline:
                    try:
                        with urllib.request.urlopen(
                            f"http://127.0.0.1:{port}/health",
                            timeout=1,
                        ) as response:
                            payload = json.loads(response.read().decode("utf-8"))
                            break
                    except OSError:
                        time.sleep(0.1)
                self.assertIsNotNone(payload)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["bandMonitor"]["state"], "CONNECTED")
                self.assertTrue(payload["bandMonitor"]["connected"])
                self.assertTrue(payload["bandMonitor"]["headless"])
                self.assertEqual(payload["bandMonitor"]["applications"]["tracked"], 3)
                self.assertEqual(payload["bandMonitor"]["detail"], "신청자 010-****-5678 확인")
                self.assertNotIn("private_secret", payload["bandMonitor"])

                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/band-monitor/status",
                    timeout=1,
                ) as response:
                    status_payload = json.loads(response.read().decode("utf-8"))
                self.assertTrue(status_payload["ok"])
                self.assertEqual(status_payload["monitor"]["state"], "CONNECTED")
                self.assertTrue(status_payload["monitor"]["member_sync"]["configured"])
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
