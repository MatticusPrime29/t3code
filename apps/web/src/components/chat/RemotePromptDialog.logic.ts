import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
} from "../../providerInstances";
import { stripInlineTerminalContextPlaceholders } from "../../lib/terminalContext";

export interface RemotePromptModelOption {
  readonly key: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly selection: ModelSelection;
  readonly isDefault: boolean;
}

export function normalizeRemotePrompt(prompt: string): string | null {
  const normalized = stripInlineTerminalContextPlaceholders(prompt).trim();
  return normalized.length > 0 ? normalized : null;
}

export function remotePromptModelKey(selection: ModelSelection): string {
  return JSON.stringify([selection.instanceId, selection.model]);
}

export function buildRemotePromptModelOptions(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<RemotePromptModelOption> {
  return deriveProviderInstanceEntries(providers)
    .filter(isProviderInstancePickerReady)
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.isLegacy !== true)
        .map((model) => ({
          key: remotePromptModelKey({ instanceId: provider.instanceId, model: model.slug }),
          label: model.name,
          providerLabel: provider.displayName,
          selection: { instanceId: provider.instanceId, model: model.slug },
          isDefault: model.isDefault === true,
        })),
    );
}

export function resolveRemotePromptModelSelection(
  options: ReadonlyArray<RemotePromptModelOption>,
  projectDefault: ModelSelection | null | undefined,
): ModelSelection | null {
  if (projectDefault) {
    const matchingDefault = options.find(
      (option) => remotePromptModelKey(option.selection) === remotePromptModelKey(projectDefault),
    );
    if (matchingDefault) return matchingDefault.selection;
  }
  return options.find((option) => option.isDefault)?.selection ?? options[0]?.selection ?? null;
}
