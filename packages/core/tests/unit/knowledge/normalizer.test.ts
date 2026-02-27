import { describe, it, expect } from 'vitest';
import { normalizeError, generateSignature } from '../../../src/knowledge/normalizer.js';

describe('normalizeError', () => {
  it('replaces UUIDs', () => {
    expect(normalizeError('Error for id a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toContain('<UUID>');
  });

  it('replaces ISO timestamps', () => {
    expect(normalizeError('Failed at 2026-02-26T10:30:00Z')).toContain('<TIMESTAMP>');
    expect(normalizeError('At 2026-02-26T10:30:00.123Z')).toContain('<TIMESTAMP>');
  });

  it('replaces IP addresses', () => {
    expect(normalizeError('connect to 192.168.1.1')).toContain('<IP>');
    expect(normalizeError('ECONNREFUSED 127.0.0.1')).toContain('<IP>');
  });

  it('replaces port numbers in context', () => {
    const result = normalizeError('ECONNREFUSED <IP>:3000/api');
    expect(result).toContain(':<PORT>');
  });

  it('replaces hex hashes in paths', () => {
    expect(normalizeError('path /a1b2c3d4e5f6/ not found')).toContain('/<HASH>/');
  });

  it('replaces HTTP status codes as class level', () => {
    expect(normalizeError('returned 500 error')).toContain('5xx');
    expect(normalizeError('got 404 not found')).toContain('4xx');
  });

  it('replaces path segments with numeric IDs', () => {
    expect(normalizeError('GET /api/123')).toContain('/api/<ID>');
  });

  it('replaces standalone large numbers', () => {
    expect(normalizeError('error code 123456')).toContain('<NUM>');
  });

  it('handles complex combined error strings', () => {
    const complex =
      'ECONNREFUSED 192.168.1.100:3000/api/users/42 at 2026-02-26T12:00:00Z request a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const result = normalizeError(complex);
    expect(result).toContain('<IP>');
    expect(result).toContain(':<PORT>');
    expect(result).toContain('<UUID>');
    expect(result).toContain('<TIMESTAMP>');
  });

  it('leaves non-matching text unchanged', () => {
    expect(normalizeError('simple error message')).toBe('simple error message');
  });
});

describe('generateSignature', () => {
  it('produces deterministic output for same input', () => {
    const a = generateSignature('CONNECTION_REFUSED', 'health-check', 'ECONNREFUSED 127.0.0.1:3000');
    const b = generateSignature('CONNECTION_REFUSED', 'health-check', 'ECONNREFUSED 127.0.0.1:3000');
    expect(a.signature).toBe(b.signature);
    expect(a.signaturePattern).toBe(b.signaturePattern);
  });

  it('produces different hashes for different inputs', () => {
    const a = generateSignature('CONNECTION_REFUSED', 'health-check', 'ECONNREFUSED');
    const b = generateSignature('TIMEOUT', 'health-check', 'ETIMEDOUT');
    expect(a.signature).not.toBe(b.signature);
  });

  it('returns a 64-char hex hash', () => {
    const { signature } = generateSignature('UNKNOWN', 'test', 'error');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes category::caseName::normalizedError in signaturePattern', () => {
    const { signaturePattern } = generateSignature('TIMEOUT', 'api-test', 'request timeout');
    expect(signaturePattern).toBe('TIMEOUT::api-test::request timeout');
  });

  it('normalizes dynamic values in signaturePattern', () => {
    const { signaturePattern } = generateSignature(
      'CONNECTION_REFUSED',
      'health-check',
      'ECONNREFUSED 192.168.1.1:3000/api',
    );
    expect(signaturePattern).toContain('<IP>');
    expect(signaturePattern).toContain(':<PORT>');
  });

  it('same failure on different IPs produces same signature', () => {
    const a = generateSignature('CONNECTION_REFUSED', 'hc', 'ECONNREFUSED 10.0.0.1:3000/api');
    const b = generateSignature('CONNECTION_REFUSED', 'hc', 'ECONNREFUSED 192.168.1.1:3000/api');
    expect(a.signature).toBe(b.signature);
  });
});
