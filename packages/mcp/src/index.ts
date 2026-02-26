#!/usr/bin/env node
/**
 * @module @preflight/mcp
 * MCP Server entry point — connects the server to a StdioServerTransport
 * and handles graceful shutdown on SIGINT/SIGTERM.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

export { createServer } from './server.js';
export { SessionManager, SessionError } from './session.js';
export type { ProjectSession, SessionState } from './session.js';
export { ResultFormatter, generateSummary } from './formatters/result-formatter.js';
export type { InitResult } from './tools/init.js';
export type { BuildResult } from './tools/build.js';
export type { SetupResult } from './tools/setup.js';
export type { RunResult } from './tools/run.js';
export type { StatusResult } from './tools/status.js';
export type { LogsResult } from './tools/logs.js';
export type { CleanResult } from './tools/clean.js';
export type { MockRequestsResult } from './tools/mock-requests.js';

export const VERSION = '0.1.0';

async function main() {
  const { server } = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // Best-effort shutdown
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

// Only auto-start if this is the main entry point (not imported as a library)
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule || process.argv[1]?.endsWith('preflight-mcp')) {
  main().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
