# Quickstart: Preflight AI-Native Infrastructure

**Date**: 2026-02-25
**Feature Branch**: `002-ai-native`

---

## Prerequisites

- Node.js 20+
- pnpm 10+
- Docker Engine running and accessible

## 1. Install Dependencies

```bash
cd preflight
pnpm install
```

New dependency for `@preflight/mcp`:

```bash
pnpm --filter @preflight/mcp add @modelcontextprotocol/sdk
```

New dev dependency for JSON Schema generation:

```bash
pnpm --filter @preflight/core add -D zod-to-json-schema
```

## 2. Build All Packages

```bash
pnpm build
```

This builds `@preflight/core` → `@preflight/mcp` → `@preflight/cli` in dependency order and generates JSON Schema files to `schemas/`.

## 3. Run Tests

```bash
# All unit tests
pnpm test:run

# With coverage
pnpm test:coverage

# Specific package
pnpm --filter @preflight/core test:run
pnpm --filter @preflight/mcp test:run
```

## 4. Start MCP Server (for AI Agent integration)

### Option A: Via CLI

```bash
# From a project directory containing e2e.yaml
cd examples/as-mate
npx e2e-toolkit mcp-server
```

### Option B: Direct execution

```bash
node packages/mcp/dist/index.js
```

### Option C: Configure in Cursor

