import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import whisperManifestJson from "../../native/whisper/manifest.json" with { type: "json" };

const WhisperManifest = Schema.Struct({
  buildRevision: Schema.Int,
  sourceVersion: Schema.String,
  sourceUrl: Schema.String,
  sourceSha256: Schema.String,
  modelFileName: Schema.String,
  modelUrl: Schema.String,
  modelSha256: Schema.String,
  modelLicenseUrl: Schema.String,
  modelLicenseSha256: Schema.String,
});

const whisperManifest = Schema.decodeUnknownSync(WhisperManifest)(whisperManifestJson);

export type DesktopWhisperPlatform = "mac" | "linux" | "win";
export type DesktopWhisperArch = "arm64" | "x64" | "universal";

export const DESKTOP_WHISPER_RESOURCE_DIRECTORY = "whisper";
export const DESKTOP_WHISPER_LICENSE_FILE = "LICENSE.whisper.cpp";
export const DESKTOP_WHISPER_MODEL_LICENSE_FILE = "LICENSE.whisper-model";

export function desktopWhisperExecutableName(platform: DesktopWhisperPlatform): string {
  return platform === "win" ? "whisper-server.exe" : "whisper-server";
}

export function resolveDesktopWhisperCmakeArchitecture(
  platform: DesktopWhisperPlatform,
  arch: DesktopWhisperArch,
): string | undefined {
  if (platform !== "mac") return undefined;
  if (arch === "universal") return "arm64;x86_64";
  return arch === "arm64" ? "arm64" : "x86_64";
}

export class DesktopWhisperDownloadError extends Schema.TaggedErrorClass<DesktopWhisperDownloadError>()(
  "DesktopWhisperDownloadError",
  {
    url: Schema.String,
    destination: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to download the bundled Whisper input from ${this.url}.`;
  }
}

export class DesktopWhisperChecksumError extends Schema.TaggedErrorClass<DesktopWhisperChecksumError>()(
  "DesktopWhisperChecksumError",
  {
    filePath: Schema.String,
    expected: Schema.String,
    actual: Schema.String,
  },
) {
  override get message(): string {
    return `Bundled Whisper input ${this.filePath} has SHA-256 ${this.actual}; expected ${this.expected}.`;
  }
}

export class DesktopWhisperBuildOutputMissingError extends Schema.TaggedErrorClass<DesktopWhisperBuildOutputMissingError>()(
  "DesktopWhisperBuildOutputMissingError",
  {
    executablePath: Schema.String,
    platform: Schema.String,
    arch: Schema.String,
  },
) {
  override get message(): string {
    return `whisper.cpp did not produce ${this.executablePath} for ${this.platform}/${this.arch}.`;
  }
}

export class DesktopWhisperBuildCommandError extends Schema.TaggedErrorClass<DesktopWhisperBuildCommandError>()(
  "DesktopWhisperBuildCommandError",
  {
    command: Schema.String,
    exitCode: Schema.Int,
  },
) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}.`;
  }
}

const verifyFile = Effect.fn("desktopWhisper.verifyFile")(function* (
  filePath: string,
  expectedSha256: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const bytes = yield* fs
    .readFile(filePath)
    .pipe(
      Effect.mapError(
        (cause) => new DesktopWhisperDownloadError({ url: filePath, destination: filePath, cause }),
      ),
    );
  const actual = yield* crypto.digest("SHA-256", bytes).pipe(
    Effect.map(Encoding.encodeHex),
    Effect.mapError(
      (cause) => new DesktopWhisperDownloadError({ url: filePath, destination: filePath, cause }),
    ),
  );
  if (actual !== expectedSha256) {
    return yield* new DesktopWhisperChecksumError({
      filePath,
      expected: expectedSha256,
      actual,
    });
  }
});

