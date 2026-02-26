# Data Model: Preflight AI-Native Infrastructure Enhancement

**Date**: 2026-02-25
**Feature Branch**: `002-ai-native`

---

## 1. New Types (packages/core/src/types.ts)

### 1.1 AIFriendlyTestResult

Structured test result enriched with full diagnostic context for AI consumption.

```typescript
export interface AIFriendlyTestResult {
  /** Test case name */
  name: string;
  /** Parent suite name */
  suite: string;
  /** Overall status */
  status: 'passed' | 'failed' | 'skipped';
  /** Execution duration in milliseconds */
  duration: number;
  /** Timestamp of completion */
  timestamp: number;

  /** Populated only for failed tests */
  failure?: {
    /** Human-readable error summary */
    error: string;
    /** One-sentence summary for AI quick comprehension */
    summary: string;
    /** Optional suggested fix direction */
    suggestedFix?: string;

    /** HTTP request context (if HTTP step) */
    request?: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: unknown;
    };

    /** HTTP response context (if HTTP step) */
    response?: {
      status: number;
      headers: Record<string, string>;
      body?: unknown;
    };

    /** Structured assertion failures */
    assertions: AssertionResult[];

    /** Automatically collected diagnostics */
    diagnostics: DiagnosticReport;
  };

  /** Retry attempt history (if retry was configured) */
  attempts?: AttemptResult[];
}
```

### 1.2 DiagnosticReport

Container and environment diagnostic data collected on test failure.

```typescript
export interface DiagnosticReport {
  /** Container logs: last N lines per container */
  containerLogs: Array<{
    containerName: string;
    lines: string[];
    /** Number of log lines returned */
    lineCount: number;
  }>;

  /** Container health status per container */
  containerHealth: Array<{
    containerName: string;
    status: ContainerStatus;
    /** Health check output if available */
    healthLog?: string;
  }>;

  /** Mock service request records within the test window */
  mockRequests: Array<{
    mockName: string;
    requests: Array<{
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
      timestamp: string;
    }>;
  }>;

  /** Docker network connectivity information */
  networkInfo?: {
    networkName: string;
    connectedContainers: string[];
  };

  /** Collection timestamp */
  collectedAt: number;
}
```

### 1.3 RetryPolicy

Configuration for test case retry behavior.

```typescript
export interface RetryPolicy {
  /** Maximum number of attempts (including first) */
  maxAttempts: number;
  /** Delay between attempts (e.g., "2s", "500ms") */
  delay: string;
  /** Backoff strategy */
  backoff?: 'linear' | 'exponential';
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
}
```

### 1.4 AttemptResult

Result of a single retry attempt.

```typescript
export interface AttemptResult {
  /** Attempt number (1-based) */
  attempt: number;
  /** Whether this attempt passed */
  passed: boolean;
  /** Error message if failed */
  error?: string;
  /** Attempt duration in milliseconds */
  duration: number;
  /** Timestamp of attempt start */
  timestamp: number;
}
```

### 1.5 ServiceDefinition

Configuration for a single service in multi-service orchestration.

```typescript
export interface ServiceDefinition {
  /** Unique service name */
  name: string;
  /** Build configuration */
  build: ServiceBuildConfig;
  /** Container configuration */
  container: ServiceContainerConfig;
  /** Service-specific variables */
  vars?: Record<string, string>;
  /** Dependency ordering: names of services that must be healthy first */
  dependsOn?: string[];
}
```

### 1.6 ParallelConfig

Suite-level parallel execution configuration.

```typescript
export interface ParallelConfig {
  /** Enable parallel execution for this suite */
  enabled: boolean;
  /** Maximum concurrent suites (default: unlimited) */
  concurrency?: number;
}
```

---

## 2. Modified Types (packages/core/src/types.ts)

### 2.1 TestEvent — Enhanced `case_fail`

Add optional `diagnostics` and `attempts` fields to the `case_fail` event variant:

```typescript
export type TestEvent =
  | { type: 'suite_start'; suite: string; timestamp: number }
  | { type: 'case_start'; suite: string; name: string; timestamp: number }
  | { type: 'case_pass'; suite: string; name: string; duration: number; timestamp: number;
      attempts?: AttemptResult[] }
  | { type: 'case_fail'; suite: string; name: string; error: string; duration: number;
      timestamp: number; diagnostics?: DiagnosticReport; attempts?: AttemptResult[];
      request?: { method: string; url: string; headers: Record<string, string>; body?: unknown };
      response?: { status: number; headers: Record<string, string>; body?: unknown };
      assertions?: AssertionResult[] }
  | { type: 'case_skip'; suite: string; name: string; reason?: string; timestamp: number }
  | { type: 'suite_end'; suite: string; passed: number; failed: number; skipped: number;
      duration: number; timestamp: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; timestamp: number };
```

