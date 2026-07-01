# Supabase DB 개선 설계서

## 1. 목표

현재 AruBot은 많은 상태를 `bot_settings` JSON, 동적 채널 포인트 테이블, 서버 메모리 Map, token mapping에 의존한다. 이 구조는 빠르게 기능을 붙이기에는 좋지만, 재시작/멀티 인스턴스/장기 운영에서 URL이 바뀌거나 queue 상태가 사라지거나 조회 비용이 커지는 문제가 생긴다.

Supabase 개선 목표:

- 영상 후원/PVD viewer URL과 룰렛 viewer URL이 유저별로 안정적으로 유지된다.
- token rotate는 명시적으로 요청했을 때만 일어나고, 평소에는 같은 URL을 재사용한다.
- 서버 재시작 후에도 현재 queue, viewer token, live session, roulette settings를 복구한다.
- 동적 테이블과 JSON blob 의존도를 줄이고 query 가능한 정규화 테이블로 전환한다.
- public page, dashboard, OBS viewer가 빠르게 조회할 수 있도록 index와 materialized/read model을 준비한다.

## 2. 핵심 설계 원칙

- `owner_pid`, `channel_id`, `viewer_token`을 명확히 분리한다.
- URL 안정성이 필요한 token은 DB에 영구 저장하고, rotate 요청 전까지 재생성하지 않는다.
- 일회성 실행 결과와 장기 설정을 분리한다.
- public 조회용 데이터는 최소 필드만 빠르게 읽을 수 있게 별도 index/view를 둔다.
- 민감 token과 공개 viewer token은 scope와 권한을 다르게 관리한다.

## 3. 주요 엔티티

### 3.1 channels

스트리머 채널의 기준 테이블.

```sql
create table channels (
  channel_id text primary key,
  owner_pid text not null unique,
  display_name text,
  profile_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

목적:

- `user:<id>` 형태 pid와 실제 CHZZK channel id를 안정적으로 매핑한다.
- 모든 기능 테이블이 `channel_id`를 FK처럼 참조한다.

### 3.2 channel_viewer_tokens

영상 후원/룰렛 viewer URL을 안정적으로 유지하기 위한 핵심 테이블.

```sql
create table channel_viewer_tokens (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  token_type text not null check (token_type in ('pvd', 'roulette')),
  token_value text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_used_at timestamptz,
  usage_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unique (channel_id, token_type, active) deferrable initially immediate
);

create index idx_channel_viewer_tokens_channel_type
  on channel_viewer_tokens(channel_id, token_type)
  where active = true;

create index idx_channel_viewer_tokens_value
  on channel_viewer_tokens(token_value)
  where active = true;
```

동작:

- `/api/video-donation/viewer-url`은 기존 active pvd token을 먼저 조회한다.
- 없을 때만 새 token을 생성한다.
- `/api/roulette/viewer-url`도 동일하게 active roulette token을 재사용한다.
- rotate endpoint는 기존 token을 inactive 처리하고 새 token을 만든다.
- viewer URL은 `https://.../pvd/:token` 또는 `https://.../roulette/:token` 형태를 유지한다.

주의:

- `unique (channel_id, token_type, active)`는 PostgreSQL에서 active=false rows가 여러 개 필요한 경우 partial unique index가 더 적합하다.

권장 대체:

```sql
create unique index uniq_active_viewer_token_per_channel
  on channel_viewer_tokens(channel_id, token_type)
  where active = true;
```

### 3.3 channel_settings

기능별 설정을 큰 JSON 하나에 몰아넣지 않기 위한 공통 설정 테이블.

