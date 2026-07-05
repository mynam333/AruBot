# 그림 후원 기능 기획서

## 목표

그림 후원은 시청자가 스트리머의 포인트를 사용해 방송 화면 비율에 맞는 캔버스 위에 그림을 그리고, 그리는 과정과 최종 결과물을 OBS 브라우저 오버레이에 표시하는 기능이다.

영상 후원처럼 큐와 포인트 차감을 갖지만, 핵심 데이터는 영상 파일이 아니라 "그림을 그린 과정"이다. 따라서 서버는 완성 이미지만 저장하지 않고, 재생 가능한 스트로크 이벤트를 반드시 보존한다.

## 사용자 경험

### 시청자

- 시청자 페이지에서 그림 후원을 켠 스트리머를 선택한다.
- 접근 가능한 스트리머는 로그인한 시청자가 해당 방송에 포인트 잔액 또는 연결된 시청자 identity를 가진 방송으로 제한한다.
- 해당 스트리머에게 쌓은 포인트 잔액과 그림 후원 비용을 확인한다.
- 스트리머가 고정 비용을 쓰면 제출 비용을 즉시 확인하고, 잉크 비례 비용을 쓰면 그린 양에 따라 예상 사용 포인트가 실시간으로 갱신된다.
- 방송 화면 비율 캔버스에서 직접 그림을 그린다.
- 치지직, 씨미, YouTube 중 스트리머가 연결한 방송 화면을 선택하고, 해당 방송 화면 위에 오버레이로 직접 그린다.
- 동시 송출 중인 경우 시청자는 현재 보고 싶은 플랫폼을 선택한다.
- 붓 크기, 붓 종류, 컬러피커, 스포이드, 색상 프리셋, 투명도, 지우개를 사용할 수 있다.
- 되돌리기와 다시 실행을 지원한다.
- 제출 전에 실제 방송 화면 위에서 그리는 과정과 최종 위치를 미리 본다.
- 제출 시 포인트가 차감되고, 스트리머의 그림 후원 큐에 들어간다.
- 스트리머가 해당 시청자를 차단한 경우 그림 후원, 영상 후원, 룰렛, 유료 명령어 같은 봇 기능을 사용할 수 없다.

### 스트리머

- 그림 후원 받기 여부, 비용 방식, 최대 캔버스 복잡도, 자동 승인 여부를 설정한다.
- 비용 방식은 고정 비용과 잉크 사용량 비례 비용 중 선택한다.
- 봇 기능 사용을 막을 시청자를 차단/해제할 수 있다.
- 큐에서 신청자, 미리보기, 사용 포인트, 상태를 확인한다.
- 승인/거절/삭제/포인트 반환을 처리할 수 있다.
- 검수 모달에서 큰 화면으로 완성본과 리플레이를 확인한 뒤 승인, 거절/환불, 삭제/환불, 거절 후 차단을 처리한다.
- 대기열 순서를 드래그로 바꿀 수 있다.
- OBS용 그림 후원 오버레이 URL을 복사해 브라우저 소스로 추가한다.
- OBS용 그림 후원 오버레이 URL은 필요할 때 회전할 수 있으며, 기존 연결은 끊긴다.
- 오버레이는 그림 그리는 과정을 먼저 재생하고, 완성본을 설정한 시간 동안 유지한다.

## 방송 화면 미리보기

시청자 그림 에디터는 처음부터 빈 캔버스가 아니라 스트리머의 현재 방송 화면 위에 투명 캔버스를 올린 형태로 제공한다. 그림 좌표는 방송 플레이어 픽셀이 아니라 캔버스 상대 좌표로 저장되므로, 플랫폼을 바꾸거나 OBS 해상도가 달라도 같은 위치에 표시된다.

지원 플랫폼:

- 치지직: 연결된 채널의 라이브 화면을 기준으로 선택지를 제공한다.
- 씨미: 연결된 씨미 채널을 기준으로 선택지를 제공한다.
- YouTube: 연결된 YouTube 채널의 라이브 임베드 화면을 기준으로 선택지를 제공한다.

플랫폼 정책상 브라우저 안에서 임베드 재생이 제한될 수 있는 경우에도 같은 비율의 기준면을 유지하고, 시청자가 원본 방송을 새 창으로 열 수 있게 한다. 동시 송출 중이면 라이브 상태인 플랫폼을 우선 선택하되, 시청자가 직접 다른 플랫폼으로 바꿀 수 있다.

