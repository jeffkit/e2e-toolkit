/**
 * @module store
 * Abstract persistence layer for test history, build records, and activity logs.
 *
 * Two implementations:
 * - MemoryStore: in-memory (default, zero-config, suitable for local/test)
 * - FileStore: JSON file-based (persistent across restarts, no native deps)
 *
 * The interface is designed to be swappable for SQLite/PostgreSQL in production.
 */

import fs from 'node:fs';
import path from 'node:path';

// =====================================================================
// Record Types
// =====================================================================

export interface TestRecord {
  id: string;
  project: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  timestamp: number;
  source: 'ai' | 'manual' | 'ci';
  error?: string;
}

export interface BuildRecord {
  id: string;
  project: string;
  image: string;
  status: 'success' | 'failed';
  duration: number;
  timestamp: number;
  source: 'ai' | 'manual' | 'ci';
  error?: string;
}

export interface ActivityRecord {
  id: string;
  source: 'ai' | 'manual' | 'system';
  operation: string;
  project: string;
  status: 'running' | 'success' | 'failed';
  startTime: number;
  endTime?: number;
  detail?: string;
}

// =====================================================================
// Store Interface
// =====================================================================

export interface Store {
  // Test records
  saveTestRecord(record: TestRecord): Promise<void>;
  getTestRecords(project: string, limit?: number): Promise<TestRecord[]>;
  getTestRecord(id: string): Promise<TestRecord | null>;

  // Build records
  saveBuildRecord(record: BuildRecord): Promise<void>;
  getBuildRecords(project: string, limit?: number): Promise<BuildRecord[]>;

  // Activity records
  saveActivityRecord(record: ActivityRecord): Promise<void>;
  getActivityRecords(project?: string, limit?: number): Promise<ActivityRecord[]>;
  updateActivityRecord(id: string, patch: Partial<ActivityRecord>): Promise<void>;

  // Aggregate queries
  getProjectStats(project: string): Promise<{
    totalTests: number;
    totalBuilds: number;
    passRate: number;
    avgTestDuration: number;
    lastActivity: number;
  }>;

  // Lifecycle
  close(): Promise<void>;
}

// =====================================================================
// MemoryStore — default, no persistence
// =====================================================================

export class MemoryStore implements Store {
  private tests: TestRecord[] = [];
  private builds: BuildRecord[] = [];
  private activities: ActivityRecord[] = [];

  async saveTestRecord(record: TestRecord): Promise<void> {
    this.tests.unshift(record);
    if (this.tests.length > 1000) this.tests.length = 1000;
  }

  async getTestRecords(project: string, limit = 50): Promise<TestRecord[]> {
    return this.tests.filter(r => r.project === project).slice(0, limit);
  }

  async getTestRecord(id: string): Promise<TestRecord | null> {
    return this.tests.find(r => r.id === id) ?? null;
  }

  async saveBuildRecord(record: BuildRecord): Promise<void> {
    this.builds.unshift(record);
    if (this.builds.length > 500) this.builds.length = 500;
  }

  async getBuildRecords(project: string, limit = 50): Promise<BuildRecord[]> {
    return this.builds.filter(r => r.project === project).slice(0, limit);
  }

  async saveActivityRecord(record: ActivityRecord): Promise<void> {
    this.activities.unshift(record);
    if (this.activities.length > 2000) this.activities.length = 2000;
  }

  async getActivityRecords(project?: string, limit = 100): Promise<ActivityRecord[]> {
    const filtered = project
      ? this.activities.filter(r => r.project === project)
      : this.activities;
    return filtered.slice(0, limit);
  }

  async updateActivityRecord(id: string, patch: Partial<ActivityRecord>): Promise<void> {
    const entry = this.activities.find(r => r.id === id);
    if (entry) Object.assign(entry, patch);
  }

