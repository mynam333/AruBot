# Next.js 프론트엔드 완전 마이그레이션 기획서

## 1. 목적

현재 React/Vite 프론트엔드를 Next.js App Router 기반 멀티 페이지 앱으로 완전히 재작성한다. 단순 파일 이동이 아니라 운영자 UX, 공개 페이지, OBS viewer, WARUDO 연동 진입점을 모두 새 정보 구조로 다시 설계한다.

핵심 원칙:

- 기존 백엔드 API, public URL, OBS viewer token, WARUDO plugin 계약은 깨지 않는다.
- 관리자 화면은 단일 탭 앱에서 벗어나 기능별 독립 URL을 가진다.
- 각 페이지는 고유 경로와 의미 있는 route params/search params를 가진다.
- Server Component를 기본으로 두고, 상호작용이 필요한 부분만 Client Component로 분리한다.
- 디자인은 방송 운영 콘솔에 맞는 현대적이고 밀도 있는 제품 UI로 재설계한다.

## 2. 근거와 Next.js 방향

Next.js 공식 문서 기준으로 App Router는 파일 시스템 기반 라우터이며 layouts, nested routing, loading/error states, Server Components를 기본으로 사용한다. Dynamic Segment는 `[param]` 폴더로 URL 값을 캡처하고, route group은 URL에 영향을 주지 않는 구조화 수단이다.

참고:

- Next.js Project Structure: https://nextjs.org/docs/app/getting-started/project-structure
- Next.js App Router: https://nextjs.org/docs/app
- Next.js Dynamic Routes: https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes

## 3. 마이그레이션 범위

### 포함

- Vite 제거, Next.js App Router 도입
- `src/App.tsx` 기반 경량 라우팅 제거
- 관리자 UI 전체 재설계
- `/pvd/:token`, `/roulette/:token` viewer를 Next.js route로 이전
- `public/commands`, `public/points`, `public/roulettelog`, `public/roulettelist` 정적 HTML을 Next.js 페이지로 이전
- API client, 상태 hooks, form components, table components 재작성
- 한글 깨짐 문구 전면 교체
- metadata, loading, error, not-found 페이지 정리

### 제외 또는 보류

- Express 백엔드 API 자체 재작성은 이번 프론트엔드 마이그레이션의 직접 범위가 아니다.
- WARUDO C# plugin 코드는 기존 API 계약을 보존하되, 플러그인 UI 자체는 건드리지 않는다.
- 룰렛/영상 후원 서버 로직 변경은 필요한 API 누락 보정 외에는 별도 백엔드 작업으로 분리한다.

## 4. 최종 Next.js 프로젝트 구조

```text
src/
  app/
    layout.tsx
    globals.css
    not-found.tsx
    error.tsx
    loading.tsx
    (admin)/
      layout.tsx
      dashboard/
      connection/
      commands/
      macros/
      points/
      video-donations/
      roulette/
      donations/
      variables/
      diagnostics/
      settings/
    (viewer)/
      pvd/[viewerToken]/
      roulette/[viewerToken]/
    (public)/
      c/[channelUid]/commands/
      c/[channelUid]/points/
      c/[channelUid]/roulette/
      c/[channelUid]/roulette/logs/
      c/[channelUid]/live/
    api/
      proxy/[...path]/route.ts
  features/
    connection/
    commands/
    macros/
    points/
    video-donations/
    roulette/
    donations/
    variables/
    diagnostics/
    viewers/
    public-channel/
  shared/
    api/
    components/
    hooks/
    styles/
    types/
    utils/
```

Route group 사용:

- `(admin)`: 로그인한 스트리머 운영자 콘솔
- `(viewer)`: OBS/browser source 전용 full-screen viewer
- `(public)`: 시청자 공개 조회 페이지

URL에는 route group 이름이 노출되지 않는다.

## 5. URL 설계

### 관리자 콘솔

