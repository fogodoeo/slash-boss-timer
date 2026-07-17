#!/usr/bin/env python3
"""Standalone BAND membership application monitor.

This module connects to a dedicated Chrome instance through the Chrome
DevTools Protocol (CDP).  It deliberately uses only the Python standard
library so the monitor can run without pip-installing packages.

The monitor observes Fetch/XHR responses and DOM changes, then uses BAND's
logged-in web client for fast application, approval, rejection, and applicant
comment operations.  A narrowly scoped DOM fallback remains available.
Diagnostic output is sanitized before it is written.
"""

from __future__ import annotations

import argparse
import base64
import collections
import dataclasses
import datetime as dt
import hashlib
import http.client
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import queue
import random
import re
import signal
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable, Mapping, Optional


APP_NAME = "BAND 가입 신청 모니터"
VERSION = "0.2.0"
DEFAULT_CONFIG_FILE = "band_join_monitor_config.json"
DOM_SIGNAL_BINDING = "__bandJoinMonitorSignal"
BAND_NO_RE = re.compile(r"/band/(\d+)")

DEFAULT_CONFIG: dict[str, Any] = {
    "chrome_port": 9333,
    "chrome_executable": "",
    "chrome_profile_dir": ".band_join_chrome_profile",
    "chrome_headless": False,
    "chrome_extra_args": [],
    "band_start_url": "https://band.us/",
    "monitor_enabled": True,
    "notification_enabled": True,
    "notification_trigger_enabled": True,
    "notification_refresh_cooldown_seconds": 2,
    "application_count_poll_seconds": 0.5,
    "applications_safety_refresh_seconds": 60,
    "auto_approve_enabled": False,
    "auto_reject_enabled": False,
    "dom_action_enabled": False,
    "poll_fallback_seconds": 3,
    "dom_event_poll_seconds": 0.1,
    "approval_delay_seconds": 2,
    "action_rate_limit_seconds": 0,
    "diagnostic_mode": False,
    "diagnostic_file": "band_join_diagnostics.jsonl",
    "state_file": "band_join_monitor_state.json",
    "log_file": "band_join_monitor.log",
    "runtime_status_file": "band_join_monitor_runtime.json",
    "max_applicants": 500,
    "max_event_queue": 1000,
    "processed_state_limit": 500,
    "missing_expire_seconds": 15,
    "profile_rules": {
        "name_min_length": 2,
        "name_max_length": 5,
        "require_010_phone": True,
        "phone_digits": 11,
        "ignore_region_words": True,
    },
    "answer_rules": {
        "required": True,
        "allowed_codes": ["R", "G", "B", "Y"],
        "case_insensitive": True,
    },
    "follow_up_question": {
        "enabled": False,
        "recheck_seconds": 2,
        "prepare_retry_seconds": 10,
        "profile_message": (
            "프로필명을 '한글이름 010전화번호' 형식으로 수정해 주세요. "
            "예: 김상정 01049278600\n"
            "수정 후 '수정완료'라고 답변해 주세요."
        ),
        "answer_message": (
            "기숙사 코드를 R, G, B, Y 중 하나만 답변해 주세요."
        ),
        "profile_and_answer_message": (
            "가입 조건 확인이 필요합니다.\n"
            "1. 프로필명을 '한글이름 010전화번호' 형식으로 수정해 주세요. "
            "예: 김상정 01049278600\n"
            "2. 이 추가 질문에는 기숙사 코드 R, G, B, Y 중 하나만 "
            "답변해 주세요.\n"
            "수정한 내용은 자동으로 다시 확인합니다."
        ),
    },
}

TRUE_VALUES = {"1", "true", "yes", "y", "on"}
FALSE_VALUES = {"0", "false", "no", "n", "off"}

SENSITIVE_KEY_RE = re.compile(
    r"(authorization|cookie|token|secret|password|passwd|credential|session)",
    re.IGNORECASE,
)
PHONE_RE = re.compile(r"(?<!\d)010(?:[\s./_-]*\d){8}(?!\d)")
PHONE_ANY_RE = re.compile(r"(?<!\d)01[016789](?:[\s./_-]*\d){7,8}(?!\d)")
HANGUL_NAME_RE = re.compile(r"^[가-힣]{2,5}$")
JOIN_TERMS = (
    "join",
    "member_request",
    "membership_request",
    "application",
    "applicant",
    "pending_member",
    "member_apply",
    "가입",
    "가입신청",
    "가입 신청",
    "신청자",
    "승인대기",
    "승인 대기",
)
ACTION_TERMS = (
    "approve",
    "accept",
    "reject",
    "decline",
    "승인",
    "수락",
    "거절",
    "반려",
)
REGION_WORDS = {
    "서울",
    "서울시",
    "서울특별시",
    "부산",
    "부산시",
    "부산광역시",
    "대구",
    "대구시",
    "대구광역시",
    "인천",
    "인천시",
    "인천광역시",
    "광주",
    "광주시",
    "광주광역시",
    "대전",
    "대전시",
    "대전광역시",
    "울산",
    "울산시",
    "울산광역시",
    "세종",
    "세종시",
    "세종특별자치시",
    "경기",
    "경기도",
    "강원",
    "강원도",
    "강원특별자치도",
    "충북",
    "충청북도",
    "충남",
    "충청남도",
    "전북",
    "전라북도",
    "전북특별자치도",
    "전남",
    "전라남도",
    "경북",
    "경상북도",
    "경남",
    "경상남도",
    "제주",
    "제주도",
    "제주특별자치도",
}

PRINT_LOCK = threading.RLock()


def console_print(message: str = "", *, end: str = "\n") -> None:
    with PRINT_LOCK:
        print(message, end=end, flush=True)


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def mask_phone(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group(0))
        if len(digits) < 7:
            return "***"
        return f"{digits[:3]}-****-{digits[-4:]}"

    return PHONE_ANY_RE.sub(repl, text)


def safe_for_log(text: Any, limit: int = 400) -> str:
    value = mask_phone(str(text))
    value = re.sub(r"[\r\n\t]+", " ", value).strip()
    return value[:limit]


def deep_merge(defaults: Mapping[str, Any], supplied: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in defaults.items():
        if isinstance(value, Mapping):
            supplied_value = supplied.get(key, {})
            if isinstance(supplied_value, Mapping):
                result[key] = deep_merge(value, supplied_value)
            else:
                result[key] = deep_merge(value, {})
        else:
            result[key] = supplied.get(key, value)
    for key, value in supplied.items():
        if key not in result:
            result[key] = value
    return result


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    return default


def apply_environment_overrides(config: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(config)
    is_render = any(
        os.environ.get(name)
        for name in ("RENDER", "RENDER_SERVICE_ID", "RENDER_EXTERNAL_URL")
    )
    if is_render:
        result.update(
            {
                "chrome_executable": "/usr/bin/chromium",
                "chrome_profile_dir": "/var/data/band-chrome-profile",
                "chrome_headless": True,
                "state_file": "/var/data/band-join-monitor-state.json",
                "log_file": "/var/data/band-join-monitor.log",
                "diagnostic_file": "/var/data/band-join-diagnostics.jsonl",
                "runtime_status_file": "/var/data/band-monitor-runtime.json",
            }
        )

    string_overrides = {
        "BAND_CHROME_EXECUTABLE": "chrome_executable",
        "BAND_CHROME_PROFILE_DIR": "chrome_profile_dir",
        "BAND_START_URL": "band_start_url",
        "BAND_MONITOR_STATE_FILE": "state_file",
        "BAND_MONITOR_LOG_FILE": "log_file",
        "BAND_MONITOR_STATUS_FILE": "runtime_status_file",
    }
    for environment_name, config_name in string_overrides.items():
        value = os.environ.get(environment_name)
        if value:
            result[config_name] = value.strip()

    result["monitor_enabled"] = env_bool(
        "BAND_MONITOR_ENABLED", bool(result.get("monitor_enabled", True))
    )
    result["chrome_headless"] = env_bool(
        "BAND_CHROME_HEADLESS", bool(result.get("chrome_headless", False))
    )
    return result


def resolve_relative(base_dir: Path, value: str) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(value)))
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


def load_or_create_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        path.write_text(
            json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        console_print(f"[설정] 기본 설정 파일을 만들었습니다: {path}")
        return json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        supplied = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"설정 파일을 읽을 수 없습니다: {exc}") from exc
    if not isinstance(supplied, dict):
        raise RuntimeError("설정 파일의 최상위 값은 JSON 객체여야 합니다.")
    return deep_merge(DEFAULT_CONFIG, supplied)


def configure_logging(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("band_join_monitor")
    for existing in logger.handlers:
        try:
            existing.close()
        except Exception:
            pass
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_path,
        maxBytes=1_000_000,
        backupCount=2,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    )
    logger.addHandler(handler)
    return logger


@dataclasses.dataclass(slots=True)
class ProfileMatch:
    eligible: bool
    name: str = ""
    phone: str = ""
    reason: str = ""


class ProfileRuleMatcher:
    def __init__(self, config: Mapping[str, Any]):
        self.min_length = int(config.get("name_min_length", 2))
        self.max_length = int(config.get("name_max_length", 5))
        self.require_010 = bool(config.get("require_010_phone", True))
        self.phone_digits = int(config.get("phone_digits", 11))
        self.ignore_region_words = bool(config.get("ignore_region_words", True))

    @staticmethod
    def _extract_phone(text: str) -> tuple[str, str]:
        match = PHONE_RE.search(text)
        if not match:
            return "", text
        digits = re.sub(r"\D", "", match.group(0))
        remaining = text[: match.start()] + " " + text[match.end() :]
        return digits, remaining

    def match(self, display_name: str) -> ProfileMatch:
        raw = " ".join(str(display_name).split())
        phone, remaining = self._extract_phone(raw)
        if not phone:
            return ProfileMatch(False, reason="010 휴대폰 번호 없음")
        if len(phone) != self.phone_digits:
            return ProfileMatch(False, phone=phone, reason="휴대폰 번호 자릿수 오류")
        if self.require_010 and not phone.startswith("010"):
            return ProfileMatch(False, phone=phone, reason="010 번호가 아님")

        tokens = [
            token
            for token in re.split(r"[\s/|,;:()[\]{}<>_-]+", remaining)
            if token
        ]
        candidates: list[str] = []
        for token in tokens:
            cleaned = re.sub(r"[^가-힣]", "", token)
            if not cleaned:
                continue
            if self.ignore_region_words and cleaned in REGION_WORDS:
                continue
            if (
                self.min_length <= len(cleaned) <= self.max_length
                and re.fullmatch(r"[가-힣]+", cleaned)
            ):
                candidates.append(cleaned)
        if not candidates:
            return ProfileMatch(False, phone=phone, reason="한글 이름 없음")

        # Prefer an exact token over a token that had punctuation removed.
        name = candidates[0]
        return ProfileMatch(True, name=name, phone=phone, reason="이름/전화번호 확인")


@dataclasses.dataclass(slots=True)
class AnswerMatch:
    eligible: bool
    code: str = ""
    reason: str = ""


class JoinAnswerMatcher:
    def __init__(self, config: Mapping[str, Any]):
        self.required = bool(config.get("required", True))
        self.case_insensitive = bool(config.get("case_insensitive", True))
        supplied = config.get("allowed_codes", ["R", "G", "B", "Y"])
        codes = supplied if isinstance(supplied, list) else []
        self.allowed_codes = {
            self._normalize(str(code))
            for code in codes
            if self._normalize(str(code))
        }

    def _normalize(self, value: str) -> str:
        normalized = str(value).strip()
        return normalized.upper() if self.case_insensitive else normalized

    def match(self, answer: str) -> AnswerMatch:
        code = self._normalize(answer)
        if not code:
            if self.required:
                return AnswerMatch(False, reason="기숙사 코드 답변 없음")
            return AnswerMatch(True, reason="기숙사 코드 답변 선택사항")
        if code not in self.allowed_codes:
            allowed = "/".join(sorted(self.allowed_codes))
            return AnswerMatch(
                False,
                code=code,
                reason=f"기숙사 코드 오류 ({allowed} 중 하나 필요)",
            )
        return AnswerMatch(True, code=code, reason=f"기숙사 코드 {code} 확인")


@dataclasses.dataclass(slots=True)
class BandJoinRequest:
    stable_key: str
    display_name: str
    request_id: str = ""
    applicant_key: str = ""
    application_time: str = ""
    application_answer: str = ""
    application_reply: str = ""
    status: str = "PENDING"
    source: str = "UNKNOWN"
    first_seen: str = dataclasses.field(default_factory=now_iso)
    last_seen_monotonic: float = dataclasses.field(default_factory=time.monotonic)
    sequence: int = 0
    eligible: bool = False
    eligibility_reason: str = ""
    observation_fingerprint: str = ""

    @property
    def masked_display_name(self) -> str:
        return mask_phone(self.display_name)

    @property
    def follow_up_identity(self) -> str:
        identity = self.applicant_key or self.request_id or self.stable_key
        raw = f"follow-up:{identity}|{self.application_time.strip()}"
        return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()

    def content_fingerprint(self) -> str:
        raw = "|".join(
            (
                self.display_name.strip(),
                self.application_answer.strip(),
                self.application_reply.strip(),
            )
        )
        return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def make_stable_key(
    *,
    request_id: str,
    display_name: str,
    application_time: str,
    source: str,
) -> str:
    if request_id:
        raw = f"id:{request_id}|time:{application_time.strip()}"
    else:
        raw = f"{source}|{display_name.strip()}|{application_time.strip()}"
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


