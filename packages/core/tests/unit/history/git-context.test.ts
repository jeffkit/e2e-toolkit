/**
 * Unit tests for getGitContext.
 * Tests: success, no-git, detached HEAD, empty repo scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import { getGitContext } from '../../../src/history/git-context.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(childProcess.execSync);

describe('getGitContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return commit and branch on success', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-parse HEAD')) return 'abc123def456\n';
      if (cmd.includes('--abbrev-ref HEAD')) return 'main\n';
      return '';
    });

    const result = getGitContext('/some/dir');
    expect(result.commit).toBe('abc123def456');
    expect(result.branch).toBe('main');
  });

  it('should return nulls when not in a git repo', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const result = getGitContext('/no-git');
    expect(result.commit).toBeNull();
    expect(result.branch).toBeNull();
  });

  it('should return null branch for detached HEAD', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-parse HEAD')) return 'abc123\n';
      if (cmd.includes('--abbrev-ref HEAD')) return 'HEAD\n';
      return '';
    });

    const result = getGitContext('/detached');
    expect(result.commit).toBe('abc123');
    expect(result.branch).toBeNull();
  });

  it('should return null branch when branch command fails', () => {
    let callCount = 0;
    mockedExecSync.mockImplementation((cmd: string) => {
      callCount++;
      if (cmd.includes('rev-parse HEAD')) return 'abc123\n';
      throw new Error('branch error');
    });

    const result = getGitContext('/partial');
    expect(result.commit).toBe('abc123');
    expect(result.branch).toBeNull();
  });

  it('should handle empty commit output', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-parse HEAD')) return '\n';
      if (cmd.includes('--abbrev-ref HEAD')) return 'main\n';
      return '';
    });

    const result = getGitContext('/empty');
    expect(result.commit).toBeNull();
    // Branch is still fetched even when commit is empty/null
    expect(result.branch).toBe('main');
  });
});
