# Preflight

> 配置驱动的 Docker 容器端到端测试平台

Preflight 是一个声明式的 E2E 测试框架，通过 YAML 配置文件描述测试环境、Mock 服务和测试用例，自动完成 Docker 镜像构建、容器管理、Mock 服务启动和测试执行。

## 特性

- **YAML 驱动** — 用声明式 YAML 定义测试环境和用例，无需编写脚本
- **Docker 原生** — 自动构建镜像、管理容器、配置网络和健康检查
- **Mock 服务** — 内置 Mock 服务器，通过配置快速模拟外部依赖
- **多运行器** — 支持 YAML、Vitest、pytest、Shell、Exec 等多种测试运行器
- **断言 DSL** — 丰富的断言语法，支持精确匹配、正则、类型检查等
- **变量系统** — 支持 `{{config.*}}`、`{{env.*}}`、`{{runtime.*}}` 变量模板
- **实时报告** — Console、JSON、HTML 三种报告输出格式
- **Dashboard** — 可视化测试面板（独立包）
- **CLI 工具** — 完整的命令行工具，覆盖 init/build/setup/run/status/logs/clean 全流程

## 快速开始（5 分钟上手）

### 1. 初始化项目

```bash
npx @preflight/cli init
```

这会在当前目录生成：
- `e2e.yaml` — 主配置文件
- `tests/health.yaml` — 示例测试
- `.env.example` — 环境变量模板

### 2. 编辑配置

编辑 `e2e.yaml`，配置你的服务：

```yaml
version: "1"

project:
  name: my-app
  description: "我的应用 E2E 测试"

service:
  build:
    dockerfile: Dockerfile
    context: .
    image: my-app:e2e

  container:
    name: my-app-e2e
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: test
    healthcheck:
      path: /health
      interval: 5s
      timeout: 3s
      retries: 10
      startPeriod: 15s

  vars:
    base_url: http://localhost:8080

tests:
  suites:
    - name: 健康检查
      id: health
      file: tests/health.yaml
```

### 3. 编写测试

创建 `tests/health.yaml`：

```yaml
name: 健康检查
description: 验证服务健康状态

cases:
  - name: "GET /health 返回 200"
    request:
      method: GET
      path: /health
    expect:
      status: 200
      body:
        status: ok
```

### 4. 构建并运行

```bash
# 构建 Docker 镜像
preflight build

# 启动测试环境
preflight setup

# 运行测试
preflight run

# 清理资源
preflight clean
```

## 安装

### 全局安装

```bash
npm install -g @preflight/cli
```

### 作为开发依赖

```bash
# pnpm
pnpm add -D @preflight/cli @preflight/core

# npm
npm install -D @preflight/cli @preflight/core
```

### Monorepo 开发

```bash
git clone <repo-url>
cd preflight
pnpm install
pnpm build
```

## e2e.yaml 配置参考

完整的配置文件结构：