class DeduplicationStateManager:
    def __init__(
        self,
        state_path: Path,
        max_applicants: int = 500,
        processed_state_limit: int = 500,
    ):
        self.state_path = state_path
        self.max_applicants = max(10, max_applicants)
        self.processed_state_limit = max(10, processed_state_limit)
        self._lock = threading.RLock()
        self._items: "collections.OrderedDict[str, BandJoinRequest]" = (
            collections.OrderedDict()
        )
        self._sequence_map: dict[int, str] = {}
        self._processed_hashes: "collections.OrderedDict[str, str]" = (
            collections.OrderedDict()
        )
        self._follow_up_questions: "collections.OrderedDict[str, dict[str, Any]]" = (
            collections.OrderedDict()
        )
        self._next_sequence = 1
        self._load()

    def _load(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8-sig"))
            processed = data.get("processed", {})
            if isinstance(processed, dict):
                for key, status in list(processed.items())[-self.processed_state_limit :]:
                    if re.fullmatch(r"[0-9a-f]{64}", str(key)):
                        self._processed_hashes[str(key)] = str(status)
            questions = data.get("follow_up_questions", {})
            if isinstance(questions, dict):
                for key, record in list(questions.items())[
                    -self.processed_state_limit :
                ]:
                    if (
                        re.fullmatch(r"[0-9a-f]{64}", str(key))
                        and isinstance(record, Mapping)
                    ):
                        self._follow_up_questions[str(key)] = dict(record)
        except (OSError, json.JSONDecodeError):
            return

    def _save(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 2,
            "processed": dict(
                list(self._processed_hashes.items())[-self.processed_state_limit :]
            ),
            "follow_up_questions": dict(
                list(self._follow_up_questions.items())[
                    -self.processed_state_limit :
                ]
            ),
        }
        tmp = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(self.state_path)

    def upsert_detailed(
        self, request: BandJoinRequest
    ) -> tuple[BandJoinRequest, bool, bool]:
        with self._lock:
            existing = self._items.get(request.stable_key)
            if existing:
                existing.last_seen_monotonic = time.monotonic()
                changed = False
                if request.display_name and request.display_name != existing.display_name:
                    existing.display_name = request.display_name
                    changed = True
                if request.application_time and not existing.application_time:
                    existing.application_time = request.application_time
                    changed = True
                if request.request_id and not existing.request_id:
                    existing.request_id = request.request_id
                    changed = True
                if request.applicant_key and not existing.applicant_key:
                    existing.applicant_key = request.applicant_key
                    changed = True
                if (
                    request.application_answer
                    and request.application_answer != existing.application_answer
                ):
                    existing.application_answer = request.application_answer
                    changed = True
                if (
                    request.application_reply
                    and request.application_reply != existing.application_reply
                ):
                    existing.application_reply = request.application_reply
                    changed = True
                if request.source not in existing.source.split("+"):
                    existing.source = f"{existing.source}+{request.source}"
                fingerprint = existing.content_fingerprint()
                if fingerprint != existing.observation_fingerprint:
                    existing.observation_fingerprint = fingerprint
                    changed = True
                return existing, False, changed

            request.sequence = self._next_sequence
            self._next_sequence += 1
            request.observation_fingerprint = request.content_fingerprint()
            previous_status = self._processed_hashes.get(request.stable_key)
            if previous_status:
                request.status = previous_status
            self._items[request.stable_key] = request
            self._sequence_map[request.sequence] = request.stable_key
            while len(self._items) > self.max_applicants:
                old_key, old_item = self._items.popitem(last=False)
                self._sequence_map.pop(old_item.sequence, None)
                if old_item.status != "PENDING":
                    self._processed_hashes[old_key] = old_item.status
            return request, True, True

    def upsert(self, request: BandJoinRequest) -> tuple[BandJoinRequest, bool]:
        stored, is_new, _changed = self.upsert_detailed(request)
        return stored, is_new

    def get_by_sequence(self, sequence: int) -> Optional[BandJoinRequest]:
        with self._lock:
            key = self._sequence_map.get(sequence)
            return self._items.get(key) if key else None

    def list_items(self) -> list[BandJoinRequest]:
        with self._lock:
            return list(self._items.values())

    def set_status(self, stable_key: str, status: str) -> None:
        with self._lock:
            item = self._items.get(stable_key)
            if item:
                item.status = status
            if status not in {
                "PENDING",
                "ELIGIBLE",
                "INVALID",
                "AWAITING_CORRECTION",
                "QUESTION_SENDING",
                "QUESTION_FAILED",
                "ACTION_SENT",
            }:
                self._processed_hashes[stable_key] = status
                self._processed_hashes.move_to_end(stable_key)
                while len(self._processed_hashes) > self.processed_state_limit:
                    self._processed_hashes.popitem(last=False)
                self._save()

    def follow_up_status(self, identity: str) -> str:
        with self._lock:
            record = self._follow_up_questions.get(identity, {})
            return str(record.get("status", "")) if record else ""

    def begin_follow_up(
        self,
        identity: str,
        *,
        stable_key: str,
        reason_codes: Iterable[str],
        message: str,
    ) -> bool:
        with self._lock:
            if identity in self._follow_up_questions:
                return False
            self._follow_up_questions[identity] = {
                "status": "SENDING",
                "stable_key": stable_key,
                "reason_codes": list(reason_codes),
                "message_hash": hashlib.sha256(
                    message.encode("utf-8", errors="replace")
                ).hexdigest(),
                "attempted_at": now_iso(),
            }
            self._trim_follow_up_questions()
            self._save()
            return True

    def finish_follow_up(
        self,
        identity: str,
        status: str,
        detail: str = "",
    ) -> None:
        with self._lock:
            record = self._follow_up_questions.get(identity)
            if not record:
                return
            record["status"] = status
            record["finished_at"] = now_iso()
            if detail:
                record["detail"] = safe_for_log(detail, 160)
            self._follow_up_questions.move_to_end(identity)
            self._trim_follow_up_questions()
            self._save()

    def _trim_follow_up_questions(self) -> None:
        while len(self._follow_up_questions) > self.processed_state_limit:
            self._follow_up_questions.popitem(last=False)

    def mark_missing(
        self,
        active_keys: set[str],
        source_prefix: str = "DOM",
        expire_after: float = 15.0,
    ) -> list[BandJoinRequest]:
        expired: list[BandJoinRequest] = []
        now = time.monotonic()
        with self._lock:
            for key, item in self._items.items():
                if source_prefix not in item.source:
                    continue
                if item.status not in {
                    "PENDING",
                    "ELIGIBLE",
                    "INVALID",
                    "AWAITING_CORRECTION",
                    "QUESTION_SENDING",
                    "QUESTION_FAILED",
                    "ACTION_SENT",
                }:
                    continue
                if key in active_keys:
                    continue
                if now - item.last_seen_monotonic < expire_after:
                    continue
                item.status = "EXPIRED"
                self._processed_hashes[key] = item.status
                expired.append(item)
            if expired:
                self._save()
        return expired


class BoundedQueue:
    def __init__(self, maxsize: int):
        self.queue: "queue.Queue[Any]" = queue.Queue(maxsize=max(10, maxsize))

    def put(self, item: Any) -> None:
        try:
            self.queue.put_nowait(item)
        except queue.Full:
            try:
                self.queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self.queue.put_nowait(item)
            except queue.Full:
                pass

    def get(self, timeout: Optional[float] = None) -> Any:
        return self.queue.get(timeout=timeout)


class DiagnosticSanitizer:
    @staticmethod
    def sanitize_url(url: str) -> str:
        try:
            parsed = urllib.parse.urlsplit(url)
            segments = []
            for segment in parsed.path.split("/"):
                if not segment:
                    segments.append(segment)
                    continue
                if len(segment) > 24 or re.fullmatch(r"[A-Za-z0-9_-]{18,}", segment):
                    segments.append(":id")
                elif re.fullmatch(r"\d{5,}", segment):
                    segments.append(":number")
                else:
                    segments.append(segment)
            return urllib.parse.urlunsplit(
                (parsed.scheme, parsed.netloc, "/".join(segments), "", "")
            )
        except Exception:
            return "<invalid-url>"

    @classmethod
    def sanitize_headers(cls, headers: Mapping[str, Any]) -> dict[str, str]:
        sanitized: dict[str, str] = {}
        for key, value in headers.items():
            if SENSITIVE_KEY_RE.search(str(key)):
                continue
            text = safe_for_log(value, 120)
            sanitized[str(key)] = text
        return sanitized

    @classmethod
    def payload_shape(cls, value: Any, depth: int = 0) -> Any:
        if depth > 5:
            return "<max-depth>"
        if isinstance(value, Mapping):
            result: dict[str, Any] = {}
            for key, item in list(value.items())[:40]:
                key_text = str(key)
                if SENSITIVE_KEY_RE.search(key_text):
                    result[key_text] = "<redacted>"
                else:
                    result[key_text] = cls.payload_shape(item, depth + 1)
            return result
        if isinstance(value, list):
            if not value:
                return []
            return [cls.payload_shape(value[0], depth + 1), f"<count:{len(value)}>"]
        if isinstance(value, bool):
            return "<bool>"
        if isinstance(value, (int, float)):
            return "<number>"
        if value is None:
            return None
        text = str(value)
        if PHONE_ANY_RE.search(text):
            return "<phone>"
        if len(text) > 80 or re.search(r"[A-Za-z0-9_-]{24,}", text):
            return "<string>"
        return safe_for_log(text, 80)

    @classmethod
    def event_record(cls, kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        record: dict[str, Any] = {"time": now_iso(), "kind": kind}
        for key, value in payload.items():
            if SENSITIVE_KEY_RE.search(str(key)):
                continue
            if key == "url":
                record[key] = cls.sanitize_url(str(value))
            elif key == "headers" and isinstance(value, Mapping):
                record[key] = cls.sanitize_headers(value)
            elif key in {"body", "payload", "post_data"}:
                if isinstance(value, str):
                    try:
                        decoded = json.loads(value)
                    except json.JSONDecodeError:
                        decoded = "<non-json>"
                else:
                    decoded = value
                record[key] = cls.payload_shape(decoded)
            else:
                record[key] = cls.payload_shape(value)
        return record


class DiagnosticWriter:
    def __init__(self, path: Path, enabled: bool, logger: logging.Logger):
        self.path = path
        self.enabled = enabled
        self.logger = logger
        self._lock = threading.Lock()

    def write(self, kind: str, payload: Mapping[str, Any]) -> None:
        if not self.enabled:
            return
        record = DiagnosticSanitizer.event_record(kind, payload)
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                if self.path.exists() and self.path.stat().st_size > 1_000_000:
                    rotated = self.path.with_suffix(self.path.suffix + ".1")
                    if rotated.exists():
                        rotated.unlink()
                    self.path.replace(rotated)
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except OSError as exc:
                self.logger.warning("진단 파일 기록 실패: %s", safe_for_log(exc))


class WebSocketProtocolError(RuntimeError):
    pass


class SimpleWebSocket:
    """Small RFC 6455 client sufficient for local Chrome DevTools sockets."""

    def __init__(self, url: str, timeout: float = 5.0):
        self.url = url
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None
        self._send_lock = threading.Lock()
        self._closed = threading.Event()
        self._fragment_opcode: Optional[int] = None
        self._fragment_data = bytearray()

    @staticmethod
    def _read_exact(sock: socket.socket, length: int) -> bytes:
        chunks = bytearray()
        while len(chunks) < length:
            chunk = sock.recv(length - len(chunks))
            if not chunk:
                raise ConnectionError("WebSocket 연결이 닫혔습니다.")
            chunks.extend(chunk)
        return bytes(chunks)

    def connect(self) -> None:
        parsed = urllib.parse.urlsplit(self.url)
        if parsed.scheme not in {"ws", "wss"}:
            raise WebSocketProtocolError(f"지원하지 않는 WebSocket 주소: {self.url}")
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        raw = socket.create_connection((host, port), timeout=self.timeout)
        if parsed.scheme == "wss":
            import ssl

            context = ssl.create_default_context()
            raw = context.wrap_socket(raw, server_hostname=host)
        raw.settimeout(1.0)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "Origin: http://localhost\r\n"
            "\r\n"
        )
        raw.sendall(request.encode("ascii"))
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = raw.recv(4096)
            if not chunk:
                break
            response.extend(chunk)
            if len(response) > 65536:
                raise WebSocketProtocolError("WebSocket 응답 헤더가 너무 큽니다.")
        header = bytes(response).split(b"\r\n\r\n", 1)[0].decode(
            "iso-8859-1", errors="replace"
        )
        if " 101 " not in header.splitlines()[0]:
            raw.close()
            raise WebSocketProtocolError(
                f"WebSocket 연결 실패: {header.splitlines()[0] if header else '응답 없음'}"
            )
        accept_expected = base64.b64encode(
            hashlib.sha1(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
            ).digest()
        ).decode("ascii")
        headers = {}
        for line in header.splitlines()[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.strip().lower()] = value.strip()
        if headers.get("sec-websocket-accept") != accept_expected:
            raw.close()
            raise WebSocketProtocolError("WebSocket 승인 키가 일치하지 않습니다.")
        self.sock = raw
        self._closed.clear()

    def _send_frame(self, opcode: int, payload: bytes = b"") -> None:
        if self.sock is None or self._closed.is_set():
            raise ConnectionError("WebSocket이 연결되어 있지 않습니다.")
        first = 0x80 | (opcode & 0x0F)
        mask_key = os.urandom(4)
        length = len(payload)
        if length < 126:
            header = struct.pack("!BB", first, 0x80 | length)
        elif length < 65536:
            header = struct.pack("!BBH", first, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", first, 0x80 | 127, length)
        masked = bytes(
            byte ^ mask_key[index % 4] for index, byte in enumerate(payload)
        )
        with self._send_lock:
            self.sock.sendall(header + mask_key + masked)

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def recv_text(self) -> Optional[str]:
        if self.sock is None:
            raise ConnectionError("WebSocket이 연결되어 있지 않습니다.")
        while not self._closed.is_set():
            try:
                first_two = self._read_exact(self.sock, 2)
            except socket.timeout:
                continue
            first, second = first_two
            fin = bool(first & 0x80)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read_exact(self.sock, 2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exact(self.sock, 8))[0]
            mask_key = self._read_exact(self.sock, 4) if masked else b""
            payload = self._read_exact(self.sock, length) if length else b""
            if masked:
                payload = bytes(
                    byte ^ mask_key[index % 4]
                    for index, byte in enumerate(payload)
                )

            if opcode == 0x8:
                self._closed.set()
                return None
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode in {0x1, 0x2}:
                if fin:
                    if opcode == 0x2:
                        return payload.decode("utf-8", errors="replace")
                    return payload.decode("utf-8")
                self._fragment_opcode = opcode
                self._fragment_data = bytearray(payload)
                continue
            if opcode == 0x0 and self._fragment_opcode is not None:
                self._fragment_data.extend(payload)
                if fin:
                    data = bytes(self._fragment_data)
                    opcode = self._fragment_opcode
                    self._fragment_opcode = None
                    self._fragment_data.clear()
                    if opcode == 0x2:
                        return data.decode("utf-8", errors="replace")
                    return data.decode("utf-8")
        return None

    def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()
        sock = self.sock
        self.sock = None
        if sock is None:
            return
        try:
            with self._send_lock:
                sock.sendall(b"\x88\x80" + os.urandom(4))
        except OSError:
            pass
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        sock.close()


class CDPConnection:
    def __init__(self, websocket_url: str, max_event_queue: int = 1000):
        self.websocket_url = websocket_url
        self.websocket = SimpleWebSocket(websocket_url)
        self.events = BoundedQueue(max_event_queue)
        self._pending: dict[int, "queue.Queue[Any]"] = {}
        self._pending_lock = threading.Lock()
        self._id_lock = threading.Lock()
        self._next_id = 1
        self._receiver: Optional[threading.Thread] = None
        self._closed = threading.Event()

    @property
    def connected(self) -> bool:
        return not self._closed.is_set() and self._receiver is not None

    def connect(self) -> None:
        self.websocket.connect()
        self._closed.clear()
        self._receiver = threading.Thread(
            target=self._receive_loop,
            name="cdp-receiver",
            daemon=True,
        )
        self._receiver.start()

    def _receive_loop(self) -> None:
        error: Optional[BaseException] = None
        try:
            while not self._closed.is_set():
                text = self.websocket.recv_text()
                if text is None:
                    break
                try:
                    message = json.loads(text)
                except json.JSONDecodeError:
                    continue
                message_id = message.get("id")
                if isinstance(message_id, int):
                    with self._pending_lock:
                        waiter = self._pending.pop(message_id, None)
                    if waiter:
                        waiter.put(message)
                elif "method" in message:
                    self.events.put(message)
        except BaseException as exc:  # receiver must wake all waiting callers
            error = exc
        finally:
            self._closed.set()
            with self._pending_lock:
                pending = list(self._pending.values())
                self._pending.clear()
            for waiter in pending:
                waiter.put({"__connection_error__": str(error or "연결 종료")})

    def call(
        self,
        method: str,
        params: Optional[Mapping[str, Any]] = None,
        timeout: float = 8.0,
    ) -> Mapping[str, Any]:
        if self._closed.is_set():
            raise ConnectionError("CDP 연결이 닫혀 있습니다.")
        with self._id_lock:
            message_id = self._next_id
            self._next_id += 1
        waiter: "queue.Queue[Any]" = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[message_id] = waiter
        message = {
            "id": message_id,
            "method": method,
            "params": dict(params or {}),
        }
        try:
            self.websocket.send_text(json.dumps(message, separators=(",", ":")))
            response = waiter.get(timeout=timeout)
        except Exception:
            with self._pending_lock:
                self._pending.pop(message_id, None)
            raise
        if "__connection_error__" in response:
            raise ConnectionError(response["__connection_error__"])
        if "error" in response:
            error = response["error"]
            raise RuntimeError(
                f"CDP {method} 실패: {error.get('message', error)}"
            )
        result = response.get("result", {})
        return result if isinstance(result, Mapping) else {}

    def get_event(self, timeout: float = 0.5) -> Mapping[str, Any]:
        event = self.events.get(timeout=timeout)
        return event if isinstance(event, Mapping) else {}

    def close(self) -> None:
        self._closed.set()
        self.websocket.close()


class ChromeManager:
    def __init__(
        self,
        port: int,
        executable: str,
        profile_dir: Path,
        start_url: str,
        headless: bool,
        extra_args: Iterable[str],
        logger: logging.Logger,
    ):
        self.port = port
        self.executable_setting = executable
        self.profile_dir = profile_dir
        self.start_url = start_url
        self.headless = headless
        self.extra_args = [str(value) for value in extra_args if str(value).strip()]
        self.logger = logger
        self.process: Optional[subprocess.Popen[Any]] = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _json_request(
        self, path: str, method: str = "GET", timeout: float = 2.0
    ) -> Any:
        request = urllib.request.Request(self.base_url + path, method=method)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def ready(self) -> bool:
        try:
            data = self._json_request("/json/version")
            return isinstance(data, Mapping) and bool(data.get("Browser"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            return False

    def list_tabs(self) -> list[dict[str, Any]]:
        try:
            data = self._json_request("/json/list")
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            return []
        return [dict(item) for item in data if isinstance(item, Mapping)]

    def open_tab(self, url: Optional[str] = None) -> Optional[dict[str, Any]]:
        target_url = urllib.parse.quote(url or self.start_url, safe="")
        try:
            data = self._json_request(f"/json/new?{target_url}", method="PUT")
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            return None
        return dict(data) if isinstance(data, Mapping) else None

    def find_executable(self) -> Optional[Path]:
        if self.executable_setting:
            configured = Path(
                os.path.expandvars(os.path.expanduser(self.executable_setting))
            )
            if configured.exists():
                return configured
        candidates = [
            Path(os.environ.get("PROGRAMFILES", ""))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", ""))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", ""))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES", ""))
            / "Microsoft/Edge/Application/msedge.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", ""))
            / "Microsoft/Edge/Application/msedge.exe",
        ]
        for name in ("chrome", "chrome.exe", "msedge", "msedge.exe"):
            found = shutil.which(name)
            if found:
                candidates.append(Path(found))
        return next((path for path in candidates if path and path.exists()), None)

    def _clear_stale_profile_locks(self) -> None:
        """Remove Chromium locks left on a persistent disk by an old instance."""
        removed: list[str] = []
        for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
            path = self.profile_dir / name
            try:
                path.unlink()
                removed.append(name)
            except FileNotFoundError:
                continue
            except OSError as exc:
                self.logger.warning(
                    "Chrome profile lock cleanup failed (%s): %s",
                    name,
                    safe_for_log(exc),
                )
        if removed:
            self.logger.info(
                "Removed stale Chrome profile locks: %s", ", ".join(removed)
            )

    def stop(self) -> None:
        """Stop only the Chrome process launched by this monitor."""
        process = self.process
        self.process = None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)

    def ensure_running(self, wait_seconds: float = 15.0) -> bool:
        if self.ready():
            return True
        executable = self.find_executable()
        if executable is None:
            raise RuntimeError(
                "Chrome/Edge 실행 파일을 찾지 못했습니다. "
                "설정의 chrome_executable 값을 지정하세요."
            )
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._clear_stale_profile_locks()
        args = [
            str(executable),
            f"--remote-debugging-port={self.port}",
            "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*",
            f"--user-data-dir={self.profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
        ]
        if self.headless:
            args.extend(
                [
                    "--headless=new",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--disable-extensions",
                    "--disable-background-networking",
                    "--disable-component-update",
                    "--disable-default-apps",
                    "--disable-sync",
                    "--metrics-recording-only",
                    "--renderer-process-limit=1",
                    "--disk-cache-size=16777216",
                    "--media-cache-size=1",
                    "--window-size=800,600",
                    "--js-flags=--max-old-space-size=128",
                    "--disable-features=Translate,MediaRouter,OptimizationHints,"
                    "GlobalMediaControls,AutofillServerCommunication",
                ]
            )
        else:
            args.append("--new-window")
        args.extend(self.extra_args)
        args.append(self.start_url)
        creationflags = 0
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        self.process = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            if self.ready():
                return True
            if self.process.poll() is not None:
                break
            time.sleep(0.3)
        return self.ready()


