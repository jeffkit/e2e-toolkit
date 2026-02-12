# Feature Specification: E2E Testing Toolkit

**Feature Branch**: `001-e2e-toolkit`  
**Created**: 2026-02-12  
**Status**: Draft  
**Input**: User description: "将现有的 as-mate/e2e 测试系统重构为一个独立的、通用的 Docker E2E Testing Toolkit"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 新项目快速接入 (Priority: P1)

开发者有一个 Docker 化的服务，希望快速建立 E2E 测试环境，无需编写代码，只需配置 YAML 文件即可开始测试。

**Why this priority**: 这是工具的核心价值主张 - 零代码配置驱动的测试能力。如果开发者无法快速接入，工具就失去了通用性。这是 MVP 必须支持的核心场景。

**Independent Test**: 可以通过以下步骤独立验证：
1. 在一个新的 Docker 化项目目录中运行 `e2e-toolkit init`
2. 编辑生成的 `e2e.yaml` 模板，填写服务的基本信息（Dockerfile 路径、端口等）
3. 编写 1-2 个简单的 YAML 测试用例（如健康检查）
4. 运行 `e2e-toolkit setup` 完成环境初始化
5. 运行 `e2e-toolkit run` 成功执行测试

**Acceptance Scenarios**:

1. **Given** 开发者有一个包含 Dockerfile 的项目目录, **When** 运行 `e2e-toolkit init`, **Then** 系统生成 `e2e.yaml` 配置文件模板，包含所有必要的配置节（project, tests, mocks）
2. **Given** 开发者已编辑 `e2e.yaml` 配置了服务信息, **When** 运行 `e2e-toolkit setup`, **Then** 系统检查依赖、构建 Docker 镜像、启动容器、验证健康状态，整个过程通过 SSE 实时反馈进度
3. **Given** 开发者已编写 YAML 测试用例, **When** 运行 `e2e-toolkit run`, **Then** 系统执行测试并输出结果，支持 `--suite` 参数过滤特定测试套件
4. **Given** 开发者配置了 Mock 服务路由, **When** 运行 `e2e-toolkit setup`, **Then** 系统自动生成并启动 Mock 服务容器，提供 `/_mock/health` 等管理接口

---

### User Story 2 - 日常开发测试工作流 (Priority: P1)

开发者在日常开发中修改了代码，需要快速验证功能是否正常。通过 Dashboard 可视化界面或 CLI 命令快速重新构建、测试和调试。

**Why this priority**: 这是工具的高频使用场景。开发者每天都会多次使用这个工作流，必须流畅高效。Dashboard 的可视化能力是提升开发体验的关键。

**Independent Test**: 可以通过以下步骤独立验证：
1. 修改服务代码后运行 `e2e-toolkit build` 重新构建镜像
2. 通过 `e2e-toolkit dashboard` 打开 Dashboard
3. 在 Dashboard 的"镜像构建"页面查看构建日志（SSE 实时流）
4. 在"容器管理"页面重启容器
5. 在"API 调试"页面手动测试 API
6. 在"测试套件"页面运行特定测试并查看结果

**Acceptance Scenarios**:

1. **Given** 开发者修改了服务代码, **When** 运行 `e2e-toolkit build`, **Then** 系统重新构建 Docker 镜像，通过 SSE 实时输出构建日志，支持 `--no-cache` 选项强制重新构建
2. **Given** Dashboard 已启动, **When** 访问镜像构建页面并点击"开始构建", **Then** 页面通过 SSE 实时显示构建进度和日志，支持分支选择、构建参数配置
3. **Given** 容器正在运行, **When** 在 Dashboard 容器管理页面点击"重启", **Then** 容器重启，页面实时显示容器状态、日志流、进程列表
4. **Given** 容器已启动, **When** 在 Dashboard API 调试页面发送请求, **Then** 请求被代理到容器，响应实时显示，支持自定义请求头、请求体
5. **Given** 测试套件已定义, **When** 在 Dashboard 测试套件页面选择并运行测试, **Then** 测试执行，实时显示测试事件流（start/step/assert/complete），支持查看历史记录

