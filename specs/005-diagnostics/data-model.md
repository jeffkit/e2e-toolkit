# Data Model: Intelligent Diagnostics & Suggestions

**Feature**: 005-diagnostics  
**Date**: 2026-02-26

---

## Entity Relationship Diagram

```
┌──────────────────┐       ┌──────────────────────┐
│  test_case_runs   │       │   failure_patterns    │
│  (existing)       │       │   (new)               │
│──────────────────│       │──────────────────────│
│  id (PK)         │       │  id (PK)             │
│  run_id (FK)     │       │  category            │
│  case_name       │       │  signature           │◄─── lookup key
│  error           │       │  signature_pattern   │
│  status          │       │  description         │
│  ...             │       │  suggested_fix       │
└──────────────────┘       │  confidence          │
         │                 │  occurrences         │
         │ diagnose uses   │  resolutions         │
         │ run_id +        │  source              │
         │ case_name       │  first_seen_at       │
         │ to fetch error  │  last_seen_at        │
         ▼                 │  created_at          │
┌──────────────────┐       │  updated_at          │
│  test_runs        │       └──────────────────────┘
│  (existing)       │                 │
│──────────────────│                 │ 1:N
│  id (PK)         │                 │
│  project         │                 ▼
│  timestamp       │       ┌──────────────────────┐
│  ...             │       │    fix_history        │
└──────────────────┘       │    (new)              │
                           │──────────────────────│
                           │  id (PK)             │
                           │  pattern_id (FK)     │
                           │  run_id              │
                           │  case_name           │
                           │  fix_description     │
                           │  success             │
                           │  created_at          │
                           └──────────────────────┘
```

---

## TypeScript Interfaces

### FailureCategory (Enumeration)

```typescript
export type FailureCategory =
  | 'ASSERTION_MISMATCH'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'CONTAINER_OOM'
  | 'CONTAINER_CRASH'
  | 'MOCK_MISMATCH'
  | 'CONFIG_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';
```

10 defined categories per FR-001. `UNKNOWN` is the catch-all when no classification rule matches.

### FailureEvent

Input to the classification system. Extracted from a failed test case run.

```typescript
export interface FailureEvent {
  runId: string;
  caseName: string;
  suiteId: string;
  error: string;
  status: number | null;
  containerStatus: string | null;
  oomKilled: boolean;
  diagnostics: DiagnosticReport | null;
}
```

**Field semantics**:
- `error` — Raw error string from `test_case_runs.error`
- `status` — HTTP status code if available (extracted from error or response)
- `containerStatus` — Docker container status if relevant
- `oomKilled` — Whether OOMKilled was detected in diagnostics
- `diagnostics` — Full diagnostic report for context-rich classification

### ClassificationRule

A single rule in the classification chain.

```typescript
export interface ClassificationRule {
  readonly name: string;
  readonly category: FailureCategory;
  match(event: FailureEvent): boolean;
}
```

**Validation**: `name` must be unique across all rules. `match` must be a pure function (no side effects).

### FailurePattern

The core knowledge entity. Stored in `failure_patterns` table.

```typescript
export interface FailurePattern {
  id: string;
  category: FailureCategory;
  signature: string;
  signaturePattern: string;
  description: string;
  suggestedFix: string;
  confidence: number;
  occurrences: number;
  resolutions: number;
  source: 'built-in' | 'learned';
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}
```

**Field semantics**:
- `id` — UUID v4, primary key
- `signature` — SHA-256 hash of `category::caseName::normalizedError`
- `signaturePattern` — Human-readable normalized error pattern (pre-hash)
- `description` — Human-readable description of the failure pattern
- `suggestedFix` — Recommended fix text returned to the Agent
- `confidence` — Score 0–1 calculated as `(resolutions + 1) / (occurrences + 2)` (Laplace smoothing)
- `occurrences` — Total times this pattern has been seen
- `resolutions` — Total successful fixes reported for this pattern
- `source` — `'built-in'` for shipped patterns, `'learned'` for auto-created
- `firstSeenAt` / `lastSeenAt` — ISO 8601 timestamps

**State transitions**:
```
[New failure, no match] → Create pattern (occurrences=1, resolutions=0, source='learned')
[New failure, match found] → Increment occurrences, update lastSeenAt
[Fix reported, success] → Increment resolutions, recalculate confidence, append fix_history
[Fix reported, failure] → Append fix_history only (no confidence change)
```

