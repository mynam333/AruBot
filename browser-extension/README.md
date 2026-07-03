# Aru Pause Browser Extension

Chrome/Firefox용 영상 후원 감지 확장 프로그램입니다. CHZZK, CIME, Toonation, AruBot 영상 후원 이벤트를 WebSocket으로 수신하고, 각 서비스별 대기열 종료 시각의 최댓값까지 열려 있는 YouTube 탭의 영상을 일시정지합니다.

## 로드 방법

1. 개발 테스트
   - Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> `D:\AruBot\browser-extension`
   - Firefox: `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on -> `manifest.json`
2. 스토어 패키지
   - `npm run extension:build`
   - Chrome ZIP: `dist/browser-extension/aru-pause-chrome-v<version>.zip`
   - Firefox ZIP: `dist/browser-extension/aru-pause-firefox-v<version>.zip`
   - 빌드할 때마다 `browser-extension/version.json`의 빌드 번호가 증가하고 매니페스트 버전도 함께 바뀝니다.
3. 확장 팝업에서 `Overlay URLs`를 열고 네 서비스의 오버레이 주소를 저장합니다.
4. `Monitoring`을 켭니다.

## 큐 규칙

- 서비스별 종료 시각을 따로 계산합니다.
- 새 영상 후원은 해당 서비스의 마지막 종료 시각 뒤에 붙습니다.
- YouTube 재개 시점은 네 서비스 종료 시각 중 가장 늦은 시간입니다.
- 각 영상 후원에는 설정된 추가 지연 시간이 더해지며 기본값은 1초입니다.

## 현재 커넥터

- CIME: 오버레이 HTML의 `socketUrl`/`alertKey`를 읽고 `DONATION_VIDEO` WebSocket을 구독합니다. 패킷에 `ci.me/clips/{id}`가 있으면 `https://ci.me/json/clips/{id}`에서 `bodyData.clips[0].duration`과 `playback.url`을 보강합니다.
- CHZZK: `video@...` 세션 ID로 `/manage/v1/alerts/{id}/session-url`을 조회한 뒤 Socket.IO WebSocket을 연결합니다.
- Toonation: alertbox HTML의 `payload`를 읽고 `wss://toon.at:8071/{payload}`에 연결합니다.
- AruBot: PVD viewer URL 또는 토큰에서 viewer token을 추출하고 `/api/pvd/ws?token=...`에 연결합니다. 운영 주소 `https://arubot.yuaru.com/pvd/{token}`은 자동으로 `https://arubotapi.yuaru.com` API를 사용합니다. 로컬 프론트가 `localhost:3000`이면 현재 프로젝트의 `getBrowserApiBase()`와 동일하게 `http://127.0.0.1:3001`을 사용합니다. 옵션의 `AruBot API base`로 명시적 API 주소를 덮어쓸 수 있습니다.

## AruBot PVD 동기화

- `/api/pvd/ws`는 연결 직후 현재 재생 중인 항목을 `type: "start"`로 전송하므로, 확장 프로그램을 늦게 켜도 현재 PVD 상태를 받을 수 있습니다.
- `elapsedSec`, `atSec`, `startedAt`, `serverNow`를 이용해 이미 재생된 시간을 빼고 남은 영상 시간만 YouTube 일시정지 큐에 추가합니다.
- `/api/video-donation/now-playing?token=...`을 WebSocket 연결 직후 한 번 더 조회해 초기 패킷 누락에도 대비합니다.

비공식/내부 API는 서비스 배포에 따라 바뀔 수 있습니다. 그래서 패킷에서 `start/end`, `duration`, `video_length`, `video_info.duration`, `vStart/vEnd` 등 여러 후보 필드를 탐지하도록 구현했습니다.
