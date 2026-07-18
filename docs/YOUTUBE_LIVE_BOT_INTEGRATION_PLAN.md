# YouTube Live bot integration plan

작성일: 2026-07-03  
대상: AruBot CHZZK/CIME 통합 채팅봇  
범위: 유튜브 라이브 채팅을 기존 AruBot 명령어, 포인트, 출석, 룰렛, 예측 베팅, 영상 후원, 자동 응답 흐름에 통합하기 위한 feasibility 및 구현 기획

## 1. 결론

구현 가능하다. 현재 AruBot은 이미 CHZZK와 CIME를 하나의 내부 사용자 모델(`app_users`, `platform_accounts`, `platform_tokens`)에 묶고, 플랫폼별 채팅 송신을 `sendChatByPost`에서 분기하는 구조를 갖고 있다. 따라서 유튜브는 새 provider인 `youtube`를 추가하고, YouTube Live Chat API를 AruBot의 표준 채팅 이벤트로 정규화하는 방식이 가장 현실적이다.

다만 기존 `browser-extension/content-youtube.js`는 유튜브 영상 재생을 일시정지/재개하는 보조 기능일 뿐 라이브 채팅봇이 아니다. 유튜브 라이브 채팅봇은 브라우저 DOM 스크래핑이 아니라 Google OAuth + YouTube Data API 기반으로 구현해야 운영 안정성, 정책 준수, 계정 보호를 확보할 수 있다.

1차 목표는 "유튜브 라이브 채팅에서도 CHZZK/CIME와 같은 명령어 경험"이다.

- 유튜브 채팅 수신
- 봇 채팅 응답 전송
- 채팅 명령어 자동 응답
- 채팅당 포인트 지급
- 출석 체크
- 포인트 비용 명령어
- `${roulette::name}` 룰렛 실행 및 결과 채팅
- `${video_donation}` 영상 후원 접수
- 예측 베팅 명령어
- 데스크톱/로컬 프로그램 자동화 브로드캐스트

2차 목표는 유튜브 고유 기능이다.

- KRW Super Chat 기반 후원 규칙
- 멤버십 이벤트 기반 포인트/자동화
- 유튜브 moderator/owner 권한 세분화
- 특정 라이브 방송 수동 선택
- 다중 동시 방송/예약 방송 처리

## 2. 공식 API 기준

확인 기준일: 2026-07-03

참고 문서:

- YouTube Live Streaming API reference: https://developers.google.com/youtube/v3/live/docs
- `liveChatMessages.streamList`: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
- `liveChatMessages.list`: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list
- `liveChatMessages.insert`: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert
- `liveBroadcasts`: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts
- OAuth server-side web apps: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- Quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost

중요한 공식 기준:

- YouTube는 채팅 수신에 `liveChatMessages.streamList`를 권장한다. 서버 스트리밍 방식이라 새 메시지를 낮은 지연으로 받고, 계속 polling하는 것보다 quota 초과 위험을 줄인다.
- AruBot 운영 기본값은 `streamList` 전용으로 잡는다. `liveChatMessages.list` 기반 polling은 부하와 quota 소비가 커서 일반 fallback으로 사용하지 않는다.
- `liveChatMessages.list`는 장애 조사, 로컬 개발, 또는 운영자가 명시적으로 켠 비상 모드에서만 제한적으로 사용한다. 이 경우에도 응답의 `nextPageToken`과 `pollingIntervalMillis`를 반드시 지켜야 한다.
- 채팅 전송은 `POST /youtube/v3/liveChat/messages?part=snippet`이고, `snippet.liveChatId`, `snippet.type = textMessageEvent`, `snippet.textMessageDetails.messageText`가 필요하다.
- 활성 라이브의 채팅 ID는 `liveBroadcast` 리소스의 `snippet.liveChatId`에서 얻는다.
- Google OAuth web server flow는 `state` CSRF 방어, redirect URI 정확한 등록, client secret 보호, refresh token 보관이 필요하다.
- YouTube Data API는 quota 기반이다. 공식 quota 문서 기준 기본적으로 search/video upload 외 endpoint에 대해 일일 10,000 units가 제공되고, 모든 요청은 실패한 요청도 최소 1 quota point를 소비한다. Live Streaming API도 YouTube Data API의 일부라 quota를 소비한다.
- `youtube.force-ssl` 같은 scope는 민감한 scope로 취급될 수 있으므로 public production 배포 전 Google OAuth app verification이 일정 리스크다.