### 2.2 E2EConfig — Multi-service and retry support

```typescript
export interface E2EConfig {
  version: string;
  project: { name: string; description?: string; version?: string };

  /** Single service (backward compatible) */
  service?: ServiceConfig;

  /** Multiple services (new, takes precedence over service) */
  services?: ServiceDefinition[];

  mocks?: Record<string, MockServiceConfig>;

  tests?: {
    suites: TestSuiteConfig[];
    /** Global retry policy (applies to all cases without case-level retry) */
    retry?: RetryPolicy;
    /** Global parallel execution config */
    parallel?: ParallelConfig;
  };

  dashboard?: DashboardConfig;
  network?: NetworkConfig;
  repos?: RepoConfig[];
}
```

### 2.3 TestSuiteConfig — Parallel and runner extension

```typescript
export interface TestSuiteConfig {
  name: string;
  id: string;
  file?: string;
  runner?: string;                    // now also supports 'playwright'
  command?: string;
  config?: string;
  /** Suite-level retry policy override */
  retry?: RetryPolicy;
  /** Suite-level parallel execution */
  parallel?: boolean;
  /** Maximum concurrency for this suite's cases */
  concurrency?: number;
}
```

### 2.4 TestStep — Per-case retry

```typescript
export interface TestStep {
  name: string;
  delay?: string;
  request?: { /* ... unchanged ... */ };
  exec?: { /* ... unchanged ... */ };
  file?: FileAssertConfig;
  process?: ProcessAssertConfig;
  port?: PortAssertConfig;
  expect?: { /* ... unchanged ... */ };
  save?: Record<string, string>;
  ignoreError?: boolean;
  /** Per-case retry policy (overrides global and suite-level) */
  retry?: RetryPolicy;
}
```

### 2.5 SuiteReport — Attempt history in case reports

```typescript
export interface SuiteReport {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  cases: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
    /** Retry attempt history (if retry was used) */
    attempts?: AttemptResult[];
    /** Full diagnostics (for failed cases) */
    diagnostics?: DiagnosticReport;
  }>;
}
```

---

## 3. MCP Session Types (packages/mcp/src/session.ts)

### 3.1 ProjectSession

Per-project state tracked by the MCP server.

```typescript
export interface ProjectSession {
  /** Absolute path to the project directory */
  projectPath: string;
  /** Loaded and validated E2E configuration */
  config: E2EConfig;
  /** Path to the e2e.yaml file */
  configPath: string;
  /** Container IDs managed by this session */
  containerIds: Map<string, string>;
  /** Running mock server instances */
  mockServers: Map<string, { server: FastifyInstance; port: number }>;
  /** Docker network name */
  networkName: string;
  /** Session creation timestamp */
  createdAt: number;
  /** Current state */
  state: 'initialized' | 'built' | 'running' | 'stopped';
}
```

### 3.2 SessionManager

```typescript
export class SessionManager {
  private sessions: Map<string, ProjectSession>;

  getOrThrow(projectPath: string): ProjectSession;
  create(projectPath: string, config: E2EConfig, configPath: string): ProjectSession;
  remove(projectPath: string): void;
  has(projectPath: string): boolean;
}
```

---

## 4. MCP Tool Input/Output Types (packages/mcp/src/tools/)

### 4.1 Common Response Envelope

All MCP tool responses follow this envelope:

```typescript
interface McpToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: number;
}
```

### 4.2 Tool-Specific Data Types

See `contracts/mcp-tools.md` for complete input/output schemas per tool.

---

## 5. Config Schema Extensions (packages/core/src/config-loader.ts)

### 5.1 New Zod Schemas

```typescript
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().min(1).max(10).describe('Maximum retry attempts including first try'),
  delay: z.string().describe('Delay between retries, e.g. "2s", "500ms"'),
  backoff: z.enum(['linear', 'exponential']).optional().describe('Backoff strategy'),
  backoffMultiplier: z.number().optional().default(2).describe('Multiplier for exponential backoff'),
}).describe('Retry policy for transient test failures');

export const ParallelConfigSchema = z.object({
  enabled: z.boolean().describe('Enable parallel suite execution'),
  concurrency: z.number().optional().describe('Max concurrent suites'),
}).describe('Parallel test execution configuration');

export const ServiceDefinitionSchema = z.object({
  name: z.string().describe('Unique service identifier'),
  build: ServiceBuildSchema,
  container: ServiceContainerSchema,
  vars: z.record(z.string()).optional(),
  dependsOn: z.array(z.string()).optional().describe('Services that must be healthy before this one starts'),
}).describe('Service definition for multi-service orchestration');
```

