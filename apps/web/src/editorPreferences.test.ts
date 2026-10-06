import { describe, expect, it } from "vite-plus/test";

import { resolvePreferredEditor } from "./editorPreferences";

describe("preferred editor", () => {
  it("defaults to PhpStorm when installed alongside other editors", () => {
    expect(resolvePreferredEditor(["cursor", "vscode", "phpstorm", "file-manager"], null)).toBe(
      "phpstorm",
    );
  });

  it("honors an explicitly selected editor", () => {
    expect(resolvePreferredEditor(["vscode", "phpstorm"], "vscode")).toBe("vscode");
  });

  it("recovers from an editor that is no longer installed", () => {
    expect(resolvePreferredEditor(["phpstorm", "file-manager"], "cursor")).toBe("phpstorm");
  });

  it("uses the normal fallback when PhpStorm is unavailable", () => {
    expect(resolvePreferredEditor(["file-manager", "vscode"], null)).toBe("vscode");
    expect(resolvePreferredEditor([], null)).toBeNull();
  });
});
