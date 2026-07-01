# 방송 자동화 액션 빌더 기획서

작성일: 2026-07-01  
대상: AruBot CHZZK/CIME 통합 채팅봇  
범위: 기획 및 구현 설계. 실제 구현은 이 문서를 기준으로 단계적으로 진행한다.

## 1. 목표

AruBot의 명령어, 후원, 포인트, 예측 베팅, 룰렛, 영상 후원 이벤트를 방송 도구와 외부 서비스의 자동화 액션으로 연결한다. 스트리머는 코드를 작성하지 않고 “언제 실행할지”, “어떤 조건에서 실행할지”, “무엇을 실행할지”를 빌더 UI에서 조합할 수 있어야 한다.

핵심 목표:

- CHZZK와 CIME 이벤트를 동일한 자동화 엔진으로 처리한다.
- OBS, 범용 WebSocket, HTTP, UDP, 사운드, AruBot 오버레이, T.I.T.S., VTube Studio를 1차 지원한다.
- Streamer.bot 같은 별도 자동화 프로그램 설치를 전제로 하지 않고, AruBot이 직접 WebSocket/HTTP/UDP 클라이언트와 서버 역할을 제공한다.
- VTube Studio, T.I.T.S., OBS처럼 목록 조회가 가능한 대상은 모델/핫키/아이템/트리거/장면 목록을 자동으로 불러와 드롭다운에서 선택하게 만든다.
- 연결 실패, 중복 실행, 과도한 호출, 방송 중 실수 실행을 막는 안전장치를 기본 제공한다.
- 액션 실행 로그, 재시도, 테스트 실행, 미리보기, 변수 치환을 제공한다.
- 향후 SOOP 공식 API, SOOP Extension SDK, SSAPI, Twip/Toonation 알림, Discord Webhook, MIDI/OSC, 조명/스마트홈 같은 확장 대상을 같은 구조로 추가할 수 있게 만든다.

## 2. 확인한 외부 API 기준

### OBS Studio

기준 문서:

- obs-websocket README: https://github.com/obsproject/obs-websocket
- obs-websocket 5.x protocol: https://raw.githubusercontent.com/obsproject/obs-websocket/master/docs/generated/protocol.md

확인 사항:

- OBS Studio 28 이상은 obs-websocket이 기본 포함된다.
- 기본 WebSocket 포트는 `4455`이며 OBS 도구 메뉴에서 변경 가능하다.
- 인증 사용을 권장하며, OBS가 최초 실행 시 비밀번호를 생성한다.
- 5.x 프로토콜은 연결 직후 서버가 `Hello`를 보내고 클라이언트가 `Identify`로 응답한다.
- 인증이 필요한 경우 `password + salt`, 이후 `base64_secret + challenge`를 각각 SHA256/base64 처리해 `authentication` 값을 만든다.
- 일반 요청은 `op: 6` `Request`, 응답은 `op: 7` `RequestResponse` 구조다.
- 다중 요청은 `op: 8` `RequestBatch`로 순차/병렬 실행이 가능하다.

1차 지원 액션:

- 장면 전환: `SetCurrentProgramScene`
- 소스 표시/숨김: `SetSceneItemEnabled`
- 입력 음소거/해제: `SetInputMute`
- 미디어 소스 재생/정지/재시작: `TriggerMediaInputAction`
- 필터 표시/숨김: `SetSourceFilterEnabled`
- 브라우저 소스 URL 갱신: `SetInputSettings`
- 스트리밍/녹화 시작/중지: 위험 액션으로 별도 확인 필요
- 배치 액션: 장면 전환 + 소스 표시 + 일정 시간 후 숨김

### VTube Studio

기준 문서:

- VTube Studio API Development Page: https://github.com/DenchiSoft/VTubeStudio
- 공식 문서 안내: https://denchisoft.com/documentation/

확인 사항:

- VTube Studio는 Public API를 제공하며 WebSocket으로 연결한다.
- UDP `47779`로 API 상태를 브로드캐스트하고, 응답에는 API 활성 여부, 포트, 인스턴스 ID, 창 제목이 포함된다.
- 최초 연결 시 `AuthenticationTokenRequest`를 보내면 VTube Studio 안에서 사용자 승인 팝업이 뜬다.
- 승인 후 받은 토큰은 저장해 다음 세션에서 `AuthenticationRequest`에 재사용한다.
- 플러그인 이름과 개발자 이름은 토큰 요청/인증 요청에서 동일해야 한다.
- `HotkeyTriggerRequest`로 현재 모델 또는 Live2D Item의 핫키를 실행할 수 있다.
- 핫키 큐는 제한이 있으며, 동일 핫키는 짧은 간격으로 과도하게 실행하면 실패할 수 있다.

1차 지원 액션:

- 핫키 실행: `HotkeyTriggerRequest`
- 모델 위치/크기 변경
- 표정 활성/비활성
- ArtMesh 틴트
- 아이템 로드/제거/이동
- 트래킹 파라미터 입력

### T.I.T.S. Twitch Integrated Throwing System

기준 문서:

- 제품 페이지: https://remasuri3.itch.io/tits
- API 저장소: https://github.com/Remasuri/TITSAPI

확인 사항:

- T.I.T.S.는 OBS에 Spout2 또는 Game Capture로 올리는 별도 오버레이 앱이다.
- API 문서는 “초기 개발 단계”라고 명시되어 있어 버전 변화 가능성이 높다.
- WebSocket 서버는 `ws://localhost:42069` 기반이다.
- 데이터 엔드포인트는 `ws://localhost:42069/websocket`이다.
- 이벤트 엔드포인트는 `ws://localhost:42069/events`이다.
- 공통 요청 헤더는 `apiName: TITSPublicApi`, `apiVersion: 1.0`, `requestID`, `messageType` 구조다.
- 아이템 목록, 아이템 정보, 아이템 던지기, 트리거 목록, 트리거 활성화를 지원한다.
- 아이템 던지기는 `TITSThrowItemsRequest`이며 `items`, `delayTime`, `amountOfThrows`, `errorOnMissingID`를 사용한다.
- 트리거 활성화는 `TITSTriggerActivateRequest`이며 `triggerID` 또는 `triggerName`으로 실행할 수 있다.

1차 지원 액션:

- 아이템 던지기: 특정 아이템 또는 랜덤 풀
- 트리거 실행: ID 또는 이름
- 아이템 목록 동기화
- 트리거 목록 동기화
- 히트/트리거 이벤트를 AruBot 이벤트로 수신하는 역방향 연동

### Streamer.bot (선택 호환 대상)

기준 문서:

- API References: https://docs.streamer.bot/api
- WebSocket Requests: https://docs.streamer.bot/api/websocket/requests

확인 사항:

- Streamer.bot은 WebSocket, HTTP, UDP API 서버를 제공한다.
- WebSocket 요청은 문자열 JSON이며 기본 구조는 `request`, `id`다.
- 응답은 `status: ok | error`, `id`를 포함한다.
- `GetActions`로 액션 목록을 가져올 수 있다.
- WebSocket 이벤트는 `Subscribe` 요청을 보내야 수신된다.

기획 반영:

- Streamer.bot은 기본 사용 경로가 아니다.
- AruBot은 Streamer.bot 설치 없이 직접 WebSocket/HTTP/UDP 자동화 액션을 실행해야 한다.
- 이미 Streamer.bot을 사용하는 스트리머를 위해 액션 목록 조회, 액션 실행, 커스텀 이벤트 송신은 선택 호환 커넥터로 남긴다.
- Speaker.bot 연계도 Streamer.bot 의존 기능이 아니라 별도 음성/TTS 커넥터 후보로 검토한다.

### 직접 프로토콜 커넥터

Streamer.bot을 우회하기 위해 AruBot이 직접 제공해야 하는 범용 커넥터다.

#### WebSocket Client

- 임의의 `ws://` 또는 `wss://` endpoint에 연결한다.
- JSON, text payload 전송을 지원한다.
- header, subprotocol, query token, bearer token 인증을 지원한다.
- 연결 유지 ping/pong, 자동 재연결, 요청/응답 correlation id를 제공한다.
- 응답 JSONPath 검증과 응답 값을 다음 액션 변수로 저장하는 기능을 제공한다.
- OBS/VTube Studio/T.I.T.S.처럼 전용 프로토콜이 있는 대상은 범용 WebSocket 위에 typed adapter를 얹는다.

#### WebSocket Server

- 외부 로컬 도구가 AruBot에 이벤트를 밀어 넣을 수 있는 inbound endpoint를 제공한다.
- endpoint 예: `/api/automations/inbound/ws/:connectionToken`
- 인증은 connection token + optional HMAC challenge로 처리한다.
- 수신 메시지는 `automation.external.websocket` 표준 이벤트로 변환한다.
- OBS 브라우저 소스, 로컬 런처, 커스텀 툴이 AruBot 이벤트를 직접 발생시키는 용도로 쓴다.

#### HTTP Client

- GET/POST/PUT/PATCH/DELETE 요청을 보낸다.
- JSON, form, raw body, custom header를 지원한다.
- HMAC 서명, Bearer token, Basic auth, query token을 지원한다.
- 응답 status, header, body JSONPath 검증을 제공한다.
- Discord Webhook, Slack, Notion, Home Assistant, 커스텀 서버 연동에 바로 사용할 수 있다.

#### HTTP Inbound Webhook

- 외부 서비스가 AruBot 자동화를 직접 트리거할 수 있는 webhook endpoint를 제공한다.
- endpoint 예: `/api/automations/inbound/http/:connectionToken`
- HMAC 서명 검증, timestamp replay 방지, IP allowlist 옵션을 제공한다.
- 수신 body는 `automation.external.webhook` 표준 이벤트로 변환한다.

#### UDP Send/Listen

- UDP packet send와 listen을 지원한다.
- OSC, 로컬 조명/음향 툴, 일부 VTuber 도구, 커스텀 방송 장비 연동에 사용한다.
- cloud 백엔드에서는 사설망/localhost UDP가 불가능하므로 Local Agent가 실행 주체가 된다.
- 기본값은 localhost/LAN only이며, 전송 빈도 제한과 packet size 제한을 둔다.
- 수신 이벤트는 `automation.external.udp` 표준 이벤트로 변환한다.

## 3. 자동화 모델

자동화는 다음 5단계로 구성한다.

1. Trigger: 어떤 이벤트에서 시작하는지
2. Filter: 어떤 조건에서만 실행할지
3. Variables: 이벤트 값을 어떤 변수로 사용할지
4. Actions: 어떤 외부 동작을 어떤 순서로 실행할지
5. Policy: 중복 방지, 쿨다운, 재시도, 실패 처리

예시:

