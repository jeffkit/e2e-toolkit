/**
 * @module commands/logs
 * `preflight logs` — View container logs.
 *
 * Streams or displays recent logs from the configured container
 * by delegating to the Docker engine's log functions.
 */

import { Command } from 'commander';

// ── ANSI colours ──────────────────────────────────────────────────────
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('查看容器日志')
    .option('-f, --follow', '持续跟踪日志输出')
    .option('-n, --tail <lines>', '显示最近 N 行日志', '100')
    .option('--container <name>', '指定容器名（默认使用配置中的容器）')
    .action(async (opts: { follow?: boolean; tail: string; container?: string }) => {
      // Lazy import to avoid needing built core for --help/--version
      const {
        loadConfig,
        getContainerLogs,
        streamContainerLogs,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;

      // Determine container name
      let containerName = opts.container;
      if (!containerName) {
        try {
          const config = await loadConfig(configPath);
          if (!config.service) {
            console.error(`${RED}No service configured in e2e.yaml${RESET}`);
            console.error(`${GRAY}提示: 使用 --container <name> 直接指定容器名${RESET}`);
            process.exit(1);
          }
          containerName = config.service.container.name;
        } catch (err) {
          console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
          console.error(`${GRAY}提示: 使用 --container <name> 直接指定容器名${RESET}`);
          process.exit(1);
        }
      }

      console.log(`${BOLD}Container logs: ${containerName}${RESET}\n`);

      if (opts.follow) {
        // Stream logs in real-time via AsyncGenerator
        try {
          process.on('SIGINT', () => process.exit(0));
          process.on('SIGTERM', () => process.exit(0));

          for await (const event of streamContainerLogs(containerName)) {
            if (event.type === 'container_log') {
              if (event.stream === 'stderr') {
                process.stderr.write(`${RED}${event.line}${RESET}\n`);
              } else {
                process.stdout.write(`${event.line}\n`);
              }
            }
          }
        } catch (err) {
          console.error(`${RED}Failed to stream logs: ${(err as Error).message}${RESET}`);
          process.exit(1);
        }
      } else {
        // Fetch recent logs
        try {
          const tail = parseInt(opts.tail, 10);
          const logs = await getContainerLogs(containerName, tail);
          if (logs.trim()) {
            console.log(logs);
          } else {
            console.log(`${GRAY}(no logs available)${RESET}`);
          }
        } catch (err) {
          console.error(`${RED}Failed to get logs: ${(err as Error).message}${RESET}`);
          process.exit(1);
        }
      }
    });
}
