/**
 * E2E 测试辅助工具
 */

export const CONTAINER_URL = process.env.E2E_CONTAINER_URL || 'http://localhost:3000';
export const DASHBOARD_URL = process.env.E2E_DASHBOARD_URL || 'http://localhost:9095';

/**
 * 向容器发送 HTTP 请求
 */
export async function containerRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: { timeout?: number }
): Promise<{ status: number; data: T; headers: Headers }> {
  const url = `${CONTAINER_URL}${path}`;
  const timeout = options?.timeout || 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {
      'X-Trace-Id': `e2e-${Date.now()}`,
    };

    // 只在有 body 时才设置 Content-Type，避免 Fastify 对空 JSON body 报 400
    if (body !== undefined && body !== null && method !== 'GET') {
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
      data = await response.json() as T;
    } else {
      data = await response.text() as unknown as T;
    }

    return { status: response.status, data, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 等待容器健康
 */
export async function waitForHealthy(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await containerRequest('GET', '/livez', undefined, { timeout: 5000 });
      if (status === 200) return;
    } catch {
      // 容器尚未就绪，继续重试
    }
    await sleep(2000);
  }
  throw new Error(`Container did not become healthy within ${timeoutMs}ms`);
}

/**
 * 等待一段时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成测试用 game_id
 */
export function testGameId(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 断言响应成功
 *
 * as-mate API 约定：success=0 表示成功，success=1 表示失败（类似 Unix exit code）
 */
export function assertSuccess(data: { success?: number; error?: string }) {
  if (data.success !== 0) {
    throw new Error(`Expected success=0, got success=${data.success}, error: ${data.error}`);
  }
}

/**
 * 在容器内执行命令（通过 Dashboard API 的 /api/docker/exec）
 *
 * @returns 命令输出字符串
 */
export async function containerExec(command: string): Promise<string> {
  const url = `${DASHBOARD_URL}/api/docker/exec`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });

  const data = await response.json() as { success: boolean; output?: string; error?: string };
  if (!data.success) {
    throw new Error(`containerExec failed: ${data.error}\nOutput: ${data.output || ''}`);
  }
  return data.output || '';
}

/**
 * 检查容器内路径是否存在
 */
export async function containerPathExists(path: string): Promise<boolean> {
  try {
    await containerExec(`test -e ${path} && echo exists`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 列出容器内目录下的文件名
 */
export async function containerLs(dirPath: string): Promise<string[]> {
  const output = await containerExec(`ls ${dirPath}`);
  return output.split('\n').filter(Boolean);
}

/**
 * 读取容器内文件内容
 */
export async function containerCat(filePath: string): Promise<string> {
  return containerExec(`cat ${filePath}`);
}

/**
 * 读取容器内符号链接的目标
 */
export async function containerReadlink(linkPath: string): Promise<string> {
  return containerExec(`readlink ${linkPath}`);
}
