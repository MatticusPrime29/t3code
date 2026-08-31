import {
  TrelloIntegrationError,
  type TrelloBoard,
  type TrelloBoardConfiguration,
  type TrelloCardAttachment,
  type TrelloCardContext,
  type TrelloCardListItem,
  type TrelloCredentials,
  type TrelloId,
  type TrelloIntegrationSettings,
  type TrelloList,
  type TrelloPreparedAttachment,
  type TrelloThreadCard,
  type ThreadId,
  type TrelloUpsertBoardInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import { attachmentFileExtension, createPendingAttachmentId } from "../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";

const API_BASE_URL = "https://api.trello.com/1";
const TrelloListIdsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeListIds = Schema.decodeUnknownOption(TrelloListIdsJson);
const encodeListIds = Schema.encodeSync(TrelloListIdsJson);

const ApiBoard = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  closed: Schema.optional(Schema.Boolean),
});

const ApiList = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  closed: Schema.optional(Schema.Boolean),
});

const ApiCardListItem = Schema.Struct({
  id: Schema.String,
  idList: Schema.String,
  name: Schema.String,
  url: Schema.String,
  dateLastActivity: Schema.String,
});

const ApiAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  mimeType: Schema.optional(Schema.NullOr(Schema.String)),
  bytes: Schema.optional(Schema.NullOr(Schema.Number)),
  date: Schema.optional(Schema.NullOr(Schema.String)),
});

const ApiAction = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  date: Schema.String,
  data: Schema.Struct({
    text: Schema.optional(Schema.String),
    attachment: Schema.optional(
      Schema.Struct({
        id: Schema.String,
      }),
    ),
    old: Schema.optional(
      Schema.Struct({
        desc: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
      }),
    ),
  }),
  memberCreator: Schema.optional(
    Schema.Struct({
      fullName: Schema.optional(Schema.String),
      username: Schema.optional(Schema.String),
    }),
  ),
});

const ApiCard = Schema.Struct({
  id: Schema.String,
  idBoard: Schema.String,
  name: Schema.String,
  url: Schema.String,
  desc: Schema.optional(Schema.String),
  dateLastActivity: Schema.String,
  attachments: Schema.optional(Schema.Array(ApiAttachment)),
  actions: Schema.optional(Schema.Array(ApiAction)),
});

interface CredentialRow {
  readonly apiKey: string;
  readonly apiToken: string;
}

interface BoardRow {
  readonly boardId: string;
  readonly projectId: string;
  readonly listFilterMode: "whitelist" | "blacklist";
  readonly listIdsJson: string;
}

const failure = (
  reason: TrelloIntegrationError["reason"],
  message: string,
): TrelloIntegrationError => new TrelloIntegrationError({ reason, message });

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function parseListIds(raw: string): ReadonlyArray<TrelloId> {
  const decoded = decodeListIds(raw);
  return decoded._tag === "Some"
    ? decoded.value.filter((item) => item.trim() !== "").map((item) => item as TrelloId)
    : [];
}

function mimeTypeForAttachment(name: string, declared: string | null | undefined): string {
  if (declared?.trim()) return declared;
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "txt":
    case "md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function isAfter(value: string | null | undefined, since: string | undefined): boolean {
  if (!since) return true;
  if (!value) return true;
  return Date.parse(value) > Date.parse(since);
}

function isTrelloUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "trello.com" || hostname.endsWith(".trello.com");
  } catch {
    return false;
  }
}

function toCardAttachment(attachment: typeof ApiAttachment.Type): TrelloCardAttachment {
  return {
    id: attachment.id as TrelloId,
    name: attachment.name,
    url: attachment.url,
    mimeType: mimeTypeForAttachment(attachment.name, attachment.mimeType),
    sizeBytes:
      typeof attachment.bytes === "number" && attachment.bytes >= 0
        ? Math.trunc(attachment.bytes)
        : null,
    date: attachment.date ?? null,
  };
}

