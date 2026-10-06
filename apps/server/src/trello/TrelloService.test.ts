import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TrelloService from "./TrelloService.ts";

const layerHttp = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          request.url.endsWith("/members/me/boards")
            ? [{ id: "board", name: "Board", url: "https://trello.com/b/board" }]
            : request.url.includes("/boards/")
              ? [
                  {
                    id: "card",
                    idList: "list",
                    name: "Card",
                    url: "https://trello.com/c/card",
                    dateLastActivity: "2026-10-01",
                  },
                ]
              : {
                  id: "card",
                  idBoard: "board",
                  name: "Card",
                  url: "https://trello.com/c/card",
                  desc: "Description",
                  dateLastActivity: "2026-10-01",
                  attachments: [],
                  actions: [],
                },
        ),
      ),
    ),
  ),
);
const layerTest = TrelloService.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerConfig.layerTest("/tmp", { prefix: "t3-trello-test-" })),
  Layer.provide(layerHttp),
  Layer.provide(NodeServices.layer),
);

it.effect("uses V2 thread links and the latest user message for card updates", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const trello = yield* TrelloService.TrelloService;
    yield* sql`INSERT INTO trello_credentials VALUES (1, 'test-key', 'test-token', '2026-09-01')`;
    yield* sql`INSERT INTO trello_boards VALUES ('board', 'project', 'whitelist', '["list"]', '2026-09-01', '2026-09-01')`;
    yield* sql`INSERT INTO orchestration_v2_projection_threads
      (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
      VALUES ('thread', 'project', 'Thread', 'codex', 'full-access', 'default', '2026-09-01', '2026-09-01', '{}')`;
    yield* sql`INSERT INTO trello_thread_cards VALUES ('card', 'thread', '2026-09-01')`;
    yield* sql`INSERT INTO orchestration_v2_projection_messages
      (message_id, thread_id, role, streaming, created_at, updated_at, payload_json) VALUES
      ('user-1', 'thread', 'user', 0, '2026-09-01', '2026-09-01', '{}'),
      ('user-2', 'thread', 'user', 0, '2026-09-02', '2026-09-02', '{}'),
      ('assistant', 'thread', 'assistant', 0, '2026-09-03', '2026-09-03', '{}')`;

    assert.deepStrictEqual((yield* trello.listCards)[0]?.threadIds, [ThreadId.make("thread")]);
    assert.strictEqual((yield* trello.getThreadCard("thread"))?.latestPromptAt, "2026-09-02");
    yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = '2026-09-04' WHERE thread_id = 'thread'`;
    assert.deepStrictEqual((yield* trello.listCards)[0]?.threadIds, []);
  }).pipe(Effect.provide(layerTest)),
);
