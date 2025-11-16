export type RecorderEventType =
  | 'click'
  | 'keypress'
  | 'input_commit'
  | 'navigation'
  | 'visibility';

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

