from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

from band_join_monitor import (
    BandJoinMonitor,
    BandJoinRequest,
    BandTabFinder,
    ChromeManager,
    DEFAULT_CONFIG,
    DeduplicationStateManager,
    DiagnosticSanitizer,
    DOMJoinParser,
    DOM_MONITOR_SCRIPT,
    DOM_SIGNAL_BINDING,
    WEBPACK_CAPTURE_SCRIPT,
    JoinAnswerMatcher,
    JoinActionAdapter,
    NetworkJoinParser,
    ProfileRuleMatcher,
    ReconnectPolicy,
    WebSocketJoinParser,
    apply_environment_overrides,
    make_stable_key,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"


class ChromeManagerTests(unittest.TestCase):
    def test_clears_stale_profile_locks_from_persistent_disk(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            profile_dir = Path(temporary_directory)
            lock_names = ("SingletonLock", "SingletonSocket", "SingletonCookie")
            for name in lock_names:
                (profile_dir / name).write_text("stale", encoding="utf-8")

            manager = ChromeManager(
                port=9333,
                executable="chrome",
                profile_dir=profile_dir,
                start_url="https://www.band.us/",
                headless=True,
                extra_args=[],
                logger=mock.Mock(),
            )
            manager._clear_stale_profile_locks()

            for name in lock_names:
                self.assertFalse((profile_dir / name).exists())


class ProfileRuleMatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.matcher = ProfileRuleMatcher(
            {
                "name_min_length": 2,
                "name_max_length": 5,
                "require_010_phone": True,
                "phone_digits": 11,
                "ignore_region_words": True,
            }
        )

    def test_accepts_supported_profile_forms(self) -> None:
        examples = [
            "김상정 01040288600",
            "김상정/01040288600",
            "김상정 010-4028-8600",
            "김상정/전북/01040288600",
            "전북 김상정 01040288600",
        ]
        for example in examples:
            with self.subTest(example=example):
                result = self.matcher.match(example)
                self.assertTrue(result.eligible)
                self.assertEqual(result.name, "김상정")
                self.assertEqual(result.phone, "01040288600")

    def test_rejects_missing_name_or_phone(self) -> None:
        for example in ("김상정", "01040288600", "김상정 01140288600"):
            with self.subTest(example=example):
                self.assertFalse(self.matcher.match(example).eligible)


class JoinAnswerMatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.matcher = JoinAnswerMatcher(
            {
                "required": True,
                "allowed_codes": ["R", "G", "B", "Y"],
                "case_insensitive": True,
            }
        )

    def test_accepts_dormitory_codes(self) -> None:
        for answer in ("R", "G", "B", "Y", " r ", "g\n"):
            with self.subTest(answer=answer):
                self.assertTrue(self.matcher.match(answer).eligible)

    def test_rejects_missing_or_invalid_code(self) -> None:
        for answer in ("", "A", "RG", "R입니다"):
            with self.subTest(answer=answer):
                self.assertFalse(self.matcher.match(answer).eligible)

    def test_profile_and_answer_are_both_required(self) -> None:
        profile = ProfileRuleMatcher(DEFAULT_CONFIG["profile_rules"])
        valid_profile = profile.match("김상정 01040288600")
        invalid_profile = profile.match("김상정")
        valid_answer = self.matcher.match("R")
        invalid_answer = self.matcher.match("A")
        self.assertTrue(valid_profile.eligible and valid_answer.eligible)
        self.assertFalse(valid_profile.eligible and invalid_answer.eligible)
        self.assertFalse(invalid_profile.eligible and valid_answer.eligible)


class ParserTests(unittest.TestCase):
    def test_websocket_fixture(self) -> None:
        payload = (FIXTURE_DIR / "ws_join_request.json").read_text(
            encoding="utf-8"
        )
        requests = WebSocketJoinParser().parse(payload)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].request_id, "fixture-request-001")
        self.assertIn("01012345678", requests[0].display_name)

    def test_network_fixture(self) -> None:
        body = (FIXTURE_DIR / "xhr_join_response.json").read_text(
            encoding="utf-8"
        )
        requests = NetworkJoinParser().parse(
            body, "https://band.us/api/membership_requests"
        )
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].request_id, "fixture-request-002")

    def test_malformed_json_is_ignored(self) -> None:
        self.assertEqual(WebSocketJoinParser().parse("{broken"), [])
        self.assertEqual(NetworkJoinParser().parse("{broken", "https://band.us"), [])

    def test_dom_rows(self) -> None:
        rows = [
            {
                "display_name": "김상정 01040288600",
                "request_id": "dom-1",
                "application_time": "10:00",
                "application_answer": "R",
            }
        ]
        requests = DOMJoinParser().parse_rows(rows)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].source, "DOM")
        self.assertEqual(requests[0].application_answer, "R")

    def test_live_band_dom_selectors_are_supported(self) -> None:
        self.assertIn("._newsCountLabel", DOM_MONITOR_SCRIPT)
        self.assertIn("li.requestJoinMemberItem", DOM_MONITOR_SCRIPT)
        self.assertIn(".text.-flex .ellipsis", DOM_MONITOR_SCRIPT)
        self.assertIn(".date.-ellipsis", DOM_MONITOR_SCRIPT)
        self.assertIn("dd.answerText", DOM_MONITOR_SCRIPT)
        self.assertIn('href !== "#"', DOM_MONITOR_SCRIPT)
        self.assertIn(DOM_SIGNAL_BINDING, DOM_MONITOR_SCRIPT)
        self.assertIn("window.__bandJoinMonitorVersion", DOM_MONITOR_SCRIPT)
        self.assertIn("__bandWebpackRequire", WEBPACK_CAPTURE_SCRIPT)


