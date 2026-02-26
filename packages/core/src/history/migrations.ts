/**
 * @module history/migrations
 * SQLite schema migrations using user_version pragma for version tracking.
 */

import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  up: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Create test_runs and test_case_runs tables with indexes',
    up: [
      `CREATE TABLE IF NOT EXISTS test_runs (
        id          TEXT PRIMARY KEY,
        project     TEXT NOT NULL,
        timestamp   INTEGER NOT NULL,
        git_commit  TEXT,
        git_branch  TEXT,
        config_hash TEXT NOT NULL,
        trigger     TEXT NOT NULL CHECK (trigger IN ('cli', 'mcp', 'dashboard', 'ci')),
        duration    INTEGER NOT NULL DEFAULT 0,
        passed      INTEGER NOT NULL DEFAULT 0,
        failed      INTEGER NOT NULL DEFAULT 0,
        skipped     INTEGER NOT NULL DEFAULT 0,
        flaky       INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS test_case_runs (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
        suite_id    TEXT NOT NULL,
        case_name   TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
        duration    INTEGER NOT NULL DEFAULT 0,
        attempts    INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
        response_ms INTEGER,
        assertions  INTEGER,
        error       TEXT,
        snapshot    TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_runs_project_ts ON test_runs(project, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_runs_project_status ON test_runs(project, status)',
      'CREATE INDEX IF NOT EXISTS idx_cases_run_id ON test_case_runs(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_cases_suite_case ON test_case_runs(suite_id, case_name)',
      'CREATE INDEX IF NOT EXISTS idx_cases_name_ts ON test_case_runs(case_name, created_at DESC)',
    ],
  },
];

/**
 * Apply pending migrations to the database.
 * Uses the SQLite `user_version` pragma to track the current schema version.
 */
export function applyMigrations(db: Database.Database): void {
  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      const migrate = db.transaction(() => {
        for (const sql of migration.up) {
          db.exec(sql);
        }
        db.pragma(`user_version = ${migration.version}`);
      });
      migrate();
    }
  }
}
