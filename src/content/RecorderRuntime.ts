import {
  createBaseEvent,
  createRuntimeOptions,
  domainMatches,
  isDomainDenied,
} from '@/lib/events';
import {
  describeElement as buildElementDescriptor,
  elementMatchesSelectors,
  extractHostname,
  getElementValue,
  isRecorderUIElement,
  isSensitiveElement,
} from '@/lib/dom';
import { ScreenshotService } from '@/lib/screenshot';
import { loadPreferences, updatePreferences } from '@/lib/preferences';
import type {
  EventSubscriber,
  RecorderEvent,
  RecordedEvent,
  RecorderFilters,
  RecorderPreferences,
  RecorderRuntimeOptions,
  SessionExport,
  SessionMetadata,
} from '@/lib/types';

interface TypingBuffer {
  text: string;
  target: Element | null;
  timer: number | null;
}

interface PrivacyEvaluation {
  allowEvent: boolean;
  allowScreenshot: boolean;
  allowTyped: boolean;
}

const TYPING_INACTIVITY_MS = 2000;
type ChromeApi = typeof chrome;
const chromeApi: ChromeApi | undefined =
  typeof window === 'undefined' ? undefined : (window as Window & { chrome?: ChromeApi }).chrome;
let historyAlreadyPatched = false;

export class RecorderRuntime {
  private events: RecorderEvent[] = [];
  private metadata: SessionMetadata = { sessionId: '', startedAt: '' };
  private subscribers = new Set<EventSubscriber>();
  private screenshotService: ScreenshotService;
  private isRecording = false;
  private listenersAttached = false;
  private typingBuffer: TypingBuffer | null = null;
  private lastKnownUrl = typeof window !== 'undefined' ? window.location.href : '';
  private urlPollHandle: number | null = null;
  private navigationHandler = () => this.handleNavigationChange();
  private preferences: RecorderPreferences;

  constructor(options?: RecorderRuntimeOptions) {
    const runtimeOptions = createRuntimeOptions(options);
    this.screenshotService = new ScreenshotService(runtimeOptions.minimumScreenshotIntervalMs);
    this.preferences = loadPreferences();
  }

  async initialize(): Promise<void> {
    this.attachListeners();
    this.patchHistory();
    this.attachExtensionChannel();
    await this.syncState();
  }

  subscribe(callback: EventSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.events);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async addEvent(event: RecordedEvent): Promise<void> {
    if (!chromeApi?.runtime) return;
    try {
      await chromeApi.runtime.sendMessage({ type: 'RECORD_EVENT', payload: event });
    } catch (error) {
      console.warn('[Recorder] Failed to send event to background', error);
    }
  }

  private attachExtensionChannel(): void {
    if (!chromeApi?.runtime?.onMessage) return;
    chromeApi.runtime.onMessage.addListener((message: { type?: string; payload?: any }) => {
      switch (message?.type) {
        case 'RECORDER_TAB_EVENT':
          void this.handleTabEvent(message.payload ?? {});
          break;
        case 'EVENT_ADDED':
          if (message.payload) {
            this.handleExternalEvent(message.payload as RecorderEvent);
          }
          break;
        case 'EVENTS_CLEARED':
          this.events = [];
          this.metadata = message.payload || { sessionId: crypto.randomUUID(), startedAt: new Date().toISOString() };
          this.notifySubscribers();
          break;
        case 'STATE_UPDATE':
          if (message.payload) {
            this.isRecording = !!message.payload.isRecording;
          }
          break;
      }
    });
  }

  private handleExternalEvent(event: RecorderEvent): void {
    // Avoid duplicates if we just added it? 
    // For simplicity, we can just rely on the background to broadcast back to us
    // checking IDs can prevent duplicates
    if (!this.events.some(e => e.id === event.id)) {
      this.events = [...this.events, event];
      this.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.notifySubscribers();
    }
  }

