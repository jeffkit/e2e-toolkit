# Research: Intelligent Diagnostics & Suggestions

**Feature**: 005-diagnostics  
**Date**: 2026-02-26

---

## Decision 1: Failure Classification Architecture

**Chosen**: Chain of Responsibility pattern with ordered rule array

**Rationale**: The spec requires an ordered chain where the first matching rule determines the category (FR-002). A simple array of `ClassificationRule` objects provides:
- Deterministic evaluation order (first match wins)
- O(n) worst-case per classification (n = number of rules, typically ~15)
- Trivial extensibility — push a new rule onto the array (FR-003)
- No complex inheritance hierarchy; composition-first approach aligns with TypeScript best practices

Each rule implements a minimal interface:

```typescript
interface ClassificationRule {
  name: string;
  category: FailureCategory;
  match(event: FailureEvent): boolean;
}
```

The classifier iterates rules in order. If no rule matches, it returns `UNKNOWN`.

**Alternatives considered**:
- **Decision tree** — More complex to maintain, harder to extend dynamically, over-engineered for ~15 rules
- **Machine learning classifier** — Adds external dependency, requires training data, violates constitution principle of minimal dependencies; overkill for pattern-based matching
- **Map-based lookup** — Cannot express complex conditions (e.g., multi-field matching, regex patterns)

**Trade-offs**:
- (+) Simple, testable, extensible
- (+) Deterministic — same input always produces same category
- (-) Linear scan per classification — acceptable for <20 rules; if rules grow to hundreds, could add indexing by error code prefix

---

## Decision 2: Error Normalization Strategy

**Chosen**: Regex-based normalization pipeline with ordered replacement rules

**Rationale**: The spec requires normalizing dynamic parts of error messages (FR-015): HTTP paths, status codes, IPs, ports, timestamps, and UUIDs. A pipeline of regex replacements applied sequentially is:
- Deterministic and reproducible
- Easy to test each normalizer independently
- Extensible by adding new regex rules

Normalization rules (applied in order):

| Pattern | Replacement | Example |
|---------|-------------|---------|
| UUID v4 | `<UUID>` | `a1b2c3d4-...` → `<UUID>` |
| ISO timestamps | `<TIMESTAMP>` | `2026-02-26T10:30:00Z` → `<TIMESTAMP>` |
| IP addresses | `<IP>` | `192.168.1.1` → `<IP>` |
| Port numbers (in context) | `<PORT>` | `:3000` → `:<PORT>` |
| HTTP paths with segments | Path class | `/api/users/123` → `/api/users/<ID>` |
| HTTP status codes | Class level | `500` → `5xx`, `404` → `4xx` |
| Numeric IDs (standalone) | `<ID>` | `id=42` → `id=<ID>` |
| Hex hashes (8+ chars) | `<HASH>` | `a1b2c3d4e5f6` → `<HASH>` |

**Alternatives considered**:
- **AST-based parsing** — Error messages are free-text, not structured enough for AST
- **Tokenization + dictionary** — More complex, requires maintaining a token dictionary
- **LLM-based normalization** — Adds latency, non-deterministic, requires API key

**Trade-offs**:
- (+) Fast, deterministic, zero external dependencies
- (+) Each normalizer is independently testable
- (-) May over-normalize or under-normalize edge cases; mitigated by ordering rules carefully and providing escape hatches

---

## Decision 3: Signature Generation Algorithm

**Chosen**: SHA-256 hash of `category::caseName::normalizedError`

**Rationale**: The spec requires a deterministic failure signature (FR-004). SHA-256 provides:
- Deterministic output for identical input
- Negligible collision probability for our scale (thousands of patterns, not billions)
- Available in Node.js `crypto` module — no external dependency
- 64-char hex string is readable and suitable for database indexing

The signature input string format: `${category}::${caseName}::${normalizedError}`

Using `::` as delimiter avoids ambiguity with common error message characters.

**Alternatives considered**:
- **MD5** — Faster but cryptographically broken; no practical benefit for our use case
- **xxHash/MurmurHash** — Faster but not in Node.js stdlib; would add dependency
- **Raw normalized string as key** — Too long for efficient indexing; variable length

**Trade-offs**:
- (+) No external dependencies (Node.js `crypto`)
- (+) Fixed-length output (64 chars) for consistent DB indexing
- (-) ~2x slower than non-cryptographic hashes — irrelevant at our scale (<1ms per hash)

---

## Decision 4: Knowledge Base Storage

**Chosen**: New tables in the existing SQLite database (same DB file as history)

**Rationale**: The spec explicitly requires persistence using the existing persistence layer (FR-013). The history subsystem already uses `better-sqlite3` with WAL mode and a migration system (`user_version` pragma). Adding new tables via migration version 2 is the natural path:

- Reuses existing DB connection setup and WAL/synchronous pragmas
- Shares the same `createHistoryStore` factory pattern (extended for knowledge)
- Atomic operations via SQLite transactions (handles concurrent fix reports per edge case)
- The `applyMigrations` function already supports sequential versioned migrations

Two new tables:
1. **`failure_patterns`** — Core pattern entity (category, signature, description, fix, confidence, counts)
2. **`fix_history`** — Individual fix records linked to patterns via foreign key

