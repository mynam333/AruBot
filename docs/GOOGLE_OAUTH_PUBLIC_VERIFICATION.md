# Google OAuth 공개용 검증 절차

작성일: 2026-07-03  
대상: AruBot YouTube Live 연동 공개 서비스 전환  
목표: 테스트 사용자 제한 없이 일반 스트리머가 YouTube 계정을 연결할 수 있도록 Google OAuth 앱 검증을 통과한다.

## 1. 결론

AruBot의 YouTube Live 연동은 Google 계정의 YouTube 권한을 OAuth로 위임받아 라이브 채팅을 수신하고, 연결된 채널 계정으로 채팅 응답을 전송한다. 따라서 내부 테스트용이 아니라 공개 서비스로 제공하려면 Google Cloud Console의 OAuth 앱 검증 절차를 준비해야 한다.

현재 AruBot 기준 공개 검증에 제출할 핵심 값은 다음과 같다.

| 항목 | 값 |
| --- | --- |
| 앱 이름 | AruBot |
| 프론트엔드 홈 | `https://arubot.yuaru.com` |
| 백엔드 API | `https://arubotapi.yuaru.com` |
| OAuth redirect URI | `https://arubotapi.yuaru.com/api/auth/youtube/callback` |
| OAuth client type | Web application |
| 사용 API | YouTube Data API v3 |
| 사용 scope | `https://www.googleapis.com/auth/youtube.force-ssl` |
| 채팅 수신 | `liveChatMessages.streamList` |
| 채팅 전송 | `liveChatMessages.insert` |
| Super Chat 처리 | `currency = KRW`인 Super Chat만 기존 후원 이벤트로 처리 |

공개 검증 완료 전에는 OAuth 앱을 Testing 상태로 두고 테스트 사용자만 추가해서 검증한다. 일반 사용자에게 공개하려면 OAuth 앱을 Production 대상으로 제출하고 검증 완료 상태를 받아야 한다.

## 2. 공식 기준

검증 준비는 다음 Google 공식 문서를 기준으로 한다.

- Sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- OAuth consent screen 설정: https://developers.google.com/workspace/guides/configure-oauth-consent
- YouTube Data API OAuth web server flow: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- OAuth App Verification Help Center: https://support.google.com/cloud/answer/13463073

공식 기준상 민감하거나 제한된 scope를 요청하는 앱은 공개 전 검증이 필요할 수 있다. 검증에는 공개 홈페이지, 개인정보처리방침, 정확한 OAuth 동의 화면, scope별 상세 사용 사유, 사용자가 권한을 부여하고 실제 기능이 동작하는 영어 데모 영상이 필요하다.

## 3. 제출 전 코드/환경 점검

운영 서버에 배포된 코드와 환경 변수가 먼저 맞아야 한다. Google 검증 전에 아래 항목을 모두 확인한다.

### 3.1 운영 환경 변수

운영 백엔드의 `.env` 또는 배포 환경 변수에 다음 값이 있어야 한다.

```env
APP_BASE_URL=https://arubot.yuaru.com
PUBLIC_API_BASE_URL=https://arubotapi.yuaru.com
APP_REDIRECT_AFTER_LOGIN=https://arubot.yuaru.com/connection

YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://arubotapi.yuaru.com/api/auth/youtube/callback
YOUTUBE_AUTH_SCOPE=https://www.googleapis.com/auth/youtube.force-ssl

OAUTH_STATE_SECRET=...
ARUBOT_SECRET_ENCRYPTION_KEY=...
```

주의할 점:

- `YOUTUBE_REDIRECT_URI`는 Google Cloud Console의 Authorized redirect URI와 한 글자도 다르면 안 된다.
- 공개 운영 도메인은 `http://`가 아니라 `https://`를 사용한다.
- `ARUBOT_SECRET_ENCRYPTION_KEY`는 운영 토큰 암호화 키다. 설정 후 변경하면 기존 OAuth 토큰 복호화가 실패할 수 있으므로 백업과 마이그레이션 계획 없이 바꾸지 않는다.
- `OAUTH_STATE_SECRET`은 OAuth state 검증용 고정 비밀값이다. 서버 재시작 때마다 바뀌면 진행 중인 OAuth 요청이 실패할 수 있다.

### 3.2 redirect URI 실측 확인

운영 서버 재시작 후 로그인 시작 API가 Google로 보내는 URL을 확인한다.

```powershell
curl.exe -s -D - -o NUL https://arubotapi.yuaru.com/api/auth/youtube/login
```

응답의 `Location` 헤더에서 다음을 확인한다.