export interface TrelloServiceShape {
  readonly getSettings: Effect.Effect<TrelloIntegrationSettings, TrelloIntegrationError>;
  readonly saveCredentials: (
    credentials: TrelloCredentials,
  ) => Effect.Effect<TrelloIntegrationSettings, TrelloIntegrationError>;
  readonly clearCredentials: Effect.Effect<TrelloIntegrationSettings, TrelloIntegrationError>;
  readonly listBoards: Effect.Effect<ReadonlyArray<TrelloBoard>, TrelloIntegrationError>;
  readonly listBoardLists: (
    boardId: TrelloId,
  ) => Effect.Effect<ReadonlyArray<TrelloList>, TrelloIntegrationError>;
  readonly upsertBoard: (
    input: TrelloUpsertBoardInput,
  ) => Effect.Effect<TrelloIntegrationSettings, TrelloIntegrationError>;
  readonly deleteBoard: (
    boardId: TrelloId,
  ) => Effect.Effect<TrelloIntegrationSettings, TrelloIntegrationError>;
  readonly listCards: Effect.Effect<ReadonlyArray<TrelloCardListItem>, TrelloIntegrationError>;
  readonly linkThread: (
    cardId: TrelloId,
    threadId: string,
  ) => Effect.Effect<void, TrelloIntegrationError>;
  readonly getThreadCard: (
    threadId: string,
  ) => Effect.Effect<TrelloThreadCard | null, TrelloIntegrationError>;
  readonly getCardContext: (
    cardId: TrelloId,
    since?: string,
  ) => Effect.Effect<TrelloCardContext, TrelloIntegrationError>;
  readonly prepareAttachments: (
    cardId: TrelloId,
    attachmentIds: ReadonlyArray<TrelloId>,
  ) => Effect.Effect<ReadonlyArray<TrelloPreparedAttachment>, TrelloIntegrationError>;
}

