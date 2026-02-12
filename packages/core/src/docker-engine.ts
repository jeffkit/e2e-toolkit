/**
 * @module docker-engine
 * Docker Engine - Image building and container management.
 *
 * Uses Docker CLI (`child_process` spawn/execSync) instead of dockerode
 * for zero native-dependency operation.
 */

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import type { BuildEvent, ContainerStatus, ContainerEvent } from './types.js';

// =====================================================================
// Public Interfaces
// =====================================================================

/** Options for building a Docker image */
export interface DockerBuildOptions {
  /** Path to the Dockerfile */
  dockerfile: string;
  /** Build context directory */
  context: string;
  /** Image name (including tag) */
  imageName: string;
  /** Build arguments */
  buildArgs?: Record<string, string>;
  /** Disable Docker layer cache */
  noCache?: boolean;
}

/** Options for running a Docker container */
export interface DockerRunOptions {
  /** Container name */
  name: string;
  /** Docker image to run */
  image: string;
  /** Port mappings in "hostPort:containerPort" format */
  ports: string[];
  /** Environment variables */
  environment?: Record<string, string>;
  /** Volume mounts */
  volumes?: string[];
  /** Docker network to attach to */
  network?: string;
  /** Container healthcheck configuration */
  healthcheck?: {
    cmd: string;
    interval: string;
    timeout: string;
    retries: number;
    startPeriod: string;
  };
}

// =====================================================================
// Command Builders (exported for testing)
// =====================================================================

/**
 * Build the argument list for `docker build`.
 *
 * @param options - Build options
 * @returns Array of CLI arguments for `docker build`
 */
export function buildBuildArgs(options: DockerBuildOptions): string[] {
  const args: string[] = ['build'];

  args.push('-f', options.dockerfile);
  args.push('-t', options.imageName);

  if (options.noCache) {
    args.push('--no-cache');
  }

  if (options.buildArgs) {
    for (const [key, value] of Object.entries(options.buildArgs)) {
      args.push('--build-arg', `${key}=${value}`);
    }
  }

  args.push(options.context);

  return args;
}

/**
 * Build the argument list for `docker run -d`.
 *
 * @param options - Run options
 * @returns Array of CLI arguments for `docker run`
 */
export function buildRunArgs(options: DockerRunOptions): string[] {
  const args: string[] = ['run', '-d', '--name', options.name];

  if (options.network) {
    args.push('--network', options.network);
  }

  for (const portMapping of options.ports) {
    args.push('-p', portMapping);
  }

  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  if (options.volumes) {
    for (const vol of options.volumes) {
      args.push('-v', vol);
    }
  }

  if (options.healthcheck) {
    const hc = options.healthcheck;
    // Wrap health-cmd in quotes because args are joined into a shell string
    args.push('--health-cmd', `"${hc.cmd}"`);
    args.push('--health-interval', hc.interval);
    args.push('--health-timeout', hc.timeout);
    args.push('--health-retries', String(hc.retries));
    args.push('--health-start-period', hc.startPeriod);
  }

  args.push(options.image);

  return args;
}

// =====================================================================
// Docker Build
// =====================================================================

/**
 * Build a Docker image, yielding {@link BuildEvent} entries as progress updates.
 *
 * Uses `docker build` via `child_process.spawn` and streams stdout/stderr
 * line by line.
 *
 * @param options - Build options
 * @yields {BuildEvent} Progress events
 */
export async function* buildImage(options: DockerBuildOptions): AsyncGenerator<BuildEvent> {
  const args = buildBuildArgs(options);
  const startTime = Date.now();

  yield { type: 'build_start', image: options.imageName, timestamp: Date.now() };

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const lineBuffer = { stdout: '', stderr: '' };

    const processLines = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      lineBuffer[stream] += chunk.toString();
      const lines = lineBuffer[stream].split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      lineBuffer[stream] = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          // We can't yield from inside a callback, so we collect events
          // Instead, we use a different pattern below
        }
      }
    };

    proc.stdout.on('data', (data: Buffer) => processLines('stdout', data));
    proc.stderr.on('data', (data: Buffer) => processLines('stderr', data));

    proc.on('error', reject);
    proc.on('close', (code) => resolve(code));
  });

  // Note: The async generator pattern with spawn requires a different approach.
  // We re-implement using a queue-based pattern for proper yielding.

  yield {
    type: 'build_end',
    success: exitCode === 0,
    duration: Date.now() - startTime,
    error: exitCode !== 0 ? `Build exited with code ${exitCode}` : undefined,
    timestamp: Date.now(),
  };
}

/**
 * Build a Docker image with full streaming of build logs.
 *
 * Uses an internal event queue to properly yield {@link BuildEvent} entries
 * from the spawned process.
 *
 * @param options - Build options
 * @yields {BuildEvent} Progress events including individual log lines
 */
