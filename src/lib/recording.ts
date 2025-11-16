export interface RecordingOptions {
  videoBitsPerSecond?: number;
  mimeType?: string;
  frameRate?: number;
}

export interface RecordingState {
  isRecording: boolean;
  blob: Blob | null;
  dataUrl: string | null;
  error: string | null;
}

export class ScreenRecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private state: RecordingState = {
    isRecording: false,
    blob: null,
    dataUrl: null,
    error: null,
  };

  async startRecording(options: RecordingOptions = {}): Promise<void> {
    if (this.state.isRecording) {
      throw new Error('Recording is already in progress');
    }

    try {
      // Request screen capture
      const displayMedia = navigator.mediaDevices.getDisplayMedia({
        video: {
          mediaSource: 'screen',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: options.frameRate || 30 },
        } as MediaTrackConstraints,
        audio: true, // Include system audio if available
      });

      this.stream = await displayMedia;

      // Determine best MIME type
      const mimeType =
        options.mimeType ||
        (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : MediaRecorder.isTypeSupported('video/webm')
              ? 'video/webm'
              : 'video/mp4');

      const videoBitsPerSecond = options.videoBitsPerSecond || 2500000; // 2.5 Mbps for high quality

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        videoBitsPerSecond,
      });

      this.chunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        const dataUrl = await this.blobToDataUrl(blob);
        this.state = {
          isRecording: false,
          blob,
          dataUrl,
          error: null,
        };
        this.cleanup();
      };

      this.mediaRecorder.onerror = (event) => {
        const error = (event as ErrorEvent).error?.message || 'Recording error occurred';
        this.state.error = error;
        this.state.isRecording = false;
        this.cleanup();
      };

      this.mediaRecorder.start(1000); // Collect data every second
      this.state.isRecording = true;
      this.state.error = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.error = message;
      this.state.isRecording = false;
      this.cleanup();
      throw error;
    }
  }

  async stopRecording(): Promise<RecordingState> {
    if (!this.state.isRecording || !this.mediaRecorder) {
      throw new Error('No recording in progress');
    }

    return new Promise((resolve) => {
      if (this.mediaRecorder) {
        this.mediaRecorder.onstop = async () => {
          const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'video/webm' });
          const dataUrl = await this.blobToDataUrl(blob);
          this.state = {
            isRecording: false,
            blob,
            dataUrl,
            error: null,
          };
          this.cleanup();
          resolve(this.state);
        };
        this.mediaRecorder.stop();
      } else {
        resolve(this.state);
      }
    });
  }

  getState(): RecordingState {
    return { ...this.state };
  }

  isRecording(): boolean {
    return this.state.isRecording;
  }

  async downloadRecording(filename?: string): Promise<void> {
    if (!this.state.blob) {
      throw new Error('No recording available to download');
    }

    const url = URL.createObjectURL(this.state.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `screen-recording-${Date.now()}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private async blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }
}

