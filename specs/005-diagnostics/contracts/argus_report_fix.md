# MCP Tool Contract: argus_report_fix

**Tool Number**: 17 (of 18)  
**Priority**: P2 (User Story 5)

---

## Overview

Records a fix reported by an AI Agent after successfully resolving a failure. Updates the corresponding failure pattern's resolution count, recalculates confidence, and appends the fix to the pattern's history.

---

## Tool Registration

```typescript
server.tool(
  'argus_report_fix',
  {
    projectPath: z.string().describe('Project path (must have active session with history enabled)'),
    runId: z.string().describe('ID of the test run where the failure was originally diagnosed'),
    caseName: z.string().describe('Name of the test case that was fixed'),
    fixDescription: z.string().describe('Description of what was changed to fix the failure'),
    success: z.boolean().optional().default(true).describe('Whether the fix resolved the failure (default: true)'),
  },
  async (params) => { /* handler */ },
);
```

---

## Input Schema (Zod)

```typescript
{
  projectPath: z.string(),
  runId: z.string(),
  caseName: z.string(),
  fixDescription: z.string(),
  success: z.boolean().optional().default(true),
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectPath` | string | Yes | — | Absolute path to project directory |
| `runId` | string | Yes | — | Test run ID from the original failure |
| `caseName` | string | Yes | — | Case name of the fixed test |
| `fixDescription` | string | Yes | — | Human-readable description of the fix |
| `success` | boolean | No | `true` | Whether the fix actually resolved the issue |

---

## Output Schema

### Success Response (Existing Pattern Updated)

```json
{
  "success": true,
  "data": {
    "patternId": "builtin-conn-refused",
    "category": "CONNECTION_REFUSED",
    "previousConfidence": 0.5,
    "updatedConfidence": 0.67,
    "occurrences": 3,
    "resolutions": 2,
    "fixRecordId": "fix-002",
    "isNewPattern": false
  },
  "timestamp": 1740000000000
}
```

### Success Response (New Pattern Created)

When the failure had no existing pattern, `argus_report_fix` first classifies and creates a pattern, then records the fix.

```json
{
  "success": true,
  "data": {
    "patternId": "pat-new-abc",
    "category": "UNKNOWN",
    "previousConfidence": null,
    "updatedConfidence": 0.67,
    "occurrences": 1,
    "resolutions": 1,
    "fixRecordId": "fix-003",
    "isNewPattern": true
  },
  "timestamp": 1740000000000
}
```

### Error Responses

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session for `projectPath` |
| `HISTORY_DISABLED` | History/knowledge base not enabled in config |
| `RUN_NOT_FOUND` | `runId` does not exist in history |
| `CASE_NOT_FOUND` | `caseName` not found in the specified run |
| `INTERNAL_ERROR` | Unexpected error during fix recording |

---

## Handler Implementation

```typescript
// packages/mcp/src/tools/report-fix.ts

export interface ReportFixParams {
  projectPath: string;
  runId: string;
  caseName: string;
  fixDescription: string;
  success?: boolean;
}

export interface ReportFixResult {
  patternId: string;
  category: FailureCategory;
  previousConfidence: number | null;
  updatedConfidence: number;
  occurrences: number;
  resolutions: number;
  fixRecordId: string;
  isNewPattern: boolean;
}

export async function handleReportFix(
  params: ReportFixParams,
  sessionManager: SessionManager,
): Promise<ReportFixResult>;
```

### Workflow

1. **Resolve session** — `sessionManager.getOrThrow(projectPath)`
2. **Validate stores** — Ensure `historyStore` and `knowledgeStore` exist
3. **Fetch run + case** — Locate the original failure in history
4. **Build FailureEvent** — Same extraction as `argus_diagnose`
5. **Classify + Sign** — Generate signature for the failure
6. **Find or Create Pattern**:
   - If pattern exists → use it
   - If not → create new pattern (source: `'learned'`), set `isNewPattern: true`
7. **Record Fix** — `knowledgeStore.recordFix({ patternId, runId, caseName, fixDescription, success })`
8. **Update Pattern** (if `success === true`):
   - Increment `resolutions`
   - Recalculate `confidence = (resolutions + 1) / (occurrences + 2)`
   - Update `updatedAt`
9. **Return result** with previous and updated confidence

### Concurrency

All updates to a pattern (increment, recalculate, append) are wrapped in a single SQLite transaction to prevent data races (per edge case spec).

---

## Acceptance Test Mapping

| Spec Scenario | Verification |
|---------------|-------------|
| US5-1: Fix for known pattern | Pattern updated, confidence recalculated, fix in history |
| US5-2: Fix for unknown failure | New pattern created, fix recorded in its history |
| US3-1: Occurrences=3, resolutions=1 → report fix | resolutions=2, confidence increases |
| US3-2: Fix with description | fixHistory entry has runId, description, success, timestamp |
| US3-3: UNKNOWN failure fix | New pattern created with signature, fix recorded |