## 3. 현재 프로젝트 적합성

현재 구조상 유튜브 통합에 유리한 부분:

- `server/migrations/005_multi_platform_accounts.sql`에 provider 기반 계정/토큰 테이블이 이미 있다.
- `server/supabase.js`의 `upsertPlatformIdentity`, `upsertPlatformTokens`, `getPlatformTokens`, `listPlatformTokenUsers`, `deletePlatformAccount`는 provider 문자열만 추가하면 재사용 가능하다.
- `src/features/admin/connection-page.tsx`는 provider config 배열 구조라 `youtube` 카드를 추가하기 쉽다.
- `server/index.js`에는 CIME용 표준 WebSocket 이벤트 세션과 CHZZK용 채팅 이벤트 처리 경험이 이미 있다.
- `sendChatByPost`는 provider 분기 구조라 `youtube` 채팅 전송 어댑터를 추가할 수 있다.
- 룰렛 큐, 영상 후원 큐, 예측 베팅, 포인트/출석 저장소는 platform-agnostic하게 재사용 가능하다.

현재 구조상 손봐야 할 부분:

- CHZZK와 CIME의 채팅 자동화 처리 로직이 완전히 공통화되어 있지 않다. 세 번째 provider를 붙이면 중복이 더 커지므로 `processPlatformChatAutomation()` 공통 함수로 일부 추출하는 편이 낫다.
- `POST /api/account/platforms/refresh`는 현재 `chzzk | cime`만 허용한다. `youtube` 허용과 프로필 보강 분기가 필요하다.
- `CommandVariableHelpButton`의 provider badge가 CHZZK/CIME만 고려한다.
- 라이브 상태 캐시는 CHZZK/CIME 각각의 전용 함수가 섞여 있으므로 `refreshYoutubeLiveStatus()`를 추가하고, 장기적으로 `refreshPlatformLiveStatus(provider, ownerUserId)` 형태로 정리하는 게 좋다.
- `YOUTUBE_API_KEY`는 공개 영상 검색, 채널·라이브 메타데이터, 대기 플레이리스트 추천에 사용한다. 영상 후원 URL의 제목과 길이는 Data API 할당량 없이 확인한다.

## 4. 권장 구현 방식

### 4.1 기본 원칙

유튜브 라이브 통합은 서버 API 방식으로 구현한다.

브라우저 확장 프로그램으로 유튜브 채팅 DOM을 읽는 방식은 1차 구현에서 제외한다. DOM 구조 변경, 로그인 상태 의존, 정책 리스크, 유튜브 Studio/시청 페이지 차이, 중복 메시지 처리 문제가 크다. 확장 프로그램은 기존처럼 영상 플레이어 보조 기능에 남긴다.

### 4.2 OAuth

추가 환경 변수:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `YOUTUBE_AUTH_SCOPE`
- `YOUTUBE_API_BASE=https://www.googleapis.com/youtube/v3`

권장 scope:

- 1차 최소: `https://www.googleapis.com/auth/youtube.force-ssl`
- 읽기 전용 프로필만 분리할 경우: `https://www.googleapis.com/auth/youtube.readonly`

현실적으로 봇이 채팅을 보내려면 쓰기 권한이 필요하므로, 1차는 `youtube.force-ssl` 단일 scope로 단순화한다. 다만 consent screen 문구와 Google verification 대응 문서를 반드시 준비한다.

추가 API:

