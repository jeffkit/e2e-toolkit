/**
 * @module commands/build
 * `preflight build` — Build Docker images.
 *
 * Reads the service.build configuration from e2e.yaml and executes
 * `docker build` with the configured Dockerfile, context, and args.
 */

import { Command } from 'commander';

// ── ANSI colours ──────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('构建 Docker 镜像')
    .option('--no-cache', '禁用 Docker 构建缓存')
    .action(async (opts: { cache?: boolean }) => {
      // Lazy import to avoid needing built core for --help/--version
      const {
        loadConfig,
        buildImageStreaming,
        buildBuildArgs,
      } = await import('@preflight/core');

      const configPath = program.opts().config as string | undefined;

      // Load config
      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      const { build } = config.service;
      console.log(`\n${BOLD}Building image: ${build.image}${RESET}\n`);
      console.log(`  Dockerfile: ${GRAY}${build.dockerfile}${RESET}`);
      console.log(`  Context:    ${GRAY}${build.context}${RESET}`);
      if (build.args) {
        console.log(`  Args:       ${GRAY}${JSON.stringify(build.args)}${RESET}`);
      }
      console.log('');

      try {
        const args = buildBuildArgs({
          tag: build.image,
          dockerfile: build.dockerfile,
          context: build.context,
          buildArgs: build.args,
          noCache: opts.cache === false,
        });

        for await (const event of buildImageStreaming(args)) {
          switch (event.type) {
            case 'build_start':
              console.log(`${GRAY}[build]${RESET} Starting build...`);
              break;
            case 'build_log':
              process.stdout.write(`${GRAY}${event.line}${RESET}`);
              break;
            case 'build_end':
              if (event.success) {
                console.log(`\n${GREEN}${BOLD}Build succeeded${RESET} ${GRAY}(${event.duration}ms)${RESET}\n`);
              } else {
                console.error(`\n${RED}${BOLD}Build failed${RESET}: ${event.error ?? 'unknown error'}\n`);
                process.exit(1);
              }
              break;
          }
        }
      } catch (err) {
        console.error(`${RED}Build failed: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }
    });
}
