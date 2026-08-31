import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createTrelloEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const settings = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:trello:settings",
    tag: WS_METHODS.trelloGetSettings,
    staleTimeMs: 15_000,
  });
  const cards = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:trello:cards",
    tag: WS_METHODS.trelloListCards,
    staleTimeMs: 15_000,
  });
  return {
    settings,
    boards: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:trello:boards",
      tag: WS_METHODS.trelloListBoards,
      staleTimeMs: 30_000,
    }),
    boardLists: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:trello:board-lists",
      tag: WS_METHODS.trelloListBoardLists,
      staleTimeMs: 30_000,
    }),
    cards,
    threadCard: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:trello:thread-card",
      tag: WS_METHODS.trelloGetThreadCard,
      staleTimeMs: 10_000,
    }),
    cardContext: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:trello:card-context",
      tag: WS_METHODS.trelloGetCardContext,
      staleTimeMs: 10_000,
    }),
    readCardContext: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:read-card-context",
      tag: WS_METHODS.trelloGetCardContext,
    }),
    saveCredentials: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:save-credentials",
      tag: WS_METHODS.trelloSaveCredentials,
    }),
    clearCredentials: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:clear-credentials",
      tag: WS_METHODS.trelloClearCredentials,
    }),
    upsertBoard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:upsert-board",
      tag: WS_METHODS.trelloUpsertBoard,
    }),
    deleteBoard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:delete-board",
      tag: WS_METHODS.trelloDeleteBoard,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:link-thread",
      tag: WS_METHODS.trelloLinkThread,
    }),
    prepareAttachments: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trello:prepare-attachments",
      tag: WS_METHODS.trelloPrepareAttachments,
    }),
  };
}
