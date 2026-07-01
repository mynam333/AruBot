# Frontend 리팩토링 설계서

## 1. 현재 프론트엔드 구조

현재 React 앱은 다음 entrypoint와 화면을 가진다.

- `src/App.tsx`: 경량 path 분기와 전체 운영 UI shell
- `/pvd/:token`: `PvdViewer`
- `/roulette/:token`: `RouletteViewer`
- 운영 UI tabs: 연결, 봇 설정, 변수, 후원, 채널 포인트, 통계
- `public/commands`, `public/points`, `public/roulettelog`, `public/roulettelist`: 별도 정적 HTML 공개 페이지

주요 컴포넌트:

- `ConnectionPanel`: OAuth 상태, 연결/해제, API Key 발급/재발급, 봇 on/off
- `BotControls`: 봇 설정, 명령어 규칙, 매크로
- `ChannelPointsPanel`: 포인트 관리, 영상 후원, 룰렛 관리까지 포함
- `DonationsPanel`: 후원 포인트 환산, 후원 명령어 규칙
- `PvdViewer`: YouTube iframe 기반 OBS 영상 후원 viewer
- `RouletteViewer`: OBS 룰렛 viewer, WebSocket, animation, theme
- `VariablesHelp`: placeholder와 special trigger 안내
- `BotStats`: 연결/처리/응답/방송 상태

## 2. 현재 UI/코드 문제

- 한글 UI 문자열 상당수가 깨져 있어 실제 사용자가 기능을 이해하기 어렵다.
- `ChannelPointsPanel`이 포인트, 영상 후원, 룰렛 편집까지 담당해 변경 위험이 크다.
- `RouletteViewer`는 animation, WebSocket, reconnect, theme SVG, state queue가 한 파일에 몰려 있다.
- `App.tsx`가 탭 노출과 연결 상태를 직접 관리하고, route 계층이 없다.
- 정적 공개 페이지는 React 앱과 별도라 헤더, 탭, API base, live badge 코드가 중복된다.
- `ChatSimulator`는 코드에 있지만 현재 `App.tsx` 탭에서 사실상 사용되지 않는다.
- form validation, optimistic update, loading/error state가 화면마다 다르게 구현되어 있다.
- Tailwind class가 각 컴포넌트에 흩어져 있어 디자인 토큰이 없다.

## 3. 목표 UX 방향

AruBot은 마케팅 사이트가 아니라 방송 운영 도구다. 따라서 첫 화면은 설명형 랜딩 페이지가 아니라 바로 상태와 작업을 보여주는 console이어야 한다.

디자인 방향:

- 어두운 테마는 유지하되 대비, spacing, 표/폼 밀도를 정리한다.
- 라이트 모드와 다크 모드를 모두 지원하고 system preference를 따른다.
- 화려한 motion, gradient, glass surface는 정보 위계를 해치지 않는 범위에서 적극 사용한다.
- 좌측 primary navigation + 상단 status bar 구조를 권장한다.
- 카드 남발보다 table, split panel, toolbar, detail drawer를 사용한다.
- 위험 작업은 명확한 confirmation modal과 결과 toast를 둔다.
- OBS viewer는 투명 배경, 16:9/전체 화면 안정성, 초저잡음 렌더링을 우선한다.
- 공개 페이지는 모바일에서도 검색/정렬/페이지네이션이 자연스럽게 동작해야 한다.

상세 디자인 시스템은 [프론트엔드 비주얼 디자인 시스템 고도화 기획서](./FRONTEND_VISUAL_DESIGN_SYSTEM_PLAN.md)를 따른다.

## 4. 목표 정보 구조

```text
AppShell
  StatusBar
    connection state
    live state
    bot enabled toggle
    active channel
  Sidebar
    연결
    명령어
    매크로
    채널 포인트
    영상 후원
    룰렛
    후원 명령어
    변수
    통계/진단
```

각 화면:

- 연결: OAuth, API Key, WARUDO/Electron 연동 안내, logout
- 명령어: 규칙 목록, 검색, 추가/편집 drawer, 권한/포인트/cooldown
- 매크로: 목록, interval, enabled, 실패 상태, debug reset
- 채널 포인트: 랭킹 table, inline edit, import/export, clear
- 영상 후원: 설정, viewer URL, now playing, queue reorder/delete/refund
- 룰렛: 정의 목록, 항목 편집, 확률 검증, theme preview, viewer URL, 로그 링크
- 후원 명령어: 포인트 환산, 금액 조건 규칙, 반복 전송
- 변수: placeholder와 special trigger reference
- 통계/진단: 처리량, 라이브 상태, cache/connection health

