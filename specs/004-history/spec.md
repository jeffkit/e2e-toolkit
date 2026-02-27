# Feature Specification: Test Result Persistence & Trend Analysis

**Feature Branch**: `004-history`  
**Created**: 2026-02-26  
**Status**: Draft  
**Input**: User description: "测试结果持久化与趋势分析 — 自动记录每次测试运行结果，提供 Flaky Test 识别、历史趋势分析，并通过 MCP 工具和 Dashboard 暴露给用户和 AI Agent"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Test Result Recording (Priority: P1)

As a developer running E2E tests, I want every test run and its per-case results to be automatically persisted so that I can review historical outcomes without re-running tests.

Every time a test suite is executed (via CLI, MCP, CI, or Dashboard), the system automatically captures run-level metadata (project, timestamp, git context, duration, pass/fail counts) and per-case details (status, duration, retry attempts, error summaries). Results are stored locally by default and are queryable afterward.

**Why this priority**: Without persistence, no downstream feature (flaky detection, trends, comparisons) can function. This is the foundational data layer that all other stories depend on.

**Independent Test**: Run a test suite via any trigger, then verify that run-level and case-level records exist in the local store and contain correct metadata.

**Acceptance Scenarios**:

1. **Given** a project with history enabled (default), **When** a test suite completes via CLI, **Then** one TestRun record and one TestCaseRun record per case are persisted with correct metadata (project name, timestamp, git commit, git branch, config hash, duration, pass/fail/skip counts).
2. **Given** history is enabled, **When** a test run is triggered via MCP tool, **Then** the trigger source is recorded as `mcp` and all metadata is captured identically to a CLI run.
3. **Given** the project is inside a git repository, **When** a test run completes, **Then** the current commit hash and branch name are automatically captured in the run record.
4. **Given** history is disabled in configuration, **When** a test suite completes, **Then** no records are persisted and no errors are raised.
5. **Given** a test case required multiple retry attempts, **When** the run completes, **Then** the TestCaseRun record reflects the number of attempts and the final status.

---

### User Story 2 - Flaky Test Identification (Priority: P1)

As a developer or AI Agent, I want the system to automatically identify flaky tests so that I can distinguish intermittent failures from genuine bugs and make informed decisions about whether to investigate or ignore a failure.

The system analyzes recent history for each test case (default: last 10 runs) and computes a flaky score based on the ratio of failures to total runs. Cases that exhibit both passes and failures are classified into stability levels (STABLE, MOSTLY_STABLE, FLAKY, VERY_FLAKY, BROKEN). When a test fails, the flaky information is included in the result output.

**Why this priority**: Flaky test identification is the primary intelligence feature that differentiates historical data from raw logs. It directly enables AI Agents to make smart pass/fail decisions, which is a core value proposition.

**Independent Test**: Run a test case multiple times with varying outcomes, then verify the flaky score and level are correctly computed and included in subsequent run results.

**Acceptance Scenarios**:

1. **Given** a test case with 10 historical runs (7 pass, 3 fail), **When** the flaky detection runs, **Then** the flaky score is 0.3 and the level is FLAKY.
2. **Given** a test case with 10 historical runs (all pass), **When** the flaky detection runs, **Then** the flaky score is 0 and the level is STABLE.
3. **Given** a test case with 10 historical runs (all fail), **When** the flaky detection runs, **Then** the flaky score is 1.0 and the level is BROKEN.
4. **Given** a test case with 10 historical runs (9 pass, 1 fail), **When** the flaky detection runs, **Then** the flaky score is 0.1 and the level is MOSTLY_STABLE.
5. **Given** a test case that just failed, **When** the result is returned, **Then** the result includes flaky information (isFlaky flag, score, level, recent results list, and a human-readable suggestion).
6. **Given** a test case with fewer than 2 historical runs, **When** the flaky detection runs, **Then** the case is classified as STABLE (insufficient data to determine flakiness).

---

### User Story 3 - MCP History & Trend Tools for AI Agents (Priority: P1)

As an AI Agent, I want to query historical test data and trends through MCP tools so that I can make data-driven decisions during automated testing workflows.

