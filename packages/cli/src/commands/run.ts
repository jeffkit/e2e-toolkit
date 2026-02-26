/**
 * @module commands/run
 * `preflight run` — Execute test suites.
 *
 * Steps:
 * 1. Load e2e.yaml
 * 2. Select suites (--suite filter or all)
 * 3. Create runner from registry
 * 4. Execute tests
 * 5. Output report (console/json)
 */

import { Command } from 'commander';
import path from 'node:path';

// ── ANSI colours ──────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerRun(program: Command): void {
  program
    .command('run')
    .description('运行测试套件')
    .option('-s, --suite <id>', '指定运行的测试套件 ID')
    .option('--reporter <type>', '报告格式 (console|json)', 'console')
    .option('--timeout <ms>', '超时时间（毫秒）', '60000')
    .action(async (opts: { suite?: string; reporter: string; timeout: string }) => {
      // Lazy import to avoid needing built core for --help/--version
      const {
        loadConfig,
        createDefaultRegistry,
        ConsoleReporter,
        JSONReporter,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;

      // 1. Load config
      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      if (!config.tests?.suites || config.tests.suites.length === 0) {
        console.error(`${RED}No test suites defined in configuration.${RESET}`);
        process.exit(1);
      }

      // 2. Select suites
      let suites: Array<{ name: string; id: string; file?: string; runner?: string; command?: string; config?: string }>;
      if (opts.suite) {
        suites = config.tests.suites.filter((s) => s.id === opts.suite);
        if (suites.length === 0) {
          console.error(`${RED}Suite "${opts.suite}" not found.${RESET}`);
          console.error(`Available suites: ${config.tests.suites.map((s) => s.id).join(', ')}`);
          process.exit(1);
        }
      } else {
        suites = config.tests.suites;
      }

      // 3. Create runner registry
      const registry = await createDefaultRegistry();

      // 4. Create reporter
      const reporter = opts.reporter === 'json'
        ? new JSONReporter()
        : new ConsoleReporter();

      console.log(`\n${BOLD}Running ${suites.length} suite(s)...${RESET}\n`);

      const timeout = parseInt(opts.timeout, 10);
      const configDir = configPath ? path.dirname(path.resolve(configPath)) : process.cwd();

      // 5. Execute tests
      for (const suite of suites) {
        const runnerId = suite.runner ?? 'yaml';
        const runner = registry.get(runnerId);

        if (!runner) {
          console.error(`${RED}Runner "${runnerId}" not found for suite "${suite.name}".${RESET}`);
          continue;
        }

        const target = suite.command ?? suite.file ?? '';
        const env: Record<string, string> = {
          BASE_URL: config.service.vars?.base_url ?? `http://localhost:${config.service.container.ports[0]?.split(':')[0] ?? '8080'}`,
          ...(config.service.container.environment ?? {}),
        };

        const events = runner.run({
          cwd: configDir,
          target,
          env,
          timeout,
        });

        for await (const event of events) {
          reporter.onEvent(event);
        }
      }

      // 6. Generate report
      const report = reporter.generate();

      if (opts.reporter === 'json') {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(
          `\n${BOLD}Summary:${RESET} ` +
          `${GREEN}${report.totals.passed} passed${RESET}, ` +
          `${RED}${report.totals.failed} failed${RESET}, ` +
          `${report.totals.skipped} skipped\n`,
        );
      }

      // Exit with failure code if any tests failed
      if (report.totals.failed > 0) {
        process.exit(1);
      }
    });
}
