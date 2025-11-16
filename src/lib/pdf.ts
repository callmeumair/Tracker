import type { PdfProgress, RecorderEvent, SessionExport } from './types';

interface PdfOptions {
  onProgress?: (progress: PdfProgress) => void;
  signal?: AbortSignal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsPDFDocument = any;

const PAGE_MARGIN = 40;
const LINE_HEIGHT = 18; // Increased for better readability
const IMAGE_MAX_WIDTH = 500; // Slightly larger for better visibility
const TITLE_FONT_SIZE = 24;
const HEADING_FONT_SIZE = 16;
const BODY_FONT_SIZE = 11;
const LABEL_FONT_SIZE = 10;

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

function addTitlePage(doc: JsPDFDocument, session: SessionExport) {
  // Title with better spacing
  doc.setFontSize(TITLE_FONT_SIZE);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0); // Black for better contrast
  doc.text('Browser Screen Recorder Session', PAGE_MARGIN, PAGE_MARGIN + 30);
  
  // Subtitle
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(60, 60, 60); // Dark gray
  doc.text('Session Report', PAGE_MARGIN, PAGE_MARGIN + 50);
  
  // Metadata section
  doc.setFontSize(BODY_FONT_SIZE);
  const meta = session.metadata;
  const domains = Array.from(new Set(session.events.map((event) => safeHostname(event.url)))).filter(Boolean);

  const rows = [
    ['Session ID', meta.sessionId],
    ['Started', formatTimestamp(meta.startedAt)],
    ['Ended', meta.endedAt ? formatTimestamp(meta.endedAt) : 'In progress'],
    ['Total events', String(session.events.length)],
    ['Domains', domains.join(', ') || '(none)'],
  ];

  let offsetY = PAGE_MARGIN + 90;
  rows.forEach(([label, value]) => {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(LABEL_FONT_SIZE);
    doc.setTextColor(0, 0, 0);
    doc.text(`${label}:`, PAGE_MARGIN, offsetY);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(40, 40, 40);
    wrapText(doc, value, PAGE_MARGIN + 140, offsetY, 420);
    offsetY += LINE_HEIGHT * Math.max(1, Math.ceil(value.length / 70)) + 4; // Better spacing
  });

  doc.addPage();
}

async function renderEventBlock(doc: JsPDFDocument, event: RecorderEvent, startY: number): Promise<number> {
  const left = PAGE_MARGIN;
  let cursorY = startY;

  // Event type header with better styling
  doc.setFontSize(HEADING_FONT_SIZE);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0);
  const eventHeader = `${event.type.toUpperCase()} — ${formatTimestamp(event.timestamp)}`;
  doc.text(eventHeader, left, cursorY);
  cursorY += LINE_HEIGHT + 4;

  // URL with label
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('URL:', left, cursorY);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(30, 30, 30);
  wrapText(doc, event.url, left + 40, cursorY, 450);
  cursorY += LINE_HEIGHT * 2 + 2;

  if (event.element) {
    const descriptor = buildElementDescription(event);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Element:', left, cursorY);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 30, 30);
    wrapText(doc, descriptor, left + 60, cursorY, 430);
    cursorY += LINE_HEIGHT * 2 + 2;
  }

  if (event.typedText) {
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Typed:', left, cursorY);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 80, 150); // Blue for typed text to make it stand out
    wrapText(doc, event.typedText, left + 50, cursorY, 440);
    cursorY += LINE_HEIGHT * 2 + 2;
  }

  if (event.navigationUrl) {
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Navigation:', left, cursorY);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 30, 30);
    wrapText(doc, event.navigationUrl, left + 80, cursorY, 410);
    cursorY += LINE_HEIGHT * 2 + 2;
  }

  if (event.visibilityState) {
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Visibility:', left, cursorY);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(event.visibilityState, left + 80, cursorY);
    cursorY += LINE_HEIGHT * 2 + 2;
  }

  if (event.screenshotDataUrl) {
    try {
      const image = await prepareImage(event.screenshotDataUrl);
      const height = (IMAGE_MAX_WIDTH / image.width) * image.height;
      // Support PNG format for better quality
      const format = event.screenshotDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(image.dataUrl, format, left, cursorY, IMAGE_MAX_WIDTH, height);
      cursorY += height + LINE_HEIGHT + 4;
    } catch (error) {
      doc.setFont(undefined, 'normal');
      doc.setTextColor(200, 0, 0); // Red for errors
      wrapText(doc, `[Image failed to embed: ${(error as Error).message}]`, left, cursorY, 500);
      cursorY += LINE_HEIGHT * 2;
    }
  } else {
    doc.setFont(undefined, 'normal');
    doc.setTextColor(120, 120, 120); // Gray for missing data
    wrapText(doc, '[No screenshot captured]', left, cursorY, 500);
    cursorY += LINE_HEIGHT * 2;
  }

  doc.line(left, cursorY, left + 500, cursorY);
  cursorY += LINE_HEIGHT;
  return cursorY;
}

function wrapText(doc: JsPDFDocument, text: string, x: number, y: number, width: number) {
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
  }
}

function loadAndScaleImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  if (typeof Image === 'undefined') {
    return Promise.reject(new Error('Image API unavailable'));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Preserve original quality, only scale if too large
      const maxWidth = 1200; // Higher max width for better quality
      const scale = Math.min(1, IMAGE_MAX_WIDTH / img.width, maxWidth / img.width);
      if (scale >= 1) {
        // Keep original format (PNG or JPEG)
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
      // Use high-quality rendering
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Preserve original format - use PNG if original was PNG, otherwise high-quality JPEG
      const isPNG = dataUrl.startsWith('data:image/png');
      const outputDataUrl = isPNG
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.95); // Higher quality JPEG
      
      resolve({
        dataUrl: outputDataUrl,
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

