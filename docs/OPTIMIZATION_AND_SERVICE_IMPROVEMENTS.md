# 최적화 및 서비스 개선 제안서

## 1. 목표

AruBot은 실시간 채팅, OBS viewer, WebSocket, 외부 API, 포인트/룰렛/영상 후원 같은 상태ful 기능이 많다. 리팩토링의 성패는 UI 정리뿐 아니라 불필요한 요청, 중복 계산, 메모리 누수, 외부 API 호출 폭증을 줄이는 데 달려 있다.

최적화 목표:

- 채팅 이벤트가 늘어나도 명령어 처리 지연을 안정적으로 유지한다.
- OBS viewer와 public page가 서버에 과도한 polling 부하를 주지 않는다.
- CHZZK/YouTube/Supabase 호출을 캐시와 배치 처리로 줄인다.
- 멀티 인스턴스 배포 시 WebSocket/queue/event 상태가 깨지지 않는다.
- 운영자가 문제 원인을 바로 볼 수 있도록 진단 가능성을 높인다.

## 2. 백엔드 최적화

### 2.1 API 요청 부하 절감

- public pages는 짧은 TTL 캐시를 적용한다.
  - 명령어/룰렛 정의: 30-60초
  - 포인트 랭킹: 5-15초 또는 stale-while-revalidate
  - 룰렛 로그: 검색 없는 첫 페이지 5-10초
- 관리자 화면의 polling을 화면별로 제한한다.
  - 연결/라이브 상태: 30초
  - 포인트 목록: 현재 2초 polling은 부담이 크므로 focus 상태에서만 5-10초, 편집 중에는 중지
  - 영상 후원 queue: WebSocket/SSE 우선, polling fallback은 2-5초
- 동일 요청 deduplication을 API wrapper 또는 service cache에서 처리한다.
- route별 rate limit을 둔다.
  - viewer token 검증
  - public page 조회
  - channelpoints import
  - WARUDO events push
  - roulette spin trigger

### 2.2 DB 최적화

- `sid`, `channelId`, `ownerPid` 기준 인덱스를 명확히 유지한다.
- Supabase DB 개선 상세안은 [Supabase DB 개선 설계서](./SUPABASE_DB_IMPROVEMENT_PLAN.md)를 따른다.
- 영상 후원/PVD viewer와 룰렛 viewer URL은 `channel_viewer_tokens` 같은 DB 매핑 테이블로 고정한다.
- 서버 재시작 후 복구가 필요한 queue/playback/macro 상태는 메모리 Map이 아니라 DB 또는 Redis-backed store에 저장한다.
- 자주 쓰는 query를 repository 단위로 고정하고 explain/analyze 기준을 남긴다.
- 동적 `channelpoint_<uid>` 테이블은 장기적으로 단일 `channel_points` 테이블로 통합한다.
  - 권장 PK: `(channel_id, user_id)`
  - index: `(channel_id, points desc)`, `(channel_id, username)`, `(channel_id, updated_at)`
- 대량 import는 chunk + transaction + progress 방식으로 처리한다.
- `bot_settings` JSON에 많은 도메인 설정을 모두 넣는 구조는 장기적으로 분리한다.
  - `bot_settings`
  - `macro_settings`
  - `roulette_defs`
  - `donation_rules`
  - `video_donation_settings`
- 룰렛 로그와 출석 로그는 retention 정책을 둔다.

### 2.3 캐시 전략

- per-request cache: 같은 요청 안에서 user/channel/live 정보를 중복 조회하지 않는다.
- short-lived memory cache:
  - live status
  - channel profile
  - follower/subscription lookup
  - roulette token -> channel mapping
- distributed cache:
  - Redis가 있으면 WebSocket fanout, WARUDO queue, viewer current state를 Redis adapter로 이동한다.
- cache invalidation:
  - bot settings 저장 시 command/roulette/macro 관련 cache를 정확히 무효화한다.
  - token rotate 시 viewer token mapping과 old socket을 정리한다.

### 2.4 WebSocket/Realtime 최적화

- PVD와 Roulette viewer는 WebSocket 우선, polling fallback으로 유지한다.
- heartbeat interval은 30초 이상으로 유지하고, dead socket cleanup을 주기적으로 수행한다.
- 채널별 connection pool은 token type과 token value로 격리한다.
- broadcast 실패율을 metric으로 수집한다.
- 멀티 인스턴스에서는 Redis pub/sub 또는 durable event bus 없이는 특정 인스턴스에 붙은 WebSocket만 받을 수 있으므로 fanout 설계를 분명히 한다.

