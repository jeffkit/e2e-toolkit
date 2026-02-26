/**
 * @module tools/mock-validate
 * argus_mock_validate — Validate mock endpoint coverage against an OpenAPI spec.
 */

import path from 'node:path';
import { loadConfig, loadAndDereferenceSpec } from 'argusai-core';
import type { MockServiceConfig, E2EConfig, MockValidateResult } from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';

export interface MockValidateParams {
  projectPath: string;
  mockName?: string;
  specPath?: string;
}

/**
 * Handle the argus_mock_validate MCP tool call.
 *
 * @param params - Tool input
 * @param sessionManager - Session manager for config access
 * @returns Coverage analysis result
 */
export async function handleMockValidate(
  params: MockValidateParams,
  sessionManager: SessionManager,
): Promise<MockValidateResult> {
  const { projectPath, mockName, specPath } = params;

  const session = sessionManager.getOrThrow(projectPath);

  const config = session.config;
  const mocks = config.mocks;

  if (!mocks) {
    throw new SessionError('MOCK_NOT_FOUND', 'No mocks configured in e2e.yaml');
  }

  if (mockName) {
    const mockConfig = mocks[mockName] as MockServiceConfig | undefined;
    if (!mockConfig) {
      throw new SessionError('MOCK_NOT_FOUND', `Mock "${mockName}" not found in e2e.yaml`);
    }
    return validateSingleMock(mockConfig, mockName, projectPath, specPath);
  }

  // Validate all mocks with openapi field
  for (const [name, mc] of Object.entries(mocks)) {
    const mockConfig = mc as MockServiceConfig;
    if (mockConfig.openapi || specPath) {
      return validateSingleMock(mockConfig, name, projectPath, specPath);
    }
  }

  throw new SessionError('NO_OPENAPI_SPEC', 'No mock with an openapi field found and no specPath provided');
}

async function validateSingleMock(
  mockConfig: MockServiceConfig,
  mockName: string,
  projectPath: string,
  specPathOverride?: string,
): Promise<MockValidateResult> {
  const resolvedSpecPath = specPathOverride ?? mockConfig.openapi;
  if (!resolvedSpecPath) {
    throw new SessionError('NO_OPENAPI_SPEC', `Mock "${mockName}" has no openapi field and no specPath was provided`);
  }

  const absoluteSpecPath = path.isAbsolute(resolvedSpecPath)
    ? resolvedSpecPath
    : path.resolve(projectPath, resolvedSpecPath);

  const spec = await loadAndDereferenceSpec(absoluteSpecPath);

  const specEndpoints = new Set<string>();
  for (const route of spec.routes) {
    specEndpoints.add(`${route.method}:${route.openApiPath}`);
  }

  const mockEndpoints = new Set<string>();

  // Auto-generated routes cover all spec endpoints when openapi is set
  if (mockConfig.openapi) {
    for (const route of spec.routes) {
      mockEndpoints.add(`${route.method}:${route.openApiPath}`);
    }
  }

  // Override and manual routes
  const manualRoutes = [
    ...(mockConfig.overrides ?? []),
    ...(mockConfig.routes ?? []),
  ];
  for (const route of manualRoutes) {
    mockEndpoints.add(`${route.method.toUpperCase()}:${route.path}`);
  }

  const covered: Array<{ method: string; path: string }> = [];
  const missing: Array<{ method: string; path: string }> = [];

  for (const endpoint of specEndpoints) {
    const [method, ep] = endpoint.split(':') as [string, string];
    if (mockEndpoints.has(endpoint)) {
      covered.push({ method, path: ep });
    } else {
      missing.push({ method, path: ep });
    }
  }

  const extra: Array<{ method: string; path: string }> = [];
  for (const endpoint of mockEndpoints) {
    if (!specEndpoints.has(endpoint)) {
      const [method, ep] = endpoint.split(':') as [string, string];
      extra.push({ method, path: ep });
    }
  }

  const totalSpecEndpoints = specEndpoints.size;
  const coveragePercent = totalSpecEndpoints > 0
    ? Math.round((covered.length / totalSpecEndpoints) * 10000) / 100
    : 100;

  return {
    totalSpecEndpoints,
    coveredCount: covered.length,
    missingCount: missing.length,
    coveragePercent,
    covered,
    missing,
    extra,
  };
}
