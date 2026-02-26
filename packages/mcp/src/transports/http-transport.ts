/**
 * @module transports/http-transport
 * HTTP transport layer for the MCP server.
 *
 * Wraps MCP SDK's StreamableHTTPServerTransport with:
 * - Standalone HTTP server (for `--mode http`)
 * - Fastify route handler (for unified server integration)
 * - Optional API key authentication
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface HttpTransportOptions {
  port: number;
  host?: string;
  /** Path for the MCP endpoint (default: /mcp) */
  path?: string;
  /** API key for authentication (optional; if set, requests must include Authorization: Bearer <key>) */
  apiKey?: string;
  /** Enable CORS headers */
  cors?: boolean;
}

/**
 * Start a standalone HTTP server for the MCP transport.
 * Used when running `preflight-mcp --mode http --port 3100`.
 */
export async function startHttpTransport(
  mcpServer: McpServer,
  options: HttpTransportOptions,
): Promise<{ transport: StreamableHTTPServerTransport; close: () => Promise<void> }> {
  const mcpPath = options.path ?? '/mcp';
  const host = options.host ?? '0.0.0.0';

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await mcpServer.connect(transport);

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS preflight
    if (options.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Auth check
    if (options.apiKey) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${options.apiKey}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API key' }));
        return;
      }
    }

    const url = new URL(req.url ?? '/', `http://${host}:${options.port}`);

    if (url.pathname === mcpPath) {
      // Parse JSON body for POST
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        await transport.handleRequest(req, res, body);
      } else {
        await transport.handleRequest(req, res);
      }
    } else if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'preflight-mcp', mode: 'http', sessionId: transport.sessionId }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', availableEndpoints: [mcpPath, '/health'] }));
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.listen(options.port, host, () => {
      resolve({
        transport,
        close: async () => {
          await transport.close();
          return new Promise<void>((res, rej) => {
            httpServer.close((err) => err ? rej(err) : res());
          });
        },
      });
    });
    httpServer.on('error', reject);
  });
}

/**
 * Create a Fastify-compatible route handler for mounting MCP on an existing Fastify app.
 * Used by the unified `preflight server` to share the Dashboard's HTTP port.
 */
export function createFastifyMcpHandler(
  mcpServer: McpServer,
  options?: { apiKey?: string },
): { transport: StreamableHTTPServerTransport; handler: (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void> } {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Connect will be called by the caller after getting the transport
  const handler = async (req: IncomingMessage, res: ServerResponse, body?: unknown) => {
    if (options?.apiKey) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${options.apiKey}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }
    await transport.handleRequest(req, res, body);
  };

  return { transport, handler };
}
