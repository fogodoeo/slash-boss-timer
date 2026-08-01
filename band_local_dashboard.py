#!/usr/bin/env python3
"""Live local dashboard for BAND join approval and CREWART member sync."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any

import band_join_monitor as monitor_module
from band_member_sync_monitor import SyncedBandJoinMonitor


ROOT = Path(__file__).resolve().parent


def load_env_file(path: Path) -> None:
    """Load a small dotenv file without overwriting the current environment."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or not key.replace("_", "a").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def compact(value: Any, width: int) -> str:
    text = " ".join(str(value or "-").split())
    if len(text) > width:
        return text[: max(1, width - 1)] + "…"
    return text


def request_row(monitor: SyncedBandJoinMonitor, request: Any) -> list[str]:
    profile = monitor.profile_matcher.match(request.display_name)
    profile_phone = getattr(profile, "phone", "") or "-"
    verified_phone = request.verified_phone or "-"
    if request.phone_verified is True:
        verification = "인증"
    elif request.phone_verified is False:
        verification = "미인증"
    else:
        verification = "확인대기"
    sync = getattr(monitor, "_member_sync_results", {}).get(request.stable_key)
    if sync:
        sync_text = "완료" if sync.get("success") else "실패"
    elif request.status == "APPROVED":
        sync_text = "확인필요"
    else:
        sync_text = "-"
    return [
        str(request.sequence), request.status, getattr(profile, "name", "") or request.display_name,
        profile_phone, verified_phone, verification,
        "통과" if request.eligible else "보류", sync_text,
    ]


def render_dashboard(monitor: SyncedBandJoinMonitor) -> str:
    directory = monitor.member_directory
    sync_state = "연결됨" if directory.configured else ("꺼짐" if not directory.enabled else "설정필요")
    connected = "연결됨" if monitor.connected_event.is_set() else "연결대기"
    rows = [request_row(monitor, item) for item in monitor.registry.list_items()]
    lines = [
        "BAND 가입 승인 · CREWART 연동 (로컬 CMD)",
        f"BAND: {connected} / 상태: {monitor.state} / Supabase 동기화: {sync_state}",
        f"자동승인: {'ON' if monitor.config.get('auto_approve_enabled') else 'OFF'} / "
        f"자동거절: {'ON' if monitor.config.get('auto_reject_enabled') else 'OFF'} / "
        f"감지 인원: {len(rows)}",
        "",
        "번호 | 상태           | 이름             | 프로필 번호  | BAND 인증번호 | 폰인증   | 판정 | CREWART",
        "-" * 104,
    ]
    for row in rows[-25:]:
        lines.append(
            f"{compact(row[0],4):>4} | {compact(row[1],14):<14} | "
            f"{compact(row[2],16):<16} | {compact(row[3],12):<12} | "
            f"{compact(row[4],13):<13} | {compact(row[5],8):<8} | "
            f"{compact(row[6],4):<4} | {compact(row[7],8)}"
        )
    if not rows:
        lines.append("현재 감지된 가입 신청이 없습니다.")
    last = getattr(monitor, "_last_member_sync", None)
    lines.extend([
        "",
        f"최근 연동: {last.get('result') if last else '-'} / {last.get('at') if last else '-'}",
        "키: [R] 새로고침  [O] BAND 창 열기  [A] 수동승인  [X] 수동거절  [Q] 종료",
    ])
    return "\n".join(lines)


def prompt_action(monitor: SyncedBandJoinMonitor, action: str) -> None:
    try:
        sequence = input("\n신청 번호: ").strip()
        if not sequence.isdigit():
            input("올바른 번호가 아닙니다. Enter를 누르세요.")
            return
        request = monitor.registry.get_by_sequence(int(sequence))
        if not request:
            input("해당 신청이 없습니다. Enter를 누르세요.")
            return
        label = "승인" if action == "approve" else "거절"
        if input(f"{request.display_name} 님을 {label}할까요? (y/N): ").strip().lower() not in {"y", "yes"}:
            return
        success, message = monitor.perform_action(request, action)
        input(f"{'완료' if success else '실패'}: {message}\nEnter를 누르세요.")
    except (EOFError, KeyboardInterrupt):
        return


def dashboard_loop(monitor: SyncedBandJoinMonitor) -> None:
    try:
        import msvcrt
    except ImportError:
        monitor_module.terminal_loop(monitor)
        return
    while not monitor.stop_event.is_set():
        sys.stdout.write("\x1b[2J\x1b[H" + render_dashboard(monitor) + "\n")
        sys.stdout.flush()
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline and not monitor.stop_event.is_set():
            if msvcrt.kbhit():
                key = msvcrt.getwch().lower()
                if key == "q":
                    return
                if key == "r":
                    monitor.refresh()
                elif key == "o":
                    monitor.bring_to_front()
                elif key == "a":
                    prompt_action(monitor, "approve")
                elif key == "x":
                    prompt_action(monitor, "reject")
                break
            time.sleep(0.05)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=monitor_module.DEFAULT_CONFIG_FILE)
    parser.add_argument("--check-config", action="store_true")
    return parser.parse_args()


def main() -> int:
    if os.name == "nt":
        os.system("chcp 65001 >nul")
    load_env_file(ROOT / ".env.band-local")
    args = parse_args()
    config_path = Path(args.config).expanduser().resolve()
    try:
        config = monitor_module.apply_environment_overrides(
            monitor_module.load_or_create_config(config_path)
        )
    except Exception as exc:
        print(f"설정 오류: {exc}")
        return 2
    if args.check_config:
        print("BAND 설정 정상 / 로컬 대시보드 준비됨")
        return 0
    monitor = SyncedBandJoinMonitor(config, config_path.parent)
    try:
        monitor.start()
        dashboard_loop(monitor)
    except KeyboardInterrupt:
        pass
    finally:
        monitor.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
