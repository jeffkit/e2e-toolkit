/**
 * Unit tests for resilience/network-verifier module.
 *
 * Mocks dockerExec to avoid real Docker calls.
 * Covers: DNS resolution (success/failure), connectivity checks
 * (reachable/unreachable), network topology collection,
 * SSE event emission, error throwing on failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SSEBus, SSEMessage } from '../../../src/types.js';

vi.mock('../../../src/docker-engine.js', () => ({
  dockerExec: vi.fn(),
}));

import { dockerExec } from '../../../src/docker-engine.js';
import { NetworkVerifier } from '../../../src/resilience/network-verifier.js';
import { ArgusError } from '../../../src/resilience/error-codes.js';

const mockDockerExec = vi.mocked(dockerExec);

function createMockBus(): SSEBus & { events: Array<{ channel: string; msg: SSEMessage }> } {
  const events: Array<{ channel: string; msg: SSEMessage }> = [];
  return {
    events,
    emit(channel: string, msg: SSEMessage) {
      events.push({ channel, msg });
    },
    subscribe: () => () => {},
  };
}

describe('NetworkVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =================================================================
  // checkDnsResolution
  // =================================================================

  describe('checkDnsResolution', () => {
    it('should return resolved=true with address on success', async () => {
      mockDockerExec.mockResolvedValueOnce(
        'Server:    127.0.0.11\nAddress:  127.0.0.11\n\nName:   mock-api\nAddress: 172.20.0.3',
      );

      const verifier = new NetworkVerifier();
      const result = await verifier.checkDnsResolution('test-container', 'mock-api');

      expect(result.resolved).toBe(true);
      expect(result.address).toBe('172.20.0.3');
      expect(mockDockerExec).toHaveBeenCalledWith(
        ['exec', 'test-container', 'nslookup', 'mock-api'],
        5_000,
      );
    });

    it('should return resolved=false when nslookup fails', async () => {
      mockDockerExec.mockRejectedValueOnce(new Error('nslookup: can\'t resolve'));

      const verifier = new NetworkVerifier();
      const result = await verifier.checkDnsResolution('test-container', 'nonexistent-host');

      expect(result.resolved).toBe(false);
      expect(result.address).toBeUndefined();
    });

    it('should extract last address from multi-line nslookup output', async () => {
      mockDockerExec.mockResolvedValueOnce(
        'Server:    127.0.0.11\nAddress:  127.0.0.11\n\nName:   svc\nAddress: 10.0.0.5\nAddress: 10.0.0.6',
      );

      const verifier = new NetworkVerifier();
      const result = await verifier.checkDnsResolution('container', 'svc');

      expect(result.resolved).toBe(true);
      expect(result.address).toBe('10.0.0.6');
    });
  });

  // =================================================================
  // collectNetworkTopology
  // =================================================================

  describe('collectNetworkTopology', () => {
    it('should parse container names from docker network inspect', async () => {
      mockDockerExec.mockResolvedValueOnce('container-a container-b mock-api ');

      const verifier = new NetworkVerifier();
      const topology = await verifier.collectNetworkTopology('e2e-network');

      expect(topology.networkName).toBe('e2e-network');
      expect(topology.connectedContainers).toEqual(['container-a', 'container-b', 'mock-api']);
    });

    it('should return empty containers on inspect failure', async () => {
      mockDockerExec.mockRejectedValueOnce(new Error('network not found'));

      const verifier = new NetworkVerifier();
      const topology = await verifier.collectNetworkTopology('missing-network');

      expect(topology.networkName).toBe('missing-network');
      expect(topology.connectedContainers).toEqual([]);
    });
  });

  // =================================================================
  // verifyConnectivity
  // =================================================================

  describe('verifyConnectivity', () => {
    it('should return report with all reachable when DNS and TCP succeed', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('nslookup')) {
          return 'Server: 127.0.0.11\nAddress: 127.0.0.11\n\nName: mock-api\nAddress: 172.20.0.3';
        }
        if (args.includes('nc')) {
          return '';
        }
        if (args.includes('network')) {
          return 'test-svc mock-api ';
        }
        return '';
      });

      const bus = createMockBus();
      const verifier = new NetworkVerifier(bus);

      const report = await verifier.verifyConnectivity(
        'test-svc',
        [{ name: 'mock-api', hostname: 'mock-api', port: 8080 }],
        'e2e-network',
      );

      expect(report.allReachable).toBe(true);
      expect(report.results).toHaveLength(1);
      expect(report.results[0]!.reachable).toBe(true);
      expect(report.results[0]!.dnsResolved).toBe(true);
      expect(report.networkTopology.networkName).toBe('e2e-network');

      const networkCheckEvents = bus.events.filter(
        e => e.channel === 'resilience' && e.msg.event === 'network_check',
      );
      expect(networkCheckEvents).toHaveLength(1);

      const verifiedEvents = bus.events.filter(
        e => e.channel === 'resilience' && e.msg.event === 'network_verified',
      );
      expect(verifiedEvents).toHaveLength(1);
    });

    it('should throw DNS_RESOLUTION_FAILED when hostname cannot be resolved', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('nslookup')) {
          throw new Error('nslookup failed');
        }
        if (args.includes('network')) {
          return 'test-svc ';
        }
        return '';
      });

      const verifier = new NetworkVerifier();

      await expect(
        verifier.verifyConnectivity(
          'test-svc',
          [{ name: 'mock-api', hostname: 'mock-api', port: 8080 }],
          'e2e-network',
        ),
      ).rejects.toThrow(ArgusError);

      try {
        await verifier.verifyConnectivity(
          'test-svc',
          [{ name: 'mock-api', hostname: 'mock-api', port: 8080 }],
          'e2e-network',
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ArgusError);
        expect((err as ArgusError).code).toBe('DNS_RESOLUTION_FAILED');
      }
    });

    it('should throw NETWORK_UNREACHABLE when TCP check fails', async () => {
      let ncCallCount = 0;
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('nslookup')) {
          return 'Address: 172.20.0.3';
        }
        if (args.includes('nc')) {
          ncCallCount++;
          throw new Error('Connection refused');
        }
        if (args.includes('network')) {
          return 'test-svc mock-api ';
        }
        return '';
      });

      const verifier = new NetworkVerifier();

      try {
        await verifier.verifyConnectivity(
          'test-svc',
          [{ name: 'mock-api', hostname: 'mock-api', port: 8080 }],
          'e2e-network',
        );
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ArgusError);
        expect((err as ArgusError).code).toBe('NETWORK_UNREACHABLE');
      }
    });

    it('should check multiple services and report per-service results', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('nslookup')) {
          const hostname = args[args.indexOf('nslookup') + 1];
          if (hostname === 'reachable-svc') return 'Address: 172.20.0.3';
          throw new Error('DNS failed');
        }
        if (args.includes('nc')) {
          return '';
        }
        if (args.includes('network')) {
          return 'test-svc reachable-svc ';
        }
        return '';
      });

      const bus = createMockBus();
      const verifier = new NetworkVerifier(bus);

      try {
        await verifier.verifyConnectivity(
          'test-svc',
          [
            { name: 'reachable-svc', hostname: 'reachable-svc', port: 3000 },
            { name: 'unreachable-svc', hostname: 'unreachable-svc', port: 4000 },
          ],
          'e2e-network',
        );
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ArgusError);
        expect((err as ArgusError).code).toBe('DNS_RESOLUTION_FAILED');
      }

      const checkEvents = bus.events.filter(
        e => e.channel === 'resilience' && e.msg.event === 'network_check',
      );
      expect(checkEvents).toHaveLength(2);
    });

    it('should emit SSE events for each service check', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('nslookup')) return 'Address: 172.20.0.5';
        if (args.includes('nc')) return '';
        if (args.includes('network')) return 'svc-a svc-b ';
        return '';
      });

      const bus = createMockBus();
      const verifier = new NetworkVerifier(bus);

      await verifier.verifyConnectivity(
        'svc-a',
        [
          { name: 'svc-b', hostname: 'svc-b', port: 3000 },
          { name: 'svc-c', hostname: 'svc-c', port: 4000 },
        ],
        'net',
      );

      const checkEvents = bus.events.filter(e => e.msg.event === 'network_check');
      expect(checkEvents).toHaveLength(2);

      const verifiedEvents = bus.events.filter(e => e.msg.event === 'network_verified');
      expect(verifiedEvents).toHaveLength(1);
      const verifiedData = verifiedEvents[0]!.msg.data as Record<string, unknown>;
      expect(verifiedData['allReachable']).toBe(true);
    });
  });
});
