# ArgusAI Evolution Roadmap

**Created**: 2026-02-26
**Status**: Draft
**Author**: AI Analysis + Human Review
**Base**: 002-ai-native (all 110 tasks completed)

---

## Executive Summary

ArgusAI 已完成从 "人工操作的 CLI 工具" 到 "AI-Native 编程基础设施" 的第一阶段转型。所有 12 个 User Story、110 个任务均已完成。

本文档规划下一阶段的 6 个进化方向，目标是将 ArgusAI 从 "能用" 提升为 "好用且智能" 的 AI Agent 测试基础设施。

### 核心进化理念

```
当前状态：AI Agent 可以执行测试，看到结果
目标状态：AI Agent 可以自主地、可靠地、智能地完成测试闭环
                     ↑            ↑            ↑
                  错误恢复     多项目隔离    学习能力
```

### 进化路线图总览

| 波次 | 优先级 | 方向 | 目标 |
|------|--------|------|------|
| 第一波 | P1 | ② 错误恢复与自愈 | AI Agent 的自主性 |
| 第一波 | P1 | ③ 测试持久化与趋势 | 测试的可信度 |
| 第一波 | P1 | ⑦-L1 多项目隔离 | 基础设施可靠性 |
| 第二波 | P2 | ④ 智能诊断建议 | AI 的诊断准确率 |
| 第二波 | P2 | ⑤ OpenAPI 智能 Mock | Mock 体验与效率 |
| 第二波 | P2 | ⑥-L1 性能预算 | 性能回归检测 |
| 第三波 | P3 | ⑥-L2 负载测试 | 性能基准能力 |
| 第三波 | P3 | ⑦-L2 远程团队协作 | 团队规模化使用 |

---

## 方向 ② — 错误恢复与自愈机制

### 问题陈述

当前 ArgusAI 的错误处理是"报告型"的——出错就停下来告诉你。但在 AI Agent 自主循环中，我们需要"恢复型"——能自己尝试修复再继续。

**典型痛点场景**：
- Docker daemon 未启动，AI Agent 不知道该怎么办
- 上次测试异常退出留下孤儿容器，新一轮 setup 端口冲突
- 容器 OOM Kill 后，Agent 只看到 "container exited" 但不知道原因
- 健康检查超时，但没有足够上下文判断是启动慢还是真的挂了

### 目标

1. AI Agent 在 90% 的常见基础设施错误场景下能自主恢复，无需人工干预
2. 剩余 10% 不可恢复的错误，提供足够上下文让 Agent 给出准确诊断
3. 避免 Agent 陷入无效重试循环（熔断器）

### 功能需求

#### FR-R01: Docker 环境预检（Preflight Check）

在 `setup` 和 `build` 操作前自动执行环境预检：

| 检查项 | 检测方法 | 失败时的行为 |
|--------|---------|-------------|
| Docker daemon 可达 | `docker info` | 返回 `DOCKER_UNAVAILABLE` 错误码 + 诊断建议 |
| Docker API 版本兼容 | 解析 `docker version` 输出 | 版本过低时警告 |
| 磁盘空间充足 | `docker system df` + `df -h` | 低于阈值时返回 `DISK_LOW` 警告或错误 |
| Docker 网络正常 | `docker network ls` | 网络异常时返回诊断 |
| 必要端口未被占用 | 使用已有 `isPortInUse` | 端口冲突时自动分配或报告 |

可配置性：

```yaml
resilience:
  preflight:
    enabled: true
    checkDocker: true
    checkDiskSpace: "2GB"     # 最小可用磁盘空间
    checkPorts: true
    cleanOrphans: true        # 清理上次遗留的孤儿资源
```

#### FR-R02: 孤儿资源清理

每次 `setup` 前自动检测并清理上次遗留的资源：

- 扫描带有 `argusai.project=<project-name>` label 的容器
- 扫描带有 `argusai.project=<project-name>` label 的网络
- 提供清理报告（清理了什么、为什么被认为是孤儿）
- 可通过配置禁用：`resilience.preflight.cleanOrphans: false`

**实现要点**：
- `startContainer` 和 `ensureNetwork` 时添加 label
- 清理时只删除匹配 label 且非当前 session 的资源
- 防止误删其他项目的资源

#### FR-R03: 容器生命周期守护

| 场景 | 检测 | 恢复策略 |
|------|------|---------|
| OOM Kill | `docker inspect` → `State.OOMKilled` | 自动重启（可配置） + 报告内存使用峰值 |
| 进程崩溃 | `docker inspect` → 非零退出码 | 自动重启 + 收集崩溃前日志 |
| 健康检查失败 | 健康状态从 healthy → unhealthy | 收集日志 + 进程列表 + 网络状态后报告 |

容器重启配置：

```yaml
resilience:
  container:
    restartOnFailure: true
    maxRestarts: 3
    restartBackoff: exponential  # linear | exponential | fixed
    restartDelay: "2s"
```

