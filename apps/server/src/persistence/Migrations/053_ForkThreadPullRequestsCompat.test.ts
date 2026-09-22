import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

it.effect("backfills pull request links after the fork migration history", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* sql`
      INSERT INTO projection_threads (
        thread_id,
        project_id,
        title,
        model_selection_json,
        linked_pull_request_json,
        created_at,
        updated_at
      )
      VALUES (
        'thread-1',
        'project-1',
        'Linked thread',
        '{"instanceId":"codex","model":"gpt-5.4"}',
        '{"projectId":"project-1","repository":"PingDotGG/T3Code","number":42,"url":"https://github.com/pingdotgg/t3code/pull/42"}',
        '2026-09-09T00:00:00.000Z',
        '2026-09-09T00:00:00.000Z'
      )
    `;

    yield* runMigrations();

    const rows = yield* sql<{
      readonly threadId: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    }>`
      SELECT
        thread_id AS "threadId",
        host,
        repository,
        number
      FROM projection_thread_pull_requests
    `;
    assert.deepEqual(rows, [
      {
        threadId: "thread-1",
        host: "github.com",
        repository: "pingdotgg/t3code",
        number: 42,
      },
    ]);
    assert.deepEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
