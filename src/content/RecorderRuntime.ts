import {
  EventStore,
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
import type {
  EventSubscriber,
  RecorderEvent,
  RecorderFilters,
  RecorderPreferences,
  RecorderRuntimeOptions,
  SessionExport,
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
  private store = new EventStore();
  private screenshotService: ScreenshotService;
  private isRecording = false;
  private listenersAttached = false;
  private typingBuffer: TypingBuffer | null = null;
  private lastKnownUrl = typeof window !== 'undefined' ? window.location.href : '';
  private urlPollHandle: number | null = null;
  private navigationHandler = () => this.handleNavigationChange();
  private preferences: RecorderPreferences = this.store.getPreferences();

  constructor(options?: RecorderRuntimeOptions) {
    const runtimeOptions = createRuntimeOptions(options);
    this.screenshotService = new ScreenshotService(runtimeOptions.minimumScreenshotIntervalMs);
  }

  async initialize(): Promise<void> {
    await this.store.loadFromDb();
    this.attachListeners();
    this.patchHistory();
    this.attachExtensionChannel();
  }

  subscribe(callback: EventSubscriber): () => void {
    return this.store.subscribe(callback);
  }

  private attachExtensionChannel(): void {
    if (!chromeApi?.runtime?.onMessage) return;
    chromeApi.runtime.onMessage.addListener((message: { type?: string; payload?: Record<string, unknown> }) => {
      if (message?.type === 'RECORDER_TAB_EVENT') {
        void this.handleTabEvent(message.payload ?? {});
      }
    });
  }

  private async handleTabEvent(payload: Record<string, unknown>): Promise<void> {
    if (!this.isRecording) return;
    const record = createBaseEvent('navigation', this.store.getMetadata().sessionId, {
      navigationUrl: (payload.url as string) ?? window.location.href,
    });
    record.meta = {
      ...record.meta,
      tabEvent: payload,
    };
    await this.store.addEvent(record);
  }

  getEvents(): RecorderEvent[] {
    return this.store.getEvents();
  }

  getSessionMetadata() {
    return this.store.getMetadata();
  }

  exportSessionJSON(): SessionExport {
    return this.store.exportSessionJSON();
  }

  getPreferences(): RecorderPreferences {
    return this.preferences;
  }

  getFilters(): RecorderFilters {
    return this.preferences.filters;
  }

  setFilters(filters: RecorderFilters): RecorderFilters {
    this.preferences = this.store.updatePreferences({ filters });
    return this.preferences.filters;
  }

  setTypedCaptureEnabled(enabled: boolean): void {
    this.preferences = this.store.updatePreferences({ typedCaptureEnabled: enabled });
    if (!enabled) {
      void this.flushTypingBuffer('typed-disabled');
    }
  }

  isRecordingActive(): boolean {
    return this.isRecording;
  }

  async start(): Promise<void> {
    this.isRecording = true;
    this.lastKnownUrl = window.location.href;
  }

  stop(): void {
    this.isRecording = false;
    void this.flushTypingBuffer('stop');
    this.store.markStopped();
  }

  async clear(): Promise<void> {
    this.isRecording = false;
    this.typingBuffer = null;
    await this.store.clear();
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

    const record = createBaseEvent('click', this.store.getMetadata().sessionId, {
      element: descriptor,
      coords,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });

    await this.store.addEvent(record);
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
    const record = createBaseEvent('visibility', this.store.getMetadata().sessionId, {
      visibilityState: state,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    await this.store.addEvent(record);
  };

  private async handleNavigationChange(): Promise<void> {
    if (!this.isRecording) return;
    const privacy = this.evaluatePrivacy(null);
    if (!privacy.allowEvent) return;
    const screenshot = await this.screenshotService.capture({
      allow: privacy.allowScreenshot,
      reason: 'navigation',
    });
    const record = createBaseEvent('navigation', this.store.getMetadata().sessionId, {
      navigationUrl: window.location.href,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    await this.store.addEvent(record);
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
    const record = createBaseEvent('keypress', this.store.getMetadata().sessionId, {
      element: descriptor,
      typedText: typed,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    await this.store.addEvent(record);
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
    const record = createBaseEvent('input_commit', this.store.getMetadata().sessionId, {
      element: descriptor,
      typedText: typedValue,
      screenshotDataUrl: screenshot.dataUrl,
      screenshotError: screenshot.error,
    });
    record.meta = { ...record.meta, inputReason: reason };
    await this.store.addEvent(record);
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

