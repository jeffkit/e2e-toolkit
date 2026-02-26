/**
 * @module commands/init
 * `argusai init` — Initialize a new ArgusAI project.
 *
 * Creates:
 * - e2e.yaml template configuration
 * - tests/ directory
 * - tests/health.yaml example test suite
 * - .env.example
 */

import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── ANSI colours ──────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ── Template content ─────────────────────────────────────────────────

const E2E_YAML_TEMPLATE = `version: "1"
project:
  name: my-project
  description: "E2E test suite for my-project"

service:
  build:
    dockerfile: Dockerfile
    context: "."
    image: "my-project:{{config.version}}"
  container:
    name: my-project-e2e
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: test
    healthcheck:
      path: /health
      interval: "5s"
      timeout: "3s"
      retries: 10
      startPeriod: "30s"
  vars:
    version: "1.0.0"
    base_url: "http://localhost:8080"

# mocks:
#   gateway:
#     port: 8081
#     routes:
#       - method: GET
#         path: /api/status
#         response:
#           status: 200
#           body:
#             status: ok

tests:
  suites:
    - name: "Health Check"
      id: health
      file: tests/health.yaml
      runner: yaml

# dashboard:
#   port: 9095
#   uiPort: 9091

network:
  name: e2e-network
`;

const HEALTH_YAML_TEMPLATE = `name: "Health Check Suite"
description: "Verify the service is alive and responding"

cases:
  - name: "GET /health returns 200"
    request:
      method: GET
      path: /health
      timeout: "5s"
    expect:
      status: 200
      body:
        status: ok
`;

const ENV_EXAMPLE = `# argusai environment variables
# Copy this file to .env and adjust values as needed.

# BASE_URL=http://localhost:8080
# API_KEY=your-api-key-here
# NODE_ENV=test
`;

// ── Command ──────────────────────────────────────────────────────────

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('初始化 ArgusAI 项目')
    .option('-d, --dir <directory>', '目标目录', '.')
    .action(async (opts: { dir: string }) => {
      const baseDir = path.resolve(opts.dir);

      console.log(`\n${BOLD}Initializing ArgusAI project...${RESET}\n`);

      // 1. Create e2e.yaml
      const yamlPath = path.join(baseDir, 'e2e.yaml');
      if (await fileExists(yamlPath)) {
        console.log(`  ${GRAY}skip${RESET}  e2e.yaml (already exists)`);
      } else {
        await fs.writeFile(yamlPath, E2E_YAML_TEMPLATE, 'utf-8');
        console.log(`  ${GREEN}create${RESET}  e2e.yaml`);
      }

      // 2. Create tests/ directory
      const testsDir = path.join(baseDir, 'tests');
      await fs.mkdir(testsDir, { recursive: true });
      console.log(`  ${GREEN}create${RESET}  tests/`);

      // 3. Create tests/health.yaml
      const healthPath = path.join(testsDir, 'health.yaml');
      if (await fileExists(healthPath)) {
        console.log(`  ${GRAY}skip${RESET}  tests/health.yaml (already exists)`);
      } else {
        await fs.writeFile(healthPath, HEALTH_YAML_TEMPLATE, 'utf-8');
        console.log(`  ${GREEN}create${RESET}  tests/health.yaml`);
      }

      // 4. Create .env.example
      const envPath = path.join(baseDir, '.env.example');
      if (await fileExists(envPath)) {
        console.log(`  ${GRAY}skip${RESET}  .env.example (already exists)`);
      } else {
        await fs.writeFile(envPath, ENV_EXAMPLE, 'utf-8');
        console.log(`  ${GREEN}create${RESET}  .env.example`);
      }

      console.log(`\n${GREEN}Done!${RESET} Edit ${BOLD}e2e.yaml${RESET} to configure your project.\n`);
    });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
