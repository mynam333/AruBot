# Songbook Karaoke Overlay

## Surface Brief

Mode: Operate in the editor; passive broadcast display in OBS.
Extend the existing songbook page with an Overlay tab. Do not alter song requests
or playback behavior. "Singing" in request management is the source of truth;
this overlay does not play audio, load a YouTube player, or generate lyrics.

Approved direction: charcoal translucent surfaces, mint accents, white song
titles, quieter artist/requester lines. The current song defaults to the lower
left and the request list to the right. No full-screen backdrop or visual effects
over the stream. Real video thumbnails are optional, with an icon fallback.

## Interaction and Layout

- Independent current-song and request-list blocks; drag, resize, numeric
  positions, keyboard arrows, visibility, and reset for the selected orientation.
- Separate 1920x1080 and 1080x1920 logical layouts. Choose orientation from the
  browser source dimensions and scale the whole logical scene without cropping.
- Save explicitly to the channel, not browser-local storage. Cancel restores the
  saved draft. Optimistic revisions reject conflicting saves from other editors.
- Tune accent/text/background colors, background opacity, type scale, list length,
  thumbnails, requester names, and key shift. Empty blocks may be hidden.
- Long titles scroll gently after a pause; reduced motion uses ellipsis. Overflow
  requests collapse into a count. Empty, error, loading, and read-only states exist.

## Data and Recovery

Dedicated revocable random overlay token; only public song identity, requester,
queue order, request-open state, and overlay layout are returned. No internal
owner/viewer IDs, request messages, private notes, or editing credentials.
Persist layout and token in PostgreSQL under the existing songbook owner lock.
Read snapshots directly from PostgreSQL so multiple API instances agree.
Single-flight two-second polling with an eight-second timeout and bounded
retry backoff continues indefinitely. Keep the last frame on transient failures;
clear it on revoked/invalid tokens. OBS has no editing controls or blocking errors.

## Focused Acceptance Checks

Normalize and bound layouts; portrait and landscape remain independent; token
rotation revokes the old link; permission scopes separate reads from writes;
save conflicts preserve current settings; snapshots omit private fields and
exclude completed requests; drag/resize stay in bounds; save/reload round-trips;
two aspect ratios render without overlap; recovery does not create duplicate polls.
