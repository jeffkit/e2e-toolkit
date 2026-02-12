/**
 * @module commands/setup
 * `e2e-toolkit setup` — One-command environment setup.
 *
 * Steps:
 * 1. Check dependencies (Docker, Node.js)
 * 2. Load e2e.yaml
 * 3. Build images (unless --skip-build)
 * 4. Start mock services
 * 5. Start containers
 * 6. Wait for healthy
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';

// ── ANSI colours ──────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(icon: string, msg: string): void {
  console.log(`  ${icon} ${msg}`);
}

async function commandExists(cmd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn('which', [cmd], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('一键搭建测试环境')
    .option('--skip-build', '跳过镜像构建')
    .option('--no-dashboard', '不启动 Dashboard')
    .action(async (opts: { skipBuild?: boolean; dashboard?: boolean }) => {
      // Lazy import to avoid needing built core for --help/--version
      const {
        loadConfig,
        buildImage,
        startContainer,
        ensureNetwork,
        waitForHealthy,
        createMockServer,
        buildBuildArgs,
        buildRunArgs,
      } = await import('@e2e-toolkit/core');

      const configPath = program.opts().config as string | undefined;

      console.log(`\n${BOLD}Setting up e2e environment...${RESET}\n`);

      // 1. Check dependencies
      log(`${GRAY}[1/6]${RESET}`, 'Checking dependencies...');
      const hasDocker = await commandExists('docker');
      const hasNode = await commandExists('node');

      if (!hasDocker) {
        console.error(`  ${RED}✗${RESET} Docker not found. Please install Docker first.`);
        process.exit(1);
      }
      log(`${GREEN}✓${RESET}`, 'Docker available');

      if (!hasNode) {
        console.error(`  ${RED}✗${RESET} Node.js not found.`);
        process.exit(1);
      }
      log(`${GREEN}✓${RESET}`, 'Node.js available');

      // 2. Load config
      log(`${GRAY}[2/6]${RESET}`, 'Loading configuration...');
      let config;
      try {
        config = await loadConfig(configPath);
        log(`${GREEN}✓${RESET}`, `Project: ${config.project.name}`);
      } catch (err) {
        console.error(`  ${RED}✗${RESET} ${(err as Error).message}`);
        process.exit(1);
      }

      // 3. Build image
      if (!opts.skipBuild) {
        log(`${GRAY}[3/6]${RESET}`, 'Building image...');
        try {
          const args = buildBuildArgs({
            tag: config.service.build.image,
            dockerfile: config.service.build.dockerfile,
            context: config.service.build.context,
            buildArgs: config.service.build.args,
          });
          await buildImage(args);
          log(`${GREEN}✓${RESET}`, `Image built: ${config.service.build.image}`);
        } catch (err) {
          console.error(`  ${RED}✗${RESET} Build failed: ${(err as Error).message}`);
          process.exit(1);
        }
      } else {
        log(`${YELLOW}○${RESET}`, 'Skipping build (--skip-build)');
      }

      // 4. Start mock services
      log(`${GRAY}[4/6]${RESET}`, 'Starting mock services...');
      if (config.mocks) {
        for (const [name, mockConfig] of Object.entries(config.mocks)) {
          if (mockConfig.routes && mockConfig.routes.length > 0) {
            try {
              const mockApp = createMockServer(mockConfig);
              await mockApp.listen({ port: mockConfig.port, host: '0.0.0.0' });
              log(`${GREEN}✓${RESET}`, `Mock "${name}" on port ${mockConfig.port}`);
            } catch (err) {
              console.error(`  ${RED}✗${RESET} Mock "${name}" failed: ${(err as Error).message}`);
            }
          }
        }
      } else {
        log(`${GRAY}-${RESET}`, 'No mocks configured');
      }

      // 5. Start container
      log(`${GRAY}[5/6]${RESET}`, 'Starting container...');
      try {
        const networkName = config.network?.name ?? 'e2e-network';
        await ensureNetwork(networkName);

        const runArgs = buildRunArgs({
          name: config.service.container.name,
          image: config.service.build.image,
          ports: config.service.container.ports,
          environment: config.service.container.environment,
          volumes: config.service.container.volumes,
          network: networkName,
        });
        await startContainer(runArgs);
        log(`${GREEN}✓${RESET}`, `Container "${config.service.container.name}" started`);
      } catch (err) {
        console.error(`  ${RED}✗${RESET} Container start failed: ${(err as Error).message}`);
        process.exit(1);
      }

      // 6. Wait for healthy
      log(`${GRAY}[6/6]${RESET}`, 'Waiting for healthy...');
      if (config.service.container.healthcheck) {
        try {
          await waitForHealthy(config.service.container.name, {
            timeout: 120_000,
            interval: 2_000,
          });
          log(`${GREEN}✓${RESET}`, 'Service is healthy');
        } catch (err) {
          console.error(`  ${RED}✗${RESET} Health check failed: ${(err as Error).message}`);
          process.exit(1);
        }
      } else {
        log(`${GRAY}-${RESET}`, 'No healthcheck configured, skipping');
      }

      console.log(`\n${GREEN}${BOLD}Environment ready!${RESET}\n`);
    });
}
