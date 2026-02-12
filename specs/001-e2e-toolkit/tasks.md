# Task Breakdown: E2E Testing Toolkit

**Feature Branch**: `001-e2e-toolkit`  
**Created**: 2026-02-12  
**Spec**: `specs/001-e2e-toolkit/spec.md`  
**Plan**: `specs/001-e2e-toolkit/plan.md`

> 每个任务为 1–4 小时可完成的工作单元。依赖关系以 `依赖: TXXX` 标注，可并行的任务以 `⚡ 可并行` 标注。

---

## Phase 1: Foundation（核心基础）— MVP Core

**目标**: 可以通过代码 API 加载配置、构建镜像、启动容器、运行 YAML 测试

### 1.1 Monorepo 脚手架

- [ ] T001: Monorepo 根目录初始化 (预估: 2h)
  - 创建根 `package.json`（workspaces 声明）、`pnpm-workspace.yaml`、`tsconfig.json`（project references）、`tsconfig.base.json`（shared compiler options）
  - 配置 ESM (`"type": "module"`)、TypeScript strict mode
  - 创建 `.gitignore`、`.env.example`、`vitest.workspace.ts`
  - 关键文件: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`
  - 依赖: 无

- [ ] T002: packages/core 包初始化 (预估: 1h)
  - 创建 `packages/core/package.json`（`@e2e-toolkit/core`）、`tsconfig.json`、`vitest.config.ts`
  - 创建 `src/index.ts` barrel export、`src/types.ts` 骨架
  - 创建 `tests/unit/` 和 `tests/integration/` 目录结构
  - 关键文件: `packages/core/package.json`, `packages/core/tsconfig.json`
  - 依赖: T001

- [ ] T003: packages/cli 包初始化 (预估: 1h)
  - 创建 `packages/cli/package.json`（`@e2e-toolkit/cli`，依赖 `@e2e-toolkit/core: workspace:*`）
  - 配置 `bin` 入口 (`e2e-toolkit`)、`tsconfig.json`
  - 创建 `src/index.ts` 骨架
  - 关键文件: `packages/cli/package.json`, `packages/cli/src/index.ts`
  - 依赖: T001

- [ ] T004: packages/dashboard 包初始化 (预估: 1h)
  - 创建 `packages/dashboard/package.json`（`@e2e-toolkit/dashboard`）
  - 配置 `vite.config.ts`、`tsconfig.json`、`tsconfig.node.json`
  - 创建 `server/`、`ui/`、`index.html` 骨架
  - 关键文件: `packages/dashboard/package.json`, `packages/dashboard/vite.config.ts`
  - 依赖: T001

> T002、T003、T004 ⚡ 可并行（均只依赖 T001）

### 1.2 核心类型定义

- [ ] T005: 定义所有核心类型接口 (预估: 2h)
  - 在 `packages/core/src/types.ts` 中定义完整类型体系:
    - `E2EConfig` 及其子类型 (`ServiceBuild`, `ServiceContainer`, `HealthcheckConfig` 等)
    - `TestSuiteConfig`, `YAMLTestCase`, `TestStep`
    - `MockServiceConfig`, `MockRouteConfig`
    - `TestEvent` (统一事件: `suite_start`, `case_start`, `case_pass`, `case_fail`, `case_skip`, `suite_end`, `log`)
    - `AssertionResult` (path, operator, expected, actual, passed, message)
    - `BuildEvent`, `ContainerEvent`, `ContainerStatus`
    - `TestRunner` 接口, `RunConfig`, `RunnerRegistry`
    - `VariableContext`
    - `SSEChannel`, `SSEMessage`
    - `TestReport`, `SuiteReport`, `Reporter` 接口
  - 所有类型使用 TypeScript strict mode，无 `any`
  - 关键文件: `packages/core/src/types.ts`
  - 依赖: T002

### 1.3 配置加载器

- [ ] T006: config-loader — Zod schema 定义 (预估: 2h)
  - 使用 Zod 定义完整的 `E2EConfigSchema`（对照 plan.md 中的 schema）
  - 包含: `HealthcheckSchema`, `ServiceBuildSchema`, `ServiceContainerSchema`, `MockRouteSchema`, `MockServiceSchema`, `TestSuiteSchema`, `DashboardSchema`, `NetworkSchema`
  - 支持 `.default()` 默认值、`.optional()` 可选字段
  - 导出 `type E2EConfig = z.infer<typeof E2EConfigSchema>`
  - 关键文件: `packages/core/src/config-loader.ts`
  - 依赖: T005

- [ ] T007: config-loader — YAML 加载 + .env + 变量替换集成 (预估: 2h)
  - 实现 `loadConfig(configPath?: string): Promise<E2EConfig>`
  - 步骤: dotenv.config() → fs.readFile → yaml.load → Zod parse → resolveConfigVariables
  - 支持 YAML anchors/aliases（js-yaml 原生支持）
  - 错误处理: Zod validation error 转为可读错误（含字段名和行号信息）
  - 关键文件: `packages/core/src/config-loader.ts`
  - 依赖: T006, T008 (variable-resolver)

- [ ] T008: config-loader 单元测试 (预估: 2h)
  - 测试 Zod schema 校验（合法配置、缺少必要字段、类型错误）
  - 测试 YAML 加载（正常加载、文件不存在、YAML 语法错误）
  - 测试 .env 加载（存在/不存在 .env）
  - 测试默认值填充
  - 关键文件: `packages/core/tests/unit/config-loader.test.ts`
  - 依赖: T007

### 1.4 模板变量引擎

- [ ] T009: variable-resolver 实现 (预估: 2h)
  - 实现 `resolveTemplate(template: string, ctx: VariableContext): string`
    - 内置变量: `{{timestamp}}` (Date.now), `{{uuid}}` (crypto.randomUUID), `{{date}}` (ISO 8601)
    - 环境变量: `{{env.VAR_NAME}}` → `process.env.VAR_NAME`
    - 请求上下文: `{{request.body.field}}`, `{{request.params.id}}`, `{{request.query.q}}`（Mock 专用）
    - 用户定义变量: `{{varName}}` → ctx.vars[varName]
  - 实现 `resolveDeep<T>(value: T, ctx: VariableContext): T` — 递归解析对象/数组中所有字符串
  - 实现 `resolveNestedPath(obj: unknown, path: string): string` — 点分路径取值
  - 未定义变量保持原样 `{{undefinedVar}}` 或报错（可配置）
  - 关键文件: `packages/core/src/variable-resolver.ts`
  - 依赖: T005

- [ ] T010: variable-resolver 单元测试 (预估: 1.5h)
  - 测试所有内置变量替换（timestamp, uuid, date）
  - 测试 env 变量（存在/不存在的环境变量）
  - 测试 request 上下文变量（body/params/query）
  - 测试用户定义变量和未定义变量处理
  - 测试 resolveDeep 递归解析（嵌套对象、数组）
  - 关键文件: `packages/core/tests/unit/variable-resolver.test.ts`
  - 依赖: T009

> T009 ⚡ 可与 T006 并行（两者均只依赖 T005）

### 1.5 断言 DSL 引擎

- [ ] T011: assertion-engine 实现 — 基础断言操作符 (预估: 3h)
  - 实现 `runAssertions(expected, actual, basePath, ctx): AssertionResult[]`
  - 基础操作符: 精确匹配 (===)、`type` (typeof)、`exists` (非 null/undefined)、`in` (数组包含)
  - 比较操作符: `gt`, `gte`, `lt`, `lte` (数值比较)
  - 字符串操作符: `contains` (string.includes / array.includes)、`matches` (正则)、`startsWith`
  - 长度操作符: `length` (精确匹配或复合比较如 `length: { gt: 0 }`)
  - `save` 副作用: 通过 `ctx.saveVariable(name, value)` 保存值到上下文
  - 嵌套对象: 递归断言
  - 错误信息格式: `"Assertion FAILED at {path}\n  Operator: {op}\n  Expected: {expected}\n  Actual: {actual}"`
  - 关键文件: `packages/core/src/assertion-engine.ts`
  - 依赖: T005

- [ ] T012: assertion-engine 单元测试 (预估: 2.5h)
  - 每种操作符至少 3 个测试用例（通过、失败、边界情况）
  - 测试嵌套对象断言（多层级）
  - 测试 save 操作（验证 saveVariable 被正确调用）
  - 测试错误信息格式
  - 测试 length 复合操作 (`length: 5` 和 `length: { gt: 0 }`)
  - 关键文件: `packages/core/tests/unit/assertion-engine.test.ts`
  - 依赖: T011

> T011 ⚡ 可与 T006、T009 并行（均只依赖 T005）

### 1.6 Docker 引擎

- [ ] T013: docker-engine — DockerEngine 类骨架 + 镜像构建 (预估: 3h)
  - 实现 `DockerEngine` 类
  - `buildImage(options: BuildOptions): AsyncGenerator<BuildEvent>` — 通过 `child_process.spawn` 调用 `docker build`
    - 支持 `--file` (Dockerfile 路径)、`--build-arg`、`--no-cache`
    - 流式输出 stdout/stderr 为 `BuildEvent` (`type: 'log'`)
    - 构建完成/失败时发送 `BuildEvent` (`type: 'status'`)
  - `checkPortConflicts(ports: string[]): Promise<PortConflict[]>` — 检查端口占用
  - 关键文件: `packages/core/src/docker-engine.ts`
  - 依赖: T005

- [ ] T014: docker-engine — 容器生命周期管理 (预估: 3h)
  - `startContainer(options: ContainerOptions): Promise<string>` — `docker run -d` 启动容器
    - 支持: ports, environment, volumes, network, name
  - `stopContainer(name: string): Promise<void>` — `docker stop` + `docker rm`
  - `getContainerStatus(name: string): Promise<ContainerStatus>` — `docker inspect`
  - `ensureNetwork(name: string): Promise<void>` — `docker network create` (如不存在)
  - 关键文件: `packages/core/src/docker-engine.ts`
  - 依赖: T013

- [ ] T015: docker-engine — 健康检查 + 日志 + 清理 (预估: 3h)
  - `waitForHealthy(name, healthPath, timeoutMs): Promise<void>` — 轮询 HTTP 健康端点
  - `streamLogs(name, tail?): AsyncGenerator<string>` — `docker logs -f` 流式输出
  - `getLogs(name, tail?): Promise<string>` — `docker logs` 静态获取
  - `exec(name, command): Promise<{output, exitCode}>` — `docker exec`
  - `getProcesses(name): Promise<ProcessInfo[]>` — `docker top`
  - `listDirectory(name, dirPath): Promise<DirectoryEntry[]>` — `docker exec ls`
  - `cleanup(options: CleanupOptions): Promise<void>` — 批量清理容器、网络、卷
  - 关键文件: `packages/core/src/docker-engine.ts`
  - 依赖: T014

- [ ] T016: docker-engine 单元测试 (预估: 2.5h)
  - Mock `child_process.spawn` / `child_process.execSync`
  - 测试 buildImage: 正常构建、构建失败、no-cache 选项
  - 测试容器生命周期: start → status → stop
  - 测试 ensureNetwork: 网络已存在 / 新建
  - 测试 waitForHealthy: 成功 / 超时
  - 测试端口冲突检测
  - 测试 cleanup
  - 关键文件: `packages/core/tests/unit/docker-engine.test.ts`
  - 依赖: T015

> T013 ⚡ 可与 T006、T009、T011 并行（均只依赖 T005）

### 1.7 YAML 测试引擎

- [ ] T017: yaml-engine — YAML 测试文件解析 (预估: 2h)
  - 实现 `loadYamlTestFile(filePath: string): Promise<YAMLTestCase>`
  - 解析 YAML 结构: `name`, `description`, `sequential`, `setup`, `teardown`, `variables`, `cases`
  - 每个 case 解析: `name`, `request` (method/path/headers/body/timeout), `expect`, `save`, `delay`
  - Zod schema 校验 YAML 测试文件格式
  - 关键文件: `packages/core/src/yaml-engine.ts`
  - 依赖: T005, T009

- [ ] T018: yaml-engine — HTTP 请求执行 + 断言集成 (预估: 3h)
  - 实现核心执行流:
    1. `createVariableContext(config.vars, testCase.variables)` — 合并变量上下文
    2. `runSetupSteps(setup, ctx)` — 执行前置步骤 (wait_healthy, request)
    3. 遍历 `cases`: delay → resolveTemplate → executeHttpRequest → runAssertions → save
    4. `runTeardownSteps(teardown, ctx)` — 始终执行后置步骤
  - 使用 native `fetch` 发送 HTTP 请求
  - 集成 `assertion-engine` 校验响应
  - 集成 `variable-resolver` 进行变量替换
  - 支持 `ignore_error: true` (setup/teardown 步骤)
  - 发射 `TestEvent` 流 (suite_start, case_start, case_pass/case_fail, suite_end)
  - 关键文件: `packages/core/src/yaml-engine.ts`
  - 依赖: T017, T011, T009

- [ ] T019: yaml-engine 单元测试 (预估: 2.5h)
  - Mock HTTP 请求（使用 msw 或手动 mock fetch）
  - 测试 YAML 文件解析（正常、格式错误）
  - 测试变量替换在请求中的应用
  - 测试 setup/teardown 执行（包括 ignore_error）
  - 测试断言集成（通过、失败）
  - 测试 save 变量跨步骤传递
  - 测试 delay 行为
  - 测试 TestEvent 发射（验证事件顺序和内容）
  - 关键文件: `packages/core/tests/unit/yaml-engine.test.ts`
  - 依赖: T018

### 1.8 测试运行器框架

- [ ] T020: test-runner 框架 + RunnerRegistry (预估: 2h)
  - 实现 `TestRunner` 接口
  - 实现 `RunnerRegistry`: `register()`, `get()`, `list()`
  - 实现 `TestOrchestrator`:
    - `constructor(config, registry, bus)`
    - `runSuite(suiteId): AsyncGenerator<TestEvent>` — 从 config 查找 suite，选择 runner，执行
    - `runAll(): AsyncGenerator<TestEvent>` — 遍历所有 suites
    - `getHistory(limit?)`, `getCurrent()` — 历史记录管理
  - 关键文件: `packages/core/src/test-runner.ts`
  - 依赖: T005

- [ ] T021: yaml-runner 实现 (预估: 1.5h)
  - 实现 `YamlRunner` (implements `TestRunner`)
  - `id: 'yaml'`
  - `run(config: RunConfig): AsyncGenerator<TestEvent>` — 调用 yaml-engine 执行
  - `available(): Promise<boolean>` — 始终返回 true（内置运行器）
  - 关键文件: `packages/core/src/runners/yaml-runner.ts`
  - 依赖: T018, T020

- [ ] T022: vitest-runner 实现 (预估: 2h)
  - 实现 `VitestRunner` (implements `TestRunner`)
  - `id: 'vitest'`
  - `run()` — `spawn('npx', ['vitest', 'run', target, '--reporter=json', ...])` 
  - 解析 Vitest JSON 输出 → `TestEvent` 流
  - `available()` — 检查 `npx vitest --version` 是否可用
  - 支持 `options.config` 指定 vitest 配置文件
  - 关键文件: `packages/core/src/runners/vitest-runner.ts`
  - 依赖: T020

> T020 ⚡ 可与 T017 并行（均只依赖 T005）
> T022 ⚡ 可与 T021 并行（均只依赖 T020）

### 1.9 Core barrel export

- [ ] T023: 更新 core/src/index.ts barrel export (预估: 0.5h)
  - 从 `index.ts` 统一导出所有公共 API:
    - `loadConfig`, `E2EConfigSchema`
    - `resolveTemplate`, `resolveDeep`
    - `runAssertions`, `AssertionResult`
    - `DockerEngine`, `BuildEvent`, `ContainerEvent`
    - `YamlRunner`, `VitestRunner`
    - `TestOrchestrator`, `RunnerRegistry`
    - 所有 types
  - 关键文件: `packages/core/src/index.ts`
  - 依赖: T007, T009, T011, T015, T018, T020, T021, T022

---

## Phase 2: Mock + SSE

**目标**: Mock 服务声明式生成，SSE 事件总线，Reporter，更多 Runner

### 2.1 Mock 服务生成器

- [ ] T024: mock-generator — Fastify Mock 应用生成 (预估: 3h)
  - 实现 `MockGenerator` 类
  - `createMockApp(config: MockServiceConfig): FastifyInstance`
    - 从 `config.routes` 动态注册 Fastify 路由
    - 支持路径参数 (`/api/users/:id`)
    - 支持 `when` 条件路由（匹配 body/headers/query）
    - 支持 `response.delay` 延迟模拟
    - 支持 `{{request.body.field}}` 等模板变量在响应体中
  - 自动注册管理接口:
    - `GET /_mock/health` — 健康检查
    - `GET /_mock/requests` — 查看请求记录
    - `GET /_mock/routes` — 查看已注册路由
    - `DELETE /_mock/requests` — 清空请求记录
  - 每个 Mock 实例独立的请求记录数组
  - 关键文件: `packages/core/src/mock-generator.ts`
  - 依赖: T005, T009

- [ ] T025: mock-generator — Docker 容器化 (预估: 2.5h)
  - `buildMockImage(config): Promise<string>` — 生成临时 mock-server.ts + Dockerfile → docker build
  - `startAsContainer(config, network, docker): Promise<string>` — 调用 DockerEngine 在指定网络启动 Mock 容器
  - `startLocal(config): Promise<FastifyInstance>` — 本地进程模式启动（开发/调试用）
  - 关键文件: `packages/core/src/mock-generator.ts`
  - 依赖: T024, T015

- [ ] T026: mock-generator 单元测试 (预估: 2h)
  - 测试 createMockApp: 路由注册、路径参数、条件路由、延迟响应
  - 测试管理接口: /_mock/health, /_mock/requests, /_mock/routes
  - 测试请求记录功能
  - 测试模板变量在响应体中的替换
  - 关键文件: `packages/core/tests/unit/mock-generator.test.ts`
  - 依赖: T025

### 2.2 SSE 事件总线

- [ ] T027: sse-bus 实现 (预估: 2h)
  - 实现 `SSEBus` 类
  - `publish(message: SSEMessage): void` — 发布到指定 channel
  - `subscribe(channels, callback): () => void` — 订阅，返回取消函数
  - `getHistory(channel, sinceId?, limit?): SSEMessage[]` — 历史消息（支持 Last-Event-ID 恢复）
  - 自增 event ID 生成
  - 频道类型: `build`, `container`, `test`, `mock`, `system`
  - 内存中保留每个频道最近 1000 条消息（可配置）
  - 关键文件: `packages/core/src/sse-bus.ts`
  - 依赖: T005

- [ ] T028: sse-bus 单元测试 (预估: 1h)
  - 测试 publish/subscribe 基本流程
  - 测试多频道订阅
  - 测试取消订阅
  - 测试 getHistory（含 sinceId 过滤）
  - 关键文件: `packages/core/tests/unit/sse-bus.test.ts`（新建或扩展）
  - 依赖: T027

> T027 ⚡ 可与 T024 并行

### 2.3 Reporter

- [ ] T029: reporter — ConsoleReporter + JsonReporter (预估: 2h)
  - 实现 `Reporter` 接口和 `TestReport` / `SuiteReport` 数据结构
  - `ConsoleReporter` — 彩色终端输出（✓ pass / ✗ fail / ○ skip），汇总统计
  - `JsonReporter` — 输出结构化 JSON（适合 CI 管道）
  - `collectEvents(events: AsyncGenerator<TestEvent>): Promise<TestReport>` — 从 TestEvent 流汇总为 TestReport
  - 关键文件: `packages/core/src/reporter.ts`
  - 依赖: T005

> T029 ⚡ 可与 T024、T027 并行

### 2.4 更多内置 Runner

- [ ] T030: shell-runner 实现 (预估: 1.5h)
  - 实现 `ShellRunner` (implements `TestRunner`)
  - `run()` — `spawn('bash', ['-e', scriptPath])`, 捕获 stdout/stderr
  - 退出码 0 → pass, 非 0 → fail
  - `available()` — 检查 bash 可用
  - 关键文件: `packages/core/src/runners/shell-runner.ts`
  - 依赖: T020

- [ ] T031: exec-runner 实现 (预估: 1.5h)
  - 实现 `ExecRunner` (implements `TestRunner`)
  - `run()` — `spawn(command, args)`, 捕获输出
  - 退出码 0 → pass, 非 0 → fail
  - `available()` — 始终 true
  - 关键文件: `packages/core/src/runners/exec-runner.ts`
  - 依赖: T020

> T030、T031 ⚡ 可并行，也可与 T024–T029 并行

### 2.5 集成测试

- [ ] T032: yaml-runner + mock-generator 集成测试 (预估: 3h)
  - 启动本地 Mock 服务 (startLocal)
  - 使用 yaml-runner 执行包含 HTTP 请求的 YAML 测试
  - 验证: 变量替换、断言通过/失败、save 跨步骤传递、setup/teardown
  - 验证: Mock 条件路由、延迟响应
  - 验证: TestEvent 事件流正确
  - 关键文件: `packages/core/tests/integration/yaml-runner.test.ts`, `packages/core/tests/integration/mock-service.test.ts`
  - 依赖: T021, T025, T029

---

## Phase 3: CLI

**目标**: `e2e-toolkit` 命令行工具可用

### 3.1 CLI 框架

- [ ] T033: CLI 框架搭建 (预估: 2h)
  - 使用 Commander.js 搭建 CLI 入口
  - `#!/usr/bin/env node` shebang
  - 全局选项: `--config <path>` (指定 e2e.yaml), `--verbose`, `--version`
  - 统一错误处理和退出码
  - 输出工具函数: `packages/cli/src/utils/output.ts` (chalk 彩色输出 + ora spinner)
  - SSE 终端渲染: `packages/cli/src/utils/sse-printer.ts` (SSE → 终端实时刷新)
  - `--help` 全局和子命令帮助
  - 关键文件: `packages/cli/src/index.ts`, `packages/cli/src/utils/output.ts`, `packages/cli/src/utils/sse-printer.ts`
  - 依赖: T003, T023

