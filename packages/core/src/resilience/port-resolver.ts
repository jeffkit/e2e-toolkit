/**
 * @module resilience/port-resolver
 * Port conflict detection and auto-resolution.
 *
 * Detects occupied ports before container creation and either
 * auto-assigns alternatives (strategy: 'auto') or fails fast
 * (strategy: 'fail').
 */

import { createServer } from 'node:net';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  PortMapping,
  ServiceDefinition,
  MockServiceConfig,
  SSEBus,
} from '../types.js';
import { isPortInUse } from '../docker-engine.js';
import { ArgusError } from './error-codes.js';

const execFileAsync = promisify(execFileCb);

// =====================================================================
// PortResolver
// =====================================================================

export class PortResolver {
  constructor(
    private strategy: 'auto' | 'fail',
    private eventBus?: SSEBus,
  ) {}

  /**
   * Find the next available port starting from `startPort`.
   *
   * Skips privileged ports (< 1024) and tries up to `maxAttempts` ports.
   *
   * @throws {ArgusError} PORT_EXHAUSTION if no port is available
   */
  async findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
    let port = startPort;

    for (let i = 0; i < maxAttempts; i++) {
      if (port < 1024) {
        port = 1024;
      }
      if (port > 65535) {
        break;
      }

      const inUse = await isPortInUse(port);
      if (!inUse) {
        return port;
      }
      port++;
    }

    throw new ArgusError(
      'PORT_EXHAUSTION',
      `No available port found after ${maxAttempts} attempts starting from ${startPort}`,
      { startPort, maxAttempts },
    );
  }

  /**
   * Resolve ports for all services and mocks.
   *
   * Returns immutable copies of services/mocks with updated ports
   * plus a PortMapping array documenting all reassignments.
   */
  async resolveServicePorts(
    services: ServiceDefinition[],
    mocks: Record<string, MockServiceConfig>,
  ): Promise<{
    services: ServiceDefinition[];
    mocks: Record<string, MockServiceConfig>;
    portMappings: PortMapping[];
  }> {
    const portMappings: PortMapping[] = [];
    const resolvedServices: ServiceDefinition[] = [];
    const resolvedMocks: Record<string, MockServiceConfig> = {};

    for (const svc of services) {
      const resolvedPorts: string[] = [];

      for (const portMapping of svc.container.ports) {
        const parts = portMapping.split(':');
        const hostPort = parseInt(parts[0]!, 10);
        const containerPort = parseInt(parts[1] ?? parts[0]!, 10);

        const resolved = await this.resolvePort(svc.name, hostPort);
        portMappings.push(resolved);
        resolvedPorts.push(`${resolved.actualPort}:${containerPort}`);
      }

      resolvedServices.push({
        ...svc,
        container: {
          ...svc.container,
          ports: resolvedPorts,
        },
      });
    }

    for (const [name, mockConfig] of Object.entries(mocks)) {
      const resolved = await this.resolvePort(name, mockConfig.port);
      portMappings.push(resolved);

      resolvedMocks[name] = {
        ...mockConfig,
        port: resolved.actualPort,
      };
    }

    return { services: resolvedServices, mocks: resolvedMocks, portMappings };
  }

  private async resolvePort(serviceName: string, port: number): Promise<PortMapping> {
    const inUse = await isPortInUse(port);

    if (!inUse) {
      return {
        service: serviceName,
        originalPort: port,
        actualPort: port,
        reassigned: false,
      };
    }

    const pid = await getOccupyingPid(port);

    this.eventBus?.emit('resilience', {
      event: 'port_conflict',
      data: {
        type: 'port_conflict',
        service: serviceName,
        port,
        pid: pid ?? undefined,
        timestamp: Date.now(),
      },
    });

    if (this.strategy === 'fail') {
      throw new ArgusError(
        'PORT_CONFLICT',
        `Port ${port} is already in use for service "${serviceName}"`,
        { service: serviceName, port, pid },
      );
    }

    const actualPort = await this.findAvailablePort(port + 1);

    this.eventBus?.emit('resilience', {
      event: 'port_reassigned',
      data: {
        type: 'port_reassigned',
        service: serviceName,
        original: port,
        actual: actualPort,
        timestamp: Date.now(),
      },
    });

    return {
      service: serviceName,
      originalPort: port,
      actualPort,
      reassigned: true,
    };
  }
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Best-effort detection of the PID occupying a port via `lsof`.
 */
async function getOccupyingPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-i', `:${port}`, '-t'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const pid = parseInt(stdout.trim().split('\n')[0]!, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