### 2.5 Scheduler 최적화

- 매크로는 세션 전체를 매 tick마다 스캔하지 않는다.
  - next-run priority queue 또는 min-heap 기반 스케줄러로 전환한다.
  - macro별 `nextRunAt`을 계산해 가장 가까운 작업만 wakeup한다.
- 실패 backoff는 macro별로 독립 유지한다.
- live-only macro는 live status cache가 바뀔 때만 스케줄 재계산한다.
- shutdown 시 timer와 queue 상태를 저장하거나 안전하게 재구성한다.

### 2.6 외부 API 최적화

- CHZZK token refresh는 동시 요청 lock을 둔다.
  - 같은 sid에서 refresh가 동시에 여러 번 실행되지 않도록 single-flight 처리한다.
- CHZZK live/profile/follower/subscription 조회는 TTL 캐시를 둔다.
- YouTube resolve는 videoId 기준 캐시를 둔다.
  - 제목/길이 조회 결과는 24시간 이상 캐시 가능
  - 검색어 기반 조회는 짧은 TTL 또는 명시적 재검색
- 외부 API 오류는 retry budget과 circuit breaker로 제한한다.

### 2.7 보안/부하 보호

- API Key와 viewer token은 scope를 분리한다.
  - API Key: owner API
  - viewer token: pvd/roulette viewer only
  - channel token: channel-scoped public/realtime
- public endpoint는 channelUid 단위 rate limit과 response size limit을 둔다.
- import/export는 authenticated owner만 허용한다.
- diagnostics/admin endpoint는 별도 admin guard가 필요하다.

## 3. Next.js/프론트엔드 최적화

### 3.1 렌더링 전략

- Server Component를 기본으로 사용한다.
- 상호작용이 필요한 form/table/viewer만 Client Component로 분리한다.
- heavy components는 route 단위 dynamic import를 사용한다.
  - YouTube player
  - Roulette animation
  - drag/drop queue
  - import/export processor
- public pages는 서버 렌더링으로 초기 HTML을 빠르게 제공한다.

### 3.2 요청 최적화

- 관리자 화면 initial data는 route segment별로 병렬 fetch한다.
- 검색/필터는 URL search params로 유지하고 debounce를 적용한다.
- client polling은 tab visibility/focus에 따라 중지한다.
- form 저장 후 전체 refetch 대신 변경된 entity만 갱신한다.
- copy field, toggle, drawer 같은 UI 상태는 서버 상태와 분리한다.

### 3.3 번들 최적화

- lucide icon은 필요한 아이콘만 직접 import한다.
- feature barrel export 남발을 피한다.
- feature별 heavy code는 dynamic import로 지연 로딩한다.
- viewer route와 admin route의 JS를 분리한다.
- public page는 관리자 전용 bundle을 포함하지 않는다.
- animation SVG/theme code는 roulette viewer route에서만 로드한다.

### 3.4 대형 목록 최적화

- 포인트 랭킹은 서버 페이지네이션을 기본으로 한다.
- 1,000개 이상 rows는 virtualization 또는 cursor pagination을 적용한다.
- import preview는 전체 파일을 DOM에 렌더하지 않는다.
- logs는 offset보다 cursor 기반 pagination을 장기 목표로 둔다.

### 3.5 UX 성능

- 저장 버튼은 pending 상태와 optimistic UI를 명확히 표시한다.
- 위험 작업은 modal 확인 후 background 작업으로 진행한다.
- skeleton은 table row 형태로 제공한다.
- toast는 중복 표시를 dedupe한다.
- 모바일에서 drawer/table overflow를 방지한다.

## 4. OBS Viewer 최적화

### PVD Viewer

- WebSocket 연결 성공 시 polling을 완전히 중지한다.
- visibility hidden에서는 control emit을 억제한다.
- 같은 videoId/startSec는 player reload를 피한다.
- manual seek 감지는 throttle한다.
- `/api/video-donation/now-playing` fallback endpoint를 확실히 구현한다.

### Roulette Viewer

