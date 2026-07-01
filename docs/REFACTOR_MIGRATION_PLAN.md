# AruBot 리팩토링 및 마이그레이션 전체 기획서

## 1. 목표

AruBot은 치지직 OAuth 로그인, 채팅 이벤트 수집, 명령어 응답, 출석, 채널 포인트, 영상 후원, 룰렛, 후원 명령어, 매크로, 공개 조회 페이지, OBS 뷰어, WARUDO/C# 플러그인 연동을 포함하는 통합 채팅봇이다.

이번 리팩토링의 목표는 다음과 같다.

- 현재 사용 가능한 기능을 누락 없이 보존한다.
- 단일 대형 서버 파일과 비대한 React 컴포넌트를 기능 단위로 분리한다.
- 한글 문자열 인코딩 깨짐, 중복 라우트, 숨은 상태 공유, 캐시 정합성 문제를 제거한다.
- UI를 더 읽기 쉽고 조작하기 쉬운 운영 도구 형태로 재구성한다.
- 외부 계약(API Key, 공개 URL, WebSocket payload, WARUDO 노드)을 깨지 않으면서 내부 구조를 교체한다.

## 2. 현재 시스템 요약

### 기술 스택

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, lucide-react
- Backend: Node.js ESM, Express, ws, axios, cookie-parser, cors
- Storage: Supabase/PostgreSQL 중심, legacy SQLite 구현도 존재
- External APIs: CHZZK OpenAPI/OAuth, YouTube Data API optional, Redis optional
- Viewer/Static: `/pvd/:token`, `/roulette/:token`, `/commands/:uid`, `/points/:uid`, `/roulettelog/:uid`, `/roulettelist/:uid`
- Plugin: WARUDO C# plugin, API Key 인증, WebSocket/long-poll 이벤트 수신, 포인트 조회/조정 노드

### 주요 문제

- `server/index.js`가 약 13,000줄 단일 파일로, 라우팅/도메인 로직/캐시/스케줄러/WebSocket/보안/DB 접근이 섞여 있다.
- `ChannelPointsPanel.tsx`, `RouletteViewer.tsx`가 매우 크고 여러 관심사를 동시에 가진다.
- 일부 한글 문자열과 주석이 mojibake 상태라 UI 문구와 유지보수성이 크게 손상되어 있다.
- `/api/channel/context` 라우트가 중복 정의되어 있다.
- `PvdViewer`는 `/api/video-donation/now-playing`을 호출하지만 현재 서버 라우트 목록에서 해당 GET 라우트가 확인되지 않는다. 마이그레이션 전에 의도된 라우트 누락인지 배포 코드 차이인지 확인해야 한다.
- 공개 정적 HTML 페이지가 React 앱과 별도 구현이라 UI/라우팅/상수/API base 중복이 있다.
- Supabase와 SQLite 구현이 공존하지만 실제 런타임 기본 경로와 fallback 정책이 문서화되어 있지 않다.
- 전역 Map 기반 상태가 많아 멀티 인스턴스, 서버리스 배포, 재시작 복구에서 동작이 달라질 수 있다.

## 3. 반드시 보존할 기능 목록

### 인증과 세션

- CHZZK OAuth 로그인, callback 처리, refresh token 갱신, revoke/logout
- 쿠키 기반 sid 발급 및 `user:<channelId>` partition으로 마이그레이션
- `/api/chzzk/me`, `/api/auth/chzzk/token`, `/api/auth/chzzk/session/attach`
- API Key 발급, 재발급, 폐기, `/apikey` 브라우저 콜백

### 채팅과 명령어

- CHZZK 이벤트 polling/구독 기반 채팅 이벤트 수신
- 명령어 룰 CRUD
- 키워드 포함 매칭, enabled, cooldown, 권한 레벨, 포인트 비용
- `{live.*}`, `{channel.*}`, `{user.*}` 변수 치환
- `${video_donation}`, `${roulette::이름}` 특수 트리거
- 봇 전체 enable/disable, 방송 중에만 명령어 처리 옵션

### 출석과 라이브 상태

- 라이브 상태 확인 및 캐시
- KST 기준 출석일 계산
- 방송일 기록, 사용자 출석 기록, 연속 출석, 누적 출석일
- 출석 안내 메시지 on/off, 제외 UID 목록

### 채널 포인트

- 채널별 포인트 테이블 또는 equivalent schema
- 포인트 목록, 검색, 편집, set/incr/delete/clear
- JSON export/import, 대용량 chunk import
- 공개 포인트 페이지 `/points/:uid`
- API Key 기반 외부 포인트 조회/조정

### 영상 후원

- 영상 후원 설정: 초당 포인트, 활성화, 최대 길이, 사용자별 대기열 제한
- YouTube URL/검색어 해석, 제목/길이 조회
- 요청 시 포인트 차감, 대기열 추가, 현재 재생, next/pop, 삭제, 삭제 후 환불, 순서 변경
- OBS/PVD viewer URL 발급과 token rotation
- `/api/pvd/ws` WebSocket start/control 동기화
- HTTP polling fallback 유지

