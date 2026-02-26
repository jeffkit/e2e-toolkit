# ArgusAI Claude Code Plugin Marketplace

本目录是 ArgusAI 的 Claude Code Plugin Marketplace，业务团队安装后即可让 AI 编程助手直接执行 Docker 容器 E2E 测试。

## 安装方式

### 方式一：从本地目录安装

```bash
claude plugin install --marketplace /path/to/argusai/claude-plugin argusai
```

### 方式二：从 Git 仓库安装

将 `claude-plugin/` 目录推送到 Git 仓库后：

```bash
claude plugin install --marketplace github:jeffkit/infra4agent/argusai/claude-plugin argusai
```

## 安装后你会获得什么

### MCP 工具（9 个）

安装后 AI 自动获得以下 MCP 工具，无需额外配置：

| 工具 | 说明 |
|------|------|
| `argus_init` | 加载项目 e2e.yaml 配置 |
| `argus_build` | 构建 Docker 镜像 |
| `argus_setup` | 启动测试环境（网络 + Mock + 容器） |
| `argus_run` | 运行测试套件 |
| `argus_run_suite` | 运行单个测试套件 |
| `argus_status` | 查看环境状态 |
| `argus_logs` | 查看容器日志 |
| `argus_clean` | 清理测试资源 |
| `argus_mock_requests` | 查看 Mock 请求录制 |

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/run-tests [suite-id]` | 一键运行 E2E 测试（自动 build → setup → run → report） |
| `/init-e2e` | 为当前项目初始化 ArgusAI 配置 |

### Skill（自动触发）

AI 在检测到以下场景时会自动使用 ArgusAI 技能：
- 项目中存在 `e2e.yaml` 文件
- 用户要求运行 E2E 测试、验证接口、测试服务
- 用户提到 "跑一下测试"、"run e2e tests" 等关键词

## 前置条件

使用前请确保：
- **Docker** 已安装且 Daemon 已启动
- **Node.js >= 20** 已安装
- **argusai-mcp** 已全局安装（`npm install -g argusai-mcp`）或位于 PATH 中
- 项目目录中有 `e2e.yaml` 配置文件

## 目录结构

```
claude-plugin/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace 清单
├── plugins/
│   └── argusai/                  # ArgusAI Plugin
│       ├── .claude-plugin/
│       │   └── plugin.json       # Plugin 清单
│       ├── .mcp.json             # MCP Server 配置
│       ├── commands/
│       │   ├── run-tests.md      # /run-tests 命令
│       │   └── init-e2e.md       # /init-e2e 命令
│       └── skills/
│           └── argusai-e2e/
│               ├── SKILL.md      # 核心 Skill 定义
│               └── references/   # 参考文档
│                   ├── yaml-test-syntax.md
│                   └── e2e-yaml-config.md
└── README.md                     # 本文件
```

## 使用示例

安装 plugin 后，在 Claude Code 中直接对话即可：

```
用户：帮我跑一下这个项目的 E2E 测试

AI：（自动识别 e2e.yaml → argus_init → argus_build → argus_setup → argus_run → 报告结果）

用户：health 测试失败了，帮我看看怎么回事

AI：（自动调用 argus_logs 查看日志 → 分析失败原因 → 给出修复建议）
```

或使用斜杠命令：

```
/run-tests          ← 运行所有测试
/run-tests health   ← 只运行 health 套件
/init-e2e           ← 为当前项目初始化配置
```
