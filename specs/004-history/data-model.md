# Data Model: Test Result Persistence & Trend Analysis

**Feature Branch**: `004-history`
**Date**: 2026-02-26

---

## Entity Relationship Diagram

```
┌─────────────────────────┐
│       test_runs          │
│─────────────────────────│
│ PK  id          TEXT     │
│     project     TEXT     │──┐
│     timestamp   INTEGER  │  │
│     git_commit  TEXT?    │  │  ┌──────────────────────────┐
│     git_branch  TEXT?    │  │  │    test_case_runs         │
│     config_hash TEXT     │  │  │──────────────────────────│
│     trigger     TEXT     │  │  │ PK  id          TEXT      │
│     duration    INTEGER  │  │  │ FK  run_id      TEXT      │──→ test_runs.id
│     passed      INTEGER  │  │  │     suite_id    TEXT      │
│     failed      INTEGER  │  │  │     case_name   TEXT      │
│     skipped     INTEGER  │  │  │     status      TEXT      │
│     flaky       INTEGER  │  │  │     duration    INTEGER   │
│     status      TEXT     │  │  │     attempts    INTEGER   │
│     created_at  TEXT     │  │  │     response_ms INTEGER?  │
│─────────────────────────│  │  │     assertions  INTEGER?  │
│ IDX project+timestamp    │  │  │     error       TEXT?     │
│ IDX project+status       │  │  │     snapshot    TEXT?     │
└─────────────────────────┘  │  │     created_at  TEXT      │
                              │  │──────────────────────────│
                              │  │ IDX run_id                │
                              │  │ IDX suite_id+case_name    │
                              │  │ IDX case_name+created_at  │
                              │  └──────────────────────────┘
                              │
                              │  (1:N relationship — ON DELETE CASCADE)
                              └──────────────────────────────────────┘
```

---

## Table: `test_runs`

Represents a single complete execution of a test suite. One row per `argus_run` / CLI run / Dashboard trigger.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | TEXT (PK) | No | UUID-like identifier, e.g. `run-{timestamp}-{random}` |
| `project` | TEXT | No | Project name from `e2e.yaml` `project.name` |
| `timestamp` | INTEGER | No | Unix epoch milliseconds when the run started |
| `git_commit` | TEXT | Yes | Full git commit SHA, `null` if not in a git repo |
| `git_branch` | TEXT | Yes | Git branch name, `null` if detached HEAD or not in repo |
| `config_hash` | TEXT | No | SHA-256 hex of the `e2e.yaml` file content |
| `trigger` | TEXT | No | One of: `cli`, `mcp`, `dashboard`, `ci` |
| `duration` | INTEGER | No | Total run duration in milliseconds |
| `passed` | INTEGER | No | Count of passed test cases |
| `failed` | INTEGER | No | Count of failed test cases |
| `skipped` | INTEGER | No | Count of skipped test cases |
| `flaky` | INTEGER | No | Count of cases identified as flaky in this run |
| `status` | TEXT | No | Overall run status: `passed` or `failed` |
| `created_at` | TEXT | No | ISO 8601 timestamp for human readability |

### Indexes

```sql
CREATE INDEX idx_runs_project_ts ON test_runs(project, timestamp DESC);
CREATE INDEX idx_runs_project_status ON test_runs(project, status);
```

### Constraints

- `trigger` CHECK: `trigger IN ('cli', 'mcp', 'dashboard', 'ci')`
- `status` CHECK: `status IN ('passed', 'failed')`

---

## Table: `test_case_runs`

Represents the outcome of a single test case within a run. Multiple rows per `test_runs` row.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | TEXT (PK) | No | Unique identifier, e.g. `case-{run_timestamp}-{suite}-{index}` |
| `run_id` | TEXT (FK) | No | References `test_runs.id`, CASCADE on delete |
| `suite_id` | TEXT | No | Suite identifier from config (e.g. `api-tests`) |
| `case_name` | TEXT | No | Test case name (used as the stable key for flaky detection) |
| `status` | TEXT | No | One of: `passed`, `failed`, `skipped` |
| `duration` | INTEGER | No | Case execution duration in milliseconds |
| `attempts` | INTEGER | No | Number of retry attempts (1 = no retry, >1 = retried) |
| `response_ms` | INTEGER | Yes | HTTP response time if applicable (from HTTP test steps) |
| `assertions` | INTEGER | Yes | Total number of assertions evaluated |
| `error` | TEXT | Yes | Error summary for failed cases (first 2000 chars) |
| `snapshot` | TEXT | Yes | JSON-serialized diagnostic snapshot (container logs excerpt, etc.) |
| `created_at` | TEXT | No | ISO 8601 timestamp |

### Indexes

```sql
CREATE INDEX idx_cases_run_id ON test_case_runs(run_id);
CREATE INDEX idx_cases_suite_case ON test_case_runs(suite_id, case_name);
CREATE INDEX idx_cases_name_ts ON test_case_runs(case_name, created_at DESC);
```

### Constraints

- `FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE`
- `status` CHECK: `status IN ('passed', 'failed', 'skipped')`
- `attempts` CHECK: `attempts >= 1`

---

## SQL DDL (Migration v1)

```sql
CREATE TABLE IF NOT EXISTS test_runs (
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
);

CREATE TABLE IF NOT EXISTS test_case_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_runs_project_ts ON test_runs(project, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_status ON test_runs(project, status);
CREATE INDEX IF NOT EXISTS idx_cases_run_id ON test_case_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_cases_suite_case ON test_case_runs(suite_id, case_name);
CREATE INDEX IF NOT EXISTS idx_cases_name_ts ON test_case_runs(case_name, created_at DESC);
```