```yaml
# 配置版本（目前固定为 "1"）
version: "1"

# 项目信息
project:
  name: my-project                # 项目名称（必填）
  description: "项目描述"          # 项目描述（可选）

# 服务配置
service:
  # Docker 构建配置
  build:
    dockerfile: Dockerfile         # Dockerfile 路径（必填）
    context: "."                   # 构建上下文（默认 "."）
    image: my-app:e2e             # 镜像名称（必填，支持变量）
    args:                          # 构建参数（可选）
      NODE_ENV: production

  # 容器配置
  container:
    name: my-app-e2e              # 容器名称（必填）
    ports:                         # 端口映射（必填，格式：host:container）
      - "8080:3000"
      - "8081:3001"
    environment:                   # 环境变量（可选）
      NODE_ENV: production
      API_KEY: "{{env.API_KEY}}"  # 支持变量引用
    volumes:                       # Volume 挂载（可选）
      - "data-vol:/app/data"
    healthcheck:                   # 健康检查（可选）
      path: /health               # 健康检查路径（必填）
      interval: 10s               # 检查间隔（默认 10s）
      timeout: 5s                 # 超时时间（默认 5s）
      retries: 10                 # 重试次数（默认 10）
      startPeriod: 30s            # 启动等待（默认 30s）

  # 自定义变量（可选，通过 {{config.xxx}} 引用）
  vars:
    base_url: http://localhost:8080
    api_version: v2

# Mock 服务配置（可选）
mocks:
  gateway:                         # Mock 名称
    port: 9081                    # 宿主机端口
    containerPort: 8081           # 容器内端口（可选）
    routes:                        # 路由列表
      - method: GET
        path: /api/status
        response:
          status: 200
          body: { status: "ok" }

# 测试套件配置（可选）
tests:
  suites:
    - name: 健康检查               # 套件名称
      id: health                  # 唯一 ID
      file: tests/health.yaml    # 测试文件路径
      runner: yaml               # 运行器（默认 yaml）

    - name: API 测试
      id: api
      file: tests/api.yaml

    - name: Python 测试
      id: pytest-suite
      runner: pytest
      file: tests/

    - name: 集成测试
      id: integration
      runner: vitest
      file: tests/integration/
      config: vitest.config.ts

    - name: 冒烟测试
      id: smoke
      runner: shell
      file: scripts/smoke-test.sh

    - name: 自定义命令
      id: custom
      runner: exec
      command: "curl -sf http://localhost:8080/health"

# Dashboard 配置（可选）
dashboard:
  port: 9095                      # API 端口（默认 9095）
  uiPort: 9091                   # UI 端口（默认 9091）

# Docker 网络配置（可选）
network:
  name: e2e-network              # 网络名称（默认 e2e-network）
```

## CLI 命令参考

### 全局选项

```bash
preflight [command] [options]

选项:
  -c, --config <path>    e2e.yaml 配置文件路径
  --verbose              启用详细输出
  -V, --version          显示版本号
  -h, --help             显示帮助信息
```

### `init` — 初始化项目

```bash
preflight init [options]

选项:
  --dir <path>    目标目录（默认当前目录）
```

生成 `e2e.yaml`、`tests/health.yaml` 和 `.env.example` 模板文件。不会覆盖已存在的文件。

### `build` — 构建 Docker 镜像

```bash
preflight build [options]

选项:
  --no-cache    不使用 Docker 缓存
```

根据 `e2e.yaml` 的 `service.build` 配置构建 Docker 镜像。

### `setup` — 启动测试环境

```bash
preflight setup
```

创建 Docker 网络、启动 Mock 服务、启动主容器并等待健康检查通过。

### `run` — 运行测试

```bash
preflight run [options]

选项:
  -s, --suite <id>       指定运行的测试套件 ID
  --reporter <type>      报告格式：console | json（默认 console）
  --timeout <ms>         超时时间，毫秒（默认 60000）
```

执行 `tests.suites` 中配置的测试套件。支持通过 `--suite` 筛选特定套件。

### `status` — 查看环境状态

```bash
preflight status
```

显示容器状态、端口使用情况、网络信息和镜像详情。

### `logs` — 查看容器日志

```bash
preflight logs [options]

选项:
  -f, --follow            持续跟踪日志输出
  -n, --tail <lines>      显示最近 N 行日志（默认 100）
  --container <name>      指定容器名（默认使用配置中的容器）
```

查看或实时跟踪容器的标准输出/错误日志。

### `dashboard` — 启动 Dashboard

```bash
preflight dashboard [options]

选项:
  -p, --port <port>      Dashboard 端口（默认 9091）
```

启动可视化 Dashboard 面板。如果 `@preflight/dashboard` 包不可用，会打印手动启动指令。

### `clean` — 清理资源

```bash
preflight clean [options]

选项:
  --all    同时删除镜像和 volumes
```

停止容器、删除 Docker 网络，清理测试环境。

## YAML 测试语法文档

### 测试文件结构

