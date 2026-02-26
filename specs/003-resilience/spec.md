# Feature Specification: Error Recovery & Self-Healing

**Feature Branch**: `003-resilience`  
**Created**: 2026-02-26  
**Status**: Draft  
**Input**: User description: "Transform ArgusAI from a 'report-and-stop' error handling approach to a 'recover-and-continue' model, enabling AI Agents to autonomously recover from 90% of common infrastructure errors without human intervention."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Structured Error Codes for AI Agent Decision-Making (Priority: P0)

When an infrastructure error occurs during any ArgusAI operation (build, setup, run, clean), the system returns a standardized, machine-readable error code along with structured context so that AI Agents can programmatically decide how to recover. Instead of parsing free-text error messages, the AI Agent receives a typed error object with a known code, severity, category, and suggested recovery actions.

**Why this priority**: This is the foundational capability that all other self-healing features depend on. Without structured error codes, AI Agents cannot distinguish between recoverable and fatal errors, and cannot select appropriate recovery strategies. Every other user story in this spec relies on these codes to function.

**Independent Test**: Can be fully tested by triggering known error conditions (stopping Docker daemon, filling disk, occupying a port) and verifying that each returns the correct structured error code with all required fields.

**Acceptance Scenarios**:

1. **Given** the Docker daemon is not running, **When** an AI Agent calls any Docker-dependent operation (build, setup, run), **Then** the system returns a structured error with code `DOCKER_UNAVAILABLE`, category `infrastructure`, severity `fatal`, and a human-readable message.
2. **Given** available disk space is below the configured threshold, **When** an AI Agent calls `preflight_build` or `preflight_setup`, **Then** the system returns a structured error with code `DISK_SPACE_LOW`, category `infrastructure`, severity `warning` or `fatal` (based on remaining space), and includes the current available space and the required threshold.
3. **Given** a container is killed by the OOM killer, **When** the system detects the termination, **Then** it returns a structured error with code `CONTAINER_OOM`, category `container`, severity `recoverable`, and includes the container's memory limit and peak usage.
4. **Given** a configured port is already occupied by another process, **When** `preflight_setup` attempts to bind it, **Then** the system returns a structured error with code `PORT_CONFLICT`, category `network`, severity `recoverable`, and includes the conflicting port number and the PID of the occupying process (if detectable).
5. **Given** any structured error is returned, **When** an AI Agent inspects the response, **Then** the error object includes at minimum: `code` (string enum), `category` (string enum), `severity` (fatal | recoverable | warning), `message` (human-readable), `details` (contextual data object), and `suggestedActions` (array of recovery action identifiers).

---

### User Story 2 - Preflight Environment Health Check (Priority: P0)

Before executing any setup or build operation, an AI Agent (or the system automatically) runs a preflight health check that validates the Docker daemon is reachable, sufficient disk space exists, and orphaned resources from previous runs are detected. The check returns a structured health report so the agent can decide whether to proceed, clean up, or abort.

**Why this priority**: Preflight checks prevent the most common class of failures — attempting operations in an unhealthy environment. Catching problems before they cause cascading failures is the highest-leverage recovery strategy and directly reduces the number of errors AI Agents encounter.

**Independent Test**: Can be fully tested by invoking the preflight check under various environment conditions (Docker stopped, low disk, orphaned containers present) and verifying the health report accurately reflects each condition.

**Acceptance Scenarios**:

1. **Given** a healthy environment with Docker running, sufficient disk space, and no orphaned resources, **When** the preflight check runs, **Then** it returns a health report with all checks passing and an overall status of `healthy`.
2. **Given** the Docker daemon is not running, **When** the preflight check runs, **Then** the health report marks the Docker connectivity check as `failed` with error code `DOCKER_UNAVAILABLE` and overall status as `unhealthy`.
3. **Given** disk space is below the configured threshold (default 2GB), **When** the preflight check runs, **Then** the health report marks the disk space check as `warning` or `failed`, includes available vs. required space, and sets overall status accordingly.
4. **Given** orphaned containers and networks from a previous run exist (identifiable by ArgusAI Docker labels), **When** the preflight check runs, **Then** the health report lists each orphaned resource with its name, type, creation time, and associated project label.
5. **Given** the `resilience.preflight.enabled` config is `true`, **When** `preflight_setup` or `preflight_build` is invoked, **Then** the preflight check runs automatically before the operation begins, and the operation is blocked if the check returns `unhealthy`.
6. **Given** the preflight check identifies orphaned resources and `resilience.preflight.cleanOrphans` is `true`, **When** auto-cleanup is enabled, **Then** orphaned resources are automatically removed and the preflight check re-evaluates as `healthy` before proceeding.