重启后行为：
- 记录重启原因和时间
- 等待健康检查通过
- 如果达到 maxRestarts 仍失败，停止重启并返回详细诊断

#### FR-R04: 端口冲突自动规避

当配置的端口已被占用时：

| 策略 | 行为 | 配置值 |
|------|------|--------|
| auto | 自动分配下一个可用端口，更新变量 | `portConflictStrategy: auto` |
| fail | 立即报错并指出占用端口的进程 | `portConflictStrategy: fail` |

端口自动分配规则：
- 从配置端口开始递增，最多尝试 100 个端口
- 分配后更新 `{{config.base_url}}` 等变量
- 在 MCP 返回的 `SetupResult` 中标明实际使用的端口

#### FR-R05: 网络韧性

- Mock 服务连接检测：测试前验证 Mock 端点可达
- DNS 解析验证：确认容器间通过网络名能互相解析
- 超时后增强诊断：健康检查超时时自动收集容器日志 + 进程列表 + 端口监听情况

#### FR-R06: Circuit Breaker（熔断器）

对 Docker CLI 调用实现熔断器：

- 状态机：CLOSED（正常）→ OPEN（熔断）→ HALF_OPEN（探测）
- 连续失败 N 次后熔断（默认 N=5）
- 熔断期间所有 Docker 调用直接返回 `CIRCUIT_OPEN` 错误
- 经过 cooldown 时间（默认 30s）后进入 HALF_OPEN，尝试一次调用
- 提供 MCP 工具 `argus_reset_circuit` 手动重置

#### FR-R07: MCP 新工具

| 工具 | 功能 |
|------|------|
| `argus_preflight_check` | 手动触发环境预检，返回检查报告 |
| `argus_reset_circuit` | 重置 Docker 调用熔断器 |

#### FR-R08: 结构化错误码

所有错误响应使用标准化错误码：

| 错误码 | 含义 | AI Agent 建议行动 |
|--------|------|------------------|
| DOCKER_UNAVAILABLE | Docker daemon 不可达 | 提示用户启动 Docker |
| DISK_SPACE_LOW | 磁盘空间不足 | 提示清理或扩容 |
| PORT_CONFLICT | 端口被占用 | 自动规避或提示用户 |
| CONTAINER_OOM | 容器内存不足 | 增加内存限制或优化服务 |
| CONTAINER_CRASH | 容器崩溃 | 查看日志诊断原因 |
| HEALTH_CHECK_TIMEOUT | 健康检查超时 | 增加超时时间或排查服务启动 |
| CIRCUIT_OPEN | Docker 调用熔断 | 等待或手动重置 |
| ORPHAN_RESOURCES | 存在孤儿资源 | 已自动清理（info 级别）|

### 涉及文件

| 操作 | 文件路径 |
|------|---------|
| NEW | `packages/core/src/resilience.ts` — PreflightChecker, CircuitBreaker, OrphanCleaner |
| NEW | `packages/core/src/container-guardian.ts` — ContainerGuardian (OOM/crash 检测与恢复) |
| MOD | `packages/core/src/docker-engine.ts` — 添加 label 支持、端口规避逻辑 |
| MOD | `packages/core/src/config-loader.ts` — 扩展 ResilienceConfig schema |
| MOD | `packages/core/src/types.ts` — 新增错误码枚举、ResilienceConfig 类型 |
| MOD | `packages/mcp/src/tools/setup.ts` — 集成预检和孤儿清理 |
| MOD | `packages/mcp/src/tools/build.ts` — 集成预检 |
| NEW | `packages/mcp/src/tools/preflight-check.ts` — argus_preflight_check |
| NEW | `packages/core/tests/unit/resilience.test.ts` |
| NEW | `packages/core/tests/unit/container-guardian.test.ts` |

### 验收标准

- AC-R01: Docker daemon 未启动时，`argus_setup` 返回 `DOCKER_UNAVAILABLE` 错误码和启动建议
- AC-R02: 上次遗留孤儿容器时，新一轮 `setup` 自动清理并正常启动
- AC-R03: 容器 OOM Kill 后自动重启，最终超过 maxRestarts 时返回详细诊断
- AC-R04: 配置端口被占用时，`auto` 策略自动分配可用端口并更新变量
- AC-R05: Docker 连续失败 5 次后熔断，后续调用立即返回 `CIRCUIT_OPEN`

---

## 方向 ③ — 测试结果持久化与趋势分析

### 问题陈述

当前测试结果是"一次性的"——跑完就没了。无法回答：
- "这个测试最近是不是变 flaky 了？"
- "上周到这周的通过率趋势如何？"
- "这次失败是新问题还是老问题？"

对于 AI Agent 来说，没有历史数据就无法做出智能决策（比如判断一个失败是 flaky 还是真实 bug）。

### 目标

1. 每次测试运行的结果自动持久化
2. 提供 Flaky Test 识别能力，准确率 > 90%
3. AI Agent 可以通过 MCP 工具查询历史数据和趋势
4. Dashboard 新增趋势分析页面