### OBS 오버레이

- 투명 배경 전체 화면 브라우저 소스다.
- 그림은 방송 화면 기준 상대 좌표로 표시된다.
- 재생 단계:
  1. 대기
  2. 그리는 과정 재생
  3. 완성본 유지
  4. 페이드아웃
  5. 다음 큐 항목 재생

## 저장 방식

### 결론

그림 후원은 "벡터 스트로크 이벤트 + 최종 래스터 미리보기" 조합으로 저장하는 것이 가장 좋다.

영상처럼 캔버스를 녹화해 mp4/webm으로 저장하면 용량이 크고, 배속/해상도/투명 배경/수정 대응이 어렵다. 반대로 최종 이미지만 저장하면 "그리는 과정"을 재생할 수 없다. 따라서 실제 원본은 이벤트 로그로 저장하고, 빠른 목록 표시와 검수용으로 완성 이미지를 별도 저장한다.

### 저장 데이터

각 그림 후원은 다음 데이터를 가진다.

- `drawing_id`: 그림 후원 ID
- `owner_user_id`: 스트리머 유저 ID
- `channel_uid`: 포인트 차감 기준 채널
- `viewer_user_id`: 신청 시청자 ID
- `viewer_name`: 신청 시청자 닉네임
- `cost`: 사용 포인트
- `canvas`: 기준 캔버스 정보
- `strokes`: 그리는 과정 이벤트
- `preview_image_url`: 완성본 WebP/PNG
- `status`: `queued`, `approved`, `playing`, `done`, `rejected`, `deleted`
- `created_at`, `approved_at`, `played_at`

### 캔버스 좌표

좌표는 픽셀이 아니라 정규화 좌표로 저장한다.

```json
{
  "widthRatio": 16,
  "heightRatio": 9,
  "safeArea": { "x": 0, "y": 0, "w": 1, "h": 1 }
}
```

스트로크 좌표도 `0..1` 범위로 저장한다.

```json
{
  "x": 0.4215,
  "y": 0.5831,
  "p": 0.72,
  "t": 142
}
```

- `x`, `y`: 캔버스 상대 좌표
- `p`: 압력 또는 속도 기반 가중치, 없으면 `1`
- `t`: 해당 그림 후원 시작 후 경과 시간(ms)

이렇게 저장하면 OBS 해상도가 1280x720, 1920x1080, 2560x1440이어도 같은 위치와 비율로 재생된다.

### 스트로크 이벤트 포맷

권장 포맷:

```json
{
  "version": 1,
  "canvas": { "widthRatio": 16, "heightRatio": 9 },
  "brushes": [
    {
      "id": "b1",
      "type": "pen",
      "color": "#ff6b9a",
      "alpha": 0.85,
      "size": 0.012,
      "blendMode": "source-over"
    }
  ],
  "strokes": [
    {
      "id": "s1",
      "brushId": "b1",
      "points": [
        { "x": 0.21, "y": 0.44, "p": 1, "t": 0 },
        { "x": 0.22, "y": 0.45, "p": 1, "t": 18 }
      ]
    }
  ]
}
```

붓 크기 `size`도 픽셀이 아니라 캔버스 짧은 축 대비 비율로 저장한다. 예를 들어 `0.012`는 OBS 캔버스 짧은 축의 1.2% 크기다.

### 왜 이벤트 저장이 좋은가

- 그리는 과정을 정확히 재생할 수 있다.
- OBS 해상도와 관계없이 비율이 유지된다.
- 저장 용량이 작다.
- 최종 이미지 품질을 서버나 클라이언트에서 다시 렌더링할 수 있다.
- 자동 검수, 복잡도 제한, 리플레이 속도 조정이 가능하다.

### 최종 이미지 저장

최종 이미지는 검수와 목록 표시를 위해 WebP를 우선 저장한다.

- 권장 크기: 기준 1280x720 또는 설정된 오버레이 비율
- 투명 배경 유지
- 포맷: `image/webp`
- fallback: `image/png`

최종 이미지는 원본이 아니라 캐시다. 원본은 항상 `strokes`다.

## 포인트 비용 정책

그림 후원 비용은 스트리머가 직접 선택한다.

### 고정 비용