- `client_id`가 Google Cloud Console의 Web application OAuth Client ID와 같다.
- `redirect_uri`를 URL decode 했을 때 `https://arubotapi.yuaru.com/api/auth/youtube/callback`이다.
- `scope`에 `https://www.googleapis.com/auth/youtube.force-ssl`가 포함된다.
- `access_type=offline`과 `prompt=consent`가 포함되어 refresh token 발급을 받을 수 있다.

`redirect_uri_mismatch`가 계속 발생하면 Google Cloud Console에 등록된 URI와 실제 `Location`의 `redirect_uri`를 복사해 문자 단위로 비교한다. 특히 `http`/`https`, trailing slash, 경로의 대소문자, 다른 OAuth client를 사용 중인지 확인한다.

### 3.3 API 동작 확인

검증 제출 전에 테스트 사용자 계정으로 다음을 확인한다.

- `/connection`에서 YouTube 연결 버튼이 열린다.
- Google OAuth 동의 후 `/api/auth/youtube/callback`에서 성공 처리된다.
- 연결 상태 API가 YouTube를 `connected`로 표시한다.
- YouTube Live 채팅 수신이 `streamList` 기반으로 동작한다.
- 채팅 명령어 응답이 연결된 YouTube 채널 계정으로 전송된다.
- KRW Super Chat만 기존 후원 이벤트로 생성된다.
- KRW가 아닌 Super Chat, Super Sticker, 알 수 없는 paid event는 후원 이벤트로 생성되지 않고 진단 로그에 남는다.
- `/connection`에서 연결 해제 또는 재연결 안내가 가능하다.

## 4. Google Cloud Console 설정

### 4.1 프로젝트/API

1. Google Cloud Console에서 AruBot 운영용 프로젝트를 연다.
2. API Library에서 YouTube Data API v3를 활성화한다.
3. 테스트/스테이징 프로젝트와 운영 프로젝트를 분리한다. 공개 검증은 운영 프로젝트로만 제출한다.

### 4.2 Google Auth Platform - Branding

Google Cloud Console의 Google Auth Platform에서 Branding을 설정한다.

| 항목 | 권장 값 |
| --- | --- |
| App name | AruBot |
| User support email | 실제 응답 가능한 지원 이메일 |
| App logo | AruBot 로고. 서비스 화면과 동일한 브랜드 사용 |
| Application home page | `https://arubot.yuaru.com` |
| Privacy policy | `https://arubot.yuaru.com/privacy` |
| Terms of service | `https://arubot.yuaru.com/terms` |
| Authorized domains | `yuaru.com` |
| Developer contact email | 검증 메일을 받을 운영자 이메일 |

홈페이지와 정책 페이지는 로그인하지 않아도 접근 가능해야 한다. 홈페이지에는 AruBot이 YouTube Live 채팅봇/방송 자동화 서비스라는 점이 명확해야 하고, 개인정보처리방침 링크가 보여야 한다.

### 4.3 Google Auth Platform - Audience

1. User type은 공개 서비스라면 External을 선택한다.
2. 검증 전에는 Publishing status를 Testing으로 두고 테스트 사용자만 추가한다.
3. 공개 검증 제출 시 Production 전환/검증 제출 절차를 진행한다.

### 4.4 Google Auth Platform - Data Access

Data Access에서 AruBot이 실제 요청하는 scope만 등록한다.

```text
https://www.googleapis.com/auth/youtube.force-ssl
```

다른 Google scope는 사용하지 않는 한 등록하지 않는다. 검증 사유는 아래 문구를 기반으로 제출한다.

```text
AruBot requests https://www.googleapis.com/auth/youtube.force-ssl so streamers can connect their own YouTube channel, receive YouTube Live Chat messages through liveChatMessages.streamList, send automated bot replies to the same live chat via liveChatMessages.insert, and process KRW Super Chat events according to the streamer's configured automation rules. AruBot stores OAuth tokens encrypted at rest and lets streamers disconnect or revoke YouTube access from the platform connection page.
```

추가 설명에 포함할 내용:

- AruBot은 스트리머가 직접 연결한 본인 YouTube 채널의 라이브 채팅에만 접근한다.
- 채팅 수신은 부하와 quota를 줄이기 위해 가능한 한 `liveChatMessages.streamList`를 사용한다.
- 채팅 전송은 명령어 응답, 자동 응답, 포인트/룰렛/예측 베팅 결과 안내에 사용한다.
- Super Chat은 `currency = KRW`인 경우에만 기존 후원 이벤트와 동일하게 처리한다.
- Google 사용자 데이터를 판매하거나 광고 타겟팅 목적으로 공유하지 않는다.
- OAuth token은 서버에서 암호화해 저장하고, 연결 해제 시 재사용하지 않는다.

### 4.5 OAuth Client

Credentials 또는 Clients 메뉴에서 Web application OAuth client를 만든다.

Authorized redirect URIs:

```text
https://arubotapi.yuaru.com/api/auth/youtube/callback
```