### 功能需求

#### FR-H01: 测试运行记录（TestRun）

自动记录每次测试运行的元数据：

```
TestRun {
  id: string (UUID)
  projectName: string
  timestamp: ISO-8601
  gitCommit: string | null      # 自动从 git rev-parse HEAD 获取
  gitBranch: string | null      # 自动从 git branch --show-current 获取
  configHash: string            # e2e.yaml 内容的 SHA-256
  trigger: 'cli' | 'mcp' | 'ci' | 'dashboard'
  durationMs: number
  total: number
  passed: number
  failed: number
  skipped: number
  flakyCount: number            # 标记为 flaky 的失败数
  status: 'pass' | 'fail' | 'error'
  metadata: JSON                # 可扩展字段
}
```

#### FR-H02: 用例级别记录（TestCaseRun）

记录每个测试用例每次运行的详情：

```
TestCaseRun {
  id: string (UUID)
  runId: string (FK → TestRun.id)
  suiteId: string
  caseName: string
  status: 'pass' | 'fail' | 'skip' | 'flaky'
  durationMs: number
  attempts: number              # 重试次数
  responseTimeMs: number | null # HTTP 响应时间
  assertionCount: number
  failedAssertionCount: number
  errorSummary: string | null   # 失败摘要
  errorCategory: string | null  # 失败分类（连接④）
  diagnostics: JSON | null      # 诊断信息快照
}
```

#### FR-H03: 存储引擎

| 模式 | 存储 | 适用场景 |
|------|------|---------|
| local | SQLite (`~/.argusai/history.db`) | 单机开发 |
| remote | PostgreSQL | 团队协作（Phase 3 扩展） |
| memory | 内存 Map | 测试/CI（不持久化） |

配置：

```yaml
history:
  enabled: true
  storage: local              # local | remote | memory
  retention: 90d              # 保留天数
  maxRuns: 1000               # 最大记录数
  dbPath: ~/.argusai/history.db  # SQLite 路径（local 模式）
```

#### FR-H04: Flaky Test 识别引擎

**算法**：
1. 取同一 `caseName` + `suiteId` 最近 N 次记录（默认 N=10）
2. 如果 pass 和 fail 都出现过，标记为 flaky
3. 计算 flaky score = fail_count / total_count
4. flaky score ∈ (0, 1)：0 = 从不失败，1 = 总是失败
5. 0 < score < 1 的用例为 flaky，score 越接近 0.5 越 flaky

**分级**：
| 范围 | 级别 | 含义 |
|------|------|------|
| score = 0 | STABLE | 稳定通过 |
| 0 < score ≤ 0.2 | MOSTLY_STABLE | 偶尔失败 |
| 0.2 < score ≤ 0.5 | FLAKY | 不稳定 |
| 0.5 < score < 1.0 | VERY_FLAKY | 非常不稳定 |
| score = 1.0 | BROKEN | 持续失败（不是 flaky，是真 bug） |

**在测试结果中的体现**：

```json
{
  "caseName": "创建游戏接口",
  "status": "fail",
  "flakyInfo": {
    "isFlaky": true,
    "flakyScore": 0.3,
    "level": "FLAKY",
    "recentResults": ["pass", "pass", "fail", "pass", "pass", "pass", "fail", "pass", "pass", "pass"],
    "suggestion": "此用例为不稳定测试（近10次中3次失败），建议排查环境依赖或增加重试"
  }
}
```

#### FR-H05: 趋势 API

| 端点 | 功能 | 参数 |
|------|------|------|
| `GET /api/trends/pass-rate` | 通过率趋势 | `days`, `suiteId` |
| `GET /api/trends/duration` | 执行时间趋势 | `days`, `suiteId`, `caseName` |
| `GET /api/trends/flaky` | Flaky 排行榜 | `topN`, `suiteId` |
| `GET /api/trends/failures` | 失败趋势 | `days`, `caseName` |
| `GET /api/runs` | 运行历史列表 | `limit`, `offset`, `status` |
| `GET /api/runs/:id` | 单次运行详情 | — |

#### FR-H06: MCP 新工具

| 工具 | 功能 | 输入 |
|------|------|------|
| `argus_history` | 查询历史运行记录 | `limit`, `status`, `since` |
| `argus_trends` | 获取趋势数据 | `metric` (pass-rate/duration/flaky), `days` |
| `argus_flaky` | 获取 Flaky Test 列表 | `topN`, `threshold` |
| `argus_compare` | 对比两次运行 | `runId1`, `runId2` |

**AI Agent 使用场景**：
```
Agent 跑测试 → 某个用例失败 → 调用 argus_flaky 查看该用例的 flaky score
→ flaky score = 0.3 → Agent 判定为 flaky → 选择忽略并继续
→ flaky score = 0 → Agent 判定为新 bug → 开始修复
```

#### FR-H07: Dashboard 趋势页面

新增 "趋势分析" 页面：
- 通过率折线图（按天/按周）
- 执行时间箱线图
- Flaky Test 排行表
- 最近失败的用例列表（可点击查看详情）
- 运行历史时间轴

