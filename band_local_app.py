#!/usr/bin/env python3
"""Native Windows UI for BAND approvals and CREWART member synchronization."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import sys
import threading
from typing import Any, Callable

import band_join_monitor as monitor_module
from band_local_dashboard import load_env_file
from band_member_sync_monitor import SyncedBandJoinMonitor


ROOT = Path(__file__).resolve().parent
APP_LOCK_PORT = 49333


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=monitor_module.DEFAULT_CONFIG_FILE)
    parser.add_argument("--check-config", action="store_true")
    return parser.parse_args()


def load_monitor_config(config_path: Path) -> dict[str, Any]:
    load_env_file(ROOT / ".env.band-local")
    return monitor_module.apply_environment_overrides(
        monitor_module.load_or_create_config(config_path)
    )


class SingleInstance:
    def __init__(self) -> None:
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)

    def acquire(self) -> bool:
        try:
            self.socket.bind(("127.0.0.1", APP_LOCK_PORT))
            self.socket.listen(1)
            return True
        except OSError:
            self.socket.close()
            return False

    def close(self) -> None:
        try:
            self.socket.close()
        except OSError:
            pass


class BandApprovalApp:
    BG = "#0b0f16"
    PANEL = "#121925"
    PANEL_2 = "#182231"
    LINE = "#263244"
    TEXT = "#f4f7fb"
    MUTED = "#8d9bad"
    BLUE = "#5b8cff"
    GREEN = "#43d19e"
    RED = "#ff6b78"
    AMBER = "#f0b85a"

    def __init__(
        self, root: Any, monitor: SyncedBandJoinMonitor, lock: SingleInstance,
        config_path: Path,
    ):
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        self.root = root
        self.monitor = monitor
        self.lock = lock
        self.config_path = config_path
        self.closing = False
        self.busy = False
        self.row_cache: dict[str, Any] = {}
        phone_rules = monitor.config.get("phone_verification_rules", {})
        self.require_verified_var = tk.BooleanVar(value=bool(phone_rules.get("require_verified", True)))
        self.require_match_var = tk.BooleanVar(value=bool(phone_rules.get("require_number_match", False)))

        root.title("BAND 가입 승인 센터 · CREWART 연동")
        root.geometry("1240x760")
        root.minsize(1040, 650)
        root.configure(bg=self.BG)
        root.protocol("WM_DELETE_WINDOW", self.close)
        try:
            root.iconbitmap(default=str(ROOT / "band-monitor.ico"))
        except Exception:
            pass

        self._configure_styles()
        self._build_ui()
        self.monitor.start()
        self._refresh_ui()

    def _configure_styles(self) -> None:
        style = self.ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(
            "Monitor.Treeview", background=self.PANEL, fieldbackground=self.PANEL,
            foreground=self.TEXT, rowheight=38, borderwidth=0, font=("Malgun Gothic", 10)
        )
        style.configure(
            "Monitor.Treeview.Heading", background=self.PANEL_2, foreground=self.MUTED,
            relief="flat", borderwidth=0, font=("Malgun Gothic", 9, "bold")
        )
        style.map("Monitor.Treeview", background=[("selected", "#294a80")])
        style.configure("Vertical.TScrollbar", background=self.PANEL_2, troughcolor=self.BG, borderwidth=0)

    def _label(self, parent: Any, text: str = "", **kwargs: Any) -> Any:
        options = {"text": text, "bg": kwargs.pop("bg", self.BG), "fg": kwargs.pop("fg", self.TEXT),
                   "font": kwargs.pop("font", ("Malgun Gothic", 10))}
        options.update(kwargs)
        return self.tk.Label(parent, **options)

    def _button(self, parent: Any, text: str, command: Callable[[], None], *, accent: str | None = None) -> Any:
        bg = accent or self.PANEL_2
        fg = "#071019" if accent in {self.GREEN, self.AMBER} else self.TEXT
        return self.tk.Button(
            parent, text=text, command=command, bg=bg, fg=fg, activebackground=accent or "#223044",
            activeforeground=fg, relief="flat", bd=0, padx=16, pady=9,
            font=("Malgun Gothic", 10, "bold"), cursor="hand2"
        )

    def _build_ui(self) -> None:
        shell = self.tk.Frame(self.root, bg=self.BG)
        shell.pack(fill="both", expand=True, padx=24, pady=20)

        header = self.tk.Frame(shell, bg=self.BG)
        header.pack(fill="x")
        title_box = self.tk.Frame(header, bg=self.BG)
        title_box.pack(side="left")
        self._label(title_box, "BAND 가입 승인 센터", font=("Malgun Gothic", 22, "bold")).pack(anchor="w")
        self._label(
            title_box, "가입 신청 · 휴대폰 인증 · CREWART 회원명단 동기화를 한 화면에서 확인합니다.",
            fg=self.MUTED, font=("Malgun Gothic", 9)
        ).pack(anchor="w", pady=(4, 0))
        self.live_pill = self._label(
            header, "● 연결 준비 중", bg=self.PANEL_2, fg=self.AMBER,
            font=("Malgun Gothic", 10, "bold"), padx=15, pady=9
        )
        self.live_pill.pack(side="right", anchor="n")

        cards = self.tk.Frame(shell, bg=self.BG)
        cards.pack(fill="x", pady=(20, 16))
        self.card_values: dict[str, Any] = {}
        definitions = [
            ("band", "BAND 연결", "연결 대기"),
            ("pending", "처리 대기", "0명"),
            ("verified", "폰 인증 완료", "0명"),
            ("sync", "CREWART 명단", "확인 중"),
        ]
        for index, (key, label, value) in enumerate(definitions):
            card = self.tk.Frame(cards, bg=self.PANEL, highlightbackground=self.LINE, highlightthickness=1)
            card.grid(row=0, column=index, sticky="nsew", padx=(0 if index == 0 else 6, 0 if index == 3 else 6))
            cards.grid_columnconfigure(index, weight=1)
            self._label(card, label, bg=self.PANEL, fg=self.MUTED, font=("Malgun Gothic", 9, "bold")).pack(anchor="w", padx=16, pady=(14, 4))
            value_label = self._label(card, value, bg=self.PANEL, font=("Malgun Gothic", 17, "bold"))
            value_label.pack(anchor="w", padx=16, pady=(0, 14))
            self.card_values[key] = value_label

        toolbar = self.tk.Frame(shell, bg=self.BG)
        toolbar.pack(fill="x", pady=(0, 12))
        self._label(toolbar, "가입 신청 현황", font=("Malgun Gothic", 13, "bold")).pack(side="left")
        self._button(toolbar, "BAND 창 열기", lambda: self._run_monitor_command(self.monitor.bring_to_front)).pack(side="right", padx=(8, 0))
        self._button(toolbar, "새로고침", lambda: self._run_monitor_command(self.monitor.refresh)).pack(side="right")

        options = self.tk.Frame(shell, bg=self.PANEL, highlightbackground=self.LINE, highlightthickness=1)
        options.pack(fill="x", pady=(0, 12))
        self._label(options, "가입 조건", bg=self.PANEL, fg=self.MUTED, font=("Malgun Gothic", 9, "bold")).pack(side="left", padx=(15, 8), pady=9)
        verified_check = self.tk.Checkbutton(
            options, text="BAND 폰 인증 필수", variable=self.require_verified_var,
            command=self._persist_phone_options, bg=self.PANEL, fg=self.TEXT,
            activebackground=self.PANEL, activeforeground=self.TEXT, selectcolor=self.PANEL_2,
            font=("Malgun Gothic", 10), cursor="hand2"
        )
        verified_check.pack(side="left", padx=(5, 20))
        match_check = self.tk.Checkbutton(
            options, text="프로필 번호 일치 필수", variable=self.require_match_var,
            command=self._persist_phone_options, bg=self.PANEL, fg=self.TEXT,
            activebackground=self.PANEL, activeforeground=self.TEXT, selectcolor=self.PANEL_2,
            font=("Malgun Gothic", 10), cursor="hand2"
        )
        match_check.pack(side="left")
        self._label(options, "번호가 달라도 가입시키려면 두 번째 옵션을 끄세요.", bg=self.PANEL, fg=self.MUTED, font=("Malgun Gothic", 9)).pack(side="right", padx=15)

        table_frame = self.tk.Frame(shell, bg=self.PANEL, highlightbackground=self.LINE, highlightthickness=1)
        table_frame.pack(fill="both", expand=True)
        columns = ("no", "status", "name", "profile_phone", "verified_phone", "phone_auth", "phone_match", "decision", "sync", "time")
        self.tree = self.ttk.Treeview(table_frame, columns=columns, show="headings", style="Monitor.Treeview", selectmode="browse")
        headings = {
            "no": "번호", "status": "상태", "name": "가입자", "profile_phone": "프로필 번호",
            "verified_phone": "BAND 인증번호", "phone_auth": "폰 인증", "phone_match": "번호 비교", "decision": "판정",
            "sync": "CREWART 동기화", "time": "신청 시각"
        }
        widths = {"no": 54, "status": 105, "name": 145, "profile_phone": 125, "verified_phone": 125,
                  "phone_auth": 88, "phone_match": 88, "decision": 80, "sync": 115, "time": 160}
        for column in columns:
            self.tree.heading(column, text=headings[column])
            self.tree.column(column, width=widths[column], minwidth=50, anchor="center", stretch=column in {"name", "time"})
        scrollbar = self.ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.tree.pack(side="left", fill="both", expand=True)
        self.tree.tag_configure("approved", foreground=self.GREEN)
        self.tree.tag_configure("invalid", foreground=self.RED)
        self.tree.tag_configure("pending", foreground=self.AMBER)
        self.tree.bind("<<TreeviewSelect>>", self._show_selected_detail)

        footer = self.tk.Frame(shell, bg=self.BG)
        footer.pack(fill="x", pady=(13, 0))
        detail_box = self.tk.Frame(footer, bg=self.BG)
        detail_box.pack(side="left", fill="x", expand=True)
        self.detail = self._label(detail_box, "신청자를 선택하면 판정 상세정보가 표시됩니다.", fg=self.MUTED, anchor="w")
        self.detail.pack(fill="x")
        self.mode_text = self._label(
            detail_box, "", fg=self.AMBER, font=("Malgun Gothic", 9, "bold"), anchor="w"
        )
        self.mode_text.pack(fill="x", pady=(4, 0))
        action_box = self.tk.Frame(footer, bg=self.BG)
        action_box.pack(side="right", padx=(18, 0))
        self.reject_button = self._button(action_box, "선택 거절", lambda: self._selected_action("reject"), accent=self.RED)
        self.reject_button.pack(side="left", padx=(0, 8))
        self.approve_button = self._button(action_box, "선택 승인", lambda: self._selected_action("approve"), accent=self.GREEN)
        self.approve_button.pack(side="left")

    def _request_values(self, request: Any) -> tuple[str, ...]:
        profile = self.monitor.profile_matcher.match(request.display_name)
        sync = getattr(self.monitor, "_member_sync_results", {}).get(request.stable_key)
        if request.phone_verified is True:
            phone_auth = "인증 완료"
        elif request.phone_verified is False:
            phone_auth = "미인증"
        else:
            phone_auth = "확인 대기"
        profile_phone = getattr(profile, "phone", "") or ""
        verified_phone = request.verified_phone or ""
        if profile_phone and verified_phone:
            phone_match = "일치" if profile_phone == verified_phone else "불일치"
        else:
            phone_match = "확인 대기"
        sync_text = "완료" if sync and sync.get("success") else ("실패" if sync else "-")
        return (
            str(request.sequence), request.status, getattr(profile, "name", "") or request.display_name,
            profile_phone or "-", verified_phone or "-", phone_auth, phone_match,
            "통과" if request.eligible else "보류", sync_text,
            request.application_time or request.first_seen,
        )

    @staticmethod
    def _row_tag(status: str) -> str:
        if status == "APPROVED":
            return "approved"
        if status in {"INVALID", "REJECTED", "ACTION_FAILED"}:
            return "invalid"
        return "pending"

    def _refresh_ui(self) -> None:
        if self.closing:
            return
        items = self.monitor.registry.list_items()
        current = {item.stable_key: item for item in items}
        selected = self.tree.selection()
        selected_key = selected[0] if selected else ""
        for iid in self.tree.get_children(""):
            if iid not in current:
                self.tree.delete(iid)
        for item in items:
            values = self._request_values(item)
            tags = (self._row_tag(item.status),)
            if self.tree.exists(item.stable_key):
                self.tree.item(item.stable_key, values=values, tags=tags)
            else:
                self.tree.insert("", "end", iid=item.stable_key, values=values, tags=tags)
        self.row_cache = current
        if selected_key and self.tree.exists(selected_key):
            self.tree.selection_set(selected_key)

        pending = sum(item.status not in {"APPROVED", "REJECTED", "EXPIRED"} for item in items)
        verified = sum(item.phone_verified is True for item in items)
        connected = self.monitor.connected_event.is_set()
        sync_configured = self.monitor.member_directory.configured
        state_label = {
            "DISCONNECTED": "연결 대기",
            "CONNECTING": "연결 중",
            "CONNECTED": "실시간 감시 중",
            "LOGIN_REQUIRED": "BAND 로그인 필요",
            "FALLBACK": "복구 중",
        }.get(self.monitor.state, self.monitor.state)
        self.card_values["band"].configure(text="연결됨" if connected else "연결 대기", fg=self.GREEN if connected else self.AMBER)
        self.card_values["pending"].configure(text=f"{pending}명", fg=self.AMBER if pending else self.TEXT)
        self.card_values["verified"].configure(text=f"{verified}명", fg=self.GREEN if verified else self.TEXT)
        self.card_values["sync"].configure(text="연결됨" if sync_configured else "설정 필요", fg=self.GREEN if sync_configured else self.RED)
        self.live_pill.configure(
            text="● 실시간 감시 중" if connected else f"● {state_label}",
            fg=self.GREEN if connected else self.AMBER,
        )
        auto_approve = bool(self.monitor.config.get("auto_approve_enabled"))
        auto_reject = bool(self.monitor.config.get("auto_reject_enabled"))
        self.mode_text.configure(
            text=(f"자동 승인 {'ON' if auto_approve else 'OFF'}  ·  자동 거절 {'ON' if auto_reject else 'OFF'}"
                  f"  ·  폰 인증 {'필수' if self.require_verified_var.get() else '선택'}"
                  f"  ·  번호 일치 {'필수' if self.require_match_var.get() else '표시만'}")
        )
        self.root.after(800, self._refresh_ui)

    def _show_selected_detail(self, _event: Any = None) -> None:
        selected = self.tree.selection()
        request = self.row_cache.get(selected[0]) if selected else None
        if not request:
            self.detail.configure(text="신청자를 선택하면 판정 상세정보가 표시됩니다.")
            return
        self.detail.configure(text=f"#{request.sequence}  {request.display_name}  ·  {request.eligibility_reason or '판정 정보 없음'}")

    def _persist_phone_options(self) -> None:
        from tkinter import messagebox
        rules = self.monitor.config.setdefault("phone_verification_rules", {})
        previous_rules = dict(rules)
        rules["enabled"] = True
        rules["require_verified"] = bool(self.require_verified_var.get())
        rules["require_number_match"] = bool(self.require_match_var.get())
        try:
            temporary = self.config_path.with_suffix(self.config_path.suffix + ".tmp")
            temporary.write_text(
                json.dumps(self.monitor.config, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            temporary.replace(self.config_path)
        except OSError as exc:
            rules.clear()
            rules.update(previous_rules)
            self.require_verified_var.set(bool(rules.get("require_verified", True)))
            self.require_match_var.set(bool(rules.get("require_number_match", False)))
            messagebox.showerror("옵션 저장 실패", str(exc), parent=self.root)
            return
        self.monitor.phone_matcher = monitor_module.PhoneVerificationMatcher(rules)
        _success, message = self.monitor.reclassify_pending_requests()
        self.detail.configure(text=message)

    def _run_monitor_command(self, command: Callable[[], tuple[bool, str]]) -> None:
        if self.busy:
            return
        self.busy = True

        def work() -> None:
            try:
                success, message = command()
            except Exception as exc:
                success, message = False, str(exc)
            self.root.after(0, lambda: self._command_done(success, message))

        threading.Thread(target=work, daemon=True).start()

    def _command_done(self, success: bool, message: str) -> None:
        from tkinter import messagebox
        self.busy = False
        if not success:
            messagebox.showerror("작업 실패", message, parent=self.root)

    def _selected_action(self, action: str) -> None:
        from tkinter import messagebox
        selected = self.tree.selection()
        request = self.row_cache.get(selected[0]) if selected else None
        if not request:
            messagebox.showinfo("신청자 선택", "먼저 가입 신청자를 선택해주세요.", parent=self.root)
            return
        label = "승인" if action == "approve" else "거절"
        if not messagebox.askyesno(
            f"가입 {label}", f"{request.display_name}\n\n이 신청자를 {label}할까요?", parent=self.root
        ):
            return
        self._run_monitor_command(lambda: self.monitor.perform_action(request, action))

    def close(self) -> None:
        if self.closing:
            return
        self.closing = True
        self.live_pill.configure(text="● 종료 중", fg=self.MUTED)
        self.approve_button.configure(state="disabled")
        self.reject_button.configure(state="disabled")

        def stop() -> None:
            try:
                self.monitor.stop()
            finally:
                self.lock.close()
                self.root.after(0, self.root.destroy)

        threading.Thread(target=stop, daemon=True).start()


def main() -> int:
    args = parse_args()
    config_path = Path(args.config).expanduser().resolve()
    try:
        config = load_monitor_config(config_path)
    except Exception as exc:
        if args.check_config:
            print(f"CONFIG_ERROR: {exc}")
            return 2
        from tkinter import messagebox
        messagebox.showerror("설정 오류", str(exc))
        return 2
    if args.check_config:
        print("GUI_CONFIG_OK")
        return 0

    # pythonw has no console streams. Discard incidental engine output; logs remain in the log file.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    import tkinter as tk
    from tkinter import messagebox
    lock = SingleInstance()
    if not lock.acquire():
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo("이미 실행 중", "BAND 가입 승인 센터가 이미 실행 중입니다.", parent=root)
        root.destroy()
        return 0
    root = tk.Tk()
    monitor = SyncedBandJoinMonitor(config, config_path.parent)
    BandApprovalApp(root, monitor, lock, config_path)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
