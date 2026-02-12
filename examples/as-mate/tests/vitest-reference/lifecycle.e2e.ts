/**
 * 完整生命周期 E2E 测试
 *
 * 验证完整的游戏生命周期：create → 状态检查 → event → shutdown
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { containerRequest, waitForHealthy, testGameId, assertSuccess, sleep } from './helpers.js';

describe('完整生命周期', () => {
  const gameId = testGameId('lifecycle');
  const token = 'e2e-lifecycle-token';
  const template = 'phaser-2d';

  beforeAll(async () => {
    await waitForHealthy();
    // 确保干净状态
    try {
      await containerRequest('POST', '/shutdown/force');
      await sleep(3000);
    } catch {
      // ignore
    }
  });

  it('Step 1: 创建游戏', async () => {
    const { status, data } = await containerRequest<{ success: number; error?: string }>(
      'POST',
      '/create',
      {
        game_id: gameId,
        game_name: 'Lifecycle Test',
        template,
        token,
      },
      { timeout: 60_000 }
    );

    expect(status).toBe(200);
    assertSuccess(data);
  });

  it('Step 2: 等待进程就绪', async () => {
    // 等待进程启动
    await sleep(10_000);

    const { data } = await containerRequest<{
      instance?: { gameId?: string };
      processes?: Record<string, unknown>;
    }>('GET', '/api/status');

    expect(data).toHaveProperty('instance');
  });

  it('Step 3: 发送 activity 活动', async () => {
    // source 必须是 'preview' 或 'agent_studio'
    const { status } = await containerRequest<{ success?: boolean }>(
      'POST',
      '/activity',
      { source: 'preview' }
    );

    expect(status).toBe(200);
  });

  it('Step 4: 验证非空闲状态', async () => {
    const { data } = await containerRequest<{ idle: boolean }>('GET', '/idle');
    expect(data.idle).toBe(false);
  });

  it('Step 5: 发送事件', async () => {
    const { status } = await containerRequest<{ success: number; error?: string }>(
      'POST',
      '/event',
      {
        type: 'allow_join',
        data: JSON.stringify({ user_id: 'test-user' }),
      }
    );

    // event 可能因为 gateway 不可达而失败（mock 模式下应该成功）
    expect(status).toBe(200);
  });

  it('Step 6: 优雅关闭', async () => {
    // /shutdown 不需要 request body
    const { status, data } = await containerRequest<{
      success: number;
      error?: string;
      backup_key?: string;
    }>(
      'POST',
      '/shutdown',
      undefined,
      { timeout: 120_000 }
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('success');
  });

  it('Step 7: 关闭后容器仍健康', async () => {
    await sleep(3000);

    const { status } = await containerRequest('GET', '/livez');
    expect(status).toBe(200);
  });

  it('Step 8: 关闭后无活跃游戏', async () => {
    // shutdown 后 game_id 应该被清空
    await sleep(2000);
    const { data } = await containerRequest<{
      game_id?: string;
      mode?: string;
    }>('GET', '/health');

    // 关闭后不应该有活跃游戏
    // game_id 应为 null，mode 应为 'idle'
    expect(data.game_id).toBeNull();
    expect(data.mode).toBe('idle');
  });
});