로컬 개발용 client를 별도로 쓸 경우 운영 client에 로컬 URI를 섞지 않는다. 운영 검증 대상 client는 공개 도메인만 포함하는 편이 심사 대응이 쉽다.

## 5. 개인정보처리방침 필수 반영 항목

검증 전에 `https://arubot.yuaru.com/privacy`를 공개해야 한다. 법률 문서 최종 검토는 별도로 받아야 하지만, 최소한 아래 항목은 명시되어야 한다.

### 5.1 수집하는 YouTube 관련 데이터

- YouTube 채널 ID, 채널명, 프로필 이미지 등 연결 계정 식별 정보
- YouTube OAuth access token 및 refresh token
- 현재 라이브 방송 ID, live chat ID 등 라이브 연결 상태
- 라이브 채팅 작성자 표시명, 작성자 채널 ID, 메시지 본문, 메시지 ID, 작성 시각
- KRW Super Chat 금액, 통화, 작성자 정보, 메시지 본문
- 명령어 처리, 포인트 지급, 룰렛, 예측 베팅, 자동 응답, 후원 처리에 필요한 운영 로그

### 5.2 사용 목적

- 스트리머가 연결한 YouTube Live 채팅 수신
- 스트리머가 설정한 명령어/자동 응답/매크로 실행
- 포인트, 출석, 룰렛, 예측 베팅, 영상 후원 등 방송 운영 기능 제공
- KRW Super Chat을 기존 후원 이벤트와 동일하게 처리
- 연결 상태 진단, 오류 대응, 악용 방지

### 5.3 저장/보호/공유

- OAuth token은 서버에서 암호화해 저장한다.
- 운영 로그는 서비스 제공, 장애 대응, 악용 방지 목적에 필요한 기간만 보관한다.
- Google 사용자 데이터는 판매하지 않는다.
- 법적 요구, 보안 대응, 사용자가 명시적으로 설정한 외부 연동 외에는 제3자에게 공유하지 않는다.
- 사용자는 AruBot의 YouTube 연결 해제 기능 또는 Google 계정 권한 관리 페이지에서 접근 권한을 철회할 수 있다.

### 5.4 삭제/철회

개인정보처리방침에는 다음 흐름을 명시한다.

- 사용자는 AruBot `/connection` 화면에서 YouTube 연결을 해제할 수 있다.
- 사용자는 Google 계정의 Third-party access 또는 보안 설정에서 AruBot 접근 권한을 철회할 수 있다.
- 연결 해제 후 AruBot은 저장된 OAuth token을 더 이상 사용하지 않는다.
- 계정 삭제 또는 데이터 삭제 요청 방법과 처리 기한을 제공한다.

## 6. 제출용 데모 영상

Google 검증 데모 영상은 영어로 녹화한다. YouTube Studio에 일부 공개(Unlisted)로 업로드하고 제출 폼에 링크를 넣는다.

### 6.1 녹화 전 준비

- 브라우저 언어를 English로 설정한다.
- 테스트 스트리머 Google 계정을 준비한다.
- 해당 계정의 YouTube 채널에서 제한 공개 또는 테스트 라이브를 준비한다.
- AruBot 운영 프론트엔드와 백엔드가 실제 공개 도메인에서 동작해야 한다.
- 브라우저 주소창이 보이도록 녹화한다.
- Google OAuth 동의 화면의 URL에 OAuth client ID가 보이도록 한다.
- 데모 중 사용할 채팅 명령어와 자동 응답 규칙을 미리 설정한다.

### 6.2 영상 시나리오

아래 순서 그대로 녹화하면 제출 자료로 재사용하기 쉽다.

1. Open `https://arubot.yuaru.com`.
2. Show that the homepage describes AruBot as a live chat bot/streaming automation service.
3. Open the privacy policy and terms links from the public page.
4. Sign in to AruBot and open the platform connection page.
5. Click the YouTube connect button.
6. Complete the Google OAuth flow in English.
7. On the consent screen, show the app name `AruBot`.
8. Show that the browser address bar includes the OAuth client ID.
9. Grant the YouTube permission.
10. Return to AruBot and show YouTube status as connected.
11. Start or open a test YouTube Live.
12. Send a live chat command from a viewer account.
13. Show AruBot receiving the live chat and sending an automated reply to the same YouTube Live chat.
14. Trigger a command that uses AruBot automation, such as points, roulette, prediction, or macro response.
15. Show the KRW Super Chat behavior if a test payment path is available. If not available, show the relevant configuration and diagnostic screen, and explain that AruBot processes only `currency = KRW` Super Chat events as donation events.
16. Show that the user can disconnect YouTube from AruBot.

### 6.3 영어 내레이션 예시