```txt
Trigger: CIME 후원 수신
Filter: 금액 >= 10000, 메시지에 "축하" 포함
Actions:
  1. OBS 소스 "축하 오버레이" 표시
  2. VTube Studio 핫키 "Happy" 실행
  3. T.I.T.S. confetti 아이템 30개 던지기
  4. 6초 대기
  5. OBS 소스 숨김
Policy: 같은 후원 eventId는 1회만 실행, 실패 시 1회 재시도
```

## 4. 지원 트리거

### 플랫폼 이벤트

- CHZZK 채팅 메시지
- CHZZK 후원
- CHZZK 구독
- CIME 채팅 메시지
- CIME 후원
- CIME 구독
- 라이브 시작/종료

### AruBot 내부 이벤트

- 명령어 실행 성공
- 명령어 실행 실패
- 포인트 적립
- 포인트 사용
- 출석 기록
- 룰렛 실행 시작/종료
- 룰렛 특정 아이템 당첨
- 영상 후원 큐 등록
- 영상 후원 재생 시작/종료
- 예측 베팅 시작/마감/정산
- 예측 베팅 특정 선택지 승리
- 시청자 플랫폼 계정 연결

### 수동 트리거

- 관리자 테스트 실행
- 공개 페이지 버튼 실행
- OBS 오버레이에서 버튼 실행
- Webhook URL 호출
- 예약 시간 실행

## 5. 조건 빌더

조건은 사용자가 코드 없이 구성할 수 있어야 한다.

1차 조건:

- 금액 비교: `>=`, `>`, `=`, `<`, `<=`
- 포인트 비교
- 닉네임/사용자 ID 일치
- 플랫폼: CHZZK, CIME
- 채팅 메시지 포함/정규식
- 명령어 이름
- 룰렛 결과 이름
- 예측 선택지
- 방송 상태: 라이브 중, 오프라인
- 실행 시간대
- 쿨다운 상태

고급 조건:

- AND/OR 그룹
- 이전 액션 성공 여부
- 최근 N분 내 실행 횟수
- 유저별 1회 제한
- VIP/구독자/관리자 역할 조건

## 6. 액션 타입

### 공통 액션

- Wait: 지정 시간 대기
- Branch: 조건 분기
- Repeat: 제한 횟수 반복
- Stop: 이후 액션 중단
- Set Variable: 임시 변수 설정
- Chat Reply: 채팅 응답 전송
- Point Adjust: 포인트 지급/차감

### OBS 액션

- 장면 전환
- 소스 표시/숨김
- 필터 표시/숨김
- 브라우저 소스 URL/설정 변경
- 텍스트 소스 내용 변경
- 미디어 소스 재시작
- 오디오 입력 음소거/해제
- 녹화/스트리밍 시작/중지
- Studio Mode 전환/컷/트랜지션

### WebSocket 액션

- JSON 메시지 전송
- 텍스트 메시지 전송
- 연결 열기/재사용/닫기 정책 선택
- 연결 유지 ping
- 응답 검증
- 응답 값을 변수로 저장
- inbound WebSocket 이벤트를 자동화 트리거로 사용

### HTTP 액션

- GET/POST/PUT/PATCH/DELETE
- JSON/form/body 템플릿
- 커스텀 헤더
- HMAC 서명 옵션
- 응답 상태/JSONPath 검증
- 응답 값을 변수로 저장
- inbound webhook 이벤트를 자동화 트리거로 사용

### UDP 액션

- UDP packet 전송
- OSC message 전송
- UDP listener로 외부 이벤트 수신
- localhost/LAN 전용 실행 정책
- packet rate limit
- binary payload는 1차에서는 비활성화하고 text/JSON/OSC부터 지원

### 사운드 액션

실행 위치를 분리한다.

- 서버 재생: 백엔드 서버에서 소리 재생. 배포 서버에는 의미가 작으므로 로컬 런타임 전용.
- 브라우저 오버레이 재생: OBS 브라우저 소스에서 재생. 실전 방송에 가장 적합.
- T.I.T.S./VTube Studio 내부 SFX: 해당 앱의 자체 기능을 호출.

1차 구현은 “AruBot 액션 오버레이”에서 사운드를 재생하는 방식으로 한다.

### 오버레이 액션

- 오버레이 메시지 표시
- 이미지/GIF 표시
- 사운드 재생
- 애니메이션 프리셋 실행
- 카운트다운 표시
- 예측 결과/룰렛 결과 연출
- 시청자 이름 강조

### T.I.T.S. 액션

- 아이템 목록 새로고침
- 아이템 던지기
- 트리거 목록 새로고침
- 트리거 실행
- 히트 이벤트 수신 후 후속 액션 실행
- 아이템과 트리거는 discovery 결과를 드롭다운으로 선택
- API 응답에 썸네일/base64 이미지가 있는 경우 선택 목록에서 미리보기 표시

### VTube Studio 액션

- 핫키 실행
- 표정 토글
- 모델 이동/확대
- 색상 틴트
- 아이템 로드/제거
- 커스텀 파라미터 입력
- API 토큰 요청/재인증
- 모델, 핫키, Live2D Item, expression 목록은 discovery 결과를 드롭다운으로 선택
- discovery 실패 시 마지막 캐시와 직접 입력 fallback 제공

## 7. 한국 인터넷 방송에 적합한 추가 연동 아이디어

현실적인 구현 가능성, 스트리머 체감 가치, 약관/운영 안정성을 기준으로 정리한다. 공식 API는 우선 검토하고, 비공식 API나 alertbox scraping 계열은 반드시 opt-in과 법적/약관 고지를 둔다.

### 1순위: 직접 체감 가치가 큰 연동

#### SOOP Open API

기준 문서:

- SOOP Open API: https://developers.sooplive.co.kr/?szWork=openapi

활용 아이디어:

- SOOP LIVE/CHAT/ANALYTICS 데이터를 AruBot 표준 이벤트로 변환한다.
- SOOP에서 들어온 채팅/후원/라이브 상태를 CHZZK/CIME와 같은 자동화 규칙으로 처리한다.
- 스트리머별 방송 통계, 이벤트별 자동화 성과, 시청자 반응 분석에 사용한다.

주의점:

- Developer Registration, Partnership Application, API key 발급 심사가 필요하다.
- Open API Feedback이 영업일 기준 최대 10일 걸릴 수 있으므로 MVP 핵심 경로로 묶지 않는다.
- 공식 연동이 가능해지면 SOOP 관련 기능은 비공식 API보다 공식 API를 우선한다.

#### SOOP Extension SDK

기준 문서:

- SOOP Extension SDK API: https://developers.sooplive.com/?sub=api&szWork=extension

활용 아이디어:

- SOOP 확장 UI 안에서 채팅 service message를 수신하고 자동화 이벤트로 변환한다.
- `MESSAGE`, `BALLOON_GIFTED` 같은 확장 메시지를 오버레이/액션 빌더와 연결한다.
- 확장 화면에서 버튼을 누르면 AruBot 자동화 트리거가 실행되도록 만든다.

주의점:

- 서버 봇 API라기보다 SOOP 확장 실행 환경용 SDK에 가깝다.
- 일반 대시보드 기능과 분리해 “SOOP Extension 모드”로 설계한다.

#### SSAPI

기준 문서:

- SSAPI Socket API: https://ssapi.kr/docs/category/-socket-api

활용 아이디어:

- SOOP/Afreeca, CHZZK 채팅과 후원 이벤트를 Socket.IO로 받아 빠르게 자동화 트리거에 연결한다.
- SOOP 도전미션, CHZZK 미션/참여 후원, 애드벌룬, 구독 같은 이벤트를 표준 이벤트로 매핑한다.
- 공식 API 발급 전 테스트/개인 사용 단계에서 빠른 연결 옵션으로 제공한다.

주의점:

- AruBot 핵심 인프라가 외부 서드파티 서비스에 의존하면 운영 리스크가 생긴다.
- 개인정보와 토큰 처리 범위를 명확히 고지하고, 공식 API가 가능한 곳은 공식 API를 우선한다.

#### Twip/Toonation Alertbox 연동

기준 자료:

- donation-alert-api: https://github.com/outstanding1301/donation-alert-api

활용 아이디어:

- Twip/Toonation alertbox key 또는 URL을 등록하면 후원 알림을 자동화 트리거로 변환한다.
- 후원 금액/닉네임/메시지에 따라 OBS, VTube Studio, T.I.T.S., 사운드, 오버레이 액션을 실행한다.
- 한국 스트리머가 이미 쓰는 후원 플랫폼과 자연스럽게 연결된다.

주의점:

- 위 자료는 비공식 라이브러리이며 alertbox 기반 접근이다.
- 약관과 안정성 검토 전에는 core 기능이 아니라 “실험적 opt-in 커넥터”로 둔다.
- 사용자가 제공한 alertbox URL/key만 처리하고, 계정 비밀번호 입력 방식은 금지한다.

### 2순위: 방송 운영 편의가 큰 연동

#### Discord Webhook

- 방송 시작/종료, 예측 결과, 대형 후원, 자동화 실패를 Discord 채널로 보낸다.
- 커뮤니티 운영자에게 바로 가치가 있고 HTTP Webhook만으로 구현 가능하다.
- 이미지 embed, 버튼 링크, role mention 옵션을 제공한다.

#### Stream Deck / Touch Portal / 커스텀 컨트롤러

- AruBot inbound HTTP/WebSocket endpoint를 눌러 자동화를 실행한다.
- 별도 플러그인 없이 URL 호출만으로 연동할 수 있게 한다.
- 나중에 Stream Deck 플러그인을 만들더라도 현재 구조를 그대로 재사용한다.

#### OBS Browser Source Control Surface

- OBS 브라우저 소스에 “방송 중 빠른 액션 패널”을 띄운다.
- 채팅창을 보며 사운드, 장면 연출, T.I.T.S. 투척, VTS 표정을 즉시 실행한다.
- 모바일 대시보드와 같은 permission model을 사용한다.

#### TTS/Voice Connector

- 브라우저 오버레이 TTS를 기본값으로 제공한다.
- 로컬 TTS, VoiceVox, ElevenLabs, Azure Speech, 네이버 CLOVA Voice 같은 provider adapter를 추가할 수 있게 한다.
- 후원 메시지, 포인트 사용, 룰렛 당첨, 예측 정산 멘트를 자동 재생한다.

### 3순위: 연출 확장성이 큰 로컬 연동

#### OSC/UDP

- VSeeFace, VNyan, Warudo, VRChat OSC, 커스텀 VTuber 툴에 적합하다.
- 표정, 포즈, 액세서리, 파라미터 값을 자동화 액션으로 보낸다.
- UDP 특성상 Local Agent에서 실행하고 cloud 백엔드는 명령만 전달한다.

#### MIDI

- 오디오 믹서, 조명 콘솔, DAW, 사운드보드와 연동한다.
- 채널 mute, scene cue, sample trigger, 조명 preset 같은 방송 연출에 유용하다.
- Web MIDI는 브라우저 권한 이슈가 있으므로 Local Agent adapter가 현실적이다.