---

## Derived Entity: FlakyInfo (Computed, Not Stored)

Computed at query time from `test_case_runs` for a given `case_name` over the last N runs. Not persisted — always fresh.

| Field | Type | Description |
|-------|------|-------------|
| `caseName` | string | The test case identifier |
| `suiteId` | string | Parent suite identifier |
| `isFlaky` | boolean | `true` if 0 < score < 1.0 |
| `score` | number | `fail_count / total_count` (0.0 – 1.0) |
| `level` | StabilityLevel | Classification based on score thresholds |
| `recentResults` | Array<'pass'\|'fail'\|'skip'> | Last N results in chronological order |
| `suggestion` | string | Human-readable action suggestion |

### Stability Levels (FR-007)

| Level | Score Range | Description |
|-------|------------|-------------|
| `STABLE` | score = 0 | All recent runs passed |
| `MOSTLY_STABLE` | 0 < score ≤ 0.2 | Occasional failures, likely transient |
| `FLAKY` | 0.2 < score ≤ 0.5 | Significant instability, needs attention |
| `VERY_FLAKY` | 0.5 < score < 1.0 | More failures than passes |
| `BROKEN` | score = 1.0 | All recent runs failed |

### Flaky Score Query

```sql
SELECT
  case_name,
  suite_id,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as fail_count,
  GROUP_CONCAT(status, ',') as results_csv
FROM (
  SELECT case_name, suite_id, status, created_at
  FROM test_case_runs
  WHERE case_name = ?
    AND run_id IN (
      SELECT id FROM test_runs WHERE project = ? ORDER BY timestamp DESC LIMIT ?
    )
  ORDER BY created_at ASC
)
GROUP BY case_name, suite_id;
```

---

## TypeScript Interfaces

```typescript
/** Trigger source for a test run (FR-003). */
export type TriggerSource = 'cli' | 'mcp' | 'dashboard' | 'ci';

/** Stability classification levels (FR-007). */
export type StabilityLevel = 'STABLE' | 'MOSTLY_STABLE' | 'FLAKY' | 'VERY_FLAKY' | 'BROKEN';

/** Persistent record for a complete test run (FR-001). */
export interface TestRunRecord {
  id: string;
  project: string;
  timestamp: number;
  gitCommit: string | null;
  gitBranch: string | null;
  configHash: string;
  trigger: TriggerSource;
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  status: 'passed' | 'failed';
}

/** Persistent record for a single test case outcome (FR-002). */
export interface TestCaseRunRecord {
  id: string;
  runId: string;
  suiteId: string;
  caseName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  attempts: number;
  responseMs: number | null;
  assertions: number | null;
  error: string | null;
  snapshot: string | null;
}

/** Computed flaky analysis result (FR-006, FR-007, FR-008). */
export interface FlakyInfo {
  caseName: string;
  suiteId: string;
  isFlaky: boolean;
  score: number;
  level: StabilityLevel;
  recentResults: Array<'passed' | 'failed' | 'skipped'>;
  suggestion: string;
}

/** Comparison between two test runs (FR-012). */
export interface RunComparison {
  baseRun: TestRunRecord;
  compareRun: TestRunRecord;
  newFailures: TestCaseRunRecord[];
  fixed: TestCaseRunRecord[];
  consistent: { passed: number; failed: number; skipped: number };
}

/** Daily trend data point for time-series charts. */
export interface TrendDataPoint {
  date: string;        // ISO date string (YYYY-MM-DD)
  value: number;       // Metric value (pass rate %, avg duration ms, etc.)
  runCount: number;    // Number of runs on this date
}

/** History configuration added to e2e.yaml (FR-014, FR-015). */
export interface HistoryConfig {
  enabled: boolean;
  storage: 'local' | 'memory';
  path?: string;
  retention: {
    maxAge: string;    // Duration string, e.g. "90d"
    maxRuns: number;
  };
  flakyWindow: number; // Number of recent runs for flaky detection (default: 10)
}
```

---

## Configuration Schema Extension

Added to `e2e.yaml` under a `history` key:

```yaml
history:
  enabled: true          # default: true
  storage: local         # 'local' | 'memory' (default: 'local')
  path: .argusai/history.db  # SQLite file path (default)
  retention:
    maxAge: 90d          # default: 90 days
    maxRuns: 1000        # default: 1000
  flakyWindow: 10        # default: 10 recent runs
```

### Zod Schema

```typescript
export const HistoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storage: z.enum(['local', 'memory']).default('local'),
  path: z.string().optional(),
  retention: z.object({
    maxAge: z.string().default('90d'),
    maxRuns: z.number().min(10).max(100000).default(1000),
  }).default({}),
  flakyWindow: z.number().min(2).max(100).default(10),
}).default({});
```

---

## State Transitions

### TestRun Lifecycle

```
[Test Execution Starts]
  │
  ▼
[Collect TestEvents] ──→ [Build TestRunRecord + TestCaseRunRecords]
  │
  ▼
[Compute Flaky Scores] ──→ [Attach FlakyInfo to failed cases]
  │
  ▼
[Persist to HistoryStore] ──→ [Run Retention Cleanup]
  │
  ▼
[Return enriched results]
```

### Flaky Level Transitions

A test case's flaky level changes naturally as new runs push old results out of the sliding window. No explicit state machine — the level is recomputed on every query.
