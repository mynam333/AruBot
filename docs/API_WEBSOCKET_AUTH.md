# Desktop and Warudo WebSocket authentication

Long-lived API keys should not be placed in WebSocket URLs because URLs can be retained by proxies, diagnostics, and process logs. New desktop and Warudo clients use a short-lived, single-use ticket instead.

1. Send `POST /api/apikey/ws-ticket` with the scoped API key in `Authorization: Bearer <API_KEY>` and JSON body `{ "scope": "desktop" }` or `{ "scope": "warudo" }`.
2. Use the returned ticket within 30 seconds at `/api/desktop/ws?ticket=<TICKET>` or `/api/warudo/ws?ticket=<TICKET>`.
3. The server atomically marks the ticket consumed. A replay, expired ticket, or ticket issued for the other scope is rejected.

The previous `?token=<API_KEY>` transport remains enabled only for existing client compatibility. After every deployed client uses tickets, set `ARUBOT_ALLOW_LEGACY_WS_QUERY_API_KEY=false`. API keys remain scoped, expiring, revocable, and stored by hash.

This mechanism is unrelated to the required CHZZK `socket.io-client@2.0.3` compatibility exception.
