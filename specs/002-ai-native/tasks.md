# Tasks: Preflight AI-Native Infrastructure Enhancement

**Input**: Design documents from `/specs/002-ai-native/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mcp-tools.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. User stories sharing the same priority are grouped into the same phase (matching spec.md phases).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story(ies) this task belongs to (e.g., US1, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new MCP package, install dependencies, and establish project scaffolding

- [X] T001 Create `packages/mcp/` directory structure with `src/`, `src/tools/`, `src/formatters/`, `tests/unit/tools/`, `tests/unit/formatters/`
- [X] T002 Create `packages/mcp/package.json` with name `@preflight/mcp`, type `module`, dependency on `@preflight/core` (workspace:\*), `@modelcontextprotocol/sdk` ^1.11, and `zod`
- [X] T003 Create `packages/mcp/tsconfig.json` extending root tsconfig conventions (strict, ESM, NodeNext module resolution, outDir `dist/`)
- [X] T004 Add `zod-to-json-schema` as devDependency to `packages/core/package.json` via `pnpm --filter @preflight/core add -D zod-to-json-schema`
- [X] T005 [P] Create `schemas/` directory at project root for generated JSON Schema output files
- [X] T006 [P] Verify pnpm workspace picks up `packages/mcp/` — run `pnpm install` to link workspace packages
- [X] T007 [P] Verify `pnpm build` succeeds with the new package in the dependency graph (add build script to `packages/mcp/package.json`)

**Checkpoint**: New MCP package scaffolded, dependencies installed, workspace linked

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Bug fixes and core type extensions that MUST be complete before any user story implementation

**⚠️ CRITICAL**: These fix correctness, security, and reliability issues that all subsequent work depends on.

### Bug Fixes (FR-011 through FR-016)

- [X] T008 [P] Fix `buildImage` event loss in `packages/core/src/docker-engine.ts`: replace broken callback-based `buildImage` with the working queue-based pattern from `buildImageStreaming`; keep `buildImageStreaming` as alias for backward compat (FR-011)
- [X] T009 [P] Fix command injection in `packages/core/src/docker-engine.ts`: replace all `execSync(\`docker ${args.join(' ')}\`)` with `execFileSync('docker', args)` in `startContainer`, `stopContainer`, `getContainerStatus`, `isContainerRunning`, `getContainerLogs`, `execInContainer`, `ensureNetwork`, `removeNetwork`, `waitForHealthy`, and the `safeExec` helper (FR-012)
- [X] T010 [P] Fix `isPortInUse` in `packages/core/src/docker-engine.ts`: rewrite as async `Promise<boolean>` using `net.createServer().listen()` with `EADDRINUSE` detection; update all callers to `await` (FR-013)
- [X] T011 [P] Fix `execSync` in `packages/core/src/yaml-engine.ts`: replace all `execSync` calls in `executeExecStep`, `executeFileStep`, `executeProcessStep`, `executePortStep` with `util.promisify(execFile)` async equivalents; ensure all step functions are properly `async` (FR-014)
- [X] T012 [P] Fix shared `startTime` in `packages/core/src/mock-generator.ts`: move module-level `const startTime = Date.now()` inside `createMockServer` so each instance has its own creation timestamp (FR-015)
- [X] T013 [P] Fix hardcoded secrets in `examples/as-mate/e2e.yaml`: replace literal COS credentials (lines 46-48, 140-144) with `$AS_MATE_COS_SECRET_ID` and `$AS_MATE_COS_SECRET_KEY` env var references; create `examples/as-mate/.env.example` documenting required variables (FR-016)

### Bug Fix Regression Tests

- [X] T014 [P] Add regression test for buildImage event capture in `packages/core/tests/unit/docker-engine.test.ts`: verify `buildImage` yields `build_log` events for each stdout/stderr line (not just `build_start`/`build_end`)
- [X] T015 [P] Add regression test for command injection prevention in `packages/core/tests/unit/docker-engine.test.ts`: pass shell metacharacters in container name/env values, verify `execFileSync` is called (not `execSync`)
- [X] T016 [P] Add regression test for `isPortInUse` in `packages/core/tests/unit/docker-engine.test.ts`: bind a port → verify returns `true`; free port → verify returns `false`
- [X] T017 [P] Add regression test for async yaml-engine steps in `packages/core/tests/unit/yaml-engine.test.ts`: run exec/file/process/port steps, verify no `execSync` calls, verify event loop not blocked
- [X] T018 [P] Add regression test for mock-generator shared state in `packages/core/tests/unit/mock-generator.test.ts`: create two mock servers with time gap, verify each reports independent uptime

### Core Type Extensions

- [X] T019 Add new interfaces to `packages/core/src/types.ts`: `AIFriendlyTestResult`, `DiagnosticReport`, `RetryPolicy`, `AttemptResult`, `ServiceDefinition`, `ParallelConfig` as defined in data-model.md
- [X] T020 Extend `TestEvent` type union in `packages/core/src/types.ts`: add optional `diagnostics?: DiagnosticReport`, `attempts?: AttemptResult[]`, `request?`, `response?`, `assertions?` fields to `case_fail` event; add optional `attempts?` to `case_pass`
- [X] T021 Extend `E2EConfig` interface in `packages/core/src/types.ts`: add optional `services?: ServiceDefinition[]` field and extend `tests` with optional `retry?: RetryPolicy` and `parallel?: ParallelConfig`
- [X] T022 Extend `TestSuiteConfig` in `packages/core/src/types.ts`: add optional `retry?: RetryPolicy`, `parallel?: boolean`, `concurrency?: number` fields; add `'playwright'` to runner type
- [X] T023 Extend `TestStep` in `packages/core/src/types.ts`: add optional `retry?: RetryPolicy` field for per-case retry override
- [X] T024 Extend `SuiteReport` case type in `packages/core/src/types.ts`: add optional `attempts?: AttemptResult[]` and `diagnostics?: DiagnosticReport` fields
- [X] T025 Export all new types from `packages/core/src/index.ts`

**Checkpoint**: All bugs fixed with regression tests. Core types extended. Foundation ready for user story implementation.

---

## Phase 3: User Stories 1 & 2 — MCP Server + AI-Friendly Output (Priority: P0) 🎯 MVP

**Goal**: AI Agents can invoke the full Preflight lifecycle (build → setup → run → clean) via MCP tools and receive structured JSON results with rich failure diagnostics.

**Independent Test**: Connect an MCP client to the server, run the complete workflow, verify structured JSON at each step. Introduce intentional test failures and verify diagnostic fields are populated.

### US1: MCP Server Implementation

- [X] T026 [US1] Create MCP session manager in `packages/mcp/src/session.ts`: implement `ProjectSession` interface and `SessionManager` class with `getOrThrow`, `create`, `remove`, `has` methods; state machine for `initialized → built → running → stopped`
- [X] T027 [US1] Create MCP server core in `packages/mcp/src/server.ts`: instantiate `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` with name `@preflight/mcp`, version `0.1.0`; register all 9 tools; export `createServer()` factory
- [X] T028 [US1] Create server entry point in `packages/mcp/src/index.ts`: import server, create `StdioServerTransport`, connect server to transport, handle graceful shutdown
- [X] T029 [P] [US1] Implement `preflight_init` tool handler in `packages/mcp/src/tools/init.ts`: validate input with Zod, call `loadConfig()` from `@preflight/core`, create session, return `InitResult` JSON envelope
- [X] T030 [P] [US1] Implement `preflight_build` tool handler in `packages/mcp/src/tools/build.ts`: call `buildImage()` from core, send MCP progress notifications (`notifications/progress`) for each build log line using `progressToken` from `_meta`, return `BuildResult` JSON
- [X] T031 [P] [US1] Implement `preflight_setup` tool handler in `packages/mcp/src/tools/setup.ts`: create Docker network, start mock services, start service containers, wait for health checks, update session state to `running`, return `SetupResult` JSON
- [X] T032 [P] [US1] Implement `preflight_run` tool handler in `packages/mcp/src/tools/run.ts`: execute test suites via `executeYAMLSuite()`, format results as `AIFriendlyTestResult[]`, support `filter` and `parallel` params, return `RunResult` JSON
- [X] T033 [P] [US1] Implement `preflight_run_suite` tool handler in `packages/mcp/src/tools/run.ts` (same file as T032): execute single suite by `suiteId`, return same format as `preflight_run` with single suite
- [X] T034 [P] [US1] Implement `preflight_status` tool handler in `packages/mcp/src/tools/status.ts`: query container status, network status, mock service status for all managed resources, return `StatusResult` JSON
- [X] T035 [P] [US1] Implement `preflight_logs` tool handler in `packages/mcp/src/tools/logs.ts`: call `getContainerLogs()` from core with `lines` and `since` params, return `LogsResult` JSON
- [X] T036 [P] [US1] Implement `preflight_clean` tool handler in `packages/mcp/src/tools/clean.ts`: stop containers (best-effort, force if requested), stop mock servers, remove Docker network, remove session, return `CleanResult` JSON
- [X] T037 [P] [US1] Implement `preflight_mock_requests` tool handler in `packages/mcp/src/tools/mock-requests.ts`: fetch `/_mock/requests` from each mock endpoint, support `mockName` filter and `clear` option, return `MockRequestsResult` JSON

### US2: AI-Friendly Output & Diagnostics

- [X] T038 [US2] Create `DiagnosticCollector` class in `packages/core/src/diagnostics.ts`: implement `collectContainerDiagnostics(containerName)` (last 50 lines logs + health), `collectMockDiagnostics(mockEndpoints)` (GET /_mock/requests), `collectNetworkDiagnostics(networkName)` (docker network inspect), and `collect(options)` aggregator; use `Promise.allSettled` for parallel collection with timeouts
- [X] T039 [US2] Create result formatter in `packages/mcp/src/formatters/result-formatter.ts`: implement `toAIFriendly(testReport, diagnostics)` converting `TestReport` → `AIFriendlyTestResult[]`; passing tests get minimal output (status + timing), failing tests get full diagnostics including request/response context, assertion details, container logs, mock requests, NL summary, and optional `suggestedFix`
- [X] T040 [US2] Wire diagnostics into test execution flow: modify `packages/core/src/yaml-engine.ts` to call `DiagnosticCollector.collect()` on `case_fail` events and attach `DiagnosticReport` to the event's `diagnostics` field
- [X] T041 [US2] Generate natural-language failure summaries in `packages/mcp/src/formatters/result-formatter.ts`: create a `generateSummary(event)` function that produces a one-sentence description of the failure (e.g., "POST /create returned 500 instead of expected 200, container logs show ECONNREFUSED")

### US1+US2: Unit Tests

- [X] T042 [P] [US1] Write unit tests for session manager in `packages/mcp/tests/unit/session.test.ts`: test create/get/remove/state transitions/concurrent sessions
- [X] T043 [P] [US1] Write unit tests for `preflight_init` handler in `packages/mcp/tests/unit/tools/init.test.ts`: test valid config, missing config, invalid config, duplicate session
- [X] T044 [P] [US1] Write unit tests for `preflight_build` handler in `packages/mcp/tests/unit/tools/build.test.ts`: test successful build, failed build, progress notifications, no-cache option
- [X] T045 [P] [US1] Write unit tests for `preflight_setup` handler in `packages/mcp/tests/unit/tools/setup.test.ts`: test environment startup, health check timeout, port conflict
- [X] T046 [P] [US1] Write unit tests for `preflight_run` handler in `packages/mcp/tests/unit/tools/run.test.ts`: test all-pass, mixed results, suite filter, not-running error
- [X] T047 [P] [US1] Write unit tests for `preflight_status`, `preflight_logs`, `preflight_clean`, `preflight_mock_requests` handlers in `packages/mcp/tests/unit/tools/status.test.ts`, `logs.test.ts`, `clean.test.ts`, `mock-requests.test.ts`
- [X] T048 [P] [US2] Write unit tests for `DiagnosticCollector` in `packages/core/tests/unit/diagnostics.test.ts`: test container log collection, health status, mock request fetch, network inspect, timeout handling, partial failure (one service unreachable)
- [X] T049 [P] [US2] Write unit tests for result formatter in `packages/mcp/tests/unit/formatters/result-formatter.test.ts`: test passing-test minimal output, failing-test full diagnostics, NL summary generation, mixed results

### CLI Integration

- [X] T050 [US1] Add `mcp-server` subcommand to CLI in `packages/cli/src/commands/mcp-server.ts`: import `@preflight/mcp`, start the MCP server with stdio transport, handle SIGINT/SIGTERM for graceful shutdown
- [X] T051 [US1] Register `mcp-server` command in `packages/cli/src/index.ts`: add new subcommand entry so `e2e-toolkit mcp-server` starts the MCP server

**Checkpoint**: Full MCP lifecycle works end-to-end. AI Agents receive structured JSON with rich failure diagnostics. This is the MVP.

---

## Phase 4: User Stories 3 & 4 — Bug Fixes Verification + JSON Schema (Priority: P0-P1)

**Goal US3**: All six known bugs verified fixed with passing regression tests (completed in Phase 2, this phase validates).

**Goal US4**: JSON Schema enables AI-authored test YAML with IDE validation support.

**Independent Test US3**: Run the full regression test suite added in Phase 2 and confirm all pass.

**Independent Test US4**: Validate existing example YAML files against generated schema; introduce invalid YAML and confirm validation errors.

### US3: Bug Fix Validation

- [X] T052 [US3] Run all regression tests from Phase 2 (T014-T018) and verify 100% pass rate; fix any remaining issues
- [X] T053 [US3] Manually verify `examples/as-mate/e2e.yaml` contains no hardcoded secrets — all sensitive values use `$ENV_VAR` syntax

### US4: JSON Schema Generation

- [X] T054 [P] [US4] Add `.describe()` annotations to all fields in existing Zod schemas in `packages/core/src/config-loader.ts`: cover `E2EConfigSchema`, all step types (http, exec, file, process, port), assertion operators, service config, mock config, and test suite structure with human-readable titles and descriptions
- [X] T055 [US4] Create JSON Schema generator module in `packages/core/src/schema-generator.ts`: use `zod-to-json-schema` to convert `E2EConfigSchema` → `schemas/e2e-config.schema.json` and `TestSuiteSchema` → `schemas/test-suite.schema.json`; export `generateSchemas(outputDir)` function
- [X] T056 [US4] Add schema generation to build pipeline: add a `generate:schemas` script in `packages/core/package.json` that runs the schema generator; wire into root `pnpm build` flow
- [X] T057 [US4] Validate generated schemas against existing examples: run `ajv validate -s schemas/e2e-config.schema.json -d examples/as-mate/e2e.yaml` and verify it passes; verify an intentionally invalid YAML fails
- [X] T058 [P] [US4] Write unit tests for schema generator in `packages/core/tests/unit/schema-generator.test.ts`: verify output is valid JSON Schema, all fields have descriptions, valid configs pass validation, invalid configs fail

**Checkpoint**: All bugs verified fixed. JSON Schema generated and validated.

---

## Phase 5: User Stories 5 & 6 — Retry Mechanism + Async Migration (Priority: P1)

**Goal US5**: Tests can be configured with per-case and global retry policies; exhausted retries include auto-diagnostics.

**Goal US6**: All Docker-related YAML steps execute asynchronously without blocking the event loop.

**Independent Test US5**: Configure retry on a test case against a flaky mock, verify retries occur with correct backoff timing and attempt history appears in results.

**Independent Test US6**: Run YAML tests with exec/file/process/port steps and verify event-loop responsiveness (setTimeout check shows no blocking).

### US5: Retry Engine

- [X] T059 [US5] Create `RetryExecutor` class in `packages/core/src/retry-engine.ts`: implement `execute(testCaseFn, retryPolicy)` method with support for `maxAttempts`, `delay` (parse "2s"/"500ms" strings), `backoff: 'linear' | 'exponential'`, and `backoffMultiplier`; record each `AttemptResult`; on final failure call `DiagnosticCollector.collect()` and attach to event
- [X] T060 [US5] Add `RetryPolicySchema` Zod schema to `packages/core/src/config-loader.ts`: define `maxAttempts` (min 1, max 10), `delay` (string), `backoff` (optional enum), `backoffMultiplier` (optional number, default 2) with `.describe()` annotations
- [X] T061 [US5] Extend `E2EConfigSchema` in `packages/core/src/config-loader.ts`: add optional `retry?: RetryPolicySchema` to the `tests` object for global retry policy
- [X] T062 [US5] Extend `TestSuiteSchema` in `packages/core/src/config-loader.ts`: add optional `retry?: RetryPolicySchema` for suite-level override
- [X] T063 [US5] Integrate retry into YAML engine in `packages/core/src/yaml-engine.ts`: before executing each test case, resolve effective `RetryPolicy` (case-level > suite-level > global); wrap case execution with `RetryExecutor.execute()`; emit `case_pass`/`case_fail` with `attempts` history
- [X] T064 [US5] Ensure case-level retry takes precedence: in `packages/core/src/yaml-engine.ts` policy resolution, check `step.retry` first, then `suiteConfig.retry`, then `globalConfig.tests.retry`
- [X] T065 [P] [US5] Write unit tests for retry engine in `packages/core/tests/unit/retry-engine.test.ts`: test success on first attempt (no retry), success on Nth attempt, all attempts exhausted, linear backoff timing, exponential backoff timing, attempt history recording, diagnostics attachment on final failure
- [X] T066 [P] [US5] Add retry integration tests to `packages/core/tests/unit/yaml-engine.test.ts`: test global policy applies to case without retry, case-level overrides global, suite-level overrides global but not case-level

### US6: Async Migration

- [X] T067 [US6] (Covered by T011) Verify all `execSync` calls in `packages/core/src/yaml-engine.ts` are replaced with async `execFile` equivalents — confirm no `execSync` imports remain
- [X] T068 [US6] Verify all `execSync`/`execFileSync` calls in `packages/core/src/docker-engine.ts` that were converted in T009 now use async `execFile` equivalents where the calling code is already async; keep sync versions only where callers are synchronous
- [X] T069 [US6] Add async verification test in `packages/core/tests/unit/yaml-engine.test.ts`: execute a test with exec/file/process/port steps; use `setTimeout` callback to verify event loop is not blocked during step execution
- [X] T070 [US6] Backward compatibility validation: run all existing test fixtures against the async-migrated engine and verify identical results

**Checkpoint**: Retry engine functional with correct precedence. All YAML steps are async. Event loop never blocked.

---

## Phase 6: User Story 7 — Multi-Service Orchestration (Priority: P2)

**Goal**: Multi-service `e2e.yaml` configurations with independent build/start/health-check per service, shared Docker network, and full backward compatibility with single-service configs.

**Independent Test**: Define a two-service `e2e.yaml`, build and start both, verify inter-service communication via container name.

- [X] T071 [US7] Add `ServiceDefinitionSchema` Zod schema to `packages/core/src/config-loader.ts`: define `name`, `build` (ServiceBuildSchema), `container` (ServiceContainerSchema), `vars` (optional record), `dependsOn` (optional string array) with `.describe()` annotations
- [X] T072 [US7] Extend `E2EConfigSchema` in `packages/core/src/config-loader.ts`: add optional `services?: z.array(ServiceDefinitionSchema)`; add refine check requiring either `service` or `services`
- [X] T073 [US7] Create `MultiServiceOrchestrator` class in `packages/core/src/orchestrator.ts`: implement lifecycle methods `normalizeConfig(config)` (wrap single `service` into `services: [service]`), `buildAll(services)` (parallel builds), `startAll(services, networkName)` (sequential with `dependsOn` ordering), `healthCheckAll(services)`, `cleanAll(services, networkName)` (force cleanup even on partial failure)
- [X] T074 [US7] Implement `dependsOn` ordering in `packages/core/src/orchestrator.ts`: topological sort of `ServiceDefinition[]` based on `dependsOn` arrays; detect circular dependencies and throw clear error
- [X] T075 [US7] Wire orchestrator into MCP `preflight_setup` handler in `packages/mcp/src/tools/setup.ts`: use `MultiServiceOrchestrator` instead of direct Docker calls; handle both single and multi-service configs transparently
- [X] T076 [US7] Wire orchestrator into MCP `preflight_clean` handler in `packages/mcp/src/tools/clean.ts`: use `MultiServiceOrchestrator.cleanAll()` for comprehensive cleanup
- [X] T077 [US7] Update MCP `preflight_build` handler in `packages/mcp/src/tools/build.ts`: support `service` param for building specific service in multi-service mode; build all if omitted
- [X] T078 [P] [US7] Write unit tests for `MultiServiceOrchestrator` in `packages/core/tests/unit/orchestrator.test.ts`: test single-service normalization, multi-service parallel build, sequential start with dependsOn, health check failure cleanup, circular dependency detection, partial failure reporting
- [X] T079 [US7] Export `MultiServiceOrchestrator` and related types from `packages/core/src/index.ts`

**Checkpoint**: Multi-service orchestration works. Single-service configs unchanged. Services communicate on shared Docker network.

---

## Phase 7: User Story 8 — Playwright Browser Testing Runner (Priority: P2)

**Goal**: Playwright tests can be run as a test suite runner type, emitting standard `TestEvent` objects for unified reporting.

**Independent Test**: Configure a suite with `runner: playwright`, run it, verify TestEvent output matches standard format.

- [X] T080 [P] [US8] Create `PlaywrightRunner` class in `packages/core/src/runners/playwright-runner.ts`: implement `TestRunner` interface; `available()` checks if `@playwright/test` is resolvable; `run(config)` spawns `npx playwright test --reporter=json` with optional `--config` flag, parses JSON output, converts to `TestEvent` stream (suite_start, case_start, case_pass/case_fail, suite_end)
- [X] T081 [US8] Register `PlaywrightRunner` in `packages/core/src/test-runner.ts`: add to `createDefaultRegistry()` as `'playwright'` runner type
- [X] T082 [US8] Handle Playwright failure output: in `packages/core/src/runners/playwright-runner.ts`, parse Playwright error messages and attach failure screenshots/traces paths (if configured) to the `case_fail` event's error field
- [X] T083 [P] [US8] Write unit tests for `PlaywrightRunner` in `packages/core/tests/unit/playwright-runner.test.ts`: mock `spawn` to return sample Playwright JSON output; verify correct TestEvent conversion; test `available()` check; test failure handling with error output; test missing playwright dependency
- [X] T084 [US8] Add `@playwright/test` as optional peerDependency in `packages/core/package.json` with `"optional": true`

**Checkpoint**: Playwright runner registered. Tests emit standard TestEvents for unified reporting.

---

## Phase 8: User Story 9 — Parallel Test Suite Execution (Priority: P2)

**Goal**: Test suites marked `parallel: true` execute concurrently with isolated variable contexts, bounded by optional `concurrency` limit.

**Independent Test**: Configure 3 suites with `parallel: true`, verify concurrent execution (total time ≈ longest suite, not sum), verify no variable cross-contamination.

- [X] T085 [US9] Add `ParallelConfigSchema` Zod schema to `packages/core/src/config-loader.ts`: define `enabled` (boolean), `concurrency` (optional number) with `.describe()` annotations
- [X] T086 [US9] Extend `E2EConfigSchema` in `packages/core/src/config-loader.ts`: add optional `parallel?: ParallelConfigSchema` to the `tests` object
- [X] T087 [US9] Create `ParallelSuiteExecutor` class in `packages/core/src/parallel-engine.ts`: implement inline concurrency limiter (semaphore pattern — counter + queue); accept suites with `parallel: true` and `concurrency` limit; deep-clone `VariableContext` per suite using `structuredClone`; collect events from all suites with correct `suite` attribution; use `Promise.allSettled` to ensure all suites complete
- [X] T088 [US9] Integrate parallel execution into YAML engine or test runner: in `packages/core/src/yaml-engine.ts` (or a new coordinator), partition suites into parallel and sequential groups; execute parallel group via `ParallelSuiteExecutor`; execute sequential group in order
- [X] T089 [US9] Update reporter in `packages/core/src/reporter.ts`: handle interleaved events from parallel suites; correctly attribute events to source suite; ensure final report accurately reflects each suite's results
- [X] T090 [P] [US9] Write unit tests for `ParallelSuiteExecutor` in `packages/core/tests/unit/parallel-engine.test.ts`: test concurrent execution (timing), concurrency limit enforcement, variable context isolation (no cross-contamination), event attribution correctness, `Promise.allSettled` behavior when one suite fails
- [X] T091 [US9] Export `ParallelSuiteExecutor` from `packages/core/src/index.ts`

**Checkpoint**: Parallel suites run concurrently. Variables isolated. Reporter handles interleaved events.

---

## Phase 9: User Stories 10 & 11 — CI Templates + npm Packaging (Priority: P2)

**Goal US10**: Ready-to-use CI workflow templates for GitHub Actions and GitLab CI covering the full E2E lifecycle.

**Goal US11**: Packages configured for npm publication; global CLI installation works; `@preflight/mcp` independently installable.

**Independent Test US10**: Copy the GitHub Actions template to a test repo and run the pipeline.

**Independent Test US11**: Run `npm pack` on each package and verify contents; install `@preflight/mcp` independently and start the server.

### US10: CI Templates

- [X] T092 [P] [US10] Create GitHub Actions workflow template in `ci-templates/github-actions.yml`: include steps for checkout, Node.js 20 setup, pnpm install, preflight build, preflight setup, preflight run (JSON output to file), preflight clean, upload test-results.json as artifact; add configurable parameters (`project_path`, `test_filter`, `artifact_path`) as workflow inputs
- [X] T093 [P] [US10] Create GitLab CI template in `ci-templates/gitlab-ci.yml`: equivalent pipeline stages (install → build → setup → run → clean), artifact upload, configurable variables for project path, test filters, artifact paths
- [X] T094 [P] [US10] Create project-specific GitHub Actions workflow in `.github/workflows/preflight-e2e.yml`: example workflow using the template for the `examples/as-mate` project, triggered on push/PR

### US11: npm Packaging

- [X] T095 [US11] Update `packages/cli/package.json`: add `"bin": { "e2e-toolkit": "./dist/index.js" }`, `"files": ["dist/", "README.md"]`, `"publishConfig": { "access": "public" }`, verify `"exports"` field is correct
- [X] T096 [US11] Update `packages/mcp/package.json`: add `"bin": { "preflight-mcp": "./dist/index.js" }`, `"files": ["dist/", "README.md"]`, `"publishConfig": { "access": "public" }`, verify `"exports"` field points to `./dist/index.js`
- [X] T097 [US11] Verify independent installability: run `pnpm --filter @preflight/mcp pack` and inspect tarball contents; verify `dist/index.js` is the entry point and `@preflight/core` is a bundled or declared dependency
- [X] T098 [US11] Add shebang `#!/usr/bin/env node` to `packages/mcp/src/index.ts` and `packages/cli/src/index.ts` entry points for global CLI execution
- [X] T099 [US11] Verify global install works: `npm install -g ./packages/cli/` and confirm `e2e-toolkit --help` runs; `npm install -g ./packages/mcp/` and confirm `preflight-mcp` starts

**Checkpoint**: CI templates ready. Packages configured for npm publish. Global CLI works.

---

## Phase 10: User Story 12 — IDE Extension Support (Priority: P3)

**Goal**: VS Code/Cursor users get IntelliSense for test YAML files and MCP server configuration templates.

**Independent Test**: Open a YAML test file in VS Code with schema associated; verify autocompletion and validation.

- [X] T100 [P] [US12] Create `.vscode/settings.json` with JSON Schema associations: map `schemas/e2e-config.schema.json` to `e2e.yaml`/`e2e.yml` files, map `schemas/test-suite.schema.json` to `tests/*.yaml` files
- [X] T101 [P] [US12] Create MCP integration template in `mcp-templates/cursor-mcp-config.json`: template for adding Preflight MCP server to Cursor's `.cursor/mcp.json`; include `command`, `args` (pointing to `packages/mcp/dist/index.js`), and `env` fields with placeholder comments
- [X] T102 [US12] Document IDE setup in quickstart.md integration: verify `specs/002-ai-native/quickstart.md` section 6 matches the actual generated schema paths and VS Code settings

**Checkpoint**: IDE support configured. IntelliSense works for YAML test files.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Final quality, documentation, and validation across all user stories

- [X] T103a [P] Add MCP Server core unit test in `packages/mcp/tests/unit/server.test.ts`: test McpServer instantiation, verify all 9 tools are registered, test transport connection lifecycle, test graceful shutdown (analysis finding H1)
- [X] T103b Add session concurrency guard in `packages/mcp/src/session.ts`: implement mutex/state-machine lock to prevent concurrent operations on the same project; return `INVALID_STATE` error when concurrent MCP clients attempt operations (analysis finding H2)
- [X] T103c [P] Add JSDoc comments to all exported functions across new modules: diagnostics-collector.ts, retry-engine.ts, parallel-engine.ts, orchestrator.ts, schema-generator.ts, session.ts, server.ts, result-formatter.ts, and all MCP tool handler files (analysis finding H3, constitution compliance)
- [X] T103 Run full test suite across all packages: `pnpm test:run` — verify 100% pass rate
- [X] T104 Run test coverage: `pnpm test:coverage` — verify MCP handlers ≥90%, diagnostics ≥90%, retry engine ≥90%, overall ≥85%
- [X] T105 [P] Verify all new modules are exported from respective `index.ts` files: `packages/core/src/index.ts` (diagnostics, retry-engine, parallel-engine, orchestrator, schema-generator), `packages/mcp/src/index.ts`
- [X] T106 [P] Type-check entire project: run `pnpm type-check` (tsc -b) and resolve any TypeScript errors
- [X] T107 [P] Run linter: `pnpm lint` and fix any ESLint violations in new/modified files
- [X] T108 Validate quickstart.md end-to-end: follow all steps in `specs/002-ai-native/quickstart.md` from prerequisites through integration testing scenarios; document any corrections needed
- [X] T109 [P] Verify backward compatibility: run existing tests with unmodified `e2e.yaml` configs through the updated engine; confirm identical behavior
- [X] T110 [P] Security review: verify no `execSync` calls remain in production code paths (only `execFileSync` or async `execFile`); verify no shell string interpolation in Docker commands

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)        → No dependencies — start immediately
Phase 2 (Foundational) → Depends on Phase 1 — BLOCKS all user stories
Phase 3 (US1+US2, P0)  → Depends on Phase 2 — MVP delivery
Phase 4 (US3+US4, P0-P1) → Depends on Phase 2 (US3), Phase 2+3 (US4 for schema annotations)
Phase 5 (US5+US6, P1)  → Depends on Phase 2 (types) + Phase 3 (diagnostics for retry)
Phase 6 (US7, P2)      → Depends on Phase 2 (types) + Phase 3 (MCP setup handler)
Phase 7 (US8, P2)      → Depends on Phase 2 (types) — can parallel with Phase 6
Phase 8 (US9, P2)      → Depends on Phase 2 (types) — can parallel with Phase 6, 7
Phase 9 (US10+11, P2)  → Depends on Phase 3 (MCP package exists)
Phase 10 (US12, P3)    → Depends on Phase 4 (JSON Schema generated)
Phase 11 (Polish)       → Depends on all desired phases being complete
```

### User Story Independence

| Story | Can Start After | Dependencies on Other Stories |
|-------|----------------|-------------------------------|
| US1 (MCP Server) | Phase 2 | None |
| US2 (AI Output) | Phase 2 | US1 (result formatter integrates with MCP tools) |
| US3 (Bug Fixes) | Phase 2 (already done) | None |
| US4 (JSON Schema) | Phase 2 | None (but benefits from US5 retry schema) |
| US5 (Retry) | Phase 2 | US2 (diagnostics on retry exhaustion) |
| US6 (Async) | Phase 2 (already done in T011) | None |
| US7 (Multi-Service) | Phase 2 | US1 (MCP handlers use orchestrator) |
| US8 (Playwright) | Phase 2 | None (plugs into existing runner registry) |
| US9 (Parallel) | Phase 2 | None (extends test execution) |
| US10 (CI) | Phase 3 | US1 (CI uses CLI commands) |
| US11 (npm) | Phase 3 | US1 (MCP package must exist) |
| US12 (IDE) | Phase 4 | US4 (JSON Schema must be generated) |

### Parallel Opportunities

**Within Phase 2** (all bug fixes are in different files/functions):
- T008, T009, T010 can run in parallel (all in docker-engine.ts but different functions)
- T011 can parallel with above (yaml-engine.ts)
- T012 can parallel with above (mock-generator.ts)
- T013 can parallel with above (examples/as-mate/e2e.yaml)
- All regression tests T014-T018 can parallel with each other

**Within Phase 3** (MCP tool handlers are independent files):
- T029-T037 can all run in parallel (each is a separate tool handler file)
- T042-T049 can all run in parallel (each is a separate test file)

**Cross-Phase parallelism** (after Phase 2):
- Phase 6 (US7), Phase 7 (US8), Phase 8 (US9) can proceed in parallel
- Phase 4 (US4 schema) can parallel with Phase 5 (US5 retry)

---

## Parallel Execution Examples

### Example: Phase 2 Bug Fixes (6 developers)

```
Developer A: T008 (buildImage event loss fix)
Developer B: T009 (command injection fix)
Developer C: T010 (isPortInUse rewrite)
Developer D: T011 (yaml-engine async migration)
Developer E: T012 (mock-generator shared state fix)
Developer F: T013 (hardcoded secrets fix)
→ Then all regression tests T014-T018 in parallel
→ Then type extensions T019-T025 sequentially (same file)
```

### Example: Phase 3 MCP Tools (4 developers)

```
Developer A: T029 (init), T034 (status)
Developer B: T030 (build), T035 (logs)
Developer C: T031 (setup), T036 (clean)
Developer D: T032-T033 (run/run_suite), T037 (mock-requests)
→ All working in parallel on different files in packages/mcp/src/tools/
```

### Example: P2 Features (3 developers)

```
Developer A: Phase 6 — Multi-Service Orchestration (US7)
Developer B: Phase 7 — Playwright Runner (US8)
Developer C: Phase 8 — Parallel Execution (US9)
→ All three stories can proceed simultaneously after Phase 2
```

---

## Implementation Strategy

### MVP First (Phase 1 → 2 → 3)

1. **Phase 1**: Setup MCP package scaffolding (T001-T007)
2. **Phase 2**: Fix all bugs + extend types (T008-T025)
3. **Phase 3**: Implement MCP Server + AI-friendly output (T026-T051)
4. **STOP and VALIDATE**: Test MCP lifecycle end-to-end via quickstart.md Scenario 1
5. **Deploy/demo** the MVP: AI Agents can now run full build → setup → run → clean

### Incremental Delivery

| Increment | Phases | Delivers |
|-----------|--------|----------|
| MVP | 1 → 2 → 3 | MCP Server + AI diagnostics (core AI-native vision) |
| +Schema | + 4 | AI-authored YAML validation |
| +Reliability | + 5 | Retry mechanism + full async |
| +Scale | + 6, 7, 8 | Multi-service + Playwright + parallel |
| +Distribution | + 9, 10 | npm packages + CI templates + IDE support |
| Release | + 11 | Polished, tested, documented |

### Suggested MVP Scope

**User Stories 1 + 2 only** (Phase 1-3):
- 51 tasks (T001-T051)
- Delivers the complete AI-native testing vision
- Everything else is enhancement, reliability, or distribution

---

## Summary

| Metric | Count |
|--------|-------|
| **Total tasks** | 110 |
| Phase 1 (Setup) | 7 |
| Phase 2 (Foundational) | 18 |
| Phase 3 (US1+US2, P0 MVP) | 26 |
| Phase 4 (US3+US4, P0-P1) | 7 |
| Phase 5 (US5+US6, P1) | 12 |
| Phase 6 (US7, P2) | 9 |
| Phase 7 (US8, P2) | 5 |
| Phase 8 (US9, P2) | 7 |
| Phase 9 (US10+US11, P2) | 8 |
| Phase 10 (US12, P3) | 3 |
| Phase 11 (Polish) | 8 |
| **Parallel tasks** | 53 (48% of total) |
| **User stories covered** | 12/12 |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- All file paths are relative to `preflight/` project root
