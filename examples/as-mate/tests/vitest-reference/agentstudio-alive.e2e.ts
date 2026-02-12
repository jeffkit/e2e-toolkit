/**
 * AgentStudio 存活性 E2E 测试
 *
 * 验证 /create 和 /vibe 之后，AgentStudio 在 4936 端口正常存活，
 * 且核心 API 可用。
 *
 * 端口映射：容器内 4936 → 宿主机 19936
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  containerRequest,
  waitForHealthy,
  testGameId,
  assertSuccess,
  sleep,
  CONTAINER_URL,
  containerExec,
  containerPathExists,
  containerLs,
  containerCat,
  containerReadlink,
} from './helpers.js';

/** AgentStudio 外部访问地址（19936 映射到容器内 4936） */
const AGENTSTUDIO_URL = CONTAINER_URL.replace(/:\d+$/, ':19936');

/**
 * 向 AgentStudio 发送请求
 */
async function agentStudioRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: { timeout?: number }
): Promise<{ status: number; data: T }> {
  const url = `${AGENTSTUDIO_URL}${path}`;
  const timeout = options?.timeout || 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {};
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined && body !== null && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    let data: T;
    if (contentType.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }

    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 等待 AgentStudio 可访问
 */
async function waitForAgentStudio(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await agentStudioRequest('GET', '/api/health', undefined, {
        timeout: 5000,
      });
      if (status === 200) return;
    } catch {
      // 尚未就绪
    }
    await sleep(2000);
  }
  throw new Error(`AgentStudio did not become available within ${timeoutMs}ms`);
}

// =====================================================================
// 测试用例
// =====================================================================

