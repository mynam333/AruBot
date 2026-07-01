# 예측 베팅 기능

예측 베팅은 스트리머가 웹에서 질문과 선택지를 열고, 시청자가 채팅 명령어로 포인트를 걸어 참여하는 기능이다. 정산 시 승리 선택지에 걸린 비율대로 전체 포인트 풀을 배분한다.

## 사용자 경험

- 스트리머: `/predictions`에서 질문, 선택지, 최소/최대 포인트, 자동 마감 시간을 입력한다.
- 시청자: 채팅에서 기본 명령어 `!투표 번호 포인트`로 참여한다.
- 호환 명령어로 `!배팅 번호 포인트`, `!베팅 번호 포인트`, `!예측 번호 포인트`도 사용할 수 있다.
- 금액은 `1000`, `1k`, `1만`, `올인`처럼 입력할 수 있다.
- 스트리머: 진행 현황을 웹에서 확인하고 베팅 마감, 정산, 취소/환불을 실행한다.
- OBS: `/viewer/prediction/:channelUid`를 브라우저 소스로 추가해 현재 비율을 표시한다.

## 규칙

- 선택지는 최소 2개 이상이어야 한다.
- 선택지 개수에는 별도 최대 제한을 두지 않는다.
- 한 시청자는 하나의 선택지에만 참여할 수 있다.
- 같은 선택지에는 추가 베팅할 수 있다.
- 다른 선택지로 변경하는 것은 허용하지 않는다.
- 취소하거나 승자가 없으면 참가자에게 자동 환불한다.
- 정산은 pari-mutuel 방식으로 전체 풀을 승리 선택지 참가자에게 비례 배분한다.
- 자동 마감 시간이 지나면 새 베팅은 막고, 관리 화면/OBS에는 마감된 현황을 유지한다.
- 선택지별 예상 배당과 100P 기준 예상 수령액을 표시한다.

## API

- `GET /api/predictions`
- `GET /api/predictions/active`
- `POST /api/predictions/create`
- `POST /api/predictions/:id/lock`
- `POST /api/predictions/:id/settle`
- `POST /api/predictions/:id/cancel`
- `GET /api/public/:uid/prediction`

## DB

마이그레이션 파일:

- `server/migrations/006_prediction_betting.sql`

주요 테이블:

- `prediction_events`
- `prediction_bets`

주요 인덱스:

- `idx_prediction_events_sid_created`
- `idx_prediction_events_channel_status`
- `idx_prediction_bets_prediction_amount`
- `idx_prediction_bets_user`

## 추가 개선 후보

- 운영자 권한별 정산 가능 여부 분리
- 결과 정산 전 확인 모달
- 예측 템플릿 저장
- 선택지별 아이콘/컬러 커스터마이징
- 방송 종료 후 예측 리포트
- Redis pub/sub 기반 실시간 오버레이 push 전환
