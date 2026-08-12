# 로컬 Supabase 전환 및 데이터 이관 계획

## 1. 목표

현재 AruBot의 DB 의존성을 원격 Supabase에서 로컬 Supabase 스택으로 전환하되, 운영 데이터 손실 없이 재현 가능한 개발/테스트 환경을 만든다.

핵심 목표는 다음과 같다.

- 로컬에서 Supabase API, PostgREST, Studio, Postgres를 모두 실행한다.
- 원격 `public` 스키마와 데이터를 로컬로 안전하게 복제한다.
- 현재 프로젝트의 `server/migrations`와 `server/supabase.js` bootstrap 로직이 로컬 DB에서도 동일하게 동작하게 한다.
- 전환 후 주요 API, viewer URL, 포인트, 룰렛, 자동화, OAuth token 저장 동작을 검증한다.
- 쿼리 성능과 인덱스 상태를 확인해 로컬에서도 운영과 비슷한 성능 특성을 재현한다.

## 2. 현재 프로젝트 기준

현재 DB 연결은 주로 다음 세 환경 변수로 결정된다.

- `SUPABASE_URL`: Supabase REST/PostgREST API URL
- `SUPABASE_SERVICE_ROLE_KEY`: 서버에서 사용하는 service role key
- `SUPABASE_DB_URL`: direct Postgres 연결 URL

주요 DB 파일은 다음과 같다.

- `server/supabase.js`: Supabase client, direct `pg` pool, schema bootstrap, repository 함수가 함께 있음
- `server/migrations/*.sql`: 순차 실행되는 PostgreSQL 마이그레이션
- `server/sqlite.js`: legacy/fallback 성격의 SQLite 구현
- `docs/SUPABASE_DB_IMPROVEMENT_PLAN.md`: 장기 스키마 개선 계획

현재 마이그레이션은 `001`부터 `009`까지 있으며, `channel_tokens`, `channel_viewer_tokens`, `video_donation_queue`, `viewer_playback_state`, `channel_points_balances`, `macro_schedules`, `platform_accounts`, `prediction_events`, `automation_jobs`, `youtube_bot_profiles`, `app_users` 등을 다룬다.

주의할 점:

- `server/supabase.js`는 일부 기본 테이블을 런타임에서 `ensureSchema()`로도 생성한다.
- 로컬 Supabase의 Postgres direct URL은 일반적으로 SSL을 쓰지 않는다.
- 원격 Supabase direct URL은 보통 SSL이 필요하다.
- 따라서 최종 구현 단계에서는 DB URL에 따라 `pg` SSL 옵션을 분기해야 한다.

## 3. 권장 전환 방식

권장 방식은 "로컬 Supabase exact clone 후 앱 전환"이다.

1. 원격 DB를 백업한다.
2. 로컬 Supabase 스택을 초기화하고 실행한다.
3. 원격 `public` 스키마와 데이터를 로컬 DB로 복원한다.
4. 로컬 DB에서 프로젝트 마이그레이션과 bootstrap을 재실행해 누락 컬럼/인덱스를 보정한다.
5. `.env`를 로컬 Supabase 값으로 전환한다.
6. 백엔드/프론트엔드/API 회귀 테스트를 수행한다.
7. 인덱스, 통계, 느린 쿼리를 확인한다.

이 방식이 좋은 이유:

- 운영 데이터 구조와 실제 데이터를 가장 가깝게 재현한다.
- 마이그레이션 파일만으로는 런타임 bootstrap이 만든 테이블까지 완전히 보장하지 못할 수 있다.
- 원격 데이터의 edge case를 로컬에서 바로 검증할 수 있다.

대안으로 "마이그레이션만 적용한 빈 DB"를 만들 수도 있지만, 이 경우 기존 운영 데이터 이슈나 JSON shape 차이를 놓치기 쉽다.

중요한 운영 판단:

- Supabase CLI 로컬 스택은 개발/검증용으로 쓴다.
- 실제 외부 서비스 운영에는 CLI 스택을 그대로 공개하지 않는다.
- 운영 비용과 부하를 줄이려면 최종 구조를 "백엔드 + Postgres 중심"으로 수렴시킨다.
- Supabase API/PostgREST는 전환기 호환 계층으로 두고, 채팅/포인트/출석 같은 hot path는 direct `pg` 또는 prepared query로 옮긴다.

## 4. 백엔드에 붙일 로컬 Supabase 설치 개념

여기서 말하는 "Supabase 대체품"은 Supabase를 완전히 다른 DB로 바꾸는 것이 아니라, Supabase CLI가 Docker로 띄우는 로컬 Supabase 스택을 백엔드의 새 연결 대상으로 쓰는 방식이다.

즉, 백엔드는 그대로 다음 두 경로를 사용한다.

- `@supabase/supabase-js`: `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`로 PostgREST API에 연결
- `pg`: `SUPABASE_DB_URL`로 로컬 Postgres에 직접 연결

단순히 로컬 PostgreSQL만 설치하는 방식은 1차 권장안이 아니다. 현재 코드가 `supabase.from(...)` 호출을 많이 사용하고, 서버 시작 시 PostgREST schema refresh도 수행하기 때문이다. 로컬 PostgreSQL만 쓰려면 PostgREST/API key 계층을 별도로 대체해야 하므로 변경 범위가 커진다.

권장 구성:

```text
AruBot Express server
  ├─ SUPABASE_URL=http://127.0.0.1:54321
  │   └─ local Supabase API/PostgREST
  ├─ SUPABASE_SERVICE_ROLE_KEY=<local service_role key>
  │   └─ server-side privileged REST access
  └─ SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
      └─ local Supabase Postgres direct connection
```

프론트엔드는 DB에 직접 붙지 않고 백엔드 API를 호출한다. 따라서 로컬 DB 전환의 핵심은 Express 서버의 `.env`를 로컬 Supabase로 바꾸는 것이다.

선택지는 다음처럼 구분한다.

| 선택지 | 설명 | 현재 프로젝트 적합도 |
| --- | --- | --- |
| 로컬 Supabase CLI 스택 | Supabase API, PostgREST, Studio, Postgres를 Docker로 로컬 실행 | 개발/이관 검증에 가장 적합. 기존 `supabase.from(...)` 코드와 direct `pg` 코드를 모두 유지 가능 |
| 순수 로컬 Postgres | Postgres만 설치하고 `SUPABASE_DB_URL`만 연결 | 최종 저부하 운영 목표로는 좋지만, 지금 바로 쓰면 `SUPABASE_URL` 기반 Supabase client 호출이 깨짐 |
| 자체 PostgREST + Postgres | Supabase 없이 PostgREST와 Postgres를 직접 구성 | 전환기 운영 후보. Supabase 전체 스택보다 가볍지만 인증 key, schema cache, REST 설정을 직접 운영해야 함 |
| Supabase self-hosting | Supabase 전체 컴포넌트를 직접 배포 | Supabase 기능을 계속 많이 쓸 때 운영 후보. 단, 사용하지 않는 Auth/Storage/Realtime까지 같이 운영하면 리소스 부담이 커짐 |

따라서 1차 구현은 로컬 Supabase CLI 스택으로 잡는다. 이후 부하를 줄이는 방향은 다음 순서가 좋다.

1. 로컬 Supabase로 원격 DB를 복제해 기능 호환성을 먼저 확보한다.
2. 백엔드 hot path를 `supabase.from(...)`에서 direct `pg` query로 점진 전환한다.
3. 운영 구성은 전체 Supabase 공개가 아니라 `backend -> Postgres` 중심으로 두고, PostgREST가 남아도 내부망 전용으로 제한한다.

## 5. 부하 최소화 운영 방향

### 5.1 결론

