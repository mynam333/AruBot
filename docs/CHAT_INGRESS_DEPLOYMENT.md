# Chat ingress deployment

## Scope

Normal API releases keep the existing chat receiver and its provider sockets running.
Events received during the handoff remain in its persistent journal until the next
worker can claim them. A brief command-response delay is possible during draining.
This is not a guarantee against host shutdown, disk failure, provider disconnection,
forced process termination, or ingress self-upgrades. Ambiguous events after a crash
require reconciliation rather than blind replay of point charges or external actions.

The first migration from the single `arubot-api` process is a maintenance operation:
both processes cannot own port 3001 or the same provider sockets simultaneously.
Do not perform that initial migration during a broadcast.

## Processes and paths

| Component | Binding | Lifetime |
| --- | --- | --- |
| `arubot-ingress` | Gateway `127.0.0.1:3001`, private control `127.0.0.1:3701` | Pinned release, not restarted by normal deploys |
| `arubot-runtime-blue` | `127.0.0.1:3002` | Alternating API/command worker |
| `arubot-runtime-green` | `127.0.0.1:3003` | Alternating API/command worker |

Keep the existing reverse proxy pointed at port 3001. Do not publish ports
3002, 3003 or 3701. Every control request requires the shared Bearer secret.
The public gateway does not expose private control routes.

Under `/home/ubuntu/AruBot`:

- `releases/<sha>-<timestamp>-<pid>/`: immutable installed release.
- `current`: active API release symlink.
- `ingress-current`: pinned ingress release symlink, untouched by subsequent deploys.
- `shared/.env`: shared production configuration, private to the deploy account.
- `shared/chat-ingress/`: journal and active generation, outside release cleanup.
- `shared/logs/`: API worker and ingress logs.
- `shared/backend-deploy.lock`: Linux `flock` covering migrations and deployment.
- `shared/chat-runtime-deploy.lock/`: exclusive deploy-script lock and owner metadata.

Release cleanup preserves every PM2 cwd/script reference, both symlink targets,
the previous release, and at least the two most recent releases. It fails closed
on an unreadable PM2 reference. It never deletes the shared journal.

## Journal capacity and status

ACK immediately drops the completed event payload from memory and retains only a
small completion receipt for duplicate detection. Older payload records already in
the on-disk WAL are removed by compaction, not by the ACK itself. Completed receipts
default to a six-hour window and a maximum of 100,000 receipts; configured retention
is capped at seven days. Pending and uncertain events never expire automatically.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `ARUBOT_CHAT_INGRESS_DEDUPE_TTL_MS` | `21600000` (6 hours) | Completed-receipt retention; minimum 1 minute, maximum effective retention 7 days |
| `ARUBOT_CHAT_INGRESS_MAX_ACKED_RECEIPTS` | `100000` | Maximum retained completion receipts; accepted range 1 to 1,000,000 |
| `ARUBOT_CHAT_INGRESS_COMPACT_BYTES` | `67108864` (64 MiB) | WAL growth triggering compaction; not a hard disk-size limit |

Compaction also runs periodically. A large pending/uncertain backlog can still grow
memory and disk usage because compaction preserves unprocessed work. Increasing
receipt limits trades more memory for a longer duplicate-detection window. Capacity
eviction can shorten that window below the configured TTL: a completed event whose
receipt was evicted may be accepted again if the provider resends it. Do not describe
the configured TTL as a guaranteed minimum or seven days as the default.

Inspect authenticated loopback `GET /status` and alert on sustained backlog, memory
or disk growth and an unexpectedly short receipt window:

| Status field | Interpretation |
| --- | --- |
| `backlog`, `inflight`, `uncertain` | Pending, executing and manually reconcilable event counts |
| `acked` | Currently retained completion receipts, not a lifetime processed-event total |
| `journalBytes` | Current on-disk WAL size in bytes |
| `dedupeEntries` | Current duplicate-detection index size, including retained unfinished work |
| `maxAckedReceipts`, `dedupeTtlMs` | Effective receipt capacity and retention settings |
| `evictedReceipts` | Receipt removals from TTL/capacity pruning in this journal instance; not a count of dropped pending events |
| `oldestAckedAt` | Completion timestamp of the oldest retained receipt, Unix milliseconds, or `null` |
| `memoryRssBytes`, `memoryHeapUsedBytes` | Ingress process RSS and used JavaScript heap in bytes |
| `healthy` | Journal/service/provider health; false requires investigation before deploying |

