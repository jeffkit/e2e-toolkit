/**
 * @module server
 * MCP server setup — registers all 9 preflight tools with Zod input schemas.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionManager, SessionError } from './session.js';
import { ResultFormatter } from './formatters/result-formatter.js';
import { handleInit } from './tools/init.js';
import { handleBuild } from './tools/build.js';
import { handleSetup } from './tools/setup.js';
import { handleRun, handleRunSuite } from './tools/run.js';
import { handleStatus } from './tools/status.js';
import { handleLogs } from './tools/logs.js';
import { handleClean } from './tools/clean.js';
import { handleMockRequests } from './tools/mock-requests.js';

interface McpToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  timestamp: number;
}

/** Wrap tool result data in a success JSON envelope. */
function successResponse<T>(data: T): { content: Array<{ type: 'text'; text: string }> } {
  const envelope: McpToolResponse<T> = {
    success: true,
    data,
    timestamp: Date.now(),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }] };
}

/** Wrap an error in a structured JSON envelope with code and message. */
function errorResponse(code: string, message: string, details?: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const envelope: McpToolResponse = {
    success: false,
    error: { code, message, details },
    timestamp: Date.now(),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }] };
}

/** Convert an unknown thrown value into an MCP error response. */
function handleError(err: unknown): { content: Array<{ type: 'text'; text: string }> } {
  if (err instanceof SessionError) {
    return errorResponse(err.code, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse('INTERNAL_ERROR', message);
}

/**
 * Create and configure the MCP server with all 9 preflight tools registered.
 *
 * @returns The McpServer instance, a fresh SessionManager, and a ResultFormatter
 */
export function createServer(): { server: McpServer; sessionManager: SessionManager; formatter: ResultFormatter } {
  const server = new McpServer({
    name: '@preflight/mcp',
    version: '0.1.0',
  });

  const sessionManager = new SessionManager();
  const formatter = new ResultFormatter();

  // Tool 1: preflight_init
  server.tool(
    'preflight_init',
    {
      projectPath: z.string().describe('Absolute path to project directory containing e2e.yaml'),
      configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
    },
    async (params) => {
      try {
        const result = await handleInit(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 2: preflight_build
  server.tool(
    'preflight_build',
    {
      projectPath: z.string().describe('Project path (must have active session)'),
      noCache: z.boolean().optional().describe('Disable Docker layer cache'),
      service: z.string().optional().describe('Build specific service (multi-service mode)'),
    },
    async (params) => {
      try {
        const result = await handleBuild(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 3: preflight_setup
  server.tool(
    'preflight_setup',
    {
      projectPath: z.string().describe('Project path (must have built images)'),
      timeout: z.string().optional().describe('Health check timeout override, e.g. "120s"'),
    },
    async (params) => {
      try {
        const result = await handleSetup(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 4: preflight_run
  server.tool(
    'preflight_run',
    {
      projectPath: z.string().describe('Project path (must have running environment)'),
      filter: z.string().optional().describe('Suite ID filter (comma-separated for multiple)'),
      parallel: z.boolean().optional().describe('Override parallel execution setting'),
    },
    async (params) => {
      try {
        const result = await handleRun(params, sessionManager, formatter);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 5: preflight_run_suite
  server.tool(
    'preflight_run_suite',
    {
      projectPath: z.string().describe('Project path'),
      suiteId: z.string().describe('Suite identifier to run'),
    },
    async (params) => {
      try {
        const result = await handleRunSuite(params, sessionManager, formatter);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 6: preflight_status
  server.tool(
    'preflight_status',
    {
      projectPath: z.string().describe('Project path'),
    },
    async (params) => {
      try {
        const result = await handleStatus(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 7: preflight_logs
  server.tool(
    'preflight_logs',
    {
      projectPath: z.string().describe('Project path'),
      container: z.string().describe('Container name'),
      lines: z.number().optional().describe('Number of tail lines (default: 100)'),
      since: z.string().optional().describe('Show logs since timestamp, e.g. "5m", "2h"'),
    },
    async (params) => {
      try {
        const result = await handleLogs(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 8: preflight_clean
  server.tool(
    'preflight_clean',
    {
      projectPath: z.string().describe('Project path'),
      force: z.boolean().optional().describe('Force remove stuck containers'),
    },
    async (params) => {
      try {
        const result = await handleClean(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 9: preflight_mock_requests
  server.tool(
    'preflight_mock_requests',
    {
      projectPath: z.string().describe('Project path'),
      mockName: z.string().optional().describe('Specific mock name (default: all mocks)'),
      since: z.string().optional().describe('Filter requests after timestamp'),
      clear: z.boolean().optional().describe('Clear request log after reading'),
    },
    async (params) => {
      try {
        const result = await handleMockRequests(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  return { server, sessionManager, formatter };
}
