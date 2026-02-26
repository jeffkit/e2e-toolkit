/**
 * @module tools/setup
 * argus_setup — Start the test environment.
 *
 * Uses MultiServiceOrchestrator for config normalization and dependency
 * ordering, while keeping Docker calls at this level for testability.
 */

import {
  ensureNetwork,
  startContainer,
  waitForHealthy,
  createMockServer,
  isPortInUse,
  parseTime,
  MultiServiceOrchestrator,
  type E2EConfig,
  type ServiceDefinition,
  type MockServiceConfig,
} from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';

export interface SetupResult {
  network: { name: string; created: boolean };
  services: Array<{
    name: string;
    containerId: string;
    status: 'running' | 'healthy' | 'unhealthy' | 'failed';
    ports: Array<{ host: number; container: number }>;
    healthCheckDuration?: number;
    error?: string;
  }>;
  mocks: Array<{
    name: string;
    port: number;
    status: 'running' | 'failed';
    routeCount: number;
  }>;
  totalDuration: number;
}

function parsePorts(ports: string[]): Array<{ host: number; container: number }> {
  return ports.map(p => {
    const parts = p.split(':');
    return {
      host: parseInt(parts[0]!, 10),
      container: parseInt(parts[1] ?? parts[0]!, 10),
    };
  });
}

function buildHealthcheckCmd(svc: ServiceDefinition) {
  if (!svc.container.healthcheck) return undefined;
  return {
    cmd: `wget -qO- http://localhost${svc.container.healthcheck.path} || exit 1`,
    interval: svc.container.healthcheck.interval ?? '10s',
    timeout: svc.container.healthcheck.timeout ?? '5s',
    retries: svc.container.healthcheck.retries ?? 10,
    startPeriod: svc.container.healthcheck.startPeriod ?? '30s',
  };
}

/**
 * Handle the argus_setup MCP tool call.
 * Creates Docker network, starts mock services and service containers,
 * and waits for health checks in dependency order.
 *
 * @param params - Tool input with projectPath and optional health-check timeout override
 * @param sessionManager - Session store for tracking project state
 * @returns Setup results including network, service, and mock status
 * @throws {SessionError} SESSION_NOT_FOUND if not initialized, PORT_CONFLICT on occupied ports
 */
export async function handleSetup(
  params: { projectPath: string; timeout?: string },
  sessionManager: SessionManager,
): Promise<SetupResult> {
  const session = sessionManager.getOrThrow(params.projectPath);
  const config = session.config;
  const totalStart = Date.now();
  const healthTimeout = params.timeout ? parseTime(params.timeout) : 120_000;

  const bus = sessionManager.eventBus;
  const ts = () => Date.now();

  bus?.emit('activity', {
    event: 'activity_start',
    data: { id: `setup-${totalStart}`, source: 'ai', operation: 'setup', project: config.project.name, status: 'running', startTime: totalStart },
  });
  bus?.emit('setup', { event: 'setup_start', data: { type: 'setup_start', project: config.project.name, timestamp: ts() } });

  const orchestrator = new MultiServiceOrchestrator();
  const services = orchestrator.normalizeServices(config);

  const orderedServices = services.length > 0
    ? orchestrator.topologicalSort(services)
    : [];

  // Create Docker network
  let networkCreated = false;
  try {
    await ensureNetwork(session.networkName);
    networkCreated = true;
    bus?.emit('setup', { event: 'network_created', data: { type: 'network_created', name: session.networkName, timestamp: ts() } });
  } catch {
    // Network may already exist
  }

  // Start mock services
  const mockResults: SetupResult['mocks'] = [];
  if (config.mocks) {
    for (const [name, mockConfig] of Object.entries(config.mocks)) {
      const mc = mockConfig as MockServiceConfig;
      try {
        const portInUse = await isPortInUse(mc.port);
        if (portInUse) {
          throw new SessionError('PORT_CONFLICT', `Port ${mc.port} is already in use for mock "${name}"`);
        }

        bus?.emit('setup', { event: 'mock_starting', data: { type: 'mock_starting', name, port: mc.port, timestamp: ts() } });
        const mockServer = createMockServer(mc);
        await mockServer.listen({ port: mc.port, host: '0.0.0.0' });
        session.mockServers.set(name, { server: mockServer, port: mc.port });
        bus?.emit('setup', { event: 'mock_started', data: { type: 'mock_started', name, port: mc.port, timestamp: ts() } });
        mockResults.push({
          name,
          port: mc.port,
          status: 'running',
          routeCount: mc.routes?.length ?? 0,
        });
      } catch (err) {
        if (err instanceof SessionError) throw err;
        mockResults.push({
          name,
          port: mc.port,
          status: 'failed',
          routeCount: mc.routes?.length ?? 0,
        });
      }
    }
  }

  // Start service containers in dependency order
  const serviceResults: SetupResult['services'] = [];

  for (const svc of orderedServices) {
    try {
      bus?.emit('setup', { event: 'service_starting', data: { type: 'service_starting', name: svc.name, image: svc.build.image, timestamp: ts() } });
      const containerId = await startContainer({
        name: svc.container.name,
        image: svc.build.image,
        ports: svc.container.ports,
        environment: svc.container.environment,
        volumes: svc.container.volumes,
        network: session.networkName,
        healthcheck: buildHealthcheckCmd(svc),
      });

      session.containerIds.set(svc.container.name, containerId);

      let status: 'running' | 'healthy' | 'unhealthy' = 'running';
      let healthCheckDuration: number | undefined;

      if (svc.container.healthcheck) {
        const hcStart = Date.now();
        const isHealthy = await waitForHealthy(svc.container.name, healthTimeout);
        healthCheckDuration = Date.now() - hcStart;
        status = isHealthy ? 'healthy' : 'unhealthy';
        if (isHealthy) {
          bus?.emit('setup', { event: 'service_healthy', data: { type: 'service_healthy', name: svc.name, duration: healthCheckDuration, timestamp: ts() } });
        }
      }

      serviceResults.push({
        name: svc.name,
        containerId,
        status,
        ports: parsePorts(svc.container.ports),
        healthCheckDuration,
      });
    } catch (err) {
      serviceResults.push({
        name: svc.name,
        containerId: '',
        status: 'failed',
        ports: parsePorts(svc.container.ports),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allHealthy = serviceResults.every(
    s => s.status !== 'failed' && s.status !== 'unhealthy',
  );
  if (allHealthy && serviceResults.length > 0) {
    sessionManager.transition(params.projectPath, 'running');
  }

  const totalDuration = Date.now() - totalStart;
  bus?.emit('setup', { event: 'setup_end', data: { type: 'setup_end', duration: totalDuration, success: allHealthy, timestamp: ts() } });
  bus?.emit('activity', {
    event: 'activity_update',
    data: { id: `setup-${totalStart}`, source: 'ai', operation: 'setup', project: config.project.name, status: allHealthy ? 'success' : 'failed', startTime: totalStart, endTime: Date.now() },
  });

  return {
    network: { name: session.networkName, created: networkCreated },
    services: serviceResults,
    mocks: mockResults,
    totalDuration,
  };
}