로컬로 돌린다고 자동으로 백엔드 부하가 줄어드는 것은 아니다. 원격 Supabase에서 사라지는 것은 외부 서비스 요금/쿼터와 네트워크 왕복 비용이고, DB CPU/메모리/디스크 I/O 부담은 직접 운영하는 서버로 이동한다.

부하를 최소화하려면 "Supabase 전체 기능을 자체 운영"이 아니라 "현재 코드 호환에 필요한 구성만 남기고 hot path는 Postgres direct로 최적화"해야 한다.

권장 목표 구조:

```text
Internet
  -> Reverse proxy
    -> AruBot Express/Next backend
      -> in-process cache / optional Redis
      -> PgBouncer or pg Pool
      -> Postgres

Internal only, transition period:
  -> PostgREST
  -> Supabase Studio
```

외부에 공개할 것은 AruBot 백엔드뿐이다. Postgres, PostgREST, Studio는 외부 공개하지 않는다.

### 5.2 CLI 로컬 스택과 운영 self-hosting 분리

Supabase 공식 문서 기준으로 CLI 로컬 스택은 개발/테스트 용도다. 운영 공개용으로는 self-hosting 문서를 따른 별도 구성이 필요하다.

이 프로젝트에서는 다음처럼 나눈다.

- 개발/이관 검증: Supabase CLI local stack
- 운영 비용 절감: 자체 서버의 Postgres 중심 구성
- Supabase REST 호환이 아직 필요한 전환기: PostgREST를 내부망에만 배치
- Supabase Auth/Storage/Realtime을 쓰지 않는다면 해당 서비스를 운영 구성에서 제외하거나 비활성화 검토

현재 AruBot은 자체 OAuth session, token table, WebSocket server를 갖고 있다. Supabase Auth/Storage/Realtime 의존도가 낮으므로, 장기적으로는 전체 Supabase self-hosting보다 Postgres 중심 구성이 더 가볍다.

### 5.3 현재 코드에서 부하가 커질 가능성이 큰 지점

우선순위가 높은 hot path:

- 채팅 이벤트마다 실행되는 출석/포인트/명령어 처리
- `attendance`, `attendance_state`, `channel_points_balances` write
- viewer token lookup
- PVD/roulette viewer 상태 polling 또는 WebSocket fanout
- public points ranking
- automation job claim polling
- `live_sessions` 주기 업데이트
- performance monitoring scheduler

현재 코드에는 `supabase.from(...)` 호출과 direct `withPgClient(...)` 호출이 섞여 있다. 로컬 Supabase API를 통하면 백엔드에서 PostgREST로 HTTP 요청을 보내고, PostgREST가 다시 Postgres에 쿼리한다. 같은 서버 안에서 운영하면 이 경로는 편하지만 CPU와 connection overhead가 늘 수 있다.

저부하 원칙:

- hot path는 direct `pg` query로 처리한다.
- public read는 TTL cache를 둔다.
- write는 이벤트마다 즉시 DB에 쓰지 말고 가능한 범위에서 batch/upsert한다.
- WebSocket으로 fanout 가능한 상태는 polling을 줄인다.
- 주기 scheduler는 기본값을 보수적으로 잡고, 운영에서 필요한 것만 켠다.

### 5.4 단계별 저부하 전환안

#### Phase A. 호환성 우선

목표:

- 로컬 Supabase CLI 스택으로 현재 기능이 그대로 동작하는지 확인한다.
- 데이터 이관과 migration 정합성을 검증한다.

구성:

```text
backend -> local Supabase API/PostgREST
backend -> local Postgres direct
```

부하 최소화 설정:

```dotenv
SUPABASE_DB_POOL_MAX=5
SUPABASE_DB_CONNECT_TIMEOUT_MS=5000
SUPABASE_DB_STATEMENT_TIMEOUT_MS=10000
SUPABASE_DB_IDLE_TIMEOUT_MS=30000
ARUBOT_SUPABASE_PERF_MONITORING=false
```

`ARUBOT_SUPABASE_PERF_MONITORING=false`는 새로 도입할 운영 플래그다. 실제 구현 시 `startPerformanceMonitoringSchedulerSupabase()`를 이 플래그로 끄는 방식이 좋다.

#### Phase B. hot path direct DB 전환

목표:

- 채팅 처리 중 자주 호출되는 DB 작업을 PostgREST가 아니라 direct `pg`로 보낸다.
- DB round-trip 수를 줄인다.

우선 전환 대상:

- `getBotSettings`: channel/sid별 TTL memory cache
- `recordAttendanceAndGetStreak`: 단일 transaction 또는 stored function
- `incrChannelPoints`: `insert ... on conflict ... do update`
- `getChannelPoints`, `listChannelPointsPage`: direct query + pagination 강제
- viewer token lookup: direct query + short TTL cache
- `live_sessions` update: batch update 우선

권장 구현:

- repository 레이어를 `server/db`로 분리한다.
- `supabase.from(...)` 사용처를 read-heavy/hot-path부터 direct query로 대체한다.
- 여러 query가 한 이벤트 안에서 이어질 경우 transaction으로 묶는다.
- `select *` 대신 필요한 컬럼만 조회한다.

#### Phase C. 운영 경량화

목표:

- 운영 서버에서 Supabase 전체 스택 의존을 줄인다.
- Postgres와 백엔드를 중심으로 안정 운영한다.

권장 구성:

```text
Nginx/Caddy
  -> AruBot backend
    -> node pg Pool or PgBouncer
    -> Postgres
```

PostgREST가 아직 필요한 경우:

```text
backend -> PostgREST -> Postgres
```

단, PostgREST는 외부 공개하지 않고 localhost 또는 private network에 둔다.

완전히 제거 가능한 조건:

- `server/supabase.js`의 모든 `supabase.from(...)` hot/normal path가 direct `pg`로 바뀜
- PostgREST schema refresh가 필요 없어짐
- Supabase REST API URL이 없어도 `initDb()`가 정상 동작하도록 구조 변경됨

### 5.5 캐시 전략

권장 TTL:

| 데이터 | 캐시 위치 | TTL | 무효화 |
| --- | --- | ---: | --- |
| bot settings | process memory 또는 Redis | 3-10초 | 설정 저장 시 즉시 삭제 |
| command rules | process memory 또는 Redis | 5-30초 | 명령어 저장/삭제 시 삭제 |
| viewer token lookup | process memory | 30-300초 | rotate 시 삭제 |
| points ranking public page | process memory 또는 Redis | 3-10초 | 포인트 대량 변경 후 삭제 |
| live status | process memory | 2-5초 | live event 수신 시 갱신 |
| app admin status | process memory | 30-300초 | admin 변경 시 삭제 |

단일 Node 프로세스라면 process memory cache로 충분하다. 여러 프로세스나 PM2 cluster를 쓸 경우 Redis를 도입한다.

### 5.6 write batching 전략

채팅/출석/포인트는 write amplification이 가장 크다.

권장:

- 출석은 이미 `attendanceDedupe`가 있으므로 DB unique key와 함께 유지한다.
- 포인트 증감은 즉시성이 반드시 필요한 화면 외에는 1-3초 단위 batch flush를 검토한다.
- live session last_update는 매 이벤트마다 쓰지 말고 최소 간격을 둔다.
- token `last_used`/`usage_count`는 매 요청마다 쓰지 말고 throttle한다.
- queue 상태 변경처럼 정확성이 중요한 write는 즉시 commit한다.

데이터 정합성 기준:

- OAuth token, API key, viewer token rotate: 즉시 write
- 포인트 결제/환불/베팅 정산: transaction 즉시 write
- 단순 조회 통계, last_used, usage_count: 지연 write 허용
- public page ranking: cache 허용

### 5.7 연결 수 제한

Supabase 공식 문서도 connection pooling이 새 연결 생성 비용을 줄이고 확장성을 개선한다고 설명한다. 자체 운영에서는 DB connection을 아껴야 하므로 다음 원칙을 둔다.