Four new MCP tools provide programmatic access to historical data: querying run history, retrieving trend metrics (pass rate, duration, flaky rankings), listing flaky tests, and comparing two runs side-by-side. This enables AI Agents to autonomously decide whether a failure is a new bug or a known flaky test, and to track quality trends over time.

**Why this priority**: MCP tools are the primary interface for AI Agents to leverage historical data. Without these tools, the persistence layer provides no value to automated workflows.

**Independent Test**: After accumulating test run history, invoke each MCP tool and verify it returns correctly structured and accurate data.

**Acceptance Scenarios**:

1. **Given** multiple test runs exist in history, **When** an AI Agent calls `argus_history` with `limit=5`, **Then** the 5 most recent TestRun records are returned in reverse chronological order.
2. **Given** test runs spanning the last 14 days, **When** an AI Agent calls `argus_trends` with `metric=pass-rate` and `days=7`, **Then** daily pass-rate data points for the last 7 days are returned.
3. **Given** several test cases have non-zero flaky scores, **When** an AI Agent calls `argus_flaky` with `topN=5`, **Then** the top 5 flakiest cases are returned sorted by flaky score descending.
4. **Given** two completed test runs, **When** an AI Agent calls `argus_compare` with both run IDs, **Then** a comparison is returned showing cases that changed status (new failures, fixed failures, consistent results).
5. **Given** a test case just failed, **When** the AI Agent calls `argus_flaky` and finds the case has a flaky score of 0.3, **Then** the Agent can determine this is a known flaky test and choose to continue rather than investigate.
6. **Given** `argus_history` is called with `status=fail`, **Then** only runs with at least one failure are returned.

---

### User Story 4 - Trend Analysis APIs (Priority: P2)

As a Dashboard frontend or external consumer, I want RESTful APIs that provide aggregated trend data so that I can visualize quality metrics over time.

The system exposes trend endpoints for pass rate over time, execution duration over time, flaky test rankings, failure trends per case, and paginated run history. These APIs serve both the built-in Dashboard and potential external integrations.

**Why this priority**: APIs are the bridge between persisted data and visual presentation. They are needed before the Dashboard page can be built, but the core value (persistence + flaky detection + MCP tools) can function without them.

**Independent Test**: Seed the history store with representative data, call each API endpoint, and verify response structure and data accuracy.

**Acceptance Scenarios**:

1. **Given** test runs over the past 30 days, **When** `GET /api/trends/pass-rate?days=30` is called, **Then** daily pass-rate percentages are returned as a time series.
2. **Given** test runs with varying durations, **When** `GET /api/trends/duration?days=14&suiteId=X` is called, **Then** duration statistics per day are returned for the specified suite.
3. **Given** flaky tests exist, **When** `GET /api/trends/flaky?topN=10` is called, **Then** the top 10 flakiest cases are returned with their scores, levels, and recent result patterns.
4. **Given** a specific test case, **When** `GET /api/trends/failures?days=7&caseName=X` is called, **Then** the failure trend for that case over the last 7 days is returned.
5. **Given** many test runs exist, **When** `GET /api/runs?limit=20&offset=0` is called, **Then** a paginated list of 20 runs is returned with total count for pagination.
6. **Given** a specific run ID, **When** `GET /api/runs/:id` is called, **Then** the full run details including all case-level records are returned.

---

### User Story 5 - Dashboard Trend Analysis Page (Priority: P2)

As a team lead or developer using the web Dashboard, I want a visual trend analysis page so that I can quickly assess project quality health, spot regressions, and identify problematic tests.

A new "Trend Analysis" page in the Dashboard displays: a pass-rate line chart (daily/weekly), an execution duration chart, a flaky test ranking table, a recent failures list with drill-down capability, and a run history timeline.

**Why this priority**: The Dashboard page is the most user-friendly way to consume trend data, but all underlying capabilities (persistence, APIs, flaky detection) must exist first. It delivers high value for human users but is not required for AI Agent workflows.

**Independent Test**: Navigate to the Trends page with historical data present and verify all charts and tables render correctly with accurate data.

**Acceptance Scenarios**:

