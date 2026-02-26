# argusai-mcp

## 0.2.0

### Minor Changes

- feat: add Error Recovery & Self-Healing resilience subsystem

  - 7 resilience modules: error-codes, preflight, container-guardian, port-resolver, orphan-cleaner, circuit-breaker, network-verifier
  - 13 structured error codes for AI-parseable diagnostics
  - 2 new MCP tools: argus_preflight_check, argus_reset_circuit (9→11 tools)
  - Resilience config section in e2e.yaml schema
  - 141 unit tests across 15 test files

### Patch Changes

- Updated dependencies
  - argusai-core@0.2.0