Add to your Cursor MCP configuration (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "preflight": {
      "command": "node",
      "args": ["/absolute/path/to/preflight/packages/mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

A template is available at `mcp-templates/cursor-mcp-config.json`.

## 5. Use MCP Tools from an AI Agent

### Complete Workflow

```
1. preflight_init   → Load project config
2. preflight_build  → Build Docker images
3. preflight_setup  → Start environment (network, mocks, containers)
4. preflight_run    → Execute all test suites
5. preflight_clean  → Tear down environment
```

### Example: Initialize a Project

```json
{
  "tool": "preflight_init",
  "arguments": {
    "projectPath": "/Users/you/projects/my-service"
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "projectName": "my-service",
    "configPath": "/Users/you/projects/my-service/e2e.yaml",
    "services": [{ "name": "my-service-e2e", "image": "my-service:e2e", "ports": ["3000:3000"], "hasHealthcheck": true }],
    "mocks": [{ "name": "gateway", "port": 8081, "routeCount": 5 }],
    "suites": [{ "id": "health", "name": "Health Check", "runner": "yaml", "file": "tests/health.yaml" }],
    "schemaVersion": "1"
  },
  "timestamp": 1740480000000
}
```

### Example: Run Tests and Analyze Failures

```json
{
  "tool": "preflight_run",
  "arguments": {
    "projectPath": "/Users/you/projects/my-service"
  }
}
```

A failing test returns (abbreviated):
```json
{
  "success": true,
  "data": {
    "status": "failed",
    "totals": { "passed": 5, "failed": 1, "skipped": 0, "total": 6 },
    "suites": [{
      "cases": [{
        "name": "Create game returns 200",
        "status": "failed",
        "failure": {
          "error": "Expected status 200, got 500",
          "summary": "The POST /create endpoint returned a 500 server error instead of 200, likely due to missing environment variable or database connection issue.",
          "request": { "method": "POST", "url": "http://localhost:3000/create", "headers": {}, "body": { "game_id": "test" } },
          "response": { "status": 500, "headers": { "content-type": "application/json" }, "body": { "error": "Internal Server Error" } },
          "assertions": [{ "path": "status", "operator": "exact", "expected": 200, "actual": 500, "passed": false }],
          "diagnostics": {
            "containerLogs": [{ "containerName": "my-service-e2e", "lines": ["Error: ECONNREFUSED 127.0.0.1:5432", "..."], "lineCount": 50 }],
            "containerHealth": [{ "containerName": "my-service-e2e", "status": "unhealthy" }],
            "mockRequests": [{ "mockName": "gateway", "requests": [] }]
          }
        }
      }]
    }]
  }
}
```

## 6. YAML Test Authoring with Schema

### VS Code / Cursor IntelliSense

Add to your workspace `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "./schemas/e2e-config.schema.json": ["e2e.yaml", "e2e.yml"],
    "./schemas/test-suite.schema.json": ["tests/*.yaml"]
  }
}
```

### Validate Manually

```bash
# Using ajv-cli or similar
npx ajv validate -s schemas/e2e-config.schema.json -d examples/as-mate/e2e.yaml
```

## 7. Retry Configuration

### Global retry in e2e.yaml

```yaml
tests:
  retry:
    maxAttempts: 3
    delay: "2s"
    backoff: exponential
  suites:
    - name: Health Check
      id: health
      file: tests/health.yaml
```

### Per-case retry in test YAML

```yaml
cases:
  - name: Flaky endpoint test
    retry:
      maxAttempts: 5
      delay: "1s"
      backoff: linear
    request:
      method: GET
      path: /unstable
    expect:
      status: 200
```

## 8. Multi-Service Configuration

### e2e.yaml with multiple services

```yaml
services:
  - name: api
    build:
      dockerfile: api/Dockerfile
      context: .
      image: my-api:e2e
    container:
      name: my-api-e2e
      ports: ["3000:3000"]
      healthcheck:
        path: /health
        interval: 5s
        timeout: 3s
        retries: 5
        startPeriod: 10s

  - name: web
    build:
      dockerfile: web/Dockerfile
      context: .
      image: my-web:e2e
    container:
      name: my-web-e2e
      ports: ["8080:8080"]
      environment:
        API_URL: "http://my-api-e2e:3000"
    dependsOn:
      - api
```

Both services are connected to the same Docker network. The `web` service waits for `api` to be healthy before starting.

## 9. Parallel Suite Execution

```yaml
tests:
  parallel:
    enabled: true
    concurrency: 3
  suites:
    - { name: Suite A, id: a, file: tests/a.yaml, parallel: true }
    - { name: Suite B, id: b, file: tests/b.yaml, parallel: true }
    - { name: Suite C, id: c, file: tests/c.yaml, parallel: true }
    - { name: Suite D, id: d, file: tests/d.yaml, parallel: true }
```

With `concurrency: 3`, suites A, B, C start immediately; D starts when one finishes.

## 10. CI Integration

### GitHub Actions

Copy `ci-templates/github-actions.yml` to `.github/workflows/e2e.yml`:

```yaml
# Key steps:
# 1. Checkout + Node.js setup
# 2. pnpm install
# 3. preflight build
# 4. preflight setup
# 5. preflight run (JSON output)
# 6. preflight clean
# 7. Upload test-results.json as artifact
```

### GitLab CI

Copy `ci-templates/gitlab-ci.yml` to `.gitlab-ci.yml`.

## 11. Integration Testing Scenarios

### Scenario 1: Full MCP Lifecycle

1. Start MCP server: `node packages/mcp/dist/index.js`
2. Send `preflight_init` with `examples/as-mate` path
3. Send `preflight_build`
4. Send `preflight_setup`
5. Send `preflight_run`
6. Verify structured JSON results
7. Send `preflight_clean`
8. Verify all containers removed

### Scenario 2: Failure Diagnostics

1. Set up environment with a misconfigured service (wrong port)
2. Run tests
3. Verify failure report includes:
   - HTTP request/response context
   - Assertion details
   - Container logs (last 50 lines)
   - Container health status
   - Mock request records

### Scenario 3: Retry Mechanism

1. Configure test with `retry: { maxAttempts: 3, delay: "1s" }`
2. Use a mock that fails first 2 requests, succeeds on 3rd
3. Run test
4. Verify final status is "pass" with 3 attempts in history

### Scenario 4: Multi-Service Communication

1. Define 2 services: API (port 3000) and Web (port 8080, depends on API)
2. Build and setup
3. Run test that sends request from Web to API via container name
4. Verify inter-service communication works on shared Docker network
