# YAML Test File Complete Syntax Reference

## Test File Structure

```yaml
name: "Suite Name"              # Required — suite display name
description: "Description"      # Optional
sequential: true                # Execute cases in order (default: true)

variables:                      # Suite-level variables
  game_id: "test-{{timestamp}}"
  token: "my-token"

setup:                          # Pre-test steps (run before cases)
  - waitHealthy:
      timeout: 60s              # Wait for service to become healthy
  - delay: 3s                   # Simple delay
  - name: "Setup request"       # Named HTTP request
    request:
      method: POST
      path: /api/init
      body: { key: value }
    ignoreError: true           # Don't fail setup if this request fails

teardown:                       # Post-test cleanup (always runs)
  - name: "Cleanup"
    request:
      method: DELETE
      path: /api/cleanup
    ignoreError: true

cases:                          # Test cases (required)
  - name: "Case Name"          # Required — case display name
    delay: 2s                   # Wait before executing this case
    request:                    # HTTP request definition
      method: GET               # GET | POST | PUT | PATCH | DELETE
      path: /api/resource       # Request path
      headers:                  # Optional headers
        Authorization: "Bearer {{config.token}}"
        Content-Type: application/json
      body:                     # Optional request body (ignored for GET)
        key: value
      timeout: 30s              # Request timeout (optional)
    expect:                     # Assertions (optional)
      status: 200
      headers:
        content-type: application/json
      body:
        field: expected_value
    save:                       # Save response values (optional)
      my_id: "data.id"         # JSONPath-like extraction
      token: "headers.x-token"
```

## Variable System

| Template | Source | Example |
|----------|--------|---------|
| `{{config.xxx}}` | `service.vars` in e2e.yaml + `variables` in test file | `{{config.base_url}}` |
| `{{env.xxx}}` | Environment variables / `.env` file | `{{env.API_KEY}}` |
| `{{runtime.xxx}}` | Values saved via `save` in previous cases | `{{runtime.my_id}}` |
| `{{timestamp}}` | Current ISO-8601 timestamp | `2026-02-26T10:30:00.000Z` |
| `{{uuid}}` | Random UUID v4 | `a1b2c3d4-...` |

## Assertion DSL Complete Reference

### Status Code

```yaml
expect:
  status: 200                  # Exact match
  status: [200, 201]           # Any of these
```

### Body — Exact Match

```yaml
expect:
  body:
    name: "hello"              # String
    count: 42                  # Number
    active: true               # Boolean
    data: null                 # Null
```

### Body — Operators

```yaml
expect:
  body:
    # Type check
    name: { type: string }     # string | number | boolean | object | array | null

    # Existence
    token: { exists: true }    # Field exists (not null, not undefined)

    # Enum
    status: { in: [active, pending, disabled] }

    # Numeric comparison
    count:
      gt: 0                    # Greater than
      gte: 1                   # Greater than or equal
      lt: 100                  # Less than
      lte: 99                  # Less than or equal

    # String operations
    message:
      contains: "success"      # Contains substring
      startsWith: "OK"         # Starts with
      matches: "^\\d+$"        # Regex match

    # Length check
    items:
      length: 5                # Exact length
    items:
      length:                  # Range length
        gt: 0
        lte: 100
```

### Body — Shorthand DSL

```yaml
expect:
  body:
    token: $exists             # Same as { exists: true }
    status: $regex:^ok$        # Same as { matches: "^ok$" }
```

### Nested Object

```yaml
expect:
  body:
    user:
      name: "Alice"
      profile:
        age: { gt: 18 }
        email: { type: string }
```

### Header Assertions

```yaml
expect:
  headers:
    content-type: application/json    # Case-insensitive match
    x-request-id: { exists: true }
```

## Time Formats

| Format | Example | Milliseconds |
|--------|---------|-------------|
| Milliseconds | `100ms` | 100 |
| Seconds | `5s` | 5000 |
| Minutes | `2m` | 120000 |
| Hours | `1h` | 3600000 |
| Number | `500` | 500 (treated as ms) |

## Mock Service Configuration (in e2e.yaml)

```yaml
mocks:
  service-name:
    port: 9081                 # Host port
    containerPort: 8081        # Container-accessible port (optional)
    routes:
      - method: GET
        path: /api/users/:id   # Supports route parameters
        response:
          status: 200
          delay: "2s"          # Optional response delay
          body:
            id: "{{request.params.id}}"
            name: "User {{request.params.id}}"
        when:                  # Optional conditional matching
          body:
            type: "create"
```

### Mock Template Variables

| Variable | Description |
|----------|-------------|
| `{{request.body.xxx}}` | Request body field |
| `{{request.params.xxx}}` | Route parameter |
| `{{request.query.xxx}}` | Query parameter |
| `{{timestamp}}` | ISO-8601 timestamp |
| `{{uuid}}` | Random UUID v4 |

### Mock Diagnostic Endpoints

Each mock service exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /_mock/health` | Health check |
| `GET /_mock/requests` | View all recorded requests |
| `POST /_mock/requests/clear` | Clear recorded requests |
