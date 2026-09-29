import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import upstreamMigration54 from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";

for (const history of ["fork", "upstream"] as const) {
  it.effect(`converges the ${history} id-54 migration history at id 55`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });

      if (history === "fork") {
        yield* runMigrations({ toMigrationInclusive: 54 });
      } else {
        yield* upstreamMigration54;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (54, 'ProjectionThreadsAutoSettleDisabledAt')
        `;
      }

      yield* runMigrations();

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.isTrue(threadColumns.some((column) => column.name === "auto_settle_disabled_at"));
      assert.isTrue(projectColumns.some((column) => column.name === "original_repository_json"));
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trello_thread_cards'
      `;
      assert.deepEqual(tables, [{ name: "trello_thread_cards" }]);
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
}