- animation state machine을 reducer로 분리해 불필요한 rerender를 줄인다.
- SVG overlay는 theme 변경 시에만 remount한다.
- 중복 payload는 key 기반으로 무시한다.
- batch payload는 queue로 순차 처리한다.
- SFX는 preload하되 autoplay 정책 실패를 graceful하게 처리한다.

## 5. 운영 관측성

추가하면 좋은 metric:

- request count/status/latency by route
- CHZZK API call count/error/latency
- Supabase query latency by repository
- WebSocket active connections by channel/token type
- broadcast success/failure count
- macro scheduled/sent/skipped/failed count
- video donation queue length
- roulette spin count and queue length
- cache hit/miss
- memory usage and cleanup result

운영자 UI에 표시할 진단:

- 현재 연결 상태
- 마지막 이벤트 수신 시각
- viewer 연결 수
- 매크로 다음 실행 예정
- 최근 오류 10개
- API Key 마지막 사용 시각
- token rotate 필요 여부

## 6. 서비스 개선 제안

### 6.1 운영자 경험

- 첫 화면 dashboard에서 “지금 해야 할 일”을 보여준다.
  - 연결 끊김
  - API Key 미발급
  - viewer 미연결
  - 확률 합계 오류
  - 영상 후원 비활성화
- 설정 변경 이력을 남긴다.
- 명령어/룰렛/매크로를 복제할 수 있게 한다.
- 템플릿을 제공한다.
  - 출석 체크 기본 명령어
  - 포인트 지급 명령어
  - 영상 후원 명령어
  - 룰렛 기본 세트
- 명령어 테스트 패널을 제공한다.
  - userId, username, 권한, 포인트, 라이브 상태를 가정해 결과 preview

### 6.2 시청자 경험

- 공개 채널 페이지를 하나의 channel hub로 통합한다.
  - `/c/[channelUid]`
  - 명령어, 포인트, 룰렛, 라이브 상태를 탭으로 제공
- 모바일 public page를 더 읽기 쉽게 만든다.
- 룰렛 정의 페이지에 실제 확률을 명확히 표시한다.
- 포인트 랭킹에 내 포인트 조회 기능을 추가한다.

### 6.3 방송 연출 기능

- 룰렛 theme preset을 확장한다.
- 룰렛 결과별 custom SFX/색상/텍스트를 지원한다.
- 영상 후원 queue overlay를 별도 OBS source로 제공한다.
- 후원 명령어가 WARUDO event뿐 아니라 desktop client에도 동일하게 표시되도록 event history를 만든다.

### 6.4 안정성 기능

- “점검 모드”를 추가해 명령어 처리만 일시 중지한다.
- viewer token rotate 시 기존 OBS URL 영향 범위를 안내한다.
- 설정 export/import로 백업 기능을 제공한다.
- 명령어/룰렛/매크로 변경 전 자동 snapshot을 남긴다.
- 문제가 생겼을 때 이전 설정으로 rollback할 수 있게 한다.

### 6.5 권한과 협업

- 스트리머 외 운영자 권한을 분리한다.
  - viewer URL 복사 가능
  - 포인트 수정 가능
  - 명령어 수정 가능
  - 진단 보기 가능
- 감사 로그를 남긴다.
  - 누가 어떤 설정을 바꿨는지
  - 포인트 수동 조정 내역
  - API Key 발급/회수

### 6.6 수익화/확장 가능성

- 채널별 플러그인 marketplace 구조를 고려한다.
  - 룰렛 pack
  - 명령어 template pack
  - viewer theme pack
- 고급 기능을 module flag로 분리한다.
  - multi-operator
  - advanced analytics
  - custom overlay theme
  - long-term logs

## 7. 우선순위 로드맵

### 즉시 반영

- `/api/video-donation/now-playing` 확인/구현
- 포인트 목록 polling 완화
- API client request dedupe
- WebSocket 연결 수/실패 metric
- 한글 깨짐 문구 복구

### Next.js 전환 중 반영

- Server Component 중심 route 설계
- public/admin/viewer bundle 분리
- feature별 dynamic import
- route-level loading/error UI
- public page cache/revalidate 정책

### 백엔드 리팩토링 중 반영

- repository 계층과 query 최적화
- macro scheduler priority queue
- Redis adapter for realtime fanout
- channel_points 단일 테이블 전환 설계
- admin/diagnostics 보호 정책

### 전환 후 개선

- channel hub
- 설정 snapshot/rollback
- audit log
- operator role
- advanced analytics
