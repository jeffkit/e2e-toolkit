/**
 * @module resilience/network-verifier
 * Verify container-to-service network connectivity via Docker DNS and TCP checks.
 *
 * Runs `docker exec` inside a reference container to test DNS resolution
 * and TCP reachability of mock services. Collects network topology from
 * `docker network inspect` for diagnostics on failure.
 */

import type {
  ConnectivityResult,
  NetworkVerificationReport,
  SSEBus,
} from '../types.js';
import { dockerExec } from '../docker-engine.js';
import { ArgusError } from './error-codes.js';

// =====================================================================
// NetworkVerifier
// =====================================================================

export class NetworkVerifier {
  constructor(private eventBus?: SSEBus) {}

  /**
   * Check whether a hostname can be resolved via DNS from inside a container.
   *
   * @param fromContainer - Container to execute the DNS lookup in
   * @param hostname - Target hostname to resolve
   * @returns Resolution result with optional resolved address
   */
  async checkDnsResolution(
    fromContainer: string,
    hostname: string,
  ): Promise<{ resolved: boolean; address?: string }> {
    try {
      const output = await dockerExec(
        ['exec', fromContainer, 'nslookup', hostname],
        5_000,
      );

      const addressMatch = /Address:\s+([^\s]+)/g;
      let lastAddress: string | undefined;
      let match: RegExpExecArray | null;
      while ((match = addressMatch.exec(output)) !== null) {
        lastAddress = match[1];
      }

      return { resolved: true, address: lastAddress };
    } catch {
      return { resolved: false };
    }
  }

  /**
   * Verify network connectivity from a test container to all mock services.
   *
   * For each service: resolves DNS, then performs a TCP connectivity check.
   * Collects Docker network topology for diagnostic context.
   * Emits SSE events per check and on completion.
   *
   * @throws {ArgusError} DNS_RESOLUTION_FAILED if any hostname cannot be resolved
   * @throws {ArgusError} NETWORK_UNREACHABLE if any service is not reachable
   */
  async verifyConnectivity(
    testContainer: string,
    mockServices: Array<{ name: string; hostname: string; port: number }>,
    networkName: string,
  ): Promise<NetworkVerificationReport> {
    const results: ConnectivityResult[] = [];
    const topology = await this.collectNetworkTopology(networkName);

    for (const svc of mockServices) {
      const start = Date.now();
      const dns = await this.checkDnsResolution(testContainer, svc.hostname);
      let reachable = false;
      let error: string | undefined;

      if (dns.resolved) {
        try {
          await dockerExec(
            ['exec', testContainer, 'nc', '-z', '-w', '3', svc.hostname, String(svc.port)],
            5_000,
          );
          reachable = true;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      } else {
        error = `DNS resolution failed for ${svc.hostname}`;
      }

      const latencyMs = Date.now() - start;

      const result: ConnectivityResult = {
        service: svc.name,
        hostname: svc.hostname,
        reachable,
        dnsResolved: dns.resolved,
        latencyMs,
        error,
      };
      results.push(result);

      this.eventBus?.emit('resilience', {
        event: 'network_check',
        data: {
          type: 'network_check',
          service: svc.name,
          reachable,
          timestamp: Date.now(),
        },
      });
    }

    const allReachable = results.every(r => r.reachable);

    const report: NetworkVerificationReport = {
      results,
      allReachable,
      networkTopology: topology,
      timestamp: Date.now(),
    };

    this.eventBus?.emit('resilience', {
      event: 'network_verified',
      data: {
        type: 'network_verified',
        allReachable,
        timestamp: Date.now(),
      },
    });

    if (!allReachable) {
      const dnsFailures = results.filter(r => !r.dnsResolved);
      if (dnsFailures.length > 0) {
        throw new ArgusError(
          'DNS_RESOLUTION_FAILED',
          `DNS resolution failed for: ${dnsFailures.map(f => f.hostname).join(', ')}`,
          { results, networkTopology: topology },
        );
      }

      const unreachable = results.filter(r => !r.reachable);
      throw new ArgusError(
        'NETWORK_UNREACHABLE',
        `Services unreachable: ${unreachable.map(u => `${u.service} (${u.hostname}:${u.error ?? 'unknown'})`).join(', ')}`,
        { results, networkTopology: topology },
      );
    }

    return report;
  }

  /**
   * Collect network topology from `docker network inspect`.
   */
  async collectNetworkTopology(
    networkName: string,
  ): Promise<{ networkName: string; connectedContainers: string[] }> {
    try {
      const output = await dockerExec(
        ['network', 'inspect', networkName, '--format', '{{range .Containers}}{{.Name}} {{end}}'],
        5_000,
      );
      const containers = output.split(/\s+/).filter(Boolean);
      return { networkName, connectedContainers: containers };
    } catch {
      return { networkName, connectedContainers: [] };
    }
  }
}
