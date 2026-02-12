/**
 * 异常场景 E2E 测试
 *
 * 验证各种错误情况的处理
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { containerRequest, waitForHealthy } from './helpers.js';

describe('异常场景', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  describe('参数校验', () => {
    it('POST /create 空 body 返回 400', async () => {
      const { status } = await containerRequest('POST', '/create', {});
      expect(status).toBe(400);
    });

    it('POST /create 缺少 template 返回 400', async () => {
      const { status } = await containerRequest('POST', '/create', {
        game_id: 'test',
        game_name: 'test',
        token: 'test',
        // 缺少 template
      });
      expect(status).toBe(400);
    });

    it('POST /vibe 空 body 返回 400', async () => {
      const { status } = await containerRequest('POST', '/vibe', {});
      expect(status).toBe(400);
    });

    it('POST /play 空 body 返回 400', async () => {
      const { status } = await containerRequest('POST', '/play', {});
      expect(status).toBe(400);
    });

    it('POST /event 缺少 type 返回 400', async () => {
      const { status } = await containerRequest('POST', '/event', {
        data: 'test',
      });
      expect(status).toBe(400);
    });

    it('POST /event 缺少 data 返回 400', async () => {
      const { status } = await containerRequest('POST', '/event', {
        type: 'test',
      });
      expect(status).toBe(400);
    });
  });

  describe('不存在的 API 路由', () => {
    it('GET /api/nonexistent 返回 404', async () => {
      // nginx 会将非 /api 前缀的请求 fallback 到 SPA（返回200），
      // 所以测试 /api 前缀下的 404
      const { status } = await containerRequest('GET', '/api/nonexistent');
      expect(status).toBe(404);
    });
  });

  describe('Admin API', () => {
    it('GET /api/status 返回有效数据', async () => {
      const { status, data } = await containerRequest<Record<string, unknown>>('GET', '/api/status');
      expect(status).toBe(200);
      expect(typeof data).toBe('object');
    });

    it('GET /api/metrics 返回指标数据', async () => {
      const { status, data } = await containerRequest<Record<string, unknown>>('GET', '/api/metrics');
      expect(status).toBe(200);
      expect(typeof data).toBe('object');
    });

    it('GET /api/config 返回配置', async () => {
      const { status, data } = await containerRequest<Record<string, unknown>>('GET', '/api/config');
      expect(status).toBe(200);
      expect(typeof data).toBe('object');
    });

    it('POST /api/actions/invalid 返回 400', async () => {
      const { status } = await containerRequest('POST', '/api/actions/nonexistent');
      expect(status).toBe(400);
    });
  });

  describe('并发请求', () => {
    it('多个健康检查并发请求都能正确响应', async () => {
      const promises = Array.from({ length: 10 }, () =>
        containerRequest('GET', '/livez')
      );

      const results = await Promise.all(promises);
      for (const result of results) {
        expect(result.status).toBe(200);
      }
    });
  });
});