---

### User Story 3 - CI 流水线集成 (Priority: P2)

在 CI/CD 流水线中自动运行 E2E 测试，支持无头模式、JSON 报告输出、资源清理。

**Why this priority**: CI 集成是生产环境质量保证的关键环节，但不是 MVP 的核心。可以在 P1 功能稳定后再完善。支持 CI 模式可以确保工具在生产环境可用。

**Independent Test**: 可以通过以下步骤独立验证：
1. 在 CI 脚本中运行 `e2e-toolkit setup --skip-dashboard`
2. 运行 `e2e-toolkit run --ci --reporter json > test-results.json`
3. 验证 JSON 报告包含所有测试结果、执行时间、断言详情
4. 运行 `e2e-toolkit clean` 清理所有资源
5. 验证退出码正确（成功 0，失败非 0）

**Acceptance Scenarios**:

1. **Given** CI 环境已安装 Docker 和 Node.js, **When** 运行 `e2e-toolkit setup --skip-dashboard`, **Then** 系统完成环境初始化但不启动 Dashboard，所有操作通过 CLI 完成
2. **Given** 测试环境已就绪, **When** 运行 `e2e-toolkit run --ci --reporter json`, **Then** 系统执行所有测试，输出 JSON 格式报告到 stdout，包含每个测试的状态、耗时、错误信息
3. **Given** 测试执行完成（无论成功或失败）, **When** 运行 `e2e-toolkit clean`, **Then** 系统清理所有容器、网络、卷，退出码为 0
4. **Given** 测试执行失败, **When** CI 脚本检查退出码, **Then** `e2e-toolkit run` 返回非 0 退出码，CI 流水线正确识别失败

---

### User Story 4 - YAML 声明式测试编写 (Priority: P1)

开发者使用 YAML 格式编写测试用例，支持变量替换、断言 DSL、步骤编排、Mock 服务集成。

**Why this priority**: YAML 声明式测试是工具的核心能力，是零代码配置的关键。如果 YAML 测试引擎不完善，开发者就无法充分利用工具。

**Independent Test**: 可以通过以下步骤独立验证：
1. 编写一个包含多个步骤的 YAML 测试用例（HTTP 请求、变量保存、断言）
2. 使用变量替换（{{timestamp}}, {{uuid}}, {{env.XX}}）
3. 使用各种断言类型（status, headers, body 的 type/exists/in/contains/matches）
4. 运行测试验证所有功能正常工作

**Acceptance Scenarios**:

1. **Given** 开发者编写了 YAML 测试用例, **When** 测试步骤中使用 `{{timestamp}}` 变量, **Then** 系统在运行时替换为当前时间戳（毫秒）
2. **Given** 测试步骤中使用了 `save` 保存响应字段到变量, **When** 后续步骤引用该变量, **Then** 系统正确替换变量值
3. **Given** 测试步骤中使用了 `expect` 断言, **When** 断言类型为 `contains` 或 `matches`, **Then** 系统正确执行断言，失败时输出详细的错误信息（期望值 vs 实际值）
4. **Given** 测试用例包含 `setup` 和 `teardown` 步骤, **When** 运行测试, **Then** setup 在测试前执行，teardown 在测试后执行（无论测试成功或失败）
5. **Given** 测试步骤中使用了 `delay` 延迟, **When** 运行测试, **Then** 系统在步骤间等待指定时间（秒）

---

### User Story 5 - 多语言测试运行器支持 (Priority: P2)

开发者可以使用不同的测试框架（Vitest、Pytest、Shell、Exec）编写测试，所有测试通过统一的 TestEvent 接口输出结果。

**Why this priority**: 语言无关性是工具通用性的体现，但不是 MVP 的核心。可以先支持 YAML + Vitest，其他运行器后续扩展。

**Independent Test**: 可以通过以下步骤独立验证：
1. 编写一个 Vitest 测试文件（.test.ts）
2. 在 `e2e.yaml` 中配置 Vitest 运行器
3. 运行 `e2e-toolkit run --suite vitest-suite`
4. 验证测试执行，TestEvent 正确输出到 Dashboard/CLI

