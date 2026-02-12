/**
 * API 代理路由
 *
 * 基于原版 as-mate/e2e 迁移，改为从 e2e.yaml 读取容器 URL。
 * 将请求转发到被测容器，便于从仪表盘直接调用容器 API。
 */

import { type FastifyPluginAsync } from 'fastify';
import { getAppState } from '../app-state.js';

export const proxyRoutes: FastifyPluginAsync = async (app) => {
  function getContainerUrl(): string {
    const config = getAppState().config;
    if (config?.service.vars?.base_url) return config.service.vars.base_url;
    const firstPort = config?.service.container.ports?.[0];
    if (firstPort) {
      const hostPort = firstPort.split(':')[0];
      return `http://localhost:${hostPort}`;
    }
    return process.env.CONTAINER_URL || 'http://localhost:3000';
  }

  /** 通用 API 代理 - 转发任意请求到容器 */
  app.all('/*', async (request, reply) => {
    const targetPath = (request.params as { '*': string })['*'] || '';
    const containerUrl = getContainerUrl();
    const url = `${containerUrl}/${targetPath}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 透传关键 header
    if (request.headers['x-trace-id']) {
      headers['X-Trace-Id'] = request.headers['x-trace-id'] as string;
    }
    if (request.headers['authorization']) {
      headers['Authorization'] = request.headers['authorization'] as string;
    }

    try {
      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
      };

      if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        fetchOptions.body = JSON.stringify(request.body);
      }

      const response = await fetch(url, fetchOptions);
      const contentType = response.headers.get('content-type') || '';

      let responseBody: unknown;
      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      return reply
        .status(response.status)
        .headers({
          'X-Proxied-From': url,
          'X-Proxied-Status': String(response.status),
        })
        .send(responseBody);
    } catch (err) {
      return reply.status(502).send({
        success: false,
        error: `Failed to reach container: ${err instanceof Error ? err.message : String(err)}`,
        targetUrl: url,
      });
    }
  });
};
