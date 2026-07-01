# Backend 리팩토링 설계서

## 1. 현재 백엔드 구조

현재 백엔드는 `server/index.js` 단일 파일에 다음 책임이 모두 들어 있다.

- Express app/middleware/CORS/static files
- CHZZK OAuth, token refresh, user/channel 조회
- bot settings/rules/stats CRUD
- command execution, placeholder substitution, attendance, point cost
- macros scheduler, cache, timer, backoff
- video donation queue, YouTube lookup, PVD viewer sync
- roulette selection, queue, result persistence, viewer broadcast
- donation command rules
- API Key issue/revoke
- WARUDO/Electron desktop event queue and WebSocket
- channel token generation/validation/security monitoring
- memory/cache/resource cleanup
- Supabase/PostgreSQL migration and optimization helper

`server/supabase.js`도 repository와 schema bootstrap, direct pg query, migration helper가 함께 들어 있어 분리가 필요하다. `server/sqlite.js`는 legacy/fallback 구현으로 보이며 Supabase와 같은 API 일부를 제공한다.

## 2. 목표 구조

```text
server/
  app.ts                         # express composition only
  server.ts                      # listen, upgrade dispatch, shutdown
  config/env.ts                  # validated env
  http/
    middleware/
      session.ts
      auth.ts
      channelAccess.ts
      apiKey.ts
      errors.ts
    routes/
      authRoutes.ts
      chzzkRoutes.ts
      botRoutes.ts
      pointRoutes.ts
      donationRoutes.ts
      videoDonationRoutes.ts
      rouletteRoutes.ts
      macroRoutes.ts
      publicRoutes.ts
      adminRoutes.ts
  realtime/
    upgradeRouter.ts
    pvdGateway.ts
    rouletteGateway.ts
    warudoGateway.ts
    desktopGateway.ts
  domains/
    auth/
    chzzk/
    botRules/
    commandEngine/
    placeholders/
    attendance/
    channelPoints/
    macros/
    videoDonation/
    roulette/
    donations/
    tokens/
    warudo/
  db/
    repositories/
    schema/
    migrations/
  jobs/
  observability/
  shared/
```

## 3. 핵심 도메인 분리안

### Auth domain

책임:

- CHZZK OAuth login/callback
- access token refresh
- token revoke/logout
- sid cookie 발급과 user partition migration
- `/api/chzzk/me`

주요 서비스:

- `ChzzkOAuthService`
- `SessionService`
- `TokenRepository`

보존 엔드포인트:

- `GET /api/auth/chzzk/login`
- `GET /api/auth/chzzk/callback`
- `GET /api/auth/chzzk/token`
- `POST /api/auth/chzzk/revoke`
- `POST /api/auth/chzzk/logout`
- `POST /api/auth/chzzk/session/attach`
- `GET /api/chzzk/me`

### Command engine

책임:

- 채팅 이벤트를 명령어 후보로 변환
- 봇 활성화, 방송 중 여부, 권한, cooldown, pointsCost 평가
- 응답 랜덤 선택
- placeholder substitution
- special trigger execution

권장 pipeline:

```text
ChatEvent
  -> normalizeUserRole
  -> matchRule
  -> checkLiveGate
  -> checkCooldown
  -> checkAndDeductPoints
  -> renderResponse
  -> executeActions(video donation, roulette, warudo, chat response)
  -> persistStats
```

주의:

- 룰렛 결과에서 실행된 내부 명령은 포인트를 중복 차감하지 않아야 한다.
- 빈 응답 또는 whitespace 응답은 채팅을 보내지 않는다.
- cooldown은 최소 1000ms를 유지한다.

### Placeholder service

보존 변수:

- `{live.title}`
- `{live.category}`
- `{live.viewers}`
- `{live.startedAt}`
- `{live.elapsed}`
- `{live.elapsed_ko}`
- `{live.channel}`
- `{channel.followers}`
- `{user.followedAt}`
- `{user.followedDays}`
- `{user.subscriptionMonths}`
- `{user.points}`
- `{user.channelPoints}`
- `{user.name}`
- `{user.username}`
- `{user.nickname}`
- `{user.attendanceDays}`

특수 트리거:

- `${video_donation}`
- `${roulette::룰렛이름}`

### Macro domain

책임:

- settings 내 `macros` 배열 CRUD
- 방송 중 여부 캐시
- 매크로별 독립 타이머
- 실패 횟수와 backoff
- stale cache cleanup

보존 엔드포인트:

- `GET /api/macros`
- `POST /api/macros/upsert`
- `POST /api/macros/delete`
- `GET /api/macros/debug`
- `POST /api/macros/reset-timers`
- `GET /api/macros/performance`
- `GET /api/macros/performance/system`
- `POST /api/macros/cleanup`