**Acceptance Scenarios**:

1. **Given** 开发者编写了 Vitest 测试文件, **When** 在 `e2e.yaml` 中配置 `type: vitest`, **Then** 系统调用 `npx vitest run` 执行测试，捕获输出并转换为 TestEvent
2. **Given** 开发者编写了 Pytest 测试文件, **When** 在 `e2e.yaml` 中配置 `type: pytest`, **Then** 系统调用 `pytest` 执行测试，解析输出并转换为 TestEvent
3. **Given** 开发者编写了 Shell 脚本测试, **When** 在 `e2e.yaml` 中配置 `type: shell`, **Then** 系统执行 bash 脚本，捕获退出码和输出，转换为 TestEvent
4. **Given** 所有测试运行器执行完成, **When** 查看 Dashboard 或 CLI 输出, **Then** 所有测试事件通过统一的 TestEvent 格式呈现，包含 type/timestamp/testId/data 字段

---

### Edge Cases

- **Docker 镜像构建失败**: 当 Dockerfile 有语法错误或依赖无法下载时，系统应输出清晰的错误信息，指出失败的具体步骤和原因
- **容器启动超时**: 当容器健康检查超时（超过配置的最大等待时间），系统应报告超时错误，提供容器日志帮助诊断
- **端口冲突**: 当配置的端口已被占用，系统应检测冲突并提示用户修改配置或停止占用端口的进程
- **测试执行中断**: 当用户中断测试执行（Ctrl+C），系统应优雅清理已启动的容器，不留下孤儿进程
- **Mock 服务路由冲突**: 当多个 Mock 路由匹配同一请求时，系统应使用第一个匹配的路由，并记录警告日志
- **变量未定义**: 当测试步骤引用了未定义的变量（如 `{{undefined_var}}`），系统应报告错误，指出变量名和位置
- **断言失败**: 当断言失败时，系统应输出详细的对比信息（期望值 vs 实际值），帮助快速定位问题
- **网络隔离**: 当容器无法访问外部网络时，系统应检测网络问题，提供诊断建议（检查 Docker 网络配置）
- **磁盘空间不足**: 当 Docker 构建或运行需要大量磁盘空间时，系统应检测可用空间，提前警告用户
- **并发测试执行**: 当多个测试套件同时运行时，系统应确保容器隔离，避免测试间相互影响

## Requirements *(mandatory)*

### Functional Requirements

#### F1: 配置文件 (`e2e.yaml`)

- **FR-001**: System MUST support `e2e.yaml` as the primary configuration file, located in project root directory
- **FR-002**: System MUST allow users to declare Docker build configuration (Dockerfile path, build args, context, no-cache option)
- **FR-003**: System MUST allow users to declare Docker run configuration (ports, environment variables, volumes, health check, network)
- **FR-004**: System MUST allow users to declare Mock services (routes, responses, conditions, delays) in YAML format
- **FR-005**: System MUST allow users to declare test suites (name, type, path, runner-specific options)
- **FR-006**: System MUST support variable replacement in configuration: `{{timestamp}}`, `{{uuid}}`, `{{env.VAR_NAME}}`, `{{custom_var}}`
- **FR-007**: System MUST support loading environment variables from `.env` file (dotenv format)
- **FR-008**: System MUST validate `e2e.yaml` schema on load, reporting errors with line numbers and field names
- **FR-009**: System MUST support YAML anchors and aliases for configuration reuse

#### F2: YAML 声明式测试引擎