#### Home Assistant / 조명

- Home Assistant webhook 또는 REST API로 조명, 전광판, 스마트 플러그를 제어한다.
- Philips Hue, Nanoleaf, WLED는 개별 구현보다 Home Assistant 또는 HTTP adapter를 우선한다.
- 후원 금액대별 조명 색상, 예측 승리 팀 색상, 룰렛 벌칙 연출에 적합하다.

#### StreamElements / Twitch EventSub

- 한국 스트리머 중 글로벌 동시 송출 또는 Twitch 경험이 있는 사용자에게만 선택 제공한다.
- Twitch EventSub WebSocket은 공식성이 높고 이벤트 안정성이 좋지만, AruBot의 주력 시장에서는 2차 확장으로 둔다.
- StreamElements custom widget은 오버레이 배포 채널로 유용하나 핵심 자동화 엔진과 분리한다.

### 보류 또는 선택 호환 대상

- Streamer.bot: 설치 부담이 있으므로 기본 경로에서 제외하고, 이미 사용하는 스트리머를 위한 호환 커넥터로만 둔다.
- Lumia Stream: 조명 연출에는 좋지만 한국 스트리머의 기본 사용률을 확인한 뒤 지원한다.
- Voicemeeter / Elgato Wave Link: 로컬 음향 환경 의존성이 커서 Local Agent 안정화 후 검토한다.

## 8. 시스템 아키텍처

### 핵심 컴포넌트

```txt
Event Ingestor
  -> Automation Matcher
  -> Automation Executor
  -> Connector Adapter
  -> Discovery Registry
  -> External Target
  -> Execution Log
```

### 컴포넌트 책임

- Event Ingestor: CHZZK/CIME/내부 이벤트를 표준 이벤트로 변환
- Matcher: 활성 규칙 조회, 조건 평가, 중복 실행 방지
- Executor: 액션 순서 실행, wait/branch/retry 처리
- Connector Adapter: OBS/VTS/TITS/HTTP/WebSocket/UDP 등 대상별 프로토콜 처리
- Discovery Registry: 장면, 소스, 모델, 핫키, 아이템, 트리거 목록 조회와 캐시 관리
- Credential Store: 연결 정보와 토큰 저장
- Log Store: 실행 결과, 실패 사유, 소요 시간 저장
- Overlay Gateway: OBS 브라우저 소스에 액션 이벤트 전달
- Inbound Gateway: 외부 Webhook/WebSocket/UDP 이벤트를 표준 자동화 이벤트로 변환

### 서버 프로세스 분리

기존 PM2 기능별 분리와 맞춘다.

- `arubot-api`: API, 관리자 UI 요청, 설정 저장
- `arubot-chat-runtime`: CHZZK/CIME 실시간 이벤트 수집
- `arubot-automation-worker`: 자동화 큐 소비, 외부 액션 실행
- `arubot-overlay-gateway`: OBS 오버레이 WebSocket 브로드캐스트
- `arubot-inbound-gateway`: 외부 Webhook/WebSocket 수신, 서명 검증, 표준 이벤트 발행
- `arubot-local-agent`: 스트리머 PC에서 OBS/VTS/TITS/UDP/MIDI 같은 로컬 액션 실행

처음에는 단일 프로세스 내부 모듈로 구현하되, 큐와 저장소 구조는 프로세스 분리가 가능하도록 만든다.

## 9. 데이터베이스 설계

Supabase/Postgres 기준.

### automation_rules

```sql
id uuid primary key
owner_user_id text not null
name text not null
description text
enabled boolean not null default true
trigger_type text not null
trigger_config jsonb not null default '{}'::jsonb
condition_tree jsonb not null default '{}'::jsonb
actions jsonb not null default '[]'::jsonb
policy jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

인덱스:

- `(owner_user_id, enabled, trigger_type)`
- GIN index on `condition_tree`

### automation_connections

```sql
id uuid primary key
owner_user_id text not null
type text not null
name text not null
enabled boolean not null default true
endpoint text
secret_ref text
config jsonb not null default '{}'::jsonb
capabilities jsonb not null default '{}'::jsonb
discovery_cache jsonb not null default '{}'::jsonb
discovery_updated_at timestamptz
last_status text
last_checked_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

지원 type:

- `obs`
- `websocket`
- `websocket_server`
- `http`
- `http_webhook`
- `udp`
- `overlay`
- `sound_overlay`
- `tits`
- `vtube_studio`
- `streamerbot`
- `soop_openapi`
- `soop_extension`
- `ssapi`
- `twip_toonation_alertbox`

discovery_cache 예시:

```json
{
  "version": 1,
  "source": "vtube_studio",
  "models": [],
  "hotkeys": [],
  "items": [],
  "expressions": [],
  "fetchedAt": "2026-07-01T00:00:00.000Z"
}
```

### automation_runs

```sql
id uuid primary key
owner_user_id text not null
rule_id uuid
trigger_type text not null
trigger_event_id text
status text not null
started_at timestamptz not null default now()
finished_at timestamptz
duration_ms integer
input_snapshot jsonb not null default '{}'::jsonb
error_message text
idempotency_key text
```

인덱스:

- `(owner_user_id, started_at desc)`
- unique partial index on `(owner_user_id, idempotency_key)` where `idempotency_key is not null`

### automation_run_steps

```sql
id uuid primary key
run_id uuid not null references automation_runs(id) on delete cascade
step_index integer not null
action_type text not null
target_type text
status text not null
started_at timestamptz
finished_at timestamptz
duration_ms integer
request_snapshot jsonb
response_snapshot jsonb
error_message text
```

