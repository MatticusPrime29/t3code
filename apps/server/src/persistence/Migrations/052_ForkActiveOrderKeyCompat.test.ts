import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import branchPullRequest from "./048_ProjectionThreadBranchPullRequest.ts";
import trelloIntegration from "./048_TrelloIntegration.ts";
import originalRepository from "./049_ProjectionProjectOriginalRepository.ts";
import autoPullCompatibility from "./050_ForkAutoPullCompat.ts";
import branchCompatibility from "./051_ForkBranchPullRequestCompat.ts";
import activeOrderKey from "./049_ProjectionThreadsActiveOrderKey.ts";
import compatibility from "./052_ForkActiveOrderKeyCompat.ts";

for (const history of ["fresh", "fork", "upstream"] as const) {
  it.effect(`adds both id-49 schema changes to ${history} history and preserves data`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (history === "fork") {
        yield* runMigrations({ toMigrationInclusive: 47 });
        yield* trelloIntegration;
        yield* originalRepository;
        yield* autoPullCompatibility;
        yield* branchCompatibility;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES
            (48, 'TrelloIntegration'),
            (49, 'ProjectionProjectOriginalRepository'),
            (50, 'ForkAutoPullCompat'),
            (51, 'ForkBranchPullRequestCompat')
        `;
        yield* sql`
          INSERT INTO trello_thread_cards (card_id, thread_id, created_at)
          VALUES ('card-1', 'thread-1', '2026-09-08T00:00:00.000Z')
        `;
      } else if (history === "upstream") {
        yield* runMigrations({ toMigrationInclusive: 47 });
        yield* branchPullRequest;
        yield* activeOrderKey;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (48, 'ProjectionThreadBranchPullRequest'), (49, 'ProjectionThreadsActiveOrderKey')
        `;
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode,
            created_at, updated_at, active_order_key
          ) VALUES (
            'thread-1', 'project-1', 'Existing thread',
            '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access',
            '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z', 'gm'
          )
        `;
      }
      yield* runMigrations();
      const projectColumns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
      assert.isTrue(projectColumns.some((column) => column.name === "original_repository_json"));
      const threadColumns = yield* sql<{ name: string }>`PRAGMA table_info(projection_threads)`;
      assert.isTrue(threadColumns.some((column) => column.name === "active_order_key"));
      assert.isTrue(threadColumns.some((column) => column.name === "branch_pull_request_json"));
      const cards = yield* sql<{ card_id: string }>`SELECT card_id FROM trello_thread_cards`;
      assert.deepEqual(cards, history === "fork" ? [{ card_id: "card-1" }] : []);
      yield* compatibility;
      if (history === "upstream") {
        const rows = yield* sql<{ active_order_key: string }>`
          SELECT active_order_key FROM projection_threads WHERE thread_id = 'thread-1'
        `;
        assert.deepEqual(rows, [{ active_order_key: "gm" }]);
      }
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
}
