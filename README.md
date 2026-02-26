# ArgusAI

> 配置驱动的 Docker 容器端到端测试平台 — 代码的百眼守护者

ArgusAI 是一个声明式的 E2E 测试框架，通过 YAML 配置文件描述测试环境、Mock 服务和测试用例，自动完成 Docker 镜像构建、容器管理、Mock 服务启动和测试执行。同时提供 MCP Server，让 AI 编程助手可以直接执行 E2E 测试。

## 特性

- **YAML 驱动** — 声明式定义测试环境和用例，零脚本编写
- **Docker 原生** — 自动构建镜像、管理容器、配置网络和健康检查
- **Mock 服务** — 内置 Mock 服务器，通过配置快速模拟外部依赖
- **多运行器** — 支持 YAML / Vitest / pytest / Shell / Exec / Playwright 等多种测试运行器
- **断言 DSL** — 丰富的断言语法，支持精确匹配、正则、类型检查、存在性验证等
- **变量系统** — 支持 `{{config.*}}`、`{{env.*}}`、`{{runtime.*}}` 模板变量
- **可视化 Dashboard** — 实时查看测试执行状态、容器日志、Mock 请求录制
- **MCP Server** — AI 原生集成，让 Cursor/Claude 等编程助手直接运行 E2E 测试
- **CI/CD 模板** — 提供 GitLab CI 和 GitHub Actions 开箱即用模板

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 20.0 | 运行时环境 |
| pnpm | >= 10.0 | 包管理器 |
| Docker | >= 24.0 | 容器引擎（需启动 Docker Daemon） |

## 快速开始

### 1. 安装

```bash
# 全局安装 CLI
npm install -g argusai

# 或作为开发依赖
pnpm add -D argusai argusai-core
```

### 2. 初始化项目

```bash
argusai init
```

自动生成：
- `e2e.yaml` — 主配置文件
- `tests/health.yaml` — 示例健康检查测试
- `.env.example` — 环境变量模板

### 3. 编辑配置

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

### 4. 编写测试

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

### 5. 运行测试

```bash
argusai build          # 构建 Docker 镜像
argusai setup          # 启动测试环境（网络 + Mock + 容器）
argusai run            # 执行测试
argusai clean          # 清理资源
```

## CLI 命令参考

```
argusai [command] [options]

全局选项:
  -c, --config <path>    e2e.yaml 配置文件路径
  --verbose              详细输出模式
  -V, --version          显示版本号
  -h, --help             显示帮助信息
```

| 命令 | 说明 | 关键选项 |
|------|------|----------|
| `init` | 初始化项目模板 | `--dir <path>` 目标目录 |
| `build` | 构建 Docker 镜像 | `--no-cache` 禁用缓存 |
| `setup` | 启动测试环境 | — |
| `run` | 运行测试套件 | `-s <id>` 指定套件, `--reporter json` 报告格式, `--timeout <ms>` 超时 |
| `status` | 查看容器/网络状态 | — |
| `logs` | 查看容器日志 | `-f` 实时跟踪, `-n <lines>` 行数, `--container <name>` 指定容器 |
| `dashboard` | 启动可视化面板 | `-p <port>` 端口 |
| `clean` | 清理测试资源 | `--all` 同时删除镜像和 volumes |

### 典型工作流

```bash
# 完整的一键测试流程
argusai build && argusai setup && argusai run && argusai clean

# 只运行指定套件
argusai run -s health

# 运行多个套件
argusai run -s health,api

# JSON 报告输出（适合 CI）
argusai run --reporter json > test-results.json

# 启动 Dashboard 后手动测试
argusai setup && argusai dashboard
```

## e2e.yaml 配置参考

```yaml
version: "1"

project:
  name: my-project                # 项目名称（必填）
  description: "项目描述"          # 项目描述（可选）

# ============ 单服务模式 ============
service:
  build:
    dockerfile: Dockerfile         # Dockerfile 路径（必填）
    context: "."                   # 构建上下文（默认 "."）
    image: my-app:e2e             # 镜像名称（必填）
    args:                          # 构建参数（可选）
      NODE_ENV: production

  container:
    name: my-app-e2e              # 容器名称（必填）
    ports:                         # 端口映射（host:container）
      - "8080:3000"
    environment:                   # 环境变量（可选，支持变量引用）
      NODE_ENV: production
      API_KEY: "{{env.API_KEY}}"
    volumes:                       # Volume 挂载（可选）
      - "data-vol:/app/data"
    healthcheck:                   # 健康检查（可选）
      path: /health
      interval: 10s
      timeout: 5s
      retries: 10
      startPeriod: 30s

  vars:                            # 自定义变量（通过 {{config.xxx}} 引用）
    base_url: http://localhost:8080

# ============ 多服务模式 ============
services:
  - name: api-server
    build: { ... }
    container: { ... }
  - name: worker
    build: { ... }
    container: { ... }

# ============ Mock 服务 ============
mocks:
  gateway:
    port: 9081                    # 宿主机端口
    containerPort: 8081           # 容器内端口（可选）
    routes:
      - method: GET
        path: /api/status
        response:
          status: 200
          body: { status: "ok" }

# ============ 测试套件 ============
tests:
  suites:
    - name: 健康检查
      id: health
      file: tests/health.yaml
      runner: yaml                # 可选：yaml | vitest | pytest | shell | exec | playwright

# ============ Dashboard ============
dashboard:
  port: 9095                      # API 端口（默认 9095）
  uiPort: 9091                   # UI 端口（默认 9091）

# ============ Docker 网络 ============
network:
  name: e2e-network
```

