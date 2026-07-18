# AruBot

AruBot은 CHZZK, CIME, YouTube Live 채팅 운영을 함께 지원하는 Next.js + Express 기반 채팅봇 서비스입니다. 기존 기능을 유지하면서 관리자 UI를 멀티 페이지 구조로 분리하고, 영상 후원/룰렛 OBS 뷰어, 명령어, 매크로, 포인트, 후원 규칙, 공개 페이지를 관리합니다.

## 주요 기능

- CHZZK OAuth 로그인, 채팅 이벤트 수신, 방송 상태 조회
- CIME OAuth 로그인, 이벤트 스트림 연동, 플랫폼 계정 연결
- YouTube OAuth 로그인, Live Chat `streamList` 수신, 채팅 응답 전송
- YouTube Super Chat은 원화(KRW)인 경우에만 기존 후원 이벤트와 동일하게 처리
- 플랫폼별 로그인 후 하나의 내부 사용자로 관리하는 계정 매핑 구조
- 봇 명령어 규칙 관리: 키워드, 자동 응답, 권한, 쿨다운, 포인트 비용
- 방송 상태 기반 명령어 제한과 출석 체크
- 채널 포인트 조회, 수정, 지급/차감, JSON 가져오기/내보내기
- 예측 베팅: 웹에서 예측 열기, 채팅 명령어 참여, 포인트 정산/환불, OBS 현황 오버레이
- 영상 후원 큐, YouTube 재생 뷰어, 삭제/보류/순서 변경, 안정적인 공개 토큰
- 룰렛 정의, 확률/가중치 방식, OBS 룰렛 뷰어, 실행 로그
- 후원 금액 기반 포인트 정산과 자동 응답
- 방송 중 자동 매크로 전송
- 방송 자동화: T.I.T.S., Toonation, TTS, 사운드, Stream Deck/Touch Portal 제어 URL
- GUI 로컬 프로그램: 방송 PC에서 로컬 앱, 민감정보, 대용량 사운드 폴더, 자동화 큐 처리
- 공개 페이지: 명령어 목록, 포인트 목록, 룰렛 로그, 룰렛 정보

## 프로젝트 구조

```text
src/app/              Next.js App Router 페이지
src/components/       공통 UI, 앱 셸, 레거시 뷰어 컴포넌트
src/features/         관리자 기능별 화면 조합
src/shared/           API 헬퍼, 라우팅/내비게이션 설정
server/               Express API, OAuth, WebSocket, Supabase/SQLite 연동
server/migrations/    PostgreSQL 마이그레이션 SQL
local-program/        Electron 기반 AruBot Local Program GUI
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
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`
- `YOUTUBE_VIEWER_AUTH_SCOPE`: 시청자 YouTube 연결용 읽기 전용 scope. 기본값은 `https://www.googleapis.com/auth/youtube.readonly`
- `YOUTUBE_BOT_AUTH_SCOPE`: 중앙 봇 계정용 scope. 채팅 발송 때문에 기본값은 `https://www.googleapis.com/auth/youtube.force-ssl`
- `ARUBOT_DB_PROVIDER`: `supabase` 또는 `postgres`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`: `ARUBOT_DB_PROVIDER=supabase`일 때 사용
- `POSTGRES_URL`: `ARUBOT_DB_PROVIDER=postgres`일 때 사용. 운영 Postgres 모드에서는 Supabase 공식 서버 URL/key에 의존하지 않습니다.

선택 환경 변수:

- `CIME_OPENAPI_BASE`: CIME OpenAPI base URL. 기본값은 `https://ci.me/api/openapi`
- `YOUTUBE_AUTH_SCOPE`: 구버전 배포 호환용 중앙 봇 scope fallback. 새 설정에서는 `YOUTUBE_BOT_AUTH_SCOPE`를 사용합니다.
- `YOUTUBE_API_BASE`: YouTube Data API base URL. 기본값은 `https://www.googleapis.com/youtube/v3`
- `YOUTUBE_STREAM_PATH`: Live Chat streaming endpoint. 기본값은 `/liveChat/messages/stream`
- `REDIS_URL`: 실시간 이벤트 fanout을 보조할 Redis 인스턴스
- `YOUTUBE_API_KEY`: 공개 영상 검색, 채널·라이브 메타데이터, 대기 플레이리스트 추천에 사용합니다. 영상 후원 URL의 제목과 길이 조회에는 Data API 할당량을 사용하지 않습니다.
- `POSTGRES_POOL_MAX`, `POSTGRES_CONNECT_TIMEOUT_MS`, `POSTGRES_STATEMENT_TIMEOUT_MS`, `POSTGRES_IDLE_TIMEOUT_MS`, `POSTGRES_SSL`: Postgres provider 연결 튜닝

## 로컬 개발

백엔드:

```bash
npm run server
```

프론트엔드:

```bash
npm run dev
```

GUI 로컬 프로그램:

```bash
npm run local:app
```

DB provider 점검/전환 보조:

```bash
npm run db:migrate
npm run db:migration-status
npm run db:dump-public -- --target=supabase --out=backups/supabase-public.dump
npm run db:restore-public -- --target=postgres --file=backups/supabase-public.dump --confirm=restore-public
npm run db:repair-sequences -- --target=postgres
npm run db:counts
npm run db:compare-counts
npm run db:compare-checksums
npm run db:diff-table -- --table=sessions
npm run db:sync-volatile-tables
npm run db:provider-smoke
npm run db:cutover-preflight
npm run db:cutover-verify
npm run db:cutover-rehearsal
npm run db:cutover-rehearsal -- --execute --confirm=restore-public --base=http://localhost:3001
npm run db:switch-to-postgres
npm run db:switch-to-postgres -- --execute --confirm=switch-to-postgres --base=https://arubotapi.yuaru.com
npm run api:smoke -- --base=http://localhost:3001 --expect-provider=postgres
```