| 목적 | 새 경로 | 주요 params/search |
| --- | --- | --- |
| 홈 대시보드 | `/dashboard` | `?range=24h|7d|30d` |
| 연결/OAuth/API Key | `/connection` | `?auth=success|failed` |
| API Key 상세 | `/connection/api-keys/[keyId]` | `keyId` |
| 명령어 목록 | `/commands` | `?q=&role=&enabled=&page=` |
| 명령어 생성 | `/commands/new` | 없음 |
| 명령어 상세 | `/commands/rules/[ruleId]` | `ruleId` |
| 명령어 편집 | `/commands/rules/[ruleId]/edit` | `ruleId` |
| 명령어 실행 기록 | `/commands/rules/[ruleId]/history` | `ruleId`, `?page=` |
| 매크로 목록 | `/macros` | `?enabled=&page=` |
| 매크로 생성 | `/macros/new` | 없음 |
| 매크로 편집 | `/macros/[macroId]/edit` | `macroId` |
| 매크로 타이머 진단 | `/macros/[macroId]/timers` | `macroId` |
| 포인트 랭킹 | `/points` | `?q=&sort=&page=` |
| 사용자 포인트 상세 | `/points/users/[userId]` | `userId` |
| 포인트 import | `/points/import` | 없음 |
| 포인트 export | `/points/export` | `?format=json` |
| 영상 후원 대기열 | `/video-donations/queue` | `?status=queued|playing|done` |
| 영상 후원 설정 | `/video-donations/settings` | 없음 |
| 영상 후원 항목 상세 | `/video-donations/items/[itemId]` | `itemId` |
| 영상 후원 viewer 관리 | `/video-donations/viewer` | 없음 |
| 룰렛 목록 | `/roulette` | `?q=&type=&theme=` |
| 룰렛 생성 | `/roulette/new` | 없음 |
| 룰렛 상세 | `/roulette/defs/[rouletteId]` | `rouletteId` |
| 룰렛 편집 | `/roulette/defs/[rouletteId]/edit` | `rouletteId` |
| 룰렛 항목 편집 | `/roulette/defs/[rouletteId]/items/[itemId]` | `rouletteId`, `itemId` |
| 룰렛 로그 | `/roulette/logs` | `?q=&page=&limit=` |
| 룰렛 viewer 관리 | `/roulette/viewer` | 없음 |
| 후원 명령어 목록 | `/donations/rules` | `?enabled=` |
| 후원 명령어 생성 | `/donations/rules/new` | 없음 |
| 후원 명령어 편집 | `/donations/rules/[ruleId]/edit` | `ruleId` |
| 후원 설정 | `/donations/settings` | 없음 |
| 변수 레퍼런스 | `/variables` | `?section=live|user|special` |
| 진단 홈 | `/diagnostics` | `?tab=system|cache|security` |
| 채널 토큰 진단 | `/diagnostics/tokens` | `?type=roulette|pvd|api` |
| WebSocket 진단 | `/diagnostics/realtime` | `?channelId=` |
| 앱 설정 | `/settings` | 없음 |

### OBS/viewer 전용

| 목적 | 새 경로 | 기존 호환 alias |
| --- | --- | --- |
| 영상 후원 viewer | `/viewer/pvd/[viewerToken]` | `/pvd/[viewerToken]` rewrite 유지 |
| 룰렛 viewer | `/viewer/roulette/[viewerToken]` | `/roulette/[viewerToken]` rewrite 유지 |
실제 Next app route는 두 버전을 모두 둘 수 있다.

```text
app/(viewer)/viewer/pvd/[viewerToken]/page.tsx
app/(viewer)/pvd/[viewerToken]/page.tsx
app/(viewer)/viewer/roulette/[viewerToken]/page.tsx
app/(viewer)/roulette/[viewerToken]/page.tsx
```

### 공개 페이지

기존 `/commands/:uid` 스타일은 유지하되, 새 canonical URL은 채널 단위로 통합한다.

| 목적 | 새 canonical | 기존 호환 |
| --- | --- | --- |
| 공개 명령어 | `/c/[channelUid]/commands` | `/commands/[channelUid]` |
| 공개 포인트 | `/c/[channelUid]/points` | `/points/[channelUid]` |
| 공개 룰렛 정보 | `/c/[channelUid]/roulette` | `/roulettelist/[channelUid]` |
| 공개 룰렛 로그 | `/c/[channelUid]/roulette/logs` | `/roulettelog/[channelUid]` |
| 공개 라이브 상태 | `/c/[channelUid]/live` | 신규 |

호환 URL은 Next route 또는 redirect/rewrite로 처리한다.

## 6. Next.js routing 파일 설계

예시:

```text
src/app/(admin)/commands/page.tsx
src/app/(admin)/commands/new/page.tsx
src/app/(admin)/commands/rules/[ruleId]/page.tsx
src/app/(admin)/commands/rules/[ruleId]/edit/page.tsx
src/app/(admin)/commands/rules/[ruleId]/history/page.tsx

src/app/(public)/c/[channelUid]/commands/page.tsx
src/app/(public)/commands/[channelUid]/page.tsx

src/app/(viewer)/viewer/roulette/[viewerToken]/page.tsx
src/app/(viewer)/roulette/[viewerToken]/page.tsx
```