```yaml
# 套件名称（必填）
name: 测试套件名称
# 描述（可选）
description: 套件描述
# 是否顺序执行（可选，默认 true）
sequential: true

# 套件级变量（可选）
variables:
  game_id: "test-{{timestamp}}"
  token: "my-token"

# 前置步骤（可选）
setup:
  - waitHealthy:
      timeout: 60s
  - delay: 3s
  - name: "前置请求"
    request:
      method: POST
      path: /api/init
      body:
        key: value

# 后置步骤（可选）
teardown:
  - name: "清理数据"
    request:
      method: DELETE
      path: /api/cleanup
    ignoreError: true

# 测试用例（必填）
cases:
  - name: "用例名称"
    delay: 2s                      # 执行前等待（可选）
    request:
      method: GET                  # HTTP 方法
      path: /api/resource         # 请求路径
      headers:                     # 请求头（可选）
        Authorization: "Bearer {{config.token}}"
      body:                        # 请求体（可选，GET 请求忽略）
        key: value
      timeout: 30s                # 请求超时（可选）
    expect:                        # 断言（可选）
      status: 200
      headers:
        content-type: application/json
      body:
        data: expected_value
    save:                          # 保存响应值（可选）
      my_id: "data.id"
```

### Setup 步骤类型

| 类型 | 语法 | 说明 |
|------|------|------|
| 等待健康 | `waitHealthy: { timeout: 60s }` | 轮询服务健康接口 |
| 延迟 | `delay: 3s` | 等待指定时间 |
| HTTP 请求 | `name: ..., request: ...` | 执行 HTTP 请求（支持 ignoreError） |

### 变量系统

| 模板 | 来源 | 示例 |
|------|------|------|
| `{{config.xxx}}` | `service.vars` + `variables` | `{{config.base_url}}` |
| `{{env.xxx}}` | 环境变量 / `.env` 文件 | `{{env.API_KEY}}` |
| `{{runtime.xxx}}` | `save` 保存的值 | `{{runtime.my_id}}` |
| `{{timestamp}}` | 当前时间戳 | `{{timestamp}}` |

### 时间格式

支持以下时间字符串格式：

| 格式 | 示例 | 毫秒值 |
|------|------|--------|
| 毫秒 | `100ms` | 100 |
| 秒 | `5s` | 5000 |
| 分钟 | `2m` | 120000 |
| 小时 | `1h` | 3600000 |
| 纯数字 | `500` | 500（视为毫秒） |

## 断言 DSL 参考

### 状态码断言

```yaml
expect:
  # 精确匹配
  status: 200

  # 多值匹配
  status: [200, 201]
```

### Body 断言 — 精确匹配

```yaml
expect:
  body:
    name: "hello"         # 字符串精确匹配
    count: 42             # 数字精确匹配
    active: true          # 布尔精确匹配
    data: null            # null 精确匹配
```

### Body 断言 — 操作符

```yaml
expect:
  body:
    # 类型检查
    name:
      type: string        # string | number | boolean | object | array | null

    # 存在性检查
    token:
      exists: true        # 值存在（非 null、非 undefined）

    # 枚举值
    status:
      in: [active, pending, disabled]

    # 数值比较
    count:
      gt: 0               # 大于
      gte: 1              # 大于等于
      lt: 100             # 小于
      lte: 99             # 小于等于

    # 字符串操作
    message:
      contains: "success" # 包含子串
      startsWith: "OK"    # 前缀匹配
      matches: "^\\d+$"   # 正则匹配

    # 长度检查
    items:
      length: 5           # 精确长度
      length:             # 范围长度
        gt: 0
        lte: 100
```

### Body 断言 — 简写 DSL（YAML 文件中可用）

```yaml
expect:
  body:
    token: $exists            # 等同于 { exists: true }
    status: $regex:^ok$       # 等同于 { matches: "^ok$" }
```

### 嵌套对象断言

```yaml
expect:
  body:
    user:
      name: "Alice"
      profile:
        age:
          gt: 18
```

### Header 断言

```yaml
expect:
  headers:
    content-type: application/json   # 精确匹配（大小写不敏感）
    x-request-id:
      exists: true
```

## Mock 服务配置参考

### 基本路由

```yaml
mocks:
  api-gateway:
    port: 9081
    containerPort: 8081
    routes:
      - method: GET
        path: /api/users
        response:
          status: 200
          body:
            users: []
            total: 0
```

### 参数路由

