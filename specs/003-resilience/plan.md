# Implementation Plan: Error Recovery & Self-Healing

**Branch**: `003-resilience` | **Date**: 2026-02-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-resilience/spec.md`

## Summary

Transform ArgusAI from a "report-and-stop" error handling model to a "recover-and-continue" model. The implementation introduces a resilience subsystem within `packages/core/src/resilience/` that provides: standardized structured error codes for AI Agent decision-making, preflight environment health checks, container auto-restart with backoff, port conflict auto-resolution, orphan resource cleanup, a circuit breaker for Docker operations, network connectivity verification, and two new MCP tools (`argus_preflight_check`, `argus_reset_circuit`). All features are configuration-driven via a new `resilience` section in `e2e.yaml` and integrate with the existing SSE event bus for real-time feedback.

## Technical Context

**Language/Version**: TypeScript 5.x strict mode, Node.js 20+ LTS
**Primary Dependencies**: Zod (config validation), `node:child_process` (Docker CLI), `node:net` (port scanning), `@modelcontextprotocol/sdk` (MCP tools), existing `argusai-core` internals
**Storage**: N/A — all state is in-memory (circuit breaker, container guardian) with SSE event streaming
**Testing**: Vitest with `vi.mock()` for Docker CLI isolation; target 85%+ overall, 90%+ for circuit breaker and error codes
**Target Platform**: Linux (primary), macOS (development), Windows (WSL2)
**Project Type**: TypeScript monorepo (pnpm workspaces) — packages: core, cli, dashboard, mcp
**Performance Goals**: Preflight checks < 10s, circuit breaker fail-fast < 100ms, port resolution < 2s per port
**Constraints**: Zero new runtime dependencies; reuse existing `retry-engine.ts` backoff utilities; all Docker interaction via CLI (no dockerode)
**Scale/Scope**: 13 error codes, 6 new core modules, 2 new MCP tools, ~15 modified files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 1 | Configuration-Driven Architecture | **PASS** | All resilience behavior controlled via `resilience` section in `e2e.yaml`. Sensible defaults enable recovery without any config. |
| 2 | Language-Agnostic Testing | **PASS** | Error codes and health reports are language-independent structured JSON. No impact on test format support. |
| 3 | Zero-Intrusion Testing | **PASS** | All resilience is infrastructure-level. No modifications to service code required. Container guardian and preflight operate on Docker metadata only. |
| 4 | TypeScript Strict Mode | **PASS** | All new types (`StructuredError`, `HealthReport`, `CircuitBreakerState`, etc.) are strictly typed interfaces. No `any` usage. ESM imports throughout. |
| 5 | Test Coverage | **PASS** | Target 90%+ for error codes and circuit breaker modules; 85%+ for all other resilience modules. Vitest with `vi.mock()` for Docker CLI mocking. |
| 6 | Single Entry CLI | **PASS** | No new CLI commands. Preflight integrates into existing `setup` and `build` flows. MCP tools extend the existing tool surface. |
| 7 | SSE Real-Time Feedback | **PASS** | New SSE event types for resilience: `preflight_*`, `restart_*`, `cleanup_*`, `circuit_*` emitted on the existing `EventBus`. |
| 8 | Extensible Architecture | **PASS** | Error codes are string-enum extensible. Circuit breaker accepts pluggable `DockerOperationFn` type. Health checks implement `HealthChecker` interface for future extension. |
| 9 | Web Framework (Fastify) | **PASS** | No new Fastify routes. MCP tools follow existing patterns in `server.ts`. Dashboard can subscribe to new SSE channels. |
| 10 | Node.js 20+ | **PASS** | Uses native `fetch` (for mock connectivity), `AbortController` with `AbortSignal.timeout()` for Docker health probes, async/await throughout. |

**Constitution Gate: PASSED** — No violations detected.

## Project Structure

### Documentation (this feature)

```text
specs/003-resilience/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── error-codes.md
│   ├── preflight-api.md
│   └── mcp-tools.md
└── tasks.md             # Phase 2 output (NOT created by plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── resilience/                        # [NEW] Resilience subsystem
│   ├── index.ts                       # [NEW] Public barrel exports
│   ├── error-codes.ts                 # [NEW] Structured error types, code enum, factory
│   ├── preflight.ts                   # [NEW] Environment health checker
│   ├── circuit-breaker.ts             # [NEW] Circuit breaker for Docker ops
│   ├── container-guardian.ts          # [NEW] Container auto-restart with backoff
│   ├── port-resolver.ts              # [NEW] Port conflict detection & auto-resolution
│   ├── orphan-cleaner.ts             # [NEW] Orphan resource detection & cleanup
│   └── network-verifier.ts           # [NEW] Mock service connectivity verification
├── types.ts                           # [MOD] Add resilience config types, event types
├── config-loader.ts                   # [MOD] Add ResilienceConfigSchema
├── docker-engine.ts                   # [MOD] Add Docker label support, expose helpers
├── orchestrator.ts                    # [MOD] Integrate preflight, guardian, port resolver
├── index.ts                           # [MOD] Re-export resilience modules
└── diagnostics.ts                     # [MOD] Extend with container restart diagnostics

