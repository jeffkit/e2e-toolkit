/**
 * @module commands/clean
 * `preflight clean` — Clean up all test resources.
 *
 * Stops containers, removes networks, and optionally removes volumes/images.
 */

import { Command } from 'commander';

// ── ANSI colours ──────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(icon: string, msg: string): void {
  console.log(`  ${icon} ${msg}`);
}

export function registerClean(program: Command): void {
  program
    .command('clean')
    .description('清理测试资源')
    .option('--all', '同时删除镜像和 volumes')
    .action(async (_opts: { all?: boolean }) => {
      // Lazy import to avoid needing built core for --help/--version
      const {
        loadConfig,
        stopContainer,
        removeNetwork,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      console.log(`\n${BOLD}Cleaning up resources...${RESET}\n`);

      if (!config.service) {
        console.error(`${RED}No service configured in e2e.yaml${RESET}`);
        process.exit(1);
      }

      // 1. Stop container
      try {
        await stopContainer(config.service.container.name);
        log(`${GREEN}✓${RESET}`, `Container "${config.service.container.name}" stopped and removed`);
      } catch {
        log(`${GRAY}-${RESET}`, `Container "${config.service.container.name}" not running`);
      }

      // 2. Remove network
      const networkName = config.network?.name ?? 'e2e-network';
      try {
        await removeNetwork(networkName);
        log(`${GREEN}✓${RESET}`, `Network "${networkName}" removed`);
      } catch {
        log(`${GRAY}-${RESET}`, `Network "${networkName}" not found`);
      }

      console.log(`\n${GREEN}${BOLD}Clean complete.${RESET}\n`);
    });
}
