# Research: Preflight AI-Native Infrastructure Enhancement

**Date**: 2026-02-25
**Feature Branch**: `002-ai-native`

---

## Decision 1: MCP Server SDK and Transport

**Chosen**: `@modelcontextprotocol/sdk` ^1.11 with `StdioServerTransport`

**Rationale**: The official TypeScript SDK is Tier 1 (highest-quality), maintained by the MCP project itself, currently at v1.11.2. It provides the `McpServer` high-level API which handles JSON-RPC framing, tool registration via Zod schemas, and transport management. Stdio transport is the standard for local tool servers (Cursor, Claude Code both use it). The SDK already depends on Zod, which aligns with our existing Zod usage in `config-loader.ts`.

**Alternatives considered**:
- **Custom JSON-RPC implementation**: Lower-level, more control, but massive maintenance burden. The MCP protocol is evolving and the SDK tracks changes.
- **Streamable HTTP transport**: Good for remote servers, but our primary use case is local AI agent integration. Stdio is simpler, faster, and universally supported by MCP clients.
- **FastMCP (Python)**: Not applicable — project is TypeScript.

**Trade-offs**:
- Pro: Zero protocol implementation effort; Zod integration for tool schemas; progress notifications built-in
- Con: SDK dependency adds ~50KB; tied to SDK's API evolution
- Mitigation: SDK is MIT licensed and well-maintained; our tool handlers are thin wrappers over @preflight/core

---

## Decision 2: Build Log Streaming via MCP

**Chosen**: MCP `notifications/progress` for incremental build log delivery

