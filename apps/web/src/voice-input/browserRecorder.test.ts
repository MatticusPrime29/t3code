import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { BrowserVoiceRecorder, selectBrowserRecordingMimeType } from "./browserRecorder";

class FakeMediaRecorder {
  static lastStartTimeslice: number | undefined;

  static isTypeSupported(mimeType: string) {
    return mimeType === "audio/webm;codecs=opus";
  }

  readonly mimeType: string;
  state: RecordingState = "inactive";
  private readonly listeners = new Map<string, Array<(event: Event & { data?: Blob }) => void>>();

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "";
  }

  addEventListener(name: string, listener: EventListener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener as (event: Event & { data?: Blob }) => void);
    this.listeners.set(name, listeners);
  }

  start(timeslice?: number) {
    FakeMediaRecorder.lastStartTimeslice = timeslice;
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.emit("dataavailable", { data: new Blob(["audio"], { type: this.mimeType }) });
    this.emit("stop", {});
  }

  private emit(name: string, extra: { data?: Blob }) {
    const event = { type: name, ...extra } as Event & { data?: Blob };
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

afterEach(() => {
  FakeMediaRecorder.lastStartTimeslice = undefined;
  vi.unstubAllGlobals();
});

describe("BrowserVoiceRecorder", () => {
  it("selects Opus WebM when the browser supports it", () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    expect(selectBrowserRecordingMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("records a blob URL, reports completion, and releases microphone tracks", async () => {
    const recordingTrack = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [recordingTrack] });
    const createObjectURL = vi.fn(() => "blob:voice-recording");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("isSecureContext", true);

    const statuses: Array<{ readonly isFinished: boolean; readonly url: string | null }> = [];
    const recorder = new BrowserVoiceRecorder((status) => statuses.push(status));

    await expect(recorder.requestPermission()).resolves.toEqual({
      granted: true,
      canAskAgain: true,
    });
    expect(recordingTrack.stop).not.toHaveBeenCalled();

    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 300 });
    expect(FakeMediaRecorder.lastStartTimeslice).toBe(250);
    await recorder.stop();

    expect(recorder.uri).toBe("blob:voice-recording");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ isFinished: true, url: "blob:voice-recording" });
    await recorder.release();
    expect(recordingTrack.stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();

    recorder.forgetUri("blob:voice-recording");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:voice-recording");
    expect(recorder.uri).toBeNull();
  });
});
