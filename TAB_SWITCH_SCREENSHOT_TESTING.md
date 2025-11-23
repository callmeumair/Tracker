# Tab Switch Screenshot Capture Testing Guide

## Overview

This document provides comprehensive testing instructions for the new tab switch screenshot capture feature. This feature automatically captures a screenshot whenever you switch between tabs or activate a new tab.

## Feature Description

When recording is active, the extension will now:
- Automatically capture a screenshot when you switch to a different tab
- Capture a screenshot when a new tab becomes visible
- Store these as special `tab_visible_screenshot` events in the timeline
- Apply per-tab throttling (700ms minimum between captures)
- Retry once (after 150ms) if initial capture fails

## Prerequisites

1. Extension loaded in Chrome from `dist/extension/`
2. At least 2-3 tabs open for testing
3. Browser DevTools Console open to check logs
4. Extension panel visible in at least one tab

## Test Suite

### Test 1: Basic Tab Switching ✓

**Objective**: Verify screenshots are captured when switching between existing tabs.

**Steps**:
1. Open 3 tabs with distinctive visual content:
   - Tab A: `https://example.com`
   - Tab B: `https://github.com`
   - Tab C: `https://stackoverflow.com`

2. In Tab A, click extension icon to open recorder panel

3. Click "Start" to begin recording

4. Perform the following tab switches:
   - Switch from Tab A → Tab B (wait 1 second)
   - Switch from Tab B → Tab C (wait 1 second)
   - Switch from Tab C → Tab A (wait 1 second)

5. Return to Tab A and check the recorder panel timeline

**Expected Results**:
- ✓ 4 total `tab_visible_screenshot` events appear in timeline
  - 1 for initial tab A activation when recording started
  - 1 for switching to Tab B
  - 1 for switching to Tab C
  - 1 for returning to Tab A
- ✓ Each event shows the correct tab badge (Tab ID)
- ✓ Each event has a screenshot thumbnail
- ✓ Clicking thumbnail shows the correct page content for that tab
- ✓ Console shows logs: `[Background] Tab switch screenshot captured for tab <ID>`

**Console Verification**:
```
[Background] Tab activated: <tabId>
[Background] Tab switch screenshot captured for tab <tabId>
```

---

### Test 2: New Tab Activation ✓

**Objective**: Verify screenshot is captured when opening and navigating to a new tab.

**Steps**:
1. Start recording with Tab A open

2. Open a new tab (Ctrl+T / Cmd+T)

3. Navigate to `https://reddit.com`

4. Wait for page to fully load

5. Switch back to Tab A and check timeline

**Expected Results**:
- ✓ 1 `tab_visible_screenshot` event for the new tab
- ✓ Event shows correct URL (`reddit.com`)
- ✓ Screenshot shows Reddit's homepage
- ✓ Event appears approximately 500ms after tab creation
- ✓ Console shows: `[Background] Tab created: <tabId>`

**Edge Case**: If the tab is still loading when activated, verify:
- First capture attempt may fail (logged as warning)
- Retry after 150ms succeeds
- Final event has valid screenshot

---

### Test 3: Throttling Verification ✓

**Objective**: Verify rapid tab switching is throttled to prevent excessive screenshots.

**Steps**:
1. Start recording with 3 tabs open (A, B, C)

2. Rapidly switch between tabs as fast as possible:
   - A → B → C → A → B → C (within 2-3 seconds)

3. Check timeline and console

**Expected Results**:
- ✓ Not every switch generates a screenshot
- ✓ Per-tab throttling means each tab respects 700ms minimum
- ✓ Console shows throttle messages: `[Background] Tab switch screenshot throttled for tab <ID>`
- ✓ Only switches that occur ≥700ms after last screenshot for that tab succeed
- ✓ Example: If you switch A→B→A in 400ms, second A screenshot is throttled

