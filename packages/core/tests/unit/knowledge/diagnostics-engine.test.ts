import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../src/history/migrations.js';
import { DiagnosticsEngine } from '../../../src/knowledge/diagnostics-engine.js';
import { createDefaultClassifier } from '../../../src/knowledge/classifier.js';
import { SQLiteKnowledgeStore } from '../../../src/knowledge/knowledge-store.js';
import type { FailureEvent, KnowledgeStore } from '../../../src/knowledge/types.js';

function makeEvent(overrides: Partial<FailureEvent> = {}): FailureEvent {
  return {
    runId: 'run-1',
    caseName: 'test-case',
    suiteId: 'suite-1',
    error: '',
    status: null,
    containerStatus: null,
    oomKilled: false,
    diagnostics: null,
    ...overrides,
  };
}

describe('DiagnosticsEngine', () => {
  let db: Database.Database;
  let store: SQLiteKnowledgeStore;
  let engine: DiagnosticsEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    store = new SQLiteKnowledgeStore(db);
    engine = new DiagnosticsEngine(createDefaultClassifier(), store);
  });

  afterEach(() => {
    db.close();
  });

  describe('diagnose', () => {
    it('classifies and matches built-in pattern via category fallback', () => {
      const event = makeEvent({
        error: 'connect ECONNREFUSED 127.0.0.1:3000',
      });
      const result = engine.diagnose(event);

      expect(result.category).toBe('CONNECTION_REFUSED');
      expect(result.pattern).not.toBeNull();
      expect(result.pattern!.source).toBe('built-in');
      expect(result.suggestedFix).toBeTruthy();
      expect(result.confidence).toBe(0.5);
      expect(result.isNewPattern).toBe(false);
    });

    it('returns fix history for matched pattern', () => {
      const pattern = store.findBySignature('builtin::CONNECTION_REFUSED')!;
      store.recordFix({
        patternId: pattern.id,
        runId: 'run-old',
        caseName: 'hc',
        fixDescription: 'Increased start period',
        success: true,
      });

      const result = engine.diagnose(
        makeEvent({ error: 'ECONNREFUSED 10.0.0.1:8080/health' }),
      );
      expect(result.fixHistory.length).toBe(1);
      expect(result.fixHistory[0]!.fixDescription).toBe('Increased start period');
    });

    it('creates new learned pattern for unknown failures', () => {
      const event = makeEvent({
        error: 'totally novel failure XYZ',
      });
      const result = engine.diagnose(event);

      expect(result.category).toBe('UNKNOWN');
      expect(result.isNewPattern).toBe(true);
      expect(result.pattern).not.toBeNull();
      expect(result.pattern!.source).toBe('learned');
      expect(result.suggestedFix).toBeNull();
      expect(result.confidence).toBeNull();
      expect(result.fixHistory).toEqual([]);
    });

    it('matches exact signature on second occurrence of same failure', () => {
      const event = makeEvent({ error: 'totally unique failure ABC' });
      const first = engine.diagnose(event);
      expect(first.isNewPattern).toBe(true);

      const second = engine.diagnose(event);
      expect(second.isNewPattern).toBe(false);
      expect(second.pattern).not.toBeNull();
      expect(second.pattern!.source).toBe('learned');
    });

    it('increments occurrences on built-in pattern match', () => {
      const event = makeEvent({ error: 'ECONNREFUSED 1.2.3.4:80/api' });
      engine.diagnose(event);

      const pattern = store.findBySignature('builtin::CONNECTION_REFUSED')!;
      expect(pattern.occurrences).toBe(1);
    });

    it('gracefully degrades on storage error', () => {
      const failingStore: KnowledgeStore = {
        findBySignature: () => { throw new Error('DB error'); },
        findByCategory: () => [],
        findBySource: () => [],
        getAllPatterns: () => [],
        createPattern: () => { throw new Error('DB error'); },
        incrementOccurrences: () => {},
        recordFix: () => { throw new Error('DB error'); },
        getFixHistory: () => [],
        updateConfidence: () => {},
        close: () => {},
      };

      const degradedEngine = new DiagnosticsEngine(createDefaultClassifier(), failingStore);
      const result = degradedEngine.diagnose(
        makeEvent({ error: 'ECONNREFUSED' }),
      );

      expect(result.category).toBe('CONNECTION_REFUSED');
      expect(result.pattern).toBeNull();
      expect(result.suggestedFix).toBeNull();
    });
  });

  describe('reportFix', () => {
    it('reports fix for known pattern and updates confidence', () => {
      const event = makeEvent({ error: 'ECONNREFUSED 127.0.0.1:3000/api' });

      // First diagnose to increment occurrences
      engine.diagnose(event);

      const result = engine.reportFix(event, 'Increased healthcheck.startPeriod', true);

      expect(result.category).toBe('CONNECTION_REFUSED');
      expect(result.patternId).toBe('builtin-conn-refused');
      expect(result.isNewPattern).toBe(false);
      expect(result.previousConfidence).toBe(0.5);
      expect(result.updatedConfidence).toBeGreaterThan(result.previousConfidence!);
      expect(result.fixRecordId).toBeTruthy();
    });

    it('creates new pattern when reporting fix for unknown failure', () => {
      const event = makeEvent({ error: 'brand new weird error QQQ' });
      const result = engine.reportFix(event, 'Fixed the thing', true);

      expect(result.isNewPattern).toBe(true);
      expect(result.previousConfidence).toBeNull();
      expect(result.fixRecordId).toBeTruthy();
    });

    it('does not increment resolutions on unsuccessful fix', () => {
      const event = makeEvent({ error: 'ECONNREFUSED' });
      engine.diagnose(event);

      const result = engine.reportFix(event, 'Tried something', false);

      expect(result.resolutions).toBe(0);
      expect(result.updatedConfidence).toBe(0.5);
    });

    it('confidence follows Laplace smoothing formula', () => {
      const event = makeEvent({ error: 'ECONNREFUSED 1.2.3.4:80/x' });

      // Create pattern with occurrences = 1
      engine.diagnose(event);

      // Report successful fix: occurrences=1, resolutions=1 → (1+1)/(1+2) = 0.667
      const result = engine.reportFix(event, 'Fix applied', true);

      const expectedConfidence = (0 + 1 + 1) / (1 + 2);
      expect(result.updatedConfidence).toBeCloseTo(expectedConfidence, 2);
    });
  });
});