packages/mcp/src/
├── tools/
│   ├── preflight-check.ts            # [NEW] argus_preflight_check MCP tool
│   ├── reset-circuit.ts              # [NEW] argus_reset_circuit MCP tool
│   ├── setup.ts                       # [MOD] Integrate preflight gate, port resolver
│   └── build.ts                       # [MOD] Integrate preflight gate, circuit breaker
├── server.ts                          # [MOD] Register 2 new tools (total: 11)
└── session.ts                         # [MOD] Add circuit breaker state to session

packages/core/tests/unit/resilience/   # [NEW] Test directory
├── error-codes.test.ts                # [NEW]
├── preflight.test.ts                  # [NEW]
├── circuit-breaker.test.ts            # [NEW]
├── container-guardian.test.ts         # [NEW]
├── port-resolver.test.ts             # [NEW]
├── orphan-cleaner.test.ts            # [NEW]
└── network-verifier.test.ts          # [NEW]
```

**Structure Decision**: All new resilience modules are grouped under `packages/core/src/resilience/` as a cohesive subsystem with a barrel `index.ts`. This keeps the existing flat module structure of `packages/core/src/` intact while providing clear boundaries for the resilience feature. MCP tools follow the existing `packages/mcp/src/tools/` convention.

---

## Implementation Phases

### Phase 1: Error Code Foundation & Resilience Config (P0)

Establishes the structured error system and configuration schema that all other phases depend on.

#### 1.1 Structured Error Types — `resilience/error-codes.ts`

**New types to define:**

```typescript
/** All known ArgusAI error codes */
export type ArgusErrorCode =
  | 'DOCKER_UNAVAILABLE'
  | 'DISK_SPACE_LOW'
  | 'PORT_CONFLICT'
  | 'PORT_EXHAUSTION'
  | 'CONTAINER_OOM'
  | 'CONTAINER_CRASH'
  | 'CONTAINER_RESTART_EXHAUSTED'
  | 'HEALTH_CHECK_TIMEOUT'
  | 'NETWORK_UNREACHABLE'
  | 'DNS_RESOLUTION_FAILED'
  | 'CIRCUIT_OPEN'
  | 'ORPHAN_DETECTED'
  | 'CLEANUP_FAILED';

export type ErrorCategory = 'infrastructure' | 'container' | 'network' | 'system';
export type ErrorSeverity = 'fatal' | 'recoverable' | 'warning';