**Alternatives considered**:
- **Separate SQLite file** — Unnecessary complexity; the knowledge base conceptually belongs with test history
- **JSON file** — No transaction support, no query capability, problematic for concurrent access
- **External database (PostgreSQL)** — Violates zero-dependency principle and complicates deployment

**Trade-offs**:
- (+) Zero new dependencies
- (+) Atomic transactions for concurrent fix reports
- (+) Shares existing infrastructure (WAL mode, migration system)
- (-) Couples knowledge base lifecycle to history store lifecycle — acceptable since they're semantically related

---

## Decision 5: Confidence Score Calculation

**Chosen**: Empirical success rate with Laplace smoothing

**Rationale**: The spec defines confidence as reflecting the resolution rate (User Story 2, scenario 2). A simple empirical formula with Laplace smoothing avoids over-confidence on small samples:

```
confidence = (resolutions + α) / (occurrences + α + β)
```

Where:
- `α = 1` (pseudo-successes) — provides optimistic prior for built-in patterns
- `β = 1` (pseudo-failures) — prevents confidence from reaching 1.0

For built-in patterns with 0 occurrences: `confidence = 1 / 2 = 0.5` (reasonable starting point per acceptance scenario 1).

For a pattern with 5 occurrences, 4 resolutions: `confidence = (4 + 1) / (5 + 2) = 0.71` (reflects the 80% rate with slight regression toward mean).

**Alternatives considered**:
- **Raw ratio (resolutions/occurrences)** — Division by zero for new patterns; 100% confidence after one success is misleading
- **Wilson score interval** — More statistically rigorous but over-complex for this use case
- **Bayesian beta distribution** — Elegant but harder to explain to users; same practical outcome for our data scale

**Trade-offs**:
- (+) Simple formula, easy to explain and debug
- (+) Handles zero-data case gracefully (built-in patterns start at 0.5)
- (+) Naturally degrades confidence for rarely-seen patterns
- (-) Less statistically rigorous than Wilson/Beta — acceptable for operational context

---

## Decision 6: Module Architecture

**Chosen**: New `packages/core/src/knowledge/` directory with focused modules

**Rationale**: Following the existing patterns in the codebase (e.g., `history/`, `resilience/`), a dedicated `knowledge/` directory provides:
- Clear separation of concerns
- Independent testability per module
- Clean public API via `index.ts` re-exports

Module breakdown:

| Module | Responsibility |
|--------|---------------|
| `types.ts` | FailureCategory enum, interfaces (FailurePattern, FixRecord, DiagnosticResult, ClassificationRule, FailureEvent) |
| `classifier.ts` | FailureClassifier class with rule chain, built-in rules |
| `normalizer.ts` | Error normalization pipeline, signature generation |
| `knowledge-store.ts` | KnowledgeStore interface + SQLiteKnowledgeStore + NoopKnowledgeStore |
| `built-in-patterns.ts` | Seed data for 6+ built-in failure patterns |
| `diagnostics-engine.ts` | DiagnosticsEngine orchestrator (classify → sign → match → suggest) |
| `index.ts` | Public API re-exports |

MCP tools in `packages/mcp/src/tools/`:
- `diagnose.ts` — `argus_diagnose` handler
- `report-fix.ts` — `argus_report_fix` handler
- `patterns.ts` — `argus_patterns` handler

**Alternatives considered**:
- **Single file** — Too large; would exceed 500 lines, hard to test
- **Flat files in `src/`** — Inconsistent with codebase conventions (history/ and resilience/ use directories)

---

## Decision 7: Built-in Pattern Set

**Chosen**: 6 built-in patterns covering the spec's minimum requirements (FR-006)

| Category | Signature Pattern | Suggested Fix |
|----------|------------------|---------------|
| CONNECTION_REFUSED | `ECONNREFUSED *:*` | 服务可能未完全启动，尝试增加 healthcheck.startPeriod |
| TIMEOUT | `ETIMEDOUT / timeout exceeded` | 请求超时，检查服务响应时间或增加 timeout 配置 |
| CONTAINER_OOM | `OOMKilled = true` | 容器内存不足，增加 container memory limit 或优化内存使用 |
| HTTP_ERROR | `returned 5xx` | 服务端错误，检查容器日志定位 root cause |
| MOCK_MISMATCH | `mock.*unexpected request` | Mock 服务收到未预期请求，检查 mock routes 配置是否完整 |
| ASSERTION_MISMATCH | `expected .* (to equal\|to match\|to be)` | 断言失败，检查测试期望值或服务返回值是否正确 |

Built-in patterns are seeded on first DB initialization (migration version 2). They have `source: 'built-in'` and are not deleted during cleanup.

---

## Decision 8: Graceful Degradation

**Chosen**: Classification-only fallback when knowledge base is unavailable

**Rationale**: Per the edge case spec, when storage is unavailable, the system falls back to classification-only mode. This is implemented by:
1. The `DiagnosticsEngine` catches storage errors during pattern matching
2. Returns a `DiagnosticResult` with category and signature but `pattern: null`
3. Logs the storage error via the existing logging mechanism
4. Does not throw — the diagnostic result is still useful without historical context

This mirrors the existing `NoopHistoryStore` pattern used when history is disabled.
