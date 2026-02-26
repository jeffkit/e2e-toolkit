# Feature Specification: Preflight AI-Native Infrastructure Enhancement

**Feature Branch**: `002-ai-native`  
**Created**: 2026-02-25  
**Status**: Draft  
**Input**: User description: "Transform Preflight from a human-operated tool into AI-native programming infrastructure, enabling AI Agents (Cursor, Claude Code, etc.) to natively invoke Preflight for end-to-end automated acceptance testing."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI Agent End-to-End Acceptance via MCP (Priority: P0)

An AI Agent (e.g., Claude in Cursor) modifies service code and needs to verify the changes work correctly. The agent invokes Preflight through MCP tools to build the Docker image, start the test environment (including network, mocks, containers, and health checks), run the tests, and receive structured JSON results. If tests pass, the agent proceeds. If tests fail, the agent analyzes the diagnostics and autonomously fixes the code — all without requiring human intervention or shell commands.

**Why this priority**: This is the core value proposition of the entire feature. Without MCP integration, AI Agents cannot natively use Preflight, and the tool remains human-only. This story unlocks the entire "AI-native infrastructure" vision.

**Independent Test**: Can be fully tested by configuring an MCP client to connect to the Preflight MCP Server, invoking the build → setup → run → clean workflow, and verifying that structured JSON results are returned at each step.

**Acceptance Scenarios**:

1. **Given** a project with a valid `e2e.yaml` and Dockerfile, **When** an MCP client calls `preflight_init` followed by `preflight_build`, **Then** the build completes and returns a structured JSON response including build status and image identifier.
2. **Given** a successfully built image, **When** an MCP client calls `preflight_setup`, **Then** the test environment starts (network, mock services, containers), health checks pass, and a structured JSON status response is returned.
3. **Given** a running test environment, **When** an MCP client calls `preflight_run`, **Then** all test suites execute and a structured JSON result is returned with pass/fail status per case, including timing information.
4. **Given** a running test environment, **When** an MCP client calls `preflight_run_suite` with a specific suite identifier, **Then** only that suite executes and returns its structured JSON result.
5. **Given** any environment state, **When** an MCP client calls `preflight_status`, **Then** a JSON response is returned describing the current state of all containers, networks, and mock services.
6. **Given** a running container, **When** an MCP client calls `preflight_logs` with a container reference, **Then** the recent container logs are returned as structured text in the JSON response.
7. **Given** mock services are running, **When** an MCP client calls `preflight_mock_requests`, **Then** all recorded mock request entries are returned as structured JSON (method, path, headers, body, timestamp).
8. **Given** a test environment with running resources, **When** an MCP client calls `preflight_clean`, **Then** all containers, networks, and mock services are stopped and removed, and a confirmation JSON is returned.
9. **Given** a build or test operation is in progress, **When** an MCP client reads the streaming response, **Then** incremental progress updates are delivered (e.g., build log lines, test event streams).

---

### User Story 2 - AI Agent Understands Test Failures Autonomously (Priority: P0)

When a test fails, the AI Agent receives a comprehensive, structured failure report that contains everything needed to diagnose the problem: the full HTTP request and response context, structured assertion failure details, recent container logs, container health status, and mock service request records. The agent can parse this report and determine the root cause without making additional API calls.

**Why this priority**: MCP integration alone is not sufficient if the AI cannot understand failures. Rich diagnostics are essential for the autonomous fix-verify loop that defines AI-native testing.

**Independent Test**: Can be tested by running a test suite with intentionally failing assertions and verifying the output JSON contains all required diagnostic fields.

**Acceptance Scenarios**:

1. **Given** a test case with an HTTP assertion that fails (e.g., expected status 200 but received 500), **When** the test result is returned, **Then** the failure report includes: request method, URL, headers, and body; response status, headers, and body; the assertion path, operator, expected value, and actual value.
2. **Given** a test case fails, **When** the failure report is generated, **Then** it includes the last 50 lines of logs from each relevant container and each container's current health status.
3. **Given** mock services are configured and a test fails, **When** the failure report is generated, **Then** it includes all requests received by mock services during that test case's execution window.
4. **Given** any test failure, **When** the failure report is generated, **Then** it includes a one-sentence natural-language summary suitable for AI quick comprehension and an optional suggested fix direction.
5. **Given** a test suite with mixed pass/fail results, **When** the results are returned, **Then** passing tests have minimal output while failing tests have full diagnostics attached.