```yaml
routes:
  - method: GET
    path: /api/users/:id
    response:
      status: 200
      body:
        id: "{{request.params.id}}"
        name: "User {{request.params.id}}"
```

### 响应模板变量

Mock 响应 body 支持以下模板变量：

| 变量 | 说明 |
|------|------|
| `{{request.body.xxx}}` | 请求 body 中的字段 |
| `{{request.params.xxx}}` | 路由参数 |
| `{{request.query.xxx}}` | Query 参数 |
| `{{timestamp}}` | ISO-8601 时间戳 |
| `{{uuid}}` | 随机 UUID v4 |

### 延迟响应

```yaml
routes:
  - method: POST
    path: /api/slow
    response:
      status: 200
      delay: "2s"
      body:
        result: ok
```

### 条件匹配

```yaml
routes:
  - method: POST
    path: /api/action
    when:
      body:
        type: "create"
    response:
      status: 201
      body:
        created: true

  - method: POST
    path: /api/action
    response:
      status: 200
      body:
        default: true
```

### 诊断端点

每个 Mock 服务自动提供以下诊断端点：

| 端点 | 说明 |
|------|------|
| `GET /_mock/health` | Mock 服务健康检查 |
| `GET /_mock/requests` | 查看所有已录制的请求 |
| `POST /_mock/requests/clear` | 清空录制的请求 |

## Dashboard 使用说明

Preflight 提供一个可视化 Dashboard 用于实时查看测试状态。

### 启动方式

**通过 CLI 启动：**

```bash
preflight dashboard
```

**手动启动：**

```bash
cd packages/dashboard && pnpm dev
```

### 功能

- 实时测试执行状态展示
- 容器状态和日志查看
- 测试结果历史
- Mock 服务请求录制查看

## 从 as-mate 迁移指南

Preflight 项目的一个核心目标是将基于 Vitest 的 TypeScript E2E 测试迁移为声明式 YAML 测试。以下以 as-mate 项目为例：

### 迁移对照

**原始 TypeScript 测试 (`health.e2e.ts`)：**

```typescript
describe('健康检查', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('GET /livez 返回 200', async () => {
    const { status, data } = await containerRequest('GET', '/livez');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
  });
});
```

**迁移后 YAML 测试 (`tests/health.yaml`)：**

```yaml
name: 健康检查
sequential: true

setup:
  - waitHealthy:
      timeout: 60s

cases:
  - name: "GET /livez 返回 200"
    request:
      method: GET
      path: /livez
    expect:
      status: 200
      body:
        status: ok
```

### 映射规则

| TypeScript | YAML |
|-----------|------|
| `describe(name, ...)` | `name: <name>` |
| `beforeAll(waitForHealthy)` | `setup: [{waitHealthy: {timeout: 60s}}]` |
| `afterAll(cleanup)` | `teardown: [{name: ..., ignoreError: true}]` |
| `it(name, ...)` | `cases: [{name: ..., ...}]` |
| `containerRequest(method, path, body)` | `request: {method, path, body}` |
| `expect(status).toBe(200)` | `expect: {status: 200}` |
| `expect(data.xxx).toBe(yyy)` | `expect: {body: {xxx: yyy}}` |
| `expect(data).toHaveProperty(key)` | `expect: {body: {key: $exists}}` |
| `sleep(5000)` | `delay: 5s` |
| 变量 `testGameId()` | `variables: {game_id: "e2e-{{timestamp}}"}` |

### 完整示例

完整的 as-mate 迁移示例请查看 `examples/as-mate/` 目录：

```
examples/as-mate/
├── e2e.yaml              # 主配置文件
└── tests/
    ├── health.yaml       # 健康检查（← health.e2e.ts）
    ├── create.yaml       # Create 流程（← create.e2e.ts）
    ├── lifecycle.yaml    # 完整生命周期（← lifecycle.e2e.ts）
    └── errors.yaml       # 异常场景（← error-handling.e2e.ts）
```

## 架构概览