export interface StructuredError {
  code: ArgusErrorCode;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  details: Record<string, unknown>;
  suggestedActions: string[];
  timestamp: number;
}
```

**Error metadata registry**: A static `Map<ArgusErrorCode, { category, defaultSeverity, suggestedActions }>` that defines the default classification for each code. Factory function `createStructuredError(code, message, details?, severityOverride?)` produces `StructuredError` instances.

**Custom error class**: `ArgusError extends Error` that wraps a `StructuredError` for throw/catch patterns, replacing the current free-text error throws in Docker operations.

**Mapping from existing errors**: The current `SessionError` class in `session.ts` uses string codes like `'PORT_CONFLICT'`, `'SESSION_NOT_FOUND'`. We preserve `SessionError` for session-level concerns and use `ArgusError` for infrastructure/resilience errors. The MCP `handleError` function in `server.ts` will be extended to detect `ArgusError` and serialize its `StructuredError` into the response envelope.

#### 1.2 Resilience Configuration Schema — modify `config-loader.ts` and `types.ts`

**New types in `types.ts`:**

```typescript
export interface ResilienceConfig {
  preflight: {
    enabled: boolean;          // default: true
    diskSpaceThreshold: string; // default: '2GB'
    cleanOrphans: boolean;     // default: true
  };
  container: {
    restartOnFailure: boolean; // default: true
    maxRestarts: number;       // default: 3
    restartDelay: string;      // default: '2s'
    restartBackoff: 'exponential' | 'linear'; // default: 'exponential'
  };
  network: {
    portConflictStrategy: 'auto' | 'fail'; // default: 'auto'
    verifyConnectivity: boolean;            // default: true
  };
  circuitBreaker: {
    enabled: boolean;          // default: true
    failureThreshold: number;  // default: 5
    resetTimeoutMs: number;    // default: 30000
  };
}
```

**New Zod schema in `config-loader.ts`:**

```typescript
export const ResilienceConfigSchema = z.object({
  preflight: z.object({
    enabled: z.boolean().default(true),
    diskSpaceThreshold: z.string().default('2GB'),
    cleanOrphans: z.boolean().default(true),
  }).default({}),
  container: z.object({
    restartOnFailure: z.boolean().default(true),
    maxRestarts: z.number().min(0).max(10).default(3),
    restartDelay: z.string().default('2s'),
    restartBackoff: z.enum(['exponential', 'linear']).default('exponential'),
  }).default({}),
  network: z.object({
    portConflictStrategy: z.enum(['auto', 'fail']).default('auto'),
    verifyConnectivity: z.boolean().default(true),
  }).default({}),
  circuitBreaker: z.object({
    enabled: z.boolean().default(true),
    failureThreshold: z.number().min(1).max(20).default(5),
    resetTimeoutMs: z.number().default(30000),
  }).default({}),
}).default({});
```

Add `resilience?: ResilienceConfig` to the `E2EConfig` interface and `E2EConfigSchema`.

**Default behavior**: When no `resilience` section is present in `e2e.yaml`, Zod `.default({})` cascading ensures all features are enabled with sensible defaults (FR-R30).

#### 1.3 Preflight Health Check — `resilience/preflight.ts`

**HealthReport type:**

```typescript
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type OverallHealth = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details: Record<string, unknown>;
  duration: number;
}

export interface HealthReport {
  overall: OverallHealth;
  checks: HealthCheckResult[];
  timestamp: number;
  duration: number;
}
```

**PreflightChecker class:**

- `checkDockerDaemon()`: Runs `docker info` with 5s timeout via `execFileAsync`. Returns `pass` on success, `fail` with `DOCKER_UNAVAILABLE` on failure.
- `checkDiskSpace(threshold)`: Runs `df -BG /` (Linux) or `df -g /` (macOS) to parse available space. Compares against configured threshold. Returns `pass`/`warn`/`fail` based on available-vs-threshold ratio.
- `checkOrphans(projectName)`: Runs `docker ps -a --filter label=argusai.project --format json` to find containers with ArgusAI labels not matching current run. Also checks `docker network ls --filter label=argusai.project`. Returns list of `OrphanResource` entries.
- `runAll(config, projectName)`: Composes all checks, aggregates into `HealthReport`. Overall status: `unhealthy` if any check is `fail`, `degraded` if any is `warn`, `healthy` otherwise.
- Emits SSE events: `preflight_start`, `preflight_check` (per individual check), `preflight_end`.

**Integration point**: The `handleSetup` and `handleBuild` MCP tool handlers will call `preflightChecker.runAll()` when `resilience.preflight.enabled` is `true`, blocking execution if the result is `unhealthy`.

#### 1.4 Docker Label Support — modify `docker-engine.ts`

Add label arguments to `buildRunArgs()`:

```typescript
/** Labels applied to all ArgusAI-managed Docker resources */
export interface ArgusDockerLabels {
  'argusai.managed': 'true';
  'argusai.project': string;
  'argusai.run-id': string;
  'argusai.created-at': string;
}
```

Modify `buildRunArgs()` to accept an optional `labels?: Record<string, string>` in `DockerRunOptions` and append `--label key=value` for each entry. Similarly modify `ensureNetwork()` to accept labels.

The orchestrator and setup tool will pass these labels when creating containers and networks, enabling the orphan cleaner to identify ArgusAI resources.

---

### Phase 2: Container & Port Resilience (P1)

#### 2.1 Container Guardian — `resilience/container-guardian.ts`

**Purpose**: Monitors running containers and auto-restarts on failure with configurable backoff. Captures diagnostics before each restart attempt.

**ContainerDiagnostics type (add to `types.ts`):**

```typescript
export interface ContainerDiagnostics {
  containerId: string;
  containerName: string;
  exitCode: number | null;
  oomKilled: boolean;
  logs: string[];
  memoryStats: { limit: number; peak: number } | null;
  timestamp: number;
}

