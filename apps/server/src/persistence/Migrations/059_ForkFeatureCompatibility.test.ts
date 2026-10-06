import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import forkCompatibility from "./055_ForkUpstreamSchemaCompatibility.ts";

it.effect("upgrades the fork's id-55 history without losing settings or rewriting its ledger", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 53 });
    yield* forkCompatibility;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (54, 'ForkSchemaCompatibility'), (55, 'ForkUpstreamSchemaCompatibility')`;
    yield* sql`INSERT INTO trello_credentials (singleton_id, api_key, api_token, updated_at)
      VALUES (1, 'test-key', 'test-token', '2026-09-01')`;
    const ledger = yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= 55`;
    const credentials = yield* sql`SELECT * FROM trello_credentials`;

    yield* runMigrations();
    assert.deepStrictEqual(
      yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= 55`,
      ledger,
    );
    assert.deepStrictEqual(yield* sql`SELECT * FROM trello_credentials`, credentials);
    assert.strictEqual(
      (yield* sql`SELECT name FROM sqlite_master WHERE name = 'orchestration_v2_events'`).length,
      1,
    );
    assert.strictEqual(
      (yield* sql`PRAGMA table_info(projection_projects)`).filter(
        (column) => column.name === "original_repository_json",
      ).length,
      1,
    );
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