- **FR-010**: System MUST support YAML format for defining HTTP test cases (request method, path, headers, body, timeout)
- **FR-011**: System MUST support `expect` assertions for status code, headers, and response body
- **FR-012**: System MUST support assertion DSL: `type` (string/number/boolean/object/array), `exists`, `in`, `gt`/`gte`/`lt`/`lte`, `contains`, `matches` (regex), `length`
- **FR-013**: System MUST support variable extraction from responses using `save` action (JSONPath or dot notation)
- **FR-014**: System MUST support `setup` and `teardown` sections in test cases (executed before/after main steps)
- **FR-015**: System MUST support `delay` action for waiting between steps (milliseconds or seconds)
- **FR-016**: System MUST support `sequential: true` flag to enforce step execution order (disable parallelization)
- **FR-017**: System MUST support built-in variables: `{{timestamp}}` (current time in ms), `{{uuid}}` (v4 UUID), `{{date}}` (ISO 8601 date)
- **FR-018**: System MUST support custom variables defined in test context and passed between steps
- **FR-019**: System MUST report assertion failures with detailed information (expected value, actual value, field path)

#### F3: 多语言测试运行器

- **FR-020**: System MUST support built-in YAML test runner (executes YAML test definitions)
- **FR-021**: System MUST support Vitest runner (calls `npx vitest run` with test file path)
- **FR-022**: System MUST support Pytest runner (calls `pytest` with test file path and options)
- **FR-023**: System MUST support Shell runner (executes bash scripts with `bash -e` for error handling)
- **FR-024**: System MUST support Exec runner (executes arbitrary commands with arguments)
- **FR-025**: System MUST emit unified `TestEvent` interface for all test runners (type, timestamp, testId, data)
- **FR-026**: System MUST support test runner-specific options in `e2e.yaml` (e.g., Vitest config file, Pytest markers)
- **FR-027**: System MUST capture test output (stdout/stderr) and include in TestEvent data
- **FR-028**: System MUST support test timeout configuration per suite (default: 5 minutes)

#### F4: Docker 引擎

- **FR-029**: System MUST support Docker image building with custom Dockerfile path and build context
- **FR-030**: System MUST support Docker build arguments (`--build-arg`) from configuration
- **FR-031**: System MUST support `--no-cache` option for Docker builds
- **FR-032**: System MUST manage container lifecycle (create, start, stop, remove, status check)
- **FR-033**: System MUST support Docker network creation and management (isolated networks for test isolation)
- **FR-034**: System MUST detect port conflicts before starting containers and report errors
- **FR-035**: System MUST support health check waiting (poll container health endpoint until ready or timeout)
- **FR-036**: System MUST stream container logs via SSE in real-time (stdout/stderr)
- **FR-037**: System MUST support container environment variable injection from `e2e.yaml` and `.env` file
- **FR-038**: System MUST support volume mounting (bind mounts and named volumes)
- **FR-039**: System MUST clean up containers, networks, and volumes on test completion or error

#### F5: Mock 服务框架

- **FR-040**: System MUST generate Mock HTTP service from `e2e.yaml` mock declarations
- **FR-041**: System MUST support path parameters in routes (e.g., `/api/users/:id` matches `/api/users/123`)
- **FR-042**: System MUST support request body and query parameter template variables (e.g., `{{request.body.userId}}`)
- **FR-043**: System MUST provide management endpoints: `GET /_mock/health`, `GET /_mock/requests`, `GET /_mock/routes`, `DELETE /_mock/requests`
- **FR-044**: System MUST support response delay simulation (milliseconds) for testing timeouts
- **FR-045**: System MUST support conditional routing (`when` clause based on request method, path, headers, body)
- **FR-046**: System MUST run Mock service as Docker container (isolated from test service)
- **FR-047**: System MUST support multiple Mock services in single `e2e.yaml` (different ports)

#### F6: Dashboard

- **FR-048**: System MUST provide Fastify backend API server (default port: 9095, configurable)
- **FR-049**: System MUST provide React frontend (default port: 9091 in dev, served by Fastify in prod)
- **FR-050**: System MUST provide "镜像构建" page (branch selection, build options, SSE log streaming)
- **FR-051**: System MUST provide "容器管理" page (start/stop/restart, status, real-time logs, process list, directory browsing)
- **FR-052**: System MUST provide "API 调试" page (proxy requests to container, custom headers/body, response display)
- **FR-053**: System MUST provide "测试套件" page (test suite selection, real-time execution output, test history)
- **FR-054**: System MUST stream all long-running operations via SSE (build logs, container logs, test events)
- **FR-055**: System MUST support CORS for frontend-backend communication
- **FR-056**: System MUST persist test history (last N runs, configurable limit)

