# Render Starter용 BAND 가입 모니터

## 구성

하나의 Render Web Service 안에서 다음 두 프로세스를 실행한다.

- `slash-check-app.js`: 기존 웹서비스와 `/health`
- `band_join_monitor.py --daemon`: BAND 가입 신청 감시

`render_start.py`가 두 프로세스를 관리한다. 웹서비스가 종료되면 컨테이너가
종료되어 Render가 다시 시작하고, BAND 모니터만 종료되면 10초 후 다시 실행한다.

## 비용이 발생하지 않도록 주의

`render-band.example.yaml`을 새 Blueprint로 가져오면 새 Starter 서비스가 만들어져
서비스 요금이 하나 더 발생할 수 있다. 기존 월 $7 서비스를 재사용하려면 기존
서비스의 데이터부터 백업한 뒤 같은 서비스의 런타임을 Docker로 변경한다.

Render 공식 문서 기준으로 기존 서비스의 런타임은 Render API의 Update service
요청이나 기존 Blueprint의 `runtime` 변경으로 전환할 수 있다. 새 서비스를 만들거나
기존 서비스를 삭제하지 않는다.

전환 시 기존 서비스 ID, URL, 요금제 및 연결된 Persistent Disk 설정은 유지하고,
Docker 이미지 안에서 기존 웹앱과 BAND 모니터를 함께 실행한다.

실제 전환 전에는 `/var/data`의 기존 상태 파일을 반드시 백업한다.

## 필요한 Render 설정

Docker 서비스의 환경변수:

```text
BAND_MONITOR_ENABLED=true
BAND_CHROME_HEADLESS=true
BAND_START_URL=https://www.band.us/band/101992972/applications
NODE_OPTIONS=--max-old-space-size=160
```

Persistent Disk:

```text
Mount Path: /var/data
Size: 1 GB
```

첫 배포부터 `BAND_MONITOR_ENABLED=true`로 실행한다. BAND 세션이 아직 없다면
기존 웹서비스는 정상 실행되고 `/health`의 `bandMonitor.state`만
`LOGIN_REQUIRED`로 표시된다.

## BAND 로그인 세션

Windows Chrome 프로필 전체를 Linux Render로 복사하면 운영체제별 암호화 차이로
로그인 쿠키를 그대로 사용할 수 없다. 로그인된 BAND 요청의 `Cookie` 헤더 값을
Render의 Secret 환경변수 `BAND_COOKIE_HEADER`에 넣는 부트스트랩 방식을 사용한다.

주의:

- 쿠키는 비밀번호와 같은 로그인 자격정보다.
- Git, 설정 JSON, 채팅, 로그에 절대 저장하지 않는다.
- Render Dashboard의 Secret 환경변수로만 입력한다.
- 노출됐다고 의심되면 BAND에서 모든 기기 로그아웃 후 다시 로그인한다.

세션을 입력한 다음 재배포한다. 첫 실행에서
쿠키가 Chromium 프로필에 적용되고 이후 프로필은 `/var/data/band-chrome-profile`에
유지된다.

## 확인

배포 후 다음 주소를 확인한다.

```text
https://<서비스주소>.onrender.com/health
```

응답의 `bandMonitor` 값이 다음과 같으면 연결된 상태다.

```json
{
  "state": "CONNECTED",
  "connected": true,
  "headless": true
}
```

`DISCONNECTED` 또는 `FALLBACK`이면 Render Logs에서 `BAND monitor` 및
`Chrome` 관련 메시지를 확인한다.

## Starter 메모리 확인

Starter 512MB에서 다음 제한을 적용한다.

- Node 최대 힙 160MB
- Chromium 렌더러 1개
- Chromium V8 최대 힙 128MB
- 디스크 캐시 16MB
- 확장 기능, GPU, 동기화, 번역 기능 비활성화

Render Metrics에서 메모리가 한계에 계속 닿거나 `Out of memory`로 재시작되면
Starter 한 대에서 기존 웹앱과 Chromium을 함께 운영하기 어려운 상태다.
