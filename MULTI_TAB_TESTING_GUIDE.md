# Multi-Tab Recording Testing Guide

## Overview

This guide provides comprehensive manual testing instructions for the multi-tab recording feature. The extension now seamlessly records user interactions across all browser tabs and merges them into a unified timeline.

## Installation

1. Open Chrome/Edge browser
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `dist/extension` directory from this project
6. The extension should now be loaded

## Test Suite

### Test 1: Basic Multi-Tab Recording

**Objective**: Verify events from multiple tabs are captured and merged correctly.

**Steps**:
1. Open 3 tabs:
   - Tab 1: `https://example.com`
   - Tab 2: `https://github.com`
   - Tab 3: `https://stackoverflow.com`

2. In Tab 1, click the extension icon to open the recorder panel

3. Click "Start" to begin recording

4. In Tab 1:
   - Click a few links
   - Type in any input field (if available)
   - Scroll the page

5. Switch to Tab 2:
   - Click some elements
   - Navigate to a different page

6. Switch to Tab 3:
   - Submit a form or interact with elements
   - Type in search box

7. Return to Tab 1 and check the recorder panel

**Expected Results**:
- ✓ All events from all 3 tabs appear in the timeline
- ✓ Each event shows a colored tab badge (e.g., "Tab 123", "Tab 124", "Tab 125")
- ✓ Events are sorted chronologically regardless of which tab they came from
- ✓ Tab badges have different colors for visual distinction

### Test 2: Tab View Modes

**Objective**: Verify the UI can switch between merged and per-tab views.

**Steps**:
1. With recording active and events from multiple tabs captured
2. Click "Per-Tab View" button
3. Select different tabs from the dropdown
4. Click "Merged Timeline" button

**Expected Results**:
- ✓ Merged Timeline shows all events from all tabs
- ✓ Per-Tab View dropdown lists all tabs with event counts
- ✓ Selecting a specific tab filters to show only that tab's events
- ✓ "All Tabs" option shows all events even in per-tab mode

### Test 3: Screenshot Coordination

**Objective**: Verify screenshots are captured correctly per tab.

**Steps**:
1. Start recording
2. Open Tab 1 with a distinctive visual (e.g., bright colored website)
3. Click an element (triggers screenshot)
4. Immediately switch to Tab 2 with different visual
5. Click an element (triggers another screenshot)
6. Check screenshots in the event timeline

**Expected Results**:
- ✓ Screenshot for Tab 1 shows Tab 1's content (not Tab 2's)
- ✓ Screenshot for Tab 2 shows Tab 2's content
- ✓ Screenshots are throttled (minimum 700ms between captures per tab)
- ✓ No screenshot mix-ups between tabs

### Test 4: Tab Lifecycle Management

**Objective**: Verify recording continues after tab operations.

**Steps**:
1. Start recording with 2 tabs
2. Add events in both tabs
3. Close one of the tabs
4. Open a new tab (Tab 4)
5. Interact in the new tab
6. Reload one of the existing tabs

**Expected Results**:
- ✓ Events from closed tab remain in timeline
- ✓ New tab's events appear with new tab ID
- ✓ After reload, events continue recording in reloaded tab
- ✓ No errors in console

### Test 5: PDF Export with Multi-Tab Data

**Objective**: Verify PDF includes events from all tabs.

**Steps**:
1. Record events across 3+ tabs
2. Stop recording
3. Click "Generate PDF"
4. Open the downloaded PDF

**Expected Results**:
- ✓ PDF title page shows "Multi-Tab Session Report"
- ✓ Tab Sessions section lists all tabs with event counts and URLs
- ✓ Event headers include tab indicators: "CLICK (Tab 123)"
- ✓ Events from all tabs are included in chronological order

### Test 6: State Persistence & Recovery

**Objective**: Verify session survives extension reload.

**Steps**:
1. Start recording and capture events from 2+ tabs
2. Stop recording
3. Navigate to `chrome://extensions/`
4. Click "Reload" on the extension
5. Return to any tab and open the recorder panel

**Expected Results**:
- ✓ Events from all tabs are still visible
- ✓ Tab sessions are restored from IndexedDB
- ✓ Can continue recording and events are added correctly