---

### User Story 3 - Container Auto-Restart on Failure (Priority: P1)

When a container crashes due to an OOM kill, process exit, or health check failure during test execution, the system automatically attempts to restart it using a configurable backoff strategy. Before each restart, diagnostics (logs, exit code, memory stats) are captured. If the maximum restart count is exceeded, the system reports a final failure with all collected diagnostics from every attempt.

**Why this priority**: Container crashes are the most frequent runtime failure in Docker-based testing. Automatic restart with backoff handles transient issues (memory spikes, race conditions on startup) without AI Agent intervention, while the diagnostics capture ensures persistent failures are debuggable.

**Independent Test**: Can be tested by running a container configured to crash after a short period, verifying the system auto-restarts with backoff, captures diagnostics per attempt, and eventually reports final failure with full history when max restarts are reached.

**Acceptance Scenarios**:

1. **Given** a running container that is killed by the OOM killer and `resilience.container.restartOnFailure` is `true`, **When** the system detects the OOM kill, **Then** it captures the container's last 100 lines of logs and memory stats, waits the configured `restartDelay`, and restarts the container.
2. **Given** a container that crashes with a non-zero exit code, **When** the system detects the crash and restarts are configured, **Then** it applies the configured backoff strategy (`exponential` or `linear`) between restart attempts.
3. **Given** `resilience.container.restartBackoff` is `exponential` with a base delay of `2s`, **When** the container crashes repeatedly, **Then** restart delays follow the pattern: 2s, 4s, 8s (doubling each time, capped at a reasonable maximum).
4. **Given** a container that crashes more times than `resilience.container.maxRestarts` (e.g., 3), **When** the final restart is exhausted, **Then** the system reports a final failure with error code `CONTAINER_RESTART_EXHAUSTED`, including diagnostics from every restart attempt (logs, exit codes, timestamps).
5. **Given** a container that crashes once but succeeds on the second attempt, **When** the test continues, **Then** the test proceeds normally using the restarted container, and the final report includes a note that a restart occurred along with the restart reason.
6. **Given** a container health check fails continuously, **When** the health check timeout is reached, **Then** the system treats it as a container failure and applies the restart policy with health check failure diagnostics attached.

---

### User Story 4 - Port Conflict Auto-Resolution (Priority: P1)

When a configured port is already in use by another process, the system automatically finds an available port, assigns it, and updates all relevant configuration variables so that tests reference the correct port. The AI Agent is informed of the port reassignment through the structured response.

**Why this priority**: Port conflicts are the second most common setup failure, especially in development environments where multiple test runs or services compete for ports. Auto-resolution eliminates a frequent source of manual intervention that interrupts AI Agent workflows.

**Independent Test**: Can be tested by occupying a port that ArgusAI is configured to use, running setup, and verifying the system selects an alternative port, updates variables, and reports the mapping in the response.

**Acceptance Scenarios**:

1. **Given** a service configured to bind port 3000 and port 3000 is already in use, **When** `preflight_setup` runs with `resilience.network.portConflictStrategy: auto`, **Then** the system finds an available port, binds the service to it, and updates all port-referencing variables.
2. **Given** an auto-reassigned port, **When** the setup response is returned to the AI Agent, **Then** the response includes a `portMappings` object showing original → actual port mappings for each service.
3. **Given** mock services configured on specific ports that conflict, **When** setup runs with auto-resolution, **Then** mock service ports are also auto-reassigned and their variables updated consistently.
4. **Given** `resilience.network.portConflictStrategy` is `fail` (the explicit opt-out), **When** a port conflict is detected, **Then** the system returns a `PORT_CONFLICT` error with details about the conflicting port and does not attempt auto-resolution.
5. **Given** multiple services all configured on the same port, **When** auto-resolution runs, **Then** each service receives a unique available port and no two services share a port.

