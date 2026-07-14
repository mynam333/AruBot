# Security exceptions

## CHZZK Socket.IO 2.x compatibility exception

- Status: approved, required compatibility exception
- Package: `socket.io-client@2.0.3` (exact version; no range)
- Scope: the authenticated server-side CHZZK session client only
- Last reviewed: 2026-07-14 (reviewed the 2026-07-13 metadata update to GHSA-96hv-2xvq-fx4p; npm source `1123262`)
- Next scheduled review: 2026-10-14, or immediately when npm reports a changed finding
- Review trigger: any CHZZK session protocol change, any new advisory in this dependency chain, or a validated replacement client

CHZZK's session endpoint currently requires the Socket.IO 2.x protocol used by `socket.io-client@2.0.3`. Upgrading this dependency to Socket.IO 3.x or 4.x breaks the production CHZZK chat session handshake. Do not upgrade, override, deduplicate, or replace this package or its locked transitive dependency chain until the replacement has passed an end-to-end CHZZK live-session compatibility test.

This exception covers only the currently audited advisory IDs in the locked dependency chain:

- `parseuri`: GHSA-6fx8-h7jm-663j
- `socket.io-parser`: GHSA-xfhh-g9f5-x4m4, GHSA-qm95-pgcg-qqfq, GHSA-cqmj-92xf-r6r9, GHSA-677m-j7p3-52f9
- nested `ws`: GHSA-3h5v-q93c-6h6q, GHSA-96hv-2xvq-fx4p
- `xmlhttprequest-ssl`: GHSA-h4j5-c7cj-74xg, GHSA-72mh-269x-7mh5
- aggregate findings reported by npm for `engine.io-client` and `socket.io-client` only when they are caused exclusively by the entries above

No future advisory is implicitly approved. `npm run audit:production` verifies the exact package versions, dependency paths, and advisory IDs. A new advisory, a changed dependency path, or any unrelated production vulnerability fails the gate.

### Compensating controls

- The dependency is exactly pinned in both `package.json` and `package-lock.json`; automated range upgrades are prohibited.
- The legacy client is used only for outbound connections to a CHZZK-issued authenticated session URL. It is not exposed as a general-purpose public Socket.IO server.
- The runtime forces the WebSocket transport, creates a fresh connection, disables client reconnection, and obtains the session URL through the authenticated CHZZK API flow.
- The application validates the CHZZK live channel before creating the chat session and disconnects the session when the broadcast is offline.
- CI runs the exception-aware production audit. It permits only the exact findings listed above and blocks every new or altered finding.
- Production runs the API under PM2 memory and restart limits, reducing the blast radius of resource-exhaustion failures.

### Removal plan

Remove this exception only after CHZZK supports a newer Socket.IO protocol or a replacement transport is available and automated tests prove authenticated session creation, subscription, chat receipt, disconnect/reconnect, and live/offline transitions in a real CHZZK-compatible environment. The upgrade must be reviewed as a protocol migration, not a routine dependency update.