`db:switch-to-postgres`는 PM2 백엔드 중지, Supabase public schema dump, Postgres restore, migration, sequence repair, count/checksum 검증, `.env`의 `ARUBOT_DB_PROVIDER=postgres` 전환, PM2 reload, API smoke까지 한 번에 수행한다. 기본은 dry-run이며 실제 실행에는 `--execute --confirm=switch-to-postgres`가 필요하다. dump 중에도 운영 백엔드를 계속 실행해야 하는 특수 상황에서만 `--skip-runtime-stop`을 사용한다.

Windows 설치 파일 빌드:

```bash
npm run local:release
```

빌드 결과는 `public/downloads/local-program`에 생성됩니다. 이 폴더에는 Windows 설치용 `.exe`, `.exe.blockmap`, `latest.yml`, 로컬 프로그램이 업데이트 확인에 사용하는 `latest.json` manifest가 함께 들어갑니다. 홈페이지의 `/downloads/local-program` 페이지에서 최신 설치 파일을 다운로드할 수 있습니다.

Vercel에 설치 파일을 직접 올리지 않고 GitHub Releases에서 받게 하려면 아래처럼 외부 다운로드 URL을 manifest에 넣습니다.

```powershell
$env:ARUBOT_LOCAL_DOWNLOAD_BASE_URL="https://github.com/OWNER/REPO/releases/download/local-v0.1.0"
npm run local:release:external
```

이 모드는 `dist/local-program`에 생성된 `.exe`, `.exe.blockmap`, `latest.yml`, `latest.json`을 GitHub Release asset으로 올리고, `public/downloads/local-program/latest.json`만 Vercel에 배포하는 방식입니다. 로컬 프로그램의 업데이트 버튼도 이 manifest를 읽어 GitHub의 설치 파일을 내려받고 SHA-256을 검증한 뒤 다음 종료 시 설치 화면 없이 조용히 적용합니다.

다운로드 페이지(`/downloads/local-program`)는 동적 페이지입니다. `LOCAL_PROGRAM_MANIFEST_URL` 또는 `NEXT_PUBLIC_LOCAL_PROGRAM_MANIFEST_URL`을 설정하면 Vercel 배포를 다시 하지 않아도 해당 외부 manifest를 `no-store`로 읽어 최신 설치 파일 링크를 보여줍니다.

GitHub Actions 자동 배포:

- `.github/workflows/local-program-release.yml`은 `local-program/**`, Electron 빌드 설정, manifest 스크립트, 패키지 파일이 변경되어 `main` 또는 `master`에 push되면 실행됩니다.
- Actions는 Windows에서 `npm run local:release:external`을 실행해 `.exe`와 `latest.json`을 생성합니다.
- 릴리스 태그는 `local-v{자동 생성 버전}` 형식입니다. Actions에서는 `package.json`의 major/minor와 `GITHUB_RUN_NUMBER`를 조합해 예: `0.1.42` 같은 로컬 프로그램 전용 버전을 만듭니다.
- GitHub Release에는 `.exe`, `.exe.blockmap`, `latest.yml`, `latest.json`이 함께 업로드되고, 릴리스 본문에는 이전 로컬 프로그램 릴리스 이후의 변경 커밋과 변경 파일이 자동으로 적힙니다.
- Vercel 환경 변수는 `LOCAL_PROGRAM_MANIFEST_URL=https://github.com/OWNER/REPO/releases/latest/download/latest.json`처럼 설정하면 최신 GitHub Release manifest를 동적으로 읽습니다.

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
- 로컬 프로그램 다운로드: `/downloads/local-program`
- 스트리머 콘솔: `/streamer`, `/dashboard`
- 시청자 포인트: `/viewer/me`
- 대시보드: `/dashboard`
- 연결 관리: `/connection`
- 명령어: `/commands`
- 매크로: `/macros`
- 포인트: `/points`
- 예측 베팅: `/predictions`
- 방송 자동화: `/automations`
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
- [Google OAuth 공개용 검증 절차](./docs/GOOGLE_OAUTH_PUBLIC_VERIFICATION.md)
- [예측 베팅 기능](./docs/PREDICTION_BETTING_FEATURE.md)
- [방송 자동화 액션 빌더 기획](./docs/AUTOMATION_ACTION_BUILDER_PLAN.md)

## 운영 메모

- 공개 뷰어 URL은 사용자별 안정 토큰을 사용해 링크 변경을 최소화합니다.
- 영상 후원 뷰어는 페이지 가시성 변화와 플레이어 버퍼링을 고려해 상태 복구 로직을 강화했습니다.
- CHZZK와 CIME 시청자 계정은 플랫폼 계정 테이블을 통해 하나의 내부 사용자로 연결하고, YouTube는 방송 채널 OAuth로 Live Chat 송수신을 연결합니다.
- Supabase 마이그레이션은 `server/migrations`의 순서대로 적용합니다.
- 로컬 프로그램 업데이트는 `public/downloads/local-program/latest.json`의 버전과 SHA-256을 확인한 뒤 새 설치 파일을 임시 폴더에 다운로드합니다. 자동 업데이트 메타 파일이 준비된 환경에서는 Electron updater가 종료 시 조용히 적용하고, fallback 경로에서도 설치 마법사를 띄우지 않는 숨김 설치로 처리합니다. 배포 도메인이 `https://arubot.vercel.app`가 아니라면 로컬 프로그램의 업데이트 정보 주소를 실제 프론트엔드 도메인의 `/downloads/local-program/latest.json`로 바꿔 주세요.
