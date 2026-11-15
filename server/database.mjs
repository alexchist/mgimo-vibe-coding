import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed.mjs";
import { upgradeDemoRecords } from "./migrations.mjs";

export function openDatabase(databasePath) {
  if (databasePath !== ":memory:")
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      profile_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS records_owner_kind ON records(user_id, kind);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS request_keys (
      user_id TEXT NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      request_id TEXT NOT NULL REFERENCES records(id),
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS planner_keys (
      user_id TEXT NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      task_id TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `);
  seedDatabase(db);
  upgradeDemoRecords(db);
  return db;
}
