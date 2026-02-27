# Quickstart: OpenAPI Smart Mock

**Feature**: 006-openapi-mock  
**Date**: 2026-02-27

---

## Prerequisites

- Node.js 20+
- pnpm installed
- An OpenAPI 3.x spec file (YAML or JSON)
- Existing ArgusAI project with `e2e.yaml`

---

## 1. Basic Setup — Auto Mode (5 minutes)

Add an OpenAPI-backed mock to your `e2e.yaml`:

```yaml
mocks:
  payment-api:
    port: 9090
    openapi: ./specs/payment-api.yaml
```

That's it. Start the test environment:

```bash
e2e-toolkit setup
```

Every endpoint in `payment-api.yaml` is now a live mock route on `http://localhost:9090`. Responses are generated from `example` fields in the spec, or from schema types when examples are absent.

### Test it

```bash
curl http://localhost:9090/api/balance
# → {"balance": 0, "currency": "string"}

curl http://localhost:9090/api/charge -X POST \
  -H "Content-Type: application/json" \
  -d '{"amount": 100, "currency": "USD"}'
# → {"charged": true, "transactionId": "string"}
```

### Select alternative status codes

```bash
curl http://localhost:9090/api/charge -X POST \
  -H "X-Mock-Status: 400" \
  -H "Content-Type: application/json" \
  -d '{"amount": -1}'
# → Returns the 400 response defined in the spec
```

---

## 2. Request Validation

Enable validation to catch malformed requests early:

```yaml
mocks:
  payment-api:
    port: 9090
    openapi: ./specs/payment-api.yaml
    validate: true
```

Now sending invalid requests returns 422 with clear error details:

```bash
curl http://localhost:9090/api/charge -X POST \
  -H "Content-Type: application/json" \
  -d '{"amount": "not-a-number", "currency": "USD"}'
# → 422 {"error": "Request validation failed", "details": [
#     {"location": "body", "pointer": "/amount", "message": "must be integer"}
#   ]}
```

---

## 3. Manual Overrides

Override specific endpoints while keeping auto-generation for everything else:

```yaml
mocks:
  payment-api:
    port: 9090
    openapi: ./specs/payment-api.yaml
    overrides:
      - method: POST
        path: /api/charge
        response:
          status: 200
          body:
            charged: true
            transactionId: "{{uuid}}"
```

- `POST /api/charge` → returns the override (with a real UUID)
- All other endpoints → auto-generated from the spec

---

## 4. Record/Replay

### Step 1: Record against the real API

```yaml
mocks:
  payment-api:
    port: 9090
    openapi: ./specs/payment-api.yaml
    mode: record
    target: https://api.payment.com
```

Run your tests normally. All requests are forwarded to the real API; responses are saved to `.argusai/recordings/payment-api.json`.

### Step 2: Replay without network

```yaml
mocks:
  payment-api:
    port: 9090
    openapi: ./specs/payment-api.yaml
    mode: replay
```

Recorded responses are served deterministically. No network access needed.

### Step 3: Smart mode (best of both)

```yaml
mocks:
  payment-api:
    port: 9090
    openapi: ./specs/payment-api.yaml
    mode: smart
```

- Has recording? → Replay it
- No recording? → Auto-generate from spec

---

## 5. MCP Tools

### Generate mock config from a spec

Invoke the `argus_mock_generate` tool:

```json
{
  "projectPath": "/home/dev/my-project",
  "specPath": "specs/payment-api.yaml",
  "port": 9090,
  "validate": true
}
```

Returns a YAML snippet ready to paste into `e2e.yaml`.

### Validate mock coverage

Invoke the `argus_mock_validate` tool:

```json
{
  "projectPath": "/home/dev/my-project",
  "mockName": "payment-api"
}
```

Returns a coverage report listing covered, missing, and extra endpoints.

---

## 6. Full Configuration Reference

```yaml
mocks:
  payment-api:
    port: 9090                           # Required: host port
    containerPort: 9090                   # Optional: container-internal port
    openapi: ./specs/payment-api.yaml     # Path to OpenAPI 3.x spec
    mode: auto                            # auto | record | replay | smart
    validate: false                       # Enable request validation
    target: https://api.payment.com       # Real API URL (for record mode)
    recordingsDir: .argusai/recordings    # Recordings directory
    maxDepth: 3                           # Max depth for circular $ref
    overrides:                            # Override specific routes
      - method: POST
        path: /api/charge
        response:
          status: 200
          body: { charged: true, transactionId: "{{uuid}}" }
    routes:                               # Legacy: same as overrides when openapi is set
      - method: GET
        path: /custom/endpoint
        response:
          status: 200
          body: { custom: true }
```

---

## 7. Integration Test Scenarios

### Scenario A: Verify auto-generation covers all spec endpoints

```bash
# 1. Set up with openapi only
# 2. For each endpoint in spec, send a request
# 3. Assert response status matches default 2xx
# 4. Assert response body conforms to schema
```

### Scenario B: Verify validation rejects bad requests

```bash
# 1. Set up with validate: true
# 2. Send request with wrong body type
# 3. Assert 422 with validation error details
# 4. Send valid request
# 5. Assert 2xx with mock response
```

### Scenario C: Verify record → replay cycle

```bash
# 1. Start in record mode with real API target
# 2. Send requests through mock
# 3. Verify real responses are returned
# 4. Stop mock, switch to replay mode
# 5. Send same requests
# 6. Verify identical responses without network access
```

### Scenario D: Verify override precedence

```bash
# 1. Set up with openapi + override for POST /api/charge
# 2. Send POST /api/charge → assert override response (with {{uuid}})
# 3. Send GET /api/balance → assert auto-generated response
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Spec file not found" | Check the `openapi` path is relative to `e2e.yaml` directory |
| "Unresolvable $ref" | Ensure referenced files exist and paths are correct |
| "Circular reference detected" | Adjust `maxDepth` (default: 3) if responses are truncated |
| "No recording found" in replay mode | Run in `record` mode first, or switch to `smart` mode |
| Validation errors on valid requests | Check that your spec's parameter types match what your service sends |
