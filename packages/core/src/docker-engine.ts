/**
 * @module docker-engine
 * Docker Engine - Image building and container management.
 *
 * Uses Docker CLI (`child_process` spawn/execFile) instead of dockerode
 * for zero native-dependency operation.
 */

import { spawn, execFileSync, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import type { BuildEvent, ContainerStatus, ContainerEvent } from './types.js';

const execFileAsync = promisify(execFileCb);

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
    args.push('--health-cmd', hc.cmd);
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
 * Uses an internal event queue to properly yield events from the spawned
 * `docker build` process, including individual `build_log` lines.
 *
 * @param options - Build options
 * @yields {BuildEvent} Progress events including individual log lines
 */
export async function* buildImage(options: DockerBuildOptions): AsyncGenerator<BuildEvent> {
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
        setTimeout(resolve, 1000);
      });
    }
  }
}

/** @deprecated Use {@link buildImage} instead. Kept for backward compatibility. */
export const buildImageStreaming = buildImage;

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
    const { stdout } = await execFileAsync('docker', args, {
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return stdout.trim().slice(0, 12);
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
  await safeExecFileAsync('docker', ['rm', '-f', name]);
}

/**
 * Get the current status of a container.
 *
 * @param name - Container name
 * @returns Container status string
 */
export async function getContainerStatus(name: string): Promise<ContainerStatus> {
  const result = await safeExecFileAsync('docker', ['inspect', '--format', '{{.State.Status}}', name]);
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
  const result = await safeExecFileAsync('docker', [
    'ps', '--filter', `name=^${name}$`, '--filter', 'status=running', '--format', '{{.Names}}',
  ]);
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
    const { stdout } = await execFileAsync('docker', ['logs', `--tail=${lines}`, name], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return stdout.trim();
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
    const { stdout } = await execFileAsync('docker', ['exec', name, 'sh', '-c', command], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    return stdout.trim();
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
  await safeExecFileAsync('docker', ['network', 'create', name]);
}

/**
 * Remove a Docker network.
 *
 * @param name - Network name
 */
export async function removeNetwork(name: string): Promise<void> {
  await safeExecFileAsync('docker', ['network', 'rm', name]);
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
    const healthStatus = await safeExecFileAsync(
      'docker', ['inspect', '--format', '{{.State.Health.Status}}', name],
    );

    if (healthStatus === 'healthy') {
      return true;
    }

    const containerStatus = await safeExecFileAsync(
      'docker', ['inspect', '--format', '{{.State.Status}}', name],
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
 * Attempts to bind a temporary server on the port; `EADDRINUSE` means
 * the port is already taken.
 *
 * @param port - Port number to check
 * @returns `true` if the port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false));
    });
  });
}

/**
 * Synchronous port-in-use check using `lsof`.
 *
 * @param port - Port number
 * @returns `true` if the port is in use
 */
export function isPortInUseSync(port: number): boolean {
  const result = safeExecFile('lsof', ['-i', `:${port}`, '-t']);
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
  const result = await safeExecFileAsync(
    'docker', ['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{json .}}'],
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
 * Async safe execution — returns output or empty string on failure.
 * Avoids shell injection by using execFile (no shell interpretation).
 */
async function safeExecFileAsync(bin: string, args: string[], opts?: { cwd?: string }): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      encoding: 'utf-8',
      cwd: opts?.cwd,
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Sync safe execution — used only by isPortInUseSync which has sync callers.
 */
function safeExecFile(bin: string, args: string[]): string {
  try {
    return execFileSync(bin, args, {
      encoding: 'utf-8',
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