- Node 프로세스 1개 기준 `SUPABASE_DB_POOL_MAX=5`부터 시작한다.
- PM2 cluster를 늘리면 `pool max * process count`가 총 DB 연결 수가 된다.
- PostgREST를 같이 쓰면 PostgREST도 별도 DB connection을 사용한다.
- 직접 DB 접근과 PostgREST를 동시에 heavy하게 쓰지 않는다.
- 운영에서 PgBouncer를 쓰면 transaction pooling을 우선 검토한다.

예시:

```dotenv
# single process
SUPABASE_DB_POOL_MAX=5

# 2 process라면 총 direct pool 최대 10개
PM2_INSTANCES=2
SUPABASE_DB_POOL_MAX=5
```

### 5.8 백엔드 부하를 줄이는 API 정책

- public 목록 API는 pagination을 강제한다.
- `listChannelPoints()`처럼 전체 row를 읽는 endpoint는 admin export 전용으로 제한한다.
- viewer/admin 화면은 WebSocket을 우선하고 polling interval을 늘린다.
- diagnostics/performance endpoint는 admin 전용으로 제한하고 rate limit을 둔다.
- migration/bootstrap은 서버 시작 때 매번 무겁게 돌지 않도록 migration log 기반으로 최소화한다.

### 5.9 권장 최종 판단

무료 티어 한계를 피하려고 모든 Supabase 컴포넌트를 그대로 자체 운영하면 비용은 줄어도 서버 부하는 커질 수 있다. AruBot에는 이미 Express API, OAuth session, WebSocket, direct `pg` 코드가 있으므로 다음이 가장 현실적이다.

1. 로컬 Supabase CLI로 데이터 이관과 호환성을 검증한다.
2. 운영은 CLI 스택 공개가 아니라 자체 서버 Postgres 중심으로 설계한다.
3. `supabase.from(...)`는 전환기 호환용으로만 남기고 hot path부터 direct `pg`로 옮긴다.
4. cache, batching, pagination, connection pool 제한으로 DB 부하를 낮춘다.

## 6. Supabase/Postgres DB 타입 분리 단계

### 6.1 목표 상태

최종 목표는 `.env`에서 DB 타입을 명시적으로 선택하는 것이다.

```dotenv
# supabase | postgres
ARUBOT_DB_PROVIDER=postgres

# Supabase provider에서만 사용
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=

# Postgres provider에서 사용
POSTGRES_URL=postgresql://arubot:password@127.0.0.1:5432/arubot
POSTGRES_POOL_MAX=5
POSTGRES_CONNECT_TIMEOUT_MS=5000
POSTGRES_STATEMENT_TIMEOUT_MS=10000
POSTGRES_IDLE_TIMEOUT_MS=30000
```

운영 원칙:

- `ARUBOT_DB_PROVIDER=supabase`: Supabase 공식 서버 또는 로컬 Supabase CLI 스택에 연결한다.
- `ARUBOT_DB_PROVIDER=postgres`: Supabase URL/key를 사용하지 않는다.
- `postgres` provider에서는 PostgREST, Studio, Auth, Storage, Realtime을 운영 필수 요소로 두지 않는다.
- 두 provider는 같은 `public` 스키마와 같은 migration SQL을 사용한다.
- 데이터 이동은 provider 변환이 아니라 PostgreSQL dump/restore 또는 logical copy로 처리한다.

이렇게 해야 Supabase와 Postgres 간 이동이 단순해진다. Supabase도 내부 DB는 PostgreSQL이므로, 앱 스키마를 Supabase 전용 기능에 묶지 않으면 같은 migration과 같은 dump로 왕복할 수 있다.

### 6.2 중복 작업을 막는 설계 원칙

중복 작업을 피하려면 "기능별로 Supabase용 코드와 Postgres용 코드를 따로 두 벌 작성"하지 않는다.

원칙:

- DB schema는 하나만 둔다.
- migration runner도 하나만 둔다.
- repository interface도 하나만 둔다.
- provider별 차이는 connection adapter에만 둔다.
- 비즈니스 로직은 provider를 몰라야 한다.
- provider별 테스트는 같은 계약 테스트를 재사용한다.

권장 구조:

```text
server/db/
  index.js                 # ARUBOT_DB_PROVIDER를 읽고 provider 선택
  config.js                # env parsing/validation
  migrations.js            # 공통 migration runner
  postgres-client.js       # pg Pool 생성
  supabase-client.js       # Supabase REST client + direct pg Pool
  repositories/
    settings.js            # provider 독립 repository API
    points.js
    attendance.js
    tokens.js
    roulette.js
    automation.js
```

단기적으로는 `server/supabase.js`를 한 번에 갈아엎지 않는다. 먼저 repository interface를 만들고, 기존 함수들을 provider 뒤로 옮긴다. 이렇게 해야 한 단계마다 동작을 검증할 수 있다.

### 6.3 단계별 교체 로드맵

아래 단계를 순서대로 완료한다. 한 단계를 완료하기 전 다음 단계로 넘어가지 않는다.

#### Stage 0. 기준선 고정

목표:

- 현재 Supabase 기반 동작을 기준선으로 고정한다.
- 이후 provider 교체 중 기능이 깨졌는지 비교할 수 있게 만든다.

작업:

- 현재 `.env`를 백업한다.
- 원격 Supabase `public` 스키마와 데이터를 백업한다.
- `npm test` 결과를 기록한다.
- 주요 API smoke test 목록을 확정한다.
- 현재 row count와 주요 table checksum 또는 count를 저장한다.

완료 조건:

- 백업 파일이 생성되어 있고 복원 테스트가 가능하다.
- 기준 테스트 결과가 문서화되어 있다.
- 주요 테이블 row count가 기록되어 있다.

#### Stage 1. env provider 설정 추가

목표:

- `.env`에서 `supabase`와 `postgres` provider를 선택할 수 있게 한다.
- 아직 실제 DB 접근 방식은 크게 바꾸지 않는다.

작업:

- `ARUBOT_DB_PROVIDER=supabase|postgres`를 도입한다.
- `postgres` provider에서 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 없어도 서버가 시작될 수 있는 목표를 정의한다.
- provider별 필수 env 검증 규칙을 만든다.
- `.env.example`과 README에 provider별 예시를 추가한다.

완료 조건:

- `ARUBOT_DB_PROVIDER=supabase`에서는 기존 동작이 유지된다.
- `ARUBOT_DB_PROVIDER=postgres`에서 필요한 env 목록이 명확하다.
- 운영에서는 `postgres` provider가 Supabase 공식 서버 URL/key를 요구하지 않는다는 정책이 문서화되어 있다.

#### Stage 2. 공통 migration runner 분리

목표:

- Supabase와 Postgres가 같은 migration SQL을 같은 방식으로 적용한다.
- schema 생성 위치를 `server/supabase.js` 내부 bootstrap에서 공통 migration으로 이동할 준비를 한다.

작업:

- `server/migrations/*.sql`을 공통 source of truth로 선언한다.
- migration log table을 provider 공통으로 사용한다.
- `ensureSchema()`에서만 생성되는 테이블/컬럼을 migration 파일로 정리할 목록을 만든다.
- migration runner가 `SUPABASE_DB_URL` 또는 `POSTGRES_URL` 중 provider별 direct DB URL을 사용하게 설계한다.

완료 조건:

- 빈 Postgres DB에 migration만 적용해 기본 schema가 생성되는 계획이 확정된다.
- Supabase에서 만든 dump도 같은 schema로 복원 가능하다는 전제가 유지된다.
- 런타임 bootstrap은 보조 안전장치로만 남기고, 최종 source of truth가 migration임이 명확하다.

#### Stage 3. DB repository 계약 정의

목표:

- 비즈니스 로직이 Supabase client를 직접 알지 않게 한다.
- provider별 구현 교체를 함수 계약 아래로 숨긴다.

