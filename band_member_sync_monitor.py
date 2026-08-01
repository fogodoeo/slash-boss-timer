#!/usr/bin/env python3
"""Run the BAND monitor and mirror successful approvals to Supabase."""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import band_join_monitor as monitor_module


TRUE_VALUES = {"1", "true", "yes", "y", "on"}
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
BaseBandJoinMonitor = monitor_module.BandJoinMonitor


def enabled(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in TRUE_VALUES


class SupabaseMemberDirectory:
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self.enabled = enabled("BAND_MEMBER_SYNC_ENABLED", False)
        self.url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        self.service_role_key = os.environ.get(
            "SUPABASE_SERVICE_ROLE_KEY", ""
        ).strip()
        table = os.environ.get("BAND_MEMBER_TABLE", "band_members").strip()
        self.table = table if IDENTIFIER_RE.fullmatch(table) else ""
        self.timeout = 7.0
        self.attempts = 3
        self.configured = bool(
            self.enabled
            and self.url.startswith("https://")
            and self.service_role_key
            and self.table
        )

    def upsert(
        self,
        *,
        phone: str,
        display_name: str,
        member_key: str,
    ) -> tuple[bool, str]:
        if not self.enabled:
            return True, "disabled"
        if not self.configured:
            return False, "Supabase 회원 명단 환경변수가 준비되지 않았습니다."
        if not re.fullmatch(r"010\d{8}", phone):
            return False, "승인 프로필에서 유효한 전화번호를 확인하지 못했습니다."

        now = dt.datetime.now(dt.timezone.utc).isoformat()
        body = json.dumps(
            {
                "phone_normalized": phone,
                "display_name": display_name,
                "band_member_key": member_key or None,
                "is_active": True,
                "joined_at": now,
                "updated_at": now,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        query = urllib.parse.urlencode({"on_conflict": "phone_normalized"})
        endpoint = f"{self.url}/rest/v1/{self.table}?{query}"
        request = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "apikey": self.service_role_key,
                "Authorization": f"Bearer {self.service_role_key}",
                "Content-Type": "application/json; charset=utf-8",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )

        last_error = "unknown"
        for attempt in range(self.attempts):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    status = int(getattr(response, "status", 200))
                if 200 <= status < 300:
                    return True, "synced"
                last_error = f"HTTP {status}"
            except urllib.error.HTTPError as exc:
                last_error = f"HTTP {exc.code}"
            except (OSError, urllib.error.URLError) as exc:
                last_error = type(exc).__name__
            if attempt + 1 < self.attempts:
                time.sleep(0.5 * (attempt + 1))
        return False, f"Supabase 동기화 실패: {last_error}"


class SyncedBandJoinMonitor(BaseBandJoinMonitor):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.member_directory = SupabaseMemberDirectory(self.logger)
        self._last_member_sync: dict[str, Any] | None = None
        self._member_sync_results: dict[str, dict[str, Any]] = {}

    def runtime_status_extras(self) -> dict[str, Any]:
        directory = getattr(self, "member_directory", None)
        return {
            "member_sync": {
                "enabled": bool(directory and directory.enabled),
                "configured": bool(directory and directory.configured),
                "last_result": self._last_member_sync,
            }
        }

    def _record_member_sync(
        self, result: str, success: bool, request: Any | None = None
    ) -> None:
        self._last_member_sync = {
            "result": result,
            "success": success,
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        stable_key = str(getattr(request, "stable_key", "") or "")
        if stable_key:
            self._member_sync_results[stable_key] = dict(self._last_member_sync)

    def perform_action(self, request: Any, action: str) -> tuple[bool, str]:
        success, message = super().perform_action(request, action)
        if not success or action != "approve":
            return success, message

        profile = self.profile_matcher.match(request.display_name)
        if not profile.eligible or not profile.phone:
            self._record_member_sync("profile_phone_missing", False, request)
            self.logger.error(
                "BAND 승인 후 회원 명단 동기화 생략: 프로필 전화번호 없음"
            )
            return True, f"{message} 회원 명단에는 전화번호를 확인하지 못해 등록하지 못했습니다."

        phone_verification = self.phone_matcher.match(profile, request)
        if not phone_verification.eligible or not phone_verification.phone:
            self._record_member_sync("verified_phone_unavailable", False, request)
            self.logger.error(
                "BAND 승인 후 회원 명단 동기화 생략: 인증 전화번호 확인 불가"
            )
            return True, (
                f"{message} 인증 전화번호를 확인하지 못해 회원 명단에는 "
                "등록하지 않았습니다."
            )

        # When the profile number and BAND's verified number differ, retain both
        # as membership aliases. Either number can then unlock CREWART results.
        phones = list(dict.fromkeys(
            phone for phone in (profile.phone, phone_verification.phone)
            if re.fullmatch(r"010\d{8}", phone)
        ))
        results = [
            self.member_directory.upsert(
                phone=phone,
                display_name=profile.name,
                member_key=request.applicant_key or request.request_id,
            )
            for phone in phones
        ]
        synced = bool(results) and all(result[0] for result in results)
        if results and all(result[1] == "disabled" for result in results):
            detail = "disabled"
        elif len(results) <= 1:
            detail = results[0][1] if results else "no_phone"
        else:
            detail = "synced_profile_and_verified"
        if synced:
            self._record_member_sync(detail, True, request)
            if detail != "disabled":
                self.logger.info("BAND 승인 회원을 Supabase 명단에 등록했습니다.")
            return True, message

        self._record_member_sync("sync_failed", False, request)
        detail = "; ".join(result[1] for result in results if not result[0]) or "no_phone"
        self.logger.error("BAND 승인 후 회원 명단 동기화 실패: %s", detail)
        return True, f"{message} 다만 회원 명단 자동 등록은 실패했습니다."


def main() -> int:
    monitor_module.BandJoinMonitor = SyncedBandJoinMonitor
    return monitor_module.main()


if __name__ == "__main__":
    raise SystemExit(main())
