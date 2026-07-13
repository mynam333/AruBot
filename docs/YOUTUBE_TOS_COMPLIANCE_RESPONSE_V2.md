# YouTube ToS Violations Report V.2 대응 자료

> 보고서: `principal_ ToS Violations Report V.2.pdf`  
> 보고서 일자: 2026-07-13  
> API Client: `principal`  
> Google Cloud Project Number: `681839169707`

## 1. 무엇이 위반으로 지적되었는가

보고서는 Developer Policy III.E.4.a를 인용해 OAuth authorization token 보관을 지적했습니다. 인용된 문장은 토큰 저장 자체를 금지하는 문장이 아닙니다. 토큰은 다음 조건을 모두 충족할 때만 필요한 기간 동안 저장할 수 있다는 의미입니다.

- 현재 서비스 기능에 토큰이 실제로 필요할 것
- 사용자가 허용한 scope와 고지된 목적 안에서만 사용할 것
- 사용자의 동의가 현재도 활성 상태일 것
- 철회되거나 더 이상 필요하지 않은 토큰과 관련 Authorized Data를 삭제할 것

보고서 캡처는 `방송 액션 설계` 화면의 `저장` 버튼을 강조하지만, 이 버튼은 AruBot의 블루프린트 JSON 초안만 저장합니다. OAuth 토큰 또는 YouTube API Data를 저장하거나 YouTube에서 생성·수정·삭제 작업을 실행하지 않습니다. 다만 기존 화면에는 이 구분이 드러나지 않았고, 서버에서도 일반 사용자 토큰과 별도로 보관되는 중앙 봇 토큰에 대해 활성 동의·실제 사용 시각 및 동일한 자동 검증 정책이 완전히 적용되지 않았습니다.

## 2. 확인된 실제 공백과 해결 내용

| 항목 | 기존 상태 | 해결 내용 |
| --- | --- | --- |
| 활성 동의 증빙 | OAuth 토큰과 마지막 유효성 검증 시각만 저장 | 최초 동의, 최근 명시적 동의 확인, 마지막 실제 API 사용, 마지막 유효성 검증 시각을 분리 저장 |
| 중앙 봇 토큰 | 별도 테이블에 보관되어 일반 사용자용 30일 검증 스케줄 대상에서 제외 | 중앙 봇도 같은 스케줄에서 29일 이내 채널·권한 재검증 |
| 장기 미사용 | 토큰 유효성은 확인했지만 사용자 활동과 동의 유지 여부를 별도로 만료시키지 않음 | 기본 180일 동안 실제 사용·로그인·동의 재확인이 모두 없으면 Google 권한을 철회하고 로컬 YouTube 연결 데이터 삭제 |
| 권한 철회 | 연결 해제 API는 Google revoke와 로컬 삭제를 지원 | 일반 연결과 중앙 봇 모두 화면에서 직접 철회 가능하며, 철회 범위와 YouTube 원본 비삭제 사실을 확인 문구로 표시 |
| 명시적 재확인 | OAuth 재연결 외 별도 확인 수단 없음 | 일반 YouTube 연결과 중앙 봇에 `권한 유지 확인` 추가. 서버에서 실제 API 권한과 채널 일치 여부를 확인한 뒤 동의 시각 갱신 |
| 잘못된 저장 인식 | 블루프린트 버튼이 단순히 `저장`으로 표시 | `초안 저장`으로 변경하고, AruBot 초안만 저장하며 OAuth 권한/API Data는 저장하지 않는다는 툴팁 제공 |
| 갱신 불가 토큰 | 일반 토큰은 주기 검증 시 삭제됐으나 중앙 봇 토큰은 재인증 필요 상태로 남을 수 있음 | `invalid_grant`, 401, refresh token 부재를 확인하면 토큰 레코드와 관련 런타임 연결을 즉시 제거 |

## 3. 회신용 영문 이메일

**Subject:** Resolution of Developer Policy III.E.4.a - API Client principal - Project 681839169707

Dear YouTube API Services Team,

