import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  voiceInputFreezesEditor,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrowserVoiceRecorder, browserVoiceRecordingAvailable } from "./browserRecorder";
import { createSpeachesTranscriber } from "./speachesTranscriber";

const INITIAL_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

export function useBrowserVoiceInput(input: {
  readonly endpoint: string | null;
  readonly ownerKey: string;
  readonly draftMessage: string;
  readonly selection: { readonly start: number; readonly end: number };
  readonly disabled: boolean;
  readonly onCommitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => void;
}) {
  const [state, setState] = useState<VoiceInputState>(INITIAL_STATE);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const transcriber = useMemo(
    () => (input.endpoint ? createSpeachesTranscriber(input.endpoint) : null),
    [input.endpoint],
  );
  const previousDraftRef = useRef({ ownerKey: input.ownerKey, text: input.draftMessage });
  const revisionRef = useRef(0);
  if (
    previousDraftRef.current.ownerKey !== input.ownerKey ||
    previousDraftRef.current.text !== input.draftMessage
  ) {
    previousDraftRef.current = { ownerKey: input.ownerKey, text: input.draftMessage };
    revisionRef.current += 1;
  }

  const latestInputRef = useRef({ ...input, transcriber });
  latestInputRef.current = { ...input, transcriber };
  const controllerRef = useRef<VoiceInputController | null>(null);
  const recorderRef = useRef<BrowserVoiceRecorder | null>(null);
  if (!recorderRef.current) {
    recorderRef.current = new BrowserVoiceRecorder((status) => {
      controllerRef.current?.handleRecorderStatus(status);
    });
  }
  const recorder = recorderRef.current;

  if (!controllerRef.current) {
    controllerRef.current = new VoiceInputController({
      recorder,
      getTranscriber: () => latestInputRef.current.transcriber,
      requestPermission: () => recorder.requestPermission(),
      configureRecording: () => Promise.resolve(),
      releaseRecording: () => recorder.release(),
      deleteRecording: (uri) => recorder.forgetUri(uri),
      readDraft: (): VoiceDraftSnapshot => {
        const current = latestInputRef.current;
        return {
          ownerKey: current.ownerKey,
          text: current.draftMessage,
          selection: current.selection,
          revision: revisionRef.current,
        };
      },
      commitDraft: (text, selection) => latestInputRef.current.onCommitDraft(text, selection),
      onStateChange: setState,
    });
  }
  const controller = controllerRef.current;

  const previousOwnerRef = useRef(input.ownerKey);
  useEffect(() => {
    if (previousOwnerRef.current === input.ownerKey) return;
    previousOwnerRef.current = input.ownerKey;
    controller.ownerChanged();
  }, [controller, input.ownerKey]);

  useEffect(() => {
    const interruptWhenHidden = () => {
      if (document.visibilityState === "hidden") controller.appMovedToBackground();
    };
    window.addEventListener("pagehide", interruptWhenHidden);
    document.addEventListener("visibilitychange", interruptWhenHidden);
    return () => {
      window.removeEventListener("pagehide", interruptWhenHidden);
      document.removeEventListener("visibilitychange", interruptWhenHidden);
    };
  }, [controller]);

  useEffect(
    () => () => {
      controller.dispose();
      void recorder.release();
    },
    [controller, recorder],
  );

  useEffect(() => {
    if (state.phase !== "recording") {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = performance.now();
    const update = () => setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1_000));
    const intervalId = window.setInterval(update, 250);
    return () => window.clearInterval(intervalId);
  }, [state.phase]);

  const start = useCallback(() => {
    if (!latestInputRef.current.disabled) void controller.start();
  }, [controller]);
  const stop = useCallback(() => void controller.stop(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return {
    isAvailable: transcriber !== null && browserVoiceRecordingAvailable(),
    state,
    elapsedSeconds,
    blocksSubmission: voiceInputBlocksSubmission(state),
    freezesEditor: voiceInputFreezesEditor(state),
    start,
    stop,
    cancel,
  };
}
