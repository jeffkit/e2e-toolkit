# Feature Specification: OpenAPI Smart Mock

**Feature Branch**: `006-openapi-mock`  
**Created**: 2026-02-27  
**Status**: Draft  
**Input**: User description: "OpenAPI Smart Mock — one-click mock generation from OpenAPI specs with request validation, record/replay modes, and manual overrides"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One-Click Mock Generation from OpenAPI Spec (Priority: P1)

A developer has an OpenAPI 3.x specification file (YAML or JSON) for a third-party payment API. Instead of manually defining dozens of mock routes one by one in `e2e.yaml`, the developer points the mock configuration at the OpenAPI spec file. The system automatically generates mock routes for every endpoint defined in the spec, producing realistic response bodies derived from `example` fields or schema types. The developer starts the test suite and all dependent API calls hit the generated mock server — zero manual route definitions required.

**Why this priority**: This is the core value proposition. Without automatic mock generation, every other feature (validation, record/replay, overrides) has no foundation. A developer can immediately save hours of manual mock definition work with this story alone.

**Independent Test**: Can be fully tested by providing an OpenAPI spec file in the mock configuration and verifying that all spec-defined endpoints return schema-appropriate responses. Delivers immediate value by eliminating manual route definition.

**Acceptance Scenarios**:

1. **Given** an `e2e.yaml` with a mock entry pointing to a valid OpenAPI 3.0 YAML spec, **When** the mock server starts, **Then** every path/method combination in the spec has a functioning mock route returning a response matching the defined schema.
2. **Given** an OpenAPI spec where endpoints define `example` fields on response schemas, **When** a request hits that mock endpoint, **Then** the response body uses the provided example values.
3. **Given** an OpenAPI spec where endpoints have no `example` fields, **When** a request hits that mock endpoint, **Then** the response body is auto-generated from schema types (strings get placeholder strings, integers get placeholder integers, arrays get single-element arrays, etc.).
4. **Given** an OpenAPI 3.1 spec in JSON format, **When** the mock server starts, **Then** all routes are generated correctly, identical in behavior to a YAML-formatted spec.
5. **Given** an OpenAPI spec containing `$ref` references (including cross-file references), **When** the spec is parsed, **Then** all references are fully resolved and the corresponding mock routes produce correct responses.
6. **Given** an OpenAPI spec defining multiple response status codes for a single endpoint (e.g., 200, 400, 404), **When** the mock server starts, **Then** the default response is the lowest 2xx status code, and the developer can select an alternative status code by sending an `X-Mock-Status` header with the desired code.

---

### User Story 2 — Request Validation Mode (Priority: P2)

A developer wants to ensure that the service under test is sending correctly formatted requests to the mocked API. The developer enables validation mode in the mock configuration. When the service sends a request with a missing required field or wrong parameter type, the mock server rejects it with a clear validation error instead of silently returning a mock response. This helps catch integration bugs early — before reaching the real API.

**Why this priority**: Request validation transforms the mock from a passive stub into an active correctness checker. It catches bugs that would otherwise only surface in integration or production environments, delivering significant testing quality improvement.

**Independent Test**: Can be tested by enabling `validate: true` on a mock with an OpenAPI spec and sending both valid and invalid requests. Valid requests receive mock responses; invalid requests receive detailed validation errors.

**Acceptance Scenarios**:

1. **Given** a mock with `validate: true` and a spec defining a POST endpoint requiring a JSON body with fields `amount` (integer) and `currency` (string), **When** the service sends a POST with `amount: "not-a-number"`, **Then** the mock returns a 422 response with a clear error message indicating the type mismatch.
2. **Given** a mock with `validate: true`, **When** the service sends a request to an endpoint not defined in the spec, **Then** the mock returns a 422 response indicating the endpoint is not recognized.
3. **Given** a mock with `validate: true` and a spec requiring query parameter `page` as an integer, **When** the service sends `page=abc`, **Then** the mock returns a 422 response with a validation error for the parameter.
4. **Given** a mock with `validate: false` (or validation not specified), **When** the service sends a malformed request, **Then** the mock returns a normal mock response without validation errors.

---

### User Story 3 — Manual Override of Auto-Generated Routes (Priority: P2)

A developer needs most endpoints to use auto-generated mock responses, but one specific endpoint (e.g., POST /api/charge) must return a custom response with a dynamic transaction ID for the test scenario to work correctly. The developer adds an override entry for that specific route. The override takes priority over the auto-generated route, while all other endpoints continue to use auto-generated responses.

**Why this priority**: Real-world testing almost always requires at least some custom mock behavior. Without overrides, developers would have to choose between full automation (inflexible) and full manual definition (tedious). Overrides enable the best of both worlds.

**Independent Test**: Can be tested by defining a mock with an OpenAPI spec and one override entry, then verifying the overridden endpoint returns the custom response while non-overridden endpoints return auto-generated responses.

**Acceptance Scenarios**:

1. **Given** a mock with an OpenAPI spec and an override for `POST /api/charge` returning `{ charged: true, transactionId: "{{uuid}}" }`, **When** a POST request hits `/api/charge`, **Then** the response matches the override definition (with `{{uuid}}` replaced by a generated UUID), not the auto-generated response.
2. **Given** a mock with an OpenAPI spec and no override for `GET /api/balance`, **When** a GET request hits `/api/balance`, **Then** the response is auto-generated from the spec schema.
3. **Given** a mock with an override for a path that also exists in the OpenAPI spec, **When** the mock server starts, **Then** the system does not produce errors or warnings — the override silently takes precedence.

---

### User Story 4 — Record/Replay Mode (Priority: P3)

A developer needs to run tests offline (e.g., in CI without network access to the real API). The developer first runs tests in `record` mode, which proxies requests to the real API and saves the actual responses. Later, the developer switches to `replay` mode, and the mock server replays the recorded responses without contacting the real API. For convenience, the `smart` mode automatically replays when a recording exists and falls back to auto-generated responses for unrecorded endpoints.

**Why this priority**: Record/replay enables offline and deterministic testing, which is valuable for CI pipelines and flaky-test reduction. However, it requires the core mock generation to already work, and many teams can get significant value from the `auto` + `validate` combination alone.

**Independent Test**: Can be tested by running in `record` mode against a real API, then switching to `replay` mode and verifying that identical responses are served without network access.

**Acceptance Scenarios**:

1. **Given** a mock configured in `record` mode with a real API target, **When** a request passes through the mock, **Then** the request is forwarded to the real API, the real response is returned to the caller, and the request/response pair is saved to a recording file.
2. **Given** a mock configured in `replay` mode with existing recordings, **When** a request matching a recorded interaction arrives, **Then** the recorded response is returned without contacting the real API.
3. **Given** a mock configured in `replay` mode, **When** a request arrives that has no matching recording, **Then** the mock returns an error indicating no recording was found for that request.
4. **Given** a mock configured in `smart` mode, **When** a request arrives that has a matching recording, **Then** the recorded response is returned.
5. **Given** a mock configured in `smart` mode, **When** a request arrives that has no matching recording, **Then** an auto-generated response based on the OpenAPI spec is returned.
6. **Given** a mock configured in `auto` mode, **When** any request arrives, **Then** the response is always auto-generated from the OpenAPI spec (recordings are ignored).

---

### User Story 5 — MCP Tools for Mock Management (Priority: P3)

A developer using the MCP interface wants to quickly generate a mock configuration snippet from an OpenAPI spec file without manually writing YAML. The developer invokes the `argus_mock_generate` tool with the path to an OpenAPI spec, and receives a ready-to-use YAML configuration snippet. Additionally, the developer can invoke `argus_mock_validate` to check whether their current mock configuration covers all endpoints defined in the spec, highlighting any missing endpoints.

**Why this priority**: MCP tools enhance the developer experience for ArgusAI's MCP users, but the core mock functionality must work first. These tools are productivity accelerators, not core functionality.

**Independent Test**: Can be tested by invoking each MCP tool with appropriate inputs and verifying the output format and correctness.

**Acceptance Scenarios**:

1. **Given** an OpenAPI spec file at a known path, **When** the developer invokes `argus_mock_generate` with that path, **Then** the tool returns a valid YAML snippet containing mock configuration for all endpoints in the spec.
2. **Given** a current `e2e.yaml` with mock definitions and an OpenAPI spec, **When** the developer invokes `argus_mock_validate`, **Then** the tool returns a report listing which spec endpoints are covered by mock routes and which are missing.
3. **Given** an OpenAPI spec and a mock configuration that covers all endpoints, **When** `argus_mock_validate` is invoked, **Then** the tool reports full coverage with no missing endpoints.

---

### Edge Cases

