import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import RecorderRuntime from './RecorderRuntime';
import { RecorderPanel } from '@/ui/RecorderPanel';

let runtimeInstance: RecorderRuntime | null = null;
let reactRoot: Root | null = null;

export async function bootstrapRecorder(): Promise<RecorderRuntime> {
  if (runtimeInstance) {
    return runtimeInstance;
  }

  runtimeInstance = new RecorderRuntime();
  await runtimeInstance.initialize();

  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener(
        'DOMContentLoaded',
        () => resolve(),
        { once: true },
      );
    });
  }

  const container = document.createElement('div');
  container.id = 'browser-recorder-panel';
  container.setAttribute('data-recorder-ui', 'true');
  document.body.appendChild(container);

  reactRoot = createRoot(container);
  reactRoot.render(
    <StrictMode>
      <RecorderPanel runtime={runtimeInstance} />
    </StrictMode>,
  );

  (window as unknown as Record<string, unknown>).browserRecorder = runtimeInstance;

  return runtimeInstance;
}

export function teardownRecorder() {
  runtimeInstance?.destroy();
  runtimeInstance = null;
  reactRoot?.unmount();
  reactRoot = null;
}

