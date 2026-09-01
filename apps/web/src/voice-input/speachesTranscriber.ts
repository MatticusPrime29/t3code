import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

const TRANSCRIPTION_MODEL = "whisper-1";
const TRANSCRIPTION_LANGUAGE = "en";

type Fetch = typeof globalThis.fetch;

export interface SpeachesTranscriberOptions {
  readonly language?: string;
  readonly locale?: string;
  readonly prepareRecording?: (recording: Blob, signal: AbortSignal) => Promise<Blob>;
}

function recordingExtension(contentType: string): string {
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

function transcriptionError(message: string, cause?: unknown): VoiceTranscriptionError {
  return new VoiceTranscriptionError(
    "transcription-failed",
    message,
    cause === undefined ? undefined : { cause },
  );
}

export function resolveSpeachesTranscriptionEndpoint(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const isLoopbackHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
    if (url.protocol !== "https:" && !isLoopbackHttp) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function createSpeachesTranscriber(
  endpoint: string,
  fetchImpl: Fetch = globalThis.fetch,
  options: SpeachesTranscriberOptions = {},
): VoiceTranscriber {
  const language = options.language ?? TRANSCRIPTION_LANGUAGE;
  return {
    prepare: async ({ signal }) => {
      throwIfVoiceTranscriptionAborted(signal);
      return {
        locale: options.locale ?? language,
        transcribe: async (uri, { signal: transcriptionSignal }) => {
          try {
            throwIfVoiceTranscriptionAborted(transcriptionSignal);
            const recordingResponse = await fetchImpl(uri, { signal: transcriptionSignal });
            if (!recordingResponse.ok) {
              throw transcriptionError("The browser recording could not be read.");
            }
            let recording = await recordingResponse.blob();
            throwIfVoiceTranscriptionAborted(transcriptionSignal);
            if (recording.size === 0) {
              throw transcriptionError("The browser recording was empty.");
            }
            if (options.prepareRecording) {
              recording = await options.prepareRecording(recording, transcriptionSignal);
              throwIfVoiceTranscriptionAborted(transcriptionSignal);
            }

            const contentType = recording.type || "audio/webm";
            const form = new FormData();
            form.append("file", recording, `recording.${recordingExtension(contentType)}`);
            form.append("model", TRANSCRIPTION_MODEL);
            form.append("language", language);
            form.append("response_format", "json");

            const response = await fetchImpl(endpoint, {
              method: "POST",
              body: form,
              signal: transcriptionSignal,
            });
            if (!response.ok) {
              throw transcriptionError(`Voice transcription failed with HTTP ${response.status}.`);
            }

            const payload: unknown = await response.json();
            if (
              typeof payload !== "object" ||
              payload === null ||
              !("text" in payload) ||
              typeof payload.text !== "string"
            ) {
              throw transcriptionError("Voice transcription returned an invalid response.");
            }
            return payload.text;
          } catch (error) {
            throwIfVoiceTranscriptionAborted(transcriptionSignal);
            if (error instanceof VoiceTranscriptionError) throw error;
            throw transcriptionError("Voice transcription failed.", error);
          }
        },
      };
    },
  };
}