### FixRecord

A historical fix attempt. Stored in `fix_history` table.

```typescript
export interface FixRecord {
  id: string;
  patternId: string;
  runId: string;
  caseName: string;
  fixDescription: string;
  success: boolean;
  createdAt: string;
}
```

**Field semantics**:
- `patternId` — FK to `failure_patterns.id`
- `runId` — Reference to the test run where the fix was applied
- `fixDescription` — Agent-provided description of what was fixed
- `success` — Whether the fix resolved the failure (re-run passed)

### DiagnosticResult

Output of the full diagnostic workflow (classify → sign → match → suggest).

```typescript
export interface DiagnosticResult {
  category: FailureCategory;
  signature: string;
  signaturePattern: string;
  pattern: FailurePattern | null;
  suggestedFix: string | null;
  confidence: number | null;
  fixHistory: FixRecord[];
  isNewPattern: boolean;
}
```

**Field semantics**:
- `pattern` — Matched pattern, or `null` if no match (but a new one was created)
- `suggestedFix` — From matched pattern, or `null` if no match
- `confidence` — From matched pattern, or `null` if no match
- `fixHistory` — Recent fix records for the matched pattern (limited to last 10)
- `isNewPattern` — `true` if a new pattern was auto-created for this failure

### KnowledgeStore

Persistence interface for the knowledge base.

```typescript
export interface KnowledgeStore {
  findBySignature(signature: string): FailurePattern | null;
  findByCategory(category: FailureCategory): FailurePattern[];
  getAllPatterns(): FailurePattern[];
  createPattern(pattern: Omit<FailurePattern, 'id' | 'createdAt' | 'updatedAt'>): FailurePattern;
  incrementOccurrences(patternId: string): void;
  recordFix(fix: Omit<FixRecord, 'id' | 'createdAt'>): FixRecord;
  getFixHistory(patternId: string, limit?: number): FixRecord[];
  updateConfidence(patternId: string, confidence: number): void;
  close(): void;
}
```

---

## SQLite Schema (Migration Version 2)

Added to the existing `applyMigrations` function in `packages/core/src/history/migrations.ts`.

```sql
-- Migration 2: Knowledge base tables for diagnostics & suggestions

CREATE TABLE IF NOT EXISTS failure_patterns (
  id                TEXT PRIMARY KEY,
  category          TEXT NOT NULL CHECK (category IN (
    'ASSERTION_MISMATCH', 'HTTP_ERROR', 'TIMEOUT', 'CONNECTION_REFUSED',
    'CONTAINER_OOM', 'CONTAINER_CRASH', 'MOCK_MISMATCH', 'CONFIG_ERROR',
    'NETWORK_ERROR', 'UNKNOWN'
  )),
  signature         TEXT NOT NULL UNIQUE,
  signature_pattern TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  suggested_fix     TEXT NOT NULL DEFAULT '',
  confidence        REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  occurrences       INTEGER NOT NULL DEFAULT 0 CHECK (occurrences >= 0),
  resolutions       INTEGER NOT NULL DEFAULT 0 CHECK (resolutions >= 0),
  source            TEXT NOT NULL DEFAULT 'learned' CHECK (source IN ('built-in', 'learned')),
  first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patterns_signature ON failure_patterns(signature);
CREATE INDEX IF NOT EXISTS idx_patterns_category ON failure_patterns(category);
CREATE INDEX IF NOT EXISTS idx_patterns_source ON failure_patterns(source);

CREATE TABLE IF NOT EXISTS fix_history (
  id              TEXT PRIMARY KEY,
  pattern_id      TEXT NOT NULL REFERENCES failure_patterns(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  case_name       TEXT NOT NULL,
  fix_description TEXT NOT NULL,
  success         INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fix_history_pattern ON fix_history(pattern_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_history_run ON fix_history(run_id);
```

### Seed Data (Built-in Patterns)

Inserted during migration 2 after table creation:

```sql
INSERT OR IGNORE INTO failure_patterns (id, category, signature, signature_pattern, description, suggested_fix, confidence, occurrences, resolutions, source)
VALUES
  ('builtin-conn-refused',  'CONNECTION_REFUSED', 'builtin::CONNECTION_REFUSED',  'ECONNREFUSED *:*',                      'Service connection refused',                '服务可能未完全启动，尝试增加 healthcheck.startPeriod',                    0.5, 0, 0, 'built-in'),
  ('builtin-timeout',       'TIMEOUT',            'builtin::TIMEOUT',             'ETIMEDOUT / timeout exceeded',           'Request or operation timed out',            '请求超时，检查服务响应时间或增加 timeout 配置',                           0.5, 0, 0, 'built-in'),
  ('builtin-container-oom', 'CONTAINER_OOM',      'builtin::CONTAINER_OOM',       'OOMKilled = true',                       'Container killed due to out of memory',     '容器内存不足，增加 container memory limit 或优化内存使用',                 0.5, 0, 0, 'built-in'),
  ('builtin-http-error',    'HTTP_ERROR',          'builtin::HTTP_ERROR',          'returned 5xx',                           'HTTP server error response',                '服务端错误，检查容器日志定位 root cause',                                  0.5, 0, 0, 'built-in'),
  ('builtin-mock-mismatch', 'MOCK_MISMATCH',       'builtin::MOCK_MISMATCH',      'mock unexpected request',                'Mock service received unexpected request',  'Mock 服务收到未预期请求，检查 mock routes 配置是否完整',                    0.5, 0, 0, 'built-in'),
  ('builtin-assertion',     'ASSERTION_MISMATCH',  'builtin::ASSERTION_MISMATCH',  'expected .* to (equal|match|be)',        'Test assertion failed',                     '断言失败，检查测试期望值或服务返回值是否正确',                              0.5, 0, 0, 'built-in');
```

### Normalization Rules

Applied sequentially to the raw error string before hashing:

| Order | Pattern (Regex) | Replacement |
|-------|----------------|-------------|
| 1 | `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` | `<UUID>` |
| 2 | `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\d.]*Z?` | `<TIMESTAMP>` |
| 3 | `\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}` | `<IP>` |
| 4 | `:\d{2,5}(?=[/\s,)\]])` | `:<PORT>` |
| 5 | `/[a-f0-9]{8,}/` | `/<HASH>/` |
| 6 | `\b\d{3}\b` (in HTTP context) | Status class (e.g., `5xx`) |
| 7 | `/\w+/\d+` (path segments) | `/\w+/<ID>` |
| 8 | `\b\d{4,}\b` (standalone large numbers) | `<NUM>` |

---

## Classification Rules (Ordered Chain)

| Order | Rule Name | Category | Match Condition |
|-------|-----------|----------|----------------|
| 1 | `container-oom` | `CONTAINER_OOM` | `oomKilled === true` OR error contains `OOMKilled` |
| 2 | `container-crash` | `CONTAINER_CRASH` | containerStatus is `exited` or `dead` AND not OOM |
| 3 | `connection-refused` | `CONNECTION_REFUSED` | error contains `ECONNREFUSED` |
| 4 | `timeout` | `TIMEOUT` | error contains `ETIMEDOUT`, `timeout`, or `ESOCKETTIMEDOUT` |
| 5 | `network-error` | `NETWORK_ERROR` | error contains `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH` |
| 6 | `http-5xx` | `HTTP_ERROR` | HTTP status 500-599 |
| 7 | `http-4xx` | `HTTP_ERROR` | HTTP status 400-499 |
| 8 | `mock-mismatch` | `MOCK_MISMATCH` | error contains `mock` AND (`unexpected` OR `unmatched`) |
| 9 | `config-error` | `CONFIG_ERROR` | error contains `config`, `YAML`, `validation`, or `schema` |
| 10 | `assertion-mismatch` | `ASSERTION_MISMATCH` | error contains `expected`, `to equal`, `to match`, `AssertionError` |

If no rule matches → `UNKNOWN`.

Rules are ordered most-specific-first: infrastructure conditions (OOM, crash) before network conditions before application-level conditions (assertions).

---

## Confidence Recalculation

On each fix report:

```typescript
function recalculateConfidence(occurrences: number, resolutions: number): number {
  const alpha = 1; // Laplace pseudo-successes
  const beta = 1;  // Laplace pseudo-failures
  return (resolutions + alpha) / (occurrences + alpha + beta);
}
```

| Occurrences | Resolutions | Confidence |
|-------------|-------------|------------|
| 0 | 0 | 0.50 (built-in default) |
| 1 | 0 | 0.33 |
| 1 | 1 | 0.67 |
| 5 | 4 | 0.71 |
| 10 | 8 | 0.75 |
| 10 | 10 | 0.92 |
| 100 | 70 | 0.70 |
