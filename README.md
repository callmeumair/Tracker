# Browser Screen Recorder & Interaction Tracker

Turn any modern Chromium page into a self-serve usability recorder. The floating panel captures user clicks, typing sessions, input commits, SPA navigations, tab visibility changes, and throttled screenshots, then surfaces them in a chat-like feed with PDF/JSON exports.

## Highlights
- Start/Stop/Clear controls with persistent event store (IndexedDB) and JSON export API (`window.browserRecorder.exportSessionJSON()`).
- Privacy-first typed text capture toggle, password/data-privacy detection, domain allowlist/denylist, and selector denylist.
- SPA-safe navigation tracking: history monkeypatch + `popstate` + 1 s URL polling fallback, plus optional Chrome extension background script broadcasting cross-tab events.
- Screenshot throttling (≥700 ms) with html2canvas fallback and chrome tab capture, queueing concurrent requests.
- Chat UI with search + event type filters, thumbnail gallery, fullscreen overlay, PDF progress modal, and toast notifications.
- PDF generator (dynamic `jspdf` import) adds title page, ordered event cards, scaled screenshots, cancellation hook, and placeholder text if embedding fails.
- Sample assets included: `sample/sample-session.json`, `sample/sample-session.pdf`, and `sample/demo.gif` (animated summary).

## Getting Started
```bash
npm install
npm run dev
```
The dev server injects the recorder panel directly into the served page so you can test against any site via browser devtools snippets or bookmarklets.

### Scripts
| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload and recorder injection. |
| `npm run build` | Type-check + production bundle for standalone/site embedding. |
| `npm run test` | Jest + jsdom unit suite (event capture, SPA patching, PDF generation). |
| `npm run demo` | Rebuilds `sample/sample-session.pdf` from `sample/sample-session.json` via `jspdf`. |
| `npm run extension-build` | Produces `dist/extension/` with `content.js`, `background.js`, and `manifest.json`. |
| `npm run lint` | ESLint check (flat config). |

### Chrome Extension
1. `npm run extension-build`
2. Chrome → Extensions → Developer mode → **Load unpacked** → select `dist/extension`.
3. The background service worker (`src/background.ts`) listens to `tabs.onCreated/onActivated/onUpdated` and notifies content scripts (`RECORDER_TAB_EVENT`) while exposing `chrome.tabs.captureVisibleTab` for high-fidelity screenshots.

## Using the Recorder
1. Click **Start** to begin a session. A warning reminds users that typed text (excluding passwords/data-privacy elements) is recorded.
2. Interact with the page. The recorder ignores its own UI via `data-recorder-ui`.
3. Watch the chat feed populate with timestamps, event types, typed snippets, and screenshot thumbnails (click for fullscreen).
4. Use search or type-filter toggles to focus on specific interactions.
5. **Generate PDF** to get `session-YYYYMMDD-HHMMSS.pdf` with a title page + ordered event details + scaled images. Progress and cancel controls keep the UI responsive.
6. **Export JSON** downloads the live session payload; it mirrors the output of `exportSessionJSON()`.
7. **Clear** resets the store (with confirmation).

## YouTube / Instagram Manual Checklist
- **YouTube search input (`input#search`)**
  - Start recording, type a query, press Enter.
  - Expect a `keypress` aggregation containing the typed phrase and an `input_commit` event with the committed value + screenshot.
  - Generate PDF and verify the typed phrase plus image appear on the event page.
- **YouTube SPA navigation**
  - Click a video tile without a full reload.
  - Expect a `navigation` event with the new `/watch` URL, screenshot, and timestamp matching the SPA transition.
- **Instagram SPA navigation**
  - On https://www.instagram.com/ trigger an in-app route change (search panel, profile link, etc.). `navigationUrl` should update even though the page never reloads.
- **Visibility changes**
  - Switch to another tab → expect `visibility` event with `hidden`. Return to tab → expect `visible` event and a screenshot captured on resume.
- **Password exclusion**
  - Interact with any `<input type="password">` or `[data-privacy="sensitive"]`. No typed text or value should appear, and screenshots for that element are skipped per deny rules.
- **>20 event PDF**
  - Drive enough interactions (clicks, typing, SPA navs) and confirm the PDF paginates cleanly without image splits.

## Automated Tests
- `src/tests/runtime.test.ts`: mocks the screenshot service, simulates DOM click + history navigation, and asserts event payloads.
- `src/tests/pdf.test.ts`: mocks `jspdf`, injects deterministic `Image`, and checks that `generatePDFReport` writes the typed text & invokes `save()`.

Run them all via `npm test`.

## Sample Assets
- `sample/sample-session.json` — canonical export for documentation and demo script.
- `sample/sample-session.pdf` — generated with `npm run demo`, mirrors PDF output for >20 events.
- `sample/demo.gif` — lightweight animated summary of the panel workflow (start → interactions → export). Embed in docs or PRs as proof-of-life.

## Known Limitations / Notes
- Screenshots outside the extension rely on `html2canvas`, so cross-origin media protected by CORS may render as blanks (a placeholder error string is stored).
- Streaming sites with aggressive CSP may block the injected styles; load the extension build in those cases.
- The animated GIF is a stylized visualization (no audio) sized for quick sharing rather than a literal screen capture.
- File size for long sessions can grow; consider clearing or exporting between flows.

## Acceptance Matrix
- ✅ Click/key/input events with selectors, coords, throttle, and privacy filters.
- ✅ SPA/polling navigation detection and tab visibility capture.
- ✅ IndexedDB persistence + JSON export API.
- ✅ Domain/selector filters, typed toggle w/ localStorage persistence.
- ✅ Chat UI, thumbnail overlay, PDF export with progress + cancellation.
- ✅ Sample JSON/PDF/GIF artifacts + Jest/unit coverage + README test plan.
- ✅ Optional Chrome extension background for cross-tab monitoring + `chrome.tabs.captureVisibleTab` bridge.
