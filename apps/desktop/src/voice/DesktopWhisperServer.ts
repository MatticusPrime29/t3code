import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NetService from "@t3tools/shared/Net";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

const WHISPER_MODEL_FILE = "ggml-base.bin";
const WHISPER_READY_TIMEOUT = Duration.minutes(1);
const WHISPER_IDLE_TIMEOUT = Duration.minutes(15);
const WHISPER_TERMINATE_GRACE = Duration.seconds(2);

interface ActiveWhisperServer {
  readonly endpoint: string;
  readonly port: number;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  readonly generation: number;
  readonly idleFiber: Option.Option<Fiber.Fiber<void>>;
}

export class DesktopWhisperServer extends Context.Service<
  DesktopWhisperServer,
  {
    /** Starts or refreshes the bundled loopback server and returns its private endpoint. */
    readonly prepare: Effect.Effect<Option.Option<string>>;
  }
>()("@t3tools/desktop/voice/DesktopWhisperServer") {}

const { logInfo: logWhisperInfo, logWarning: logWhisperWarning } =
  makeComponentLogger("desktop-whisper");

function whisperExecutableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "whisper-server.exe" : "whisper-server";
}

const waitForListener = Effect.fn("desktop.whisper.waitForListener")(function* (
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
  DesktopWhisperServer,
  Effect.gen(function* () {
    const parentScope = yield* Scope.Scope;
    const assets = yield* DesktopAssets.DesktopAssets;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const net = yield* NetService.NetService;
    const crypto = yield* Crypto.Crypto;
    const active = yield* Ref.make(Option.none<ActiveWhisperServer>());
    const mutex = yield* Semaphore.make(1);
    let generation = 0;

    const stopActive = Effect.fn("desktop.whisper.stopActive")(function* () {
      const current = yield* Ref.getAndSet(active, Option.none());
      if (Option.isNone(current)) return;
      yield* Option.match(current.value.idleFiber, {
        onNone: () => Effect.void,
        onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
      });
      yield* current.value.handle.kill().pipe(Effect.ignore);
      yield* logWhisperInfo("stopped bundled transcription server", {
        port: current.value.port,
      });
    });

    const scheduleIdleStop = Effect.fn("desktop.whisper.scheduleIdleStop")(function* (
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
                yield* logWhisperInfo("stopped idle bundled transcription server", {
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

    const prepareUnlocked = Effect.fn("desktop.whisper.prepareUnlocked")(function* () {
      const current = yield* Ref.get(active);
      if (
        Option.isSome(current) &&
        (yield* current.value.handle.isRunning.pipe(Effect.orElseSucceed(() => false)))
      ) {
        const refreshed = yield* scheduleIdleStop(current.value);
        return Option.some(refreshed.endpoint);
      }
      if (Option.isSome(current)) {
        yield* stopActive();
      }

      const executable = yield* assets.resolveResourcePath(
        environment.path.join("whisper", whisperExecutableName(environment.platform)),
      );
      const model = yield* assets.resolveResourcePath(
        environment.path.join("whisper", WHISPER_MODEL_FILE),
      );
      if (Option.isNone(executable) || Option.isNone(model)) {
        yield* logWhisperWarning("bundled transcription resources are unavailable");
        return Option.none<string>();
      }

      const port = yield* net.reserveLoopbackPort("127.0.0.1");
      const requestToken = (yield* crypto.randomUUIDv4).replaceAll("-", "");
      const requestPath = `/${requestToken}`;
      const endpoint = `http://127.0.0.1:${port}${requestPath}/v1/audio/transcriptions`;
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          executable.value,
          [
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            "--model",
            model.value,
            "--request-path",
            requestPath,
            "--inference-path",
            "/v1/audio/transcriptions",
            "--language",
            "auto",
            "--no-timestamps",
          ],
          {
            cwd: environment.path.dirname(model.value),
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
      yield* logWhisperInfo("starting bundled transcription server", {
        port,
        pid: Number(handle.pid),
      });

      if (!(yield* waitForListener(net, port))) {
        yield* stopActive();
        yield* logWhisperWarning("bundled transcription server did not become ready", { port });
        return Option.none<string>();
      }

      const refreshed = yield* scheduleIdleStop(server);
      yield* logWhisperInfo("bundled transcription server ready", { port });
      return Option.some(refreshed.endpoint);
    });

    const prepare = mutex
      .withPermits(1)(
        prepareUnlocked().pipe(
          Effect.catchCause((cause) =>
            logWhisperWarning("could not prepare bundled transcription server", { cause }).pipe(
              Effect.as(Option.none<string>()),
            ),
          ),
        ),
      )
      .pipe(Scope.provide(parentScope));

    yield* Effect.addFinalizer(() => mutex.withPermits(1)(stopActive()));
    return DesktopWhisperServer.of({ prepare });
  }),
);
