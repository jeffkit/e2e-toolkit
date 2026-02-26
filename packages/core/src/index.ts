// argusai-core - 核心引擎

// Types
export * from './types.js';

// Config Loader
export {
  loadConfig,
  E2EConfigSchema,
  RetryPolicySchema,
  ParallelConfigSchema,
  ServiceDefinitionSchema,
  TestSuiteSchema,
} from './config-loader.js';
export type { ValidatedE2EConfig } from './config-loader.js';

// Variable Resolver
export {
  resolveVariables,
  resolveObjectVariables,
  createVariableContext,
} from './variable-resolver.js';

// Assertion Engine
export {
  assertBody,
  assertStatus,
  assertHeaders,
} from './assertion-engine.js';

// Docker Engine
export {
  buildImage,
  buildImageStreaming,
  startContainer,
  stopContainer,
  getContainerStatus,
  isContainerRunning,
  getContainerLogs,
  execInContainer,
  ensureNetwork,
  removeNetwork,
  waitForHealthy,
  isPortInUse,
  isPortInUseSync,
  getContainerInfo,
  streamContainerLogs,
  buildBuildArgs,
  buildRunArgs,
} from './docker-engine.js';
export type { DockerBuildOptions, DockerRunOptions } from './docker-engine.js';
export { getDockerHostArgs, isDockerRemote } from './docker-engine.js';

// YAML Engine
export {
  loadYAMLTests,
  parseTime,
  executeYAMLSuite,
  executeSuitesWithParallel,
} from './yaml-engine.js';
export type { YAMLEngineOptions, SuiteExecutionConfig } from './yaml-engine.js';

// Test Runner
export { RunnerRegistry, createDefaultRegistry } from './test-runner.js';

// Runners
export { YAMLRunner } from './runners/yaml-runner.js';
export { VitestRunner } from './runners/vitest-runner.js';
export { ShellRunner } from './runners/shell-runner.js';
export { ExecRunner } from './runners/exec-runner.js';
export { PytestRunner } from './runners/pytest-runner.js';
export { PlaywrightRunner } from './runners/playwright-runner.js';

// Diagnostics
export { DiagnosticCollector } from './diagnostics.js';
export type { DiagnosticCollectorOptions } from './diagnostics.js';

// Schema Generator
export {
  generateSchemas,
  getE2EConfigJsonSchema,
  getTestSuiteJsonSchema,
} from './schema-generator.js';

// Retry Engine
export {
  RetryExecutor,
  resolveRetryPolicy,
  parseDelay,
  computeBackoffDelay,
} from './retry-engine.js';
export type { RetryResult } from './retry-engine.js';

// Parallel Suite Executor
export { ParallelSuiteExecutor } from './parallel-engine.js';
export type {
  ParallelSuiteConfig,
  ParallelExecutorOptions,
} from './parallel-engine.js';

// Multi-Service Orchestrator
export { MultiServiceOrchestrator } from './orchestrator.js';
export type {
  OrchestratorServiceResult,
  BuildAllResult,
  CleanAllResult,
} from './orchestrator.js';

// Mock Generator
export { createMockServer, resolveResponseTemplate } from './mock-generator.js';

// SSE Bus
export { EventBus, createEventBus } from './sse-bus.js';
export type { PreflightEvent, PreflightChannel, SetupEvent, CleanEvent, ActivityEntry } from './types.js';

// Resource Limiter
export {
  Semaphore,
  ResourceLimiter,
  buildResourceArgs,
} from './resource-limiter.js';
export type {
  ResourceLimits,
  ProjectResourceState,
  ResourceLimiterOptions,
} from './resource-limiter.js';

// Runtime (container execution abstraction)
export {
  DockerRuntime,
  KubernetesRuntime,
  createRuntime,
} from './runtime.js';
export type {
  ContainerRuntime,
  RuntimeBuildOptions,
  RuntimeRunOptions,
  RuntimeExecResult,
  RuntimeType,
  RuntimeConfig,
  K8sRuntimeOptions,
} from './runtime.js';

// Notifier
export {
  Notifier,
  ConsoleNotifier,
  WebhookNotifier,
  createNotifier,
} from './notifier.js';
export type {
  Notification,
  NotificationLevel,
  NotificationChannel,
  NotifierOptions,
  NotifierConfig,
  WebhookNotifierOptions,
} from './notifier.js';

// Task Queue
export { TaskQueue } from './task-queue.js';
export type { TaskEntry, TaskQueueOptions, TaskQueueEvent, QueueStats, TaskStatus, TaskFn } from './task-queue.js';

// Store (persistence layer)
export {
  MemoryStore,
  FileStore,
  createStore,
} from './store.js';
export type { Store, StoreOptions, TestRecord, BuildRecord, ActivityRecord } from './store.js';

// Reporter
export { ConsoleReporter, JSONReporter, HTMLReporter } from './reporter.js';

// Workspace Manager
export {
  getWorkspacePath,
  resolveRepoLocalPath,
  getRepoInfo,
  syncRepo,
  syncAllRepos,
  getWorkspaceInfo,
  resolveBuildPaths,
} from './workspace.js';
export type { RepoInfo, WorkspaceInfo, SyncResult } from './workspace.js';