### 涉及文件

| 操作 | 文件路径 |
|------|---------|
| NEW | `packages/core/src/history.ts` — HistoryStore (SQLite/Memory), FlakyDetector |
| NEW | `packages/core/src/history-schema.ts` — 数据库 schema 定义 |
| MOD | `packages/core/src/types.ts` — TestRun, TestCaseRun, FlakyInfo 类型 |
| MOD | `packages/core/src/config-loader.ts` — HistoryConfig schema |
| MOD | `packages/core/src/yaml-engine.ts` — 执行完成后写入 history |
| MOD | `packages/mcp/src/tools/run.ts` — 结果中包含 flaky 信息 |
| NEW | `packages/mcp/src/tools/history.ts` — argus_history |
| NEW | `packages/mcp/src/tools/trends.ts` — argus_trends, argus_flaky, argus_compare |
| MOD | `packages/dashboard/server/` — 新增趋势 API 路由 |
| NEW | `packages/dashboard/src/pages/Trends.tsx` — 趋势分析页面 |
| NEW | `packages/core/tests/unit/history.test.ts` |

### 验收标准

- AC-H01: 每次 `argus_run` 执行后，TestRun 和 TestCaseRun 自动写入 SQLite
- AC-H02: 同一用例在最近 10 次中 3 次失败、7 次通过时，flaky score = 0.3，level = FLAKY
- AC-H03: `argus_flaky` 返回按 flaky score 降序排列的用例列表
- AC-H04: `argus_trends` 返回过去 N 天的通过率趋势数据
- AC-H05: Dashboard 趋势页面正确展示折线图和排行榜

---

## 方向 ④ — 智能诊断建议（AI 学习能力）

### 问题陈述

当前的诊断系统是"无状态的"——每次失败都从零开始分析。不知道"上次也是这个问题，当时是这样修的"。

AI Agent 每次都要重新推理，效率低且容易重复犯错。

### 目标

1. 建立失败模式知识库，覆盖 80% 的常见失败场景
2. 新失败匹配到已知模式时，直接给出历史修复方案
3. Agent 修复成功后自动归档，持续提升知识库质量
4. 诊断准确率（匹配到正确模式的概率）> 70%

### 前置依赖

- 方向 ③ 的持久化层（需要存储失败模式和修复记录）

### 功能需求

#### FR-D01: 失败分类器（FailureClassifier）

自动将每次失败分类为以下类别：

| 类别 | 识别规则 | 典型原因 |
|------|---------|---------|
| `ASSERTION_MISMATCH` | expect 断言不匹配 | 代码逻辑变更、数据不一致 |
| `HTTP_ERROR` | 非预期 HTTP 状态码 | 服务端错误、路由未注册 |
| `TIMEOUT` | 请求或健康检查超时 | 服务启动慢、资源不足 |
| `CONNECTION_REFUSED` | ECONNREFUSED | 服务未启动、端口未监听 |
| `CONTAINER_OOM` | OOMKilled = true | 内存限制过低 |
| `CONTAINER_CRASH` | 非零退出码 | 启动脚本错误、依赖缺失 |
| `MOCK_MISMATCH` | Mock 未收到预期请求 | 请求路径/方法错误 |
| `CONFIG_ERROR` | 配置验证失败 | YAML 语法错误、必填字段缺失 |
| `NETWORK_ERROR` | 容器间通信失败 | 网络未创建、DNS 解析失败 |
| `UNKNOWN` | 无法分类 | 新型错误 |

分类规则实现为可扩展的规则链（Chain of Rules），每条规则检查特定条件。

#### FR-D02: 失败签名（Failure Signature）

为每次失败生成唯一签名，用于匹配历史记录：

```
signature = hash(category + caseName + errorPattern)
```

其中 `errorPattern` 是错误消息的规范化形式（移除动态部分如时间戳、ID）。

示例：
- `"POST /api/games returned 500"` → 规范化为 `"POST /api/* returned 5xx"`
- `"ECONNREFUSED 127.0.0.1:8080"` → 规范化为 `"ECONNREFUSED *:*"`

#### FR-D03: 修复知识库（FixKnowledgeBase）

存储结构：

```
FailurePattern {
  patternId: string (UUID)
  category: FailureCategory
  signaturePattern: string      # 签名匹配模式（支持通配符）
  description: string           # 人类可读描述
  suggestedFix: string          # 建议修复方向
  confidence: number            # 0-1，基于历史成功率
  occurrences: number           # 出现次数
  resolutions: number           # 成功修复次数
  lastSeen: ISO-8601
  createdAt: ISO-8601
  
  # 历史修复记录
  fixHistory: [{
    runId: string
    fixDescription: string      # Agent 或人类的修复描述
    fixSuccessful: boolean
    timestamp: ISO-8601
  }]
}
```

内置知识库（预置常见模式）：

