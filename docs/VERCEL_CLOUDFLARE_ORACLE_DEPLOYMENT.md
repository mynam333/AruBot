# Vercel, Cloudflare, Oracle Cloud 배포 가이드

이 프로젝트는 프론트엔드를 Vercel에 올리고, 백엔드는 Oracle Cloud VM에서 실행한 뒤 Cloudflare Tunnel로 `https://api...` 공개 주소를 연결하는 구성을 권장한다. 이 방식은 백엔드의 `3001` 포트를 인터넷에 직접 열지 않아도 되고, 브라우저는 항상 Cloudflare HTTPS 주소로 API를 호출한다.

## 권장 도메인 구조

- 프론트엔드: `https://arubot.example.com`
- 백엔드 API: `https://api.example.com`

OAuth, 쿠키, CORS 문제를 줄이려면 Vercel 기본 도메인과 별도 API 도메인을 섞기보다 같은 상위 도메인의 서브도메인을 쓰는 편이 좋다.

## Vercel 프론트엔드 설정

Vercel에서 Git 저장소를 Import하고 다음 값으로 설정한다.

- Framework Preset: `Next.js`
- Root Directory: 저장소 루트
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: 비워둠

Vercel 환경변수는 프론트엔드가 API를 찾는 데 필요한 값만 넣는다.

```env
NEXT_PUBLIC_API_BASE=https://api.example.com
API_BASE=https://api.example.com
SERVER_API_BASE=https://api.example.com
```

치지직, 씨미, Supabase service role, Redis 같은 백엔드 비밀키는 Vercel 프론트엔드 프로젝트에 넣지 않는다.

## Oracle Cloud 백엔드 설정

Oracle VM에는 Node.js 22 LTS를 설치하고 저장소를 배포한다. 백엔드는 `npm run server`로 실행된다. nvm을 쓴다면 GitHub Actions의 비대화형 SSH 세션에서도 읽을 수 있도록 deploy 사용자 홈의 `$HOME/.nvm`에 설치한다.

권장 Node.js 준비:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
npm install -g pm2
node -v
npm -v
pm2 -v
```

Oracle ARM 인스턴스에서는 `better-sqlite3` prebuilt binary가 없을 수 있어 `npm ci --omit=dev` 중 네이티브 컴파일이 필요하다. 배포 워크플로는 `make`, C++ compiler, `python3`가 없으면 passwordless sudo로 자동 설치를 시도한다. 수동으로 준비하려면 Ubuntu 계열에서는 아래를 한 번 실행한다.

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

Oracle Linux 계열이면 아래를 사용한다.

```bash
sudo dnf install -y make gcc gcc-c++ python3
```

```bash
npm ci --omit=dev
npm run server
```

운영에서는 PM2로 프로세스를 유지한다. 저장소에는 `ecosystem.config.cjs`가 포함되어 있으며 기본 프로세스 이름은 `arubot-api`다.

```bash
npm i -g pm2
pm2 startOrReload ecosystem.config.cjs --env production --update-env
pm2 save
pm2 startup
```

현재 백엔드는 API, WebSocket, 치지직/씨미 채팅 런타임, 영상 후원/룰렛 브로드캐스트가 같은 메모리 상태를 공유한다. 따라서 Redis pub/sub 기반 fanout을 붙이기 전까지는 PM2 `cluster`나 다중 API 인스턴스를 켜지 않는다. `ecosystem.config.cjs`는 이 제약에 맞춰 `fork` 1개, 메모리 재시작, 로그 분리를 기본값으로 둔다.

백엔드 `.env` 예시는 다음과 같다.

```env
NODE_ENV=production
SERVER_PORT=3001
PORT=3001

FRONTEND_ORIGIN=https://arubot.example.com
BACKEND_ORIGIN=https://api.example.com
APP_REDIRECT_AFTER_LOGIN=https://arubot.example.com/?auth=success
OAUTH_STATE_SECRET=replace_with_stable_random_32_bytes
# 기본값은 host-only cookie다. 꼭 필요할 때만 .example.com처럼 명시한다.
COOKIE_DOMAIN=

CHZZK_CLIENT_ID=...
CHZZK_CLIENT_SECRET=...
CHZZK_REDIRECT_URI=https://api.example.com/api/auth/chzzk/callback
CHZZK_UNOFFICIAL_API_BASE=https://api.chzzk.naver.com

CIME_CLIENT_ID=...
CIME_CLIENT_SECRET=...
CIME_REDIRECT_URI=https://api.example.com/api/auth/cime/callback
CIME_OPENAPI_BASE=https://ci.me/api/openapi
CIME_APP_API_BASE=https://ci.me/api/app
CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE=
PLATFORM_PROFILE_TIMEOUT_MS=2500

SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
REDIS_URL=...
YOUTUBE_API_KEY=...
```

치지직/씨미 개발자 콘솔에는 아래 Redirect URI를 정확히 등록한다.

- `https://api.example.com/api/auth/chzzk/callback`
- `https://api.example.com/api/auth/cime/callback`

CHZZK OAuth는 로그인 시작 시 `https://chzzk.naver.com/account-interlock`로 `clientId`, `redirectUri`, `state`를 보내고, callback에서 같은 `state`를 돌려받는다. 서버는 state를 `oauth_state` 쿠키와 10분 TTL 서버 메모리 저장소에 저장하고, `OAUTH_STATE_SECRET`으로 서명한 state 자체도 검증한다. 그래서 쿠키가 누락되거나 서버가 재시작돼도 같은 비밀값을 유지하면 callback을 통과할 수 있다. 그래도 `invalid_state`가 뜨면 로그인 시작 URL과 callback URL이 서로 다른 백엔드/도메인으로 갔거나, 운영 서버의 `OAUTH_STATE_SECRET`이 배포 중 바뀐 경우를 우선 확인한다.

운영 도메인이 `api.example.com`이면 `COOKIE_DOMAIN`은 비워두거나 `.example.com`이어야 한다. 다른 최상위 도메인 값으로 설정하면 브라우저가 쿠키를 버린다. CIME OAuth도 같은 `clientId`, `redirectUri`, `state` 흐름으로 처리하며, 사용자가 인증을 취소해 `error=access_denied`로 돌아오면 400을 내지 않고 프론트엔드로 `auth=cancelled`를 전달한다.

## Cloudflare Tunnel 설정

Cloudflare에 도메인을 연결한 뒤 Oracle VM에서 `cloudflared`를 설치한다. 터널은 로컬 `http://127.0.0.1:3001` 서비스를 `https://api.example.com`으로 노출한다.

```bash
cloudflared tunnel login
cloudflared tunnel create arubot-api
cloudflared tunnel route dns arubot-api api.example.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: api.example.com
    service: http://127.0.0.1:3001
  - service: http_status:404
```

터널 규칙을 확인하고 실행한다.

```bash
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://api.example.com/api/health
cloudflared tunnel run arubot-api
```

정상 동작을 확인한 뒤 Linux 서비스로 등록한다.