### Test 7: Port Connection & Reconnection

**Objective**: Verify content scripts reconnect after disconnect.

**Steps**:
1. Start recording
2. Open browser DevTools Console
3. Check for port connection messages: `[Recorder] Port connected to background`
4. Navigate to a new page in the same tab
5. Check console again

**Expected Results**:
- ✓ Port connection established on page load
- ✓ After navigation, port reconnects automatically
- ✓ Queued events are flushed after reconnection
- ✓ No error messages about failed port communication

### Test 8: Background Throttling

**Objective**: Verify background-level screenshot throttling works.

**Steps**:
1. Start recording
2. Rapidly click multiple elements in quick succession (< 700ms apart)
3. Check the timeline

**Expected Results**:
- ✓ Not every click has a screenshot (throttled)
- ✓ Minimum 700ms between screenshots per tab
- ✓ No browser performance issues

### Test 9: JSON Export with Tab Metadata

**Objective**: Verify JSON export includes tab information.

**Steps**:
1. Record events from multiple tabs
2. Click "Export JSON"
3. Open the downloaded JSON file

**Expected Results**:
- ✓ `tabSessions` array is present (if using merged session)
- ✓ Each event has `tabId` property
- ✓ Tab sessions include metadata: `tabId`, `url`, `eventCount`, `firstEventTime`, `lastEventTime`

### Test 10: Edge Cases

**Objective**: Test robustness under unusual conditions.

**Steps**:
1. Start recording
2. Open a restricted page: `chrome://extensions/`
3. Try to interact (content script injection should fail gracefully)
4. Open many tabs (10+) and interact in random order
5. Close tabs while recording is active

**Expected Results**:
- ✓ Restricted pages don't break recording in other tabs
- ✓ Console shows debug message about injection failure (not errors)
- ✓ Many tabs handled correctly (scalability test)
- ✓ Closing tabs doesn't cause errors

## Verification Checklist

After completing all tests, verify:

- [ ] Events from all tabs appear in UI
- [ ] Tab badges are color-coded and visible
- [ ] Screenshots correspond to correct tabs
- [ ] PDF export includes multi-tab metadata
- [ ] JSON export has `tabId` on events
- [ ] Port-based communication working (check console logs)
- [ ] No errors in browser console
- [ ] Extension survives reload/restart
- [ ] UI responsive with 100+ events from multiple tabs
- [ ] Clear button removes all events and sessions

## Debugging Tips

### Check Background Script Logs
1. Go to `chrome://extensions/`
2. Click "Service worker" under the extension
3. Check console for background logs like:
   - `[Background] Initializing background service worker`
   - `[Background] Port connected:`
   - `[Background] Screenshot captured for tab`

### Check Content Script Logs
1. Open DevTools in any tab (F12)
2. Look for logs like:
   - `[Recorder] Port connected to background`
   - `[Browser Recorder] Successfully initialized`

### Check IndexedDB
1. Open DevTools → Application → Storage → IndexedDB
2. Expand `browser-recorder` database
3. Check `events`, `metadata`, and `tab-sessions` stores

### Common Issues

**Issue**: Events not appearing from Tab 2
- **Fix**: Check if content script injected (look for console logs)
- **Fix**: Ensure tab URL matches manifest permissions

**Issue**: Screenshots from wrong tab
- **Fix**: Verify port-based screenshot delegation is working
- **Fix**: Check `lastScreenshotTime` in tab session

**Issue**: Port disconnected errors
- **Fix**: Check if service worker is active
- **Fix**: Reload extension and retry

## Success Criteria

The multi-tab recording feature is working correctly if:

1. ✅ Events from all tabs merge into single timeline
2. ✅ Each event clearly shows which tab it came from
3. ✅ Screenshots reflect the correct tab content
4. ✅ PDF export includes tab metadata
5. ✅ UI can filter by tab or show merged view
6. ✅ Session persists after extension reload
7. ✅ No console errors during normal operation

## Reporting Issues

If any test fails, note:
- Which test step failed
- Browser version and OS
- Console errors (if any)
- Screenshot of the issue
- Steps to reproduce