export interface RestartHistory {
  containerName: string;
  attempts: Array<ContainerDiagnostics & { attemptNumber: number; delayMs: number }>;
  finalStatus: 'recovered' | 'exhausted';
}
```

**ContainerGuardian class:**

```typescript
export class ContainerGuardian {
  constructor(
    private config: ResilienceConfig['container'],
    private eventBus?: SSEBus,
  ) {}

  async monitorAndRestart(
    containerName: string,
    runOptions: DockerRunOptions,
    labels: ArgusDockerLabels,
  ): Promise<RestartHistory | null>
}
```

**Implementation details:**

- `captureDiagnostics(name)`: Runs `docker inspect --format '{{json .State}}'` to get exit code, OOM status. Gets last 100 lines via `getContainerLogs()`. Runs `docker stats --no-stream --format '{{json .}}'` for memory. Returns `ContainerDiagnostics`.
- `monitorAndRestart()`: After detecting a container failure (via `getContainerStatus()` returning `exited` or `dead`), captures diagnostics, then calls `stopContainer()` + `startContainer()` with the original `runOptions`. Uses `computeBackoffDelay()` from the existing `retry-engine.ts` for delay calculation between attempts.
- Emits SSE events: `restart_attempt { name, attempt, reason, delay }`, `restart_success { name, attempt, duration }`, `restart_exhausted { name, attempts, history }`.
- Returns `null` if container is healthy, or a `RestartHistory` if restarts were attempted.
- Failure after `maxRestarts` throws `ArgusError` with code `CONTAINER_RESTART_EXHAUSTED` and full `RestartHistory` in details.

**Backoff reuse**: Leverages `computeBackoffDelay(baseDelayMs, attempt, backoff, multiplier)` from `retry-engine.ts` directly, avoiding code duplication. The `restartDelay` config string is parsed via `parseDelay()` from the same module.

**Integration**: The orchestrator's `startAll()` method will wrap container startup with the guardian. During test execution, the YAML engine's health-check wait will delegate to the guardian for restart capability.

#### 2.2 Port Resolver — `resilience/port-resolver.ts`

**PortMapping type (add to `types.ts`):**

```typescript
export interface PortMapping {
  service: string;
  originalPort: number;
  actualPort: number;
  reassigned: boolean;
}
```

**PortResolver class:**

```typescript
export class PortResolver {
  constructor(
    private strategy: 'auto' | 'fail',
    private eventBus?: SSEBus,
  ) {}

  async resolveServicePorts(
    services: ServiceDefinition[],
    mocks: Record<string, MockServiceConfig>,
  ): Promise<{
    services: ServiceDefinition[];
    mocks: Record<string, MockServiceConfig>;
    portMappings: PortMapping[];
  }>

  async findAvailablePort(startPort: number, maxAttempts?: number): Promise<number>
}
```

**Implementation details:**

- `resolveServicePorts()`: Iterates all configured ports from services and mocks. For each, calls `isPortInUse()` from `docker-engine.ts`. If in use and strategy is `'auto'`, calls `findAvailablePort()` starting from the original port + 1. Updates the `ServiceDefinition.container.ports` array and `MockServiceConfig.port` with new values. Collects `PortMapping` entries. If strategy is `'fail'`, throws `ArgusError` with code `PORT_CONFLICT`.
- `findAvailablePort()`: Tries ports incrementally from `startPort`, up to 100 attempts. Skips privileged ports (< 1024). Throws `ArgusError` with `PORT_EXHAUSTION` if no port found.
- Also detects PID of occupying process via `lsof -i :PORT -t` (best-effort, included in error details).
- Returns modified copies of services/mocks (immutable pattern) plus the mapping array.
- Emits SSE events: `port_conflict { service, port, pid }`, `port_reassigned { service, original, actual }`.

**Integration**: Called at the start of `handleSetup()` before container creation. The returned `portMappings` is included in the `SetupResult` response so AI Agents know the actual endpoints.

#### 2.3 Orphan Cleaner — `resilience/orphan-cleaner.ts`

**OrphanResource type (add to `types.ts`):**

```typescript
export interface OrphanResource {
  type: 'container' | 'network' | 'volume';
  name: string;
  id: string;
  project: string;
  runId: string;
  createdAt: string;
}