#### F7: CLI 工具

- **FR-057**: System MUST provide `e2e-toolkit init` command to generate `e2e.yaml` template
- **FR-058**: System MUST provide `e2e-toolkit setup` command (dependency check, build, start, health verification)
- **FR-059**: System MUST provide `e2e-toolkit run` command (execute tests with optional `--suite` filter)
- **FR-060**: System MUST provide `e2e-toolkit status` command (show running containers, test status, resource usage)
- **FR-061**: System MUST provide `e2e-toolkit clean` command (remove containers, networks, volumes, images optionally)
- **FR-062**: System MUST provide `e2e-toolkit dashboard` command (start Dashboard server)
- **FR-063**: System MUST provide `e2e-toolkit build` command (build Docker image with options)
- **FR-064**: System MUST provide `e2e-toolkit logs` command (stream container logs, support `--follow` option)
- **FR-065**: System MUST support `--help` flag for all commands with usage examples
- **FR-066**: System MUST support `--ci` flag for CI mode (no interactive prompts, JSON output, proper exit codes)
- **FR-067**: System MUST support `--reporter` option (json, table, tap formats)

### Key Entities *(include if feature involves data)*

- **E2EConfig**: 主配置文件实体，包含 project（Docker 配置）、tests（测试套件列表）、mocks（Mock 服务列表）、variables（全局变量）
- **TestSuite**: 测试套件实体，包含 name（名称）、type（运行器类型：yaml/vitest/pytest/shell/exec）、path（测试文件路径）、options（运行器特定选项）
- **YAMLTestCase**: YAML 测试用例实体，包含 name（用例名）、setup（前置步骤）、steps（测试步骤列表）、teardown（后置步骤）、variables（局部变量）
- **TestStep**: 测试步骤实体，包含 action（操作类型：http_request/delay/save）、request（HTTP 请求配置）、expect（断言配置）、save（变量保存配置）
- **MockService**: Mock 服务实体，包含 name（服务名）、port（端口）、routes（路由列表）、container（容器配置）
- **MockRoute**: Mock 路由实体，包含 path（路径，支持参数）、method（HTTP 方法）、response（响应配置）、when（条件配置）、delay（延迟配置）
- **TestEvent**: 统一测试事件实体，包含 type（事件类型：start/step/assert/error/complete）、timestamp（时间戳）、testId（测试 ID）、data（事件数据，类型取决于事件类型）
- **ContainerState**: 容器状态实体，包含 id（容器 ID）、name（容器名）、status（运行状态）、ports（端口映射）、health（健康状态）、logs（日志流）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: as-mate 项目的现有 7 个 E2E 测试用例可以完全迁移到 YAML 格式，迁移后的测试覆盖相同的功能点，执行时间不超过原测试的 120%
- **SC-002**: 新项目（包含 Dockerfile 的服务）可以在 10 分钟内完成接入（从运行 `e2e-toolkit init` 到成功运行第一个测试），配置步骤不超过 5 步
- **SC-003**: Dashboard 提供与现有 as-mate/e2e Dashboard 同等的功能（镜像构建、容器管理、API 调试、测试套件），所有操作响应时间 < 2 秒（除构建和测试执行）
- **SC-004**: CLI 命令简洁直观，90% 的常用操作可以通过单条命令完成，命令帮助文档完整（每个命令有 `--help` 和示例）
- **SC-005**: 文档完整度：README 包含快速开始、配置说明、API 文档；使用手册包含所有功能的使用示例和最佳实践
- **SC-006**: YAML 测试引擎支持所有声明的断言类型（type/exists/in/gt/gte/lt/lte/contains/matches/length），断言失败时错误信息包含期望值、实际值、字段路径
- **SC-007**: Mock 服务框架支持路径参数、条件路由、延迟模拟，Mock 服务启动时间 < 3 秒，请求响应延迟 < 100ms（不含配置的延迟）
- **SC-008**: Docker 引擎支持镜像构建、容器生命周期管理、健康检查等待，容器启动到健康就绪时间可配置（默认 60 秒），超时错误信息清晰
- **SC-009**: 多语言测试运行器支持 YAML/Vitest/Pytest/Shell/Exec，所有运行器输出统一的 TestEvent 格式，测试执行失败时退出码正确（非 0）
- **SC-010**: CI 集成支持：`e2e-toolkit setup --skip-dashboard` 和 `e2e-toolkit run --ci --reporter json` 可以在无交互环境下正常工作，资源清理完整（无残留容器/网络/卷）

