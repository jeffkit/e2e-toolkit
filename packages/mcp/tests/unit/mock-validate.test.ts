/**
 * Unit tests for argus_mock_validate MCP tool.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { handleMockValidate } from '../../src/tools/mock-validate.js';
import { SessionManager } from '../../src/session.js';
import type { E2EConfig } from 'argusai-core';

const FIXTURES = path.resolve(import.meta.dirname, '../../../core/tests/unit/openapi/fixtures');
const PETSTORE = path.join(FIXTURES, 'petstore.yaml');
const PROJECT_PATH = '/test/project';

function makeConfig(mocks: Record<string, unknown>): E2EConfig {
  return {
    version: '1',
    project: { name: 'test' },
    mocks: mocks as E2EConfig['mocks'],
  };
}

describe('argus_mock_validate', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  it('should report full coverage when openapi is set', async () => {
    const config = makeConfig({
      'pet-api': {
        port: 9090,
        openapi: PETSTORE,
      },
    });
    sessionManager.create(PROJECT_PATH, config, '/test/e2e.yaml');

    const result = await handleMockValidate(
      { projectPath: PROJECT_PATH, mockName: 'pet-api' },
      sessionManager,
    );

    expect(result.totalSpecEndpoints).toBe(4);
    expect(result.coveredCount).toBe(4);
    expect(result.missingCount).toBe(0);
    expect(result.coveragePercent).toBe(100);
    expect(result.covered).toHaveLength(4);
    expect(result.missing).toHaveLength(0);
  });

  it('should detect extra endpoints from overrides', async () => {
    const config = makeConfig({
      'pet-api': {
        port: 9090,
        openapi: PETSTORE,
        overrides: [
          { method: 'GET', path: '/custom/extra', response: { status: 200, body: {} } },
        ],
      },
    });
    sessionManager.create(PROJECT_PATH, config, '/test/e2e.yaml');

    const result = await handleMockValidate(
      { projectPath: PROJECT_PATH, mockName: 'pet-api' },
      sessionManager,
    );

    expect(result.extra).toHaveLength(1);
    expect(result.extra[0]!.path).toBe('/custom/extra');
  });

  it('should throw when mock not found', async () => {
    const config = makeConfig({
      'other-mock': { port: 9090 },
    });
    sessionManager.create(PROJECT_PATH, config, '/test/e2e.yaml');

    await expect(
      handleMockValidate(
        { projectPath: PROJECT_PATH, mockName: 'nonexistent' },
        sessionManager,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('should throw when no openapi field and no specPath', async () => {
    const config = makeConfig({
      'manual-mock': {
        port: 9090,
        routes: [{ method: 'GET', path: '/api', response: { status: 200, body: {} } }],
      },
    });
    sessionManager.create(PROJECT_PATH, config, '/test/e2e.yaml');

    await expect(
      handleMockValidate(
        { projectPath: PROJECT_PATH, mockName: 'manual-mock' },
        sessionManager,
      ),
    ).rejects.toThrow(/openapi/i);
  });

  it('should throw when no active session', async () => {
    await expect(
      handleMockValidate(
        { projectPath: '/unknown/path' },
        sessionManager,
      ),
    ).rejects.toThrow(/session/i);
  });

  it('should validate override-only mock with specPath', async () => {
    const config = makeConfig({
      'partial-mock': {
        port: 9090,
        routes: [
          { method: 'GET', path: '/pets', response: { status: 200, body: [] } },
        ],
      },
    });
    sessionManager.create(PROJECT_PATH, config, '/test/e2e.yaml');

    const result = await handleMockValidate(
      { projectPath: PROJECT_PATH, mockName: 'partial-mock', specPath: PETSTORE },
      sessionManager,
    );

    expect(result.totalSpecEndpoints).toBe(4);
    expect(result.coveredCount).toBe(1);
    expect(result.missingCount).toBe(3);
    expect(result.coveragePercent).toBe(25);
  });
});