```sql
create table channel_settings (
  channel_id text primary key,
  bot_enabled boolean not null default true,
  only_when_live boolean not null default true,
  attendance_announce boolean not null default true,
  attendance_exclude_user_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 3.4 command_rules

기존 `bot_rules`를 channel 기준으로 명확히 정리한다.

```sql
create table command_rules (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  name text not null,
  keywords text[] not null default '{}',
  responses text[] not null default '{}',
  enabled boolean not null default true,
  required_role_level integer not null default 1,
  points_cost integer not null default 0,
  cooldown_ms integer not null default 1000,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_command_rules_channel_enabled
  on command_rules(channel_id, enabled);

create index idx_command_rules_keywords
  on command_rules using gin(keywords);
```

### 3.5 macros

```sql
create table macros (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  enabled boolean not null default true,
  interval_sec integer not null check (interval_sec > 0),
  message text not null,
  next_run_at timestamptz,
  last_sent_at timestamptz,
  failure_count integer not null default 0,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_macros_due
  on macros(next_run_at)
  where enabled = true;

create index idx_macros_channel
  on macros(channel_id, enabled);
```

효과:

- 서버 메모리 timer만 믿지 않고 DB에서 재시작 복구 가능
- due macro만 조회 가능
- priority queue scheduler와 맞물림

### 3.6 channel_points

동적 `channelpoint_<uid>` 테이블을 대체하는 단일 테이블.

```sql
create table channel_points (
  channel_id text not null,
  user_id text not null,
  username text,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index idx_channel_points_rank
  on channel_points(channel_id, points desc, username asc);

create index idx_channel_points_username
  on channel_points(channel_id, lower(username));
```

마이그레이션:

- 기존 `channelpoint_<uid>` 테이블을 channel별로 읽어 `channel_points`에 upsert한다.
- import/export API 응답 shape는 유지한다.
- 전환 기간에는 repository가 새 테이블 우선, 없으면 legacy dynamic table fallback을 사용한다.

### 3.7 video_donation_settings

```sql
create table video_donation_settings (
  channel_id text primary key,
  accept_enabled boolean not null default false,
  points_per_second integer not null default 1,
  max_duration_sec integer not null default 600,
  per_user_limit integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 3.8 video_donation_queue

서버 메모리에만 있는 영상 후원 queue를 DB로 이동한다.

```sql
create table video_donation_queue (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  requester_user_id text not null,
  requester_username text,
  video_id text not null,
  title text,
  duration_sec integer not null,
  start_sec integer not null default 0,
  play_sec integer,
  cost integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'playing', 'done', 'deleted', 'refunded', 'failed')),
  position integer not null default 0,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index idx_video_queue_active
  on video_donation_queue(channel_id, status, position, requested_at);

create index idx_video_queue_requester
  on video_donation_queue(channel_id, requester_user_id, status);
```

효과:

- 서버 재시작 후 queue 복구
- public/diagnostics에서 queue length 빠른 조회
- per-user limit 계산 가능
- refund 처리 audit 가능

### 3.9 viewer_playback_state

PVD viewer 현재 재생 상태를 DB/Redis에서 복구하기 위한 테이블.

```sql
create table viewer_playback_state (
  channel_id text not null,
  viewer_type text not null check (viewer_type in ('pvd', 'roulette')),
  current_item_id uuid,
  state text not null default 'idle',
  at_sec integer not null default 0,
  started_at timestamptz,
  paused_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, viewer_type)
);
```

PVD `/api/video-donation/now-playing`은 이 테이블 또는 Redis state를 기준으로 응답한다.

### 3.10 roulette_defs

```sql
create table roulette_defs (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  name text not null,
  type text not null check (type in ('items', 'probability')),
  theme text not null default 'classic',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, lower(name))
);
```

PostgreSQL은 `unique (channel_id, lower(name))` 직접 문법이 제약으로는 안 되므로 expression unique index를 사용한다.

```sql
create unique index uniq_roulette_defs_channel_name
  on roulette_defs(channel_id, lower(name));
```

### 3.11 roulette_items

```sql
create table roulette_items (
  id uuid primary key default gen_random_uuid(),
  roulette_id uuid not null,
  label text not null,
  value text,
  weight numeric,
  probability numeric,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_roulette_items_def_order
  on roulette_items(roulette_id, sort_order);
```

확률 합계 검증은 application service에서 먼저 수행하고, 필요하면 DB function으로 보조한다.

### 3.12 roulette_sessions

기존 테이블을 보강한다.

추가 권장 컬럼:

- `roulette_id uuid`
- `channel_id text not null`
- `viewer_token text`
- `batch_id text`
- `execution_source text` (`chat`, `donation`, `system`, `api`)
- `created_at timestamptz`

index:

```sql
create index idx_roulette_sessions_channel_created
  on roulette_sessions(channel_id, created_at desc);

create index idx_roulette_sessions_roulette_created
  on roulette_sessions(roulette_id, created_at desc);
```

### 3.13 donation_rules

```sql
create table donation_rules (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  enabled boolean not null default true,
  name text,
  min_amount integer,
  max_amount integer,
  message_pattern text,
  wildcard boolean not null default false,
  response text,
  repeat_enabled boolean not null default false,
  repeat_per_amount integer,
  repeat_cooldown_ms integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_donation_rules_channel_enabled
  on donation_rules(channel_id, enabled);
```

### 3.14 audit_logs

서비스 개선을 위한 설정 변경/포인트 수동 조정 기록.

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  actor_pid text,
  action text not null,
  target_type text not null,
  target_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_channel_created
  on audit_logs(channel_id, created_at desc);
```

## 4. URL 안정성 설계

### 영상 후원 viewer URL

현재 목표:

- 유저/채널별로 PVD viewer URL이 계속 동일해야 한다.
- 서버 재시작, 로그인 재연결, 설정 저장으로 token이 바뀌면 안 된다.

권장 flow:

```text
GET /api/video-donation/viewer-url
  -> resolve channel_id from session/API key
  -> select active token where channel_id and token_type='pvd'
  -> if exists: return existing URL
  -> else: insert token and return URL
```

rotate:

```text
POST /api/video-donation/rotate-viewer-token
  -> deactivate existing active token
  -> create new token
  -> close old viewer sockets
  -> return new URL
```

### 룰렛 viewer URL

동일 원칙을 `token_type='roulette'`에 적용한다.

### token 보안

- token은 충분히 긴 random hex 또는 base64url 값을 사용한다.
- viewer token은 owner 권한을 가지지 않는다.
- token last_used/usage_count를 갱신하되, 너무 자주 write하지 않도록 throttle하거나 Redis counter를 둔다.

## 5. 마이그레이션 전략

### Phase 1. 신규 테이블 추가

- 기존 테이블을 삭제하지 않고 새 테이블을 추가한다.
- repository에서 새 테이블 우선 read, 없으면 legacy fallback을 둔다.

### Phase 2. backfill

- sessions/tokens에서 channels backfill
- bot_settings JSON에서 settings/macros/roulette/video donation/donation rules 추출
- 동적 channelpoint 테이블에서 `channel_points`로 복사
- 기존 roulette_sessions에 channel_id/roulette_id를 가능한 만큼 채운다.

### Phase 3. dual-write

- 설정 저장 시 legacy `bot_settings`와 신규 테이블에 동시에 write한다.
- viewer URL 발급은 신규 `channel_viewer_tokens`를 source of truth로 둔다.
- 포인트 변경은 신규 `channel_points`에 write하고 legacy fallback은 read-only로 전환한다.

### Phase 4. read switch

- API read를 신규 테이블로 전환한다.
- public pages, dashboard, viewer는 신규 read model만 본다.

### Phase 5. legacy 제거

- 충분한 검증 후 legacy JSON/dynamic table fallback을 제거한다.
- 제거 전 export/backup을 생성한다.

## 6. 성능 최적화 쿼리 기준

### public command list

```sql
select id, name, keywords, responses, required_role_level, points_cost, cooldown_ms
from command_rules
where channel_id = $1 and enabled = true
order by name asc
limit $2 offset $3;
```

index:

- `idx_command_rules_channel_enabled`

### point ranking

```sql
select user_id, username, points
from channel_points
where channel_id = $1
order by points desc, username asc
limit $2 offset $3;
```

index:

- `idx_channel_points_rank`

### active video queue

```sql
select *
from video_donation_queue
where channel_id = $1 and status in ('queued', 'playing')
order by position asc, requested_at asc;
```

index:

- `idx_video_queue_active`

### due macros

```sql
select *
from macros
where enabled = true and next_run_at <= now()
order by next_run_at asc
limit 100;
```

index:

- `idx_macros_due`

## 7. RLS와 권한

Supabase service role을 서버에서 사용하더라도 정책 모델은 문서화한다.

권장:

- 서버는 service role로 DB 접근
- 클라이언트는 DB 직접 접근 금지
- public page API는 서버에서 필요한 필드만 노출
- API Key owner_pid로 channel_id를 resolve
- viewer token은 viewer read/control 범위만 허용

나중에 Supabase client direct access를 쓴다면:

- `channels.owner_pid = auth.uid()` 기반 owner policy
- public read view는 별도 view/RPC로 제한
- viewer token 검증은 RPC로만 처리

## 8. 운영/관리 기능 개선

DB 개선과 함께 추가하면 좋은 기능:

- viewer URL 고정 상태 표시
  - 생성일
  - 마지막 사용 시각
  - 연결 viewer 수
  - rotate 이력
- 설정 snapshot
  - command/roulette/macro/video donation 설정 변경 전 snapshot 저장
- rollback
  - 최근 snapshot으로 복구
- point adjustment history
  - 수동 지급/차감/환불 기록
- queue history
  - 영상 후원 삭제/환불/실패 사유 기록
- data export
  - 채널 전체 설정 export

## 9. 즉시 반영할 항목

- `channel_viewer_tokens` 설계 도입
- `/api/video-donation/viewer-url`과 `/api/roulette/viewer-url`이 기존 active token을 재사용하도록 보장
- `/api/video-donation/now-playing`을 DB/Redis backed state로 구현
- `channel_points` 단일 테이블 전환 계획 수립
- video donation queue를 DB-backed로 전환
- macro `next_run_at` 저장과 due query 도입
- viewer token rotate 시 old sockets cleanup