- What happens when the OpenAPI spec file is malformed or invalid? The system should report a clear parsing error at mock server startup time, identifying the location and nature of the problem.
- What happens when the OpenAPI spec file path does not exist? The system should report a clear "file not found" error at startup.
- What happens when a `$ref` reference points to a non-existent schema? The system should report an unresolved reference error with the specific `$ref` path.
- What happens when the OpenAPI spec defines circular `$ref` references? The system should detect circular references and generate a response with a configurable maximum nesting depth to avoid infinite recursion.
- What happens when an override path does not match any path in the OpenAPI spec? The override should still work — overrides are independent of the spec and can define entirely custom routes.
- What happens when `record` mode cannot reach the real API? The system should return an error response to the caller and log the connectivity failure, rather than silently failing.
- What happens when multiple recordings match a single request (e.g., same path but different times)? The system should replay the most recently recorded response for that request signature.
- What happens when the spec contains endpoints with path parameters (e.g., `/users/{id}`)? The mock should correctly match requests with any value in the path parameter position.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-M01**: System MUST parse OpenAPI 3.0 and 3.1 specification files in both YAML and JSON formats, fully resolving all `$ref` references including cross-file references.
- **FR-M02**: System MUST automatically generate mock routes for every path/method combination defined in a parsed OpenAPI spec, producing response bodies based on `example` fields when present, or type-appropriate generated values when absent.
- **FR-M03**: System MUST support multi-status-code responses per endpoint, defaulting to the lowest 2xx status code and allowing callers to select alternative status codes via an `X-Mock-Status` request header.
- **FR-M04**: System MUST provide an optional request validation mode (`validate: true`) that checks incoming requests against the OpenAPI spec for correct method, path, request body structure, and parameter types, returning 422 with descriptive error details on validation failure.
- **FR-M05**: System MUST support four mock operating modes: `auto` (generate responses from spec), `record` (proxy to real API and save responses), `replay` (serve from recordings), and `smart` (replay if recording exists, otherwise auto-generate).
- **FR-M06**: System MUST allow manually defined override routes that take precedence over auto-generated routes, supporting the existing mock response capabilities including template variables (e.g., `{{uuid}}`).
- **FR-M07**: System MUST provide an `argus_mock_generate` MCP tool that accepts an OpenAPI spec file path and returns a valid YAML mock configuration snippet covering all spec endpoints.
- **FR-M08**: System MUST provide an `argus_mock_validate` MCP tool that compares the current mock configuration against an OpenAPI spec and reports endpoint coverage (covered vs. missing).
- **FR-M09**: System MUST report clear, actionable error messages when an OpenAPI spec is invalid, missing, contains unresolvable references, or has other parsing failures.
- **FR-M10**: System MUST correctly handle OpenAPI path parameters (e.g., `/users/{id}`) by matching any concrete path segment in that position.
- **FR-M11**: System MUST detect circular `$ref` references and handle them gracefully with bounded nesting depth instead of infinite recursion.
- **FR-M12**: Mock configuration MUST be declarative and defined within the existing `e2e.yaml` configuration file, consistent with the project's configuration-driven architecture.

### Key Entities

- **OpenAPI Spec**: An external specification file (YAML or JSON) conforming to the OpenAPI 3.0 or 3.1 standard. Contains paths, methods, request/response schemas, parameters, and examples. Serves as the source of truth for auto-generated mock routes.
- **Mock Server**: A running HTTP server instance bound to a configured port that serves mock responses. Each mock server is associated with one OpenAPI spec and operates in one of four modes.
- **Mock Route**: A single path/method combination with an associated response. Can be auto-generated from the OpenAPI spec or manually defined as an override. Overrides take precedence.
- **Recording**: A persisted request/response pair captured during `record` mode. Identified by request method, path, and optionally query parameters and body signature. Used for deterministic replay.
- **Override**: A manually defined route entry in the `e2e.yaml` configuration that takes priority over any auto-generated route for the same path/method.
- **Validation Result**: The outcome of checking an incoming request against the OpenAPI spec. Contains pass/fail status and, on failure, a list of specific violations (wrong type, missing field, unknown endpoint, etc.).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from having an OpenAPI spec file to a fully functioning mock server with all endpoints in under 2 minutes of configuration time (adding ~5 lines to `e2e.yaml`).
- **SC-002**: Auto-generated mock responses conform to their OpenAPI schema definitions in 100% of cases (every response passes schema validation against the spec it was generated from).
- **SC-003**: Request validation mode catches 100% of requests that violate the OpenAPI spec (wrong types, missing required fields, unknown endpoints) with descriptive error messages.
- **SC-004**: Switching between mock modes (auto, record, replay, smart) requires changing only a single configuration value — no other configuration changes needed.
- **SC-005**: Manual overrides coexist with auto-generated routes without conflicts — the developer never needs to disable auto-generation to use an override.
- **SC-006**: Record/replay produces deterministic test results — replaying the same recording yields identical responses across runs.
- **SC-007**: The MCP `argus_mock_generate` tool produces a valid, ready-to-use YAML snippet that requires no manual editing for basic usage.
- **SC-008**: The MCP `argus_mock_validate` tool correctly identifies 100% of spec endpoints missing from the mock configuration.

## Assumptions

- OpenAPI specs provided by users are syntactically valid documents conforming to either OpenAPI 3.0 or 3.1. The system validates and reports errors but does not attempt to fix invalid specs.
- The existing mock server infrastructure (defined in `e2e.yaml`) provides a stable foundation that can be extended without breaking backward compatibility with existing manual mock definitions.
- Recording files are stored locally on the file system alongside the project. No remote storage or shared recording repositories are in scope.
- Path matching for recorded interactions uses method + path + sorted query parameters as the request signature. Request body content is not part of the matching key by default.
- The `X-Mock-Status` header is a reserved header name for mock status code selection and will not conflict with headers used by real APIs under test.
- Template variables in overrides (e.g., `{{uuid}}`) follow the existing template engine conventions already present in the mock system.
