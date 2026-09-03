import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Idempotent on purpose: databases migrated before the 2026-09 upstream sync
// created these tables under an earlier migration id, so this runs as a no-op
// there and as the initial creation on fresh databases.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS trello_credentials (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      api_key TEXT NOT NULL,
      api_token TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS trello_boards (
      board_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      list_filter_mode TEXT NOT NULL CHECK (list_filter_mode IN ('whitelist', 'blacklist')),
      list_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_trello_boards_project_id
    ON trello_boards(project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS trello_thread_cards (
      card_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (card_id, thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_trello_thread_cards_card_id
    ON trello_thread_cards(card_id)
  `;
});