### 룰렛

- 룰렛 정의 CRUD: 이름, 타입, 항목, 실행 값, 테마
- 가중치형과 확률형 선택 로직
- 확률형은 합계 100% 검증 및 자동 조정 UX
- 명령어 응답에서 `${roulette::name}` 실행
- 결과 채팅 전송, 결과 값이 명령어일 때 포인트 중복 차감 방지
- 결과 저장, 로그 조회, 공개 룰렛 정보/로그 페이지
- OBS 룰렛 viewer URL, `/api/roulette/ws`, batch 표시, 재연결, 테마/SFX

### 후원 명령어

- 후원 금액을 채널 포인트로 환산
- 후원 조건 규칙: 금액 범위, 메시지 패턴, wildcard, 응답, 반복 전송
- 후원 명령을 WARUDO/Electron desktop 이벤트로 전달

### 매크로

- 매크로 CRUD: enabled, intervalSec, message
- 방송 중 조건과 캐시
- 매크로별 독립 타이머
- 실패 횟수와 exponential backoff
- 인증 오류 시 cache invalidation
- debug/performance/reset/cleanup 엔드포인트

### 외부 연동

- WARUDO direct event push: `/api/warudo/events/push`
- WARUDO long-poll: `/api/warudo/events/next`
- WARUDO WebSocket: `/api/warudo/ws?token=...`
- Electron desktop WebSocket: `/api/desktop/ws?token=...`
- Desktop command push: `/api/desktop/command`
- C# plugin API Key 획득 flow와 포인트 노드 호환

### 운영/보안/모니터링

- 채널 토큰 생성/검증/회수/usage tracking
- channel access enforcement
- memory/cache/resource cleanup
- database performance analyze/optimize
- security event 통계와 suspicious token report
- graceful shutdown

## 4. 보존해야 할 URL/API 호환성 표면

### Public page URLs

- `/commands/:uid`
- `/points/:uid`
- `/roulettelog/:uid`
- `/roulettelist/:uid`
- `/pvd/:token`
- `/roulette/:token`

### WebSocket paths

- `/api/pvd/ws?token=...`
- `/api/roulette/ws?token=...`
- `/api/warudo/ws?token=...`
- `/api/desktop/ws?token=...`

### 주요 REST API 그룹

- Auth: `/api/auth/chzzk/*`, `/api/apikey/*`, `/apikey`
- Chzzk: `/api/chzzk/me`, `/api/chzzk/live`, `/api/chzzk/events`, `/api/chzzk/chat/send`, `/api/chzzk/reset`
- Bot: `/api/bot/settings`, `/api/bot/rules`, `/api/bot/stats`
- Channel points: `/api/channelpoints*`, `/api/public/:uid/points`
- Donation: `/api/donation/*`
- Video donation: `/api/video-donation/*`
- Roulette: `/api/roulette/*`, `/api/public/:uid/roulette-defs`
- Macros: `/api/macros*`
- Warudo/Desktop: `/api/warudo/*`, `/api/desktop/*`
- Admin/diagnostics: `/api/memory/*`, `/api/channel/tokens/*`, `/api/admin/*`, `/api/health`

## 5. 목표 아키텍처

### Backend module layout

```text
server/
  app.ts
  config/
  http/
    routes/
    middleware/
  realtime/
    pvdGateway.ts
    rouletteGateway.ts
    warudoGateway.ts
    desktopGateway.ts
  domains/
    auth/
    chzzk/
    botRules/
    macros/
    attendance/
    channelPoints/
    videoDonation/
    roulette/
    donation/
    tokens/
  db/
    repositories/
    migrations/
    supabaseClient.ts
  jobs/
  observability/
  shared/
```

### Frontend module layout

```text
src/
  app/
  routes/
  layouts/
  features/
    connection/
    botSettings/
    commands/
    macros/
    points/
    videoDonation/
    roulette/
    donations/
    stats/
    viewers/
  shared/
    api/
    components/
    hooks/
    styles/
    types/
```

### 데이터 원칙

- `sid`, `ownerPid`, `channelId` 의미를 명확히 분리한다.
- DB 저장 모델과 API DTO를 분리한다.
- Supabase DB 개선 상세안은 [Supabase DB 개선 설계서](./SUPABASE_DB_IMPROVEMENT_PLAN.md)를 따른다.
- 영상 후원/PVD viewer와 룰렛 viewer URL은 유저/채널별 DB 매핑으로 고정해, 설정 저장이나 서버 재시작으로 바뀌지 않게 한다.
- 채널 포인트는 동적 테이블 방식 유지 여부를 재검토하되, 마이그레이션 중에는 기존 동작을 우선 보존한다.
- 전역 Map은 인터페이스 뒤로 숨기고, Redis/DB backed adapter로 교체 가능하게 만든다.
- WebSocket payload는 버전 필드를 추가하되 기존 필드를 제거하지 않는다.

## 6. 단계별 마이그레이션 전략

### Phase 0. 동결 및 기준선 확보

