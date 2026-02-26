# e2e.yaml Configuration Reference

## Complete Structure

```yaml
version: "1"                          # Required — config version

project:
  name: string                        # Required — project name
  description: string                 # Optional

# ======== Single Service Mode ========
service:
  build:
    dockerfile: string                # Required — Dockerfile path
    context: string                   # Build context (default: ".")
    image: string                     # Required — image name (supports {{env.VAR}})
    args:                             # Optional build args
      KEY: VALUE

  container:
    name: string                      # Required — container name
    ports:                            # Required — port mappings
      - "host:container"
    environment:                      # Optional — env vars
      KEY: VALUE
      SECRET: "{{env.SECRET}}"        # Supports variable templates
    volumes:                          # Optional
      - "volume-name:/path/in/container"
    healthcheck:                      # Optional (strongly recommended)
      path: /health                   # Required — health endpoint
      interval: 10s                   # Check interval (default: 10s)
      timeout: 5s                     # Check timeout (default: 5s)
      retries: 10                     # Retry count (default: 10)
      startPeriod: 30s               # Wait before first check (default: 30s)

  vars:                               # Custom variables → {{config.xxx}}
    base_url: http://localhost:8080

# ======== Multi-Service Mode ========
services:
  - name: api-server
    build:
      dockerfile: Dockerfile.api
      image: api:e2e
    container:
      name: api-e2e
      ports: ["8080:3000"]

  - name: worker
    build:
      dockerfile: Dockerfile.worker
      image: worker:e2e
    container:
      name: worker-e2e
      ports: ["8081:3000"]

# ======== Mock Services ========
mocks:
  mock-name:
    port: 9081                        # Host port
    containerPort: 8081               # In-network port (optional)
    routes:
      - method: GET
        path: /api/endpoint
        response:
          status: 200
          body: { key: "value" }

# ======== Test Suites ========
tests:
  suites:
    - name: string                    # Suite display name
      id: string                      # Unique ID (used for filtering)
      file: string                    # Test file or directory path
      runner: yaml                    # yaml | vitest | pytest | shell | exec | playwright
      command: string                 # For exec runner only
      config: string                  # Runner config file (e.g. vitest.config.ts)
      retry:                          # Retry policy (optional)
        maxRetries: 3
        backoff: exponential
      parallel: boolean               # Run cases in parallel (optional)

# ======== Dashboard ========
dashboard:
  port: 9095                          # API port (default: 9095)
  uiPort: 9091                       # UI port (default: 9091)

# ======== Network ========
network:
  name: e2e-network                   # Docker network name (default: e2e-network)
```

## Test Runner Types

| Runner | ID | Purpose | `file` field | `command` field |
|--------|----|---------|-------------|----------------|
| YAML | `yaml` | Declarative HTTP tests | `.yaml` test file | — |
| Vitest | `vitest` | JS/TS tests | Test directory/file | — |
| Pytest | `pytest` | Python tests | Test directory/file | — |
| Shell | `shell` | Shell scripts | `.sh` script | — |
| Exec | `exec` | Arbitrary commands | — | Command string |
| Playwright | `playwright` | Browser E2E | Playwright test dir | — |

## Environment Variable Resolution

Variables in `environment` are resolved in this order:
1. Literal values: `NODE_ENV: test`
2. `{{env.VAR}}` — from process environment or `.env` file
3. `{{config.VAR}}` — from `service.vars`

## JSON Schema

For IDE autocompletion, reference the JSON schema:
- `schemas/e2e-config.schema.json` — main config schema
- `schemas/test-suite.schema.json` — test file schema
