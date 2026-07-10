# YouTube API Services ToS 위반 조치 및 회신안

검토 보고서: `principal_ ToS Violations Report V.1.pdf` (2026-07-10)

API Client: `principal`  
보고서 기재 Project Number: `681839169707`

> 전송 전 확인: 아래 회신은 API Client가 Google Cloud 프로젝트 `681839169707` 하나만 사용한다는 전제로 작성되었습니다. 실제 Google Cloud Console에서 다른 프로젝트를 함께 사용하지 않는지 소유자가 최종 확인해야 합니다. 수정 사항을 운영 환경에 배포하고 공개 URL 및 스크린샷을 확인한 뒤 전송하세요.

## 위반별 조치

| 정책 | 보고서 지적 | 적용한 해결책 | 심사 증빙 |
| --- | --- | --- | --- |
| III.D.1.c | 동일 API Client의 복수 프로젝트 사용 여부 확인 | 단일 프로젝트 `681839169707` 사용 사실을 회신에 명시 | Google Cloud Console 프로젝트 화면 |
| III.A.1 | 자체 약관에 YouTube 서비스 약관 구속 동의 문구 및 링크 없음 | 이용약관 제6조에 "YouTube API 연동 기능을 사용함으로써 YouTube 서비스 약관에 구속되는 것에 동의"한다는 문구와 공식 약관 링크 추가 | `https://arubot.yuaru.com/terms` |
| III.A.2.b | 개인정보처리방침에 YouTube API Services 사용 사실 미고지 | 개인정보처리방침에 "AruBot은 YouTube API Services를 사용합니다" 문구와 전용 섹션 추가 | `https://arubot.yuaru.com/privacy` |
| III.A.2.d | 접근·수집·저장·사용하는 사용자/API Data 설명 부족 | 채널, OAuth, 방송, 영상, Live Chat, 작성자 역할, Super Chat 데이터와 각각의 사용 목적·저장 위치·보유기간을 표와 전용 섹션에 명시 | 개인정보처리방침 2조 및 10조 |
| III.A.2.f | 제3자 콘텐츠 및 광고 제공 가능성 미고지 | YouTube IFrame Player에서 Google/YouTube가 콘텐츠와 광고를 제공할 수 있고 AruBot이 이를 변경·차단하지 않는다고 명시 | 개인정보처리방침 10조 |
| III.A.2.h | 저장 데이터 삭제 및 Google 권한 철회 절차 미고지 | 서비스 내 YouTube 연결 해제 절차, Google 서드 파티 연결 관리 링크, 문의 이메일, 철회 후 최대 7일 이내 삭제 기준 명시 | 개인정보처리방침 10조 및 플랫폼 연결 화면 |
| III.E.4.a | 활성 사용자 동의에 필요한 기간을 넘긴 OAuth 토큰 보관 위험 | 토큰 암호화 보관, Google 토큰 철회 성공 확인, 연결 해제 시 Authorized Data 동시 삭제, 30일 이내 권한 재확인, 갱신 불가 시 자동 삭제 구현 | 연결 해제 API 및 `last_validated_at` 기반 스케줄러 |
| III.F.2.a,b | YouTube와 혼동되는 변형 아이콘, 색상·형태·최소 크기 위반 | 일반 영상 기능은 중립 `Clapperboard`/`Puzzle` 아이콘으로 교체. 실제 YouTube 표시는 적색 공식 자산, 최소 세로 20px, YouTube 링크를 적용 | 랜딩, 플랫폼 연결, 로그인, 영상 후원 화면 |

## 회신용 영문 이메일

**Subject:** Resolution of YouTube API Services ToS Violations - API Client principal - Project 681839169707

Dear YouTube API Services Team,

Thank you for providing the ToS Violations Report V.1 dated July 10, 2026. We reviewed every item in the report and implemented the corrective actions described below for the API Client "principal."

**Project confirmation - Policy III.D.1.c**

