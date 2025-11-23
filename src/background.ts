import { EventStore } from '@/lib/events';
import type { RecorderEvent, RecordedEvent, TabSession, PortMessage, TabSessionMetadata, MergedSessionExport } from '@/lib/types';

// Global state
const store = new EventStore();
const tabSessions = new Map<number, TabSession>();
const tabPorts = new Map<number, chrome.runtime.Port>();
let globalIsRecording = false;

// Constants
const TAB_EVENT = 'RECORDER_TAB_EVENT';
const TOGGLE_PANEL = 'RECORDER_TOGGLE_PANEL';
const MIN_SCREENSHOT_INTERVAL_MS = 700;

// Initialize on startup
initialize();

async function initialize() {
  console.log('[Background] Initializing background service worker');
  
  // Load persisted state
  await store.loadFromDb();
  await restoreAllTabSessions();
  
  // Set up listeners
  chrome.runtime.onConnect.addListener(handlePortConnection);
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.action.onClicked.addListener(handleActionClick);
  chrome.tabs.onCreated.addListener(handleTabCreated);
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  
  console.log('[Background] Initialization complete');
}

// ============================================================================
// Port-based Communication
// ============================================================================

function handlePortConnection(port: chrome.runtime.Port) {
  if (!port.name.startsWith('recorder-tab')) {
    return;
  }

  console.log('[Background] Port connected:', port.name, 'sender:', port.sender?.tab?.id);
  
  const tabId = port.sender?.tab?.id;
  if (!tabId) {
    console.warn('[Background] Port connected without tabId');
    return;
  }

  // Store port reference
  tabPorts.set(tabId, port);

  // Ensure tab session exists
  if (!tabSessions.has(tabId)) {
    createTabSession(tabId, port.sender?.tab?.windowId ?? 0, port.sender?.tab?.url ?? '');
  }

  // Set up port message handler
  port.onMessage.addListener((message: PortMessage) => {
    handlePortMessage(tabId, message, port);
  });

  // Clean up on disconnect
  port.onDisconnect.addListener(() => {
    console.log('[Background] Port disconnected for tab', tabId);
    tabPorts.delete(tabId);
    // Don't delete the session - keep it for history
  });

  // Send initial state
  port.postMessage({
    type: 'state:update',
    isRecording: globalIsRecording,
  } as PortMessage);
}

function handlePortMessage(tabId: number, message: PortMessage, port: chrome.runtime.Port) {
  switch (message.type) {
    case 'tab:init':
      console.log('[Background] Tab initialized:', tabId);
      break;

    case 'tab:event':
      void handleTabEvent(tabId, message.event);
      break;

    case 'screenshot:request':
      void handleScreenshotRequest(tabId, message.requestId, message.reason, port);
      break;

    default:
      console.warn('[Background] Unknown port message type:', (message as PortMessage).type);
  }
}

function sendToPort(tabId: number, message: PortMessage) {
  const port = tabPorts.get(tabId);
  if (port) {
    try {
      port.postMessage(message);
    } catch (error) {
      console.warn('[Background] Failed to send message to port', tabId, error);
      tabPorts.delete(tabId);
    }
  }
}

function broadcastToAllPorts(message: PortMessage) {
  for (const [tabId, port] of tabPorts.entries()) {
    try {
      port.postMessage(message);
    } catch (error) {
      console.warn('[Background] Failed to broadcast to port', tabId, error);
      tabPorts.delete(tabId);
    }
  }
}

// ============================================================================
// Tab Session Management
// ============================================================================

function createTabSession(tabId: number, windowId: number, url: string): TabSession {
  const session: TabSession = {
    tabId,
    windowId,
    url,
    events: [],
    lastScreenshotTime: 0,
    isRecording: globalIsRecording,
    createdAt: new Date().toISOString(),
  };
  
  tabSessions.set(tabId, session);
  console.log('[Background] Created tab session:', tabId);
  
  return session;
}

function getOrCreateTabSession(tabId: number, windowId: number, url: string): TabSession {
  let session = tabSessions.get(tabId);
  if (!session) {
    session = createTabSession(tabId, windowId, url);
  } else {
    // Update URL if changed
    if (url && session.url !== url) {
      session.url = url;
    }
  }
  return session;
}

