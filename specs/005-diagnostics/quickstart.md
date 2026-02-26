# Quickstart: Intelligent Diagnostics & Suggestions

**Feature**: 005-diagnostics  
**Date**: 2026-02-26

---

## Prerequisites

- ArgusAI project initialized with `argus_init`
- History enabled in `e2e.yaml` (required for knowledge base persistence):

```yaml
history:
  enabled: true
  storage: local
  retention:
    maxAge: 90d
    maxRuns: 500
  flakyWindow: 10
```

The knowledge base tables are automatically created in the same SQLite database used by history on first access (migration version 2).

---

## Setup

No additional setup is required. The diagnostics subsystem initializes automatically when a session is created with history enabled. Built-in patterns (6 patterns covering common failure types) are seeded during database migration.

---

## Usage: Diagnose a Failure

After a test run produces failures, use `argus_diagnose` to get structured diagnostic information:

```
Tool: argus_diagnose
Input:
  projectPath: "/path/to/my-project"
  runId: "run-2026-02-26-001"
  caseName: "health-check"
```

### Example Response (Known Pattern Match)

```json
{
  "category": "CONNECTION_REFUSED",
  "signature": "a1b2c3d4...",
  "signaturePattern": "CONNECTION_REFUSED::health-check::ECONNREFUSED <IP>:<PORT>",
  "pattern": {
    "id": "builtin-conn-refused",
    "suggestedFix": "服务可能未完全启动，尝试增加 healthcheck.startPeriod",
    "confidence": 0.67,
    "occurrences": 5,
    "resolutions": 3
  },
  "suggestedFix": "服务可能未完全启动，尝试增加 healthcheck.startPeriod",
  "confidence": 0.67,
  "fixHistory": [
    {
      "fixDescription": "Increased startPeriod from 10s to 30s",
      "success": true,
      "createdAt": "2026-02-25T14:00:00Z"
    }
  ],
  "isNewPattern": false
}
```

### Example Response (New/Unknown Failure)

```json
{
  "category": "UNKNOWN",
  "signature": "f1e2d3c4...",
  "signaturePattern": "UNKNOWN::api-test::unexpected error in module <HASH>",
  "pattern": null,
  "suggestedFix": null,
  "confidence": null,
  "fixHistory": [],
  "isNewPattern": true
}
```

---

## Usage: Report a Fix

After the Agent fixes a failure and the re-run passes, report the fix to improve future suggestions:

```
Tool: argus_report_fix
Input:
  projectPath: "/path/to/my-project"
  runId: "run-2026-02-26-001"
  caseName: "health-check"
  fixDescription: "Increased healthcheck.startPeriod from 10s to 30s in e2e.yaml"
```

### Example Response

```json
{
  "patternId": "builtin-conn-refused",
  "category": "CONNECTION_REFUSED",
  "previousConfidence": 0.67,
  "updatedConfidence": 0.71,
  "occurrences": 5,
  "resolutions": 4,
  "fixRecordId": "fix-004",
  "isNewPattern": false
}
```

---

## Usage: Browse Knowledge Base

View all failure patterns to understand diagnostic coverage:

```
Tool: argus_patterns
Input:
  projectPath: "/path/to/my-project"
```

Filter by category:

```
Tool: argus_patterns
Input:
  projectPath: "/path/to/my-project"
  category: "TIMEOUT"
```

---

## Typical Agent Workflow

```
1. Agent calls argus_run → test fails
2. Agent calls argus_diagnose(runId, caseName)
   → Gets category, suggestedFix, confidence
3. Agent applies the suggested fix (or reasons about it)
4. Agent calls argus_run again → test passes
5. Agent calls argus_report_fix(runId, caseName, "what I did")
   → Knowledge base updated, confidence improved
6. Next time same failure occurs → higher confidence, better suggestion
```

---

## Integration Testing Scenarios

### Scenario 1: Built-in Pattern Match

1. Start a project with a service that is intentionally down
2. Run tests → `health-check` fails with `ECONNREFUSED`
3. Call `argus_diagnose` → expect `CONNECTION_REFUSED` category, built-in pattern match
4. Verify `suggestedFix` mentions `healthcheck.startPeriod`

### Scenario 2: Feedback Loop

1. Trigger a failure that matches a built-in pattern
2. Call `argus_diagnose` → note the `confidence`
3. Fix the issue, re-run tests → pass
4. Call `argus_report_fix` → verify `updatedConfidence > previousConfidence`
5. Call `argus_patterns` → verify pattern's `resolutions` incremented

### Scenario 3: New Pattern Learning

1. Trigger a failure with a unique error message
2. Call `argus_diagnose` → expect `isNewPattern: true`
3. Fix the issue, report via `argus_report_fix`
4. Trigger the same failure again
5. Call `argus_diagnose` → expect to match the learned pattern from step 2

### Scenario 4: Graceful Degradation

1. Initialize project with `history.storage: 'memory'` (no SQLite)
2. Run tests → failure occurs
3. Call `argus_diagnose` → should still return `category` and `signature`
4. Pattern matching returns `null` (no persistence), but classification works

---

## Module Overview

```
packages/core/src/knowledge/
├── types.ts              # FailureCategory, interfaces
├── classifier.ts         # Rule chain classifier
├── normalizer.ts         # Error normalization + signature generation
├── knowledge-store.ts    # KnowledgeStore interface + SQLite implementation
├── built-in-patterns.ts  # 6 seed patterns
├── diagnostics-engine.ts # Orchestrator (classify → sign → match → suggest)
└── index.ts              # Public API

packages/mcp/src/tools/
├── diagnose.ts           # argus_diagnose handler
├── report-fix.ts         # argus_report_fix handler
└── patterns.ts           # argus_patterns handler
```