export interface OrphanCleanupResult {
  found: OrphanResource[];
  removed: OrphanResource[];
  failed: Array<OrphanResource & { error: string }>;
  duration: number;
}
```

**OrphanCleaner class:**

```typescript
export class OrphanCleaner {
  constructor(
    private currentProject: string,
    private currentRunId: string,
    private eventBus?: SSEBus,
  ) {}

  async detect(): Promise<OrphanResource[]>
  async cleanup(orphans: OrphanResource[]): Promise<OrphanCleanupResult>
  async detectAndCleanup(): Promise<OrphanCleanupResult>
}
```

**Implementation details:**

- `detect()`: Runs `docker ps -a --filter label=argusai.managed=true --filter label=argusai.project=<currentProject> --format '{{json .}}'`. Filters out containers with the current `runId`. Also queries `docker network ls --filter label=argusai.managed=true --format '{{json .}}'`. Returns `OrphanResource[]`.
- `cleanup()`: For each orphan: containers are stopped via `docker rm -f`, networks via `docker network rm`. Each removal is independent — failure of one does not block others (FR-R17). Containers attached to a network are stopped before network removal.
- Scoping: Only removes resources matching `argusai.project=<currentProject>` (FR-R16). Resources from other projects or without ArgusAI labels are never touched.
- Emits SSE events: `cleanup_start`, `cleanup_resource { type, name, action }`, `cleanup_end { found, removed, failed }`.

**Integration**: Called by `PreflightChecker.checkOrphans()` for detection. When `resilience.preflight.cleanOrphans` is `true`, also called in the preflight gate before setup/build proceeds.

---

### Phase 3: Circuit Breaker & Network Verification (P1–P2)

#### 3.1 Circuit Breaker — `resilience/circuit-breaker.ts`

**CircuitBreakerState type (add to `types.ts`):**

```typescript
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  lastStateTransition: number;
  failureHistory: Array<{ error: string; timestamp: number }>;
}
```

**CircuitBreaker class:**

```typescript
export class CircuitBreaker {
  constructor(
    private failureThreshold: number,
    private resetTimeoutMs: number,
    private eventBus?: SSEBus,
  ) {}

  getState(): CircuitBreakerState

  async execute<T>(operation: () => Promise<T>): Promise<T>

  reset(): { previous: CircuitState; current: CircuitState }
}
```

**State machine:**

```
  [closed] ---(failureThreshold consecutive failures)---> [open]
  [open]   ---(manual reset via MCP tool)--------------> [half-open]
  [half-open] ---(probe succeeds)----------------------> [closed]
  [half-open] ---(probe fails)-------------------------> [open]
