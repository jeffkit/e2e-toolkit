/**
 * Create 流程 E2E 测试
 *
 * 验证游戏创建流程：创建游戏 → 验证状态 → 验证进程启动
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { containerRequest, waitForHealthy, testGameId, assertSuccess, sleep } from './helpers.js';

describe('Create 流程', () => {
  const gameId = testGameId('create');
  const token = 'e2e-test-token';
  const template = 'phaser-2d';

  beforeAll(async () => {
    await waitForHealthy();
  });

  afterAll(async () => {
    // 清理：强制关闭
    try {
      await containerRequest('POST', '/shutdown/force');
    } catch {
      // ignore
    }
  });

  it('POST /create 创建游戏成功', async () => {
    const { status, data } = await containerRequest<{ success: number; error?: string }>(
      'POST',
      '/create',
      {
        game_id: gameId,
        game_name: 'E2E Create Test',
        template,
        token,
      },
      { timeout: 60_000 }
    );

    expect(status).toBe(200);
    assertSuccess(data);
  });

  it('创建后 /health 显示游戏上下文', async () => {
    // 等待一段时间让服务初始化
    await sleep(5000);

    const { data } = await containerRequest<{
      status: string;
      game_id?: string;
      mode?: string;
    }>('GET', '/health');

    // /health 返回的 game_id 直接在顶层
    expect(data).toHaveProperty('game_id');
    expect(data).toHaveProperty('mode');
  });

  it('创建后 /api/status 显示进程状态', async () => {
    const { status, data } = await containerRequest<{
      instance?: { gameId?: string; mode?: string };
      processes?: Record<string, unknown>;
    }>('GET', '/api/status');

    expect(status).toBe(200);
    expect(data).toHaveProperty('instance');
    expect(data).toHaveProperty('processes');
  });

  it('创建后不应处于空闲状态', async () => {
    const { data } = await containerRequest<{ idle: boolean }>('GET', '/idle');
    // 刚创建的游戏不应该空闲
    expect(data.idle).toBe(false);
  });

  it('POST /create 缺少必填字段返回 400', async () => {
    const { status } = await containerRequest('POST', '/create', {
      game_id: gameId,
      // 缺少 game_name, template, token
    });
    expect(status).toBe(400);
  });
});