### 3.2 init 命令

- [ ] T034: `e2e-toolkit init` 命令 + 模板文件 (预估: 2h)
  - 在当前目录生成 `e2e.yaml` 模板（交互式或默认）
  - 生成示例测试文件 `tests/health.yaml`
  - 检测已有 Dockerfile，自动填充部分配置
  - 模板文件: `templates/default/e2e.yaml`, `templates/default/tests/health.yaml`
  - 关键文件: `packages/cli/src/commands/init.ts`, `templates/default/`
  - 依赖: T033

### 3.3 setup 命令

- [ ] T035: `e2e-toolkit setup` 命令 (预估: 3h)
  - 完整的环境初始化流程:
    1. 依赖检查 (Docker 可用性、Node.js 版本)
    2. 加载配置 (`loadConfig`)
    3. 创建 Docker 网络 (`ensureNetwork`)
    4. 构建主服务镜像 (`buildImage`) — SSE 日志实时输出到终端
    5. 构建并启动 Mock 服务 (如果有 `mocks` 配置)
    6. 启动主服务容器 (`startContainer`)
    7. 等待健康检查 (`waitForHealthy`)
  - 支持 `--skip-dashboard` 选项（CI 模式）
  - 关键文件: `packages/cli/src/commands/setup.ts`
  - 依赖: T033, T007, T015, T025

