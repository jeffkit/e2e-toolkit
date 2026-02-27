# Tasks: Intelligent Diagnostics & Suggestions

**Input**: Design documents from `/specs/005-diagnostics/`  
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/, research.md, quickstart.md  
**Branch**: `005-diagnostics` | **Generated**: 2026-02-27

**Organization**: Tasks are grouped by user story (6 stories from spec.md) to enable independent implementation and testing. P1 stories (US1, US2, US4) share foundational dependencies but US1+US2 core logic can proceed in parallel after types are defined. P2 stories (US3, US5) depend on the full diagnostic pipeline. P3 (US6) is a read-only view.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US6)
- All paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure for the new knowledge base subsystem and test directories

- [X] T001 Create `packages/core/src/knowledge/` directory and initial barrel export file `packages/core/src/knowledge/index.ts`
- [X] T002 [P] Create test directory `packages/core/tests/unit/knowledge/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, interfaces, and database migration that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Define `FailureCategory` type union (10 categories: `ASSERTION_MISMATCH`, `HTTP_ERROR`, `TIMEOUT`, `CONNECTION_REFUSED`, `CONTAINER_OOM`, `CONTAINER_CRASH`, `MOCK_MISMATCH`, `CONFIG_ERROR`, `NETWORK_ERROR`, `UNKNOWN`), `FailureEvent` interface (runId, caseName, suiteId, error, status, containerStatus, oomKilled, diagnostics), `ClassificationRule` interface (name, category, match), `FailurePattern` interface, `FixRecord` interface, `DiagnosticResult` interface, `ReportFixResult` interface (patternId, category, previousConfidence, updatedConfidence, occurrences, resolutions, fixRecordId, isNewPattern), and `KnowledgeStore` interface (findBySignature, findByCategory, findBySource, getAllPatterns, createPattern, incrementOccurrences, recordFix, getFixHistory, updateConfidence, close) in `packages/core/src/knowledge/types.ts`
- [X] T004 Add database migration version 2 to the `MIGRATIONS` array in `packages/core/src/history/migrations.ts` — creates `failure_patterns` table (id, category, signature UNIQUE, signature_pattern, description, suggested_fix, confidence, occurrences, resolutions, source, first_seen_at, last_seen_at, created_at, updated_at) with CHECK constraints and indexes (idx_patterns_signature, idx_patterns_category, idx_patterns_source), creates `fix_history` table (id, pattern_id FK, run_id, case_name, fix_description, success, created_at) with indexes (idx_fix_history_pattern, idx_fix_history_run), and inserts 6 built-in seed patterns via `INSERT OR IGNORE`
- [X] T005 [P] Re-export all knowledge types from `packages/core/src/knowledge/index.ts`

**Checkpoint**: Foundation ready — types defined, DB schema migrated with seed data. User story implementation can now begin.

---

## Phase 3: US1 — Automatic Failure Classification (Priority: P1) 🎯 MVP

**Goal**: Automatically classify each test failure into one of 10 defined categories using an ordered chain of rules. The first matching rule determines the category; unmatched failures are classified as `UNKNOWN`.

**Independent Test**: Trigger known failure types (e.g., `ECONNREFUSED`, HTTP 500, OOMKilled) and verify the system assigns the correct category.

### Implementation for User Story 1

- [X] T006 [US1] Implement `FailureClassifier` class with `classify(event: FailureEvent): FailureCategory` method in `packages/core/src/knowledge/classifier.ts` — accepts an ordered array of `ClassificationRule` via constructor, iterates rules in order (first match wins), returns `UNKNOWN` if no rule matches
- [X] T007 [US1] Implement 10 built-in classification rules as `ClassificationRule` objects in `packages/core/src/knowledge/classifier.ts` — ordered most-specific-first: (1) container-oom: `oomKilled === true` OR error contains `OOMKilled`, (2) container-crash: containerStatus is `exited`/`dead` AND not OOM, (3) connection-refused: error contains `ECONNREFUSED`, (4) timeout: error contains `ETIMEDOUT`/`timeout`/`ESOCKETTIMEDOUT`, (5) network-error: error contains `ENOTFOUND`/`EAI_AGAIN`/`ENETUNREACH`, (6) http-5xx: status 500-599, (7) http-4xx: status 400-499, (8) mock-mismatch: error contains `mock` AND (`unexpected` OR `unmatched`), (9) config-error: error contains `config`/`YAML`/`validation`/`schema`, (10) assertion-mismatch: error contains `expected`/`to equal`/`to match`/`AssertionError`
- [X] T008 [US1] Export `FailureClassifier` and `createDefaultClassifier()` factory from `packages/core/src/knowledge/classifier.ts`, re-export from `packages/core/src/knowledge/index.ts`

### Tests for User Story 1

- [X] T009 [P] [US1] Write unit tests in `packages/core/tests/unit/knowledge/classifier.test.ts` covering: each of the 10 classification rules with matching input, multi-indicator priority (timeout AND connection refused → first matching rule wins), `UNKNOWN` fallback when no rule matches, custom rule injection via constructor — target 90%+ coverage

**Checkpoint**: US1 complete — all failure types are classified into structured categories. AI Agents get consistent failure taxonomy.

---

## Phase 4: US2 — Historical Fix Suggestions (Priority: P1)

**Goal**: Generate deterministic failure signatures by normalizing error messages, match against the knowledge base for historical patterns, and return suggested fixes with confidence scores. Auto-create new pattern entries for unknown failures.

**Independent Test**: Pre-load knowledge base with built-in patterns, trigger a matching failure, verify the system returns the correct suggested fix and confidence score.

### Implementation for User Story 2

- [X] T010 [US2] Implement `normalizeError(error: string): string` function in `packages/core/src/knowledge/normalizer.ts` — apply 8 ordered regex replacements per data-model.md normalization rules: (1) UUID → `<UUID>`, (2) ISO timestamps → `<TIMESTAMP>`, (3) IP addresses → `<IP>`, (4) port numbers → `:<PORT>`, (5) hex hashes → `/<HASH>/`, (6) HTTP status codes → class level (e.g., `5xx`), (7) path segments with numeric IDs → `/<ID>`, (8) standalone large numbers → `<NUM>`
- [X] T011 [US2] Implement `generateSignature(category: FailureCategory, caseName: string, error: string): { signature: string; signaturePattern: string }` function in `packages/core/src/knowledge/normalizer.ts` — normalizes the error, constructs `${category}::${caseName}::${normalizedError}` pattern string, computes SHA-256 hash via `node:crypto`, returns both the hash (signature) and the human-readable pattern string (signaturePattern)
- [X] T012 [US2] Implement `SQLiteKnowledgeStore` class in `packages/core/src/knowledge/knowledge-store.ts` — implements `KnowledgeStore` interface using `better-sqlite3`, methods: `findBySignature(signature)` with indexed lookup, `findByCategory(category)`, `getAllPatterns()`, `createPattern(pattern)` generating UUID v4, `incrementOccurrences(patternId)` updating lastSeenAt and updatedAt, `recordFix(fix)` inserting into fix_history, `getFixHistory(patternId, limit=10)` ordered by created_at DESC, `updateConfidence(patternId, confidence)` updating updatedAt, `close()` — all mutations wrapped in transactions
- [X] T013 [US2] Implement `NoopKnowledgeStore` class in `packages/core/src/knowledge/knowledge-store.ts` — returns null/empty for all queries, no-ops for all mutations (used when history is disabled, mirrors existing `NoopHistoryStore` pattern)
- [X] T014 [US2] Define 6 built-in pattern data objects in `packages/core/src/knowledge/built-in-patterns.ts` — CONNECTION_REFUSED, TIMEOUT, CONTAINER_OOM, HTTP_ERROR, MOCK_MISMATCH, ASSERTION_MISMATCH per seed data in data-model.md; export as `BUILT_IN_PATTERNS: FailurePattern[]` for use in tests and validation
- [X] T015 [US2] Implement `DiagnosticsEngine` class in `packages/core/src/knowledge/diagnostics-engine.ts` — constructor takes `FailureClassifier` + `KnowledgeStore`; method `diagnose(event: FailureEvent): DiagnosticResult` orchestrates: (1) classify → category, (2) normalize + sign → signature + signaturePattern, (3) `knowledgeStore.findBySignature(signature)` → pattern match, (4) **if no exact match: fallback to `knowledgeStore.findByCategory(category)` filtered to `source='built-in'` to match built-in patterns by category** (resolves C1: built-in patterns have fixed signatures that don't match SHA-256 hashes), (5) if match found (exact or category fallback): `incrementOccurrences`, return pattern + suggestedFix + confidence + fixHistory, (6) if no match at all: `createPattern` with source=`'learned'`, occurrences=1, return `isNewPattern: true`; method `reportFix(event: FailureEvent, fixDescription: string, success: boolean): ReportFixResult` orchestrates: (1) classify + sign, (2) find or create pattern, (3) `recordFix`, (4) if success: increment resolutions + `recalculateConfidence`, (5) return updated stats; graceful degradation: catch storage errors → return classification-only result with `pattern: null`
- [X] T016 [US2] Export `normalizeError`, `generateSignature`, `SQLiteKnowledgeStore`, `NoopKnowledgeStore`, `DiagnosticsEngine`, and `BUILT_IN_PATTERNS` from `packages/core/src/knowledge/index.ts`

### Tests for User Story 2

- [X] T017 [P] [US2] Write unit tests in `packages/core/tests/unit/knowledge/normalizer.test.ts` covering: each of the 8 normalization rules individually, combined normalization of complex error strings, `generateSignature` determinism (same input → same hash), different inputs → different hashes, signature pattern readability — target 90%+ coverage
- [X] T018 [P] [US2] Write unit tests in `packages/core/tests/unit/knowledge/knowledge-store.test.ts` covering: `SQLiteKnowledgeStore` CRUD operations (create, find by signature, find by category, get all), `incrementOccurrences` updates counts and timestamps, `recordFix` + `getFixHistory` with limit, `updateConfidence` range validation, `NoopKnowledgeStore` returns null/empty for all operations — target 90%+ coverage using in-memory SQLite
- [X] T019 [P] [US2] Write unit tests in `packages/core/tests/unit/knowledge/built-in-patterns.test.ts` covering: exactly 6 built-in patterns, each has required fields (id, category, signature, signaturePattern, description, suggestedFix), all categories from FR-006 are covered, source is `'built-in'` for all
- [X] T020 [P] [US2] Write unit tests in `packages/core/tests/unit/knowledge/diagnostics-engine.test.ts` covering: full `diagnose` workflow (classify → sign → match → suggest), known pattern match returns suggestedFix + confidence + fixHistory, unknown failure creates new pattern with `isNewPattern: true`, `reportFix` updates resolutions + confidence (Laplace smoothing verification), graceful degradation on storage error returns category-only result — target 90%+ coverage

**Checkpoint**: US1 + US2 complete — failures are classified, signatures generated, patterns matched, and fixes suggested. The core diagnostic pipeline is operational.

---

## Phase 5: US4 — MCP Tool: Diagnose Failure (Priority: P1)

**Goal**: Expose `argus_diagnose` MCP tool that accepts a run ID and case name, performs the full diagnostic workflow, and returns structured results. This is the primary Agent-facing interface.

**Independent Test**: Invoke `argus_diagnose` for a failed test case and verify the response contains category, signature, pattern match, suggestion, and confidence.

### Implementation for User Story 4

- [X] T021 [US4] Add `knowledgeStore: KnowledgeStore | null` field to `ProjectSession` interface in `packages/mcp/src/session.ts`; initialize `SQLiteKnowledgeStore` (reusing the existing history DB connection) when `history.enabled` is true in session creation, `NoopKnowledgeStore` otherwise; call `knowledgeStore.close()` in session destroy
- [X] T022 [US4] Implement `handleDiagnose(params, sessionManager)` handler in `packages/mcp/src/tools/diagnose.ts` — validate session exists, history/knowledge stores are available, fetch run + case from historyStore, validate case is failed, build `FailureEvent` from case data (extract error, status, containerStatus, oomKilled from case and diagnostics), call `diagnosticsEngine.diagnose(event)`, format and return `DiagnosticResult` with success/error envelope per contract; error codes: `SESSION_NOT_FOUND`, `HISTORY_DISABLED`, `RUN_NOT_FOUND`, `CASE_NOT_FOUND`, `CASE_NOT_FAILED`, `INTERNAL_ERROR`
- [X] T023 [US4] Register `argus_diagnose` tool with Zod parameter schema (`projectPath: z.string()`, `runId: z.string()`, `caseName: z.string()`) in `packages/mcp/src/server.ts` (tool 16 of 18)

**Checkpoint**: US4 complete — AI Agents can call `argus_diagnose` to get structured failure analysis.

---

## Phase 6: US3 + US5 — Fix Feedback Loop & Report Fix Tool (Priority: P2)

**Goal**: Enable AI Agents to report fixes back to the knowledge base, updating pattern statistics and confidence. The feedback loop transforms the knowledge base from a static reference into a self-improving system.

**Independent Test**: Report a fix for a known failure pattern and verify the pattern's resolution count, confidence, and fix history are updated correctly.

### Implementation for User Stories 3 & 5

- [X] T024 [US3] [US5] Implement `handleReportFix(params, sessionManager)` handler in `packages/mcp/src/tools/report-fix.ts` — validate session + stores, fetch run + case from historyStore, build `FailureEvent`, call `diagnosticsEngine.reportFix(event, fixDescription, success)`, return `ReportFixResult` with patternId, category, previousConfidence, updatedConfidence, occurrences, resolutions, fixRecordId, isNewPattern per contract; error codes: `SESSION_NOT_FOUND`, `HISTORY_DISABLED`, `RUN_NOT_FOUND`, `CASE_NOT_FOUND`, `INTERNAL_ERROR`
- [X] T025 [US3] [US5] Register `argus_report_fix` tool with Zod parameter schema (`projectPath: z.string()`, `runId: z.string()`, `caseName: z.string()`, `fixDescription: z.string()`, `success: z.boolean().optional().default(true)`) in `packages/mcp/src/server.ts` (tool 17 of 18)

**Checkpoint**: US3 + US5 complete — AI Agents report fixes, knowledge base learns and improves confidence scores over time.

---

## Phase 7: US6 — MCP Tool: Browse Knowledge Base (Priority: P3)

**Goal**: Expose `argus_patterns` MCP tool for browsing all failure patterns with optional filtering by category and source, and configurable sort order. Provides transparency into the system's diagnostic coverage.

**Independent Test**: Call `argus_patterns` and verify it returns all patterns including built-in ones, with correct metadata and counts.

### Implementation for User Story 6

- [X] T026 [US6] Implement `handlePatterns(params, sessionManager)` handler in `packages/mcp/src/tools/patterns.ts` — validate session + knowledgeStore, query patterns (filtered by category if specified, filtered by source if specified), sort by `sortBy` parameter (confidence/occurrences/lastSeen descending), count built-in vs learned, return `PatternsResult` with patterns array + total + builtInCount + learnedCount per contract; error codes: `SESSION_NOT_FOUND`, `HISTORY_DISABLED`, `INTERNAL_ERROR`
- [X] T027 [US6] Register `argus_patterns` tool with Zod parameter schema (`projectPath: z.string()`, `category: z.enum([...]).optional()`, `source: z.enum(['built-in', 'learned']).optional()`, `sortBy: z.enum(['confidence', 'occurrences', 'lastSeen']).optional().default('occurrences')`) in `packages/mcp/src/server.ts` (tool 18 of 18)

**Checkpoint**: US6 complete — operators and Agents can browse and audit the full knowledge base.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, re-exports, and validation across all user stories

- [X] T028 Add `export * from './knowledge/index.js'` to `packages/core/src/index.ts` for public API surface
- [X] T029 [P] Re-export knowledge types (`FailureCategory`, `FailurePattern`, `FixRecord`, `DiagnosticResult`) from `packages/core/src/types.ts` for convenience access
- [X] T030 [P] Verify migration v2 executes cleanly on a fresh database AND on an existing v1 database — confirm 6 built-in patterns are present after migration, `failure_patterns` and `fix_history` tables have correct schema and indexes
- [X] T031 [P] Validate that when `history.enabled` is false, `NoopKnowledgeStore` is used and `argus_diagnose` returns `HISTORY_DISABLED` error gracefully
- [X] T032 [P] Run full knowledge test suite (`packages/core/tests/unit/knowledge/`) and verify 90%+ coverage for classifier.ts, normalizer.ts, knowledge-store.ts, diagnostics-engine.ts
- [X] T033 Verify MCP server registers exactly 18 tools total (15 existing + 3 new: argus_diagnose, argus_report_fix, argus_patterns) in `packages/mcp/src/server.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — can parallel with US2 type/normalizer work
- **US2 (Phase 4)**: Depends on Phase 2 — **BLOCKS US4** (diagnose tool needs full pipeline)
- **US4 (Phase 5)**: Depends on US1 + US2 — **BLOCKS US3+US5** (report-fix reuses diagnose infra)
- **US3+US5 (Phase 6)**: Depends on US4 (session + knowledgeStore integration)
- **US6 (Phase 7)**: Depends on US2 (knowledgeStore); can parallel with Phase 6
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
  └─→ Phase 2 (Foundational: types + migration)
        ├─→ Phase 3 (US1: Classifier) ──────────────┐
        └─→ Phase 4 (US2: Normalizer + Store + Engine) ─┤
                                                         └─→ Phase 5 (US4: argus_diagnose)
                                                               ├─→ Phase 6 (US3+US5: argus_report_fix) 
                                                               └─→ Phase 7 (US6: argus_patterns) [P]
                                                                     └─→ Phase 8 (Polish)
