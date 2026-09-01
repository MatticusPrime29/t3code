import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as NetService from "@t3tools/shared/Net";

import * as ServerConfig from "../config.ts";
import * as ServerWhisperServer from "./ServerWhisperServer.ts";

describe("ServerWhisperServer", () => {
  it.effect("starts one private loopback server and reuses it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseConfig = yield* ServerConfig.ServerConfig;
        const resourceDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-server-whisper-test-",
        });
        yield* fileSystem.writeFileString(`${resourceDir}/whisper-server`, "binary");
        yield* fileSystem.writeFileString(`${resourceDir}/ggml-base.bin`, "model");

        let spawnedCommand: ChildProcess.Command | undefined;
        let killCount = 0;
        const spawner = Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            spawnedCommand = command;
            return Effect.succeed(
              ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(42),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                isRunning: Effect.succeed(true),
                kill: () => Effect.sync(() => void (killCount += 1)),
                unref: Effect.succeed(Effect.void),
                stdin: Sink.drain,
                stdout: Stream.empty,
                stderr: Stream.empty,
                all: Stream.empty,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
              }),
            );
          }),
        );
        const net = Layer.succeed(
          NetService.NetService,
          NetService.NetService.of({
            canListenOnHost: () => Effect.succeed(true),
            isPortAvailableOnLoopback: () => Effect.succeed(true),
            hasListenerOnHost: () => Effect.succeed(true),
            reserveLoopbackPort: () => Effect.succeed(43_123),
            findAvailablePort: () => Effect.succeed(43_123),
          }),
        );
        const whisperLayer = ServerWhisperServer.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layer({ ...baseConfig, whisperResourceDir: resourceDir }),
          ),
          Layer.provideMerge(spawner),
          Layer.provideMerge(net),
          Layer.provideMerge(FetchHttpClient.layer),
          Layer.provideMerge(NodeServices.layer),
        );
        const whisper = yield* ServerWhisperServer.ServerWhisperServer.pipe(
          Effect.provide(whisperLayer),
        );

        const first = yield* whisper.prepare;
        const second = yield* whisper.prepare;

        assert.isTrue(first._tag === "Some");
        assert.deepEqual(second, first);
        assert.isDefined(spawnedCommand);
        if (spawnedCommand._tag !== "StandardCommand") {
          throw new Error("Expected whisper.cpp to spawn a standard command.");
        }
        assert.equal(spawnedCommand.command, `${resourceDir}/whisper-server`);
        assert.includeMembers(
          [...spawnedCommand.args],
          [
            "--host",
            "127.0.0.1",
            "--port",
            "43123",
            "--model",
            `${resourceDir}/ggml-base.bin`,
            "--language",
            "auto",
          ],
        );
        assert.equal(killCount, 0);
      }),
    ).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-server-test-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});
