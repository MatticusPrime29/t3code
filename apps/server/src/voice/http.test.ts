import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";

import { handleVoiceTranscriptionRequest } from "../http.ts";
import { ServerWhisperServer } from "./ServerWhisperServer.ts";

const TranscriptionResponse = Schema.Struct({ text: Schema.String });
const decodeTranscriptionResponse = Schema.decodeUnknownEffect(
  Schema.fromJsonString(TranscriptionResponse),
);

it.effect("proxies one bounded browser recording to the local Whisper service", () =>
  Effect.gen(function* () {
    const routes = HttpRouter.add(
      "POST",
      "/voice-test",
      handleVoiceTranscriptionRequest().pipe(
        Effect.provideService(
          ServerWhisperServer,
          ServerWhisperServer.of({
            prepare: Effect.succeed(Option.some("http://127.0.0.1/unused")),
            transcribe: ({ bytes, contentType, fileName }) =>
              Effect.sync(() => {
                expect(new TextDecoder().decode(bytes)).toBe("wav");
                expect(contentType).toBe("audio/wav");
                expect(fileName).toBe("recording.wav");
                return Option.some("local transcript");
              }),
          }),
        ),
      ),
    );
    yield* routes.pipe(HttpRouter.serve, Layer.build);

    const client = yield* HttpClient.HttpClient;
    const form = new FormData();
    form.append("file", new Blob(["wav"], { type: "audio/wav" }), "recording.wav");
    const response = yield* client.post("/voice-test", { body: HttpBody.formData(form) });

    const responseBody = yield* response.text;
    if (response.status !== 200) throw new Error(responseBody);
    expect(yield* decodeTranscriptionResponse(responseBody)).toEqual({ text: "local transcript" });
  }).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("rejects a transcription request without exactly one file", () =>
  Effect.gen(function* () {
    yield* HttpRouter.add(
      "POST",
      "/voice-test",
      handleVoiceTranscriptionRequest().pipe(
        Effect.provideService(
          ServerWhisperServer,
          ServerWhisperServer.of({
            prepare: Effect.succeed(Option.none()),
            transcribe: () => Effect.succeed(Option.none()),
          }),
        ),
      ),
    ).pipe(HttpRouter.serve, Layer.build);
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.post("/voice-test", {
      body: HttpBody.formData(new FormData()),
    });
    expect(response.status).toBe(400);
  }).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