  async getProjectStats(project: string): Promise<{
    totalTests: number;
    totalBuilds: number;
    passRate: number;
    avgTestDuration: number;
    lastActivity: number;
  }> {
    const tests = this.tests.filter(r => r.project === project);
    const builds = this.builds.filter(r => r.project === project);
    const passed = tests.filter(r => r.status === 'passed').length;
    const totalDuration = tests.reduce((s, r) => s + r.duration, 0);
    const latestTest = tests[0]?.timestamp ?? 0;
    const latestBuild = builds[0]?.timestamp ?? 0;

    return {
      totalTests: tests.length,
      totalBuilds: builds.length,
      passRate: tests.length > 0 ? passed / tests.length : 0,
      avgTestDuration: tests.length > 0 ? totalDuration / tests.length : 0,
      lastActivity: Math.max(latestTest, latestBuild),
    };
  }

  async close(): Promise<void> {
    // no-op
  }
}

// =====================================================================
// FileStore — JSON file-based persistence (local mode)
// =====================================================================

interface FileStoreData {
  tests: TestRecord[];
  builds: BuildRecord[];
  activities: ActivityRecord[];
}

export class FileStore implements Store {
  private data: FileStoreData;
  private dirty = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = this.load();
  }

  private load(): FileStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw) as FileStoreData;
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { tests: [], builds: [], activities: [] };
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushSync();
      this.flushTimer = undefined;
    }, 1000);
  }

  private flushSync(): void {
    if (!this.dirty) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    this.dirty = false;
  }

  async saveTestRecord(record: TestRecord): Promise<void> {
    this.data.tests.unshift(record);
    if (this.data.tests.length > 1000) this.data.tests.length = 1000;
    this.scheduleFlush();
  }

  async getTestRecords(project: string, limit = 50): Promise<TestRecord[]> {
    return this.data.tests.filter(r => r.project === project).slice(0, limit);
  }

  async getTestRecord(id: string): Promise<TestRecord | null> {
    return this.data.tests.find(r => r.id === id) ?? null;
  }

  async saveBuildRecord(record: BuildRecord): Promise<void> {
    this.data.builds.unshift(record);
    if (this.data.builds.length > 500) this.data.builds.length = 500;
    this.scheduleFlush();
  }

  async getBuildRecords(project: string, limit = 50): Promise<BuildRecord[]> {
    return this.data.builds.filter(r => r.project === project).slice(0, limit);
  }

  async saveActivityRecord(record: ActivityRecord): Promise<void> {
    this.data.activities.unshift(record);
    if (this.data.activities.length > 2000) this.data.activities.length = 2000;
    this.scheduleFlush();
  }

  async getActivityRecords(project?: string, limit = 100): Promise<ActivityRecord[]> {
    const filtered = project
      ? this.data.activities.filter(r => r.project === project)
      : this.data.activities;
    return filtered.slice(0, limit);
  }

  async updateActivityRecord(id: string, patch: Partial<ActivityRecord>): Promise<void> {
    const entry = this.data.activities.find(r => r.id === id);
    if (entry) {
      Object.assign(entry, patch);
      this.scheduleFlush();
    }
  }

  async getProjectStats(project: string): Promise<{
    totalTests: number;
    totalBuilds: number;
    passRate: number;
    avgTestDuration: number;
    lastActivity: number;
  }> {
    const tests = this.data.tests.filter(r => r.project === project);
    const builds = this.data.builds.filter(r => r.project === project);
    const passed = tests.filter(r => r.status === 'passed').length;
    const totalDuration = tests.reduce((s, r) => s + r.duration, 0);
    const latestTest = tests[0]?.timestamp ?? 0;
    const latestBuild = builds[0]?.timestamp ?? 0;

    return {
      totalTests: tests.length,
      totalBuilds: builds.length,
      passRate: tests.length > 0 ? passed / tests.length : 0,
      avgTestDuration: tests.length > 0 ? totalDuration / tests.length : 0,
      lastActivity: Math.max(latestTest, latestBuild),
    };
  }

  async close(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushSync();
  }
}

// =====================================================================
// Factory
// =====================================================================

export interface StoreOptions {
  type?: 'memory' | 'file';
  /** File path for FileStore (default: .argusai/store.json in cwd) */
  filePath?: string;
}

export function createStore(options?: StoreOptions): Store {
  const type = options?.type ?? 'memory';
  if (type === 'file') {
    const filePath = options?.filePath ?? path.join(process.cwd(), '.argusai', 'store.json');
    return new FileStore(filePath);
  }
  return new MemoryStore();
}
