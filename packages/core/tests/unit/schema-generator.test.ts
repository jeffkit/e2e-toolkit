/**
 * Unit tests for schema-generator module.
 *
 * Tests cover:
 * - JSON Schema generation produces valid output
 * - All fields have descriptions
 * - Valid configs pass validation against generated schema
 * - Invalid configs fail validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Ajv from 'ajv';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  generateSchemas,
  getE2EConfigJsonSchema,
  getTestSuiteJsonSchema,
} from '../../src/schema-generator.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'schema-gen-test-'));
}

describe('schema-generator', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('generateSchemas', () => {
    it('should generate schema files in the output directory', async () => {
      const files = await generateSchemas(tmpDir);

      expect(files).toHaveLength(2);
      expect(files[0]).toContain('e2e-config.schema.json');
      expect(files[1]).toContain('test-suite.schema.json');

      for (const f of files) {
        const content = await fs.readFile(f, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
        expect(parsed.title).toBeTruthy();
        expect(parsed.description).toBeTruthy();
      }
    });

    it('should create the output directory if it does not exist', async () => {
      const nested = path.join(tmpDir, 'deep', 'nested', 'dir');
      const files = await generateSchemas(nested);
      expect(files).toHaveLength(2);
    });
  });

  describe('getE2EConfigJsonSchema', () => {
    it('should return a valid JSON Schema object', () => {
      const schema = getE2EConfigJsonSchema();

      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.title).toBe('Preflight E2E Configuration');
      expect(schema.definitions).toBeDefined();
    });

    it('should have description on top-level properties', () => {
      const schema = getE2EConfigJsonSchema();
      const definitions = schema.definitions as Record<string, { properties?: Record<string, { description?: string }> }>;
      const e2eConfig = definitions['E2EConfig'];
      expect(e2eConfig).toBeDefined();

      const props = e2eConfig!.properties!;
      expect(props['version']?.description).toBeTruthy();
      expect(props['project']?.description).toBeTruthy();
    });

    it('should validate a valid E2E config', () => {
      const schema = getE2EConfigJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const validConfig = {
        version: '1',
        project: { name: 'test-project' },
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
          container: { name: 'test-container', ports: ['8080:8080'] },
        },
        tests: {
          suites: [{ name: 'Health', id: 'health', file: 'tests/health.yaml' }],
        },
      };

      const valid = validate(validConfig);
      expect(valid).toBe(true);
    });

    it('should reject config missing required project.name', () => {
      const schema = getE2EConfigJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const invalidConfig = {
        version: '1',
        project: { description: 'no name' },
      };

      const valid = validate(invalidConfig);
      expect(valid).toBe(false);
      expect(validate.errors).toBeTruthy();
      expect(validate.errors!.some(e =>
        e.keyword === 'required' && e.message?.includes('name'),
      )).toBe(true);
    });

    it('should reject config with invalid port type', () => {
      const schema = getE2EConfigJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const invalidConfig = {
        version: '1',
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
          container: { name: 'test', ports: [8080] },
        },
      };

      const valid = validate(invalidConfig);
      expect(valid).toBe(false);
    });
  });

  describe('getTestSuiteJsonSchema', () => {
    it('should return a valid JSON Schema object', () => {
      const schema = getTestSuiteJsonSchema();

      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.title).toBe('Preflight Test Suite');
    });

    it('should validate a valid test suite config', () => {
      const schema = getTestSuiteJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const validSuite = {
        name: 'Health Check',
        id: 'health',
        file: 'tests/health.yaml',
        runner: 'yaml',
      };

      expect(validate(validSuite)).toBe(true);
    });

    it('should validate suite with retry policy', () => {
      const schema = getTestSuiteJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const suiteWithRetry = {
        name: 'Flaky Tests',
        id: 'flaky',
        file: 'tests/flaky.yaml',
        retry: {
          maxAttempts: 3,
          delay: '2s',
          backoff: 'exponential',
          backoffMultiplier: 2,
        },
      };

      expect(validate(suiteWithRetry)).toBe(true);
    });

    it('should reject suite missing required id', () => {
      const schema = getTestSuiteJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const invalidSuite = { name: 'No ID' };

      expect(validate(invalidSuite)).toBe(false);
      expect(validate.errors!.some(e =>
        e.keyword === 'required' && e.message?.includes('id'),
      )).toBe(true);
    });

    it('should reject retry with maxAttempts > 10', () => {
      const schema = getTestSuiteJsonSchema();
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);

      const invalidSuite = {
        name: 'Bad Retry',
        id: 'bad-retry',
        retry: { maxAttempts: 50, delay: '1s' },
      };

      expect(validate(invalidSuite)).toBe(false);
    });
  });
});
