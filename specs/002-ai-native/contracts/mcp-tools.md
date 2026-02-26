# MCP Tool Contracts: Preflight AI-Native

**Date**: 2026-02-25
**Feature Branch**: `002-ai-native`

All tools are registered on the `McpServer` instance and communicate via JSON-RPC over stdio.
Input parameters are validated with Zod schemas. All responses follow the common envelope.

---

## Common Response Envelope

```typescript
interface McpToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;        // machine-readable error code
    message: string;     // human-readable description
    details?: unknown;   // additional context
  };
  timestamp: number;     // Unix ms
}
```

MCP tool return format (per SDK):
```typescript
{ content: [{ type: "text", text: JSON.stringify(response) }] }
```

---

## Tool 1: preflight_init

Initialize a project session by loading and validating the e2e.yaml configuration.

### Input Schema (Zod)

```typescript
{
  projectPath: z.string().describe('Absolute path to project directory containing e2e.yaml'),
  configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
}
```

### Output

```typescript
interface InitResult {
  projectName: string;
  configPath: string;
  services: Array<{
    name: string;
    image: string;
    ports: string[];
    hasHealthcheck: boolean;
  }>;
  mocks: Array<{
    name: string;
    port: number;
    routeCount: number;
  }>;
  suites: Array<{
    id: string;
    name: string;
    runner: string;
    file?: string;
  }>;
  schemaVersion: string;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `CONFIG_NOT_FOUND` | e2e.yaml not found at projectPath |
| `CONFIG_INVALID` | Zod validation failed |
| `SESSION_EXISTS` | Session already initialized for this project |

---

## Tool 2: preflight_build

Build Docker image(s) for the project services. Sends progress notifications for build log lines.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path (must have active session)'),
  noCache: z.boolean().optional().describe('Disable Docker layer cache'),
  service: z.string().optional().describe('Build specific service (multi-service mode)'),
}
```

### Progress Notifications

When the client provides a `progressToken` in `_meta`, the server sends:

```typescript
{
  method: "notifications/progress",
  params: {
    progressToken: "<from request>",
    progress: <line_number>,
    total: undefined,  // total unknown during build
    message: "<build log line>"
  }
}
```

### Output

```typescript
interface BuildResult {
  services: Array<{
    name: string;
    image: string;
    status: 'success' | 'failed';
    duration: number;
    error?: string;
  }>;
  totalDuration: number;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session for projectPath |
| `BUILD_FAILED` | Docker build exited non-zero |
| `DOCKERFILE_NOT_FOUND` | Dockerfile path doesn't exist |

---

## Tool 3: preflight_setup

Start the test environment: create Docker network, start mock services, start service containers, wait for health checks.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path (must have built images)'),
  timeout: z.string().optional().describe('Health check timeout override, e.g. "120s"'),
}
```

### Output

```typescript
interface SetupResult {
  network: {
    name: string;
    created: boolean;
  };
  services: Array<{
    name: string;
    containerId: string;
    status: 'running' | 'healthy' | 'unhealthy' | 'failed';
    ports: Array<{ host: number; container: number }>;
    healthCheckDuration?: number;
  }>;
  mocks: Array<{
    name: string;
    port: number;
    status: 'running' | 'failed';
    routeCount: number;
  }>;
  totalDuration: number;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session |
| `NOT_BUILT` | Images not built yet (call preflight_build first) |
| `HEALTH_CHECK_TIMEOUT` | Service did not become healthy |
| `PORT_CONFLICT` | Required port already in use |
| `DOCKER_ERROR` | Docker daemon error |

---

## Tool 4: preflight_run

Run all test suites (or filtered suites) and return structured results.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path (must have running environment)'),
  filter: z.string().optional().describe('Suite ID filter (comma-separated for multiple)'),
  parallel: z.boolean().optional().describe('Override parallel execution setting'),
}
```

### Output

```typescript
interface RunResult {
  /** Overall status */
  status: 'passed' | 'failed';
  /** Summary totals */
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
  /** Total duration in ms */
  duration: number;
  /** Per-suite results */
  suites: Array<{
    id: string;
    name: string;
    status: 'passed' | 'failed';
    duration: number;
    passed: number;
    failed: number;
    skipped: number;
    /** AI-friendly test case results */
    cases: AIFriendlyTestResult[];
  }>;
}
```

Where `AIFriendlyTestResult` is as defined in data-model.md. Passing cases have minimal output; failing cases include full diagnostics.

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session |
| `NOT_RUNNING` | Environment not set up (call preflight_setup first) |
| `SUITE_NOT_FOUND` | Filtered suite ID doesn't exist |

