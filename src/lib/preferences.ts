import type { RecorderFilters, RecorderPreferences } from './types';

const PREFERENCES_KEY = 'recorder:prefs:v1';

const DEFAULT_FILTERS: RecorderFilters = {
  domainAllowlist: [],
  domainDenylist: [],
  selectorDenylist: [],
};

const DEFAULT_PREFERENCES: RecorderPreferences = {
  typedCaptureEnabled: true,
  filters: DEFAULT_FILTERS,
};

function safeParse(value: string | null): RecorderPreferences | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RecorderPreferences;
    return {
      typedCaptureEnabled: parsed.typedCaptureEnabled ?? true,
      filters: normalizeFilters(parsed.filters),
    };
  } catch {
    return null;
  }
}

function normalizeFilters(filters?: RecorderFilters): RecorderFilters {
  if (!filters) return { ...DEFAULT_FILTERS };
  return {
    domainAllowlist: normalizeList(filters.domainAllowlist),
    domainDenylist: normalizeList(filters.domainDenylist),
    selectorDenylist: normalizeList(filters.selectorDenylist),
  };
}

function normalizeList(list?: string[]): string[] {
  return (list ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

function resolveStorage(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

export function loadPreferences(storage?: Storage): RecorderPreferences {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ...DEFAULT_PREFERENCES, filters: { ...DEFAULT_FILTERS } };
  }

  const stored = safeParse(resolvedStorage.getItem(PREFERENCES_KEY));
  if (stored) return stored;
  return { ...DEFAULT_PREFERENCES, filters: { ...DEFAULT_FILTERS } };
}

export function persistPreferences(
  prefs: RecorderPreferences,
  storage?: Storage,
): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}

export function updatePreferences(
  updates: Partial<RecorderPreferences>,
  storage?: Storage,
): RecorderPreferences {
  const resolvedStorage = resolveStorage(storage);
  const current = loadPreferences(resolvedStorage);
  const next: RecorderPreferences = {
    ...current,
    ...updates,
    filters: updates.filters ? normalizeFilters(updates.filters) : current.filters,
  };
  persistPreferences(next, resolvedStorage);
  return next;
}