```

### Within Each User Story

1. Types/interfaces first (if story adds new types)
2. Core class implementation (constructor, main methods)
3. Integration with existing systems (session, MCP tools)
4. Barrel export update
5. Unit tests (can parallel with integration step)

### Parallel Opportunities

**Task-level parallelism** (within each phase):
- T001 + T002: Setup directories in parallel
- T003 + T005: Types definition + barrel export can overlap
- T017 + T018 + T019 + T020: All US2 test files are independent
- T028 + T029 + T030 + T031 + T032: Polish tasks touch different files

**Phase-level parallelism**:
- Phase 6 (US3+US5: report-fix) and Phase 7 (US6: patterns) can proceed in parallel once Phase 5 is complete
- US1 classifier implementation (T006-T008) can parallel with US2 normalizer (T010-T011) since they are independent modules

---

## Parallel Example: Core Module Development (Phases 3–4)

After Phase 2 (types + migration) is complete, classifier and normalizer can develop in parallel:

```text
Worker A: US1 — Classifier
  T006 → T007 → T008 + T009

Worker B: US2 — Normalizer + Store + Engine
  T010 → T011 → T012 → T013 → T014 → T015 → T016 + T017 + T018 + T019 + T020
```

## Parallel Example: MCP Tools (Phases 6–7)

After Phase 5 (argus_diagnose) is complete:

```text
Worker A: US3+US5 — Report Fix
  T024 → T025

