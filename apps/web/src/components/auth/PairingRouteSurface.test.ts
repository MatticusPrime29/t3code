import { describe, expect, it } from "vite-plus/test";

import { describeSupportedMethods } from "./PairingRouteSurface";

describe("describeSupportedMethods", () => {
  it("explains how to obtain a one-time token", () => {
    expect(describeSupportedMethods(["one-time-token"])).toContain("npx t3 pair");
    expect(describeSupportedMethods(["one-time-token"])).toContain("full pairing link");
  });
});
