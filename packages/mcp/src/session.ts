/**
 * @module session
 * Per-project session state management for the MCP server.
 *
 * Tracks loaded configuration, running containers, mock servers,
 * and the overall lifecycle state for each project.
 *
 * Includes a per-session mutex to prevent concurrent MCP operations
 * on the same project (e.g. two clients calling build simultaneously).
 */

import type { E2EConfig } from '@preflight/core';

// =====================================================================
// Types
// =====================================================================

export type SessionState = 'initialized' | 'built' | 'running' | 'stopped';

export interface ProjectSession {
  projectPath: string;
  config: E2EConfig;
  configPath: string;
  containerIds: Map<string, string>;
  mockServers: Map<string, { server: { close(): Promise<void> }; port: number }>;
  networkName: string;
  createdAt: number;
  state: SessionState;
}

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  initialized: ['built', 'stopped'],
  built: ['running', 'stopped'],
  running: ['stopped'],
  stopped: ['initialized'],
};

// =====================================================================
// SessionMutex — prevents concurrent operations on the same project
// =====================================================================

class SessionMutex {
  private locks = new Map<string, { holder: string; acquired: number }>();
  private waitQueues = new Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>>();

  /**
   * Acquire an exclusive lock for a project. If already held, throws
   * INVALID_STATE immediately (non-blocking guard).
   */
  acquire(projectPath: string, operation: string): void {
    const existing = this.locks.get(projectPath);
    if (existing) {
      throw new SessionError(
        'INVALID_STATE',
        `Concurrent operation rejected: "${operation}" cannot run while "${existing.holder}" is in progress for project ${projectPath}`,
      );
    }
    this.locks.set(projectPath, { holder: operation, acquired: Date.now() });
  }

  /** Release the lock for a project. */
  release(projectPath: string): void {
    this.locks.delete(projectPath);
  }

  /** Check if a project currently has a held lock. */
  isLocked(projectPath: string): boolean {
    return this.locks.has(projectPath);
  }
}

// =====================================================================
// SessionManager
// =====================================================================

export class SessionManager {
  private sessions = new Map<string, ProjectSession>();
  private mutex = new SessionMutex();

  /**
   * Check whether a session exists for the given project path.
   */
  has(projectPath: string): boolean {
    return this.sessions.has(projectPath);
  }

  /**
   * Retrieve an existing session or throw SESSION_NOT_FOUND.
   */
  getOrThrow(projectPath: string): ProjectSession {
    const session = this.sessions.get(projectPath);
    if (!session) {
      throw new SessionError('SESSION_NOT_FOUND', `No active session for project: ${projectPath}`);
    }
    return session;
  }

  /**
   * Create a new session for a project. Throws SESSION_EXISTS if one already exists.
   */
  create(projectPath: string, config: E2EConfig, configPath: string): ProjectSession {
    if (this.sessions.has(projectPath)) {
      throw new SessionError('SESSION_EXISTS', `Session already exists for project: ${projectPath}`);
    }

    const networkName = config.network?.name ?? 'e2e-network';

    const session: ProjectSession = {
      projectPath,
      config,
      configPath,
      containerIds: new Map(),
      mockServers: new Map(),
      networkName,
      createdAt: Date.now(),
      state: 'initialized',
    };

    this.sessions.set(projectPath, session);
    return session;
  }

  /**
   * Remove a session and release any held lock.
   */
  remove(projectPath: string): void {
    this.mutex.release(projectPath);
    this.sessions.delete(projectPath);
  }

  /**
   * Transition a session to a new state, validating the state machine.
   */
  transition(projectPath: string, newState: SessionState): void {
    const session = this.getOrThrow(projectPath);
    const allowed = VALID_TRANSITIONS[session.state];
    if (!allowed.includes(newState)) {
      throw new SessionError(
        'INVALID_STATE',
        `Cannot transition from "${session.state}" to "${newState}"`,
      );
    }
    session.state = newState;
  }

  /**
   * Acquire an exclusive operation lock for a project.
   * Prevents concurrent MCP clients from running operations simultaneously.
   *
   * @throws {SessionError} with code INVALID_STATE if another operation is in progress
   */
  acquireLock(projectPath: string, operation: string): void {
    this.mutex.acquire(projectPath, operation);
  }

  /**
   * Release the operation lock for a project.
   */
  releaseLock(projectPath: string): void {
    this.mutex.release(projectPath);
  }

  /**
   * Check if a project session is currently locked by an operation.
   */
  isLocked(projectPath: string): boolean {
    return this.mutex.isLocked(projectPath);
  }
}

// =====================================================================
// Error Type
// =====================================================================

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}
