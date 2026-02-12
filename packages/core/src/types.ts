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
  /** 运行器类型 */
  runner?: string;
  /** 自定义命令 */
  command?: string;
  /** Vitest 配置文件 */
  config?: string;
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
  service: ServiceConfig;
  mocks?: Record<string, MockServiceConfig>;
  tests?: { suites: TestSuiteConfig[] };
  dashboard?: DashboardConfig;
  network?: NetworkConfig;
  /** Git 仓库列表（用于分支选择与构建前 checkout） */
  repos?: RepoConfig[];
}

// ==================== 测试类型 ====================

/** YAML 测试用例步骤 */
export interface TestStep {
  name: string;
  /** 请求前延迟 */
  delay?: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: string;
  };
  expect?: {
    status?: number | number[];
    headers?: Record<string, unknown>;
    body?: Record<string, unknown>;
  };
  /** 保存响应变量 */
  save?: Record<string, string>;
}

/** YAML 测试套件定义 */
export interface YAMLTestSuite {
  name: string;
  description?: string;
  sequential?: boolean;
  variables?: Record<string, string>;
  setup?: Array<TestStep | { waitHealthy?: { timeout?: string } } | { delay?: string }>;
  teardown?: Array<TestStep & { ignoreError?: boolean }>;
  cases: TestStep[];
}

// ==================== 测试事件 ====================

export type TestEvent =
  | { type: 'suite_start'; suite: string; timestamp: number }
  | { type: 'case_start'; suite: string; name: string; timestamp: number }
  | { type: 'case_pass'; suite: string; name: string; duration: number; timestamp: number }
  | { type: 'case_fail'; suite: string; name: string; error: string; duration: number; timestamp: number }
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