Watch the age of `oldestAckedAt` together with `acked`, `maxAckedReceipts` and changes
in `evictedReceipts` to identify capacity pressure. The receipt limit does not bound
the size of the unfinished-event index. These environment values belong to the
pinned ingress process; normal API releases do not reload them. Change them through
the separate ingress maintenance procedure, not by restarting ingress mid-broadcast.

## Enable once

1. Back up the database and shared configuration. Confirm disk headroom for the
   journal and memory for ingress plus two temporary API workers. Use expand/contract
   database migrations compatible with both API generations and the pinned ingress.
   Direct PostgreSQL access is mandatory in ingress mode: durable-job lease renewal
   and ownership transfer have no REST fallback. Unsupported database configurations
   must fail worker readiness, never silently start without these guarantees.
2. In `shared/.env`, set `ARUBOT_ENABLE_CHAT_INGRESS=true` and
   `ARUBOT_CHAT_INGRESS_SECRET` to a randomly generated secret of at least 32 characters.
   Do not paste the secret into chat, command-line arguments, logs or the repository.
   A server-side generator such as `openssl rand -hex 32` can generate the value.
3. For the first maintenance deployment only, also set
   `ARUBOT_ALLOW_CHAT_INGRESS_MIGRATION=true`. Without it, a running legacy process
   makes preflight fail before migrations or process changes.
4. Run the backend workflow. It stops the legacy process, creates ingress once,
   then prepares and activates the first worker. Only after routed readiness succeeds
   does it delete the still-stopped, identity-matched legacy PM2 entry and save PM2,
   avoiding accidental resurrection and a permanently pinned obsolete release.
   A failed migration preserves that entry for recovery. Remove the
   migration authorization flag after success. Leave `ARUBOT_ENABLE_CHAT_INGRESS=true`.
5. Verify `/status` via authenticated loopback, public `/api/readiness`, provider
   sessions and actual chat/command/OBS behavior before the next broadcast.

The workflow uses an explicit opt-in. Existing installations without the flag keep
their legacy deployment path. Once a pinned ingress exists, removing the flag does
not silently fall back to restarting the legacy process: deployment aborts instead.
Legacy `npm run pm2:reload` is also rejected in ingress mode; use the deployment
workflow or `scripts/deploy-chat-runtime.mjs` with a prepared immutable release.

## Handoff contract (protocol 1)

All private calls use `Authorization: Bearer <shared secret>` over loopback.

1. Validate ingress protocol, health and active PM2 identity. Refuse an occupied
   candidate slot or an already-draining deployment. Start the other worker with a
   unique `ARUBOT_RUNTIME_ID`, `ARUBOT_CHAT_INGRESS_URL=http://127.0.0.1:3701`, shared
   secret and the correct loopback port. Its cwd is the real release, never `current`.
2. Wait for candidate `GET /api/readiness`: HTTP 200, `ok=true`, `check=readiness`,
   matching `releaseSha`, `readiness.initialBootstrapCompleted=true`, `db.ok=true`.
   Standby readiness must not require the candidate to own event claims.
3. Ingress `POST /runtime/drain {runtimeId: oldId}` stops new claims. Old worker
   `POST /api/runtime/drain {timeoutMs}` fences new mutations/background work and
   waits for commands, macros and tracked HTTP work to finish. Confirm ingress
   `inflight=0` and the same active ID.
4. `GET /api/runtime/checkpoint` on old; send that JSON directly as the body of
   `POST /api/runtime/import` on candidate. Require `{ok:true}`. Snapshots are capped
   at 16 MiB and remain in memory; they may contain tokens and must not be logged.
   Import must atomically validate/apply state and transferable durable-job ownership.
   Before activation, transient import failures (network/interrupted response/5xx)
   retry the exact same serialized snapshot, at most three attempts. Before every
   attempt, confirm the source is still active and drained with zero inflight events.
   Never replay that pre-activation snapshot after the candidate becomes active.
5. Ingress `POST /runtime/activate {runtimeId, url, expectedRuntimeId: oldId}` performs
   a compare-and-swap. Then candidate `POST /api/runtime/resume {}` refreshes its
   active state. Check candidate and gateway readiness and ingress identity again.
