# 프론트엔드 비주얼 디자인 시스템 고도화 기획서

## 0. 2026-07 디자인 재정의: Pastel Product Console

현재 구현 기준은 “심플하지만 기억에 남는 파스텔 방송 운영 콘솔”이다. 귀여움은 캐릭터나 마스코트 이미지가 아니라 둥근 인터랙션, 부드러운 색면, 명확한 상태 배지, 짧은 마이크로 애니메이션으로 표현한다.

핵심 원칙:

- 마스코트, AI 생성 캐릭터, 의미 없는 장식 이미지는 사용하지 않는다.
- CHZZK와 CIME 로그인 버튼은 첫 화면과 `/connection`에서 바로 보여야 한다.
- 모든 화면은 실제 백엔드 API 응답을 기준으로 상태를 표시하고, mock/dummy/debug 문구를 사용자 화면에 노출하지 않는다.
- 라이트/다크 모드는 같은 정보 구조와 대비를 유지한다.
- 모바일에서는 하단 주요 내비게이션과 짧은 액션 라벨을 사용하고, 데스크톱에서는 좌측 사이드바와 상단 컨텍스트 바를 사용한다.
- 그라데이션은 큰 히어로 1개와 상태 강조 영역에만 제한하고, decorative orb/bokeh 배경은 사용하지 않는다.
- Radix Tooltip, Sonner, Tailwind 기반 컴포넌트처럼 검증된 오픈소스 primitive를 사용하되, 서비스 고유의 토큰과 문구로 조립한다.
- 애니메이션은 `fade-up`, hover lift, icon transition처럼 200-420ms 범위의 짧은 피드백으로 제한하고 `prefers-reduced-motion`을 존중한다.

구현 체크리스트:

- `/dashboard`: 실제 플랫폼 연결 상태, CHZZK/CIME 로그인 버튼, 기능 진입 카드, API 기반 상태 카드.
- `/connection`: 플랫폼별 로그인, 재연결, 연결 해제, 채널 목록, OAuth callback query 안내.
- App Shell: 마스코트 없는 브랜드 마크, 플랫폼 연결 CTA, 테마 전환 툴팁, 모바일 하단 내비게이션.
- 공통 UI: `clamp()` 기반 반응형 반경, 낮은 대비의 파스텔 surface, 명확한 focus ring, hover/lift 상태.
- 문구: 운영 품질·백엔드 내부 표현 대신 “명령어 관리”, “포인트 설정”, “OBS 주소”, “연결된 채널”처럼 사용자가 바로 이해하는 표현을 사용한다.

## 1. 목표

Next.js 전환과 함께 AruBot 프론트엔드를 단순 관리 패널이 아니라 화려하고 동적인 방송 운영 콘솔로 재설계한다. 단, 실시간 운영 도구라는 본질을 유지해야 하므로 시각 효과는 정보 구조, 작업 속도, 모바일 사용성, OBS viewer 안정성을 방해하지 않는 방식으로 적용한다.

디자인 목표:

- 라이트 모드와 다크 모드를 모두 완성도 있게 지원한다.
- 모바일, 태블릿, 데스크톱에서 같은 기능을 자연스럽게 사용할 수 있다.
- 애니메이션, 그라데이션, glass surface, skeleton, transition을 적극 활용한다.
- 상용 서비스 수준의 오픈소스 UI primitive와 headless component를 사용한다.
- dashboard/admin/public/viewer 각각에 맞는 다른 밀도와 연출을 제공한다.

## 2. 제품 디자인 방향

### 핵심 콘셉트

“Broadcast Control Studio”

방송 스튜디오의 콘솔처럼 상태가 선명하고, 실시간 변화가 살아 있으며, 명령어/포인트/룰렛/영상 후원을 빠르게 운영할 수 있는 도구형 UI를 지향한다.

### 시각 성격

- 정교한 panel layout
- 선명한 상태 색상
- 얇은 gradient border
- 은은한 animated background field
- glass/blur panel은 중요 영역에만 제한 사용
- 데이터 표는 밀도 있게, detail/editor는 넉넉하게
- 카드보다는 table, split pane, drawer, command palette 중심

### 피해야 할 것

- 단순 랜딩 페이지처럼 큰 hero만 있는 구조
- 모든 화면을 카드 grid로 처리하는 방식
- 과한 decorative orb/bokeh 배경
- 글자 대비가 낮은 유리 효과
- 모바일에서 표/버튼/모달이 깨지는 애니메이션
- OBS viewer의 투명 배경을 방해하는 전역 스타일

## 3. 테마 시스템

### 지원 모드

- Light
- Dark
- System

권장 구현:

- Next.js에서 `next-themes`로 class 기반 theme 전환
- CSS variables로 color token 정의
- Tailwind class는 semantic token을 참조

### 색상 토큰

```css
:root {
  --background: 250 250 252;
  --foreground: 18 24 38;
  --surface: 255 255 255;
  --surface-raised: 247 249 252;
  --border: 220 226 235;
  --muted: 96 105 122;
  --accent: 0 132 255;
  --accent-2: 108 92 231;
  --success: 0 168 107;
  --warning: 238 154 0;
  --danger: 229 62 62;
}

.dark {
  --background: 8 12 20;
  --foreground: 244 247 251;
  --surface: 15 23 36;
  --surface-raised: 21 31 48;
  --border: 45 58 78;
  --muted: 146 157 174;
  --accent: 56 189 248;
  --accent-2: 167 139 250;
  --success: 52 211 153;
  --warning: 251 191 36;
  --danger: 248 113 113;
}
```

### 테마별 사용감

Light mode:

- 배경은 거의 흰색에 가까운 cool gray
- surface는 명확한 white panel
- gradient는 얇은 border, active nav, chart accent에 제한
- 그림자는 부드럽고 낮게

Dark mode:

- 배경은 deep ink/navy
- surface는 slate 계열
- gradient는 active area와 realtime state에 조금 더 적극 사용
- glow는 focus/active 상태에만 사용

## 4. 반응형 정보 구조

### Desktop

- 좌측 sidebar 고정
- 상단 status bar 고정
- 본문은 12-column grid
- 목록 + detail split layout 적극 사용
- drawer는 우측에서 열린다.

### Tablet

- sidebar는 compact icon rail
- detail은 drawer 또는 full-height panel
- table column 일부 축약
- 주요 action은 toolbar에 유지

### Mobile

- 하단 navigation 또는 hamburger sheet
- 페이지 header는 compact
- table은 card list 또는 priority column table로 전환
- form은 full-screen sheet
- destructive action은 bottom confirm sheet
- viewer URL/API Key copy field는 한 줄 overflow 없이 줄바꿈 가능한 구조

### Breakpoints

- `sm`: `40rem`
- `md`: `48rem`
- `lg`: `64rem`
- `xl`: `80rem`
- `2xl`: `96rem`

크기 지정 원칙:

- 레이아웃 폭은 `%`, `fr`, `minmax()`, `clamp()`를 우선 사용한다.
- 아이콘 박스, 버튼 높이, 패널 반경은 전역 CSS 변수로 관리하고 변수 내부에서 `rem`과 viewport ratio를 조합한다.
- 고정 픽셀 기반 `width`, `height`, `border-radius`, table min-width는 사용하지 않는다.
- 정사각형 버튼과 아이콘 박스는 `aspect-ratio`를 사용해 비율을 유지한다.

모바일 우선으로 작성하되, 운영자 콘솔의 desktop 정보 밀도를 별도 최적화한다.

## 5. 레이아웃 시스템

### Admin Shell

```text
AppShell
  Sidebar / MobileNav
  TopStatusBar
  Main
    PageHeader
    Toolbar
    ContentGrid
    DrawerHost
```

### Page 유형

- Overview page: dashboard, diagnostics
- Table page: commands, points, roulette logs
- Builder page: roulette editor, donation rules
- Queue page: video donations
- Reference page: variables
- Viewer page: pvd, roulette
- Public page: channel hub, commands, points, roulette

## 6. 컴포넌트 스택

### 기본 UI

권장:

- shadcn/ui: Next.js 친화적인 component composition과 Tailwind 기반 스타일
- Radix UI primitives: 접근성 높은 Dialog, Popover, Tooltip, Tabs, Select
- Radix Themes는 전체 테마 프레임워크로 도입할지 검토하되, shadcn/ui와 중복 사용은 피한다.

사용 후보:

- Button
- Dialog
- Sheet
- Popover
- Tooltip
- Select
- Tabs
- Dropdown Menu
- Toast/Sonner
- Command
- Form
- Switch
- Slider
- Data Table pattern

### 데이터/표

- TanStack Table
  - 서버 페이지네이션
  - column visibility
  - sorting/filtering state
  - row selection
- 큰 포인트 목록은 virtualization 후보
  - TanStack Virtual 또는 react-virtualized 계열 검토

### 애니메이션

- Motion for React
  - page transition
  - drawer/sheet enter/exit
  - list item reorder
  - number count-up
  - toast transition
- CSS animation
  - gradient border
  - live pulse
  - skeleton shimmer
  - subtle background mesh

### 차트/시각화

- Recharts 또는 Tremor 스타일 chart 구성 검토
- dashboard metric sparkline
- queue length trend
- command usage trend
- roulette result distribution

