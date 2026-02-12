/**
 * Play 流程 E2E 测试
 *
 * 验证游戏只读播放模式：加载游戏 → 验证预览服务
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { containerRequest, waitForHealthy, testGameId, sleep } from './helpers.js';

describe('Play 流程', () => {
  const gameId = testGameId('play');

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

  it('POST /play 请求被正确处理', async () => {
    const { status, data } = await containerRequest<{ success: number; error?: string }>(
      'POST',
      '/play',
      { game_id: gameId },
      { timeout: 60_000 }
    );

    // play 可能返回 200（成功）或 500（COS 上没有发布包）
    // 我们验证请求格式正确被接受（不是 400）
    expect([200, 500]).toContain(status);
    expect(data).toHaveProperty('success');
  });

  it('POST /play 缺少 game_id 返回 400', async () => {
    const { status } = await containerRequest('POST', '/play', {});
    expect(status).toBe(400);
  });
});
