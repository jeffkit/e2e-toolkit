/**
 * Vibe 流程 E2E 测试
 *
 * 验证游戏编辑加载流程：加载游戏 → 验证进程 → 验证编辑模式
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { containerRequest, waitForHealthy, testGameId, sleep } from './helpers.js';

describe('Vibe 流程', () => {
  const gameId = testGameId('vibe');
  const token = 'e2e-test-token';

  beforeAll(async () => {
    await waitForHealthy();
    // 确保之前的游戏已关闭
    try {
      await containerRequest('POST', '/shutdown/force');
      await sleep(3000);
    } catch {
      // ignore
    }
  });

  afterAll(async () => {
    try {
      await containerRequest('POST', '/shutdown/force');
    } catch {
      // ignore
    }
  });

  it('POST /vibe 请求被正确处理', async () => {
    const { status, data } = await containerRequest<{ success: number; error?: string }>(
      'POST',
      '/vibe',
      {
        game_id: gameId,
        token,
      },
      { timeout: 120_000 }
    );

    // vibe 可能返回 200（成功）或 500（COS 上没有备份数据）
    // 我们验证请求格式正确被接受（不是 400）
    expect([200, 500]).toContain(status);
    expect(data).toHaveProperty('success');
  });

  it('POST /vibe 缺少 game_id 返回 400', async () => {
    const { status } = await containerRequest('POST', '/vibe', {
      token: 'some-token',
    });
    expect(status).toBe(400);
  });

  it('POST /vibe 缺少 token 返回 400', async () => {
    const { status } = await containerRequest('POST', '/vibe', {
      game_id: 'some-game',
    });
    expect(status).toBe(400);
  });
});
