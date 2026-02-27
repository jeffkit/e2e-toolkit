import { describe, it, expect } from 'vitest';
import { BUILT_IN_PATTERNS } from '../../../src/knowledge/built-in-patterns.js';
import type { FailureCategory } from '../../../src/knowledge/types.js';

describe('BUILT_IN_PATTERNS', () => {
  it('contains exactly 6 patterns', () => {
    expect(BUILT_IN_PATTERNS.length).toBe(6);
  });

  it('all have source "built-in"', () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.source).toBe('built-in');
    }
  });

  it('each has required fields', () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.id).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.signature).toBeTruthy();
      expect(p.signaturePattern).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.suggestedFix).toBeTruthy();
      expect(typeof p.confidence).toBe('number');
      expect(typeof p.occurrences).toBe('number');
      expect(typeof p.resolutions).toBe('number');
    }
  });

  it('covers the required failure categories per FR-006', () => {
    const expectedCategories: FailureCategory[] = [
      'CONNECTION_REFUSED',
      'TIMEOUT',
      'CONTAINER_OOM',
      'HTTP_ERROR',
      'MOCK_MISMATCH',
      'ASSERTION_MISMATCH',
    ];

    const patternCategories = BUILT_IN_PATTERNS.map((p) => p.category);
    for (const cat of expectedCategories) {
      expect(patternCategories).toContain(cat);
    }
  });

  it('all have unique IDs', () => {
    const ids = BUILT_IN_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all have unique signatures', () => {
    const sigs = BUILT_IN_PATTERNS.map((p) => p.signature);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('all start with default confidence 0.5', () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.confidence).toBe(0.5);
    }
  });
});