고유 파라미터 규칙:

- 채널 공개 페이지: `channelUid`
- OBS viewer: `viewerToken`
- 명령어: `ruleId`
- 매크로: `macroId`
- 포인트 사용자: `userId`
- 영상 후원 항목: `itemId`
- 룰렛: `rouletteId`
- 룰렛 항목: `itemId`
- 후원 규칙: `ruleId`

동일한 `[id]` 이름을 남발하지 않고 도메인 의미가 드러나는 param명을 사용한다.

## 7. 데이터 패칭 전략

### 원칙

- Server Component에서 가능한 초기 데이터를 fetch한다.
- 인증 cookie가 필요한 요청은 server-side fetch wrapper에서 처리한다.
- 실시간/주기 갱신이 필요한 영역은 Client Component로 분리한다.
- viewer는 browser API, WebSocket, YouTube iframe 때문에 Client Component 중심으로 둔다.

### Fetch wrapper

```text
shared/api/server.ts    # server-only backend fetch
shared/api/client.ts    # browser fetch
shared/api/public.ts    # public page fetch
```

환경 변수:

- 기존 `VITE_API_BASE`는 `NEXT_PUBLIC_API_BASE`로 변경한다.
- 서버 전용 backend origin은 `ARUBOT_API_INTERNAL_BASE` 또는 `SERVER_API_BASE`로 둔다.
- client bundle에 secret을 노출하지 않는다.

### 캐싱 정책

- 관리자 데이터: 기본 `no-store`
- 공개 명령어/룰렛 정의: 짧은 revalidate 가능, 예: 30초
- 공개 포인트/로그: 검색/페이지네이션이 있으므로 server fetch with searchParams
- viewer 데이터: cache 금지, WebSocket 우선

## 8. Server/Client Component 경계

Server Component:

- 관리자 page shell
- public page initial table
- metadata generation
- static variable reference
- settings initial load

Client Component:

- OAuth redirect 처리 후 toast
- API Key copy/blur/rotation
- command editor form
- macro interval editor
- points inline editing/import file input
- video donation queue drag/drop/player
- roulette item editor/probability auto-adjust
- PVD viewer
- roulette viewer animation/WebSocket

무거운 컴포넌트:

- YouTube player viewer
- Roulette animation viewer
- drag/drop queue
- large import/export logic

위 항목은 `next/dynamic`으로 필요한 route에서만 로드한다.

## 9. 디자인 시스템 기획

### 제품 톤

목표는 “방송 운영실 콘솔”이다. 마케팅 페이지처럼 큰 hero나 설명 카드가 아니라, 현재 상태와 다음 작업이 바로 보이는 밀도 있는 도구 UI가 필요하다.

상세한 라이트/다크 테마, 모바일 shell, 애니메이션, 그라데이션, 오픈소스 컴포넌트 도입 기준은 [프론트엔드 비주얼 디자인 시스템 고도화 기획서](./FRONTEND_VISUAL_DESIGN_SYSTEM_PLAN.md)를 따른다.

시각 방향:

- 배경: charcoal/navy 계열의 낮은 채도
- 주요 surface: deep gray, border는 명확하지만 얇게
- accent: cyan/green/amber/red를 의미별로 제한 사용
- radius: 6-8px 중심
- 그림자보다 border와 계층 spacing 중심
- 데이터 표와 form control은 compact하고 읽기 쉽게

### App shell

- 좌측 sidebar: 기능 navigation
- 상단 status bar: 연결 상태, 방송 상태, bot enabled, 현재 채널
- 본문: 페이지별 header + toolbar + primary content
- 우측 drawer: 상세/편집/진단 패널

### 주요 컴포넌트

- `AppSidebar`
- `TopStatusBar`
- `PageHeader`
- `Toolbar`
- `DataTable`
- `EntityList`
- `DetailDrawer`
- `ConfirmDialog`
- `Toast`
- `CopySecretField`
- `StatusBadge`
- `MetricStrip`
- `SegmentedControl`
- `InlineEditableNumber`
- `RouteTabs`

### 화면별 디자인

