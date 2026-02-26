// ==================== 配置类型 ====================

/** 健康检查配置 */
export interface HealthcheckConfig {
  /** HTTP 健康检查路径 */
  path: string;
  /** 检查间隔 */
  interval?: string;
  /** 超时时间 */
  timeout?: string;
  /** 重试次数 */
  retries?: number;
  /** 启动等待期 */
  startPeriod?: string;
}

/** 服务构建配置 */
export interface ServiceBuildConfig {
  /** Dockerfile 路径 */
  dockerfile: string;
  /** 构建上下文 */
  context: string;
  /** 镜像名（支持变量） */
  image: string;
  /** 构建参数 */
  args?: Record<string, string>;
}

/** 服务容器配置 */
export interface ServiceContainerConfig {
  /** 容器名 */
  name: string;
  /** 端口映射 host:container */
  ports: string[];
  /** 环境变量 */
  environment?: Record<string, string>;
  /** Volume 挂载 */
  volumes?: string[];
  /** 健康检查 */
  healthcheck?: HealthcheckConfig;
}

/** 服务配置 */
export interface ServiceConfig {
  build: ServiceBuildConfig;
  container: ServiceContainerConfig;
  /** 自定义变量 */
  vars?: Record<string, string>;
}

/** Mock 路由配置 */
export interface MockRouteConfig {
  method: string;
  path: string;
  response: {
    status: number;
    headers?: Record<string, string>;
    body: unknown;
    delay?: string;
  };
  when?: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  };
}

/** Mock 服务配置 */
export interface MockServiceConfig {
  /** 宿主机端口 */
  port: number;
  /** 容器内端口 */
  containerPort?: number;
  /** Mock 路由 */
  routes?: MockRouteConfig[];
  /** 或使用已有镜像 */
  image?: string;
}

/** 测试套件配置 */
export interface TestSuiteConfig {
  name: string;
  id: string;
  /** 测试文件路径 */
  file?: string;
  /** 运行器类型 (yaml, vitest, pytest, shell, exec, playwright) */
  runner?: string;
  /** 自定义命令 */
  command?: string;
  /** Vitest 配置文件 */
  config?: string;
  /** Suite-level retry policy override */
  retry?: RetryPolicy;
  /** Enable parallel execution for this suite */
  parallel?: boolean;
  /** Maximum concurrency for this suite's cases */
  concurrency?: number;
}

/** 预定义 API 端点 */
export interface PresetEndpoint {
  method: string;
  path: string;
  name: string;
  body?: unknown;
}

/** 预定义 API 端点分组 */
export interface PresetGroup {
  group: string;
  endpoints: PresetEndpoint[];
}

/** Git 仓库配置 */
export interface RepoConfig {
  name: string;
  /** 本地路径（相对于 e2e.yaml 目录） */
  path?: string;
  /** 远程仓库 URL（SSH 或 HTTPS） */
  url?: string;
  /** 默认分支名（远程仓库模式使用） */
  branch?: string;
}

/** Dashboard 配置 */
export interface DashboardConfig {
  port: number;
  uiPort?: number;
  /** 预定义 API 端点 */
  presets?: PresetGroup[];
  /** 环境变量编辑器默认值 */
  envDefaults?: Record<string, string>;
  /** 容器内默认浏览目录 */
  defaultDirs?: string[];
}

/** 网络配置 */
export interface NetworkConfig {
  name: string;
}

/** 顶层配置 */
export interface E2EConfig {
  version: string;
  project: { name: string; description?: string; version?: string };
  /** Single service (backward compatible) */
  service?: ServiceConfig;
  /** Multiple services (new, takes precedence over service) */
  services?: ServiceDefinition[];
  mocks?: Record<string, MockServiceConfig>;
  tests?: {
    suites: TestSuiteConfig[];
    /** Global retry policy (applies to all cases without case-level retry) */
    retry?: RetryPolicy;
    /** Global parallel execution config */
    parallel?: ParallelConfig;
  };
  dashboard?: DashboardConfig;
  network?: NetworkConfig;
  /** Git 仓库列表（用于分支选择与构建前 checkout） */
  repos?: RepoConfig[];
}

// ==================== 测试类型 ====================

/** 文件断言配置 */
export interface FileAssertConfig {
  /** 容器内文件路径 */
  path: string;
  /** 覆盖默认容器名 */
  container?: string;
  /** 断言文件存在 */
  exists?: boolean;
  /** 断言文件内容包含 */
  contains?: string | string[];
  /** 断言文件内容不包含 */
  notContains?: string | string[];
  /** 正则匹配文件内容 */
  matches?: string;
  /** 解析为 JSON 并断言字段 */
  json?: Record<string, unknown>;
  /** 检查文件权限（如 "-rwxr-xr-x"） */
  permissions?: string;
  /** 检查文件所有者 */
  owner?: string;
  /** 检查文件大小（支持 ">0", "<1024" 等） */
  size?: string;
}