describe('AgentStudio 存活性验证', () => {
  describe('Create 后 AgentStudio 可用', () => {
    const gameId = testGameId('as-alive-create');
    const token = 'e2e-alive-token';

    beforeAll(async () => {
      await waitForHealthy();

      // 清理旧状态
      try {
        await containerRequest('POST', '/shutdown/force');
        await sleep(3000);
      } catch {
        // ignore
      }

      // 创建游戏
      const { status, data } = await containerRequest<{ success: number; error?: string }>(
        'POST',
        '/create',
        {
          game_id: gameId,
          game_name: 'AgentStudio Alive Test',
          template: 'phaser-2d',
          token,
        },
        { timeout: 60_000 }
      );

      expect(status).toBe(200);
      assertSuccess(data);

      // 等待 AgentStudio 启动（需要时间同步 marketplace + 安装 plugins）
      await waitForAgentStudio(60_000);

      // 额外等待 marketplace 同步完成（异步操作）
      await sleep(5000);
    }, 180_000); // hook timeout 180s（COS 下载模板 + marketplace 同步 + AgentStudio 启动）

    afterAll(async () => {
      try {
        await containerRequest('POST', '/shutdown/force');
      } catch {
        // ignore
      }
    });

    it('AgentStudio /api/health 返回 200', async () => {
      const { status, data } = await agentStudioRequest<{
        status: string;
        version?: string;
        name?: string;
        engine?: string;
      }>('GET', '/api/health');

      expect(status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('name');
    });

    it('AgentStudio 前端页面可访问', async () => {
      const { status, data } = await agentStudioRequest<string>('GET', '/');
      expect(status).toBe(200);
      expect(data).toContain('<!doctype html>');
      expect(data).toContain('AgentStudio');
    });

    it('AgentStudio /api/agents 返回 Agent 列表', async () => {
      const { status, data } = await agentStudioRequest<{
        agents: Array<{ id: string; name: string }>;
      }>('GET', '/api/agents');

      expect(status).toBe(200);
      expect(data).toHaveProperty('agents');
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBeGreaterThan(0);
    });

    it('AgentStudio /api/config 返回配置', async () => {
      const { status, data } = await agentStudioRequest<{
        success: boolean;
        config: { port: number };
      }>('GET', '/api/config');

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.config.port).toBe(4936);
    });

    it('as-mate /api/status 显示 agentStudio 进程 running', async () => {
      const { status, data } = await containerRequest<{
        processes: Record<string, { status: string }>;
      }>('GET', '/api/status');

      expect(status).toBe(200);
      expect(data.processes).toHaveProperty('agentStudio');
      expect(data.processes.agentStudio.status).toBe('running');
    });

    // =========================================================
    // /workspace 模板文件验证
    // =========================================================

    it('/workspace 下有 phaser-2d 模板的核心文件', async () => {
      const files = await containerLs('/workspace');
      // phaser-2d 模板应包含这些核心文件
      expect(files).toContain('package.json');
      expect(files).toContain('index.html');
      expect(files).toContain('vite.config.ts');
      expect(files).toContain('src');
    });

    it('/workspace/package.json 内容正确', async () => {
      const content = await containerCat('/workspace/package.json');
      const pkg = JSON.parse(content);
      // phaser-2d 模板的 package name
      expect(pkg.name).toBeTruthy();
      expect(pkg.version).toBeTruthy();
      // 应有 scripts
      expect(pkg.scripts).toBeTruthy();
    });

    it('/workspace/src 目录包含游戏源代码', async () => {
      const srcFiles = await containerLs('/workspace/src');
      // phaser-2d 模板的 src 目录应包含主入口和游戏模块
      expect(srcFiles.length).toBeGreaterThan(0);
      expect(srcFiles).toContain('main.ts');
    });

    // =========================================================
    // /marketplace 目录验证（种子复制 + COS 同步）
    // =========================================================

    it('/marketplace 目录存在且有内容', async () => {
      const exists = await containerPathExists('/marketplace');
      expect(exists).toBe(true);

      const files = await containerLs('/marketplace');
      // marketplace 应至少包含核心文件
      expect(files).toContain('plugins');
    });

    it('/marketplace/plugins 包含插件目录', async () => {
      const plugins = await containerLs('/marketplace/plugins');
      // 至少应有一个插件
      expect(plugins.length).toBeGreaterThan(0);
    });

    // =========================================================
    // marketplace → ~/.claude 同步验证（claude 引擎）
    // =========================================================

    it('marketplace 内容已同步到 ~/.claude/plugins/marketplaces', async () => {
      const CLAUDE_HOME = '/home/agentstudio/.claude';
      const mpDir = `${CLAUDE_HOME}/plugins/marketplaces`;

      const exists = await containerPathExists(mpDir);
      expect(exists).toBe(true);

      const files = await containerLs(mpDir);
      // 应有 plugins 和 agents 目录
      expect(files).toContain('plugins');
    });

    it('marketplace 插件已安装到 ~/.claude/plugins/marketplaces/plugins', async () => {
      const pluginsDir = '/home/agentstudio/.claude/plugins/marketplaces/plugins';
      const plugins = await containerLs(pluginsDir);
      // 应至少包含一个插件（如 code-reviewer、data-analyst 等）
      expect(plugins.length).toBeGreaterThan(0);
    });

    it('~/.claude/skills 有来自 marketplace 的符号链接', async () => {
      const skillsDir = '/home/agentstudio/.claude/skills';
      const exists = await containerPathExists(skillsDir);
      expect(exists).toBe(true);

      // 列出 skills 目录内容
      const skills = await containerLs(skillsDir);
      // 至少有 1 个从 marketplace 安装过来的 skill
      expect(skills.length).toBeGreaterThan(0);

      // 验证至少一个条目是符号链接且指向 marketplaces 目录
      const firstSkill = skills[0];
      const target = await containerReadlink(`${skillsDir}/${firstSkill}`);
      expect(target).toContain('marketplaces');
    });

    it('~/.claude/mcp.json 包含 marketplace 安装的 MCP 服务器', async () => {
      const mcpJson = await containerCat('/home/agentstudio/.claude/mcp.json');
      const mcp = JSON.parse(mcpJson);

      expect(mcp).toHaveProperty('mcpServers');
      // 应至少有 1 个 MCP 服务器条目
      const serverNames = Object.keys(mcp.mcpServers);
      expect(serverNames.length).toBeGreaterThan(0);

      // 至少一个服务器应标注来自 plugins 安装
      const hasPluginInstalled = serverNames.some(name => {
        const server = mcp.mcpServers[name];
        return server._installedBy && server._installedBy.includes('plugins/');
      });
      expect(hasPluginInstalled).toBe(true);
    });
  });

  describe('Vibe 后 AgentStudio 可用', () => {
    const gameId = testGameId('as-alive-vibe');
    const token = 'e2e-alive-token';
    let vibeSucceeded = false;

    beforeAll(async () => {
      await waitForHealthy();

      // 清理旧状态
      try {
        await containerRequest('POST', '/shutdown/force');
        await sleep(3000);
      } catch {
        // ignore
      }

      // 调用 vibe（可能因无备份返回 500）
      const { status } = await containerRequest<{ success: number; error?: string }>(
        'POST',
        '/vibe',
        { game_id: gameId, token },
        { timeout: 60_000 }
      );

      vibeSucceeded = status === 200;

      if (vibeSucceeded) {
        // vibe 成功，等待 AgentStudio 启动
        await waitForAgentStudio(30_000);
      }
    }, 120_000); // hook timeout 120s

    afterAll(async () => {
      try {
        await containerRequest('POST', '/shutdown/force');
      } catch {
        // ignore
      }
    });

    it('Vibe 成功时 AgentStudio 必须可访问', async () => {
      if (!vibeSucceeded) {
        // vibe 因 COS 无备份而失败，此场景下跳过探活检查
        // 但确认 as-mate 本身仍健康
        const { status } = await containerRequest('GET', '/livez');
        expect(status).toBe(200);
        return;
      }

      // vibe 成功，AgentStudio 必须在线
      const { status, data } = await agentStudioRequest<{
        status: string;
        version?: string;
      }>('GET', '/api/health');

      expect(status).toBe(200);
      expect(data.status).toBe('ok');
    });

    it('Vibe 成功时 as-mate 状态为 vibe 模式', async () => {
      if (!vibeSucceeded) {
        // vibe 失败，跳过
        const { status } = await containerRequest('GET', '/livez');
        expect(status).toBe(200);
        return;
      }

      const { data } = await containerRequest<{
        game_id?: string | null;
        mode?: string;
      }>('GET', '/health');

      expect(data.mode).toBe('vibe');
      expect(data.game_id).toBeTruthy();
    });
  });
});
