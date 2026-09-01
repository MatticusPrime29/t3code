import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import {
  buildRemotePromptModelOptions,
  normalizeRemotePrompt,
  resolveRemotePromptModelSelection,
} from "./RemotePromptDialog.logic";

function provider(
  instanceId: string,
  models: Array<{ slug: string; name: string; isDefault?: boolean; isLegacy?: boolean }>,
  overrides: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName: instanceId,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    version: null,
    models: models.map((model) => ({
      ...model,
      isCustom: false,
      capabilities: null,
    })),
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("remote prompt model options", () => {
  it("removes inline terminal context placeholders before dispatch", () => {
    expect(normalizeRemotePrompt("  inspect \uFFFC this  ")).toBe("inspect  this");
    expect(normalizeRemotePrompt("\uFFFC  ")).toBeNull();
  });

  it("keeps ready configured instances and omits legacy models", () => {
    const options = buildRemotePromptModelOptions([
      provider("codex", [
        { slug: "gpt-5", name: "GPT-5", isDefault: true },
        { slug: "gpt-4", name: "GPT-4", isLegacy: true },
      ]),
      provider("disabled", [{ slug: "other", name: "Other" }], { enabled: false }),
    ]);

    expect(options.map((option) => option.selection.model)).toEqual(["gpt-5"]);
  });

  it("prefers the project's valid default, then the provider default", () => {
    const options = buildRemotePromptModelOptions([
      provider("codex", [
        { slug: "gpt-5", name: "GPT-5", isDefault: true },
        { slug: "gpt-5-mini", name: "GPT-5 mini" },
      ]),
    ]);

    expect(
      resolveRemotePromptModelSelection(options, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-mini",
      })?.model,
    ).toBe("gpt-5-mini");
    expect(resolveRemotePromptModelSelection(options, null)?.model).toBe("gpt-5");
  });
});
