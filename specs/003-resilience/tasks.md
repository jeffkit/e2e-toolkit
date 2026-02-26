# Tasks: Error Recovery & Self-Healing

**Input**: Design documents from `/specs/003-resilience/`  
**Prerequisites**: plan.md (required), spec.md (required)  
**Branch**: `003-resilience` | **Generated**: 2026-02-26

**Organization**: Tasks are grouped by user story (8 stories from spec.md) to enable independent implementation and testing. User stories within the same priority tier (P1) can be developed in parallel.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US8)
- All paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure for the new resilience subsystem

- [X] T001 Create `packages/core/src/resilience/` directory and initial barrel export file `packages/core/src/resilience/index.ts`
- [X] T002 [P] Create test directory `packages/core/tests/unit/resilience/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, configuration schema, and Docker label infrastructure that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add `ResilienceConfig` interface with `preflight`, `container`, `network`, and `circuitBreaker` sub-interfaces, plus resilience SSE event type variants (`preflight_start`, `preflight_check`, `preflight_end`, `restart_attempt`, `restart_success`, `restart_exhausted`, `cleanup_start`, `cleanup_resource`, `cleanup_end`, `port_conflict`, `port_reassigned`, `circuit_open`, `circuit_half_open`, `circuit_closed`, `network_check`, `network_verified`) to the event type unions in `packages/core/src/types.ts`
- [X] T004 Add `runId: string`, `activeGuardians: Map<string, ContainerGuardian>`, and `portMappings?: PortMapping[]` fields to `ProjectSession` interface in `packages/mcp/src/session.ts`; generate `runId` via `Date.now().toString(36)` in `create()`; clean up guardians in `destroy()`
- [X] T005 Implement `ResilienceConfigSchema` Zod schema with cascading `.default({})` for all sub-sections, `.describe()` annotations on ALL fields (satisfies FR-R31), and add `resilience: ResilienceConfigSchema.optional()` to `E2EConfigSchema` in `packages/core/src/config-loader.ts`
- [X] T006 Add `ArgusDockerLabels` interface (`argusai.managed`, `argusai.project`, `argusai.run-id`, `argusai.created-at`) and inject `--label key=value` into `buildRunArgs()` in `packages/core/src/docker-engine.ts`
- [X] T007 Add label parameter support to `ensureNetwork()` for `docker network create --label` in `packages/core/src/docker-engine.ts`
- [X] T008 [P] Export `safeExecFileAsync` or create a `dockerExec(args)` helper function in `packages/core/src/docker-engine.ts` for reuse by resilience modules

**Checkpoint**: Foundation ready — resilience types, config schema, and Docker label infrastructure in place. User story implementation can now begin.

---

## Phase 3: US1 — Structured Error Codes for AI Agent Decision-Making (Priority: P0) 🎯 MVP

**Goal**: All infrastructure errors return standardized, machine-readable `StructuredError` objects with code, category, severity, and suggested recovery actions — enabling AI Agents to make programmatic recovery decisions.

**Independent Test**: Trigger known error conditions (Docker down, disk full, port occupied) and verify each returns the correct structured error code with all required fields.

### Implementation for User Story 1

- [X] T009 [US1] Define `ArgusErrorCode` union type (13 codes: `DOCKER_UNAVAILABLE`, `DISK_SPACE_LOW`, `PORT_CONFLICT`, `PORT_EXHAUSTION`, `CONTAINER_OOM`, `CONTAINER_CRASH`, `CONTAINER_RESTART_EXHAUSTED`, `HEALTH_CHECK_TIMEOUT`, `NETWORK_UNREACHABLE`, `DNS_RESOLUTION_FAILED`, `CIRCUIT_OPEN`, `ORPHAN_DETECTED`, `CLEANUP_FAILED`), `ErrorCategory`, `ErrorSeverity`, and `StructuredError` interface in `packages/core/src/resilience/error-codes.ts`
- [X] T010 [US1] Implement `ERROR_METADATA` registry as `Map<ArgusErrorCode, { category: ErrorCategory, defaultSeverity: ErrorSeverity, suggestedActions: string[] }>` with defaults for all 13 codes in `packages/core/src/resilience/error-codes.ts`
- [X] T011 [US1] Implement `createStructuredError(code, message, details?, severityOverride?)` factory function that resolves metadata from the registry and returns a complete `StructuredError` in `packages/core/src/resilience/error-codes.ts`
- [X] T012 [US1] Implement `ArgusError extends Error` class wrapping a `StructuredError` payload with `.toJSON()` serialization in `packages/core/src/resilience/error-codes.ts`
- [X] T013 [US1] Extend MCP `handleError` function in `packages/mcp/src/server.ts` to detect `ArgusError` instances and serialize the inner `StructuredError` into the MCP response envelope
- [X] T014 [US1] Re-export all error-codes types and functions from `packages/core/src/resilience/index.ts`

### Tests for User Story 1

- [X] T015 [P] [US1] Write unit tests covering: error metadata for all 13 codes, factory function with/without overrides, `ArgusError` construction and serialization, MCP error handler integration — target 90%+ coverage in `packages/core/tests/unit/resilience/error-codes.test.ts`

**Checkpoint**: US1 complete — all error paths return `StructuredError`. AI Agents can parse error codes without free-text matching.

---

## Phase 4: US2 — Preflight Environment Health Check (Priority: P0)

**Goal**: Before any setup or build operation, validate Docker daemon connectivity, disk space, and orphaned resources. Return a structured health report so AI Agents can decide whether to proceed, clean up, or abort.

**Independent Test**: Invoke the preflight check under various conditions (Docker stopped, low disk, orphaned containers) and verify the health report accurately reflects each condition.

### Implementation for User Story 2

- [X] T016 [US2] Add `CheckStatus` (`pass`|`warn`|`fail`), `OverallHealth` (`healthy`|`degraded`|`unhealthy`), `HealthCheckResult`, and `HealthReport` types to `packages/core/src/types.ts`
- [X] T017 [US2] Implement `PreflightChecker.checkDockerDaemon()` — runs `docker info` with 5s timeout via `execFileAsync`, returns `pass` or `fail` with `DOCKER_UNAVAILABLE` in `packages/core/src/resilience/preflight.ts`
- [X] T018 [US2] Implement `PreflightChecker.checkDiskSpace(threshold)` — parses `df -BG /` (Linux) or `df -g /` (macOS), compares against configurable threshold (default 2GB), returns `pass`/`warn`/`fail` in `packages/core/src/resilience/preflight.ts`
- [X] T019 [US2] Implement `PreflightChecker.checkOrphans(projectName)` — runs `docker ps -a --filter label=argusai.project=<name>` and `docker network ls --filter label=argusai.project=<name>` to detect orphaned resources in `packages/core/src/resilience/preflight.ts`
- [X] T020 [US2] Implement `PreflightChecker.runAll(config, projectName)` — aggregates all checks, computes overall status (`unhealthy` if any `fail`, `degraded` if any `warn`), emits SSE events (`preflight_start`, `preflight_check`, `preflight_end`) in `packages/core/src/resilience/preflight.ts`
- [X] T021 [US2] Add preflight gate to `handleSetup` in `packages/mcp/src/tools/setup.ts` — call `preflightChecker.runAll()` when `resilience.preflight.enabled` is `true`, return structured error and block execution if result is `unhealthy`
- [X] T022 [US2] Add preflight gate to `handleBuild` in `packages/mcp/src/tools/build.ts` — check Docker daemon and disk space before building
- [X] T023 [US2] Re-export preflight module from `packages/core/src/resilience/index.ts`

### Tests for User Story 2

- [X] T024 [P] [US2] Write unit tests for `checkDockerDaemon` (success/timeout), `checkDiskSpace` (above/below/edge threshold), `checkOrphans` (found/none), `runAll` aggregation logic in `packages/core/tests/unit/resilience/preflight.test.ts`

**Checkpoint**: US1 + US2 complete — error codes and preflight checks are operational. Environment issues are detected before they cause cascading failures.

---

## Phase 5: US3 — Container Auto-Restart on Failure (Priority: P1)

**Goal**: Automatically restart crashed containers (OOM, non-zero exit, health check failure) with configurable backoff. Capture diagnostics before each attempt and report full history when max restarts are exhausted.

**Independent Test**: Run a container configured to crash, verify auto-restart with backoff, diagnostics capture per attempt, and final failure report with full history when max restarts reached.

### Implementation for User Story 3

- [X] T025 [P] [US3] Add `ContainerDiagnostics` (containerId, containerName, exitCode, oomKilled, logs, memoryStats, timestamp) and `RestartHistory` (containerName, attempts[], finalStatus) interfaces to `packages/core/src/types.ts`
- [X] T026 [US3] Implement `ContainerGuardian.captureDiagnostics(name)` — runs `docker inspect --format '{{json .State}}'` for exit code/OOM, `getContainerLogs()` for last 100 lines, `docker stats --no-stream` for memory in `packages/core/src/resilience/container-guardian.ts`
- [X] T027 [US3] Implement `ContainerGuardian.monitorAndRestart(containerName, runOptions, labels)` — detect failure via `getContainerStatus()`, apply `exponential`/`linear` backoff via `computeBackoffDelay()` from `retry-engine.ts`, restart up to `maxRestarts` times in `packages/core/src/resilience/container-guardian.ts`
- [X] T028 [US3] Add SSE events (`restart_attempt`, `restart_success`, `restart_exhausted`) and throw `ArgusError(CONTAINER_RESTART_EXHAUSTED)` with full `RestartHistory` in details on exhaustion in `packages/core/src/resilience/container-guardian.ts`
- [X] T029 [US3] Integrate `ContainerGuardian` into `startAll()` method in `packages/core/src/orchestrator.ts` — wrap container startup with guardian monitoring
- [X] T030 [US3] Re-export container-guardian module from `packages/core/src/resilience/index.ts`

### Tests for User Story 3

- [X] T031 [P] [US3] Write unit tests for diagnostics capture, exponential/linear backoff timing, restart success on second attempt, exhaustion with full history in `packages/core/tests/unit/resilience/container-guardian.test.ts`

**Checkpoint**: US3 complete — containers auto-recover from transient crashes with full diagnostic trail.

---

## Phase 6: US4 — Port Conflict Auto-Resolution (Priority: P1)

**Goal**: Detect port conflicts during setup and automatically find/assign available ports, updating all referencing variables. Report original→actual port mapping so AI Agents and tests reference correct endpoints.

**Independent Test**: Occupy a configured port, run setup, verify the system selects an alternative port, updates variables, and reports the mapping.

### Implementation for User Story 4

- [X] T032 [P] [US4] Add `PortMapping` type (service, originalPort, actualPort, reassigned) to `packages/core/src/types.ts`
- [X] T033 [US4] Implement `PortResolver.findAvailablePort(startPort, maxAttempts?)` — TCP probe via `node:net` server.listen, try up to 100 ports, skip privileged (<1024), throw `ArgusError(PORT_EXHAUSTION)` if none found in `packages/core/src/resilience/port-resolver.ts`
- [X] T034 [US4] Implement `PortResolver.resolveServicePorts(services, mocks)` — iterate configured ports, check `isPortInUse()`, auto-reassign when strategy is `'auto'`, throw `ArgusError(PORT_CONFLICT)` when strategy is `'fail'`, detect occupying PID via `lsof -i :PORT -t` in `packages/core/src/resilience/port-resolver.ts`
- [X] T035 [US4] Add SSE events (`port_conflict`, `port_reassigned`) and return immutable copies of services/mocks with updated ports plus `PortMapping[]` in `packages/core/src/resilience/port-resolver.ts`
- [X] T036 [US4] Integrate `PortResolver` in `handleSetup` in `packages/mcp/src/tools/setup.ts` — resolve ports before container creation and add `portMappings` to `SetupResult`
- [X] T037 [US4] Re-export port-resolver module from `packages/core/src/resilience/index.ts`

### Tests for User Story 4

- [X] T038 [P] [US4] Write unit tests for port availability scanning, auto-resolution across multiple services, fail strategy, port exhaustion in `packages/core/tests/unit/resilience/port-resolver.test.ts`

**Checkpoint**: US4 complete — port conflicts are auto-resolved. AI Agents receive correct endpoint information.

---

## Phase 7: US5 — Orphan Resource Auto-Cleanup (Priority: P1)

**Goal**: Detect leftover Docker containers, networks, and volumes from previous ArgusAI runs using Docker labels. Auto-clean when enabled, report failures without blocking other cleanup.

**Independent Test**: Manually create labeled Docker resources, run setup, verify orphans are detected, cleaned, and reported.

### Implementation for User Story 5

- [X] T039 [P] [US5] Add `OrphanResource` (type, name, id, project, runId, createdAt) and `OrphanCleanupResult` (found, removed, failed, duration) types to `packages/core/src/types.ts`
- [X] T040 [US5] Implement `OrphanCleaner.detect()` — run `docker ps -a --filter label=argusai.managed=true --filter label=argusai.project=<currentProject>` and `docker network ls --filter label=argusai.managed=true`, exclude current `runId`, return `OrphanResource[]` in `packages/core/src/resilience/orphan-cleaner.ts`
- [X] T041 [US5] Implement `OrphanCleaner.cleanup(orphans)` — stop and remove containers via `docker rm -f`, remove networks via `docker network rm`, isolate per-resource errors (FR-R17), remove containers before networks in `packages/core/src/resilience/orphan-cleaner.ts`
- [X] T042 [US5] Implement `OrphanCleaner.detectAndCleanup()` with SSE events (`cleanup_start`, `cleanup_resource`, `cleanup_end`) in `packages/core/src/resilience/orphan-cleaner.ts`
- [X] T043 [US5] Wire orphan cleanup into preflight gate — call `OrphanCleaner.detectAndCleanup()` when `resilience.preflight.cleanOrphans` is `true` before setup proceeds in `packages/mcp/src/tools/setup.ts`
- [X] T044 [US5] Re-export orphan-cleaner module from `packages/core/src/resilience/index.ts`

### Tests for User Story 5

- [X] T045 [P] [US5] Write unit tests for orphan detection (filter by project, exclude current run), cleanup with partial failures, empty-orphan fast path, cross-project isolation in `packages/core/tests/unit/resilience/orphan-cleaner.test.ts`

**Checkpoint**: US5 complete — stale resources are cleaned up before each run, preventing port/network/disk conflicts.

---

## Phase 8: US6 — Circuit Breaker for Docker Operations (Priority: P1)

**Goal**: Prevent AI Agents from infinite retry loops against a broken Docker environment. After consecutive failures exceed the threshold, fail fast with `CIRCUIT_OPEN`. Support manual reset to half-open via MCP tool.

**Independent Test**: Stop Docker, make repeated calls, verify circuit opens after threshold, confirm fail-fast, reset and verify probe behavior.

### Implementation for User Story 6

- [X] T046 [P] [US6] Add `CircuitState` (`closed`|`open`|`half-open`) and `CircuitBreakerState` (state, failureCount, lastFailureTime, lastStateTransition, failureHistory) types to `packages/core/src/types.ts`
- [X] T047 [US6] Implement `CircuitBreaker` class with state machine (closed→open on threshold, open→half-open on reset, half-open→closed on probe success, half-open→open on probe failure) in `packages/core/src/resilience/circuit-breaker.ts`
- [X] T048 [US6] Implement `CircuitBreaker.execute<T>(operation)` — run operation in closed state (increment failures on error), throw `ArgusError(CIRCUIT_OPEN)` immediately in open state (<100ms), attempt single probe in half-open state in `packages/core/src/resilience/circuit-breaker.ts`
- [X] T049 [US6] Implement `CircuitBreaker.reset()` returning `{previous, current}` state and `getState()` returning full `CircuitBreakerState`; emit SSE events (`circuit_open`, `circuit_half_open`, `circuit_closed`) on transitions in `packages/core/src/resilience/circuit-breaker.ts`
- [X] T050 [US6] Create `ResilientDockerEngine` wrapper class that proxies all Docker CLI calls through `circuitBreaker.execute()` in `packages/core/src/resilience/index.ts`
- [X] T051 [US6] Add `circuitBreaker` field to `ProjectSession` interface and initialize a `CircuitBreaker` instance per session in `packages/mcp/src/session.ts`
- [X] T052 [US6] Wrap `buildImage()` calls through circuit breaker via `ResilientDockerEngine` in `packages/mcp/src/tools/build.ts`
- [X] T053 [US6] Re-export circuit-breaker module from `packages/core/src/resilience/index.ts`

### Tests for User Story 6

- [X] T054 [P] [US6] Write unit tests for state transitions (all paths), fail-fast timing verification (<100ms), probe success/failure, reset from open/closed, concurrent operation safety — target 90%+ coverage in `packages/core/tests/unit/resilience/circuit-breaker.test.ts`

**Checkpoint**: US6 complete — broken environments trigger fast failure instead of infinite retries.

---

## Phase 9: US7 — Network Resilience & Mock Service Verification (Priority: P2)

**Goal**: Before tests run, verify mock services are reachable from the test container via Docker DNS. On failure, provide enhanced diagnostics including network topology, DNS results, and connectivity outcomes.

**Independent Test**: Misconfigure Docker networking, verify the system detects and reports connectivity problems with actionable diagnostics.

### Implementation for User Story 7

- [X] T055 [P] [US7] Add `ConnectivityResult` (service, hostname, reachable, dnsResolved, latencyMs, error?) and `NetworkVerificationReport` (results, allReachable, networkTopology, timestamp) types to `packages/core/src/types.ts`
- [X] T056 [US7] Implement `NetworkVerifier.checkDnsResolution(fromContainer, hostname)` — run `docker exec <container> nslookup <hostname>`, return `{resolved, address?}` in `packages/core/src/resilience/network-verifier.ts`
- [X] T057 [US7] Implement `NetworkVerifier.verifyConnectivity(testContainer, mockServices, networkName)` — TCP check per mock service via `docker exec <container> nc -z <host> <port>`, collect network topology from `docker network inspect`, build `NetworkVerificationReport` in `packages/core/src/resilience/network-verifier.ts`
- [X] T058 [US7] Add SSE events (`network_check`, `network_verified`) and throw `ArgusError(NETWORK_UNREACHABLE)` or `ArgusError(DNS_RESOLUTION_FAILED)` with topology diagnostics on failure in `packages/core/src/resilience/network-verifier.ts`
- [X] T059 [US7] Integrate `NetworkVerifier.verifyConnectivity()` in `handleSetup` in `packages/mcp/src/tools/setup.ts` — run after all services are healthy when `resilience.network.verifyConnectivity` is `true`, add `networkVerification` to `SetupResult`
- [X] T060 [US7] Re-export network-verifier module from `packages/core/src/resilience/index.ts`

### Tests for User Story 7

- [X] T061 [P] [US7] Write unit tests for DNS resolution (success/failure), connectivity checks (reachable/unreachable), topology collection, diagnostic formatting in `packages/core/tests/unit/resilience/network-verifier.test.ts`

**Checkpoint**: US7 complete — network issues produce actionable diagnostics instead of cryptic timeouts.

---

## Phase 10: US8 — MCP Tools for Manual Recovery (Priority: P2)

**Goal**: Expose `argus_preflight_check` and `argus_reset_circuit` MCP tools so AI Agents can proactively manage environment health and circuit breaker state.

**Independent Test**: Call each MCP tool under relevant conditions and verify structured responses match expected formats.

### Implementation for User Story 8

- [X] T062 [US8] Implement `argus_preflight_check` handler — accept `projectPath`, optional `skipDiskCheck`, `skipOrphanCheck`, `autoFix` params; create `PreflightChecker`, run checks respecting skip flags, run `OrphanCleaner.cleanup()` when `autoFix` is true; include circuit breaker state in response when available; return `HealthReport` in `packages/mcp/src/tools/preflight-check.ts`
- [X] T063 [US8] Implement `argus_reset_circuit` handler — accept `projectPath`, retrieve circuit breaker from session, call `reset()`, return previous state, new state, and failure history; handle already-closed no-op case in `packages/mcp/src/tools/reset-circuit.ts`
- [X] T064 [US8] Register `argus_preflight_check` and `argus_reset_circuit` tools with Zod parameter schemas in `packages/mcp/src/server.ts` (tool count: 9→11)

### Tests for User Story 8

- [X] T066 [P] [US8] Write unit tests for `argus_preflight_check` (with/without skip flags, autoFix mode) and `argus_reset_circuit` (open→half-open, already-closed no-op) MCP handlers

**Checkpoint**: US8 complete — AI Agents have manual override capabilities for environment health and circuit breaker management.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, re-exports, and validation across all user stories

- [X] T067 Add `export * from './resilience/index.js'` to `packages/core/src/index.ts` for public API surface
- [X] T068 Update `cleanAll()` in `packages/core/src/orchestrator.ts` to invoke `OrphanCleaner` for cleanup on teardown
- [X] T069 [P] Extend `packages/core/src/diagnostics.ts` with container restart diagnostics formatting for `RestartHistory` display
- [X] T070 [P] Validate all resilience config defaults behave correctly when no `resilience` section is present in `e2e.yaml` — ensure preflight enabled, auto port resolution, restart on failure with 3 max restarts
- [X] T071 Finalize `SetupResult` type extensions (`preflight?: HealthReport`, `portMappings?: PortMapping[]`, `networkVerification?: NetworkVerificationReport`, `orphanCleanup?: OrphanCleanupResult`) and setup response serialization in `packages/mcp/src/tools/setup.ts`
- [X] T072 [P] Run full resilience test suite and verify 85%+ overall coverage, 90%+ for `error-codes.test.ts` and `circuit-breaker.test.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — **BLOCKS US2–US8** (all stories use error codes)
- **US2 (Phase 4)**: Depends on US1 — **BLOCKS US8** (MCP tool wraps preflight)
- **US3–US6 (Phases 5–8)**: All depend on US1; **can run in parallel** with each other
- **US7 (Phase 9)**: Depends on US1; can parallel with US3–US6
- **US8 (Phase 10)**: Depends on US2 (preflight) and US6 (circuit breaker)
- **Polish (Phase 11)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
  └─→ Phase 2 (Foundational)
        └─→ Phase 3 (US1: Error Codes) ← ALL stories depend on this
              ├─→ Phase 4 (US2: Preflight) ────────────────┐
              ├─→ Phase 5 (US3: Container Guardian) [P]    │
              ├─→ Phase 6 (US4: Port Resolver) [P]         │
              ├─→ Phase 7 (US5: Orphan Cleaner) [P]        │
              ├─→ Phase 8 (US6: Circuit Breaker) [P] ──────┤
              └─→ Phase 9 (US7: Network Verifier) [P]      │
                                                            └─→ Phase 10 (US8: MCP Tools)
                                                                  └─→ Phase 11 (Polish)
