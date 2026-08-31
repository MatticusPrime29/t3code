import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const TrelloId = TrimmedNonEmptyString.pipe(Schema.brand("TrelloId"));
export type TrelloId = typeof TrelloId.Type;

export const TrelloListFilterMode = Schema.Literals(["whitelist", "blacklist"]);
export type TrelloListFilterMode = typeof TrelloListFilterMode.Type;

export const TrelloCredentials = Schema.Struct({
  apiKey: TrimmedNonEmptyString,
  apiToken: TrimmedNonEmptyString,
});
export type TrelloCredentials = typeof TrelloCredentials.Type;

export const TrelloBoardConfiguration = Schema.Struct({
  boardId: TrelloId,
  projectId: ProjectId,
  listFilterMode: TrelloListFilterMode,
  listIds: Schema.Array(TrelloId),
});
export type TrelloBoardConfiguration = typeof TrelloBoardConfiguration.Type;

export const TrelloIntegrationSettings = Schema.Struct({
  credentials: Schema.NullOr(TrelloCredentials),
  boards: Schema.Array(TrelloBoardConfiguration),
});
export type TrelloIntegrationSettings = typeof TrelloIntegrationSettings.Type;

export const TrelloBoard = Schema.Struct({
  id: TrelloId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  closed: Schema.Boolean,
});
export type TrelloBoard = typeof TrelloBoard.Type;

export const TrelloList = Schema.Struct({
  id: TrelloId,
  name: TrimmedNonEmptyString,
  closed: Schema.Boolean,
});
export type TrelloList = typeof TrelloList.Type;

export const TrelloCardListItem = Schema.Struct({
  id: TrelloId,
  boardId: TrelloId,
  boardName: TrimmedNonEmptyString,
  projectId: ProjectId,
  listId: TrelloId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  dateLastActivity: IsoDateTime,
  threadIds: Schema.Array(ThreadId),
});
export type TrelloCardListItem = typeof TrelloCardListItem.Type;

export const TrelloCardComment = Schema.Struct({
  id: TrelloId,
  text: Schema.String,
  author: Schema.String,
  date: IsoDateTime,
});
export type TrelloCardComment = typeof TrelloCardComment.Type;

export const TrelloCardAttachment = Schema.Struct({
  id: TrelloId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  mimeType: Schema.String,
  sizeBytes: Schema.NullOr(NonNegativeInt),
  date: Schema.NullOr(IsoDateTime),
});
export type TrelloCardAttachment = typeof TrelloCardAttachment.Type;

export const TrelloCardContext = Schema.Struct({
  id: TrelloId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  description: Schema.String,
  dateLastActivity: IsoDateTime,
  comments: Schema.Array(TrelloCardComment),
  attachments: Schema.Array(TrelloCardAttachment),
  updates: Schema.Struct({
    description: Schema.Boolean,
    comments: Schema.Boolean,
    attachments: Schema.Boolean,
  }),
});
export type TrelloCardContext = typeof TrelloCardContext.Type;

export const TrelloThreadCard = Schema.Struct({
  cardId: TrelloId,
  cardUrl: TrimmedNonEmptyString,
  cardName: TrimmedNonEmptyString,
  latestPromptAt: Schema.NullOr(IsoDateTime),
});
export type TrelloThreadCard = typeof TrelloThreadCard.Type;

export const TrelloPreparedAttachment = Schema.Struct({
  attachmentId: TrimmedNonEmptyString,
  sourceAttachmentId: TrelloId,
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
});
export type TrelloPreparedAttachment = typeof TrelloPreparedAttachment.Type;

export const TrelloUpsertBoardInput = Schema.Struct({
  ...TrelloBoardConfiguration.fields,
  originalBoardId: Schema.optional(TrelloId),
});
export type TrelloUpsertBoardInput = typeof TrelloUpsertBoardInput.Type;

export const TrelloDeleteBoardInput = Schema.Struct({ boardId: TrelloId });
export type TrelloDeleteBoardInput = typeof TrelloDeleteBoardInput.Type;

export const TrelloListBoardListsInput = Schema.Struct({ boardId: TrelloId });
export type TrelloListBoardListsInput = typeof TrelloListBoardListsInput.Type;

export const TrelloLinkThreadInput = Schema.Struct({
  cardId: TrelloId,
  threadId: ThreadId,
});
export type TrelloLinkThreadInput = typeof TrelloLinkThreadInput.Type;

export const TrelloThreadCardInput = Schema.Struct({ threadId: ThreadId });
export type TrelloThreadCardInput = typeof TrelloThreadCardInput.Type;

export const TrelloCardContextInput = Schema.Struct({
  cardId: TrelloId,
  since: Schema.optional(IsoDateTime),
});
export type TrelloCardContextInput = typeof TrelloCardContextInput.Type;

export const TrelloPrepareAttachmentsInput = Schema.Struct({
  cardId: TrelloId,
  attachmentIds: Schema.Array(TrelloId),
});
export type TrelloPrepareAttachmentsInput = typeof TrelloPrepareAttachmentsInput.Type;

export const TrelloIntegrationErrorReason = Schema.Literals([
  "not_configured",
  "authentication_failed",
  "api_failed",
  "not_found",
  "conflict",
  "validation",
  "attachment_failed",
]);
export type TrelloIntegrationErrorReason = typeof TrelloIntegrationErrorReason.Type;

export class TrelloIntegrationError extends Schema.TaggedErrorClass<TrelloIntegrationError>()(
  "TrelloIntegrationError",
  {
    reason: TrelloIntegrationErrorReason,
    message: TrimmedNonEmptyString,
  },
) {}
