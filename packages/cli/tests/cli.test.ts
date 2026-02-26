/**
 * CLI smoke tests for preflight.
 *
 * Tests cover:
 * - --help output
 * - --version output
 * - init command generates files (uses temporary directory)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Run the CLI via tsx */
function runCLI(args: string[], cwd?: string): string {
  const cliPath = path.resolve(__dirname, '../src/index.ts');
  return execFileSync('npx', ['tsx', cliPath, ...args], {
    encoding: 'utf-8',
    cwd,
    timeout: 15_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

describe('CLI', () => {
  describe('--help', () => {
    it('should show help text with all commands', () => {
      const output = runCLI(['--help']);
      expect(output).toContain('preflight');
      expect(output).toContain('init');
      expect(output).toContain('setup');
      expect(output).toContain('run');
      expect(output).toContain('build');
      expect(output).toContain('status');
      expect(output).toContain('clean');
    });
  });

  describe('--version', () => {
    it('should show version number', () => {
      const output = runCLI(['--version']);
      expect(output.trim()).toBe('0.1.0');
    });
  });

  describe('init', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-cli-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should create project files in target directory', async () => {
      runCLI(['init', '--dir', tmpDir]);

      // Check e2e.yaml exists
      await expect(fs.stat(path.join(tmpDir, 'e2e.yaml'))).resolves.toBeTruthy();

      // Check tests/health.yaml exists
      await expect(fs.stat(path.join(tmpDir, 'tests', 'health.yaml'))).resolves.toBeTruthy();

      // Check .env.example exists
      await expect(fs.stat(path.join(tmpDir, '.env.example'))).resolves.toBeTruthy();
    });

    it('should not overwrite existing files', async () => {
      // Create an existing e2e.yaml with custom content
      const customContent = 'custom-content';
      await fs.writeFile(path.join(tmpDir, 'e2e.yaml'), customContent, 'utf-8');

      runCLI(['init', '--dir', tmpDir]);

      // Original file should be preserved
      const content = await fs.readFile(path.join(tmpDir, 'e2e.yaml'), 'utf-8');
      expect(content).toBe(customContent);
    });
  });
});
