import { describe, expect, it } from "vite-plus/test";

import {
  SERVER_BROWSER_OPERATIONS,
  __testing,
  resolveServerBrowserUrl,
  serverBrowserViewport,
} from "./ServerBrowserHost.ts";

describe("server browser navigation", () => {
  it("resolves environment ports beside the server instead of the web client", () => {
    expect(
      resolveServerBrowserUrl({
        target: {
          kind: "environment-port",
          port: 5173,
          protocol: "https",
          path: "settings?tab=browser",
        },
      }),
    ).toBe("https://localhost:5173/settings?tab=browser");
  });

  it("normalizes public and schemeless URLs", () => {
    expect(resolveServerBrowserUrl({ url: "example.com" })).toBe("https://example.com/");
    expect(resolveServerBrowserUrl({ url: "localhost:4173" })).toBe("http://localhost:4173/");
  });
});

describe("server browser capabilities", () => {
  it("advertises the complete inspect and interaction surface without recordings", () => {
    expect(SERVER_BROWSER_OPERATIONS).toEqual([
      "status",
      "open",
      "navigate",
      "snapshot",
      "click",
      "type",
      "press",
      "scroll",
      "evaluate",
      "waitFor",
      "resize",
      "setColorScheme",
    ]);
  });

  it("uses a stable viewport for a headless fill panel", () => {
    expect(serverBrowserViewport({ _tag: "fill" })).toEqual({ width: 1280, height: 800 });
    expect(serverBrowserViewport({ _tag: "freeform", width: 1024, height: 768 })).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("resolves named device viewport inputs through the shared catalog", () => {
    expect(
      __testing.requestedViewport({
        mode: "preset",
        preset: "iphone-12-pro",
        orientation: "landscape",
      }),
    ).toMatchObject({
      _tag: "preset",
      width: 844,
      height: 390,
      presetId: "iphone-12-pro",
    });
  });
});