테스트 기준:

- 서로 다른 매크로는 서로의 타이머에 영향이 없어야 한다.
- bot response는 macro timer를 변경하지 않아야 한다.
- 실패 backoff는 macro별로 독립이어야 한다.
- 인증 오류는 재시도하지 않고 캐시를 무효화한다.

### Channel points domain

책임:

- 채널별 포인트 조회/수정/증감/삭제
- import/export
- public read
- API Key 인증을 통한 외부 접근

보존 엔드포인트:

- `GET /api/channelpoints`
- `POST /api/channelpoints/set`
- `POST /api/channelpoints/incr`
- `GET /api/channelpoints/get`
- `POST /api/channelpoints/delete`
- `GET /api/channelpoints/export`
- `GET /api/channelpoints/export/page`
- `POST /api/channelpoints/import`
- `POST /api/channelpoints/clear`
- `GET /api/public/:uid/points`

권장 DB 구조:

- 단기: 현재 `channelpoint_<uid>` 동적 테이블 방식을 repository 뒤로 감춘다.
- 중기: `channel_points(channel_id, user_id, username, points, updated_at)` 단일 테이블 전환을 검토한다.
- 전환 시 기존 동적 테이블을 읽어 단일 테이블로 backfill하고, 이전 API 응답 shape는 유지한다.

### Video donation domain

책임:

- 영상 후원 설정
- YouTube video id 추출, search, title/duration 조회
- 요청 validation과 포인트 차감
- queue CRUD, reorder, pop, delete, refund
- PVD viewer token 발급/rotation
- PVD viewer WebSocket broadcast와 HTTP fallback

보존 엔드포인트:

- `GET /api/video-donation/settings`
- `POST /api/video-donation/settings`
- `GET /api/video-donation/resolve-title`
- `POST /api/video-donation/request`
- `GET /api/video-donation/queue`
- `POST /api/video-donation/pop`
- `POST /api/video-donation/pop-by-token`
- `POST /api/video-donation/control`
- `POST /api/video-donation/control-by-token`
- `POST /api/video-donation/reorder`
- `POST /api/video-donation/delete`
- `POST /api/video-donation/delete-refund`
- `GET /api/video-donation/viewer-url`
- `POST /api/video-donation/rotate-viewer-token`

확인 필요:

- `PvdViewer.tsx`는 `GET /api/video-donation/now-playing?token=...`을 사용한다. 현재 `server/index.js`에서 해당 route가 확인되지 않는다. 새 구조에서는 반드시 구현하거나 viewer 호출을 실제 존재하는 API로 맞춰야 한다.

### Roulette domain

책임:

- 룰렛 정의 읽기/저장
- 가중치/확률형 선택
- 확률 합계 validation
- 결과 저장
- 결과 채팅 전송
- viewer token 발급/검증
- WebSocket fanout
- batch spin queue

보존 엔드포인트:

- `GET /api/roulette/viewer-url`
- `GET /api/roulette/resolve-token`
- `GET /api/roulette/logs`
- `GET /api/public/:uid/roulette-defs`

보존 WebSocket payload:

```json
{
  "type": "roulette",
  "token": "...",
  "channelId": "...",
  "name": "룰렛 이름",
  "username": "사용자명",
  "value": "optional",
  "label": "결과 라벨",
  "createdAt": "timestamp",
  "theme": "classic",
  "items": ["A", "B"],
  "batchId": "optional",
  "batchCount": 1
}
```

### WARUDO/Desktop domain

책임:

- API Key owner partition 식별
- direct push -> queue enqueue
- WebSocket broadcast
- long-poll fallback
- desktop command relay
- Redis pub/sub optional cross-instance fanout

보존 엔드포인트:

- `POST /api/warudo/events/push`
- `GET /api/warudo/events/next`
- `GET /api/warudo/debug/ws`
- `POST /api/desktop/command`

보존 WebSocket:

- `/api/warudo/ws?token=<API_KEY>`
- `/api/desktop/ws?token=<API_KEY>`

## 4. Middleware와 인증 정책

권장 middleware 순서:

1. request id
2. CORS
3. JSON body limit
4. cookie parser
5. session attach
6. optional API Key attach
7. channel access enforcement
8. route handler
9. error handler

관리 API 보호:

- `/api/admin/*`
- `/api/memory/*`
- `/api/channel/tokens/*`
- `/api/debug/*`

현재 코드는 일부 운영/보안 엔드포인트가 일반 세션 접근으로 열릴 수 있으므로, 새 구조에서는 최소 owner session 또는 admin secret 보호 정책을 명시해야 한다.

## 5. DB/repository 설계

Repository interface 예시:

```ts
interface BotSettingsRepository {
  getSettings(pid: string): Promise<BotSettings>;
  setSettings(pid: string, settings: BotSettings): Promise<void>;
}

interface ChannelPointsRepository {
  list(channelId: string): Promise<PointRow[]>;
  get(channelId: string, userId: string): Promise<PointRow | null>;
  set(channelId: string, row: PointRow): Promise<void>;
  increment(channelId: string, row: PointDelta): Promise<void>;
}
```

Supabase/PostgreSQL:

- `tokens`
- `sessions`
- `bot_settings`
- `bot_stats`
- `bot_rules`
- `live_days`
- `attendance`
- `attendance_state`
- `roulette_sessions`
- `channel_tokens`
- `api_keys`
- `live_sessions`
- 동적 `channelpoint_<uid>` 테이블

SQLite:

- 현재 유사 schema를 갖고 있으나 실제 운영 기준으로 사용할지 결정 필요
- 유지한다면 Supabase와 동일 contract test를 통과해야 한다.

Supabase 개선:

- 상세 schema와 단계별 전환 계획은 [Supabase DB 개선 설계서](./SUPABASE_DB_IMPROVEMENT_PLAN.md)를 따른다.
- viewer URL 안정성을 위해 PVD/roulette token은 channel별 active token으로 DB에 영구 저장한다.
- 영상 후원 queue, playback state, macro next run state는 재시작 복구 가능하도록 DB 또는 Redis-backed store로 전환한다.
- channel points는 장기적으로 동적 테이블 대신 단일 `channel_points(channel_id, user_id, points)` 구조로 통합한다.

## 6. Runtime state 정리

현재 전역 Map 종류:

- session context cache
- channel cache
- channel connection pool
- PVD/roulette token-to-sid map
- PVD/roulette queues and sockets
- video donation queues/timers
- macro cache/timers/failures
- live status cache
- warudo queues/waiters/sockets
- security/token usage stats

권장 abstraction:

```ts
interface RuntimeState {
  sessions: SessionRuntimeStore;
  realtime: RealtimeConnectionRegistry;
  queues: QueueStore;
  scheduler: SchedulerState;
  metrics: MetricsStore;
}
```

초기에는 in-memory adapter로 시작하고, 멀티 인스턴스가 필요한 항목만 Redis/DB adapter로 교체한다.

## 6.1 부하 절감 설계

상세 기준은 [최적화 및 서비스 개선 제안서](./OPTIMIZATION_AND_SERVICE_IMPROVEMENTS.md)를 따른다.

- 외부 API 호출은 service 단위 single-flight와 TTL cache를 적용한다.
- macro 실행은 interval tick마다 전체 macro를 훑지 않고 `nextRunAt` 기반 priority queue로 바꾼다.
- public/read API는 route별 cache 정책과 rate limit을 둔다.
- channel points import/export는 chunk, transaction, progress report를 기본으로 한다.
- WebSocket broadcast는 channel/token type 단위 fanout으로 제한하고 실패 연결은 즉시 정리한다.
- Supabase query는 repository별 index와 latency metric을 함께 관리한다.

## 7. API contract 테스트 목록

최소 snapshot:

- route가 존재하는지
- status code
- response JSON key
- auth 필요 여부
- cookie/API Key/token 입력 방식

우선순위:

1. CHZZK OAuth/token refresh는 mock으로 contract 유지
2. Bot settings/rules CRUD
3. Channel points CRUD/import/export
4. Video donation queue and viewer sync
5. Roulette trigger and WebSocket broadcast
6. WARUDO push/ws/long-poll
7. Public pages API

## 8. 마이그레이션 순서

1. `env.ts`, `logger.ts`, `errors.ts`를 추가한다.
2. `server/index.js`에서 side-effect 없는 helper부터 `shared/`로 이동한다.
3. DB access를 repository로 감싼 뒤 기존 함수 이름은 adapter로 남긴다.
4. read-only route부터 route module로 이동한다.
5. write route를 service 단위로 이동한다.
6. WebSocket upgrade dispatch를 `realtime/upgradeRouter.ts`로 이동한다.
7. scheduler와 cleanup job을 app bootstrap에서 명시적으로 start/stop한다.
8. `server/index.js`는 composition과 bootstrap만 남긴다.

## 9. 완료 기준

- 모든 기존 REST path와 WebSocket path가 유지된다.
- 기존 테스트가 통과하고 route contract 테스트가 추가된다.
- `server/index.js`가 300줄 이하 bootstrap 파일이 된다.
- 기능별 서비스가 독립 unit test 가능하다.
- `/api/video-donation/now-playing`의 의도와 구현이 일치한다.
- 관리/진단 API 보호 정책이 명확하다.
