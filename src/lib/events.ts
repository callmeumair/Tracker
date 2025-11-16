import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { describeElement } from './dom';
import { loadPreferences, persistPreferences } from './preferences';
import type {
  ElementDescriptor,
  EventSubscriber,
  RecorderEvent,
  RecorderFilters,
  RecorderPreferences,
  RecorderRuntimeOptions,
  SessionExport,
  SessionMetadata,
} from './types';

interface RecorderDB extends DBSchema {
  events: {
    key: string;
    value: RecorderEvent;
  };
  metadata: {
    key: string;
    value: SessionMetadata;
  };
}

const DB_NAME = 'browser-recorder';
const DB_VERSION = 1;

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export class EventStore {
  private events: RecorderEvent[] = [];
  private subscribers = new Set<EventSubscriber>();
  private metadata: SessionMetadata;
  private dbPromise: Promise<IDBPDatabase<RecorderDB>> | null = null;
  private preferences: RecorderPreferences;

  constructor() {
    this.metadata = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
    this.preferences = loadPreferences();
    if (isIndexedDBAvailable()) {
      this.dbPromise = openDB<RecorderDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('events')) {
            db.createObjectStore('events');
          }
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata');
          }
        },
      }).catch((err) => {
        console.warn('[Recorder] Failed to open IndexedDB', err);
        return null as unknown as IDBPDatabase<RecorderDB>;
      });
    }
  }

  getPreferences(): RecorderPreferences {
    return this.preferences;
  }

  updatePreferences(partial: Partial<RecorderPreferences>): RecorderPreferences {
    this.preferences = {
      ...this.preferences,
      ...partial,
      filters: partial.filters ? this.normalizeFilters(partial.filters) : this.preferences.filters,
    };
    persistPreferences(this.preferences);
    return this.preferences;
  }

  async loadFromDb(): Promise<void> {
    if (!this.dbPromise) {
      return;
    }
    try {
      const db = await this.dbPromise;
      if (!db) return;
      const storedEvents = await db.getAll('events');
      storedEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.events = storedEvents;
      const storedMeta = await db.get('metadata', 'session');
      if (storedMeta) {
        this.metadata = storedMeta;
      }
      this.notify();
    } catch (error) {
      console.warn('[Recorder] Failed to load from IndexedDB', error);
    }
  }

  getEvents(): RecorderEvent[] {
    return [...this.events];
  }

  getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }

  subscribe(callback: EventSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.getEvents());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async addEvent(event: RecorderEvent): Promise<void> {
    this.events = [...this.events, event];
    if (!this.metadata.startedAt) {
      this.metadata.startedAt = event.timestamp;
    }
    await this.persistEvent(event);
    await this.persistMetadata();
    this.notify();
  }

  async clear(): Promise<void> {
    this.events = [];
    this.metadata = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        await db.clear('events');
        await db.put('metadata', this.metadata, 'session');
      } catch (error) {
        console.warn('[Recorder] Failed to clear IndexedDB', error);
      }
    }
    this.notify();
  }

  markStopped(): void {
    this.metadata.endedAt = new Date().toISOString();
    void this.persistMetadata();
  }

  exportSessionJSON(): SessionExport {
    return {
      metadata: this.getMetadata(),
      events: this.getEvents(),
    };
  }

  private async persistEvent(event: RecorderEvent): Promise<void> {
    if (!this.dbPromise) return;
    try {
      const db = await this.dbPromise;
      await db.put('events', event, event.id);
    } catch (error) {
      console.warn('[Recorder] Failed to persist event', error);
    }
  }

  private async persistMetadata(): Promise<void> {
    if (!this.dbPromise) return;
    try {
      const db = await this.dbPromise;
      await db.put('metadata', this.metadata, 'session');
    } catch (error) {
      console.warn('[Recorder] Failed to persist metadata', error);
    }
  }

  private notify(): void {
    const snapshot = this.getEvents();
    this.subscribers.forEach((subscriber) => subscriber(snapshot));
  }

  private normalizeFilters(filters: RecorderFilters): RecorderFilters {
    return {
      domainAllowlist: filters.domainAllowlist.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
      domainDenylist: filters.domainDenylist.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
      selectorDenylist: filters.selectorDenylist.map((entry) => entry.trim()).filter(Boolean),
    };
  }
}

export function createBaseEvent(
  type: RecorderEvent['type'],
  sessionId: string,
  overrides: Partial<RecorderEvent> = {},
): RecorderEvent {
  const userAgentData = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } })
    .userAgentData;
  const browserLabel =
    userAgentData?.brands?.map((brand: { brand: string }) => brand.brand).join(', ') || navigator.appName;
  return {
    id: crypto.randomUUID(),
    sessionId,
    type,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    screenshotDataUrl: null,
    meta: {
      browser: browserLabel,
      userAgent: navigator.userAgent,
    },
    ...overrides,
  };
}

export function sanitizeElementDescriptor(
  element: Element | null,
  options: { stripText?: boolean } = {},
): ElementDescriptor | undefined {
  if (!element) return undefined;
  const descriptor = describeElement(element);
  if (!descriptor) return undefined;
  if (options.stripText) {
    return { ...descriptor, textSnippet: undefined };
  }
  return descriptor;
}

export function normalizeFiltersInput(input: string): string[] {
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

export function shouldCaptureForDomain(hostname: string, filters: RecorderFilters): boolean {
  const allowlist = filters.domainAllowlist;
  const denylist = filters.domainDenylist;
  if (allowlist.length > 0) {
    const match = allowlist.some((allowed) => domainMatches(hostname, allowed));
    if (!match) {
      return false;
    }
  }
  if (denylist.some((denied) => domainMatches(hostname, denied))) {
    return false;
  }
  return true;
}

export function isDomainDenied(hostname: string, filters: RecorderFilters): boolean {
  return filters.domainDenylist.some((denied) => domainMatches(hostname, denied));
}

export function domainMatches(hostname: string, pattern: string): boolean {
  const normalizedPattern = pattern.toLowerCase().replace(/^\*+\./, '');
  const cleanPattern = normalizedPattern.replace(/^https?:\/\//, '');
  return hostname === cleanPattern || hostname.endsWith(`.${cleanPattern}`);
}

export function createRuntimeOptions(options?: RecorderRuntimeOptions): RecorderRuntimeOptions {
  return {
    minimumScreenshotIntervalMs: options?.minimumScreenshotIntervalMs ?? 700,
  };
}