---

### User Story 5 - Orphan Resource Auto-Cleanup (Priority: P1)

Before each test environment setup, the system detects leftover Docker containers, networks, and volumes from previous ArgusAI runs using Docker labels. When orphans are found and auto-cleanup is enabled, they are automatically removed before the new environment is created. If cleanup fails for any resource, it is reported but does not block the new setup (unless it causes a conflict).

**Why this priority**: Orphaned resources cause port conflicts, network name collisions, and disk space exhaustion. Proactive cleanup before each run prevents an entire class of downstream errors and is essential for reliable operation in shared or long-running development environments.

**Independent Test**: Can be tested by manually creating labeled Docker resources, running setup, and verifying orphans are detected, cleaned, and reported.

**Acceptance Scenarios**:

1. **Given** leftover containers with ArgusAI labels exist from a previous run, **When** `preflight_setup` runs with `resilience.preflight.cleanOrphans: true`, **Then** those containers are stopped and removed before the new environment is created.
2. **Given** leftover Docker networks with ArgusAI labels exist, **When** orphan cleanup runs, **Then** those networks are removed after their attached containers are stopped.
3. **Given** an orphaned container that cannot be removed (e.g., filesystem mount busy), **When** cleanup attempts force-removal, **Then** the cleanup report includes the failure reason for that specific resource, but other orphans are still cleaned.
4. **Given** `resilience.preflight.cleanOrphans` is `false`, **When** orphans are detected during the preflight check, **Then** they are reported in the health check response but not removed.
5. **Given** no orphaned ArgusAI resources exist, **When** the cleanup step runs, **Then** it completes immediately with a report indicating no orphans were found.
6. **Given** orphaned resources belong to a different ArgusAI project (different project label), **When** cleanup runs, **Then** only resources matching the current project's label are removed — other projects' resources are left untouched.

---

### User Story 6 - Circuit Breaker for Docker Operations (Priority: P1)

The system implements a circuit breaker pattern for Docker CLI interactions. When repeated Docker operations fail (e.g., Docker daemon is down, persistent permission errors), the circuit opens and subsequent operations fail fast with a clear error code (`CIRCUIT_OPEN`) instead of attempting the operation. This prevents AI Agents from getting into infinite retry loops against a broken environment. The circuit can be manually reset via an MCP tool.

**Why this priority**: Without a circuit breaker, AI Agents can waste significant time and compute retrying operations against a fundamentally broken environment. The circuit breaker provides a hard stop mechanism that forces the agent to escalate rather than loop, which is critical for autonomous operation reliability.

**Independent Test**: Can be tested by stopping the Docker daemon, making repeated operation calls, verifying the circuit opens after the threshold, confirming subsequent calls fail fast, then resetting the circuit and verifying operations are attempted again.

**Acceptance Scenarios**:

1. **Given** Docker operations fail 5 consecutive times (configurable threshold), **When** the next Docker operation is attempted, **Then** the circuit breaker opens and the operation fails immediately with error code `CIRCUIT_OPEN`, without attempting the Docker command.
2. **Given** the circuit breaker is open, **When** any Docker-dependent MCP tool is called, **Then** it returns `CIRCUIT_OPEN` error within 100ms (no timeout waiting for Docker).
3. **Given** the circuit breaker is open, **When** an AI Agent calls `argus_reset_circuit`, **Then** the circuit transitions to half-open state, and the next Docker operation is attempted as a probe.
4. **Given** the circuit breaker is in half-open state and the probe operation succeeds, **When** subsequent operations are called, **Then** the circuit closes and operations proceed normally.
5. **Given** the circuit breaker is in half-open state and the probe operation fails, **When** the probe fails, **Then** the circuit re-opens immediately.
6. **Given** the circuit breaker state, **When** `preflight_status` is called, **Then** the status response includes the current circuit breaker state (closed, open, half-open), failure count, and time since last state transition.

---

### User Story 7 - Network Resilience & Mock Service Verification (Priority: P2)