- Dashboard: 현재 연결/방송/봇/포인트/큐/룰렛 상태를 1 화면에서 스캔
- Commands: table + drawer, rule matcher와 response preview
- Points: ranking table 중심, import/export는 별도 페이지
- Video Donations: queue board + now playing split view
- Roulette: left list + right builder, probability validation rail
- Donations: rules list + condition builder
- Diagnostics: log/metric table, 위험 작업은 별도 action zone
- Viewers: chrome 없는 full-screen transparent canvas
- Public pages: 가벼운 channel header + 검색/정렬 table

## 10. 디자인 시안 제작 계획

구현 전 Image Gen으로 다음 시안을 만든다.

1. 관리자 Dashboard primary screen
2. Commands table + edit drawer
3. Points ranking + inline edit
4. Video donation queue + now playing
5. Roulette builder + theme preview
6. Public channel command page
7. Mobile admin navigation state

시안 승인 후 디자인 토큰과 컴포넌트 규칙을 확정한다. 구현 중에는 시안과 브라우저 스크린샷을 비교해 fidelity를 맞춘다.

## 11. 기능별 페이지 책임

### Dashboard

데이터:

- connection status
- live status
- bot enabled
- recent command count
- point row count
- video queue count
- last roulette results

UI:

- 상태 strip
- 최근 활동 timeline
- 빠른 작업: 명령어 추가, 포인트 import, viewer URL 복사

### Connection

기능:

- CHZZK login/logout
- token availability
- API Key issue/reuse/rotate/revoke
- WARUDO plugin 연결 안내

주의:

- API Key는 blur 처리와 click copy 유지
- rotate는 confirm dialog 필수

### Commands

기능:

- 목록, 검색, 필터, 상세, 생성, 수정, 삭제
- 권한 level, pointsCost, cooldown
- responses 빈 배열 처리
- 변수 삽입 helper

### Macros

기능:

- 목록, 생성, 수정, 삭제
- enabled toggle
- intervalSec validation
- timer/status route 연결

### Points

기능:

- ranking table
- user detail route
- set/incr/delete
- import/export/clear

### Video Donations

기능:

- settings
- queue
- item detail
- viewer URL management
- title resolve
- pop/reorder/delete/refund

### Roulette

기능:

- roulette definitions
- item editor
- probability sum validation
- theme preview
- logs
- viewer URL management

### Public Channel

기능:

- live badge
- commands list
- points table
- roulette defs
- roulette logs

SEO:

- channelUid 기반 metadata
- canonical은 `/c/[channelUid]/*`
- 기존 URL은 호환 canonical 또는 redirect

## 12. 호환성 전략

### 기존 URL 보존

다음 URL은 절대 깨지면 안 된다.

- `/pvd/:token`
- `/roulette/:token`
- `/commands/:uid`
- `/points/:uid`
- `/roulettelog/:uid`
- `/roulettelist/:uid`

viewer URL 안정성은 백엔드/Supabase에서 보장한다. 상세안은 [Supabase DB 개선 설계서](./SUPABASE_DB_IMPROVEMENT_PLAN.md)를 따른다. Next.js는 기존 token URL을 그대로 렌더하고, token 재발급은 명시적인 rotate action으로만 노출한다.

Next.js에서는 다음 중 하나로 처리한다.

- 같은 path에 page를 둔다.
- `next.config.js` rewrites/redirects로 canonical route에 연결한다.

### API path 보존

백엔드 Express가 계속 `/api/*`를 담당한다. Next.js dev/prod에서 API base 처리 방식:

- 개발: Next dev server에서 `/api/:path*` rewrite -> `http://localhost:3001/api/:path*`
- 운영: `NEXT_PUBLIC_API_BASE=https://arubotapi.yuaru.com`
- 필요 시 `app/api/proxy/[...path]/route.ts`는 same-origin 배포용 bridge로만 둔다.

### Viewer behavior 보존

- transparent background
- full viewport
- token param 이름은 내부적으로 `viewerToken`
- query params는 추가 가능하지만 기존 token URL은 그대로 동작
- WebSocket reconnect/fallback 유지

## 13. 패키지 전환 계획

제거:

- `vite`
- `@vitejs/plugin-react`
- Vite config/proxy
- `index.html`

추가:

- `next`
- `sharp` optional if image optimization 필요
- 필요한 경우 `clsx`, `tailwind-merge`, `zod`

유지:

- `react`
- `react-dom`
- `tailwindcss`
- `lucide-react`
- 기존 테스트 도구는 Next 환경에 맞춰 조정

