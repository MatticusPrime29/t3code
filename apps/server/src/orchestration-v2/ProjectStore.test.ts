import { assert, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";

it.layer(ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)))(
  "ProjectStoreV2",
  (it) => {
    it.effect(
      "preserves model selections and supports setting and clearing the original repository",
      () =>
        Effect.gen(function* () {
          const projects = yield* ProjectStore.ProjectStoreV2;
          const sql = yield* SqlClient.SqlClient;
          const projectId = ProjectId.make("project-null-options");
          const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
          yield* projects.apply({
            sequence: 1,
            eventId: EventId.make("event-null-options"),
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: "2026-03-24T00:00:00.000Z",
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            type: "project.created",
            payload: {
              projectId,
              title: "Null options project",
              workspaceRoot: "/tmp/project-null-options",
              defaultModelSelection: modelSelection,
              scripts: [],
              createdAt: "2026-03-24T00:00:00.000Z",
              updatedAt: "2026-03-24T00:00:00.000Z",
            },
          });

          const rows = yield* sql<{ readonly defaultModelSelection: string | null }>`
          SELECT default_model_selection_json AS "defaultModelSelection"
          FROM projection_projects
          WHERE project_id = ${projectId}
        `;
          const originalRepository = {
            remoteName: "upstream",
            remoteUrl: "git@github.com:owner/original.git",
            source: "configured" as const,
          };
          const updateEvent = {
            sequence: 2,
            eventId: EventId.make("event-original-repository"),
            aggregateKind: "project" as const,
            aggregateId: projectId,
            occurredAt: "2026-03-24T00:00:00.000Z",
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            type: "project.meta-updated" as const,
            payload: { projectId, originalRepository, updatedAt: "2026-03-24T00:00:00.000Z" },
          };
          yield* projects.apply(updateEvent);
          assert.deepStrictEqual(
            Option.getOrNull(yield* projects.get(projectId))?.originalRepository,
            originalRepository,
          );
          assert.deepStrictEqual(
            Option.getOrNull(yield* projects.getShell(projectId))?.originalRepository,
            originalRepository,
          );
          yield* projects.apply({
            ...updateEvent,
            payload: { ...updateEvent.payload, originalRepository: null },
          });
          assert.strictEqual(
            Option.getOrNull(yield* projects.get(projectId))?.originalRepository,
            null,
          );
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.strictEqual(rows[0]?.defaultModelSelection, JSON.stringify(modelSelection));
          assert.deepStrictEqual(
            Option.getOrNull(yield* projects.get(projectId))?.defaultModelSelection,
            modelSelection,
          );
        }),
    );
  },
);
