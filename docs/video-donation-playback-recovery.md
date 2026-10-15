# Video Donation Playback Recovery

## Failure paths fixed

- Periodic HTTP snapshots, focus events and WebSocket initialization previously sought an already playing item back to the server clock. A snapshot now reconciles queue identity and pause intent; it seeks only for a new item or a newer explicit playback revision.
- YouTube can temporarily return zero during buffering. Only the owning BGM window with stable PLAYING/PAUSED samples can report native timeline seeks. A candidate must remain stable for 600 ms. Video overlays have no native timeline controls and cannot report automatic seeks.
- Controls carry an item ID, playback epoch, revision, client ID and control ID. Duplicate revisions, retired epochs, stale items and another BGM window's controls cannot override current playback. A locally initiated seek acknowledgement does not seek its sender again.
- A server restart creates a new playback epoch. A connected player keeps its current position when accepting the new initial state, while subsequent explicit controls remain functional.
- Failed completion reports previously destroyed the player and then allowed the unchanged queue head to start again. The client now retains a pending completion and retries without replaying that item, including when BGM readiness temporarily pauses the queue.
- Repeated direct-video snapshots no longer reset the media element or its readiness state. Caption changes update captions without recreating the YouTube player or socket.
- BGM presence requests time out after five seconds. A brief failure does not stop audio; a client without renewed ownership pauses before the server's 12-second lease can expire. A rejected ownership claim stops local playback immediately.

## Compatibility and controls

Native YouTube timeline controls remain available in the BGM window. Web controls, explicit seek/pause/play, requested playback ranges, video interruptions, idle Mix playback and low-volume behavior remain supported. The backend and frontend should be deployed together; already open browser sources should be refreshed once to load the corrected client.

No new dependencies or database schema are required for these playback changes.

## Verification boundary

The focused Jest tests execute the player component and server control handlers with simulated clocks, requests and YouTube events. They cover delayed responses, repeated snapshots and commands, buffering, ownership conflicts, restart epochs, completion retry, interruption, native seeking and direct-video playback.

A temporary Playwright fixture also runs the actual React component in Chromium with simulated media/transport, checking that state updates, captions, native timeline controls and restart snapshots preserve a single player and its progress. This is not proof of live YouTube, an OBS browser source, production network behavior or a production deployment.

For release smoke testing, keep a video overlay and BGM player open without the management website; request both kinds of items, pause/seek, interrupt BGM with video, then restart the backend. Confirm no same-item replay, commands resume without login, and the queue advances only once per item. Single-process backend restarts still have a real connection gap; automatic recovery does not mean zero downtime.