Worker B: US6 — Browse Patterns
  T026 → T027
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US4 = Classification + Knowledge Base + Diagnose Tool)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — types + migration)
3. Complete Phase 3: US1 — Failure Classifier
4. Complete Phase 4: US2 — Normalizer + Knowledge Store + Engine
5. Complete Phase 5: US4 — `argus_diagnose` MCP tool
6. **STOP and VALIDATE**: Trigger known failures → verify classification + pattern matching + suggested fix. Trigger unknown failure → verify new pattern auto-created.
7. Deploy/demo if ready — AI Agents can now diagnose failures and get historical fix suggestions

### Incremental Delivery

1. Setup + Foundational + US1 + US2 + US4 → **MVP: Diagnose failures with fix suggestions** ✅
2. Add US3+US5 (Report Fix tool) → Knowledge base learns from Agent fixes ✅
3. Add US6 (Browse Patterns tool) → Operators can audit the knowledge base ✅
4. Polish → Final integration, coverage validation ✅

### Summary Table

| Phase | Story | Priority | Tasks | Parallel | Files Created | Files Modified |
|-------|-------|----------|-------|----------|---------------|----------------|
| 1 | Setup | — | 2 | 1 | 2 | 0 |
| 2 | Foundational | — | 3 | 1 | 1 | 1 |
| 3 | US1: Classifier | P1 | 4 | 1 | 1 | 1 |
| 4 | US2: Normalizer + Store + Engine | P1 | 11 | 4 | 4 | 1 |
| 5 | US4: Diagnose Tool | P1 | 3 | 0 | 1 | 2 |
| 6 | US3+US5: Report Fix | P2 | 2 | 0 | 1 | 1 |
| 7 | US6: Browse Patterns | P3 | 2 | 0 | 1 | 1 |
| 8 | Polish | — | 6 | 4 | 0 | 2 |
| **Total** | | | **33** | **11** | **11** | **~9** |

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase
- `[Story]` labels (US1–US6) map each task to its user story for traceability
- Each user story is independently completable and testable at its checkpoint
- Commit after each task or logical group within a story
- Stop at any checkpoint to validate the story independently
- Tests use Vitest with in-memory SQLite for `KnowledgeStore` tests — no persistent DB required for unit tests
- All new code uses TypeScript strict mode, ESM imports, no `any` types
- Zero new runtime dependencies — reuse existing `better-sqlite3`, `zod`, `node:crypto`
- Core module goes in `packages/core/src/knowledge/` (not diagnostics/ to avoid confusion with existing `diagnostics.ts`)
- DB migration goes in `packages/core/src/history/migrations.ts` (adding v2 to existing MIGRATIONS array)
- MCP tool count: 15 → 18 (argus_diagnose, argus_report_fix, argus_patterns)