| Pattern ID | Category | Signature | Suggested Fix |
|-----------|----------|-----------|---------------|
| `BUILTIN-001` | CONNECTION_REFUSED | `ECONNREFUSED *:*` | "服务可能未完全启动，尝试增加 healthcheck.startPeriod" |
| `BUILTIN-002` | TIMEOUT | `healthcheck timeout *` | "增加 healthcheck.timeout 和 retries，或检查服务启动日志" |
| `BUILTIN-003` | CONTAINER_OOM | `OOMKilled` | "增加容器内存限制 (container.resources.memory)" |
| `BUILTIN-004` | HTTP_ERROR | `* returned 5xx` | "检查容器日志中的异常堆栈，可能是未处理的错误" |
| `BUILTIN-005` | MOCK_MISMATCH | `mock * received 0 requests` | "检查请求路径和方法是否与 Mock 路由匹配" |
| `BUILTIN-006` | ASSERTION_MISMATCH | `expected * but got *` | "检查服务逻辑是否变更，或更新断言期望值" |

#### FR-D04: 诊断工作流

```
失败发生
    │
    ▼
FailureClassifier.classify(event)
    │ → category + signature
    ▼
FixKnowledgeBase.match(signature)
    │
    ├─ 匹配到 → 返回 { pattern, suggestedFix, confidence, history }
    │
    └─ 未匹配 → 创建新 pattern（category + signature + description）
    │
    ▼
增强的 AIFriendlyTestResult:
    {
      ...现有字段,
      failureCategory: "CONNECTION_REFUSED",
      knownPattern: {
        patternId: "BUILTIN-001",
        description: "服务启动后短时间内连接被拒绝",
        suggestedFix: "增加 healthcheck.startPeriod 时间",
        confidence: 0.85,
        occurrences: 12,
        similarResolutions: [
          { date: "2026-02-20", fix: "增加 startPeriod 到 30s", successful: true }
        ]
      }
    }
```

#### FR-D05: 修复反馈闭环

当 AI Agent 修复了一个失败并重新测试通过后：

1. Agent 调用 `argus_report_fix(runId, caseName, fixDescription)`
2. 系统匹配该失败的 pattern
3. 更新 pattern 的 `resolutions` 计数和 `confidence`
4. 将修复记录添加到 `fixHistory`

这样知识库的 confidence 会随着使用越来越准确。

#### FR-D06: MCP 新工具

| 工具 | 功能 |
|------|------|
| `argus_diagnose` | 主动分析指定失败，返回分类 + 历史匹配 + 修复建议 |
| `argus_report_fix` | Agent 修复成功后回报，归档到知识库 |
| `argus_patterns` | 查看知识库中的所有失败模式 |

### 涉及文件

| 操作 | 文件路径 |
|------|---------|
| NEW | `packages/core/src/failure-classifier.ts` — FailureClassifier |
| NEW | `packages/core/src/knowledge-base.ts` — FixKnowledgeBase |
| MOD | `packages/core/src/diagnostics.ts` — 集成分类器和知识库 |
| MOD | `packages/core/src/types.ts` — FailureCategory, FailurePattern 类型 |
| MOD | `packages/mcp/src/formatters/result-formatter.ts` — 增强输出 |
| NEW | `packages/mcp/src/tools/diagnose.ts` — argus_diagnose |
| NEW | `packages/mcp/src/tools/report-fix.ts` — argus_report_fix |
| NEW | `packages/core/tests/unit/failure-classifier.test.ts` |
| NEW | `packages/core/tests/unit/knowledge-base.test.ts` |

### 验收标准

- AC-D01: CONNECTION_REFUSED 错误自动分类为 `CONNECTION_REFUSED` 类别
- AC-D02: 已知模式的失败返回 suggestedFix 和 confidence
- AC-D03: Agent 通过 `argus_report_fix` 报告修复后，对应 pattern 的 confidence 更新
- AC-D04: 新型错误自动创建新 pattern，下次遇到时可匹配

---

## 方向 ⑤ — OpenAPI 智能 Mock

### 问题陈述

当前 Mock 服务完全手动定义，写多个接口很繁琐。且 Mock 不知道请求是否符合接口规范，无法帮助发现请求格式错误。

### 目标

1. 从 OpenAPI 3.x spec 一键生成 Mock 路由配置
2. 可选的请求验证模式，自动检测请求格式错误
3. 录制/回放模式，支持离线测试
4. 手动定义的路由可以覆盖自动生成的

### 功能需求

#### FR-M01: OpenAPI 解析器

支持 OpenAPI 3.0 和 3.1 规范：
- 解析 `paths`（端点和方法）
- 解析 `schemas`（请求/响应体结构）
- 解析 `parameters`（路径参数、查询参数、header）
- 支持 `$ref` 引用解析
- 支持 YAML 和 JSON 格式的 spec 文件

依赖选择：`@readme/openapi-parser` 或 `swagger-parser`

#### FR-M02: 自动 Mock 路由生成

从 OpenAPI spec 自动生成 Mock 路由：

