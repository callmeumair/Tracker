import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type RecorderRuntime from '@/content/RecorderRuntime';
import type { RecorderEvent, RecorderFilters } from '@/lib/types';
import { generatePDFReport } from '@/lib/pdf';
import './RecorderPanel.css';

const EVENT_TYPES: RecorderEvent['type'][] = ['click', 'keypress', 'input_commit', 'navigation', 'visibility'];

interface RecorderPanelProps {
  runtime: RecorderRuntime;
}

type PdfState =
  | { status: 'idle' }
  | { status: 'generating'; percent: number; stage?: string; controller: AbortController };

export function RecorderPanel({ runtime }: RecorderPanelProps) {
  const [events, setEvents] = useState<RecorderEvent[]>(runtime.getEvents());
  const [isRecording, setIsRecording] = useState(runtime.isRecordingActive());
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilters, setTypeFilters] = useState<Record<RecorderEvent['type'], boolean>>(
    EVENT_TYPES.reduce(
      (acc, type) => {
        acc[type] = true;
        return acc;
      },
      {} as Record<RecorderEvent['type'], boolean>,
    ),
  );
  const preferences = runtime.getPreferences();
  const [typedCaptureEnabled, setTypedCaptureEnabled] = useState(preferences.typedCaptureEnabled);
  const [filterInputs, setFilterInputs] = useState({
    allowlist: preferences.filters.domainAllowlist.join(', '),
    denylist: preferences.filters.domainDenylist.join(', '),
    selectors: preferences.filters.selectorDenylist.join(', '),
  });
  const [pdfState, setPdfState] = useState<PdfState>({ status: 'idle' });
  const [previewEvent, setPreviewEvent] = useState<RecorderEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<RecorderEvent[] | null>(null);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return runtime.subscribe((next) => setEvents(next));
  }, [runtime]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => typeFilters[event.type] && matchesSearch(event, searchQuery));
  }, [events, typeFilters, searchQuery]);

  const handleStart = async () => {
    await runtime.start();
    setIsRecording(true);
    setMessage('Recording started');
  };

  const handleStop = () => {
    runtime.stop();
    setIsRecording(false);
    setMessage('Recording stopped');
  };

  const handleClear = async () => {
    if (!window.confirm('Clear all recorded events?')) {
      return;
    }
    setUndoStack([...events]);
    await runtime.clear();
    setMessage('Session cleared');
  };

  const handleUndo = useCallback(() => {
    if (undoStack) {
      undoStack.forEach((event) => {
        runtime.addEvent(event);
      });
      setUndoStack(null);
      setMessage('Events restored');
    }
  }, [undoStack, runtime]);

  const handleTypedToggle = (value: boolean) => {
    runtime.setTypedCaptureEnabled(value);
    setTypedCaptureEnabled(value);
  };

  const handleFilterApply = () => {
    const nextFilters: RecorderFilters = {
      domainAllowlist: parseList(filterInputs.allowlist, true),
      domainDenylist: parseList(filterInputs.denylist, true),
      selectorDenylist: parseList(filterInputs.selectors, false),
    };
    runtime.setFilters(nextFilters);
    setMessage('Filters updated');
  };

  const handlePdf = async () => {
    const controller = new AbortController();
    setPdfState({ status: 'generating', percent: 0, stage: 'Preparing', controller });
    try {
      await generatePDFReport(runtime.exportSessionJSON(), {
        signal: controller.signal,
        onProgress: (progress) => {
          setPdfState({
            status: 'generating',
            percent: progress.percent,
            stage: progress.stage,
            controller,
          });
        },
      });
      setMessage('PDF downloaded');
    } catch (error) {
      if ((error as Error).message.includes('cancelled')) {
        setMessage('PDF generation cancelled');
      } else {
        console.error(error);
        setMessage('PDF generation failed');
      }
    } finally {
      setPdfState({ status: 'idle' });
    }
  };

  const handleExportJson = () => {
    const payload = runtime.exportSessionJSON();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-export-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('JSON exported');
  };

  const handleClose = useCallback(() => {
    const panel = document.getElementById('browser-recorder-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  }, []);

  const handleCloseKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleClose();
      }
    },
    [handleClose],
  );

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showOverflowMenu) {
          setShowOverflowMenu(false);
        } else {
          handleClose();
        }
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (
        overflowMenuRef.current &&
        showOverflowMenu &&
        !overflowMenuRef.current.contains(event.target as Node)
      ) {
        setShowOverflowMenu(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleClose, showOverflowMenu]);

  const handleSearchClear = () => {
    setSearchQuery('');
  };

  const handleEventTypeToggle = (type: RecorderEvent['type']) => {
    setTypeFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const recordingLabel = isRecording ? 'Recording' : 'Stopped';

  return (
    <div
      ref={panelRef}
      className="recorder-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recorder-title"
      data-recorder-ui="true"
    >
      {/* Header */}
      <header className="recorder-panel__header">
        <div className="recorder-panel__header-left">
          <div className="recorder-panel__header-title">
            <img
              className="recorder-panel__header-icon"
              src={
                typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
                  ? chrome.runtime.getURL('icons/icon.png')
                  : '/icons/icon.png'
              }
              alt="Recorder icon"
              onError={(e) => {
                // Fallback if icon fails to load
                console.warn('[Browser Recorder] Icon failed to load, using fallback');
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
            <h2 id="recorder-title">Recorder</h2>
          </div>
          <span
            className={`recorder-panel__status-chip recorder-panel__status-chip--${
              isRecording ? 'recording' : 'stopped'
            }`}
          >
            {recordingLabel}
          </span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="recorder-panel__close"
          onClick={handleClose}
          onKeyDown={handleCloseKeyDown}
          aria-label="Close recorder"
          role="button"
          tabIndex={0}
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Primary Actions */}
      <div className="recorder-panel__primary-actions">
        <div className="recorder-panel__action-group recorder-panel__action-group--primary">
          <button
            type="button"
            className="recorder-panel__button--primary"
            onClick={handleStart}
            disabled={isRecording}
          >
            Start
          </button>
          <button
            type="button"
            className={isRecording ? 'recorder-panel__button--danger' : 'recorder-panel__button--secondary'}
            onClick={handleStop}
            disabled={!isRecording}
          >
            Stop
          </button>
        </div>
        <div className="recorder-panel__action-group recorder-panel__action-group--secondary">
          <button
            type="button"
            className="recorder-panel__button--secondary"
            onClick={handlePdf}
            disabled={!events.length}
          >
            Generate PDF
          </button>
          <button
            type="button"
            className="recorder-panel__button--secondary"
            onClick={handleExportJson}
            disabled={!events.length}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="recorder-panel__button--secondary"
            onClick={handleClear}
            disabled={!events.length}
          >
            Clear
          </button>
        </div>
        <div className="recorder-panel__overflow-menu" ref={overflowMenuRef}>
          <button
            type="button"
            className="recorder-panel__overflow-button"
            onClick={() => setShowOverflowMenu(!showOverflowMenu)}
            aria-label="More actions"
            aria-expanded={showOverflowMenu}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
            </svg>
          </button>
          {showOverflowMenu && (
            <div className="recorder-panel__overflow-dropdown" role="menu">
              <button
                type="button"
                className="recorder-panel__button--secondary"
                onClick={() => {
                  handlePdf();
                  setShowOverflowMenu(false);
                }}
                disabled={!events.length}
                role="menuitem"
              >
                Generate PDF
              </button>
              <button
                type="button"
                className="recorder-panel__button--secondary"
                onClick={() => {
                  handleExportJson();
                  setShowOverflowMenu(false);
                }}
                disabled={!events.length}
                role="menuitem"
              >
                Export JSON
              </button>
              <button
                type="button"
                className="recorder-panel__button--secondary"
                onClick={() => {
                  handleClear();
                  setShowOverflowMenu(false);
                }}
                disabled={!events.length}
                role="menuitem"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Settings */}
      <section className="recorder-panel__settings">
        <p className="recorder-panel__privacy-warning">
          Typed text (except passwords) will be recorded. Toggle to pause typed text capture.
        </p>
        <div className="recorder-panel__toggle-wrapper">
          <label className="recorder-panel__toggle" aria-label="Typed text capture">
            <input
              type="checkbox"
              checked={typedCaptureEnabled}
              onChange={(event) => handleTypedToggle(event.target.checked)}
              aria-checked={typedCaptureEnabled}
            />
            <span className="recorder-panel__toggle-slider"></span>
          </label>
          <span className="recorder-panel__toggle-label">
            Typed text capture {typedCaptureEnabled ? 'enabled' : 'disabled'}
          </span>
        </div>
      </section>

      {/* Filters */}
      <section className="recorder-panel__filters">
        <h3>Domain Filters</h3>
        <label>
          Allowlist
          <input
            type="text"
            value={filterInputs.allowlist}
            onChange={(event) => setFilterInputs((prev) => ({ ...prev, allowlist: event.target.value }))}
            placeholder="example.com, app.example.com"
          />
        </label>
        <label>
          Denylist
          <input
            type="text"
            value={filterInputs.denylist}
            onChange={(event) => setFilterInputs((prev) => ({ ...prev, denylist: event.target.value }))}
            placeholder="sensitive.example.com"
          />
        </label>
        <label>
          Selector denylist
          <input
            type="text"
            value={filterInputs.selectors}
            onChange={(event) => setFilterInputs((prev) => ({ ...prev, selectors: event.target.value }))}
            placeholder="#private, [data-privacy='sensitive']"
          />
        </label>
        <button type="button" className="recorder-panel__apply-filters" onClick={handleFilterApply}>
          Apply filters
        </button>
      </section>

      {/* Search */}
      <section className="recorder-panel__search">
        <div className="recorder-panel__search-wrapper">
          <input
            type="text"
            className="recorder-panel__search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search events by URL, text, or type"
            aria-label="Search events"
          />
          {searchQuery && (
            <button
              type="button"
              className="recorder-panel__search-clear"
              onClick={handleSearchClear}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="recorder-panel__event-type-chips">
          {EVENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`recorder-panel__event-chip ${
                typeFilters[type] ? 'recorder-panel__event-chip--active' : ''
              }`}
              onClick={() => handleEventTypeToggle(type)}
              aria-pressed={typeFilters[type]}
            >
              <span className="recorder-panel__event-chip-icon">
                {typeFilters[type] && (
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {type}
            </button>
          ))}
        </div>
      </section>

      {/* Events Feed */}
      <section className="recorder-panel__feed">
        {filteredEvents.length === 0 ? (
          <div className="recorder-panel__empty">
            <p className="recorder-panel__empty-text">
              {events.length === 0
                ? 'No events recorded yet. Start recording to capture user interactions.'
                : 'No events match your current filters.'}
            </p>
            {events.length === 0 && (
              <button
                type="button"
                className="recorder-panel__button--primary recorder-panel__empty-cta"
                onClick={handleStart}
                disabled={isRecording}
              >
                Start Recording
              </button>
            )}
          </div>
        ) : (
          filteredEvents.map((event) => (
            <article className="recorder-event" key={event.id}>
              <div className="recorder-event__meta">
                <span className="recorder-event__type">{event.type}</span>
                <span className="recorder-event__timestamp">{formatRelativeTime(event.timestamp)}</span>
              </div>
              <p className="recorder-event__url">{event.url}</p>
              {event.element?.textSnippet && <p className="recorder-event__text">{event.element.textSnippet}</p>}
              {event.typedText && <p className="recorder-event__typed">Typed: {event.typedText}</p>}
              {event.screenshotDataUrl && (
                <button
                  type="button"
                  className="recorder-event__thumbnail"
                  onClick={() => setPreviewEvent(event)}
                  aria-label="View screenshot"
                >
                  <img src={event.screenshotDataUrl} alt="event screenshot" />
                </button>
              )}
            </article>
          ))
        )}
      </section>

      {/* PDF Generation Modal */}
      {pdfState.status === 'generating' && (
        <div className="recorder-panel__modal" data-recorder-ui="true">
          <div className="recorder-panel__modal-content">
            <p>Generating PDF…</p>
            <progress value={pdfState.percent} max={100} />
            <p>{pdfState.stage}</p>
            <button type="button" onClick={() => pdfState.controller.abort()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewEvent && (
        <div className="recorder-panel__modal" onClick={() => setPreviewEvent(null)} data-recorder-ui="true">
          <div className="recorder-panel__modal-content recorder-panel__preview">
            <img src={previewEvent.screenshotDataUrl ?? ''} alt="Event screenshot" />
            <button type="button" onClick={() => setPreviewEvent(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Toast Messages */}
      {message && (
        <div className="recorder-panel__toast" data-recorder-ui="true">
          <p>{message}</p>
          {undoStack && message === 'Session cleared' && (
            <button type="button" onClick={handleUndo} className="recorder-panel__button--secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>
              Undo
            </button>
          )}
          <button type="button" onClick={() => setMessage(null)} aria-label="Close message">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function matchesSearch(event: RecorderEvent, query: string) {
  if (!query.trim()) return true;
  const haystack = [
    event.url,
    event.element?.textSnippet ?? '',
    event.typedText ?? '',
    event.navigationUrl ?? '',
    event.type,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function parseList(value: string, lower = false): string[] {
  return value
    .split(',')
    .map((entry) => (lower ? entry.trim().toLowerCase() : entry.trim()))
    .filter(Boolean);
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

export default RecorderPanel;