**Rationale**: MCP protocol supports progress notifications where the server sends `notifications/progress` JSON-RPC messages with a `progressToken` (provided by the client in the request's `_meta`). This allows the build tool to send each log line as a progress update while the build is in progress, and then return the final structured result. This is the standard MCP pattern for long-running operations.

**Alternatives considered**:
- **Return all logs in final response**: Simpler, but the client has no visibility during long Docker builds (can be 2-5 minutes). AI agents may timeout or lose context.
- **SSE transport**: Would allow server-push, but requires the MCP server to run as an HTTP server rather than stdio. Adds complexity and doesn't align with our primary local-first use case.
- **Separate log resource**: MCP resources could expose a log stream, but resources are for read-only data, not real-time streams.

**Trade-offs**:
- Pro: Standard MCP pattern; client gets real-time feedback; build result is a clean structured JSON
- Con: Not all MCP clients may display progress notifications to users (but agents can use them programmatically)

---

## Decision 3: Command Injection Fix — `execFileSync` vs `spawn`

**Chosen**: Replace `execSync(cmd_string)` with `execFileSync('docker', argsArray)` in synchronous paths, and `execFile` (promisified) + `spawn` in async paths

**Rationale**: `execSync` passes commands through a shell, allowing shell metacharacter injection. `execFileSync` and `execFile` bypass the shell entirely — arguments are passed directly to the executable as an argv array. This is the standard Node.js security best practice for subprocess invocation.

**Alternatives considered**:
- **Shell escaping**: Manually escape all user-provided values before interpolation. Error-prone, incomplete (different shells have different metacharacters), and fragile.
- **Docker SDK (dockerode)**: Full Docker API client that avoids shell entirely. However, the constitution notes the project deliberately chose CLI-based Docker interaction for zero native-dependency operation.

**Trade-offs**:
- Pro: Complete elimination of command injection; no shell interpretation overhead; simpler code
- Con: Some existing patterns (e.g., `2>/dev/null || true` in `ensureNetwork`) need refactoring since they rely on shell features
- Mitigation: Replace shell-dependent patterns with try/catch in JavaScript

---

## Decision 4: Async Migration Strategy for yaml-engine

**Chosen**: `util.promisify(execFile)` wrapping `child_process.execFile`

**Rationale**: `execFile` is the async counterpart to `execFileSync` and doesn't use a shell. Combined with `util.promisify`, it returns a Promise. This directly replaces every `execSync` call in `executeFileStep`, `executeProcessStep`, `executePortStep`, and `executeExecStep` with an awaitable async equivalent.

**Alternatives considered**:
- **`child_process.exec` (async)**: Still uses a shell, doesn't fix the command injection vector.
- **`spawn` with stdout collection**: More complex for simple command-and-capture patterns. Better for streaming (already used in `buildImageStreaming`), overkill for short commands.
- **`execa` npm package**: Popular wrapper but adds a dependency. `execFile` + promisify is built-in and sufficient.

**Trade-offs**:
- Pro: Built-in Node.js; shell-free; naturally async; backward-compatible output
- Con: Requires updating all step functions from sync to async (type signature changes)
- Mitigation: Step functions already return `string[]` via `Promise<string[]>` in their callers; making them properly async is a natural evolution

---

## Decision 5: JSON Schema Generation Approach

**Chosen**: `zod-to-json-schema` library to generate schemas from existing Zod definitions

**Rationale**: The project already defines comprehensive Zod schemas in `config-loader.ts` (`E2EConfigSchema`, `TestSuiteSchema`, etc.). Using `zod-to-json-schema` avoids maintaining parallel JSON Schema files. The library handles all Zod types, generates `$ref` for shared definitions, and respects `.describe()` annotations for titles/descriptions.

**Alternatives considered**:
- **Handwritten JSON Schema**: More control over output format, but creates a maintenance burden — every config change requires manual schema updates.
- **TypeScript-to-JSON-Schema (ts-json-schema-generator)**: Works from types, but our Zod schemas already contain validation rules (min/max, patterns) that TypeScript types don't capture.
- **AJV schema builder**: Low-level programmatic schema construction. More code, no advantage over Zod conversion.

**Trade-offs**:
- Pro: Single source of truth (Zod schemas); automatic sync with config changes; zero maintenance of separate schema files
- Con: Need to add `.describe()` annotations to all Zod schema fields (one-time effort); output format controlled by library
- Mitigation: Library supports customization of output format and reference strategy

---

## Decision 6: Retry Engine Architecture

**Chosen**: Dedicated `RetryExecutor` class wrapping individual test case execution within `executeYAMLSuite`

**Rationale**: The retry engine wraps the `executeStep` function call for each test case. It reads `RetryPolicy` from either the test case's `retry` field or the global `tests.retry` config (case-level takes precedence). Each attempt's result is recorded. On success, all attempts are included in the pass event. On exhaustion, auto-diagnostics are collected and attached.

**Alternatives considered**:
- **Retry at the runner level**: Wrapping the entire `TestRunner.run()` would retry entire suites, not individual cases. Too coarse-grained.
- **Retry at the MCP tool level**: The MCP `preflight_run` tool could retry. But retry policy should be declarative in YAML, not an MCP parameter.
- **External retry library (p-retry, async-retry)**: These add dependencies for simple logic. Our backoff calculation is ~10 lines of code.

**Trade-offs**:
- Pro: Fine-grained per-case retry; declarative YAML config; attempt history in reports
- Con: Increases `yaml-engine.ts` complexity; need careful interaction with teardown steps
- Mitigation: RetryExecutor is a separate module, injected into the execution loop

---

## Decision 7: Multi-Service Orchestration Design

**Chosen**: `MultiServiceOrchestrator` class managing a `ServiceDefinition[]` array, with backward-compatible single-service wrapping

**Rationale**: The orchestrator normalizes configuration: if `service` (singular) is present, it wraps it as `services: [service]`. Then it performs parallel build, sequential start (with dependency ordering if configured), parallel health-check wait, and cleanup. All services share a single Docker network.

**Alternatives considered**:
- **Docker Compose integration**: Shell out to `docker compose`. Simpler but introduces Docker Compose as a dependency, loses fine-grained control over health-check reporting and event streaming.
- **Kubernetes/k3s**: Far too heavy for a testing tool.
- **Sequential service handling in existing code**: Simpler but doesn't allow parallel builds or proper cleanup on partial failures.

**Trade-offs**:
- Pro: Full control over lifecycle events; proper error reporting per service; no new binary dependencies
- Con: Reimplements some Docker Compose functionality; complexity in cleanup on partial failures
- Mitigation: Start simple with sequential start; parallel build is straightforward since Docker builds are independent

---

## Decision 8: Playwright Runner Integration

**Chosen**: External process runner using `npx playwright test --reporter=json` with JSON output parsing

**Rationale**: Playwright has a built-in JSON reporter that outputs comprehensive test results. Running Playwright as an external process via `spawn` keeps the Playwright dependency optional (peer dependency). The JSON output is parsed and converted to `TestEvent` objects, maintaining unified reporting.

**Alternatives considered**:
- **Playwright programmatic API (`@playwright/test`)**: Tighter integration, but requires importing Playwright as a direct dependency, significantly increasing package size for users who don't need browser testing.
- **Custom Playwright reporter plugin**: Create a custom reporter that directly emits TestEvents. Elegant but requires the user to configure it in their Playwright config, adding setup friction.
- **Puppeteer instead of Playwright**: Less feature-rich test runner; Playwright is the de facto standard for E2E browser testing.

**Trade-offs**:
- Pro: Playwright stays optional (peer dep); existing Playwright configs work; no version coupling
- Con: JSON output parsing may break if Playwright changes format; extra process overhead
- Mitigation: Pin to Playwright's stable JSON reporter format; version validation in `available()` check

---

## Decision 9: Parallel Suite Execution Strategy

**Chosen**: `Promise.all` with inline concurrency limiter (no external dependency)

**Rationale**: Parallel suites are independent — each has its own test cases, variable context, and execution timeline. A simple concurrency limiter using a semaphore pattern (counter + queue) limits simultaneous suites to `concurrency` (default: all suites). Each suite gets a deep-cloned `VariableContext` to prevent cross-contamination.

**Alternatives considered**:
- **Worker Threads**: True parallelism, but test suites share Docker state (containers, network) and need to emit events to the main thread's reporters. Worker thread serialization adds complexity.
- **`p-limit` npm package**: Clean API, but it's a 3-line function. Not worth the dependency.
- **`Promise.allSettled`**: Used instead of `Promise.all` to ensure all suites complete even if some fail.

**Trade-offs**:
- Pro: Simple; no new dependencies; proper isolation via cloned context; correct event attribution
- Con: I/O-bound parallelism only (single event loop); port conflicts between suites possible
- Mitigation: Port conflict detection/isolation is documented as an edge case; suites should use different ports or use container-internal ports

---

## Decision 10: isPortInUse Rewrite

**Chosen**: Promise-based `net.createServer().listen()` with `EADDRINUSE` detection

**Rationale**: The current implementation is fundamentally broken — it creates a server, registers an error handler, then calls a child process instead of using the server, and finally closes the never-opened server. The correct approach is simple: try to bind a server to the port. If it fails with `EADDRINUSE`, the port is in use. If it succeeds, close the server and report the port as free.

**Implementation**:
```typescript
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false));
    });
  });
}
```

Note: This changes the return type from `boolean` (sync) to `Promise<boolean>` (async). All callers must be updated to `await`. This is consistent with the async migration goal.

**Alternatives considered**:
- **`lsof` fallback**: Platform-specific (not available on Alpine/Windows), requires shell, slower.
- **`net.connect()` attempt**: Checks if something is listening, not just if port is bound. Different semantics — a bound-but-not-listening port would be missed.

---

## Decision 11: MCP Session State Management

**Chosen**: In-memory `Map<string, ProjectSession>` keyed by project path

**Rationale**: The MCP server needs to track state between tool calls (loaded config, running containers, mock server instances). A simple in-memory map keyed by absolute project path allows multiple projects to be managed. Session is created on `preflight_init` and cleaned on `preflight_clean`.

**Alternatives considered**:
- **File-based state**: Persist to `~/.preflight/sessions/`. Survives restarts but adds complexity for a tool that should be stateless between runs.
- **Single global session**: Simpler but prevents managing multiple projects simultaneously.

**Trade-offs**:
- Pro: Simple; no disk I/O; supports multi-project; natural lifecycle
- Con: State lost on server restart; concurrent `preflight_clean` on same project needs locking
- Mitigation: Each tool call validates session state and returns clear error if prerequisites not met

---

## Decision 12: DiagnosticCollector Architecture

**Chosen**: Standalone `DiagnosticCollector` class that accepts container names and mock endpoints, returns `DiagnosticReport`

**Rationale**: Diagnostics collection is used by both the retry engine (on final failure) and the MCP result formatter. Separating it into its own module with a clear interface makes it testable and reusable. The collector makes async calls to Docker CLI and mock server HTTP endpoints.

**Implementation approach**:
- `collectContainerDiagnostics(containerName)`: calls `getContainerLogs(name, 50)` + `getContainerStatus(name)`
- `collectMockDiagnostics(mockEndpoints)`: calls `GET /_mock/requests` on each mock endpoint
- `collectNetworkDiagnostics(networkName)`: calls `docker network inspect`
- `collect(options)`: aggregates all above into a single `DiagnosticReport`

**Trade-offs**:
- Pro: Composable; testable with mocked Docker/HTTP calls; async throughout
- Con: Multiple HTTP/Docker calls on each failure can add latency (~1-2s)
- Mitigation: Parallel collection via `Promise.allSettled`; timeout limits on each call
