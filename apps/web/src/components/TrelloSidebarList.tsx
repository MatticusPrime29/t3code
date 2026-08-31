import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ScopedThreadRef,
  TrelloCardListItem,
  TrelloId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { TrelloIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { trelloEnvironment } from "../state/trello";
import { useAtomCommand } from "../state/use-atom-command";
import { formatInitialTrelloPrompt, trelloPreparedFiles } from "../trelloContext";
import { Badge } from "./ui/badge";
import { toastManager } from "./ui/toast";

interface TrelloSidebarListProps {
  readonly environmentId: EnvironmentId;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly onNavigateToThread: (threadRef: ScopedThreadRef) => void;
}

export function TrelloSidebarList(props: TrelloSidebarListProps) {
  const projects = useProjects();
  const startThread = useNewThreadHandler();
  const cardsAtom = trelloEnvironment.cards({
    environmentId: props.environmentId,
    input: {},
  });
  const cardsQuery = useEnvironmentQuery(cardsAtom);
  const readCardContext = useAtomCommand(trelloEnvironment.readCardContext, {
    reportFailure: false,
  });
  const linkThread = useAtomCommand(trelloEnvironment.linkThread, { reportFailure: false });
  const prepareAttachments = useAtomCommand(trelloEnvironment.prepareAttachments, {
    reportFailure: false,
  });
  const [openingCardId, setOpeningCardId] = useState<TrelloId | null>(null);

  const visibleCards = useMemo(
    () =>
      (cardsQuery.data ?? []).filter(
        (card) =>
          props.scopedProjectKeys === null ||
          props.scopedProjectKeys.has(`${props.environmentId}:${card.projectId}`),
      ),
    [cardsQuery.data, props.environmentId, props.scopedProjectKeys],
  );
  const cardsByBoard = useMemo(() => {
    const grouped = new Map<string, TrelloCardListItem[]>();
    for (const card of visibleCards) {
      const cards = grouped.get(card.boardId) ?? [];
      cards.push(card);
      grouped.set(card.boardId, cards);
    }
    return [...grouped.values()];
  }, [visibleCards]);

  const openCard = async (card: TrelloCardListItem) => {
    const existingThreadId = card.threadIds[0];
    if (existingThreadId) {
      props.onNavigateToThread(scopeThreadRef(props.environmentId, existingThreadId));
      return;
    }
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === props.environmentId && candidate.id === card.projectId,
    );
    if (!project) {
      toastManager.add({ type: "error", title: "The associated T3 project no longer exists" });
      return;
    }

    setOpeningCardId(card.id);
    try {
      const contextResult = await readCardContext({
        environmentId: props.environmentId,
        input: { cardId: card.id },
      });
      if (!AsyncResult.isSuccess(contextResult)) {
        toastManager.add({ type: "error", title: "Could not read the Trello card" });
        return;
      }
      const draft = await startThread(scopeProjectRef(props.environmentId, project.id));
      if (!draft) return;
      const linkResult = await linkThread({
        environmentId: props.environmentId,
        input: { cardId: card.id, threadId: draft.threadId },
      });
      if (!AsyncResult.isSuccess(linkResult)) {
        toastManager.add({ type: "error", title: "Could not link the Trello card to the chat" });
        return;
      }
      appAtomRegistry.refresh(
        trelloEnvironment.threadCard({
          environmentId: props.environmentId,
          input: { threadId: draft.threadId },
        }),
      );

      const store = useComposerDraftStore.getState();
      store.setPrompt(draft.draftId, formatInitialTrelloPrompt(contextResult.value));
      if (contextResult.value.attachments.length > 0) {
        const attachmentResult = await prepareAttachments({
          environmentId: props.environmentId,
          input: {
            cardId: card.id,
            attachmentIds: contextResult.value.attachments.map((attachment) => attachment.id),
          },
        });
        if (AsyncResult.isSuccess(attachmentResult)) {
          store.addFiles(
            draft.draftId,
            trelloPreparedFiles(props.environmentId, attachmentResult.value),
          );
        } else {
          toastManager.add({
            type: "warning",
            title: "The Trello card opened without its attachments",
          });
        }
      }
      appAtomRegistry.refresh(cardsAtom);
    } finally {
      setOpeningCardId(null);
    }
  };

  if (cardsQuery.isPending) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        Loading Trello cards…
      </div>
    );
  }
  if (cardsQuery.error) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        Trello is unavailable. Check its credentials and boards in Settings.
      </div>
    );
  }
  if (visibleCards.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No Trello cards in this project scope.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {cardsByBoard.map((cards) => {
        const first = cards[0]!;
        const project = projects.find(
          (candidate) =>
            candidate.environmentId === props.environmentId && candidate.id === first.projectId,
        );
        return (
          <section key={first.boardId}>
            <div className="mb-1 flex items-center gap-1.5 px-2.5 text-xs font-medium text-sidebar-muted-foreground">
              <TrelloIcon className="size-3.5 shrink-0 text-[#0c66e4]" />
              <span className="min-w-0 flex-1 truncate">{first.boardName}</span>
              <span className="max-w-24 truncate font-normal opacity-70">
                {project?.title ?? "Missing project"}
              </span>
            </div>
            <ul role="list" className="flex flex-col gap-px">
              {cards.map((card) => {
                const ongoing = card.threadIds.length > 0;
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      disabled={openingCardId === card.id}
                      onClick={() => void openCard(card)}
                      className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-row-hover disabled:cursor-wait disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate">{card.name}</span>
                      <Badge
                        size="sm"
                        variant={ongoing ? "info" : "outline"}
                        className="font-normal"
                      >
                        {openingCardId === card.id
                          ? "Opening…"
                          : ongoing
                            ? "Ongoing"
                            : "Start chat"}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