---

### User Story 3 - Known Bugs Are Fixed for Reliable Operation (Priority: P0)

Developers and AI Agents rely on Preflight's core engines (Docker, YAML, Mock) working correctly. Several known bugs — including event loss during Docker builds, command injection vulnerabilities, incorrect port detection, event-loop blocking, shared-state contamination, and hardcoded secrets — must be resolved to ensure safe and reliable operation.

**Why this priority**: These bugs undermine the correctness and security of the entire platform. The MCP integration and diagnostics are only useful if the underlying engines work reliably. Security vulnerabilities (command injection) and correctness issues (event loss, port detection) are blockers for production use.

**Independent Test**: Each bug fix can be tested independently with targeted unit tests and regression tests.

**Acceptance Scenarios**:

1. **Given** a Docker image build with multi-line output, **When** `buildImage` is called, **Then** all build events are captured and delivered without loss (no events dropped due to callback/yield mismatch).
2. **Given** container arguments that include shell metacharacters or special characters, **When** `startContainer` is called, **Then** arguments are passed safely without shell interpretation (no command injection possible).
3. **Given** a port that is currently in use by another process, **When** `isPortInUse` is called, **Then** it correctly returns `true`; and for a free port, it returns `false`.
4. **Given** a YAML test with file, process, or port steps, **When** the steps execute, **Then** they run asynchronously without blocking the Node.js event loop (no `execSync` calls).
5. **Given** multiple mock service instances started at different times, **When** each instance reports uptime or request timestamps, **Then** each instance uses its own start time reference (no shared module-level state contamination).
6. **Given** the example project `examples/as-mate/e2e.yaml`, **When** inspected, **Then** all secrets and keys reference environment variables (e.g., `$ENV_VAR`) rather than hardcoded literal values.

---

### User Story 4 - YAML Test Schema Enables AI-Authored Tests (Priority: P1)

AI Agents writing test YAML files can reference a JSON Schema to understand the valid structure, supported assertion operators, step types, and configuration options. This reduces syntax errors and invalid configurations when AI generates test definitions.

**Why this priority**: While not blocking the core MCP workflow, schema-guided generation significantly improves AI authoring quality and reduces the fix-retry cycle for malformed test files.

**Independent Test**: Can be tested by validating existing example YAML files against the generated schema and confirming they pass validation.

**Acceptance Scenarios**:

1. **Given** the generated JSON Schema for `e2e.yaml`, **When** an existing valid `e2e.yaml` file is validated against it, **Then** it passes validation with no errors.
2. **Given** the JSON Schema, **When** an `e2e.yaml` with an unsupported assertion operator is validated, **Then** it fails validation with a clear error message identifying the invalid operator.
3. **Given** the JSON Schema, **When** it is inspected, **Then** it covers all supported step types (http, exec, file, process, port), all assertion operators, service configuration, mock configuration, and test suite structure.
4. **Given** the JSON Schema, **When** referenced by an AI Agent or IDE, **Then** it provides descriptive titles and descriptions for each field to guide authoring.

---

### User Story 5 - Reliable Testing with Retry and Auto-Diagnostics (Priority: P1)

In unstable environments (e.g., flaky Docker builds, transient network issues), tests can be configured with retry policies at both the individual test case level and globally. When retries are exhausted and a test ultimately fails, comprehensive diagnostics are automatically collected and attached, so developers or AI Agents have full context without manual log gathering.

**Why this priority**: Reliability directly impacts trust in the testing platform. Transient failures that cause false negatives erode confidence and waste debugging time for both humans and AI Agents.

**Independent Test**: Can be tested by configuring a test case with retry settings against a service that fails intermittently, verifying retries occur, and checking diagnostics on final failure.

**Acceptance Scenarios**:

1. **Given** a test case configured with `retry: { maxAttempts: 3, delay: 2s }`, **When** the test fails on the first attempt but succeeds on the second, **Then** the overall test result is "pass" and the report includes attempt history.
2. **Given** a test case with exponential backoff retry, **When** it fails all attempts, **Then** the delays between attempts increase exponentially and the final report includes all attempt results.
3. **Given** a global retry policy configured in `e2e.yaml`, **When** a test case without its own retry config fails, **Then** the global retry policy applies.
4. **Given** a test case with its own retry config and a global policy, **When** the test case fails, **Then** the case-level retry config takes precedence over the global policy.
5. **Given** a test failure after all retries exhausted, **When** the failure report is generated, **Then** it automatically includes: last 50 lines of container logs, container health status, mock service request records, and Docker network connectivity check results.

---

### User Story 6 - Async Docker Execution for Non-Blocking Operation (Priority: P1)

The YAML test engine executes Docker-related operations (exec, file, process, port steps) asynchronously, ensuring the Node.js event loop is never blocked. This improves responsiveness for concurrent operations and prevents timeouts in long-running test suites.

**Why this priority**: Blocking the event loop prevents SSE streaming, health-check monitoring, and concurrent test operations. This is a prerequisite for reliable MCP Server operation where multiple requests may be in flight.

**Independent Test**: Can be tested by running YAML tests with exec/file/process/port steps and verifying that event-loop metrics show no blocking and that SSE streams remain responsive during execution.

**Acceptance Scenarios**:

1. **Given** a YAML test with an `exec` step, **When** the step executes, **Then** it runs asynchronously (using Promise-based execution) and does not block the event loop.
2. **Given** a YAML test with `file`, `process`, and `port` steps, **When** executed, **Then** all steps use async execution internally.
3. **Given** an existing test suite that uses exec/file/process/port steps, **When** run with the updated engine, **Then** all tests produce the same results as before (backward compatible).

---

### User Story 7 - Multi-Service Orchestration for Microservice Testing (Priority: P2)

Developers with microservice architectures (e.g., API service + Web frontend) can define multiple services in their `e2e.yaml` configuration. Each service is independently built, started, and health-checked. Services communicate through a shared Docker network. The existing single-service `service` configuration continues to work unchanged.

**Why this priority**: Multi-service support expands Preflight's applicability to real-world architectures but is not required for the core AI-native vision which can be demonstrated with single-service projects.

**Independent Test**: Can be tested by defining a two-service `e2e.yaml` (e.g., an API backend + a frontend), building and starting both, and verifying inter-service communication works.

**Acceptance Scenarios**:

1. **Given** an `e2e.yaml` with a `services` array containing two service definitions, **When** `setup` is executed, **Then** both services are independently built, started, health-checked, and connected to a shared Docker network.
2. **Given** two running services on the same Docker network, **When** a test step sends a request from one service to another by container name, **Then** the request succeeds.
3. **Given** an `e2e.yaml` using the existing single `service` field, **When** processed by the updated engine, **Then** it works identically to before (full backward compatibility).
4. **Given** a multi-service setup where one service fails health checks, **When** setup is attempted, **Then** the failure is reported with diagnostics for the failing service and other services are cleaned up.

---

### User Story 8 - Playwright Browser Testing Integration (Priority: P2)

Developers can run browser-based end-to-end tests using Playwright alongside existing YAML/shell/script tests. Playwright test results are emitted as standard TestEvent objects, enabling unified reporting and diagnostics across all test types.

**Why this priority**: Browser testing is important for full-stack coverage but represents a new runner type that extends rather than enables the core platform.

**Independent Test**: Can be tested by configuring a test suite with `runner: playwright` and verifying it executes Playwright tests and returns results in the standard TestEvent format.

**Acceptance Scenarios**:

1. **Given** a test suite configured with `runner: playwright` and a Playwright config file, **When** the suite runs, **Then** Playwright tests execute and results are emitted as TestEvent objects.
2. **Given** a mixed test configuration with both YAML and Playwright suites, **When** all suites run, **Then** results from both runner types appear in a unified report with consistent format.
3. **Given** a Playwright test that fails, **When** the failure report is generated, **Then** it includes Playwright's error output and, if configured, failure screenshots or traces.

---

### User Story 9 - Parallel Test Suite Execution (Priority: P2)

