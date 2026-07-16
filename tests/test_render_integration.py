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
import urllib.request

import render_start


ROOT = Path(__file__).resolve().parents[1]


class RenderHealthIntegrationTests(unittest.TestCase):
    def test_supervisor_uses_configured_chrome(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            chrome = Path(temp_dir) / "chrome"
            chrome.write_bytes(b"test")
            resolved = render_start.resolve_chrome_executable(
                {"BAND_CHROME_EXECUTABLE": str(chrome)}
            )
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
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
