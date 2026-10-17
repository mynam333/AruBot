# Aru Pause Browser Extension

Chrome/Firefox용 영상 후원 감지 확장 프로그램입니다. CHZZK, CIME, Toonation, AruBot 영상 후원 이벤트를 WebSocket으로 수신하고, 후원이 끝날 때까지 열려 있는 YouTube 탭의 영상을 일시정지합니다.

## 로드 방법

1. 개발 테스트
   - Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> `D:\AruBot\browser-extension`
   - Firefox: `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on -> `manifest.json`
2. 스토어 패키지
   - `npm run extension:build`
   - Chrome ZIP: `dist/browser-extension/aru-pause-chrome-v<version>.zip`
   - Firefox ZIP: `dist/browser-extension/aru-pause-firefox-v<version>.zip`
   - 첫 빌드는 `2.0.0`으로 생성되고, 이후 빌드할 때마다 `browser-extension/version.json`의 패치 버전이 `2.0.1`, `2.0.2`처럼 증가하며 매니페스트 버전도 함께 바뀝니다.
3. 확장 팝업에서 `Overlay URLs`를 열고 네 서비스의 오버레이 주소를 저장합니다.
4. `Monitoring`을 켭니다.

## 큐 규칙

- CHZZK는 후원별 실제 `donationControl`의 `PLAY`/`STOP` 및 `stopVideo` 스킵 신호를 사용합니다. 영상 길이가 지나도 광고·버퍼링 중에는 먼저 재개하지 않습니다.
- AruBot도 실제 현재 재생 항목의 종료·스킵·삭제가 확인될 때만 해제합니다. 남은 시간은 표시용이며, 재개를 결정하지 않습니다.
- CIME·Toonation은 기존 길이 기반 대기열을 유지합니다. 설정한 추가 지연 시간(기본 1초)은 이 타이머와 CHZZK 테스트 알림에만 적용됩니다.
- 다른 서비스의 후원이 남아 있으면 모두 해제될 때까지 기다립니다. CHZZK 알림 일시정지는 다음 후원만 대기시키며, 이미 재생 중인 후원의 종료를 대신하지 않습니다.
- 실제 종료를 기다리는 동안 팝업과 YouTube에는 `종료 대기`가 표시됩니다. 연결 실패나 시간 경과를 종료로 취급하지 않습니다. 종료 신호를 놓쳤다면 실제 후원이 끝났는지 확인한 뒤 팝업의 `즉시 재생` 버튼으로 해제할 수 있습니다.

## 현재 커넥터

- CIME: 오버레이 HTML의 `socketUrl`/`alertKey`를 읽고 `DONATION_VIDEO` WebSocket을 구독합니다. 패킷에 `ci.me/clips/{id}`가 있으면 `https://ci.me/json/clips/{id}`에서 `bodyData.clips[0].duration`과 `playback.url`을 보강합니다.
- CHZZK: `video@...` 세션 ID로 `/manage/v1/alerts/{id}/session-url`을 조회한 뒤 Socket.IO `EIO=3` WebSocket을 연결합니다. 클라이언트 ping과 서버 pong으로 연결을 유지합니다. `/video-session/{id}/alert-setting`에서 알림 대기 상태를 받고, 후원 ID에 해당하는 실제 종료를 기다립니다. 실제 후원의 길이 조회는 필요 없습니다. 치지직 `TEST` 알림은 플랫폼이 종료를 통보하지 않으므로 테스트에만 기존 메타데이터 기반 타이머를 사용합니다.
- Toonation: alertbox HTML의 `payload`를 읽고 `wss://ws.toon.at/{payload}`에 연결합니다.
- AruBot: PVD viewer URL 또는 토큰에서 viewer token을 추출하고 `/api/pvd/ws?token=...`에 연결합니다. 운영 주소 `https://arubot.yuaru.com/pvd/{token}`은 자동으로 `https://arubotapi.yuaru.com` API를 사용합니다. 로컬 프론트가 `localhost:3000`이면 현재 프로젝트의 `getBrowserApiBase()`와 동일하게 `http://127.0.0.1:3001`을 사용합니다. 옵션의 `AruBot API base`로 명시적 API 주소를 덮어쓸 수 있습니다.

## AruBot PVD 동기화

- `/api/pvd/ws`는 연결 직후 현재 재생 중인 항목을 `type: "start"`로 전송하므로, 확장 프로그램을 늦게 켜도 현재 PVD 상태를 받을 수 있습니다.
- `elapsedSec`, `atSec`, `startedAt`, `serverNow`를 이용해 이미 재생된 시간을 빼고 남은 영상 시간으로 YouTube 일시정지 시각을 갱신합니다. 일시정지·재생·탐색 제어도 반영합니다.
- 현재 항목이 없는 `start` 패킷은 종료 신호로 처리합니다. 대기 음악이 재생 중이고 후원이 시작을 기다리는 `idleDeferred` 상태에서는 YouTube를 정지하지 않습니다.
- `/api/video-donation/now-playing?token=...`을 WebSocket 연결 직후 조회하고, 후원 재생 중에는 15초마다 재확인해 누락된 상태를 복구합니다. YouTube API를 호출하는 것은 아닙니다. 오래된 응답과 종료된 연결의 응답은 무시합니다.
- 광고·버퍼링·일시정지·길이 미확인·연결 실패 시에도 마지막 실제 재생 상태를 유지합니다. 재연결 후 현재 항목 조회로 상태를 복구합니다. `storage.session` 지원 브라우저에서는 서비스 워커가 재시작되어도 대기 상태를 복원합니다.
- 후원 전에 재생 중이던 YouTube만 자동 재개합니다. 확장 프로그램에서 수동 재개한 항목은 같은 영상의 상태를 다시 수신해도 정지시키지 않습니다.

비공식/내부 API는 서비스 배포에 따라 바뀔 수 있습니다. 치지직 실제 종료 신호가 누락된 경우 임의 타이머로 재개하지 않고 대기를 유지합니다. 서버의 치지직 일시정지도 동일한 규칙이며, 종료 신호를 복구할 수 없으면 영상 후원 설정에서 해당 일시정지 옵션을 꺼 해제할 수 있습니다. 실제 방송에서 알림 세션의 `STOP` 수신 여부는 별도 확인이 필요합니다.