For large test suites, developers can enable parallel execution at the suite level to reduce total test time. Each parallel suite operates with an isolated variable context. The reporter correctly interleaves and attributes events from concurrent suites.

**Why this priority**: Performance optimization for large suites improves developer velocity but is not essential for core functionality.

**Independent Test**: Can be tested by configuring multiple suites with `parallel: true` and verifying they execute concurrently with correct, non-interfering results.

**Acceptance Scenarios**:

1. **Given** three test suites with `parallel: true`, **When** executed, **Then** all three run concurrently and total execution time is approximately the duration of the longest suite (not the sum).
2. **Given** parallel suites that each set different variable values, **When** executed concurrently, **Then** each suite sees only its own variable context with no cross-contamination.
3. **Given** a configuration with `concurrency: 2` and four suites, **When** executed, **Then** at most 2 suites run simultaneously.
4. **Given** parallel test execution, **When** results are reported, **Then** events from different suites are correctly attributed and the final report accurately reflects each suite's results.

---

### User Story 10 - CI/CD Integration with Templates (Priority: P2)

DevOps teams can use provided CI template files for GitHub Actions and GitLab CI to set up automated E2E testing pipelines. The templates cover the full lifecycle: install dependencies → build → setup → run → clean. Test results can be uploaded as CI artifacts for later review.

**Why this priority**: CI integration is essential for production workflows but depends on the core features being stable first.

**Independent Test**: Can be tested by running the provided GitHub Actions workflow in a test repository and verifying the pipeline completes the full E2E lifecycle.

**Acceptance Scenarios**:

1. **Given** the provided GitHub Actions workflow template, **When** added to a repository with Preflight configured, **Then** the pipeline executes: install → build → setup → run → clean without manual intervention.
2. **Given** a CI pipeline run where tests fail, **When** the pipeline completes, **Then** test result JSON files are uploaded as CI artifacts and the pipeline exits with a non-zero code.
3. **Given** the provided GitLab CI template, **When** used in a GitLab project, **Then** it provides equivalent functionality to the GitHub Actions template.
4. **Given** the CI templates, **When** inspected, **Then** they include configurable parameters for project path, test filters, and artifact paths.

---

### User Story 11 - npm Package Publication and Global CLI (Priority: P2)

The Preflight tool is published as npm packages that can be installed globally, providing the CLI command system-wide. The MCP Server package is published separately for independent installation.

**Why this priority**: Distribution readiness is important for adoption but is a packaging concern, not a feature capability concern.

**Independent Test**: Can be tested by running `npm pack` and verifying the package contents, then installing globally and confirming the CLI command works.

**Acceptance Scenarios**:

1. **Given** the packaged npm distribution, **When** installed globally via `npm install -g`, **Then** the `e2e-toolkit` CLI command is available and functional.
2. **Given** the `@preflight/mcp` package, **When** installed independently, **Then** the MCP Server can be started and accepts MCP client connections.
3. **Given** the package configuration, **When** inspected, **Then** `package.json` includes correct `publishConfig`, `files`, `bin`, and `exports` fields.

---

### User Story 12 - IDE Extension Support for Test Authoring (Priority: P3)

VS Code and Cursor users get IntelliSense support when editing YAML test files (via JSON Schema association), configuration hints for `e2e.yaml`, and template configurations for connecting to the MCP Server.

**Why this priority**: Developer experience enhancement that builds on the JSON Schema (P1) and MCP Server (P0) features. Nice-to-have for the initial release.

**Independent Test**: Can be tested by opening a YAML test file in VS Code with the schema associated and verifying autocompletion and validation work.

**Acceptance Scenarios**:

1. **Given** a VS Code workspace with the JSON Schema configured, **When** editing a test YAML file, **Then** IntelliSense provides field suggestions and validates the structure in real-time.
2. **Given** the MCP integration template, **When** added to Cursor's MCP configuration, **Then** the Preflight MCP Server appears as an available tool provider.

---

### Edge Cases

