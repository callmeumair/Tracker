# Troubleshooting: Recorder Panel Not Visible

## Quick Fixes

### 1. Reload the Extension
After rebuilding, you MUST reload the extension:
- Go to `chrome://extensions/`
- Find "Browser Screen Recorder"
- Click the **reload icon** (circular arrow) on the extension card
- Refresh the webpage you're testing on

### 2. Check Browser Console
Open DevTools (F12) and check the Console tab for errors:
- Look for `[Browser Recorder]` messages
- Any red errors should be reported

### 3. Verify Extension is Active
- In `chrome://extensions/`, ensure the extension is **enabled** (toggle should be ON)
- Check that "Allow access to file URLs" is enabled if testing on local files

### 4. Check Content Script Injection
In DevTools Console, type:
```javascript
document.getElementById('browser-recorder-panel')
```
If it returns `null`, the panel wasn't injected. If it returns an element, the panel exists but might be hidden.

### 5. Manual Initialization
If auto-init fails, try in Console:
```javascript
window.browserRecorder
```
If undefined, the recorder didn't initialize. Try:
```javascript
// Check if content script loaded
console.log('Content script check');
```

## Common Issues

### Issue: Panel appears but is invisible
**Solution:** Check CSS z-index conflicts. The panel uses `z-index: 2147483647`. Some sites override this.

### Issue: Panel doesn't appear on specific sites
**Possible causes:**
- Site has Content Security Policy (CSP) blocking inline scripts
- Site uses Shadow DOM that isolates content
- Site removes/modifies DOM after page load

**Solution:** Try a simpler site first (like `example.com`) to verify the extension works.

### Issue: Extension shows errors in chrome://extensions/
**Check:**
- Background script errors (click "service worker" link)
- Content script errors (check page console)

### Issue: Panel appears but React errors
**Solution:** Check console for React errors. May indicate a bundling issue.

## Testing Steps

1. **Fresh Install:**
   ```bash
   npm run extension-build
   ```
   Then in Chrome:
   - Remove old extension
   - Load unpacked from `dist/extension`
   - Visit a simple site like `example.com`
   - Check console for `[Browser Recorder]` messages

2. **Verify Files:**
   ```bash
   ls -la dist/extension/
   ```
   Should show: `content.js`, `background.js`, `manifest.json`, `assets/`

3. **Check Manifest:**
   - `manifest.json` should have `content_scripts` with `matches: ["<all_urls>"]`
   - `run_at: "document_idle"` is correct

## Debug Mode

Add to content script (temporary):
```javascript
console.log('[Recorder] Content script loaded');
console.log('[Recorder] Document ready:', document.readyState);
console.log('[Recorder] Body exists:', !!document.body);
```

## Still Not Working?

1. Check Chrome version (needs Chrome 88+ for Manifest V3)
2. Try disabling other extensions (conflicts possible)
3. Test in Incognito mode (extensions disabled by default)
4. Check if site blocks extensions (some banking sites do)

