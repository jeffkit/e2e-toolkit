/**
 * 健康检查 E2E 测试
 *
 * 验证容器的健康检查接口是否正常工作
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { containerRequest, waitForHealthy } from './helpers.js';

describe('健康检查', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('GET /livez 返回 200', async () => {
    const { status, data } = await containerRequest<{ status: string }>('GET', '/livez');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
  });

  it('GET /readyz 返回就绪状态', async () => {
    const { status, data } = await containerRequest<{
      status: string;
      checks: Record<string, boolean>;
    }>('GET', '/readyz');
    expect(status).toBe(200);
    // /readyz 返回 { status: 'ready', checks: {...} }
    expect(data).toHaveProperty('status');
    expect(data.status).toBe('ready');
  });

  it('GET /health 返回健康信息', async () => {
    const { data } = await containerRequest<{
      status: string;
      engine?: string;
      uptime_seconds?: number;
    }>('GET', '/health');
    // /health 可能返回 200 或 503（unhealthy 也是正常响应）
    expect(data).toHaveProperty('status');
    expect(['healthy', 'unhealthy']).toContain(data.status);
  });

  it('GET /idle 返回空闲状态', async () => {
    const { status, data } = await containerRequest<{
      idle: boolean;
      idle_seconds?: number;
    }>('GET', '/idle');
    expect(status).toBe(200);
    expect(data).toHaveProperty('idle');
    expect(typeof data.idle).toBe('boolean');
  });
});
