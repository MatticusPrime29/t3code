import type { EnvironmentId, ThreadId, TrelloCardContext } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "../../composerDraftStore";
import { useEnvironmentQuery } from "../../state/query";
import { trelloEnvironment } from "../../state/trello";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatTrelloUpdates, trelloPreparedFiles } from "../../trelloContext";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

interface TrelloThreadIntegration {
  readonly cardUrl: string | null;
  readonly updateDialog: ReactNode;
}

export function useTrelloThreadIntegration(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly composerDraftTarget: ComposerThreadTarget;
}): TrelloThreadIntegration {
  const threadCardAtom = input.threadId
    ? trelloEnvironment.threadCard({
        environmentId: input.environmentId,
        input: { threadId: input.threadId },
      })
    : null;
  const threadCard = useEnvironmentQuery(threadCardAtom);
  const cardContextAtom =
    threadCard.data?.latestPromptAt && threadCard.data.cardId
      ? trelloEnvironment.cardContext({
          environmentId: input.environmentId,
          input: {
            cardId: threadCard.data.cardId,
            since: threadCard.data.latestPromptAt,
          },
        })
      : null;
  const cardContext = useEnvironmentQuery(cardContextAtom);
  const prepareAttachments = useAtomCommand(trelloEnvironment.prepareAttachments, {
    reportFailure: false,
  });
  const [pendingContext, setPendingContext] = useState<TrelloCardContext | null>(null);
  const [includeDescription, setIncludeDescription] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [applying, setApplying] = useState(false);
  const presentedUpdateKeyRef = useRef<string | null>(null);
  const updateKey = useMemo(() => {
    if (!threadCard.data?.latestPromptAt || !cardContext.data) return null;
    return `${input.threadId ?? "draft"}:${cardContext.data.id}:${threadCard.data.latestPromptAt}:${cardContext.data.dateLastActivity}`;
  }, [cardContext.data, input.threadId, threadCard.data?.latestPromptAt]);

  useEffect(() => {
    const context = cardContext.data;
    if (
      !context ||
      !updateKey ||
      presentedUpdateKeyRef.current === updateKey ||
      (!context.updates.description && !context.updates.comments && !context.updates.attachments)
    ) {
      return;
    }
    presentedUpdateKeyRef.current = updateKey;
    setIncludeDescription(context.updates.description);
    setIncludeComments(context.updates.comments);
    setIncludeAttachments(context.updates.attachments);
    setPendingContext(context);
  }, [cardContext.data, updateKey]);

  const applyUpdates = async () => {
    const context = pendingContext;
    const threadCardData = threadCard.data;
    if (!context || !threadCardData) return;
    setApplying(true);
    try {
      const text = formatTrelloUpdates({ context, includeDescription, includeComments });
      const store = useComposerDraftStore.getState();
      if (text) {
        const existing = store.getComposerDraft(input.composerDraftTarget)?.prompt.trimEnd() ?? "";
        store.setPrompt(input.composerDraftTarget, existing ? `${existing}\n\n${text}` : text);
      }
      if (includeAttachments && context.updates.attachments && context.attachments.length > 0) {
        const result = await prepareAttachments({
          environmentId: input.environmentId,
          input: {
            cardId: threadCardData.cardId,
            attachmentIds: context.attachments.map((attachment) => attachment.id),
          },
        });
        if (AsyncResult.isSuccess(result)) {
          store.addFiles(
            input.composerDraftTarget,
            trelloPreparedFiles(input.environmentId, result.value),
          );
        } else {
          toastManager.add({ type: "error", title: "Could not add the Trello attachments" });
          return;
        }
      }
      setPendingContext(null);
    } finally {
      setApplying(false);
    }
  };

  return {
    cardUrl: threadCard.data?.cardUrl ?? null,
    updateDialog: pendingContext ? (
      <Dialog open onOpenChange={(open) => !open && setPendingContext(null)}>
        <DialogPopup className="w-full sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Trello card updated</DialogTitle>
            <DialogDescription>
              This card changed after the most recent prompt. Choose what to add to the composer.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-2">
            {pendingContext.updates.description ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
                <Checkbox
                  checked={includeDescription}
                  onCheckedChange={(checked) => setIncludeDescription(checked === true)}
                />
                Updated description
              </label>
            ) : null}
            {pendingContext.updates.comments ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
                <Checkbox
                  checked={includeComments}
                  onCheckedChange={(checked) => setIncludeComments(checked === true)}
                />
                {pendingContext.comments.length} new or updated{" "}
                {pendingContext.comments.length === 1 ? "comment" : "comments"}
              </label>
            ) : null}
            {pendingContext.updates.attachments ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
                <Checkbox
                  checked={includeAttachments}
                  onCheckedChange={(checked) => setIncludeAttachments(checked === true)}
                />
                {pendingContext.attachments.length} new{" "}
                {pendingContext.attachments.length === 1 ? "attachment" : "attachments"}
              </label>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingContext(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                applying || (!includeDescription && !includeComments && !includeAttachments)
              }
              onClick={() => void applyUpdates()}
            >
              {applying ? "Applying…" : "Apply to composer"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    ) : null,
  };
}
