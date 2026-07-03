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

## 6. 사전 준비

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

## 7. 로컬 Supabase 초기화 상세 절차

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

## 8. 백엔드 연결 상세 절차

### 8.1 `.env`에서 로컬 Supabase로 전환

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

### 8.2 백엔드가 Supabase에 연결되는 순서

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

### 8.3 연결 smoke test

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

### 8.4 프론트엔드 연결

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

### 8.5 로컬 Supabase Studio 사용

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

## 9. 데이터 백업 및 이관 전략

### 9.1 원격 전체 백업

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

### 9.2 로컬 복원용 public 스키마 백업

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

### 9.3 로컬 DB 복원

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

## 10. 마이그레이션 정합성 검증

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

## 11. 코드 변경 계획

이번 문서는 기획용이며 아직 구현하지 않는다. 실제 구현 시 필요한 변경은 다음으로 제한한다.

### 11.1 로컬 DB SSL 분기

현재 `pgClientOptions()`는 항상 다음 옵션을 사용한다.

```js
ssl: { rejectUnauthorized: false }
```

로컬 Supabase direct DB는 일반적으로 SSL을 사용하지 않으므로, 다음 정책으로 바꾼다.

- `SUPABASE_DB_SSL=false`면 SSL 비활성화
- DB host가 `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`이면 SSL 비활성화
- URL query에 `sslmode=disable`이 있으면 SSL 비활성화
- 그 외 원격 URL은 기존처럼 SSL 사용

### 11.2 개발 스크립트 추가

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

### 11.3 환경 변수 문서화

`.env.example`과 README에 로컬 Supabase 예시를 추가한다.

실제 `.env`는 secrets가 들어 있으므로 자동 덮어쓰지 않는다. 사용자가 원격/로컬 env 파일을 나누고 싶다면 다음 구조를 권장한다.

- `.env`: 현재 실행 대상
- `.env.remote.example`: 원격 Supabase 형태 예시
- `.env.local-supabase.example`: 로컬 Supabase 형태 예시

## 12. 성능 최적화 계획

### 12.1 복원 직후 통계 갱신

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

### 12.2 주요 조회 경로 확인

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

### 12.3 인덱스 사용률 점검

현재 `003_performance_optimization_indexes.sql`에는 `analyze_channel_query_performance()`, `monitor_index_usage()`, `get_performance_recommendations()`가 있다. 로컬 전환 후 다음을 실행한다.

```sql
select * from analyze_channel_query_performance();
select * from monitor_index_usage();
select * from get_performance_recommendations();
```

주의:

- 로컬은 트래픽이 적어 인덱스 사용 통계가 운영과 다를 수 있다.
- 복원 직후에는 통계가 충분하지 않으므로 API 회귀 테스트를 한 번 돌린 뒤 확인한다.

### 12.4 연결 풀 튜닝

로컬 기본값은 다음 정도면 충분하다.

```dotenv
SUPABASE_DB_POOL_MAX=5
SUPABASE_DB_CONNECT_TIMEOUT_MS=5000
SUPABASE_DB_STATEMENT_TIMEOUT_MS=15000
SUPABASE_DB_IDLE_TIMEOUT_MS=30000
```

운영 부하를 로컬에서 재현하는 경우에만 pool max를 10 이상으로 올린다.

## 13. 데이터 검증 체크리스트

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

## 14. 기능 검증 체크리스트

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

## 15. 운영 데이터 보호 원칙

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

## 16. 단계별 실행 로드맵

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

## 17. 최종 권장 결론

로컬 Supabase 전환은 충분히 가능하다. 이 프로젝트는 이미 Supabase direct DB URL과 migration SQL을 갖고 있어, 전체 구조를 바꾸기보다 다음 세 가지를 정확히 처리하는 것이 중요하다.

1. 원격 데이터는 Supabase 내부 스키마가 아니라 `public` 앱 스키마 중심으로 복원한다.
2. 로컬 Postgres용 SSL 비활성화 분기를 구현한다.
3. 복원 후 row count, 주요 workflow, 인덱스 사용률을 검증한 뒤 `.env`를 로컬로 전환한다.

이 순서로 진행하면 운영 DB를 건드리지 않고 로컬에서 실제 데이터 기반 디버깅과 최적화를 할 수 있다.
