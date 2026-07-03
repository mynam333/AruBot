# Aru Pause Store Submission

## Build

```powershell
npm run extension:build
```

Outputs:

- Chrome Web Store: `dist/browser-extension/aru-pause-chrome-v<version>.zip`
- Firefox AMO: `dist/browser-extension/aru-pause-firefox-v<version>.zip`

The source `browser-extension/manifest.json` keeps localhost permissions for unpacked local development. The store ZIPs remove localhost and 127.0.0.1 host permissions. Every build increments `browser-extension/version.json` and writes that generated version to both store manifests.

## Chrome Web Store

- Upload `aru-pause-chrome-v<version>.zip`.
- The manifest is generated without Firefox-only `browser_specific_settings`.
- The ZIP root contains `manifest.json`, extension scripts, options/popup pages, and PNG icons.
- Required listing assets still need to be uploaded in the Chrome Web Store dashboard: screenshots and promotional images.

## Firefox AMO

- Upload `aru-pause-firefox-v<version>.zip`.
- The manifest includes `browser_specific_settings.gecko.id` as `aru-pause@yuaru.com`.
- AMO may also be driven with `web-ext sign` after preparing Mozilla API credentials.

## Permission Justification

- `storage`: saves overlay URLs, AruBot API base, monitoring state, and delay settings locally.
- `tabs`: finds open YouTube tabs so playback can be paused and resumed.
- `scripting`: injects the YouTube content script into already-open YouTube tabs when needed.
- `alarms`: keeps the service worker's queue/resume check active.
- YouTube host permissions: pause and resume only YouTube video tabs.
- CHZZK, CIME, Toonation, AruBot host permissions: fetch overlay/session metadata and connect to each service's donation WebSocket.

## Privacy Notes

- The extension does not collect analytics.
- Overlay URLs and the optional AruBot API base are stored in `chrome.storage.local`/`browser.storage.local` only.
- Donation event payloads are processed in the extension service worker to compute pause durations and are not sent to any third-party service by this extension.

## Reviewer Test Flow

1. Install the extension.
2. Open a YouTube video in a normal tab.
3. Open the extension popup and click `10s test`.
4. Confirm the YouTube video pauses, the countdown runs, and playback resumes when the timer ends.
5. In options, save valid overlay URLs for live service testing and enable `Monitoring`.
