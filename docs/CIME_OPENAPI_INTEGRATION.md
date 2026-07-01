# CIME OpenAPI 연동 문서

## 공식 문서 범위

- 공식 개발자 센터: https://developers.ci.me/
- 확인한 문서: `/docs/overview`, `/docs/getting-started`, `/docs/authentication`, `/docs/api-users`, `/docs/api-channels`, `/docs/api-lives`, `/docs/api-chats`, `/docs/api-categories`, `/docs/api-restrictions`, `/docs/events-sessions`, `/docs/events-chat`, `/docs/events-donation`, `/docs/events-subscription`, `/docs/updates`

## 기본 규칙

- Base URL: `https://ci.me/api/openapi`
- 성공 응답: `{ code, message, content }`
- 오류 응답: `{ statusCode, message, error }`
- 성공/실패는 body의 `code`가 아니라 HTTP status 기준으로 처리한다.
- Access Token 유효 시간은 1일, Refresh Token은 6개월이다.
- Refresh Token은 rotation 방식이므로 갱신 응답의 새 refresh token을 반드시 저장한다.

## OAuth

- 인증 페이지: `https://ci.me/auth/openapi/account-interlock`
- Query: `clientId`, `redirectUri`, `state`
- 토큰 발급: `POST /auth/v1/token`
- 토큰 취소: `POST /auth/v1/token/revoke`
- 내 정보: `GET /open/v1/users/me`

필수 환경 변수:

- `CIME_CLIENT_ID`
- `CIME_CLIENT_SECRET`
- `CIME_REDIRECT_URI`
- `CIME_OPENAPI_BASE`, 기본값 `https://ci.me/api/openapi`

## 주요 스코프

- `READ:USER`: 현재 사용자 정보
- `READ:CHANNEL`: 채널/팔로워/관리자
- `READ:SUBSCRIPTION`: 구독자/구독 이벤트
- `READ:DONATION`: 후원 이벤트
- `READ:LIVE_CHAT`: 채팅 이벤트
- `WRITE:LIVE_CHAT`: 채팅 메시지 전송
- `WRITE:LIVE_CHAT_NOTICE`: 채팅 공지
- `READ:LIVE_STREAM_SETTINGS`, `WRITE:LIVE_STREAM_SETTINGS`: 라이브 설정
- `READ:LIVE_STREAM_KEY`: 스트림 키
- `READ:USER_BLOCK`, `WRITE:USER_BLOCK`: 차단 조회/차단/해제

## 이벤트 세션

- 세션 생성: `GET /open/v1/sessions/auth`
- CIME 이벤트는 표준 WebSocket을 사용한다. Socket.IO와 호환되지 않는다.
- 연결 유지: 1분 간격으로 `{"type":"PING"}` 전송, 응답은 `{"action":"PONG"}`.
- 이벤트 구독:
  - `POST /open/v1/sessions/events/subscribe/chat?sessionKey=...`
  - `POST /open/v1/sessions/events/subscribe/donation?sessionKey=...`
  - `POST /open/v1/sessions/events/subscribe/subscription?sessionKey=...`
- 수신 형식: `{ "event": "CHAT" | "DONATION" | "SUBSCRIPTION", "data": { ... } }`

## AruBot 통합 방식

- 사용자는 `app_users` 기준으로 하나만 관리한다.
- 플랫폼별 계정은 `platform_accounts`에 `provider = chzzk | cime`으로 저장한다.
- 플랫폼별 OAuth 토큰은 `platform_tokens`에 저장한다.
- OAuth로 얻은 기본 프로필을 우선 저장하고, 공개/비공식 프로필 API는 프로필 이미지, 핸들, 설명, 팔로워 수 같은 부가 정보 보강에만 사용한다.
- 기존 CHZZK 가입자는 기존 `user:<chzzkChannelId>` 기반 데이터를 유지하고, CIME를 연결하면 같은 `app_users.id`에 연결한다.
- CIME 최초 가입자는 `user:cime:<cimeChannelId>` 형태의 세션 사용자로 시작한다.
- 채팅봇 설정, 룰, 포인트, 출석, 후원 규칙은 기존 `sid = user:<appUserId>` 파티션을 공유한다.

## 구현된 API

- `GET /api/auth/cime/login`
- `GET /api/auth/cime/callback`
- `GET /api/auth/cime/token`
- `POST /api/auth/cime/revoke`
- `GET /api/cime/me`
- `GET /api/cime/live/me`
- `POST /api/cime/chat/send`
- `GET /api/cime/events`
- `POST /api/cime/reset`
- `GET /api/account/platforms`
- `POST /api/account/platforms/refresh`
- `POST /api/auth/chzzk/revoke`

## 구현된 런타임 동작