### 3.4 build 命令

- [ ] T036: `e2e-toolkit build` 命令 (预估: 1.5h)
  - 加载配置，调用 `DockerEngine.buildImage()`
  - SSE 日志实时输出到终端（通过 sse-printer）
  - 支持 `--no-cache` 选项
  - 关键文件: `packages/cli/src/commands/build.ts`
  - 依赖: T033, T015

### 3.5 run 命令

- [ ] T037: `e2e-toolkit run` 命令 (预估: 3h)
  - 加载配置，使用 `TestOrchestrator` 运行测试
  - 支持 `--suite <id>` 过滤特定套件
  - 支持 `--ci` 模式（无交互、JSON 输出、proper exit code）
  - 支持 `--reporter <format>` 选择报告格式（console / json）
  - 实时输出 TestEvent 到终端
  - 退出码: 全部通过 → 0, 有失败 → 1
  - 关键文件: `packages/cli/src/commands/run.ts`
  - 依赖: T033, T020, T029

### 3.6 辅助命令

- [ ] T038: `status` + `clean` + `logs` 命令 (预估: 2.5h)
  - `status` — 显示运行中的容器、端口映射、健康状态、资源使用
  - `clean` — 停止并删除容器、网络；支持 `--volumes` 删除卷、`--images` 删除镜像
  - `logs` — 输出容器日志，支持 `--follow` 实时跟踪、`--tail <n>` 行数限制
  - 关键文件: `packages/cli/src/commands/status.ts`, `packages/cli/src/commands/clean.ts`, `packages/cli/src/commands/logs.ts`
  - 依赖: T033, T015

