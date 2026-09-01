import type { VoiceRecorder, VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

const RECORDING_TIMESLICE_MS = 250;

export function browserVoiceRecordingAvailable(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    globalThis.isSecureContext !== false
  );
}

export function selectBrowserRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function microphonePermissionCanBeRetried(error: unknown): boolean {
  if (!(error instanceof DOMException)) return true;
  return error.name !== "NotAllowedError" && error.name !== "SecurityError";
}

export class BrowserVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;

  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(private readonly onStatus: (status: VoiceRecorderStatus) => void) {}

  async requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    if (!browserVoiceRecordingAvailable()) {
      return { granted: false, canAskAgain: false };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      return { granted: true, canAskAgain: true };
    } catch (error) {
      return { granted: false, canAskAgain: microphonePermissionCanBeRetried(error) };
    }
  }

  async prepareToRecordAsync(): Promise<void> {
    this.stream ??= await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.chunks = [];
    const mimeType = selectBrowserRecordingMimeType();
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.mediaRecorder = recorder;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      this.onStatus({
        isFinished: false,
        hasError: true,
        error: "The browser stopped recording unexpectedly.",
        url: this.uri,
      });
    });
    recorder.addEventListener("stop", () => {
      if (this.finishTimer !== null) {
        clearTimeout(this.finishTimer);
        this.finishTimer = null;
      }
      const recording = new Blob(this.chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      if (recording.size > 0) {
        this.uri = URL.createObjectURL(recording);
      }
      this.resolveStop?.();
      this.resolveStop = null;
      this.stopPromise = null;
      this.onStatus({
        isFinished: recording.size > 0,
        hasError: recording.size === 0,
        error: recording.size === 0 ? "The browser recording was empty." : null,
        url: this.uri,
      });
    });
  }

  record({ forDuration }: { readonly forDuration: number }): void {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state !== "inactive") {
      throw new Error("Browser voice recorder is not prepared.");
    }
    // Periodic chunks avoid near-empty short recordings in Chromium. In particular,
    // relying only on stop() to flush WebM can leave little more than its header.
    recorder.start(RECORDING_TIMESLICE_MS);
    this.finishTimer = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, forDuration * 1_000);
  }

  stop(): Promise<void> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    if (this.stopPromise) return this.stopPromise;
    const stopPromise = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
    this.stopPromise = stopPromise;
    recorder.stop();
    return stopPromise;
  }

  async release(): Promise<void> {
    if (this.finishTimer !== null) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }

  forgetUri(uri: string): void {
    URL.revokeObjectURL(uri);
    if (this.uri === uri) this.uri = null;
  }
}