/** 进程断言配置 */
export interface ProcessAssertConfig {
  /** 进程名或匹配模式（用于 grep） */
  name: string;
  /** 覆盖默认容器名 */
  container?: string;
  /** 断言进程是否在运行 */
  running?: boolean;
  /** 断言进程数量 */
  count?: string; // e.g. ">0", "==1", ">=2"
  /** 断言进程用户 */
  user?: string;
}

/** 端口断言配置 */
export interface PortAssertConfig {
  /** 要检查的端口号 */
  port: number;
  /** 主机名（默认 localhost） */
  host?: string;
  /** 覆盖默认容器名 */
  container?: string;
  /** 断言端口是否监听 */
  listening?: boolean;
  /** 超时时间（默认 5s） */
  timeout?: string;
}

/** YAML 测试用例步骤 */
export interface TestStep {
  name: string;
  /** 请求前延迟 */
  delay?: string;
  /** HTTP 请求 */
  request?: {
    method: string;
    path: string;
    /** 可选：使用完整 URL 替代 baseUrl + path */
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: string;
  };
  /** 容器内命令执行 */
  exec?: {
    command: string;
    /** 覆盖默认容器名 */
    container?: string;
  };
  /** 容器内文件断言（语义化，底层使用 docker exec） */
  file?: FileAssertConfig;
  /** 容器内进程断言 */
  process?: ProcessAssertConfig;
  /** 端口监听断言 */
  port?: PortAssertConfig;
  expect?: {
    status?: number | number[];
    headers?: Record<string, unknown>;
    body?: Record<string, unknown>;
    /** exec 步骤的输出断言 */
    output?: {
      /** 输出包含指定字符串 */
      contains?: string | string[];
      /** 输出不包含指定字符串 */
      notContains?: string | string[];
      /** 正则匹配 */
      matches?: string;
      /** 将输出解析为 JSON 并断言 */
      json?: Record<string, unknown>;
      /** 输出行数断言 e.g. ">0" */
      length?: string;
    };
    /** exec 步骤的退出码断言 */
    exitCode?: number;
    /** 表达式断言 - 简易 CEL 风格 */
    expr?: string | string[];
    /** 复合断言 - 全部通过 (AND) */
    all?: Array<Record<string, unknown>>;
    /** 复合断言 - 任一通过 (OR) */
    any?: Array<Record<string, unknown>>;
  };
  /** 保存响应变量 */
  save?: Record<string, string>;
  /** 忽略错误继续执行 */
  ignoreError?: boolean;
  /** Per-case retry policy (overrides global and suite-level) */
  retry?: RetryPolicy;
}

/** YAML 测试套件定义 */
export interface YAMLTestSuite {
  name: string;
  description?: string;
  sequential?: boolean;
  variables?: Record<string, string>;
  setup?: Array<TestStep | { waitHealthy?: { timeout?: string } } | { waitForPort?: { host?: string; port: number; timeout?: string } } | { delay?: string }>;
  teardown?: Array<TestStep & { ignoreError?: boolean }>;
  cases: TestStep[];
}

// ==================== AI-Native Types ====================

/** Structured test result enriched with full diagnostic context for AI consumption. */
export interface AIFriendlyTestResult {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  timestamp: number;

  failure?: {
    error: string;
    summary: string;
    suggestedFix?: string;

    request?: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: unknown;
    };

    response?: {
      status: number;
      headers: Record<string, string>;
      body?: unknown;
    };

    assertions: AssertionResult[];
    diagnostics: DiagnosticReport;
  };

  attempts?: AttemptResult[];
}

/** Container and environment diagnostic data collected on test failure. */
export interface DiagnosticReport {
  containerLogs: Array<{
    containerName: string;
    lines: string[];
    lineCount: number;
  }>;

  containerHealth: Array<{
    containerName: string;
    status: ContainerStatus;
    healthLog?: string;
  }>;

  mockRequests: Array<{
    mockName: string;
    requests: Array<{
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
      timestamp: string;
    }>;
  }>;

  networkInfo?: {
    networkName: string;
    connectedContainers: string[];
  };

  collectedAt: number;
}

/** Configuration for test case retry behavior. */
export interface RetryPolicy {
  maxAttempts: number;
  delay: string;
  backoff?: 'linear' | 'exponential';
  backoffMultiplier?: number;
}

/** Result of a single retry attempt. */
export interface AttemptResult {
  attempt: number;
  passed: boolean;
  error?: string;
  duration: number;
  timestamp: number;
}

/** Configuration for a single service in multi-service orchestration. */
export interface ServiceDefinition {
  name: string;
  build: ServiceBuildConfig;
  container: ServiceContainerConfig;
  vars?: Record<string, string>;
  dependsOn?: string[];
}

