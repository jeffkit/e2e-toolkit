/**
 * Unit tests for HistoryRecorder.
 * Tests: record creation, ID generation, git context inclusion,
 * config hash computation, retention cleanup call, graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryRecorder } from '../../../src/history/history-recorder.js';
import { MemoryHistoryStore } from '../../../src/history/memory-history-store.js';
import type { HistoryConfig } from '../../../src/history/types.js';
import type { RunInput } from '../../../src/history/history-recorder.js';

vi.mock('../../../src/history/git-context.js', () => ({
  getGitContext: vi.fn(() => ({ commit: 'mock-sha', branch: 'mock-branch' })),
}));

vi.mock('../../../src/history/config-hash.js', () => ({
  computeConfigHash: vi.fn(() => 'sha256:mockhash'),
}));

const defaultConfig: HistoryConfig = {
  enabled: true,
  storage: 'memory',
  retention: { maxAge: '90d', maxRuns: 1000 },
  flakyWindow: 10,
};

function createRunInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    status: 'failed',
    duration: 5000,
    totals: { passed: 3, failed: 1, skipped: 0 },
    suites: [
      {
        id: 'api-tests',
        name: 'API Tests',
        status: 'failed',
        duration: 5000,
        passed: 3,
        failed: 1,
        skipped: 0,
        cases: [
          {
            name: 'GET /health',
            suite: 'API Tests',
            status: 'passed',
            duration: 100,
            timestamp: Date.now(),
          },
          {
            name: 'POST /users',
            suite: 'API Tests',
            status: 'passed',
            duration: 200,
            timestamp: Date.now(),
          },
          {
            name: 'GET /orders',
            suite: 'API Tests',
            status: 'passed',
            duration: 150,
            timestamp: Date.now(),
          },
          {
            name: 'DELETE /users/:id',
            suite: 'API Tests',
            status: 'failed',
            duration: 300,
            timestamp: Date.now(),
            failure: {
              error: 'Expected 204 but got 500',
              assertions: [{ passed: false, path: 'status', operator: 'eq', expected: 204, actual: 500, message: 'status mismatch' }],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('HistoryRecorder', () => {
  let store: MemoryHistoryStore;
  let recorder: HistoryRecorder;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MemoryHistoryStore();
    recorder = new HistoryRecorder(store, defaultConfig);
  });

  describe('recordRun', () => {
    it('should create a run record and case records', () => {
      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path/to/project',
        '/path/to/project/e2e.yaml',
        'mcp',
      );

      expect(result).not.toBeNull();
      expect(result!.runRecord.project).toBe('my-project');
      expect(result!.runRecord.status).toBe('failed');
      expect(result!.runRecord.passed).toBe(3);
      expect(result!.runRecord.failed).toBe(1);
      expect(result!.caseRecords).toHaveLength(4);
    });

    it('should generate proper ID formats', () => {
      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      expect(result!.runRecord.id).toMatch(/^run-\d+-[a-z0-9]+$/);
      for (const c of result!.caseRecords) {
        expect(c.id).toMatch(/^case-\d+-[a-z0-9-]+-\d+$/);
      }
    });

    it('should include git context from getGitContext', () => {
      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      expect(result!.runRecord.gitCommit).toBe('mock-sha');
      expect(result!.runRecord.gitBranch).toBe('mock-branch');
    });

    it('should include config hash from computeConfigHash', () => {
      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      expect(result!.runRecord.configHash).toBe('sha256:mockhash');
    });

    it('should use explicit trigger source', () => {
      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
        'dashboard',
      );

      expect(result!.runRecord.trigger).toBe('dashboard');
    });

    it('should default trigger to cli when CI env is not set', () => {
      const origCI = process.env['CI'];
      delete process.env['CI'];

      try {
        const result = recorder.recordRun(
          createRunInput(),
          'my-project',
          '/path',
          '/path/e2e.yaml',
        );
        expect(result!.runRecord.trigger).toBe('cli');
      } finally {
        if (origCI !== undefined) process.env['CI'] = origCI;
      }
    });

    it('should persist records to the store', () => {
      recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      const stored = store.getRuns('my-project', {});
      expect(stored.total).toBe(1);
      expect(stored.runs[0]!.project).toBe('my-project');
    });

    it('should capture error text on failed cases', () => {
      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      const failedCase = result!.caseRecords.find(c => c.status === 'failed');
      expect(failedCase).toBeDefined();
      expect(failedCase!.error).toBe('Expected 204 but got 500');
    });

    it('should call cleanup after saving', () => {
      const cleanupSpy = vi.spyOn(store, 'cleanup');

      recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      expect(cleanupSpy).toHaveBeenCalledWith('my-project', '90d', 1000);
    });
  });

  describe('graceful degradation', () => {
    it('should return null when store.saveRun throws', () => {
      vi.spyOn(store, 'saveRun').mockImplementation(() => {
        throw new Error('DB locked');
      });

      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      expect(result).toBeNull();
    });

    it('should still succeed when cleanup throws', () => {
      vi.spyOn(store, 'cleanup').mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      const result = recorder.recordRun(
        createRunInput(),
        'my-project',
        '/path',
        '/path/e2e.yaml',
      );

      expect(result).not.toBeNull();
      expect(result!.runRecord.project).toBe('my-project');
    });
  });
});
