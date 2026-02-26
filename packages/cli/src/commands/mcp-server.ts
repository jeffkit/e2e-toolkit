/**
 * @module commands/mcp-server
 * `preflight mcp-server` — Start the MCP server with stdio transport.
 *
 * Launches the @preflight/mcp server process so AI agents (Cursor, Claude Code)
 * can connect via the Model Context Protocol.
 */

import { Command } from 'commander';

export function registerMcpServer(program: Command): void {
  program
    .command('mcp-server')
    .description('Start the MCP server for AI agent integration')
    .action(async () => {
      const { createServer } = await import('@preflight/mcp');
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

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
    });
}