  private async syncState(): Promise<void> {
    if (!chromeApi?.runtime) return;
    try {
      const response = await chromeApi.runtime.sendMessage({ type: 'GET_STATE' });
      if (response) {
        this.events = response.events || [];
        this.metadata = response.metadata || { sessionId: '', startedAt: '' };
        this.isRecording = response.isRecording || false;
        this.notifySubscribers();
      }
    } catch (error) {
      console.warn('[Recorder] Failed to sync state', error);
    }
  }

  private notifySubscribers(): void {
    const snapshot = this.getEvents();
    this.subscribers.forEach((subscriber) => subscriber(snapshot));
  }

  private async handleTabEvent(payload: Record<string, unknown>): Promise<void> {
    if (!this.isRecording) return;
    const record = createBaseEvent('navigation', this.metadata.sessionId, {
      navigationUrl: (payload.url as string) ?? window.location.href,
    });
    record.meta = {
      ...record.meta,
      tabEvent: payload,
    };
    await this.addEvent(record);
  }

  getEvents(): RecorderEvent[] {
    return [...this.events];
  }

  getSessionMetadata() {
    return { ...this.metadata };
  }

  exportSessionJSON(): SessionExport {
    return {
      metadata: this.getSessionMetadata(),
      events: this.getEvents(),
    };
  }

  getPreferences(): RecorderPreferences {
    return this.preferences;
  }

  getFilters(): RecorderFilters {
    return this.preferences.filters;
  }

  setFilters(filters: RecorderFilters): RecorderFilters {
    this.preferences = updatePreferences({ filters });
    return this.preferences.filters;
  }

  setTypedCaptureEnabled(enabled: boolean): void {
    this.preferences = updatePreferences({ typedCaptureEnabled: enabled });
    if (!enabled) {
      void this.flushTypingBuffer('typed-disabled');
    }
  }

  isRecordingActive(): boolean {
    return this.isRecording;
  }

  async start(): Promise<void> {
    if (!chromeApi?.runtime) return;
    this.isRecording = true;
    this.lastKnownUrl = window.location.href;
    await chromeApi.runtime.sendMessage({ type: 'START_RECORDING' });
  }

  stop(): void {
    if (!chromeApi?.runtime) return;
    this.isRecording = false;
    void this.flushTypingBuffer('stop');
    chromeApi.runtime.sendMessage({ type: 'STOP_RECORDING' });
  }

  async clear(): Promise<void> {
    if (!chromeApi?.runtime) return;
    this.isRecording = false;
    this.typingBuffer = null;
    await chromeApi.runtime.sendMessage({ type: 'CLEAR_EVENTS' });
  }