6. Switch `current`, save PM2 state, then delete the fully drained old worker and
   save again. Only now clean unused releases. Never reload or delete ingress.

The first deployment has no old worker, so drain/checkpoint/import are skipped.
The workflow never cancels an in-progress deployment in favor of a newer push.
Linux `flock` prevents overlapping workflow/manual deployments, including migrations.

## Failure and recovery

- Candidate readiness failure: discard candidate; old continues without a drain.
- Drain/checkpoint failure: no activation; resume old. Queued chat remains in ingress.
  Scheduled donation desktop repeats, including manually started donation tests,
  are drain-tracked. If a long repeat batch exceeds the drain timeout, deployment
  aborts and resumes the old worker instead of terminating the remaining repeats.
- Import response failure: reconcile with bounded idempotent retries while the
  candidate remains inactive. If those retries cannot confirm success, or the
  active generation changes, keep old drained and preserve both workers for
  reconciliation; do not overwrite old with a possibly-empty candidate snapshot.
  Chat continues to queue. Reconcile the applied snapshot and durable-job ownership
  before restoring/resuming old or completing activation.
- Activation response failure after a confirmed import: reconcile `/status` before
  deleting anything, drain candidate and checkpoint/import back to old before
  resuming old, to restore transferred state and durable-job ownership.
- Post-activation readiness failure: drain candidate, checkpoint/import back, CAS
  to old, resume old, verify old through the gateway, then discard candidate.
- If reconciliation fails: preserve both workers and ingress. Do not force-delete
  workers, restart ingress, clear the journal, or automatically replay uncertain events.
  Inspect PM2 and authenticated `/status`/`/events/uncertain`, reconcile external
  effects, and complete/resume the interrupted handoff before redeploying.
- First-deploy failure: there is no old ingress worker to roll back to. The created
  ingress is preserved so received events can remain queued. Fix readiness and retry;
  if a candidate is already active, reconcile it manually before a new deployment.
- Interrupted deploy lock: check `owner.json`, running deploy processes and current
  ingress state first. Remove a stale lock directory only after confirming no deploy
  is running and the active worker is safely resumed. Never blindly delete live locks.
- Protocol mismatch, ingress secret rotation or ingress/provider-code upgrade:
  schedule separate maintenance. Normal releases deliberately retain the pinned
  ingress binary/dependencies/environment and refuse incompatible protocol versions.

### Manually reconcile uncertain events

Use authenticated loopback `GET /events/uncertain` to inspect events whose execution
result is unknown. Before changing any event, manually reconcile its external effects:
point deductions, chat responses, donation/roulette queues and desktop actions. A
crash may have happened after an external action but before its acknowledgment.

Only after that review, use authenticated `POST /events/resolve` with all fields:

```json
{
  "id": "event-id-from-the-uncertain-list",
  "action": "retry",
  "operator": "operator-identifier",
  "reason": "External effects checked and safe to retry",
  "confirm": "I_HAVE_RECONCILED_SIDE_EFFECTS"
}
```

`action` must be `retry` or `discard`. Choose `retry` only when repeating the action
is safe after verifying or compensating any earlier effects. Choose `discard` when
the event must not execute again after reconciliation. Discard does not undo an
already-sent response, automatically refund points or reverse external actions.
Never automate these calls solely because an event is old or a queue is blocked;
uncertain work is deliberately retained until this explicit operator decision.

## Verification

Use `npm run test:chat-runtime` for the package's runtime test suite.
`node --test tests/chat-ingress*.test.mjs tests/chat-runtime*.test.mjs tests/runtime-handoff*.test.mjs`
runs in backend safety CI, including PostgreSQL handoff tests against its PostgreSQL
service using `ARUBOT_TEST_POSTGRES_URL`. Deployment-specific tests exercise actual HTTP control and
readiness endpoints with an injected PM2 executor: success ordering, state transfer,
rollback, drain timeout, lost import/activation responses, migration opt-in, process/path
retention, protocol mismatch and concurrent deployment rejection. Existing artifact
and deployment regression tests are also retained.

These checks are not a production PM2/platform test. Before claiming production
continuity, send numbered live chats through a real staged release and verify every
received event is processed once, queue order/points remain correct, provider session
IDs stay stable, and OBS reconnects without restarting the current media item.
