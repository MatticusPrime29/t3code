import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "../config.ts";
import { resolveServerWhisperResourcePaths } from "./ServerWhisperResources.ts";

const WHISPER_READY_TIMEOUT = Duration.minutes(1);
const WHISPER_IDLE_TIMEOUT = Duration.minutes(15);
const WHISPER_TERMINATE_GRACE = Duration.seconds(2);
const VoiceTranscriptionResponse = Schema.Struct({ text: Schema.String });
const decodeVoiceTranscriptionResponse = Schema.decodeUnknownEffect(VoiceTranscriptionResponse);

export interface ServerWhisperTranscriptionInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
}

export class ServerWhisperTranscriptionError extends Data.TaggedError(
  "ServerWhisperTranscriptionError",
)<{
  readonly cause: unknown;
}> {}

interface ActiveWhisperServer {
  readonly endpoint: string;
  readonly port: number;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  readonly generation: number;
  readonly idleFiber: Option.Option<Fiber.Fiber<void>>;
}

export class ServerWhisperServer extends Context.Service<
  ServerWhisperServer,
  {
    readonly prepare: Effect.Effect<Option.Option<string>>;
    readonly transcribe: (
      input: ServerWhisperTranscriptionInput,
    ) => Effect.Effect<Option.Option<string>, ServerWhisperTranscriptionError>;
  }
>()("t3/voice/ServerWhisperServer") {}

const waitForListener = Effect.fn("server.whisper.waitForListener")(function* (
  net: NetService.NetService["Service"],
  port: number,
) {
  return yield* net.hasListenerOnHost(port, "127.0.0.1").pipe(
    Effect.repeat({
      until: (ready) => ready,
      schedule: Schedule.spaced(Duration.millis(100)),
    }),
    Effect.timeoutOption(WHISPER_READY_TIMEOUT),
    Effect.map(Option.getOrElse(() => false)),
  );
});

export const layer = Layer.effect(
  ServerWhisperServer,
  Effect.gen(function* () {
    const parentScope = yield* Scope.Scope;
    const config = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcessPlatform;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const net = yield* NetService.NetService;
    const crypto = yield* Crypto.Crypto;
    const httpClient = yield* HttpClient.HttpClient;
    const resourceContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const active = yield* Ref.make(Option.none<ActiveWhisperServer>());
    const mutex = yield* Semaphore.make(1);
    let generation = 0;

    const stopActive = Effect.fn("server.whisper.stopActive")(function* () {
      const current = yield* Ref.getAndSet(active, Option.none());
      if (Option.isNone(current)) return;
      yield* Option.match(current.value.idleFiber, {
        onNone: () => Effect.void,
        onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
      });
      yield* current.value.handle.kill().pipe(Effect.ignore);
      yield* Effect.logInfo("Stopped server-hosted Whisper.", { port: current.value.port });
    });

    const scheduleIdleStop = Effect.fn("server.whisper.scheduleIdleStop")(function* (
      server: ActiveWhisperServer,
    ) {
      yield* Option.match(server.idleFiber, {
        onNone: () => Effect.void,
        onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
      });
      const idleFiber = yield* Effect.forkIn(
        Effect.sleep(WHISPER_IDLE_TIMEOUT).pipe(
          Effect.andThen(
            mutex.withPermits(1)(
              Effect.gen(function* () {
                const latest = yield* Ref.get(active);
                if (Option.isNone(latest) || latest.value.generation !== server.generation) return;
                yield* Ref.set(active, Option.none());
                yield* latest.value.handle.kill().pipe(Effect.ignore);
                yield* Effect.logInfo("Stopped idle server-hosted Whisper.", {
                  port: latest.value.port,
                });
              }),
            ),
          ),
        ),
        parentScope,
      );
      const refreshed = { ...server, idleFiber: Option.some(idleFiber) };
      yield* Ref.set(active, Option.some(refreshed));
      return refreshed;
    });

    const prepareUnlocked = Effect.fn("server.whisper.prepareUnlocked")(function* () {
      const current = yield* Ref.get(active);
      if (
        Option.isSome(current) &&
        (yield* current.value.handle.isRunning.pipe(Effect.orElseSucceed(() => false)))
      ) {
        return Option.some((yield* scheduleIdleStop(current.value)).endpoint);
      }
      if (Option.isSome(current)) yield* stopActive();

      const resources = yield* resolveServerWhisperResourcePaths(
        config.whisperResourceDir,
        platform,
      ).pipe(Effect.provide(resourceContext));
      if (Option.isNone(resources)) {
        yield* Effect.logWarning("Server-hosted Whisper resources are unavailable.");
        return Option.none<string>();
      }

      const port = yield* net.reserveLoopbackPort("127.0.0.1");
      const requestPath = `/${(yield* crypto.randomUUIDv4).replaceAll("-", "")}`;
      const endpoint = `http://127.0.0.1:${port}${requestPath}/v1/audio/transcriptions`;
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          resources.value.executable,
          [
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            "--model",
            resources.value.model,
            "--request-path",
            requestPath,
            "--inference-path",
            "/v1/audio/transcriptions",
            "--language",
            "auto",
            "--no-timestamps",
          ],
          {
            cwd: config.whisperResourceDir,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            killSignal: "SIGTERM",
            forceKillAfter: WHISPER_TERMINATE_GRACE,
          },
        ),
      );
      generation += 1;
      const server: ActiveWhisperServer = {
        endpoint,
        port,
        handle,
        generation,
        idleFiber: Option.none(),
      };
      yield* Ref.set(active, Option.some(server));
      yield* Effect.logInfo("Starting server-hosted Whisper.", {
        port,
        pid: Number(handle.pid),
      });

      if (!(yield* waitForListener(net, port))) {
        yield* stopActive();
        yield* Effect.logWarning("Server-hosted Whisper did not become ready.", { port });
        return Option.none<string>();
      }

      const refreshed = yield* scheduleIdleStop(server);
      yield* Effect.logInfo("Server-hosted Whisper is ready.", { port });
      return Option.some(refreshed.endpoint);
    });

    const prepare = mutex
      .withPermits(1)(
        prepareUnlocked().pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not prepare server-hosted Whisper.", { cause }).pipe(
              Effect.as(Option.none<string>()),
            ),
          ),
        ),
      )
      .pipe(Scope.provide(parentScope));

    const transcribe = Effect.fn("server.whisper.transcribe")(
      (input: ServerWhisperTranscriptionInput) =>
        Effect.gen(function* () {
          const endpoint = yield* prepare;
          if (Option.isNone(endpoint)) return Option.none<string>();

          const form = new FormData();
          form.append(
            "file",
            new Blob([Uint8Array.from(input.bytes).buffer], { type: input.contentType }),
            input.fileName,
          );
          form.append("model", "whisper-1");
          form.append("language", "auto");
          form.append("response_format", "json");

          const response = yield* httpClient.post(endpoint.value, {
            body: HttpBody.formData(form),
          });
          if (response.status < 200 || response.status >= 300) {
            return yield* new ServerWhisperTranscriptionError({
              cause: `Local Whisper returned HTTP status ${response.status}.`,
            });
          }
          const payload = yield* decodeVoiceTranscriptionResponse(yield* response.json);
          return Option.some(payload.text);
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ServerWhisperTranscriptionError
              ? cause
              : new ServerWhisperTranscriptionError({ cause }),
          ),
        ),
    );

    yield* Effect.addFinalizer(() => mutex.withPermits(1)(stopActive()));
    return ServerWhisperServer.of({ prepare, transcribe });
  }),
);