작업:

- 현재 `server/supabase.js` export 함수를 기능군별로 나눈다.
- settings, tokens, sessions, points, attendance, roulette, viewer state, predictions, automation, platform accounts로 repository 계약을 정의한다.
- 각 계약의 입력/출력 shape를 기존 API와 동일하게 유지한다.
- 계약 테스트를 만든다.

완료 조건:

- route/controller 코드는 repository API만 호출하도록 전환 계획이 있다.
- Supabase provider와 Postgres provider가 같은 계약을 구현해야 한다.
- 중복 비즈니스 로직 없이 provider 내부는 query 방식만 다르게 둘 수 있다.

#### Stage 4. Supabase provider를 기존 동작으로 래핑

목표:

- 먼저 기존 Supabase 구현을 provider 인터페이스 뒤로 넣는다.
- 이 단계에서는 기능 변경을 하지 않는다.

작업:

- `ARUBOT_DB_PROVIDER=supabase`에서 기존 Supabase client와 direct pg pool을 사용한다.
- 기존 `server/supabase.js` 함수를 wrapper 또는 adapter로 연결한다.
- route/controller import를 새 db module로 점진 전환한다.

완료 조건:

- provider 추상화 후에도 `supabase` provider 기준 기존 테스트가 통과한다.
- 기존 기능 동작이 바뀌지 않는다.
- 이 단계까지는 운영 DB 변경이 없다.

#### Stage 5. Postgres provider 구현

목표:

- `ARUBOT_DB_PROVIDER=postgres`에서 Supabase URL/key 없이 direct Postgres만으로 동작하게 한다.
- 운영 경량화의 핵심 단계다.

작업:

- `POSTGRES_URL` 기반 `pg Pool`을 만든다.
- 로컬/운영 Postgres SSL 옵션을 env로 분기한다.
- repository 계약을 direct SQL로 구현한다.
- hot path부터 Postgres provider 구현 우선순위를 둔다.
- `supabase.from(...)`에 의존하는 코드는 provider 밖에서 제거한다.

우선순위:

1. tokens/sessions/API keys
2. bot settings/rules
3. points/attendance
4. viewer tokens/viewer state/PVD queue
5. roulette sessions
6. predictions
7. platform accounts/tokens
8. automation jobs/action blueprints
9. diagnostics/performance monitoring

완료 조건:

- `ARUBOT_DB_PROVIDER=postgres`에서 서버가 Supabase URL/key 없이 시작한다.
- 주요 API smoke test가 Postgres provider에서 통과한다.
- 운영 hot path가 direct Postgres로 동작한다.

#### Stage 6. 데이터 이동 절차 확정

목표:

- Supabase에서 Postgres로, Postgres에서 Supabase로 데이터를 안전하게 이동할 수 있게 한다.

작업:

- `public` 스키마 dump/restore 절차를 표준화한다.
- row count 검증 스크립트를 만든다.
- 민감 token 복호화 가능 여부를 검증한다.
- sequence/identity 값을 restore 후 보정한다.
- provider별 connection string만 바꾸면 같은 dump를 사용할 수 있게 한다.

Supabase -> Postgres:

```powershell
pg_dump $env:SUPABASE_DB_URL `
  --schema=public `
  --format=custom `
  --blobs `
  --no-owner `
  --no-acl `
  --file backups/supabase-public.dump

pg_restore `
  --dbname $env:POSTGRES_URL `
  --schema=public `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  backups/supabase-public.dump
```

Postgres -> Supabase:

```powershell
pg_dump $env:POSTGRES_URL `
  --schema=public `
  --format=custom `
  --blobs `
  --no-owner `
  --no-acl `
  --file backups/postgres-public.dump

pg_restore `
  --dbname $env:SUPABASE_DB_URL `
  --schema=public `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  backups/postgres-public.dump
```

완료 조건:

- 양방향 dump/restore 절차가 문서화되어 있다.
- 복원 후 row count와 주요 기능 smoke test가 통과한다.
- schema drift 없이 같은 migration chain을 사용한다.

구현된 보조 명령:

```powershell
npm run db:migration-status
npm run db:dump-public -- --target=supabase --out=backups/supabase-public.dump
npm run db:restore-public -- --target=postgres --file=backups/supabase-public.dump --confirm=restore-public
npm run db:repair-sequences -- --target=postgres
npm run db:counts -- --target=supabase
npm run db:counts -- --target=postgres
npm run db:compare-counts
npm run db:compare-checksums
npm run db:diff-table -- --table=sessions
npm run db:sync-volatile-tables
npm run db:cutover-preflight
npm run db:cutover-verify
npm run db:cutover-rehearsal
npm run db:cutover-rehearsal -- --execute --confirm=restore-public --base=http://localhost:3001
npm run db:switch-to-postgres
npm run db:switch-to-postgres -- --execute --confirm=switch-to-postgres --base=<백엔드 URL>
npm run api:smoke -- --base=http://localhost:3001 --expect-provider=postgres
```

`db:migration-status`는 `migration_log` 기준으로 이미 성공한 migration과 pending migration을 보여준다. `db:migrate`는 성공 기록이 있는 migration 파일을 다시 실행하지 않는다. `db:restore-public`은 대상 `public` 스키마에 `--clean --if-exists`를 사용하므로 반드시 `--confirm=restore-public`을 요구한다. `db:repair-sequences`는 restore 후 identity/sequence 값을 현재 최대 id 다음 값으로 보정한다. `db:compare-counts`는 `SUPABASE_DB_URL`과 `POSTGRES_URL`을 모두 읽어 같은 테이블 목록의 row count를 비교한다. 단, `migration_log`는 전환 중 Postgres에서 새 실행 기록이 추가될 수 있는 운영 메타데이터라 기본 비교에서 제외한다. `db:compare-checksums`는 주요 테이블의 count와 row fingerprint를 UTC/ISO 세션 기준으로 비교한다. `db:diff-table`은 checksum 실패 시 값은 숨기고 row key와 다른 컬럼명을 보여주는 진단 명령이다. `--show-values`를 붙이면 실제 값도 출력하므로 토큰/secret 테이블에서는 사용하지 않는다. `db:sync-volatile-tables`는 dump 직후 OAuth refresh나 명령 실행으로 바뀔 수 있는 `platform_tokens`, `bot_counter_values`를 Supabase에서 Postgres로 한 번 더 최신 동기화한다. `db:cutover-preflight`는 `pg_dump`/`pg_restore` 설치, 양쪽 DB 연결, URL 오설정, Postgres target 상태를 먼저 점검한다. `db:cutover-verify`는 Postgres provider 전환 전후의 DB 상태를 한 번에 점검한다. `db:cutover-rehearsal`은 preflight, dump, restore, volatile table sync, restore 직후 count/checksum compare, migration, sequence repair, provider smoke, API smoke를 순서대로 조율한다. checksum 비교는 Postgres bootstrap이 `updated_at`, `last_seen`, `last_used` 같은 런타임성 컬럼을 갱신하기 전에 수행한다. 기본은 dry-run이며 실제 실행에는 `--execute --confirm=restore-public`이 필요하다. `db:switch-to-postgres`는 dump 전 PM2 백엔드를 멈춰 Supabase 원본 쓰기를 차단하고, rehearsal 검증 성공 후 `.env`를 `ARUBOT_DB_PROVIDER=postgres`로 바꾸고 Supabase runtime env를 비운 뒤 PM2 reload와 API smoke까지 수행하는 원클릭 전환 명령이다. 실패가 `.env` 전환 전에 발생하면 기존 Supabase 설정으로 PM2 runtime을 다시 띄운다. 기본은 dry-run이며 실제 실행에는 `--execute --confirm=switch-to-postgres`가 필요하다. 운영 백엔드를 멈출 수 없는 특수 상황에서만 `--skip-runtime-stop`을 사용한다. `api:smoke`는 실행 중인 백엔드의 read-only endpoint를 호출해 API와 provider 노출 상태를 확인한다. `ARUBOT_DB_PROVIDER=postgres` 환경에서 양쪽 DB를 동시에 읽는 명령을 일회성으로 실행할 때는 `ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES=true`를 별도 shell에만 설정한다. `POSTGRES_URL`이 공식 Supabase host를 가리키면 기본적으로 차단되며, `ARUBOT_ALLOW_SUPABASE_POSTGRES_URL=true`는 명시적인 진단 shell에서만 사용한다.

