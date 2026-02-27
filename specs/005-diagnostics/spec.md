# Feature Specification: Intelligent Diagnostics & Suggestions

**Feature Branch**: `005-diagnostics`  
**Created**: 2026-02-26  
**Status**: Draft  
**Input**: User description: "智能诊断建议（AI 学习能力）— 建立失败模式知识库，自动分类失败、匹配历史修复方案、修复反馈闭环"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Failure Classification (Priority: P1)

An AI Agent triggers a test run and one or more test cases fail. The system automatically analyzes each failure event and classifies it into a well-defined failure category (e.g., CONNECTION_REFUSED, TIMEOUT, HTTP_ERROR). The Agent receives a structured classification alongside the failure details, enabling it to immediately understand the *type* of problem without manual log inspection.

**Why this priority**: Classification is the foundation of all downstream diagnostics. Without accurate categorization, pattern matching and fix suggestions cannot function. This delivers immediate value by replacing ad-hoc log parsing with structured, consistent failure taxonomy.

**Independent Test**: Can be fully tested by triggering known failure types (e.g., stopping a service to cause CONNECTION_REFUSED) and verifying the system assigns the correct category. Delivers value even without a knowledge base — structured classification alone reduces Agent reasoning time.

**Acceptance Scenarios**:

1. **Given** a test case fails with `ECONNREFUSED` in the error output, **When** the system processes the failure event, **Then** it classifies the failure as `CONNECTION_REFUSED`.
2. **Given** a test case fails with an HTTP 500 response, **When** the system processes the failure event, **Then** it classifies the failure as `HTTP_ERROR`.
3. **Given** a test case fails with `OOMKilled = true` in container status, **When** the system processes the failure event, **Then** it classifies the failure as `CONTAINER_OOM`.
4. **Given** a test case fails with an error message that does not match any known rule, **When** the system processes the failure event, **Then** it classifies the failure as `UNKNOWN`.
5. **Given** a failure event contains multiple error indicators (e.g., timeout AND connection refused), **When** the system processes the failure event, **Then** it classifies using the most specific matching rule (the first rule in the chain that matches).

---

### User Story 2 - Historical Fix Suggestions (Priority: P1)

An AI Agent encounters a classified failure. The system generates a unique signature for the failure and looks up the knowledge base for matching historical patterns. If a match is found, the system returns the suggested fix along with a confidence score and historical fix records. The Agent can then attempt the suggested fix instead of reasoning from scratch.

**Why this priority**: This is the core value proposition — turning a "stateless" diagnostic system into one that learns from history. Matching failures to known patterns and returning proven fixes dramatically reduces resolution time and prevents repeated mistakes.

**Independent Test**: Can be tested by pre-loading the knowledge base with built-in patterns, triggering a matching failure, and verifying the system returns the correct suggested fix and confidence score. Delivers value immediately with built-in patterns before any learning occurs.

**Acceptance Scenarios**:

1. **Given** a failure classified as `CONNECTION_REFUSED` with signature matching built-in pattern `ECONNREFUSED *:*`, **When** the system queries the knowledge base, **Then** it returns the suggested fix "服务可能未完全启动，尝试增加 healthcheck.startPeriod" with confidence ≥ 0.5.
2. **Given** a failure with a signature that has been seen 5 times before with 4 successful resolutions, **When** the system queries the knowledge base, **Then** it returns the pattern with a confidence reflecting the 80% resolution rate.
3. **Given** a failure with a signature that has never been seen before, **When** the system queries the knowledge base, **Then** it returns no match and creates a new pattern entry for future reference.
4. **Given** an error message `"POST /api/games returned 500"`, **When** the system generates the failure signature, **Then** dynamic parts are normalized (e.g., specific paths become wildcards, specific status codes become class-level patterns like `5xx`).

---

### User Story 3 - Fix Feedback Loop (Priority: P2)

After the AI Agent successfully fixes a failure and the re-run passes, the Agent reports the fix back to the system. The system matches the fix report to the original failure pattern and updates the knowledge base: incrementing the resolution count, adjusting confidence, and archiving the fix details. Over time, this continuous feedback improves the quality and accuracy of future suggestions.

**Why this priority**: The feedback loop is what transforms the knowledge base from a static reference into a self-improving system. While the system delivers value with built-in patterns alone (P1 stories), the feedback loop ensures it grows smarter with every resolved failure.

**Independent Test**: Can be tested by reporting a fix for a known failure pattern and verifying the pattern's resolution count, confidence, and fix history are updated correctly. Delivers value by enabling the system to track which fixes actually work.

**Acceptance Scenarios**:

1. **Given** a pattern with `occurrences: 3` and `resolutions: 1`, **When** the Agent reports a successful fix for a matching failure, **Then** the pattern's `resolutions` increments to 2 and `confidence` is recalculated upward.
2. **Given** a failure that matched an existing pattern, **When** the Agent reports a fix with a description, **Then** a new entry is appended to the pattern's `fixHistory` with the run ID, fix description, success status, and timestamp.
3. **Given** an `UNKNOWN` failure that was never seen before, **When** the Agent reports a fix for it, **Then** a new pattern is created in the knowledge base with the failure's signature, and the fix is recorded in its history.

---

### User Story 4 - MCP Tool: Diagnose Failure (Priority: P1)

An AI Agent calls the `argus_diagnose` tool with a specific failure's run ID and case name. The system performs the full diagnostic workflow: classifies the failure, generates a signature, matches against the knowledge base, and returns a structured response containing the category, matching pattern (if any), suggested fix, confidence score, and relevant fix history.

**Why this priority**: This is the primary interface through which Agents interact with the diagnostics system. Without this tool, the classification and knowledge base capabilities are inaccessible to Agents.

**Independent Test**: Can be tested by invoking `argus_diagnose` for a failed test case and verifying the response contains all expected fields (category, signature, pattern match, suggestion, confidence).

**Acceptance Scenarios**:

1. **Given** a test run with a failed case that matches a known pattern, **When** the Agent calls `argus_diagnose` with the run ID and case name, **Then** the response includes the failure category, matching pattern ID, suggested fix text, confidence score, and fix history entries.
2. **Given** a test run with a failed case that matches no known pattern, **When** the Agent calls `argus_diagnose`, **Then** the response includes the failure category, the generated signature, and a note indicating no historical match was found (a new pattern is created automatically).
3. **Given** a run ID or case name that does not exist, **When** the Agent calls `argus_diagnose`, **Then** the system returns a clear error message.

---

### User Story 5 - MCP Tool: Report Fix (Priority: P2)

An AI Agent calls the `argus_report_fix` tool after successfully fixing a failure and verifying the fix via a re-run. The system records the fix, updates the corresponding failure pattern, and confirms the update.

**Why this priority**: Enables the feedback loop (User Story 3). Without this tool, Agents cannot contribute fixes back to the knowledge base.

**Independent Test**: Can be tested by calling `argus_report_fix` with valid parameters and verifying the knowledge base is updated.

**Acceptance Scenarios**:

1. **Given** a previously diagnosed failure with a known pattern, **When** the Agent calls `argus_report_fix` with the run ID, case name, and fix description, **Then** the system updates the pattern and returns a confirmation with the updated confidence.
2. **Given** a fix report for a failure that has no existing pattern, **When** the Agent calls `argus_report_fix`, **Then** the system creates a new pattern and records the fix in its history.

---

### User Story 6 - MCP Tool: Browse Knowledge Base (Priority: P3)

An AI Agent or a human operator calls `argus_patterns` to browse all failure patterns in the knowledge base. The system returns a list of all patterns with their categories, signature patterns, occurrence and resolution counts, confidence scores, and last-seen timestamps. This enables understanding of the system's current diagnostic coverage and identifying areas that need attention.

**Why this priority**: This is an observability and management tool. While not critical for the core diagnostic workflow, it provides valuable transparency into what the system has learned and helps operators audit and curate the knowledge base.

**Independent Test**: Can be tested by calling `argus_patterns` and verifying it returns the full set of patterns including built-in ones.

**Acceptance Scenarios**:

1. **Given** a knowledge base with 6 built-in patterns and 2 learned patterns, **When** the Agent calls `argus_patterns`, **Then** all 8 patterns are returned with complete metadata.
2. **Given** a filter parameter for a specific category (e.g., `TIMEOUT`), **When** the Agent calls `argus_patterns` with the filter, **Then** only patterns matching that category are returned.

---

### Edge Cases