---

## Tool 5: preflight_run_suite

Run a single test suite by ID. Identical output format to preflight_run but for one suite.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path'),
  suiteId: z.string().describe('Suite identifier to run'),
}
```

### Output

Same as `preflight_run` but with a single suite in the `suites` array.

### Error Codes

Same as `preflight_run`, plus:

| Code | Condition |
|------|-----------|
| `SUITE_NOT_FOUND` | Suite ID not found in configuration |

---

## Tool 6: preflight_status

Get current status of all containers, networks, and mock services.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path'),
}
```

### Output

```typescript
interface StatusResult {
  state: 'initialized' | 'built' | 'running' | 'stopped';
  network: {
    name: string;
    exists: boolean;
  };
  services: Array<{
    name: string;
    containerId?: string;
    status: ContainerStatus;
    ports: Array<{ host: number; container: number; accessible: boolean }>;
    health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
    uptime?: number;
  }>;
  mocks: Array<{
    name: string;
    port: number;
    status: 'running' | 'stopped';
    requestCount: number;
  }>;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session |

---

## Tool 7: preflight_logs

Get recent logs from a specific container.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path'),
  container: z.string().describe('Container name'),
  lines: z.number().optional().default(100).describe('Number of tail lines'),
  since: z.string().optional().describe('Show logs since timestamp, e.g. "5m", "2h"'),
}
```

### Output

```typescript
interface LogsResult {
  container: string;
  lines: string[];
  lineCount: number;
  containerStatus: ContainerStatus;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session |
| `CONTAINER_NOT_FOUND` | Container name not in session |
| `CONTAINER_NOT_RUNNING` | Container exists but not running |

---

## Tool 8: preflight_clean

Stop and remove all containers, networks, and mock services. Cleanup is best-effort.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path'),
  force: z.boolean().optional().default(true).describe('Force remove stuck containers'),
}
```

### Output

```typescript
interface CleanResult {
  containers: Array<{
    name: string;
    action: 'removed' | 'not_found' | 'force_removed' | 'failed';
    error?: string;
  }>;
  mocks: Array<{
    name: string;
    action: 'stopped' | 'not_running' | 'failed';
    error?: string;
  }>;
  network: {
    name: string;
    action: 'removed' | 'not_found' | 'failed';
    error?: string;
  };
  sessionRemoved: boolean;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session (still attempts Docker cleanup) |

---

## Tool 9: preflight_mock_requests

Get all recorded requests from mock services.

### Input Schema

```typescript
{
  projectPath: z.string().describe('Project path'),
  mockName: z.string().optional().describe('Specific mock name (default: all mocks)'),
  since: z.string().optional().describe('Filter requests after timestamp'),
  clear: z.boolean().optional().describe('Clear request log after reading'),
}
```

### Output

```typescript
interface MockRequestsResult {
  mocks: Array<{
    name: string;
    port: number;
    totalRequests: number;
    requests: Array<{
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
      timestamp: string;
    }>;
  }>;
}
```

### Error Codes

| Code | Condition |
|------|-----------|
| `SESSION_NOT_FOUND` | No active session |
| `MOCK_NOT_FOUND` | Named mock doesn't exist |
| `MOCKS_NOT_RUNNING` | Mock services not started |

---

## MCP Server Registration Example

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: '@preflight/mcp',
  version: '0.1.0',
});

server.tool(
  'preflight_init',
  {
    projectPath: z.string().describe('Absolute path to project directory'),
    configFile: z.string().optional().describe('Config filename override'),
  },
  async ({ projectPath, configFile }) => {
    // ... handler implementation ...
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result),
      }],
    };
  }
);

// ... register other tools ...

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Edge Case Handling

| Scenario | Tool | Behavior |
|----------|------|----------|
| `preflight_run` without `preflight_setup` | run | Returns error: `NOT_RUNNING` with message suggesting to call `preflight_setup` first |
| Docker build fails mid-stream | build | Returns partial build logs in progress notifications + error in final response |
| Concurrent operations on same project | any | Session uses state machine; invalid transitions return `INVALID_STATE` error |
| Docker daemon unreachable | build/setup | Returns `DOCKER_ERROR` with daemon connectivity information |
| Container stuck during clean | clean | Uses `docker rm -f` (force); reports `force_removed` status |
| Mock server port already in use | setup | Returns `PORT_CONFLICT` with the occupied port and suggestions |
| Health check timeout (single service in multi) | setup | Cleans up all services; reports which service failed and includes its logs |