Before running tests, the system verifies that mock services are reachable from the test container by checking Docker network connectivity and DNS resolution. When health check timeouts occur, the system provides enhanced diagnostics including network topology, DNS resolution results, and connectivity test outcomes to help pinpoint the root cause.

**Why this priority**: Network issues between containers are harder to diagnose than container crashes. While less frequent than container or port issues, they produce the most confusing failure modes. Enhanced diagnostics significantly reduce debugging time for both AI Agents and humans.

**Independent Test**: Can be tested by deliberately misconfiguring Docker networking (wrong network, DNS issues) and verifying the system detects and reports connectivity problems with actionable diagnostics.

**Acceptance Scenarios**:

1. **Given** mock services are configured and running, **When** network verification runs before tests, **Then** the system confirms each mock service is reachable from the test container via its Docker DNS name.
2. **Given** a mock service that is unreachable due to a Docker network misconfiguration, **When** network verification fails, **Then** the system returns error code `NETWORK_UNREACHABLE` with diagnostics including: which service is unreachable, DNS resolution result, network topology (which containers are on which networks), and a suggested recovery action.
3. **Given** a container health check times out, **When** the timeout is reported, **Then** enhanced diagnostics include: health check command output, container logs during the health check period, network connectivity test results, and DNS resolution status.
4. **Given** all mock services pass network verification, **When** verification completes, **Then** the response includes a connectivity matrix showing all verified service-to-service paths.
5. **Given** a DNS resolution failure for a container hostname, **When** the system detects it, **Then** it reports error code `DNS_RESOLUTION_FAILED` with the hostname that failed, the network it was expected on, and all containers currently on that network.

---

### User Story 8 - MCP Tools for Manual Recovery (Priority: P2)

AI Agents have access to two new MCP tools for managing the resilience subsystem: `argus_preflight_check` for manually triggering environment health checks at any time, and `argus_reset_circuit` for resetting the circuit breaker after an environment issue has been resolved. These tools enable AI Agents to proactively manage environment health as part of their autonomous workflow.

**Why this priority**: While automatic recovery handles most cases, AI Agents need manual override capabilities for situations that require explicit intervention — such as resetting a tripped circuit breaker after fixing the Docker daemon, or running a health check before a retry attempt.

**Independent Test**: Can be tested by calling each MCP tool under relevant conditions and verifying the structured responses match expected formats.

**Acceptance Scenarios**:

1. **Given** an AI Agent wants to check environment health before starting a workflow, **When** it calls `argus_preflight_check`, **Then** a structured health report is returned covering Docker daemon, disk space, orphaned resources, and network readiness.
2. **Given** the `argus_preflight_check` tool, **When** called with optional parameters to skip certain checks (e.g., `skipDiskCheck: true`), **Then** only the requested checks are performed and reported.
3. **Given** the circuit breaker is in the open state, **When** an AI Agent calls `argus_reset_circuit`, **Then** the circuit transitions to half-open, and the response confirms the state change with the previous and new state.
4. **Given** the circuit breaker is already closed (healthy), **When** an AI Agent calls `argus_reset_circuit`, **Then** the response indicates no action was needed and the circuit remains closed.
5. **Given** an AI Agent calls `argus_preflight_check` with `autoFix: true`, **When** orphaned resources or other auto-fixable issues are detected, **Then** the system resolves them and returns a report showing what was found and what was fixed.

---

### Edge Cases

