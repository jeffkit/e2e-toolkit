/**
 * E2E Toolkit Dashboard 后端服务器
 *
 * 支持多项目管理与动态切换。
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, createEventBus, type E2EConfig } from '@e2e-toolkit/core';
import { initAppState, getAppState } from './app-state.js';
import { addProject, loadRegistry, getActiveProject } from './project-registry.js';
import { dockerRoutes } from './routes/docker.js';
import { proxyRoutes } from './routes/proxy.js';
import { testRoutes } from './routes/tests.js';
import { configRoutes } from './routes/config.js';
import { projectRoutes } from './routes/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =====================================================================
// Initialize AppState
// =====================================================================

const eventBus = createEventBus();

const appState = initAppState({
  config: null,
  configDir: process.cwd(),
  configPath: null,
  eventBus,
});

// =====================================================================
// Load config: E2E_CONFIG env > active project in registry > fallback
// =====================================================================

const envConfigPath = process.env.E2E_CONFIG || undefined;

async function loadProjectConfig(configPath: string): Promise<boolean> {
  try {
    const config = await loadConfig(configPath);
    const absPath = path.resolve(configPath);
    appState.config = config;
    appState.configDir = path.dirname(absPath);
    appState.configPath = absPath;
    console.log(`[config] Loaded e2e.yaml for project: ${config.project.name}`);
    console.log(`[config] Config dir: ${appState.configDir}`);
    return true;
  } catch (err) {
    console.warn(`[config] Failed to load ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

if (envConfigPath) {
  // Priority 1: E2E_CONFIG environment variable
  const loaded = await loadProjectConfig(envConfigPath);
  if (loaded && appState.config) {
    // Auto-register this project
    addProject({
      name: appState.config.project.name,
      configPath: path.resolve(envConfigPath),
      description: appState.config.project.description,
    });
  }
} else {
  // Priority 2: Active project from registry
  const activeProject = getActiveProject();
  if (activeProject) {
    await loadProjectConfig(activeProject.configPath);
  } else {
    console.warn('[config] No E2E_CONFIG and no active project in registry.');
    console.warn('[config] Dashboard will run with limited functionality.');
    console.warn('[config] Use the Projects page to add and activate a project.');
  }
}

// =====================================================================
// Determine ports
// =====================================================================

const PORT = parseInt(
  process.env.E2E_PORT ||
    String(appState.config?.dashboard?.port ?? 9095),
);

// =====================================================================
// Fastify App
// =====================================================================

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, { origin: true });

// =====================================================================
// API Routes
// =====================================================================

await app.register(projectRoutes, { prefix: '/api/projects' });
await app.register(dockerRoutes, { prefix: '/api/docker' });
await app.register(proxyRoutes, { prefix: '/api/proxy' });
await app.register(testRoutes, { prefix: '/api/tests' });
await app.register(configRoutes, { prefix: '/api/config' });

// Health check (reads from live appState)
app.get('/api/health', async () => {
  const state = getAppState();
  return {
    status: 'ok',
    service: 'e2e-toolkit-dashboard',
    project: state.config?.project.name ?? 'unconfigured',
    version: state.config?.project.version,
    containerName: state.config?.service.container.name ?? 'unknown',
    containerUrl: state.config?.service.vars?.base_url,
    uptime: process.uptime(),
  };
});

// =====================================================================
// Static Files (Production Mode)
// =====================================================================

const publicDir = path.resolve(__dirname, '../dist/public');
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

// =====================================================================
// Start Server
// =====================================================================

async function start() {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🎯 E2E Dashboard running on http://localhost:${PORT}`);
    if (appState.config) {
      console.log(`   Project: ${appState.config.project.name}`);
      console.log(`   Container: ${appState.config.service.container.name}`);
    }
    const registry = loadRegistry();
    console.log(`   Registered projects: ${registry.projects.length}`);
    console.log('');
  } catch (err) {
    console.error('Failed to start E2E dashboard:', err);
    process.exit(1);
  }
}

start();

export { app, appState };