#### 원클릭 전환 전 설정

실행 전 `.env`에는 아래 값이 준비되어 있어야 한다.

```dotenv
ARUBOT_DB_PROVIDER=supabase
SUPABASE_DB_URL=<현재 Supabase direct database URL>
SUPABASE_URL=<현재 Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<현재 Supabase service role key>
POSTGRES_URL=<로컬 또는 self-hosted Postgres URL>
POSTGRES_POOL_MAX=5
POSTGRES_CONNECT_TIMEOUT_MS=5000
POSTGRES_STATEMENT_TIMEOUT_MS=10000
POSTGRES_IDLE_TIMEOUT_MS=30000
POSTGRES_SSL=false
ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES=false
ARUBOT_ALLOW_SUPABASE_POSTGRES_URL=false
ARUBOT_SUPABASE_PERF_MONITORING=false
```

실행 전 시스템에는 아래 조건이 필요하다.

- `pg_dump`와 `pg_restore`가 PATH에서 실행 가능해야 한다.
- `POSTGRES_URL`은 공식 Supabase host가 아닌 로컬 또는 self-hosted Postgres여야 한다.
- `SUPABASE_DB_URL`과 `POSTGRES_URL`은 서로 다른 DB여야 한다.
- Postgres 대상 DB는 restore로 `public` schema가 정리되어도 되는 DB여야 한다.
- PM2 운영 전환까지 한 번에 하려면 `pm2`가 설치되어 있고 `ecosystem.config.cjs`로 reload 가능해야 한다.
- PM2 reload를 원하지 않으면 `--skip-pm2-reload`를 붙이고, 이후 직접 백엔드를 재시작해야 한다.
- 실행 중인 백엔드 API smoke를 건너뛰려면 `--skip-api-smoke`를 붙이고, 이후 직접 `npm run api:smoke -- --base=<백엔드 URL> --expect-provider=postgres`를 실행해야 한다.

원클릭 실행 순서:

```powershell
npm run db:switch-to-postgres
npm run db:switch-to-postgres -- --execute --confirm=switch-to-postgres --base=<백엔드 URL>
```

첫 번째 명령은 dry-run으로 실행 계획만 출력한다. 두 번째 명령은 dump/restore/검증이 모두 성공한 뒤 `.env`를 수정한다. 수정 전 `.env.pre-postgres-<timestamp>.bak` 백업이 자동 생성된다.

#### Stage 7. dual-run 검증

목표:

- 같은 데이터에서 Supabase provider와 Postgres provider 결과가 일치하는지 확인한다.

작업:

- 동일 dump를 Supabase local과 Postgres local에 각각 복원한다.
- read-only API 결과를 비교한다.
- write API는 테스트 채널/테스트 계정으로만 비교한다.
- 포인트/출석/베팅처럼 정합성이 중요한 기능은 transaction 결과를 비교한다.

완료 조건:

- 주요 read API 응답이 provider 간 일치한다.
- 주요 write workflow 후 row count와 핵심 필드가 일치한다.
- provider 차이로 인한 API 응답 shape 변화가 없다.

#### Stage 8. 운영 전환

목표:

- 운영 `.env`를 `ARUBOT_DB_PROVIDER=postgres`로 전환한다.
- Supabase 공식 서버 의존을 제거한다.

작업:

- 최종 Supabase 백업을 생성한다.
- 운영 Postgres에 restore한다.
- `analyze`를 실행한다.
- 운영 `.env`에서 `ARUBOT_DB_PROVIDER=postgres`, `POSTGRES_URL`을 설정한다.
- 운영 `.env`에서 Supabase 공식 URL/key를 제거하거나 비워둔다.
- 서버를 재시작한다.
- smoke test를 실행한다.
- 로그와 DB connection count를 확인한다.

완료 조건:

- 운영 서버가 Supabase 공식 서버 없이 동작한다.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 없어도 `postgres` provider에서 정상 동작한다.
- 주요 기능 smoke test가 통과한다.
- rollback용 Supabase 백업이 보관되어 있다.

#### Stage 9. Supabase 의존 제거 및 완료 선언

목표:

- Postgres provider 운영을 안정화하고 Supabase provider를 optional compatibility로 격리한다.

작업:

- 남은 `supabase.from(...)` hot path가 없는지 검색한다.
- `postgres` provider에서 PostgREST schema refresh가 실행되지 않는지 확인한다.
- Supabase 공식 서버로 나가는 네트워크 요청이 없는지 로그로 확인한다.
- 문서의 운영 절차를 Postgres 기준으로 갱신한다.
- 필요하면 Supabase provider는 개발/복구용 optional provider로만 유지한다.

완료 조건:

- `ARUBOT_DB_PROVIDER=postgres` 운영에서 Supabase 공식 서버 접속이 없다.
- DB schema, migration, repository 테스트가 Postgres 기준으로 통과한다.
- 데이터 이관 검증과 기능 smoke test가 통과한다.
- 이 조건이 모두 충족되면 "DB 교체가 완벽히 끝났다"고 판단한다.

### 6.4 코드 교체 후 백엔드에서 해야 할 일

코드 교체가 끝난 뒤 백엔드 운영자는 아래 순서대로 실행한다.

1. 운영 배포를 멈추거나 maintenance window를 연다.
2. 현재 Supabase DB를 전체 백업한다.
3. 현재 Supabase `public` 스키마를 별도 백업한다.
4. 운영 Postgres 서버를 준비한다.
5. `npm run db:cutover-preflight`로 `pg_dump`/`pg_restore`, 양쪽 DB 연결, URL 오설정을 확인한다.
6. 운영 Postgres에 migration을 적용한다.
7. Supabase `public` dump를 운영 Postgres에 restore한다.
8. `npm run db:repair-sequences -- --target=postgres`로 sequence/identity 값을 보정한다.
9. `npm run db:compare-counts`로 row count를 검증한다.
10. `npm run db:compare-checksums`로 핵심 테이블 fingerprint를 비교한다.
11. `analyze`를 실행한다.
12. 운영 `.env`를 `ARUBOT_DB_PROVIDER=postgres`와 `POSTGRES_URL` 기준으로 바꾼다.
13. Supabase 공식 서버 URL/key를 운영 `.env`에서 제거하거나 비운다.
14. `npm run db:provider-smoke`로 Postgres provider 연결과 필수 테이블을 확인한다.
15. `npm run db:cutover-verify`로 pending migration, 필수 테이블, sequence 상태를 확인한다.
16. 백엔드 서버를 재시작한다.
17. `npm run api:smoke -- --base=<백엔드 URL> --expect-provider=postgres`를 실행한다.
18. 로그인, 토큰 저장, 포인트, 출석, 룰렛, PVD queue, 자동화 job을 테스트한다.
19. 로그에서 Supabase 공식 서버로 나가는 요청이 없는지 확인한다.
20. DB connection count, CPU, memory, slow query를 확인한다.
21. 문제가 있으면 백업 기준으로 rollback한다.
22. 문제가 없으면 Postgres provider 운영을 확정한다.
23. 일정 기간 후 Supabase provider를 optional 복구 경로로만 남기거나 제거한다.

### 6.5 완료 선언 기준

다음 조건을 모두 만족해야 DB 교체 완료로 본다.

