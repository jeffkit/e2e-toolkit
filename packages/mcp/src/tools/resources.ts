/**
 * @module tools/resources
 * argus_resources — Show all ArgusAI-managed Docker resources across all projects.
 *
 * Queries Docker for containers and networks carrying the `argusai.managed=true`
 * label, then groups them by project. Also shows in-process port allocations
 * and active sessions from the SessionManager.
 */

import { dockerExec, PortAllocator } from 'argusai-core';
import { SessionManager } from '../session.js';

// =====================================================================
// Result Types
// =====================================================================

export interface ResourceContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  runId: string;
  createdAt: string;
}

export interface ResourceNetwork {
  id: string;
  name: string;
  driver: string;
  createdAt: string;
}

export interface ProjectResources {
  project: string;
  /** Containers labelled argusai.project=<project> */
  containers: ResourceContainer[];
  /** Networks whose name starts with argusai-<slug>- or carry the project label */
  networks: ResourceNetwork[];
  /** Ports claimed by this project in the process-level PortAllocator */
  claimedPorts: number[];
  /** Active session info (if any) */
  session?: {
    state: string;
    runId: string;
    networkName: string;
    activeMocks: string[];
  };
}

export interface ResourcesResult {
  projects: ProjectResources[];
  summary: {
    totalContainers: number;
    totalNetworks: number;
    totalClaimedPorts: number;
    activeSessions: number;
  };
}

// =====================================================================
// Handler
// =====================================================================

/**
 * Handle the argus_resources MCP tool call.
 * Returns all ArgusAI-managed Docker resources grouped by project.
 *
 * @param sessionManager - Session store to enrich results with live session info
 */
export async function handleResources(sessionManager: SessionManager): Promise<ResourcesResult> {
  const byProject = new Map<string, ProjectResources>();

  const ensure = (project: string): ProjectResources => {
    if (!byProject.has(project)) {
      byProject.set(project, {
        project,
        containers: [],
        networks: [],
        claimedPorts: [],
      });
    }
    return byProject.get(project)!;
  };

  // ── 1. Query Docker containers with argusai.managed=true label ──────
  try {
    const raw = await dockerExec([
      'ps', '-a',
      '--filter', 'label=argusai.managed=true',
      '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Label "argusai.project"}}\t{{.Label "argusai.run-id"}}\t{{.CreatedAt}}',
    ]);

    if (raw) {
      for (const line of raw.split('\n')) {
        const parts = line.split('\t');
        if (parts.length < 8) continue;
        const [id, name, image, status, state, project, runId, createdAt] = parts;
        if (!project) continue;
        const entry = ensure(project);
        entry.containers.push({
          id: id!.slice(0, 12),
          name: name ?? '',
          image: image ?? '',
          status: status ?? '',
          state: state ?? '',
          runId: runId ?? '',
          createdAt: createdAt ?? '',
        });
      }
    }
  } catch {
    // Docker may be unavailable — continue gracefully
  }

  // ── 2. Query Docker networks with argusai.managed=true label ────────
  try {
    const raw = await dockerExec([
      'network', 'ls',
      '--filter', 'label=argusai.managed=true',
      '--format', '{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Label "argusai.project"}}\t{{.CreatedAt}}',
    ]);

    if (raw) {
      for (const line of raw.split('\n')) {
        const parts = line.split('\t');
        if (parts.length < 5) continue;
        const [id, name, driver, project, createdAt] = parts;
        // Fall back to extracting project from `argusai-<project>-network` pattern
        const effectiveProject =
          project ||
          (name?.match(/^argusai-(.+)-network$/) ?? [])[1] ||
          'unknown';
        const entry = ensure(effectiveProject);
        entry.networks.push({
          id: id!.slice(0, 12),
          name: name ?? '',
          driver: driver ?? '',
          createdAt: createdAt ?? '',
        });
      }
    }
  } catch {
    // Continue gracefully
  }

  // ── 3. Merge process-level PortAllocator claims ──────────────────────
  for (const [project, claims] of PortAllocator.instance.getAllClaims()) {
    const entry = ensure(project);
    entry.claimedPorts = claims.map(c => c.port).sort((a, b) => a - b);
  }

  // ── 4. Merge active session metadata ────────────────────────────────
  for (const session of sessionManager.listSessions()) {
    const projectName = session.config.project.name;
    const entry = ensure(projectName);
    entry.session = {
      state: session.state,
      runId: session.runId,
      networkName: session.networkName,
      activeMocks: [...session.mockServers.keys()],
    };
  }

  const projects = [...byProject.values()].sort((a, b) =>
    a.project.localeCompare(b.project),
  );

  const totalContainers = projects.reduce((s, p) => s + p.containers.length, 0);
  const totalNetworks = projects.reduce((s, p) => s + p.networks.length, 0);
  const totalClaimedPorts = projects.reduce((s, p) => s + p.claimedPorts.length, 0);
  const activeSessions = sessionManager.size;

  return {
    projects,
    summary: {
      totalContainers,
      totalNetworks,
      totalClaimedPorts,
      activeSessions,
    },
  };
}