```

### Within Each User Story

1. Types/interfaces first (if story adds new types)
2. Core class implementation (constructor, main methods)
3. SSE events and error handling integration
4. Integration with existing MCP tools/orchestrator
5. Barrel export update
6. Unit tests (can parallel with integration step)

### Parallel Opportunities

**Story-level parallelism** (after US1 completes):
- US3, US4, US5, US6, US7 can all proceed simultaneously — they touch different files with no cross-dependencies
- This represents **37 tasks** (Phases 5–9) that can be distributed across parallel workers

**Task-level parallelism** (within each phase):
- All tasks marked `[P]` can run alongside other tasks in the same phase
- Type definition tasks (`[P]`) can run while previous story's integration is being tested
- Test writing tasks (`[P]`) can run alongside integration tasks in the same story

---

## Parallel Example: P1 User Stories (Phases 5–8)

After US1 (error codes) and US2 (preflight) are complete, all P1 stories can launch in parallel:

```text
Worker A: US3 — Container Guardian
  T025 → T026 → T027 → T028 → T029 → T030 + T031

Worker B: US4 — Port Resolver
  T032 → T033 → T034 → T035 → T036 → T037 + T038

Worker C: US5 — Orphan Cleaner
  T039 → T040 → T041 → T042 → T043 → T044 + T045

