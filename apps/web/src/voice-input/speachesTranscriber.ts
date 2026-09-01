import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

const TRANSCRIPTION_MODEL = "whisper-1";
const TRANSCRIPTION_LANGUAGE = "en";

type Fetch = typeof globalThis.fetch;

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
): VoiceTranscriber {
  return {
    prepare: async ({ signal }) => {
      throwIfVoiceTranscriptionAborted(signal);
      return {
        locale: TRANSCRIPTION_LANGUAGE,
        transcribe: async (uri, { signal: transcriptionSignal }) => {
          try {
            throwIfVoiceTranscriptionAborted(transcriptionSignal);
            const recordingResponse = await fetchImpl(uri, { signal: transcriptionSignal });
            if (!recordingResponse.ok) {
              throw transcriptionError("The browser recording could not be read.");
            }
            const recording = await recordingResponse.blob();
            throwIfVoiceTranscriptionAborted(transcriptionSignal);
            if (recording.size === 0) {
              throw transcriptionError("The browser recording was empty.");
            }

            const contentType = recording.type || "audio/webm";
            const form = new FormData();
            form.append("file", recording, `recording.${recordingExtension(contentType)}`);
            form.append("model", TRANSCRIPTION_MODEL);
            form.append("language", TRANSCRIPTION_LANGUAGE);
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
