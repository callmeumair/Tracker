import { generatePDFReport } from '@/lib/pdf';
import type { SessionExport } from '@/lib/types';

const mockText = jest.fn();
const mockSave = jest.fn();
const mockAddImage = jest.fn();
const mockSplit = jest.fn((text: string) => [text]);
const mockSetFont = jest.fn();
const mockSetFontSize = jest.fn();
const mockAddPage = jest.fn();
const mockLine = jest.fn();

jest.mock('jspdf', () => {
  return {
    jsPDF: jest.fn().mockImplementation(() => ({
      text: mockText,
      save: mockSave,
      addImage: mockAddImage,
      splitTextToSize: mockSplit,
      setFont: mockSetFont,
      setFontSize: mockSetFontSize,
      addPage: mockAddPage,
      line: mockLine,
      internal: { pageSize: { getHeight: () => 792 } },
    })),
  };
});

describe('generatePDFReport', () => {
  beforeAll(() => {
    class FakeImage {
      width = 320;
      height = 180;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    }

    Object.defineProperty(globalThis, 'Image', {
      writable: true,
      value: FakeImage,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves a pdf that references typed text and screenshots', async () => {
    const session: SessionExport = {
      metadata: {
        sessionId: 'demo',
        startedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
        endedAt: new Date('2024-01-01T00:05:00Z').toISOString(),
      },
      events: [
        {
          id: '1',
          sessionId: 'demo',
          type: 'input_commit',
          timestamp: new Date('2024-01-01T00:01:00Z').toISOString(),
          url: 'https://example.com',
          element: {
            tag: 'input',
            id: 'search',
            classes: ['field'],
            textSnippet: 'Search',
            selector: '#search',
          },
          typedText: 'youtube cats',
          screenshotDataUrl: 'data:image/png;base64,AAA',
          meta: { browser: 'Jest', userAgent: 'Jest' },
        },
      ],
    };

    await generatePDFReport(session, {
      onProgress: jest.fn(),
    });

    expect(mockSave).toHaveBeenCalled();
    const textCalls = mockText.mock.calls.flat().join(' ');
    expect(textCalls).toContain('Typed: youtube cats');
    expect(mockAddImage).toHaveBeenCalled();
  });
});