### automation_event_dedup

```sql
owner_user_id text not null
event_key text not null
first_seen_at timestamptz not null default now()
expires_at timestamptz not null
primary key (owner_user_id, event_key)
```

## 10. 백엔드 API 설계

### 규칙 관리

- `GET /api/automations/rules`
- `POST /api/automations/rules`
- `GET /api/automations/rules/:ruleId`
- `PUT /api/automations/rules/:ruleId`
- `DELETE /api/automations/rules/:ruleId`
- `POST /api/automations/rules/:ruleId/test`
- `POST /api/automations/rules/:ruleId/duplicate`

### 연결 관리

- `GET /api/automations/connections`
- `POST /api/automations/connections`
- `PUT /api/automations/connections/:connectionId`
- `DELETE /api/automations/connections/:connectionId`
- `POST /api/automations/connections/:connectionId/test`
- `POST /api/automations/connections/:connectionId/discover`

### 대상별 discovery

- `POST /api/automations/discover/obs`
  - 장면, 소스, 입력, 필터 목록 조회
- `POST /api/automations/discover/vtube-studio`
  - UDP 검색, 인스턴스 선택, 모델, 핫키, 아이템, expression 목록 조회
  - 토큰이 없으면 인증 요청 플로우 시작
- `POST /api/automations/discover/tits`
  - `TITSItemListRequest`, `TITSTriggerListRequest`로 아이템, 트리거 목록 조회
- `POST /api/automations/discover/streamerbot`
  - 선택 호환 기능으로 액션 목록 조회
- `POST /api/automations/discover/websocket`
  - 연결 가능 여부, 응답 schema sample, ping 결과 확인
- `POST /api/automations/discover/http`
  - 인증/endpoint 테스트, response schema sample 저장
- `POST /api/automations/discover/udp`
  - Local Agent 기준 송신/수신 테스트
- `POST /api/automations/discover/soop-openapi`
  - API key 권한, channel/live/chat/analytics 접근 가능 범위 확인
- `POST /api/automations/discover/ssapi`
  - receiver 설정, 수신 가능 이벤트 타입 확인

### Inbound endpoint

- `POST /api/automations/inbound/http/:connectionToken`
  - 외부 webhook 수신
  - timestamp + HMAC signature 검증
  - `automation.external.webhook` 이벤트 발행
- `GET /api/automations/inbound/ws/:connectionToken`
  - 외부 WebSocket client 연결
  - connection token 검증
  - 메시지 수신 시 `automation.external.websocket` 이벤트 발행
- `POST /api/automations/inbound/test/:connectionId`
  - inbound 설정 테스트용 샘플 이벤트 발행

### 실행 로그

- `GET /api/automations/runs`
- `GET /api/automations/runs/:runId`
- `POST /api/automations/runs/:runId/retry`

## 11. 프론트엔드 UX 설계

### 경로

- `/automations`: 자동화 규칙 목록
- `/automations/new`: 새 자동화 만들기
- `/automations/:ruleId`: 자동화 상세
- `/automations/:ruleId/edit`: 자동화 편집
- `/automations/connections`: 외부 연결 관리
- `/automations/runs`: 실행 기록
- `/automations/templates`: 추천 템플릿

### 빌더 화면 구조

1. 상단: 자동화 이름, 사용 여부, 테스트 실행
2. Trigger 패널: 이벤트 선택
3. Condition 패널: 조건 그룹 빌더
4. Action Timeline: 순서형 액션 블록
5. Variables 패널: 사용 가능한 변수 목록
6. Policy 패널: 쿨다운, 재시도, 중복 방지
7. Test 패널: 샘플 이벤트로 실행 결과 미리보기

### 연결/목록 선택 UX

- 연결 카드에는 `연결 테스트`, `목록 새로고침`, `마지막 동기화 시간`, `실행 위치`를 표시한다.
- 실행 위치는 `Cloud`, `Local Agent`, `Browser Overlay` 중 하나로 표시한다.
- OBS 액션은 scene/source/input/filter를 discovery 결과 드롭다운에서 선택한다.
- VTube Studio 액션은 instance, model, hotkey, item, expression을 discovery 결과 드롭다운에서 선택한다.
- T.I.T.S. 액션은 item, trigger를 discovery 결과 드롭다운에서 선택한다.
- 목록이 오래되었거나 대상 앱에서 삭제된 항목은 “확인 필요” 상태로 표시한다.
- 드롭다운에는 검색, 최근 사용, 즐겨찾기, 직접 입력 fallback을 제공한다.
- 직접 입력으로 저장한 값은 다음 discovery 성공 시 실제 항목과 매칭해 자동 보정한다.
- API 연결이 꺼져 있어도 마지막 정상 discovery cache로 편집은 가능하게 한다.
- 테스트 실행은 실제 외부 앱 실행 전 “dry run”과 “실행”을 분리한다.

### 디자인 원칙

- Zapier/Make처럼 “트리거 -> 조건 -> 액션” 흐름이 한눈에 보이게 만든다.
- 방송 도구 특성상 실수 방지를 위해 위험 액션은 빨간색이 아니라 별도 확인 플로우로 분리한다.
- OBS/VTS/TITS 연결 상태는 항상 상단에 작은 상태 칩으로 표시한다.
- 액션 블록은 접었을 때도 대상, 작업, 핵심 파라미터가 보여야 한다.
- 실패한 액션은 로그에서 바로 “이 설정으로 테스트 재실행”을 할 수 있어야 한다.

