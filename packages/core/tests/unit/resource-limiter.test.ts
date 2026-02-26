import { describe, it, expect, vi } from 'vitest';
import {
  Semaphore,
  ResourceLimiter,
  buildResourceArgs,
} from '../../src/resource-limiter.js';

// =====================================================================
// Helpers
// =====================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================================
// Semaphore
// =====================================================================

describe('Semaphore', () => {
  it('throws if max < 1', () => {
    expect(() => new Semaphore(0)).toThrow('max must be >= 1');
  });

  it('allows up to max concurrent acquisitions', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.available).toBe(0);
  });

  it('blocks when at capacity', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const promise = sem.acquire().then(() => { acquired = true; });
    await delay(20);
    expect(acquired).toBe(false);
    expect(sem.waiting).toBe(1);

    sem.release();
    await promise;
    expect(acquired).toBe(true);
  });

  it('release unblocks waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));

    sem.release();
    await p1;
    sem.release();
    await p2;

    expect(order).toEqual([1, 2]);
  });

  it('reports available and capacity correctly', async () => {
    const sem = new Semaphore(3);
    expect(sem.capacity).toBe(3);
    expect(sem.available).toBe(3);
    await sem.acquire();
    expect(sem.available).toBe(2);
    sem.release();
    expect(sem.available).toBe(3);
  });
});

// =====================================================================
// ResourceLimiter — basic operations
// =====================================================================

describe('ResourceLimiter — basic operations', () => {
  it('defaults to 10 global max containers', () => {
    const limiter = new ResourceLimiter();
    expect(limiter.globalCapacity).toBe(10);
  });

  it('uses custom global max containers', () => {
    const limiter = new ResourceLimiter({ globalMaxContainers: 5 });
    expect(limiter.globalCapacity).toBe(5);
  });

  it('acquire and release container', async () => {
    const limiter = new ResourceLimiter({ globalMaxContainers: 2 });
    await limiter.acquireContainer('/proj-a', 'container-1');
    expect(limiter.globalAvailable).toBe(1);

    limiter.releaseContainer('/proj-a', 'container-1');
    expect(limiter.globalAvailable).toBe(2);
  });

  it('returns resource limits on acquire', async () => {
    const limiter = new ResourceLimiter();
    limiter.setProjectLimits('/proj', { cpu: 0.5, memory: '256m' });

    const limits = await limiter.acquireContainer('/proj', 'c1');
    expect(limits.cpu).toBe(0.5);
    expect(limits.memory).toBe('256m');
    limiter.releaseContainer('/proj', 'c1');
  });

  it('uses default limits when project has no explicit limits', async () => {
    const limiter = new ResourceLimiter({
      defaultLimits: { cpu: 1, memory: '512m' },
    });
    const limits = await limiter.acquireContainer('/any', 'c1');
    expect(limits.cpu).toBe(1);
    expect(limits.memory).toBe('512m');
    limiter.releaseContainer('/any', 'c1');
  });
});

// =====================================================================
// ResourceLimiter — project-level limits
// =====================================================================

describe('ResourceLimiter — project container limits', () => {
  it('rejects when project hits container limit', async () => {
    const limiter = new ResourceLimiter();
    limiter.setProjectLimits('/proj', { maxContainers: 1 });

    await limiter.acquireContainer('/proj', 'c1');
    await expect(limiter.acquireContainer('/proj', 'c2'))
      .rejects.toThrow('container limit');

    limiter.releaseContainer('/proj', 'c1');
    const limits = await limiter.acquireContainer('/proj', 'c2');
    expect(limits).toBeDefined();
    limiter.releaseContainer('/proj', 'c2');
  });

  it('different projects have independent limits', async () => {
    const limiter = new ResourceLimiter();
    limiter.setProjectLimits('/a', { maxContainers: 1 });
    limiter.setProjectLimits('/b', { maxContainers: 1 });

    await limiter.acquireContainer('/a', 'a-c1');
    await limiter.acquireContainer('/b', 'b-c1');

    await expect(limiter.acquireContainer('/a', 'a-c2')).rejects.toThrow('container limit');
    await expect(limiter.acquireContainer('/b', 'b-c2')).rejects.toThrow('container limit');

    limiter.releaseContainer('/a', 'a-c1');
    limiter.releaseContainer('/b', 'b-c1');
  });
});

