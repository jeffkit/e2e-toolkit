/**
 * Unit tests for argus_mock_generate MCP tool.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { handleMockGenerate } from '../../src/tools/mock-generate.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../core/tests/unit/openapi/fixtures');
const PETSTORE = path.join(FIXTURES, 'petstore.yaml');

describe('argus_mock_generate', () => {
  it('should generate valid YAML snippet from spec', async () => {
    const result = await handleMockGenerate({
      projectPath: FIXTURES,
      specPath: PETSTORE,
    });

    expect(result.yaml).toContain('mocks:');
    expect(result.yaml).toContain('openapi:');
    expect(result.yaml).toContain('port: 9090');
  });

  it('should produce correct summary fields', async () => {
    const result = await handleMockGenerate({
      projectPath: FIXTURES,
      specPath: PETSTORE,
    });

    expect(result.summary.specTitle).toBe('Petstore API');
    expect(result.summary.specVersion).toBe('3.0.3');
    expect(result.summary.totalEndpoints).toBe(4);
    expect(result.summary.methods['GET']).toBe(2);
    expect(result.summary.methods['POST']).toBe(1);
    expect(result.summary.methods['DELETE']).toBe(1);
  });

  it('should throw on missing spec file', async () => {
    await expect(
      handleMockGenerate({
        projectPath: '/tmp',
        specPath: '/nonexistent/spec.yaml',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('should include optional params in YAML when specified', async () => {
    const result = await handleMockGenerate({
      projectPath: FIXTURES,
      specPath: PETSTORE,
      port: 8080,
      mode: 'record',
      validate: true,
      target: 'https://api.example.com',
    });

    expect(result.yaml).toContain('port: 8080');
    expect(result.yaml).toContain('mode: record');
    expect(result.yaml).toContain('validate: true');
    expect(result.yaml).toContain('target: https://api.example.com');
  });

  it('should derive mock name from spec title', async () => {
    const result = await handleMockGenerate({
      projectPath: FIXTURES,
      specPath: PETSTORE,
    });

    expect(result.yaml).toContain('petstore-api:');
  });

  it('should use custom mock name when provided', async () => {
    const result = await handleMockGenerate({
      projectPath: FIXTURES,
      specPath: PETSTORE,
      mockName: 'my-custom-mock',
    });

    expect(result.yaml).toContain('my-custom-mock:');
  });
});
