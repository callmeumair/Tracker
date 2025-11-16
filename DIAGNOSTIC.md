# Browser Recorder Panel - Diagnostic Guide

## Quick Checks

### 1. Reload Extension
- Go to `chrome://extensions/`
- Find "Browser Screen Recorder"
- Click the **reload icon** (circular arrow)
- **Refresh the webpage** you're testing on

### 2. Check Console Messages
Open DevTools (F12) → Console tab, and look for:

**✅ GOOD - You should see these:**
```
[Browser Recorder] Content script loaded, initializing...
[Browser Recorder] Document ready state: complete
[Browser Recorder] Body exists: true
[Browser Recorder] Panel container created and appended to body
[Browser Recorder] React root created
[Browser Recorder] React component rendered
[Browser Recorder] Successfully initialized
[Browser Recorder] Panel should be visible in bottom-right corner
```

**❌ BAD - If you see errors:**
- Any red error messages
- "Failed to initialize"
- "React render failed"

### 3. Manual Check Commands

Run these in the Console (F12):

```javascript
// Check if content script loaded
document.getElementById('browser-recorder-panel')
```
- Returns element → Panel exists (might be hidden)
- Returns `null` → Panel wasn't created

```javascript
// Check if recorder initialized
window.browserRecorder
```
- Returns object → Extension loaded correctly
- Returns `undefined` → Extension didn't initialize

```javascript
// Check if init function exists
window.initBrowserRecorder
```
- Returns function → You can manually trigger init
- Returns `undefined` → Content script didn't load

### 4. Manual Initialization

If auto-init failed, try manually:

```javascript
// In Console (F12)
initBrowserRecorder()
```

This should create the panel if the script loaded but auto-init failed.

### 5. Check Panel Visibility

```javascript
// Check if panel exists and its styles
const panel = document.getElementById('browser-recorder-panel');
if (panel) {
  const rect = panel.getBoundingClientRect();
  const styles = window.getComputedStyle(panel);
  console.log({
    exists: true,
    display: styles.display,
    visibility: styles.visibility,
    opacity: styles.opacity,
    zIndex: styles.zIndex,
    position: styles.position,
    width: rect.width,
    height: rect.height,
    visible: rect.width > 0 && rect.height > 0,
    location: { top: rect.top, right: window.innerWidth - rect.right, bottom: rect.bottom }
  });
} else {
  console.log('Panel does not exist');
}
```

### 6. Common Issues

**Issue: No console messages at all**
- Content script didn't load
- Check `chrome://extensions/` for errors
- Try reloading the extension

**Issue: "Unexpected token 'export'" error**
- Extension wasn't rebuilt properly
- Run: `npm run extension-build`
- Reload extension

**Issue: Panel exists but invisible**
- Check z-index conflicts
- Scroll page - might be off-screen
- Check visibility check output

**Issue: React errors**
- Check console for React-specific errors
- May indicate bundling issue

### 7. Test on Simple Site

Try a simple site first to verify extension works:
1. Visit `https://example.com`
2. Check console for `[Browser Recorder]` messages
3. Look for panel in bottom-right

If it works on example.com but not on YouTube, it's a site-specific issue.

### 8. Still Not Working?

Share these details:
1. All `[Browser Recorder]` console messages
2. Any red errors in console
3. Output of: `document.getElementById('browser-recorder-panel')`
4. Output of: `window.browserRecorder`
5. What site you're testing on

