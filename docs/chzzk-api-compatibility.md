# CHZZK Read API Compatibility

Checked on 2026-09-29 against the live CHZZK website, its current first-party web
client, and the official developer documentation. Read access is centralized in
`server/chzzk-info.js`; other providers and CHZZK chat transport are unchanged.

## Read Contracts

| Information | Current request | Important fields and behavior |
| --- | --- | --- |
| Public channel profile | `GET /service/v1/channels/{channelId}` | `channelId`, `channelName`, `channelImageUrl`, `followerCount`, `verifiedMark`, `openLive` |
| Public follower count | `GET /service/v1/channels/{channelId}/followers/count` | `content.followerCount`; no owner access token required |
| Official channel fallback | `GET /open/v1/channels?channelIds={channelId}` | `Client-Id` and `Client-Secret` headers, not a bearer token; verify the returned channel ID |
| Follow date | `GET /open/v1/channels/followers?page=0&size=50` | Owner bearer token; match `channelId`, read `createdDate` |
| Subscription months | `GET /open/v1/channels/subscribers?page=0&size=50` | Owner bearer token; match `channelId`, read `month` |
| Live state | `GET /polling/v3.1/channels/{channelId}/live-status` | Explicit `status`; public channel `openLive` is a fallback |
| Live metadata and preview | `GET /service/v1/channels/{channelId}/data?fields=topExposedVideos` | `topExposedVideos.openLive`: title, category, viewers, open date, and playback JSON when supplied |

Public requests use `CHZZK_UNOFFICIAL_API_BASE`; official requests use
`CHZZK_OPENAPI_BASE`. These web endpoints are not a stable official API contract.
Keep contract tests and this audit up to date when the web client changes.

The current web client also uses protected live-detail/playback metadata requests.
The server does not reproduce that protection handshake, copy browser credentials,
or depend on generated protected URLs. Drawing donation previews use only playback
metadata supplied by the public channel home response. If it is missing or
restricted, the preview remains unavailable; a playback URL is not fabricated.

## Correctness Rules

- A successful HTTP response with a non-200 CHZZK envelope code is an error.
- Null counts are unknown, not zero. An absent live flag is unknown, not offline.
- Channel IDs take precedence over display names, including for identically named viewers.
- Both relationship lists start at page zero and use at most 50 entries per page.
- Auth failures never fall back to guessed unauthenticated relationship endpoints.
- Failed, truncated, and timed-out relationship scans are not negative-cached.
- Profile errors preserve the previous profile and do not prevent an immediate retry.
- Live check failures preserve the previous state and chat connection. This includes
  a partial multi-channel failure when no successful check confirms a live channel.
- Timezone-less CHZZK live timestamps are Korea time (`+09:00`).

## Other Paths Audited

These existing paths remain in the current first-party client and were not renamed:

- Clip details: `/service/v1/clips/{clipId}/detail`.
- Extension video donation lookup: `/service/v2/donation/videos`.
- Extension alert session lookup: `/manage/v1/alerts/{alertId}/session-url`.

Official `/open/v1/users/me`, `/open/v1/channels/streaming-roles`, category search,
and session/chat endpoints retain their existing roles. No OAuth scopes were
expanded. The connected owner must still authorize follower/subscriber reading;
permission failures require fixing the app permission or reconnecting the account.

## Verification And Limits

The live browser confirmed the public channel profile schema and current polling
requests. The deployed first-party web client confirmed channel-home live metadata,
including `livePlaybackJson` / `previewPlaybackJson`. Automated tests use sanitized
fixtures, not captured account tokens or personal relationship lists.

This environment's direct requests to `api.chzzk.naver.com` timed out, so a real
server-to-CHZZK smoke test and an authenticated owner follower/subscriber lookup
remain deployment checks. Tests do not prove access from the production server.
The production bot and its database were not started or modified during verification.

## Sources

- [CHZZK website](https://chzzk.naver.com/)
- [Channel API](https://chzzk.gitbook.io/chzzk/chzzk-api/channel)
- [Live API](https://chzzk.gitbook.io/chzzk/chzzk-api/live)
- [User API](https://chzzk.gitbook.io/chzzk/chzzk-api/user)
- [Authentication and response conventions](https://chzzk.gitbook.io/chzzk/chzzk-api/tips)