- What happens when the MCP Server receives a `preflight_run` call but no environment has been set up? It should return a clear error JSON indicating the prerequisite step was skipped.
- What happens when a Docker build fails mid-stream? The MCP Server should return partial build logs and a structured error with the failure point identified.
- What happens when multiple MCP clients attempt concurrent operations on the same project? The system should either serialize operations or return a conflict error — not corrupt state.
- What happens when the test environment runs out of disk space or Docker daemon is unreachable? Diagnostics should include system-level context (disk usage, Docker daemon status) in the error response.
- What happens when a retry-configured test encounters a non-transient failure (e.g., assertion on wrong endpoint)? The retry mechanism should still execute all configured attempts, but diagnostics should help distinguish transient vs. persistent failures.
- What happens when `preflight_clean` is called but some containers are in a stuck state? The clean operation should force-remove containers and report any that could not be removed.
- What happens when multi-service orchestration has circular health-check dependencies? The system should detect startup timeout and report which services failed health checks.
- What happens when parallel test suites compete for the same port? Each parallel suite should use isolated port assignments or detect and report port conflicts.

## Requirements *(mandatory)*

### Functional Requirements

#### Phase 1: AI Integration Foundation (P0)

- **FR-001**: System MUST provide an MCP Server (`@preflight/mcp` package) that exposes Preflight operations as MCP tools, enabling AI Agents to invoke them without shell commands.
- **FR-002**: The MCP Server MUST expose the following tools: `preflight_init`, `preflight_build`, `preflight_setup`, `preflight_run`, `preflight_run_suite`, `preflight_status`, `preflight_logs`, `preflight_clean`, `preflight_mock_requests`.
- **FR-003**: All MCP tool responses MUST be structured JSON (not terminal-formatted text), parseable by AI Agents for automated decision-making.
- **FR-004**: The `preflight_build` tool MUST support streaming build log delivery so clients can monitor progress incrementally.
- **FR-005**: The MCP Server MUST be implementable as a separate monorepo package that depends on the core Preflight engine.
- **FR-006**: The test failure JSON report MUST include: full HTTP request context (method, URL, headers, body), full HTTP response context (status, headers, body), structured assertion details (path, operator, expected value, actual value), recent container logs, container health status, mock service request records, a one-sentence natural-language summary, and an optional suggested fix direction.
- **FR-007**: System MUST define an `AIFriendlyTestResult` interface that standardizes the shape of enriched failure reports.
- **FR-008**: Passing tests MUST return minimal output (status, timing) while failing tests MUST include full diagnostics.
- **FR-009**: System MUST provide a JSON Schema for `e2e.yaml` and test YAML files that covers all supported step types, assertion operators, service configuration, and mock configuration.
- **FR-010**: The JSON Schema MUST include human-readable titles and descriptions for each field to assist AI and IDE authoring.
- **FR-011**: The `buildImage` function MUST be fixed to ensure all build events are captured without loss (resolve callback/yield mismatch).
- **FR-012**: The `startContainer` function MUST pass container arguments safely without shell interpretation (resolve command injection vulnerability).
- **FR-013**: The `isPortInUse` function MUST correctly detect whether a given port is occupied.
- **FR-014**: The YAML engine MUST NOT use `execSync` for file, process, or port steps; all must use asynchronous execution.
- **FR-015**: Each mock service instance MUST maintain its own start-time reference, independent of other instances.
- **FR-016**: Example configuration files MUST NOT contain hardcoded secrets; all sensitive values MUST reference environment variables.

#### Phase 2: Reliability Enhancement (P1)

- **FR-017**: System MUST support per-test-case retry configuration with `maxAttempts`, `delay`, and `backoff` (linear or exponential) parameters in YAML.
- **FR-018**: System MUST support a global retry policy in `e2e.yaml` that applies to all test cases without case-level retry configuration.
- **FR-019**: Case-level retry configuration MUST take precedence over global retry policy.
- **FR-020**: The test reporter MUST record the result of each retry attempt, not just the final outcome.
- **FR-021**: The YAML engine MUST replace all `execSync` calls with async alternatives (`execFile` + Promise or equivalent) for exec, file, process, and port steps.
- **FR-022**: The async migration MUST maintain backward-compatible interfaces so existing test configurations produce identical results.
- **FR-023**: On test failure, the system MUST automatically collect and attach diagnostics: last 50 lines of container logs, container health status, mock service request records, and Docker network connectivity check results.
- **FR-024**: Diagnostic information MUST be attached to the `case_fail` TestEvent for unified consumption.

