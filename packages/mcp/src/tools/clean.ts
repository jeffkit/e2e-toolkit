/**
 * @module tools/clean
 * preflight_clean — Stop and remove all containers, networks, and mocks.
 *
 * Uses MultiServiceOrchestrator for config normalization, while keeping
 * Docker calls at this level for testability.
 */

import {
  stopContainer,
  removeNetwork,
  MultiServiceOrchestrator,
} from '@preflight/core';
import { SessionManager, SessionError } from '../session.js';

export interface CleanResult {
  containers: Array<{
    name: string;
    action: 'removed' | 'not_found' | 'force_removed' | 'failed';
    error?: string;
  }>;
  mocks: Array<{
    name: string;
    action: 'stopped' | 'not_running' | 'failed';
    error?: string;
  }>;
  network: {
    name: string;
    action: 'removed' | 'not_found' | 'failed';
    error?: string;
  };
  sessionRemoved: boolean;
}

/**
 * Handle the preflight_clean MCP tool call.
 * Stops containers, shuts down mock servers, removes the Docker network,
 * and destroys the session. Uses best-effort cleanup for all resources.
 *
 * @param params - Tool input with projectPath and optional force flag
 * @param sessionManager - Session store for tracking project state
 * @returns Cleanup results for containers, mocks, network, and session
 */
export async function handleClean(
  params: { projectPath: string; force?: boolean },
  sessionManager: SessionManager,
): Promise<CleanResult> {
  let session;
  let networkName = 'e2e-network';

  try {
    session = sessionManager.getOrThrow(params.projectPath);
    networkName = session.networkName;
  } catch (err) {
    if (err instanceof SessionError && err.code === 'SESSION_NOT_FOUND') {
      return {
        containers: [],
        mocks: [],
        network: { name: networkName, action: 'not_found' },
        sessionRemoved: false,
      };
    }
    throw err;
  }

  // Use orchestrator to normalize services from config
  const orchestrator = new MultiServiceOrchestrator();
  const services = orchestrator.normalizeServices(session.config);

  // Collect all container names to clean — both from config and session tracking
  const containerNames = new Set<string>();
  for (const svc of services) {
    containerNames.add(svc.container.name);
  }
  for (const [name] of session.containerIds) {
    containerNames.add(name);
  }

  // Stop containers (best-effort)
  const containerResults: CleanResult['containers'] = [];
  for (const name of containerNames) {
    try {
      await stopContainer(name);
      containerResults.push({ name, action: 'removed' });
    } catch (err) {
      containerResults.push({
        name,
        action: 'failed',
        error: (err as Error).message,
      });
    }
  }

  // Stop mock servers
  const mockResults: CleanResult['mocks'] = [];
  for (const [name, mockInfo] of session.mockServers) {
    try {
      await mockInfo.server.close();
      mockResults.push({ name, action: 'stopped' });
    } catch (err) {
      mockResults.push({
        name,
        action: 'failed',
        error: (err as Error).message,
      });
    }
  }

  // Remove network
  let networkResult: CleanResult['network'];
  try {
    await removeNetwork(networkName);
    networkResult = { name: networkName, action: 'removed' };
  } catch {
    networkResult = { name: networkName, action: 'failed' };
  }

  // Remove session
  sessionManager.remove(params.projectPath);

  return {
    containers: containerResults,
    mocks: mockResults,
    network: networkResult,
    sessionRemoved: true,
  };
}
