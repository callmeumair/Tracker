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
  if (message?.type === 'RECORDER_CAPTURE_TAB') {
    const format = message.format || 'png'; // Default to PNG for higher quality
    chrome.tabs.captureVisibleTab(
      sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: format as 'png' | 'jpeg' },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ dataUrl: null, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ dataUrl });
      },
    );
    return true;
  }
  return false;
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    notifyTab(tab.id, { eventType: 'tab_created', tabId: tab.id, openerTabId: tab.openerTabId ?? null });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  notifyTab(activeInfo.tabId, { eventType: 'tab_activated', ...activeInfo });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    notifyTab(tabId, { eventType: 'tab_updated', url: tab.url });
  }
});

function notifyTab(tabId: number, payload: Record<string, unknown>) {
  chrome.tabs.sendMessage(tabId, { type: TAB_EVENT, payload }, () => {
    // ignore errors where content scripts are missing
    void chrome.runtime.lastError;
  });
}

