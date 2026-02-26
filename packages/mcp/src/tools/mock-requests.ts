/**
 * @module tools/mock-requests
 * preflight_mock_requests — Get recorded requests from mock services.
 */

import { SessionManager, SessionError } from '../session.js';

export interface MockRequestsResult {
  mocks: Array<{
    name: string;
    port: number;
    totalRequests: number;
    requests: Array<{
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
      timestamp: string;
    }>;
  }>;
}

interface MockRequestData {
  count: number;
  requests: Array<{
    method: string;
    url: string;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    timestamp: string;
  }>;
}

/**
 * Handle the preflight_mock_requests MCP tool call.
 * Fetches recorded HTTP requests from mock service endpoints.
 * Optionally filters by mock name, time range, and clears request logs.
 *
 * @param params - Tool input with projectPath, optional mockName filter, since timestamp, and clear flag
 * @param sessionManager - Session store for tracking project state
 * @returns Recorded requests per mock service
 * @throws {SessionError} MOCKS_NOT_RUNNING if no mocks active, MOCK_NOT_FOUND if filter matches nothing
 */
export async function handleMockRequests(
  params: { projectPath: string; mockName?: string; since?: string; clear?: boolean },
  sessionManager: SessionManager,
): Promise<MockRequestsResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (session.mockServers.size === 0) {
    throw new SessionError('MOCKS_NOT_RUNNING', 'No mock services are running');
  }

  if (params.mockName && !session.mockServers.has(params.mockName)) {
    throw new SessionError('MOCK_NOT_FOUND', `Mock service "${params.mockName}" not found`);
  }

  const result: MockRequestsResult = { mocks: [] };
  const targets = params.mockName
    ? [[params.mockName, session.mockServers.get(params.mockName)!] as const]
    : Array.from(session.mockServers.entries());

  for (const [name, mockInfo] of targets) {
    try {
      const resp = await fetch(`http://localhost:${mockInfo.port}/_mock/requests`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        result.mocks.push({ name, port: mockInfo.port, totalRequests: 0, requests: [] });
        continue;
      }

      const data = await resp.json() as MockRequestData;
      let requests = data.requests;

      if (params.since) {
        const sinceTime = new Date(params.since).getTime();
        requests = requests.filter(r => new Date(r.timestamp).getTime() >= sinceTime);
      }

      result.mocks.push({
        name,
        port: mockInfo.port,
        totalRequests: requests.length,
        requests,
      });

      if (params.clear) {
        await fetch(`http://localhost:${mockInfo.port}/_mock/requests`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(2000),
        });
      }
    } catch {
      result.mocks.push({ name, port: mockInfo.port, totalRequests: 0, requests: [] });
    }
  }

  return result;
}