Worker D: US6 — Circuit Breaker
  T046 → T047 → T048 → T049 → T050 → T051 → T052 → T053 + T054
```

---

## Implementation Strategy

### MVP First (US1 + US2 = Error Codes + Preflight)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks everything)
3. Complete Phase 3: US1 — Structured Error Codes
4. Complete Phase 4: US2 — Preflight Health Check
5. **STOP and VALIDATE**: Trigger error conditions → verify structured error codes. Run preflight with Docker stopped / low disk → verify health report.
6. Deploy/demo if ready — AI Agents can now get structured errors and preflight reports

### Incremental Delivery

1. Setup + Foundational + US1 + US2 → **MVP: Error codes + preflight** ✅
2. Add US3 (Container Guardian) → Transient crashes auto-recover ✅
3. Add US4 (Port Resolver) → Port conflicts auto-resolve ✅
4. Add US5 (Orphan Cleaner) → Stale resources auto-cleaned ✅
5. Add US6 (Circuit Breaker) → Broken environments fail fast ✅
6. Add US7 (Network Verifier) → Network issues diagnosed ✅
7. Add US8 (MCP Tools) → AI Agents get manual controls ✅
8. Polish → Final integration, coverage validation ✅

### Summary Table

| Phase | Story | Priority | Tasks | Parallel | Files Created | Files Modified |
|-------|-------|----------|-------|----------|---------------|----------------|
| 1 | Setup | — | 2 | 1 | 2 | 0 |
| 2 | Foundational | — | 6 | 2 | 0 | 3 |
| 3 | US1: Error Codes | P0 | 7 | 1 | 1 | 2 |
| 4 | US2: Preflight | P0 | 9 | 1 | 1 | 3 |
| 5 | US3: Container Guardian | P1 | 7 | 2 | 1 | 2 |
| 6 | US4: Port Resolver | P1 | 7 | 2 | 1 | 2 |
| 7 | US5: Orphan Cleaner | P1 | 7 | 2 | 1 | 2 |
| 8 | US6: Circuit Breaker | P1 | 9 | 2 | 1 | 3 |
| 9 | US7: Network Verifier | P2 | 7 | 2 | 1 | 2 |
| 10 | US8: MCP Tools | P2 | 5 | 1 | 2 | 2 |
| 11 | Polish | — | 6 | 3 | 0 | 4 |
| **Total** | | | **72** | **19** | **11** | **~15** |

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase
- `[Story]` labels (US1–US8) map each task to its user story for traceability
- Each user story is independently completable and testable at its checkpoint
- Commit after each task or logical group within a story
- Stop at any checkpoint to validate the story independently
- Tests use Vitest with `vi.mock()` for Docker CLI isolation — no real Docker required for unit tests
- All new code uses TypeScript strict mode, ESM imports, no `any` types
- Zero new runtime dependencies — reuse existing `retry-engine.ts`, `node:net`, `node:child_process`
