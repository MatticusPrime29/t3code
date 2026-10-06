// @effect-diagnostics nodeBuiltinImport:off - tests the pre-install Node launcher without runtime dependencies.
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createForkLaunchPlan } from "./start-fork.ts";

describe("source fork launcher", () => {
  it("opens a local authenticated browser session and stages voice resources", () => {
    const root = NodePath.resolve("fork checkout");
    const plan = createForkLaunchPlan(root);
    expect(plan.localUrl).toBe("http://localhost:13773");
    expect(plan.serverArgs.slice(1)).toEqual([
      "start",
      "--host",
      "0.0.0.0",
      "--port",
      "13773",
      "--base-dir",
      NodePath.join(root, ".t3"),
      "--auto-bootstrap-project-from-cwd",
      "false",
      "--no-browser",
      "false",
    ]);
    expect(plan.whisperResourceDir).toBe(NodePath.join(root, ".t3", "runtime", "whisper"));
    expect(plan.preparationCommands).toContain("vp i --frozen-lockfile");
    expect(plan.preparationCommands).toContain("vp run stage:server-whisper");
  });

  it("preserves a caller's production data directory and port", () => {
    const root = NodePath.resolve("fork checkout");
    const baseDir = NodePath.resolve("production state");
    const plan = createForkLaunchPlan(root, { baseDir, port: "4312", noBrowser: true });
    expect(plan.serverArgs).toContain(baseDir);
    expect(plan.serverArgs).toContain("4312");
    expect(plan.serverArgs.slice(-2)).toEqual(["--no-browser", "true"]);
    expect(plan.localUrl).toBe("http://localhost:4312");
  });

  it("rejects invalid ports before installing or starting anything", () => {
    expect(() => createForkLaunchPlan("/fork", { port: "0" })).toThrow("Invalid server port");
    expect(() => createForkLaunchPlan("/fork", { port: "65536" })).toThrow("Invalid server port");
    expect(() => createForkLaunchPlan("/fork", { port: "13773/path" })).toThrow(
      "Invalid server port",
    );
  });
});
