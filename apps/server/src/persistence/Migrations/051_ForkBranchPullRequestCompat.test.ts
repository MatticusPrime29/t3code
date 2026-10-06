import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import branchPullRequest from "./048_ProjectionThreadBranchPullRequest.ts";
import trelloIntegration from "./048_TrelloIntegration.ts";
import originalRepository from "./049_ProjectionProjectOriginalRepository.ts";
import autoPullCompatibility from "./050_ForkAutoPullCompat.ts";

for (const history of ["fresh", "fork", "upstream"] as const) {
  it.effect(`upgrades ${history} migration history without losing fork data`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (history === "fork") {
        yield* runMigrations({ toMigrationInclusive: 47 });
        yield* trelloIntegration;
        yield* originalRepository;
        yield* autoPullCompatibility;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES
            (48, 'TrelloIntegration'),
            (49, 'ProjectionProjectOriginalRepository'),
            (50, 'ForkAutoPullCompat')
        `;
        yield* sql`
          INSERT INTO trello_thread_cards (card_id, thread_id, created_at)
          VALUES ('card-1', 'thread-1', '2026-09-06T00:00:00.000Z')
        `;
      } else if (history === "upstream") {
        yield* runMigrations({ toMigrationInclusive: 47 });
        yield* branchPullRequest;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (48, 'ProjectionThreadBranchPullRequest')
        `;
      }
      yield* runMigrations();
      const threadColumns = yield* sql<{ name: string }>`PRAGMA table_info(projection_threads)`;
      assert.isTrue(threadColumns.some((column) => column.name === "branch_pull_request_json"));
      const projectColumns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
      assert.isTrue(projectColumns.some((column) => column.name === "original_repository_json"));
      assert.isTrue(projectColumns.some((column) => column.name === "auto_pull"));
      const cards = yield* sql<{ card_id: string }>`SELECT card_id FROM trello_thread_cards`;
      assert.deepEqual(cards, history === "fork" ? [{ card_id: "card-1" }] : []);
      const rerun = yield* runMigrations();
      assert.deepEqual(rerun, []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
}
