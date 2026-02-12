/**
 * Unit tests for yaml-engine module.
 *
 * Tests cover:
 * - YAML file loading and parsing
 * - Time string parsing
 * - Variable resolution in test cases
 * - Error handling for invalid files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadYAMLTests, parseTime } from '../../src/yaml-engine.js';

/** Helper to create a temporary directory */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'e2e-yaml-test-'));
}

describe('yaml-engine', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('parseTime', () => {
    it('should parse seconds', () => {
      expect(parseTime('5s')).toBe(5000);
    });

    it('should parse milliseconds', () => {
      expect(parseTime('100ms')).toBe(100);
    });

    it('should parse minutes', () => {
      expect(parseTime('2m')).toBe(120000);
    });

    it('should parse hours', () => {
      expect(parseTime('1h')).toBe(3600000);
    });

    it('should parse plain numbers as milliseconds', () => {
      expect(parseTime('500')).toBe(500);
    });

    it('should handle decimal values', () => {
      expect(parseTime('1.5s')).toBe(1500);
      expect(parseTime('0.5m')).toBe(30000);
    });

    it('should handle whitespace', () => {
      expect(parseTime('  5s  ')).toBe(5000);
    });

    it('should throw on invalid format', () => {
      expect(() => parseTime('abc')).toThrow('Invalid time format');
      expect(() => parseTime('5x')).toThrow('Invalid time format');
      expect(() => parseTime('')).toThrow('Invalid time format');
    });
  });

  describe('loadYAMLTests', () => {
    it('should load a minimal YAML test file', async () => {
      const yamlContent = [
        'name: Health Check Tests',
        'cases:',
        '  - name: GET /health',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.name).toBe('Health Check Tests');
      expect(suite.cases).toHaveLength(1);
      expect(suite.cases[0]!.name).toBe('GET /health');
      expect(suite.cases[0]!.request.method).toBe('GET');
      expect(suite.cases[0]!.request.path).toBe('/health');
      expect(suite.cases[0]!.expect?.status).toBe(200);
    });

    it('should load a full YAML test file with all fields', async () => {
      const yamlContent = [
        'name: Full API Tests',
        'description: Complete test suite',
        'sequential: true',
        'variables:',
        '  api_key: test-key-123',
        '  timeout: "5s"',
        'setup:',
        '  - name: Create resource',
        '    request:',
        '      method: POST',
        '      path: /api/resources',
        '      headers:',
        '        Authorization: "Bearer {{api_key}}"',
        '      body:',
        '        name: test-resource',
        '    expect:',
        '      status: 201',
        '    save:',
        '      resource_id: id',
        'cases:',
        '  - name: Get resource',
        '    delay: "1s"',
        '    request:',
        '      method: GET',
        '      path: /api/resources/{{resource_id}}',
        '      timeout: "10s"',
        '    expect:',
        '      status: 200',
        '      body:',
        '        name: test-resource',
        'teardown:',
        '  - name: Delete resource',
        '    request:',
        '      method: DELETE',
        '      path: /api/resources/{{resource_id}}',
        '    ignoreError: true',
      ].join('\n');

      const filePath = path.join(tmpDir, 'full-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.name).toBe('Full API Tests');
      expect(suite.description).toBe('Complete test suite');
      expect(suite.sequential).toBe(true);
      expect(suite.variables).toEqual({ api_key: 'test-key-123', timeout: '5s' });
      expect(suite.setup).toHaveLength(1);
      expect(suite.cases).toHaveLength(1);
      expect(suite.teardown).toHaveLength(1);
      expect(suite.cases[0]!.delay).toBe('1s');
    });

    it('should handle setup with waitHealthy and delay', async () => {
      const yamlContent = [
        'name: Setup Test',
        'setup:',
        '  - waitHealthy:',
        '      timeout: "30s"',
        '  - delay: "2s"',
        'cases:',
        '  - name: Test case',
        '    request:',
        '      method: GET',
        '      path: /test',
      ].join('\n');

      const filePath = path.join(tmpDir, 'setup-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.setup).toHaveLength(2);
    });

    it('should throw on file not found', async () => {
      await expect(
        loadYAMLTests(path.join(tmpDir, 'nonexistent.yaml')),
      ).rejects.toThrow('Failed to read YAML test file');
    });

    it('should throw on YAML syntax error', async () => {
      const filePath = path.join(tmpDir, 'bad.yaml');
      await fs.writeFile(filePath, ':\n  invalid: yaml\n    broken:', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('YAML syntax error');
    });

    it('should throw on empty file', async () => {
      const filePath = path.join(tmpDir, 'empty.yaml');
      await fs.writeFile(filePath, '', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('empty or invalid');
    });

    it('should throw when missing required name field', async () => {
      const filePath = path.join(tmpDir, 'no-name.yaml');
      await fs.writeFile(filePath, 'cases:\n  - name: test\n    request:\n      method: GET\n      path: /test', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('missing required "name" field');
    });

    it('should throw when missing cases array', async () => {
      const filePath = path.join(tmpDir, 'no-cases.yaml');
      await fs.writeFile(filePath, 'name: Test\n', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('missing required "cases" array');
    });

    it('should load a YAML file with save directives', async () => {
      const yamlContent = [
        'name: Save Test',
        'cases:',
        '  - name: Create and save ID',
        '    request:',
        '      method: POST',
        '      path: /api/items',
        '      body:',
        '        name: test-item',
        '    expect:',
        '      status: 201',
        '    save:',
        '      item_id: data.id',
        '      item_name: data.name',
      ].join('\n');

      const filePath = path.join(tmpDir, 'save-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.cases[0]!.save).toEqual({
        item_id: 'data.id',
        item_name: 'data.name',
      });
    });

    it('should load test with multiple expected statuses', async () => {
      const yamlContent = [
        'name: Multi-Status Test',
        'cases:',
        '  - name: Check endpoint',
        '    request:',
        '      method: GET',
        '      path: /api/check',
        '    expect:',
        '      status:',
        '        - 200',
        '        - 204',
      ].join('\n');

      const filePath = path.join(tmpDir, 'multi-status.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.cases[0]!.expect?.status).toEqual([200, 204]);
    });
  });
});