### Non-Functional Requirements

- **NFR-001**: 系统必须兼容 Node.js 20+ 和 pnpm 包管理器
- **NFR-002**: 系统必须依赖 Docker（Docker Desktop 或 Docker Engine），不修改被测服务代码
- **NFR-003**: 系统必须支持 Linux、macOS、Windows（WSL2）平台
- **NFR-004**: Dashboard 前端必须使用 React + Vite + Tailwind CSS，后端必须使用 Fastify 5.x
- **NFR-005**: 所有代码必须使用 TypeScript 5.x strict mode，ESM 模块系统，无 `any` 类型（除非绝对必要并文档化）
- **NFR-006**: 核心模块（YAML 引擎、断言引擎、Docker 引擎）测试覆盖率 ≥ 85%，整体测试覆盖率 ≥ 80%
- **NFR-007**: 所有长运行操作（构建、测试执行）必须通过 SSE 提供实时反馈，SSE 连接断开时支持重连和事件 ID 恢复

## Constraints

- **C-001**: 必须依赖 Docker（Docker Desktop 或 Docker Engine），不支持非容器化服务
- **C-002**: 必须使用 Node.js 20+ 运行时，不支持更低版本
- **C-003**: 必须使用 pnpm 作为包管理器，不支持 npm/yarn
- **C-004**: 不修改被测服务代码，测试通过容器网络和 HTTP API 进行
- **C-005**: 必须遵循项目宪法（Constitution）的所有原则，特别是配置驱动架构、语言无关测试、零侵入测试

## Open Questions / Needs Clarification

- **Q-001**: [NEEDS CLARIFICATION: Mock 服务是否需要支持 WebSocket 协议，还是仅 HTTP/HTTPS？]
- **Q-002**: [NEEDS CLARIFICATION: 测试套件是否支持并行执行，还是强制顺序执行？如果支持并行，如何确保容器隔离？]
- **Q-003**: [NEEDS CLARIFICATION: Dashboard 是否需要用户认证，还是仅本地访问？]
- **Q-004**: [NEEDS CLARIFICATION: 是否支持测试数据持久化（数据库、文件系统），还是每次测试都使用全新容器？]
- **Q-005**: [NEEDS CLARIFICATION: 是否支持多容器服务测试（如微服务架构），还是仅单容器服务？]

## Dependencies

- **D-001**: Docker Engine 或 Docker Desktop（必须）
- **D-002**: Node.js 20+ LTS（必须）
- **D-003**: pnpm 8+（必须）
- **D-004**: Fastify 5.x（Dashboard 后端）
- **D-005**: React 18+（Dashboard 前端）
- **D-006**: Vite 5+（前端构建工具）
- **D-007**: Tailwind CSS 3+（前端样式）
- **D-008**: Vitest（测试运行器之一，可选）
- **D-009**: Pytest（测试运行器之一，可选，Python 环境）

## Related Documents

- **Project Constitution**: `/Users/kongjie/projects/agent-studio/e2e-toolkit/.specify/memory/constitution.md`
- **Source Reference**: `/Users/kongjie/projects/agent-studio/as-mate/e2e/` (existing E2E system to be refactored)
- **Docker Documentation**: https://docs.docker.com/
- **Fastify Documentation**: https://www.fastify.io/
- **Vitest Documentation**: https://vitest.dev/