/** Suite-level parallel execution configuration. */
export interface ParallelConfig {
  enabled: boolean;
  concurrency?: number;
}

// ==================== 测试事件 ====================

export type TestEvent =
  | { type: 'suite_start'; suite: string; timestamp: number }
  | { type: 'case_start'; suite: string; name: string; timestamp: number }
  | { type: 'case_pass'; suite: string; name: string; duration: number; timestamp: number;
      attempts?: AttemptResult[] }
  | { type: 'case_fail'; suite: string; name: string; error: string; duration: number;
      timestamp: number; diagnostics?: DiagnosticReport; attempts?: AttemptResult[];
      request?: { method: string; url: string; headers: Record<string, string>; body?: unknown };
      response?: { status: number; headers: Record<string, string>; body?: unknown };
      assertions?: AssertionResult[] }
  | { type: 'case_skip'; suite: string; name: string; reason?: string; timestamp: number }
  | { type: 'suite_end'; suite: string; passed: number; failed: number; skipped: number; duration: number; timestamp: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; timestamp: number };

// ==================== 断言 ====================

export interface AssertionResult {
  path: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}

// ==================== 测试运行器 ====================

export interface RunConfig {
  cwd: string;
  target: string;
  env: Record<string, string>;
  timeout: number;
}

export interface TestRunner {
  id: string;
  run(config: RunConfig): AsyncGenerator<TestEvent>;
  available(): Promise<boolean>;
}

// ==================== Docker ====================

export type BuildEvent =
  | { type: 'build_start'; image: string; timestamp: number }
  | { type: 'build_log'; line: string; stream: 'stdout' | 'stderr'; timestamp: number }
  | { type: 'build_end'; success: boolean; duration: number; error?: string; timestamp: number };

export type ContainerStatus = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | 'unknown';

export type ContainerEvent =
  | { type: 'container_start'; name: string; timestamp: number }
  | { type: 'container_healthy'; name: string; timestamp: number }
  | { type: 'container_stop'; name: string; timestamp: number }
  | { type: 'container_log'; name: string; line: string; stream: 'stdout' | 'stderr'; timestamp: number }
  | { type: 'container_error'; name: string; error: string; timestamp: number };

// ==================== Setup/Clean 生命周期事件 ====================

export type SetupEvent =
  | { type: 'setup_start'; project: string; timestamp: number }
  | { type: 'network_created'; name: string; timestamp: number }
  | { type: 'mock_starting'; name: string; port: number; timestamp: number }
  | { type: 'mock_started'; name: string; port: number; timestamp: number }
  | { type: 'service_starting'; name: string; image: string; timestamp: number }
  | { type: 'service_healthy'; name: string; duration: number; timestamp: number }
  | { type: 'setup_end'; duration: number; success: boolean; error?: string; timestamp: number };

export type CleanEvent =
  | { type: 'clean_start'; project: string; timestamp: number }
  | { type: 'container_removing'; name: string; timestamp: number }
  | { type: 'container_removed'; name: string; timestamp: number }
  | { type: 'mock_stopped'; name: string; timestamp: number }
  | { type: 'network_removed'; name: string; timestamp: number }
  | { type: 'clean_end'; duration: number; timestamp: number };

/** Unified event type spanning all lifecycle phases. */
export type PreflightEvent = TestEvent | BuildEvent | ContainerEvent | SetupEvent | CleanEvent;

/** Preflight event channels for the SSE bus. */
export type PreflightChannel = 'test' | 'build' | 'container' | 'setup' | 'clean' | 'activity';

/** Entry in the activity timeline — tracks a single high-level operation. */
export interface ActivityEntry {
  id: string;
  source: 'ai' | 'manual' | 'system';
  operation: string;
  project: string;
  status: 'running' | 'success' | 'failed';
  startTime: number;
  endTime?: number;
  detail?: string;
}

// ==================== SSE ====================

export interface SSEMessage {
  event: string;
  data: unknown;
}

export interface SSEBus {
  emit(channel: string, message: SSEMessage): void;
  subscribe(channel: string, handler: (msg: SSEMessage) => void): () => void;
}

// ==================== Reporter ====================

export interface SuiteReport {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  cases: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
    attempts?: AttemptResult[];
    diagnostics?: DiagnosticReport;
  }>;
}

export interface TestReport {
  project: string;
  timestamp: number;
  duration: number;
  suites: SuiteReport[];
  totals: { passed: number; failed: number; skipped: number };
}

export interface Reporter {
  id: string;
  onEvent(event: TestEvent): void;
  generate(): TestReport;
}

// ==================== 变量上下文 ====================

export interface VariableContext {
  /** 从配置获取的变量 */
  config: Record<string, string>;
  /** 运行时变量（save 保存的） */
  runtime: Record<string, string>;
  /** 环境变量 */
  env: Record<string, string>;
}