async function handleTabEvent(tabId: number, event: RecordedEvent) {
  if (!globalIsRecording) {
    return;
  }

  // Attach tabId if not present
  if (!event.tabId) {
    event.tabId = tabId;
  }

  const session = tabSessions.get(tabId);
  if (session) {
    session.events.push(event);
    
    // Persist to IndexedDB
    await store.addEvent(event);
    await store.saveTabSession(tabId, session);
    
    // Broadcast to all tabs so they can update UI
    await broadcast({ type: 'EVENT_ADDED', payload: event });
  }
}

function getMergedEvents(): RecorderEvent[] {
  const allEvents: RecorderEvent[] = [];
  
  for (const session of tabSessions.values()) {
    allEvents.push(...session.events);
  }
  
  // Sort by timestamp
  allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  
  return allEvents;
}

function getTabSessionsMetadata(): TabSessionMetadata[] {
  const metadata: TabSessionMetadata[] = [];
  
  for (const session of tabSessions.values()) {
    const events = session.events;
    metadata.push({
      tabId: session.tabId,
      url: session.url,
      eventCount: events.length,
      firstEventTime: events[0]?.timestamp,
      lastEventTime: events[events.length - 1]?.timestamp,
    });
  }
  
  return metadata;
}

function getMergedSessionExport(): MergedSessionExport {
  const metadata = store.getMetadata();
  const events = getMergedEvents();
  const tabSessions = getTabSessionsMetadata();
  
  return {
    metadata,
    events,
    tabSessions,
  };
}

async function restoreAllTabSessions() {
  try {
    const sessions = await store.getAllTabSessions();
    console.log('[Background] Restoring', sessions.length, 'tab sessions from IndexedDB');
    
    for (const session of sessions) {
      tabSessions.set(session.tabId, session);
    }
  } catch (error) {
    console.warn('[Background] Failed to restore tab sessions', error);
  }
}

async function persistTabSession(tabId: number) {
  const session = tabSessions.get(tabId);
  if (session) {
    await store.saveTabSession(tabId, session);
  }
}

// ============================================================================
// Screenshot Coordination with Double Throttling
// ============================================================================

async function handleScreenshotRequest(
  tabId: number,
  requestId: string,
  reason: string,
  port: chrome.runtime.Port
) {
  const session = tabSessions.get(tabId);
  if (!session) {
    console.warn('[Background] Screenshot request for unknown tab', tabId);
    sendToPort(tabId, {
      type: 'screenshot:response',
      requestId,
      dataUrl: null,
      error: 'Tab session not found',
    });
    return;
  }

  const now = Date.now();
  const elapsed = now - session.lastScreenshotTime;

  // Background-level throttling check
  if (elapsed < MIN_SCREENSHOT_INTERVAL_MS) {
    const delay = MIN_SCREENSHOT_INTERVAL_MS - elapsed;
    console.log('[Background] Throttling screenshot request for tab', tabId, 'delay:', delay);
    
    // Queue the request
    setTimeout(() => {
      void performScreenshotCapture(tabId, requestId, reason, port, session);
    }, delay);
  } else {
    void performScreenshotCapture(tabId, requestId, reason, port, session);
  }
}