```bash
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Cloudflare Tunnel을 쓰는 경우 Oracle 보안 목록/방화벽에서 `3001` 인바운드를 열 필요가 없다. SSH 관리를 위한 포트만 제한적으로 열고, 백엔드는 `127.0.0.1:3001`로만 받는 구성이 가장 단순하다.

## Cloudflare SSL/TLS

Tunnel 구성에서는 브라우저와 Cloudflare 사이가 HTTPS로 처리되고, Cloudflare가 터널을 통해 Oracle VM의 로컬 서비스로 전달한다. 같은 Zone에서 직접 프록시되는 다른 Origin도 운영한다면 SSL/TLS 모드는 `Full (strict)`를 기본값으로 둔다.

직접 Nginx + Cloudflare 프록시로 운영하는 대안도 가능하지만, 이 경우 Origin이 `443`에서 유효한 인증서를 제공해야 하며 `Full (strict)` 조건을 만족해야 한다.

## GitHub Actions 백엔드 자동 배포

`.github/workflows/deploy-backend.yml`은 `main` 브랜치의 백엔드 관련 변경이 push되거나 수동 실행될 때 Oracle VM으로 백엔드를 배포한다. Actions는 백엔드 실행에 필요한 파일만 임시 staging 디렉터리에 복사한 뒤 압축해 VM에 업로드하고, VM에서는 임시 릴리스 디렉터리에 풀어 `npm ci --omit=dev` 후 `current` symlink를 새 릴리스로 전환하고 PM2를 다시 시작한다.

아티펙트 압축은 저장소 루트 `.`를 직접 대상으로 삼지 않는다. 압축 중 파일이 바뀌어 `tar: .: file changed as we read it`가 나는 일을 막기 위해 staging 디렉터리를 따로 만들고, 압축 파일도 staging 밖에 생성한다.

GitHub 저장소에는 다음 Secrets/Variables를 설정한다.

Secrets:

- `ORACLE_HOST`: Oracle VM 공인 IP 또는 SSH 도메인
- `ORACLE_USER`: SSH 사용자명
- `ORACLE_SSH_PRIVATE_KEY`: 배포용 SSH private key
- `ORACLE_PORT`: SSH 포트, 기본값을 쓰면 생략 가능

Variables:

- 백엔드 배포 경로는 `/home/ubuntu/AruBot`으로 고정된다.
- `REMOTE_NODE_BIN_DIR`: 선택값. 원격 SSH 세션에서 `npm`을 찾지 못할 때 `node`와 `npm`이 들어 있는 bin 디렉터리. 예: `/home/ubuntu/.nvm/versions/node/v22.23.0/bin`

Oracle VM 최초 1회 준비:

```bash
sudo mkdir -p /home/ubuntu/AruBot/shared/logs
sudo chown -R "$USER":"$USER" /home/ubuntu/AruBot
nano /home/ubuntu/AruBot/shared/.env
```

배포 워크플로는 SSH 사용자에게 배포 디렉터리 또는 기존 로그 파일 쓰기 권한이 없을 때 passwordless sudo가 가능하면 자동으로 `mkdir`와 `chown`을 시도한다. passwordless sudo가 불가능하면 워크플로 로그에 표시되는 `sudo mkdir -p ...`와 `sudo chown -R ...` 명령을 Oracle VM에서 한 번 실행한 뒤 다시 배포한다.

`npm: command not found`가 계속 나면 Node/npm이 설치되지 않은 것이 아니라 배포 SSH 사용자의 비대화형 셸 PATH에 없는 경우가 많다. Oracle VM에서 배포 사용자로 아래를 확인한다.

```bash
whoami
command -v node || true
command -v npm || true
find "$HOME" /usr/local /usr /opt -path '*/bin/npm' -type f 2>/dev/null | head -20
```

예를 들어 `npm`이 `/home/ubuntu/.nvm/versions/node/v22.23.0/bin/npm`에 있다면 GitHub Actions Variables에 `REMOTE_NODE_BIN_DIR=/home/ubuntu/.nvm/versions/node/v22.23.0/bin`을 추가한다. 가능하면 Node는 `root`가 아니라 `ORACLE_USER`로 접속하는 배포 사용자 홈에 설치한다.

`/home/ubuntu/AruBot/shared/.env`에는 백엔드 운영 환경변수를 넣는다. 이 파일은 GitHub Actions artifact에 포함되지 않으며, 각 릴리스의 `.env`로 symlink된다.

배포 후 현재 릴리스는 `/home/ubuntu/AruBot/current`를 가리키고, 이전 릴리스는 `/home/ubuntu/AruBot/releases` 아래에 남는다. 만약 기존 `current`가 symlink가 아니라 일반 디렉터리라면 `releases/legacy-current-*`로 한 번 이동한 뒤 symlink로 교체한다. PM2는 같은 앱 이름의 기존 cwd를 계속 물고 있지 않도록 `arubot-api` 프로세스를 삭제한 뒤 새 `current` 기준으로 다시 시작한다. 업로드된 `/tmp` 압축파일, Actions 러너의 로컬 압축파일, 임시 릴리스 디렉터리, 배포용 SSH 키 파일은 배포 성공/실패와 관계없이 정리한다.

운영 로그는 프로젝트 경로 아래에서 바로 확인할 수 있다. `current/logs`는 릴리스가 교체되어도 유지되는 `shared/logs`를 가리킨다. 별도의 `ARUBOT_LOG_DIR` 설정은 사용하지 않는다.

```bash
tail -F /home/ubuntu/AruBot/current/logs/api.out.log
tail -F /home/ubuntu/AruBot/current/logs/api.err.log
```

## 배포 후 점검

```bash
curl -i https://api.example.com/api/health
curl -i https://api.example.com/api/account/platforms
```

`/api/health` 또는 `/api/version` 응답의 `releaseSha`가 GitHub Actions 실행 SHA와 같아야 새 빌드가 실제로 실행 중인 상태다. 프론트엔드에서는 브라우저 개발자 도구 Network 탭에서 API 요청이 `https://api.example.com`으로 나가는지 확인한다. OAuth 로그인 후 다시 `https://arubot.example.com/?auth=success`로 돌아오면 프론트엔드, 백엔드, Cloudflare Tunnel, OAuth Redirect URI가 모두 맞게 연결된 상태다.

## 공식 문서

- Cloudflare Tunnel 생성, DNS 라우팅, 실행: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/
- Cloudflare Tunnel 설정 파일과 ingress: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- Cloudflare Tunnel Linux 서비스 등록: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/
- Cloudflare SSL/TLS Full (strict): https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
- Vercel Next.js 배포: https://vercel.com/docs/frameworks/full-stack/nextjs
- Vercel 환경변수: https://vercel.com/docs/environment-variables
