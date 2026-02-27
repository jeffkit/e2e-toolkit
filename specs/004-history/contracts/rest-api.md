# REST API Contracts: Trend Analysis & Run History

**Feature Branch**: `004-history`
**Date**: 2026-02-26

Base path: Dashboard Fastify server (existing `packages/dashboard/server/`)

All endpoints return JSON. Error responses use standard HTTP status codes with a body:
```json
{ "success": false, "error": "description" }
```

---

## GET `/api/trends/pass-rate`

Daily pass-rate trend over time.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | 30 | Number of days to analyze (1-365) |
| `suiteId` | string | - | Optional: filter to a specific suite |

### Response 200

```typescript
interface PassRateTrendResponse {
  success: true;
  period: { from: string; to: string };
  granularity: 'daily';
  dataPoints: Array<{
    date: string;       // YYYY-MM-DD
    passRate: number;   // 0-100 percentage
    passed: number;
    failed: number;
    skipped: number;
    runCount: number;
  }>;
}
```

### Example

```
GET /api/trends/pass-rate?days=7
```

```json
{
  "success": true,
  "period": { "from": "2026-02-19", "to": "2026-02-26" },
  "granularity": "daily",
  "dataPoints": [
    { "date": "2026-02-19", "passRate": 92.3, "passed": 24, "failed": 2, "skipped": 0, "runCount": 2 },
    { "date": "2026-02-20", "passRate": 100.0, "passed": 13, "failed": 0, "skipped": 1, "runCount": 1 }
  ]
}
```

---

## GET `/api/trends/duration`

Execution duration trend over time.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | 14 | Number of days (1-365) |
| `suiteId` | string | - | Optional: filter to a specific suite |

### Response 200

```typescript
interface DurationTrendResponse {
  success: true;
  period: { from: string; to: string };
  dataPoints: Array<{
    date: string;
    avgDuration: number;   // milliseconds
    minDuration: number;
    maxDuration: number;
    runCount: number;
  }>;
}
```

---

## GET `/api/trends/flaky`

Flaky test ranking.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `topN` | number | 10 | Number of cases to return (1-50) |
| `minScore` | number | 0.01 | Minimum flaky score |
| `suiteId` | string | - | Optional: filter to a specific suite |

### Response 200

```typescript
interface FlakyRankingResponse {
  success: true;
  cases: Array<{
    caseName: string;
    suiteId: string;
    score: number;
    level: StabilityLevel;
    recentResults: string[];  // ['passed', 'failed', ...]
    failCount: number;
    totalRuns: number;
  }>;
  totalFlaky: number;
  analysisWindow: number;
}
```

---

## GET `/api/trends/failures`

Failure trend for a specific test case.

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `caseName` | string | Yes | - | Test case name |
| `days` | number | No | 7 | Number of days |
| `suiteId` | string | No | - | Optional: suite filter |

### Response 200

```typescript
interface FailureTrendResponse {
  success: true;
  caseName: string;
  period: { from: string; to: string };
  dataPoints: Array<{
    date: string;
    status: 'passed' | 'failed' | 'skipped' | 'no-run';
    duration: number | null;
    error: string | null;
    runId: string | null;
  }>;
  summary: {
    totalRuns: number;
    failures: number;
    flakyScore: number;
    level: StabilityLevel;
  };
}
```

### Response 400

Returned when `caseName` is missing.

---

## GET `/api/runs`

Paginated list of historical test runs.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 20 | Page size (1-100) |
| `offset` | number | 0 | Pagination offset |
| `status` | string | - | Optional: `passed` or `failed` |
| `days` | number | - | Optional: limit to recent N days |

### Response 200

```typescript
interface RunListResponse {
  success: true;
  runs: TestRunRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
```

---

## GET `/api/runs/:id`

Full details for a single test run, including all case-level records.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Test run ID |

### Response 200

```typescript
interface RunDetailResponse {
  success: true;
  run: TestRunRecord;
  cases: TestCaseRunRecord[];
  flaky: FlakyInfo[];  // flaky info for failed cases in this run
}
```

### Response 404

```json
{ "success": false, "error": "Run not found: run-abc123" }
```

---

## GET `/api/runs/:id/compare/:compareId`

Compare two runs (convenience wrapper around the core compare logic).

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Base run ID |
| `compareId` | string | Comparison run ID |

### Response 200

Same as `ArgusCompareResponse` from MCP contract.

### Response 404

Returned if either run ID does not exist.

---

## Fastify Route Registration

All routes register under a new plugin:

```typescript
// packages/dashboard/server/routes/history.ts
export const historyRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/trends/pass-rate
  // GET /api/trends/duration
  // GET /api/trends/flaky
  // GET /api/trends/failures
  // GET /api/runs
  // GET /api/runs/:id
  // GET /api/runs/:id/compare/:compareId
};
```

Registered in the main server as:

```typescript
app.register(historyRoutes, { prefix: '/api' });
```