- `GET /api/auth/youtube/login`
- `GET /api/auth/youtube/callback`
- `GET /api/auth/youtube/token`
- `POST /api/auth/youtube/revoke`
- `GET /api/youtube/me`
- `GET /api/youtube/live/me`
- `POST /api/youtube/chat/send`
- `GET /api/youtube/events`
- `POST /api/youtube/reset`

콜백 처리:

1. `state` 검증
2. authorization code를 Google token endpoint로 교환
3. `channels.list?part=snippet&mine=true`로 채널 ID/채널명/프로필 이미지 확보
4. `upsertPlatformIdentity('youtube', profile, preferredUserId)` 저장
5. `upsertPlatformTokens('youtube', ownerUserId, channelId, tokens)` 저장
6. `ensureYoutubeSession(ownerUserId)` 시작
7. `/connection?auth=success&platform=youtube`로 redirect

토큰 갱신:

- `expiresAt` 만료 60초 전이면 refresh token으로 갱신한다.
- Google refresh token은 매번 새로 내려오지 않을 수 있으므로, 새 refresh token이 있을 때만 교체한다.
- `invalid_grant` 발생 시 token/account 상태를 `reauth_required`로 표시하고 연결 화면에 재인증 CTA를 보여준다.

### 4.3 라이브 및 채팅 ID 탐색

권장 순서:

1. `liveBroadcasts.list?part=snippet,status,contentDetails&mine=true&broadcastStatus=active`
2. `status.lifeCycleStatus === 'live'`이거나 active 목록에 포함된 방송 선택
3. `snippet.liveChatId` 저장
4. liveChatId가 없으면 "라이브 채팅 비활성화" 상태로 처리

확장 옵션:

- active 방송이 없고 `onlyWhenLive=false`인 경우에도 채팅 처리는 불가능하므로 `connected=false, live=false`로 응답한다.
- active 방송이 여러 개인 경우 기본은 가장 최근 `actualStartTime` 또는 `scheduledStartTime` 기준 하나를 선택하고, 2차에서 수동 선택 UI를 제공한다.
- 방송이 종료되면 `offlineAt`, `liveChatEnded`, `liveChatDisabled`, `liveBroadcasts.list` 결과 변화를 기준으로 세션을 종료한다.

### 4.4 채팅 수신

1차 및 운영 기본: `liveChatMessages.streamList`

- ownerUserId별 `youtubeSessionStore`를 둔다.
- entry 필드:
  - `ownerUserId`
  - `primarySid`
  - `channelId`
  - `liveChatId`
  - `connected`
  - `queue`
  - `nextPageToken`
  - `abortController`
  - `processedIds`
  - `sentReplies`
  - `reconnectTimer`
  - `lastMessageAt`
  - `lastError`

비상/진단 전용: `liveChatMessages.list`

- stream 연결이 실패해도 자동으로 polling으로 전환하지 않는다. 기본 동작은 reconnect backoff 후 `streamList` 재연결이다.
- polling은 운영자가 진단/비상 모드를 명시적으로 켠 경우에만 시작한다.
- 첫 요청은 과거 채팅 일부가 들어올 수 있으므로, 세션 시작 시점 이전 메시지는 기본적으로 처리하지 않는다.
- 이후 요청은 `nextPageToken`을 사용하고, 응답의 `pollingIntervalMillis`보다 빠르게 호출하지 않는다.
- 비상 polling은 최대 지속 시간, 최대 요청 횟수, 채널별 동시 실행 1개 제한을 둔다.

정규화 이벤트:

```js
{
  type: 'chat',
  provider: 'youtube',
  id: item.id,
  ts: Date.parse(item.snippet.publishedAt) || Date.now(),
  user: item.authorDetails.displayName || 'Unknown',
  userId: item.authorDetails.channelId || item.snippet.authorChannelId || '',
  message: item.snippet.textMessageDetails?.messageText || item.snippet.displayMessage || '',
  role: {
    owner: item.authorDetails.isChatOwner === true,
    moderator: item.authorDetails.isChatModerator === true,
    sponsor: item.authorDetails.isChatSponsor === true,
    verified: item.authorDetails.isVerified === true
  },
  raw: item
}
```