scripts:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "server": "node server/index.js",
  "dev:server": "npm run server",
  "lint": "next lint",
  "test": "jest"
}
```

단, `next lint` 지원 상태와 프로젝트 ESLint flat config 호환성은 실제 설치 버전에서 확인한다.

## 14. Next config 기획

```ts
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
      { source: '/commands/:uid', destination: '/c/:uid/commands' },
      { source: '/points/:uid', destination: '/c/:uid/points' },
      { source: '/roulettelog/:uid', destination: '/c/:uid/roulette/logs' },
      { source: '/roulettelist/:uid', destination: '/c/:uid/roulette' }
    ];
  }
};
```

운영에서는 rewrites 대상이 환경 변수 기반이어야 한다.

## 15. 테스트 계획

### 자동 테스트

- route generation: 모든 route path가 렌더되는지
- API client: base URL, credentials, error handling
- command editor validation
- roulette probability editor
- points import parser
- viewer payload reducer
- public pages table filter/sort

### E2E

- `/connection` login 상태별 화면
- `/commands/new` -> 저장 -> `/commands/rules/[ruleId]`
- `/points/import` -> import 진행
- `/video-donations/queue` -> reorder/delete/refund
- `/roulette/new` -> item 추가 -> 저장 -> `/roulette/defs/[rouletteId]`
- `/viewer/roulette/[viewerToken]` WebSocket message render
- `/c/[channelUid]/commands` public rendering

### Visual QA

- desktop 1440x900
- laptop 1280x800
- mobile 390x844
- OBS viewer 1920x1080 transparent
- OBS viewer 1280x720 transparent

## 15.1 Next.js 최적화 기준

상세 기준은 [최적화 및 서비스 개선 제안서](./OPTIMIZATION_AND_SERVICE_IMPROVEMENTS.md)를 따른다.

- Server Component를 기본으로 사용하고 Client Component 경계를 최소화한다.
- 관리자, 공개 페이지, OBS viewer bundle을 route 단위로 분리한다.
- heavy viewer/animation/drag-drop/import 로직은 dynamic import로 해당 페이지에서만 로드한다.
- public page는 서버 렌더링과 짧은 revalidate 또는 backend cache를 조합한다.
- 검색/필터는 URL search params와 debounce를 사용해 불필요한 요청을 줄인다.
- route별 loading/error UI를 두어 느린 요청이 전체 앱을 막지 않게 한다.

## 16. 단계별 실행 계획

### Phase 0. 기준선

- 현재 Vite app 주요 기능 스크린샷 확보
- current route/API contract snapshot 작성
- 한글 문구 복구표 작성
- `/api/video-donation/now-playing` 누락 여부 확인

### Phase 1. Next.js scaffold

- Next.js 의존성 추가
- `src/app` 생성
- Tailwind globals 이전
- API wrapper 이전
- 기존 Vite 빌드 파일 제거는 마지막에 진행

### Phase 2. Routing skeleton

- 모든 admin/public/viewer route 파일 생성
- 각 route에 임시 skeleton UI 배치
- rewrites/compat route 검증

### Phase 3. Design system

- Image Gen 시안 제작 및 승인
- tokens, typography, layout primitives 구현
- App shell 구현

### Phase 4. Feature migration

순서:

1. Public pages
2. Connection
3. Commands
4. Points
5. Macros
6. Donations
7. Video Donations
8. Roulette admin
9. PVD viewer
10. Roulette viewer
11. Diagnostics

이 순서는 위험도가 낮은 페이지부터 시작해 WebSocket/OBS viewer를 후반에 집중 검증하기 위함이다.

### Phase 5. Vite 제거와 QA

- `src/main.tsx`, `src/App.tsx`, `index.html`, `vite.config.ts` 제거 또는 보관 후 삭제
- package scripts 정리
- build/test/lint
- Browser screenshot QA
- OBS viewer 실제 URL QA

## 17. 완료 기준

- Next.js App Router로 전체 프론트엔드가 동작한다.
- 기존 Vite 라우팅이 제거된다.
- 기존 공개 URL과 viewer URL이 모두 유지된다.
- 관리자 기능이 독립 route로 세분화된다.
- 한글 깨짐 UI 문구가 없다.
- desktop/mobile/OBS viewer 화면에서 overflow나 겹침이 없다.
- 기존 백엔드 API 계약을 바꾸지 않고 기능이 동작한다.
- 새 디자인 시스템과 공통 컴포넌트가 반복 UI를 일관되게 처리한다.