We confirm that this API Client uses one Google Cloud API Project: Project Number 681839169707. No other project numbers are used for this API Client.

**Terms of Use - Policy III.A.1**

We updated the AruBot Terms of Use to state explicitly that, by using AruBot's YouTube API integration, users agree to be bound by the YouTube Terms of Service. The page now provides direct links to the YouTube Terms of Service, YouTube API Services Terms of Service, and YouTube Developer Policies.

Terms URL: https://arubot.yuaru.com/terms

**Privacy Policy - Policies III.A.2.b, III.A.2.d, III.A.2.f, and III.A.2.h**

We added a dedicated YouTube API Services section to the AruBot Privacy Policy. It now:

- clearly states that AruBot uses YouTube API Services;
- lists the YouTube account, channel, OAuth, broadcast, video, Live Chat, author, role, and Super Chat data that the client accesses, collects, stores, and uses;
- explains the specific purposes for processing that data, its storage location, and its retention periods;
- discloses that Google/YouTube may serve third-party content, including advertisements, through the YouTube IFrame Player, and that AruBot does not alter or block those advertisements or player functions;
- explains the in-product YouTube disconnect and stored-data deletion process;
- links directly to the Google third-party connections page at https://myaccount.google.com/connections?filters=3,4; and
- provides the developer contact address for privacy, deletion, and revocation requests.

Privacy Policy URL: https://arubot.yuaru.com/privacy

**Authorization token handling - Policy III.E.4.a**

OAuth access and refresh tokens are encrypted at rest and are used only for the purposes and scopes specifically authorized by the active user. We implemented the following controls:

- The in-product YouTube disconnect action programmatically revokes the Google OAuth grant before removing local data.
- A failed external revocation is no longer reported as a successful disconnect; the user is asked to retry.
- After successful revocation, AruBot deletes the stored YouTube OAuth tokens, YouTube platform account data, and registered YouTube channel data.
- AruBot records the last authorization validation time and reconfirms each stored YouTube authorization within 30 days.
- If a token can no longer be refreshed or validated because authorization was revoked, the associated YouTube Authorized Data is automatically deleted.
- Account deletion also revokes external OAuth grants before deleting the account data.

**Branding - Policies III.F.2.a and III.F.2.b**

We replaced the modified play-button-style marks shown in the report with neutral product icons for non-YouTube video and browser-extension features. Wherever YouTube itself is identified, we now use the unmodified red YouTube brand asset, render it at a minimum height of 20 CSS pixels, preserve its aspect ratio and colors, and link the mark to YouTube or the relevant YouTube integration component.

**Additional compliance safeguard**

The production live-chat receiver now uses the documented YouTube Live Streaming API `liveChatMessages.list` method, follows each response's `nextPageToken`, and never polls faster than the returned `pollingIntervalMillis`.

We respectfully request that you review the updated API Client and confirm that the reported violations have been resolved. We can provide additional screenshots, test credentials, or implementation details if required.

Sincerely,

AruBot Developer  
mynam33333@gmail.com

## 전송 전 증빙 체크리스트

- Google Cloud Console에서 `principal`이 프로젝트 `681839169707`만 사용하는지 확인
- 운영 환경에 DB migration `016_youtube_api_compliance.sql` 적용
- 프론트엔드와 백엔드 배포
- `https://arubot.yuaru.com/terms`의 YouTube 약관 문구와 링크 스크린샷
- `https://arubot.yuaru.com/privacy`의 YouTube API Services, 광고, 삭제·철회 문구 스크린샷
- 플랫폼 연결 화면의 YouTube 연결 해제 버튼 스크린샷
- 랜딩·플랫폼 연결·영상 후원 화면의 수정된 아이콘 스크린샷
- 테스트 계정으로 YouTube 연결 후 연결 해제 실행, Google 계정 연결 목록에서 권한 제거 확인
- 회신 이메일의 단일 프로젝트 확인 문장을 실제 구성과 대조
