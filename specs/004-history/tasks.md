# Tasks: Test Result Persistence & Trend Analysis

**Input**: Design documents from `/specs/004-history/`  
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/mcp-tools.md, contracts/rest-api.md, research.md, quickstart.md  
**Branch**: `004-history` | **Generated**: 2026-02-26

**Organization**: Tasks are grouped by user story (6 stories from spec.md) to enable independent implementation and testing. Within each priority tier, stories can be developed in parallel where noted.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US6)
- All paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies, create directory structure, and prepare the history subsystem scaffold

- [X] T001 Install `better-sqlite3` as a runtime dependency and `@types/better-sqlite3` as a dev dependency in `packages/core/package.json`
- [X] T002 [P] Create `packages/core/src/history/` directory and initial barrel export file `packages/core/src/history/index.ts`
- [X] T003 [P] Create test directory `packages/core/tests/unit/history/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: History types, configuration schema, and HistoryStore interface that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Define history-specific types in `packages/core/src/history/types.ts`: `TriggerSource` union (`'cli' | 'mcp' | 'dashboard' | 'ci'`), `StabilityLevel` union (`'STABLE' | 'MOSTLY_STABLE' | 'FLAKY' | 'VERY_FLAKY' | 'BROKEN'`), `TestRunRecord` interface (id, project, timestamp, gitCommit, gitBranch, configHash, trigger, duration, passed, failed, skipped, flaky, status), `TestCaseRunRecord` interface (id, runId, suiteId, caseName, status, duration, attempts, responseMs, assertions, error, snapshot), `FlakyInfo` interface (caseName, suiteId, isFlaky, score, level, recentResults, suggestion, failCount, totalRuns), `RunComparison` interface (baseRun, compareRun, newFailures as comparison items with baseStatus/compareStatus, fixed, consistent counts, newCases, removedCases), `TrendDataPoint` interface (date, value, runCount), `HistoryConfig` interface (enabled, storage, path, retention, flakyWindow)
- [X] T005 Define `HistoryStore` interface in `packages/core/src/history/history-store.ts` with methods: `saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void`, `getRuns(project: string, options: { limit?, offset?, status?, days? }): { runs: TestRunRecord[], total: number }`, `getRunById(id: string): { run: TestRunRecord, cases: TestCaseRunRecord[] } | null`, `getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[]`, `getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[]`, `getCasesForRun(runId: string): TestCaseRunRecord[]`, `getDistinctCaseNames(project: string, options?: { suiteId?: string, limit?: number }): string[]`, `cleanup(project: string, maxAge: string, maxRuns: number): number`, `close(): void`
- [X] T006 Implement `HistoryConfigSchema` Zod schema with `enabled: z.boolean().default(true)`, `storage: z.enum(['local', 'memory']).default('local')`, `path: z.string().optional()`, `retention: z.object({ maxAge: z.string().default('90d'), maxRuns: z.number().min(10).max(100000).default(1000) }).default({})`, `flakyWindow: z.number().min(2).max(100).default(10)` and integrate as `history: HistoryConfigSchema.optional()` into `E2EConfigSchema` in `packages/core/src/config-loader.ts`
- [X] T007 Add `HistoryConfig` and history-related types to main types export in `packages/core/src/types.ts` (re-export from `./history/types.js`)
- [X] T008 Re-export all foundational types and the `HistoryStore` interface from `packages/core/src/history/index.ts`

**Checkpoint**: Foundation ready — history types, HistoryStore interface, and config schema are in place. User story implementation can now begin.

---

## Phase 3: US1 — Automatic Test Result Recording (Priority: P1) 🎯 MVP

**Goal**: Every test run and its per-case results are automatically persisted. This is the foundational data layer that all other stories depend on.

**Independent Test**: Run a test suite via any trigger, then verify that run-level and case-level records exist in the local store and contain correct metadata.

### Implementation for User Story 1

- [X] T009 [US1] Implement SQLite schema migrations in `packages/core/src/history/migrations.ts`: define `MIGRATIONS` array with v1 migration creating `test_runs` and `test_case_runs` tables per data-model.md DDL, with all indexes and constraints; implement `applyMigrations(db)` using `user_version` pragma for version tracking
- [X] T010 [US1] Implement `SQLiteHistoryStore` class in `packages/core/src/history/history-store.ts`: constructor accepts `dbPath` string, opens database with `better-sqlite3`, sets WAL mode pragmas (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `temp_store=MEMORY`, `cache_size=-8000`, `foreign_keys=ON`), calls `applyMigrations()`, implements all `HistoryStore` methods using prepared statements, includes write serialization for concurrent safety
- [X] T011 [US1] Implement `MemoryHistoryStore` class in `packages/core/src/history/memory-history-store.ts`: in-memory Map-based implementation of `HistoryStore` for tests and CI mode, uses `Map<string, TestRunRecord>` and `Map<string, TestCaseRunRecord[]>` keyed by runId
- [X] T012 [US1] Implement `createHistoryStore(config: HistoryConfig, projectDir: string): HistoryStore` factory function in `packages/core/src/history/history-store.ts`: returns `SQLiteHistoryStore` for `'local'` mode (creating `.argusai/` directory if needed), `MemoryHistoryStore` for `'memory'` mode, respects `config.path` override for custom SQLite location
- [X] T013 [US1] Implement `getGitContext(cwd: string): { commit: string | null; branch: string | null }` in `packages/core/src/history/git-context.ts`: use `execSync('git rev-parse HEAD')` and `execSync('git rev-parse --abbrev-ref HEAD')` with try/catch returning `null` on failure, handle detached HEAD (branch = `'HEAD'` → `null`)
- [X] T014 [US1] Implement `computeConfigHash(configPath: string): string` in `packages/core/src/history/config-hash.ts`: read file content with `fs.readFileSync`, compute SHA-256 via `crypto.createHash('sha256')`, return hex-encoded hash prefixed with `sha256:`; return `sha256:unknown` if file not found
- [X] T015 [US1] Implement `detectTriggerSource(explicit?: TriggerSource): TriggerSource` in `packages/core/src/history/types.ts`: return `explicit` if provided, check `process.env.CI` for `'ci'`, default to `'cli'`
- [X] T016 [US1] Implement `HistoryRecorder` class in `packages/core/src/history/history-recorder.ts`: constructor accepts `HistoryStore` and `HistoryConfig`; `recordRun(runResult, projectName, projectDir, configPath, triggerSource)` method builds `TestRunRecord` (generating ID as `run-{timestamp}-{random}`) and `TestCaseRunRecord[]` (generating IDs as `case-{timestamp}-{suite}-{index}`) from test results, calls `getGitContext()`, `computeConfigHash()`, saves via `store.saveRun()`, then runs `store.cleanup()` with retention settings; wraps entire operation in try/catch for graceful degradation per FR-017
- [X] T017 [US1] Integrate `HistoryRecorder` into the test execution pipeline: add `historyStore` and `historyRecorder` fields to `ProjectSession` in `packages/mcp/src/session.ts`, initialize in `create()` when history is enabled, call `historyRecorder.recordRun()` after test completion in `packages/mcp/src/tools/run.ts`, pass `'mcp'` as trigger source; clean up store in session `destroy()`
- [X] T018 [US1] Re-export `SQLiteHistoryStore`, `MemoryHistoryStore`, `createHistoryStore`, `HistoryRecorder`, `getGitContext`, `computeConfigHash` from `packages/core/src/history/index.ts`

### Tests for User Story 1

- [X] T019 [P] [US1] Write unit tests for `SQLiteHistoryStore` and `MemoryHistoryStore` in `packages/core/tests/unit/history/history-store.test.ts`: test saveRun + getRuns round-trip, pagination, status filtering, date range queries, getRunById with cases, getCaseHistory ordering, cleanup by maxAge and maxRuns, concurrent write safety, cascade delete — target 90%+ coverage
- [X] T020 [P] [US1] Write unit tests for `getGitContext` in `packages/core/tests/unit/history/git-context.test.ts`: mock `execSync` for success, no-git, detached HEAD, empty repo scenarios
- [X] T021 [P] [US1] Write unit tests for `HistoryRecorder` in `packages/core/tests/unit/history/history-recorder.test.ts`: verify record creation from run results, correct ID generation, git context inclusion, config hash computation, retention cleanup call, graceful degradation when store throws

**Checkpoint**: US1 complete — every test run is automatically persisted with full metadata. The data layer is operational and queryable.

---

## Phase 4: US2 — Flaky Test Identification (Priority: P1)

**Goal**: Automatically identify flaky tests by analyzing recent history and computing stability scores. Enrich failed test results with flaky information.

**Independent Test**: Run a test case multiple times with varying outcomes, then verify the flaky score and level are correctly computed and included in subsequent run results.

### Implementation for User Story 2

- [X] T022 [US2] Implement `FlakyDetector` class in `packages/core/src/history/flaky-detector.ts`: constructor accepts `HistoryStore` and `flakyWindow` (default 10); `analyze(caseName: string, project: string): FlakyInfo` queries recent case history, computes `score = failCount / total`, classifies into `StabilityLevel` per thresholds (0 = STABLE, 0 < s ≤ 0.2 = MOSTLY_STABLE, 0.2 < s ≤ 0.5 = FLAKY, 0.5 < s < 1.0 = VERY_FLAKY, 1.0 = BROKEN), generates human-readable `suggestion` string, returns STABLE with empty results when fewer than 2 historical runs exist
- [X] T023 [US2] Implement `analyzeAll(project: string, options?: { minScore?, topN?, suiteId? }): FlakyInfo[]` method in `FlakyDetector`: query all distinct case names from recent runs, compute flaky info for each, filter by `minScore` threshold, sort by score descending, limit to `topN`
- [X] T024 [US2] Integrate flaky detection into `HistoryRecorder.recordRun()` in `packages/core/src/history/history-recorder.ts`: after saving run, compute flaky info for each failed case, set `isFlaky` flag and attach `FlakyInfo` to the returned enriched result, update `flaky` count on the `TestRunRecord`
- [X] T025 [US2] Re-export `FlakyDetector` from `packages/core/src/history/index.ts`

### Tests for User Story 2

- [X] T026 [P] [US2] Write unit tests for `FlakyDetector` in `packages/core/tests/unit/history/flaky-detector.test.ts`: test all 5 stability levels with exact threshold boundaries (score=0, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0), insufficient data fallback (< 2 runs → STABLE), suggestion text generation, `analyzeAll` with filtering and sorting, empty history — target 90%+ coverage

**Checkpoint**: US1 + US2 complete — persistence and flaky detection are operational. Failed tests include flaky context for intelligent decision-making.

---

## Phase 5: US3 — MCP History & Trend Tools for AI Agents (Priority: P1)

**Goal**: Four new MCP tools (`argus_history`, `argus_trends`, `argus_flaky`, `argus_compare`) provide programmatic access to historical data for AI Agents.

**Independent Test**: After accumulating test run history, invoke each MCP tool and verify it returns correctly structured and accurate data.

### Implementation for User Story 3

- [X] T027 [US3] Implement `handleHistory` handler in `packages/mcp/src/tools/history.ts`: accept `projectPath`, `limit` (default 20, max 100), `status` filter, `days` filter, `offset` (default 0); retrieve `historyStore` from session, call `store.getRuns()`, return `{ runs, total, hasMore }` per mcp-tools.md contract; error codes: `NO_SESSION`, `HISTORY_DISABLED`, `INVALID_PARAMS`
- [X] T028 [P] [US3] Implement `handleTrends` handler in `packages/mcp/src/tools/trends.ts`: accept `projectPath`, `metric` (`'pass-rate' | 'duration' | 'flaky'`), `days` (default 14, max 90), optional `suiteId`; compute daily aggregated `TrendDataPoint[]` from `store.getRunsInDateRange()`, calculate summary with current/previous/change/direction; return `ArgusTrendsResponse` per contract
- [X] T029 [P] [US3] Implement `handleFlaky` handler in `packages/mcp/src/tools/flaky.ts`: accept `projectPath`, `topN` (default 10, max 50), `minScore` (default 0.01), optional `suiteId`; delegate to `FlakyDetector.analyzeAll()`, return `{ cases, totalFlaky, analysisWindow }` per contract
- [X] T030 [P] [US3] Implement `handleCompare` handler in `packages/mcp/src/tools/compare.ts`: accept `projectPath`, `baseRunId`, `compareRunId`; load both runs with cases via `store.getRunById()`, compute diff (newFailures, fixed, consistent, newCases, removedCases) per mcp-tools.md contract; error codes: `RUN_NOT_FOUND`, `DIFFERENT_PROJECTS`
- [X] T031 [US3] Register `argus_history`, `argus_trends`, `argus_flaky`, `argus_compare` tools with Zod parameter schemas in `packages/mcp/src/server.ts` (tool count: 11→15), import handlers and wire up with `successResponse`/`errorResponse` envelope

### Tests for User Story 3

- [X] T032 [P] [US3] Write unit tests for all 4 MCP tool handlers in `packages/mcp/tests/history-tools.test.ts`: test `argus_history` (pagination, status filter, days filter, empty results), `argus_trends` (pass-rate/duration/flaky metrics, summary calculation, empty data), `argus_flaky` (topN limiting, minScore filtering, sorting), `argus_compare` (new failures, fixes, consistent, run not found error, different projects error) — target 85%+ coverage

**Checkpoint**: US1 + US2 + US3 complete — the core P1 feature set is operational. AI Agents can record, query, analyze, and compare test history.

---

## Phase 6: US4 — Trend Analysis APIs (Priority: P2)

**Goal**: RESTful API endpoints for the Dashboard and external consumers to access aggregated trend data.

**Independent Test**: Seed the history store with representative data, call each API endpoint, and verify response structure and data accuracy.

### Implementation for User Story 4

- [ ] T033 [US4] Implement `historyRoutes` Fastify plugin in `packages/dashboard/server/routes/history.ts` with 7 endpoints per rest-api.md contract:
  - `GET /api/trends/pass-rate` — daily pass-rate trend with `days` and `suiteId` params
  - `GET /api/trends/duration` — duration trend with `days` and `suiteId` params
  - `GET /api/trends/flaky` — flaky ranking with `topN`, `minScore`, `suiteId` params
  - `GET /api/trends/failures` — per-case failure trend with required `caseName`, optional `days`, `suiteId` params
  - `GET /api/runs` — paginated run list with `limit`, `offset`, `status`, `days` params
  - `GET /api/runs/:id` — single run detail with all cases and flaky info for failed cases
  - `GET /api/runs/:id/compare/:compareId` — run comparison (delegates to same compare logic as MCP)
- [ ] T034 [US4] Register `historyRoutes` plugin in `packages/dashboard/server/index.ts`: import and `app.register(historyRoutes)`, ensure history store is accessible from the app context (via `app.decorate` or similar pattern matching existing route registration)
- [ ] T035 [US4] Add `HistoryStore` initialization to dashboard server startup in `packages/dashboard/server/index.ts`: create store from project config on startup and on project switch, make available to route handlers

### Tests for User Story 4

- [ ] T036 [P] [US4] Write integration tests for history REST endpoints in `packages/dashboard/server/routes/history.test.ts`: test all 7 endpoints with seeded data, verify response shapes match rest-api.md contracts, test pagination, filters, 404 for missing run, 400 for missing caseName on failures endpoint — target 80%+ coverage

**Checkpoint**: US4 complete — all REST APIs are operational. Dashboard frontend can begin fetching trend data.

---

## Phase 7: US5 — Dashboard Trend Analysis Page (Priority: P2)

**Goal**: A visual "Trend Analysis" page in the Dashboard with charts, tables, and timeline for quality insights.

**Independent Test**: Navigate to the Trends page with historical data present and verify all charts and tables render correctly with accurate data.

### Implementation for User Story 5

- [ ] T037 [US5] Install `recharts` as a dependency in `packages/dashboard/package.json`
- [ ] T038 [P] [US5] Add trend API client functions to `packages/dashboard/ui/lib/api.ts`: `trends.passRate(days?)`, `trends.duration(days?)`, `trends.flaky(topN?)`, `trends.failures(caseName, days?)`, `runs.list(limit?, offset?, status?)`, `runs.detail(id)`, `runs.compare(baseId, compareId)` — each returning typed responses matching rest-api.md contracts
- [ ] T039 [P] [US5] Implement `PassRateChart` component in `packages/dashboard/ui/components/PassRateChart.tsx`: Recharts `ResponsiveContainer` + `LineChart` showing daily pass-rate with date X-axis and percentage Y-axis, daily/weekly toggle via prop, tooltip showing pass/fail/skip counts per day, green/red color coding for pass-rate thresholds
- [ ] T040 [P] [US5] Implement `DurationChart` component in `packages/dashboard/ui/components/DurationChart.tsx`: Recharts `AreaChart` showing avg/min/max duration bands over time, tooltip with run count per day, formatted duration labels (ms → seconds)
- [ ] T041 [P] [US5] Implement `FlakyTable` component in `packages/dashboard/ui/components/FlakyTable.tsx`: sortable table of flaky cases with columns: case name, suite, flaky score (with color-coded stability level badge), recent results (visual dots: green=pass, red=fail, gray=skip), total runs; click row to show detail
- [ ] T042 [P] [US5] Implement `FailuresList` component in `packages/dashboard/ui/components/FailuresList.tsx`: list of recent failures with case name, suite, error summary (truncated), last failure date, flaky status badge; click to expand with full error and failure trend mini-chart
- [ ] T043 [P] [US5] Implement `RunTimeline` component in `packages/dashboard/ui/components/RunTimeline.tsx`: vertical timeline of runs showing status indicator (green/red dot), timestamp, duration, pass/fail/skip counts, git branch badge, trigger source icon; load-more pagination at bottom
- [ ] T044 [US5] Implement `TrendsPage` in `packages/dashboard/ui/pages/TrendsPage.tsx`: compose all 5 components, manage shared state (date range, suite filter), handle loading/error/empty states; empty state shows guidance message per acceptance scenario 6; use Tailwind responsive grid layout
- [ ] T045 [US5] Add `trends` page entry to `main.tsx` in `packages/dashboard/ui/main.tsx`: add `'trends'` to `Page` type union, add `TrendsPage` import, add `trends: { label: '趋势分析', icon: '📈', component: <TrendsPage /> }` to pages record

### Tests for User Story 5

- [ ] T046 [P] [US5] Write component tests for `TrendsPage` in `packages/dashboard/ui/pages/TrendsPage.test.tsx`: verify render with data, empty state rendering, date range filter interaction, suite filter interaction, loading states — target 80%+ coverage

**Checkpoint**: US5 complete — the Trends page is fully functional with charts, tables, and timeline visualization.

---

## Phase 8: US6 — Configurable Storage & Retention (Priority: P3)

**Goal**: Support multiple storage modes (local, memory) and configurable retention policies for different team environments.

**Independent Test**: Modify storage configuration, run tests, and verify data is stored/retained according to the specified settings.

### Implementation for User Story 6

- [ ] T047 [US6] Enhance `SQLiteHistoryStore.cleanup()` in `packages/core/src/history/history-store.ts`: implement time-based cleanup parsing duration strings (e.g. `'90d'`, `'30d'`, `'7d'`) and computing cutoff timestamp, implement count-based cleanup deleting oldest runs beyond `maxRuns`, rely on `ON DELETE CASCADE` for case record cleanup, return total deleted count
- [ ] T048 [US6] Implement graceful degradation in `HistoryRecorder` and `createHistoryStore` in `packages/core/src/history/history-recorder.ts` and `packages/core/src/history/history-store.ts`: when `enabled: false` return a no-op stub implementing `HistoryStore` interface; when store initialization fails (corrupted DB, disk error) log warning and fall back to `MemoryHistoryStore` per FR-017; when individual write fails log warning and continue test execution
- [ ] T049 [US6] Add integration between `HistoryConfig.enabled` flag and all downstream consumers: MCP tools return `HISTORY_DISABLED` error code when history is disabled, REST API endpoints return 503 with descriptive message, Dashboard Trends page shows "History is disabled" state
- [ ] T050 [US6] Re-export any new public APIs from `packages/core/src/history/index.ts`

### Tests for User Story 6

- [ ] T051 [P] [US6] Write unit tests for configurable storage in `packages/core/tests/unit/history/storage-config.test.ts`: test `'local'` mode creates SQLite file at configured path, `'memory'` mode uses in-memory store, `enabled: false` returns no-op store, retention cleanup by time (`90d` → records older than 90 days removed), retention cleanup by count (keep only `maxRuns`), graceful degradation on corrupted DB file, default config values when no `history` section in `e2e.yaml`

**Checkpoint**: US6 complete — storage is configurable for different environments with automatic retention and graceful degradation.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, re-exports, and validation across all user stories

- [ ] T052 Add `export * from './history/index.js'` to `packages/core/src/index.ts` for public API surface
- [ ] T052b [P] Integrate `HistoryRecorder` into Dashboard test execution path in `packages/dashboard/server/routes/tests.ts`: when tests are triggered from the Dashboard UI, pass `'dashboard'` as trigger source to ensure FR-003 coverage for all 4 trigger sources
- [ ] T053 [P] Validate all history config defaults behave correctly when no `history` section is present in `e2e.yaml` — ensure history is enabled with local storage, 90d retention, 1000 maxRuns, flakyWindow of 10
- [ ] T054 [P] Verify `better-sqlite3` prebuilt binaries resolve correctly for macOS (arm64 + x64) and Linux (x64) in CI; add `better-sqlite3` to `pnpm.overrides` if needed for consistent resolution
- [ ] T055 [P] Ensure Dashboard server gracefully handles the case where no project is loaded (no active session) for all history endpoints — return 503 with descriptive error
- [ ] T056 Run full history test suite and verify 80%+ overall coverage, 90%+ for `history-store.test.ts` and `flaky-detector.test.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — **BLOCKS US2–US6** (all stories need persistence)
- **US2 (Phase 4)**: Depends on US1 (needs stored history to analyze)
- **US3 (Phase 5)**: Depends on US2 (MCP tools expose flaky analysis); can overlap with US2 for non-flaky tools
- **US4 (Phase 6)**: Depends on US1 + US2; **can run in parallel** with US3
- **US5 (Phase 7)**: Depends on US4 (needs REST APIs to fetch data)
- **US6 (Phase 8)**: Depends on US1; **can run in parallel** with US3–US5
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
  └─→ Phase 2 (Foundational)
        └─→ Phase 3 (US1: Persistence) ← ALL stories depend on this
              ├─→ Phase 4 (US2: Flaky Detection)
              │     ├─→ Phase 5 (US3: MCP Tools)
              │     └─→ Phase 6 (US4: REST APIs) [P with US3]
              │           └─→ Phase 7 (US5: Dashboard Page)
              └─→ Phase 8 (US6: Storage Config) [P with US2–US5]
                                                    └─→ Phase 9 (Polish)
