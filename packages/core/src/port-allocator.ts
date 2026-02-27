/**
 * @module port-allocator
 * Process-level port registry for multi-project isolation.
 *
 * Prevents port collisions when multiple ArgusAI projects start up
 * concurrently in the same process (e.g., multiple MCP clients).
 *
 * The allocator is a module-level singleton — all sessions share one registry.
 * Ports are "claimed" when a session starts setup and "released" on teardown.
 */

import { isPortInUse } from './docker-engine.js';

// =====================================================================
// Types
// =====================================================================

export interface PortClaim {
  port: number;
  project: string;
  sessionId: string;
  claimedAt: number;
}

export interface PortAllocatorOptions {
  /** Inclusive lower bound of the allocation range (default: 9000). */
  rangeStart?: number;
  /** Inclusive upper bound of the allocation range (default: 9999). */
  rangeEnd?: number;
}

// =====================================================================
// PortAllocator
// =====================================================================

/**
 * Process-wide singleton port registry.
 *
 * When PortResolver resolves service ports it should check `PortAllocator`
 * first so two concurrently-starting projects don't race to claim the
 * same free port.
 *
 * Usage:
 *   const port = await PortAllocator.instance.allocate(9000, 'my-project', 'session-abc');
 *   // ... use the port ...
 *   PortAllocator.instance.release(port, 'session-abc');
 */
export class PortAllocator {
  private static _instance: PortAllocator | undefined;

  /** Access the process-level singleton. */
  static get instance(): PortAllocator {
    if (!PortAllocator._instance) {
      PortAllocator._instance = new PortAllocator();
    }
    return PortAllocator._instance;
  }

  /** Replace the singleton (useful in tests). */
  static reset(instance?: PortAllocator): void {
    PortAllocator._instance = instance;
  }

  private readonly claims = new Map<number, PortClaim>();
  private readonly rangeStart: number;
  private readonly rangeEnd: number;

  constructor(options?: PortAllocatorOptions) {
    this.rangeStart = options?.rangeStart ?? 9000;
    this.rangeEnd = options?.rangeEnd ?? 9999;
  }

  /**
   * Claim a specific port for a project/session.
   * Returns `true` if the claim was successful (port was free in the registry),
   * `false` if it was already claimed by another session.
   *
   * Note: this only checks the in-process registry. The caller must still
   * perform an OS-level check via `isPortInUse` if needed.
   */
  claim(port: number, project: string, sessionId: string): boolean {
    const existing = this.claims.get(port);
    if (existing && existing.sessionId !== sessionId) {
      return false;
    }
    this.claims.set(port, { port, project, sessionId, claimedAt: Date.now() });
    return true;
  }

  /**
   * Release all ports claimed by a specific session.
   * Call this during `argus_clean` / session teardown.
   */
  releaseSession(sessionId: string): void {
    for (const [port, claim] of this.claims) {
      if (claim.sessionId === sessionId) {
        this.claims.delete(port);
      }
    }
  }

  /**
   * Release a single port claimed by a session.
   */
  release(port: number, sessionId: string): void {
    const claim = this.claims.get(port);
    if (claim?.sessionId === sessionId) {
      this.claims.delete(port);
    }
  }

  /**
   * Check whether a port is claimed (in the in-process registry).
   */
  isClaimed(port: number): boolean {
    return this.claims.has(port);
  }

  /**
   * Return the claim for a port, or undefined if unclaimed.
   */
  getClaim(port: number): PortClaim | undefined {
    return this.claims.get(port);
  }

  /**
   * Find and claim the next available port starting from `preferred`.
   *
   * The search order is:
   * 1. Start at `preferred` (or `rangeStart` if preferred is outside the range).
   * 2. Walk forward wrapping at `rangeEnd`.
   * 3. For each candidate: check in-process registry first, then OS-level.
   *
   * Returns `null` when no free port can be found in the full range.
   */
  async allocate(
    preferred: number,
    project: string,
    sessionId: string,
  ): Promise<number | null> {
    const start = Math.max(preferred, this.rangeStart);
    const total = this.rangeEnd - this.rangeStart + 1;

    for (let i = 0; i < total; i++) {
      const port = this.rangeStart + ((start - this.rangeStart + i) % total);

      // Skip ports already claimed in-process
      if (this.isClaimed(port)) continue;

      // Skip ports already in use at the OS level
      try {
        if (await isPortInUse(port)) continue;
      } catch {
        continue;
      }

      // Claim it
      if (this.claim(port, project, sessionId)) {
        return port;
      }
    }

    return null;
  }

  /**
   * Return all active claims, grouped by project.
   */
  getAllClaims(): Map<string, PortClaim[]> {
    const byProject = new Map<string, PortClaim[]>();
    for (const claim of this.claims.values()) {
      const list = byProject.get(claim.project) ?? [];
      list.push(claim);
      byProject.set(claim.project, list);
    }
    return byProject;
  }

  /**
   * Return all claims for a specific project.
   */
  getProjectClaims(project: string): PortClaim[] {
    return [...this.claims.values()].filter(c => c.project === project);
  }

  /** Total number of currently claimed ports. */
  get claimedCount(): number {
    return this.claims.size;
  }
}