### 아이콘

- lucide-react 유지
- nav/action/status 아이콘은 의미별로 고정한다.
- icon-only button은 tooltip과 aria-label 필수

## 7. 화면별 디자인 고도화

### Dashboard

디자인:

- 첫 화면에 현재 방송 운영 상태가 바로 보이는 command center
- 상단 realtime strip: 연결, 라이브, 봇 활성화, viewer 연결 수
- 좌측: 최근 이벤트 timeline
- 중앙: 오늘의 처리량, 포인트 변화, 영상 후원 queue
- 우측: 경고/할 일 panel

동적 효과:

- 라이브 상태 pulse
- metric count-up
- 최근 이벤트 slide-in
- subtle animated gradient rail

### Connection

디자인:

- OAuth 상태, API Key, WARUDO/Electron 연결을 stepper처럼 구성
- API Key는 blur field + reveal on hover/focus + copy feedback
- rotate는 danger zone으로 분리

동적 효과:

- 연결 성공 confetti는 과하지 않게 1회
- WebSocket/API 상태는 animated status dot

### Commands

디자인:

- table 중심
- row click -> right drawer detail
- edit는 full drawer
- 변수 삽입 command palette
- 응답 preview panel

동적 효과:

- rule enabled toggle transition
- keyword chip motion
- save success row highlight

### Points

디자인:

- ranking table + quick edit
- user detail route는 point history 중심
- import/export는 separate workflow page

동적 효과:

- point 변경 시 number flip/count animation
- import progress bar
- rank movement animation은 대량 목록에서는 제한

### Video Donations

디자인:

- “현재 재생”과 “대기열”을 split layout
- queue item은 thumbnail, duration, cost, requester, action menu
- settings는 별도 route
- viewer URL 관리 panel 제공

동적 효과:

- drag reorder animation
- now playing progress
- queue item enter/exit

### Roulette

디자인:

- roulette list + builder split
- items table과 preview를 같은 화면에 배치
- theme selector는 visual swatch
- probability sum 상태를 우측 validation rail에 표시

동적 효과:

- probability bar transition
- theme preview animated micro demo
- item add/remove animation

### Donations

디자인:

- 조건 builder: amount range, message match, response action
- repeat 설정은 collapsible advanced section
- rule card 대신 조건 row + detail drawer

### Diagnostics

디자인:

- metric dashboard + filterable logs
- cache hit/miss, WS connections, token usage, DB latency
- danger action은 분리된 operations zone

### Public Channel Hub

디자인:

- `/c/[channelUid]` channel hub
- live status, command list, points, roulette info를 탭으로 구성
- 시청자용이므로 관리자 UI보다 더 읽기 쉽고 가볍게
- 모바일 우선

동적 효과:

- live badge pulse
- tab transition
- table row hover/focus

### OBS Viewers

디자인:

- PVD viewer는 완전 투명 배경과 full viewport
- Roulette viewer는 theme별 화려한 animation 유지
- viewer 설정 UI는 관리자 쪽에서만 제공

주의:

- Admin app의 global background/gradient가 viewer route에 적용되면 안 된다.
- viewer route는 별도 layout으로 body overflow/background를 제어한다.

## 8. 애니메이션 원칙

### 사용 위치

- 페이지 전환
- drawer/sheet/modal
- tab switch
- list reorder
- status pulse
- skeleton
- metric update
- toast
- viewer animation

### 금지 또는 제한

- 대형 table 전체에 매번 stagger animation 적용 금지
- input typing 중 layout shift 금지
- 무한 animation이 많은 화면에서 CPU/GPU 점유를 높이는 효과 금지
- `prefers-reduced-motion` 사용자는 transition을 최소화

### Motion budget

- micro interaction: 120-180ms
- drawer/modal: 180-240ms
- page transition: 160-220ms
- skeleton shimmer: 1.2-1.8s
- live pulse: 1.8-2.4s

## 9. 그라데이션 사용 원칙

사용:

- active nav indicator
- status strip border
- dashboard highlight rail
- chart accent
- CTA primary button
- roulette theme preview

제한:

- 전체 배경을 한 가지 보라/파랑 gradient로 덮지 않는다.
- 텍스트 뒤에 대비를 떨어뜨리는 gradient를 깔지 않는다.
- decorative orb/bokeh 대신 얇은 mesh line, border gradient, subtle noise texture를 사용한다.

## 10. 라이트/다크 QA 기준

각 화면은 두 모드에서 모두 검증한다.

- 텍스트 대비
- border visibility
- active/focus state
- destructive action
- disabled state
- table zebra/hover
- chart color
- skeleton color
- toast/dialog overlay
- mobile drawer
- OBS viewer route background

