# Implementation Plan: Intelligent Diagnostics & Suggestions

**Branch**: `005-diagnostics` | **Date**: 2026-02-26 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/005-diagnostics/spec.md`

## Summary

Build an intelligent diagnostics subsystem that automatically classifies test failures into structured categories, matches them against a knowledge base of historical failure patterns, suggests proven fixes with confidence scores, and learns from Agent-reported fix outcomes. The system exposes three new MCP tools (`argus_diagnose`, `argus_report_fix`, `argus_patterns`) and persists its knowledge base in the existing SQLite database alongside test history data.

**Technical approach**: Chain of Responsibility classification → regex-based error normalization → SHA-256 signature hashing → SQLite knowledge base lookup → Laplace-smoothed confidence scoring → feedback loop via fix reporting.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, ESM)  
**Primary Dependencies**: better-sqlite3 (existing), zod (existing), @modelcontextprotocol/sdk (existing), node:crypto (stdlib)  
**Storage**: SQLite via better-sqlite3 — new `failure_patterns` and `fix_history` tables in existing history.db  
**Testing**: Vitest — 90%+ coverage target (core module per constitution)  
**Target Platform**: Node.js 20+ (Linux/macOS)  
**Project Type**: Monorepo (pnpm workspaces: core, cli, mcp, dashboard)  
**Performance Goals**: <2 seconds per diagnostic workflow (SC-006); expected <50ms  
**Constraints**: No `any` types, no new external dependencies, zero external API calls  
**Scale/Scope**: ~15 classification rules, 6+ built-in patterns, hundreds of learned patterns over time

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Gate (Phase 0)

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 1 | Configuration-Driven | PASS | Knowledge base uses existing history config; no new YAML keys required |
| 2 | Language-Agnostic | N/A | Diagnostics operate on test results, not test language |
| 3 | Zero-Intrusion | PASS | No service code changes; diagnostics analyze failure events post-hoc |
| 4 | TypeScript Strict Mode | PASS | All new code: strict mode, ESM, no `any`, explicit types |
| 5 | Test Coverage 80%+ | PASS | Core module target: 90%+ (classifier, normalizer, knowledge-store) |
| 6 | Single Entry CLI | N/A | Feature is MCP-tool-only; no new CLI subcommands |
| 7 | SSE Real-Time | N/A | Diagnostics are synchronous request/response, not long-running |
| 8 | Extensible Architecture | PASS | ClassificationRule interface allows plugging new rules |
| 9 | Web Framework: Fastify | N/A | No new HTTP endpoints; MCP tools only |
| 10 | Node.js 20+ | PASS | Uses native `crypto.createHash` for SHA-256 |

**Gate Result**: PASS — No violations.

### Post-Design Gate (Phase 2)

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 1 | Configuration-Driven | PASS | Reuses `history.enabled` and `history.storage` from existing config |
| 2 | Language-Agnostic | N/A | — |
| 3 | Zero-Intrusion | PASS | — |
| 4 | TypeScript Strict Mode | PASS | All interfaces defined; FailureCategory is string literal union |
| 5 | Test Coverage | PLAN | 90%+ for: classifier.ts, normalizer.ts, knowledge-store.ts, diagnostics-engine.ts |
| 6 | Single Entry CLI | N/A | — |
| 7 | SSE Real-Time | N/A | — |
| 8 | Extensible Architecture | PASS | Rule chain extensible; KnowledgeStore interface enables alternate implementations |
| 9 | Web Framework: Fastify | N/A | — |
| 10 | Node.js 20+ | PASS | — |

**Gate Result**: PASS — No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/005-diagnostics/
├── plan.md                            # This file
├── spec.md                            # Feature specification
├── research.md                        # Technical decisions & rationale
├── data-model.md                      # Entity definitions, SQLite schema, TypeScript interfaces
├── quickstart.md                      # Setup, usage examples, integration scenarios
├── contracts/
│   ├── argus_diagnose.md              # MCP tool contract: diagnose failure
│   ├── argus_report_fix.md            # MCP tool contract: report fix
│   └── argus_patterns.md              # MCP tool contract: browse knowledge base
└── tasks.md                           # (Phase 2 — /speckit.tasks output)
```

### Source Code (repository root)