## YAML 测试语法

### 测试文件结构

```yaml
name: 测试套件名称                    # 必填
description: 套件描述                 # 可选
sequential: true                     # 顺序执行（默认 true）

variables:                           # 套件级变量
  game_id: "test-{{timestamp}}"

setup:                               # 前置步骤
  - waitHealthy: { timeout: 60s }    # 等待服务健康
  - delay: 3s                        # 等待指定时间
  - name: "前置请求"                  # 执行 HTTP 请求
    request:
      method: POST
      path: /api/init

teardown:                            # 后置清理
  - name: "清理数据"
    request:
      method: DELETE
      path: /api/cleanup
    ignoreError: true

cases:                               # 测试用例
  - name: "用例名称"
    delay: 2s                        # 执行前等待
    request:
      method: GET
      path: /api/resource
      headers:
        Authorization: "Bearer {{config.token}}"
      body:
        key: value
      timeout: 30s
    expect:
      status: 200
      headers:
        content-type: application/json
      body:
        data: expected_value
    save:                            # 保存响应值供后续用例使用
      my_id: "data.id"
```

### 变量系统

| 模板 | 来源 | 示例 |
|------|------|------|
| `{{config.xxx}}` | `service.vars` + `variables` | `{{config.base_url}}` |
| `{{env.xxx}}` | 环境变量 / `.env` 文件 | `{{env.API_KEY}}` |
| `{{runtime.xxx}}` | `save` 保存的值 | `{{runtime.my_id}}` |
| `{{timestamp}}` | 当前 ISO-8601 时间戳 | — |

### 断言 DSL

```yaml
expect:
  status: 200                        # 精确匹配
  status: [200, 201]                 # 多值匹配

  body:
    name: "hello"                    # 字符串精确匹配
    count: 42                        # 数字精确匹配
    active: true                     # 布尔精确匹配

    token: { exists: true }          # 存在性检查
    name: { type: string }           # 类型检查
    status: { in: [active, pending] }  # 枚举值

    count: { gt: 0, lte: 100 }      # 数值比较
    message: { contains: "success" } # 包含子串
    code: { matches: "^\\d+$" }      # 正则匹配
    items: { length: 5 }             # 长度检查

    token: $exists                   # 简写 DSL
    status: $regex:^ok$              # 简写正则

    user:                            # 嵌套对象断言
      profile:
        age: { gt: 18 }

  headers:
    content-type: application/json   # 大小写不敏感
    x-request-id: { exists: true }
```

### 时间格式

支持 `100ms`、`5s`、`2m`、`1h` 或纯数字（毫秒）。

## Mock 服务

### 基本用法

```yaml
mocks:
  api-gateway:
    port: 9081
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

| 变量 | 说明 |
|------|------|
| `{{request.body.xxx}}` | 请求 body 中的字段 |
| `{{request.params.xxx}}` | 路由参数 |
| `{{request.query.xxx}}` | Query 参数 |
| `{{timestamp}}` | ISO-8601 时间戳 |
| `{{uuid}}` | 随机 UUID v4 |

### 高级功能

```yaml
routes:
  # 延迟响应（模拟慢接口）
  - method: POST
    path: /api/slow
    response:
      status: 200
      delay: "2s"
      body: { result: ok }

  # 条件匹配（根据请求内容返回不同响应）
  - method: POST
    path: /api/action
    when:
      body:
        type: "create"
    response:
      status: 201
      body: { created: true }

  - method: POST
    path: /api/action
    response:
      status: 200
      body: { default: true }
```

### 诊断端点

每个 Mock 服务自动提供：

| 端点 | 说明 |
|------|------|
| `GET /_mock/health` | Mock 服务健康检查 |
| `GET /_mock/requests` | 查看所有已录制的请求 |
| `POST /_mock/requests/clear` | 清空录制的请求 |

## 测试运行器

| 运行器 | runner ID | 用途 | 目标格式 |
|--------|-----------|------|----------|
| YAML Runner | `yaml` | 声明式 HTTP 测试（默认） | `.yaml` 测试文件 |
| Vitest Runner | `vitest` | JS/TS 单元/集成测试 | 测试目录/文件 |
| Pytest Runner | `pytest` | Python 测试 | 测试目录/文件 |
| Shell Runner | `shell` | Shell 脚本测试 | `.sh` 脚本 |
| Exec Runner | `exec` | 任意命令 | 命令字符串 |
| Playwright Runner | `playwright` | 浏览器 E2E 测试 | Playwright 测试文件 |

```yaml
tests:
  suites:
    - name: API 测试
      id: api
      file: tests/api.yaml              # YAML 运行器（默认）

    - name: 集成测试
      id: integration
      runner: vitest
      file: tests/integration/
      config: vitest.config.ts

    - name: Python 测试
      id: pytest-suite
      runner: pytest
      file: tests/

    - name: 冒烟测试
      id: smoke
      runner: shell
      file: scripts/smoke-test.sh

    - name: 自定义命令
      id: custom
      runner: exec
      command: "curl -sf http://localhost:8080/health"

    - name: 浏览器测试
      id: browser
      runner: playwright
      file: tests/e2e/
