---
skill_name: argusai-e2e
version: 0.1.0
description: >
  Run Docker-based E2E tests using ArgusAI MCP tools. Use this skill when users
  ask to run end-to-end tests, verify API behavior, test services in Docker containers,
  set up mock services, or perform acceptance testing. Triggers include phrases like
  "跑一下E2E测试", "运行端到端测试", "run e2e tests", "verify the API",
  "test the service", "run acceptance tests", "检查服务是否正常",
  or when the current project contains an e2e.yaml file.
triggers:
  - "跑一下E2E测试"
  - "运行端到端测试"
  - "run e2e tests"
  - "run tests"
  - "test the service"
  - "run acceptance tests"
  - "检查服务是否正常"
  - "验证接口"
  - "e2e.yaml"
---

# ArgusAI E2E Testing Skill

You have access to ArgusAI MCP tools for running Docker-based end-to-end tests. This skill teaches you how to use these tools effectively.

## Prerequisites

Before using ArgusAI tools, verify:
1. **Docker** is running (`docker info` should succeed)
2. **e2e.yaml** exists in the project directory
3. **argusai-mcp** package is available (installed via plugin MCP config)

## Available MCP Tools

You have 9 MCP tools available through the ArgusAI MCP server:

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `argus_init` | Load project config | **Always call first** — loads e2e.yaml and creates a session |
| `argus_build` | Build Docker images | After code changes, or first time setup |
| `argus_setup` | Start test environment | After build, creates network + mock + containers |
| `argus_run` | Run all/filtered test suites | Main test execution |
| `argus_run_suite` | Run a single test suite | For targeted testing |
| `argus_status` | Check environment status | To verify containers are running |
| `argus_logs` | View container logs | When tests fail, to diagnose issues |
| `argus_clean` | Clean up resources | After testing is complete |
| `argus_mock_requests` | View mock request recordings | To verify outbound requests |

## Standard Workflow

### Full Test Cycle

Follow this sequence for a complete E2E test run:

```
1. argus_init(projectPath)     → Load configuration
2. argus_build(projectPath)    → Build Docker image
3. argus_setup(projectPath)    → Start environment (network + mocks + container)
4. argus_run(projectPath)      → Execute all test suites
5. argus_clean(projectPath)    → Clean up everything
```

### Quick Re-test (Environment Already Running)

If the environment is already running (check with `argus_status`):

```
1. argus_init(projectPath)     → Reload config
2. argus_run(projectPath)      → Run tests
```

### Targeted Testing

To run a specific test suite:

```
argus_run_suite(projectPath, suiteId: "health")
```

Or filter multiple suites:

```
argus_run(projectPath, filter: "health,api")
```

## Tool Parameters Reference

### argus_init
```
projectPath: string (required) — Absolute path to the project directory containing e2e.yaml
configFile?: string — Config filename override (default: "e2e.yaml")
```

### argus_build
```
projectPath: string (required) — Project path (must have active session from init)
noCache?: boolean — Disable Docker layer cache for clean rebuild
service?: string — Build specific service in multi-service mode
```

### argus_setup
```
projectPath: string (required) — Project path (must have built images)
timeout?: string — Health check timeout override, e.g. "120s"
```

### argus_run
```
projectPath: string (required) — Project path (must have running environment)
filter?: string — Suite ID filter (comma-separated for multiple, e.g. "health,api")
parallel?: boolean — Override parallel execution setting
```

### argus_run_suite
```
projectPath: string (required) — Project path
suiteId: string (required) — Suite identifier to run
```

### argus_status
```
projectPath: string (required) — Project path
```

### argus_logs
```
projectPath: string (required) — Project path
container: string (required) — Container name
lines?: number — Number of tail lines (default: 100)
since?: string — Show logs since timestamp, e.g. "5m", "2h"
```

### argus_clean
```
projectPath: string (required) — Project path
force?: boolean — Force remove stuck containers
```

### argus_mock_requests
```
projectPath: string (required) — Project path
mockName?: string — Specific mock name (default: all mocks)
since?: string — Filter requests after timestamp
clear?: boolean — Clear request log after reading
```

## Response Format

All tools return a JSON envelope:

```json
{
  "success": true,
  "data": { ... },
  "timestamp": 1234567890
}
```

On error:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  },
  "timestamp": 1234567890
}
```

## Failure Diagnosis Workflow

When tests fail, follow this diagnostic sequence:

1. **Check the run result** — the `argus_run` response includes per-suite and per-case results with assertion details
2. **View container logs** — `argus_logs(projectPath, container, lines: 200)` to see application errors
3. **Check mock requests** — `argus_mock_requests(projectPath)` to verify the service sent correct requests to dependencies
4. **Check environment status** — `argus_status(projectPath)` to verify containers are healthy

### Common Failure Patterns

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| `HEALTH_CHECK_TIMEOUT` | Service didn't start in time | Check logs, increase `startPeriod` |
| Status code mismatch | API behavior changed | Review the endpoint implementation |
| Body assertion failed | Response structure changed | Update test expectations or fix code |
| `CONNECTION_REFUSED` | Container not running | Run `argus_status`, maybe re-run `argus_setup` |
| Mock not recording requests | Wrong URL in container config | Verify `environment` in e2e.yaml |

## e2e.yaml Quick Reference

The e2e.yaml config file defines:

```yaml
version: "1"
project:
  name: string             # Project name
service:
  build:
    dockerfile: string     # Dockerfile path
    image: string          # Image name
  container:
    name: string           # Container name
    ports: ["host:container"]
    environment: {}        # Env vars (supports {{env.VAR}} templates)
    healthcheck:
      path: /health
      interval: 10s
      timeout: 5s
      retries: 10
      startPeriod: 30s
  vars: {}                 # Custom vars ({{config.xxx}})

mocks:                     # Optional mock services
  mock-name:
    port: 9081
    routes:
      - method: GET
        path: /api/endpoint
        response:
          status: 200
          body: { key: "value" }

tests:
  suites:
    - name: string
      id: string           # Used in argus_run filter
      file: string         # Path to test YAML file
      runner: yaml         # yaml | vitest | pytest | shell | exec | playwright
```

## YAML Test File Quick Reference

```yaml
name: Suite Name
sequential: true

setup:
  - waitHealthy: { timeout: 60s }

cases:
  - name: "Test case"
    request:
      method: GET
      path: /api/endpoint
      headers: { Authorization: "Bearer {{config.token}}" }
      body: { key: "value" }
    expect:
      status: 200
      body:
        field: "exact_value"
        count: { gt: 0 }
        token: { exists: true }
        name: { contains: "sub" }
    save:
      my_var: "data.id"        # Save for {{runtime.my_var}} in later cases
```

### Assertion Operators

- Exact match: `field: "value"` or `field: 42`
- Type check: `field: { type: string }`
- Existence: `field: { exists: true }`
- Comparison: `field: { gt: 0, lte: 100 }`
- String ops: `field: { contains: "x", startsWith: "y", matches: "^\\d+$" }`
- Length: `field: { length: 5 }` or `field: { length: { gt: 0 } }`
- Enum: `field: { in: [a, b, c] }`
- Shorthand: `field: $exists` or `field: $regex:^ok$`

## Best Practices

1. **Always init first** — `argus_init` must be called before any other tool
2. **Check status before re-running** — use `argus_status` to see if environment is already up
3. **Clean up after testing** — always call `argus_clean` when done
4. **Use targeted runs** — when debugging, use `argus_run_suite` for faster feedback
5. **Read logs on failure** — container logs usually reveal the root cause
6. **projectPath must be absolute** — always use the full absolute path