### 5.2 Extended E2EConfigSchema

```typescript
export const E2EConfigSchema = z.object({
  version: z.string().default('1'),
  project: z.object({
    name: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
  // Backward-compatible: either service (singular) or services (array)
  service: z.object({
    build: ServiceBuildSchema,
    container: ServiceContainerSchema,
    vars: z.record(z.string()).optional(),
  }).optional(),
  services: z.array(ServiceDefinitionSchema).optional(),
  mocks: z.record(MockServiceSchema).optional(),
  tests: z.object({
    suites: z.array(TestSuiteSchema),
    retry: RetryPolicySchema.optional(),
    parallel: ParallelConfigSchema.optional(),
  }).optional(),
  dashboard: DashboardSchema.optional(),
  network: NetworkSchema.optional(),
  repos: z.array(RepoConfigSchema).optional(),
}).refine(
  (data) => data.service || data.services,
  { message: 'Either "service" or "services" must be defined' }
);
```

---

## 6. Entity Relationship Summary

```
E2EConfig
 ├── project (name, version)
 ├── service? ──────→ ServiceConfig (backward compat)
 ├── services? ─────→ ServiceDefinition[] (new multi-service)
 │     └── dependsOn → ServiceDefinition.name
 ├── mocks ─────────→ Record<string, MockServiceConfig>
 ├── tests
 │     ├── suites ──→ TestSuiteConfig[]
 │     │     ├── runner → 'yaml' | 'vitest' | 'shell' | 'exec' | 'pytest' | 'playwright'
 │     │     ├── retry? → RetryPolicy
 │     │     └── parallel? → boolean
 │     ├── retry? ──→ RetryPolicy (global default)
 │     └── parallel? → ParallelConfig (global default)
 ├── network ───────→ NetworkConfig
 └── repos ─────────→ RepoConfig[]

TestStep
 ├── request? ──────→ HTTP request definition
 ├── exec? ─────────→ Docker exec definition
 ├── file? ─────────→ File assertion
 ├── process? ──────→ Process assertion
 ├── port? ─────────→ Port assertion
 ├── expect? ───────→ Assertion rules
 ├── retry? ────────→ RetryPolicy (per-case override)
 └── save? ─────────→ Variable capture

TestEvent (case_fail)
 ├── error ─────────→ string
 ├── diagnostics? ──→ DiagnosticReport
 │     ├── containerLogs[]
 │     ├── containerHealth[]
 │     ├── mockRequests[]
 │     └── networkInfo?
 ├── assertions? ───→ AssertionResult[]
 ├── request? ──────→ HTTP request context
 ├── response? ─────→ HTTP response context
 └── attempts? ─────→ AttemptResult[]

AIFriendlyTestResult (MCP output)
 ├── failure?
 │     ├── summary (NL sentence)
 │     ├── suggestedFix?
 │     ├── request/response context
 │     ├── assertions[]
 │     └── diagnostics → DiagnosticReport
 └── attempts? ─────→ AttemptResult[]
```

---

## 7. Docker Engine Function Signature Changes

### 7.1 Async Migration

Functions changing from sync to async:

| Function | Before | After |
|----------|--------|-------|
| `isPortInUse` | `(port: number): boolean` | `(port: number): Promise<boolean>` |
| `stopContainer` | uses `safeExec(shell_string)` | uses `execFileAsync('docker', [...])` |
| `getContainerStatus` | uses `safeExec(shell_string)` | uses `execFileAsync('docker', [...])` |
| `isContainerRunning` | uses `safeExec(shell_string)` | uses `execFileAsync('docker', [...])` |
| `getContainerLogs` | uses `execSync(shell_string)` | uses `execFileAsync('docker', [...])` |
| `execInContainer` | uses `execSync(shell_string)` | uses `execFileAsync('docker', [...])` |
| `ensureNetwork` | uses `safeExec(shell || true)` | uses try/catch with `execFileAsync` |
| `removeNetwork` | uses `safeExec(shell || true)` | uses try/catch with `execFileAsync` |

Internal helper change:

| Function | Before | After |
|----------|--------|-------|
| `safeExec` | `(cmd: string): string` (sync, shell) | `safeExecFile(bin: string, args: string[]): Promise<string>` (async, no shell) |

### 7.2 startContainer Fix

```typescript
// Before (vulnerable):
const output = execSync(`docker ${args.join(' ')}`, { encoding: 'utf-8', timeout: 30_000 }).trim();

// After (safe):
const { stdout } = await execFileAsync('docker', args, { encoding: 'utf-8', timeout: 30_000 });
return stdout.trim().slice(0, 12);
```