1. **Given** test runs exist for the past 14 days, **When** the user navigates to the Trends page, **Then** a pass-rate line chart shows daily pass-rate data points with clear labels.
2. **Given** the Trends page is displayed, **When** the user toggles between daily and weekly aggregation, **Then** the pass-rate chart updates to reflect the selected granularity.
3. **Given** flaky tests exist, **When** the user views the flaky ranking table, **Then** cases are listed by flaky score (highest first) with score, level, and recent result indicators.
4. **Given** recent failures exist, **When** the user clicks on a failed case in the failures list, **Then** detailed information about that case's failure history is displayed.
5. **Given** multiple runs exist, **When** the user scrolls the run history timeline, **Then** runs are displayed chronologically with status indicators and key metrics.
6. **Given** no historical data exists, **When** the user navigates to the Trends page, **Then** a helpful empty state is shown with guidance on how to generate data.

---

### User Story 6 - Configurable Storage & Retention (Priority: P3)

As a developer or team administrator, I want to configure how and where test history is stored, and how long it is retained, so that the system fits my team's infrastructure and storage constraints.

The system supports three storage modes: local file-based storage for individual developers, remote database storage for team collaboration, and in-memory storage for CI/testing environments. Retention policies control how long data is kept and the maximum number of runs stored.

**Why this priority**: The local storage mode is the default and is included in P1 work. This story covers the additional configurability (remote mode, custom retention) that is important for team adoption but not essential for the core feature to function.

**Independent Test**: Modify storage configuration, run tests, and verify data is stored/retained according to the specified settings.

**Acceptance Scenarios**:

1. **Given** `storage: local` in configuration, **When** tests run, **Then** results are persisted to a local database file at the configured path.
2. **Given** `storage: memory` in configuration, **When** tests run, **Then** results are available during the session but not persisted across restarts.
3. **Given** `retention: 90d` in configuration, **When** records older than 90 days exist, **Then** they are automatically cleaned up.
4. **Given** `maxRuns: 1000` in configuration, **When** the 1001st run completes, **Then** the oldest run and its case records are removed.
5. **Given** history is explicitly disabled (`enabled: false`), **When** tests run, **Then** no persistence occurs and all history-dependent features degrade gracefully (flaky detection returns "no data", trends return empty).

---

### Edge Cases

- What happens when the database file is corrupted or inaccessible? The system should log a warning and continue test execution without persistence, rather than failing the test run.
- What happens when a test case is renamed? The flaky detection treats it as a new case with no history (score = 0, level = STABLE).
- How does the system handle concurrent test runs writing to the same database? Write operations should be serialized to prevent corruption.
- What happens when the git repository has no commits or is in a detached HEAD state? Git metadata fields should be `null` without causing errors.
- What if historical data spans a configuration change (e.g., test cases were added/removed)? Only cases present in the current run are evaluated for flakiness; removed cases retain their historical records but are excluded from active flaky rankings.
- What happens when `argus_compare` is called with an invalid run ID? The system should return a clear error indicating the run was not found.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically record a TestRun entity after every test execution, capturing: unique identifier, project name, timestamp, git commit and branch (when available), configuration hash, trigger source, duration, and aggregate pass/fail/skip/flaky counts.
- **FR-002**: System MUST automatically record a TestCaseRun entity for every test case in each run, capturing: unique identifier, parent run reference, suite identifier, case name, final status, duration, retry attempts count, response time (when applicable), assertion counts, error summary, and diagnostic snapshot.
- **FR-003**: System MUST detect the trigger source (CLI, MCP, CI, or Dashboard) and record it in the TestRun metadata.
- **FR-004**: System MUST automatically retrieve current git commit hash and branch name from the environment and include them in TestRun records. When git information is unavailable, these fields must be null without causing errors.
- **FR-005**: System MUST compute a configuration hash from the test configuration file contents to enable detection of configuration changes between runs.
- **FR-006**: System MUST calculate a flaky score for each test case based on the ratio of failures to total runs in the most recent N executions (default N=10), where flaky score = fail_count / total_count.
- **FR-007**: System MUST classify test case stability into five levels based on flaky score: STABLE (score = 0), MOSTLY_STABLE (0 < score ≤ 0.2), FLAKY (0.2 < score ≤ 0.5), VERY_FLAKY (0.5 < score < 1.0), BROKEN (score = 1.0).
- **FR-008**: System MUST include flaky information (isFlaky flag, score, level, recent results list, human-readable suggestion) in test results when a case fails and has historical data.
- **FR-009**: System MUST provide an `argus_history` MCP tool that returns historical test run records, filterable by limit, status, and time range.
- **FR-010**: System MUST provide an `argus_trends` MCP tool that returns trend data for specified metrics (pass-rate, duration, flaky) over a configurable number of days.
- **FR-011**: System MUST provide an `argus_flaky` MCP tool that returns the top N flakiest test cases, sorted by flaky score descending, optionally filtered by a minimum score threshold.
- **FR-012**: System MUST provide an `argus_compare` MCP tool that accepts two run IDs and returns a comparison showing status changes between them (new failures, fixes, consistent results).
- **FR-013**: System MUST expose RESTful trend API endpoints: pass-rate trend, duration trend, flaky rankings, failure trends, run history (paginated), and single run details.
- **FR-014**: System MUST support configurable storage modes: local file-based storage (default), in-memory storage (for testing/CI), and remote database storage (for team use, planned expansion).
- **FR-015**: System MUST support configurable data retention by time period (default: 90 days) and maximum run count (default: 1000), automatically cleaning up records that exceed these limits.
- **FR-016**: System MUST provide a Dashboard "Trend Analysis" page displaying: pass-rate line chart (daily/weekly toggle), execution duration chart, flaky test ranking table, recent failures list with drill-down, and run history timeline.
- **FR-017**: System MUST handle storage failures gracefully — if the history store is unavailable, test execution continues normally without persistence, and a warning is logged.
- **FR-018**: System MUST serialize concurrent write operations to the history store to prevent data corruption.

