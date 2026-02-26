import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, FileStore, createStore, type Store, type TestRecord, type BuildRecord, type ActivityRecord } from '../../src/store.js';

// =====================================================================
// Helpers
// =====================================================================

function makeTestRecord(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    project: '/tmp/my-project',
    suite: 'login.yaml',
    status: 'passed',
    passed: 3,
    failed: 0,
    skipped: 0,
    duration: 1200,
    timestamp: Date.now(),
    source: 'ai',
    ...overrides,
  };
}

function makeBuildRecord(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    id: `build-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    project: '/tmp/my-project',
    image: 'my-app:latest',
    status: 'success',
    duration: 5000,
    timestamp: Date.now(),
    source: 'manual',
    ...overrides,
  };
}

function makeActivityRecord(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source: 'ai',
    operation: 'preflight_run',
    project: '/tmp/my-project',
    status: 'running',
    startTime: Date.now(),
    ...overrides,
  };
}

// =====================================================================
// Shared contract tests — run against every Store implementation
// =====================================================================

function storeContractTests(name: string, factory: () => { store: Store; cleanup: () => void }) {
  describe(`Store contract: ${name}`, () => {
    let store: Store;
    let cleanup: () => void;

    beforeEach(() => {
      const created = factory();
      store = created.store;
      cleanup = created.cleanup;
    });

    afterEach(async () => {
      await store.close();
      cleanup();
    });

    // ----- Test records -----

    it('saves and retrieves test records', async () => {
      const record = makeTestRecord();
      await store.saveTestRecord(record);
      const records = await store.getTestRecords(record.project);
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(record.id);
    });

    it('getTestRecord returns null for non-existent id', async () => {
      const result = await store.getTestRecord('nonexistent');
      expect(result).toBeNull();
    });

    it('getTestRecord returns specific record by id', async () => {
      const r1 = makeTestRecord({ id: 'tr-1' });
      const r2 = makeTestRecord({ id: 'tr-2' });
      await store.saveTestRecord(r1);
      await store.saveTestRecord(r2);
      const result = await store.getTestRecord('tr-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('tr-1');
    });

    it('filters test records by project', async () => {
      await store.saveTestRecord(makeTestRecord({ project: '/a' }));
      await store.saveTestRecord(makeTestRecord({ project: '/b' }));
      await store.saveTestRecord(makeTestRecord({ project: '/a' }));

      const aRecords = await store.getTestRecords('/a');
      expect(aRecords).toHaveLength(2);
      const bRecords = await store.getTestRecords('/b');
      expect(bRecords).toHaveLength(1);
    });

    it('respects limit parameter on test records', async () => {
      for (let i = 0; i < 10; i++) {
        await store.saveTestRecord(makeTestRecord());
      }
      const limited = await store.getTestRecords('/tmp/my-project', 3);
      expect(limited).toHaveLength(3);
    });

    it('returns newest test records first', async () => {
      await store.saveTestRecord(makeTestRecord({ id: 'old', timestamp: 1000 }));
      await store.saveTestRecord(makeTestRecord({ id: 'new', timestamp: 2000 }));
      const records = await store.getTestRecords('/tmp/my-project');
      expect(records[0].id).toBe('new');
    });

    // ----- Build records -----

    it('saves and retrieves build records', async () => {
      const record = makeBuildRecord();
      await store.saveBuildRecord(record);
      const records = await store.getBuildRecords(record.project);
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(record.id);
    });

    it('filters build records by project', async () => {
      await store.saveBuildRecord(makeBuildRecord({ project: '/x' }));
      await store.saveBuildRecord(makeBuildRecord({ project: '/y' }));
      expect(await store.getBuildRecords('/x')).toHaveLength(1);
      expect(await store.getBuildRecords('/y')).toHaveLength(1);
    });

    // ----- Activity records -----

    it('saves and retrieves activity records', async () => {
      const record = makeActivityRecord();
      await store.saveActivityRecord(record);
      const records = await store.getActivityRecords(record.project);
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(record.id);
    });

    it('getActivityRecords without project returns all', async () => {
      await store.saveActivityRecord(makeActivityRecord({ project: '/a' }));
      await store.saveActivityRecord(makeActivityRecord({ project: '/b' }));
      const all = await store.getActivityRecords();
      expect(all).toHaveLength(2);
    });

    it('updates activity record fields', async () => {
      const record = makeActivityRecord({ id: 'act-update', status: 'running' });
      await store.saveActivityRecord(record);
      await store.updateActivityRecord('act-update', { status: 'success', endTime: Date.now() });
      const records = await store.getActivityRecords(record.project);
      const updated = records.find(r => r.id === 'act-update');
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('success');
      expect(updated!.endTime).toBeDefined();
    });

    it('updateActivityRecord is no-op for nonexistent id', async () => {
      await expect(store.updateActivityRecord('nope', { status: 'failed' })).resolves.not.toThrow();
    });

    // ----- Aggregate stats -----

    it('getProjectStats returns correct aggregates', async () => {
      await store.saveTestRecord(makeTestRecord({ project: '/p', status: 'passed', duration: 100 }));
      await store.saveTestRecord(makeTestRecord({ project: '/p', status: 'failed', duration: 200 }));
      await store.saveBuildRecord(makeBuildRecord({ project: '/p' }));

      const stats = await store.getProjectStats('/p');
      expect(stats.totalTests).toBe(2);
      expect(stats.totalBuilds).toBe(1);
      expect(stats.passRate).toBe(0.5);
      expect(stats.avgTestDuration).toBe(150);
    });

    it('getProjectStats returns zeros for unknown project', async () => {
      const stats = await store.getProjectStats('/unknown');
      expect(stats.totalTests).toBe(0);
      expect(stats.totalBuilds).toBe(0);
      expect(stats.passRate).toBe(0);
      expect(stats.avgTestDuration).toBe(0);
      expect(stats.lastActivity).toBe(0);
    });
  });
}

// =====================================================================
// Run contract tests for each implementation
// =====================================================================

storeContractTests('MemoryStore', () => ({
  store: new MemoryStore(),
  cleanup: () => {},
}));

storeContractTests('FileStore', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-store-'));
  const filePath = path.join(tmpDir, 'store.json');
  return {
    store: new FileStore(filePath),
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
});

// =====================================================================
// MemoryStore-specific tests
// =====================================================================

describe('MemoryStore capacity limits', () => {
  it('caps test records at 1000', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 1050; i++) {
      await store.saveTestRecord(makeTestRecord({ id: `t-${i}` }));
    }
    const all = await store.getTestRecords('/tmp/my-project', 2000);
    expect(all.length).toBeLessThanOrEqual(1000);
  });
});

// =====================================================================
// FileStore-specific tests
// =====================================================================

describe('FileStore persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-filestore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists data across instances', async () => {
    const filePath = path.join(tmpDir, 'data.json');

    const store1 = new FileStore(filePath);
    await store1.saveTestRecord(makeTestRecord({ id: 'persist-1', project: '/p' }));
    await store1.close();

    const store2 = new FileStore(filePath);
    const records = await store2.getTestRecords('/p');
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('persist-1');
    await store2.close();
  });

  it('handles corrupted file gracefully', async () => {
    const filePath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(filePath, '{{invalid json}}}');

    const store = new FileStore(filePath);
    const records = await store.getTestRecords('/any');
    expect(records).toHaveLength(0);
    await store.close();
  });

  it('creates parent directories if needed', async () => {
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'store.json');
    const store = new FileStore(deepPath);
    await store.saveTestRecord(makeTestRecord({ id: 'deep' }));
    await store.close();
    expect(fs.existsSync(deepPath)).toBe(true);
  });
});

// =====================================================================
// createStore factory
// =====================================================================

describe('createStore factory', () => {
  it('defaults to MemoryStore', () => {
    const store = createStore();
    expect(store).toBeInstanceOf(MemoryStore);
  });

  it('creates FileStore when type is "file"', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-factory-'));
    try {
      const store = createStore({ type: 'file', filePath: path.join(tmpDir, 's.json') });
      expect(store).toBeInstanceOf(FileStore);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