```
preflight/
├── packages/
│   ├── core/            # 核心引擎（@preflight/core）
│   │   ├── src/
│   │   │   ├── types.ts            # 类型定义
│   │   │   ├── config-loader.ts    # YAML 配置加载 + Zod 验证
│   │   │   ├── variable-resolver.ts # 变量模板解析
│   │   │   ├── assertion-engine.ts # 断言 DSL 引擎
│   │   │   ├── yaml-engine.ts      # YAML 测试执行引擎
│   │   │   ├── docker-engine.ts    # Docker CLI 封装
│   │   │   ├── mock-generator.ts   # Mock 服务生成器（Fastify）
│   │   │   ├── test-runner.ts      # RunnerRegistry + 工厂
│   │   │   ├── reporter.ts         # Console/JSON/HTML 报告
│   │   │   ├── sse-bus.ts          # SSE 事件总线
│   │   │   └── runners/
│   │   │       ├── yaml-runner.ts    # YAML 声明式运行器
│   │   │       ├── vitest-runner.ts  # Vitest 运行器
│   │   │       ├── pytest-runner.ts  # Python pytest 运行器
│   │   │       ├── shell-runner.ts   # Shell 脚本运行器
│   │   │       └── exec-runner.ts    # 通用命令运行器
│   │   └── tests/
│   │
│   ├── cli/             # CLI 工具（@preflight/cli）
│   │   └── src/
│   │       ├── index.ts            # 入口
│   │       └── commands/
│   │           ├── init.ts           # 项目初始化
│   │           ├── build.ts          # 镜像构建
│   │           ├── setup.ts          # 环境启动
│   │           ├── run.ts            # 测试运行
│   │           ├── status.ts         # 状态查看
│   │           ├── logs.ts           # 日志查看
│   │           ├── dashboard.ts      # Dashboard 启动
│   │           └── clean.ts          # 资源清理
│   │
│   └── dashboard/       # 可视化 Dashboard（@preflight/dashboard）
│
└── examples/
    └── as-mate/         # as-mate 迁移示例
```

### 技术栈

| 模块 | 技术 |
|------|------|
| 配置验证 | Zod |
| YAML 解析 | js-yaml |
| Mock 服务器 | Fastify |
| Docker 操作 | Docker CLI (child_process) |
| CLI 框架 | Commander.js |
| 测试框架 | Vitest |
| 运行时 | Node.js >= 20 |

### 数据流

```
e2e.yaml
  │
  ▼
Config Loader ──► Zod 验证 + 变量解析
  │
  ├──► Docker Engine ──► 构建镜像 / 启动容器
  │
  ├──► Mock Generator ──► Fastify Mock 服务器
  │
  └──► Runner Registry
        │
        ├── YAMLRunner ──► YAML Engine ──► HTTP 请求 + 断言
        ├── VitestRunner ──► npx vitest run
        ├── PytestRunner ──► pytest
        ├── ShellRunner ──► bash script
        └── ExecRunner ──► sh -c command
              │
              ▼
        Reporter (Console / JSON / HTML)
              │
              ▼
        SSE Bus ──► Dashboard (实时状态)
```

## 测试运行器

| 运行器 | ID | 用途 | 目标格式 |
|--------|-----|------|----------|
| YAML Runner | `yaml` | 声明式 HTTP 测试 | `.yaml` 测试文件 |
| Vitest Runner | `vitest` | JS/TS 单元/集成测试 | 测试目录/文件 |
| Pytest Runner | `pytest` | Python 测试 | 测试目录/文件 |
| Shell Runner | `shell` | Shell 脚本测试 | `.sh` 脚本 |
| Exec Runner | `exec` | 任意命令 | 命令字符串 |

## 报告格式

| 格式 | 类 | 用途 |
|------|-----|------|
| Console | `ConsoleReporter` | 终端彩色实时输出 |
| JSON | `JSONReporter` | 机器可读的结构化报告 |
| HTML | `HTMLReporter` | 自包含的 HTML 报告文件 |

HTML 报告使用示例：

```typescript
import { HTMLReporter } from '@preflight/core';

const reporter = new HTMLReporter();
// ... feed events via reporter.onEvent(event) ...
await reporter.writeReport('./report.html');
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test:run

# 类型检查
pnpm type-check

# 代码检查
pnpm lint
```

## License

MIT
