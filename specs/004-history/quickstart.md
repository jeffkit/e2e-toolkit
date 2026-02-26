# Quickstart: Test Result Persistence & Trend Analysis

**Feature Branch**: `004-history`
**Date**: 2026-02-26

---

## Prerequisites

- Node.js 20+
- pnpm 10+
- An existing ArgusAI project with `e2e.yaml` configured

## Setup

### 1. Install the new dependency

```bash
cd packages/core
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

### 2. Build

```bash
pnpm build
```

### 3. Configuration (optional)

History is **enabled by default** with sensible defaults. To customize, add a `history` section to `e2e.yaml`:

```yaml
# e2e.yaml
project:
  name: my-api

history:
  enabled: true            # default: true
  storage: local           # 'local' | 'memory'
  path: .argusai/history.db  # SQLite file location
  retention:
    maxAge: 90d            # auto-cleanup records older than 90 days
    maxRuns: 1000          # keep at most 1000 runs
  flakyWindow: 10          # analyze last 10 runs for flaky detection
```

To disable history entirely:

```yaml
history:
  enabled: false
```

---

## Usage

### Via CLI

Run tests as usual — history recording is automatic:

```bash
e2e-toolkit run
```

After running, the run record and all case-level results are persisted to `.argusai/history.db`.

### Via MCP Tools

#### Query Run History

```json
{ "tool": "argus_history", "params": { "projectPath": "/path/to/project", "limit": 5 } }
```

#### Get Trend Data

```json
{ "tool": "argus_trends", "params": { "projectPath": "/path/to/project", "metric": "pass-rate", "days": 7 } }
```

#### List Flaky Tests

```json
{ "tool": "argus_flaky", "params": { "projectPath": "/path/to/project", "topN": 5 } }
```

#### Compare Two Runs

```json
{ "tool": "argus_compare", "params": { "projectPath": "/path/to/project", "baseRunId": "run-xxx", "compareRunId": "run-yyy" } }
```

### Via Dashboard

1. Start the dashboard: `e2e-toolkit dashboard`
2. Navigate to the **Trends** page from the sidebar
3. View:
   - Pass-rate line chart (daily/weekly toggle)
   - Duration trend chart
   - Flaky test ranking table
   - Recent failures list
   - Run history timeline

### Via REST API

```bash
# Pass-rate trend (last 7 days)
curl http://localhost:9095/api/trends/pass-rate?days=7

# Flaky rankings
curl http://localhost:9095/api/trends/flaky?topN=5

# Run history (paginated)
curl http://localhost:9095/api/runs?limit=20&offset=0

# Single run details
curl http://localhost:9095/api/runs/run-1709000000000-a1b2c3
```

---

## Verification

### Verify Persistence

After running a test suite:

```bash
# Check the SQLite database exists
ls -la .argusai/history.db

# Query directly (requires sqlite3 CLI)
sqlite3 .argusai/history.db "SELECT id, project, status, passed, failed FROM test_runs ORDER BY timestamp DESC LIMIT 5;"
```

### Verify Flaky Detection

1. Run the same test suite at least 3 times
2. If any test has intermittent failures:

```json
{ "tool": "argus_flaky", "params": { "projectPath": "/path/to/project" } }
```

Expected: cases with mixed pass/fail history appear with a non-zero flaky score.

### Verify Trend APIs

After accumulating runs over multiple days:

```bash
curl http://localhost:9095/api/trends/pass-rate?days=14 | jq '.dataPoints'
```

Expected: array of daily data points with `date`, `passRate`, and `runCount`.

---

## Integration Scenarios

### Scenario A: AI Agent Flaky Decision

1. AI Agent runs tests via `argus_run`
2. A test fails
3. Agent calls `argus_flaky` to check the failed test's history
4. If flaky score > 0.2, Agent concludes it's a known flaky test and proceeds
5. If flaky score = 0, Agent investigates the failure as a new bug

### Scenario B: CI Pipeline Trend Check

1. CI runs tests and history is recorded (trigger: `ci`)
2. CI script calls `argus_trends` with `metric=pass-rate` and `days=7`
3. If pass-rate trend shows decline, CI flags the build

### Scenario C: Dashboard Quality Review

1. Team lead opens Dashboard Trends page
2. Reviews pass-rate chart — spots a dip 3 days ago
3. Checks flaky ranking — sees a new test entered the top 5
4. Drills into the flaky test's failure history to investigate

---

## Test Coverage Targets

| Module | Target | Location |
|--------|--------|----------|
| `history-store.ts` (SQLite + Memory) | 90%+ | `packages/core/tests/unit/history-store.test.ts` |
| `flaky-detector.ts` | 90%+ | `packages/core/tests/unit/flaky-detector.test.ts` |
| `git-context.ts` | 85%+ | `packages/core/tests/unit/git-context.test.ts` |
| MCP history tools | 85%+ | `packages/mcp/tests/history-tools.test.ts` |
| Dashboard trend routes | 80%+ | `packages/dashboard/server/routes/history.test.ts` |
| React Trends page | 80%+ | `packages/dashboard/ui/src/pages/Trends.test.tsx` |

---

## Troubleshooting

### "History is disabled"

Check `e2e.yaml` for `history.enabled: false`. Remove or set to `true`.

### Empty trends / no data

Run at least one test suite with history enabled. Data appears after the first successful run.

### SQLite errors

If the database file is corrupted, delete it and re-run tests to rebuild:

```bash
rm .argusai/history.db
e2e-toolkit run
```

### Flaky score is 0 for a known flaky test

The sliding window needs at least 2 runs with different outcomes. Run the test suite multiple times to accumulate history.