  destroy(): void {
    if (!this.listenersAttached) return;
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeydown, true);
    document.removeEventListener('blur', this.handleBlur, true);
    document.removeEventListener('submit', this.handleFormSubmit, true);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange, true);
    window.removeEventListener('recorder-spa-navigation', this.navigationHandler);
    window.removeEventListener('popstate', this.navigationHandler);
    if (this.urlPollHandle) {
      window.clearInterval(this.urlPollHandle);
      this.urlPollHandle = null;
    }
    this.listenersAttached = false;
  }

  private attachListeners(): void {
    if (this.listenersAttached || typeof document === 'undefined') return;
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeydown, true);
    document.addEventListener('blur', this.handleBlur, true);
    document.addEventListener('submit', this.handleFormSubmit, true);
    document.addEventListener('visibilitychange', this.handleVisibilityChange, true);
    this.listenersAttached = true;
  }

  private patchHistory(): void {
    if (typeof window === 'undefined' || typeof history === 'undefined') return;

    if (!historyAlreadyPatched) {
      const wrapHistory = <K extends 'pushState' | 'replaceState'>(type: K) => {
        const original = history[type];
        return function wrapped(this: History, ...args: Parameters<History[K]>) {
          const result = original.apply(this, args);
          window.dispatchEvent(new Event('recorder-spa-navigation'));
          return result;
        };
      };

      history.pushState = wrapHistory('pushState');
      history.replaceState = wrapHistory('replaceState');
      historyAlreadyPatched = true;
    }

    window.addEventListener('recorder-spa-navigation', this.navigationHandler);
    window.addEventListener('popstate', this.navigationHandler);
    this.urlPollHandle = window.setInterval(() => {
      const current = window.location.href;
      if (current !== this.lastKnownUrl) {
        this.lastKnownUrl = current;
        void this.handleNavigationChange();
      }
    }, 1000);
    historyAlreadyPatched = true;
  }

  private handleClick = async (event: MouseEvent): Promise<void> => {
    if (!this.isRecording) return;
    const target = event.target as Element | null;
    if (isRecorderUIElement(target)) return;
    const privacy = this.evaluatePrivacy(target);
    if (!privacy.allowEvent) return;

    const descriptor = target ? this.describeElement(target, privacy) : undefined;
    const rect = target?.getBoundingClientRect();
    const coords = rect
      ? {
          x: event.clientX,
          y: event.clientY,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }
      : { x: event.clientX, y: event.clientY };

    const screenshot = await this.screenshotService.capture({
      allow: privacy.allowScreenshot,
      reason: 'click',
    });

    const record = createBaseEvent('click', this.metadata.sessionId, {
      element: descriptor,
      coords,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });

    await this.addEvent(record);
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    if (!this.isRecording) return;
    const target = event.target as Element | null;
    if (isRecorderUIElement(target)) return;

    const key = this.normalizeKey(event);
    if (!key) return;

    if (key === '[Enter]' && !event.shiftKey && target) {
      void this.flushTypingBuffer('enter');
      void this.recordInputCommit(target, 'enter');
      return;
    }

    this.appendTypingCharacter(target, key);
    if (key === '[Tab]' || key === '[Escape]') {
      void this.flushTypingBuffer(key === '[Tab]' ? 'tab' : 'escape');
    }
  };

  private handleBlur = (event: FocusEvent): void => {
    const target = event.target as Element | null;
    if (!this.isRecording || !target || isRecorderUIElement(target)) return;
    void this.flushTypingBuffer('blur');
    void this.recordInputCommit(target, 'blur');
  };

  private handleFormSubmit = (event: SubmitEvent): void => {
    if (!this.isRecording) return;
    const target = event.target as Element | null;
    if (target && isRecorderUIElement(target)) return;
    const candidate =
      target instanceof HTMLFormElement
        ? ((document.activeElement as Element | null) ?? target)
        : target;
    void this.flushTypingBuffer('submit');
    void this.recordInputCommit(candidate, 'submit');
  };

  private handleVisibilityChange = async (): Promise<void> => {
    if (!this.isRecording) return;
    const state = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    const privacy = this.evaluatePrivacy(null);
    if (!privacy.allowEvent) return;
    const screenshot =
      state === 'visible'
        ? await this.screenshotService.capture({ allow: privacy.allowScreenshot, reason: 'visibility' })
        : { dataUrl: null };
    const record = createBaseEvent('visibility', this.metadata.sessionId, {
      visibilityState: state,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    await this.addEvent(record);
  };

  private async handleNavigationChange(): Promise<void> {
    if (!this.isRecording) return;
    const privacy = this.evaluatePrivacy(null);
    if (!privacy.allowEvent) return;
    const screenshot = await this.screenshotService.capture({
      allow: privacy.allowScreenshot,
      reason: 'navigation',
    });
    const record = createBaseEvent('navigation', this.metadata.sessionId, {
      navigationUrl: window.location.href,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    await this.addEvent(record);
  }

  private appendTypingCharacter(target: Element | null, value: string): void {
    if (!this.isRecording) return;
    const privacy = this.evaluatePrivacy(target);
    if (!privacy.allowEvent || !privacy.allowTyped) return;
    const currentTarget = this.typingBuffer?.target;
    if (!this.typingBuffer || currentTarget !== target) {
      void this.flushTypingBuffer('switch');
      this.typingBuffer = { text: '', target, timer: null };
    }
    this.typingBuffer.text += value;
    this.scheduleTypingFlush();
  }

  private scheduleTypingFlush(): void {
    if (!this.typingBuffer) return;
    if (this.typingBuffer.timer) {
      window.clearTimeout(this.typingBuffer.timer);
    }
    this.typingBuffer.timer = window.setTimeout(() => {
      void this.flushTypingBuffer('timeout');
    }, TYPING_INACTIVITY_MS);
  }

  private async flushTypingBuffer(reason: string): Promise<void> {
    if (!this.typingBuffer || !this.typingBuffer.text.trim()) {
      this.clearTypingBuffer();
      return;
    }
    const { target, text } = this.typingBuffer;
    this.clearTypingBuffer();
    const privacy = this.evaluatePrivacy(target);
    if (!privacy.allowEvent) return;
    const typed = privacy.allowTyped ? text : undefined;
    if (!typed) return;
    const descriptor = target ? this.describeElement(target, privacy) : undefined;
    const screenshot = await this.screenshotService.capture({
      allow: privacy.allowScreenshot,
      reason: `typing-${reason}`,
    });
    const record = createBaseEvent('keypress', this.metadata.sessionId, {
      element: descriptor,
      typedText: typed,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    await this.addEvent(record);
  }

  private clearTypingBuffer(): void {
    if (this.typingBuffer?.timer) {
      window.clearTimeout(this.typingBuffer.timer);
    }
    this.typingBuffer = null;
  }

  private async recordInputCommit(element: Element | null, reason: string): Promise<void> {
    if (!element || isRecorderUIElement(element)) return;
    if (isSensitiveElement(element)) return;
    const privacy = this.evaluatePrivacy(element);
    if (!privacy.allowEvent) return;
    const value = getElementValue(element);
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const typedValue = privacy.allowTyped ? trimmed.slice(0, 1000) : undefined;
    const screenshot = await this.screenshotService.capture({
      allow: privacy.allowScreenshot,
      reason: `input-${reason}`,
    });
    const descriptor = this.describeElement(element, privacy);
    const record = createBaseEvent('input_commit', this.metadata.sessionId, {
      element: descriptor,
      typedText: typedValue,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    record.meta = { ...record.meta, inputReason: reason };
    await this.addEvent(record);
  }

  private evaluatePrivacy(element: Element | null): PrivacyEvaluation {
    const hostname = extractHostname(window.location.href);
    const filters = this.preferences.filters;
    const allowlist = filters.domainAllowlist;
    const allowDomain =
      allowlist.length === 0 || allowlist.some((allowed) => domainMatches(hostname, allowed));
    if (!allowDomain) {
      return { allowEvent: false, allowScreenshot: false, allowTyped: false };
    }

    const domainSensitive = isDomainDenied(hostname, filters);
    const selectorSensitive = elementMatchesSelectors(element, filters.selectorDenylist);
    const sensitiveElement = isSensitiveElement(element);

    const allowScreenshot = !(domainSensitive || selectorSensitive);
    const allowTyped = allowScreenshot && !sensitiveElement && this.preferences.typedCaptureEnabled;

    return {
      allowEvent: true,
      allowScreenshot,
      allowTyped,
    };
  }

  private normalizeKey(event: KeyboardEvent): string | null {
    if (event.metaKey || event.ctrlKey || event.altKey) return null;
    if (event.key.length === 1) return event.key;
    switch (event.key) {
      case 'Enter':
        return '[Enter]';
      case 'Tab':
        return '[Tab]';
      case 'Escape':
        return '[Escape]';
      case ' ':
      case 'Spacebar':
        return ' ';
      default:
        return null;
    }
  }

  private describeElement(element: Element, privacy: PrivacyEvaluation) {
    const descriptor = buildElementDescriptor(element);
    if (!descriptor) return undefined;
    if (!privacy.allowTyped) {
      return { ...descriptor, textSnippet: undefined };
    }
    return descriptor;
  }
}

export default RecorderRuntime;