```

### Within Each User Story

1. Types/interfaces first (if story adds new types)
2. Core class implementation (constructor, main methods)
3. Integration with existing MCP tools/orchestrator/dashboard
4. Barrel export update
5. Unit tests (can parallel with integration step)

### Parallel Opportunities

**Story-level parallelism** (after US2 completes):
- US3 (MCP Tools) and US4 (REST APIs) can proceed simultaneously — they live in different packages (`packages/mcp/` vs `packages/dashboard/`)
- US6 (Storage Config) can proceed in parallel with US3–US5 — it enhances the core store module

**Task-level parallelism** (within each phase):
- All tasks marked `[P]` can run alongside other tasks in the same phase
- Component tasks in US5 (T039–T043) are all parallelizable — they produce independent React components
- Test writing tasks `[P]` can run alongside integration tasks in the same story

---

## Parallel Example: P2 User Stories (Phases 6–7)

After US2 (flaky detection) is complete, P2 stories can proceed:

```text
Worker A: US4 — REST APIs (Phase 6)
  T033 → T034 → T035 + T036

Worker B: US5 — Dashboard Page (Phase 7, starts after US4 API endpoints exist)
  T037 → T038 + T039 + T040 + T041 + T042 + T043 → T044 → T045 + T046

Worker C: US6 — Storage Config (Phase 8, can run with any story after US1)
  T047 → T048 → T049 → T050 + T051
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 = Persistence + Flaky Detection + MCP Tools)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks everything)
3. Complete Phase 3: US1 — Automatic Test Result Recording
4. Complete Phase 4: US2 — Flaky Test Identification
5. Complete Phase 5: US3 — MCP Tools
6. **STOP and VALIDATE**: Run tests → verify records persist. Check flaky detection with mixed results. Invoke all 4 MCP tools → verify correct responses.
7. Deploy/demo if ready — AI Agents can now record, analyze, and query test history