- 모든 그림 후원이 같은 포인트를 사용한다.
- 설정값: `costPoints`
- 시청자는 제출 전 정확한 비용을 확인한다.
- 간단하고 예측 가능하므로 기본값으로 둔다.

### 잉크 사용량 비례 비용

- 선의 길이, 붓 크기, 투명도, 압력, 도구 종류를 기준으로 잉크 단위를 계산한다.
- 설정값: `inkCostPerUnit`
- 지우개와 형광펜은 일반 펜보다 낮은 계수로 계산한다.
- 시청자 에디터는 현재 그림 기준 예상 포인트를 보여준다.
- 최종 비용은 서버가 정규화된 stroke 데이터로 다시 계산한다. 클라이언트 예상값은 안내용이며 포인트 차감의 신뢰 기준이 아니다.

잉크 계산은 픽셀이 아니라 정규화 좌표와 붓 비율을 기준으로 한다. OBS 해상도나 시청자 기기 크기가 달라도 같은 그림은 같은 비용으로 계산되어야 한다.

```json
{
  "pricingMode": "ink",
  "inkCostPerUnit": 1,
  "metrics": {
    "ink": { "raw": 0.0842, "units": 85 }
  }
}
```

운영 제한:

- 서버는 최소/최대 붓 크기, 투명도, 포인트 수, stroke 수를 정규화한다.
- 비용이 부족하면 제출 전에 거절한다.
- 포인트 차감은 stroke 저장과 같은 제출 흐름 안에서 처리한다.
- 향후 과도한 잉크 사용 방지를 위해 `maxCostPoints` 또는 일일 제출 한도를 추가할 수 있다.

### 대용량 저장 위치

초기 구현은 DB JSONB로 시작할 수 있지만, 상용 운영 기준으로는 다음 방식이 좋다.

- DB: 메타데이터, 상태, 포인트, 승인 정보
- Object Storage: stroke JSON, preview WebP

권장 경로:

```text
drawing-donations/{ownerUserId}/{drawingId}/strokes.json
drawing-donations/{ownerUserId}/{drawingId}/preview.webp
```

Supabase Storage, Cloudflare R2, S3 중 하나를 사용할 수 있다. 현재 프로젝트가 Supabase/Postgres와 Cloudflare 배포를 함께 쓰므로 Cloudflare R2 또는 Supabase Storage가 현실적이다.