```
OpenAPI Path + Method → Mock Route
OpenAPI Response Schema → Mock Response Body
OpenAPI Parameters → Route Parameters
```

响应体生成策略（优先级从高到低）：
1. 使用 schema 中的 `example` 字段
2. 使用 `examples` 对象中的第一个 example
3. 基于类型自动生成：

| Schema Type | 生成规则 |
|------------|---------|
| string | `"string_<fieldName>"` |
| string (format: uuid) | `"{{uuid}}"` |
| string (format: date-time) | `"{{timestamp}}"` |
| string (format: email) | `"user@example.com"` |
| number / integer | `42` |
| boolean | `true` |
| array | `[<item>, <item>]`（2 个元素） |
| object | 递归生成各字段 |

多状态码支持：
- 默认返回第一个 2xx 响应
- 可通过 `X-Mock-Status` header 切换响应状态码

#### FR-M03: 请求验证模式

开启 `validate: true` 后：

- 验证请求方法是否被 spec 允许
- 验证请求路径是否存在
- 验证请求体是否符合 schema
- 验证必填参数是否存在
- 验证参数类型是否正确

验证失败时返回 422：

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request body validation failed",
  "details": [
    {
      "path": "body.amount",
      "expected": "number",
      "actual": "string",
      "message": "Expected number, got string"
    }
  ]
}
```

#### FR-M04: 录制/回放模式

| 模式 | 行为 |
|------|------|
| `auto` | 使用自动生成的 Mock 响应 |
| `record` | 代理请求到真实 API，录制响应 |
| `replay` | 从录制文件回放响应 |
| `smart` | 有录制就回放，没有就自动生成 |

录制存储：

```
.mock-recordings/
├── payment-api/
│   ├── GET_api_users.json
│   ├── POST_api_users.json
│   └── GET_api_users_{id}.json
```

每个文件结构：

```json
{
  "request": {
    "method": "GET",
    "path": "/api/users/123",
    "headers": { ... },
    "query": { ... }
  },
  "response": {
    "status": 200,
    "headers": { ... },
    "body": { ... }
  },
  "recordedAt": "2026-02-26T10:00:00Z"
}
```

#### FR-M05: 手动覆盖

手动定义的 `overrides` 优先于自动生成的路由：

```yaml
mocks:
  payment-api:
    port: 9082
    openapi: ./specs/payment-api.yaml
    mode: auto
    validate: true
    overrides:
      - method: POST
        path: /api/charge
        response:
          status: 200
          body: { charged: true, transactionId: "{{uuid}}" }
      - method: POST
        path: /api/refund
        when:
          body:
            amount: { gt: 1000 }
        response:
          status: 400
          body: { error: "Amount too large" }
```

#### FR-M06: MCP 新工具

| 工具 | 功能 |
|------|------|
| `argus_mock_generate` | 从 OpenAPI spec 生成 Mock YAML 配置片段 |
| `argus_mock_validate` | 验证当前 Mock 配置是否覆盖 spec 中所有端点 |

### 涉及文件

| 操作 | 文件路径 |
|------|---------|
| NEW | `packages/core/src/openapi-mock.ts` — OpenAPI 解析 + Mock 生成 |
| NEW | `packages/core/src/mock-recorder.ts` — 录制/回放引擎 |
| MOD | `packages/core/src/mock-generator.ts` — 集成 OpenAPI Mock + 验证模式 |
| MOD | `packages/core/src/config-loader.ts` — 扩展 MockConfig schema |
| MOD | `packages/core/src/types.ts` — OpenAPIMockConfig 类型 |
| NEW | `packages/mcp/src/tools/mock-generate.ts` — argus_mock_generate |
| NEW | `packages/core/tests/unit/openapi-mock.test.ts` |
| NEW | `packages/core/tests/unit/mock-recorder.test.ts` |

### 验收标准

- AC-M01: 给定 OpenAPI spec，自动生成覆盖所有端点的 Mock 路由
- AC-M02: 开启 validate 后，格式错误的请求返回 422 + 详细错误信息
- AC-M03: record 模式正确录制请求/响应到文件
- AC-M04: replay 模式从文件正确回放响应
- AC-M05: overrides 中定义的路由覆盖自动生成的路由

---

## 方向 ⑥ — 性能基准测试

### 问题陈述

当前 ArgusAI 只关注"功能正确性"，不关注"性能"。接口响应时间从 50ms 涨到 500ms 不会触发任何报警。

### 目标

1. 自动采集 HTTP 请求的响应时间指标
2. 支持 YAML 中的性能断言（Performance Budget）
3. 基于历史数据的性能回归检测
4. 可选的简单负载测试能力

### 功能需求

#### FR-P01: 响应时间采集

在 YAML 引擎执行 HTTP 请求时自动记录：

```typescript
interface PerformanceMetrics {
  dnsLookupMs: number;
  tcpConnectionMs: number;
  ttfbMs: number;           // Time to First Byte
  totalResponseMs: number;
  bodySizeBytes: number;
}
```

使用 Node.js 内置的 `perf_hooks` 或 HTTP 请求的 timing 信息。

#### FR-P02: 性能断言（Performance Budget）

在 YAML 测试的 `expect` 中新增 `performance` 断言：

```yaml
cases:
  - name: "获取用户列表"
    request:
      method: GET
      path: /api/users
    expect:
      status: 200
      performance:
        responseTime: { lt: "200ms" }
        ttfb: { lt: "100ms" }
        bodySize: { lt: "50KB" }