### Incremental Delivery

1. Setup + Foundational + US1 → **Data persistence operational** ✅
2. Add US2 (Flaky Detection) → Intelligent failure analysis ✅
3. Add US3 (MCP Tools) → **MVP: AI Agents can use history** ✅
4. Add US4 (REST APIs) → Dashboard data layer ready ✅
5. Add US5 (Dashboard Page) → Visual trend analysis ✅
6. Add US6 (Storage Config) → Team-ready configuration ✅
7. Polish → Final integration, coverage validation ✅

### Summary Table

| Phase | Story | Priority | Tasks | Parallel | Files Created | Files Modified |
|-------|-------|----------|-------|----------|---------------|----------------|
| 1 | Setup | — | 3 | 2 | 2 | 1 |
| 2 | Foundational | — | 5 | 0 | 2 | 2 |
| 3 | US1: Persistence | P1 | 13 | 3 | 6 | 3 |
| 4 | US2: Flaky Detection | P1 | 5 | 1 | 1 | 2 |
| 5 | US3: MCP Tools | P1 | 6 | 4 | 5 | 1 |
| 6 | US4: REST APIs | P2 | 4 | 1 | 1 | 1 |
| 7 | US5: Dashboard Page | P2 | 10 | 7 | 8 | 2 |
| 8 | US6: Storage Config | P3 | 5 | 1 | 1 | 3 |
| 9 | Polish | — | 5 | 3 | 0 | 1 |
| **Total** | | | **56** | **22** | **26** | **~16** |

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase
- `[Story]` labels (US1–US6) map each task to its user story for traceability
- Each user story is independently completable and testable at its checkpoint
- Commit after each task or logical group within a story
- Stop at any checkpoint to validate the story independently
- Tests use Vitest with `vi.mock()` for SQLite/Docker isolation — no real database required for unit tests
- All new code uses TypeScript strict mode, ESM imports, no `any` types
- New runtime dependency: `better-sqlite3` (native addon, prebuilt binaries for all platforms)
- New UI dependency: `recharts` (React-native charting library for Dashboard)
- Dashboard uses state-based page routing (no react-router) — match existing pattern in `main.tsx`