class BandTabFinder:
    @staticmethod
    def choose_tab(tabs: Iterable[Mapping[str, Any]]) -> Optional[dict[str, Any]]:
        candidates: list[tuple[int, dict[str, Any]]] = []
        for tab in tabs:
            if tab.get("type") != "page":
                continue
            url = str(tab.get("url", ""))
            if "band.us" not in url.lower():
                continue
            score = 0
            lowered = url.lower()
            title = str(tab.get("title", "")).lower()
            if "/band/" in lowered:
                score += 20
            if any(
                term in lowered
                for term in ("applications", "member", "join", "request")
            ):
                score += 15
            if any(term in title for term in ("가입", "멤버", "member", "join")):
                score += 10
            if tab.get("webSocketDebuggerUrl"):
                score += 5
            candidates.append((score, dict(tab)))
        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0], reverse=True)
        return candidates[0][1]

    @classmethod
    def find_or_open(cls, chrome: ChromeManager) -> Optional[dict[str, Any]]:
        tab = cls.choose_tab(chrome.list_tabs())
        if tab:
            return tab
        opened = chrome.open_tab()
        if opened:
            return opened
        return None


def _contains_term(value: Any, terms: Iterable[str]) -> bool:
    try:
        text = json.dumps(value, ensure_ascii=False).lower()
    except (TypeError, ValueError):
        text = str(value).lower()
    return any(term.lower() in text for term in terms)


def _first_string(
    mapping: Mapping[str, Any], keys: Iterable[str]
) -> str:
    normalized = {str(key).lower(): value for key, value in mapping.items()}
    for key in keys:
        value = normalized.get(key.lower())
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value).strip()
    return ""


class BaseJoinParser:
    NAME_KEYS = (
        "display_name",
        "profile_name",
        "member_name",
        "nickname",
        "user_name",
        "name",
    )
    ID_KEYS = (
        "request_id",
        "application_id",
        "join_request_id",
        "member_id",
        "user_key",
        "user_id",
        "member_no",
    )
    APPLICANT_KEY_KEYS = (
        "applicant_key",
        "applicantkey",
        "applicant_id",
        "applicantid",
    )
    TIME_KEYS = (
        "application_time",
        "applied_at",
        "requested_at",
        "created_at",
        "time",
        "date",
    )
    STATUS_KEYS = ("status", "state", "request_status")
    ANSWER_KEYS = (
        "application_answer",
        "join_answer",
        "joinanswer",
        "answer",
    )

    def _walk(
        self,
        value: Any,
        *,
        source: str,
        inherited_context: bool = False,
        depth: int = 0,
    ) -> list[BandJoinRequest]:
        if depth > 8:
            return []
        results: list[BandJoinRequest] = []
        if isinstance(value, Mapping):
            local_context = inherited_context or _contains_term(
                list(value.keys()), JOIN_TERMS
            )
            if not local_context:
                local_context = _contains_term(value, JOIN_TERMS)
            name = _first_string(value, self.NAME_KEYS)
            request_id = _first_string(value, self.ID_KEYS)
            applicant_key = _first_string(value, self.APPLICANT_KEY_KEYS)
            application_time = _first_string(value, self.TIME_KEYS)
            application_answer = _first_string(value, self.ANSWER_KEYS)
            status = _first_string(value, self.STATUS_KEYS) or "PENDING"
            if local_context and name and (
                request_id or PHONE_ANY_RE.search(name) or len(value) >= 2
            ):
                stable_key = make_stable_key(
                    request_id=request_id or applicant_key,
                    display_name=name,
                    application_time=application_time,
                    source=source,
                )
                results.append(
                    BandJoinRequest(
                        stable_key=stable_key,
                        display_name=name,
                        request_id=request_id,
                        applicant_key=applicant_key or request_id,
                        application_time=application_time,
                        application_answer=application_answer,
                        status=status.upper(),
                        source=source,
                    )
                )
            for child in value.values():
                results.extend(
                    self._walk(
                        child,
                        source=source,
                        inherited_context=local_context,
                        depth=depth + 1,
                    )
                )
        elif isinstance(value, list):
            for child in value:
                results.extend(
                    self._walk(
                        child,
                        source=source,
                        inherited_context=inherited_context,
                        depth=depth + 1,
                    )
                )
        deduped: dict[str, BandJoinRequest] = {}
        for request in results:
            deduped[request.stable_key] = request
        return list(deduped.values())


class WebSocketJoinParser(BaseJoinParser):
    def parse(self, payload: str) -> list[BandJoinRequest]:
        try:
            decoded = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            return []
        if not _contains_term(decoded, JOIN_TERMS):
            return []
        return self._walk(decoded, source="WEBSOCKET")


class NetworkJoinParser(BaseJoinParser):
    def parse(self, body: str, url: str = "") -> list[BandJoinRequest]:
        try:
            decoded = json.loads(body)
        except (json.JSONDecodeError, TypeError):
            return []
        if not (
            _contains_term(url, JOIN_TERMS)
            or _contains_term(decoded, JOIN_TERMS)
        ):
            return []
        return self._walk(decoded, source="NETWORK")