```text
packages/core/src/
├── knowledge/                          # NEW — Diagnostics & Knowledge Base
│   ├── index.ts                        # Public API re-exports
│   ├── types.ts                        # FailureCategory, FailureEvent, FailurePattern, FixRecord,
│   │                                   #   DiagnosticResult, ClassificationRule, KnowledgeStore
│   ├── classifier.ts                   # FailureClassifier — rule chain implementation
│   ├── normalizer.ts                   # Error normalization pipeline + signature generation
│   ├── knowledge-store.ts              # SQLiteKnowledgeStore + NoopKnowledgeStore
│   ├── built-in-patterns.ts            # 6 seed patterns (CONNECTION_REFUSED, TIMEOUT, etc.)
│   └── diagnostics-engine.ts           # DiagnosticsEngine — orchestrates classify → sign → match → suggest
├── history/
│   └── migrations.ts                   # MODIFIED — Add migration version 2 (knowledge base tables)
├── diagnostics.ts                      # EXISTING — DiagnosticCollector (unchanged, complementary)
├── types.ts                            # EXISTING — Re-export knowledge types
└── index.ts                            # MODIFIED — Re-export knowledge/ module

packages/mcp/src/
├── tools/
│   ├── diagnose.ts                     # NEW — argus_diagnose handler
│   ├── report-fix.ts                   # NEW — argus_report_fix handler
│   └── patterns.ts                     # NEW — argus_patterns handler
├── server.ts                           # MODIFIED — Register 3 new tools (tools 16-18)
└── session.ts                          # MODIFIED — Add knowledgeStore to Session interface

packages/core/tests/unit/
└── knowledge/                          # NEW — Unit tests
    ├── classifier.test.ts              # Classification rule chain tests
    ├── normalizer.test.ts              # Error normalization + signature tests
    ├── knowledge-store.test.ts         # SQLiteKnowledgeStore CRUD tests
    ├── built-in-patterns.test.ts       # Seed data validation tests
    └── diagnostics-engine.test.ts      # Full workflow integration tests
```

**Structure Decision**: Follows existing monorepo pattern. New `knowledge/` directory mirrors `history/` and `resilience/` conventions. No new packages needed — all code lives in `packages/core` (logic) and `packages/mcp` (tool registration).

## Key Design Decisions

| Decision | Choice | Rationale | See |
|----------|--------|-----------|-----|
| Classification approach | Chain of Responsibility (ordered rule array) | Simple, deterministic, extensible; first match wins | research.md §1 |
| Error normalization | Regex pipeline (8 ordered replacements) | Deterministic, zero deps, independently testable | research.md §2 |
| Signature algorithm | SHA-256 of `category::caseName::normalizedError` | Node.js stdlib, fixed-length, negligible collision risk | research.md §3 |
| Knowledge storage | New tables in existing SQLite DB | Reuses infrastructure, atomic transactions, migration system | research.md §4 |
| Confidence formula | Laplace smoothing: `(resolutions+1)/(occurrences+2)` | Handles zero-data gracefully, avoids overconfidence | research.md §5 |
| Module structure | `packages/core/src/knowledge/` directory | Matches codebase convention (history/, resilience/) | research.md §6 |
| Built-in patterns | 6 patterns seeded via migration | Covers FR-006 minimum; immediately available on init | research.md §7 |
| Graceful degradation | Classification-only fallback | Returns category even when DB unavailable | research.md §8 |

## Dependencies & Integration Points

### Existing Code Touched

| File | Change | Risk |
|------|--------|------|
| `history/migrations.ts` | Add migration version 2 | Low — additive, existing migrations unaffected |
| `core/index.ts` | Add `export * from './knowledge/index.js'` | Low — additive only |
| `core/types.ts` | Re-export knowledge types | Low — additive only |
| `mcp/server.ts` | Register 3 new tools | Low — follows exact pattern of existing 15 tools |
| `mcp/session.ts` | Add `knowledgeStore` to Session | Medium — must handle missing store gracefully |

### Dependencies (all existing, no new installs)

| Package | Usage | Version |
|---------|-------|---------|
| `better-sqlite3` | Knowledge base persistence | Existing in core |
| `zod` | Input validation for MCP tools | Existing in mcp |
| `node:crypto` | SHA-256 signature hashing | Node.js stdlib |

## Complexity Tracking

> No constitution violations — this section is empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