```

## MCP Server（AI 集成）

ArgusAI 提供 MCP Server，让 AI 编程助手（如 Cursor、Claude Desktop）可以直接执行 E2E 测试。

### 配置 Cursor

在 Cursor 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "argusai": {
      "command": "node",
      "args": ["<ARGUSAI_PATH>/packages/mcp/dist/index.js"]
    }
  }
}
```

### MCP 工具列表

| 工具 | 说明 |
|------|------|
| `argus_init` | 初始化项目（加载 e2e.yaml） |
| `argus_build` | 构建 Docker 镜像 |
| `argus_setup` | 启动测试环境 |
| `argus_run` | 运行所有/指定测试套件 |
| `argus_run_suite` | 运行单个测试套件 |
| `argus_status` | 查看环境状态 |
| `argus_logs` | 查看容器日志 |
| `argus_clean` | 清理资源 |
| `argus_mock_requests` | 查看 Mock 请求录制 |

### AI 工作流示例

通过 MCP，AI 助手可以执行完整的测试循环：

```
1. argus_init(projectPath) → 加载项目配置
2. argus_build(projectPath) → 构建镜像
3. argus_setup(projectPath) → 启动环境
4. argus_run(projectPath)   → 执行测试
5. argus_logs(projectPath, container) → 查看失败日志
6. argus_clean(projectPath) → 清理
```

## Dashboard

ArgusAI 提供可视化 Dashboard 用于实时监控测试。

```bash
argusai dashboard
```

功能包括：
- 实时测试执行状态展示
- 容器状态和日志查看
- 测试结果历史
- Mock 服务请求录制查看
- API Explorer（支持自定义预设端点）
- 配置编辑器

## 报告格式

| 格式 | 用途 |
|------|------|
| Console | 终端彩色实时输出（默认） |
| JSON | 机器可读的结构化报告，适合 CI |
| HTML | 自包含的 HTML 报告文件，可离线查看 |

```bash
# JSON 报告
argusai run --reporter json > report.json
```

## CI/CD 集成

项目提供开箱即用的 CI 模板，位于 `ci-templates/` 目录。

### GitLab CI

```yaml
include:
  - local: 'ci-templates/gitlab-ci.yml'

variables:
  PROJECT_PATH: .
  TEST_FILTER: ''
```

### GitHub Actions

```yaml
jobs:
  e2e:
    uses: ./.github/workflows/argusai-e2e.yml
    with:
      project_path: .
      test_filter: ''
```

详见 `ci-templates/` 目录中的完整模板。

## 架构概览

```
argusai/
├── packages/
│   ├── core/             # 核心引擎（argusai-core）
│   │   └── src/
│   │       ├── config-loader.ts      # YAML 配置加载 + Zod 验证
│   │       ├── docker-engine.ts      # Docker CLI 封装
│   │       ├── yaml-engine.ts        # YAML 测试执行引擎
│   │       ├── mock-generator.ts     # Mock 服务生成器（Fastify）
│   │       ├── assertion-engine.ts   # 断言 DSL 引擎
│   │       ├── variable-resolver.ts  # 变量模板解析
│   │       ├── test-runner.ts        # RunnerRegistry
│   │       ├── reporters.ts          # Console/JSON/HTML 报告
│   │       └── runners/              # 测试运行器实现
│   │
│   ├── cli/              # CLI 工具（argusai）
│   ├── dashboard/        # 可视化面板（argusai-dashboard）
│   └── mcp/              # MCP Server（argusai-mcp）
│
├── examples/             # 示例项目
├── ci-templates/         # CI/CD 模板
├── mcp-templates/        # MCP 配置模板
└── schemas/              # JSON Schema（IDE 自动补全）
```

### 技术栈

| 模块 | 技术 |
|------|------|
| 配置验证 | Zod |
| YAML 解析 | js-yaml |
| Mock 服务器 | Fastify |
| Docker 操作 | Docker CLI (child_process) |
| CLI 框架 | Commander.js |
| Dashboard | React + Vite + Tailwind CSS |
| 实时通信 | SSE (Server-Sent Events) |
| 运行时 | Node.js >= 20 |

## 开发

```bash
git clone <repo-url>
cd argusai
pnpm install
pnpm build
pnpm test:run
```

## License

MIT