처리 대상:

- `textMessageEvent`: 1차 명령어 처리 대상
- `superChatEvent`: 2차 후원 이벤트 처리 대상. 단, 기존 후원 이벤트와 동일하게 작동하는 대상은 `currency === 'KRW'`인 Super Chat만이다.
- `superStickerEvent`: 1차/2차 기존 후원 이벤트 호환 처리에서 제외한다. 별도 정책을 정하기 전까지 큐 기록 또는 진단 표시만 한다.
- `memberMilestoneChatEvent`, `newSponsorEvent`, `membershipGiftingEvent`, `giftMembershipReceivedEvent`: 2차 멤버십 이벤트 처리 대상
- `messageDeletedEvent`, `userBannedEvent`, `pollEvent`: 1차에서는 큐에만 저장하거나 무시

### 4.5 채팅 송신

`sendChatByPost`에 provider 분기 추가:

```js
function makeYoutubeChatPost(ownerUserId, liveChatId, resolvedUsername, extra = {}) {
  return { provider: 'youtube', ownerUserId, liveChatId, resolvedUsername, ...extra };
}
```

`sendYoutubeChat(ownerUserId, liveChatId, message)`:

- access token 갱신
- liveChatId가 없으면 현재 active live에서 다시 resolve
- `POST https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet`
- body:

```json
{
  "snippet": {
    "liveChatId": "...",
    "type": "textMessageEvent",
    "textMessageDetails": {
      "messageText": "..."
    }
  }
}
```

주의:

- CHZZK/CIME는 현재 100자 제한을 적용하지만 유튜브는 동일 제한이 아니다. 플랫폼별 `maxChatLength`를 adapter에 둔다.
- 응답 flood를 막기 위해 provider별 send queue와 최소 간격을 둔다.
- 자신의 봇 메시지가 다시 들어올 수 있으므로, 봇 채널 ID를 저장하고 self-message는 출석/포인트/명령어 처리에서 제외한다.

### 4.6 공통 채팅 자동화 엔진

유튜브를 기존 코드에 단순 복사하면 빠르게 붙일 수는 있지만 유지보수가 나빠진다. 권장 구조는 공통 처리 함수를 추가하는 것이다.

제안 함수:

```js
async function processPlatformChatAutomation({
  sid,
  provider,
  channelUid,
  ownerUserId,
  ev,
  chatPost,
  sendChat,
  isLiveAllowed,
  getRoleLevel
}) {}
```

공통 처리에 포함할 것:

- `botEnabled` gate
- `onlyWhenLive` gate
- 출석 체크
- 채팅당 포인트 지급
- 제외 유저 처리
- 예측 베팅 명령어
- 룰 매칭
- roleLevel 권한 체크
- 쿨다운
- 포인트 비용 차감
- placeholder 치환
- `${video_donation}` 처리
- `${roulette::name}` 처리
- 데스크톱/Warudo 이벤트 브로드캐스트
- 중복 응답 방지
- `lastUsed` 업데이트

플랫폼 adapter가 제공할 것:

- `provider`
- `channelUid`
- `chatPost`
- `sendChat(text)`
- `roleLevel`
- `isOwner`
- `isBotSelf`
- `maxChatLength`
- `sourceName`, 예: `youtube-chat`

이렇게 만들면 CHZZK/CIME도 점진적으로 같은 엔진으로 옮길 수 있다.

### 4.7 KRW Super Chat 후원 호환

YouTube Super Chat은 통화가 다양하므로 기존 후원 이벤트와 1:1로 합치면 환율, 세금, 표시 금액, 정산 기준이 섞인다. AruBot에서는 `currency === 'KRW'`인 Super Chat만 기존 후원 이벤트와 동일하게 처리한다.

정규화 조건:

- `item.snippet.type === 'superChatEvent'`
- `item.snippet.superChatDetails.currency === 'KRW'`
- `amountMicros`가 유효한 양수

정규화 이벤트:

```js
{
  type: 'donation',
  provider: 'youtube',
  donationType: 'youtube_super_chat',
  id: item.id,
  ts: Date.parse(item.snippet.publishedAt) || Date.now(),
  user: item.authorDetails.displayName || 'Unknown',
  userId: item.authorDetails.channelId || item.snippet.authorChannelId || '',
  amount: Math.floor(Number(item.snippet.superChatDetails.amountMicros || 0) / 1000000),
  currency: 'KRW',
  amountDisplayString: item.snippet.superChatDetails.amountDisplayString || '',
  message: item.snippet.superChatDetails.userComment || '',
  raw: item
}
```

기존 후원 이벤트와 동일하게 실행할 동작:

- 후원 금액 기반 포인트 지급
- `settings.donationRules` 매칭
- 후원 룰 응답 채팅 전송
- 후원 룰의 데스크톱/로컬 프로그램 command broadcast
- 후원 룰의 `${roulette::name}` 실행
- 후원 로그/진단 이벤트 기록

처리하지 않는 경우:

- `currency !== 'KRW'`: 후원 룰, 포인트 지급, 룰렛 트리거를 실행하지 않는다. 진단/이벤트 큐에는 `ignoredReason: 'non_krw_super_chat'`로 기록한다.
- `superStickerEvent`: 기존 후원 이벤트와 동일 처리하지 않는다. 별도 정책을 정하기 전까지 `ignoredReason: 'super_sticker_not_supported'`로 기록한다.
- `amountMicros`가 없거나 0 이하인 경우: `ignoredReason: 'invalid_super_chat_amount'`로 기록한다.

운영 UI에는 "YouTube Super Chat은 KRW만 후원 규칙에 반영"이라는 설명을 둔다. non-KRW Super Chat을 나중에 지원하려면 환율 기준, 반올림, 최소 금액, 정산 시점 정책을 별도 설정으로 추가한 뒤 확장한다.

## 5. 사용자 경험

### 5.1 연결 화면

`/connection`에 YouTube 카드 추가:

- 라벨: `YouTube`
- 설명: `YouTube Live 시청자도 같은 명령어, 포인트, 룰렛 흐름으로 참여하게 합니다.`
- 상태 badge:
  - `미연결`
  - `연결됨`
  - `재인증 필요`
  - `라이브 없음`
  - `채팅 비활성화`
- 버튼:
  - `YouTube로 로그인`
  - `추가 연결`
  - `최신 정보 보기`
  - `연결 해제`
  - `채팅 다시 연결`

### 5.2 대시보드/진단

추가 표시:

- YouTube connected 여부
- 현재 active live title
- liveChatId 확보 여부
- streamList 연결 상태
- 비상 polling 사용 여부
- lastMessageAt
- lastError
- quota/rate-limit 관련 오류
- reauth_required 여부

### 5.3 운영 설정

기본 설정은 기존 bot settings를 공유한다.

- `botEnabled`
- `onlyWhenLive`
- `channelPointsPerChat`
- `channelPointsPerAttendance`
- `attendanceMessage`
- `attendanceAnnounce`
- `attendanceExcludeUserIds`
- 명령어 룰
- 포인트 비용
- 룰렛/영상 후원/예측 베팅 설정

추가 유튜브 전용 설정 후보:

- `youtube.enabled`
- `youtube.receiveMode = stream`
- `youtube.emergencyPollingEnabled = false`
- `youtube.ignoreSelfMessages = true`
- `youtube.ignoreModeratorCommands = false`
- `youtube.replyMinIntervalMs`
- `youtube.maxReplyLength`
- `youtube.liveSelectionMode = auto | manual`
- `youtube.selectedBroadcastId`

## 6. DB 및 마이그레이션

기존 `platform_accounts`, `platform_tokens`는 provider 확장만으로 충분하다.

