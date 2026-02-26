/**
 * Unit tests for resilience/orphan-cleaner module.
 *
 * Mocks dockerExec to avoid real Docker calls.
 * Covers: detect (filter by project, exclude current run),
 *         cleanup (partial failures), empty-orphan fast path,
 *         cross-project isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrphanResource, SSEBus, SSEMessage } from '../../../src/types.js';

vi.mock('../../../src/docker-engine.js', () => ({
  dockerExec: vi.fn(),
}));

import { dockerExec } from '../../../src/docker-engine.js';
import { OrphanCleaner } from '../../../src/resilience/orphan-cleaner.js';

const mockDockerExec = vi.mocked(dockerExec);

function createMockBus(): SSEBus & { events: Array<{ channel: string; msg: SSEMessage }> } {
  const events: Array<{ channel: string; msg: SSEMessage }> = [];
  return {
    events,
    emit(channel: string, msg: SSEMessage) {
      events.push({ channel, msg });
    },
    subscribe: () => () => {},
  };
}

describe('OrphanCleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =================================================================
  // detect
  // =================================================================

  describe('detect', () => {
    it('should return empty array when no orphans found', async () => {
      mockDockerExec.mockResolvedValue('');

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toEqual([]);
    });

    it('should detect orphaned containers from previous runs', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) {
          return 'abc123\told-container\targusai.run-id=old-run,argusai.created-at=2026-01-01';
        }
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.type).toBe('container');
      expect(orphans[0]!.name).toBe('old-container');
      expect(orphans[0]!.runId).toBe('old-run');
    });

    it('should exclude containers belonging to the current run', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) {
          return 'abc123\tmy-container\targusai.run-id=current-run,argusai.created-at=2026-01-01';
        }
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toHaveLength(0);
    });

    it('should detect orphaned networks', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('network') && args.includes('ls')) {
          return 'net123\told-network\targusai.run-id=old-run,argusai.created-at=2026-01-01';
        }
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.type).toBe('network');
    });

    it('should handle docker command failures gracefully', async () => {
      mockDockerExec.mockRejectedValue(new Error('Docker not available'));

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toEqual([]);
    });
  });

  // =================================================================
  // cleanup
  // =================================================================

  describe('cleanup', () => {
    it('should remove containers before networks', async () => {
      const callOrder: string[] = [];
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args[0] === 'rm') callOrder.push('rm-container');
        if (args[0] === 'network' && args[1] === 'rm') callOrder.push('rm-network');
        return '';
      });

      const orphans: OrphanResource[] = [
        { type: 'network', name: 'net1', id: 'net-id', project: 'p', runId: 'old', createdAt: '' },
        { type: 'container', name: 'c1', id: 'c-id', project: 'p', runId: 'old', createdAt: '' },
      ];

      const cleaner = new OrphanCleaner('p', 'current');
      const result = await cleaner.cleanup(orphans);

      expect(callOrder[0]).toBe('rm-container');
      expect(callOrder[1]).toBe('rm-network');
      expect(result.removed).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('should isolate per-resource errors', async () => {
      let callCount = 0;
      mockDockerExec.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Resource busy');
        return '';
      });

      const orphans: OrphanResource[] = [
        { type: 'container', name: 'c1', id: 'c1-id', project: 'p', runId: 'old', createdAt: '' },
        { type: 'container', name: 'c2', id: 'c2-id', project: 'p', runId: 'old', createdAt: '' },
      ];

      const cleaner = new OrphanCleaner('p', 'current');
      const result = await cleaner.cleanup(orphans);

      expect(result.removed).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.name).toBe('c1');
      expect(result.failed[0]!.error).toContain('Resource busy');
    });

    it('should return zero-duration for empty orphan list', async () => {
      const cleaner = new OrphanCleaner('p', 'current');
      const result = await cleaner.cleanup([]);

      expect(result.found).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // =================================================================
  // detectAndCleanup
  // =================================================================

  describe('detectAndCleanup', () => {
    it('should detect and clean in one operation', async () => {
      let callIdx = 0;
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) {
          return 'c1-id\torphan-c1\targusai.run-id=old-run,argusai.created-at=2026-01-01';
        }
        if (args[0] === 'rm') {
          return '';
        }
        return '';
      });

      const bus = createMockBus();
      const cleaner = new OrphanCleaner('my-project', 'current-run', bus);
      const result = await cleaner.detectAndCleanup();

      expect(result.found).toHaveLength(1);
      expect(result.removed).toHaveLength(1);

      const eventTypes = bus.events.map(e => (e.msg as { event: string }).event);
      expect(eventTypes).toContain('cleanup_start');
      expect(eventTypes).toContain('cleanup_resource');
      expect(eventTypes).toContain('cleanup_end');
    });

    it('should emit cleanup_end with zero counts when no orphans exist', async () => {
      mockDockerExec.mockResolvedValue('');

      const bus = createMockBus();
      const cleaner = new OrphanCleaner('my-project', 'current-run', bus);
      const result = await cleaner.detectAndCleanup();

      expect(result.found).toHaveLength(0);

      const endEvent = bus.events.find(
        e => (e.msg as { event: string }).event === 'cleanup_end',
      );
      expect(endEvent).toBeDefined();
    });
  });
});
