import { describe, expect, it } from "vite-plus/test";

import {
  desktopWhisperExecutableName,
  resolveDesktopWhisperCmakeArchitecture,
} from "./desktop-whisper.ts";

describe("desktop Whisper build inputs", () => {
  it("resolves platform executable names", () => {
    expect(desktopWhisperExecutableName("mac")).toBe("whisper-server");
    expect(desktopWhisperExecutableName("linux")).toBe("whisper-server");
    expect(desktopWhisperExecutableName("win")).toBe("whisper-server.exe");
  });

  it("configures native and universal macOS architectures", () => {
    expect(resolveDesktopWhisperCmakeArchitecture("mac", "arm64")).toBe("arm64");
    expect(resolveDesktopWhisperCmakeArchitecture("mac", "x64")).toBe("x86_64");
    expect(resolveDesktopWhisperCmakeArchitecture("mac", "universal")).toBe("arm64;x86_64");
    expect(resolveDesktopWhisperCmakeArchitecture("linux", "x64")).toBeUndefined();
  });
});