```

**Implementation details:**

- `execute()`: In `closed` state, runs the operation; on failure increments `failureCount`. When `failureCount >= failureThreshold`, transitions to `open`. In `open` state, immediately throws `ArgusError` with code `CIRCUIT_OPEN` (< 100ms latency, NFR-R03). In `half-open` state, runs a single probe operation; on success transitions to `closed` and resets counter, on failure transitions back to `open`.
- `reset()`: Called by `argus_reset_circuit` MCP tool. Transitions from `open` to `half-open`. If already `closed`, returns no-op response. Returns previous and new state.
- `getState()`: Returns the full `CircuitBreakerState` for inclusion in status responses.
- Thread safety (NFR-R04): Uses a simple lock flag (single-threaded Node.js event loop) to prevent state corruption during concurrent async operations.
- Emits SSE events: `circuit_open { failureCount, lastError }`, `circuit_half_open`, `circuit_closed { probeSucceeded }`.

**Integration**: Wraps all Docker CLI calls in `docker-engine.ts`. A singleton `CircuitBreaker` instance is created per session and stored on the `ProjectSession` object. All functions that call Docker (`startContainer`, `buildImage`, `getContainerStatus`, etc.) pass through `circuitBreaker.execute()` when the circuit breaker is enabled.

**Design note**: Rather than modifying every function in `docker-engine.ts`, we create a `ResilientDockerEngine` wrapper class in `resilience/index.ts` that proxies calls through the circuit breaker. The orchestrator and MCP tools use this wrapper instead of importing `docker-engine.ts` directly.

#### 3.2 Network Verifier — `resilience/network-verifier.ts`

**NetworkVerification types:**

```typescript
export interface ConnectivityResult {
  service: string;
  hostname: string;
  reachable: boolean;
  dnsResolved: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface NetworkVerificationReport {
  results: ConnectivityResult[];
  allReachable: boolean;
  networkTopology: {
    networkName: string;
    containers: string[];
  };
  timestamp: number;
}
```

**NetworkVerifier class:**

```typescript
export class NetworkVerifier {
  constructor(private eventBus?: SSEBus) {}

  async verifyConnectivity(
    testContainerName: string,
    mockServices: Array<{ name: string; hostname: string; port: number }>,
    networkName: string,
  ): Promise<NetworkVerificationReport>