- 운영 `.env`가 `ARUBOT_DB_PROVIDER=postgres`다.
- 운영 백엔드는 `POSTGRES_URL`만으로 DB 기능을 수행한다.
- 운영 `POSTGRES_URL`은 공식 Supabase host가 아니다.
- 운영 백엔드가 Supabase 공식 `SUPABASE_URL`에 의존하지 않는다.
- 모든 migration이 Postgres DB에 적용되어 있다.
- Supabase에서 가져온 데이터 row count가 Postgres에서 일치한다.
- 주요 기능 smoke test가 통과한다.
- hot path가 direct Postgres로 동작한다.
- 백업과 rollback 절차가 존재한다.
- 운영 로그에서 Supabase 공식 서버 접근이 없다.

이 조건이 모두 충족된 뒤에만 "DB 교체가 완벽히 끝났다"고 말한다.

### 6.6 현재 코드 반영 상태

현재 구현된 항목:

- `ARUBOT_DB_PROVIDER=supabase|postgres` provider 선택
- `POSTGRES_URL` 기반 direct Postgres 연결
- `POSTGRES_POOL_MAX`, `POSTGRES_CONNECT_TIMEOUT_MS`, `POSTGRES_STATEMENT_TIMEOUT_MS`, `POSTGRES_IDLE_TIMEOUT_MS`, `POSTGRES_SSL` 설정
- `postgres` provider에서 Supabase URL/key 없이 `initDb()` 실행
- `postgres` provider에서 공식 Supabase host를 가리키는 `POSTGRES_URL` 기본 차단
- `postgres` provider 서버 런타임에서 Supabase URL/key/env 혼입 차단
- `postgres` provider에서 `supabase.from(...)` 기존 호출을 direct `pg` 쿼리로 처리하는 호환 어댑터
- provider별 direct DB URL을 사용하는 migration/maintenance 조건
- `postgres` provider에서 PostgREST schema refresh skip
- `.env.example`과 README의 provider 설정 문서화
- provider 회귀 테스트
- `npm run db:migrate` migration/bootstrap 실행 명령
- `npm run db:migration-status` migration 적용 상태 확인
- `npm run db:dump-public` public schema dump 생성
- `npm run db:restore-public` public schema restore 실행
- `npm run db:repair-sequences` restore 후 identity/sequence 보정
- `npm run db:counts` provider별 row count 출력
- `npm run db:compare-counts` Supabase/Postgres row count 비교
- `npm run db:compare-checksums` 주요 테이블 fingerprint 비교
- `npm run db:provider-smoke` 운영 provider 연결/필수 테이블 점검
- `npm run db:cutover-preflight` cutover 전 도구/URL/DB 연결 점검
- `npm run db:cutover-verify` 최종 전환 검증 묶음
- `npm run db:cutover-rehearsal` dump/restore/검증/API smoke 순차 리허설
- `npm run db:switch-to-postgres` 데이터 이전, `.env` 전환, PM2 reload, API smoke 원클릭 전환
- `npm run api:smoke` 실행 중인 백엔드 read-only API smoke test

아직 운영자가 직접 수행해야 하는 항목:

- 실제 운영 Postgres 서버 준비
- Supabase `public` schema/data dump
- 운영 Postgres restore
- row count 비교와 주요 기능 smoke test
- 운영 `.env`를 `ARUBOT_DB_PROVIDER=postgres`로 전환
- 운영 로그에서 Supabase 공식 서버 접근이 없는지 확인

따라서 현재 상태는 "코드상 Postgres provider 전환 기반 구현 완료"다. 실제 운영 DB 교체 완료 선언은 Stage 8과 Stage 9의 운영 검증까지 끝난 뒤에만 한다.

## 7. 사전 준비

필수 도구:

- Docker Desktop 또는 Docker 호환 런타임
- Supabase CLI
- `pg_dump`, `pg_restore`, `psql`
- Node.js 22.x, npm 10+

공식 문서 기준으로 Supabase CLI 로컬 개발은 Docker 컨테이너로 로컬 Supabase 스택을 실행한다.

참고:

- https://supabase.com/docs/guides/local-development
- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/docs/guides/local-development/cli/config
- https://supabase.com/docs/guides/deployment/database-migrations

설치 확인 명령:

```powershell
node --version
npm --version
docker version
npx supabase --version
where.exe pg_dump
where.exe pg_restore
where.exe psql
```

`pg_dump`, `pg_restore`, `psql`이 없다면 PostgreSQL client tools를 설치한다. Windows에서는 PostgreSQL 공식 설치 프로그램에서 command line tools를 포함하거나, Docker 컨테이너 안의 `pg_dump`를 사용하는 방식도 가능하다. 다만 반복 작업 편의성은 로컬 client tools 설치가 더 좋다.

## 8. 로컬 Supabase 초기화 상세 절차

아직 프로젝트에 `supabase/config.toml`이 없으므로 최초 1회 초기화가 필요하다.

PowerShell 기준:

```powershell
cd D:\AruBot
npm install
npx supabase init
npx supabase start
npx supabase status
```

`supabase status`에서 다음 값을 확인한다.

- API URL: 보통 `http://127.0.0.1:54321`
- DB URL: 보통 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- anon key
- service_role key
- Studio URL: 보통 `http://127.0.0.1:54323`

처음 `supabase start`를 실행하면 Docker image를 내려받기 때문에 시간이 걸릴 수 있다. 이후 실행은 더 빠르다.

포트 충돌이 나면 다음을 확인한다.

```powershell
netstat -ano | findstr ":54321"
netstat -ano | findstr ":54322"
netstat -ano | findstr ":54323"
```

로컬 스택을 중지할 때:

```powershell
npx supabase stop
```

로컬 DB를 초기화할 때:

```powershell
npx supabase db reset
```

주의: `db reset`은 로컬 DB 데이터를 지운다. 원격 DB에는 영향을 주지 않는다.

## 9. 백엔드 연결 상세 절차

### 9.1 `.env`에서 로컬 Supabase로 전환

프로젝트 `.env` 전환 예시는 다음 형태가 된다.

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_SERVICE_ROLE_KEY=<supabase status의 service_role key>
```

중요:

- `SUPABASE_SERVICE_ROLE_KEY`는 원격 Supabase key가 아니라 `npx supabase status`가 보여주는 로컬 service role key를 넣는다.
- `SUPABASE_URL`은 DB URL이 아니라 Supabase API URL이다.
- `SUPABASE_DB_URL`은 Postgres direct URL이다.
- `SUPABASE_ANON_KEY`는 현재 백엔드에서 service role key fallback이 없을 때만 의미가 있다. 서버 운영 기준으로는 service role key를 명시하는 편이 낫다.

백엔드와 프론트엔드를 함께 로컬에서 띄우는 경우 다음 값도 확인한다.

```dotenv
SERVER_PORT=3001
NEXT_PUBLIC_API_BASE=http://localhost:3001
APP_REDIRECT_AFTER_LOGIN=http://localhost:3000/?auth=success
CHZZK_REDIRECT_URI=http://localhost:3001/api/auth/chzzk/callback
CIME_REDIRECT_URI=http://localhost:3001/api/auth/cime/callback
YOUTUBE_REDIRECT_URI=http://localhost:3001/api/auth/youtube/callback
```

OAuth redirect URI는 외부 개발자 콘솔에도 같은 값이 등록되어 있어야 한다. 로컬 DB 연결 자체와는 별개지만, 로그인 테스트에는 필요하다.

### 9.2 백엔드가 Supabase에 연결되는 순서

`server/index.js` 기준 시작 순서는 다음과 같다.

1. `dotenv.config()`가 `.env`를 읽는다.
2. `validateSecretEncryptionConfig()`가 token 암호화 키 설정을 검사한다.
3. `initDb()`가 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`로 Supabase client를 만든다.
4. `SUPABASE_DB_URL`이 있으면 `ensureSchema()` 계열 bootstrap이 direct Postgres로 기본 테이블을 보정한다.
5. `refreshPostgRESTSchema()`가 PostgREST schema cache refresh를 시도한다.
6. `ensureRouletteSessionsPg()`가 roulette table을 보정한다.
7. `runMigrations()`가 `server/migrations/*.sql`을 파일명 순서대로 실행한다.
8. `migrateChannelIdData()`와 integrity check가 실행된다.

