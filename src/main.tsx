import './index.css';
import { bootstrapRecorder } from '@/content/recorder';

bootstrapRecorder().catch((error) => {
  console.error('[Recorder] Failed to bootstrap', error);
});