## 12. 변수 치환

모든 액션은 템플릿 변수를 사용할 수 있다.

공통 변수:

- `${platform}`
- `${channel.id}`
- `${channel.name}`
- `${viewer.id}`
- `${viewer.name}`
- `${message.text}`
- `${donation.amount}`
- `${donation.message}`
- `${points.balance}`
- `${roulette.itemName}`
- `${prediction.question}`
- `${prediction.winningOption}`
- `${run.id}`
- `${now}`

보안 규칙:

- HTTP 헤더/URL 변수는 allowlist 필터를 적용한다.
- 로그에는 secret 값을 마스킹한다.
- 사용자 입력 메시지는 기본 escape 처리 후 필요한 액션에서만 raw 사용을 허용한다.

## 13. 실행 정책

### 중복 방지

- 이벤트별 `eventId`가 있으면 `ownerUserId + triggerType + eventId`로 idempotency key 생성
- eventId가 없으면 메시지 해시 + timestamp bucket 사용
- 같은 키는 TTL 동안 재실행 금지

### 쿨다운

- 규칙별 쿨다운
- 사용자별 쿨다운
- 대상 연결별 rate limit
- 액션 타입별 rate limit

### 재시도

- 네트워크 오류는 지수 백오프
- 인증 오류는 재시도하지 않고 연결 갱신 필요 상태로 전환
- OBS/VTS/TITS 로컬 앱 연결 실패는 빠르게 실패 처리하고 방송 채팅 흐름을 막지 않는다.

### 실패 처리

- `continueOnError`
- `stopOnError`
- fallback action
- 관리자 토스트/로그 표시

## 14. 보안 설계

외부 액션 빌더는 SSRF와 로컬 네트워크 접근 위험이 크다. 다음 정책을 기본 적용한다.

- HTTP/WebSocket 대상은 사용자가 명시적으로 저장한 connection만 실행 가능
- 서버 배포 환경에서는 사설 IP/localhost 호출을 기본 차단
- 로컬 OBS/VTS/TITS/UDP/MIDI 호출은 배포 서버가 직접 호출하지 않고 “AruBot Local Agent”를 통해 실행
- 초기 구현은 같은 PC에서 실행하는 개발/로컬 서버 또는 사용자 명시 설정에서만 localhost 연결 허용
- secret은 DB에 평문 저장하지 않고 secret_ref로 참조
- 실행 로그에 토큰, 비밀번호, Authorization 헤더 저장 금지
- 위험 액션은 테스트 실행에서도 확인 모달 필요
- inbound webhook은 HMAC signature, timestamp, nonce replay 방지를 기본값으로 제공
- inbound WebSocket은 connection token 외에 최초 hello/auth message를 요구한다.
- UDP listener는 기본 비활성화하고, Local Agent에서만 허용한다.
- 비공식/서드파티 커넥터는 설정 화면에 데이터 제공 범위와 안정성 고지를 표시한다.

## 15. 로컬 앱 연결 전략

OBS, VTube Studio, T.I.T.S.는 대부분 스트리머 PC의 localhost에서 실행된다. Vercel/Oracle Cloud 백엔드가 직접 `localhost`에 접근할 수 없으므로 현실적인 구조가 필요하다.

### 1단계: 로컬 개발/셀프호스팅 지원

현재처럼 백엔드를 스트리머 PC 또는 같은 LAN에 띄운 경우 직접 연결한다.

### 2단계: AruBot Local Agent

스트리머 PC에 작은 로컬 에이전트를 설치한다.

역할:

- OBS/VTS/TITS/사운드 로컬 연결 실행
- UDP/OSC/MIDI 같은 로컬 네트워크/장치 액션 실행
- Cloud 백엔드와 outbound WebSocket 유지
- 자동화 worker가 액션을 queue에 넣으면 agent가 가져가 실행
- 로컬 secret은 agent에 저장
- VTube Studio UDP discovery, T.I.T.S. localhost 연결, OBS localhost 연결을 agent에서 수행

장점:

- Cloudflare/Vercel 환경에서도 로컬 앱 연동 가능
- localhost SSRF 위험 감소
- 방송 PC의 연결 상태를 정확히 표시 가능

## 16. 구현 단계

### Phase 1: 엔진과 DB

- automation tables 추가
- trigger 표준 이벤트 타입 정의
- condition evaluator 구현
- action executor 구현
- run/step log 저장
- 테스트 실행 API 구현

### Phase 2: UI 빌더

- `/automations` 목록
- `/automations/new`
- 액션 타임라인 UI
- 조건 빌더
- 변수 패널
- 실행 로그 UI

### Phase 3: 기본 액션

- Chat Reply
- Point Adjust
- Wait
- HTTP Request
- Generic WebSocket
- UDP Send
- HTTP Inbound Webhook
- WebSocket Inbound Event
- AruBot Overlay
- Sound Overlay

### Phase 4: OBS

- obs-websocket 5.x connector
- 인증 저장/테스트
- 장면/소스 discovery
- 장면 전환, 소스 표시/숨김, 미디어 재시작
- OBS 연결 가이드 UI

### Phase 5: VTube Studio

- UDP discovery
- 토큰 요청/저장
- 인증 테스트
- 핫키 목록 discovery
- 핫키 실행

### Phase 6: T.I.T.S.

- `ws://localhost:42069/websocket` 연결
- 아이템/트리거 discovery
- 아이템 던지기
- 트리거 활성화
- `/events` 수신과 후속 자동화 연결

