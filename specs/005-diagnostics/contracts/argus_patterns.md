# MCP Tool Contract: argus_patterns

**Tool Number**: 18 (of 18)  
**Priority**: P3 (User Story 6)

---

## Overview

Browses all failure patterns in the knowledge base. Returns a list of patterns with their categories, signature patterns, occurrence/resolution counts, confidence scores, and timestamps. Supports optional filtering by category.

---

## Tool Registration

```typescript
server.tool(
  'argus_patterns',
  {
    projectPath: z.string().describe('Project path (must have active session with history enabled)'),
    category: z.enum([
      'ASSERTION_MISMATCH', 'HTTP_ERROR', 'TIMEOUT', 'CONNECTION_REFUSED',
      'CONTAINER_OOM', 'CONTAINER_CRASH', 'MOCK_MISMATCH', 'CONFIG_ERROR',
      'NETWORK_ERROR', 'UNKNOWN',
    ]).optional().describe('Filter patterns by failure category'),
    source: z.enum(['built-in', 'learned']).optional().describe('Filter by pattern source'),
    sortBy: z.enum(['confidence', 'occurrences', 'lastSeen']).optional().default('occurrences')
      .describe('Sort order for results'),
  },
  async (params) => { /* handler */ },
);
```

---

## Input Schema (Zod)

```typescript
{
  projectPath: z.string(),
  category: z.enum([...FailureCategory values]).optional(),
  source: z.enum(['built-in', 'learned']).optional(),
  sortBy: z.enum(['confidence', 'occurrences', 'lastSeen']).optional().default('occurrences'),
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectPath` | string | Yes | — | Absolute path to project directory |
| `category` | FailureCategory | No | — | Filter to a specific failure category |
| `source` | `'built-in' \| 'learned'` | No | — | Filter by pattern origin |
| `sortBy` | enum | No | `'occurrences'` | Sort criterion |

---

## Output Schema

### Success Response

```json
{
  "success": true,
  "data": {
    "patterns": [
      {
        "id": "builtin-conn-refused",
        "category": "CONNECTION_REFUSED",
        "signaturePattern": "ECONNREFUSED *:*",
        "description": "Service connection refused",
        "suggestedFix": "服务可能未完全启动，尝试增加 healthcheck.startPeriod",
        "confidence": 0.67,
        "occurrences": 5,
        "resolutions": 3,
        "source": "built-in",
        "firstSeenAt": "2026-02-20T10:00:00.000Z",
        "lastSeenAt": "2026-02-26T12:00:00.000Z"
      },
      {
        "id": "pat-learned-001",
        "category": "HTTP_ERROR",
        "signaturePattern": "HTTP_ERROR::api-test::POST /api/<ID> returned 5xx",
        "description": "API endpoint returning server error",
        "suggestedFix": "服务端错误，检查容器日志定位 root cause",
        "confidence": 0.5,
        "occurrences": 2,
        "resolutions": 1,
        "source": "learned",
        "firstSeenAt": "2026-02-24T08:00:00.000Z",
        "lastSeenAt": "2026-02-26T09:00:00.000Z"
      }
    ],
    "total": 8,
    "builtInCount": 6,
    "learnedCount": 2
  },
  "timestamp": 1740000000000
}
```

### Success Response (Filtered)

```json
{
  "success": true,
  "data": {
    "patterns": [
      {
        "id": "builtin-timeout",
        "category": "TIMEOUT",
        "signaturePattern": "ETIMEDOUT / timeout exceeded",
        "description": "Request or operation timed out",
        "suggestedFix": "请求超时，检查服务响应时间或增加 timeout 配置",
        "confidence": 0.5,
        "occurrences": 0,
        "resolutions": 0,
        "source": "built-in",
        "firstSeenAt": "2026-02-26T00:00:00.000Z",
        "lastSeenAt": "2026-02-26T00:00:00.000Z"
      }
    ],
    "total": 1,
    "builtInCount": 1,
    "learnedCount": 0
  },
  "timestamp": 1740000000000
}
```

### Error Responses

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session for `projectPath` |
| `HISTORY_DISABLED` | History/knowledge base not enabled in config |
| `INTERNAL_ERROR` | Unexpected error querying knowledge base |

---

## Handler Implementation

```typescript
// packages/mcp/src/tools/patterns.ts

export interface PatternsParams {
  projectPath: string;
  category?: FailureCategory;
  source?: 'built-in' | 'learned';
  sortBy?: 'confidence' | 'occurrences' | 'lastSeen';
}

export interface PatternsResult {
  patterns: FailurePattern[];
  total: number;
  builtInCount: number;
  learnedCount: number;
}

export async function handlePatterns(
  params: PatternsParams,
  sessionManager: SessionManager,
): Promise<PatternsResult>;
```

### Workflow

1. **Resolve session** — `sessionManager.getOrThrow(projectPath)`
2. **Validate store** — Ensure `knowledgeStore` exists
3. **Query patterns**:
   - If `category` specified → `knowledgeStore.findByCategory(category)`
   - Otherwise → `knowledgeStore.getAllPatterns()`
4. **Filter by source** (if specified)
5. **Sort** by the requested criterion (descending)
6. **Count** built-in vs learned patterns
7. **Return** full pattern list with counts

---

## Acceptance Test Mapping

| Spec Scenario | Verification |
|---------------|-------------|
| US6-1: 6 built-in + 2 learned | All 8 returned with complete metadata |
| US6-2: Filter by TIMEOUT | Only TIMEOUT patterns returned |