권장 추가 migration:

```sql
create table if not exists public.platform_runtime_state (
  provider text not null,
  user_id text not null references public.app_users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (provider, user_id, key)
);
```

용도:

- `youtube.live`: 현재 broadcastId, liveChatId, title, startedAt
- `youtube.chat_cursor`: last nextPageToken, lastMessageAt
- `youtube.connection`: mode, lastError, reauthRequired

이 테이블은 필수는 아니지만 서버 재시작 후 liveChatId와 cursor 복구가 쉬워진다. 1차 구현을 빠르게 하려면 메모리 캐시로 시작하고, 안정화 단계에서 추가해도 된다.

## 7. 구현 단계

### Phase 0. 사전 준비

- Google Cloud project 생성 또는 기존 프로젝트 사용
- YouTube Data API v3 enable
- OAuth consent screen 구성
- Web application OAuth client 생성
- redirect URI 등록
- production 도메인 확정
- verification 필요 scope 확인

산출물:

- `.env.example`에 YouTube OAuth 변수 추가
- 운영자용 Google Cloud 설정 체크리스트

### Phase 1. OAuth 및 계정 연결

- `createOAuthState('youtube')` 사용
- `/api/auth/youtube/login`
- `/api/auth/youtube/callback`
- token exchange/refresh/revoke
- `channels.list?mine=true` 프로필 조회
- `upsertPlatformIdentity('youtube', ...)`
- `/connection` YouTube 카드 추가
- `/api/account/platforms/refresh`에서 `youtube` 허용

검증:

- 로그인 성공 후 `platform_accounts.provider = youtube` 저장
- token 암호화 저장
- refresh 동작
- 연결 해제 시 token/account 삭제

### Phase 2. 라이브 감지 및 이벤트 큐

- `refreshYoutubeLiveStatus(ownerUserId, sid)`
- active broadcast 조회
- liveChatId 저장
- `youtubeSessionStore`
- `ensureYoutubeSession(ownerUserId)`
- `GET /api/youtube/events`
- `POST /api/youtube/reset`

검증:

- 라이브 없음 응답
- 라이브 있음 + 채팅 비활성화 응답
- active live title/channelId/liveChatId 확인
- 서버 재시작 후 bootstrap

### Phase 3. 채팅 수신

- `streamList` 기반 수신 구현
- streaming 실패 시 reconnect backoff 후 `streamList` 재연결
- 자동 polling fallback 금지
- 운영자 명시 설정이 있을 때만 비상 polling 진단 endpoint 제공
- `processedIds` 중복 제거
- YouTube message 정규화
- `/api/youtube/events`에서 큐 반환

검증:

- 새 채팅이 queue에 들어온다.
- 동일 메시지 중복 처리 없음
- 종료된 라이브에서 세션 정리
- rateLimitExceeded/backoff 처리

### Phase 4. 채팅 송신

- `makeYoutubeChatPost`
- `sendYoutubeChat`
- `sendChatByPost` provider 분기
- self-message 제외
- send queue/rate-limit

검증:

- 수동 API로 채팅 전송
- 룰렛 결과 채팅 전송
- 오류 시 사용자에게 재연결/재인증 상태 표시

### Phase 5. 동일 기능 통합

- 공통 `processPlatformChatAutomation` 추출 또는 YouTube 전용 얇은 wrapper 작성
- 출석/채팅 포인트 지급
- 명령어 룰
- 예측 베팅
- 영상 후원 접수
- 룰렛 실행
- desktop/local automation broadcast

검증:

- `!출석` 또는 일반 채팅 출석
- `!포인트`류 명령어
- 포인트 비용 명령어
- `${video_donation}` 명령어
- `${roulette::name}` 명령어
- `!투표 번호 포인트`

### Phase 6. KRW Super Chat 및 멤버십

1차 출시 후 진행한다.

