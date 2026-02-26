/**
 * @module commands/status
 * `preflight status` — Display environment status.
 *
 * Shows:
 * - Container status
 * - Port usage
 * - Network info
 * - Docker image list
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

function statusColor(status: string): string {
  if (status === 'running') return `${GREEN}${status}${RESET}`;
  if (status === 'exited' || status === 'dead') return `${RED}${status}${RESET}`;
  return `${YELLOW}${status}${RESET}`;
}

async function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('查看环境状态')
    .action(async () => {
      // Lazy import to avoid needing built core for --help/--version
      const {
        loadConfig,
        getContainerStatus,
        isPortInUse,
      } = await import('@preflight/core');

      const configPath = program.opts().config as string | undefined;

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      console.log(`\n${BOLD}Environment Status — ${config.project.name}${RESET}\n`);

      // ── Container status ────────────────────────────────────────────
      console.log(`${BOLD}Container:${RESET}`);
      try {
        const containerStatus = await getContainerStatus(config.service.container.name);
        console.log(`  ${config.service.container.name}: ${statusColor(containerStatus)}`);
      } catch {
        console.log(`  ${config.service.container.name}: ${RED}not found${RESET}`);
      }

      // ── Ports ───────────────────────────────────────────────────────
      console.log(`\n${BOLD}Ports:${RESET}`);
      for (const portMapping of config.service.container.ports) {
        const hostPort = parseInt(portMapping.split(':')[0] ?? '0', 10);
        if (hostPort > 0) {
          const inUse = await isPortInUse(hostPort);
          const indicator = inUse ? `${GREEN}in use${RESET}` : `${GRAY}free${RESET}`;
          console.log(`  :${hostPort} → ${indicator}`);
        }
      }

      if (config.mocks) {
        for (const [name, mock] of Object.entries(config.mocks)) {
          const inUse = await isPortInUse(mock.port);
          const indicator = inUse ? `${GREEN}in use${RESET}` : `${GRAY}free${RESET}`;
          console.log(`  :${mock.port} (mock:${name}) → ${indicator}`);
        }
      }

      // ── Network ─────────────────────────────────────────────────────
      const networkName = config.network?.name ?? 'e2e-network';
      console.log(`\n${BOLD}Network:${RESET}`);
      try {
        await runCommand('docker', ['network', 'inspect', networkName, '--format', '{{.Name}}']);
        console.log(`  ${networkName}: ${GREEN}exists${RESET}`);
      } catch {
        console.log(`  ${networkName}: ${GRAY}not created${RESET}`);
      }

      // ── Image ───────────────────────────────────────────────────────
      console.log(`\n${BOLD}Image:${RESET}`);
      try {
        const imageInfo = await runCommand('docker', ['images', config.service.build.image, '--format', '{{.Repository}}:{{.Tag}} ({{.Size}})']);
        if (imageInfo) {
          console.log(`  ${imageInfo}`);
        } else {
          console.log(`  ${config.service.build.image}: ${GRAY}not built${RESET}`);
        }
      } catch {
        console.log(`  ${config.service.build.image}: ${GRAY}not built${RESET}`);
      }

      console.log('');
    });
}
