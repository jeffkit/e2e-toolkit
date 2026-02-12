#!/usr/bin/env node
/**
 * @module @e2e-toolkit/cli
 * CLI entry point for e2e-toolkit.
 *
 * Registers all sub-commands and parses process.argv via Commander.js.
 */

import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerSetup } from './commands/setup.js';
import { registerRun } from './commands/run.js';
import { registerBuild } from './commands/build.js';
import { registerStatus } from './commands/status.js';
import { registerClean } from './commands/clean.js';
import { registerDashboard } from './commands/dashboard.js';
import { registerLogs } from './commands/logs.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('e2e-toolkit')
    .description('配置驱动的 Docker 容器端到端测试平台')
    .version('0.1.0')
    .option('-c, --config <path>', 'e2e.yaml 配置文件路径')
    .option('--verbose', '启用详细输出');

  // Register sub-commands
  registerInit(program);
  registerSetup(program);
  registerRun(program);
  registerBuild(program);
  registerStatus(program);
  registerClean(program);
  registerDashboard(program);
  registerLogs(program);

  return program;
}

// Run when executed directly
const program = createProgram();
program.parse();