- `superChatEvent` 중 `currency === 'KRW'`만 기존 후원 이벤트로 정규화
- KRW Super Chat을 CIME/CHZZK 후원 이벤트와 같은 `processDonationAutomation` 흐름에 연결
- non-KRW Super Chat은 후원 룰/포인트/룰렛 실행 없이 진단 기록만 남김
- `superStickerEvent`는 기존 후원 이벤트 호환 처리에서 제외
- 멤버십 이벤트 정규화
- 기존 donation rule 재사용
- non-KRW 통화/금액 환산 정책은 추후 별도 기능으로 보류

## 8. 테스트 전략

단위 테스트:

- YouTube OAuth callback state 검증
- token refresh 응답에서 refresh token 유지/교체
- liveBroadcasts 응답 정규화
- liveChatMessages 응답 정규화
- roleLevel 산정
- self-message 제외
- `sendChatByPost` provider 분기
- quota/rate-limit 오류 backoff
- KRW Super Chat만 donation event로 정규화
- non-KRW Super Chat과 Super Sticker는 donation rule 미실행

통합 테스트:

- 가짜 YouTube API server로 active live -> chat stream -> command 처리
- 비상 polling 진단 모드 사용 시 `pollingIntervalMillis` 준수
- 룰렛 queue에 YouTube chatPost 전달
- 영상 후원 queue 생성
- 예측 베팅 포인트 차감/환불
- KRW Super Chat이 기존 후원 룰, 포인트 지급, 룰렛 트리거를 실행
- USD/JPY 등 non-KRW Super Chat은 후원 룰, 포인트 지급, 룰렛 트리거를 실행하지 않음
- 연결 해제 후 `/api/youtube/events` 401/404 처리

회귀 테스트 후보:

- `tests/youtube-oauth-regression.test.js`
- `tests/youtube-live-chat-autoconnect-regression.test.js`
- `tests/youtube-chat-normalization.test.js`
- `tests/platform-chat-automation-shared.test.js`
- `tests/youtube-send-chat-regression.test.js`

수동 E2E:

1. 테스트 YouTube 채널에서 제한 공개 라이브 시작
2. `/connection`에서 YouTube 연결
3. 라이브 채팅에 `!명령어` 입력
4. AruBot 응답 확인
5. 포인트 지급 확인
6. 룰렛 OBS 뷰어와 결과 채팅 확인
7. 영상 후원 큐 확인
8. 방송 종료 후 세션 종료 확인

## 9. 운영 리스크

### Google OAuth verification

가장 큰 일정 리스크다. `youtube.force-ssl` scope를 production 사용자에게 노출하려면 앱 검증이 필요할 수 있다. 내부 테스트 계정만 쓰는 동안은 test user 등록으로 진행 가능하지만, 공개 서비스로 제공하려면 검증 문구, 개인정보처리방침, 서비스 도메인 소유 확인, YouTube API Services 정책 준수가 필요하다.

대응:

- MVP는 제한된 test users로 검증
- production 전 OAuth verification 신청
- consent screen에 채팅 읽기/전송 목적을 명확히 표기
- token 삭제/연결 해제 기능 제공

### Quota

채팅 수신/송신은 라이브 중 지속적으로 API를 사용한다. 운영 기본값은 streamList 전용이며, 자동 polling fallback은 두지 않는다. 불필요한 profile/live 조회 캐시와 stream reconnect backoff가 필요하다.

대응:

- active live 조회는 30-60초 캐시
- chat stream reconnect backoff
- 비상 polling 진단 모드는 기본 비활성화
- 비상 polling을 켠 경우에만 `pollingIntervalMillis`, 최대 지속 시간, 최대 요청 횟수 준수
- 오류 요청 반복 금지
- dashboard에 quota/rate-limit 오류 표시

### 채팅 flood

명령어가 많이 들어오면 봇 응답도 많이 나가고, 유튜브가 메시지 전송을 제한할 수 있다.

대응:

- provider별 send queue
- 동일 rule 중복 응답 dedupe
- 명령어 cooldown 준수
- 글로벌 reply rate limit
- 긴 메시지 자동 축약

