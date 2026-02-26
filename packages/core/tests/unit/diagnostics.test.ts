/**
 * Unit tests for DiagnosticCollector.
 * Tests container log collection, health status, mock request fetch,
 * network inspect, timeout handling, and partial failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosticCollector } from '../../src/diagnostics.js';

vi.mock('../../src/docker-engine.js', () => ({
  getContainerLogs: vi.fn(),
  getContainerStatus: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const mockExecFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
    if (cb) {
      cb(null, { stdout: '', stderr: '' });
    }
    return { stdout: '', stderr: '' };
  });
  return {
    execFile: mockExecFile,
    execFileSync: vi.fn(),
  };
});

const { getContainerLogs, getContainerStatus } = await import('../../src/docker-engine.js');
const { execFile, execFileSync } = await import('node:child_process');

describe('DiagnosticCollector', () => {
  let collector: DiagnosticCollector;

  beforeEach(() => {
    collector = new DiagnosticCollector();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('collectContainerLogs', () => {
    it('should collect logs from containers', async () => {
      vi.mocked(getContainerLogs).mockResolvedValue('line1\nline2\nline3');

      const result = await collector.collectContainerLogs(['my-app'], 50, 5000);

      expect(result).toHaveLength(1);
      expect(result[0]!.containerName).toBe('my-app');
      expect(result[0]!.lines).toEqual(['line1', 'line2', 'line3']);
      expect(result[0]!.lineCount).toBe(3);
      expect(getContainerLogs).toHaveBeenCalledWith('my-app', 50);
    });

    it('should handle partial failure gracefully', async () => {
      vi.mocked(getContainerLogs)
        .mockResolvedValueOnce('log line')
        .mockRejectedValueOnce(new Error('container not found'));

      const result = await collector.collectContainerLogs(['app1', 'app2'], 50, 5000);

      expect(result).toHaveLength(1);
      expect(result[0]!.containerName).toBe('app1');
    });

    it('should handle empty log output', async () => {
      vi.mocked(getContainerLogs).mockResolvedValue('');

      const result = await collector.collectContainerLogs(['app'], 50, 5000);

      expect(result).toHaveLength(1);
      expect(result[0]!.lines).toEqual([]);
      expect(result[0]!.lineCount).toBe(0);
    });
  });

  describe('collectContainerHealth', () => {
    it('should collect health status', async () => {
      vi.mocked(getContainerStatus).mockResolvedValue('running');
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
        if (cb) cb(null, { stdout: 'healthy output\n', stderr: '' });
        return {} as any;
      });

      const result = await collector.collectContainerHealth(['my-app'], 5000);

      expect(result).toHaveLength(1);
      expect(result[0]!.containerName).toBe('my-app');
      expect(result[0]!.status).toBe('running');
    });

    it('should handle missing health log', async () => {
      vi.mocked(getContainerStatus).mockResolvedValue('running');
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
        if (cb) cb(null, { stdout: '<nil>\n', stderr: '' });
        return {} as any;
      });

      const result = await collector.collectContainerHealth(['my-app'], 5000);

      expect(result).toHaveLength(1);
      expect(result[0]!.healthLog).toBeUndefined();
    });

    it('should handle unreachable container', async () => {
      vi.mocked(getContainerStatus).mockRejectedValue(new Error('not found'));

      const result = await collector.collectContainerHealth(['missing-app'], 5000);

      expect(result).toHaveLength(0);
    });
  });

  describe('collectMockRequests', () => {
    it('should fetch mock requests', async () => {
      const mockResponse = {
        requests: [
          { method: 'POST', url: '/api/data', body: { key: 'val' }, headers: {}, timestamp: '2026-01-01T00:00:00Z' },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'content-type': 'application/json' } }),
      );

      const result = await collector.collectMockRequests([{ name: 'cos-mock', port: 9100 }], 5000);

      expect(result).toHaveLength(1);
      expect(result[0]!.mockName).toBe('cos-mock');
      expect(result[0]!.requests).toHaveLength(1);
      expect(result[0]!.requests[0]!.method).toBe('POST');

      fetchSpy.mockRestore();
    });

    it('should handle unreachable mock', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await collector.collectMockRequests([{ name: 'dead-mock', port: 9999 }], 5000);

      expect(result).toHaveLength(0);

      fetchSpy.mockRestore();
    });
  });

  describe('collectNetworkInfo', () => {
    it('should collect network info', async () => {
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
        if (cb) cb(null, { stdout: 'container1 container2 \n', stderr: '' });
        return {} as any;
      });

      const result = await collector.collectNetworkInfo('e2e-network', 5000);

      expect(result).toBeDefined();
      expect(result!.networkName).toBe('e2e-network');
      expect(result!.connectedContainers).toEqual(['container1', 'container2']);
    });

    it('should return undefined for missing network', async () => {
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
        if (cb) cb(new Error('not found'), { stdout: '', stderr: '' });
        return {} as any;
      });

      const result = await collector.collectNetworkInfo('no-network', 5000);

      expect(result).toBeUndefined();
    });
  });

  describe('collect (aggregator)', () => {
    it('should collect all diagnostics in parallel', async () => {
      vi.mocked(getContainerLogs).mockResolvedValue('log line');
      vi.mocked(getContainerStatus).mockResolvedValue('running');
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
        if (cb) cb(null, { stdout: '<nil>\n', stderr: '' });
        return {} as any;
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ requests: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
      );

      const report = await collector.collect({
        containerNames: ['my-app'],
        mockEndpoints: [{ name: 'mock1', port: 9100 }],
        networkName: 'test-net',
      });

      expect(report.containerLogs).toHaveLength(1);
      expect(report.containerHealth).toHaveLength(1);
      expect(report.mockRequests).toHaveLength(1);
      expect(report.collectedAt).toBeGreaterThan(0);

      fetchSpy.mockRestore();
    });

    it('should collect without optional fields', async () => {
      const report = await collector.collect({});

      expect(report.containerLogs).toEqual([]);
      expect(report.containerHealth).toEqual([]);
      expect(report.mockRequests).toEqual([]);
      expect(report.networkInfo).toBeUndefined();
      expect(report.collectedAt).toBeGreaterThan(0);
    });
  });
});