- What happens when the Docker daemon becomes unavailable mid-operation (e.g., during a build or test run)? The system should detect the disconnection, capture partial state, open the circuit breaker, and return a structured error with diagnostics collected up to the failure point.
- What happens when disk space runs out during a Docker build? The system should catch the build failure, report `DISK_SPACE_LOW` with the current disk usage, and suggest cleanup actions (orphan cleanup, Docker image prune).
- What happens when a container restart succeeds but the container immediately crashes again in a loop? The backoff strategy increases delays between attempts, and after `maxRestarts` the system stops retrying and reports the crash loop pattern in diagnostics.
- What happens when all available ports in the ephemeral range are exhausted? The system should report `PORT_EXHAUSTION` with the number of ports attempted and suggest manual port release.
- What happens when orphan cleanup runs concurrently with another ArgusAI instance using the same resources? The system should use Docker labels with unique run IDs to avoid removing resources belonging to an active run.
- What happens when the circuit breaker threshold is reached during a multi-service setup (some services started, some not)? The system should clean up partially started services before reporting the circuit breaker status.
- What happens when a port conflict is detected but the occupying process exits between detection and reassignment? The system should re-check port availability before assigning an alternative; if the original port is now free, it should use it.
- What happens when the preflight check passes but the environment degrades between check and operation? The system should still handle runtime errors gracefully using the container guardian and circuit breaker — preflight checks reduce but do not eliminate runtime failures.
- What happens when the auto-restart policy conflicts with test assertions expecting specific container behavior? Container restarts during active test execution should be deferred until the current test case completes, unless the container is completely unresponsive.

## Requirements *(mandatory)*

### Functional Requirements

#### Phase 1: Error Code Foundation & Preflight (P0)

- **FR-R01**: System MUST define a standardized set of error codes covering all known failure modes: `DOCKER_UNAVAILABLE`, `DISK_SPACE_LOW`, `PORT_CONFLICT`, `PORT_EXHAUSTION`, `CONTAINER_OOM`, `CONTAINER_CRASH`, `CONTAINER_RESTART_EXHAUSTED`, `HEALTH_CHECK_TIMEOUT`, `NETWORK_UNREACHABLE`, `DNS_RESOLUTION_FAILED`, `CIRCUIT_OPEN`, `ORPHAN_DETECTED`, `CLEANUP_FAILED`.
- **FR-R02**: All error responses MUST include a structured error object with fields: `code` (string enum), `category` (infrastructure | container | network | system), `severity` (fatal | recoverable | warning), `message` (human-readable string), `details` (contextual data object), and `suggestedActions` (array of recovery action identifiers).
- **FR-R03**: System MUST implement a preflight health check that validates Docker daemon connectivity, available disk space against a configurable threshold, and presence of orphaned ArgusAI resources.
- **FR-R04**: The preflight health check MUST return a structured health report with per-check status (pass | warn | fail), individual check details, and an overall health status (healthy | degraded | unhealthy).
- **FR-R05**: When `resilience.preflight.enabled` is `true`, the preflight check MUST run automatically before `setup` and `build` operations, blocking execution if the environment is `unhealthy`.
- **FR-R06**: System MUST label all Docker resources (containers, networks, volumes) it creates with identifiable ArgusAI labels including project name and run identifier.

#### Phase 2: Container & Port Resilience (P1)

- **FR-R07**: System MUST detect container failures including OOM kills (exit code 137), non-zero exit codes, and health check failures, classifying each with the appropriate structured error code.
- **FR-R08**: When `resilience.container.restartOnFailure` is `true`, the system MUST automatically restart failed containers up to `resilience.container.maxRestarts` times using the configured backoff strategy.
- **FR-R09**: System MUST support `exponential` and `linear` backoff strategies for container restarts, with configurable base delay via `resilience.container.restartDelay`.
- **FR-R10**: Before each container restart attempt, the system MUST capture diagnostics: last 100 lines of container logs, exit code, OOM status, memory usage statistics, and timestamp.
- **FR-R11**: When all restart attempts are exhausted, the system MUST report a `CONTAINER_RESTART_EXHAUSTED` error with the full diagnostic history from all attempts.
- **FR-R12**: When `resilience.network.portConflictStrategy` is `auto`, the system MUST detect port conflicts during setup and automatically assign available ports, updating all referencing variables.
- **FR-R13**: Port auto-resolution MUST report the original-to-actual port mapping in the setup response so AI Agents and tests reference correct ports.
- **FR-R14**: When `resilience.network.portConflictStrategy` is `fail`, the system MUST return a `PORT_CONFLICT` error without attempting auto-resolution.
- **FR-R15**: System MUST detect and clean orphaned Docker resources (containers, networks) from previous ArgusAI runs using Docker labels before each setup when `resilience.preflight.cleanOrphans` is `true`.
- **FR-R16**: Orphan cleanup MUST only remove resources matching the current project's ArgusAI label, never resources from other projects or non-ArgusAI resources.
- **FR-R17**: Orphan cleanup failures for individual resources MUST NOT block cleanup of other resources; each failure is reported independently.

