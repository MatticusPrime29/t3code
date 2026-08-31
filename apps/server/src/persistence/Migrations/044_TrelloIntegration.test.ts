import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("044_TrelloIntegration", (it) => {
  it.effect("stores board configuration and enforces one card per thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* runMigrations({ toMigrationInclusive: 44 });

      yield* sql`
        INSERT INTO trello_boards (
          board_id, project_id, list_filter_mode, list_ids_json, created_at, updated_at
        ) VALUES (
          'board-1', 'project-1', 'whitelist', '["list-1"]',
          '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO trello_thread_cards (card_id, thread_id, created_at)
        VALUES ('card-1', 'thread-1', '2026-08-31T00:00:00.000Z')
      `;

      const boards = yield* sql<{
        readonly boardId: string;
        readonly projectId: string;
        readonly filterMode: string;
        readonly listIds: string;
      }>`
        SELECT
          board_id AS "boardId",
          project_id AS "projectId",
          list_filter_mode AS "filterMode",
          list_ids_json AS "listIds"
        FROM trello_boards
      `;
      assert.deepEqual(boards, [
        {
          boardId: "board-1",
          projectId: "project-1",
          filterMode: "whitelist",
          listIds: '["list-1"]',
        },
      ]);

      const duplicateThread = yield* Effect.exit(sql`
        INSERT INTO trello_thread_cards (card_id, thread_id, created_at)
        VALUES ('card-2', 'thread-1', '2026-08-31T00:01:00.000Z')
      `);
      assert.isTrue(duplicateThread._tag === "Failure");
    }),
  );
});