class DeduplicationTests(unittest.TestCase):
    def test_duplicate_events_keep_one_item(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = DeduplicationStateManager(
                Path(temp_dir) / "state.json", max_applicants=20
            )
            key = make_stable_key(
                request_id="same-id",
                display_name="김상정 01040288600",
                application_time="",
                source="DOM",
            )
            first = BandJoinRequest(key, "김상정 01040288600", "same-id")
            second = BandJoinRequest(key, "김상정 01040288600", "same-id")
            _, first_is_new = manager.upsert(first)
            _, second_is_new = manager.upsert(second)
            self.assertTrue(first_is_new)
            self.assertFalse(second_is_new)
            self.assertEqual(len(manager.list_items()), 1)

    def test_expired_application(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = DeduplicationStateManager(Path(temp_dir) / "state.json")
            request = BandJoinRequest("a" * 64, "김상정 01040288600", source="DOM")
            stored, _ = manager.upsert(request)
            stored.last_seen_monotonic = time.monotonic() - 100
            expired = manager.mark_missing(set(), expire_after=1)
            self.assertEqual(len(expired), 1)
            self.assertEqual(stored.status, "EXPIRED")

    def test_same_member_can_reapply_at_a_different_time(self) -> None:
        first = make_stable_key(
            request_id="",
            display_name="김상정 01040288600",
            application_time="1000",
            source="BAND_API",
        )
        second = make_stable_key(
            request_id="",
            display_name="김상정 01040288600",
            application_time="2000",
            source="BAND_API",
        )
        self.assertNotEqual(first, second)

    def test_same_member_key_can_reapply_at_a_different_time(self) -> None:
        first = make_stable_key(
            request_id="member-1",
            display_name="김상정",
            application_time="1000",
            source="BAND_API",
        )
        second = make_stable_key(
            request_id="member-1",
            display_name="김상정",
            application_time="2000",
            source="BAND_API",
        )
        self.assertNotEqual(first, second)

    def test_profile_change_updates_same_application(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = DeduplicationStateManager(Path(temp_dir) / "state.json")
            key = make_stable_key(
                request_id="member-1",
                display_name="김상정",
                application_time="1000",
                source="BAND_API",
            )
            first = BandJoinRequest(
                key,
                "김상정",
                "member-1",
                "applicant-1",
                "1000",
            )
            second = BandJoinRequest(
                key,
                "김상정 01040288600",
                "member-1",
                "applicant-1",
                "1000",
            )
            manager.upsert_detailed(first)
            stored, is_new, changed = manager.upsert_detailed(second)
            self.assertFalse(is_new)
            self.assertTrue(changed)
            self.assertEqual(stored.display_name, "김상정 01040288600")

    def test_follow_up_record_is_persistent_and_at_most_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "state.json"
            manager = DeduplicationStateManager(path)
            identity = "f" * 64
            self.assertTrue(
                manager.begin_follow_up(
                    identity,
                    stable_key="a" * 64,
                    reason_codes=["profile"],
                    message="프로필을 수정해 주세요.",
                )
            )
            manager.finish_follow_up(identity, "SENT")
            reloaded = DeduplicationStateManager(path)
            self.assertEqual(reloaded.follow_up_status(identity), "SENT")
            self.assertFalse(
                reloaded.begin_follow_up(
                    identity,
                    stable_key="a" * 64,
                    reason_codes=["profile"],
                    message="프로필을 수정해 주세요.",
                )
            )
            serialized = path.read_text(encoding="utf-8")
            self.assertNotIn("프로필을 수정해 주세요.", serialized)


class ChromeSelectionTests(unittest.TestCase):
    def test_render_environment_uses_persistent_headless_paths(self) -> None:
        config = json.loads(json.dumps(DEFAULT_CONFIG))
        with mock.patch.dict(
            os.environ,
            {
                "RENDER": "true",
                "BAND_MONITOR_ENABLED": "false",
                "BAND_CHROME_HEADLESS": "true",
            },
            clear=False,
        ):
            rendered = apply_environment_overrides(config)
        self.assertEqual(rendered["chrome_executable"], "/usr/bin/chromium")
        self.assertEqual(
            rendered["chrome_profile_dir"],
            "/var/data/band-chrome-profile",
        )
        self.assertEqual(
            rendered["runtime_status_file"],
            "/var/data/band-monitor-runtime.json",
        )
        self.assertTrue(rendered["chrome_headless"])
        self.assertFalse(rendered["monitor_enabled"])

    def test_login_page_sets_login_required_status(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            config["runtime_status_file"] = str(Path(temp_dir) / "runtime.json")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {"url": "https://www.band.us/"}
            connection = _FakeConnection(
                {
                    "result": {
                        "value": {
                            "url": "https://auth.band.us/login",
                            "login_required": True,
                        }
                    }
                }
            )
            monitor._periodic_session_check(  # type: ignore[arg-type]
                connection,
                10,
            )
            self.assertEqual(monitor.state, "LOGIN_REQUIRED")
            self.assertFalse(monitor.connected_event.is_set())
            monitor.stop()

    def test_bootstrap_cookie_navigates_back_to_application_page(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            config["runtime_status_file"] = str(Path(temp_dir) / "runtime.json")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {"url": "https://auth.band.us/login"}
            monitor.bootstrap_cookies = [
                {
                    "name": "BAND_SID",
                    "value": "secret",
                    "domain": ".band.us",
                    "path": "/",
                    "secure": True,
                    "httpOnly": False,
                }
            ]
            connection = _CookieConnection()
            monitor._enable_cdp(connection)  # type: ignore[arg-type]
            methods = [method for method, _params in connection.calls]
            self.assertIn("Network.setCookie", methods)
            self.assertIn("Page.navigate", methods)
            self.assertLess(
                methods.index("Page.addScriptToEvaluateOnNewDocument"),
                methods.index("Page.navigate"),
            )
            self.assertEqual(
                monitor.tab["url"],
                config["band_start_url"],
            )
            monitor.stop()

    def test_prefers_band_member_tab(self) -> None:
        tabs = [
            {
                "type": "page",
                "title": "BAND",
                "url": "https://band.us/",
                "webSocketDebuggerUrl": "ws://one",
            },
            {
                "type": "page",
                "title": "가입 신청자",
                "url": "https://www.band.us/band/123/applications",
                "webSocketDebuggerUrl": "ws://two",
            },
        ]
        selected = BandTabFinder.choose_tab(tabs)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["webSocketDebuggerUrl"], "ws://two")

    def test_reconnect_policy_resets_after_success(self) -> None:
        policy = ReconnectPolicy(minimum=1, maximum=10)
        first = policy.next_delay()
        second = policy.next_delay()
        self.assertGreaterEqual(second, first)
        policy.success()
        self.assertLess(policy.next_delay(), 1.6)

    def test_tab_reload_marks_dom_observer_for_reinstall(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor._dom_install_needed = False
            monitor._handle_event(
                None,  # type: ignore[arg-type]
                {"method": "Page.loadEventFired", "params": {}},
            )
            self.assertTrue(monitor._dom_install_needed)
            self.assertEqual(monitor.state, "FALLBACK")
            monitor.stop()

    def test_notification_change_reloads_applications_page(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            config["notification_refresh_cooldown_seconds"] = 0.5
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {
                "url": "https://www.band.us/band/123/applications"
            }
            connection = _RecordingConnection()
            monitor._handle_notification_trigger(connection)
            monitor._handle_notification_trigger(connection)
            reload_calls = [
                call for call in connection.calls if call[0] == "Page.reload"
            ]
            self.assertEqual(len(reload_calls), 1)
            self.assertTrue(monitor._dom_install_needed)
            monitor.stop()

    def test_get_news_count_request_does_not_reload_by_itself(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {
                "url": "https://www.band.us/band/123/applications"
            }
            connection = _RecordingConnection()
            monitor._handle_event(
                connection,  # type: ignore[arg-type]
                {
                    "method": "Network.requestWillBeSent",
                    "params": {
                        "requestId": "news-1",
                        "type": "XHR",
                        "request": {
                            "url": "https://api-kr.band.us/v1.2.0/get_news_count",
                            "method": "GET",
                        },
                    },
                },
            )
            reload_calls = [
                call for call in connection.calls if call[0] == "Page.reload"
            ]
            self.assertEqual(len(reload_calls), 0)
            monitor.stop()

    def test_application_count_increase_reloads_page_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {
                "url": "https://www.band.us/band/123/applications"
            }
            connection = _RecordingConnection()
            url = "https://api-kr.band.us/v1/invitation/get_application_count"
            monitor._fast_application_scan = lambda _connection: False  # type: ignore[method-assign]
            monitor._handle_application_count_response(
                connection,
                url,
                '{"result_data":{"application_count":1}}',
            )
            monitor._handle_application_count_response(
                connection,
                url,
                '{"result_data":{"application_count":1}}',
            )
            self.assertEqual(
                len(
                    [
                        call
                        for call in connection.calls
                        if call[0] == "Page.reload"
                    ]
                ),
                0,
            )
            monitor._handle_application_count_response(
                connection,
                url,
                '{"result_data":{"application_count":2}}',
            )
            self.assertEqual(
                len(
                    [
                        call
                        for call in connection.calls
                        if call[0] == "Page.reload"
                    ]
                ),
                1,
            )
            monitor.stop()

    def test_application_count_increase_uses_fast_api_without_reload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {
                "url": "https://www.band.us/band/123/applications"
            }
            connection = _RecordingConnection()
            called = []
            monitor._fast_application_scan = (  # type: ignore[method-assign]
                lambda _connection: called.append(True) or True
            )
            url = "https://api-kr.band.us/v1/invitation/get_application_count"
            monitor._handle_application_count_response(
                connection,
                url,
                '{"result_data":{"application_count":0}}',
            )
            monitor._handle_application_count_response(
                connection,
                url,
                '{"result_data":{"application_count":1}}',
            )
            self.assertEqual(called, [True])
            self.assertFalse(
                any(call[0] == "Page.reload" for call in connection.calls)
            )
            monitor.stop()

    def test_initial_nonzero_application_count_uses_fast_api(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            connection = _RecordingConnection()
            called = []
            monitor._fast_application_scan = (  # type: ignore[method-assign]
                lambda _connection: called.append(True) or True
            )
            monitor._handle_application_count_response(
                connection,
                "https://api-kr.band.us/v1/invitation/get_application_count",
                '{"result_data":{"application_count":1}}',
            )
            self.assertEqual(called, [True])
            monitor.stop()

    def test_application_count_poll_replays_captured_xhr(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            config["application_count_poll_seconds"] = 1
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor._application_count_request_id = "application-count-xhr"
            connection = _RecordingConnection()
            monitor._periodic_application_count_poll(connection, 10.0)
            replay_calls = [
                call
                for call in connection.calls
                if call[0] == "Network.replayXHR"
            ]
            self.assertEqual(len(replay_calls), 1)
            self.assertEqual(
                replay_calls[0][1],
                {"requestId": "application-count-xhr"},
            )
            monitor.stop()

    def test_dom_binding_signal_reloads_immediately(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = json.loads(json.dumps(DEFAULT_CONFIG))
            config["log_file"] = str(Path(temp_dir) / "monitor.log")
            config["state_file"] = str(Path(temp_dir) / "state.json")
            config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
            monitor = BandJoinMonitor(config, Path(temp_dir))
            monitor.tab = {
                "url": "https://www.band.us/band/123/applications"
            }
            connection = _RecordingConnection()
            monitor._handle_event(
                connection,  # type: ignore[arg-type]
                {
                    "method": "Runtime.bindingCalled",
                    "params": {
                        "name": DOM_SIGNAL_BINDING,
                        "payload": json.dumps(
                            {"type": "notification-change"}
                        ),
                    },
                },
            )
            reload_calls = [
                call for call in connection.calls if call[0] == "Page.reload"
            ]
            self.assertEqual(len(reload_calls), 1)
            monitor.stop()


class ActionSafetyTests(unittest.TestCase):
    def test_duplicate_inflight_action_is_blocked(self) -> None:
        adapter = JoinActionAdapter(True, 0, _NullLogger())
        request = BandJoinRequest("b" * 64, "김상정 01040288600")
        allowed, _ = adapter.begin_action(request)
        duplicate_allowed, _ = adapter.begin_action(request)
        self.assertTrue(allowed)
        self.assertFalse(duplicate_allowed)
        adapter.end_action(request)

    def test_processed_action_is_blocked(self) -> None:
        adapter = JoinActionAdapter(True, 0, _NullLogger())
        request = BandJoinRequest(
            "c" * 64, "김상정 01040288600", status="APPROVED"
        )
        allowed, _ = adapter.begin_action(request)
        self.assertFalse(allowed)

    def test_dom_action_success_and_failure(self) -> None:
        adapter = JoinActionAdapter(True, 0, _NullLogger())
        request = BandJoinRequest("d" * 64, "김상정 01040288600")
        success, _ = adapter.perform(
            _FakeConnection({"result": {"value": {"clicked": True, "label": "승인"}}}),
            request,
            "approve",
        )
        failure, _ = adapter.perform(
            _FakeConnection({"result": {"value": {"clicked": False}}}),
            request,
            "reject",
        )
        self.assertTrue(success)
        self.assertFalse(failure)


class FollowUpQuestionTests(unittest.TestCase):
    def _monitor(self, temp_dir: str) -> BandJoinMonitor:
        config = json.loads(json.dumps(DEFAULT_CONFIG))
        config["log_file"] = str(Path(temp_dir) / "monitor.log")
        config["state_file"] = str(Path(temp_dir) / "state.json")
        config["diagnostic_file"] = str(Path(temp_dir) / "diagnostic.jsonl")
        config["auto_approve_enabled"] = True
        config["auto_reject_enabled"] = False
        config["follow_up_question"]["enabled"] = True
        return BandJoinMonitor(config, Path(temp_dir))

    def test_invalid_application_is_queued_for_question_only_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            monitor = self._monitor(temp_dir)
            request = BandJoinRequest(
                stable_key=make_stable_key(
                    request_id="member-1",
                    display_name="김상정",
                    application_time="1000",
                    source="BAND_API",
                ),
                display_name="김상정",
                request_id="member-1",
                applicant_key="applicant-1",
                application_time="1000",
                application_answer="A",
                source="BAND_API",
            )
            monitor._accept_requests([request])
            monitor._accept_requests([request])
            self.assertEqual(monitor.auto_queue.queue.qsize(), 1)
            action, _key = monitor.auto_queue.get(timeout=0.1)
            self.assertEqual(action, "question")
            monitor.stop()

    def test_invalid_dom_application_is_queued_for_question(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            monitor = self._monitor(temp_dir)
            request = BandJoinRequest(
                stable_key="dom-invalid-1",
                display_name="김기미",
                request_id="",
                applicant_key="",
                application_time="2026-07-17",
                application_answer="FF",
                source="DOM",
            )
            monitor._accept_requests([request])
            action, _key = monitor.auto_queue.get(timeout=0.1)
            self.assertEqual(action, "question")
            monitor.stop()

    def test_bootstrap_cookie_is_injected_without_persisting_secret(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secret = "do-not-write-this-cookie"
            with mock.patch.dict(
                os.environ,
                {"BAND_COOKIE_HEADER": f"BAND_SID={secret}; Path=/"},
                clear=False,
            ):
                monitor = self._monitor(temp_dir)
            connection = _CookieConnection()
            monitor._install_bootstrap_cookies(connection)  # type: ignore[arg-type]
            self.assertEqual(len(connection.cookies), 1)
            self.assertEqual(
                connection.calls[0][0],
                "Network.clearBrowserCookies",
            )
            self.assertEqual(connection.cookies[0]["name"], "BAND_SID")
            self.assertEqual(connection.cookies[0]["value"], secret)
            monitor.set_state("CONNECTED", "render test")
            monitor.stop()
            stored_text = "\n".join(
                path.read_text(encoding="utf-8", errors="replace")
                for path in Path(temp_dir).glob("*")
                if path.is_file()
            )
            self.assertNotIn(secret, stored_text)

    def test_bootstrap_cookie_json_preserves_host_domains(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secret = "host-cookie-secret"
            cookies = [
                {
                    "name": "SESSION",
                    "value": secret,
                    "domain": "auth.band.us",
                    "path": "/",
                    "secure": True,
                    "httpOnly": True,
                    "sameSite": "Lax",
                }
            ]
            with mock.patch.dict(
                os.environ,
                {"BAND_COOKIE_JSON": json.dumps(cookies)},
                clear=False,
            ):
                monitor = self._monitor(temp_dir)
            connection = _CookieConnection()
            monitor._install_bootstrap_cookies(connection)  # type: ignore[arg-type]
            self.assertEqual(len(connection.cookies), 1)
            self.assertEqual(
                connection.cookies[0]["url"],
                "https://auth.band.us/",
            )
            self.assertNotIn("domain", connection.cookies[0])
            self.assertTrue(connection.cookies[0]["httpOnly"])
            monitor.stop()

    def test_runtime_status_file_contains_no_applicant_data(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            monitor = self._monitor(temp_dir)
            monitor.set_state("CONNECTED", "BAND render connected")
            status_path = Path(temp_dir) / "band_join_monitor_runtime.json"
            status = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertEqual(status["state"], "CONNECTED")
            self.assertTrue(status["connected"])
            self.assertNotIn("applicants", status)
            monitor.stop()

    def test_valid_additional_reply_can_satisfy_answer_rule(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            monitor = self._monitor(temp_dir)
            request = BandJoinRequest(
                stable_key=make_stable_key(
                    request_id="member-1",
                    display_name="김상정 01040288600",
                    application_time="1000",
                    source="BAND_API",
                ),
                display_name="김상정 01040288600",
                request_id="member-1",
                applicant_key="applicant-1",
                application_time="1000",
                application_answer="A",
                application_reply=" g ",
                source="BAND_API",
            )
            monitor._accept_requests([request])
            action, _key = monitor.auto_queue.get(timeout=0.1)
            self.assertEqual(action, "approve")
            self.assertTrue(monitor.registry.list_items()[0].eligible)
            monitor.stop()

    def test_successful_question_send_is_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            monitor = self._monitor(temp_dir)
            monitor.tab = {
                "url": "https://www.band.us/band/101992972/applications"
            }
            connection = _FollowUpConnection()
            monitor.connection = connection  # type: ignore[assignment]
            request = BandJoinRequest(
                stable_key=make_stable_key(
                    request_id="member-1",
                    display_name="김상정",
                    application_time="1000",
                    source="BAND_API",
                ),
                display_name="김상정",
                request_id="member-1",
                applicant_key="applicant-1",
                application_time="1000",
                application_answer="R",
                source="BAND_API",
            )
            monitor.registry.upsert(request)
            success, _message = monitor.send_follow_up_question(request)
            self.assertTrue(success)
            self.assertEqual(
                monitor.registry.follow_up_status(request.follow_up_identity),
                "SENT",
            )
            self.assertEqual(request.status, "AWAITING_CORRECTION")
            scripts = [
                call[1]["expression"]
                for call in connection.calls
                if call[0] == "Runtime.evaluate"
            ]
            self.assertTrue(
                any("createApplicantComment" in script for script in scripts)
            )
            monitor.stop()

    def test_dom_question_uses_visible_band_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            monitor = self._monitor(temp_dir)
            monitor.config["dom_action_enabled"] = True
            monitor.tab = {
                "url": "https://www.band.us/band/101992972/applications"
            }
            connection = _FollowUpConnection()
            monitor.connection = connection  # type: ignore[assignment]
            request = BandJoinRequest(
                stable_key="dom-question-1",
                display_name="김기미",
                request_id="",
                applicant_key="",
                application_time="2026-07-17",
                application_answer="FF",
                source="DOM",
            )
            monitor.registry.upsert(request)
            success, _message = monitor.send_follow_up_question(request)
            self.assertTrue(success)
            scripts = [call[1]["expression"] for call in connection.calls]
            self.assertTrue(any("_askJoinQuestionBtn" in script for script in scripts))
            self.assertTrue(any("button._btnConfirm" in script for script in scripts))
            self.assertEqual(
                monitor.registry.follow_up_status(request.follow_up_identity),
                "SENT",
            )
            monitor.stop()


class SanitizerTests(unittest.TestCase):
    def test_credentials_and_phone_are_not_written(self) -> None:
        record = DiagnosticSanitizer.event_record(
            "request",
            {
                "url": "https://band.us/api/123456789?access_token=secret",
                "headers": {
                    "Authorization": "Bearer very-secret-token",
                    "Cookie": "session=abc",
                    "Content-Type": "application/json",
                },
                "body": {
                    "access_token": "secret",
                    "profile_name": "김상정 01040288600",
                },
            },
        )
        serialized = json.dumps(record, ensure_ascii=False)
        self.assertNotIn("very-secret-token", serialized)
        self.assertNotIn("session=abc", serialized)
        self.assertNotIn("01040288600", serialized)
        self.assertNotIn("access_token=secret", serialized)


class _NullLogger:
    def __getattr__(self, _name):
        return lambda *args, **kwargs: None


class _FakeConnection:
    def __init__(self, result):
        self.result = result

    def call(self, _method, _params=None, timeout=8):
        return self.result


class _RecordingConnection:
    def __init__(self):
        self.calls = []

    def call(self, method, params=None, timeout=8):
        self.calls.append((method, params, timeout))
        return {}


class _FollowUpConnection:
    def __init__(self):
        self.calls = []
        self.connected = True

    def call(self, method, params=None, timeout=8):
        self.calls.append((method, params, timeout))
        return {"result": {"value": {"ok": True}}}

    def close(self):
        self.connected = False


class _CookieConnection:
    def __init__(self):
        self.cookies = []
        self.calls = []

    def call(self, method, params=None, timeout=8):
        self.calls.append((method, dict(params or {})))
        if method == "Network.setCookie":
            self.cookies.append(dict(params or {}))
            return {"success": True}
        return {}


if __name__ == "__main__":
    unittest.main()