## 5. 권장 파일 구조

```text
src/
  app/
    App.tsx
    routes.tsx
    AppShell.tsx
    providers.tsx
  features/
    connection/
      ConnectionPage.tsx
      api.ts
      hooks.ts
    commands/
      CommandsPage.tsx
      CommandRuleForm.tsx
      CommandRuleTable.tsx
      types.ts
    macros/
    points/
    videoDonation/
    roulette/
      RouletteAdminPage.tsx
      RouletteViewerPage.tsx
      RouletteThemePreview.tsx
      rouletteAnimation.ts
      rouletteThemes.ts
    donations/
    variables/
    stats/
    publicPages/
  shared/
    api/
      client.ts
      errors.ts
    components/
      Button.tsx
      IconButton.tsx
      Field.tsx
      Modal.tsx
      Toast.tsx
      DataTable.tsx
      CopyField.tsx
      StatusBadge.tsx
      Tabs.tsx
    hooks/
    styles/
      tokens.css
    types/
```

## 6. 공통 UI 컴포넌트

우선 만들 컴포넌트:

- `Button`, `IconButton`
- `CopyField`: API Key/viewer URL blur, click-copy, copied state
- `StatusBadge`: connected/live/enabled/error
- `ConfirmDialog`
- `ToastProvider`
- `DataTable`
- `FormField`, `NumberField`, `TextareaField`, `Switch`
- `SectionHeader`
- `EmptyState`
- `InlineError`

규칙:

- 아이콘 버튼은 lucide-react를 사용한다.
- 버튼 내 텍스트가 줄바꿈/overflow 되지 않도록 min-width와 responsive 처리한다.
- 테이블/툴바/폼의 font size를 명시한다.
- cards inside cards를 피하고, 반복 항목과 modal에만 card를 쓴다.

## 7. 상태 관리와 API layer

현재 `apiFetch`는 base URL만 처리한다. 다음 기능을 추가한다.

- typed API functions
- JSON parse helper
- uniform error shape
- 401/403 handling
- abort signal
- query params builder

예시:

```ts
export async function getBotSettings(signal?: AbortSignal): Promise<BotSettings> {
  return api.get('/api/bot/settings', { signal }).then(r => r.settings);
}
```

서버 상태는 초기에는 React hooks로 충분하다.

- `useBotSettings`
- `useCommandRules`
- `useMacros`
- `useChannelPoints`
- `useVideoDonationQueue`
- `useRouletteDefs`
- `useLiveStatus`

React Query 같은 라이브러리는 추가 의존성을 늘리므로, 실제 리팩토링 중 caching/retry가 복잡해질 때 도입한다.

## 8. 기능별 리팩토링 계획

### Connection

보존 기능:

- 저장된 token 확인 후 자동 연결
- CHZZK login redirect
- logout 시 `chzzk_no_autoconnect`
- API Key 발급/재발급
- API Key blur/copy
- botEnabled toggle

개선:

- OAuth 상태, backend 상태, realtime 상태를 분리 표시한다.
- API Key 발급은 “기존 key 재사용”과 “rotate” 동작을 명확히 나눈다.
- WARUDO plugin 연결 방법을 별도 compact panel로 제공한다.

### Commands

보존 기능:

- rule add/update/delete
- name, keywords, responses, enabled, requiredRoleLevel, pointsCost, cooldown
- cooldown 최소 1초
- 빈 responses 허용 여부는 현재 동작에 맞춰 보존한다.

개선:

- 목록 table + detail drawer
- 검색/필터(enabled/권한)
- 응답 preview와 변수 삽입 메뉴
- 저장 전 validation 메시지

### Macros

보존 기능:

- list/upsert/delete
- enabled, intervalSec, message
- timer reset/debug/performance API

개선:

- “다음 전송까지” 상태는 backend debug API가 있으면 표시
- 실패/backoff 상태 표시
- 수정은 inline quick toggle과 drawer full edit로 분리

### Channel points

보존 기능:

- 2초 polling
- 검색
- inline edit
- export/import/clear
- set/incr/delete

개선:

- pagination 또는 virtualization
- import 진행률 표시
- clear confirmation 강화
- 사용자 row action menu

### Video donation

보존 기능:

- 설정 저장
- viewer URL copy/rotation
- YouTube title resolve
- queue reorder/delete/refund
- now playing, next/pop
- PVD viewer playback sync

개선:

- 포인트 관리 화면에서 분리
- queue item drag/drop 접근성 개선
- viewer URL과 token rotation 위험 안내
- `now-playing` API 누락 여부 해결 후 상태 동기화 hook 작성

