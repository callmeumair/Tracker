import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import RecorderRuntime from './RecorderRuntime';
import { RecorderPanel } from '@/ui/RecorderPanel';

let runtimeInstance: RecorderRuntime | null = null;
let reactRoot: Root | null = null;

export async function bootstrapRecorder(): Promise<RecorderRuntime> {
  if (runtimeInstance) {
    return runtimeInstance;
  }

  runtimeInstance = new RecorderRuntime();
  await runtimeInstance.initialize();

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener(
        'DOMContentLoaded',
        () => resolve(),
        { once: true },
      );
    });
  }

  // Wait for body to exist
  while (!document.body) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  // Check if container already exists
  let container = document.getElementById('browser-recorder-panel');
  if (!container) {
    container = document.createElement('div');
    container.id = 'browser-recorder-panel';
    container.setAttribute('data-recorder-ui', 'true');
    // Add inline styles as fallback in case CSS doesn't load
    // These styles ensure the panel has proper dimensions even when hidden
    container.style.cssText = `
      position: fixed !important;
      right: 24px !important;
      bottom: 24px !important;
      width: clamp(320px, 36vw, 460px) !important;
      max-width: 460px !important;
      max-height: 90vh !important;
      background: #081028 !important;
      color: #F8FAFC !important;
      border-radius: 16px !important;
      box-shadow: 0 10px 30px rgba(2, 8, 23, 0.35) !important;
      z-index: 2147483647 !important;
      padding: 0 !important;
      font-family: 'Inter', 'Roboto', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      display: none !important;
      flex-direction: column !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    `;
    document.body.appendChild(container);
    console.log('[Browser Recorder] Panel container created and appended to body (hidden by default)');
  } else {
    console.log('[Browser Recorder] Reusing existing panel container');
  }

  // Reuse or create React root
  if (!reactRoot) {
    reactRoot = createRoot(container);
    console.log('[Browser Recorder] React root created');
  }
  
  try {
    reactRoot.render(
      <StrictMode>
        <RecorderPanel runtime={runtimeInstance} />
      </StrictMode>,
    );
    console.log('[Browser Recorder] React component rendered');
    
    // Verify container and React content are properly rendered
    setTimeout(() => {
      const checkContainer = document.getElementById('browser-recorder-panel');
      if (checkContainer) {
        const styles = window.getComputedStyle(checkContainer);
        const isVisible = styles.display !== 'none';
        const rect = checkContainer.getBoundingClientRect();
        
        // Only log detailed info in development or if there's an actual issue
        if (isVisible) {
          console.log('[Browser Recorder] Panel visibility check:', {
            exists: !!checkContainer,
            display: styles.display,
            visibility: styles.visibility,
            opacity: styles.opacity,
            zIndex: styles.zIndex,
            position: styles.position,
            width: rect.width,
            height: rect.height,
          });
          
          // Only warn if panel should be visible but has zero dimensions
          if (rect.width === 0 || rect.height === 0) {
            console.warn('[Browser Recorder] Panel has zero dimensions - CSS may not be loaded');
          }
        } else {
          // Panel is intentionally hidden, no need to check dimensions
          console.log('[Browser Recorder] Panel is hidden (as expected)');
        }
      } else {
        console.error('[Browser Recorder] Panel container disappeared after render!');
      }
    }, 200);
  } catch (renderError) {
    console.error('[Browser Recorder] React render failed:', renderError);
    // Fallback: show a simple message
    container.innerHTML = '<div style="padding: 20px; background: red; color: white; z-index: 999999; position: fixed; bottom: 20px; right: 20px;">Browser Recorder: React render failed. Check console.</div>';
    throw renderError;
  }

  (window as unknown as Record<string, unknown>).browserRecorder = runtimeInstance;

  return runtimeInstance;
}

export function teardownRecorder() {
  runtimeInstance?.destroy();
  runtimeInstance = null;
  reactRoot?.unmount();
  reactRoot = null;
}

export function togglePanel() {
  const container = document.getElementById('browser-recorder-panel');
  if (!container) {
    console.warn('[Browser Recorder] Panel container not found, initializing...');
    void bootstrapRecorder().then(() => togglePanel());
    return;
  }
  
  const computedStyle = window.getComputedStyle(container);
  const isVisible = container.style.display !== 'none' && computedStyle.display !== 'none';
  
  if (isVisible) {
    container.style.display = 'none';
    console.log('[Browser Recorder] Panel hidden');
  } else {
    // Use flex to match CSS class
    container.style.display = 'flex';
    // Ensure it's visible
    container.style.visibility = 'visible';
    container.style.opacity = '1';
    console.log('[Browser Recorder] Panel shown');
  }
}

// Auto-initialize when loaded as content script
if (typeof window !== 'undefined') {
  console.log('[Browser Recorder] Content script loaded, initializing...');
  console.log('[Browser Recorder] Document ready state:', document.readyState);
  console.log('[Browser Recorder] Body exists:', !!document.body);
  
  // Expose functions for debugging
  (window as unknown as Record<string, unknown>).initBrowserRecorder = bootstrapRecorder;
  (window as unknown as Record<string, unknown>).toggleBrowserRecorderPanel = togglePanel;
  
  // Listen for toggle messages from background script
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'RECORDER_TOGGLE_PANEL') {
        togglePanel();
      }
    });
  }
  
  void bootstrapRecorder()
    .then(() => {
      console.log('[Browser Recorder] Successfully initialized');
      console.log('[Browser Recorder] Panel is hidden by default. Click extension icon to toggle.');
      console.log('[Browser Recorder] Or run: toggleBrowserRecorderPanel() in console');
    })
    .catch((error) => {
      console.error('[Browser Recorder] Failed to initialize', error);
      console.error('[Browser Recorder] Stack:', error instanceof Error ? error.stack : String(error));
      console.log('[Browser Recorder] Try running: initBrowserRecorder() in console');
    });
}

