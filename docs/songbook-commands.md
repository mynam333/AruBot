# Songbook Commands

## Management

- Songbook > 신청 방법 manages ordinary `/api/bot/rules` records, not a separate settings copy.
- The request template is `!노래신청` with `${songbook_request}`. The link template is `!노래책` with `노래책: ${songbook_url}`.
- Both templates default to enabled, free, everyone, and a three-second command cooldown. Adding a template does not reopen closed song requests.
- Whitespace in the trigger field creates aliases. Name, triggers, cooldown, response, enabled state, and deletion are shared with the commands page. Existing role, cost, and other advanced rule fields are preserved.
- Commands appear here when any response contains a songbook token. Removing all songbook tokens in the commands page removes that command from this filtered view without deleting it.
- The embedded editor requires commands read access; editing requires commands and songbook write access. Binding `${songbook_request}` also requires songbook write access on the server.
- Existing trigger collisions are rejected in both editors. An expected edit version detects an already changed/deleted record; this is not a cross-process transaction lock for concurrent rule creation.

## Chat Requests

- CHZZK, CIME, and YouTube use the same transactional songbook queue as website requests. An argument-free request command sends usage and the viewer link.
- Search accepts a title, artist and title, or song UUID. Exact matches take priority. Multiple results require disambiguation; no arbitrary first result is submitted.
- Hidden/unrequestable songs, closed submissions, per-viewer limits, the 500-item queue cap, and the ten-second per-viewer submission throttle are enforced inside the owner-locked transaction.
- Stable platform user IDs are required. Nickname fallback identities are refused. Chat participation does not create login accounts or platform account links.
- Verified platform account links combine website/chat limits and allow the viewer to see/cancel earlier unlinked chat requests. Unrelated platforms and owners remain isolated.
- The command reply event key produces a stable request UUID. Duplicate delivery returns the existing receipt, including after submissions close.
- Songbook effects execute after other executable effects and before literal memo expansion. Viewer-provided tokens cannot add request behavior to a link-only command. Connected blueprint tests do not create requests.
- These are songbook performance requests, not video/BGM donation requests. Existing general command point-cost behavior remains unchanged; the provided templates cost zero points.

## Storage And Deployment

`031_songbook_chat_requests.sql` is applied by songbook schema initialization, after migrations 027 and 030. It preserves existing requests, allows a nullable website viewer for chat-only participants, and adds provider-scoped chat identity and deduplication indexes. No extra rule table or settings migration is needed.

Deploy frontend and backend together. Local fixture UI tests do not verify production database migration or delivery of real platform chat messages.