### 3.7 dashboard 命令

- [ ] T039: `e2e-toolkit dashboard` 命令 (预估: 1h)
  - 启动 Dashboard 服务（调用 `@e2e-toolkit/dashboard` 的 server 入口）
  - 支持 `--port <port>` 自定义端口
  - 打开浏览器（可选）
  - 注: 实际 Dashboard 实现在 Phase 4，此处仅实现 CLI 命令壳
  - 关键文件: `packages/cli/src/commands/dashboard.ts`
  - 依赖: T033

> T034–T039 中，T034、T036、T038、T039 ⚡ 可并行（均只依赖 T033 + core API）
> T035 和 T037 较为复杂，建议顺序实现

### 3.8 CLI 测试

- [ ] T040: CLI 命令单元测试 (预估: 2h)
  - 测试 `init` 命令（生成文件、检测 Dockerfile）
  - 测试 `run` 命令（--suite 过滤、--ci 模式、--reporter 选项）
  - Mock core API 调用
  - 关键文件: `packages/cli/tests/commands/init.test.ts`, `packages/cli/tests/commands/run.test.ts`
  - 依赖: T034, T037

---

## Phase 4: Dashboard

**目标**: Web Dashboard 可视化面板

### 4.1 Dashboard 后端

- [ ] T041: Dashboard Fastify server 搭建 (预估: 2h)
  - Fastify 5.x server 入口，注册 CORS、static 插件
  - 加载 `E2EConfig`，初始化 `DockerEngine`, `TestOrchestrator`, `SSEBus`
  - SSE 事件端点 `GET /api/events` — 订阅 SSEBus
  - 配置端点 `GET /api/config` — 返回当前配置
  - 关键文件: `packages/dashboard/server/index.ts`, `packages/dashboard/server/routes/events.ts`, `packages/dashboard/server/routes/config.ts`
  - 依赖: T023, T027