const ensureVerifiedDownload = Effect.fn("desktopWhisper.ensureVerifiedDownload")(
  function* (input: {
    readonly url: string;
    readonly sha256: string;
    readonly destination: string;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    if (yield* fs.exists(input.destination)) {
      const valid = yield* verifyFile(input.destination, input.sha256).pipe(
        Effect.as(true),
        Effect.catchTag("DesktopWhisperChecksumError", () => Effect.succeed(false)),
      );
      if (valid) return;
      yield* fs.remove(input.destination, { force: true });
    }

    yield* fs.makeDirectory(path.dirname(input.destination), { recursive: true });
    const response = yield* httpClient
      .pipe(HttpClient.followRedirects(5))
      .execute(HttpClientRequest.get(input.url))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.mapError(
          (cause) =>
            new DesktopWhisperDownloadError({
              url: input.url,
              destination: input.destination,
              cause,
            }),
        ),
      );
    const bytes = new Uint8Array(
      yield* response.arrayBuffer.pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWhisperDownloadError({
              url: input.url,
              destination: input.destination,
              cause,
            }),
        ),
      ),
    );
    const temporaryPath = `${input.destination}.download`;
    yield* fs.writeFile(temporaryPath, bytes);
    yield* verifyFile(temporaryPath, input.sha256).pipe(
      Effect.tapError(() => fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
    );
    yield* fs.rename(temporaryPath, input.destination);
  },
);

const runWhisperBuildCommand = Effect.fn("desktopWhisper.runBuildCommand")(function* (
  command: ChildProcess.Command,
  label: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new DesktopWhisperBuildCommandError({ command: label, exitCode });
  }
});

function whisperBuildOutputCandidates(
  buildDirectory: string,
  platform: DesktopWhisperPlatform,
  path: Path.Path,
): readonly string[] {
  const executableName = desktopWhisperExecutableName(platform);
  return [
    path.join(buildDirectory, "bin", executableName),
    path.join(buildDirectory, "bin", "Release", executableName),
  ];
}