#### Phase 3: Circuit Breaker & Network (P1–P2)

- **FR-R18**: System MUST implement a circuit breaker pattern for Docker CLI operations with three states: closed (normal), open (failing fast), half-open (probing).
- **FR-R19**: The circuit breaker MUST open after a configurable number of consecutive Docker operation failures (default: 5).
- **FR-R20**: When the circuit is open, all Docker-dependent operations MUST fail immediately with error code `CIRCUIT_OPEN`, without invoking the Docker CLI.
- **FR-R21**: The circuit breaker MUST support manual reset to half-open state via the `argus_reset_circuit` MCP tool.
- **FR-R22**: In half-open state, a single probe operation MUST be attempted; on success the circuit closes, on failure it re-opens.
- **FR-R23**: System MUST verify mock service connectivity and DNS resolution from the test container before running tests, reporting `NETWORK_UNREACHABLE` or `DNS_RESOLUTION_FAILED` with diagnostics on failure.
- **FR-R24**: Health check timeout diagnostics MUST include: health check command output, container logs during the health check window, network connectivity results, and DNS resolution status.

#### Phase 4: MCP Tools (P2)

- **FR-R25**: System MUST expose an `argus_preflight_check` MCP tool that triggers a manual environment health check and returns the structured health report.
- **FR-R26**: The `argus_preflight_check` tool MUST accept optional parameters to skip specific checks and to enable `autoFix` mode for auto-remediable issues.
- **FR-R27**: System MUST expose an `argus_reset_circuit` MCP tool that resets the circuit breaker from open to half-open state.
- **FR-R28**: The `argus_reset_circuit` tool MUST return the previous circuit state, the new state, and the failure history that caused the circuit to open.

#### Configuration Requirements

- **FR-R29**: All resilience features MUST be configurable via the `resilience` section of `e2e.yaml` as specified in the YAML config schema (preflight, container, network subsections).
- **FR-R30**: All resilience features MUST have sensible defaults that enable recovery behavior without requiring explicit configuration (preflight enabled, auto port resolution, restart on failure with 3 max restarts).
- **FR-R31**: All resilience configuration options MUST be documented in the JSON Schema with human-readable descriptions for AI and IDE authoring support.

### Key Entities