```

支持的断言操作符：`lt`, `lte`, `gt`, `gte`

单位支持：`ms`, `s`（时间）；`B`, `KB`, `MB`（大小）

性能断言失败不同于功能断言：
- 功能断言失败 = FAIL
- 性能断言失败 = PERF_WARNING（默认）或 PERF_FAIL（配置 `strict: true`）

#### FR-P03: 性能基准线与回归检测

自动基准线：
- 取最近 5 次成功运行的 p50 和 p95 作为 baseline
- 存储在 history 数据库中

回归检测：
- 当本次响应时间 > baseline p95 × regressionThreshold（默认 1.5）时标记 PERF_REGRESSION
- 在测试结果中标记，让 AI Agent 可以决定是否处理

```yaml
performance:
  baseline:
    enabled: true
    windowSize: 5             # 基准线取最近 N 次
    regressionThreshold: 1.5  # 超过 p95 的 150% 视为回归
    strictMode: false         # true = 回归导致测试失败
```

#### FR-P04: 简单负载测试（P3，后续扩展）

支持 `load` 步骤类型：

```yaml
cases:
  - name: "创建游戏接口压测"
    load:
      method: POST
      path: /api/games
      body: { name: "load-test-{{index}}" }
      concurrent: 10
      iterations: 100
      rampUp: "5s"            # 逐步增加并发
    expect:
      performance:
        p50: { lt: "100ms" }
        p95: { lt: "500ms" }
        p99: { lt: "1s" }
        errorRate: { lt: 0.01 }
        throughput: { gt: 50 }  # req/s
```

#### FR-P05: MCP 新工具

| 工具 | 功能 |
|------|------|
| `argus_perf_report` | 获取性能报告（响应时间统计 + 回归检测） |
| `argus_perf_baseline` | 查看/重置性能基准线 |

#### FR-P06: 性能数据在结果中的体现

每个测试用例的结果增加性能信息：

```json
{
  "caseName": "获取用户列表",
  "status": "pass",
  "performance": {
    "responseTimeMs": 150,
    "ttfbMs": 80,
    "bodySizeBytes": 12580,
    "baseline": {
      "p50": 120,
      "p95": 180
    },
    "regression": false,
    "budgetViolations": []
  }
}
```

### 涉及文件

| 操作 | 文件路径 |
|------|---------|
| NEW | `packages/core/src/perf-engine.ts` — 性能采集、基准线、回归检测 |
| MOD | `packages/core/src/yaml-engine.ts` — HTTP 请求时采集性能指标 |
| MOD | `packages/core/src/assertion-engine.ts` — 支持 performance 断言 |
| MOD | `packages/core/src/config-loader.ts` — PerformanceConfig schema |
| MOD | `packages/core/src/types.ts` — PerformanceMetrics, PerfBudget 类型 |
| NEW | `packages/mcp/src/tools/perf.ts` — argus_perf_report, argus_perf_baseline |
| NEW | `packages/core/tests/unit/perf-engine.test.ts` |

### 验收标准

- AC-P01: HTTP 请求自动记录 responseTimeMs 和 ttfbMs
- AC-P02: `performance.responseTime: { lt: "200ms" }` 断言在超过 200ms 时产生警告
- AC-P03: 基于最近 5 次运行的 p95 自动检测性能回归
- AC-P04: 性能信息出现在 MCP 返回的测试结果中

---

## 方向 ⑦ — 多项目隔离与团队协作

### 问题陈述

当前 ArgusAI 是单机单用户模式。多人同时测试会端口冲突、资源争抢。测试结果不能在团队间共享。

### Level 1: 本地多项目隔离（P1）

#### FR-T01: 资源命名空间

所有 Docker 资源使用 project name 作为命名空间前缀：

- 容器名：`argusai-<project>-<service>`
- 网络名：`argusai-<project>-network`
- Label：`argusai.project=<project>`, `argusai.session=<session-id>`

#### FR-T02: 端口自动分配

当多个项目同时运行时：

- 每个项目维护独立的端口分配器
- 端口范围可配置（默认 9000-9999）
- 已分配的端口记录在 session 中，防止冲突
- 新项目 setup 时检测已占用端口并跳过

```yaml
isolation:
  portRange: [9000, 9999]     # 端口分配范围
  namespace: "my-project"      # 自定义命名空间（默认用 project.name）
