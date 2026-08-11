# Security exceptions

## CHZZK Socket.IO 2.x compatibility exception

- Status: approved, required compatibility exception
- Package: `socket.io-client@2.0.3` (exact version; no range)
- Scope: the authenticated server-side CHZZK session client only
- Last reviewed: 2026-08-11 (added GHSA-2m8v-j782-fhvr / CVE-2026-69185; npm source `1130711`)
- Next scheduled review: 2026-11-11, or immediately when npm reports a changed finding
- Review trigger: any CHZZK session protocol change, any new advisory in this dependency chain, or a validated replacement client

CHZZK's session endpoint currently requires the Socket.IO 2.x protocol used by `socket.io-client@2.0.3`. Upgrading this dependency to Socket.IO 3.x or 4.x breaks the production CHZZK chat session handshake. Do not upgrade, override, deduplicate, or replace this package or its locked transitive dependency chain until the replacement has passed an end-to-end CHZZK live-session compatibility test.

This exception covers only the currently audited advisory IDs in the locked dependency chain:

- `parseuri`: GHSA-6fx8-h7jm-663j
- `socket.io-parser`: GHSA-xfhh-g9f5-x4m4, GHSA-qm95-pgcg-qqfq, GHSA-cqmj-92xf-r6r9, GHSA-677m-j7p3-52f9, GHSA-2m8v-j782-fhvr (npm source `1130711`)
- nested `ws`: GHSA-3h5v-q93c-6h6q, GHSA-96hv-2xvq-fx4p
- `xmlhttprequest-ssl`: GHSA-h4j5-c7cj-74xg, GHSA-72mh-269x-7mh5
- aggregate findings reported by npm for `engine.io-client` and `socket.io-client` only when they are caused exclusively by the entries above

No future advisory is implicitly approved. `npm run audit:production` verifies the exact package versions, dependency paths, registry download URLs, integrity hashes, advisory IDs, severities, and affected ranges. A new or altered advisory, a changed package artifact or dependency path, or any unrelated production vulnerability fails the gate.

GHSA-2m8v-j782-fhvr is an availability vulnerability: a specially crafted packet can make a Socket.IO client buffer binary attachments until the process runs out of memory. The official remediation for Socket.IO client 2.x is `socket.io-parser@3.3.6`, and there is no vendor-supported workaround other than upgrading to a safe version. That parser version is outside the `~3.1.1` range declared by the required `socket.io-client@2.0.3`. Forcing it with an override would change an untested part of the protocol stack, so it must not be deployed without the full CHZZK end-to-end compatibility test described below. The application-level packet guard described below mirrors the upstream attachment-count bounds, but it is a compensating control rather than a vendor-supported fix. Until a compatible upgrade is validated, use of the vulnerable vendor version remains an explicitly accepted residual risk rather than a package-level remediation.

### Compensating controls

- The dependency is exactly pinned in both `package.json` and `package-lock.json`; automated range upgrades are prohibited. The audit gate also verifies the reviewed dependency declarations and every reverse parent of the locked exception nodes.
- The legacy client is used only for outbound connections to a CHZZK-issued authenticated session URL. It is not exposed as a general-purpose public Socket.IO server.
- The runtime forces the WebSocket transport, creates a fresh connection, disables client reconnection, and obtains the session URL through the authenticated CHZZK API flow.
- Before the legacy client is loaded, an application-level decoder guard accepts only 1 through 10 binary attachments for event and acknowledgement packets, matching the safe upstream bounds while preserving the pinned protocol client.
- The application validates the CHZZK live channel before creating the chat session and disconnects the session when the broadcast is offline.
- CI runs the exception-aware production audit. It permits only the exact findings listed above and blocks every new or altered finding.
- Production runs the API under PM2 memory and restart limits, reducing the blast radius of resource-exhaustion failures.

### Removal plan

Remove this exception only after CHZZK supports a newer Socket.IO protocol or a replacement transport is available and automated tests prove authenticated session creation, subscription, chat receipt, disconnect/reconnect, and live/offline transitions in a real CHZZK-compatible environment. The upgrade must be reviewed as a protocol migration, not a routine dependency update.
