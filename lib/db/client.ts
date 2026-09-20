import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './data/poker.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id            TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      blinds_sb     INTEGER NOT NULL,
      blinds_bb     INTEGER NOT NULL,
      agent_model   TEXT NOT NULL,
      seats_json    TEXT NOT NULL,
      button        INTEGER NOT NULL,
      hand_no       INTEGER NOT NULL DEFAULT 0,
      current_hand  TEXT,
      status        TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS hands (
      id          TEXT PRIMARY KEY,
      match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      hand_no     INTEGER NOT NULL,
      seed        INTEGER NOT NULL,
      button_seat INTEGER NOT NULL,
      state_json  TEXT NOT NULL,
      board       TEXT NOT NULL DEFAULT '',
      awards_json TEXT,
      pot         INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      ended_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS hands_match ON hands(match_id, hand_no);

    CREATE TABLE IF NOT EXISTS actions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      hand_id     TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
      seq         INTEGER NOT NULL,
      seat        INTEGER NOT NULL,
      stage       TEXT NOT NULL,
      action_type TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      pot_after   INTEGER NOT NULL,
      text        TEXT NOT NULL,
      UNIQUE (hand_id, seq)
    );

    CREATE TABLE IF NOT EXISTS agent_decisions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      hand_id         TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
      action_seq      INTEGER NOT NULL,
      seat            INTEGER NOT NULL,
      stage           TEXT NOT NULL,
      tool_name       TEXT NOT NULL,
      input_json      TEXT NOT NULL,
      thinking        TEXT,
      table_talk      TEXT,
      render_path     TEXT,
      latency_ms      INTEGER,
      input_tokens    INTEGER,
      output_tokens   INTEGER,
      clamped         INTEGER NOT NULL DEFAULT 0,
      fallback_reason TEXT,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS decisions_hand ON agent_decisions(hand_id, action_seq);
  `);
}
