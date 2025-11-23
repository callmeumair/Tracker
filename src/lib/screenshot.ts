import type { ScreenshotResult, PortMessage } from './types';

const chromeApi = typeof window === 'undefined' ? undefined : window.chrome;

interface ScreenshotOptions {
  allow?: boolean;
  reason?: string;
}

type PortGetter = () => chrome.runtime.Port | null;

export class ScreenshotService {
  private lastCaptureTime = 0;
  private minInterval: number;
  private pendingPromise: Promise<ScreenshotResult> | null = null;
  private portGetter: PortGetter | null;
  private screenshotCallbacks = new Map<string, {
    resolve: (result: ScreenshotResult) => void;
    reject: (error: Error) => void;
  }>();

  constructor(minInterval = 700, portGetter?: PortGetter) {
    this.minInterval = minInterval;
    this.portGetter = portGetter || null;
    
    // Set up port message listener for screenshot responses
    if (portGetter && chromeApi?.runtime) {
      // We need to listen to port messages - this will be set up by the caller
      this.setupPortListener();
    }
  }

  private setupPortListener(): void {
    // The port listener is already set up in RecorderRuntime
    // We'll handle screenshot responses through a callback mechanism
  }

  handleScreenshotResponse(requestId: string, dataUrl: string | null, error?: string): void {
    const callback = this.screenshotCallbacks.get(requestId);
    if (callback) {
      this.screenshotCallbacks.delete(requestId);
      
      if (error) {
        callback.resolve({ dataUrl: null, error });
      } else {
        callback.resolve({ dataUrl });
      }
    }
  }

  async capture(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    if (options.allow === false) {
      return { dataUrl: null };
    }

    const now = Date.now();
    const elapsed = now - this.lastCaptureTime;

    if (elapsed >= this.minInterval && !this.pendingPromise) {
      return this.performCapture(options.reason);
    }

    if (!this.pendingPromise) {
      const delay = Math.max(0, this.minInterval - elapsed);
      this.pendingPromise = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            const result = await this.performCapture(options.reason);
            resolve(result);
          } catch (error) {
            resolve({
              dataUrl: null,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            this.pendingPromise = null;
          }
        }, delay);
      });
    }

    return this.pendingPromise;
  }

  private async performCapture(reason?: string): Promise<ScreenshotResult> {
    this.lastCaptureTime = Date.now();
    
    // Try port-based capture first (preferred for multi-tab support)
    if (this.portGetter) {
      try {
        const portResult = await this.tryPortCapture(reason);
        if (portResult) {
          return portResult;
        }
      } catch (error) {
        console.warn('[Recorder] Port capture failed, falling back', error);
      }
    }
    
    // Try extension sendMessage capture
    try {
      const extensionResult = await this.tryExtensionCapture();
      if (extensionResult) {
        return { dataUrl: extensionResult };
      }
    } catch (error) {
      console.warn('[Recorder] Extension capture failed', error);
    }

    // Final fallback to html2canvas
    try {
      const canvasResult = await this.captureWithHtml2Canvas(reason);
      return { dataUrl: canvasResult };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Recorder] html2canvas capture failed', message);
      return {
        dataUrl: null,
        error: message,
      };
    }
  }

  private async tryPortCapture(reason?: string): Promise<ScreenshotResult | null> {
    if (!this.portGetter) return null;
    
    const port = this.portGetter();
    if (!port) return null;

    const requestId = crypto.randomUUID();
    
    return new Promise<ScreenshotResult>((resolve, reject) => {
      // Set timeout in case response never comes
      const timeout = setTimeout(() => {
        this.screenshotCallbacks.delete(requestId);
        reject(new Error('Screenshot request timeout'));
      }, 10000);
      
      // Store callback
      this.screenshotCallbacks.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      
      // Set up one-time listener for this specific response
      const messageListener = (message: PortMessage) => {
        if (message.type === 'screenshot:response' && message.requestId === requestId) {
          port.onMessage.removeListener(messageListener);
          this.handleScreenshotResponse(message.requestId, message.dataUrl, message.error);
        }
      };
      
      port.onMessage.addListener(messageListener);
      
      // Send request
      try {
        port.postMessage({
          type: 'screenshot:request',
          requestId,
          reason: reason || 'capture',
        } as PortMessage);
      } catch (error) {
        clearTimeout(timeout);
        this.screenshotCallbacks.delete(requestId);
        port.onMessage.removeListener(messageListener);
        reject(error);
      }
    });
  }

  private async tryExtensionCapture(): Promise<string | null> {
    if (!chromeApi?.runtime) {
      return null;
    }

    try {
      const response = await new Promise<{ dataUrl?: string } | null>((resolve, reject) => {
        chromeApi.runtime.sendMessage({ type: 'RECORDER_CAPTURE_TAB', format: 'png' }, (result) => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError) {
            reject(lastError);
            return;
          }
          resolve(result);
        });
      });
      return response?.dataUrl ?? null;
    } catch (error) {
      console.warn('[Recorder] chrome.runtime screenshot failed', error);
      return null;
    }
  }

  private async captureWithHtml2Canvas(reason?: string): Promise<string> {
    if (typeof window === 'undefined') {
      throw new Error('Screenshot unavailable in this environment');
    }

    const { default: html2canvas } = await import('html2canvas');
    const target = document.body;
    const scale = Math.min(2, window.devicePixelRatio || 1); // Higher quality with device pixel ratio
    const canvas = await html2canvas(target, {
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      scale: scale,
      useCORS: true,
      allowTaint: false,
      removeContainer: true,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: 15000,
      onclone: (doc) => {
        doc.body.setAttribute('data-recorder-snapshot', reason ?? 'snapshot');
        // Hide recorder UI in screenshot
        const recorderUI = doc.querySelector('[data-recorder-ui="true"]');
        if (recorderUI) {
          (recorderUI as HTMLElement).style.display = 'none';
        }
      },
    });
    // Use PNG for better quality, or high-quality JPEG
    return canvas.toDataURL('image/png');
  }
}