## 11. 모바일 QA 기준

필수 viewport:

- 390x844
- 430x932
- 768x1024

확인:

- nav 접근성
- table/card 전환
- button text overflow
- drawer height
- modal scroll
- form keyboard focus
- copy field wrapping
- drag/drop fallback action
- theme switch

## 12. 디자인 시안 제작 계획

구현 전 Image Gen으로 다음 컨셉을 만든다.

1. Desktop dashboard dark mode
2. Desktop dashboard light mode
3. Commands table + edit drawer
4. Video donation queue
5. Roulette builder
6. Public channel hub mobile
7. Mobile admin navigation

시안 확정 후:

- color token 추출
- component variant 정의
- layout spacing scale 확정
- motion preset 정의
- 구현 fidelity checklist 작성

## 13. 도입 후보 라이브러리

### 1순위

- Next.js App Router
- Tailwind CSS
- shadcn/ui
- Radix UI primitives
- next-themes
- Motion for React
- TanStack Table
- lucide-react

### 2순위

- TanStack Virtual
- Recharts
- Sonner
- Vaul drawer
- cmdk

### 검토 기준

- 접근성
- bundle size
- SSR/Next.js 호환성
- dark mode 지원
- tree-shaking
- styling 제어권
- 유지보수 활발성
- 상용 서비스 사용에 무리 없는 라이선스

## 14. 구현 우선순위

1. Theme provider와 token system
2. App shell desktop/mobile
3. 공통 컴포넌트
4. Dashboard visual language
5. Commands page
6. Points page
7. Video donation page
8. Roulette builder
9. Public channel hub
10. Viewer route isolation
11. 전체 motion polish

## 14.1 Toast, Tooltip, Loading 세부 기획

### Toast

목표:

- 사용자가 방금 실행한 작업의 결과를 짧고 명확하게 확인한다.
- 성공/실패/주의/정보 상태를 색상, 아이콘, 좌측 상태 레일로 구분한다.
- 라이트/다크 모드에서 모두 카드처럼 읽히며, 본문 UI를 가리지 않는다.

디자인 규칙:

- 위치는 우하단을 기본으로 유지한다.
- 폭은 모바일 화면을 넘지 않도록 `min()`과 viewport 기반 값을 사용한다.
- 상태 색은 기존 semantic token을 사용한다.
- 제목은 700 weight, 설명은 muted foreground로 낮춘다.
- close button은 항상 보이되, 본문보다 시각 우선순위를 낮춘다.
- action/cancel button은 `--control-height-sm`과 `--radius-control`을 사용한다.

### Tooltip

목표:

- icon-only button과 짧은 액션의 의미를 즉시 설명한다.
- 어두운 기본 말풍선 대신 AruBot 표면 토큰을 사용해 앱 전체 톤과 맞춘다.
- 긴 설명도 모바일에서 넘치지 않게 한다.

디자인 규칙:

- Radix Tooltip primitive를 유지한다.
- 표면은 `bg-card/95`, border, blur, soft shadow를 사용한다.
- 상단에 얇은 mint/sky/coral gradient rail을 넣어 브랜드감을 준다.
- `collisionPadding`과 `max-width`를 지정해 화면 밖으로 벗어나지 않게 한다.
- 애니메이션은 160ms 내외의 scale/fade만 사용한다.

### Loading

목표:

- 단순 회색 박스가 아니라 브랜드가 살아 있는 대기 상태를 보여준다.
- 앱의 실제 레이아웃 리듬을 닮은 스켈레톤으로 화면 전환 불안을 줄인다.
- 로딩 상태에서도 문구는 짧고 사용자 관점이어야 한다.

디자인 규칙:

- `public/files/logo.png`를 중심 시각 요소로 사용한다.
- hero skeleton + 기능 카드 skeleton + 하단 action skeleton 구조로 구성한다.
- shimmer는 1.55s 내외, orbit은 1.8s 내외로 제한한다.
- `prefers-reduced-motion`에서는 전역 정책에 따라 애니메이션을 최소화한다.
- skeleton 색상은 `muted`, `card`, `surface-tint` 토큰만 사용한다.

## 15. 완료 기준

- Light/Dark/System theme가 모든 관리자/공개 페이지에서 정상 동작한다.
- 모바일에서 모든 핵심 기능을 사용할 수 있다.
- 관리자, 공개 페이지, OBS viewer layout이 서로 독립되어 있다.
- 애니메이션은 `prefers-reduced-motion`을 존중한다.
- 대형 table과 viewer animation이 성능 문제를 만들지 않는다.
- design token과 component variant가 문서화되어 있다.
- 브라우저 QA에서 desktop/mobile 두 모드 모두 텍스트 overflow가 없다.
