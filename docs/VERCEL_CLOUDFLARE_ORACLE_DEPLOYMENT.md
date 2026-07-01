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

Oracle VM에는 Node.js LTS를 설치하고 저장소를 배포한다. 백엔드는 `npm run server`로 실행된다.

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

`.github/workflows/deploy-backend.yml`은 `main` 브랜치의 백엔드 관련 변경이 push되거나 수동 실행될 때 Oracle VM으로 백엔드를 배포한다. Actions는 백엔드 실행에 필요한 파일만 임시 staging 디렉터리에 복사한 뒤 압축해 VM에 업로드하고, VM에서는 임시 릴리스 디렉터리에 풀어 `npm ci --omit=dev` 후 PM2를 reload한다.

아티펙트 압축은 저장소 루트 `.`를 직접 대상으로 삼지 않는다. 압축 중 파일이 바뀌어 `tar: .: file changed as we read it`가 나는 일을 막기 위해 staging 디렉터리를 따로 만들고, 압축 파일도 staging 밖에 생성한다.

GitHub 저장소에는 다음 Secrets/Variables를 설정한다.

Secrets:

- `ORACLE_HOST`: Oracle VM 공인 IP 또는 SSH 도메인
- `ORACLE_USER`: SSH 사용자명
- `ORACLE_SSH_PRIVATE_KEY`: 배포용 SSH private key
- `ORACLE_PORT`: SSH 포트, 기본값을 쓰면 생략 가능

Variables:

- `BACKEND_APP_DIR`: 배포 경로, 기본값은 `/opt/arubot`

Oracle VM 최초 1회 준비:

```bash
sudo mkdir -p /opt/arubot/shared/logs
sudo chown -R "$USER":"$USER" /opt/arubot
nano /opt/arubot/shared/.env
```

`BACKEND_APP_DIR`를 `/home/<user>/AruBot`처럼 다른 경로로 바꿨다면 위 명령의 `/opt/arubot`도 같은 경로로 바꾼다. 배포 워크플로는 SSH 사용자에게 배포 디렉터리 쓰기 권한이 없을 때 passwordless sudo가 가능하면 자동으로 `mkdir`와 `chown`을 시도한다. passwordless sudo가 불가능하면 워크플로 로그에 표시되는 `sudo mkdir -p ...`와 `sudo chown -R ...` 명령을 Oracle VM에서 한 번 실행한 뒤 다시 배포한다.

`/opt/arubot/shared/.env`에는 백엔드 운영 환경변수를 넣는다. 이 파일은 GitHub Actions artifact에 포함되지 않으며, 각 릴리스의 `.env`로 symlink된다.

배포 후 현재 릴리스는 `/opt/arubot/current`를 가리키고, 이전 릴리스는 `/opt/arubot/releases` 아래에 최대 5개까지 남는다. 업로드된 `/tmp` 압축파일, Actions 러너의 로컬 압축파일, 임시 릴리스 디렉터리, 배포용 SSH 키 파일은 배포 성공/실패와 관계없이 정리한다.

## 배포 후 점검

```bash
curl -i https://api.example.com/api/health
curl -i https://api.example.com/api/account/platforms
```

프론트엔드에서는 브라우저 개발자 도구 Network 탭에서 API 요청이 `https://api.example.com`으로 나가는지 확인한다. OAuth 로그인 후 다시 `https://arubot.example.com/?auth=success`로 돌아오면 프론트엔드, 백엔드, Cloudflare Tunnel, OAuth Redirect URI가 모두 맞게 연결된 상태다.

## 공식 문서

- Cloudflare Tunnel 생성, DNS 라우팅, 실행: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/
- Cloudflare Tunnel 설정 파일과 ingress: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- Cloudflare Tunnel Linux 서비스 등록: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/
- Cloudflare SSL/TLS Full (strict): https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
- Vercel Next.js 배포: https://vercel.com/docs/frameworks/full-stack/nextjs
- Vercel 환경변수: https://vercel.com/docs/environment-variables
