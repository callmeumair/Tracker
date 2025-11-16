import RecorderRuntime from '@/content/RecorderRuntime';

jest.mock('@/lib/screenshot', () => {
  return {
    ScreenshotService: class {
      capture() {
        return Promise.resolve({ dataUrl: 'data:image/png;base64,MOCK' });
      }
    },
  };
});

describe('RecorderRuntime', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      writable: true,
      value: undefined,
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('records click events with element metadata', async () => {
    const runtime = new RecorderRuntime();
    await runtime.initialize();
    await runtime.start();

    const button = document.createElement('button');
    button.textContent = 'Test Button';
    document.body.appendChild(button);

    button.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: 100,
        clientY: 150,
      }),
    );

    await flush();
    const events = runtime.getEvents();
    const clickEvent = events.find((event) => event.type === 'click');
    expect(clickEvent).toBeDefined();
    expect(clickEvent?.element?.textSnippet).toContain('Test Button');
    expect(clickEvent?.coords?.x).toBe(100);
    expect(clickEvent?.screenshotDataUrl).toBe('data:image/png;base64,MOCK');

    runtime.destroy();
  });

  it('records navigation events when history changes', async () => {
    const runtime = new RecorderRuntime();
    await runtime.initialize();
    await runtime.start();

    history.pushState({}, '', '/new-route');
    await flush(10);

    const navEvent = runtime.getEvents().find((event) => event.type === 'navigation');
    expect(navEvent).toBeDefined();
    expect(navEvent?.navigationUrl).toContain('/new-route');

    runtime.destroy();
  });
});

function flush(delay = 0) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

