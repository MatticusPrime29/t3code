import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

export const SERVER_WHISPER_MODEL_FILE = "ggml-base.bin";

export interface ServerWhisperResourcePaths {
  readonly executable: string;
  readonly model: string;
}

export function serverWhisperExecutableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "whisper-server.exe" : "whisper-server";
}

export const resolveServerWhisperResourcePaths = Effect.fn("server.whisper.resolveResourcePaths")(
  function* (resourceDir: string | undefined, platform: NodeJS.Platform) {
    if (!resourceDir?.trim()) return Option.none<ServerWhisperResourcePaths>();

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.resolve(resourceDir);
    const resources = {
      executable: path.join(directory, serverWhisperExecutableName(platform)),
      model: path.join(directory, SERVER_WHISPER_MODEL_FILE),
    };
    const [executableExists, modelExists] = yield* Effect.all(
      [fileSystem.exists(resources.executable), fileSystem.exists(resources.model)],
      { concurrency: "unbounded" },
    );
    return executableExists && modelExists
      ? Option.some(resources)
      : Option.none<ServerWhisperResourcePaths>();
  },
);
