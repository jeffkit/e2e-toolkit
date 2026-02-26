/**
 * @module resource-limiter
 * Resource isolation and concurrency control for multi-project parallel execution.
 *
 * Provides:
 * - Per-project resource limits (CPU, memory) applied to Docker containers
 * - Global concurrency semaphore to prevent host overload
 * - Project-level isolation so failures in one project don't cascade
 */

// =====================================================================
// Types
// =====================================================================

export interface ResourceLimits {
  /** CPU cores (e.g. 0.5 = half a core). 0 = no limit. */
  cpu?: number;
  /** Memory limit string (e.g. "512m", "1g"). Empty = no limit. */
  memory?: string;
  /** Max containers for this project. 0 = no limit. */
  maxContainers?: number;
}

export interface ProjectResourceState {
  project: string;
  limits: ResourceLimits;
  activeContainers: number;
}

// =====================================================================
// Semaphore — generic async concurrency limiter
// =====================================================================

export class Semaphore {
  private current = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    if (max < 1) throw new Error('Semaphore max must be >= 1');
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    if (this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      next();
    } else if (this.current > 0) {
      this.current--;
    }
  }

  get available(): number {
    return this.max - this.current;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  get capacity(): number {
    return this.max;
  }
}

// =====================================================================
// ResourceLimiter — project-aware resource management
// =====================================================================

export interface ResourceLimiterOptions {
  /** Max total concurrent containers across all projects. Default: 10. */
  globalMaxContainers?: number;
  /** Default limits applied to projects without explicit configuration. */
  defaultLimits?: ResourceLimits;
}

export class ResourceLimiter {
  private readonly globalSemaphore: Semaphore;
  private readonly projectLimits = new Map<string, ResourceLimits>();
  private readonly projectContainers = new Map<string, Set<string>>();
  private readonly defaultLimits: ResourceLimits;

  constructor(options?: ResourceLimiterOptions) {
    this.globalSemaphore = new Semaphore(options?.globalMaxContainers ?? 10);
    this.defaultLimits = options?.defaultLimits ?? {};
  }

  setProjectLimits(project: string, limits: ResourceLimits): void {
    this.projectLimits.set(project, limits);
  }

  getProjectLimits(project: string): ResourceLimits {
    return this.projectLimits.get(project) ?? this.defaultLimits;
  }

  /**
   * Request permission to start a container for a project.
   * Blocks until both global and project-level capacity is available.
   * Returns the resource limits to apply to the container.
   */
  async acquireContainer(project: string, containerName: string): Promise<ResourceLimits> {
    const limits = this.getProjectLimits(project);

    // Check project-level container limit
    if (limits.maxContainers && limits.maxContainers > 0) {
      const containers = this.projectContainers.get(project);
      if (containers && containers.size >= limits.maxContainers) {
        throw new Error(
          `Project "${project}" at container limit (${limits.maxContainers}). ` +
          `Active: ${[...containers].join(', ')}`,
        );
      }
    }

    // Acquire global semaphore
    await this.globalSemaphore.acquire();

    // Track the container
    if (!this.projectContainers.has(project)) {
      this.projectContainers.set(project, new Set());
    }
    this.projectContainers.get(project)!.add(containerName);

    return { cpu: limits.cpu, memory: limits.memory };
  }

  /** Release a container slot when the container stops. */
  releaseContainer(project: string, containerName: string): void {
    const containers = this.projectContainers.get(project);
    if (containers) {
      containers.delete(containerName);
      if (containers.size === 0) this.projectContainers.delete(project);
    }
    this.globalSemaphore.release();
  }

  /** Get current resource usage for a project. */
  getProjectState(project: string): ProjectResourceState {
    const containers = this.projectContainers.get(project);
    return {
      project,
      limits: this.getProjectLimits(project),
      activeContainers: containers?.size ?? 0,
    };
  }

  /** Get current resource usage for all projects. */
  getAllProjectStates(): ProjectResourceState[] {
    const projects = new Set([
      ...this.projectLimits.keys(),
      ...this.projectContainers.keys(),
    ]);
    return [...projects].map(p => this.getProjectState(p));
  }

  get globalAvailable(): number {
    return this.globalSemaphore.available;
  }

  get globalCapacity(): number {
    return this.globalSemaphore.capacity;
  }

  get globalWaiting(): number {
    return this.globalSemaphore.waiting;
  }
}

// =====================================================================
// Docker resource args builder
// =====================================================================

/**
 * Convert resource limits into Docker CLI arguments.
 * Appended to `docker run` commands.
 */
export function buildResourceArgs(limits: ResourceLimits): string[] {
  const args: string[] = [];
  if (limits.cpu && limits.cpu > 0) {
    args.push('--cpus', limits.cpu.toString());
  }
  if (limits.memory) {
    args.push('--memory', limits.memory);
  }
  return args;
}