```

#### FR-T03: 并行测试安全

- 不同项目可以同时 setup/run 而不互相干扰
- 使用 file lock 防止同一项目的并发 setup
- ResourceLimiter 扩展为跨项目感知

#### FR-T04: 资源使用报告

新增查看所有 ArgusAI 管理的资源的能力：

- `argus_resources` MCP 工具：列出所有项目的容器、网络、端口占用
- Dashboard 中的资源概览页

### Level 2: 远程团队协作（P3）

#### FR-T05: ArgusAI Server 模式

新增 `packages/server/` 包：
- HTTP API 暴露所有 ArgusAI 操作
- 多个 MCP client 可以连接同一 Server
- Server 统一管理 Docker 资源
- WebSocket 支持实时事件推送

#### FR-T06: 测试环境共享

- 一个人 setup 后，其他人可以对同一环境执行测试
- 环境状态广播（谁 setup 了、当前状态、最后测试时间）
- 环境锁定（某人在跑测试时，其他人排队等待）

#### FR-T07: 结果推送到企微

集成 hil-mcp 已有基础设施：
- 测试完成后自动推送摘要到企微群
- 失败时 @相关开发者
- 定期报告（每日/每周测试摘要）

配置：

```yaml
notifications:
  wecom:
    enabled: true
    chatId: "your-chat-id"
    onFailure: true           # 失败时通知
    onSuccess: false          # 成功时通知
    dailyReport: true         # 每日摘要
    mentionOnFailure: ["user1", "user2"]  # 失败时 @
```

#### FR-T08: 权限控制

| 角色 | 能力 |
|------|------|
| admin | 配置环境、清理资源、管理用户 |
| developer | 运行测试、查看结果、查看日志 |
| viewer | 查看结果、查看趋势 |

### 涉及文件

**Level 1**：

| 操作 | 文件路径 |
|------|---------|
| MOD | `packages/core/src/docker-engine.ts` — 命名空间 label |
| MOD | `packages/core/src/orchestrator.ts` — 命名空间感知 |
| NEW | `packages/core/src/port-allocator.ts` — 端口分配器 |
| MOD | `packages/core/src/resource-limiter.ts` — 跨项目资源限制 |
| MOD | `packages/core/src/config-loader.ts` — IsolationConfig schema |
| NEW | `packages/mcp/src/tools/resources.ts` — argus_resources |
| NEW | `packages/core/tests/unit/port-allocator.test.ts` |

**Level 2**（P3，后续细化）：

| 操作 | 文件路径 |
|------|---------|
| NEW | `packages/server/` — ArgusAI HTTP Server 包 |
| NEW | `packages/core/src/wecom-notifier.ts` — 企微通知集成 |

### 验收标准

**Level 1**：
- AC-T01: 两个项目同时 setup 时，容器名和网络名不冲突
- AC-T02: 端口自动分配避免冲突
- AC-T03: `argus_resources` 正确列出所有项目的资源使用情况

---

## 实施时间线（建议）

```
Week 1-2:  方向② 错误恢复与自愈
Week 3-4:  方向③ 测试持久化与 Flaky 识别
Week 5:    方向⑦-L1 多项目隔离
Week 6-7:  方向④ 智能诊断建议
Week 8-9:  方向⑤ OpenAPI 智能 Mock
Week 10:   方向⑥-L1 性能预算
Week 11+:  方向⑥-L2 负载测试 + 方向⑦-L2 团队协作（根据需求优先级）
```

## 依赖关系

```
② 错误恢复 ← （无依赖，可立即开始）
③ 持久化   ← （无依赖，可与②并行）
⑦-L1 隔离  ← （无依赖，可与②③并行）
④ 智能诊断 ← 依赖 ③ 持久化层
⑤ Mock     ← （无依赖，但建议在②③之后）
⑥ 性能     ← 依赖 ③ 持久化层（基准线存储）
⑦-L2 协作  ← 依赖 ③④⑦-L1
```

---

## Appendix: 新增 MCP 工具汇总

| 工具 | 方向 | 功能 |
|------|------|------|
| `argus_preflight_check` | ② | 环境预检报告 |
| `argus_reset_circuit` | ② | 重置 Docker 熔断器 |
| `argus_history` | ③ | 查询历史运行记录 |
| `argus_trends` | ③ | 获取趋势数据 |
| `argus_flaky` | ③ | Flaky Test 列表 |
| `argus_compare` | ③ | 对比两次运行 |
| `argus_diagnose` | ④ | 智能失败诊断 |
| `argus_report_fix` | ④ | 回报修复结果 |
| `argus_patterns` | ④ | 查看失败模式知识库 |
| `argus_mock_generate` | ⑤ | 从 OpenAPI 生成 Mock |
| `argus_mock_validate` | ⑤ | Mock 覆盖度检查 |
| `argus_perf_report` | ⑥ | 性能报告 |
| `argus_perf_baseline` | ⑥ | 性能基准线管理 |
| `argus_resources` | ⑦ | 资源使用概览 |

共计 14 个新 MCP 工具（现有 9 个 + 新增 14 个 = 23 个）。