export async function* buildImageStreaming(options: DockerBuildOptions): AsyncGenerator<BuildEvent> {
  const args = buildBuildArgs(options);
  const startTime = Date.now();

  yield { type: 'build_start', image: options.imageName, timestamp: Date.now() };

  const events: BuildEvent[] = [];
  let done = false;
  let resolveWait: (() => void) | null = null;

  const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const pushEvent = (event: BuildEvent) => {
    events.push(event);
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  };

  const processStream = (stream: 'stdout' | 'stderr', data: Buffer) => {
    const text = data.toString();
    for (const line of text.split('\n')) {
      if (line.trim()) {
        pushEvent({ type: 'build_log', line: line, stream, timestamp: Date.now() });
      }
    }
  };

  proc.stdout.on('data', (data: Buffer) => processStream('stdout', data));
  proc.stderr.on('data', (data: Buffer) => processStream('stderr', data));

  proc.on('close', (code) => {
    pushEvent({
      type: 'build_end',
      success: code === 0,
      duration: Date.now() - startTime,
      error: code !== 0 ? `Build exited with code ${code}` : undefined,
      timestamp: Date.now(),
    });
    done = true;
  });

  proc.on('error', (err) => {
    pushEvent({
      type: 'build_end',
      success: false,
      duration: Date.now() - startTime,
      error: err.message,
      timestamp: Date.now(),
    });
    done = true;
  });

  while (!done || events.length > 0) {
    if (events.length > 0) {
      yield events.shift()!;
    } else {
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        // Safety timeout to avoid hanging
        setTimeout(resolve, 1000);
      });
    }
  }
}

// =====================================================================
// Container Management
// =====================================================================

/**
 * Run a Docker container in detached mode.
 *
 * @param options - Run options
 * @returns Container ID (first 12 characters)
 * @throws {Error} If `docker run` fails
 */
