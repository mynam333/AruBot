# Restart Recovery

This document describes the legacy single-process recovery path. For uninterrupted
provider intake during ordinary API updates, use the opt-in independent ingress
and coordinated worker handoff in [CHAT_INGRESS_DEPLOYMENT.md](CHAT_INGRESS_DEPLOYMENT.md).
The first migration still requires a maintenance window.

## What This Release Fixes

- The CHZZK stored-token inventory used `access_token <> NULL`. PostgreSQL does
  not match any row against this predicate, so a cold process could miss every
  connected CHZZK account. Visiting the dashboard happened to create a session
  through a separate request path.
- Inventory now excludes NULL/empty credentials correctly, paginates all rows,
  includes platform-token-only CHZZK accounts, and surfaces database failures
  instead of pretending there are no accounts.
- Startup subscribes to CHZZK chat/donation events even while the stream is
  offline, independently of the live-status lookup. It waits for that attempt
  instead of launching it in the background and immediately marking bootstrap
  complete. Existing `onlyWhenLive` command settings are unchanged.
- CHZZK disconnects/errors enter the keyed recovery supervisor, with jittered
  exponential backoff (normally 1 second initially, up to 60 seconds). The
  periodic registered-account monitor is independent of website visits.
- A full CHZZK session creation and token refresh is single-flight. Concurrent
  website/bootstrap requests cannot create duplicate sockets during token/URL
  lookup. Existing per-channel database ownership leases remain in force.
- CIME and YouTube establish their chat connection before a separate live-status
  observation. A failing observation does not prevent connecting chat. YouTube
  still waits for an actual live chat and valid channel/bot authorization.
- Shutdown refuses new provider sessions and releases a lease acquired by an
  in-flight request after shutdown began. Revoked account guards are preserved.

## Readiness And Deployment

`/healthz` means the HTTP process is alive. `/readyz` also requires a working
database and a completed initial registered-account recovery pass. An inventory
failure keeps initial readiness false; subsequent scheduled passes retry it.
A provider-specific connection failure can remain in automatic recovery while
the HTTP service is ready. Readiness is not a claim that every external provider
is online or every user's OAuth grant is valid.

PM2 now waits for the process's `ready` IPC message. The default
`ARUBOT_PM2_LISTEN_TIMEOUT_MS` is 120000; increase it for a large account inventory.
The deployment workflow continues to check the expected release and `/readyz`
with `npm run api:smoke`, and rolls back when the candidate does not become ready.

The existing workflow prepares dependencies and migrations before replacement,
then recreates a **single PM2 fork process** to avoid retaining the previous
release's absolute working directory. This is graceful replacement with automatic
recovery, **not zero downtime**. Chat received while no provider connection exists
can be missed; the provider does not guarantee replay of those events. A process
crash can also defer lease takeover until the old lease expires (45 seconds by
default). Website login is not required for recovery.

Do not switch this deployment to PM2 cluster or run two unrestricted instances as
a workaround. In-memory overlay queues, channel sessions, and ownership leases
must be migrated together. Genuine uninterrupted updates require a separately
deployed provider-event ingress, durable event IDs/checkpoints and deduplication,
plus an explicitly coordinated lease/session handoff to the next version. None
of those guarantees are implied by this fix.

## Focused Verification

```sh
node node_modules/jest/bin/jest.js --runInBand tests/runtime-cold-start.test.js tests/startup-live-status-regression.test.js tests/chzzk-live-chat-autoconnect-regression.test.js tests/runtime-resilience-regression.test.js tests/runtime-recovery-supervisor.test.js tests/disconnected-channel-runtime-regression.test.js tests/session-bootstrap-security.test.js
node --check server/index.js
node --check server/supabase.js
node --check ecosystem.config.cjs
```

Production smoke test after deployment (no browser visits):

1. Keep the website closed, restart the service, and observe `/readyz`.
2. Confirm CHZZK subscription, then send a known command while live. Confirm it
   runs exactly once. Repeat with an account linked under a different provider.
3. While offline, test a configured donation action, then start the stream and
   send its first command. Ordinary command live-only rules must remain intact.
4. Drop the provider connection briefly and check automatic reconnect/backoff.
5. Verify release rollback and startup with the production database. Automated
   mocked-provider tests do not replace this live smoke test.
