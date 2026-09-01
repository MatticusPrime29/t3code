import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import {
  stageDesktopWhisper,
  type DesktopWhisperArch,
  type DesktopWhisperPlatform,
} from "./lib/desktop-whisper.ts";

function hostPlatform(platform: NodeJS.Platform): DesktopWhisperPlatform {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return "linux";
}

function hostArchitecture(architecture: NodeJS.Architecture): DesktopWhisperArch {
  if (architecture === "arm64") return "arm64";
  return "x64";
}

const program = Effect.gen(function* () {
  const repoRoot = process.cwd();
  const platform = yield* HostProcessPlatform;
  const architecture = yield* HostProcessArchitecture;
  const stageResourcesDir = `${repoRoot}/.t3/runtime`;
  yield* Effect.logInfo("Staging the server-hosted Whisper runtime...");
  yield* stageDesktopWhisper({
    repoRoot,
    stageResourcesDir,
    platform: hostPlatform(platform),
    arch: hostArchitecture(architecture),
    verbose: true,
  });
  yield* Effect.logInfo(`Whisper runtime ready at ${stageResourcesDir}/whisper`);
});

if (import.meta.main) {
  Effect.scoped(program).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
    NodeRuntime.runMain,
  );
}