  async checkDnsResolution(
    fromContainer: string,
    hostname: string,
  ): Promise<{ resolved: boolean; address?: string }>
}
```

**Implementation details:**

- `verifyConnectivity()`: For each mock service, runs `docker exec <testContainer> wget -qO- --timeout=5 http://<hostname>:<port>/` (or a simpler TCP check via `nc -z`). Records whether DNS resolves and whether the service responds.
- `checkDnsResolution()`: Runs `docker exec <container> nslookup <hostname>` to verify Docker DNS is resolving container hostnames.
- On failure, collects enhanced diagnostics: network topology from `docker network inspect`, container placement, DNS results. Returns `NETWORK_UNREACHABLE` or `DNS_RESOLUTION_FAILED` structured errors.
- Emits SSE events: `network_check { service, status }`, `network_verified { allReachable }`.

**Integration**: Called after all services are started in `handleSetup()` when `resilience.network.verifyConnectivity` is `true`. Results are included in the `SetupResult`.

---

### Phase 4: MCP Tools & Integration (P2)

#### 4.1 argus_preflight_check — `mcp/tools/preflight-check.ts`

**Tool registration in `server.ts`:**

```typescript
server.tool(
  'argus_preflight_check',
  {
    projectPath: z.string().describe('Project path (must have active session)'),
    skipDiskCheck: z.boolean().optional().describe('Skip disk space check'),
    skipOrphanCheck: z.boolean().optional().describe('Skip orphan resource check'),
    autoFix: z.boolean().optional().describe('Auto-fix remediable issues (e.g., clean orphans)'),
  },
  async (params) => { /* ... */ }
);
```

**Handler**: Creates a `PreflightChecker`, runs checks (respecting skip flags). When `autoFix` is `true` and orphans are detected, runs `OrphanCleaner.cleanup()` before returning. Returns the `HealthReport` as the tool response.

#### 4.2 argus_reset_circuit — `mcp/tools/reset-circuit.ts`

**Tool registration in `server.ts`:**

```typescript
server.tool(
  'argus_reset_circuit',
  {
    projectPath: z.string().describe('Project path'),
  },
  async (params) => { /* ... */ }
);
```

**Handler**: Retrieves the circuit breaker from the session. Calls `circuitBreaker.reset()`. Returns the previous state, new state, and failure history. If circuit is already closed, returns a no-op response (FR-R28).

#### 4.3 Session Modifications — modify `session.ts`

Add to `ProjectSession`:

```typescript
export interface ProjectSession {
  // ... existing fields ...
  circuitBreaker?: CircuitBreaker;
  activeGuardians: Map<string, ContainerGuardian>;
  runId: string;                    // unique per init, used for Docker labels
  portMappings?: PortMapping[];     // populated during setup with auto-resolution
}
```

The `runId` is generated as `Date.now().toString(36)` during `argus_init` and stored on the session for labeling all Docker resources.

#### 4.4 Setup Integration — modify `mcp/tools/setup.ts`

The `handleSetup` function gains the following pre-startup pipeline:

1. **Preflight gate**: If `resilience.preflight.enabled`, run `PreflightChecker.runAll()`. If `unhealthy`, return structured error without proceeding.
2. **Orphan cleanup**: If `resilience.preflight.cleanOrphans`, run `OrphanCleaner.detectAndCleanup()`.
3. **Port resolution**: If `resilience.network.portConflictStrategy === 'auto'`, run `PortResolver.resolveServicePorts()`. Update service/mock configs with resolved ports.
4. **Container startup**: Existing logic, but use `ArgusDockerLabels` on all `startContainer` and `ensureNetwork` calls.
5. **Network verification**: If `resilience.network.verifyConnectivity`, run `NetworkVerifier.verifyConnectivity()` after all services are healthy.

The `SetupResult` type gains:

```typescript
export interface SetupResult {
  // ... existing fields ...
  preflight?: HealthReport;
  portMappings?: PortMapping[];
  networkVerification?: NetworkVerificationReport;
  orphanCleanup?: OrphanCleanupResult;
}
```

#### 4.5 Build Integration — modify `mcp/tools/build.ts`

The `handleBuild` function gains:

1. **Preflight gate**: Same as setup — run Docker daemon check before building.
2. **Circuit breaker**: All `buildImage()` calls wrapped via `circuitBreaker.execute()`.
3. **Disk space check**: Check available disk before build (building images is disk-intensive).

---

## Key Data Flows

### Flow 1: Preflight → Setup → Test (happy path)

```
AI Agent calls argus_setup
  → PreflightChecker.runAll()
    → checkDockerDaemon() ✓
    → checkDiskSpace()    ✓
    → checkOrphans()      → found 2 orphans
    → OrphanCleaner.cleanup() → removed 2
  → PortResolver.resolveServicePorts()
    → port 3000 in use → reassigned to 3001
    → portMappings: [{service: 'api', original: 3000, actual: 3001}]
  → ensureNetwork() with labels
  → startContainer() × N with labels
  → waitForHealthy() × N
  → NetworkVerifier.verifyConnectivity() ✓
  → SetupResult { preflight: HealthReport, portMappings, services, mocks }
```

### Flow 2: Container crash → Guardian auto-restart

```
Container 'api' exits with code 137 (OOM)
  → ContainerGuardian detects failure
  → captureDiagnostics() → logs, exit code, memory stats
  → SSE: restart_attempt { name: 'api', attempt: 1, reason: 'OOM' }
  → sleep(2000ms)  // restartDelay
  → stopContainer() + startContainer()
  → waitForHealthy() ✓
  → SSE: restart_success { name: 'api', attempt: 1 }
  → Test execution continues
```

### Flow 3: Circuit breaker activation

```
Docker daemon crashes
  → buildImage() fails → CircuitBreaker records failure 1/5
  → startContainer() fails → failure 2/5
  → ... failures 3, 4, 5
  → CircuitBreaker transitions to OPEN
  → SSE: circuit_open { failureCount: 5 }
  → Next Docker operation → immediate ArgusError(CIRCUIT_OPEN) in <100ms
  → AI Agent calls argus_reset_circuit
  → CircuitBreaker → HALF_OPEN
  → Next Docker operation attempted as probe
  → probe succeeds → CLOSED
  → Normal operations resume
```

---

## SSE Event Types (new `resilience` channel)

All resilience events are emitted on a new `'resilience'` channel with these event types:

| Event | Data | When |
|-------|------|------|
| `preflight_start` | `{ project }` | Preflight check begins |
| `preflight_check` | `{ name, status, message }` | Each individual check completes |
| `preflight_end` | `{ overall, duration }` | Preflight check completes |
| `restart_attempt` | `{ container, attempt, reason, delay }` | Before each restart attempt |
| `restart_success` | `{ container, attempt, duration }` | Container successfully restarted |
| `restart_exhausted` | `{ container, attempts }` | All restart attempts exhausted |
| `cleanup_start` | `{ project }` | Orphan cleanup begins |
| `cleanup_resource` | `{ type, name, action }` | Each resource cleanup action |
| `cleanup_end` | `{ found, removed, failed }` | Orphan cleanup completes |
| `port_conflict` | `{ service, port, pid? }` | Port conflict detected |
| `port_reassigned` | `{ service, original, actual }` | Port auto-reassigned |
| `circuit_open` | `{ failureCount, lastError }` | Circuit breaker opens |
| `circuit_half_open` | `{}` | Circuit transitions to half-open |
| `circuit_closed` | `{ probeSucceeded }` | Circuit closes after probe |
| `network_check` | `{ service, reachable }` | Network check per service |
| `network_verified` | `{ allReachable }` | All network checks complete |

Add `'resilience'` to the `PreflightChannel` union in `types.ts`.

---

## Modifications to Existing Files — Detailed

### `packages/core/src/types.ts`

**Add:**
- `ResilienceConfig` interface (described above)
- `resilience?: ResilienceConfig` field to `E2EConfig`
- `ContainerDiagnostics`, `RestartHistory` interfaces
- `PortMapping`, `OrphanResource`, `OrphanCleanupResult` interfaces
- `CircuitState`, `CircuitBreakerState` types
- New resilience SSE event variants to the `SetupEvent` union
- `'resilience'` to `PreflightChannel` type

### `packages/core/src/config-loader.ts`

**Add:**
- `ResilienceConfigSchema` Zod schema (described in Phase 1.2)
- Add `resilience: ResilienceConfigSchema.optional()` to `E2EConfigSchema`

### `packages/core/src/docker-engine.ts`

**Modify:**
- `DockerRunOptions`: Add optional `labels?: Record<string, string>` field
- `buildRunArgs()`: Append `--label key=value` for each label entry
- `ensureNetwork()`: Accept optional `labels` parameter, append to `docker network create`
- Export `safeExecFileAsync` (currently private) for reuse in resilience modules, or provide a `dockerExec(args)` helper

### `packages/core/src/orchestrator.ts`

**Modify:**
- `startAll()`: Accept optional `ResilienceConfig` parameter. Use `PortResolver` and `ContainerGuardian` when config is provided.
- `cleanAll()`: Also clean orphan resources when called

### `packages/core/src/index.ts`

**Add re-exports:**
```typescript
export * from './resilience/index.js';
```

### `packages/mcp/src/server.ts`

**Add:**
- Import and register `handlePreflightCheck` and `handleResetCircuit`
- Tool count changes from 9 to 11 in the module doc comment

### `packages/mcp/src/session.ts`

**Modify:**
- Add `circuitBreaker`, `activeGuardians`, `runId`, `portMappings` to `ProjectSession`
- Initialize `runId` in `create()` method
- Clean up guardians in `destroy()`

### `packages/mcp/src/tools/setup.ts`

**Modify:**
- Add preflight gate before network/container setup
- Integrate `PortResolver` for port conflict resolution
- Pass Docker labels to all container and network creation calls
- Add `NetworkVerifier` call after service startup
- Extend `SetupResult` with resilience report fields

### `packages/mcp/src/tools/build.ts`

**Modify:**
- Add preflight check (Docker daemon + disk space) before building
- Wrap `buildImage()` calls through circuit breaker

---

## Complexity Tracking

> No constitution violations detected. All design decisions align with the 10 principles.

| Decision | Rationale | Alternative Considered |
|----------|-----------|----------------------|
| Resilience modules in `resilience/` subdirectory | Keeps the subsystem cohesive without polluting the flat `src/` structure | Flat files in `src/` — rejected because 7 new files would dilute the module boundary |
| `ResilientDockerEngine` wrapper vs modifying `docker-engine.ts` directly | Preserves backward compatibility; existing tests don't break | Direct modification — rejected because it would force circuit breaker onto all consumers including tests |
| Reusing `retry-engine.ts` backoff for container restarts | Avoids duplication of `computeBackoffDelay()` and `parseDelay()` | New backoff implementation — rejected because identical logic exists and is tested |
| Singleton circuit breaker per session (not global) | Different projects can have independent circuit states in multi-tenant mode | Global singleton — rejected because a Docker failure in one project shouldn't block another |
| Docker labels for orphan detection (not PID files) | Works across Docker daemon restarts and process crashes; standard Docker pattern | PID files / temp files — rejected because they are unreliable after unclean shutdown |