### 방송 선택

예약/테스트/비공개/동시 live 상태에서 자동 선택이 틀릴 수 있다.

대응:

- 1차는 active live 자동 선택
- 2차에서 수동 broadcast 선택 UI
- 선택된 broadcast가 종료되면 자동 active 탐색으로 fallback

### 플랫폼별 권한 차이

CHZZK/CIME의 role code와 YouTube의 owner/moderator/sponsor는 다르다.

대응:

- 내부 roleLevel 매핑:
  - owner: 4
  - moderator: 3
  - sponsor/member: 2
  - viewer: 1
- 명령어 권한 UI는 "스트리머/매니저/멤버/일반"처럼 플랫폼 중립 표현으로 개선

## 10. 출시 범위 제안

MVP 출시 조건:

- YouTube OAuth 연결/해제
- active live 자동 감지
- liveChatId 확보
- 채팅 수신
- 봇 채팅 응답
- 기존 명령어/포인트/출석/룰렛/영상 후원/예측 베팅 동작
- 연결 화면 및 진단 상태
- 기본 테스트와 fake API 통합 테스트

MVP에서 제외:

- non-KRW Super Chat 후원 규칙
- Super Sticker 후원 규칙
- 멤버십 이벤트
- 유튜브 채팅 삭제/차단/모더레이터 관리
- 다중 live 수동 선택 UI
- quota 사용량 그래프
- 브라우저 확장 DOM 기반 채팅 수집

현실적인 작업량:

- OAuth/연결 UI: 1-2일
- 라이브 탐색/채팅 수신 세션: 2-3일
- 채팅 송신/공통 자동화 연결: 2-4일
- 테스트/진단/운영 hardening: 2-3일
- Google Cloud/OAuth verification 준비: 개발과 별도, 심사 일정은 외부 변수

개발만 보면 약 1-2주 범위가 현실적이다. 공개 production 출시는 Google OAuth verification과 실제 라이브 테스트 결과에 따라 더 길어질 수 있다.

## 11. 권장 최종 아키텍처

```text
YouTube OAuth
  -> platform_accounts/provider=youtube
  -> platform_tokens/provider=youtube
  -> youtubeSessionStore(ownerUserId)
      -> liveBroadcasts.list
      -> liveChatMessages.streamList
      -> normalized chat event
      -> processPlatformChatAutomation
          -> attendance
          -> points
          -> command rules
          -> prediction betting
          -> video donation queue
          -> roulette queue
          -> local automation broadcast
      -> sendChatByPost(provider=youtube)
          -> liveChatMessages.insert
```

## 12. 구현 우선순위

1. YouTube OAuth 연결이 성공하고 platform table에 저장된다.
2. active live와 liveChatId를 안정적으로 찾는다.
3. streamList로 채팅을 queue에 넣는다.
4. `sendChatByPost`가 YouTube 응답을 보낸다.
5. 기존 CIME 채팅 자동화 흐름을 공통 함수로 추출하거나 YouTube wrapper에서 재사용한다.
6. 룰렛/영상 후원/예측 베팅까지 동일하게 연결한다.
7. 진단 UI와 테스트를 추가한다.
8. KRW Super Chat/멤버십을 2차로 붙인다.

## 13. 최종 판단

기술적으로 가능하고, 현재 프로젝트 구조와도 잘 맞는다. 가장 현실적인 방법은 "유튜브를 세 번째 플랫폼 provider로 추가하고, YouTube Live Chat API 이벤트를 AruBot 표준 채팅 이벤트로 정규화하는 방식"이다.

핵심 리스크는 코드 난이도보다 Google OAuth 검증, quota/rate-limit, 실제 라이브 세션 안정성이다. 따라서 구현은 API 공식 방식으로 진행하고, streamList 전용 운영, reconnect backoff, 공통 채팅 자동화 엔진, 진단 UI를 함께 넣어야 운영 가능한 수준이 된다.
