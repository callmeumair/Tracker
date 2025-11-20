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
    container.style.cssText = `
      position: fixed !important;
      right: 24px !important;
      bottom: 24px !important;
      width: 420px !important;
      max-height: 90vh !important;
      background: #0f172a !important;
      color: #f8fafc !important;
      border-radius: 16px !important;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.5) !important;
      z-index: 2147483647 !important;
      padding: 16px !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      display: none !important;
      flex-direction: column !important;
      gap: 12px !important;
      overflow: auto !important;
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
    
    // Verify container is visible
    setTimeout(() => {
      const checkContainer = document.getElementById('browser-recorder-panel');
      if (checkContainer) {
        const rect = checkContainer.getBoundingClientRect();
        const styles = window.getComputedStyle(checkContainer);
        console.log('[Browser Recorder] Panel visibility check:', {
          exists: !!checkContainer,
          display: styles.display,
          visibility: styles.visibility,
          opacity: styles.opacity,
          zIndex: styles.zIndex,
          position: styles.position,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: window.innerWidth - rect.right,
          bottom: rect.bottom,
          left: rect.left,
        });
        
        if (rect.width === 0 || rect.height === 0) {
          console.warn('[Browser Recorder] Panel has zero dimensions - CSS may not be loaded');
        }
      } else {
        console.error('[Browser Recorder] Panel container disappeared after render!');
      }
    }, 100);
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
  
  const isVisible = container.style.display !== 'none' && window.getComputedStyle(container).display !== 'none';
  
  if (isVisible) {
    container.style.display = 'none';
    console.log('[Browser Recorder] Panel hidden');
  } else {
    container.style.display = 'flex';
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

