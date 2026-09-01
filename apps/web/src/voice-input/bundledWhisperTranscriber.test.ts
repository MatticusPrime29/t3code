import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createBundledWhisperTranscriber } from "./bundledWhisperTranscriber";

const endpoint = "http://127.0.0.1:43123/private/v1/audio/transcriptions";

describe("createBundledWhisperTranscriber", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the private server and uploads a prepared WAV with language detection", async () => {
    const prepareEndpoint = vi.fn(async () => endpoint);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["recorded"], { type: "audio/webm" })))
      .mockResolvedValueOnce(Response.json({ text: "bonjour" }));
    vi.stubGlobal("fetch", fetchMock);
    const prepareRecording = vi.fn(async () => new Blob(["wav"], { type: "audio/wav" }));
    const signal = new AbortController().signal;
    const transcriber = createBundledWhisperTranscriber({
      prepareEndpoint,
      getLocale: () => "fr-CA",
      prepareRecording,
    });

    const prepared = await transcriber.prepare({ signal });
    await expect(prepared.transcribe("blob:recording", { signal })).resolves.toBe("bonjour");

    expect(prepared.locale).toBe("fr-CA");
    expect(prepareEndpoint).toHaveBeenCalledTimes(2);
    expect(prepareRecording).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[1]!;
    expect(requestUrl).toBe(endpoint);
    const form = requestInit?.body as FormData;
    expect(form.get("language")).toBe("auto");
    expect((form.get("file") as File).name).toBe("recording.wav");
  });

  it("does not upload when bundled resources are unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const transcriber = createBundledWhisperTranscriber({
      prepareEndpoint: async () => null,
      getLocale: () => "en-US",
    });

    await expect(transcriber.prepare({ signal })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