#### Phase 3: Capability Expansion (P2)

- **FR-025**: System MUST support a `services` array in `e2e.yaml` for defining multiple services, each with independent build, start, and health-check configuration.
- **FR-026**: Multi-service orchestration MUST connect all services to a shared Docker network for inter-service communication.
- **FR-027**: The existing single-`service` configuration MUST continue to work without modification (full backward compatibility).
- **FR-028**: System MUST support a `playwright` runner type that executes Playwright tests and emits results as standard TestEvent objects.
- **FR-029**: System MUST support suite-level parallel execution via `parallel: true` or `concurrency: N` configuration.
- **FR-030**: Parallel suites MUST operate with isolated variable contexts (no cross-contamination).
- **FR-031**: The reporter MUST correctly attribute and interleave events from concurrently executing suites.

#### Phase 4: Ecosystem (P2–P3)

- **FR-032**: System MUST provide ready-to-use CI workflow templates for GitHub Actions and GitLab CI covering the full E2E lifecycle.
- **FR-033**: CI templates MUST support uploading test result JSON as pipeline artifacts.
- **FR-034**: The npm package configuration MUST include correct `publishConfig`, `files`, `bin`, and `exports` fields for global CLI installation.
- **FR-035**: The `@preflight/mcp` package MUST be independently installable and startable as an MCP Server.
- **FR-036**: System MUST provide a JSON Schema association configuration for VS Code/Cursor that enables IntelliSense for test YAML files.
- **FR-037**: System MUST provide MCP Server integration configuration templates for Cursor.

### Key Entities

- **MCP Tool**: A named operation exposed by the MCP Server (e.g., `preflight_build`), accepting structured input parameters and returning structured JSON responses. Represents the primary interface for AI Agents.
- **AIFriendlyTestResult**: A structured test result enriched with HTTP context, assertion details, container diagnostics, mock request records, and AI-oriented summary. Extends the base test result for failure cases.
- **RetryPolicy**: Configuration governing test retry behavior, including maximum attempts, delay between attempts, and backoff strategy. Can be defined globally or per test case.
- **TestEvent**: The standardized event emitted by all test runners during execution (start, step, assert, error, complete, case_pass, case_fail). The common abstraction enabling unified reporting.
- **ServiceDefinition**: Configuration for a single service in a multi-service orchestration, including Dockerfile path, build arguments, health check, port mappings, and environment variables.
- **TestSuite**: A collection of test cases with shared configuration (runner type, retry policy, parallelism settings). The unit of parallel execution.
- **DiagnosticReport**: Automatically collected failure context including container logs, health status, mock requests, and network connectivity. Attached to failed test events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: AI Agents can complete the full build → setup → run → clean workflow entirely through MCP tools, with zero shell command invocations required. Verified by executing the complete lifecycle from an MCP client.
- **SC-002**: Test failure reports contain sufficient context (HTTP request/response, assertion details, container logs, mock requests) for an AI Agent to identify the root cause and suggest a fix without additional information gathering. Verified by presenting failure reports to an AI Agent and confirming it can diagnose at least 80% of common failure types from the report alone.
- **SC-003**: All six identified bugs are resolved with regression tests confirming correct behavior: no event loss during builds, no command injection in container startup, correct port-in-use detection, no event-loop blocking in YAML steps, no shared-state contamination in mocks, and no hardcoded secrets in examples.
- **SC-004**: Test retry mechanism correctly retries transient failures up to the configured maximum, with exponential backoff timing accurate within 10% tolerance. A test that fails once then succeeds shows as "pass" in the final report with full attempt history.
- **SC-005**: Multi-service orchestration successfully builds, starts, and health-checks at least 2 independent services, with inter-service communication working over the Docker network. Verified with a two-service integration test.
- **SC-006**: Provided CI templates can be copied into a GitHub Actions workflow configuration and execute the full E2E lifecycle (install → build → setup → run → clean) without modification beyond project-specific paths.
- **SC-007**: All newly written code achieves at least 85% unit test coverage as measured by Vitest's coverage reporter, with core modules (MCP Server tool handlers, diagnostics collector, retry engine) achieving 90%+ coverage.
