# AruBot

AruBot은 CHZZK와 CIME 채팅 운영을 함께 지원하는 Next.js + Express 기반 채팅봇 서비스입니다. 기존 기능을 유지하면서 관리자 UI를 멀티 페이지 구조로 분리하고, 영상 후원/룰렛 OBS 뷰어, 명령어, 매크로, 포인트, 후원 규칙, 공개 페이지를 관리합니다.

## 주요 기능

- CHZZK OAuth 로그인, 채팅 이벤트 수신, 방송 상태 조회
- CIME OAuth 로그인, 이벤트 스트림 연동, 플랫폼 계정 연결
- 플랫폼별 로그인 후 하나의 내부 사용자로 관리하는 계정 매핑 구조
- 봇 명령어 규칙 관리: 키워드, 자동 응답, 권한, 쿨다운, 포인트 비용
- 방송 상태 기반 명령어 제한과 출석 체크
- 채널 포인트 조회, 수정, 지급/차감, JSON 가져오기/내보내기
- 예측 베팅: 웹에서 예측 열기, 채팅 명령어 참여, 포인트 정산/환불, OBS 현황 오버레이
- 영상 후원 큐, YouTube 재생 뷰어, 삭제/보류/순서 변경, 안정적인 공개 토큰
- 룰렛 정의, 확률/가중치 방식, OBS 룰렛 뷰어, 실행 로그
- 후원 금액 기반 포인트 정산과 자동 응답
- 방송 중 자동 매크로 전송
- 공개 페이지: 명령어 목록, 포인트 목록, 룰렛 로그, 룰렛 정보

## 프로젝트 구조

```text
src/app/              Next.js App Router 페이지
src/components/       공통 UI, 앱 셸, 레거시 뷰어 컴포넌트
src/features/         관리자 기능별 화면 조합
src/shared/           API 헬퍼, 라우팅/내비게이션 설정
server/               Express API, OAuth, WebSocket, Supabase/SQLite 연동
server/migrations/    PostgreSQL 마이그레이션 SQL
public/               정적 공개 파일과 복사된 viewer 리소스
tests/                Jest 기반 통합/비즈니스 로직 테스트
docs/                 리팩터링, 최적화, DB, CIME 연동 문서
```

## 실행 준비

```bash
npm install
cp .env.example .env
```

필수 환경 변수:

- `SERVER_PORT`: Express 서버 포트. 기본값은 `3001`
- `APP_REDIRECT_AFTER_LOGIN`: OAuth 완료 후 이동할 프론트엔드 URL
- `OAUTH_STATE_SECRET`: OAuth state 서명에 사용하는 고정 비밀값
- `NEXT_PUBLIC_API_BASE`: 프론트엔드와 백엔드를 분리 배포할 때 사용할 API base URL
- `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, `CHZZK_REDIRECT_URI`
- `CIME_CLIENT_ID`, `CIME_CLIENT_SECRET`, `CIME_REDIRECT_URI`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`

선택 환경 변수:

- `CIME_OPENAPI_BASE`: CIME OpenAPI base URL. 기본값은 `https://ci.me/api/openapi`
- `REDIS_URL`: 실시간 이벤트 fanout을 보조할 Redis 인스턴스
- `YOUTUBE_API_KEY`: 영상 후원 제목/검색 메타데이터 보강

## 로컬 개발

백엔드:

```bash
npm run server
```

프론트엔드:

```bash
npm run dev
```

Next.js 개발 서버는 기본적으로 `http://localhost:3000`에서 실행됩니다. 로컬 프론트엔드는 `NEXT_PUBLIC_API_BASE`가 비어 있으면 `http://127.0.0.1:3001` Express API를 사용합니다.

## 빌드와 검증

```bash
npm run lint
npm test -- --runInBand
npm run build
```

`predev`와 `prebuild` 단계에서는 `server/files`의 룰렛 SFX와 로고를 `public/files`로 복사합니다.

## 주요 URL

- 메인 랜딩: `/`
- 스트리머 콘솔: `/streamer`, `/dashboard`
- 시청자 포인트: `/viewer/me`
- 대시보드: `/dashboard`
- 연결 관리: `/connection`
- 명령어: `/commands`
- 매크로: `/macros`
- 포인트: `/points`
- 예측 베팅: `/predictions`
- 예측 베팅 OBS 오버레이: `/viewer/prediction/:channelUid`
- 영상 후원 큐: `/video-donations/queue`
- 영상 후원 OBS 뷰어: `/pvd/:viewerToken`
- 룰렛: `/roulette`
- 룰렛 OBS 뷰어: `/roulette/:viewerToken`
- 공개 명령어 목록: `/commands/:channelUid`, `/c/:channelUid/commands`
- 공개 포인트 목록: `/points/:channelUid`, `/c/:channelUid/points`
- 공개 룰렛 로그: `/roulettelog/:channelUid`, `/c/:channelUid/roulette/logs`
- 공개 룰렛 정보: `/roulettelist/:channelUid`, `/c/:channelUid/roulette`

## 문서

- [전체 리팩터링 기획](./docs/REFACTOR_MIGRATION_PLAN.md)
- [백엔드 리팩터링 설계](./docs/BACKEND_MIGRATION_PLAN.md)
- [프론트엔드 리팩터링 설계](./docs/FRONTEND_MIGRATION_PLAN.md)
- [Next.js 프론트엔드 마이그레이션 기획](./docs/NEXTJS_FRONTEND_MIGRATION_PLAN.md)
- [프론트엔드 비주얼 디자인 시스템 기획](./docs/FRONTEND_VISUAL_DESIGN_SYSTEM_PLAN.md)
- [최적화 및 서비스 개선 제안](./docs/OPTIMIZATION_AND_SERVICE_IMPROVEMENTS.md)
- [Supabase DB 개선 설계](./docs/SUPABASE_DB_IMPROVEMENT_PLAN.md)
- [CIME OpenAPI 연동 정리](./docs/CIME_OPENAPI_INTEGRATION.md)
- [예측 베팅 기능](./docs/PREDICTION_BETTING_FEATURE.md)
- [방송 자동화 액션 빌더 기획](./docs/AUTOMATION_ACTION_BUILDER_PLAN.md)

## 운영 메모

- 공개 뷰어 URL은 사용자별 안정 토큰을 사용해 링크 변경을 최소화합니다.
- 영상 후원 뷰어는 페이지 가시성 변화와 플레이어 버퍼링을 고려해 상태 복구 로직을 강화했습니다.
- CHZZK와 CIME 계정은 플랫폼 계정 테이블을 통해 하나의 내부 사용자로 연결하는 방향으로 확장됩니다.
- Supabase 마이그레이션은 `server/migrations`의 순서대로 적용합니다.
