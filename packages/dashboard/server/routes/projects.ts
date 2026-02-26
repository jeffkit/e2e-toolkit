/**
 * 项目管理路由
 *
 * 管理多个 E2E 项目的注册、切换和状态查看。
 */

import { type FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadConfig } from 'argusai-core';
import {
  loadRegistry,
  addProject,
  removeProject,
  setActiveProject,
  type ProjectEntry,
} from '../project-registry.js';
import { getAppState, updateAppState } from '../app-state.js';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  /** 列出所有注册的项目 */
  app.get('/', async () => {
    const registry = loadRegistry();
    const state = getAppState();
    return {
      activeProject: registry.activeProject,
      currentLoaded: state.config?.project.name ?? null,
      projects: registry.projects,
    };
  });

  /** 添加/注册一个项目 */
  app.post('/', async (request) => {
    const body = request.body as {
      name: string;
      configPath: string;
      description?: string;
    };

    if (!body.name || !body.configPath) {
      return { success: false, error: 'Missing name or configPath' };
    }

    // 验证配置文件是否可加载
    const absPath = path.resolve(body.configPath);
    try {
      const testConfig = await loadConfig(absPath);
      const registry = addProject({
        name: body.name,
        configPath: absPath,
        description: body.description || testConfig.project.description,
      });
      return { success: true, registry };
    } catch (err) {
      return {
        success: false,
        error: `Failed to load config at ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  /** 删除一个项目 */
  app.delete('/:name', async (request) => {
    const { name } = request.params as { name: string };
    const registry = removeProject(name);
    return { success: true, registry };
  });

  /** 切换活跃项目 */
  app.post('/:name/activate', async (request) => {
    const { name } = request.params as { name: string };

    try {
      const registry = setActiveProject(name);
      const project = registry.projects.find(p => p.name === name);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // 加载新项目的配置
      const newConfig = await loadConfig(project.configPath);
      const newConfigDir = path.dirname(project.configPath);

      // 更新全局状态（所有路由将立即看到新配置）
      updateAppState({
        config: newConfig,
        configDir: newConfigDir,
        configPath: project.configPath,
      });

      console.log(`[projects] Switched to project: ${name} (${project.configPath})`);

      return {
        success: true,
        project: {
          name: newConfig.project.name,
          description: newConfig.project.description,
          version: newConfig.project.version,
          configPath: project.configPath,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to switch to project "${name}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  /** 获取当前活跃项目详情 */
  app.get('/active', async () => {
    const state = getAppState();
    if (!state.config) {
      return { active: false };
    }
    return {
      active: true,
      project: {
        name: state.config.project.name,
        description: state.config.project.description,
        version: state.config.project.version,
      },
      configPath: state.configPath,
      configDir: state.configDir,
    };
  });

  /** 扫描指定目录下的 e2e.yaml 文件 */
  app.post('/scan', async (request) => {
    const { directory } = request.body as { directory: string };
    if (!directory) {
      return { success: false, error: 'Missing directory' };
    }

    const found: Array<{ name: string; configPath: string; description?: string }> = [];
    const absDir = path.resolve(directory);

    // 递归扫描 e2e.yaml（最多 3 层深度）
    const { readdirSync, statSync, existsSync } = await import('fs');

    function scan(dir: string, depth: number) {
      if (depth > 3) return;
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry === 'node_modules' || entry.startsWith('.')) continue;
          const full = path.join(dir, entry);
          try {
            const stat = statSync(full);
            if (stat.isDirectory()) {
              scan(full, depth + 1);
            } else if (entry === 'e2e.yaml' || entry === 'e2e.yml') {
              found.push({
                name: path.basename(path.dirname(full)),
                configPath: full,
              });
            }
          } catch { /* permission error, skip */ }
        }
      } catch { /* can't read dir */ }
    }

    scan(absDir, 0);

    // 尝试加载每个找到的配置获取项目名
    for (const item of found) {
      try {
        const config = await loadConfig(item.configPath);
        item.name = config.project.name;
        item.description = config.project.description;
      } catch { /* ignore */ }
    }

    return { success: true, found };
  });

  // ============================================================
  // 配置文件读写
  // ============================================================

  /** 获取指定项目的解析后配置（JSON 格式，用于可视化编辑器） */
  app.get('/:name/parsed-config', async (request) => {
    const { name } = request.params as { name: string };
    const registry = loadRegistry();
    const project = registry.projects.find(p => p.name === name);
    if (!project) return { success: false, error: 'Project not found' };
    try {
      const config = await loadConfig(project.configPath);
      // 也读取原始 YAML 中的字段（loadConfig 可能会 normalize 一些值）
      const raw = fs.readFileSync(project.configPath, 'utf-8');
      const rawParsed = yaml.load(raw) as Record<string, unknown>;
      return { success: true, config: rawParsed, validated: config };
    } catch (err) {
      return { success: false, error: `Failed to parse config: ${(err as Error).message}` };
    }
  });

  /** 读取指定项目的 e2e.yaml 原始内容 */
  app.get('/:name/config-file', async (request) => {
    const { name } = request.params as { name: string };
    const registry = loadRegistry();
    const project = registry.projects.find(p => p.name === name);
    if (!project) return { success: false, error: 'Project not found' };
    try {
      const raw = fs.readFileSync(project.configPath, 'utf-8');
      return { success: true, content: raw, path: project.configPath };
    } catch (err) {
      return { success: false, error: `Cannot read ${project.configPath}: ${(err as Error).message}` };
    }
  });

  /** 保存 e2e.yaml 内容（接收 JSON 对象，转换为 YAML 写入） */
  app.post('/:name/config-file', async (request) => {
    const { name } = request.params as { name: string };
    const body = request.body as { config?: Record<string, unknown>; raw?: string };
    const registry = loadRegistry();
    const project = registry.projects.find(p => p.name === name);
    if (!project) return { success: false, error: 'Project not found' };

    try {
      let content: string;
      if (body.raw) {
        // 直接写入 YAML 原文
        content = body.raw;
      } else if (body.config) {
        // JSON → YAML
        content = yaml.dump(body.config, {
          indent: 2,
          lineWidth: 120,
          quotingType: '"',
          noRefs: true,
          sortKeys: false,
        });
      } else {
        return { success: false, error: 'Missing config or raw content' };
      }

      // 备份旧文件
      if (fs.existsSync(project.configPath)) {
        fs.copyFileSync(project.configPath, project.configPath + '.bak');
      }
      fs.writeFileSync(project.configPath, content, 'utf-8');

      // 重新加载配置（验证 + 更新内存状态）
      const newConfig = await loadConfig(project.configPath);
      const state = getAppState();
      if (state.configPath === project.configPath) {
        updateAppState({ config: newConfig, configDir: path.dirname(project.configPath) });
      }

      return { success: true, message: 'Config saved and reloaded' };
    } catch (err) {
      return { success: false, error: `Save failed: ${(err as Error).message}` };
    }
  });

  /** 创建新项目（在指定目录生成 e2e.yaml + 自动注册） */
  app.post('/create', async (request) => {
    const body = request.body as {
      directory: string;
      config: Record<string, unknown>;
    };
    if (!body.directory || !body.config) {
      return { success: false, error: 'Missing directory or config' };
    }
    const dir = path.resolve(body.directory);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const configPath = path.join(dir, 'e2e.yaml');
    const content = yaml.dump(body.config, {
      indent: 2,
      lineWidth: 120,
      quotingType: '"',
      noRefs: true,
      sortKeys: false,
    });
    fs.writeFileSync(configPath, content, 'utf-8');

    // 验证并注册
    try {
      const loaded = await loadConfig(configPath);
      const reg = addProject({
        name: loaded.project.name,
        configPath,
        description: loaded.project.description,
      });
      return { success: true, configPath, registry: reg };
    } catch (err) {
      return { success: false, error: `Generated config is invalid: ${(err as Error).message}`, configPath };
    }
  });

  /** 获取 e2e.yaml schema 说明（给前端展示配置字段文档） */
  app.get('/schema', async () => {
    return {
      sections: [
        {
          key: 'project',
          title: '项目信息',
          description: '项目基本元数据',
          required: true,
          fields: [
            { key: 'name', type: 'string', required: true, description: '项目唯一名称', example: 'my-service' },
            { key: 'description', type: 'string', required: false, description: '项目描述', example: 'My E2E testing project' },
            { key: 'version', type: 'string', required: false, description: '版本号', example: '1.0.0' },
          ],
        },
        {
          key: 'service.build',
          title: '镜像构建',
          description: '定义如何构建 Docker 镜像',
          required: true,
          fields: [
            { key: 'dockerfile', type: 'string', required: true, description: 'Dockerfile 路径（相对于 e2e.yaml）', example: './Dockerfile' },
            { key: 'context', type: 'string', required: true, description: '构建上下文目录', example: '.' },
            { key: 'image', type: 'string', required: true, description: '镜像名:标签', example: 'my-service:e2e' },
          ],
        },
        {
          key: 'service.container',
          title: '容器配置',
          description: '定义容器运行参数',
          required: true,
          fields: [
            { key: 'name', type: 'string', required: true, description: '容器名称', example: 'my-service-e2e' },
            { key: 'ports', type: 'string[]', required: true, description: '端口映射（宿主:容器）', example: '8080:3000' },
            { key: 'environment', type: 'map', required: false, description: '环境变量键值对' },
            { key: 'volumes', type: 'string[]', required: false, description: 'Volume 挂载', example: 'data:/data' },
            { key: 'healthcheck.path', type: 'string', required: false, description: 'HTTP 健康检查路径', example: '/health' },
          ],
        },
        {
          key: 'service.vars',
          title: '自定义变量',
          description: '可在配置中通过 {{config.xxx}} 引用的变量',
          required: false,
          fields: [
            { key: 'base_url', type: 'string', required: false, description: '被测服务的基础 URL', example: 'http://localhost:8080' },
          ],
        },
        {
          key: 'repos',
          title: 'Git 仓库',
          description: '关联的 Git 仓库，支持本地路径或远程 SSH/HTTPS URL',
          required: false,
          fields: [
            { key: 'name', type: 'string', required: true, description: '仓库显示名', example: 'my-repo' },
            { key: 'path', type: 'string', required: false, description: '本地路径（相对于 e2e.yaml）', example: '../../my-repo' },
            { key: 'url', type: 'string', required: false, description: '远程仓库 URL（SSH 或 HTTPS）', example: 'git@github.com:user/repo.git' },
            { key: 'branch', type: 'string', required: false, description: '默认分支（远程仓库使用）', example: 'main' },
          ],
        },
        {
          key: 'mocks',
          title: 'Mock 服务',
          description: '模拟外部依赖服务，自动启动为 sidecar 容器',
          required: false,
          fields: [
            { key: '[name].port', type: 'number', required: true, description: '宿主机端口', example: '8081' },
            { key: '[name].containerPort', type: 'number', required: false, description: '容器内端口' },
            { key: '[name].routes', type: 'array', required: false, description: 'Mock 路由定义列表' },
          ],
        },
        {
          key: 'tests',
          title: '测试套件',
          description: '定义 E2E 测试套件列表',
          required: false,
          fields: [
            { key: 'suites[].id', type: 'string', required: true, description: '套件唯一 ID', example: 'health' },
            { key: 'suites[].name', type: 'string', required: true, description: '套件显示名', example: '健康检查' },
            { key: 'suites[].file', type: 'string', required: false, description: '测试文件路径', example: 'tests/health.yaml' },
            { key: 'suites[].runner', type: 'string', required: false, description: '运行器类型: yaml | vitest | pytest | shell | exec' },
          ],
        },
        {
          key: 'dashboard',
          title: 'Dashboard 配置',
          description: '仪表盘 UI 的端口和预设',
          required: false,
          fields: [
            { key: 'port', type: 'number', required: false, description: 'API 服务端口', example: '9095' },
            { key: 'uiPort', type: 'number', required: false, description: 'UI 开发服务端口', example: '9091' },
            { key: 'presets', type: 'array', required: false, description: 'API 调试器预定义端点分组' },
            { key: 'envDefaults', type: 'map', required: false, description: '环境变量编辑器默认值' },
            { key: 'defaultDirs', type: 'string[]', required: false, description: '容器目录浏览默认路径' },
          ],
        },
        {
          key: 'network',
          title: 'Docker 网络',
          description: '容器间通信的 Docker 网络',
          required: false,
          fields: [
            { key: 'name', type: 'string', required: false, description: '网络名称', example: 'e2e-network' },
          ],
        },
      ],
      templates: {
        minimal: {
          version: '1',
          project: { name: 'my-project', description: 'My E2E testing project' },
          service: {
            build: { dockerfile: './Dockerfile', context: '.', image: 'my-project:e2e' },
            container: { name: 'my-project-e2e', ports: ['8080:3000'] },
            vars: { base_url: 'http://localhost:8080' },
          },
        },
        standard: {
          version: '1',
          project: { name: 'my-project', description: 'My E2E testing project', version: '1.0.0' },
          service: {
            build: { dockerfile: './Dockerfile', context: '.', image: 'my-project:e2e' },
            container: {
              name: 'my-project-e2e',
              ports: ['8080:3000'],
              environment: { NODE_ENV: 'test' },
              healthcheck: { path: '/health', interval: '10s', timeout: '5s', retries: 10, startPeriod: '30s' },
            },
            vars: { base_url: 'http://localhost:8080' },
          },
          tests: {
            suites: [
              { name: '健康检查', id: 'health', file: 'tests/health.yaml' },
              { name: '基础流程', id: 'basic', file: 'tests/basic.yaml' },
            ],
          },
          dashboard: { port: 9095, uiPort: 9091 },
          network: { name: 'e2e-network' },
        },
        full: {
          version: '1',
          project: { name: 'my-project', description: 'My E2E testing project', version: '1.0.0' },
          repos: [{ name: 'my-repo', path: '../../my-repo' }],
          service: {
            build: { dockerfile: './Dockerfile', context: '.', image: 'my-project:e2e' },
            container: {
              name: 'my-project-e2e',
              ports: ['8080:3000'],
              environment: { NODE_ENV: 'test', LOG_LEVEL: 'debug' },
              volumes: ['data:/data'],
              healthcheck: { path: '/health', interval: '10s', timeout: '5s', retries: 10, startPeriod: '30s' },
            },
            vars: { base_url: 'http://localhost:8080' },
          },
          mocks: {
            'mock-api': { port: 9081, containerPort: 8081, routes: [
              { method: 'GET', path: '/api/health', response: { status: 200, body: { status: 'ok' } } },
            ] },
          },
          tests: {
            suites: [
              { name: '健康检查', id: 'health', file: 'tests/health.yaml' },
              { name: '基础流程', id: 'basic', file: 'tests/basic.yaml' },
            ],
          },
          dashboard: {
            port: 9095,
            uiPort: 9091,
            envDefaults: { NODE_ENV: 'test', LOG_LEVEL: 'debug' },
            defaultDirs: ['/app', '/data', '/tmp'],
            presets: [
              { group: '健康检查', endpoints: [
                { method: 'GET', path: 'health', name: 'Health Check' },
              ] },
            ],
          },
          network: { name: 'e2e-network' },
        },
      },
    };
  });
};