class DOMJoinParser:
    def parse_rows(self, rows: Any) -> list[BandJoinRequest]:
        if not isinstance(rows, list):
            return []
        results: list[BandJoinRequest] = []
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            name = str(row.get("display_name") or row.get("text") or "").strip()
            if not name:
                continue
            request_id = str(row.get("request_id") or "").strip()
            applicant_key = str(row.get("applicant_key") or "").strip()
            application_time = str(row.get("application_time") or "").strip()
            application_answer = str(
                row.get("application_answer") or ""
            ).strip()
            application_reply = str(
                row.get("application_reply") or ""
            ).strip()
            row_fingerprint = str(row.get("fingerprint") or "").strip()
            stable_key = make_stable_key(
                request_id=request_id or row_fingerprint,
                display_name=name,
                application_time=application_time,
                source="DOM",
            )
            results.append(
                BandJoinRequest(
                    stable_key=stable_key,
                    display_name=name,
                    request_id=request_id or row_fingerprint,
                    applicant_key=applicant_key or request_id or row_fingerprint,
                    application_time=application_time,
                    application_answer=application_answer,
                    application_reply=application_reply,
                    status="PENDING",
                    source="DOM",
                )
            )
        return results


DOM_MONITOR_SCRIPT = r"""
(() => {
  const monitorVersion = 3;
  if (
    window.__bandJoinMonitorInstalled &&
    window.__bandJoinMonitorVersion === monitorVersion
  ) {
    return {installed: true, reused: true};
  }
  if (window.__bandJoinMonitorObserver) {
    window.__bandJoinMonitorObserver.disconnect();
  }
  window.__bandJoinMonitorInstalled = true;
  window.__bandJoinMonitorVersion = monitorVersion;
  window.__bandJoinMonitorEvents = [];
  window.__bandJoinMonitorLast = new Map();
  window.__bandJoinMonitorNotificationEvents = [];

  const actionWords = /^(승인|수락|거절|반려|approve|accept|reject|decline)$/i;
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const buttonText = (el) => clean(el.innerText || el.textContent || el.getAttribute("aria-label"));
  const isAction = (el) => actionWords.test(buttonText(el));
  const allButtons = (root) => Array.from(root.querySelectorAll("button,a,[role='button']")).filter(isAction);

  function findContainer(button) {
    const bandApplicationItem = button.closest(
      "li.requestJoinMemberItem,[data-viewname='DBandApplicationItemView']"
    );
    if (bandApplicationItem) return bandApplicationItem;

    let node = button;
    let fallback = button.parentElement;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const buttons = allButtons(node);
      const words = new Set(buttons.map(buttonText));
      const hasPositive = Array.from(words).some((word) => /^(승인|수락|approve|accept)$/i.test(word));
      const hasNegative = Array.from(words).some((word) => /^(거절|반려|reject|decline)$/i.test(word));
      if (node.matches && node.matches("li,article,tr,[class*='request'],[class*='member'],[class*='join']")) {
        fallback = node;
      }
      if (hasPositive && hasNegative && node.matches && node.matches("li,article,tr")) {
        return node;
      }
    }
    return fallback;
  }

  function candidateName(container) {
    const selectors = [
      ".text.-flex .ellipsis",
      "img[alt]",
      "[data-profile-name]",
      "[data-member-name]",
      "[class*='profileName']",
      "[class*='profile_name']",
      "[class*='memberName']",
      "[class*='member_name']",
      "[class*='name']"
    ];
    for (const selector of selectors) {
      for (const el of container.querySelectorAll(selector)) {
        const value = clean(
          el.getAttribute("data-profile-name") ||
          el.getAttribute("data-member-name") ||
          el.getAttribute("alt") ||
          el.innerText ||
          el.textContent
        );
        if (value && value.length <= 100 && !actionWords.test(value)) return value;
      }
    }
    const lines = (container.innerText || container.textContent || "")
      .split(/\r?\n/)
      .map(clean)
      .filter((line) => line && !actionWords.test(line));
    const phoneLine = lines.find((line) => /010(?:[\s./_-]*\d){8}/.test(line));
    return phoneLine || lines[0] || "";
  }

  function rowId(container) {
    const values = [
      container.dataset && (container.dataset.requestId || container.dataset.memberId || container.dataset.userId || container.dataset.key),
      container.id,
      container.getAttribute && container.getAttribute("data-id")
    ].filter(Boolean);
    if (values.length) return String(values[0]).slice(0, 160);
    const link = container.querySelector && container.querySelector("a[href]");
    if (link) {
      const href = clean(link.getAttribute("href") || "");
      if (href && href !== "#" && !href.toLowerCase().startsWith("javascript:")) {
        return href.slice(0, 200);
      }
    }
    return "";
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function notificationSignature() {
    const bandNewsLabel = document.querySelector("._newsCountLabel");
    if (bandNewsLabel) {
      const text = clean(
        bandNewsLabel.innerText || bandNewsLabel.textContent || ""
      );
      const count = text.match(/\d+/);
      return count ? String(Number(count[0])) : text;
    }
    return "";
  }

  window.__bandJoinMonitorNotificationSignature = notificationSignature();

  function detectNotificationChange() {
    const next = notificationSignature();
    const before = window.__bandJoinMonitorNotificationSignature;
    if (!next) {
      window.__bandJoinMonitorNotificationSignature = "";
      return;
    }
    if (!before) {
      window.__bandJoinMonitorNotificationSignature = next;
      return;
    }
    window.__bandJoinMonitorNotificationSignature = next;
    if (before !== next) {
      const event = {
        type: "notification-change",
        before: before,
        after: next,
        at: Date.now()
      };
      window.__bandJoinMonitorNotificationEvents.push(event);
      try {
        if (typeof window.__bandJoinMonitorSignal === "function") {
          window.__bandJoinMonitorSignal(JSON.stringify(event));
        }
      } catch (_error) {
        // The queued event remains available as the polling fallback.
      }
      if (window.__bandJoinMonitorNotificationEvents.length > 50) {
        window.__bandJoinMonitorNotificationEvents.splice(
          0,
          window.__bandJoinMonitorNotificationEvents.length - 50
        );
      }
    }
  }

  function collect() {
    const seenContainers = new Set();
    const rows = [];
    const buttons = Array.from(document.querySelectorAll("button,a,[role='button']")).filter(isAction);
    for (const button of buttons) {
      const container = findContainer(button);
      if (!container || seenContainers.has(container)) continue;
      const actions = allButtons(container).map(buttonText);
      const hasPositive = actions.some((word) => /^(승인|수락|approve|accept)$/i.test(word));
      const hasNegative = actions.some((word) => /^(거절|반려|reject|decline)$/i.test(word));
      if (!hasPositive || !hasNegative) continue;
      seenContainers.add(container);
      const fullText = clean(container.innerText || container.textContent || "");
      const displayName = candidateName(container);
      if (!displayName) continue;
      const identifier = rowId(container);
      const applicationTime = clean(
        (container.querySelector(".date.-ellipsis") || {}).textContent || ""
      ) || (fullText.match(/(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}[^ ]{0,20}|\d{1,2}:\d{2})/) || [""])[0];
      const applicationAnswer = clean(
        (container.querySelector("dd.answerText") || {}).textContent || ""
      );
      rows.push({
        display_name: displayName,
        request_id: identifier,
        application_time: applicationTime,
        application_answer: applicationAnswer,
        fingerprint: identifier || hashText([displayName, applicationTime, fullText].join("|")),
        actions: actions,
        text: displayName
      });
    }
    return rows;
  }

  function scan() {
    detectNotificationChange();
    const rows = collect();
    const next = new Map();
    for (const row of rows) {
      const key = row.request_id || row.fingerprint;
      next.set(key, row);
      const before = window.__bandJoinMonitorLast.get(key);
      if (!before || JSON.stringify(before) !== JSON.stringify(row)) {
        window.__bandJoinMonitorEvents.push(row);
      }
    }
    window.__bandJoinMonitorLast = next;
    if (window.__bandJoinMonitorEvents.length > 200) {
      window.__bandJoinMonitorEvents.splice(0, window.__bandJoinMonitorEvents.length - 200);
    }
  }

  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 150);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement || document.body, {childList: true, subtree: true, characterData: true});
  window.__bandJoinMonitorObserver = observer;
  window.__bandJoinMonitorCollect = collect;
  scan();
  return {installed: true, reused: false};
})()
"""

DOM_DRAIN_SCRIPT = r"""
(() => {
  const events = Array.isArray(window.__bandJoinMonitorEvents)
    ? window.__bandJoinMonitorEvents.splice(0, window.__bandJoinMonitorEvents.length)
    : [];
  const notificationEvents = Array.isArray(window.__bandJoinMonitorNotificationEvents)
    ? window.__bandJoinMonitorNotificationEvents.splice(0, window.__bandJoinMonitorNotificationEvents.length)
    : [];
  return {rows: events, notification_events: notificationEvents};
})()
"""

DOM_FULL_SCAN_SCRIPT = r"""
(() => {
  if (typeof window.__bandJoinMonitorCollect !== "function") return [];
  return window.__bandJoinMonitorCollect();
})()
"""

WEBPACK_CAPTURE_SCRIPT = r"""
(() => {
  const originalCall = Function.prototype.call;
  Function.prototype.call = function() {
    const candidate = arguments.length >= 4 ? arguments[3] : null;
    if (
      typeof candidate === "function" &&
      candidate.m &&
      candidate.c &&
      typeof candidate.e === "function"
    ) {
      window.__bandWebpackRequire = candidate;
      Function.prototype.call = originalCall;
    }
    return originalCall.apply(this, arguments);
  };
  setTimeout(() => {
    if (Function.prototype.call !== originalCall) {
      Function.prototype.call = originalCall;
    }
  }, 10000);
})()
"""


def runtime_value(result: Mapping[str, Any]) -> Any:
    remote = result.get("result", {})
    if isinstance(remote, Mapping):
        return remote.get("value")
    return None