- **StructuredError**: A standardized error object returned by all ArgusAI operations when failures occur. Contains `code` (error enum), `category`, `severity`, `message`, `details` (contextual data), and `suggestedActions`. The canonical format that AI Agents parse for decision-making.
- **HealthReport**: The output of a preflight health check, containing an array of individual check results (Docker, disk, orphans, network), each with status and details, plus an overall health assessment. Consumed by AI Agents and by the auto-preflight gate.
- **ContainerDiagnostics**: A snapshot of a container's state at a point in time, including recent logs, exit code, OOM status, memory statistics, and timestamp. Captured before each restart attempt and attached to failure reports.
- **RestartHistory**: An ordered collection of ContainerDiagnostics, one per restart attempt, attached to the final failure report when all restarts are exhausted. Enables AI Agents to see the progression of failures across attempts.
- **CircuitBreakerState**: The current state of the Docker operations circuit breaker, including its state (closed | open | half-open), consecutive failure count, last failure timestamp, and the error history that triggered the open state.
- **PortMapping**: A record of original configured port to actual assigned port for a service, created during port conflict auto-resolution. Included in setup responses so tests and AI Agents reference correct endpoints.
- **OrphanResource**: A Docker resource (container, network, volume) identified as belonging to a previous ArgusAI run via its labels. Contains resource type, name, creation time, project label, and run identifier.
- **ResilienceConfig**: The `resilience` section of `e2e.yaml` defining all recovery behavior: preflight check settings, container restart policy, and network conflict strategy. Validated against the JSON Schema on load.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-R01**: AI Agents can autonomously recover from at least 90% of the following common infrastructure errors without human intervention: Docker daemon restarts, port conflicts, orphaned resources from previous runs, transient container crashes (OOM, process exit), and stale Docker networks. Verified by running a test suite that injects each failure type and confirming the system recovers and tests ultimately pass.
- **SC-R02**: The preflight health check detects 100% of targetable environment issues (Docker unavailable, disk below threshold, orphaned resources) before operations begin, reducing mid-operation failures by at least 70% compared to no preflight. Verified by comparing failure rates with preflight enabled vs. disabled across repeated test runs with injected faults.
- **SC-R03**: The circuit breaker prevents infinite retry loops by failing fast within 100ms after the threshold is reached. An AI Agent encountering a broken Docker environment receives the `CIRCUIT_OPEN` error within 100ms on all subsequent calls. Verified by timing Docker-dependent calls after the circuit opens.
- **SC-R04**: Port conflict auto-resolution successfully finds and assigns available ports in under 2 seconds for up to 10 conflicting service ports. Tests run to completion using reassigned ports without manual configuration changes. Verified by occupying configured ports and measuring resolution time.
- **SC-R05**: Container auto-restart recovers from transient crashes (single OOM or process exit) within the configured backoff window, allowing tests to proceed. For a container that crashes once and recovers, total added delay is no more than the configured restart delay plus 5 seconds of overhead. Verified by running a container that crashes once and measuring recovery time.
- **SC-R06**: Every error returned by the system includes a valid structured error code, enabling AI Agents to make recovery decisions without parsing free-text messages. Verified by auditing all error paths in the resilience subsystem and confirming each returns a `StructuredError` with all required fields.
- **SC-R07**: All resilience features are configurable through `e2e.yaml` without code changes, and the system operates with sensible defaults when no `resilience` section is provided. Verified by running the system with no resilience config and confirming default behavior (preflight enabled, auto port resolution, restart on failure with 3 max restarts).
- **SC-R08**: The two new MCP tools (`argus_preflight_check`, `argus_reset_circuit`) return structured JSON responses consistent with existing MCP tool conventions. Verified by calling each tool via an MCP client and validating response schema.

### Non-Functional Requirements

- **NFR-R01**: Preflight health checks MUST complete within 10 seconds under normal conditions to avoid delaying the test workflow.
- **NFR-R02**: Orphan resource cleanup MUST complete within 30 seconds for up to 20 orphaned resources.
- **NFR-R03**: Port conflict auto-resolution MUST complete within 2 seconds per conflicting port.
- **NFR-R04**: Circuit breaker state transitions MUST be atomic and thread-safe to prevent inconsistent state under concurrent MCP requests.
- **NFR-R05**: All resilience operations MUST emit SSE events for real-time progress visibility (preflight progress, restart attempts, cleanup progress) consistent with Constitution Principle 7.
- **NFR-R06**: Resilience module code MUST achieve at least 85% unit test coverage, with the circuit breaker and error code modules achieving 90%+ coverage, consistent with Constitution Principle 5.
- **NFR-R07**: All new interfaces, error codes, and configuration types MUST have complete TypeScript type definitions with strict mode enabled, consistent with Constitution Principle 4.

## Constitution Alignment

This feature aligns with all 10 constitution principles:

| # | Principle | Alignment |
|---|-----------|-----------|
| 1 | Configuration-Driven | All resilience behavior controlled via `resilience` section in `e2e.yaml` |
| 2 | Language-Agnostic | Error codes and health reports are language-independent structured data |
| 3 | Zero-Intrusion | No service code modifications required; resilience is infrastructure-level |
| 4 | TypeScript Strict Mode | All new types (StructuredError, HealthReport, etc.) strictly typed |
| 5 | Test Coverage | 85%+ coverage target; core modules (circuit breaker, error codes) at 90%+ |
| 6 | Single Entry CLI | Preflight check available via existing CLI; MCP tools extend the tool surface |
| 7 | SSE Real-Time Feedback | Restart attempts, cleanup progress, and preflight results streamed via SSE |
| 8 | Extensible Architecture | Error codes are enum-extensible; circuit breaker is pluggable per operation type |
| 9 | Web Framework (Fastify) | New MCP endpoints follow existing Fastify patterns for the dashboard API |
| 10 | Node.js 20+ | Uses native fetch, AbortController for Docker health probes; async/await throughout |
