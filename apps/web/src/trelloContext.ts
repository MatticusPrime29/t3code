import type {
  EnvironmentId,
  TrelloCardContext,
  TrelloPreparedAttachment,
} from "@t3tools/contracts";

import type { ComposerFileAttachment } from "./composerDraftStore";
import { randomUUID } from "./lib/utils";

function formatComments(context: TrelloCardContext): string {
  if (context.comments.length === 0) return "No comments.";
  return context.comments
    .toSorted((left, right) => Date.parse(left.date) - Date.parse(right.date))
    .map((comment) => `- ${comment.author} (${comment.date}):\n${comment.text}`)
    .join("\n\n");
}

export function formatInitialTrelloPrompt(context: TrelloCardContext): string {
  return [
    "The following is a Trello card.",
    `# ${context.name}`,
    `Trello card: ${context.url}`,
    "## Description",
    context.description.trim() || "No description.",
    "## Comments",
    formatComments(context),
  ].join("\n\n");
}

export function formatTrelloUpdates(input: {
  readonly context: TrelloCardContext;
  readonly includeDescription: boolean;
  readonly includeComments: boolean;
}): string {
  const sections: string[] = [];
  if (input.includeDescription && input.context.updates.description) {
    sections.push(
      ["## Updated description", input.context.description.trim() || "No description."].join(
        "\n\n",
      ),
    );
  }
  if (input.includeComments && input.context.updates.comments) {
    sections.push(["## New Trello comments", formatComments(input.context)].join("\n\n"));
  }
  return sections.join("\n\n");
}

export function trelloPreparedFiles(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<TrelloPreparedAttachment>,
): ComposerFileAttachment[] {
  return attachments.map((attachment) => ({
    type: "file",
    id: randomUUID(),
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    file: null,
    uploadedAttachmentId: attachment.attachmentId,
    uploadEnvironmentId: environmentId,
  }));
}