- 현재 API 목록, WebSocket payload, public page URL을 snapshot 문서로 고정한다.
- 한글 깨짐 문자열은 원문 복구표를 만든 뒤 UI copy 교체 PR로 별도 처리한다.
- `/api/video-donation/now-playing` 누락 여부를 배포 환경과 비교한다.
- `npm test`, `npm run build`, 수동 OAuth flow, OBS viewer flow를 기준선으로 기록한다.

### Phase 1. 서버 분리

- `server/index.js`에서 route handler를 기능별 파일로 이동한다.
- 기존 route path와 response shape는 그대로 유지한다.
- DB 함수는 repository/service 계층으로 분리한다.
- 전역 캐시/타이머는 `RuntimeState` 인터페이스로 감싼다.

### Phase 2. 도메인 서비스 정리

- bot command execution pipeline을 `parse -> authorize -> cost -> execute -> respond`로 분리한다.
- roulette/video donation 특수 트리거는 command action plugin 형태로 분리한다.
- macro scheduler를 독립 job으로 만들고 테스트 가능한 clock 인터페이스를 둔다.
- token/channel access 보안 로직을 middleware와 service로 분리한다.

### Phase 3. 프론트엔드 정보 구조 재구성

- 단일 상단 탭 대신 운영자 업무 기준 IA로 정리한다.
- Connection, Commands, Macros, Points, Video Donation, Roulette, Donations, Diagnostics를 명확히 나눈다.
- public HTML 페이지는 React route 또는 공유 JS bundle로 통합하되 URL은 유지한다.
- viewer는 controller UI와 분리된 경량 entrypoint로 유지한다.

### Phase 4. 데이터/운영 안정화

- Supabase schema migration을 idempotent하게 정리한다.
- SQLite fallback 유지 여부를 결정한다. 유지한다면 동일 repository contract 테스트를 추가한다.
- Redis 사용 시 WARUDO queue, live session, WebSocket fanout adapter를 명확히 한다.
- 모니터링 API는 admin 보호 정책을 명시한다.

### Phase 5. 점진 배포

- 기존 서버와 새 서버를 동일 DB에 대해 read-only shadow로 돌려 응답 차이를 비교한다.
- low-risk API부터 새 handler로 전환한다.
- OBS viewer와 WARUDO plugin은 호환성 테스트 후 전환한다.
- 최종적으로 구 server/index.js를 제거한다.

## 7. 리스크와 대응

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| CHZZK OAuth/API 스펙 변경 | 로그인/채팅 송신 실패 | 공식 API wrapper 격리, refresh/revoke 테스트 추가 |
| 전역 Map 상태 손실 | viewer/queue/macro 상태 불일치 | state adapter와 DB/Redis 복구 루틴 |
| WebSocket payload 변경 | OBS/WARUDO 연동 깨짐 | contract test와 versioned payload |
| 한글 깨짐 복구 오류 | UI 의미 변질 | 화면별 문구표를 먼저 만들고 사용자 확인 |
| 동적 채널 포인트 테이블 | schema 관리 난이도 | 단일 테이블 전환 migration 또는 adapter 유지 |
| public HTML 중복 | UI 불일치 | React/shared renderer로 통합하되 기존 URL rewrite 유지 |

## 8. 검증 계획

- Unit: roulette selection/probability, command parser, placeholder substitution, macro timer, token validation
- Integration: OAuth mock, bot rules CRUD, channel points import/export, video donation queue, roulette broadcast, WARUDO queue
- Contract: REST response schema, WebSocket payload, C# plugin endpoints
- E2E: 로그인 -> 연결 -> 명령어 생성 -> 채팅 처리 -> 포인트/룰렛/영상 후원 실행
- Visual: 운영자 대시보드 desktop/mobile, OBS PVD viewer, OBS roulette viewer
- Load: 100개 이상 룰렛 요청, 대량 포인트 import, 장시간 macro scheduler

## 8.1 최적화 기준

전체 리팩토링은 [최적화 및 서비스 개선 제안서](./OPTIMIZATION_AND_SERVICE_IMPROVEMENTS.md)를 공통 기준으로 삼는다.

- public page와 viewer는 불필요한 polling을 줄이고 WebSocket/SSE/fallback 구조를 명확히 한다.
- CHZZK, YouTube, Supabase 호출은 TTL cache, single-flight, batch 처리로 제한한다.
- macro scheduler는 전체 세션 스캔 방식에서 next-run 기반 구조로 전환한다.
- channel points와 roulette logs는 pagination/cursor/retention 정책을 적용한다.
- WebSocket connection pool, broadcast 실패율, cache hit/miss를 운영 지표로 수집한다.

## 9. 완료 기준

- 기존 URL/API/WebSocket/C# plugin 계약이 모두 유지된다.
- 기존 테스트와 새 contract/E2E 테스트가 통과한다.
- 주요 UI 문구의 한글 깨짐이 제거된다.
- `server/index.js` 단일 대형 파일이 기능별 모듈로 분리된다.
- public page와 app UI의 디자인/상태/에러 처리 규칙이 일관된다.
- README만 보고 로컬 개발, 배포 설정, OBS/WARUDO 연결 절차를 재현할 수 있다.
