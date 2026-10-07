# Traffic and Text Protection

## Deployment

The API has two independent protection layers. Source changes take effect only
after deploying and restarting the backend. Cloudflare rules take effect at the
edge immediately and do not require a bot restart.

On 2026-10-07, the existing Cloudflare zone was inspected and the following free
rate-limiting rule was activated:

- Name: `AruBot API burst protection`
- Expression: `(http.host eq "arubotapi.yuaru.com")`
- Counter: source IP, more than 300 requests in 10 seconds
- Action: block for 10 seconds
- Scope: API hostname only; DNS, paid plans and other hostnames were not changed

Cloudflare's HTTP, network and SSL/TLS DDoS protection was already active. Under
Attack mode was not enabled: browser challenges can interrupt native clients,
OBS sources and callbacks. An HTTP rate rule counts upgrades, not messages inside
an established WebSocket, so the application also enforces message budgets.

The API DNS record points to Cloudflare Tunnel. Keep the origin private. The supported default is Cloudflare Tunnel to
`http://127.0.0.1:3001`, with `SERVER_HOST=127.0.0.1` and no publicly reachable
backend port. The live origin firewall was not inspected or modified. Do not
assume a proxied DNS record alone prevents direct-origin attacks.

`ARUBOT_TRUSTED_PROXIES` accepts comma-separated proxy IPs/CIDRs, defaulting to
`loopback`. This suits a local tunnel or reverse proxy. With a different topology,
configure only the actual trusted proxy peers and ensure they overwrite forwarded
headers. Never use `0.0.0.0/0` or `::/0`, and never trust a client-supplied
`CF-Connecting-IP` header directly. IPv4-mapped addresses are canonicalized;
IPv6 clients within one /64 share a budget.

## Application Limits

Defaults are centralized in `server/request-protection.js`:

| Boundary | Limit |
| --- | --- |
| HTTP requests | 1,200/minute per client network; 1,000/second per process |
| Auth/API-key routes | 60/minute per client network |
| In-flight HTTP | 96 weighted units/process; 24/client network |
| Incoming HTTP bodies | 128 MiB/10 seconds/process; 64 MiB/minute/client network |
| Large or unknown-length write body | 12 units/request |
| Rate-limit entries | 20,000; refuse new buckets when full, retain active quotas |
| WebSocket upgrades | 120/minute per client network; 200/second per process |
| WebSocket connections | 2,048/process; 32/client network |
| WebSocket frames | 120/10 seconds/socket, including ping/pong |
| Aggregate WebSocket frames/bytes | 1,000 frames/second; 32 MiB/10 seconds/process |
| Aggregate control frames | Separate budget of four frames per allowed connection/second |
| Incoming WebSocket bytes | 4 MiB/10 seconds/client network |
| Queued outgoing WebSocket bytes | 8 MiB/socket |
| WebSocket setup | 15 seconds; authenticated passive Warudo sockets remain open |
| HTTP headers/body | 15-second header timeout; 60-second request timeout |

Endpoint-specific quotas and upload size limits remain in place. Admission occurs
before body parsing; compressed request bodies and compressed WebSocket messages
are not accepted. Unknown-length bodies reserve the largest upload allowance
(16 MiB) in the byte budget; API clients should send a correct Content-Length.
Normal browser uploads are uncompressed. Rejected HTTP traffic
receives 429 or 503 with `Retry-After`; overloaded sockets close so existing client
reconnection can retry. Slow peers are disconnected, not queued indefinitely.

These are per-process controls. They complement, but cannot replace, edge DDoS
protection or firewall isolation. Shared NATs may require measured tuning. Retain
the single backend runtime described in the deployment guide; adding PM2 workers
is not a substitute for shared quotas or provider-runtime coordination.

## Text Policy

The shared text guard rejects more than three combining marks per base character,
repeated identical combining marks in one stack, and excessive invisible runs.
It decomposes individual code points to catch composed/decomposed variants without
normalizing a potentially unbounded attacker-controlled combining sequence.
Ordinary Korean, supported accents, common Arabic/Thai marks and emoji remain
unchanged. This is an anti-abuse policy, not a restriction to ASCII.

HTTP body/query/path and inbound chat events are checked before command/point
processing. Nested JSON strings (including OBS input settings) are decoded for
validation. Command rules, blueprint actions and outbound chat/local-program
effects are also guarded. Unsafe legacy queued automation jobs are marked failed
instead of being sent to the local program. Input is rejected, not rewritten into another command.
Legacy display values are cleaned on JSON output. Signed drawing document/stroke
data is not rewritten, and new submissions still pass input validation.

API errors are `zalgo_text_not_allowed` (400) and `payload_too_complex` (413).
This prevents AruBot processing/displaying abusive text; it does not delete the
original chat message from CHZZK, YouTube or CIME.

## Focused Verification

Run `node node_modules/jest/bin/jest.js --runInBand tests/text-safety.test.js
tests/request-protection.test.js tests/security-boundary-hardening-regression.test.js`.
The tests use isolated loopback HTTP/WebSocket servers and mocks, not the live bot,
database, production load tests or Cloudflare attack traffic.

Security dependency floors: `proxy-addr@2.0.8`, `sharp@0.35.5`, and
`source-map-js@1.2.2`. These address
[proxy trust spoofing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[the sharp/librsvg issue](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), and
[source-map event-loop denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Existing narrow CHZZK protocol dependency exceptions are unchanged.