### Key Entities

- **TestRun**: Represents a single complete execution of a test suite. Captures aggregate results and execution context (project, git state, configuration, trigger source). A TestRun contains one or more TestCaseRuns.
- **TestCaseRun**: Represents the outcome of a single test case within a run. Links to its parent TestRun. Captures individual case status, timing, retry behavior, and failure diagnostics.
- **FlakyInfo**: An analysis result attached to a test case, derived from historical TestCaseRun data. Contains the computed flaky score, stability level classification, recent result pattern, and a human-readable suggestion for action.
- **HistoryConfiguration**: User-configurable settings controlling storage mode, retention policies, and storage location. Part of the project's main configuration file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of test runs (across all trigger sources) produce persisted TestRun and TestCaseRun records when history is enabled.
- **SC-002**: Flaky test identification achieves > 90% accuracy — a case with mixed pass/fail history is correctly classified with the appropriate flaky score and level.
- **SC-003**: Users can retrieve the flaky status of any test case within 2 seconds of a run completing.
- **SC-004**: AI Agents can query historical trends and make pass/fail decisions (e.g., "ignore flaky" vs. "investigate new bug") without human intervention by using the 4 new MCP tools.
- **SC-005**: The Dashboard Trends page loads and renders all visualizations within 3 seconds for a dataset of up to 1000 runs.
- **SC-006**: Data retention operates automatically — no manual cleanup is required, and storage usage remains bounded by configured limits.
- **SC-007**: The system's test execution performance is not degraded by more than 5% due to the addition of history recording (persistence overhead is minimal).
- **SC-008**: The feature achieves 80%+ test coverage for the history store and flaky detection logic, with core modules (storage, flaky algorithm) at 90%+.

## Assumptions

- The default analysis window for flaky detection (N=10 recent runs) provides a sufficient sample size for reliable classification. This can be made configurable in the future if needed.
- Local SQLite-based storage is adequate for individual developer use; remote (team) storage is deferred as a Phase 3 expansion.
- The in-memory storage mode is intended for test/CI environments where persistence across sessions is not needed.
- Git information is obtained from the local environment at run time; the system does not require a git remote or specific hosting provider.
- The existing test execution pipeline can be extended with a post-execution hook to trigger history recording without architectural changes.
- Dashboard users have a modern web browser capable of rendering chart visualizations.