- [ ] T042: Docker API routes (预估: 3h)
  - `POST /api/docker/build` — 触发镜像构建，通过 SSE 推送日志
  - `POST /api/docker/start` — 启动容器
  - `POST /api/docker/stop` — 停止容器
  - `POST /api/docker/restart` — 重启容器
  - `GET /api/docker/status` — 获取容器状态
  - `GET /api/docker/logs` — 获取容器日志
  - `GET /api/docker/logs/stream` — SSE 流式日志
  - `GET /api/docker/processes` — 进程列表
  - `GET /api/docker/dirs` — 目录浏览
  - `POST /api/docker/exec` — 容器内执行命令
  - 关键文件: `packages/dashboard/server/routes/docker.ts`
  - 依赖: T041

- [ ] T043: Test + Proxy + Mock API routes (预估: 2.5h)
  - Test routes:
    - `GET /api/test/suites` — 测试套件列表
    - `POST /api/test/run` — 运行测试（指定 suiteId），通过 SSE 推送事件
    - `GET /api/test/history` — 测试历史
  - Proxy route:
    - `POST /api/proxy` — 代理请求到容器（API 调试用）
  - Mock routes:
    - `GET /api/mock/services` — Mock 服务列表
    - `GET /api/mock/:name/requests` — Mock 请求记录
  - 关键文件: `packages/dashboard/server/routes/test.ts`, `packages/dashboard/server/routes/proxy.ts`, `packages/dashboard/server/routes/mock.ts`
  - 依赖: T041

