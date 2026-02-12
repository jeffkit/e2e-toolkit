/**
 * E2E Dashboard API 客户端
 *
 * 基于原版 as-mate/e2e api.ts 迁移，新增分支、presets 等接口。
 */

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set Content-Type: application/json when there's a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  return res.json() as Promise<T>;
}

// ==================== Docker ====================

export const docker = {
  build: (options?: {
    imageName?: string;
    noCache?: boolean;
    branches?: Record<string, string>;
  }) =>
    request<{ success: boolean; message?: string; error?: string }>('/docker/build', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),

  getBuildStatus: () =>
    request<{
      status: string;
      logs: string[];
      startTime?: number;
      endTime?: number;
      error?: string;
    }>('/docker/build/status'),

  getDefaultImage: () =>
    request<{ imageName: string; version: string; projectName: string }>('/docker/default-image'),

  getBranches: () =>
    request<Record<string, { branches: string[]; current: string; commit: string }>>('/docker/branches'),

  start: (options?: {
    imageName?: string;
    useMockGateway?: boolean;
    envOverrides?: Record<string, string>;
  }) =>
    request<{ success: boolean; status?: string; containerId?: string; error?: string }>(
      '/docker/start',
      { method: 'POST', body: JSON.stringify(options || {}) },
    ),

  stop: () =>
    request<{ success: boolean; error?: string }>('/docker/stop', { method: 'POST' }),

  getStatus: () =>
    request<{ status: string; containers?: unknown[]; containerId?: string }>('/docker/status'),

  getLogs: (lines?: number, service?: string) =>
    request<{ success: boolean; logs?: string; error?: string }>(
      `/docker/logs?lines=${lines || 100}${service ? `&service=${service}` : ''}`,
    ),

  getImages: () =>
    request<{ success: boolean; images?: unknown[]; error?: string }>('/docker/images'),

  getProcesses: () =>
    request<{ success: boolean; processes?: unknown[]; error?: string }>('/docker/processes'),

  getDirs: (path?: string) =>
    request<{ success: boolean; directories?: unknown[]; error?: string }>(
      `/docker/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),

  exec: (command: string) =>
    request<{ success: boolean; output?: string; exitCode?: number; error?: string }>(
      '/docker/exec',
      { method: 'POST', body: JSON.stringify({ command }) },
    ),
};

// ==================== API Proxy ====================

export const proxy = {
  call: async (method: string, path: string, body?: unknown) => {
    const options: RequestInit = { method };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    return request<unknown>(`/proxy/${path}`, options);
  },
};

// ==================== Tests ====================

export const tests = {
  getSuites: () =>
    request<{
      suites: Array<{
        id: string;
        name: string;
        description: string;
        file: string;
        runner?: string;
      }>;
    }>('/tests/suites'),

  run: (suite?: string, containerUrl?: string) =>
    request<{ success: boolean; testId?: string; error?: string }>('/tests/run', {
      method: 'POST',
      body: JSON.stringify({ suite, containerUrl }),
    }),

  getCurrent: () =>
    request<{
      test: {
        id: string;
        suite: string;
        status: string;
        startTime: number;
        output: string[];
      } | null;
    }>('/tests/current'),

  getHistory: (limit?: number) =>
    request<{
      tests: Array<{
        id: string;
        suite: string;
        status: string;
        startTime: number;
        endTime?: number;
        exitCode?: number;
        output: string[];
      }>;
    }>(`/tests/history?limit=${limit || 20}`),

  getResult: (testId: string) =>
    request<{ success: boolean; test?: unknown; error?: string }>(`/tests/result/${testId}`),
};

// ==================== Config ====================

export const config = {
  get: () => request<Record<string, unknown>>('/config'),
  update: (updates: Record<string, unknown>) =>
    request<{ success: boolean }>('/config', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
};

// ==================== Health ====================

export const health = {
  dashboard: () =>
    request<{
      status: string;
      project?: string;
      version?: string;
      containerUrl?: string;
      containerName?: string;
    }>('/health'),
};

// ==================== Projects ====================

export interface ProjectEntry {
  name: string;
  configPath: string;
  description?: string;
  addedAt: string;
}

export const projects = {
  list: () =>
    request<{
      activeProject: string | null;
      currentLoaded: string | null;
      projects: ProjectEntry[];
    }>('/projects'),

  add: (name: string, configPath: string, description?: string) =>
    request<{ success: boolean; registry?: unknown; error?: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, configPath, description }),
    }),

  remove: (name: string) =>
    request<{ success: boolean }>(`/projects/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  activate: (name: string) =>
    request<{
      success: boolean;
      project?: { name: string; description?: string; version?: string; configPath: string };
      error?: string;
    }>(`/projects/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
    }),

  getActive: () =>
    request<{
      active: boolean;
      project?: { name: string; description?: string; version?: string };
      configPath?: string;
    }>('/projects/active'),

  scan: (directory: string) =>
    request<{
      success: boolean;
      found?: Array<{ name: string; configPath: string; description?: string }>;
      error?: string;
    }>('/projects/scan', {
      method: 'POST',
      body: JSON.stringify({ directory }),
    }),

  /** 获取项目的解析后配置（JSON 格式） */
  getParsedConfig: (name: string) =>
    request<{ success: boolean; config?: Record<string, unknown>; error?: string }>(
      `/projects/${encodeURIComponent(name)}/parsed-config`,
    ),

  /** 读取项目的 e2e.yaml 原始内容 */
  getConfigFile: (name: string) =>
    request<{ success: boolean; content?: string; path?: string; error?: string }>(
      `/projects/${encodeURIComponent(name)}/config-file`,
    ),

  /** 保存项目的 e2e.yaml（接收 JSON 对象或原始 YAML） */
  saveConfigFile: (name: string, data: { config?: Record<string, unknown>; raw?: string }) =>
    request<{ success: boolean; error?: string }>(
      `/projects/${encodeURIComponent(name)}/config-file`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  /** 创建新项目（生成 e2e.yaml + 自动注册） */
  create: (directory: string, config: Record<string, unknown>) =>
    request<{ success: boolean; configPath?: string; error?: string }>(
      '/projects/create',
      { method: 'POST', body: JSON.stringify({ directory, config }) },
    ),

  /** 获取 e2e.yaml schema 说明和模板 */
  getSchema: () =>
    request<{
      sections: Array<{
        key: string;
        title: string;
        description: string;
        required: boolean;
        fields: Array<{
          key: string;
          type: string;
          required: boolean;
          description: string;
          example?: string;
        }>;
      }>;
      templates: Record<string, Record<string, unknown>>;
    }>('/projects/schema'),
};