class JoinActionAdapter:
    def __init__(
        self,
        enabled: bool,
        rate_limit_seconds: float,
        logger: logging.Logger,
    ):
        self.enabled = enabled
        self.rate_limit_seconds = max(0.0, rate_limit_seconds)
        self.logger = logger
        self._lock = threading.RLock()
        self._inflight: set[str] = set()
        self._last_action_at = 0.0

    def begin_action(self, request: BandJoinRequest) -> tuple[bool, str]:
        with self._lock:
            if request.stable_key in self._inflight:
                return False, "이미 처리 중인 신청입니다."
            if request.status in {"APPROVED", "REJECTED", "ACTION_SENT"}:
                return False, f"이미 처리된 신청입니다: {request.status}"
            wait = self.rate_limit_seconds - (time.monotonic() - self._last_action_at)
            if wait > 0:
                return False, f"처리 속도 제한 중입니다. {wait:.1f}초 후 다시 시도하세요."
            self._inflight.add(request.stable_key)
            self._last_action_at = time.monotonic()
            return True, ""

    def end_action(self, request: BandJoinRequest) -> None:
        with self._lock:
            self._inflight.discard(request.stable_key)

    def perform(
        self,
        connection: CDPConnection,
        request: BandJoinRequest,
        action: str,
    ) -> tuple[bool, str]:
        if not self.enabled:
            return (
                False,
                "DOM 승인/거절 기능이 비활성화되어 있습니다. "
                "설정에서 dom_action_enabled를 true로 바꾸기 전에 테스트 계정으로 확인하세요.",
            )
        allowed = {
            "approve": r"/^(승인|수락|approve|accept)$/i",
            "reject": r"/^(거절|반려|reject|decline)$/i",
        }
        if action not in allowed:
            return False, "지원하지 않는 동작입니다."
        target_json = json.dumps(request.display_name, ensure_ascii=False)
        regex_literal = allowed[action]
        script = f"""
        (() => {{
          const target = {target_json};
          const actionRe = {regex_literal};
          const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
          const buttons = Array.from(document.querySelectorAll("button,a,[role='button']"));
          for (const button of buttons) {{
            if (!actionRe.test(clean(button.innerText || button.textContent || button.getAttribute("aria-label")))) continue;
            let node = button;
            for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {{
              const text = clean(node.innerText || node.textContent || "");
              if (text.includes(target)) {{
                button.scrollIntoView({{block: "center"}});
                button.click();
                return {{clicked: true, label: clean(button.innerText || button.textContent)}};
              }}
            }}
          }}
          return {{clicked: false}};
        }})()
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
            )
            value = runtime_value(result)
        except Exception as exc:
            return False, f"버튼 실행 실패: {exc}"
        if isinstance(value, Mapping) and value.get("clicked"):
            return True, f"{value.get('label', action)} 버튼을 눌렀습니다."
        return False, "해당 신청자의 버튼을 찾지 못했습니다."


class ReconnectPolicy:
    def __init__(self, minimum: float = 1.0, maximum: float = 15.0):
        self.minimum = minimum
        self.maximum = maximum
        self.current = minimum

    def success(self) -> None:
        self.current = self.minimum

    def next_delay(self) -> float:
        delay = self.current + random.uniform(0, min(0.5, self.current / 4))
        self.current = min(self.maximum, self.current * 1.8)
        return delay


class BandJoinMonitor:
    def __init__(self, config: Mapping[str, Any], config_dir: Path):
        self.config = dict(config)
        self.config_dir = config_dir
        log_path = resolve_relative(config_dir, str(config["log_file"]))
        self.logger = configure_logging(log_path)
        profile_dir = resolve_relative(
            config_dir, str(config["chrome_profile_dir"])
        )
        self.chrome = ChromeManager(
            port=int(config["chrome_port"]),
            executable=str(config.get("chrome_executable", "")),
            profile_dir=profile_dir,
            start_url=str(config.get("band_start_url", "https://band.us/")),
            headless=bool(config.get("chrome_headless", False)),
            extra_args=(
                config.get("chrome_extra_args", [])
                if isinstance(config.get("chrome_extra_args", []), list)
                else []
            ),
            logger=self.logger,
        )
        status_file = str(config.get("runtime_status_file", "")).strip()
        self.runtime_status_path = (
            resolve_relative(config_dir, status_file) if status_file else None
        )
        self.bootstrap_cookies = self._read_bootstrap_cookies()
        state_path = resolve_relative(config_dir, str(config["state_file"]))
        self.registry = DeduplicationStateManager(
            state_path=state_path,
            max_applicants=int(config["max_applicants"]),
            processed_state_limit=int(config["processed_state_limit"]),
        )
        self.profile_matcher = ProfileRuleMatcher(config.get("profile_rules", {}))
        self.answer_matcher = JoinAnswerMatcher(config.get("answer_rules", {}))
        self.ws_parser = WebSocketJoinParser()
        self.network_parser = NetworkJoinParser()
        self.dom_parser = DOMJoinParser()
        diagnostic_path = resolve_relative(
            config_dir, str(config["diagnostic_file"])
        )
        self.diagnostics = DiagnosticWriter(
            diagnostic_path,
            enabled=bool(config["diagnostic_mode"]),
            logger=self.logger,
        )
        self.action_adapter = JoinActionAdapter(
            enabled=bool(config["dom_action_enabled"]),
            rate_limit_seconds=float(config["action_rate_limit_seconds"]),
            logger=self.logger,
        )
        self.stop_event = threading.Event()
        self.connected_event = threading.Event()
        self.connection_lock = threading.RLock()
        self.connection: Optional[CDPConnection] = None
        self.tab: Optional[dict[str, Any]] = None
        self.state = "DISCONNECTED"
        self.state_detail = "시작 전"
        self.supervisor: Optional[threading.Thread] = None
        self.auto_queue = BoundedQueue(200)
        self.auto_worker: Optional[threading.Thread] = None
        self._request_meta: dict[str, dict[str, Any]] = {}
        self._response_meta: dict[str, dict[str, Any]] = {}
        self._last_dom_full_scan = 0.0
        self._last_dom_event_poll = 0.0
        self._last_notification_refresh = 0.0
        self._last_application_count_poll = 0.0
        self._application_count_request_id = ""
        self._last_application_count: Optional[int] = None
        self._last_session_check = 0.0
        self._last_follow_up_scan = 0.0
        self._follow_up_queue_lock = threading.RLock()
        self._follow_up_enqueued: set[str] = set()
        self._follow_up_retry_after: dict[str, float] = {}
        self._last_safety_refresh = time.monotonic()
        self._dom_install_needed = True

    @staticmethod
    def _read_bootstrap_cookies() -> list[dict[str, Any]]:
        serialized = os.environ.pop("BAND_COOKIE_JSON", "").strip()
        if serialized:
            try:
                raw_cookies = json.loads(serialized)
            except (TypeError, ValueError):
                raw_cookies = []
            cookies: list[dict[str, Any]] = []
            if isinstance(raw_cookies, list):
                for raw_cookie in raw_cookies:
                    if not isinstance(raw_cookie, Mapping):
                        continue
                    name = str(raw_cookie.get("name", "")).strip()
                    value = str(raw_cookie.get("value", ""))
                    domain = str(raw_cookie.get("domain", "")).strip().lower()
                    normalized_domain = domain.lstrip(".")
                    if (
                        not name
                        or not domain
                        or (
                            normalized_domain != "band.us"
                            and not normalized_domain.endswith(".band.us")
                        )
                    ):
                        continue
                    cookie: dict[str, Any] = {
                        "name": name,
                        "value": value,
                        "domain": domain,
                        "path": str(raw_cookie.get("path", "/")) or "/",
                        "secure": bool(raw_cookie.get("secure", True)),
                        "httpOnly": bool(raw_cookie.get("httpOnly", False)),
                    }
                    same_site = str(raw_cookie.get("sameSite", ""))
                    if same_site in {"Strict", "Lax", "None"}:
                        cookie["sameSite"] = same_site
                    try:
                        expires = float(raw_cookie.get("expires", -1))
                    except (TypeError, ValueError):
                        expires = -1
                    if expires > 0:
                        cookie["expires"] = expires
                    cookies.append(cookie)
            if cookies:
                return cookies

        header = os.environ.pop("BAND_COOKIE_HEADER", "").strip()
        if not header:
            return []
        ignored = {
            "path",
            "domain",
            "expires",
            "max-age",
            "secure",
            "httponly",
            "samesite",
        }
        cookies = []
        for part in header.split(";"):
            if "=" not in part:
                continue
            name, value = part.split("=", 1)
            name = name.strip()
            if not name or name.lower() in ignored:
                continue
            cookies.append(
                {
                    "name": name,
                    "value": value.strip(),
                    "domain": ".band.us",
                    "path": "/",
                    "secure": True,
                    "httpOnly": False,
                }
            )
        return cookies

    def _install_bootstrap_cookies(self, connection: CDPConnection) -> int:
        if not self.bootstrap_cookies:
            return 0
        try:
            connection.call("Network.clearBrowserCookies", timeout=3)
        except Exception:
            pass
        installed = 0
        for cookie in self.bootstrap_cookies:
            name = str(cookie.get("name", ""))
            value = str(cookie.get("value", ""))
            domain = str(cookie.get("domain", ".band.us"))
            params: dict[str, Any] = {
                "name": name,
                "value": value,
                "path": str(cookie.get("path", "/")) or "/",
                "secure": bool(cookie.get("secure", True)),
                "httpOnly": bool(cookie.get("httpOnly", False)),
            }
            if domain.startswith(".") and not name.startswith("__Host-"):
                params["domain"] = domain
            else:
                params["url"] = f"https://{domain.lstrip('.')}/"
            same_site = cookie.get("sameSite")
            if same_site in {"Strict", "Lax", "None"}:
                params["sameSite"] = same_site
            expires = cookie.get("expires")
            if isinstance(expires, (int, float)) and expires > 0:
                params["expires"] = expires
            try:
                result = connection.call("Network.setCookie", params, timeout=3)
                if result.get("success", True):
                    installed += 1
            except Exception:
                continue
        self.logger.info(
            "Render BAND 로그인 세션 쿠키 %s개 적용",
            installed,
        )
        self.bootstrap_cookies.clear()
        return installed

    def write_runtime_status(self) -> None:
        path = self.runtime_status_path
        if not path:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": VERSION,
                "updated_at": now_iso(),
                "state": self.state,
                "detail": safe_for_log(self.state_detail, 200),
                "connected": self.connected_event.is_set(),
                "headless": bool(self.config.get("chrome_headless", False)),
                "auto_approve": bool(self.config.get("auto_approve_enabled", False)),
                "auto_reject": bool(self.config.get("auto_reject_enabled", False)),
                "follow_up_question": self._follow_up_enabled(),
            }
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            tmp.replace(path)
        except OSError as exc:
            self.logger.info("실행 상태 파일 저장 실패: %s", safe_for_log(exc))

    def set_state(self, state: str, detail: str) -> None:
        changed = state != self.state or detail != self.state_detail
        self.state = state
        self.state_detail = detail
        if state == "CONNECTED":
            self.connected_event.set()
        else:
            self.connected_event.clear()
        if changed:
            console_print(f"[{state}] {detail}")
            self.logger.info("%s %s", state, safe_for_log(detail))
        self.write_runtime_status()

    def start(self) -> None:
        if not bool(self.config.get("monitor_enabled", True)):
            self.set_state("DISCONNECTED", "monitor_enabled=false")
            return
        self.supervisor = threading.Thread(
            target=self._supervisor_loop,
            name="band-monitor-supervisor",
            daemon=True,
        )
        self.auto_worker = threading.Thread(
            target=self._auto_action_loop,
            name="band-monitor-auto-action",
            daemon=True,
        )
        self.supervisor.start()
        self.auto_worker.start()

    def stop(self) -> None:
        self.stop_event.set()
        with self.connection_lock:
            connection = self.connection
            self.connection = None
        if connection:
            connection.close()
        if self.supervisor and self.supervisor.is_alive():
            self.supervisor.join(timeout=3)
        self.chrome.stop()
        self.set_state("DISCONNECTED", "사용자 종료")
        for handler in list(self.logger.handlers):
            try:
                handler.flush()
                handler.close()
            finally:
                self.logger.removeHandler(handler)

    def _enable_cdp(self, connection: CDPConnection) -> None:
        for method, params in (
            ("Network.enable", {"maxTotalBufferSize": 5_000_000}),
            ("Runtime.enable", {}),
            ("Runtime.addBinding", {"name": DOM_SIGNAL_BINDING}),
            ("Page.enable", {}),
        ):
            connection.call(method, params)
        connection.call(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": WEBPACK_CAPTURE_SCRIPT},
        )
        installed_cookies = self._install_bootstrap_cookies(connection)
        if installed_cookies:
            target_url = str(
                self.config.get("band_start_url", "https://www.band.us/")
            )
            connection.call("Page.navigate", {"url": target_url})
            if self.tab is not None:
                self.tab["url"] = target_url
        self._install_dom_monitor(connection)

    def _install_dom_monitor(self, connection: CDPConnection) -> None:
        try:
            connection.call(
                "Runtime.evaluate",
                {
                    "expression": DOM_MONITOR_SCRIPT,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
                timeout=5,
            )
            self._dom_install_needed = False
        except Exception as exc:
            self._dom_install_needed = True
            self.logger.info("DOM 감시 설치 대기: %s", safe_for_log(exc))

    def _supervisor_loop(self) -> None:
        backoff = ReconnectPolicy()
        while not self.stop_event.is_set():
            connection: Optional[CDPConnection] = None
            try:
                if not self.chrome.ensure_running():
                    raise RuntimeError("Chrome 디버깅 포트가 열리지 않았습니다.")
                tab = BandTabFinder.find_or_open(self.chrome)
                if not tab:
                    self.set_state(
                        "DISCONNECTED",
                        "band.us 탭을 찾지 못했습니다. Chrome에서 BAND를 여세요.",
                    )
                    self.stop_event.wait(backoff.next_delay())
                    continue
                websocket_url = str(tab.get("webSocketDebuggerUrl") or "")
                if not websocket_url:
                    raise RuntimeError("탭의 CDP WebSocket 주소가 없습니다.")
                connection = CDPConnection(
                    websocket_url,
                    max_event_queue=int(self.config["max_event_queue"]),
                )
                connection.connect()
                with self.connection_lock:
                    self.connection = connection
                    self.tab = tab
                self._enable_cdp(connection)
                if "/applications" in str(tab.get("url", "")).lower():
                    self._reload_applications_page(
                        connection,
                        "가입 건수 감시 초기화",
                    )
                backoff.success()
                self.set_state(
                    "CONNECTED",
                    f"{tab.get('title') or 'BAND'} ({tab.get('url', '')})",
                )
                self._monitor_connected(connection)
            except Exception as exc:
                if not self.stop_event.is_set():
                    self.set_state("DISCONNECTED", safe_for_log(exc))
                    self.logger.error(
                        "연결 루프 오류: %s\n%s",
                        safe_for_log(exc),
                        traceback.format_exc(),
                    )
                    self.stop_event.wait(backoff.next_delay())
            finally:
                with self.connection_lock:
                    if self.connection is connection:
                        self.connection = None
                        self.tab = None
                if connection:
                    connection.close()

    def _monitor_connected(self, connection: CDPConnection) -> None:
        event_timeout = min(
            0.1,
            max(0.02, float(self.config["dom_event_poll_seconds"])),
        )
        while not self.stop_event.is_set() and connection.connected:
            try:
                event = connection.get_event(timeout=event_timeout)
                self._handle_event(connection, event)
            except queue.Empty:
                pass
            self._periodic_dom_tasks(connection)
        if not self.stop_event.is_set():
            raise ConnectionError("CDP 연결이 종료되어 재연결합니다.")

    def _handle_event(
        self, connection: CDPConnection, event: Mapping[str, Any]
    ) -> None:
        method = str(event.get("method", ""))
        params = event.get("params", {})
        if not isinstance(params, Mapping):
            return
        if method == "Network.webSocketFrameReceived":
            response = params.get("response", {})
            payload = (
                str(response.get("payloadData", ""))
                if isinstance(response, Mapping)
                else ""
            )
            if payload:
                if bool(self.config["diagnostic_mode"]) or _contains_term(
                    payload, JOIN_TERMS + ACTION_TERMS
                ):
                    self.diagnostics.write(
                        "websocket_frame",
                        {"payload": payload, "opcode": response.get("opcode")},
                    )
                self._accept_requests(self.ws_parser.parse(payload))
        elif method == "Network.requestWillBeSent":
            self._handle_request_event(params)
        elif method == "Network.responseReceived":
            self._handle_response_event(connection, params)
        elif method == "Network.loadingFinished":
            self._handle_loading_finished(connection, params)
        elif method == "Runtime.bindingCalled":
            if str(params.get("name", "")) == DOM_SIGNAL_BINDING:
                try:
                    payload = json.loads(str(params.get("payload", "")))
                except (json.JSONDecodeError, TypeError):
                    payload = {}
                if (
                    isinstance(payload, Mapping)
                    and payload.get("type") == "notification-change"
                ):
                    self._handle_notification_trigger(
                        connection,
                        "상단 알림 DOM 즉시 신호",
                    )
        elif method == "Runtime.executionContextsCleared":
            self._reset_application_count_tracking()
            self._dom_install_needed = True
            self.set_state("FALLBACK", "페이지가 다시 로드되어 DOM 감시를 재설치합니다.")
        elif method == "Page.loadEventFired":
            self._dom_install_needed = True
            self.set_state("FALLBACK", "페이지가 다시 로드되어 DOM 감시를 재설치합니다.")
        elif method in {"Inspector.detached", "Target.detachedFromTarget"}:
            raise ConnectionError("Chrome 탭 연결이 분리되었습니다.")

    def _handle_request_event(self, params: Mapping[str, Any]) -> None:
        request_id = str(params.get("requestId", ""))
        request = params.get("request", {})
        if not request_id or not isinstance(request, Mapping):
            return
        url = str(request.get("url", ""))
        if "band.us" not in url.lower():
            return
        method = str(request.get("method", "GET"))
        post_data = str(request.get("postData", ""))
        if (
            method.upper() == "GET"
            and str(params.get("type", "")) == "XHR"
            and "/get_application_count"
            in urllib.parse.urlsplit(url).path.lower()
            and not self._application_count_request_id
        ):
            self._application_count_request_id = request_id
        meta = {
            "url": url,
            "method": method,
            "resource_type": str(params.get("type", "")),
        }
        self._request_meta[request_id] = meta
        if len(self._request_meta) > 1000:
            for key in list(self._request_meta)[:200]:
                self._request_meta.pop(key, None)
        if (
            method.upper() != "GET"
            and (
                bool(self.config["diagnostic_mode"])
                or
                _contains_term(url, JOIN_TERMS + ACTION_TERMS)
                or _contains_term(post_data, JOIN_TERMS + ACTION_TERMS)
            )
        ):
            self.diagnostics.write(
                "request_candidate",
                {
                    "url": url,
                    "method": method,
                    "post_data": post_data,
                    "headers": request.get("headers", {}),
                },
            )

    def _handle_response_event(
        self, connection: CDPConnection, params: Mapping[str, Any]
    ) -> None:
        request_id = str(params.get("requestId", ""))
        response = params.get("response", {})
        resource_type = str(params.get("type", ""))
        if not request_id or not isinstance(response, Mapping):
            return
        url = str(response.get("url", ""))
        if "band.us" not in url.lower() or resource_type not in {"XHR", "Fetch"}:
            return
        self._response_meta[request_id] = {
            "url": url,
            "status": response.get("status"),
            "mime_type": response.get("mimeType"),
        }
        if len(self._response_meta) > 1000:
            for key in list(self._response_meta)[:200]:
                self._response_meta.pop(key, None)

    def _handle_loading_finished(
        self, connection: CDPConnection, params: Mapping[str, Any]
    ) -> None:
        request_id = str(params.get("requestId", ""))
        meta = self._response_meta.pop(request_id, None)
        if not request_id or not isinstance(meta, Mapping):
            return
        url = str(meta.get("url", ""))
        should_read = (
            "/get_application_count"
            in urllib.parse.urlsplit(url).path.lower()
            or bool(self.config["diagnostic_mode"])
            or _contains_term(url, JOIN_TERMS + ACTION_TERMS)
        )
        if not should_read:
            return
        try:
            result = connection.call(
                "Network.getResponseBody",
                {"requestId": request_id},
                timeout=3,
            )
        except Exception:
            return
        body = str(result.get("body", ""))
        if result.get("base64Encoded"):
            try:
                body = base64.b64decode(body).decode("utf-8", errors="replace")
            except (ValueError, UnicodeDecodeError):
                return
        self._handle_application_count_response(connection, url, body)
        if bool(self.config["diagnostic_mode"]) or _contains_term(
            body, JOIN_TERMS + ACTION_TERMS
        ):
            self.diagnostics.write(
                "response_candidate",
                {
                    "url": url,
                    "status": meta.get("status"),
                    "mime_type": meta.get("mime_type"),
                    "body": body,
                },
            )
        self._accept_requests(self.network_parser.parse(body, url))

    def _handle_application_count_response(
        self,
        connection: CDPConnection,
        url: str,
        body: str,
    ) -> None:
        if (
            "/get_application_count"
            not in urllib.parse.urlsplit(url).path.lower()
        ):
            return
        try:
            decoded = json.loads(body)
            result_data = decoded.get("result_data", {})
            count = int(result_data.get("application_count"))
        except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
            return
        previous = self._last_application_count
        self._last_application_count = count
        if previous is None and count > 0:
            self._fast_application_scan(connection)
            return
        if previous is not None and count > previous:
            if not self._fast_application_scan(connection):
                self._reload_applications_page(
                    connection,
                    f"가입 신청 건수 증가 {previous}→{count} API 우회 실패",
                )

    def _band_no(self) -> str:
        tab_url = str((self.tab or {}).get("url", ""))
        match = BAND_NO_RE.search(tab_url)
        if match:
            return match.group(1)
        start_url = str(self.config.get("band_start_url", ""))
        match = BAND_NO_RE.search(start_url)
        return match.group(1) if match else ""

    def _fast_application_scan(self, connection: CDPConnection) -> bool:
        band_no = self._band_no()
        if not band_no:
            return False
        script = f"""
        new Promise((resolve) => {{
          try {{
            const require = window.__bandWebpackRequire;
            if (typeof require !== "function") {{
              resolve({{ok: false, reason: "webpack-require-missing"}});
              return;
            }}
            const api = require(637);
            let commentApi = null;
            try {{
              commentApi = require(1228);
            }} catch (_error) {{
              commentApi = null;
            }}
            const clean = (value) => String(value == null ? "" : value).trim();
            const latestApplicantReply = async (item, applicantKey) => {{
              const commentOwner = commentApi && commentApi.getApplicantComments
                ? commentApi
                : commentApi && commentApi.default;
              const getComments = commentOwner &&
                commentOwner.getApplicantComments;
              if (
                typeof getComments !== "function" ||
                !applicantKey
              ) {{
                return "";
              }}
              let value;
              try {{
                value = await getComments.call(
                  commentOwner,
                  {json.dumps(band_no)},
                  applicantKey
                );
              }} catch (_error) {{
                return "";
              }}
              const candidates = [];
              const visit = (node, depth = 0) => {{
                if (!node || depth > 6) return;
                if (Array.isArray(node)) {{
                  node.forEach((child) => visit(child, depth + 1));
                  return;
                }}
                if (typeof node !== "object") return;
                const text = clean(
                  node.body ||
                  node.comment_body ||
                  node.commentBody ||
                  node.content ||
                  node.text ||
                  node.message ||
                  ""
                );
                if (text) {{
                  const authorType = clean(
                    node.author_type ||
                    node.authorType ||
                    node.writer_type ||
                    node.writerType ||
                    node.commenter_type ||
                    ""
                  ).toLowerCase();
                  const writer = node.writer || node.author || node.member || {{}};
                  const writerKey = clean(
                    node.writer_member_key ||
                    node.writerMemberKey ||
                    node.member_key ||
                    node.memberKey ||
                    node.user_key ||
                    node.userKey ||
                    writer.member_key ||
                    writer.memberKey ||
                    writer.user_key ||
                    writer.userKey ||
                    ""
                  );
                  const explicitApplicant =
                    node.is_applicant === true ||
                    node.isApplicant === true ||
                    authorType.includes("applicant") ||
                    (writerKey && writerKey === applicantKey) ||
                    node.is_mine === false ||
                    node.isMine === false;
                  if (explicitApplicant) {{
                    const timestamp = Number(
                      node.created_at ||
                      node.createdAt ||
                      node.updated_at ||
                      node.updatedAt ||
                      node.comment_no ||
                      node.commentNo ||
                      candidates.length
                    );
                    candidates.push({{
                      text,
                      timestamp: Number.isFinite(timestamp)
                        ? timestamp
                        : candidates.length
                    }});
                  }}
                }}
                Object.values(node).forEach((child) => {{
                  if (child && typeof child === "object") {{
                    visit(child, depth + 1);
                  }}
                }});
              }};
              visit(value);
              candidates.sort((a, b) => a.timestamp - b.timestamp);
              return candidates.length
                ? candidates[candidates.length - 1].text
                : "";
            }};
            let attempts = 0;
            const fetchApplications = () => {{
              attempts += 1;
              api.getApplicationOfBand({json.dumps(band_no)}).then(
                async (value) => {{
                  const items = value && Array.isArray(value.items)
                    ? value.items
                    : [];
                  const rows = await Promise.all(items.map(async (item) => {{
                    const memberKey = clean(
                      item.member_key || item.memberKey || ""
                    );
                    const applicantKey = clean(
                      item.applicant_key ||
                      item.applicantKey ||
                      memberKey
                    );
                    const displayName = clean(
                      item.applicant_name ||
                      item.applicantName ||
                      item.profile_name ||
                      item.profileName ||
                      item.name ||
                      ""
                    );
                    return {{
                      display_name: displayName,
                      request_id: memberKey || applicantKey,
                      applicant_key: applicantKey || memberKey,
                      application_time: clean(
                        item.created_at || item.createdAt || ""
                      ),
                      application_answer: clean(
                        item.join_answer || item.joinAnswer || ""
                      ),
                      application_reply: await latestApplicantReply(
                        item,
                        applicantKey || memberKey
                      ),
                      fingerprint: memberKey || applicantKey,
                      text: displayName
                    }};
                  }}));
                  const usableRows = rows.filter(
                    (row) => row.display_name && row.request_id
                  );
                  if (!usableRows.length && attempts < 3) {{
                    setTimeout(fetchApplications, 100);
                    return;
                  }}
                  resolve({{
                    ok: usableRows.length > 0,
                    rows: usableRows,
                    reason: usableRows.length ? "" : "application-list-empty"
                  }});
                }},
                () => resolve({{
                  ok: false,
                  reason: "application-api-failed"
                }})
              );
            }};
            fetchApplications();
          }} catch (error) {{
            resolve({{ok: false, reason: String(error)}});
          }}
        }})
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
                timeout=8,
            )
            value = runtime_value(result)
        except Exception as exc:
            self.logger.info(
                "신청자 API 직접 조회 실패: %s",
                safe_for_log(exc),
            )
            return False
        if not isinstance(value, Mapping) or not value.get("ok"):
            reason = value.get("reason", "") if isinstance(value, Mapping) else ""
            self.logger.info(
                "신청자 API 직접 조회 대기: %s",
                safe_for_log(reason),
            )
            return False
        requests = self.dom_parser.parse_rows(value.get("rows", []))
        for request in requests:
            request.source = "BAND_API"
            request.stable_key = make_stable_key(
                request_id=request.request_id or request.applicant_key,
                display_name=request.display_name,
                application_time=request.application_time,
                source=request.source,
            )
        self._accept_requests(requests)
        return True

    def _reset_application_count_tracking(self) -> None:
        self._application_count_request_id = ""
        self._last_application_count = None
        self._last_application_count_poll = 0.0

    def _periodic_application_count_poll(
        self,
        connection: CDPConnection,
        now: float,
    ) -> None:
        interval = max(
            0.5,
            float(self.config["application_count_poll_seconds"]),
        )
        if now - self._last_application_count_poll < interval:
            return
        self._last_application_count_poll = now
        request_id = self._application_count_request_id
        if not request_id:
            return
        try:
            connection.call(
                "Network.replayXHR",
                {"requestId": request_id},
                timeout=2,
            )
        except Exception as exc:
            self.logger.info(
                "가입 신청 건수 확인 재연결 대기: %s",
                safe_for_log(exc),
            )
            self._application_count_request_id = ""

    def _has_active_follow_up(self) -> bool:
        for request in self.registry.list_items():
            if request.status in {"APPROVED", "REJECTED", "EXPIRED"}:
                continue
            if request.status in {
                "INVALID",
                "AWAITING_CORRECTION",
                "QUESTION_SENDING",
                "QUESTION_FAILED",
            }:
                return True
            if self.registry.follow_up_status(request.follow_up_identity):
                return True
        return False

    def _periodic_follow_up_scan(
        self,
        connection: CDPConnection,
        now: float,
    ) -> None:
        settings = self.config.get("follow_up_question", {})
        if not isinstance(settings, Mapping) or not bool(
            settings.get("enabled", False)
        ):
            return
        if not self._has_active_follow_up():
            return
        interval = max(0.5, float(settings.get("recheck_seconds", 2)))
        if now - self._last_follow_up_scan < interval:
            return
        self._last_follow_up_scan = now
        self._fast_application_scan(connection)

    def _periodic_session_check(
        self,
        connection: CDPConnection,
        now: float,
    ) -> None:
        if now - self._last_session_check < 5:
            return
        self._last_session_check = now
        script = r"""
        (() => {
          const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
          const loginControl = Array.from(
            document.querySelectorAll("button,a,[role='button']")
          ).some((element) => /^(로그인|login|sign in)$/i.test(clean(
            element.innerText || element.textContent || element.getAttribute("aria-label")
          )));
          return {
            url: String(location.href || ""),
            login_required: Boolean(
              document.querySelector("input[type='password'],form[action*='login']") ||
              loginControl ||
              /\/login(?:[/?#]|$)/i.test(location.pathname) ||
              /(^|\.)auth\.band\.us$/i.test(location.hostname)
            )
          };
        })()
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {"expression": script, "returnByValue": True},
                timeout=3,
            )
            value = runtime_value(result)
        except Exception:
            return
        if not isinstance(value, Mapping):
            return
        page_url = str(value.get("url", ""))
        if self.tab is not None and page_url:
            self.tab["url"] = page_url
        if bool(value.get("login_required")):
            self.set_state(
                "LOGIN_REQUIRED",
                "BAND 로그인 세션을 갱신해야 합니다.",
            )
        elif "/applications" in page_url.lower() and self.state == "LOGIN_REQUIRED":
            self.set_state("CONNECTED", "BAND 로그인 세션이 복구되었습니다.")

    def _periodic_dom_tasks(self, connection: CDPConnection) -> None:
        now = time.monotonic()
        self._periodic_session_check(connection, now)
        self._periodic_application_count_poll(connection, now)
        self._periodic_follow_up_scan(connection, now)
        if self._dom_install_needed:
            self._install_dom_monitor(connection)
        event_interval = max(0.05, float(self.config["dom_event_poll_seconds"]))
        if now - self._last_dom_event_poll >= event_interval:
            self._last_dom_event_poll = now
            try:
                result = connection.call(
                    "Runtime.evaluate",
                    {
                        "expression": DOM_DRAIN_SCRIPT,
                        "returnByValue": True,
                    },
                    timeout=2,
                )
                drained = runtime_value(result)
                if isinstance(drained, Mapping):
                    rows = drained.get("rows", [])
                    notification_events = drained.get("notification_events", [])
                else:
                    rows = drained
                    notification_events = []
                self._accept_requests(self.dom_parser.parse_rows(rows))
                if notification_events:
                    self._handle_notification_trigger(
                        connection,
                        "상단 알림 DOM 대기열 신호",
                    )
            except Exception:
                self._dom_install_needed = True
        full_interval = max(1.0, float(self.config["poll_fallback_seconds"]))
        if now - self._last_dom_full_scan >= full_interval:
            self._last_dom_full_scan = now
            self._full_dom_scan(connection)
        safety_interval = max(
            0.0, float(self.config["applications_safety_refresh_seconds"])
        )
        if (
            safety_interval > 0
            and now - self._last_safety_refresh >= safety_interval
        ):
            self._last_safety_refresh = now
            self._reload_applications_page(
                connection, "누락 방지 주기 확인"
            )

    def _handle_notification_trigger(
        self,
        connection: CDPConnection,
        reason: str = "상단 알림 변화 감지",
    ) -> None:
        if not bool(self.config["notification_trigger_enabled"]):
            return
        cooldown = max(
            0.5, float(self.config["notification_refresh_cooldown_seconds"])
        )
        now = time.monotonic()
        if now - self._last_notification_refresh < cooldown:
            return
        self._last_notification_refresh = now
        self._reload_applications_page(connection, reason)

    def _reload_applications_page(
        self, connection: CDPConnection, reason: str
    ) -> bool:
        tab_url = str((self.tab or {}).get("url", ""))
        if "/applications" not in tab_url.lower():
            return False
        try:
            self._reset_application_count_tracking()
            connection.call("Page.reload", {"ignoreCache": False})
            self._dom_install_needed = True
            self._last_safety_refresh = time.monotonic()
            self.logger.info("가입 신청 페이지 재확인: %s", safe_for_log(reason))
            return True
        except Exception as exc:
            self.logger.warning(
                "가입 신청 페이지 재확인 실패: %s", safe_for_log(exc)
            )
            return False

    def _full_dom_scan(self, connection: CDPConnection) -> list[BandJoinRequest]:
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": DOM_FULL_SCAN_SCRIPT,
                    "returnByValue": True,
                },
                timeout=3,
            )
            rows = runtime_value(result)
        except Exception as exc:
            self.set_state("FALLBACK", f"DOM 목록 확인 실패: {safe_for_log(exc)}")
            return []
        requests = self.dom_parser.parse_rows(rows)
        self._accept_requests(requests)
        active_keys = {request.stable_key for request in requests}
        self.registry.mark_missing(
            active_keys,
            expire_after=float(self.config["missing_expire_seconds"]),
        )
        if self.state == "FALLBACK":
            self.set_state("CONNECTED", "DOM 감시가 복구되었습니다.")
        return requests

    def _accept_requests(self, requests: Iterable[BandJoinRequest]) -> None:
        for request in requests:
            stored, is_new, changed = self.registry.upsert_detailed(request)
            if not changed:
                if (
                    not stored.eligible
                    and self._follow_up_enabled()
                    and not self.registry.follow_up_status(
                        stored.follow_up_identity
                    )
                ):
                    self._enqueue_follow_up(stored)
                continue
            if stored.status in {"APPROVED", "REJECTED", "EXPIRED"}:
                continue

            profile = self.profile_matcher.match(stored.display_name)
            original_answer = self.answer_matcher.match(
                stored.application_answer
            )
            answer = original_answer
            if not original_answer.eligible and stored.application_reply:
                answer = self.answer_matcher.match(stored.application_reply)

            stored.eligible = profile.eligible and answer.eligible
            stored.eligibility_reason = "; ".join(
                reason
                for reason in (profile.reason, answer.reason)
                if reason
            )
            follow_up_status = self.registry.follow_up_status(
                stored.follow_up_identity
            )
            if stored.eligible:
                stored.status = "ELIGIBLE"
            elif follow_up_status == "SENT":
                stored.status = "AWAITING_CORRECTION"
            elif follow_up_status == "SENDING":
                stored.status = "QUESTION_SENDING"
            elif follow_up_status == "FAILED":
                stored.status = "QUESTION_FAILED"
            else:
                stored.status = "INVALID"

            if is_new:
                self._print_new_request(stored)
                self._notify()
            else:
                self._print_updated_request(stored)

            if stored.eligible and bool(self.config["auto_approve_enabled"]):
                self.auto_queue.put(("approve", stored.stable_key))
            elif not stored.eligible and self._follow_up_enabled():
                if not follow_up_status:
                    self._enqueue_follow_up(stored)
            elif not stored.eligible and bool(self.config["auto_reject_enabled"]):
                self.auto_queue.put(("reject", stored.stable_key))

    def _follow_up_enabled(self) -> bool:
        settings = self.config.get("follow_up_question", {})
        return isinstance(settings, Mapping) and bool(
            settings.get("enabled", False)
        )

    def _follow_up_reason_codes(
        self, request: BandJoinRequest
    ) -> tuple[list[str], str]:
        profile = self.profile_matcher.match(request.display_name)
        original_answer = self.answer_matcher.match(request.application_answer)
        answer = original_answer
        if not original_answer.eligible and request.application_reply:
            answer = self.answer_matcher.match(request.application_reply)
        codes: list[str] = []
        if not profile.eligible:
            codes.append("profile")
        if not answer.eligible:
            codes.append("answer")
        settings = self.config.get("follow_up_question", {})
        if not isinstance(settings, Mapping):
            return codes, ""
        if codes == ["profile"]:
            message = settings.get("profile_message", "")
        elif codes == ["answer"]:
            message = settings.get("answer_message", "")
        else:
            message = settings.get("profile_and_answer_message", "")
        return codes, str(message).strip()

    def _enqueue_follow_up(self, request: BandJoinRequest) -> None:
        identity = request.follow_up_identity
        with self._follow_up_queue_lock:
            if identity in self._follow_up_enqueued:
                return
            if time.monotonic() < self._follow_up_retry_after.get(identity, 0.0):
                return
            self._follow_up_enqueued.add(identity)
        self.auto_queue.put(("question", request.stable_key))

    def _print_new_request(self, request: BandJoinRequest) -> None:
        time_text = request.application_time or request.first_seen
        console_print("")
        console_print(
            f"[신규 #{request.sequence}] {request.display_name} | "
            f"{request.source} | {time_text} | {request.status}"
        )
        console_print(f"  판정: {request.eligibility_reason}")
        console_print(
            f"  최초 기숙사 코드: "
            f"{request.application_answer.strip().upper() or '(미입력)'}"
        )
        if request.application_reply:
            console_print(
                f"  추가 질문 답변: "
                f"{request.application_reply.strip().upper()}"
            )
        if request.request_id:
            console_print(f"  식별자: {safe_for_log(request.request_id, 120)}")
        self.logger.info(
            "신규 #%s %s %s %s 기숙사=%s",
            request.sequence,
            request.masked_display_name,
            safe_for_log(request.source),
            safe_for_log(request.status),
            safe_for_log(
                request.application_answer.strip().upper() or "미입력"
            ),
        )

    def _print_updated_request(self, request: BandJoinRequest) -> None:
        console_print(
            f"[변경 #{request.sequence}] {request.display_name} | "
            f"{request.status} | {request.eligibility_reason}"
        )
        self.logger.info(
            "변경 #%s %s %s 기숙사=%s 추가답변=%s",
            request.sequence,
            request.masked_display_name,
            safe_for_log(request.status),
            safe_for_log(
                request.application_answer.strip().upper() or "미입력"
            ),
            safe_for_log(
                request.application_reply.strip().upper() or "없음"
            ),
        )

    def _notify(self) -> None:
        if not bool(self.config["notification_enabled"]):
            return
        try:
            if os.name == "nt":
                import winsound

                winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
            else:
                console_print("\a", end="")
        except Exception:
            pass

    def _auto_action_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                action, stable_key = self.auto_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            request = next(
                (
                    item
                    for item in self.registry.list_items()
                    if item.stable_key == stable_key
                ),
                None,
            )
            if request:
                if action == "question":
                    identity = request.follow_up_identity
                    try:
                        try:
                            success, message = self.send_follow_up_question(
                                request
                            )
                        except Exception as exc:
                            success = False
                            message = f"추가 질문 처리 오류: {exc}"
                        if (
                            not success
                            and not self.registry.follow_up_status(identity)
                        ):
                            settings = self.config.get(
                                "follow_up_question", {}
                            )
                            retry_seconds = (
                                float(settings.get("prepare_retry_seconds", 10))
                                if isinstance(settings, Mapping)
                                else 10.0
                            )
                            with self._follow_up_queue_lock:
                                self._follow_up_retry_after[identity] = (
                                    time.monotonic() + max(1.0, retry_seconds)
                                )
                        else:
                            with self._follow_up_queue_lock:
                                self._follow_up_retry_after.pop(identity, None)
                    finally:
                        with self._follow_up_queue_lock:
                            self._follow_up_enqueued.discard(identity)
                else:
                    success, message = self.perform_action(request, action)
                console_print(
                    f"[자동 {action}] #{request.sequence}: "
                    f"{'성공' if success else '실패'} - {message}"
                )
                self.logger.info(
                    "자동 %s #%s %s: %s",
                    safe_for_log(action),
                    request.sequence,
                    "성공" if success else "실패",
                    safe_for_log(message),
                )

    def send_follow_up_question(
        self,
        request: BandJoinRequest,
    ) -> tuple[bool, str]:
        reason_codes, message = self._follow_up_reason_codes(request)
        if not reason_codes:
            return True, "신청 조건이 이미 충족되어 추가 질문을 보내지 않았습니다."
        if not message:
            return False, "추가 질문 메시지가 비어 있습니다."

        band_no = self._band_no()
        applicant_key = request.applicant_key or request.request_id
        if not band_no:
            return False, "추가 질문 전송에 필요한 밴드 식별자가 없습니다."

        if not applicant_key or "BAND_API" not in request.source.split("+"):
            return self._send_follow_up_question_dom(
                request,
                reason_codes,
                message,
            )

        with self.connection_lock:
            connection = self.connection
        if not connection or not connection.connected:
            return False, "Chrome/BAND 연결이 없습니다."

        preflight_script = """
        (() => {
          try {
            const require = window.__bandWebpackRequire;
            if (typeof require !== "function") {
              return {ok: false, reason: "webpack-require-missing"};
            }
            const api = require(1228);
            const owner = api && api.createApplicantComment
              ? api
              : api && api.default;
            const fn = owner && owner.createApplicantComment;
            return {
              ok: typeof fn === "function",
              reason: typeof fn === "function"
                ? ""
                : "create-applicant-comment-missing"
            };
          } catch (error) {
            return {ok: false, reason: String(error)};
          }
        })()
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": preflight_script,
                    "returnByValue": True,
                },
                timeout=3,
            )
            preflight = runtime_value(result)
        except Exception as exc:
            return False, f"추가 질문 API 준비 확인 실패: {exc}"
        if not isinstance(preflight, Mapping) or not preflight.get("ok"):
            return self._send_follow_up_question_dom(
                request,
                reason_codes,
                message,
            )

        identity = request.follow_up_identity
        if not self.registry.begin_follow_up(
            identity,
            stable_key=request.stable_key,
            reason_codes=reason_codes,
            message=message,
        ):
            status = self.registry.follow_up_status(identity) or "기록됨"
            return False, f"동일 신청에 추가 질문 발송 기록이 있습니다: {status}"
        self.registry.set_status(request.stable_key, "QUESTION_SENDING")

        script = f"""
        new Promise((resolve) => {{
          try {{
            const require = window.__bandWebpackRequire;
            if (typeof require !== "function") {{
              resolve({{ok: false, reason: "webpack-require-missing"}});
              return;
            }}
            const api = require(1228);
            const owner = api && api.createApplicantComment
              ? api
              : api && api.default;
            const fn = owner && owner.createApplicantComment;
            if (typeof fn !== "function") {{
              resolve({{
                ok: false,
                reason: "create-applicant-comment-missing"
              }});
              return;
            }}
            Promise.resolve(fn.call(
              owner,
              {json.dumps(band_no)},
              {json.dumps(applicant_key)},
              {json.dumps(message)},
              []
            )).then(
              () => resolve({{ok: true}}),
              (error) => resolve({{
                ok: false,
                reason: String(error || "band-api-rejected")
              }})
            );
          }} catch (error) {{
            resolve({{ok: false, reason: String(error)}});
          }}
        }})
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
                timeout=8,
            )
            value = runtime_value(result)
        except Exception as exc:
            detail = f"추가 질문 API 결과 확인 실패: {exc}"
            self.registry.finish_follow_up(identity, "FAILED", detail)
            self.registry.set_status(request.stable_key, "QUESTION_FAILED")
            return False, (
                f"{detail}. 중복 방지를 위해 자동 재전송하지 않습니다."
            )

        if isinstance(value, Mapping) and value.get("ok"):
            self.registry.finish_follow_up(identity, "SENT")
            self.registry.set_status(request.stable_key, "AWAITING_CORRECTION")
            return True, "추가 질문을 1회 전송하고 수정 대기 상태로 전환했습니다."

        reason = value.get("reason", "") if isinstance(value, Mapping) else ""
        detail = f"BAND 추가 질문 API 거부: {reason or '알 수 없는 오류'}"
        self.registry.finish_follow_up(identity, "FAILED", detail)
        self.registry.set_status(request.stable_key, "QUESTION_FAILED")
        return False, f"{detail}. 중복 방지를 위해 자동 재전송하지 않습니다."

    def _send_follow_up_question_dom(
        self,
        request: BandJoinRequest,
        reason_codes: Iterable[str],
        message: str,
    ) -> tuple[bool, str]:
        if not bool(self.config.get("dom_action_enabled", False)):
            return False, "추가 질문 DOM 동작이 비활성화되어 있습니다."
        with self.connection_lock:
            connection = self.connection
        if not connection or not connection.connected:
            return False, "Chrome/BAND 연결이 없습니다."

        identity = request.follow_up_identity
        if not self.registry.begin_follow_up(
            identity,
            stable_key=request.stable_key,
            reason_codes=reason_codes,
            message=message,
        ):
            status = self.registry.follow_up_status(identity) or "기록됨"
            return False, f"동일 신청에 추가 질문 발송 기록이 있습니다: {status}"
        self.registry.set_status(request.stable_key, "QUESTION_SENDING")

        script = f"""
        new Promise((resolve) => {{
          const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const visible = (element) => Boolean(
            element && element.getClientRects && element.getClientRects().length
          );
          const targetName = {json.dumps(request.display_name)};
          const targetAnswer = {json.dumps(request.application_answer)};
          const rows = Array.from(document.querySelectorAll(
            "li.requestJoinMemberItem,[data-viewname='DBandApplicationItemView']"
          ));
          const row = rows.find((candidate) => {{
            const nameElement = candidate.querySelector(
              ".text.-flex .ellipsis,img[alt],[data-profile-name]"
            );
            const name = clean(
              nameElement && (
                nameElement.getAttribute("alt") ||
                nameElement.getAttribute("data-profile-name") ||
                nameElement.textContent
              )
            );
            const answerElement = candidate.querySelector("dd.answerText");
            const answer = clean(answerElement && answerElement.textContent);
            return name === targetName && (!targetAnswer || answer === targetAnswer);
          }});
          if (!row) {{
            resolve({{ok: false, reason: "applicant-row-not-found"}});
            return;
          }}
          const askButton = row.querySelector("._askJoinQuestionBtn");
          if (!visible(askButton)) {{
            resolve({{ok: false, reason: "ask-button-not-found"}});
            return;
          }}
          askButton.click();
          const deadline = Date.now() + 2500;
          const timer = setInterval(() => {{
            const confirm = Array.from(
              document.querySelectorAll("button._btnConfirm")
            ).find(visible);
            if (confirm) {{
              const layer = confirm.closest(
                "[role='dialog'],[class*='Layer'],[class*='layer']"
              );
              const layerText = clean(layer && layer.textContent);
              if (!layerText || !layerText.includes(targetName)) {{
                clearInterval(timer);
                resolve({{ok: false, reason: "confirmation-target-mismatch"}});
                return;
              }}
              clearInterval(timer);
              confirm.click();
              setTimeout(() => resolve({{ok: true}}), 300);
              return;
            }}
            if (Date.now() >= deadline) {{
              clearInterval(timer);
              resolve({{ok: false, reason: "confirmation-timeout"}});
            }}
          }}, 50);
        }})
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
                timeout=5,
            )
            value = runtime_value(result)
        except Exception as exc:
            detail = f"추가 질문 DOM 결과 확인 실패: {exc}"
            self.registry.finish_follow_up(identity, "FAILED", detail)
            self.registry.set_status(request.stable_key, "QUESTION_FAILED")
            return False, f"{detail}. 중복 방지를 위해 자동 재전송하지 않습니다."

        if isinstance(value, Mapping) and value.get("ok"):
            self.registry.finish_follow_up(identity, "SENT")
            self.registry.set_status(request.stable_key, "AWAITING_CORRECTION")
            return True, "BAND 가입 질문을 해당 신청자에게 1회 다시 보냈습니다."

        reason = value.get("reason", "") if isinstance(value, Mapping) else ""
        detail = f"BAND 추가 질문 DOM 동작 실패: {reason or '알 수 없는 오류'}"
        self.registry.finish_follow_up(identity, "FAILED", detail)
        self.registry.set_status(request.stable_key, "QUESTION_FAILED")
        return False, f"{detail}. 중복 방지를 위해 자동 재전송하지 않습니다."

    def _perform_api_action(
        self,
        connection: CDPConnection,
        request: BandJoinRequest,
        action: str,
    ) -> tuple[bool, str]:
        band_no = self._band_no()
        member_key = request.request_id
        function_name = {
            "approve": "acceptApplication",
            "reject": "denyApplication",
        }.get(action)
        if not band_no or not member_key or not function_name:
            return False, "BAND API 처리에 필요한 식별자가 없습니다."
        script = f"""
        new Promise((resolve) => {{
          try {{
            const require = window.__bandWebpackRequire;
            if (typeof require !== "function") {{
              resolve({{ok: false, reason: "webpack-require-missing"}});
              return;
            }}
            const api = require(637);
            api[{json.dumps(function_name)}](
              {json.dumps(band_no)},
              {json.dumps(member_key)}
            ).then(
              () => resolve({{ok: true}}),
              () => resolve({{ok: false, reason: "band-api-rejected"}})
            );
          }} catch (error) {{
            resolve({{ok: false, reason: String(error)}});
          }}
        }})
        """
        try:
            result = connection.call(
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
                timeout=5,
            )
            value = runtime_value(result)
        except Exception as exc:
            return False, f"BAND API 처리 실패: {exc}"
        if isinstance(value, Mapping) and value.get("ok"):
            label = "수락" if action == "approve" else "거절"
            return True, f"{label} API 처리가 완료됐습니다."
        reason = value.get("reason", "") if isinstance(value, Mapping) else ""
        return False, f"BAND API 처리 거부: {reason or '알 수 없는 오류'}"

    def perform_action(
        self, request: BandJoinRequest, action: str
    ) -> tuple[bool, str]:
        allowed, reason = self.action_adapter.begin_action(request)
        if not allowed:
            return False, reason
        try:
            with self.connection_lock:
                connection = self.connection
            if not connection or not connection.connected:
                return False, "Chrome/BAND 연결이 없습니다."
            used_direct_api = "BAND_API" in request.source.split("+")
            if used_direct_api:
                success, message = self._perform_api_action(
                    connection,
                    request,
                    action,
                )
            else:
                success, message = self.action_adapter.perform(
                    connection, request, action
                )
            if not success:
                if used_direct_api:
                    self._reload_applications_page(
                        connection,
                        "직접 수락·거절 API 실패 후 DOM 복구",
                    )
                self.bring_to_front()
                return False, message
            self.registry.set_status(request.stable_key, "ACTION_SENT")
            if used_direct_api:
                final_status = "APPROVED" if action == "approve" else "REJECTED"
                self.registry.set_status(request.stable_key, final_status)
                return True, message
            delay = max(0.5, float(self.config["approval_delay_seconds"]))
            self.stop_event.wait(delay)
            active = self._full_dom_scan(connection)
            still_present = any(
                item.display_name == request.display_name for item in active
            )
            if still_present:
                self.registry.set_status(request.stable_key, "ACTION_FAILED")
                return False, f"{message} 처리 후에도 신청자가 목록에 남아 있습니다."
            final_status = "APPROVED" if action == "approve" else "REJECTED"
            self.registry.set_status(request.stable_key, final_status)
            return True, f"{message} 결과를 목록에서 확인했습니다."
        except Exception as exc:
            self.registry.set_status(request.stable_key, "ACTION_FAILED")
            return False, f"처리 오류: {exc}"
        finally:
            self.action_adapter.end_action(request)

    def refresh(self) -> tuple[bool, str]:
        with self.connection_lock:
            connection = self.connection
        if not connection or not connection.connected:
            return False, "연결된 BAND 탭이 없습니다."
        try:
            connection.call("Page.reload", {"ignoreCache": False})
            self._dom_install_needed = True
            return True, "BAND 페이지 새로고침을 요청했습니다."
        except Exception as exc:
            return False, f"새로고침 실패: {exc}"

    def bring_to_front(self) -> tuple[bool, str]:
        with self.connection_lock:
            connection = self.connection
        if not connection or not connection.connected:
            return False, "연결된 BAND 탭이 없습니다."
        try:
            connection.call("Page.bringToFront")
            return True, "BAND 탭을 앞으로 가져왔습니다."
        except Exception as exc:
            return False, f"탭 열기 실패: {exc}"

    def status_text(self) -> str:
        tab_url = str((self.tab or {}).get("url", ""))
        follow_up = self.config.get("follow_up_question", {})
        follow_up_enabled = (
            isinstance(follow_up, Mapping)
            and bool(follow_up.get("enabled", False))
        )
        return (
            f"상태={self.state}, 상세={self.state_detail}, "
            f"포트={self.config['chrome_port']}, 탭={tab_url or '-'}, "
            f"진단={'ON' if self.config['diagnostic_mode'] else 'OFF'}, "
            f"알림감지={'ON' if self.config['notification_trigger_enabled'] else 'OFF'}, "
            f"DOM동작={'ON' if self.config['dom_action_enabled'] else 'OFF'}, "
            f"자동승인={'ON' if self.config['auto_approve_enabled'] else 'OFF'}, "
            f"자동거절={'ON' if self.config['auto_reject_enabled'] else 'OFF'}, "
            f"추가질문={'ON' if follow_up_enabled else 'OFF'}"
        )


