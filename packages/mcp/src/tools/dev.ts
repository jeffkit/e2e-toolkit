/**
 * @module tools/dev
 * argus_dev — One-step start for manual testing.
 *
 * Combines init → build → setup into a single command, returning
 * developer-friendly access URLs instead of raw build/setup details.
 * Reuses a healthy existing session when possible.
 */

import { loadConfig } from 'argusai-core';
import type { E2EConfig } from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';
import { handleClean } from './clean.js';
import { handleInit } from './init.js';
import { handleBuild, type BuildResult } from './build.js';
import { handleSetup, type SetupResult } from './setup.js';
import { handleStatus, type StatusResult } from './status.js';
import type { PlatformServices } from '../server.js';

export interface DevEndpoint {
  name: string;
  url: string;
  healthCheck?: string;
  status: 'healthy' | 'running' | 'unhealthy' | 'failed';
}

export interface DevMock {
  name: string;
  url: string;
  routeCount: number;
  status: 'running' | 'failed';
}

export interface DevResult {
  status: 'ready' | 'partial' | 'failed';
  endpoints: DevEndpoint[];
  mocks: DevMock[];
  hints: string[];
  details: {
    buildDuration: number;
    setupDuration: number;
    totalDuration: number;
    skippedBuild: boolean;
    reusedSession: boolean;
  };
}

function buildEndpoints(setupResult: SetupResult, config: E2EConfig): DevEndpoint[] {
  return setupResult.services.map(svc => {
    const hostPort = svc.ports[0]?.host;
    const url = hostPort ? `http://localhost:${hostPort}` : '';

    let healthCheckPath: string | undefined;
    if (config.services) {
      const def = config.services.find(s => s.container.name === svc.name);
      healthCheckPath = def?.container.healthcheck?.path;
    } else if (config.service?.container.name === svc.name) {
      healthCheckPath = config.service.container.healthcheck?.path;
    }

    return {
      name: svc.name,
      url,
      healthCheck: healthCheckPath && url ? `${url}${healthCheckPath}` : undefined,
      status: svc.status === 'healthy' || svc.status === 'running' ? svc.status : svc.status,
    };
  });
}

function buildEndpointsFromStatus(statusResult: StatusResult, config: E2EConfig): DevEndpoint[] {
  return statusResult.services.map(svc => {
    const hostPort = svc.ports[0]?.host;
    const url = hostPort ? `http://localhost:${hostPort}` : '';

    let healthCheckPath: string | undefined;
    if (config.services) {
      const def = config.services.find(s => s.container.name === svc.name);
      healthCheckPath = def?.container.healthcheck?.path;
    } else if (config.service?.container.name === svc.name) {
      healthCheckPath = config.service.container.healthcheck?.path;
    }

    const isRunning = svc.status === 'running' && svc.ports.every(p => p.accessible);
    return {
      name: svc.name,
      url,
      healthCheck: healthCheckPath && url ? `${url}${healthCheckPath}` : undefined,
      status: isRunning ? 'running' as const : 'unhealthy' as const,
    };
  });
}

function buildMocksFromSetup(setupResult: SetupResult): DevMock[] {
  return setupResult.mocks.map(m => ({
    name: m.name,
    url: `http://localhost:${m.port}`,
    routeCount: m.routeCount,
    status: m.status,
  }));
}

function buildMocksFromStatus(statusResult: StatusResult): DevMock[] {
  return statusResult.mocks.map(m => ({
    name: m.name,
    url: `http://localhost:${m.port}`,
    routeCount: 0,
    status: m.status === 'running' ? 'running' as const : 'failed' as const,
  }));
}

function buildHints(status: DevResult['status'], endpoints: DevEndpoint[], mocks: DevMock[]): string[] {
  const hints: string[] = [];

  if (status === 'ready') {
    const mainUrl = endpoints.find(e => e.status === 'healthy' || e.status === 'running')?.url;
    if (mainUrl) {
      hints.push(`服务已就绪，可访问 ${mainUrl}`);
    }
    if (mocks.length > 0) {
      const mockList = mocks.filter(m => m.status === 'running').map(m => `${m.name} → ${m.url}`).join(', ');
      if (mockList) {
        hints.push(`Mock 依赖服务已启动: ${mockList}`);
      }
    }
  } else if (status === 'partial') {
    hints.push('部分服务未能正常启动，请检查日志 (argus_logs)');
  } else {
    hints.push('服务启动失败，请查看日志排查问题 (argus_logs)');
  }

  hints.push('手动测试完成后，请调用 argus_clean 清理环境');
  return hints;
}

