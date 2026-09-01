import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as NetService from "@t3tools/shared/Net";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopWhisperServer from "./DesktopWhisperServer.ts";

function environmentLayer(resourcesPath: string) {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory: "/Users/alice",
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
    isPackaged: true,
    resourcesPath,
    runningUnderArm64Translation: false,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))));
}

describe("DesktopWhisperServer", () => {
  it.effect("starts one private loopback server and reuses it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const resourcesPath = "/Applications/T3 Code.app/Contents/Resources";
        const environment = environmentLayer(resourcesPath);
        const fileSystem = FileSystem.layerNoop({
          exists: (path) => Effect.succeed(String(path).startsWith(`${resourcesPath}/whisper/`)),
        });
        const assets = DesktopAssets.layer.pipe(
          Layer.provide(Layer.merge(environment, fileSystem)),
        );
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
        const whisperLayer = DesktopWhisperServer.layer.pipe(
          Layer.provideMerge(assets),
          Layer.provideMerge(environment),
          Layer.provideMerge(spawner),
          Layer.provideMerge(net),
          Layer.provideMerge(NodeServices.layer),
        );
        const whisper = yield* DesktopWhisperServer.DesktopWhisperServer.pipe(
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
        assert.equal(spawnedCommand.command, `${resourcesPath}/whisper/whisper-server`);
        assert.includeMembers(
          [...spawnedCommand.args],
          [
            "--host",
            "127.0.0.1",
            "--port",
            "43123",
            "--model",
            `${resourcesPath}/whisper/ggml-base.bin`,
            "--language",
            "auto",
          ],
        );
        assert.equal(spawnedCommand.options.stdout, "ignore");
        assert.equal(spawnedCommand.options.stderr, "ignore");
        assert.equal(killCount, 0);
      }),
    ),
  );
});
