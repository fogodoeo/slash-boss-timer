# 크레와트 설문 BAND OAuth 설정

설문은 `cdcup.onrender.com` 정적 사이트에서 열리고, OAuth 비밀키 처리는
`creo.onrender.com` Node 서버가 담당한다. BAND 액세스 토큰은 브라우저나
Supabase에 저장하지 않고 프로필 확인 직후 폐기한다.

## 1. BAND Developers 서비스 등록

1. [BAND Developers](https://developers.band.us/)에서 서비스를 등록하거나 기존 서비스를 선택한다.
2. 서비스 웹 주소는 `https://cdcup.onrender.com`으로 지정한다.
3. Redirect URI 도메인은 `https://creo.onrender.com`으로 지정한다.
4. 실제 콜백 주소는 `https://creo.onrender.com/api/band-oauth/callback`이다.
5. 발급된 Client ID와 Client Secret을 복사한다.

신규 서비스는 BAND 심사를 거친 뒤 Client ID/Secret이 발급될 수 있다.

## 2. Render 환경변수

`creo` 웹 서비스의 Environment에 아래 값을 Secret으로 추가한다.

```text
BAND_OAUTH_CLIENT_ID=<BAND에서 발급한 Client ID>
BAND_OAUTH_CLIENT_SECRET=<BAND에서 발급한 Client Secret>
BAND_OAUTH_SESSION_SECRET=<32자 이상의 무작위 비밀값>
BAND_OAUTH_PUBLIC_URL=https://creo.onrender.com
BAND_OAUTH_REDIRECT_URI=https://creo.onrender.com/api/band-oauth/callback
BAND_OAUTH_RETURN_URL=https://cdcup.onrender.com/crewart-survey.html
BAND_OAUTH_TARGET_BAND_NO=101005857
BAND_OAUTH_TARGET_BAND_URL=https://www.band.us/band/101005857/post
```

세션 비밀값은 로컬에서 다음 명령으로 만들 수 있다.

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`BAND_OAUTH_TARGET_BAND_KEY`는 선택 항목이다. BAND Open API가 반환하는
문자열형 `band_key`를 넣으면 로그인한 계정이 이미 해당 BAND 회원인지도
구분한다. 웹 주소의 숫자형 BAND 번호와는 다른 값이다.

## 3. 안전한 배포 순서

1. `slash-boss-timer`에 OAuth 백엔드만 먼저 배포한다.
2. Render 환경변수를 넣고 `/api/band-oauth/config`에서 `configured: true`를 확인한다.
3. 그 다음 `CDCUP` 설문 변경을 배포한다.
4. BAND 로그인, 설문 저장, BAND 가입 신청 링크를 순서대로 실제 확인한다.

OAuth가 설정되지 않은 상태에서 설문 변경을 먼저 배포하면 새 참여자가 설문을
시작할 수 없으므로 이 순서를 바꾸지 않는다.

## 가입 처리 범위

BAND 공식 OAuth/Open API에는 일반 BAND에 사용자를 자동 가입시키는 권한이
없다. 따라서 사용자는 결과 화면에서 `크레와트 BAND 가입 신청하기`를 한 번
눌러 BAND의 가입 화면으로 이동해야 한다. 가입 신청이 만들어진 뒤의 승인은
로컬 가입심사기가 즉시 처리한다.

현재 설문 대상은 BAND `101005857`이고 로컬 가입심사기 설정은 `101992972`다.
실서비스 전환 전 로컬 가입심사기의 대상 BAND를 명시적으로 확인해야 한다.
