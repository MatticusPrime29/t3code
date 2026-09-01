import { describe, expect, it, vi } from "vite-plus/test";

import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";

import {
  createSpeachesTranscriber,
  resolveSpeachesTranscriptionEndpoint,
} from "./speachesTranscriber";

const endpoint = "https://desktop.example.ts.net:8443/v1/audio/transcriptions";

async function transcribeWith(fetchImpl: typeof fetch, signal = new AbortController().signal) {
  const prepared = await createSpeachesTranscriber(endpoint, fetchImpl).prepare({ signal });
  return prepared.transcribe("blob:recording", { signal });
}

describe("resolveSpeachesTranscriptionEndpoint", () => {
  it("accepts HTTPS and loopback HTTP endpoints", () => {
    expect(resolveSpeachesTranscriptionEndpoint(` ${endpoint} `)).toBe(endpoint);
    expect(
      resolveSpeachesTranscriptionEndpoint("http://127.0.0.1:8000/v1/audio/transcriptions"),
    ).toBe("http://127.0.0.1:8000/v1/audio/transcriptions");
  });

  it("rejects missing, malformed, and non-loopback insecure endpoints", () => {
    expect(resolveSpeachesTranscriptionEndpoint(undefined)).toBeNull();
    expect(resolveSpeachesTranscriptionEndpoint("not a URL")).toBeNull();
    expect(resolveSpeachesTranscriptionEndpoint("http://example.com/transcribe")).toBeNull();
  });
});

describe("createSpeachesTranscriber", () => {
  it("uploads the recording with the OpenAI-compatible multipart contract", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["audio"], { type: "audio/webm;codecs=opus" })))
      .mockResolvedValueOnce(Response.json({ text: "Transcribed speech" }));

    await expect(transcribeWith(fetchImpl)).resolves.toBe("Transcribed speech");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [requestUrl, requestInit] = fetchImpl.mock.calls[1]!;
    expect(requestUrl).toBe(endpoint);
    expect(requestInit?.method).toBe("POST");
    const form = requestInit?.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).name).toBe("recording.webm");
  });

  it("rejects non-success and malformed responses without exposing response bodies", async () => {
    const failedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["audio"], { type: "audio/webm" })))
      .mockResolvedValueOnce(new Response("private upstream detail", { status: 503 }));
    await expect(transcribeWith(failedFetch)).rejects.toMatchObject({
      name: "VoiceTranscriptionError",
      message: "Voice transcription failed with HTTP 503.",
    });

    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["audio"], { type: "audio/webm" })))
      .mockResolvedValueOnce(Response.json({ transcript: "wrong field" }));
    await expect(transcribeWith(malformedFetch)).rejects.toMatchObject({
      name: "VoiceTranscriptionError",
      message: "Voice transcription returned an invalid response.",
    });
  });

  it("aborts recording reads and transcription uploads", async () => {
    const abortController = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      abortController.abort();
      init?.signal?.throwIfAborted();
      return new Response();
    });

    await expect(transcribeWith(fetchImpl, abortController.signal)).rejects.toBeInstanceOf(
      VoiceTranscriptionError,
    );
  });
});
