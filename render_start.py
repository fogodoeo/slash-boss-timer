#!/usr/bin/env python3
"""Run the existing Node web app and the BAND monitor in one Render service."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from typing import Optional


ROOT = Path(__file__).resolve().parent
STATUS_PATH = Path(
    os.environ.get("BAND_MONITOR_STATUS_FILE", "/var/data/band-monitor-runtime.json")
)
TRUE_VALUES = {"1", "true", "yes", "y", "on"}


def enabled(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in TRUE_VALUES


def write_disabled_status() -> None:
    try:
        STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": "render-supervisor-1",
            "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "state": "DISABLED",
            "detail": "BAND_MONITOR_ENABLED=false",
            "connected": False,
        }
        temporary = STATUS_PATH.with_suffix(STATUS_PATH.suffix + ".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(STATUS_PATH)
    except OSError as exc:
        print(f"[render-supervisor] status write failed: {exc}", flush=True)


def start_node() -> subprocess.Popen[bytes]:
    environment = os.environ.copy()
    environment.pop("BAND_COOKIE_HEADER", None)
    environment.setdefault("NODE_OPTIONS", "--max-old-space-size=160")
    command = ["node", str(ROOT / "slash-check-app.js")]
    print(f"[render-supervisor] starting web app: {' '.join(command)}", flush=True)
    return subprocess.Popen(command, cwd=ROOT, env=environment)


def resolve_chrome_executable(environment: dict[str, str]) -> str:
    """Find Chromium from Docker or Puppeteer's native-runtime download."""
    configured = environment.get("BAND_CHROME_EXECUTABLE", "").strip()
    if configured and Path(configured).is_file():
        return configured

    system_chromium = Path("/usr/bin/chromium")
    if system_chromium.is_file():
        return str(system_chromium)

    try:
        result = subprocess.run(
            [
                "node",
                "-e",
                (
                    "const p=require('puppeteer');"
                    "process.stdout.write(p.executablePath())"
                ),
            ],
            cwd=ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
        candidate = result.stdout.strip()
        if candidate and Path(candidate).is_file():
            return candidate
        print(
            "[render-supervisor] Puppeteer Chrome path is missing",
            flush=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(
            f"[render-supervisor] Puppeteer Chrome lookup failed: {exc}",
            flush=True,
        )
    return configured


def start_band_monitor() -> subprocess.Popen[bytes]:
    environment = os.environ.copy()
    environment["PYTHONUNBUFFERED"] = "1"
    chrome_executable = resolve_chrome_executable(environment)
    if chrome_executable:
        environment["BAND_CHROME_EXECUTABLE"] = chrome_executable
        print(
            "[render-supervisor] Headless Chrome is ready",
            flush=True,
        )
    config_path = environment.get(
        "BAND_MONITOR_CONFIG", str(ROOT / "band_join_monitor_config.json")
    )
    command = [
        sys.executable,
        str(ROOT / "band_join_monitor.py"),
        "--config",
        config_path,
        "--daemon",
    ]
    print("[render-supervisor] starting BAND monitor", flush=True)
    return subprocess.Popen(command, cwd=ROOT, env=environment)


def stop_process(process: Optional[subprocess.Popen[bytes]], name: str) -> None:
    if not process or process.poll() is not None:
        return
    print(f"[render-supervisor] stopping {name}", flush=True)
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    stopping = threading.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stopping.set()

    for signal_name in ("SIGTERM", "SIGINT"):
        signal_value = getattr(signal, signal_name, None)
        if signal_value is not None:
            signal.signal(signal_value, request_stop)

    node_process = start_node()
    # The combined Render image is specifically built to run both services.
    # Operators can still disable the BAND sidecar explicitly with the env var.
    band_enabled = enabled("BAND_MONITOR_ENABLED", True)
    band_process: Optional[subprocess.Popen[bytes]] = None
    if band_enabled:
        band_process = start_band_monitor()
    else:
        write_disabled_status()
        print(
            "[render-supervisor] BAND monitor disabled; set "
            "BAND_MONITOR_ENABLED=true to enable it",
            flush=True,
        )

    exit_code = 0
    try:
        while not stopping.wait(1):
            node_exit = node_process.poll()
            if node_exit is not None:
                print(
                    f"[render-supervisor] web app exited: {node_exit}",
                    flush=True,
                )
                exit_code = node_exit or 1
                break

            if band_enabled and band_process and band_process.poll() is not None:
                band_exit = band_process.returncode
                print(
                    f"[render-supervisor] BAND monitor exited: {band_exit}; "
                    "restarting in 10 seconds",
                    flush=True,
                )
                if stopping.wait(10):
                    break
                band_process = start_band_monitor()
    finally:
        stop_process(band_process, "BAND monitor")
        stop_process(node_process, "web app")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
