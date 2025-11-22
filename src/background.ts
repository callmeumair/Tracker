import { EventStore } from '@/lib/events';
import type { RecorderEvent, RecordedEvent } from '@/lib/types';

// We need to reimplement this here or ensure we can use the class
// The build process should bundle dependencies.

const store = new EventStore();
let isRecording = false;

// Load initial state
store.loadFromDb().then(() => {
  console.log('[Background] EventStore loaded');
});

const TAB_EVENT = 'RECORDER_TAB_EVENT';
const TOGGLE_PANEL = 'RECORDER_TOGGLE_PANEL';

// Handle extension icon click to toggle panel
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: TOGGLE_PANEL }, () => {
      void chrome.runtime.lastError;
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender) {
  try {
    switch (message?.type) {
      case 'START_RECORDING':
        isRecording = true;
        await broadcast({ type: 'STATE_UPDATE', payload: { isRecording: true } });
        return true;

      case 'STOP_RECORDING':
        isRecording = false;
        store.markStopped();
        await broadcast({ type: 'STATE_UPDATE', payload: { isRecording: false } });
        return true;

      case 'CLEAR_EVENTS':
        await store.clear();
        await broadcast({ type: 'EVENTS_CLEARED', payload: store.getMetadata() });
        return true;

      case 'RECORD_EVENT':
        if (isRecording && message.payload) {
          const event = message.payload as RecordedEvent;
          // Attach tabId from sender if available
          if (sender.tab?.id) {
            event.tabId = sender.tab.id;
          }
          await store.addEvent(event);
          // Broadcast back to all tabs so they can update their UI/state
          await broadcast({ type: 'EVENT_ADDED', payload: event });
        }
        return true;

      case 'GET_STATE':
        return {
          isRecording,
          events: store.getEvents(),
          metadata: store.getMetadata(),
        };

      case 'RECORDER_CAPTURE_TAB':
        return await handleCapture(message, sender);
        
      default:
        return false;
    }
  } catch (error) {
    console.error('[Background] Message handler error:', error);
    return { error: String(error) };
  }
}

async function handleCapture(message: any, sender: chrome.runtime.MessageSender) {
  const format = message.format || 'png';
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: format as 'png' | 'jpeg' }
    );
    return { dataUrl };
  } catch (error) {
    return { dataUrl: null, error: (error as Error).message };
  }
}

async function broadcast(message: any) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, message, () => {
        // Ignore errors if tab doesn't have content script
        void chrome.runtime.lastError;
      });
    }
  }
}

// Tab Lifecycle Tracking

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id) {
    // Inject script if needed (mostly for new tabs that might not match manifest rules immediately or to be safe)
    // Note: Manifest content_scripts handle most cases.
    // However, for a new tab that navigates to a valid URL, we might want to ensure it's ready.
    // We'll rely on onUpdated for injection on navigation.
    
    notifyTab(tab.id, { eventType: 'tab_created', tabId: tab.id, openerTabId: tab.openerTabId ?? null });
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  notifyTab(activeInfo.tabId, { eventType: 'tab_activated', ...activeInfo });
  
  // Ensure content script is there (optional, but good for resilience)
  await injectScript(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    await injectScript(tabId);
    notifyTab(tabId, { eventType: 'tab_updated', url: tab.url });
  }
});

async function injectScript(tabId: number) {
  try {
    // Check if we can access the tab
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (e) {
    // Often fails on restricted pages (chrome://, webstore, etc.)
    // console.debug('[Background] Injection failed/skipped for tab', tabId, e);
  }
}

function notifyTab(tabId: number, payload: Record<string, unknown>) {
  // We send this as RECORDER_TAB_EVENT so the content script in that tab can record it as a navigation/tab event
  chrome.tabs.sendMessage(tabId, { type: TAB_EVENT, payload }, () => {
    void chrome.runtime.lastError;
  });
}