따라서 로컬 연결 성공 조건은 세 가지다.

- `SUPABASE_URL`로 local PostgREST에 HTTP 요청이 가능해야 한다.
- `SUPABASE_SERVICE_ROLE_KEY`가 local Supabase key여야 한다.
- `SUPABASE_DB_URL`로 local Postgres direct connection이 가능해야 한다.

### 9.3 연결 smoke test

Supabase API 확인:

```powershell
$headers = @{
  "apikey" = $env:SUPABASE_SERVICE_ROLE_KEY
  "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}
Invoke-RestMethod -Uri "$env:SUPABASE_URL/rest/v1/" -Headers $headers
```

Postgres direct 연결 확인:

```powershell
psql $env:SUPABASE_DB_URL -c "select now();"
```

프로젝트 백엔드 실행:

```powershell
npm run server
```

정상 로그 기준:

- Supabase client 초기화 경고가 없어야 한다.
- `SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing` 경고가 없어야 한다.
- migration 실행 단계에서 connection error가 없어야 한다.
- SSL 관련 `server does not support SSL connections` 오류가 없어야 한다.

현재 코드에서는 로컬 Postgres SSL 이슈가 날 수 있으므로 실제 구현 단계에서 `pgClientOptions()` SSL 분기를 먼저 넣는 것이 좋다.

### 9.4 프론트엔드 연결

프론트엔드는 Supabase에 직접 붙지 않고 API server를 호출한다.

```powershell
npm run dev
```

로컬 프론트엔드가 백엔드를 보게 하려면 `.env`에 다음을 둔다.

```dotenv
NEXT_PUBLIC_API_BASE=http://localhost:3001
API_BASE=http://localhost:3001
SERVER_API_BASE=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`NEXT_PUBLIC_API_BASE`가 비어 있으면 코드의 rewrite/default 동작에 의존하게 되므로, 로컬 DB 전환 검증 단계에서는 명시하는 편이 안전하다.

### 9.5 로컬 Supabase Studio 사용

`npx supabase status`의 Studio URL로 접속한다.

보통:

```text
http://127.0.0.1:54323
```

Studio에서 확인할 항목:

- Table Editor에 `public` 테이블이 보이는지
- SQL Editor에서 row count 쿼리가 실행되는지
- API Docs에서 local URL/key가 표시되는지
- migration 후 신규 컬럼/인덱스가 반영됐는지

최종 구현 시 `.env.example`에는 로컬 예시를 주석으로 넣고, 실제 `.env`는 사용자가 선택적으로 바꾸도록 한다.

## 10. 데이터 백업 및 이관 전략

### 10.1 원격 전체 백업

먼저 롤백용 전체 백업을 만든다. 이 백업은 로컬 복원용이 아니라 사고 대응용이다.

```bash
mkdir -p backups
pg_dump "$REMOTE_SUPABASE_DB_URL" \
  --format=custom \
  --blobs \
  --no-owner \
  --no-acl \
  --file backups/remote-full-$(date +%Y%m%d-%H%M%S).dump
```

Windows PowerShell에서는 날짜 파일명을 별도로 만든다.

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force backups | Out-Null
pg_dump $env:REMOTE_SUPABASE_DB_URL `
  --format=custom `
  --blobs `
  --no-owner `
  --no-acl `
  --file "backups/remote-full-$stamp.dump"
```

### 10.2 로컬 복원용 public 스키마 백업

로컬 Supabase 내부 스키마까지 덮어쓰지 않기 위해 앱 데이터가 있는 `public` 스키마를 중심으로 백업한다.

```bash
pg_dump "$REMOTE_SUPABASE_DB_URL" \
  --schema=public \
  --format=custom \
  --blobs \
  --no-owner \
  --no-acl \
  --file backups/remote-public.dump
```

### 10.3 로컬 DB 복원

로컬 Supabase를 실행한 뒤 복원한다.

```bash
pg_restore \
  --dbname "$LOCAL_SUPABASE_DB_URL" \
  --schema=public \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  backups/remote-public.dump
```

주의:

- `--clean --if-exists`는 로컬 `public` 스키마의 기존 앱 테이블을 지운 뒤 복원한다.
- 로컬에서 이미 테스트 데이터가 있다면 먼저 `supabase db dump --local --data-only`로 별도 백업한다.
- Supabase Auth 사용 데이터가 필요하다면 `auth` 스키마 복원 계획을 별도로 세워야 한다. 현재 AruBot은 자체 `sessions`, `app_users`, OAuth token 저장을 주로 사용하므로 1차 범위는 `public`으로 제한한다.

## 11. 마이그레이션 정합성 검증

복원 후 다음 순서로 정합성을 맞춘다.

1. 서버를 로컬 Supabase env로 실행해 `initDb()`와 `ensureSchema()`를 통과시킨다.
2. `runMigrations()`가 `server/migrations`를 파일명 순서대로 실행하는지 확인한다.
3. 누락 컬럼/인덱스가 있는지 검사한다.

검증 쿼리 예시:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select tablename, indexname
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select migration_name, status, executed_at
from migration_log
order by executed_at desc;
```

현재 마이그레이션과 런타임 bootstrap이 일부 중복되므로, 단기적으로는 idempotent SQL을 유지한다. 장기적으로는 `server/supabase.js`의 schema creation과 `server/migrations`를 분리해 마이그레이션을 단일 source of truth로 만드는 것이 좋다.

## 12. 코드 변경 계획

이번 문서는 기획용이며 아직 구현하지 않는다. 실제 구현 시 필요한 변경은 다음으로 제한한다.

### 12.1 로컬 DB SSL 분기

현재 `pgClientOptions()`는 항상 다음 옵션을 사용한다.

```js
ssl: { rejectUnauthorized: false }
```

로컬 Supabase direct DB는 일반적으로 SSL을 사용하지 않으므로, 다음 정책으로 바꾼다.

- `SUPABASE_DB_SSL=false`면 SSL 비활성화
- DB host가 `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`이면 SSL 비활성화
- URL query에 `sslmode=disable`이 있으면 SSL 비활성화
- 그 외 원격 URL은 기존처럼 SSL 사용

### 12.2 개발 스크립트 추가

`package.json`에 다음 스크립트를 추가하는 것을 권장한다.

```json
{
  "supabase:init": "npx supabase init",
  "supabase:start": "npx supabase start",
  "supabase:stop": "npx supabase stop",
  "supabase:status": "npx supabase status",
  "supabase:reset": "npx supabase db reset"
}
```

단, `supabase:init`은 최초 1회 명령이므로 자동 dev script에 묶지 않는다.

### 12.3 환경 변수 문서화

`.env.example`과 README에 로컬 Supabase 예시를 추가한다.

실제 `.env`는 secrets가 들어 있으므로 자동 덮어쓰지 않는다. 사용자가 원격/로컬 env 파일을 나누고 싶다면 다음 구조를 권장한다.

- `.env`: 현재 실행 대상
- `.env.remote.example`: 원격 Supabase 형태 예시
- `.env.local-supabase.example`: 로컬 Supabase 형태 예시

## 13. 성능 최적화 계획

### 13.1 복원 직후 통계 갱신

복원 후 planner 통계가 부정확할 수 있으므로 `ANALYZE`를 실행한다.

```sql
analyze;
```