export class TrelloService extends Context.Service<TrelloService, TrelloServiceShape>()(
  "t3/trello/TrelloService",
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const loadOptionalCredentials = Effect.fn("TrelloService.loadOptionalCredentials")(
    function* (): Effect.fn.Return<TrelloCredentials | null, TrelloIntegrationError> {
      const rows = yield* sql<CredentialRow>`
      SELECT api_key AS "apiKey", api_token AS "apiToken"
      FROM trello_credentials
      WHERE singleton_id = 1
    `.pipe(Effect.mapError(() => failure("api_failed", "Trello settings could not be read.")));
      const row = rows[0];
      return row ? { apiKey: row.apiKey, apiToken: row.apiToken } : null;
    },
  );

  const loadCredentials = Effect.fn("TrelloService.loadCredentials")(function* (): Effect.fn.Return<
    TrelloCredentials,
    TrelloIntegrationError
  > {
    const credentials = yield* loadOptionalCredentials();
    if (!credentials) {
      return yield* failure(
        "not_configured",
        "Add a Trello API key and token in Settings before using Trello.",
      );
    }
    return credentials;
  });

  const loadBoardConfigurations = Effect.fn("TrelloService.loadBoardConfigurations")(function* () {
    const rows = yield* sql<BoardRow>`
        SELECT
          board_id AS "boardId",
          project_id AS "projectId",
          list_filter_mode AS "listFilterMode",
          list_ids_json AS "listIdsJson"
        FROM trello_boards
        ORDER BY created_at ASC, board_id ASC
      `.pipe(Effect.mapError(() => failure("api_failed", "Trello boards could not be read.")));
    return rows.map(
      (row): TrelloBoardConfiguration => ({
        boardId: row.boardId as TrelloId,
        projectId: row.projectId as TrelloBoardConfiguration["projectId"],
        listFilterMode: row.listFilterMode,
        listIds: [...parseListIds(row.listIdsJson)],
      }),
    );
  });

  const getSettings = Effect.fn("TrelloService.getSettings")(function* (): Effect.fn.Return<
    TrelloIntegrationSettings,
    TrelloIntegrationError
  > {
    const [credentials, boards] = yield* Effect.all([
      loadOptionalCredentials(),
      loadBoardConfigurations(),
    ]);
    return { credentials, boards } satisfies TrelloIntegrationSettings;
  });

  const executeWithCredentials = Effect.fn("TrelloService.executeWithCredentials")(function* <
    S extends Schema.Top,
  >(
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
    credentials: TrelloCredentials,
  ): Effect.fn.Return<S["Type"], TrelloIntegrationError, S["DecodingServices"]> {
    const authorized = request.pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader(
        "authorization",
        `OAuth oauth_consumer_key="${credentials.apiKey.replaceAll('"', "")}", oauth_token="${credentials.apiToken.replaceAll('"', "")}"`,
      ),
    );
    const response = yield* httpClient
      .execute(authorized)
      .pipe(Effect.mapError(() => failure("api_failed", "Trello could not be reached.")));
    if (response.status === 401 || response.status === 403) {
      return yield* failure("authentication_failed", "Trello rejected the API key or token.");
    }
    if (response.status === 404) {
      return yield* failure("not_found", "The requested Trello item no longer exists.");
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* failure("api_failed", `Trello returned HTTP ${response.status}.`);
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(() => failure("api_failed", "Trello returned an unexpected response.")),
    );
  });

  const execute = <S extends Schema.Top>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
    loadCredentials().pipe(
      Effect.flatMap((credentials) => executeWithCredentials(request, schema, credentials)),
    );

  const getCard = (cardId: TrelloId) =>
    execute(
      HttpClientRequest.get(`${API_BASE_URL}/cards/${encodeURIComponent(cardId)}`).pipe(
        HttpClientRequest.setUrlParams({
          fields: "id,idBoard,name,url,desc,dateLastActivity",
          attachments: "true",
          attachment_fields: "id,name,url,mimeType,bytes,date",
          actions: "commentCard,updateComment,updateCard,addAttachmentToCard",
          actions_limit: "1000",
          action_fields: "id,type,date,data",
          action_memberCreator_fields: "fullName,username",
        }),
      ),
      ApiCard,
    );

  const saveCredentials = Effect.fn("TrelloService.saveCredentials")(function* (
    credentials: TrelloCredentials,
  ): Effect.fn.Return<TrelloIntegrationSettings, TrelloIntegrationError> {
    const updatedAt = yield* nowIso;
    yield* executeWithCredentials(
      HttpClientRequest.get(`${API_BASE_URL}/members/me`).pipe(
        HttpClientRequest.setUrlParams({ fields: "id" }),
      ),
      Schema.Struct({ id: Schema.String }),
      credentials,
    );
    yield* sql`
      INSERT INTO trello_credentials (singleton_id, api_key, api_token, updated_at)
      VALUES (1, ${credentials.apiKey}, ${credentials.apiToken}, ${updatedAt})
      ON CONFLICT (singleton_id) DO UPDATE SET
        api_key = excluded.api_key,
        api_token = excluded.api_token,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(() => failure("api_failed", "Trello credentials could not be saved.")));
    return yield* getSettings();
  });

  const listBoards = execute(
    HttpClientRequest.get(`${API_BASE_URL}/members/me/boards`).pipe(
      HttpClientRequest.setUrlParams({ fields: "id,name,url,closed", filter: "all" }),
    ),
    Schema.Array(ApiBoard),
  ).pipe(
    Effect.map((boards) =>
      boards.map(
        (board): TrelloBoard => ({
          id: board.id as TrelloId,
          name: board.name,
          url: board.url,
          closed: board.closed ?? false,
        }),
      ),
    ),
  );

  const clearCredentials = sql`DELETE FROM trello_credentials WHERE singleton_id = 1`.pipe(
    Effect.mapError(() => failure("api_failed", "Trello credentials could not be cleared.")),
    Effect.andThen(getSettings()),
  );

  const listBoardLists = Effect.fn("TrelloService.listBoardLists")(function* (boardId: TrelloId) {
    const lists = yield* execute(
      HttpClientRequest.get(`${API_BASE_URL}/boards/${encodeURIComponent(boardId)}/lists`).pipe(
        HttpClientRequest.setUrlParams({ fields: "id,name,closed", filter: "all" }),
      ),
      Schema.Array(ApiList),
    );
    return lists.map(
      (list): TrelloList => ({
        id: list.id as TrelloId,
        name: list.name,
        closed: list.closed ?? false,
      }),
    );
  });

  const upsertBoard = Effect.fn("TrelloService.upsertBoard")(function* (
    input: TrelloUpsertBoardInput,
  ): Effect.fn.Return<TrelloIntegrationSettings, TrelloIntegrationError> {
    yield* loadCredentials();
    const project = yield* sql<{ readonly projectId: string }>`
      SELECT project_id AS "projectId"
      FROM projection_projects
      WHERE project_id = ${input.projectId} AND deleted_at IS NULL
    `.pipe(Effect.mapError(() => failure("api_failed", "The T3 project could not be checked.")));
    if (!project[0]) {
      return yield* failure("validation", "Choose a project that still exists.");
    }
    yield* execute(
      HttpClientRequest.get(`${API_BASE_URL}/boards/${encodeURIComponent(input.boardId)}`).pipe(
        HttpClientRequest.setUrlParams({ fields: "id" }),
      ),
      Schema.Struct({ id: Schema.String }),
    );
    const updatedAt = yield* nowIso;
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          if (input.originalBoardId && input.originalBoardId !== input.boardId) {
            yield* sql`DELETE FROM trello_boards WHERE board_id = ${input.originalBoardId}`;
          }
          yield* sql`
          INSERT INTO trello_boards (
            board_id, project_id, list_filter_mode, list_ids_json, created_at, updated_at
          ) VALUES (
            ${input.boardId}, ${input.projectId}, ${input.listFilterMode},
            ${encodeListIds([...new Set(input.listIds)])}, ${updatedAt}, ${updatedAt}
          )
          ON CONFLICT (board_id) DO UPDATE SET
            project_id = excluded.project_id,
            list_filter_mode = excluded.list_filter_mode,
            list_ids_json = excluded.list_ids_json,
            updated_at = excluded.updated_at
        `;
        }),
      )
      .pipe(Effect.mapError(() => failure("api_failed", "The Trello board could not be saved.")));
    return yield* getSettings();
  });

  const deleteBoard = Effect.fn("TrelloService.deleteBoard")(function* (
    boardId: TrelloId,
  ): Effect.fn.Return<TrelloIntegrationSettings, TrelloIntegrationError> {
    yield* sql`DELETE FROM trello_boards WHERE board_id = ${boardId}`.pipe(
      Effect.mapError(() => failure("api_failed", "The Trello board could not be removed.")),
    );
    return yield* getSettings();
  });

  const listCards = Effect.fn("TrelloService.listCards")(function* () {
    const configurations = yield* loadBoardConfigurations();
    const linkedRows = yield* sql<{ readonly cardId: string; readonly threadId: string }>`
      SELECT links.card_id AS "cardId", links.thread_id AS "threadId"
      FROM trello_thread_cards links
      JOIN projection_threads threads ON threads.thread_id = links.thread_id
      WHERE threads.deleted_at IS NULL
      ORDER BY links.created_at DESC
    `.pipe(Effect.mapError(() => failure("api_failed", "Trello card links could not be read.")));
    const threadIdsByCard = new Map<string, string[]>();
    for (const row of linkedRows) {
      const existing = threadIdsByCard.get(row.cardId) ?? [];
      existing.push(row.threadId);
      threadIdsByCard.set(row.cardId, existing);
    }
    const boardCatalog = yield* listBoards;
    const boardById = new Map(boardCatalog.map((board) => [board.id, board] as const));
    const cards = yield* Effect.all(
      configurations.map((configuration) =>
        execute(
          HttpClientRequest.get(
            `${API_BASE_URL}/boards/${encodeURIComponent(configuration.boardId)}/cards/open`,
          ).pipe(HttpClientRequest.setUrlParams({ fields: "id,idList,name,url,dateLastActivity" })),
          Schema.Array(ApiCardListItem),
        ).pipe(
          Effect.map((items) => {
            const selected = new Set(configuration.listIds);
            const accepts = (listId: string) =>
              configuration.listFilterMode === "whitelist"
                ? selected.has(listId as TrelloId)
                : !selected.has(listId as TrelloId);
            return items
              .filter((item) => accepts(item.idList))
              .map(
                (item): TrelloCardListItem => ({
                  id: item.id as TrelloId,
                  boardId: configuration.boardId,
                  boardName: boardById.get(configuration.boardId)?.name ?? configuration.boardId,
                  projectId: configuration.projectId,
                  listId: item.idList as TrelloId,
                  name: item.name,
                  url: item.url,
                  dateLastActivity: item.dateLastActivity,
                  threadIds: (threadIdsByCard.get(item.id) ?? []).map(
                    (threadId) => threadId as ThreadId,
                  ),
                }),
              );
          }),
        ),
      ),
      { concurrency: 4 },
    );
    return cards.flat();
  });

  const linkThread = Effect.fn("TrelloService.linkThread")(function* (
    cardId: TrelloId,
    threadId: string,
  ) {
    const [card, configurations] = yield* Effect.all([getCard(cardId), loadBoardConfigurations()]);
    if (!configurations.some((configuration) => configuration.boardId === card.idBoard)) {
      return yield* failure("validation", "Configure the card's Trello board first.");
    }
    const createdAt = yield* nowIso;
    yield* sql`
      INSERT INTO trello_thread_cards (card_id, thread_id, created_at)
      VALUES (${cardId}, ${threadId}, ${createdAt})
      ON CONFLICT (thread_id) DO UPDATE SET
        card_id = excluded.card_id,
        created_at = excluded.created_at
    `.pipe(Effect.mapError(() => failure("api_failed", "The Trello card could not be linked.")));
  });

  const getThreadCard = Effect.fn("TrelloService.getThreadCard")(function* (threadId: string) {
    const links = yield* sql<{ readonly cardId: string; readonly latestPromptAt: string | null }>`
      SELECT
        links.card_id AS "cardId",
        threads.latest_user_message_at AS "latestPromptAt"
      FROM trello_thread_cards links
      LEFT JOIN projection_threads threads ON threads.thread_id = links.thread_id
      WHERE links.thread_id = ${threadId}
      LIMIT 1
    `.pipe(Effect.mapError(() => failure("api_failed", "The Trello card link could not be read.")));
    const link = links[0];
    if (!link) return null;
    const card = yield* getCard(link.cardId as TrelloId);
    return {
      cardId: card.id as TrelloId,
      cardUrl: card.url,
      cardName: card.name,
      latestPromptAt: link.latestPromptAt,
    } satisfies TrelloThreadCard;
  });

  const getCardContext = Effect.fn("TrelloService.getCardContext")(function* (
    cardId: TrelloId,
    since?: string,
  ) {
    const card = yield* getCard(cardId);
    const actions = card.actions ?? [];
    const comments = actions
      .filter(
        (action) =>
          (action.type === "commentCard" || action.type === "updateComment") &&
          isAfter(action.date, since),
      )
      .map((action) => ({
        id: action.id as TrelloId,
        text: action.data.text ?? "",
        author: action.memberCreator?.fullName ?? action.memberCreator?.username ?? "Trello member",
        date: action.date,
      }));
    const descriptionUpdated = since
      ? actions.some(
          (action) =>
            action.type === "updateCard" &&
            action.data.old?.desc !== undefined &&
            isAfter(action.date, since),
        )
      : card.desc !== undefined && card.desc.trim() !== "";
    const recentlyAddedAttachmentIds = new Set(
      actions
        .filter((action) => action.type === "addAttachmentToCard" && isAfter(action.date, since))
        .flatMap((action) => (action.data.attachment ? [action.data.attachment.id] : [])),
    );
    const attachments = (card.attachments ?? [])
      .map(toCardAttachment)
      .filter(
        (attachment) =>
          !since ||
          (attachment.date
            ? isAfter(attachment.date, since)
            : recentlyAddedAttachmentIds.has(attachment.id)),
      );
    return {
      id: card.id as TrelloId,
      name: card.name,
      url: card.url,
      description: card.desc ?? "",
      dateLastActivity: card.dateLastActivity,
      comments,
      attachments,
      updates: {
        description: descriptionUpdated,
        comments: comments.length > 0,
        attachments: attachments.length > 0,
      },
    } satisfies TrelloCardContext;
  });

  const prepareAttachments = Effect.fn("TrelloService.prepareAttachments")(function* (
    cardId: TrelloId,
    attachmentIds: ReadonlyArray<TrelloId>,
  ) {
    const card = yield* getCard(cardId);
    const wanted = new Set(attachmentIds);
    const attachments = (card.attachments ?? []).filter((attachment) =>
      wanted.has(attachment.id as TrelloId),
    );
    return yield* Effect.all(
      attachments.map((attachment) =>
        Effect.gen(function* () {
          const credentials = yield* loadCredentials();
          const request = isTrelloUrl(attachment.url)
            ? HttpClientRequest.get(attachment.url).pipe(
                HttpClientRequest.setHeader(
                  "authorization",
                  `OAuth oauth_consumer_key="${credentials.apiKey.replaceAll('"', "")}", oauth_token="${credentials.apiToken.replaceAll('"', "")}"`,
                ),
              )
            : HttpClientRequest.get(attachment.url);
          const response = yield* httpClient
            .execute(request)
            .pipe(
              Effect.mapError(() =>
                failure(
                  "attachment_failed",
                  `Trello attachment '${attachment.name}' could not be downloaded.`,
                ),
              ),
            );
          if (response.status < 200 || response.status >= 300) {
            return yield* failure(
              "attachment_failed",
              `Trello attachment '${attachment.name}' returned HTTP ${response.status}.`,
            );
          }
          const bytes = new Uint8Array(
            yield* response.arrayBuffer.pipe(
              Effect.mapError(() =>
                failure(
                  "attachment_failed",
                  `Trello attachment '${attachment.name}' could not be read.`,
                ),
              ),
            ),
          );
          const extension = attachmentFileExtension(attachment.name);
          const attachmentId = createPendingAttachmentId(extension);
          const targetPath = resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}${extension}`,
          });
          if (!targetPath) {
            return yield* failure("attachment_failed", "The attachment path could not be created.");
          }
          yield* fileSystem.makeDirectory(path.dirname(targetPath), { recursive: true }).pipe(
            Effect.andThen(fileSystem.writeFile(targetPath, bytes)),
            Effect.mapError(() =>
              failure(
                "attachment_failed",
                `Trello attachment '${attachment.name}' could not be stored.`,
              ),
            ),
          );
          return {
            attachmentId,
            sourceAttachmentId: attachment.id as TrelloId,
            name: attachment.name,
            mimeType: mimeTypeForAttachment(attachment.name, attachment.mimeType),
            sizeBytes: bytes.byteLength,
          } satisfies TrelloPreparedAttachment;
        }),
      ),
      { concurrency: 3 },
    );
  });

  return TrelloService.of({
    getSettings: getSettings(),
    saveCredentials,
    clearCredentials,
    listBoards,
    listBoardLists,
    upsertBoard,
    deleteBoard,
    listCards: listCards(),
    linkThread,
    getThreadCard,
    getCardContext,
    prepareAttachments,
  });
});

export const layer = Layer.effect(TrelloService, make);
