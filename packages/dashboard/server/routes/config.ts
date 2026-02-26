/**
 * 配置路由
 *
 * 基于原版 as-mate/e2e 迁移，整合 e2e.yaml 配置管理。
 * 支持运行时配置查看（敏感信息脱敏）和运行时覆盖。
 */

import { type FastifyPluginAsync } from 'fastify';
import type { E2EConfig } from 'argusai-core';
import { getAppState } from '../app-state.js';

export const configRoutes: FastifyPluginAsync = async (app) => {

  let runtimeOverrides: Record<string, unknown> = {};

  /** 获取当前配置 */
  app.get('/', async () => {
    const e2eConfig = getAppState().config;
    if (!e2eConfig) {
      return { error: 'No e2e.yaml loaded', runtimeOverrides };
    }

    // Mask sensitive values in environment
    const maskedEnv: Record<string, string> = {};
    const env = e2eConfig.service.container.environment ?? {};
    for (const [key, value] of Object.entries(env)) {
      if (
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('key')
      ) {
        maskedEnv[key] = value ? '***' : '';
      } else {
        maskedEnv[key] = value;
      }
    }

    return {
      project: e2eConfig.project,
      service: {
        build: e2eConfig.service.build,
        container: {
          ...e2eConfig.service.container,
          environment: maskedEnv,
        },
        vars: e2eConfig.service.vars,
      },
      mocks: e2eConfig.mocks ? Object.keys(e2eConfig.mocks) : [],
      tests: e2eConfig.tests?.suites.map(s => ({ id: s.id, name: s.name })),
      dashboard: e2eConfig.dashboard,
      network: e2eConfig.network,
      repos: e2eConfig.repos,
      runtimeOverrides,
    };
  });

  /** 更新运行时配置 */
  app.patch('/', async (request) => {
    const updates = request.body as Record<string, unknown>;
    runtimeOverrides = { ...runtimeOverrides, ...updates };
    return { success: true, runtimeOverrides };
  });
};