테이블별로 더 명확히 실행하려면 다음 테이블을 우선한다.

- `sessions`
- `tokens`
- `bot_settings`
- `bot_rules`
- `roulette_sessions`
- `channel_tokens`
- `channel_viewer_tokens`
- `channel_points_balances`
- `video_donation_queue`
- `viewer_playback_state`
- `platform_accounts`
- `platform_tokens`
- `prediction_events`
- `prediction_bets`
- `automation_jobs`

### 13.2 주요 조회 경로 확인

전환 후 `EXPLAIN (ANALYZE, BUFFERS)`로 확인할 쿼리:

- viewer token lookup
- API key owner lookup
- active sessions lookup
- point ranking
- roulette session history
- video donation active queue
- automation job claim
- prediction active event lookup

예시:

```sql
explain (analyze, buffers)
select *
from channel_viewer_tokens
where token = $1 and is_active = true
limit 1;

explain (analyze, buffers)
select user_id, username, points
from channel_points_balances
where channel_uid = $1
order by points desc
limit 50;
```

### 13.3 인덱스 사용률 점검

현재 `003_performance_optimization_indexes.sql`에는 `analyze_channel_query_performance()`, `monitor_index_usage()`, `get_performance_recommendations()`가 있다. 로컬 전환 후 다음을 실행한다.

```sql
select * from analyze_channel_query_performance();
select * from monitor_index_usage();
select * from get_performance_recommendations();
```

주의:

- 로컬은 트래픽이 적어 인덱스 사용 통계가 운영과 다를 수 있다.
- 복원 직후에는 통계가 충분하지 않으므로 API 회귀 테스트를 한 번 돌린 뒤 확인한다.

### 13.4 연결 풀 튜닝

로컬 기본값은 다음 정도면 충분하다.

```dotenv
SUPABASE_DB_POOL_MAX=5
SUPABASE_DB_CONNECT_TIMEOUT_MS=5000
SUPABASE_DB_STATEMENT_TIMEOUT_MS=15000
SUPABASE_DB_IDLE_TIMEOUT_MS=30000
```

운영 부하를 로컬에서 재현하는 경우에만 pool max를 10 이상으로 올린다.

## 14. 데이터 검증 체크리스트

복원 전후 row count를 비교한다.

```sql
select 'tokens' as table_name, count(*) from tokens
union all select 'sessions', count(*) from sessions
union all select 'bot_settings', count(*) from bot_settings
union all select 'bot_rules', count(*) from bot_rules
union all select 'roulette_sessions', count(*) from roulette_sessions
union all select 'channel_tokens', count(*) from channel_tokens
union all select 'channel_viewer_tokens', count(*) from channel_viewer_tokens
union all select 'channel_points_balances', count(*) from channel_points_balances
union all select 'video_donation_queue', count(*) from video_donation_queue
union all select 'platform_accounts', count(*) from platform_accounts
union all select 'platform_tokens', count(*) from platform_tokens
union all select 'prediction_events', count(*) from prediction_events
union all select 'automation_jobs', count(*) from automation_jobs;
```

민감 데이터 검증:

- `tokens.access_token`, `tokens.refresh_token`이 복원됐는지
- `platform_tokens`의 암호화 값이 현재 `ARUBOT_SECRET_ENCRYPTION_KEY`로 복호화 가능한지
- `api_keys.api_key_hash` 기반 조회가 되는지
- `app_users.is_admin` 값이 유지됐는지

주의:

- token 암호화 키를 바꾸면 기존 token 복호화가 실패할 수 있다.
- 로컬에서 실제 OAuth token을 사용하면 운영 계정에 영향을 줄 수 있으므로, 외부 API 호출 테스트는 별도 플래그나 테스트 계정으로 제한한다.

## 15. 기능 검증 체크리스트

백엔드:

- `npm run server` 실행 시 Supabase 초기화 오류가 없어야 한다.
- `/api/diagnostics` 계열 endpoint가 DB 상태를 정상 반환해야 한다.
- 로그인 callback이 `sessions`, `tokens`, `platform_accounts`, `platform_tokens`에 정상 기록되어야 한다.

프론트엔드:

- `npm run dev` 실행 후 admin dashboard가 로컬 API를 호출해야 한다.
- viewer pages가 기존 token URL로 접근 가능해야 한다.

주요 기능:

- 포인트 목록 조회/증감/삭제
- 룰렛 세션 생성 및 로그 조회
- PVD viewer URL 조회와 queue 조회
- 매크로 목록/저장
- 예측 베팅 생성/잠금/정산
- 자동화 agent 인증/작업 claim/complete
- YouTube central bot profile 조회
- app admin 권한 조회

테스트:

```bash
npm test
```

DB 연결이 필요한 테스트는 로컬 Supabase env를 세팅한 상태에서 별도 실행한다. 현재 테스트 중 일부는 고정 로컬 Supabase URL을 가정하므로, `.env.test` 또는 테스트 setup에서 URL을 명시하는 방식이 좋다.

## 16. 운영 데이터 보호 원칙

- 원격 `.env` 값은 문서나 커밋에 남기지 않는다.
- 원격 DB URL은 `REMOTE_SUPABASE_DB_URL` 같은 일회성 shell env로만 주입한다.
- `backups/*.dump`, `backups/*.sql`은 커밋하지 않는다.
- 로컬 복원 후 실제 OAuth token으로 외부 플랫폼에 쓰기 요청을 보내지 않도록 주의한다.
- 로컬 테스트 중 token revoke/delete 기능은 테스트 계정에서만 실행한다.

`.gitignore`에는 다음 항목 추가를 검토한다.

```gitignore
backups/
*.dump
*.sql.gz
.env.local-supabase
```

## 17. 단계별 실행 로드맵

### Phase 0. 계획 확정

- 이 문서 검토
- 로컬 Supabase를 exact clone으로 쓸지, seed 기반 개발 DB로 쓸지 결정
- 운영 token 데이터까지 복사할지 결정

### Phase 1. 로컬 스택 준비

- `npx supabase init`
- `npx supabase start`
- `npx supabase status`
- `.env.local-supabase.example` 작성

### Phase 2. 안전 백업

- 원격 전체 백업 생성
- 원격 `public` 스키마 백업 생성
- 백업 파일 restore smoke test

### Phase 3. 로컬 복원

- 로컬 DB에 `public` 스키마 복원
- `analyze` 실행
- row count 비교

### Phase 4. 앱 연결 보정

- `pg` SSL 자동 분기 구현
- npm Supabase 스크립트 추가
- README와 `.env.example` 업데이트
- 필요 시 `.env`를 로컬 값으로 수동 전환

### Phase 5. 기능 검증

- 백엔드 실행
- Next.js 실행
- 주요 API와 admin/viewer workflow 확인
- `npm test` 실행

### Phase 6. 최적화

- 느린 쿼리 후보에 `EXPLAIN (ANALYZE, BUFFERS)` 실행
- 인덱스 중복/미사용 여부 점검
- pool size와 timeout 조정
- `server/migrations`와 `ensureSchema()` 중복 정리 계획 수립

## 18. 최종 권장 결론

로컬 Supabase 전환은 충분히 가능하다. 이 프로젝트는 이미 Supabase direct DB URL과 migration SQL을 갖고 있어, 전체 구조를 바꾸기보다 다음 세 가지를 정확히 처리하는 것이 중요하다.

1. 원격 데이터는 Supabase 내부 스키마가 아니라 `public` 앱 스키마 중심으로 복원한다.
2. 로컬 Postgres용 SSL 비활성화 분기를 구현한다.
3. 복원 후 row count, 주요 workflow, 인덱스 사용률을 검증한 뒤 `.env`를 로컬로 전환한다.

이 순서로 진행하면 운영 DB를 건드리지 않고 로컬에서 실제 데이터 기반 디버깅과 최적화를 할 수 있다.