현재 구현은 Supabase Storage 환경이 준비된 경우 stroke JSON을 Object Storage에 저장하고, 준비되지 않은 경우 DB JSONB 저장으로 자동 fallback한다. 운영 환경에서 Object Storage를 켜려면 다음 값을 설정한다.

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
DRAWING_DONATION_STORAGE_BUCKET=...
```

`ARUBOT_DB_PROVIDER=postgres`를 쓰면서 Supabase Storage만 함께 쓰는 배포에서는 실수로 Supabase DB로 연결되는 일을 막기 위해 기본적으로 Storage가 꺼진다. 이 구성을 의도한 경우에만 다음 값을 추가한다.

```text
ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES=true
```

DB에는 `stroke_object_key`, `preview_object_key`를 보관해 메타데이터 조회와 큐 관리를 가볍게 유지한다. 검수, OBS 재생처럼 원본 stroke가 필요한 API에서만 Object Storage를 읽는다.

## 검수와 차단

그림 후원은 방송 화면에 직접 노출되므로 영상 후원보다 강한 검수 동선이 필요하다.

- 대기열의 `검수` 버튼은 큰 모달을 열고 원본 stroke를 불러온다.
- 스트리머는 완성 이미지와 리플레이를 확인한다.
- `승인`은 OBS 오버레이 큐에 넣는다.
- `거절/환불`은 포인트를 반환하고 항목을 거절 처리한다.
- `삭제/환불`은 큐에서 제거하고 포인트를 반환한다.
- `거절하고 차단`은 포인트를 반환한 뒤 해당 시청자를 봇 기능 차단 목록에 넣는다.

봇 기능 차단은 그림 후원만 막는 것이 아니라 영상 후원, 룰렛, 유료 명령어처럼 포인트를 쓰는 시청자 참여 기능 전반에 적용한다. 차단 목록은 스트리머가 직접 추가/해제할 수 있다.

## 리플레이 방식

### 목표

실제 그림을 그린 시간이 3분이어도, OBS에는 스트리머가 설정한 최대 재생 시간 안에 자연스럽게 재생되어야 한다.

예:

- 실제 그린 활성 시간: 180초
- 스트리머 설정 최대 그리기 재생: 12초
- 재생 배속: `180 / 12 = 15배속`

### 활성 그리기 시간

"오롯이 그림 그릴 때만" 배속 기준에 포함하려면 모든 대기 시간을 그대로 저장하되, 재생 시간 계산에는 긴 idle을 제외한다.

규칙:

- 같은 스트로크 안의 포인트 간 시간은 모두 활성 시간으로 본다.
- 스트로크와 다음 스트로크 사이 간격은 최대 `idleCapMs`까지만 인정한다.
- 기본 `idleCapMs`: 120ms
- 너무 긴 고민 시간, 도구 변경 시간, 쉬는 시간은 리플레이 길이를 늘리지 않는다.

### 재생 타임라인 생성

제출 시 또는 승인 시 서버가 `replayTimeline`을 생성한다.

```json
{
  "activeDrawMs": 82400,
  "targetReplayMs": 12000,
  "speed": 6.87,
  "idleCapMs": 120
}
```

OBS 오버레이는 원본 `t`를 그대로 쓰지 않고, 이 타임라인에 맞춰 압축된 시간으로 재생한다.

### 최종 유지 시간

설정:

- `replayMaxSec`: 그리는 과정 최대 표시 시간
- `resultHoldSec`: 완성본 유지 시간
- `fadeInMs`, `fadeOutMs`

총 표시 시간:

```text
min(activeDrawSec, replayMaxSec) + resultHoldSec + fade
```

## 붓/도구 기획

### 1차 도구

- 펜: 일반 선
- 마커: 둥글고 부드러운 선
- 형광펜: 낮은 alpha와 multiply 계열
- 에어브러시: 점 분산
- 지우개: `destination-out` 합성으로 기존 stroke의 일부만 실제로 지우는 mask stroke

### 공통 속성

- 색상
- 투명도
- 크기
- 부드럽게 보정
- 실행 취소/다시 실행
- 전체 지우기

지우개는 색을 덮어 그리는 방식이 아니라 캔버스 alpha를 제거하는 방식으로 처리한다. 따라서 기존 선의 일부만 그림판처럼 지울 수 있고, 이 지우는 과정도 stroke 이벤트로 저장되어 OBS 리플레이에서 동일하게 재생된다.

### 제한 정책

서버 부하와 악용 방지를 위해 제한이 필요하다.

- 최대 스트로크 수
- 최대 포인트 수
- 최소 포인트 간 거리
- 최대 제출 용량
- 최대 투명도/브러시 크기
- 제출 쿨다운
- 사용자별 대기열 제한

## 화면 구성

### 시청자 그림 에디터

경로 후보:

```text
/viewer/drawing
/viewer/drawing/[streamerId]
```

주요 UI:

- 스트리머 선택 또는 방송별 카드
- 보유 포인트
- 예상 사용 포인트
- 캔버스
- 하단/측면 도구바
- 색상 팔레트
- 투명도 슬라이더
- 붓 크기 슬라이더
- 미리보기 재생 버튼
- 제출 버튼

모바일:

- 도구는 하단 시트
- 캔버스는 가능한 넓게
- 두 손가락 확대/이동은 편집 보조용이며 저장 좌표는 원본 캔버스 기준

### 스트리머 관리 페이지

경로 후보:

```text
/drawing-donations
/drawing-donations/settings
```

주요 UI:

- 그림 후원 받기 토글
- 비용 설정
- 승인 방식: 자동 승인, 수동 승인
- 최대 재생 시간
- 결과 유지 시간
- 제출 쿨다운
- 시청자별 대기열 제한
- 캔버스 비율
- 대기열
- 미리보기
- 승인/거절/삭제/환불
- OBS 오버레이 URL

### OBS 오버레이

경로 후보:

```text
/viewer/drawing-overlay/[token]
```

동작:

- WebSocket 기반 실시간 갱신
- 연결이 끊기면 backoff 재연결
- 폴링 없이 승인/재생 완료/삭제/순서 변경 이벤트를 즉시 반영
- 투명 배경
- full viewport canvas
- 화면 비율에 맞춰 letterbox/pillarbox 없이 전체 방송 화면 기준으로 렌더링

## 백엔드 API 초안

### 유저 차단

차단 기능은 그림 후원 전용이 아니라 봇 기능 공통 정책으로 둔다. 차단된 시청자는 다음 기능을 사용할 수 없다.

- 포인트를 소모하는 명령어
- 룰렛 실행
- 영상 후원 신청
- 그림 후원 신청
- 예측 베팅 참여

초기 구현은 스트리머 설정 JSON에 `blockedBotUsers` 배열로 저장하고, 이후 트래픽이 늘면 `bot_user_blocks` 테이블로 분리한다.

```json
{
  "blockedBotUsers": [
    {
      "userId": "chzzk:viewer-id",
      "username": "시청자",
      "reason": "방송 규칙 위반",
      "createdAt": "2026-07-05T00:00:00.000Z"
    }
  ]
}
```

API:

```text
GET    /api/bot/blocked-users
POST   /api/bot/blocked-users
DELETE /api/bot/blocked-users/:userId
```

차단 판단은 raw user id와 플랫폼 prefix id를 함께 비교한다.

```text
viewer123
chzzk:viewer123
cime:viewer123
youtube:viewer123
```

### 시청자 접근

시청자 그림 후원 페이지는 스트리머가 그림 후원을 켠 경우에만 접근 가능하다.

```text
GET /api/viewer/drawing-donation/streamers
GET /api/viewer/drawing-donation/streamers/:channelUid
```

목록에는 다음 정보만 노출한다.

- 방송 이름
- 현재 보유 포인트
- 그림 후원 비용
- 캔버스 비율
- 제출 가능 여부
- 차단 여부

차단된 시청자에게는 에디터 진입 버튼을 숨기고, 명확한 안내만 보여준다.

### 설정

```text
GET  /api/drawing-donation/settings
POST /api/drawing-donation/settings
```

### 시청자 제출

```text
POST /api/drawing-donation/submit
```

요청:

```json
{
  "streamerId": "user-id",
  "strokeObjectKey": "object-storage-key",
  "previewImageKey": "object-storage-key",
  "canvas": { "widthRatio": 16, "heightRatio": 9 },
  "metrics": {
    "strokeCount": 42,
    "pointCount": 1830,
    "activeDrawMs": 82400
  }
}
```

### 큐 관리

```text
GET  /api/drawing-donation/queue
POST /api/drawing-donation/approve
POST /api/drawing-donation/reject
POST /api/drawing-donation/delete
POST /api/drawing-donation/delete-refund
POST /api/drawing-donation/reorder
```

### OBS 오버레이

```text
GET /api/drawing-donation/viewer-url
POST /api/drawing-donation/rotate-viewer-token
GET /api/drawing-donation/current?token=...
WS  /api/drawing-donation/ws?token=...
WS  /api/drawing-donation/admin/ws
POST /api/drawing-donation/pop-by-token
```

## DB 초안

### drawing_donation_settings

```sql
create table drawing_donation_settings (
  owner_user_id uuid primary key,
  enabled boolean not null default false,
  pricing_mode text not null default 'fixed',
  cost_points integer not null default 100,
  ink_cost_per_unit numeric not null default 1,
  approval_mode text not null default 'manual',
  replay_max_sec integer not null default 12,
  result_hold_sec integer not null default 8,
  max_strokes integer not null default 120,
  max_points integer not null default 6000,
  submit_cooldown_sec integer not null default 20,
  per_user_queue_limit integer not null default 3,
  canvas_width_ratio numeric not null default 16,
  canvas_height_ratio numeric not null default 9,
  updated_at timestamptz not null default now()
);
```

### drawing_donation_items

```sql
create table drawing_donation_items (
  id text primary key,
  sid text not null,
  owner_user_id text,
  channel_uid text not null,
  viewer_user_id text not null,
  viewer_name text,
  status text not null default 'queued',
  cost integer not null default 0,
  point_deductions jsonb not null default '[]',
  point_refunded boolean not null default false,
  canvas jsonb not null default '{}',
  strokes jsonb not null default '[]',
  stroke_object_key text,
  preview_image text,
  preview_object_key text,
  metrics jsonb not null default '{}',
  replay jsonb not null default '{}',
  result_hold_sec integer not null default 8,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  playing_at timestamptz,
  rejected_at timestamptz,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);