**Throttling Logic**:
- Tab A last screenshot at T=0ms
- Switch to Tab B at T=200ms → **Captured** (B's first screenshot)
- Switch back to Tab A at T=400ms → **Throttled** (only 400ms since A's last)
- Switch to Tab A at T=800ms → **Captured** (800ms elapsed for Tab A)

---

### Test 4: Retry Logic ✓

**Objective**: Verify screenshot capture retries if tab is not ready.

**Steps**:
1. Start recording

2. Open a new tab and immediately navigate to a slow-loading site:
   - `https://httpstat.us/200?sleep=2000` (delays 2 seconds)

3. Switch to the new tab while it's still loading

4. Watch console logs carefully

5. Wait 2 seconds for page to load

6. Check timeline

**Expected Results**:
- ✓ Console shows first attempt failure: `[Background] Tab switch screenshot failed for tab <ID>`
- ✓ Console shows retry scheduled: `[Background] Scheduling retry for tab <ID>`
- ✓ After 150ms, retry succeeds or second failure logged
- ✓ If page loaded by retry time, screenshot captured successfully
- ✓ Event appears in timeline with valid or null screenshot

**Alternative Test** (if above doesn't trigger retry):
1. Switch to tab immediately after creation (before any content loads)
2. captureVisibleTab may fail on empty/loading tab
3. Retry should succeed once content appears

---

### Test 5: Return to Previous Tab ✓

**Objective**: Verify returning to a previously visited tab captures a new screenshot.

**Steps**:
1. Start recording with Tab A and Tab B open

2. Perform the following sequence:
   - Start in Tab A
   - Switch to Tab B (wait 1 second) → **Screenshot 1**
   - Switch back to Tab A (wait 1 second) → **Screenshot 2**
   - Switch to Tab B again (wait 1 second) → **Screenshot 3**
   - Switch back to Tab A (wait 1 second) → **Screenshot 4**

3. Check timeline

**Expected Results**:
- ✓ 4 separate `tab_visible_screenshot` events
- ✓ Tab A has 2 screenshot events (initial visit + return)
- ✓ Tab B has 2 screenshot events (first visit + second visit)
- ✓ Each screenshot is unique (different timestamp)
- ✓ Screenshots reflect current page state (not cached)

**Verification**:
- Filter timeline to "Per-Tab View" → Select Tab A
- Should see 2 tab_visible_screenshot events for Tab A
- Switch to Tab B filter
- Should see 2 tab_visible_screenshot events for Tab B

---

## Additional Verification Steps

### PDF Export Test

1. After completing tests above, stop recording

2. Click "Generate PDF"

3. Open the PDF and verify:
   - ✓ `TAB_VISIBLE_SCREENSHOT` events appear in chronological order
   - ✓ Each has description: "Tab became visible/active"
   - ✓ Screenshots are included for each event
   - ✓ Tab indicators show correct Tab ID

### JSON Export Test

1. Click "Export JSON"

2. Open JSON file and verify:
   - ✓ Events with `"type": "tab_visible_screenshot"` exist
   - ✓ Each has `tabId`, `timestamp`, `url`, `screenshotDataUrl` properties
   - ✓ `meta.userAgent` is `"background-capture"` for these events

### UI Filter Test

1. With multiple event types recorded, click event type filters

2. Check/uncheck "tab_visible_screenshot" filter

3. Verify:
   - ✓ Filter works correctly
   - ✓ Events appear/disappear as expected

## Edge Cases & Error Handling

### Test: Restricted Pages

1. Start recording
2. Navigate to `chrome://extensions/`
3. Switch to that tab

**Expected**: 
- Screenshot capture fails gracefully
- Console shows: `[Background] Tab switch screenshot skipped - restricted URL`
- No event created

### Test: Minimized Window

1. Start recording
2. Minimize browser window
3. Restore window and switch tabs

**Expected**:
- May fail while minimized (logged as warning)
- Succeeds after window restored

### Test: Extension Reload

1. Start recording and capture some tab switch screenshots
2. Navigate to `chrome://extensions/`
3. Click "Reload" on the extension
4. Return to a tab and switch between tabs

**Expected**:
- Previous events restored from IndexedDB
- New tab switches continue to capture screenshots
- No loss of data

## Success Criteria Checklist

After completing all tests, verify:

- [ ] ✓ Switching between tabs generates screenshot events
- [ ] ✓ Opening new tab generates screenshot when visible
- [ ] ✓ Returning to previous tab generates new screenshot
- [ ] ✓ Throttling prevents screenshots < 700ms apart per tab
- [ ] ✓ Retry logic handles slow-loading tabs
- [ ] ✓ Events appear in timeline with correct tabId
- [ ] ✓ Screenshots show correct tab content (not mixed up)
- [ ] ✓ PDF export includes tab switch screenshots
- [ ] ✓ JSON export has correct event structure
- [ ] ✓ No errors when switching rapidly or closing tabs
- [ ] ✓ Restricted pages handled gracefully
- [ ] ✓ Event type filter includes "tab_visible_screenshot"

## Console Commands for Testing

Open DevTools Console and run:

```javascript
// Check current tab sessions
chrome.runtime.sendMessage({type: 'GET_TAB_SESSIONS'}, console.log)

// Check merged session
chrome.runtime.sendMessage({type: 'GET_MERGED_SESSION'}, console.log)

// Check if recording is active
chrome.runtime.sendMessage({type: 'GET_STATE'}, console.log)
```

## Debugging Tips

### No screenshots appearing?

1. Check console for errors
2. Verify recording is active (green "Recording" status)
3. Check `globalIsRecording` is true in background worker
4. Verify tabs are not restricted pages (chrome://)

### Screenshots mixed up between tabs?

1. Check that `session.windowId` matches the tab's window
2. Verify `captureVisibleTab` receives correct `windowId` parameter
3. Check tab badges in UI match the tab IDs in console logs

### Throttling not working?

1. Check `session.lastScreenshotTime` is being updated
2. Verify `MIN_SCREENSHOT_INTERVAL_MS = 700`
3. Check console logs show throttle messages

### Retry not triggering?

1. Use a reliably slow-loading page
2. Switch to tab immediately (within 100ms of creation)
3. Check console for "Scheduling retry" message

## Performance Notes

- Each screenshot is ~50-100KB (PNG format)
- Background service worker handles all captures
- Content scripts remain lightweight
- Throttling prevents performance issues during rapid switching

## Known Limitations

1. Cannot capture screenshots of `chrome://` pages (by design)
2. Screenshot may be blank if tab content hasn't rendered yet
3. Service worker may sleep after 30s inactivity (mitigated by event persistence)
4. Very rapid switching (<100ms) may miss some intermediate tabs

## Test Results Template

Use this template to document test results:

```
# Tab Switch Screenshot Test Results

Date: [DATE]
Browser: Chrome [VERSION]
OS: [OS]

Test 1: Basic Tab Switching - ✓ PASS / ✗ FAIL
  Notes: 

Test 2: New Tab Activation - ✓ PASS / ✗ FAIL
  Notes:

Test 3: Throttling - ✓ PASS / ✗ FAIL
  Notes:

Test 4: Retry Logic - ✓ PASS / ✗ FAIL
  Notes:

Test 5: Return to Previous Tab - ✓ PASS / ✗ FAIL
  Notes:

Overall: All tests passed: YES / NO

Issues found:
1. 
2. 
```