Thank you for the ToS Violations Report V.2 dated July 13, 2026. We reviewed the finding concerning Developer Policy III.E.4.a and updated the API Client "principal" under Google Cloud Project Number 681839169707.

The Save control highlighted in the report belongs to AruBot's Broadcast Action Design editor. It saves only an AruBot configuration draft. It does not store an OAuth token or YouTube API Data, and it does not insert, update, or delete any resource on YouTube. To remove ambiguity, we renamed the control to "Save draft" and added an in-product disclosure explaining that it stores only the AruBot blueprint draft.

We also strengthened the authorization-token lifecycle for both user YouTube connections and the service's central bot authorization:

- We separately record the initial consent time, latest explicit consent confirmation, latest actual API use, and latest authorization validation time.
- Users can explicitly reconfirm continued authorization storage from the connection screen. The server validates the OAuth grant and verifies that the authorized channel still matches before recording that confirmation.
- Every stored YouTube authorization, including the central bot authorization, is revalidated within 30 calendar days. The production default is 29 days.
- Automated validation does not count as user activity and does not extend the active-user period.
- If there has been no actual authorized use, login, or explicit consent confirmation for 180 days, AruBot programmatically revokes the Google OAuth grant and deletes the locally stored token and related YouTube connection data.
- If a refresh token is missing, cannot be refreshed, or returns an invalid authorization response, AruBot immediately removes the stored authorization and disconnects the related runtime.
- The in-product disconnect controls clearly explain that they revoke Google authorization and delete data stored by AruBot, but do not delete or modify channels, videos, comments, or live-chat content stored by YouTube.
- OAuth access and refresh tokens remain encrypted at rest and are never returned to the browser.

The updated user-facing controls show the latest consent confirmation, latest validation, next validation deadline, and inactivity revocation date without exposing token values.

Relevant URLs after deployment:

- Connection and authorization controls: https://arubot.yuaru.com/connection
- Privacy Policy: https://arubot.yuaru.com/privacy
- Terms of Use: https://arubot.yuaru.com/terms

We respectfully request a new review of API Client "principal." We can provide updated screenshots, test credentials, or additional implementation evidence if needed.

Sincerely,

AruBot Developer  
mynam33333@gmail.com

## 4. 배포 및 증빙 체크리스트

- 운영 DB에 `server/migrations/017_youtube_active_consent.sql` 적용
- 백엔드와 프론트엔드를 같은 릴리스로 배포
- 일반 YouTube 연결 후 `/connection`에서 다음 항목 캡처
  - `YouTube 권한 보관` 및 `활성 동의`
  - 최근 동의 확인, 최근 권한 검증, 다음 검증 기한, 미사용 자동 철회
  - `권한 유지 확인` 및 `OAuth 연결 해제`
- 중앙 봇 관리자 화면에서 동일한 권한 보관 정보와 버튼 캡처
- 방송 액션 설계 화면에서 `초안 저장` 버튼과 툴팁 캡처
- 테스트 계정으로 `권한 유지 확인` 실행 후 최근 동의 확인 시각 변경 확인
- 테스트 계정으로 `OAuth 연결 해제` 실행 후 Google 계정 연결 목록에서 권한 제거 확인
- 연결 해제 후 AruBot에서 YouTube 토큰·플랫폼 계정·스트리머 연결 데이터가 제거되는지 확인
- YouTube의 채널·영상·댓글·라이브 채팅 원본은 변경되지 않는지 확인
- 운영 환경의 `YOUTUBE_AUTH_VALIDATION_MAX_AGE_MS`가 30일 이하인지 확인
- 운영 환경의 `YOUTUBE_AUTH_INACTIVITY_MAX_AGE_MS` 값과 이메일의 180일 설명이 일치하는지 확인

## 5. 회신 시 주의사항

- 코드는 배포 전까지 운영 서비스에 반영된 것으로 표현하지 않습니다.
- 마이그레이션과 배포가 끝난 뒤 실제 운영 URL의 캡처를 첨부합니다.
- `Save draft`가 저장하는 것은 AruBot 블루프린트 설정뿐이라는 점과 OAuth 토큰 보관 통제를 별도 항목으로 설명합니다.
