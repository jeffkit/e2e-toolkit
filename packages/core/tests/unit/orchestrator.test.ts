/**
 * Unit tests for MultiServiceOrchestrator.
 *
 * Tests cover:
 * - Single-service normalization (wraps `service` into `services[]`)
 * - Multi-service normalization (returns `services[]` as-is)
 * - Empty config normalization
 * - Topological sort with dependsOn
 * - Circular dependency detection
 * - Unknown dependency detection
 * - Parallel build via buildAll
 * - Sequential start with dependsOn ordering
 * - cleanAll best-effort cleanup
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MultiServiceOrchestrator } from '../../src/orchestrator.js';
import type { E2EConfig, ServiceDefinition, ServiceConfig } from '../../src/types.js';

vi.mock('../../src/docker-engine.js', () => ({
  buildImage: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  ensureNetwork: vi.fn(),
  removeNetwork: vi.fn(),
  waitForHealthy: vi.fn(),
}));

import {
  buildImage,
  startContainer,
  stopContainer,
  removeNetwork,
  waitForHealthy,
} from '../../src/docker-engine.js';

function makeServiceDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    name: overrides.name ?? 'test-svc',
    build: overrides.build ?? {
      dockerfile: 'Dockerfile',
      context: '.',
      image: 'test-image:latest',
    },
    container: overrides.container ?? {
      name: overrides.name ?? 'test-svc',
      ports: ['3000:3000'],
    },
    vars: overrides.vars,
    dependsOn: overrides.dependsOn,
  };
}

function makeConfig(overrides: Partial<E2EConfig> = {}): E2EConfig {
  return {
    version: '1',
    project: { name: 'test-project' },
    ...overrides,
  };
}

describe('MultiServiceOrchestrator', () => {
  let orchestrator: MultiServiceOrchestrator;

  beforeEach(() => {
    orchestrator = new MultiServiceOrchestrator();
    vi.clearAllMocks();
  });

  // =========================================================
  // normalizeServices
  // =========================================================

  describe('normalizeServices', () => {
    it('wraps single service into services array', () => {
      const svc: ServiceConfig = {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'my-app:1.0' },
        container: { name: 'my-app', ports: ['8080:8080'] },
        vars: { API_KEY: 'test' },
      };
      const config = makeConfig({ service: svc });
      const result = orchestrator.normalizeServices(config);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('my-app');
      expect(result[0]!.build.image).toBe('my-app:1.0');
      expect(result[0]!.vars).toEqual({ API_KEY: 'test' });
    });

    it('returns services array as-is when defined', () => {
      const services = [
        makeServiceDef({ name: 'svc-a' }),
        makeServiceDef({ name: 'svc-b' }),
      ];
      const config = makeConfig({ services });
      const result = orchestrator.normalizeServices(config);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('svc-a');
      expect(result[1]!.name).toBe('svc-b');
    });

    it('prefers services over service when both are defined', () => {
      const config = makeConfig({
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'single:1.0' },
          container: { name: 'single', ports: ['3000:3000'] },
        },
        services: [makeServiceDef({ name: 'multi-a' })],
      });
      const result = orchestrator.normalizeServices(config);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('multi-a');
    });

    it('returns empty array when neither service nor services', () => {
      const config = makeConfig();
      const result = orchestrator.normalizeServices(config);
      expect(result).toHaveLength(0);
    });
  });

  // =========================================================
  // topologicalSort
  // =========================================================

  describe('topologicalSort', () => {
    it('returns services unchanged when no dependencies', () => {
      const services = [
        makeServiceDef({ name: 'a' }),
        makeServiceDef({ name: 'b' }),
        makeServiceDef({ name: 'c' }),
      ];
      const sorted = orchestrator.topologicalSort(services);
      expect(sorted.map(s => s.name)).toEqual(['a', 'b', 'c']);
    });

    it('orders dependents after their dependencies', () => {
      const services = [
        makeServiceDef({ name: 'api', dependsOn: ['db'] }),
        makeServiceDef({ name: 'db' }),
        makeServiceDef({ name: 'worker', dependsOn: ['api', 'db'] }),
      ];
      const sorted = orchestrator.topologicalSort(services);
      const names = sorted.map(s => s.name);

      expect(names.indexOf('db')).toBeLessThan(names.indexOf('api'));
      expect(names.indexOf('db')).toBeLessThan(names.indexOf('worker'));
      expect(names.indexOf('api')).toBeLessThan(names.indexOf('worker'));
    });

    it('detects circular dependencies', () => {
      const services = [
        makeServiceDef({ name: 'a', dependsOn: ['b'] }),
        makeServiceDef({ name: 'b', dependsOn: ['a'] }),
      ];

      expect(() => orchestrator.topologicalSort(services)).toThrow(
        /Circular dependency detected/,
      );
    });

    it('detects transitive circular dependencies', () => {
      const services = [
        makeServiceDef({ name: 'a', dependsOn: ['c'] }),
        makeServiceDef({ name: 'b', dependsOn: ['a'] }),
        makeServiceDef({ name: 'c', dependsOn: ['b'] }),
      ];

      expect(() => orchestrator.topologicalSort(services)).toThrow(
        /Circular dependency detected/,
      );
    });

    it('throws on unknown dependency', () => {
      const services = [
        makeServiceDef({ name: 'api', dependsOn: ['nonexistent'] }),
      ];

      expect(() => orchestrator.topologicalSort(services)).toThrow(
        /depends on unknown service "nonexistent"/,
      );
    });

    it('handles diamond dependency graphs', () => {
      const services = [
        makeServiceDef({ name: 'top', dependsOn: ['left', 'right'] }),
        makeServiceDef({ name: 'left', dependsOn: ['base'] }),
        makeServiceDef({ name: 'right', dependsOn: ['base'] }),
        makeServiceDef({ name: 'base' }),
      ];
      const sorted = orchestrator.topologicalSort(services);
      const names = sorted.map(s => s.name);

      expect(names.indexOf('base')).toBeLessThan(names.indexOf('left'));
      expect(names.indexOf('base')).toBeLessThan(names.indexOf('right'));
      expect(names.indexOf('left')).toBeLessThan(names.indexOf('top'));
      expect(names.indexOf('right')).toBeLessThan(names.indexOf('top'));
    });
  });

  // =========================================================
  // buildAll
  // =========================================================

  describe('buildAll', () => {
    it('builds all services in parallel', async () => {
      const mockBuildImage = buildImage as Mock;
      mockBuildImage.mockImplementation(async function* () {
        yield { type: 'build_start', image: 'test', timestamp: Date.now() };
        yield { type: 'build_end', success: true, duration: 100, timestamp: Date.now() };
      });

      const services = [
        makeServiceDef({ name: 'svc-a' }),
        makeServiceDef({ name: 'svc-b' }),
      ];

      const result = await orchestrator.buildAll(services);

      expect(result.services).toHaveLength(2);
      expect(result.services[0]!.status).toBe('success');
      expect(result.services[1]!.status).toBe('success');
      expect(mockBuildImage).toHaveBeenCalledTimes(2);
    });

    it('reports failed builds correctly', async () => {
      const mockBuildImage = buildImage as Mock;
      mockBuildImage.mockImplementation(async function* () {
        yield { type: 'build_start', image: 'test', timestamp: Date.now() };
        yield { type: 'build_end', success: false, duration: 50, error: 'Build failed', timestamp: Date.now() };
      });

      const services = [makeServiceDef({ name: 'svc-a' })];
      const result = await orchestrator.buildAll(services);

      expect(result.services[0]!.status).toBe('failed');
      expect(result.services[0]!.error).toBe('Build failed');
    });
  });

  // =========================================================
  // startAll
  // =========================================================

  describe('startAll', () => {
    it('starts services in dependency order', async () => {
      const startOrder: string[] = [];
      (startContainer as Mock).mockImplementation(async (opts: { name: string }) => {
        startOrder.push(opts.name);
        return 'abc123def456';
      });
      (waitForHealthy as Mock).mockResolvedValue(true);

      const services = [
        makeServiceDef({ name: 'api', dependsOn: ['db'] }),
        makeServiceDef({ name: 'db' }),
      ];

      const results = await orchestrator.startAll(services, 'test-network');

      expect(startOrder[0]).toBe('db');
      expect(startOrder[1]).toBe('api');
      expect(results).toHaveLength(2);
    });

    it('returns failed status when container fails to start', async () => {
      (startContainer as Mock).mockRejectedValue(new Error('Container start failed'));

      const services = [makeServiceDef({ name: 'bad-svc' })];
      const results = await orchestrator.startAll(services, 'test-network');

      expect(results[0]!.status).toBe('failed');
      expect(results[0]!.error).toBe('Container start failed');
    });

    it('checks health when healthcheck is configured', async () => {
      (startContainer as Mock).mockResolvedValue('abc123def456');
      (waitForHealthy as Mock).mockResolvedValue(true);

      const services = [
        makeServiceDef({
          name: 'healthy-svc',
          container: {
            name: 'healthy-svc',
            ports: ['3000:3000'],
            healthcheck: { path: '/health' },
          },
        }),
      ];

      const results = await orchestrator.startAll(services, 'test-network');

      expect(results[0]!.status).toBe('healthy');
      expect(results[0]!.healthCheckDuration).toBeDefined();
      expect(waitForHealthy).toHaveBeenCalledWith('healthy-svc', 120_000);
    });
  });

  // =========================================================
  // cleanAll
  // =========================================================

  describe('cleanAll', () => {
    it('removes all containers and network', async () => {
      (stopContainer as Mock).mockResolvedValue(undefined);
      (removeNetwork as Mock).mockResolvedValue(undefined);

      const services = [
        makeServiceDef({ name: 'svc-a' }),
        makeServiceDef({ name: 'svc-b' }),
      ];

      const result = await orchestrator.cleanAll(services, 'test-network');

      expect(result.containers).toHaveLength(2);
      expect(result.containers.every(c => c.action === 'removed')).toBe(true);
      expect(result.network.action).toBe('removed');
    });

    it('continues cleanup on individual container failure', async () => {
      (stopContainer as Mock)
        .mockRejectedValueOnce(new Error('Container not found'))
        .mockResolvedValueOnce(undefined);
      (removeNetwork as Mock).mockResolvedValue(undefined);

      const services = [
        makeServiceDef({ name: 'svc-a' }),
        makeServiceDef({ name: 'svc-b' }),
      ];

      const result = await orchestrator.cleanAll(services, 'test-network');

      expect(result.containers).toHaveLength(2);
      const failed = result.containers.find(c => c.action === 'failed');
      const removed = result.containers.find(c => c.action === 'removed');
      expect(failed).toBeDefined();
      expect(removed).toBeDefined();
    });

    it('skips network removal when not specified', async () => {
      (stopContainer as Mock).mockResolvedValue(undefined);

      const services = [makeServiceDef({ name: 'svc-a' })];
      const result = await orchestrator.cleanAll(services);

      expect(result.network.action).toBe('skipped');
    });
  });
});
