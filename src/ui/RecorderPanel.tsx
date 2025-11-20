import { useEffect, useMemo, useState } from 'react';
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
    await runtime.clear();
    setMessage('Session cleared');
  };

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
  };

  const recordingLabel = isRecording ? 'Recording' : 'Stopped';

  const handleClose = () => {
    const panel = document.getElementById('browser-recorder-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  };

  return (
    <div className="recorder-panel" data-recorder-ui="true">
      <header className="recorder-panel__header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
            <h2>Recorder</h2>
            <button
              type="button"
              onClick={handleClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f8fafc',
                cursor: 'pointer',
                fontSize: '20px',
                padding: '4px 8px',
                lineHeight: 1,
              }}
              title="Close panel"
            >
              ×
            </button>
          </div>
          <p className={`recorder-panel__status recorder-panel__status--${isRecording ? 'on' : 'off'}`}>
            {recordingLabel}
          </p>
        </div>
        <div className="recorder-panel__actions">
          <button type="button" onClick={handleStart} disabled={isRecording}>
            Start
          </button>
          <button type="button" onClick={handleStop} disabled={!isRecording}>
            Stop
          </button>
          <button type="button" onClick={handlePdf} disabled={!events.length}>
            Generate PDF
          </button>
          <button type="button" onClick={handleExportJson} disabled={!events.length}>
            Export JSON
          </button>
          <button type="button" onClick={handleClear} disabled={!events.length}>
            Clear
          </button>
        </div>
      </header>

      <section className="recorder-panel__privacy">
        <p className="recorder-panel__privacy-warning">
          Typed text (except passwords) will be recorded. Toggle to pause typed text capture.
        </p>
        <label className="recorder-panel__toggle">
          <input
            type="checkbox"
            checked={typedCaptureEnabled}
            onChange={(event) => handleTypedToggle(event.target.checked)}
          />
          <span>Typed text capture {typedCaptureEnabled ? 'enabled' : 'disabled'}</span>
        </label>
      </section>

      <section className="recorder-panel__filters">
        <h3>Domain Filters</h3>
        <label>
          Allowlist
          <input
            value={filterInputs.allowlist}
            onChange={(event) => setFilterInputs((prev) => ({ ...prev, allowlist: event.target.value }))}
            placeholder="example.com, app.example.com"
          />
        </label>
        <label>
          Denylist
          <input
            value={filterInputs.denylist}
            onChange={(event) => setFilterInputs((prev) => ({ ...prev, denylist: event.target.value }))}
            placeholder="sensitive.example.com"
          />
        </label>
        <label>
          Selector denylist
          <input
            value={filterInputs.selectors}
            onChange={(event) => setFilterInputs((prev) => ({ ...prev, selectors: event.target.value }))}
            placeholder="#private, [data-privacy='sensitive']"
          />
        </label>
        <button type="button" className="recorder-panel__apply" onClick={handleFilterApply}>
          Apply filters
        </button>
      </section>

      <section className="recorder-panel__search">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search events"
        />
        <div className="recorder-panel__type-filters">
          {EVENT_TYPES.map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={typeFilters[type]}
                onChange={(event) => setTypeFilters((prev) => ({ ...prev, [type]: event.target.checked }))}
              />
              {type}
            </label>
          ))}
        </div>
      </section>

      <section className="recorder-panel__feed">
        {filteredEvents.length === 0 ? (
          <p className="recorder-panel__empty">No events recorded yet.</p>
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
                >
                  <img src={event.screenshotDataUrl} alt="event screenshot" />
                </button>
              )}
            </article>
          ))
        )}
      </section>

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

      {message && (
        <div className="recorder-panel__toast" data-recorder-ui="true">
          <p>{message}</p>
          <button type="button" onClick={() => setMessage(null)}>
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