HELP_TEXT = """
명령어:
  list                 현재 감지한 신청자 목록
  approve <번호>       신청 승인 (항상 확인 질문 표시)
  reject <번호>        신청 거절 (항상 확인 질문 표시)
  refresh              현재 BAND 탭 새로고침
  open                 BAND 탭을 앞으로 가져오기
  status               연결/설정 상태 표시
  help                 도움말 표시
  quit                 종료

주의:
  - 자동 승인/거절과 DOM 버튼 실행은 기본적으로 꺼져 있습니다.
  - 테스트 계정으로 실제 화면을 확인한 뒤 설정을 켜세요.
  - 진단 모드는 쿠키/토큰/Authorization 헤더를 저장하지 않습니다.
""".strip()


def format_request_line(request: BandJoinRequest) -> str:
    identifier = safe_for_log(request.request_id, 40) if request.request_id else "-"
    applied = request.application_time or request.first_seen
    return (
        f"#{request.sequence:<3} {request.status:<13} "
        f"{request.display_name} | {request.source} | {applied} | {identifier}"
    )


def terminal_loop(monitor: BandJoinMonitor) -> None:
    console_print("")
    console_print(HELP_TEXT)
    console_print("")
    while not monitor.stop_event.is_set():
        try:
            command = input("band-monitor> ").strip()
        except (EOFError, KeyboardInterrupt):
            console_print("")
            break
        if not command:
            continue
        parts = command.split()
        verb = parts[0].lower()
        if verb in {"quit", "exit", "q"}:
            break
        if verb == "help":
            console_print(HELP_TEXT)
        elif verb == "status":
            console_print(monitor.status_text())
        elif verb == "list":
            items = monitor.registry.list_items()
            if not items:
                console_print("감지한 신청자가 없습니다.")
            for item in items:
                console_print(format_request_line(item))
        elif verb in {"approve", "reject"}:
            if len(parts) != 2 or not parts[1].isdigit():
                console_print(f"사용법: {verb} <번호>")
                continue
            request = monitor.registry.get_by_sequence(int(parts[1]))
            if not request:
                console_print("해당 번호의 신청자가 없습니다.")
                continue
            korean_action = "승인" if verb == "approve" else "거절"
            console_print(format_request_line(request))
            try:
                confirm = input(
                    f"정말 이 신청을 {korean_action}할까요? (y/N): "
                ).strip().lower()
            except (EOFError, KeyboardInterrupt):
                console_print("")
                continue
            if confirm not in {"y", "yes"}:
                console_print("취소했습니다.")
                continue
            success, message = monitor.perform_action(request, verb)
            console_print(f"{'성공' if success else '실패'}: {message}")
        elif verb == "refresh":
            success, message = monitor.refresh()
            console_print(f"{'성공' if success else '실패'}: {message}")
        elif verb == "open":
            success, message = monitor.bring_to_front()
            console_print(f"{'성공' if success else '실패'}: {message}")
        else:
            console_print("알 수 없는 명령입니다. help를 입력하세요.")