### Phase 7: Local Agent

- 로컬 앱 연동을 cloud 배포에서도 안전하게 실행
- agent pairing
- connection heartbeat
- command queue
- OBS/VTS/TITS/UDP/MIDI 실행 위임
- discovery proxy

### Phase 8: 한국 방송 생태계 커넥터

- SOOP Open API 신청/권한 확인 UI
- SOOP live/chat/analytics 이벤트 표준화
- SOOP Extension SDK용 확장 화면 설계
- SSAPI optional connector
- Twip/Toonation alertbox optional connector
- Discord Webhook 템플릿
- 비공식 커넥터 안정성/약관 고지 UI

## 17. 추천 자동화 템플릿

### 후원 축하 풀세트

- Trigger: 후원 금액 >= 지정값
- Actions:
  - 채팅 감사 메시지
  - OBS 축하 오버레이 표시
  - VTube Studio 표정 핫키 실행
  - 사운드 재생
  - Wait
  - OBS 오버레이 숨김

### 예측 정산 연출

- Trigger: 예측 정산
- Actions:
  - OBS 예측 결과 오버레이 표시
  - 승리 선택지별 VTube Studio 핫키 실행
  - 채팅으로 상위 당첨자 안내

### 룰렛 꽝 벌칙

- Trigger: 룰렛 특정 아이템 당첨
- Actions:
  - T.I.T.S. 아이템 던지기
  - VTube Studio 놀람 표정
  - OBS 화면 흔들림 필터 켜기
  - Wait
  - 필터 끄기

### 첫 채팅 환영

- Trigger: 시청자 첫 채팅
- Conditions: 최근 10분 내 1회
- Actions:
  - 채팅 환영 메시지
  - 오버레이 닉네임 표시

### 영상 후원 시작 알림

- Trigger: 영상 후원 재생 시작
- Actions:
  - OBS 소스 표시
  - 채팅 안내
  - 영상 종료 시 소스 숨김

## 18. 수용 기준

기능 수용 기준:

- 자동화 규칙 생성, 수정, 삭제, 테스트 실행이 가능하다.
- CHZZK/CIME 이벤트가 동일한 규칙 엔진으로 들어온다.
- 조건 빌더가 금액, 메시지, 플랫폼, 사용자 조건을 평가한다.
- 액션 실행 결과가 run/step 단위로 저장된다.
- HTTP/WebSocket/Overlay/Sound 기본 액션이 실제 실행된다.
- UDP send와 inbound webhook/WebSocket 트리거가 실제 실행된다.
- OBS 장면/소스 조회와 장면 전환이 실제 OBS에서 동작한다.
- VTube Studio 토큰 승인과 핫키 실행이 실제 VTS에서 동작한다.
- T.I.T.S. 아이템 목록 조회와 던지기가 실제 T.I.T.S.에서 동작한다.
- VTube Studio 모델/핫키/아이템/expression이 드롭다운으로 선택된다.
- T.I.T.S. 아이템/트리거가 드롭다운으로 선택된다.
- Streamer.bot 설치 없이 자동화 핵심 기능이 동작한다.
- Streamer.bot 사용자는 선택 호환 커넥터로 기존 액션을 실행할 수 있다.

품질 기준:

- 실패한 외부 연결은 채팅 이벤트 처리 루프를 막지 않는다.
- 같은 이벤트는 중복 실행되지 않는다.
- secret은 로그와 응답에 노출되지 않는다.
- 모바일에서도 규칙 확인과 간단한 on/off 조작이 가능하다.
- 방송 중 위험 액션은 실수로 눌러도 즉시 실행되지 않는다.
- discovery cache가 있어 대상 앱이 꺼져 있어도 기존 규칙 편집은 가능하다.
- 비공식 커넥터는 명확한 opt-in과 안정성 고지를 거친 뒤에만 활성화된다.

## 19. 구현 전 결정해야 할 사항

- 로컬 앱 연동을 Phase 1부터 Local Agent 기반으로 갈지, 기존 Oracle 백엔드 직접 연결부터 갈지
- 자동화 실행 큐를 Postgres 기반으로 시작할지, 별도 Redis/Cloudflare Queue류를 둘지
- OBS/VTS/TITS secret 저장 방식을 Supabase만으로 처리할지, Oracle 서버 파일/환경변수 secret vault를 둘지
- 사운드 파일 업로드 저장소를 Supabase Storage, 로컬 파일, R2 중 어디로 둘지
- T.I.T.S. API가 early-stage인 만큼 버전 핀과 fallback 메시지를 어떻게 노출할지
- SOOP Open API 신청/심사 기간 동안 SSAPI 같은 optional connector를 어느 범위까지 허용할지
- Twip/Toonation alertbox 연동을 공식 API 확인 전 실험 기능으로 둘지

권장 결정:

- Phase 1은 Postgres 큐와 현재 Express worker로 시작한다.
- HTTP/WebSocket/UDP/Overlay/Sound부터 구현해 엔진을 안정화한다.
- Streamer.bot은 기본 경로에서 제외하고 optional compatibility connector로 둔다.
- OBS/VTS/TITS는 직접 연결 모드로 먼저 구현하되, Cloud 배포 실사용을 위해 Local Agent를 바로 다음 단계에 둔다.
- VTube Studio와 T.I.T.S.는 구현 시작부터 discovery cache와 드롭다운 선택 UX를 포함한다.
- secret은 최소한 암호화 저장 또는 서버 환경변수 기반 key encryption을 적용한 뒤 저장한다.
