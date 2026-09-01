import { describe, expect, it } from "vite-plus/test";
import type { RepositoryIdentity } from "@t3tools/contracts";

import {
  buildMergeOriginalPrompt,
  validateConfiguredOriginalRepository,
} from "./originalRepository";

const identity = (remoteUrl: string): RepositoryIdentity => ({
  canonicalKey: "github.com/fork/t3code",
  locator: { source: "git-remote", remoteName: "origin", remoteUrl },
});

describe("validateConfiguredOriginalRepository", () => {
  it("accepts another owner on the same host with the same repository name", () => {
    expect(
      validateConfiguredOriginalRepository(
        identity("git@github.com:fork/t3code.git"),
        "https://github.com/original/t3code",
      ),
    ).toEqual({
      ok: true,
      repository: {
        remoteName: "upstream",
        remoteUrl: "https://github.com/original/t3code",
        source: "configured",
      },
    });
  });

  it("rejects the same repository and incompatible coordinates", () => {
    expect(
      validateConfiguredOriginalRepository(
        identity("git@github.com:fork/t3code.git"),
        "https://github.com/fork/t3code",
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateConfiguredOriginalRepository(
        identity("git@github.com:fork/t3code.git"),
        "https://gitlab.com/original/t3code",
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateConfiguredOriginalRepository(
        identity("git@github.com:fork/t3code.git"),
        "https://github.com/original/another-project",
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("buildMergeOriginalPrompt", () => {
  it("keeps commit and push behind review", () => {
    const prompt = buildMergeOriginalPrompt({
      remoteName: "upstream",
      remoteUrl: "git@github.com:original/t3code.git",
      source: "detected",
    });
    expect(prompt).toContain("resolve any merge conflicts");
    expect(prompt).toContain("Do not commit or push anything");
  });
});
