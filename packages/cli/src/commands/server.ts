/**
 * @module commands/server
 * `preflight server` — Start the unified Preflight server.
 *
 * Launches MCP server (stdio or HTTP) and Dashboard (HTTP)
 * in the same process, sharing a single EventBus and SessionManager.
 */

import { Command } from 'commander';
import path from 'node:path';

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

export function registerServer(program: Command): void {
  program
    .command('server')
    .description('启动统一服务（MCP Server + Dashboard 共享事件总线）')
    .option('-p, --port <port>', 'Dashboard HTTP 端口', '9095')
    .option('--mcp-mode <mode>', 'MCP transport: stdio | http (default: stdio)', 'stdio')
    .option('--mcp-port <port>', 'MCP HTTP 端口 (http mode only)', '3100')
    .option('--mcp-api-key <key>', 'MCP HTTP API key (optional)')
    .option('--no-dashboard', '仅启动 MCP Server，不启动 Dashboard')
    .option('--no-mcp', '仅启动 Dashboard，不启动 MCP Server')
    .option('--store <type>', '持久化类型: memory | file (default: memory)', 'memory')
    .option('--store-path <path>', 'File store 路径 (file mode only)')
    .option('--concurrency <n>', '全局最大并行容器数 (default: 10)', '10')
    .option('--notify-webhook <url>', 'Webhook 通知 URL (可多次使用)')
    .option('--notify-console', '启用控制台通知输出')
    .action(async (opts: {
      port: string;
      mcpMode: string;
      mcpPort: string;
      mcpApiKey?: string;
      dashboard: boolean;
      mcp: boolean;
      store: string;
      storePath?: string;
      concurrency: string;
      notifyWebhook?: string;
      notifyConsole?: boolean;
    }) => {
      const configPath = program.opts().config as string | undefined;

      const {
        createEventBus,
        loadConfig,
        createStore,
        TaskQueue,
        createNotifier,
        ResourceLimiter,
      } = await import('argusai-core');

      const eventBus = createEventBus();

      // Platform services
      const store = createStore({
        type: opts.store as 'memory' | 'file',
        filePath: opts.storePath,
      });
      const taskQueue = new TaskQueue({
        concurrency: parseInt(opts.concurrency),
      });
      const webhooks = opts.notifyWebhook
        ? [{ url: opts.notifyWebhook }]
        : [];
      const notifier = createNotifier({
        console: opts.notifyConsole,
        webhooks,
        minLevel: 'warning',
      });
      const resourceLimiter = new ResourceLimiter({
        globalMaxContainers: parseInt(opts.concurrency),
      });

      const platform = { store, taskQueue, notifier, resourceLimiter };

      let config = null;
      let configDir = process.cwd();
      let resolvedConfigPath: string | null = null;

      if (configPath) {
        try {
          resolvedConfigPath = path.resolve(configPath);
          config = await loadConfig(resolvedConfigPath);
          configDir = path.dirname(resolvedConfigPath);
        } catch (err) {
          console.warn(`[config] ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const port = parseInt(opts.port);
      const mcpPort = parseInt(opts.mcpPort);

      console.log(`\n${BOLD}ArgusAI Unified Server${RESET}\n`);

      // Start Dashboard (HTTP)
      if (opts.dashboard) {
        try {
          const { createDashboardApp } = await import('argusai-dashboard/server');
          const { app } = await createDashboardApp({
            eventBus,
            config,
            configDir,
            configPath: resolvedConfigPath,
            port,
            store: platform.store,
            taskQueue: platform.taskQueue,
            notifier: platform.notifier,
            resourceLimiter: platform.resourceLimiter,
          });
          await app.listen({ port, host: '0.0.0.0' });
          console.log(`  ${GREEN}Dashboard${RESET}  → http://localhost:${port}`);
        } catch (err) {
          console.error(`  Dashboard failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Start MCP Server
      if (opts.mcp) {
        try {
          const { createServer, SessionManager } = await import('argusai-mcp');

          const sessionManager = new SessionManager(eventBus);
          const { server } = createServer({ sessionManager, eventBus, platform });

          if (opts.mcpMode === 'http') {
            const { startHttpTransport } = await import('argusai-mcp');
            await startHttpTransport(server, {
              port: mcpPort,
              apiKey: opts.mcpApiKey,
              cors: true,
            });
            console.log(`  ${GREEN}MCP Server${RESET} → http://localhost:${mcpPort}/mcp`);
            if (opts.mcpApiKey) {
              console.log(`  ${GRAY}Auth: API key required${RESET}`);
            }
          } else {
            const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
            const transport = new StdioServerTransport();
            await server.connect(transport);
            console.log(`  ${GREEN}MCP Server${RESET} → stdio (ready for AI agents)`);
          }
        } catch (err) {
          console.error(`  MCP Server failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (opts.dashboard || opts.mcp) {
        console.log(`\n  ${GRAY}EventBus shared between all components${RESET}\n`);
      }

      const shutdown = async () => {
        console.log('\nShutting down...');
        await store.close().catch(() => {});
        await taskQueue.drain().catch(() => {});
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