async function performScreenshotCapture(
  tabId: number,
  requestId: string,
  reason: string,
  _port: chrome.runtime.Port,
  session: TabSession
) {
  try {
    session.lastScreenshotTime = Date.now();
    
    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(
      session.windowId,
      { format: 'png' }
    );
    
    console.log('[Background] Screenshot captured for tab', tabId, 'reason:', reason);
    
    sendToPort(tabId, {
      type: 'screenshot:response',
      requestId,
      dataUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[Background] Screenshot capture failed for tab', tabId, error);
    
    sendToPort(tabId, {
      type: 'screenshot:response',
      requestId,
      dataUrl: null,
      error: errorMessage,
    });
  }
}

// ============================================================================
// Message-based Communication (Backward Compatibility)
// ============================================================================

function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) {
  void (async () => {
    try {
      const response = await processMessage(message, sender);
      sendResponse(response);
    } catch (error) {
      console.error('[Background] Message handler error:', error);
      sendResponse({ error: String(error) });
    }
  })();
  
  return true; // Keep channel open for async response
}

async function processMessage(message: any, sender: chrome.runtime.MessageSender) {
  switch (message?.type) {
    case 'START_RECORDING':
      globalIsRecording = true;
      broadcastToAllPorts({ type: 'recording:start' });
      await broadcast({ type: 'STATE_UPDATE', payload: { isRecording: true } });
      return { success: true };

    case 'STOP_RECORDING':
      globalIsRecording = false;
      store.markStopped();
      
      // Mark all sessions as stopped
      for (const session of tabSessions.values()) {
        session.isRecording = false;
      }
      
      broadcastToAllPorts({ type: 'recording:stop' });
      await broadcast({ type: 'STATE_UPDATE', payload: { isRecording: false } });
      return { success: true };

    case 'CLEAR_EVENTS':
      await store.clear();
      await store.clearTabSessions();
      
      // Clear all tab sessions
      for (const session of tabSessions.values()) {
        session.events = [];
      }
      
      await broadcast({ type: 'EVENTS_CLEARED', payload: store.getMetadata() });
      return { success: true };

    case 'RECORD_EVENT':
      if (globalIsRecording && message.payload) {
        const event = message.payload as RecordedEvent;
        const tabId = sender.tab?.id;
        
        if (tabId) {
          await handleTabEvent(tabId, event);
        }
      }
      return { success: true };

    case 'GET_STATE':
      return {
        isRecording: globalIsRecording,
        events: getMergedEvents(),
        metadata: store.getMetadata(),
      };

    case 'GET_MERGED_SESSION':
      return getMergedSessionExport();

    case 'GET_TAB_SESSIONS':
      return getTabSessionsMetadata();

    case 'RECORDER_CAPTURE_TAB':
      return await handleCapture(message, sender);

    default:
      return { error: 'Unknown message type' };
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
        void chrome.runtime.lastError; // Ignore errors
      });
    }
  }
}

// ============================================================================
// Tab Lifecycle Management
// ============================================================================

function handleActionClick(tab: chrome.tabs.Tab) {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: TOGGLE_PANEL }, () => {
      void chrome.runtime.lastError;
    });
  }
}

async function handleTabCreated(tab: chrome.tabs.Tab) {
  if (tab.id && tab.windowId) {
    console.log('[Background] Tab created:', tab.id);
    
    // Create session for this tab
    createTabSession(tab.id, tab.windowId, tab.url ?? '');
    
    // Notify tab about creation
    if (globalIsRecording) {
      setTimeout(() => {
        notifyTab(tab.id!, { 
          eventType: 'tab_created', 
          tabId: tab.id, 
          openerTabId: tab.openerTabId ?? null 
        });
      }, 500); // Small delay to ensure content script is loaded
    }
  }
}

async function handleTabActivated(activeInfo: chrome.tabs.OnActivatedInfo) {
  console.log('[Background] Tab activated:', activeInfo.tabId);
  
  // Get tab details
  const tab = await chrome.tabs.get(activeInfo.tabId);
  
  // Ensure session exists
  if (tab.windowId) {
    getOrCreateTabSession(activeInfo.tabId, tab.windowId, tab.url ?? '');
  }
  
  // Inject content script if needed
  await injectScript(activeInfo.tabId);
  
  // Notify tab
  notifyTab(activeInfo.tabId, { 
    eventType: 'tab_activated', 
    ...activeInfo 
  });
}

async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab
) {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('[Background] Tab updated:', tabId, tab.url);
    
    // Update session URL
    if (tab.windowId) {
      const session = getOrCreateTabSession(tabId, tab.windowId, tab.url);
      session.url = tab.url;
      await persistTabSession(tabId);
    }
    
    // Inject content script
    await injectScript(tabId);
    
    // Notify tab
    notifyTab(tabId, { eventType: 'tab_updated', url: tab.url });
  }
}

async function handleTabRemoved(tabId: number, _removeInfo: chrome.tabs.OnRemovedInfo) {
  console.log('[Background] Tab removed:', tabId);
  
  const session = tabSessions.get(tabId);
  if (session) {
    // Mark session as closed
    session.closedAt = new Date().toISOString();
    session.isRecording = false;
    
    // Persist final state
    await persistTabSession(tabId);
  }
  
  // Clean up port
  tabPorts.delete(tabId);
  
  // Note: We keep the session in memory for the remainder of this service worker lifecycle
  // It will be restored from IndexedDB on next startup if needed
}

async function injectScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (error) {
    // Silently fail - likely a restricted page
    // console.debug('[Background] Injection failed for tab', tabId);
  }
}

function notifyTab(tabId: number, payload: Record<string, unknown>) {
  chrome.tabs.sendMessage(tabId, { type: TAB_EVENT, payload }, () => {
    void chrome.runtime.lastError;
  });
}