> T042、T043 ⚡ 可并行

### 4.2 Dashboard 前端框架

- [ ] T044: React + Vite + Tailwind UI 框架搭建 (预估: 2.5h)
  - `main.tsx` 入口、`App.tsx` 路由配置 (react-router-dom)
  - `Layout.tsx` — 侧边栏导航 + 顶栏状态
  - Tailwind CSS 4 配置 (`@tailwindcss/vite`)
  - API client (`ui/lib/api.ts`) — 封装 fetch 调用
  - SSE client helper (`ui/lib/sse.ts`) — EventSource 封装 + 自动重连
  - Zustand stores 骨架: `build-store.ts`, `container-store.ts`, `test-store.ts`
  - 关键文件: `packages/dashboard/ui/main.tsx`, `packages/dashboard/ui/App.tsx`, `packages/dashboard/ui/components/Layout.tsx`, `packages/dashboard/ui/lib/api.ts`, `packages/dashboard/ui/lib/sse.ts`
  - 依赖: T004, T041

- [ ] T045: SSELogViewer 通用组件 (预估: 2h)
  - 通用的 SSE 日志查看器组件
  - 支持: 自动滚动、ANSI 颜色渲染、搜索/过滤、暂停/继续
  - 接收 SSE 频道参数，连接到 `/api/events`
  - `StatusBadge` 组件 — 状态标签（running/stopped/building/error）
  - 关键文件: `packages/dashboard/ui/components/SSELogViewer.tsx`, `packages/dashboard/ui/components/StatusBadge.tsx`
  - 依赖: T044

