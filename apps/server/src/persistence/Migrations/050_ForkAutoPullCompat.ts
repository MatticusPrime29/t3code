import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Fork-era databases recorded migration ids 44/45 before the 2026-09 upstream
// sync, which suppressed upstream 044 (automatic model default cleanup) and
// 045 (auto_pull column) there: the migrator skips anything at or below the
// highest recorded id. Re-apply both here; every step is guarded so it is a
// no-op on databases where the upstream migrations already ran.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!columns.some((column) => column.name === "auto_pull")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN auto_pull INTEGER NOT NULL DEFAULT 0
    `;
  }

  // Project creation never exposed a model choice. A later metadata event
  // containing this field is the evidence that the user set or reset one.
  yield* sql`
    WITH automatically_seeded_projects AS (
      SELECT created.stream_id AS project_id
      FROM orchestration_events AS created
      WHERE created.aggregate_kind = 'project'
        AND created.event_type = 'project.created'
        AND json_type(created.payload_json, '$.defaultModelSelection') IS NOT NULL
        AND json_type(created.payload_json, '$.defaultModelSelection') <> 'null'
        AND NOT EXISTS (
          SELECT 1
          FROM orchestration_events AS configured
          WHERE configured.aggregate_kind = 'project'
            AND configured.stream_id = created.stream_id
            AND configured.event_type = 'project.meta-updated'
            AND json_type(configured.payload_json, '$.defaultModelSelection') IS NOT NULL
        )
    )
    UPDATE projection_projects
    SET default_model_selection_json = NULL
    WHERE project_id IN (SELECT project_id FROM automatically_seeded_projects)
  `;

  yield* sql`
    UPDATE orchestration_events AS created
    SET payload_json = json_set(
      created.payload_json,
      '$.defaultModelSelection',
      json('null')
    )
    WHERE created.aggregate_kind = 'project'
      AND created.event_type = 'project.created'
      AND json_type(created.payload_json, '$.defaultModelSelection') IS NOT NULL
      AND json_type(created.payload_json, '$.defaultModelSelection') <> 'null'
      AND NOT EXISTS (
        SELECT 1
        FROM orchestration_events AS configured
        WHERE configured.aggregate_kind = 'project'
          AND configured.stream_id = created.stream_id
          AND configured.event_type = 'project.meta-updated'
          AND json_type(configured.payload_json, '$.defaultModelSelection') IS NOT NULL
      )
  `;
});