```

권장 인덱스:

```sql
create index idx_drawing_donation_items_owner_status_position
  on drawing_donation_items(sid, status, position, created_at);

create index idx_drawing_donation_items_viewer_created
  on drawing_donation_items(sid, viewer_user_id, created_at desc);
```

## 보안과 악용 방지

- 클라이언트가 보낸 preview 이미지는 신뢰하지 않는다.
- 서버 또는 검증 워커가 stroke JSON을 다시 렌더링해 preview와 기본 metrics를 검증한다.
- stroke JSON 크기 제한을 둔다.
- 포인트 차감은 submit API 트랜잭션에서 처리한다.
- 승인 전 항목은 OBS로 가지 않는다.
- 수동 승인 모드 기본값을 권장한다.
- 신고/차단된 유저의 제출 제한을 고려한다.
- 미성년자/혐오/선정적 그림 대응을 위해 자동 승인 사용 시 스트리머에게 위험 안내가 필요하다.

## 성능 전략

- OBS 오버레이는 Canvas 2D로 렌더링한다.
- 제출 에디터는 입력 중 전체 캔버스를 매번 다시 그리지 않고, 새로 생긴 선분만 incremental render 한다.
- 제출 에디터와 서버는 사람이 구분하기 어려운 지나치게 촘촘한 연속 좌표를 줄여 stroke JSON 크기를 낮춘다.
- 서버는 최종 저장 전 좌표, 붓 크기, 투명도, 포인트 수를 다시 정규화한다.
- 미리보기 이미지는 검수용 캐시이므로 작은 WebP data URL만 허용하고, 과도하게 큰 preview는 저장하지 않는다.
- 목록은 preview WebP만 로드한다.
- stroke JSON은 gzip 또는 brotli 압축 저장을 권장한다.
- 큰 그림은 object storage에서 range/cache 가능한 정적 파일로 제공한다.
- 현재 DB 저장 방식에서는 관리자 큐 WebSocket은 목록용 경량 row만 보내고, OBS 오버레이만 현재 재생 항목의 stroke를 받는다.
- object storage 전환 후에는 WebSocket 메시지에 stroke 전체를 넣지 않고 item id와 signed URL만 보내는 구조로 바꾼다.
- 큐 조회와 현재 항목 선정은 `sid`, `status`, `position`, `created_at` 복합 인덱스에 맞춘다.
- 현재 항목 승격은 `for update skip locked` 기반 단일 쿼리로 처리해 여러 OBS 연결이 동시에 붙어도 중복 승격을 피한다.

## 구현 단계

### 1단계: 최소 기능

- 그림 후원 설정
- 시청자 그림 에디터
- stroke JSON 저장
- preview WebP 저장
- 포인트 차감
- 스트리머 큐
- OBS 오버레이 재생

### 2단계: 운영 기능

- 승인/거절/환불
- 큐 순서 변경
- replay 속도 설정
- 결과 유지 시간 설정
- 공개 시청자 페이지에서 그림 후원 가능 스트리머 표시
- WebSocket 실시간 오버레이/관리자 큐 갱신
- 대기열 드래그 순서 변경
- 오버레이 토큰 회전
- 제출 쿨다운과 시청자별 대기열 제한
- 그림 후원 전용 이벤트 로그 카테고리

### 3단계: 고도화

- 브러시 프리셋
- 레이어는 1차에서는 제외, 이후 추가
- 텍스트 도구
- 스탬프 도구
- 자동 썸네일 검증
- 관리자 모더레이션 로그

## 구현 시 기존 시스템 재사용

- 포인트 차감: 영상 후원 포인트 차감 흐름 재사용
- 큐/OBS 토큰: PVD viewer token 구조 참고
- WebSocket fanout: PVD/룰렛 오버레이 구조 참고
- 이벤트 로그: `drawing_donation` 카테고리로 제출/환불 흐름 기록
- 시청자 페이지: 방송별 포인트 확인/바로가기 구조 재사용

## 결정 사항

- 원본 저장은 stroke 이벤트 JSON이다.
- 완성 이미지는 preview 캐시로 저장한다.
- 좌표와 붓 크기는 모두 비율 기반으로 저장한다.
- 리플레이는 idle 시간을 압축한 활성 그리기 시간 기준으로 만든다.
- OBS 오버레이는 stroke JSON을 Canvas 2D로 재생한다.
- 자동 승인보다는 수동 승인을 기본값으로 한다.
