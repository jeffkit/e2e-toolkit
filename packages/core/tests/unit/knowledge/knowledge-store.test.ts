import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../src/history/migrations.js';
import { SQLiteKnowledgeStore, NoopKnowledgeStore } from '../../../src/knowledge/knowledge-store.js';
import type { FailurePattern } from '../../../src/knowledge/types.js';

describe('SQLiteKnowledgeStore', () => {
  let db: Database.Database;
  let store: SQLiteKnowledgeStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    store = new SQLiteKnowledgeStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('findBySignature', () => {
    it('returns built-in pattern by signature', () => {
      const pattern = store.findBySignature('builtin::CONNECTION_REFUSED');
      expect(pattern).not.toBeNull();
      expect(pattern!.category).toBe('CONNECTION_REFUSED');
      expect(pattern!.source).toBe('built-in');
    });

    it('returns null for unknown signature', () => {
      expect(store.findBySignature('nonexistent')).toBeNull();
    });
  });

  describe('findByCategory', () => {
    it('returns all patterns matching category', () => {
      const patterns = store.findByCategory('CONNECTION_REFUSED');
      expect(patterns.length).toBeGreaterThanOrEqual(1);
      expect(patterns[0]!.category).toBe('CONNECTION_REFUSED');
    });

    it('returns empty for unused category', () => {
      const patterns = store.findByCategory('UNKNOWN');
      expect(patterns).toEqual([]);
    });
  });

  describe('findBySource', () => {
    it('returns all built-in patterns', () => {
      const patterns = store.findBySource('built-in');
      expect(patterns.length).toBe(6);
      for (const p of patterns) {
        expect(p.source).toBe('built-in');
      }
    });

    it('returns empty for learned when none exist', () => {
      expect(store.findBySource('learned')).toEqual([]);
    });
  });

  describe('getAllPatterns', () => {
    it('returns all 6 built-in patterns', () => {
      const patterns = store.getAllPatterns();
      expect(patterns.length).toBe(6);
    });
  });

  describe('createPattern', () => {
    it('creates a new pattern with generated id and timestamps', () => {
      const now = new Date().toISOString();
      const created = store.createPattern({
        category: 'UNKNOWN',
        signature: 'test-sig',
        signaturePattern: 'UNKNOWN::test::some error',
        description: 'Test pattern',
        suggestedFix: '',
        confidence: 0.33,
        occurrences: 1,
        resolutions: 0,
        source: 'learned',
        firstSeenAt: now,
        lastSeenAt: now,
      });

      expect(created.id).toBeTruthy();
      expect(created.category).toBe('UNKNOWN');
      expect(created.createdAt).toBeTruthy();
      expect(created.updatedAt).toBeTruthy();

      const found = store.findBySignature('test-sig');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });
  });

  describe('incrementOccurrences', () => {
    it('increments occurrences and updates timestamps', () => {
      const before = store.findBySignature('builtin::CONNECTION_REFUSED')!;
      expect(before.occurrences).toBe(0);

      store.incrementOccurrences(before.id);

      const after = store.findBySignature('builtin::CONNECTION_REFUSED')!;
      expect(after.occurrences).toBe(1);
    });
  });

  describe('recordFix + getFixHistory', () => {
    it('records a fix and retrieves it', () => {
      const pattern = store.findBySignature('builtin::TIMEOUT')!;
      const fix = store.recordFix({
        patternId: pattern.id,
        runId: 'run-1',
        caseName: 'test-case',
        fixDescription: 'Increased timeout',
        success: true,
      });

      expect(fix.id).toBeTruthy();
      expect(fix.patternId).toBe(pattern.id);
      expect(fix.success).toBe(true);

      const history = store.getFixHistory(pattern.id);
      expect(history.length).toBe(1);
      expect(history[0]!.fixDescription).toBe('Increased timeout');
    });

    it('respects limit parameter', () => {
      const pattern = store.findBySignature('builtin::TIMEOUT')!;
      for (let i = 0; i < 15; i++) {
        store.recordFix({
          patternId: pattern.id,
          runId: `run-${i}`,
          caseName: 'test-case',
          fixDescription: `Fix ${i}`,
          success: true,
        });
      }

      const limited = store.getFixHistory(pattern.id, 5);
      expect(limited.length).toBe(5);
    });

    it('returns fix history in descending order', () => {
      const pattern = store.findBySignature('builtin::TIMEOUT')!;
      store.recordFix({ patternId: pattern.id, runId: 'run-a', caseName: 'c', fixDescription: 'first', success: true });
      store.recordFix({ patternId: pattern.id, runId: 'run-b', caseName: 'c', fixDescription: 'second', success: false });

      const history = store.getFixHistory(pattern.id);
      expect(history[0]!.fixDescription).toBe('second');
      expect(history[1]!.fixDescription).toBe('first');
    });
  });

  describe('updateConfidence', () => {
    it('updates confidence value', () => {
      const pattern = store.findBySignature('builtin::CONNECTION_REFUSED')!;
      expect(pattern.confidence).toBe(0.5);

      store.updateConfidence(pattern.id, 0.75);

      const updated = store.findBySignature('builtin::CONNECTION_REFUSED')!;
      expect(updated.confidence).toBe(0.75);
    });
  });

  describe('close', () => {
    it('does not throw on close (shared DB)', () => {
      expect(() => store.close()).not.toThrow();
    });
  });
});

describe('NoopKnowledgeStore', () => {
  const noop = new NoopKnowledgeStore();

  it('findBySignature returns null', () => {
    expect(noop.findBySignature('anything')).toBeNull();
  });

  it('findByCategory returns empty', () => {
    expect(noop.findByCategory('TIMEOUT')).toEqual([]);
  });

  it('findBySource returns empty', () => {
    expect(noop.findBySource('built-in')).toEqual([]);
  });

  it('getAllPatterns returns empty', () => {
    expect(noop.getAllPatterns()).toEqual([]);
  });

  it('createPattern returns empty-id pattern', () => {
    const result = noop.createPattern({
      category: 'UNKNOWN',
      signature: 'x',
      signaturePattern: 'y',
      description: '',
      suggestedFix: '',
      confidence: 0.5,
      occurrences: 0,
      resolutions: 0,
      source: 'learned',
      firstSeenAt: '',
      lastSeenAt: '',
    });
    expect(result.id).toBe('');
  });

  it('getFixHistory returns empty', () => {
    expect(noop.getFixHistory('any')).toEqual([]);
  });

  it('mutation methods do not throw', () => {
    expect(() => noop.incrementOccurrences('x')).not.toThrow();
    expect(() => noop.updateConfidence('x', 0.5)).not.toThrow();
    expect(() => noop.close()).not.toThrow();
  });
});
