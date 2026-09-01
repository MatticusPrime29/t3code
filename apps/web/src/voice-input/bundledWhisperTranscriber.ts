import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

import { convertBrowserRecordingToWhisperWav } from "./browserRecordingWav";
import {
  createSpeachesTranscriber,
  resolveSpeachesTranscriptionEndpoint,
} from "./speachesTranscriber";

export function createBundledWhisperTranscriber(input: {
  readonly prepareEndpoint: () => Promise<string | null>;
  readonly getLocale: () => string | null;
  readonly prepareRecording?: (recording: Blob, signal: AbortSignal) => Promise<Blob>;
}): VoiceTranscriber {
  return {
    prepare: async ({ signal }) => {
      throwIfVoiceTranscriptionAborted(signal);
      const bundledEndpoint = resolveSpeachesTranscriptionEndpoint(
        (await input.prepareEndpoint()) ?? undefined,
      );
      throwIfVoiceTranscriptionAborted(signal);
      if (!bundledEndpoint) {
        throw new VoiceTranscriptionError(
          "unavailable",
          "The bundled Whisper service is unavailable.",
        );
      }

      const locale = input.getLocale()?.trim() || "en";
      return {
        locale,
        transcribe: async (uri, options) => {
          throwIfVoiceTranscriptionAborted(options.signal);
          const refreshedEndpoint = resolveSpeachesTranscriptionEndpoint(
            (await input.prepareEndpoint()) ?? undefined,
          );
          throwIfVoiceTranscriptionAborted(options.signal);
          if (!refreshedEndpoint) {
            throw new VoiceTranscriptionError(
              "unavailable",
              "The bundled Whisper service stopped before transcription.",
            );
          }
          const prepared = await createSpeachesTranscriber(refreshedEndpoint, globalThis.fetch, {
            language: "auto",
            locale,
            prepareRecording: input.prepareRecording ?? convertBrowserRecordingToWhisperWav,
          }).prepare(options);
          return prepared.transcribe(uri, options);
        },
      };
    },
  };
}
