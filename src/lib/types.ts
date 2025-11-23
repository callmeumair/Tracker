export type RecorderEventType =
  | 'click'
  | 'keypress'
  | 'input_commit'
  | 'navigation'
  | 'visibility'
  | 'tab_visible_screenshot';

export interface ElementDescriptor {
  tag: string;
  id?: string;
  classes: string[];
  textSnippet?: string;
  selector?: string;
}

export interface EventCoordinates {
  x: number;
  y: number;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RecorderEvent {
  id: string;
  sessionId: string;
  type: RecorderEventType;
  tabId?: number;
  timestamp: string;
  url: string;
  element?: ElementDescriptor;
  coords?: EventCoordinates;
  typedText?: string;
  navigationUrl?: string;
  visibilityState?: 'visible' | 'hidden';
  screenshotDataUrl: string | null;
  screenshotError?: string;
  meta: {
    browser: string;
    userAgent: string;
    [key: string]: unknown;
  };
}

/**
 * Public shape for events that can be added to the recorder runtime.
 * Kept separately to make it easier to adjust ingestion requirements later.
 */
export type RecordedEvent = RecorderEvent;

export interface RecorderFilters {
  domainAllowlist: string[];
  domainDenylist: string[];
  selectorDenylist: string[];
}

export interface RecorderPreferences {
  typedCaptureEnabled: boolean;
  filters: RecorderFilters;
}

export interface SessionMetadata {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  title?: string;
}

export interface SessionExport {
  metadata: SessionMetadata;
  events: RecorderEvent[];
}

export interface ScreenshotResult {
  dataUrl: string | null;
  error?: string;
}

export interface PdfProgress {
  percent: number;
  stage: string;
}

export type EventSubscriber = (events: RecorderEvent[]) => void;

export interface RecorderRuntimeOptions {
  minimumScreenshotIntervalMs?: number;
}

// Multi-tab recording support

export interface TabSession {
  tabId: number;
  windowId: number;
  url: string;
  events: RecorderEvent[];
  lastScreenshotTime: number;
  isRecording: boolean;
  createdAt: string;
  closedAt?: string;
}

export interface TabSessionMetadata {
  tabId: number;
  url: string;
  eventCount: number;
  firstEventTime?: string;
  lastEventTime?: string;
}

export interface MergedSessionExport extends SessionExport {
  tabSessions: TabSessionMetadata[];
}

// Port-based communication messages

export type PortMessage =
  | { type: 'tab:init'; tabId?: number }
  | { type: 'tab:event'; event: RecordedEvent }
  | { type: 'screenshot:request'; requestId: string; reason: string }
  | { type: 'screenshot:response'; requestId: string; dataUrl: string | null; error?: string }
  | { type: 'state:update'; isRecording: boolean }
  | { type: 'recording:start' }
  | { type: 'recording:stop' };

export interface ScreenshotRequest {
  requestId: string;
  tabId: number;
  timestamp: number;
  reason: string;
  resolve: (result: ScreenshotResult) => void;
  reject: (error: Error) => void;
}