export const stageDesktopWhisper = Effect.fn("stageDesktopWhisper")(function* (input: {
  readonly repoRoot: string;
  readonly stageResourcesDir: string;
  readonly platform: DesktopWhisperPlatform;
  readonly arch: DesktopWhisperArch;
  readonly verbose: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const targetRoot = path.join(input.repoRoot, "native/whisper/target");
  const archivePath = path.join(
    targetRoot,
    "downloads",
    `whisper.cpp-${whisperManifest.sourceVersion}.tar.gz`,
  );
  const sourceDirectoryName = `whisper.cpp-${whisperManifest.sourceVersion.replace(/^v/u, "")}`;
  const sourceDirectory = path.join(targetRoot, sourceDirectoryName);
  const buildDirectory = path.join(
    targetRoot,
    `build-r${whisperManifest.buildRevision}-${input.platform}-${input.arch}`,
  );
  const modelPath = path.join(targetRoot, "models", whisperManifest.modelFileName);
  const modelLicensePath = path.join(targetRoot, "licenses", "openai-whisper-LICENSE");

  yield* ensureVerifiedDownload({
    url: whisperManifest.sourceUrl,
    sha256: whisperManifest.sourceSha256,
    destination: archivePath,
  });
  yield* ensureVerifiedDownload({
    url: whisperManifest.modelUrl,
    sha256: whisperManifest.modelSha256,
    destination: modelPath,
  });
  yield* ensureVerifiedDownload({
    url: whisperManifest.modelLicenseUrl,
    sha256: whisperManifest.modelLicenseSha256,
    destination: modelLicensePath,
  });

  const sourceReady =
    (yield* fs.exists(path.join(sourceDirectory, "CMakeLists.txt"))) &&
    (yield* fs.exists(path.join(sourceDirectory, "LICENSE")));
  if (!sourceReady) {
    yield* fs.remove(sourceDirectory, { recursive: true, force: true }).pipe(Effect.ignore);
    yield* fs.makeDirectory(targetRoot, { recursive: true });
    yield* runWhisperBuildCommand(
      ChildProcess.make("cmake", ["-E", "tar", "xzf", archivePath], {
        cwd: targetRoot,
        stdout: input.verbose ? "inherit" : "ignore",
        stderr: input.verbose ? "inherit" : "ignore",
      }),
      "cmake -E tar xzf whisper.cpp",
    );
  }

  const outputCandidates = whisperBuildOutputCandidates(buildDirectory, input.platform, path);
  let executablePath: string | undefined;
  for (const candidate of outputCandidates) {
    if (yield* fs.exists(candidate)) {
      executablePath = candidate;
      break;
    }
  }
  if (!executablePath) {
    const configureArgs = [
      "-S",
      sourceDirectory,
      "-B",
      buildDirectory,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_EXAMPLES=ON",
      "-DWHISPER_BUILD_SERVER=ON",
      // Release artifacts must run across the target architecture, not only
      // on the particular CPU model used by the CI runner.
      "-DGGML_NATIVE=OFF",
      // Whisper's Accelerate backend calls an API introduced in macOS 13.3,
      // while T3 Code supports 13.0. Metal remains enabled for acceleration.
      ...(input.platform === "mac" ? ["-DGGML_BLAS=OFF"] : []),
    ];
    const cmakeArchitecture = resolveDesktopWhisperCmakeArchitecture(input.platform, input.arch);
    if (cmakeArchitecture) {
      configureArgs.push(`-DCMAKE_OSX_ARCHITECTURES=${cmakeArchitecture}`);
      configureArgs.push("-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0");
      configureArgs.push("-DGGML_METAL=ON");
      configureArgs.push("-DGGML_METAL_EMBED_LIBRARY=ON");
    }
    if (input.platform === "win") {
      configureArgs.push("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
    }

    yield* runWhisperBuildCommand(
      ChildProcess.make("cmake", configureArgs, {
        stdout: input.verbose ? "inherit" : "ignore",
        stderr: input.verbose ? "inherit" : "ignore",
      }),
      "cmake configure whisper.cpp",
    );
    yield* runWhisperBuildCommand(
      ChildProcess.make(
        "cmake",
        [
          "--build",
          buildDirectory,
          "--config",
          "Release",
          "--target",
          "whisper-server",
          "--parallel",
        ],
        {
          stdout: input.verbose ? "inherit" : "ignore",
          stderr: input.verbose ? "inherit" : "ignore",
        },
      ),
      "cmake build whisper-server",
    );
    for (const candidate of outputCandidates) {
      if (yield* fs.exists(candidate)) {
        executablePath = candidate;
        break;
      }
    }
  }

  if (!executablePath) {
    return yield* new DesktopWhisperBuildOutputMissingError({
      executablePath: outputCandidates.join(" or "),
      platform: input.platform,
      arch: input.arch,
    });
  }

  const destinationDirectory = path.join(
    input.stageResourcesDir,
    DESKTOP_WHISPER_RESOURCE_DIRECTORY,
  );
  yield* fs.remove(destinationDirectory, { recursive: true, force: true }).pipe(Effect.ignore);
  yield* fs.makeDirectory(destinationDirectory, { recursive: true });
  const destinationExecutable = path.join(
    destinationDirectory,
    desktopWhisperExecutableName(input.platform),
  );
  yield* fs.copyFile(executablePath, destinationExecutable);
  yield* fs.copyFile(modelPath, path.join(destinationDirectory, whisperManifest.modelFileName));
  yield* fs.copyFile(
    path.join(sourceDirectory, "LICENSE"),
    path.join(destinationDirectory, DESKTOP_WHISPER_LICENSE_FILE),
  );
  yield* fs.copyFile(
    modelLicensePath,
    path.join(destinationDirectory, DESKTOP_WHISPER_MODEL_LICENSE_FILE),
  );
  if (input.platform !== "win") {
    yield* fs.chmod(destinationExecutable, 0o755);
  }
});

export const DESKTOP_WHISPER_MODEL_FILE = whisperManifest.modelFileName;