```text
AruBot is a live chat bot and streaming automation service for streamers.
The streamer connects their own YouTube channel through Google OAuth.
AruBot uses the YouTube permission to receive live chat messages, send bot replies to the same live chat, and process KRW Super Chat events according to the streamer's automation settings.
OAuth tokens are encrypted at rest, and the streamer can disconnect YouTube access from this connection page.
```

## 7. 제출 패키지

검증 제출 전에 아래 자료를 한 폴더 또는 내부 문서에 모은다.

| 자료 | 상태 |
| --- | --- |
| Google Cloud project ID | 준비 필요 |
| OAuth client ID | 준비 필요 |
| 앱 이름 `AruBot` | 준비 |
| 홈페이지 URL `https://arubot.yuaru.com` | 공개 확인 필요 |
| 개인정보처리방침 URL `https://arubot.yuaru.com/privacy` | 공개 필요 |
| 이용약관 URL `https://arubot.yuaru.com/terms` | 공개 필요 |
| Authorized domain `yuaru.com` | Search Console 소유권 확인 필요 |
| Redirect URI `https://arubotapi.yuaru.com/api/auth/youtube/callback` | Console 등록 필요 |
| YouTube Data API v3 enabled | 확인 필요 |
| Scope justification | 이 문서 4.4 사용 |
| Demo video URL | 녹화 후 일부 공개 링크 준비 |
| Reviewer test account | 필요 시 제공. 비밀번호는 문서/저장소에 커밋하지 않음 |
| Support/developer contact email | 실제 수신 가능해야 함 |

## 8. Google 제출 절차

1. Google Cloud Console에서 운영 프로젝트를 선택한다.
2. Google Auth Platform의 Branding, Audience, Data Access를 모두 채운다.
3. Authorized domain `yuaru.com` 소유권을 Google Search Console에서 확인한다.
4. OAuth client의 Authorized redirect URI를 운영 HTTPS URI로 등록한다.
5. Data Access에 `https://www.googleapis.com/auth/youtube.force-ssl`만 등록한다.
6. Verification Center 또는 OAuth consent screen의 Submit for verification 절차를 시작한다.
7. Scope justification에 이 문서의 영어 문구를 붙여 넣고, AruBot 기능과 연결해서 보충 설명한다.
8. 데모 영상 URL을 제출한다.
9. Google Trust & Safety에서 오는 추가 요청 메일을 지원 이메일과 개발자 연락처 이메일에서 모두 확인한다.
10. 보완 요청이 오면 같은 프로젝트에서 수정 후 재제출한다.

## 9. 자주 반려되는 항목

아래 항목은 제출 전 반드시 제거한다.

- 홈페이지가 로그인 뒤에만 보인다.
- 홈페이지에서 AruBot과 YouTube Live 채팅봇 기능의 관련성이 드러나지 않는다.
- 개인정보처리방침이 같은 도메인에 없거나, Google/YouTube 데이터의 수집/사용/저장/공유 방식을 설명하지 않는다.
- OAuth 동의 화면의 앱 이름, 로고, 도메인이 실제 서비스와 다르다.
- 데모 영상이 영어가 아니거나, 주소창/OAuth client ID/동의 화면 앱 이름을 보여주지 않는다.
- 데모 영상에서 요청 scope가 실제로 어떤 기능에 쓰이는지 보여주지 않는다.
- Console의 redirect URI와 운영 서버가 전송하는 redirect URI가 다르다.
- 운영 프로젝트에 사용하지 않는 OAuth client나 scope가 섞여 있다.
- 검증 메일을 받을 수 없는 지원 이메일 또는 개발자 연락처를 등록했다.
- 사용자 권한 철회/연결 해제 방법이 서비스 또는 개인정보처리방침에 없다.

## 10. 공개 전 완료 기준

아래 조건을 모두 만족하면 공개용 YouTube OAuth 운영 준비가 완료된 것으로 본다.

- Google Cloud Console에서 OAuth 앱 검증 상태가 승인 또는 공개 사용 가능 상태다.
- 테스트 사용자 목록에 없는 일반 Google 계정으로 YouTube 연결이 성공한다.
- YouTube 연결 후 AruBot 연결 화면이 `connected` 상태를 표시한다.
- 실제 또는 제한 공개 YouTube Live에서 채팅 수신과 봇 응답 전송이 동작한다.
- KRW Super Chat만 기존 후원 이벤트로 처리되는 것을 확인했다.
- 비원화 paid event는 후원 이벤트로 처리되지 않고 진단 로그에서 확인된다.
- YouTube 연결 해제 후 저장된 토큰이 더 이상 사용되지 않는다.
- 장애 대응 담당자가 Google 검증 메일, OAuth client, 운영 환경 변수, 배포 재시작 절차에 접근할 수 있다.
