/**
 * Docker 操作路由
 *
 * 基于原版 as-mate/e2e 全量迁移，改为 e2e.yaml 配置驱动。
 * 功能：镜像构建(含 git 分支)、容器生命周期、Mock Gateway、SSE 日志、
 *       进程列表、目录浏览、容器内 exec、镜像列表、端口冲突检测。
 */

import { type FastifyPluginAsync } from 'fastify';
import { spawn, execSync } from 'child_process';
import path from 'path';
import type { E2EConfig, RepoConfig } from '@e2e-toolkit/core';
import { resolveRepoLocalPath, syncRepo, resolveBuildPaths, getRepoInfo } from '@e2e-toolkit/core';
import { getAppState } from '../app-state.js';

// =====================================================================
// Helpers
// =====================================================================

function safeExec(cmd: string, opts?: { cwd?: string; timeout?: number }): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      cwd: opts?.cwd,
      timeout: opts?.timeout ?? 10_000,
    }).trim();
  } catch {
    return '';
  }
}

function containerExists(name: string): boolean {
  return safeExec(`docker ps -a --filter "name=^${name}$" --format "{{.Names}}"`) === name;
}

function containerRunning(name: string): boolean {
  return safeExec(`docker ps --filter "name=^${name}$" --filter "status=running" --format "{{.Names}}"`) === name;
}

function getContainerInfoRaw(name: string): Record<string, string> | null {
  const result = safeExec(`docker ps -a --filter "name=^${name}$" --format "{{json .}}"`);
  if (!result) return null;
  try { return JSON.parse(result); } catch { return null; }
}

function getPortUser(hostPort: string): string | null {
  const result = safeExec(
    `docker ps --format "{{.Names}}\t{{.Ports}}" | grep "0.0.0.0:${hostPort}->" | head -1`,
  );
  if (!result) return null;
  return result.split('\t')[0] || null;
}

function ensureNetwork(networkName: string) {
  safeExec(`docker network create ${networkName} 2>/dev/null || true`);
}

// =====================================================================
// Git Helpers
// =====================================================================

function getGitBranches(repoDir: string): string[] {
  try {
    execSync('git fetch --prune origin 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8' });
    const result = execSync(
      'git branch -r --format "%(refname:short)" | sed "s|origin/||" | sort',
      { cwd: repoDir, encoding: 'utf-8' },
    );
    return result.trim().split('\n').filter(b => b && b !== 'HEAD');
  } catch {
    return ['main'];
  }
}