// =====================================================================
// ResourceLimiter — global concurrency
// =====================================================================

describe('ResourceLimiter — global concurrency', () => {
  it('blocks when global limit reached', async () => {
    const limiter = new ResourceLimiter({ globalMaxContainers: 2 });

    await limiter.acquireContainer('/a', 'c1');
    await limiter.acquireContainer('/b', 'c2');
    expect(limiter.globalAvailable).toBe(0);

    let acquired = false;
    const promise = limiter.acquireContainer('/c', 'c3').then(() => { acquired = true; });
    await delay(20);
    expect(acquired).toBe(false);
    expect(limiter.globalWaiting).toBe(1);

    limiter.releaseContainer('/a', 'c1');
    await promise;
    expect(acquired).toBe(true);
    limiter.releaseContainer('/b', 'c2');
    limiter.releaseContainer('/c', 'c3');
  });
});

// =====================================================================
// ResourceLimiter — state inspection
// =====================================================================

describe('ResourceLimiter — state inspection', () => {
  it('getProjectState reflects active containers', async () => {
    const limiter = new ResourceLimiter();
    limiter.setProjectLimits('/proj', { cpu: 2, maxContainers: 5 });

    await limiter.acquireContainer('/proj', 'c1');
    await limiter.acquireContainer('/proj', 'c2');

    const state = limiter.getProjectState('/proj');
    expect(state.project).toBe('/proj');
    expect(state.activeContainers).toBe(2);
    expect(state.limits.cpu).toBe(2);
    expect(state.limits.maxContainers).toBe(5);

    limiter.releaseContainer('/proj', 'c1');
    limiter.releaseContainer('/proj', 'c2');
  });

  it('getProjectState returns 0 active for unknown project', () => {
    const limiter = new ResourceLimiter();
    const state = limiter.getProjectState('/unknown');
    expect(state.activeContainers).toBe(0);
  });

  it('getAllProjectStates returns all known projects', async () => {
    const limiter = new ResourceLimiter();
    limiter.setProjectLimits('/configured', { cpu: 1 });
    await limiter.acquireContainer('/active', 'c1');

    const states = limiter.getAllProjectStates();
    const names = states.map(s => s.project);
    expect(names).toContain('/configured');
    expect(names).toContain('/active');

    limiter.releaseContainer('/active', 'c1');
  });

  it('release cleans up empty project container set', async () => {
    const limiter = new ResourceLimiter();
    await limiter.acquireContainer('/temp', 'c1');
    expect(limiter.getProjectState('/temp').activeContainers).toBe(1);

    limiter.releaseContainer('/temp', 'c1');
    expect(limiter.getProjectState('/temp').activeContainers).toBe(0);
  });
});

// =====================================================================
// buildResourceArgs
// =====================================================================

describe('buildResourceArgs', () => {
  it('returns empty array for no limits', () => {
    expect(buildResourceArgs({})).toEqual([]);
  });

  it('adds --cpus for cpu limit', () => {
    expect(buildResourceArgs({ cpu: 0.5 })).toEqual(['--cpus', '0.5']);
  });

  it('adds --memory for memory limit', () => {
    expect(buildResourceArgs({ memory: '256m' })).toEqual(['--memory', '256m']);
  });

  it('adds both flags when both limits set', () => {
    const args = buildResourceArgs({ cpu: 2, memory: '1g' });
    expect(args).toEqual(['--cpus', '2', '--memory', '1g']);
  });

  it('ignores cpu: 0', () => {
    expect(buildResourceArgs({ cpu: 0 })).toEqual([]);
  });
});