function deriveStatus(endpoints: DevEndpoint[]): DevResult['status'] {
  if (endpoints.length === 0) return 'failed';
  const allGood = endpoints.every(e => e.status === 'healthy' || e.status === 'running');
  if (allGood) return 'ready';
  const anyGood = endpoints.some(e => e.status === 'healthy' || e.status === 'running');
  return anyGood ? 'partial' : 'failed';
}

export async function handleDev(
  params: {
    projectPath: string;
    configFile?: string;
    noCache?: boolean;
    skipBuild?: boolean;
  },
  sessionManager: SessionManager,
  platform?: PlatformServices,
): Promise<DevResult> {
  const totalStart = Date.now();
  let buildDuration = 0;
  let setupDuration = 0;

  // Fast path: reuse an existing healthy session
  if (sessionManager.has(params.projectPath)) {
    try {
      const existing = sessionManager.getOrThrow(params.projectPath);
      if (existing.state === 'running') {
        const statusResult = await handleStatus({ projectPath: params.projectPath }, sessionManager);
        const allAccessible = statusResult.services.length > 0 &&
          statusResult.services.every(s => s.status === 'running' && s.ports.every(p => p.accessible));

        if (allAccessible) {
          const endpoints = buildEndpointsFromStatus(statusResult, existing.config);
          const mocks = buildMocksFromStatus(statusResult);
          const status = deriveStatus(endpoints);
          return {
            status,
            endpoints,
            mocks,
            hints: buildHints(status, endpoints, mocks),
            details: {
              buildDuration: 0,
              setupDuration: 0,
              totalDuration: Date.now() - totalStart,
              skippedBuild: true,
              reusedSession: true,
            },
          };
        }
      }

      // Session exists but not healthy — clean and restart
      try { await handleClean({ projectPath: params.projectPath }, sessionManager); } catch { /* ignore */ }
    } catch {
      // Session lookup/status failed — clean and restart
      try { await handleClean({ projectPath: params.projectPath }, sessionManager); } catch { /* ignore */ }
    }
  }

  // Step 1: Init
  let config: E2EConfig;
  try {
    await handleInit({ projectPath: params.projectPath, configFile: params.configFile }, sessionManager);
    config = sessionManager.getOrThrow(params.projectPath).config;
  } catch (err) {
    return {
      status: 'failed',
      endpoints: [],
      mocks: [],
      hints: [`初始化失败: ${(err as Error).message}`],
      details: { buildDuration: 0, setupDuration: 0, totalDuration: Date.now() - totalStart, skippedBuild: false, reusedSession: false },
    };
  }

  // Step 2: Build (can be skipped)
  if (!params.skipBuild) {
    const buildStart = Date.now();
    try {
      const buildResult = await handleBuild(
        { projectPath: params.projectPath, noCache: params.noCache },
        sessionManager,
        platform,
      );
      buildDuration = Date.now() - buildStart;
      const anyFailed = buildResult.services.some(s => s.status === 'failed');
      if (anyFailed) {
        return {
          status: 'failed',
          endpoints: [],
          mocks: [],
          hints: ['Docker 镜像构建失败，请检查 Dockerfile 和构建日志'],
          details: { buildDuration, setupDuration: 0, totalDuration: Date.now() - totalStart, skippedBuild: false, reusedSession: false },
        };
      }
    } catch (err) {
      buildDuration = Date.now() - buildStart;
      return {
        status: 'failed',
        endpoints: [],
        mocks: [],
        hints: [`构建失败: ${(err as Error).message}`],
        details: { buildDuration, setupDuration: 0, totalDuration: Date.now() - totalStart, skippedBuild: false, reusedSession: false },
      };
    }
  } else {
    buildDuration = 0;
  }

  // Step 3: Setup
  const setupStart = Date.now();
  try {
    const setupResult = await handleSetup({ projectPath: params.projectPath }, sessionManager);
    setupDuration = Date.now() - setupStart;

    const endpoints = buildEndpoints(setupResult, config);
    const mocks = buildMocksFromSetup(setupResult);
    const status = deriveStatus(endpoints);

    return {
      status,
      endpoints,
      mocks,
      hints: buildHints(status, endpoints, mocks),
      details: {
        buildDuration,
        setupDuration,
        totalDuration: Date.now() - totalStart,
        skippedBuild: !!params.skipBuild,
        reusedSession: false,
      },
    };
  } catch (err) {
    setupDuration = Date.now() - setupStart;
    return {
      status: 'failed',
      endpoints: [],
      mocks: [],
      hints: [`环境启动失败: ${(err as Error).message}`],
      details: { buildDuration, setupDuration, totalDuration: Date.now() - totalStart, skippedBuild: !!params.skipBuild, reusedSession: false },
    };
  }
}