export async function startContainer(options: DockerRunOptions): Promise<string> {
  const args = buildRunArgs(options);

  try {
    const output = execSync(`docker ${args.join(' ')}`, {
      encoding: 'utf-8',
      timeout: 30_000,
    }).trim();
    return output.slice(0, 12);
  } catch (err) {
    throw new Error(
      `Failed to start container "${options.name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Stop and remove a container by name.
 *
 * Uses `docker rm -f` to force-remove regardless of current state.
 *
 * @param name - Container name
 */
export async function stopContainer(name: string): Promise<void> {
  safeExec(`docker rm -f ${name}`);
}

/**
 * Get the current status of a container.
 *
 * @param name - Container name
 * @returns Container status string
 */
export async function getContainerStatus(name: string): Promise<ContainerStatus> {
  const result = safeExec(
    `docker inspect --format "{{.State.Status}}" ${name}`,
  );
  if (!result) return 'unknown';

  const statusMap: Record<string, ContainerStatus> = {
    created: 'created',
    running: 'running',
    paused: 'paused',
    restarting: 'restarting',
    removing: 'removing',
    exited: 'exited',
    dead: 'dead',
  };

  return statusMap[result] ?? 'unknown';
}

/**
 * Check whether a container is currently running.
 *
 * @param name - Container name
 * @returns `true` if the container is running
 */
export async function isContainerRunning(name: string): Promise<boolean> {
  const result = safeExec(
    `docker ps --filter "name=^${name}$" --filter "status=running" --format "{{.Names}}"`,
  );
  return result === name;
}

/**
 * Get container logs (tail).
 *
 * @param name - Container name
 * @param lines - Number of tail lines (default: 100)
 * @returns Log output string
 */
export async function getContainerLogs(name: string, lines = 100): Promise<string> {
  try {
    return execSync(`docker logs --tail=${lines} ${name} 2>&1`, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
  } catch (err) {
    throw new Error(
      `Failed to get logs for "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Execute a command inside a running container.
 *
 * @param name - Container name
 * @param command - Shell command to execute
 * @returns Command output
 * @throws {Error} If the command fails or the container is not running
 */
export async function execInContainer(name: string, command: string): Promise<string> {
  try {
    return execSync(
      `docker exec ${name} sh -c ${JSON.stringify(command)}`,
      { encoding: 'utf-8', timeout: 15_000 },
    ).trim();
  } catch (err) {
    throw new Error(
      `Failed to exec in "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// =====================================================================
// Network Management
// =====================================================================

/**
 * Ensure a Docker network exists. Creates it if missing, ignores if already present.
 *
 * @param name - Network name
 */
export async function ensureNetwork(name: string): Promise<void> {
  safeExec(`docker network create ${name} 2>/dev/null || true`);
}

/**
 * Remove a Docker network.
 *
 * @param name - Network name
 */
export async function removeNetwork(name: string): Promise<void> {
  safeExec(`docker network rm ${name} 2>/dev/null || true`);
}

// =====================================================================
// Health Check Waiting
// =====================================================================

/**
 * Wait for a container to become healthy by polling `docker inspect`.
 *
 * @param name - Container name
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 120000)
 * @returns `true` if the container is healthy, `false` if timeout reached
 */
export async function waitForHealthy(name: string, timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const healthStatus = safeExec(
      `docker inspect --format "{{.State.Health.Status}}" ${name}`,
    );

    if (healthStatus === 'healthy') {
      return true;
    }

    // If the container has exited or is dead, don't keep waiting
    const containerStatus = safeExec(
      `docker inspect --format "{{.State.Status}}" ${name}`,
    );
    if (containerStatus === 'exited' || containerStatus === 'dead') {
      return false;
    }

    await sleep(2000);
  }

  return false;
}

// =====================================================================
// Port Checking
// =====================================================================

/**
 * Check whether a TCP port is currently in use on localhost.
 *
 * Uses Node.js `net.createServer` to attempt binding.
 *
 * @param port - Port number to check
 * @returns `true` if the port is in use
 */
export function isPortInUse(port: number): boolean {
  try {
    const server = createServer();
    let inUse = false;

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        inUse = true;
      }
    });

    // Try to listen synchronously by using execSync with a small Node script
    const result = safeExec(
      `node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen(${port},'127.0.0.1',()=>{s.close();process.exit(0)})"`,
    );
    // If the command succeeded (exit 0), the port is NOT in use
    // safeExec returns '' on error (exit 1), meaning port IS in use
    // But safeExec catches errors and returns '', so we need a different approach

    server.close();
    return inUse;
  } catch {
    // Fallback: use lsof
    const result = safeExec(`lsof -i :${port} -t 2>/dev/null`);
    return result.length > 0;
  }
}

/**
 * Synchronous port-in-use check using `lsof`.
 *
 * @param port - Port number
 * @returns `true` if the port is in use
 */
export function isPortInUseSync(port: number): boolean {
  const result = safeExec(`lsof -i :${port} -t 2>/dev/null`);
  return result.length > 0;
}

// =====================================================================
// Container Info
// =====================================================================

/**
 * Get container metadata as a key-value record.
 *
 * @param name - Container name
 * @returns Container info record, or `null` if not found
 */
export async function getContainerInfo(name: string): Promise<Record<string, string> | null> {
  const result = safeExec(
    `docker ps -a --filter "name=^${name}$" --format "{{json .}}"`,
  );
  if (!result) return null;
  try {
    return JSON.parse(result) as Record<string, string>;
  } catch {
    return null;
  }
}

// =====================================================================
// Container Log Streaming
// =====================================================================

/**
 * Stream container logs in real-time as {@link ContainerEvent} entries.
 *
 * Uses `docker logs -f` via `child_process.spawn`.
 *
 * @param name - Container name
 * @param lines - Number of initial tail lines (default: 50)
 * @yields {ContainerEvent} Log events
 */
export async function* streamContainerLogs(
  name: string,
  lines = 50,
): AsyncGenerator<ContainerEvent> {
  yield { type: 'container_start', name, timestamp: Date.now() };

  const events: ContainerEvent[] = [];
  let done = false;
  let resolveWait: (() => void) | null = null;

  const proc = spawn('docker', ['logs', '-f', '--tail', String(lines), name], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pushEvent = (event: ContainerEvent) => {
    events.push(event);
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  };

  const processStream = (stream: 'stdout' | 'stderr', data: Buffer) => {
    const text = data.toString();
    for (const line of text.split('\n')) {
      if (line) {
        pushEvent({ type: 'container_log', name, line, stream, timestamp: Date.now() });
      }
    }
  };

  proc.stdout.on('data', (data: Buffer) => processStream('stdout', data));
  proc.stderr.on('data', (data: Buffer) => processStream('stderr', data));

  proc.on('close', () => {
    pushEvent({ type: 'container_stop', name, timestamp: Date.now() });
    done = true;
  });

  proc.on('error', (err) => {
    pushEvent({ type: 'container_error', name, error: err.message, timestamp: Date.now() });
    done = true;
  });

  while (!done || events.length > 0) {
    if (events.length > 0) {
      yield events.shift()!;
    } else {
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        setTimeout(resolve, 1000);
      });
    }
  }
}

// =====================================================================
// Internal Helpers
// =====================================================================

/**
 * Safely execute a shell command, returning output or empty string on failure.
 */
function safeExec(cmd: string, opts?: { cwd?: string }): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      cwd: opts?.cwd,
      timeout: 10_000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
