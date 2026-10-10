import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import forkCompatibility from "./059_ForkFeatureCompatibility.ts";

it.effect(
  "repairs the fork's id-59 history without rewriting its ledger or losing credentials",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 58 });
      yield* forkCompatibility;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (59, 'ForkFeatureCompatibility')`;
      yield* sql`INSERT INTO trello_credentials (singleton_id, api_key, api_token, updated_at)
      VALUES (1, 'test-key', 'test-token', '2026-10-10')`;
      const ledger = yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= 59`;
      const credentials = yield* sql`SELECT * FROM trello_credentials`;

      assert.deepStrictEqual(yield* runMigrations(), [
        [60, "ThreadSnapshotWindowIndexes"],
        [61, "ForkFeatureCompatibility"],
      ]);
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= 59`,
        ledger,
      );
      assert.deepStrictEqual(yield* sql`SELECT * FROM trello_credentials`, credentials);
      yield* sql`INSERT INTO mcp_app_model_context
      (thread_id, item_id, server, tool, text, updated_at)
      VALUES ('thread', 'item', 'server', 'tool', 'context', '2026-10-10')`;
      assert.strictEqual((yield* sql`SELECT * FROM mcp_app_model_context`).length, 1);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
