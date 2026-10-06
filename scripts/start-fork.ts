// @effect-diagnostics nodeBuiltinImport:off - source launchers must also run before `vp i`.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

/** Build and start this checkout on macOS or Windows after the caller stops its server. */
export function createForkLaunchPlan(
  repoRoot: string,
  options: {
    readonly baseDir?: string | undefined;
    readonly port?: string | undefined;
    readonly noBrowser?: boolean | undefined;
  } = {},
) {
  const port = options.port ?? "13773";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new Error(`Invalid server port: ${port}`);
  }
  return {
    // Always install: an upstream pull can change the lockfile even when node_modules exists.
    preparationCommands: [
      "vp i --frozen-lockfile",
      "vp run --filter @t3tools/web build",
      "vp run --filter t3 build:bundle",
      "vp run stage:server-whisper",
    ],
    whisperResourceDir: NodePath.join(repoRoot, ".t3", "runtime", "whisper"),
    serverArgs: [
      NodePath.join(repoRoot, "apps", "server", "dist", "bin.mjs"),
      "start",
      "--host",
      "0.0.0.0",
      "--port",
      port,
      "--base-dir",
      NodePath.resolve(repoRoot, options.baseDir ?? ".t3"),
      "--auto-bootstrap-project-from-cwd",
      "false",
      "--no-browser",
      String(options.noBrowser ?? false),
    ],
    localUrl: `http://localhost:${port}`,
  };
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      "base-dir": { type: "string" },
      port: { type: "string" },
      "no-browser": { type: "boolean" },
      "prepare-only": { type: "boolean" },
    },
  });
  const repoRoot = NodePath.dirname(import.meta.dirname);
  const plan = createForkLaunchPlan(repoRoot, {
    baseDir: values["base-dir"],
    port: values.port,
    noBrowser: values["no-browser"],
  });
  const env = { ...process.env };
  // Production web and server share an origin, whether opened locally or remotely.
  delete env.VITE_HTTP_URL;
  delete env.VITE_WS_URL;
  delete env.VITE_DEV_SERVER_URL;
  for (const command of plan.preparationCommands) {
    process.stdout.write(`T3 Fork: ${command}\n`);
    const result = NodeChildProcess.spawnSync(command, {
      cwd: repoRoot,
      env,
      shell: true, // Resolves vp's Windows command shim as well as the macOS executable.
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (!values["prepare-only"]) {
    process.stdout.write(`T3 Fork: opening an authenticated session at ${plan.localUrl}\n`);
    const server = NodeChildProcess.spawn(process.execPath, plan.serverArgs, {
      cwd: repoRoot,
      env: { ...env, T3CODE_WHISPER_RESOURCE_DIR: plan.whisperResourceDir },
      stdio: "inherit",
    });
    server.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
    server.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
    // Only forward to the child this launcher spawned.
    process.on("SIGTERM", () => server.kill("SIGTERM"));
    process.on("SIGINT", () => server.kill("SIGINT"));
  }
}
