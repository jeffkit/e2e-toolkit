import { describe, it, expect } from 'vitest';
import {
  FailureClassifier,
  DEFAULT_RULES,
  createDefaultClassifier,
} from '../../../src/knowledge/classifier.js';
import type { FailureEvent, ClassificationRule } from '../../../src/knowledge/types.js';

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

describe('FailureClassifier', () => {
  const classifier = createDefaultClassifier();

  describe('CONTAINER_OOM', () => {
    it('classifies oomKilled=true', () => {
      expect(classifier.classify(makeEvent({ oomKilled: true }))).toBe('CONTAINER_OOM');
    });

    it('classifies error containing OOMKilled', () => {
      expect(classifier.classify(makeEvent({ error: 'Container OOMKilled by kernel' }))).toBe('CONTAINER_OOM');
    });
  });

  describe('CONTAINER_CRASH', () => {
    it('classifies containerStatus=exited', () => {
      expect(classifier.classify(makeEvent({ containerStatus: 'exited' }))).toBe('CONTAINER_CRASH');
    });

    it('classifies containerStatus=dead', () => {
      expect(classifier.classify(makeEvent({ containerStatus: 'dead' }))).toBe('CONTAINER_CRASH');
    });

    it('does not classify as crash when oomKilled is true', () => {
      expect(
        classifier.classify(makeEvent({ containerStatus: 'exited', oomKilled: true })),
      ).toBe('CONTAINER_OOM');
    });
  });

  describe('CONNECTION_REFUSED', () => {
    it('classifies ECONNREFUSED error', () => {
      expect(
        classifier.classify(makeEvent({ error: 'connect ECONNREFUSED 127.0.0.1:3000' })),
      ).toBe('CONNECTION_REFUSED');
    });
  });

  describe('TIMEOUT', () => {
    it('classifies ETIMEDOUT', () => {
      expect(classifier.classify(makeEvent({ error: 'ETIMEDOUT on request' }))).toBe('TIMEOUT');
    });

    it('classifies timeout keyword', () => {
      expect(classifier.classify(makeEvent({ error: 'Request timeout exceeded' }))).toBe('TIMEOUT');
    });

    it('classifies ESOCKETTIMEDOUT', () => {
      expect(classifier.classify(makeEvent({ error: 'ESOCKETTIMEDOUT' }))).toBe('TIMEOUT');
    });
  });

  describe('NETWORK_ERROR', () => {
    it('classifies ENOTFOUND', () => {
      expect(classifier.classify(makeEvent({ error: 'getaddrinfo ENOTFOUND api.example.com' }))).toBe('NETWORK_ERROR');
    });

    it('classifies EAI_AGAIN', () => {
      expect(classifier.classify(makeEvent({ error: 'EAI_AGAIN dns failure' }))).toBe('NETWORK_ERROR');
    });

    it('classifies ENETUNREACH', () => {
      expect(classifier.classify(makeEvent({ error: 'ENETUNREACH' }))).toBe('NETWORK_ERROR');
    });
  });

  describe('HTTP_ERROR', () => {
    it('classifies 5xx status', () => {
      expect(classifier.classify(makeEvent({ status: 500 }))).toBe('HTTP_ERROR');
      expect(classifier.classify(makeEvent({ status: 503 }))).toBe('HTTP_ERROR');
      expect(classifier.classify(makeEvent({ status: 599 }))).toBe('HTTP_ERROR');
    });

    it('classifies 4xx status', () => {
      expect(classifier.classify(makeEvent({ status: 400 }))).toBe('HTTP_ERROR');
      expect(classifier.classify(makeEvent({ status: 404 }))).toBe('HTTP_ERROR');
      expect(classifier.classify(makeEvent({ status: 499 }))).toBe('HTTP_ERROR');
    });
  });

  describe('MOCK_MISMATCH', () => {
    it('classifies mock + unexpected', () => {
      expect(
        classifier.classify(makeEvent({ error: 'Mock received unexpected request to /api/users' })),
      ).toBe('MOCK_MISMATCH');
    });

    it('classifies mock + unmatched', () => {
      expect(
        classifier.classify(makeEvent({ error: 'unmatched mock route: GET /api' })),
      ).toBe('MOCK_MISMATCH');
    });

    it('does not match mock alone', () => {
      expect(classifier.classify(makeEvent({ error: 'mock server started' }))).not.toBe('MOCK_MISMATCH');
    });
  });

  describe('CONFIG_ERROR', () => {
    it('classifies config keyword', () => {
      expect(classifier.classify(makeEvent({ error: 'config file not found' }))).toBe('CONFIG_ERROR');
    });

    it('classifies YAML keyword', () => {
      expect(classifier.classify(makeEvent({ error: 'YAML parse error at line 5' }))).toBe('CONFIG_ERROR');
    });

    it('classifies validation keyword', () => {
      expect(classifier.classify(makeEvent({ error: 'validation failed for field' }))).toBe('CONFIG_ERROR');
    });

    it('classifies schema keyword', () => {
      expect(classifier.classify(makeEvent({ error: 'schema mismatch in e2e.yaml' }))).toBe('CONFIG_ERROR');
    });
  });

  describe('ASSERTION_MISMATCH', () => {
    it('classifies "expected" keyword', () => {
      expect(classifier.classify(makeEvent({ error: 'expected 200 but got 404' }))).toBe('ASSERTION_MISMATCH');
    });

    it('classifies "to equal"', () => {
      expect(classifier.classify(makeEvent({ error: 'expected value to equal 42' }))).toBe('ASSERTION_MISMATCH');
    });

    it('classifies "to match"', () => {
      expect(classifier.classify(makeEvent({ error: 'expected body to match pattern' }))).toBe('ASSERTION_MISMATCH');
    });

    it('classifies AssertionError', () => {
      expect(classifier.classify(makeEvent({ error: 'AssertionError: values differ' }))).toBe('ASSERTION_MISMATCH');
    });
  });

  describe('UNKNOWN fallback', () => {
    it('returns UNKNOWN when no rule matches', () => {
      expect(classifier.classify(makeEvent({ error: 'something completely novel' }))).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for empty error', () => {
      expect(classifier.classify(makeEvent())).toBe('UNKNOWN');
    });
  });

  describe('priority (first match wins)', () => {
    it('timeout + connection refused → connection refused wins (higher priority)', () => {
      const event = makeEvent({
        error: 'ECONNREFUSED after ETIMEDOUT on retry',
      });
      expect(classifier.classify(event)).toBe('CONNECTION_REFUSED');
    });

    it('oom + container exited → OOM wins (highest priority)', () => {
      const event = makeEvent({
        oomKilled: true,
        containerStatus: 'exited',
      });
      expect(classifier.classify(event)).toBe('CONTAINER_OOM');
    });
  });

  describe('custom rules via constructor', () => {
    it('accepts custom rules in the chain', () => {
      const customRule: ClassificationRule = {
        name: 'custom-auth',
        category: 'HTTP_ERROR',
        match: (e) => e.error.includes('401 Unauthorized'),
      };

      const custom = new FailureClassifier([customRule, ...DEFAULT_RULES]);
      expect(custom.classify(makeEvent({ error: '401 Unauthorized' }))).toBe('HTTP_ERROR');
    });
  });
});