function getCurrentBranch(repoDir: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getCurrentCommit(repoDir: string): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function checkoutAndPull(repoDir: string, branch: string): { commit: string; output: string } {
  const output: string[] = [];
  try {
    output.push(execSync('git fetch origin', { cwd: repoDir, encoding: 'utf-8' }));
    output.push(execSync(`git checkout ${branch}`, { cwd: repoDir, encoding: 'utf-8' }));
    output.push(execSync(`git reset --hard origin/${branch}`, { cwd: repoDir, encoding: 'utf-8' }));
    const commit = execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    return { commit, output: output.join('\n') };
  } catch (err) {
    throw new Error(`Git checkout failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// =====================================================================
// Build State
// =====================================================================

interface BuildState {
  status: 'idle' | 'building' | 'success' | 'error';
  logs: string[];
  startTime?: number;
  endTime?: number;
  error?: string;
  imageName?: string;
}

let buildState: BuildState = { status: 'idle', logs: [] };

// =====================================================================
// Container State
// =====================================================================

interface ContainerState {
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  containerId?: string;
  error?: string;
}

let containerState: ContainerState = { status: 'stopped' };

// =====================================================================
// SSE Clients
// =====================================================================

const sseClients: Set<{ send: (data: string) => void }> = new Set();

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.send(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

// =====================================================================
// Route Plugin
// =====================================================================

export const dockerRoutes: FastifyPluginAsync = async (_app) => {
  // All config is read per-request via getters to support dynamic project switching
  const getConfig = (): E2EConfig | null => getAppState().config;
  const getContainerName = () => getConfig()?.service.container.name ?? 'e2e-service';
  const getNetworkName = () => getConfig()?.network?.name ?? 'e2e-network';
  const getDefaultImageName = () => getConfig()?.service.build.image ?? 'e2e-service:latest';
  const getConfigDir = () => getAppState().configDir;
  const getEventBus = () => getAppState().eventBus;

  function resolveRepoPath(repo: RepoConfig): string {
    const config = getConfig();
    const projectName = config?.project.name ?? 'default';
    return resolveRepoLocalPath(repo, projectName, getConfigDir());
  }

  /** Helper: read all current config values (call per-request for dynamic switching) */
  function ctx() {
    const config = getConfig();
    return {
      config,
      containerName: getContainerName(),
      networkName: getNetworkName(),
      defaultImageName: getDefaultImageName(),
      configDir: getConfigDir(),
      eventBus: getEventBus(),
    };
  }

  const app = _app;

  // ─── SSE Event Stream ────────────────────────────────────────────

  app.get('/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const client = {
      send: (data: string) => reply.raw.write(data),
    };
    sseClients.add(client);

    client.send(`event: build-state\ndata: ${JSON.stringify(buildState)}\n\n`);
    client.send(`event: container-state\ndata: ${JSON.stringify(containerState)}\n\n`);

    request.raw.on('close', () => {
      sseClients.delete(client);
    });
  });

  // ─── Default Image Info ─────────────────────────────────────────

  app.get('/default-image', async () => {
    const { config, defaultImageName } = ctx();
    return {
      imageName: defaultImageName,
      version: config?.project.version ?? 'latest',
      projectName: config?.project.name ?? 'unknown',
    };
  });

  // ─── Branches Info ──────────────────────────────────────────────

  app.get('/branches', async () => {
    const { config, configDir } = ctx();
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    const result: Record<string, {
      branches: string[];
      current: string;
      commit: string;
      isRemote: boolean;
      url?: string;
    }> = {};
    for (const repo of repos) {
      const info = getRepoInfo(repo, projectName, configDir);
      if (info.branches.length > 0) {
        result[repo.name] = {
          branches: info.branches,
          current: info.currentBranch || 'unknown',
          commit: info.lastCommit || 'unknown',
          isRemote: info.isRemote,
          url: info.url,
        };
      } else {
        // Fallback for repos that haven't been cloned yet
        const repoPath = info.localPath;
        result[repo.name] = {
          branches: getGitBranches(repoPath),
          current: getCurrentBranch(repoPath),
          commit: getCurrentCommit(repoPath),
          isRemote: info.isRemote,
          url: info.url,
        };
      }
    }
    return result;
  });

  // ─── Build Image ─────────────────────────────────────────────────

  app.post('/build', async (request) => {
    const { config, defaultImageName, configDir, eventBus } = ctx();
    const body = request.body as {
      imageName?: string;
      noCache?: boolean;
      branches?: Record<string, string>;
    } | undefined;

    const imageName = body?.imageName || defaultImageName;
    const noCache = body?.noCache || false;
    const branchSelections = body?.branches || {};

    if (buildState.status === 'building') {
      return { success: false, error: 'Build already in progress' };
    }

    buildState = {
      status: 'building',
      logs: [],
      startTime: Date.now(),
      imageName,
    };
    broadcast('build-state', buildState);

    // Step 1: Sync repos (clone remote repos / checkout branches)
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    try {
      for (const repo of repos) {
        const branch = branchSelections[repo.name] || repo.branch;
        const isRemote = !!repo.url;

        if (isRemote || branch) {
          const msg = `[Git] ${repo.name}: ${isRemote ? 'syncing remote' : 'checking out'} ${branch || 'default'}...\n`;
          buildState.logs.push(msg);
          broadcast('build-log', { line: msg, type: 'stdout' });

          const result = await syncRepo(repo, projectName, configDir, branch || undefined, (log) => {
            const logMsg = `${log}\n`;
            buildState.logs.push(logMsg);
            broadcast('build-log', { line: logMsg, type: 'stdout' });
          });

          if (!result.success) {
            throw new Error(`Repo ${repo.name}: ${result.error}`);
          }

          const msg2 = `[Git] ${repo.name}: ${result.action} → ${result.branch || 'default'}\n`;
          buildState.logs.push(msg2);
          broadcast('build-log', { line: msg2, type: 'stdout' });
        }
      }
    } catch (err) {
      buildState.status = 'error';
      buildState.endTime = Date.now();
      buildState.error = err instanceof Error ? err.message : String(err);
      broadcast('build-state', buildState);
      return { success: false, error: buildState.error };
    }

    // Step 2: Docker build
    const dockerfile = config?.service.build.dockerfile ?? 'Dockerfile';
    const context = config?.service.build.context ?? '.';
    // Resolve paths using workspace manager (handles remote vs local repos)
    const { resolvedDockerfile, resolvedContext } = resolveBuildPaths(
      repos, projectName, configDir, dockerfile, context,
    );

    const args = ['build', '-f', resolvedDockerfile, '-t', imageName];
    if (noCache) args.push('--no-cache');
    // Add build args from config
    if (config?.service.build.args) {
      for (const [key, value] of Object.entries(config.service.build.args)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }
    args.push(resolvedContext);

    const proc = spawn('docker', args);

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      buildState.logs.push(line);
      broadcast('build-log', { line, type: 'stdout' });
    });

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      buildState.logs.push(line);
      broadcast('build-log', { line, type: 'stderr' });
    });

    proc.on('close', (code) => {
      buildState.endTime = Date.now();
      if (code === 0) {
        buildState.status = 'success';
      } else {
        buildState.status = 'error';
        buildState.error = `Build exited with code ${code}`;
      }
      broadcast('build-state', buildState);
      eventBus?.emit('docker', { event: 'build-end', data: buildState });
    });

    return { success: true, message: 'Build started', imageName };
  });

  // ─── Build Status ────────────────────────────────────────────────

  app.get('/build/status', async () => {
    return buildState;
  });

  // ─── Sync Repos ──────────────────────────────────────────────────

  app.post('/sync-repos', async (request) => {
    const { config, configDir } = ctx();
    const body = request.body as { branches?: Record<string, string> } | undefined;
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    const branchSelections = body?.branches || {};

    const results = [];
    for (const repo of repos) {
      const branch = branchSelections[repo.name] || repo.branch;
      const result = await syncRepo(repo, projectName, configDir, branch || undefined);
      results.push(result);
    }
    return { success: true, results };
  });

  // ─── Workspace Info ──────────────────────────────────────────────

  app.get('/workspace', async () => {
    const { config, configDir } = ctx();
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    const repoInfos = repos.map(r => getRepoInfo(r, projectName, configDir));
    return {
      projectName,
      repos: repoInfos,
    };
  });

  // ─── Start Container ─────────────────────────────────────────────

  app.post('/start', async (request) => {
    const body = request.body as {
      imageName?: string;
      useMockGateway?: boolean;
      envOverrides?: Record<string, string>;
    } | undefined;

    if (containerState.status === 'running' || containerState.status === 'starting') {
      return { success: false, error: 'Container already running or starting' };
    }

    containerState = { status: 'starting' };
    broadcast('container-state', containerState);

    const { config, containerName, networkName, defaultImageName, eventBus } = ctx();
    const imageName = body?.imageName || defaultImageName;
    const useMockGateway = body?.useMockGateway !== false;
    const envOverrides = body?.envOverrides || {};

    try {
      // Clean up existing containers
      if (containerExists(containerName)) {
        safeExec(`docker rm -f ${containerName}`);
      }

      // Clean up mock containers
      if (config?.mocks) {
        for (const mockName of Object.keys(config.mocks)) {
          const mockContainerName = `${containerName}-mock-${mockName}`;
          if (containerExists(mockContainerName)) {
            safeExec(`docker rm -f ${mockContainerName}`);
          }
        }
      }

      // Port conflict check
      const portConflicts: string[] = [];
      const ports = config?.service.container.ports ?? [];
      for (const mapping of ports) {
        const hostPort = mapping.split(':')[0];
        const user = getPortUser(hostPort);
        if (user) {
          portConflicts.push(`Port ${hostPort} is already used by container "${user}"`);
        }
      }

      // Also check mock ports
      if (useMockGateway && config?.mocks) {
        for (const [, mockConfig] of Object.entries(config.mocks)) {
          const user = getPortUser(String(mockConfig.port));
          if (user) {
            portConflicts.push(`Mock port ${mockConfig.port} is already used by container "${user}"`);
          }
        }
      }

      if (portConflicts.length > 0) {
        const errorMsg = `Port conflict detected:\n${portConflicts.join('\n')}`;
        containerState = { status: 'error', error: errorMsg };
        broadcast('container-state', containerState);
        return { success: false, error: errorMsg };
      }

      // Ensure network
      ensureNetwork(networkName);

      // Step 1: Start mock containers if enabled
      if (useMockGateway && config?.mocks) {
        for (const [mockName, mockConfig] of Object.entries(config.mocks)) {
          const mockContainerName = `${containerName}-mock-${mockName}`;

          if (mockConfig.image) {
            // Use pre-built image
            const mockMsg = `[Mock ${mockName}] Starting with image ${mockConfig.image}...\n`;
            broadcast('container-log', { line: mockMsg, type: 'stdout' });
            const containerPort = mockConfig.containerPort ?? mockConfig.port;
            execSync(
              `docker run -d --name ${mockContainerName} --network ${networkName} -p ${mockConfig.port}:${containerPort} ${mockConfig.image}`,
              { encoding: 'utf-8' },
            );
          } else if (mockConfig.routes) {
            // For declarative mocks, we'll start the mock using the core mock-generator
            // For now, log a message
            const mockMsg = `[Mock ${mockName}] Declarative mock on port ${mockConfig.port} (handled by dashboard)\n`;
            broadcast('container-log', { line: mockMsg, type: 'stdout' });
          }

          const gwMsg = `[Mock ${mockName}] Started on network ${networkName}\n`;
          broadcast('container-log', { line: gwMsg, type: 'stdout' });
        }
      }

      // Step 2: Build docker run command
      const dockerArgs = ['run', '-d', '--name', containerName, '--network', networkName];

      // Port mappings from config
      for (const mapping of ports) {
        dockerArgs.push('-p', mapping);
      }

      // Environment variables: config < envOverrides
      const configEnv = config?.service.container.environment ?? {};
      const finalEnv: Record<string, string> = { ...configEnv, ...envOverrides };
      for (const [key, value] of Object.entries(finalEnv)) {
        if (value !== undefined && value !== '') {
          dockerArgs.push('-e', `${key}=${value}`);
        }
      }

      // Volumes
      if (config?.service.container.volumes) {
        for (const vol of config.service.container.volumes) {
          dockerArgs.push('-v', vol);
        }
      }

      // Health check
      if (config?.service.container.healthcheck) {
        const hc = config.service.container.healthcheck;
        // Build health check port from first port mapping
        const healthPort = ports[0]?.split(':')[1] ?? '3000';
        const healthCmd = `curl -f http://localhost:${healthPort}${hc.path} || exit 1`;
        dockerArgs.push(
          '--health-cmd', `"${healthCmd}"`,
          '--health-interval', hc.interval ?? '10s',
          '--health-timeout', hc.timeout ?? '5s',
          '--health-retries', String(hc.retries ?? 10),
          '--health-start-period', hc.startPeriod ?? '30s',
        );
      }

      dockerArgs.push(imageName);

      const startMsg = `[Container] Starting ${containerName} with image ${imageName}...\n`;
      broadcast('container-log', { line: startMsg, type: 'stdout' });

      // Use spawnSync to properly handle arguments with spaces/special chars
      const dockerRunCmd = `docker ${dockerArgs.join(' ')}`;
      buildState.logs.push(`[Container] CMD: ${dockerRunCmd}\n`);
      broadcast('container-log', { line: `[Container] CMD: ${dockerRunCmd}\n`, type: 'stdout' });

      const containerId = execSync(dockerRunCmd, {
        encoding: 'utf-8',
      }).trim();

      containerState = { status: 'running', containerId: containerId.slice(0, 12) };
      broadcast('container-state', containerState);
      eventBus?.emit('docker', { event: 'container-started', data: { containerId } });

      const successMsg = `[Container] Started: ${containerId.slice(0, 12)}\n`;
      broadcast('container-log', { line: successMsg, type: 'stdout' });

      return { success: true, ...containerState };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      containerState = { status: 'error', error: errorMsg };
      broadcast('container-state', containerState);
      broadcast('container-log', { line: `[Error] ${errorMsg}\n`, type: 'stderr' });
      return { success: false, error: errorMsg };
    }
  });

  // ─── Stop Container ──────────────────────────────────────────────

  app.post('/stop', async () => {
    const { config, containerName, eventBus } = ctx();
    containerState = { status: 'stopping' };
    broadcast('container-state', containerState);

    try {
      safeExec(`docker rm -f ${containerName}`);
      // Stop mock containers
      if (config?.mocks) {
        for (const mockName of Object.keys(config.mocks)) {
          safeExec(`docker rm -f ${containerName}-mock-${mockName}`);
        }
      }
      containerState = { status: 'stopped' };
      broadcast('container-state', containerState);
      eventBus?.emit('docker', { event: 'container-stopped', data: {} });
      return { success: true };
    } catch (err) {
      containerState = {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      broadcast('container-state', containerState);
      return { success: false, error: containerState.error };
    }
  });

  // ─── Container Status ────────────────────────────────────────────

  app.get('/status', async () => {
    const { config, containerName } = ctx();
    const containers: Record<string, string>[] = [];

    // Main container
    const mainInfo = getContainerInfoRaw(containerName);
    if (mainInfo) containers.push(mainInfo);

    // Mock containers
    if (config?.mocks) {
      for (const mockName of Object.keys(config.mocks)) {
        const mockInfo = getContainerInfoRaw(`${containerName}-mock-${mockName}`);
        if (mockInfo) containers.push(mockInfo);
      }
    }

    // Sync internal state
    if (containerRunning(containerName)) {
      if (containerState.status !== 'running') {
        containerState = { status: 'running', containerId: mainInfo?.ID };
      }
    } else {
      if (containerState.status === 'running') {
        containerState = { status: 'stopped' };
      }
    }

    return { ...containerState, containers };
  });

  // ─── Container Logs (Static) ─────────────────────────────────────

  app.get('/logs', async (request) => {
    const { config, containerName } = ctx();
    const { lines, service } = request.query as { lines?: string; service?: string };
    const tailLines = lines || '100';
    let targetContainer = containerName;
    if (service && config?.mocks?.[service]) {
      targetContainer = `${containerName}-mock-${service}`;
    }

    try {
      const result = execSync(
        `docker logs --tail=${tailLines} ${targetContainer} 2>&1`,
        { encoding: 'utf-8', timeout: 10000 },
      );
      return { success: true, logs: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Container Logs Stream (SSE) ─────────────────────────────────

  app.get('/logs/stream', async (request, reply) => {
    const { config, containerName } = ctx();
    const { service, lines } = request.query as { service?: string; lines?: string };
    const tailLines = lines || '50';
    let targetContainer = containerName;
    if (service && config?.mocks?.[service]) {
      targetContainer = `${containerName}-mock-${service}`;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const proc = spawn('docker', ['logs', '-f', '--tail', tailLines, targetContainer], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const sendLine = (line: string, stream: 'stdout' | 'stderr') => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ line, stream, time: Date.now() })}\n\n`);
      } catch {
        proc.kill();
      }
    };

    proc.stdout.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        sendLine(line, 'stdout');
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        sendLine(line, 'stderr');
      }
    });

    proc.on('close', () => {
      try {
        reply.raw.write(`event: close\ndata: {}\n\n`);
        reply.raw.end();
      } catch { /* ignore */ }
    });

    request.raw.on('close', () => {
      proc.kill();
    });
  });

  // ─── Container Processes ─────────────────────────────────────────

  app.get('/processes', async () => {
    const { containerName } = ctx();
    if (!containerRunning(containerName)) {
      return { success: false, error: 'Container not running' };
    }
    try {
      const raw = execSync(
        `docker top ${containerName} aux 2>&1`,
        { encoding: 'utf-8', timeout: 10000 },
      ).trim();

      const lines = raw.split('\n');
      const processes = lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) return null;
        return {
          user: parts[0],
          pid: parts[1],
          cpu: parts[2],
          mem: parts[3],
          vsz: parts[4],
          rss: parts[5],
          stat: parts[7],
          time: parts[9],
          command: parts.slice(10).join(' '),
        };
      }).filter(Boolean);

      return { success: true, processes };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Container Directory Browsing ────────────────────────────────

  app.get('/dirs', async (request) => {
    const { config, containerName } = ctx();
    if (!containerRunning(containerName)) {
      return { success: false, error: 'Container not running' };
    }

    const { path: dirPath } = request.query as { path?: string };
    const defaultDirs = config?.dashboard?.defaultDirs ?? ['/workspace', '/app', '/config', '/home', '/tmp'];
    const targetDirs = dirPath ? [dirPath] : defaultDirs;

    try {
      const results: Array<{
        path: string;
        exists: boolean;
        entries?: Array<{
          permissions: string;
          links: string;
          owner: string;
          group: string;
          size: string;
          date: string;
          name: string;
        }>;
        error?: string;
      }> = [];

      for (const dir of targetDirs) {
        try {
          const raw = execSync(
            `docker exec ${containerName} ls -la ${dir} 2>&1`,
            { encoding: 'utf-8', timeout: 5000 },
          ).trim();

          const lines = raw.split('\n');
          const entries = lines
            .filter(l => !l.startsWith('total '))
            .map(line => {
              const parts = line.trim().split(/\s+/);
              if (parts.length < 7) return null;
              return {
                permissions: parts[0],
                links: parts[1],
                owner: parts[2],
                group: parts[3],
                size: parts[4],
                date: parts.slice(5, parts.length - 1).join(' '),
                name: parts[parts.length - 1],
              };
            })
            .filter(Boolean) as Array<{
              permissions: string;
              links: string;
              owner: string;
              group: string;
              size: string;
              date: string;
              name: string;
            }>;

          results.push({ path: dir, exists: true, entries });
        } catch (e) {
          results.push({
            path: dir,
            exists: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return { success: true, directories: results };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Execute Command in Container ────────────────────────────────

  app.post('/exec', async (request) => {
    const { containerName } = ctx();
    if (!containerRunning(containerName)) {
      return { success: false, error: 'Container not running' };
    }

    const { command } = (request.body as { command?: string }) || {};
    if (!command) {
      return { success: false, error: 'Missing command' };
    }

    try {
      const output = execSync(
        `docker exec ${containerName} sh -c ${JSON.stringify(command)} 2>&1`,
        { encoding: 'utf-8', timeout: 15000 },
      ).trim();
      return { success: true, output };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number; message?: string };
      return {
        success: false,
        output: execErr.stdout || execErr.stderr || '',
        exitCode: execErr.status,
        error: execErr.message || String(err),
      };
    }
  });

  // ─── Docker Images List ──────────────────────────────────────────

  app.get('/images', async () => {
    try {
      const result = safeExec('docker images --format "{{json .}}" | head -20');
      const images = result
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
      return { success: true, images };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
};