### Roulette admin

보존 기능:

- viewer URL copy
- roulette add/remove/save
- type switch: items/probability
- item label/value/weight/probability
- probability sum validation and auto-adjust
- theme preview

개선:

- 룰렛 목록 sidebar + selected detail
- 항목 table에서 drag reorder 추가 가능
- probability 오류를 저장 버튼 근처에 집계 표시
- theme preview는 hover 대신 click popover도 제공해 터치 대응

### Roulette viewer

보존 기능:

- `/roulette/:token`
- token validation/resolve
- WebSocket connect/reconnect
- initial/stored result handling
- batch progress
- SFX
- themes: classic, fire, ice, cyber, gold, pastel, forest, sakura, midnight, sunset
- transparent OBS background

개선:

- animation engine을 hook/module로 분리
- theme CSS/SVG를 `rouletteThemes.ts`와 CSS로 분리
- debug panel은 dev flag로만 렌더
- payload queue 처리와 duplicate suppression을 테스트 가능하게 분리

### Public pages

보존 URL:

- `/commands/:uid`
- `/points/:uid`
- `/roulettelog/:uid`
- `/roulettelist/:uid`

개선 선택지:

1. React route로 통합하고 Vercel rewrite 유지
2. 정적 HTML을 유지하되 공유 JS/CSS bundle 생성

권장:

- React route로 통합한다.
- 검색/정렬/페이지네이션 컴포넌트를 공유한다.
- SEO meta는 route별로 유지한다.
- API base 로직은 `getPublicApiBase()` 한 곳으로 모은다.

## 9. 디자인 토큰

초기 토큰 예시:

```css
:root {
  --bg: #0b1120;
  --surface: #111827;
  --surface-2: #1f2937;
  --border: #374151;
  --text: #f9fafb;
  --muted: #9ca3af;
  --accent: #38bdf8;
  --success: #34d399;
  --warning: #f59e0b;
  --danger: #f87171;
  --radius-sm: 4px;
  --radius-md: 8px;
}
```

주의:

- 전체 UI를 한 가지 파란색 계열만으로 덮지 않는다.
- 운영 도구이므로 hero, marketing copy, decorative orb를 만들지 않는다.
- 표와 폼의 정보 밀도를 유지한다.

## 9.1 프론트엔드 최적화 기준

상세 기준은 [최적화 및 서비스 개선 제안서](./OPTIMIZATION_AND_SERVICE_IMPROVEMENTS.md)를 따른다.

- 포인트/로그처럼 큰 목록은 서버 페이지네이션과 필요 시 virtualization을 사용한다.
- polling은 tab focus/visibility에 따라 중지하고, WebSocket이 연결된 viewer는 polling을 중단한다.
- viewer, drag/drop, import/export, roulette animation은 route 단위로 lazy load한다.
- form 저장 후 전체 화면 refetch보다 변경 entity만 갱신한다.
- toast, modal, copy field 같은 UI 상태는 서버 상태와 분리해 불필요한 rerender를 줄인다.

## 10. 접근성과 반응형

- 모든 input은 label을 가진다.
- icon-only button은 `aria-label`과 tooltip을 가진다.
- modal은 focus trap과 Escape close를 지원한다.
- keyboard로 table row action 접근 가능해야 한다.
- mobile에서는 sidebar를 drawer로 접고, table은 중요한 열 우선순위로 표시한다.
- OBS viewer는 viewport resize에서도 내용 clipping이 없어야 한다.

## 11. 검증 계획

수동 QA:

- 로그인 전/후 연결 페이지
- 명령어 생성/수정/삭제
- 매크로 생성/토글/삭제
- 포인트 import/export/수정/삭제
- 영상 후원 request -> queue -> viewer playback -> pop/refund
- 룰렛 생성 -> viewer URL -> command trigger -> OBS viewer 표시
- 후원 명령어 저장
- 공개 페이지 4종 UID route
- mobile width 390px, desktop 1440px

자동 테스트:

- form validation unit
- hooks API mock test
- roulette probability editor
- public page render
- viewer WebSocket payload reducer

## 12. 완료 기준

- 기존 기능과 URL이 모두 유지된다.
- 한글 깨짐 문구가 운영 UI에서 사라진다.
- 주요 화면 컴포넌트가 300줄 내외로 분리된다.
- 공통 컴포넌트와 API layer가 중복을 줄인다.
- desktop/mobile에서 텍스트 overflow와 버튼 깨짐이 없다.
- OBS viewer가 transparent background와 full viewport rendering을 유지한다.