- What happens when the same failure matches multiple classification rules? The system uses the first matching rule in the ordered chain, ensuring deterministic classification.
- What happens when the knowledge base storage is unavailable or corrupted? The system falls back to classification-only mode (returns category but no historical matches), and logs the storage error.
- What happens when a failure signature collides (two different failures produce the same hash)? The system uses category + case name + error pattern as the hash input, minimizing collision risk. If collisions occur, the pattern accumulates mixed fix history, which operators can review via `argus_patterns`.
- How does the system handle concurrent fix reports for the same pattern? Updates to occurrence/resolution counts and fix history are serialized through the persistence layer to prevent data races.
- What happens when error messages contain only dynamic content (e.g., pure UUIDs or timestamps)? The normalization step strips recognized dynamic patterns; if the entire message is dynamic, the signature relies on category + case name, producing a less specific but still useful pattern.
- What happens when the built-in knowledge base conflicts with a learned pattern for the same signature? Built-in patterns serve as defaults; learned patterns with higher resolution counts take precedence when suggesting fixes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically classify each test failure into exactly one of the defined failure categories: `ASSERTION_MISMATCH`, `HTTP_ERROR`, `TIMEOUT`, `CONNECTION_REFUSED`, `CONTAINER_OOM`, `CONTAINER_CRASH`, `MOCK_MISMATCH`, `CONFIG_ERROR`, `NETWORK_ERROR`, or `UNKNOWN`.
- **FR-002**: Classification MUST be performed by an ordered chain of rules, where each rule checks for specific conditions in the failure event. The first matching rule determines the category.
- **FR-003**: The classification rule chain MUST be extensible — new rules can be added without modifying existing ones.
- **FR-004**: System MUST generate a deterministic failure signature by combining the category, case name, and a normalized error pattern (with dynamic parts like timestamps, UUIDs, specific IDs, and port numbers replaced by wildcards).
- **FR-005**: System MUST maintain a knowledge base of failure patterns, each containing: unique pattern ID, category, signature pattern, human-readable description, suggested fix text, confidence score (0–1), occurrence count, resolution count, timestamps, and fix history.
- **FR-006**: System MUST ship with a set of built-in failure patterns covering the most common failure scenarios (at minimum: CONNECTION_REFUSED, TIMEOUT, CONTAINER_OOM, HTTP_ERROR, MOCK_MISMATCH, ASSERTION_MISMATCH).
- **FR-007**: When a failure occurs, the system MUST attempt to match its signature against existing patterns in the knowledge base and return the best match (if any) along with the suggested fix and confidence.
- **FR-008**: When a failure's signature does not match any existing pattern, the system MUST automatically create a new pattern entry in the knowledge base for future matching.
- **FR-009**: When the Agent reports a successful fix, the system MUST update the corresponding pattern's resolution count, recalculate confidence, and append the fix details to the pattern's fix history.
- **FR-010**: System MUST expose an `argus_diagnose` tool that accepts a run ID and case name, performs the full diagnostic workflow (classify → sign → match → suggest), and returns a structured result.
- **FR-011**: System MUST expose an `argus_report_fix` tool that accepts a run ID, case name, and fix description, and updates the knowledge base accordingly.
- **FR-012**: System MUST expose an `argus_patterns` tool that returns all failure patterns in the knowledge base, with optional filtering by category.
- **FR-013**: Knowledge base data MUST be persisted across system restarts using the existing persistence layer.
- **FR-014**: The diagnostic result returned by `argus_diagnose` MUST include: failure category, generated signature, matching pattern (if any), suggested fix text, confidence score, and relevant fix history entries.
- **FR-015**: Error normalization MUST handle at minimum: HTTP paths (specific segments → wildcards), HTTP status codes (specific → class-level like `5xx`), IP addresses and ports (specific → wildcards), timestamps, and UUIDs.

### Key Entities

- **FailureCategory**: An enumeration of the 10 defined failure types (ASSERTION_MISMATCH through UNKNOWN). Represents the high-level classification of what went wrong.
- **FailureSignature**: A deterministic hash derived from category + case name + normalized error pattern. Used as the lookup key for pattern matching.
- **FailurePattern**: The core knowledge entity. Represents a known type of failure, including its signature pattern, suggested fix, confidence score, occurrence/resolution statistics, and historical fix records. Patterns can be built-in (shipped with the system) or learned (created from new failures).
- **FixRecord**: A historical entry within a FailurePattern, documenting a specific fix attempt — including which run it was for, what the fix was, whether it succeeded, and when it occurred.
- **DiagnosticResult**: The output of the diagnostic workflow. Bundles together the classification, signature, matched pattern (if any), suggested fix, confidence, and fix history for a given failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The knowledge base covers at least 80% of commonly encountered failure scenarios through built-in and learned patterns, measured as the percentage of failures that match a known pattern after 30 days of usage.
- **SC-002**: When a failure matches a known pattern, the system returns a suggested fix within the same response — eliminating the need for the Agent to reason from scratch. Target: 100% of matched failures include a suggested fix.
- **SC-003**: After the Agent reports a successful fix, the corresponding pattern's confidence and fix history are updated within the same operation — ensuring the knowledge base stays current with zero manual curation for routine fixes.
- **SC-004**: Diagnostic accuracy (the probability that a matched pattern's suggested fix is relevant to the actual problem) exceeds 70%, measured as the ratio of successful resolutions to total occurrences across all patterns.
- **SC-005**: Previously unknown failures are automatically captured as new patterns, so that the second occurrence of any failure type can benefit from the first occurrence's fix — measured as 100% of new failure signatures resulting in a new pattern entry.
- **SC-006**: The full diagnostic workflow (classify → sign → match → suggest) completes within 2 seconds for any single failure, ensuring it does not become a bottleneck in the Agent's repair loop.
- **SC-007**: All 6 built-in patterns are available immediately upon system initialization, without requiring any prior failure history.
