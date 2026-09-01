import type { PreparedEnvironmentVoiceRequest } from "@t3tools/client-runtime/voice-input";
import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

import { convertBrowserRecordingToWhisperWav } from "./browserRecordingWav";
import { createSpeachesTranscriber } from "./speachesTranscriber";

export function createEnvironmentWhisperTranscriber(input: {
  readonly endpoint: string;
  readonly locale: string;
  readonly prepareRequest: () => Promise<PreparedEnvironmentVoiceRequest>;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly prepareRecording?: (recording: Blob, signal: AbortSignal) => Promise<Blob>;
}): VoiceTranscriber {
  const baseFetch = input.fetchImpl ?? globalThis.fetch;
  const authenticatedFetch: typeof globalThis.fetch = async (request, init) => {
    const requestUrl =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;
    if (requestUrl !== input.endpoint) return baseFetch(request, init);

    const prepared = await input.prepareRequest();
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(prepared.headers)) headers.set(name, value);
    return baseFetch(request, { ...init, headers, credentials: prepared.credentials });
  };

  return createSpeachesTranscriber(input.endpoint, authenticatedFetch, {
    language: "auto",
    locale: input.locale,
    prepareRecording: input.prepareRecording ?? convertBrowserRecordingToWhisperWav,
  });
}