- CIME OAuth 로그인 및 기존 로그인 세션에 CIME 계정 연결
- CIME token refresh 및 refresh token rotation 저장
- CIME 표준 WebSocket 이벤트 세션 생성
- CHAT, DONATION, SUBSCRIPTION 이벤트 구독 및 `/api/cime/events` 큐 제공
- CIME 채팅 전송
- CIME 채팅 기반 출석, 채팅 포인트 지급, 명령어 룰 자동 응답
- CIME 후원 기반 포인트 지급, 후원 룰 응답, 데스크톱 명령 브로드캐스트
- CIME 채팅 명령의 `${video_donation}` 처리: 기존 무료영도 큐, 포인트 차감, OBS 뷰어 브로드캐스트를 재사용
- CIME 채팅/후원 룰의 `${roulette::name}` 처리: 기존 룰렛 큐를 재사용하고 결과 채팅은 CIME 채팅으로 전송
- 프론트 커넥터에서 CHZZK/CIME 폴링 및 채팅 전송 경로 분기
- 연결된 플랫폼 목록에서 CHZZK/CIME 중 원하는 플랫폼을 수동 연결

## 운영 및 최적화 메모

- 프로필 보강 API는 로그인 콜백에서만 짧은 타임아웃으로 best-effort 호출한다. 실패해도 로그인과 토큰 저장은 계속 진행한다.
- CHZZK 보강 기본값은 `CHZZK_UNOFFICIAL_API_BASE=https://api.chzzk.naver.com`의 `GET /service/v1/channels/{channelId}`를 사용한다. `kimcore/chzzk`도 같은 base URL과 채널 조회 경로를 사용한다.
- CIME 보강은 `api들.md` 기준 현재 동작하는 앱 API인 `CIME_APP_API_BASE=https://ci.me/api/app`의 `GET /channels/id/{channelId}`와 `GET /channels/{slug}`를 사용한다.
- CIME 공개 엔드포인트가 변경되면 `CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE`을 `{channelId}` 또는 `{handle}` 포함 URL로 지정해 우선 시도할 수 있다.
- 보강 결과는 `platform_accounts.avatar_url`과 `platform_accounts.metadata.publicProfile`에 저장해 연결 화면과 대시보드에서 사용한다.
- 사용자는 연결 화면에서 프로필 동기화를 수동 실행할 수 있다. 이때 연결 정보는 유지하고 `metadata.publicProfile.status = ok | failed | skipped`로 보강 성공 여부만 분리해 저장한다.
- `POST /api/account/platforms/refresh`는 optional body `{ "provider": "chzzk" | "cime" }`를 받아 특정 플랫폼만 갱신할 수 있다. body가 없으면 연결된 모든 플랫폼을 순차 갱신한다.
- CIME WebSocket은 사용자별로 1개만 유지하고, 중복 생성은 `cimeSessionCreatePromises`로 억제한다.
- 이벤트 큐는 기존 `MAX_QUEUE` 제한을 공유하여 메모리 증가를 방지한다.
- 채팅 이벤트와 자동 응답은 `processedIds`, `sentReplies`로 중복 처리와 중복 응답을 막는다.
- 라이브 상태는 60초 캐시를 사용해 CIME live-status 호출 부하를 줄인다.
- 이벤트 폴링은 기존 프론트 백오프 로직을 그대로 사용한다.
- 룰렛 결과 채팅은 `sendChatByPost` 어댑터를 통해 CHZZK와 CIME를 분기한다.

## 남은 개선 후보

- CHZZK/CIME 자동화 핸들러의 중복을 더 줄여 룰 매칭, 포인트 차감, 특수 토큰 처리를 하나의 공통 함수로 통합한다.
- 플랫폼 우선순위 설정을 DB에 저장해 자동 연결 기본값을 사용자가 선택하게 한다.
- CIME 구독 이벤트에 대한 별도 룰 트리거와 포인트 정책을 추가한다.
- CIME live-status 응답 필드가 공식 문서 업데이트로 바뀌면 `isCimeLiveAllowed`의 status normalization을 문서 기준으로 좁힌다.
## 최근 보강 사항

- 공개 프로필 보강은 10분 캐시를 사용해 같은 화면에서 반복 새로고침해도 외부 API 호출을 줄인다.
- CIME 프로필 후보 URL은 중복 제거 후 호출한다. `CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE`가 기본 ID 조회 URL과 같아도 한 번만 요청한다.
- `POST /api/account/platforms/refresh`는 `provider` 값이 `chzzk` 또는 `cime`이 아니면 `400 Unsupported provider`로 응답한다.
- 연결 화면과 대시보드는 프로필 동기화 중 중복 클릭을 막고, 동기화 실패 상태를 기존 연결 유지와 분리해 표시한다.
- CHZZK/CIME 연결 해제는 해당 플랫폼의 토큰과 `platform_accounts` 레코드를 함께 정리한다. CHZZK 연결 화면은 전체 로그아웃 대신 `POST /api/auth/chzzk/revoke`를 사용한다.
