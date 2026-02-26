/**
 * ArgusAI Dashboard 后端服务器
 *
 * Supports two modes:
 * 1. Standalone: `node dist/server/index.js` (auto-starts, creates own EventBus)
 * 2. Embedded: `createDashboardApp(options)` returns a Fastify instance for the unified server
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, createEventBus, EventBus, type E2EConfig, type Store, type TaskQueue, type Notifier, type ResourceLimiter } from 'argusai-core';
import { initAppState, getAppState, type AppState } from './app-state.js';
import { addProject, loadRegistry, getActiveProject } from './project-registry.js';
import { dockerRoutes } from './routes/docker.js';
import { proxyRoutes } from './routes/proxy.js';
import { testRoutes } from './routes/tests.js';
import { configRoutes } from './routes/config.js';
import { projectRoutes } from './routes/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =====================================================================
// Factory Options
// =====================================================================

export interface DashboardOptions {
  eventBus?: EventBus;
  config?: E2EConfig | null;
  configDir?: string;
  configPath?: string | null;
  port?: number;
  /** Platform services (injected by unified server). */
  store?: Store;
  taskQueue?: TaskQueue;
  notifier?: Notifier;
  resourceLimiter?: ResourceLimiter;
}

// =====================================================================
// Shared helpers
// =====================================================================

async function loadProjectConfig(configPath: string, appState: AppState): Promise<boolean> {
  try {
    const config = await loadConfig(configPath);
    const absPath = path.resolve(configPath);
    appState.config = config;
    appState.configDir = path.dirname(absPath);
    appState.configPath = absPath;
    console.log(`[config] Loaded e2e.yaml for project: ${config.project.name}`);
    return true;
  } catch (err) {
    console.warn(`[config] Failed to load ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// =====================================================================
// Factory: createDashboardApp
// =====================================================================

export async function createDashboardApp(options?: DashboardOptions): Promise<{ app: FastifyInstance; appState: AppState }> {
  const eventBus = options?.eventBus ?? createEventBus();

  const appState = initAppState({
    config: options?.config ?? null,
    configDir: options?.configDir ?? process.cwd(),
    configPath: options?.configPath ?? null,
    eventBus,
    activities: [],
    store: options?.store,
    taskQueue: options?.taskQueue,
    notifier: options?.notifier,
    resourceLimiter: options?.resourceLimiter,
  });

  if (!appState.config) {
    const envConfigPath = process.env.E2E_CONFIG || undefined;
    if (envConfigPath) {
      await loadProjectConfig(envConfigPath, appState);
      const loadedConfig = appState.config as E2EConfig | null;
      if (loadedConfig) {
        addProject({
          name: loadedConfig.project.name,
          configPath: path.resolve(envConfigPath),
          description: loadedConfig.project.description,
        });
      }
    } else {
      const activeProject = getActiveProject();
      if (activeProject) {
        await loadProjectConfig(activeProject.configPath, appState);
      }
    }
  }

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: true });

  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(dockerRoutes, { prefix: '/api/docker' });
  await app.register(proxyRoutes, { prefix: '/api/proxy' });
  await app.register(testRoutes, { prefix: '/api/tests' });
  await app.register(configRoutes, { prefix: '/api/config' });

  // Unified SSE event stream — delivers all EventBus events to the browser
  app.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const channels = ['build', 'test', 'setup', 'clean', 'container', 'activity'];
    const unsubscribers: Array<() => void> = [];

    for (const channel of channels) {
      const unsub = eventBus.subscribe(channel, (msg) => {
        try {
          reply.raw.write(`event: ${channel}:${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`);
        } catch { /* client disconnected */ }
      });
      unsubscribers.push(unsub);
    }

    request.raw.on('close', () => {
      for (const unsub of unsubscribers) unsub();
    });
  });

  // Activity timeline REST endpoints
  app.get('/api/activities', async (request) => {
    const { limit } = request.query as { limit?: string };
    const n = parseInt(limit || '50');
    return { activities: appState.activities.slice(0, n) };
  });

  // Test history (from persistent store)
  app.get('/api/history/tests', async (request) => {
    const { project, limit } = request.query as { project?: string; limit?: string };
    if (!appState.store) return { records: [], message: 'Store not configured' };
    const records = await appState.store.getTestRecords(project ?? appState.configDir, parseInt(limit || '50'));
    return { records };
  });

  // Build history (from persistent store)
  app.get('/api/history/builds', async (request) => {
    const { project, limit } = request.query as { project?: string; limit?: string };
    if (!appState.store) return { records: [], message: 'Store not configured' };
    const records = await appState.store.getBuildRecords(project ?? appState.configDir, parseInt(limit || '50'));
    return { records };
  });

  // Project statistics
  app.get('/api/stats', async (request) => {
    const { project } = request.query as { project?: string };
    if (!appState.store) return { stats: null, message: 'Store not configured' };
    const stats = await appState.store.getProjectStats(project ?? appState.configDir);
    return { stats };
  });

  // Queue status
  app.get('/api/queue', async () => {
    if (!appState.taskQueue) return { stats: null, tasks: [], message: 'Queue not configured' };
    return {
      stats: appState.taskQueue.getStats(),
      tasks: appState.taskQueue.list(),
    };
  });

  // Resource usage
  app.get('/api/resources', async () => {
    if (!appState.resourceLimiter) return { projects: [], message: 'Resource limiter not configured' };
    return {
      projects: appState.resourceLimiter.getAllProjectStates(),
      globalAvailable: appState.resourceLimiter.globalAvailable,
      globalCapacity: appState.resourceLimiter.globalCapacity,
      globalWaiting: appState.resourceLimiter.globalWaiting,
    };
  });

  app.get('/api/health', async () => {
    const state = getAppState();
    return {
      status: 'ok',
      service: 'argusai-dashboard',
      project: state.config?.project.name ?? 'unconfigured',
      version: state.config?.project.version,
      containerName: state.config?.service?.container?.name ?? 'unknown',
      containerUrl: state.config?.service?.vars?.base_url,
      uptime: process.uptime(),
    };
  });

  const publicDir = path.resolve(__dirname, '../public');
  try {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: true,
    });
    app.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html', publicDir);
    });
  } catch {
    // Dev mode: dist/public may not exist
  }

  return { app, appState };
}

// =====================================================================
// Standalone entrypoint (when run directly)
// =====================================================================

const isMainModule = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  process.argv[1].endsWith('dist/server/index.js')
);

if (isMainModule) {
  const { app, appState } = await createDashboardApp();

  const PORT = parseInt(
    process.env.E2E_PORT ||
    String(appState.config?.dashboard?.port ?? 9095),
  );

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🎯 ArgusAI Dashboard running on http://localhost:${PORT}`);
    if (appState.config) {
      console.log(`   Project: ${appState.config.project.name}`);
    }
    const registry = loadRegistry();
    console.log(`   Registered projects: ${registry.projects.length}\n`);
  } catch (err) {
    console.error('Failed to start ArgusAI dashboard:', err);
    process.exit(1);
  }
}

export { getAppState, updateAppState } from './app-state.js';
