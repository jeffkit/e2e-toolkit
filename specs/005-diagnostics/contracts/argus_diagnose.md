# MCP Tool Contract: argus_diagnose

**Tool Number**: 16 (of 18)  
**Priority**: P1 (User Story 4)

---

## Overview

Performs the full diagnostic workflow for a failed test case: classify the failure, generate a signature, match against the knowledge base, and return structured diagnostic results with suggested fixes.

---

## Tool Registration

```typescript
server.tool(
  'argus_diagnose',
  {
    projectPath: z.string().describe('Project path (must have active session with history enabled)'),
    runId: z.string().describe('ID of the test run containing the failed case'),
    caseName: z.string().describe('Name of the failed test case to diagnose'),
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
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | Yes | Absolute path to project directory |
| `runId` | string | Yes | Test run ID (from `argus_run` or `argus_history` output) |
| `caseName` | string | Yes | Exact case name of the failed test |

---

## Output Schema

### Success Response

```json
{
  "success": true,
  "data": {
    "category": "CONNECTION_REFUSED",
    "signature": "a1b2c3d4e5f6...",
    "signaturePattern": "CONNECTION_REFUSED::health-check::ECONNREFUSED <IP>:<PORT>",
    "pattern": {
      "id": "builtin-conn-refused",
      "category": "CONNECTION_REFUSED",
      "signature": "builtin::CONNECTION_REFUSED",
      "signaturePattern": "ECONNREFUSED *:*",
      "description": "Service connection refused",
      "suggestedFix": "服务可能未完全启动，尝试增加 healthcheck.startPeriod",
      "confidence": 0.5,
      "occurrences": 3,
      "resolutions": 1,
      "source": "built-in",
      "firstSeenAt": "2026-02-26T10:00:00.000Z",
      "lastSeenAt": "2026-02-26T12:00:00.000Z"
    },
    "suggestedFix": "服务可能未完全启动，尝试增加 healthcheck.startPeriod",
    "confidence": 0.5,
    "fixHistory": [
      {
        "id": "fix-001",
        "patternId": "builtin-conn-refused",
        "runId": "run-abc",
        "caseName": "health-check",
        "fixDescription": "Increased startPeriod to 30s",
        "success": true,
        "createdAt": "2026-02-25T14:00:00.000Z"
      }
    ],
    "isNewPattern": false
  },
  "timestamp": 1740000000000
}
```

### Success Response (No Pattern Match — New Pattern Created)

```json
{
  "success": true,
  "data": {
    "category": "UNKNOWN",
    "signature": "f1e2d3c4b5a6...",
    "signaturePattern": "UNKNOWN::api-test::unexpected error <HASH>",
    "pattern": null,
    "suggestedFix": null,
    "confidence": null,
    "fixHistory": [],
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
| `CASE_NOT_FAILED` | The specified case did not fail (status is `passed` or `skipped`) |
| `INTERNAL_ERROR` | Unexpected error during diagnostic workflow |

```json
{
  "success": false,
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "Test run 'run-xyz' not found in history"
  },
  "timestamp": 1740000000000
}
```

---

## Handler Implementation

```typescript
// packages/mcp/src/tools/diagnose.ts

export interface DiagnoseParams {
  projectPath: string;
  runId: string;
  caseName: string;
}

export async function handleDiagnose(
  params: DiagnoseParams,
  sessionManager: SessionManager,
): Promise<DiagnosticResult>;
```

### Workflow

1. **Resolve session** — `sessionManager.getOrThrow(projectPath)`
2. **Validate history** — Ensure `session.historyStore` and `session.knowledgeStore` exist
3. **Fetch run + case** — `historyStore.getRunById(runId)`, find case by `caseName`
4. **Validate case failed** — `case.status === 'failed'` and `case.error` is non-null
5. **Build FailureEvent** — Extract error, status code, container info from case + diagnostics
6. **Classify** — `classifier.classify(event)` → `FailureCategory`
7. **Normalize + Sign** — `normalizer.generateSignature(category, caseName, error)` → SHA-256 hash
8. **Match** — `knowledgeStore.findBySignature(signature)`
9. **If match found** — Increment occurrences, return pattern + fix + confidence + history
10. **If no match** — Auto-create new pattern (FR-008), return `isNewPattern: true`
11. **Return DiagnosticResult**

### Performance

Target: <2 seconds per invocation (SC-006). Expected: <50ms (SQLite indexed lookup + in-memory classification).

---

## Acceptance Test Mapping

| Spec Scenario | Verification |
|---------------|-------------|
| US4-1: Failed case matches known pattern | Response includes category, patternId, suggestedFix, confidence, fixHistory |
| US4-2: Failed case matches no pattern | Response has `pattern: null`, `isNewPattern: true`, new pattern in DB |
| US4-3: Invalid runId or caseName | Returns appropriate error code |
