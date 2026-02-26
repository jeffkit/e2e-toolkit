/**
 * Unit tests for openapi/recorder module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { computeSignature, RecordingStoreImpl } from '../../../src/openapi/recorder.js';
import type { RecordingEntry } from '../../../src/openapi/types.js';

describe('recorder', () => {
  describe('computeSignature', () => {
    it('should compute signature with method and path', () => {
      expect(computeSignature('GET', '/api/items', {})).toBe('GET:/api/items');
    });

    it('should sort query parameters', () => {
      expect(computeSignature('GET', '/api/items', { b: '2', a: '1' }))
        .toBe('GET:/api/items?a=1&b=2');
    });

    it('should uppercase the method', () => {
      expect(computeSignature('get', '/api/items', {})).toBe('GET:/api/items');
    });

    it('should handle empty query', () => {
      expect(computeSignature('POST', '/api/charge', {})).toBe('POST:/api/charge');
    });
  });

  describe('RecordingStoreImpl', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'argus-recorder-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    function makeEntry(overrides: Partial<RecordingEntry> = {}): RecordingEntry {
      return {
        request: {
          method: 'GET',
          path: '/api/items',
          query: {},
          headers: {},
        },
        response: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { ok: true },
        },
        timestamp: '2026-01-01T00:00:00Z',
        ...overrides,
      };
    }

    it('should save and find recording', () => {
      const store = new RecordingStoreImpl('test', tmpDir);
      const entry = makeEntry();
      store.save(entry);

      const sig = computeSignature('GET', '/api/items', {});
      expect(store.find(sig)).toBe(entry);
      expect(store.has(sig)).toBe(true);
    });

    it('should return undefined for unknown signature', () => {
      const store = new RecordingStoreImpl('test', tmpDir);
      expect(store.find('GET:/unknown')).toBeUndefined();
      expect(store.has('GET:/unknown')).toBe(false);
    });

    it('should return most recent recording on duplicates', () => {
      const store = new RecordingStoreImpl('test', tmpDir);
      const entry1 = makeEntry({ timestamp: '2026-01-01T00:00:00Z' });
      const entry2 = makeEntry({ timestamp: '2026-01-02T00:00:00Z' });
      store.save(entry1);
      store.save(entry2);

      const sig = computeSignature('GET', '/api/items', {});
      expect(store.find(sig)).toBe(entry2);
    });

    it('should flush to disk in correct JSON format', async () => {
      const store = new RecordingStoreImpl('test-mock', tmpDir, 'spec.yaml');
      store.save(makeEntry());
      await store.flush();

      const filePath = path.join(tmpDir, 'test-mock.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      const file = JSON.parse(raw) as { metadata: { mockName: string; version: number }; recordings: unknown[] };

      expect(file.metadata.mockName).toBe('test-mock');
      expect(file.metadata.version).toBe(1);
      expect(file.recordings).toHaveLength(1);
    });

    it('should load from disk', async () => {
      const store1 = new RecordingStoreImpl('test-mock', tmpDir);
      store1.save(makeEntry());
      store1.save(makeEntry({
        request: { method: 'POST', path: '/api/charge', query: {}, headers: {} },
        response: { status: 201, headers: {}, body: { charged: true } },
      }));
      await store1.flush();

      const store2 = new RecordingStoreImpl('test-mock', tmpDir);
      await store2.load();

      expect(store2.has(computeSignature('GET', '/api/items', {}))).toBe(true);
      expect(store2.has(computeSignature('POST', '/api/charge', {}))).toBe(true);
      expect(store2.has(computeSignature('DELETE', '/api/items', {}))).toBe(false);
    });

    it('should handle load from nonexistent file gracefully', async () => {
      const store = new RecordingStoreImpl('nonexistent', tmpDir);
      await store.load();
      expect(store.has('GET:/anything')).toBe(false);
    });
  });
});
