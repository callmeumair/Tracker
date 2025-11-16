import type { PdfProgress, RecorderEvent, SessionExport } from './types';

interface PdfOptions {
  onProgress?: (progress: PdfProgress) => void;
  signal?: AbortSignal;
}

const PAGE_MARGIN = 40;
const LINE_HEIGHT = 16;
const IMAGE_MAX_WIDTH = 480;

export async function generatePDFReport(session: SessionExport, options: PdfOptions = {}): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const events = [...session.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const totalSteps = events.length + 1;
  let completed = 0;

  const reportProgress = (stage: string) => {
    completed += 1;
    const percent = Math.min(100, Math.round((completed / totalSteps) * 100));
    options.onProgress?.({ percent, stage });
  };

  checkAbort(options.signal);
  addTitlePage(doc, session);
  reportProgress('Title page');

  let cursorY = PAGE_MARGIN;
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    checkAbort(options.signal);
    const blockHeightEstimate = event.screenshotDataUrl ? 320 : 160;
    if (cursorY + blockHeightEstimate > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      cursorY = PAGE_MARGIN;
    }

    cursorY = await renderEventBlock(doc, event, cursorY);
    reportProgress(`Event ${index + 1}/${events.length}`);
  }

  const filename = buildFilename(session);
  doc.save(filename);
}

function addTitlePage(doc: any, session: SessionExport) {
  doc.setFontSize(22);
  doc.text('Browser Screen Recorder Session', PAGE_MARGIN, PAGE_MARGIN + 20);
  doc.setFontSize(12);
  const meta = session.metadata;
  const domains = Array.from(new Set(session.events.map((event) => safeHostname(event.url)))).filter(Boolean);

  const rows = [
    ['Session ID', meta.sessionId],
    ['Started', meta.startedAt],
    ['Ended', meta.endedAt ?? 'In progress'],
    ['Total events', String(session.events.length)],
    ['Domains', domains.join(', ') || '(none)'],
  ];

  let offsetY = PAGE_MARGIN + 60;
  rows.forEach(([label, value]) => {
    doc.setFont(undefined, 'bold');
    doc.text(`${label}:`, PAGE_MARGIN, offsetY);
    doc.setFont(undefined, 'normal');
    wrapText(doc, value, PAGE_MARGIN + 120, offsetY, 460);
    offsetY += LINE_HEIGHT * Math.ceil(value.length / 80);
  });

  doc.addPage();
}

async function renderEventBlock(doc: any, event: RecorderEvent, startY: number): Promise<number> {
  const left = PAGE_MARGIN;
  let cursorY = startY;

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(`${event.type.toUpperCase()} — ${formatTimestamp(event.timestamp)}`, left, cursorY);
  cursorY += LINE_HEIGHT;

  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  wrapText(doc, `URL: ${event.url}`, left, cursorY, 500);
  cursorY += LINE_HEIGHT * 2;

  if (event.element) {
    const descriptor = buildElementDescription(event);
    wrapText(doc, `Element: ${descriptor}`, left, cursorY, 500);
    cursorY += LINE_HEIGHT * 2;
  }

  if (event.typedText) {
    wrapText(doc, `Typed: ${event.typedText}`, left, cursorY, 500);
    cursorY += LINE_HEIGHT * 2;
  }

  if (event.navigationUrl) {
    wrapText(doc, `Navigation: ${event.navigationUrl}`, left, cursorY, 500);
    cursorY += LINE_HEIGHT * 2;
  }

  if (event.visibilityState) {
    wrapText(doc, `Visibility: ${event.visibilityState}`, left, cursorY, 500);
    cursorY += LINE_HEIGHT * 2;
  }

  if (event.screenshotDataUrl) {
    try {
      const image = await prepareImage(event.screenshotDataUrl);
      const height = (IMAGE_MAX_WIDTH / image.width) * image.height;
      doc.addImage(image.dataUrl, 'JPEG', left, cursorY, IMAGE_MAX_WIDTH, height);
      cursorY += height + LINE_HEIGHT;
    } catch (error) {
      wrapText(doc, `[Image failed to embed: ${(error as Error).message}]`, left, cursorY, 500);
      cursorY += LINE_HEIGHT * 2;
    }
  } else {
    wrapText(doc, '[No screenshot captured]', left, cursorY, 500);
    cursorY += LINE_HEIGHT * 2;
  }

  doc.line(left, cursorY, left + 500, cursorY);
  cursorY += LINE_HEIGHT;
  return cursorY;
}

function wrapText(doc: any, text: string, x: number, y: number, width: number) {
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, x, y);
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function buildElementDescription(event: RecorderEvent): string {
  const { element } = event;
  if (!element) return '(unknown)';
  const parts: string[] = [element.tag];
  if (element.id) parts.push(`#${element.id}`);
  if (element.classes?.length) {
    parts.push(`.${element.classes.join('.')}`);
  }
  if (element.textSnippet) {
    parts.push(`"${element.textSnippet}"`);
  }
  return parts.join(' ');
}

async function prepareImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  try {
    return await loadAndScaleImage(dataUrl);
  } catch (error) {
    if (typeof document === 'undefined') {
      throw error;
    }
    try {
      const { default: html2canvas } = await import('html2canvas');
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-10000px';
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'screenshot';
      container.appendChild(img);
      document.body.appendChild(container);
      try {
        const canvas = await html2canvas(container);
        return {
          dataUrl: canvas.toDataURL('image/jpeg', 0.8),
          width: canvas.width,
          height: canvas.height,
        };
      } finally {
        document.body.removeChild(container);
      }
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
}

function loadAndScaleImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  if (typeof Image === 'undefined') {
    return Promise.reject(new Error('Image API unavailable'));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, IMAGE_MAX_WIDTH / img.width, 1200 / img.width);
      if (scale >= 1) {
        resolve({ dataUrl, width: img.width, height: img.height });
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => reject(new Error('Failed to load screenshot image'));
    img.src = dataUrl;
  });
}

function buildFilename(session: SessionExport): string {
  const timestamp = session.metadata.startedAt
    ? formatDateForFilename(session.metadata.startedAt)
    : formatDateForFilename(new Date().toISOString());
  return `session-${timestamp}.pdf`;
}

function formatDateForFilename(value: string): string {
  const date = new Date(value);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

function checkAbort(signal?: AbortSignal) {
  if (!signal) return;
  if (signal.aborted) {
    throw new Error('PDF generation cancelled');
  }
}

