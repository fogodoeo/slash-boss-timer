from __future__ import annotations

import json
import logging
import os
from types import SimpleNamespace
import unittest
from unittest import mock

from band_member_sync_monitor import (
    BaseBandJoinMonitor,
    SupabaseMemberDirectory,
    SyncedBandJoinMonitor,
)


class _Response:
    status = 201

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class SupabaseMemberDirectoryTests(unittest.TestCase):
    def test_upsert_uses_service_role_without_exposing_phone_in_url(self) -> None:
        environment = {
            "BAND_MEMBER_SYNC_ENABLED": "true",
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "service-role-secret",
        }
        with mock.patch.dict(os.environ, environment, clear=False):
            directory = SupabaseMemberDirectory(logging.getLogger("test"))
        with mock.patch("urllib.request.urlopen", return_value=_Response()) as opened:
            ok, detail = directory.upsert(
                phone="01012345678",
                display_name="홍길동",
                member_key="member-1",
            )

        self.assertTrue(ok)
        self.assertEqual(detail, "synced")
        request = opened.call_args.args[0]
        self.assertNotIn("01012345678", request.full_url)
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["phone_normalized"], "01012345678")
        self.assertEqual(request.get_header("Authorization"), "Bearer service-role-secret")
        self.assertIn("resolution=merge-duplicates", request.get_header("Prefer"))

    def test_sync_requires_an_explicit_enable_flag(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                "BAND_MEMBER_SYNC_ENABLED": "false",
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role-secret",
            },
            clear=False,
        ):
            directory = SupabaseMemberDirectory(logging.getLogger("test"))
        ok, detail = directory.upsert(
            phone="01012345678",
            display_name="홍길동",
            member_key="member-1",
        )
        self.assertTrue(ok)
        self.assertEqual(detail, "disabled")


class SyncedMonitorHookTests(unittest.TestCase):
    def test_only_successful_approval_is_synced(self) -> None:
        monitor = object.__new__(SyncedBandJoinMonitor)
        monitor.logger = logging.getLogger("test")
        monitor.profile_matcher = mock.Mock()
        monitor.profile_matcher.match.return_value = SimpleNamespace(
            eligible=True,
            phone="01012345678",
            name="홍길동",
        )
        monitor.phone_matcher = mock.Mock()
        monitor.phone_matcher.match.return_value = SimpleNamespace(
            eligible=True,
            phone="01012345678",
        )
        monitor.member_directory = mock.Mock()
        monitor.member_directory.upsert.return_value = (True, "synced")
        request = SimpleNamespace(
            display_name="홍길동 01012345678",
            applicant_key="member-1",
            request_id="member-1",
            verified_phone="01012345678",
            phone_verified=True,
        )

        with mock.patch.object(
            BaseBandJoinMonitor,
            "perform_action",
            return_value=(True, "승인 완료"),
        ):
            success, _message = monitor.perform_action(request, "approve")
        self.assertTrue(success)
        monitor.member_directory.upsert.assert_called_once_with(
            phone="01012345678",
            display_name="홍길동",
            member_key="member-1",
        )

        monitor.member_directory.reset_mock()
        with mock.patch.object(
            BaseBandJoinMonitor,
            "perform_action",
            return_value=(True, "거절 완료"),
        ):
            monitor.perform_action(request, "reject")
        monitor.member_directory.upsert.assert_not_called()

    def test_unavailable_verified_phone_is_never_synced(self) -> None:
        monitor = object.__new__(SyncedBandJoinMonitor)
        monitor.logger = logging.getLogger("test")
        monitor.profile_matcher = mock.Mock()
        monitor.profile_matcher.match.return_value = SimpleNamespace(
            eligible=True,
            phone="01012345678",
            name="홍길동",
        )
        monitor.phone_matcher = mock.Mock()
        monitor.phone_matcher.match.return_value = SimpleNamespace(
            eligible=False,
            phone="01099998888",
        )
        monitor.member_directory = mock.Mock()
        request = SimpleNamespace(
            display_name="홍길동 01012345678",
            applicant_key="member-1",
            request_id="member-1",
            verified_phone="01099998888",
            phone_verified=True,
        )

        with mock.patch.object(
            BaseBandJoinMonitor,
            "perform_action",
            return_value=(True, "승인 완료"),
        ):
            success, _message = monitor.perform_action(request, "approve")
        self.assertTrue(success)
        monitor.member_directory.upsert.assert_not_called()

    def test_accepted_mismatched_numbers_sync_as_two_local_membership_aliases(self) -> None:
        monitor = object.__new__(SyncedBandJoinMonitor)
        monitor.logger = logging.getLogger("test")
        monitor._member_sync_results = {}
        monitor.profile_matcher = mock.Mock()
        monitor.profile_matcher.match.return_value = SimpleNamespace(
            eligible=True,
            phone="01012345678",
            name="홍길동",
        )
        monitor.phone_matcher = mock.Mock()
        monitor.phone_matcher.match.return_value = SimpleNamespace(
            eligible=True,
            phone="01099998888",
        )
        monitor.member_directory = mock.Mock()
        monitor.member_directory.upsert.return_value = (True, "synced")
        request = SimpleNamespace(
            stable_key="mismatch-alias",
            display_name="홍길동 01012345678",
            applicant_key="member-1",
            request_id="member-1",
            verified_phone="01099998888",
            phone_verified=True,
        )
        with mock.patch.object(
            BaseBandJoinMonitor,
            "perform_action",
            return_value=(True, "승인 완료"),
        ):
            success, _message = monitor.perform_action(request, "approve")
        self.assertTrue(success)
        self.assertEqual(monitor.member_directory.upsert.call_count, 2)
        self.assertEqual(
            {call.kwargs["phone"] for call in monitor.member_directory.upsert.call_args_list},
            {"01012345678", "01099998888"},
        )


if __name__ == "__main__":
    unittest.main()