def daemon_loop(monitor: BandJoinMonitor) -> None:
    def request_stop(_signum: int, _frame: Any) -> None:
        monitor.stop_event.set()

    for signal_name in ("SIGTERM", "SIGINT"):
        signal_value = getattr(signal, signal_name, None)
        if signal_value is not None:
            try:
                signal.signal(signal_value, request_stop)
            except (OSError, ValueError):
                pass
    monitor.write_runtime_status()
    while not monitor.stop_event.wait(10):
        monitor.write_runtime_status()


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument(
        "--config",
        default=DEFAULT_CONFIG_FILE,
        help="설정 JSON 파일 경로",
    )
    parser.add_argument(
        "--check-config",
        action="store_true",
        help="설정 파일을 확인하고 종료",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="콘솔 입력 없이 서버 백그라운드 모드로 실행",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    if os.name == "nt":
        try:
            os.system("chcp 65001 >nul")
        except OSError:
            pass
    args = parse_args(argv)
    config_path = Path(args.config).expanduser().resolve()
    try:
        config = apply_environment_overrides(load_or_create_config(config_path))
    except Exception as exc:
        console_print(f"[오류] {exc}")
        return 2
    if args.check_config:
        console_print(
            json.dumps(config, ensure_ascii=False, indent=2)
        )
        return 0

    console_print(f"{APP_NAME} v{VERSION}")
    console_print(f"설정: {config_path}")
    console_print(
        "처음 실행이면 열린 전용 Chrome에서 BAND에 로그인한 뒤 "
        "가입 신청자/멤버 관리 페이지를 열어주세요."
    )
    monitor = BandJoinMonitor(config, config_path.parent)
    try:
        monitor.start()
        if args.daemon:
            daemon_loop(monitor)
        else:
            terminal_loop(monitor)
    except KeyboardInterrupt:
        console_print("")
    except Exception as exc:
        console_print(f"[치명적 오류] {exc}")
        monitor.logger.error("치명적 오류\n%s", traceback.format_exc())
        return 1
    finally:
        monitor.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