### 4.3 Dashboard 页面

- [ ] T046: BuildPage — 镜像构建页面 (预估: 3h)
  - 构建选项面板: no-cache 开关、build args 输入
  - 构建按钮触发 `POST /api/docker/build`
  - 实时 SSE 日志流 (使用 SSELogViewer)
  - 构建历史列表
  - 关键文件: `packages/dashboard/ui/pages/BuildPage.tsx`, `packages/dashboard/ui/stores/build-store.ts`
  - 依赖: T045, T042

- [ ] T047: ContainerPage — 容器管理页面 (预估: 3h)
  - 容器状态卡片（名称、镜像、端口、健康状态）
  - 操作按钮: 启动、停止、重启
  - 实时日志流 (SSELogViewer)
  - 进程列表表格
  - 目录浏览器
  - 关键文件: `packages/dashboard/ui/pages/ContainerPage.tsx`, `packages/dashboard/ui/stores/container-store.ts`
  - 依赖: T045, T042

- [ ] T048: ApiExplorerPage — API 调试页面 (预估: 3h)
  - 请求构建器: HTTP 方法选择、URL 输入、Headers 编辑器、Body 编辑器（JSON）
  - 发送按钮 → `POST /api/proxy`
  - 响应面板: 状态码、响应头、响应体（JSON 高亮）、耗时
  - 请求历史列表
  - 关键文件: `packages/dashboard/ui/pages/ApiExplorerPage.tsx`
  - 依赖: T044, T043

- [ ] T049: TestSuitesPage — 测试套件页面 (预估: 3h)
  - 测试套件列表 (从 `/api/test/suites` 加载)
  - 单套件运行按钮 → `POST /api/test/run`
  - 实时测试事件流: case 开始/通过/失败 实时更新
  - 断言失败详情（expected vs actual）
  - 测试历史记录
  - 关键文件: `packages/dashboard/ui/pages/TestSuitesPage.tsx`, `packages/dashboard/ui/stores/test-store.ts`
  - 依赖: T045, T043

> T046、T047、T048、T049 ⚡ 可并行（均依赖 T045 + 后端 routes）

### 4.4 Dashboard 生产构建

- [ ] T050: Dashboard 生产模式配置 (预估: 1.5h)
  - Vite 生产构建 → 输出到 `dist/`
  - Fastify `@fastify/static` 服务静态文件
  - `dashboard` CLI 命令接入生产模式（优先使用构建产物）
  - 开发模式: Vite dev server + Fastify API server（concurrently）
  - 关键文件: `packages/dashboard/vite.config.ts`, `packages/dashboard/server/index.ts`
  - 依赖: T046, T047, T048, T049

---

## Phase 5: Polish & CI

**目标**: 完善功能、文档、迁移验证

- [ ] T051: pytest-runner 实现 (预估: 2h)
  - 实现 `PytestRunner` (implements `TestRunner`)
  - `run()` — `spawn('pytest', [target, '--tb=short', '-v', ...])`, 解析输出 → TestEvent
  - `available()` — 检查 `pytest --version` 可用
  - 支持 `options.markers` (pytest markers)
  - 关键文件: `packages/core/src/runners/pytest-runner.ts`
  - 依赖: T020

- [ ] T052: HTML Reporter 实现 (预估: 2.5h)
  - `HtmlReporter` — 生成自包含 HTML 报告文件
  - 包含: 测试汇总、每个用例的详情（通过/失败/跳过）、断言失败详情、执行时间图表
  - 输出到 `e2e-report.html`
  - 关键文件: `packages/core/src/reporter.ts` (扩展)
  - 依赖: T029

