# MCP Tool Contracts: History & Trend Analysis

**Feature Branch**: `004-history`
**Date**: 2026-02-26

All tools follow the existing MCP server envelope pattern defined in `packages/mcp/src/server.ts`:
- Success: `{ success: true, data: T, timestamp: number }`
- Error: `{ success: false, error: { code: string, message: string }, timestamp: number }`

---

## Tool 12: `argus_history`

Query historical test run records for a project.

### Input Schema (Zod)

```typescript
{
  projectPath: z.string().describe('Project path (must have active session)'),
  limit: z.number().optional().default(20).describe('Max number of runs to return (1-100)'),
  status: z.enum(['passed', 'failed']).optional().describe('Filter by run status'),
  days: z.number().optional().describe('Filter to runs within the last N days'),
  offset: z.number().optional().default(0).describe('Pagination offset'),
}
```

### Response Type

```typescript
interface ArgusHistoryResponse {
  runs: TestRunRecord[];
  total: number;
  hasMore: boolean;
}
```

### Example Call

```json
{
  "tool": "argus_history",
  "params": {
    "projectPath": "/path/to/project",
    "limit": 5,
    "status": "failed"
  }
}
```

### Example Response

```json
{
  "success": true,
  "data": {
    "runs": [
      {
        "id": "run-1709000000000-a1b2c3",
        "project": "my-api",
        "timestamp": 1709000000000,
        "gitCommit": "abc123def456",
        "gitBranch": "main",
        "configHash": "sha256:...",
        "trigger": "mcp",
        "duration": 45000,
        "passed": 12,
        "failed": 2,
        "skipped": 1,
        "flaky": 1,
        "status": "failed"
      }
    ],
    "total": 42,
    "hasMore": true
  },
  "timestamp": 1709000100000
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `NO_SESSION` | No active session for projectPath |
| `HISTORY_DISABLED` | History is disabled in configuration |
| `INVALID_PARAMS` | Limit out of range, invalid status value |

---

## Tool 13: `argus_trends`

Retrieve trend data for specified metrics over time.

### Input Schema (Zod)

```typescript
{
  projectPath: z.string().describe('Project path'),
  metric: z.enum(['pass-rate', 'duration', 'flaky']).describe('Metric to trend'),
  days: z.number().optional().default(14).describe('Number of days to analyze (1-90)'),
  suiteId: z.string().optional().describe('Filter to a specific suite'),
}
```

### Response Type

```typescript
interface ArgusTrendsResponse {
  metric: 'pass-rate' | 'duration' | 'flaky';
  period: { from: string; to: string };
  dataPoints: TrendDataPoint[];
  summary: {
    current: number;
    previous: number;
    change: number;       // percentage change
    direction: 'up' | 'down' | 'stable';
  };
}
```

### Metric Definitions

| Metric | Value | Aggregation |
|--------|-------|-------------|
| `pass-rate` | Percentage (0-100) | Daily: `passed / total * 100` |
| `duration` | Milliseconds | Daily: average run duration |
| `flaky` | Count | Daily: number of flaky cases detected |

### Example Response (pass-rate)

```json
{
  "success": true,
  "data": {
    "metric": "pass-rate",
    "period": { "from": "2026-02-12", "to": "2026-02-26" },
    "dataPoints": [
      { "date": "2026-02-12", "value": 95.0, "runCount": 3 },
      { "date": "2026-02-13", "value": 87.5, "runCount": 4 },
      { "date": "2026-02-14", "value": 100.0, "runCount": 2 }
    ],
    "summary": {
      "current": 100.0,
      "previous": 87.5,
      "change": 14.3,
      "direction": "up"
    }
  },
  "timestamp": 1709000100000
}
```

---

## Tool 14: `argus_flaky`

List the flakiest test cases for a project.

### Input Schema (Zod)

```typescript
{
  projectPath: z.string().describe('Project path'),
  topN: z.number().optional().default(10).describe('Number of flaky cases to return (1-50)'),
  minScore: z.number().optional().default(0.01).describe('Minimum flaky score threshold (0-1)'),
  suiteId: z.string().optional().describe('Filter to a specific suite'),
}
```

### Response Type

```typescript
interface ArgusFlakyResponse {
  cases: FlakyInfo[];
  totalFlaky: number;
  analysisWindow: number;  // N (number of recent runs analyzed)
}
```

### Example Response

```json
{
  "success": true,
  "data": {
    "cases": [
      {
        "caseName": "POST /api/payment - timeout scenario",
        "suiteId": "api-tests",
        "isFlaky": true,
        "score": 0.4,
        "level": "FLAKY",
        "recentResults": ["passed", "failed", "passed", "passed", "failed", "passed", "failed", "passed", "failed", "passed"],
        "suggestion": "This test fails 40% of the time. Consider adding retry logic or investigating timing-dependent assertions."
      }
    ],
    "totalFlaky": 3,
    "analysisWindow": 10
  },
  "timestamp": 1709000100000
}
```

---

## Tool 15: `argus_compare`

Compare two test runs side-by-side to identify status changes.

### Input Schema (Zod)

```typescript
{
  projectPath: z.string().describe('Project path'),
  baseRunId: z.string().describe('ID of the base (earlier) run'),
  compareRunId: z.string().describe('ID of the comparison (later) run'),
}
```

### Response Type

```typescript
interface ArgusCompareResponse {
  baseRun: TestRunRecord;
  compareRun: TestRunRecord;
  newFailures: Array<{
    caseName: string;
    suiteId: string;
    error: string | null;
    baseStatus: 'passed' | 'skipped';
    compareStatus: 'failed';
  }>;
  fixed: Array<{
    caseName: string;
    suiteId: string;
    baseStatus: 'failed';
    compareStatus: 'passed';
  }>;
  consistent: {
    passed: number;
    failed: number;
    skipped: number;
  };
  newCases: string[];
  removedCases: string[];
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `RUN_NOT_FOUND` | One or both run IDs do not exist |
| `DIFFERENT_PROJECTS` | Runs belong to different projects |

### Example Response

```json
{
  "success": true,
  "data": {
    "baseRun": { "id": "run-1709000000000-a1b2", "status": "passed", "...": "..." },
    "compareRun": { "id": "run-1709100000000-c3d4", "status": "failed", "...": "..." },
    "newFailures": [
      {
        "caseName": "GET /api/users - list all",
        "suiteId": "api-tests",
        "error": "Expected status 200 but got 500",
        "baseStatus": "passed",
        "compareStatus": "failed"
      }
    ],
    "fixed": [],
    "consistent": { "passed": 10, "failed": 0, "skipped": 1 },
    "newCases": [],
    "removedCases": []
  },
  "timestamp": 1709000100000
}
```
