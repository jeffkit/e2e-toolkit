# Implementation Plan: Preflight AI-Native Infrastructure Enhancement

**Branch**: `002-ai-native` | **Date**: 2026-02-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-ai-native/spec.md`

## Summary

Transform Preflight from a human-operated CLI tool into AI-native programming infrastructure by:
1. Adding an MCP Server package (`@preflight/mcp`) that exposes all Preflight operations as structured JSON tools
2. Enriching test failure output with full HTTP context, container diagnostics, and AI-oriented summaries
3. Fixing six known bugs in docker-engine, yaml-engine, and mock-generator
4. Adding reliability features (retry, async migration, JSON Schema)
5. Expanding capabilities (multi-service orchestration, Playwright runner, parallel execution)
6. Packaging for ecosystem distribution (npm, CI templates, IDE extensions)

## Technical Context

**Language/Version**: TypeScript 5.x strict mode, Node.js 20+ LTS
**Primary Dependencies**: @modelcontextprotocol/sdk ^1.11, Fastify 5.x, Zod 3.x, js-yaml 4.x, zod-to-json-schema 3.x, @playwright/test (optional peer)
**Storage**: N/A (stateless — Docker containers and file system)
**Testing**: Vitest 2.x with `vi.mock()`, 85-90% coverage targets
**Target Platform**: Linux (primary), macOS (dev), Windows WSL2
**Project Type**: Monorepo (pnpm workspaces)
**Performance Goals**: MCP tool response < 500ms for status/metadata ops; streaming for build/run
**Constraints**: Zero service-code intrusion; backward-compatible config; ESM-only
**Scale/Scope**: 4 packages (core, cli, dashboard, mcp), ~15 modified files, ~8 new files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| 1. Configuration-Driven | **PASS** | MCP tools read from `e2e.yaml`; retry/parallel/multi-service all YAML-configured |
| 2. Language-Agnostic Testing | **PASS** | Playwright runner adds browser tests via `TestRunner` interface; unified `TestEvent` preserved |
| 3. Zero-Intrusion | **PASS** | No service code changes; MCP operates on existing Docker/YAML infrastructure |
| 4. TypeScript Strict Mode | **PASS** | All new code in strict TS + ESM; `@preflight/mcp` uses same tsconfig conventions |
| 5. Test Coverage | **PASS** | MCP handlers 90%+, diagnostics 90%+, retry engine 90%+, bug-fix regression tests |
| 6. Single Entry CLI | **PASS** | CLI extended with `mcp-server` subcommand; existing commands unchanged |
| 7. SSE Real-Time Feedback | **PASS** | MCP progress notifications via `notifications/progress` complement existing SSE bus |
| 8. Extensible Architecture | **PASS** | Playwright runner uses existing `RunnerRegistry`; MCP tools are individually extensible |
| 9. Web Framework: Fastify | **PASS** | Mock server (Fastify 5.x) and MCP HTTP transport both Fastify-compatible |
| 10. Node.js 20+ | **PASS** | Native `fetch`, `AbortController`, `AbortSignal.timeout` used throughout |

**GATE RESULT: ALL PASS** — Proceed to Phase 0 research.

### Post-Design Re-evaluation (Phase 2)

After completing all design artifacts, re-checked each principle:

| Principle | Status | Post-Design Notes |
|-----------|--------|-------------------|
| 1. Configuration-Driven | **PASS** | `services[]`, `retry`, `parallel` are all YAML-driven. MCP tools read config, don't hardcode behavior. |
| 2. Language-Agnostic | **PASS** | Playwright runner emits `TestEvent` like all other runners. `AIFriendlyTestResult` is runner-agnostic. |
| 3. Zero-Intrusion | **PASS** | No new service code requirements. MCP Server operates externally via Docker CLI. |
| 4. TypeScript Strict | **PASS** | All new interfaces fully typed. No `any` usage. Zod schemas validate all inputs. |
| 5. Test Coverage | **PASS** | Plan includes unit tests for every new module. Coverage targets: MCP handlers 90%+, diagnostics 90%+. |
| 6. Single Entry CLI | **PASS** | `e2e-toolkit mcp-server` added as new subcommand. No changes to existing commands. |
| 7. SSE Real-Time | **PASS** | MCP progress notifications provide equivalent real-time feedback for build operations. |
| 8. Extensible | **PASS** | PlaywrightRunner plugs into RunnerRegistry. MCP tools are individually extensible. |
| 9. Fastify | **PASS** | Mock server continues using Fastify. MCP Server uses stdio transport (no conflict). |
| 10. Node.js 20+ | **PASS** | `execFile` (async), native `fetch`, `AbortSignal.timeout`, `structuredClone` for context cloning. |

**POST-DESIGN GATE: ALL PASS** — No new violations introduced. Ready for task breakdown.

## Project Structure

### Documentation (this feature)

```text
specs/002-ai-native/
├── plan.md              # This file
├── research.md          # Phase 0 output — technical decisions
├── data-model.md        # Phase 1 output — new/modified interfaces
├── quickstart.md        # Phase 1 output — usage guide
├── contracts/           # Phase 1 output — MCP tool contracts
│   └── mcp-tools.md     # All MCP tool input/output schemas
└── tasks.md             # Phase 2 output (NOT created by plan)
```

### Source Code (repository root)

```text
packages/
├── core/                          # @preflight/core (MODIFIED)
│   ├── src/
│   │   ├── types.ts               # MOD: Add AIFriendlyTestResult, RetryPolicy, DiagnosticReport,
│   │   │                          #      ServiceDefinition, enhanced TestEvent, ParallelConfig
│   │   ├── docker-engine.ts       # MOD: Fix buildImage event loss, startContainer command injection,
│   │   │                          #      isPortInUse detection; async migration of execSync
│   │   ├── yaml-engine.ts         # MOD: Replace execSync with async alternatives in exec/file/
│   │   │                          #      process/port steps; add retry mechanism
│   │   ├── mock-generator.ts      # MOD: Fix shared startTime module-level state
│   │   ├── config-loader.ts       # MOD: Extend E2EConfigSchema for services[], retry, parallel
│   │   ├── assertion-engine.ts    # (unchanged)
│   │   ├── variable-resolver.ts   # (unchanged)
│   │   ├── test-runner.ts         # MOD: Register PlaywrightRunner in default registry
│   │   ├── reporter.ts            # MOD: Support parallel suite event interleaving
│   │   ├── sse-bus.ts             # (unchanged)
│   │   ├── workspace.ts           # (unchanged)
│   │   ├── diagnostics.ts         # NEW: DiagnosticCollector — gathers logs, health, mock requests
│   │   ├── retry-engine.ts        # NEW: RetryExecutor — retry with backoff logic
│   │   ├── parallel-engine.ts     # NEW: ParallelSuiteExecutor — concurrent suite execution
│   │   ├── orchestrator.ts        # NEW: MultiServiceOrchestrator — multi-service lifecycle
│   │   ├── schema-generator.ts    # NEW: Generate JSON Schemas from Zod schemas
│   │   └── runners/
│   │       ├── yaml-runner.ts     # (unchanged)
│   │       ├── vitest-runner.ts   # (unchanged)
│   │       ├── shell-runner.ts    # (unchanged)
│   │       ├── exec-runner.ts     # (unchanged)
│   │       ├── pytest-runner.ts   # (unchanged)
│   │       └── playwright-runner.ts # NEW: Playwright test runner
│   └── tests/
│       └── unit/
│           ├── diagnostics.test.ts       # NEW
│           ├── retry-engine.test.ts      # NEW
│           ├── parallel-engine.test.ts   # NEW
│           ├── orchestrator.test.ts      # NEW
│           ├── schema-generator.test.ts  # NEW
│           ├── docker-engine.test.ts     # MOD: Add regression tests for bug fixes
│           ├── yaml-engine.test.ts       # MOD: Add async step + retry tests
│           ├── mock-generator.test.ts    # MOD: Add shared-state regression test
│           └── playwright-runner.test.ts # NEW
│
├── mcp/                           # @preflight/mcp (NEW PACKAGE)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts               # Server entry point
│   │   ├── server.ts              # McpServer setup, tool registration
│   │   ├── tools/
│   │   │   ├── init.ts            # preflight_init tool handler
│   │   │   ├── build.ts           # preflight_build (with streaming)
│   │   │   ├── setup.ts           # preflight_setup
│   │   │   ├── run.ts             # preflight_run + preflight_run_suite
│   │   │   ├── status.ts          # preflight_status
│   │   │   ├── logs.ts            # preflight_logs
│   │   │   ├── clean.ts          # preflight_clean
│   │   │   └── mock-requests.ts   # preflight_mock_requests
│   │   ├── formatters/
│   │   │   └── result-formatter.ts # Convert TestReport → AIFriendlyTestResult
│   │   └── session.ts             # Per-project session state management
│   └── tests/
│       └── unit/
│           ├── server.test.ts
│           ├── tools/*.test.ts
│           └── formatters/*.test.ts
│
├── cli/                           # @preflight/cli (MODIFIED)
│   └── src/
│       ├── index.ts               # MOD: Add `mcp-server` subcommand
│       └── commands/
│           └── mcp-server.ts      # NEW: Start MCP server via CLI
│
└── dashboard/                     # @preflight/dashboard (unchanged)

examples/
└── as-mate/
    └── e2e.yaml                   # MOD: Replace hardcoded secrets with env vars

schemas/                           # NEW: Generated JSON Schema files
├── e2e-config.schema.json
└── test-suite.schema.json

.github/
└── workflows/
    └── preflight-e2e.yml          # NEW: GitHub Actions CI template

ci-templates/
├── github-actions.yml             # NEW: Distributable CI template
└── gitlab-ci.yml                  # NEW: GitLab CI template

.vscode/
└── settings.json                  # NEW: JSON Schema association for YAML

mcp-templates/
└── cursor-mcp-config.json         # NEW: Cursor MCP integration template
```

**Structure Decision**: Existing pnpm monorepo extended with new `packages/mcp/` package. All new functionality resides in either `packages/core/src/` (shared engine code) or `packages/mcp/` (MCP-specific). This preserves the existing package boundaries and keeps the MCP server independently installable.

## Complexity Tracking

No constitution violations detected. All design decisions align with established principles.

---

## Implementation Phases

### Phase 1: AI Integration Foundation (P0)

**Bug Fixes** (FR-011 through FR-016):

1. **docker-engine.ts — `buildImage` event loss** (FR-011)
   - **Root cause**: Lines 154–163 collect lines inside a callback but comment says "We can't yield from inside a callback" and never emit them. The `buildImage` function only yields `build_start` and `build_end`, losing all intermediate `build_log` events.
   - **Fix**: Replace with the queue-based pattern already proven in `buildImageStreaming` (lines 195–260). Delete the broken `buildImage`, rename `buildImageStreaming` to `buildImage`, and keep the original `buildImageStreaming` as an alias for backward compatibility.
   - **Files**: `packages/core/src/docker-engine.ts`
   - **Tests**: Verify that `buildImage` yields `build_log` events for each stdout/stderr line.

2. **docker-engine.ts — `startContainer` command injection** (FR-012)
   - **Root cause**: Line 277 uses `execSync(`docker ${args.join(' ')}`)` which passes through shell interpretation. Environment variable values or container names with shell metacharacters can inject commands.
   - **Fix**: Replace `execSync` with `execFileSync('docker', args)` which bypasses shell interpretation entirely. Apply the same fix to `stopContainer`, `getContainerStatus`, `isContainerRunning`, `getContainerLogs`, `execInContainer`, `ensureNetwork`, `removeNetwork`, `waitForHealthy`, and the `safeExec` helper.
   - **Files**: `packages/core/src/docker-engine.ts`
   - **Tests**: Pass metacharacters in container name/env values, verify no shell execution.

3. **docker-engine.ts — `isPortInUse` broken logic** (FR-013)
   - **Root cause**: Lines 450–476 create a `net.createServer()` but never actually use it for the check. Instead they try a `node -e` child process, then fall back to `lsof`. The server is abandoned with `server.close()` without ever listening. The `inUse` variable from the error handler is never populated because the server never attempts to listen.
   - **Fix**: Rewrite as a clean async function using `net.createServer().listen()` with a Promise wrapper. Attempt to bind; `EADDRINUSE` → port in use, successful bind → port free (close server after).
   - **Files**: `packages/core/src/docker-engine.ts`
   - **Tests**: Bind a port, call `isPortInUse`, verify `true`; free port, verify `false`.

4. **yaml-engine.ts — `execSync` blocking event loop** (FR-014)
   - **Root cause**: `executeExecStep` (line 492), `executeFileStep` (lines 624, 641, 657, 671, 705), `executeProcessStep` (line 792), and `executePortStep` (lines 875, 894, 916) all use `execSync` which blocks the Node.js event loop.
   - **Fix**: Replace all `execSync` calls with `execFile` wrapped in a Promise (via `node:child_process` `execFile` + `util.promisify`). Update all step functions to be `async` and `await` the results. Make `executeStep` return `Promise<string[]>` (already is, but step delegates are sync).
   - **Files**: `packages/core/src/yaml-engine.ts`
   - **Tests**: Run exec/file/process/port steps and verify same results; measure event-loop blocking with `setTimeout` check.

5. **mock-generator.ts — shared `startTime` state** (FR-015)
   - **Root cause**: Line 228 `const startTime = Date.now()` is module-level. All mock server instances share this single value for uptime calculation. Second instance created 10s later still reports uptime relative to the first instance's start time.
   - **Fix**: Move `startTime` inside `createMockServer` so each instance captures its own creation time.
   - **Files**: `packages/core/src/mock-generator.ts`
   - **Tests**: Create two servers with time gap, verify each reports correct independent uptime.

6. **examples/as-mate/e2e.yaml — hardcoded secrets** (FR-016)
   - **Root cause**: Lines 46-48 contain hardcoded COS credentials (`AS_MATE_COS_SECRET_ID`, `AS_MATE_COS_SECRET_KEY`). Lines 140-144 in `envDefaults` repeat them.
   - **Fix**: Replace with `$AS_MATE_COS_SECRET_ID` and `$AS_MATE_COS_SECRET_KEY` environment variable references. Add a `.env.example` documenting required variables.
   - **Files**: `examples/as-mate/e2e.yaml`, `examples/as-mate/.env.example` (new)

**MCP Server Package** (FR-001 through FR-005):

7. **New package: `packages/mcp/`**
   - Create `package.json` with `@preflight/mcp` name, `@modelcontextprotocol/sdk` and `@preflight/core` as dependencies
   - Use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` with `StdioServerTransport`
   - Register 9 tools: `preflight_init`, `preflight_build`, `preflight_setup`, `preflight_run`, `preflight_run_suite`, `preflight_status`, `preflight_logs`, `preflight_clean`, `preflight_mock_requests`
   - Each tool returns structured JSON (not terminal-formatted text)
   - `preflight_build` uses MCP progress notifications (`notifications/progress`) for streaming build logs
   - Session management tracks per-project state (loaded config, container IDs, mock server instances)
   - **Files**: All files under `packages/mcp/`

**AI-Friendly Output** (FR-006 through FR-008):

8. **New module: `packages/core/src/diagnostics.ts`**
   - `DiagnosticCollector` class that gathers:
     - Container logs (last 50 lines via `getContainerLogs`)
     - Container health status (via `getContainerStatus`)
     - Mock service request records (via `/_mock/requests` HTTP call)
     - Docker network connectivity (via `docker network inspect`)
   - Returns `DiagnosticReport` typed object
   - **Files**: `packages/core/src/diagnostics.ts`, `packages/core/tests/unit/diagnostics.test.ts`

9. **Enhanced TestEvent and AIFriendlyTestResult** (FR-006, FR-007)
   - Extend `case_fail` event type to include optional `diagnostics` field
   - Define `AIFriendlyTestResult` interface with: request context, response context, assertion details, container diagnostics, mock requests, natural-language summary, suggested fix direction
   - Result formatter in `packages/mcp/src/formatters/result-formatter.ts` converts `TestReport` → `AIFriendlyTestResult[]`
   - Passing tests get minimal output (status + timing); failing tests get full diagnostics
   - **Files**: `packages/core/src/types.ts`, `packages/mcp/src/formatters/result-formatter.ts`

### Phase 2: Reliability Enhancement (P1)

10. **JSON Schema Generation** (FR-009, FR-010)
    - New module `packages/core/src/schema-generator.ts`
    - Uses `zod-to-json-schema` to convert existing `E2EConfigSchema` and create a `TestSuiteSchema`
    - Output files: `schemas/e2e-config.schema.json`, `schemas/test-suite.schema.json`
    - Include `title` and `description` on all Zod schema fields via `.describe()`
    - Build script generates schemas on `pnpm build`
    - **Files**: `packages/core/src/schema-generator.ts`, `schemas/*.json`

11. **Retry Engine** (FR-017 through FR-020)
    - New module `packages/core/src/retry-engine.ts`
    - `RetryExecutor` class accepting `RetryPolicy` config
    - Supports `maxAttempts`, `delay`, `backoff: 'linear' | 'exponential'`
    - Wraps `executeYAMLSuite` test case execution with retry loop
    - Records each attempt result in `TestEvent` metadata
    - Global policy from `e2e.yaml` `tests.retry` field; case-level overrides via `retry` in test step
    - **Files**: `packages/core/src/retry-engine.ts`, modifications to `yaml-engine.ts` and `types.ts`

12. **Async Migration completion** (FR-021, FR-022)
    - Covered by bug fix #4 above. This task ensures backward compatibility testing.
    - All existing YAML test files produce identical results before/after migration.
    - **Files**: `packages/core/src/yaml-engine.ts`, existing tests

### Phase 3: Capability Expansion (P2)

13. **Multi-Service Orchestration** (FR-025 through FR-027)
    - New module `packages/core/src/orchestrator.ts`
    - `MultiServiceOrchestrator` class manages an array of `ServiceDefinition`
    - Backward-compatible: single `service` field is auto-wrapped in `services: [service]`
    - All services connect to shared Docker network
    - Startup order: create network → build all → start all → health-check all
    - If any service fails health check, clean up all and report which failed
    - Extend `E2EConfig` type with optional `services` array field
    - Extend `E2EConfigSchema` Zod schema accordingly
    - **Files**: `packages/core/src/orchestrator.ts`, `packages/core/src/types.ts`, `packages/core/src/config-loader.ts`

14. **Playwright Runner** (FR-028)
    - New file `packages/core/src/runners/playwright-runner.ts`
    - Implements `TestRunner` interface
    - Runs `npx playwright test` with `--reporter=json` via `child_process.spawn`
    - Parses Playwright JSON output and converts to `TestEvent` stream
    - `available()` checks if `@playwright/test` is resolvable
    - Register in `createDefaultRegistry()`
    - **Files**: `packages/core/src/runners/playwright-runner.ts`, `packages/core/src/test-runner.ts`

15. **Parallel Test Execution** (FR-029 through FR-031)
    - New module `packages/core/src/parallel-engine.ts`
    - `ParallelSuiteExecutor` accepts suites with `parallel: true` or `concurrency: N`
    - Uses `Promise.all` with concurrency limiter (p-limit pattern, implemented inline)
    - Each parallel suite gets a cloned `VariableContext` for isolation
    - Reporter receives events from all suites with correct `suite` attribution
    - **Files**: `packages/core/src/parallel-engine.ts`, `packages/core/src/types.ts`

### Phase 4: Ecosystem (P2-P3)

16. **npm Packaging** (FR-034, FR-035)
    - Update `packages/cli/package.json`: add `bin`, `files`, `publishConfig`
    - Update `packages/mcp/package.json`: add `bin` for standalone MCP server start
    - Ensure `@preflight/mcp` is independently installable
    - **Files**: `packages/cli/package.json`, `packages/mcp/package.json`

17. **CI Templates** (FR-032, FR-033)
    - `ci-templates/github-actions.yml`: Install → Build → Setup → Run → Clean pipeline
    - `ci-templates/gitlab-ci.yml`: Equivalent GitLab CI pipeline
    - Both upload test result JSON as artifacts
    - Configurable parameters: project path, test filters, artifact paths
    - **Files**: `ci-templates/github-actions.yml`, `ci-templates/gitlab-ci.yml`, `.github/workflows/preflight-e2e.yml`

18. **IDE Extension Support** (FR-036, FR-037)
    - `.vscode/settings.json`: JSON Schema association for `*.yaml` test files and `e2e.yaml`
    - `mcp-templates/cursor-mcp-config.json`: Template for adding Preflight MCP server to Cursor
    - **Files**: `.vscode/settings.json`, `mcp-templates/cursor-mcp-config.json`

---

## Key Data Flow

### MCP Tool Invocation Flow

```
AI Agent (Cursor/Claude Code)
    │
    ▼ (MCP JSON-RPC over stdio)
McpServer (packages/mcp/server.ts)
    │
    ├─ preflight_init → loadConfig() → session state
    ├─ preflight_build → buildImage() → progress notifications → JSON result
    ├─ preflight_setup → orchestrator.start() → JSON status
    ├─ preflight_run → executeYAMLSuite() + retryEngine + diagnostics → AIFriendlyTestResult
    ├─ preflight_status → getContainerStatus() per service → JSON
    ├─ preflight_logs → getContainerLogs() → JSON
    ├─ preflight_clean → orchestrator.stop() → JSON confirmation
    └─ preflight_mock_requests → fetch /_mock/requests → JSON
```

### Test Failure Diagnostic Flow

```
case_fail TestEvent
    │
    ▼
DiagnosticCollector.collect(containerName, mockEndpoints)
    │
    ├─ getContainerLogs(name, 50)       → last 50 lines
    ├─ getContainerStatus(name)          → health status
    ├─ fetch(mockUrl/_mock/requests)     → recorded requests
    └─ docker network inspect            → connectivity
    │
    ▼
DiagnosticReport attached to case_fail event
    │
    ▼
ResultFormatter.toAIFriendly(report)
    │
    ├─ request context (method, url, headers, body)
    ├─ response context (status, headers, body)
    ├─ assertion details (path, operator, expected, actual)
    ├─ diagnostics (logs, health, mock requests)
    ├─ summary (one-sentence NL description)
    └─ suggestedFix (optional direction hint)
```

### Retry Execution Flow

```
RetryExecutor.execute(testCase, retryPolicy)
    │
    ├─ attempt 1: executeStep() → FAIL
    │   └─ record attempt result
    │   └─ wait: delay
    ├─ attempt 2: executeStep() → FAIL
    │   └─ record attempt result
    │   └─ wait: delay * backoffMultiplier
    ├─ attempt 3: executeStep() → PASS
    │   └─ record attempt result
    │   └─ emit case_pass with attempt history
    │
    └─ OR all attempts fail:
        └─ emit case_fail with all attempt results + auto-diagnostics
```