- [ ] T053: SSE 断线重连 + Last-Event-ID 恢复 (预估: 2h)
  - Dashboard SSE 端点支持 `Last-Event-ID` header
  - 从 SSEBus history 恢复断线期间的消息
  - 前端 SSE client 自动重连（指数退避）
  - 关键文件: `packages/dashboard/server/routes/events.ts`, `packages/dashboard/ui/lib/sse.ts`
  - 依赖: T041, T044

- [ ] T054: CI 模式优化 (预估: 2h)
  - `e2e-toolkit run --ci` 确保:
    - 无交互提示
    - JSON 报告输出到 stdout
    - 正确的退出码（0/1）
    - 超时控制
  - `e2e-toolkit clean --ci` 确保:
    - 完整资源清理（无残留容器/网络/卷）
    - 静默模式
  - 关键文件: `packages/cli/src/commands/run.ts`, `packages/cli/src/commands/clean.ts`
  - 依赖: T037, T038

- [ ] T055: as-mate E2E 测试迁移为 YAML 格式 (预估: 4h)
  - 将 `as-mate/e2e/tests/` 中的 7 个 Vitest 测试用例转写为 YAML 格式
  - 创建 as-mate 项目的 `e2e.yaml` 配置
  - 验证迁移后测试覆盖相同功能点
  - 验证执行时间不超过原测试 120%（SC-001）
  - 关键文件: 新建 as-mate YAML 测试文件（作为迁移示例）
  - 依赖: T032

- [ ] T056: README + 快速开始文档 (预估: 3h)
  - `README.md`:
    - 项目简介、特性列表
    - 快速开始（5 分钟上手）
    - 安装方式 (`npm install -g @e2e-toolkit/cli`)
    - 配置参考 (`e2e.yaml` 完整字段说明)
    - CLI 命令参考
    - YAML 测试语法文档
    - 断言 DSL 参考
    - Mock 服务配置参考
  - `.env.example` 更新
  - 关键文件: `README.md`
  - 依赖: T040, T050

- [ ] T057: 整体测试覆盖率达标 (预估: 3h)
  - 配置 Vitest coverage (c8/istanbul)
  - 补充不足的测试用例，确保:
    - 核心模块 (yaml-engine, assertion-engine, docker-engine) ≥ 85%
    - 整体覆盖率 ≥ 80%
  - 配置 `vitest.workspace.ts` 统一覆盖率报告
  - 关键文件: `vitest.workspace.ts`, 各 `vitest.config.ts`
  - 依赖: T032, T040

> T051、T052、T053、T054 ⚡ 可并行
> T055、T056、T057 可在上述任务完成后并行

---

## 任务汇总

| Phase | 任务数 | 预估总时间 | 关键里程碑 |
|-------|--------|-----------|-----------|
| Phase 1: Foundation | T001–T023 | ~48h | Core API 可用，YAML 测试可运行 |
| Phase 2: Mock + SSE | T024–T032 | ~18.5h | Mock 服务生成，SSE 总线，集成测试通过 |
| Phase 3: CLI | T033–T040 | ~17h | `e2e-toolkit` CLI 全部命令可用 |
| Phase 4: Dashboard | T041–T050 | ~25.5h | Web Dashboard 可视化面板可用 |
| Phase 5: Polish | T051–T057 | ~18.5h | 文档完备，覆盖率达标，迁移验证 |
| **总计** | **57 个任务** | **~127.5h** | |

---

## 依赖关系图（关键路径）

```
T001 (monorepo init)
 ├── T002 (core init) → T005 (types)
 │    ├── T006 (config schema) → T007 (config loader) → T008 (tests)  ─┐
 │    ├── T009 (variable-resolver) → T010 (tests)                      │
 │    ├── T011 (assertion-engine) → T012 (tests)                       │
 │    ├── T013 (docker build) → T014 (container) → T015 (health+logs)  │
 │    │                                              → T016 (tests)    │
 │    ├── T017 (yaml parse) → T018 (yaml exec) → T019 (tests)         │
 │    ├── T020 (runner framework) → T021 (yaml-runner)                 │
 │    │                           → T022 (vitest-runner)               │
 │    └── T023 (barrel export) ←──── 依赖所有 core 模块 ──────────────┘
 │         ↓
 │    T024 (mock fastify) → T025 (mock docker) → T026 (tests)
 │    T027 (sse-bus) → T028 (tests)
 │    T029 (reporter)
 │    T030 (shell-runner), T031 (exec-runner)
 │    T032 (integration tests) ← T021 + T025 + T029
 │         ↓
 ├── T003 (cli init) → T033 (cli framework) → T034–T039 (commands) → T040 (tests)
 │
 └── T004 (dashboard init) → T041 (server) → T042, T043 (routes)
                              → T044 (UI framework) → T045 (SSELogViewer)
                              → T046–T049 (pages) → T050 (production build)
```
