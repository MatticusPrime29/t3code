import { describe, expect, it, vi } from "vite-plus/test";

import { createEnvironmentWhisperTranscriber } from "./environmentWhisperTranscriber";

const endpoint = "https://environment.example.test/api/voice/transcriptions";

describe("createEnvironmentWhisperTranscriber", () => {
  it("authorizes only the environment upload and sends prepared WAV audio", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["recorded"], { type: "audio/webm" })))
      .mockResolvedValueOnce(Response.json({ text: "server transcript" }));
    const prepareRequest = vi.fn(async () => ({
      headers: { authorization: "Bearer server-token" },
      credentials: "omit" as const,
    }));
    const prepareRecording = vi.fn(async () => new Blob(["wav"], { type: "audio/wav" }));
    const signal = new AbortController().signal;
    const transcriber = createEnvironmentWhisperTranscriber({
      endpoint,
      locale: "en-CA",
      prepareRequest,
      fetchImpl,
      prepareRecording,
    });

    const prepared = await transcriber.prepare({ signal });
    await expect(prepared.transcribe("blob:recording", { signal })).resolves.toBe(
      "server transcript",
    );

    expect(prepared.locale).toBe("en-CA");
    expect(prepareRequest).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("blob:recording");
    const [requestUrl, requestInit] = fetchImpl.mock.calls[1]!;
    expect(requestUrl).toBe(endpoint);
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer server-token");
    expect(requestInit?.credentials).toBe("omit");
    const form = requestInit?.body as FormData;
    expect(form.get("language")).toBe("auto");
    expect((form.get("file") as File).name).toBe("recording.wav");
  });
});
