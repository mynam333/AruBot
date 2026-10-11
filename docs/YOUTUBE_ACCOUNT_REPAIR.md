# YouTube Connection Repair

## Apply Without Database Access

1. Deploy the commit containing this fix through the existing **Deploy Backend** GitHub Actions workflow (a push to `main` also triggers it).
2. Check for `Successfully executed 025_youtube_account_identity_deduplication.sql` in the deployment log. A later deployment may report that this migration was already successful.
3. Reload the connections page. The existing profile refresh action also repairs eligible duplicates for the signed-in owner, including an identity-only connection whose channel becomes available on refresh.

Do not disconnect YouTube or delete an account to remove duplicate rows. Those actions can revoke authorization and remove configuration.

## Cause And Scope

- Older connections used the YouTube channel ID as the account key. Newer OAuth connections use the hashed Google subject. Reconnecting could leave both rows attached to the same AruBot user.
- Profile refresh applied the owner's single active YouTube token to every linked YouTube row, making unrelated historical rows display the same channel. It also replaced identity metadata with channel metadata.
- Refresh now updates only the token-linked account and preserves its stable identity. Reconnect/profile writes and eligible repairs run in a transaction with per-identity/per-owner locks.
- A quota-limited or viewer-only login no longer clears a previously resolved channel profile.

## What Is Retained

Repair keeps the canonical Google-keyed account, the earliest connection date, latest login date, and merged metadata. The channel ID remains available as an identity alias. Only a legacy channel-keyed duplicate for the same owner and channel is removed.

Tokens, application user IDs, points, settings, and streamer channel registrations are not deleted or reassigned. Legacy token identifiers are not rewritten; they can still resolve the retained channel alias.

Different owners, conflicting Google subjects, multiple Google accounts managing the same channel, and old rows whose channel was overwritten are not automatically merged. Display names alone are not proof of identity.

## Verification

`tests/youtube-account-identity.test.js` covers profile preservation, repair boundaries, rollback, refresh routing, and token switching. `tests/youtube-account-identity-postgres.test.js` additionally exercises the real SQL migration twice and concurrent OAuth writes in an isolated schema when `ARUBOT_TEST_POSTGRES_URL` points to a local test database. The existing backend workflow already supplies that PostgreSQL service.
