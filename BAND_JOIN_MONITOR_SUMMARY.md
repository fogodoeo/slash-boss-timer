# BAND 가입 신청 자동 처리기 요약

## 목적

네이버 BAND `101992972`의 가입 신청을 24시간 감시하고, 신청자의 프로필명과 가입 질문 답변을 검사해 자동으로 수락하거나 거절하는 Windows용 Python 프로그램이다.

관리 페이지:

`https://www.band.us/band/101992972/applications`

## 현재 승인 기준

다음 조건을 모두 만족해야 자동 수락한다.

1. 프로필명에 한글 이름 2~5자가 포함되어야 한다.
2. 프로필명에 `010`으로 시작하는 11자리 휴대전화 번호가 포함되어야 한다.
3. 가입 질문 답변이 기숙사 코드 `R`, `G`, `B`, `Y` 중 하나여야 한다.

답변은 대소문자와 앞뒤 공백을 무시한다.

- 수락 예: `R`, `g`, ` B `
- 추가 확인 필요 예: 공란, `A`, `RG`, `R입니다`

조건을 하나라도 만족하지 못하면 즉시 거절하지 않고 `추가 질문하기`로
수정 방법을 한 번만 안내한다.

## 처리 방식

1. Chrome을 CDP 포트 `9333`으로 연결한다.
2. BAND의 `get_application_count` XHR을 약 0.5초마다 재실행해 신청 건수 증가를 확인한다.
3. 건수가 증가하면 BAND 웹페이지 내부 API 클라이언트로 신청자 목록을 직접 조회한다.
4. 신청자의 프로필명, 최초 `join_answer`, 추가 질문 답변을 검사한다.
5. 조건 충족 시 `accept_application` API를 직접 호출한다.
6. 조건 불충족 시 신청자 댓글 API로 수정 요청을 한 번만 전송하고 신청을 보류한다.
7. 질문을 보낸 신청자는 2초 간격으로 프로필과 답변 변경을 재검사한다.
8. 수정 후 조건을 충족하면 자동 승인한다.
9. 내부 API를 사용할 수 없으면 `/applications` 페이지 새로고침과 DOM 방식으로 복구한다.
10. 60초마다 누락 방지용 안전 새로고침을 수행한다.

정상적인 경우 전체 페이지를 새로고침하지 않고 처리한다. 목표 처리 시간은 신청 후 약 0.5~1.5초다.

## 주요 BAND 내부 API

- 신청 건수: `/v1/invitation/get_application_count`
- 신청자 목록: `/v2.0.1/get_application_of_band`
- 가입 수락: `/v2.0.0/accept_application`
- 가입 거절: `/v2.0.0/deny_application`
- 추가 질문: `/v2.3.0/create_applicant_comment`
- 추가 질문 내역: 신청자 댓글 조회 API

로그인 토큰이나 쿠키를 파일에 저장하지 않는다. 현재 로그인된 전용 Chrome 탭의 BAND 내부 API 클라이언트를 사용한다.

## 주요 파일

- `band_join_monitor.py`: 감시, 판정, 수락·거절 처리 전체 코드
- `band_join_monitor_config.json`: 현재 운영 설정
- `run_band_join_monitor.bat`: Windows 실행 파일
- `band_join_monitor.log`: 감지 및 자동 처리 기록
- `band_join_monitor_state.json`: 중복 처리 방지 상태
- `tests/test_band_join_monitor.py`: 단위 테스트
- `render_start.py`: Render에서 기존 Node 웹앱과 BAND 모니터를 함께 실행
- `Dockerfile`: Python, Node, Headless Chromium을 포함한 Render 이미지
- `RENDER_BAND_SETUP.md`: Render Starter 배포 및 로그인 세션 설정 안내

## 현재 중요 설정

```json
{
  "application_count_poll_seconds": 0.5,
  "applications_safety_refresh_seconds": 60,
  "auto_approve_enabled": true,
  "auto_reject_enabled": false,
  "dom_action_enabled": true,
  "approval_delay_seconds": 0.5,
  "action_rate_limit_seconds": 0,
  "answer_rules": {
    "required": true,
    "allowed_codes": ["R", "G", "B", "Y"],
    "case_insensitive": true
  },
  "follow_up_question": {
    "enabled": true,
    "recheck_seconds": 2,
    "prepare_retry_seconds": 10
  }
}
```

## 운영 주의사항

- 프로그램 전용 Chrome 창에서 BAND 로그인이 유지되어야 한다.
- 가입 신청자 관리 탭을 닫으면 감시가 중단될 수 있다.
- 동일 신청의 중복 수락·질문 전송은 상태 파일과 실행 중 잠금으로 방지한다.
- 추가 질문 API 결과가 불확실하게 끊긴 경우에도 중복 전송을 막기 위해 자동 재전송하지 않는다.
- 프로필명이나 답변 필드의 BAND DOM/API 구조가 변경되면 파서 수정이 필요하다.
- 자동 거절은 꺼져 있으므로 수정하지 않은 신청자는 대기 상태로 남는다.

## 현재 검증 상태

- Python 및 Render 연동 테스트 39개 통과
- 실제 신청자 자동 거절 API 처리 성공 확인
- BAND 내부 신청자 목록 API 호출 성공 확인
- 약 0.5초 간격의 신청 건수 확인 동작 확인
- 추가 질문 API 코드는 단위 테스트로 검증했으며 실제 신청자 전송은 아직 수행하지 않음

## Render Starter 지원

- Linux Headless Chromium을 사용한다.
- Chrome 프로필, 중복 방지 상태, 로그를 `/var/data`에 저장한다.
- Node 힙 160MB, Chromium V8 힙 128MB, 렌더러 1개로 제한한다.
- 기존 웹서비스 `/health` 응답에서 BAND 모니터 연결 상태를 확인할 수 있다.
- BAND 모니터가 종료되면 감독 프로세스가 10초 후 재시작한다.
- 실제 Docker 이미지는 로컬 Docker가 설치되지 않아 아직 빌드하지 못했다.
