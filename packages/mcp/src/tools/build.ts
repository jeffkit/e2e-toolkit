/**
 * @module tools/build
 * preflight_build — Build Docker images for project services.
 */

import {
  buildImage,
  type E2EConfig,
  type ServiceConfig,
  type ServiceDefinition,
  type BuildEvent,
} from '@preflight/core';
import { SessionManager, SessionError } from '../session.js';

export interface BuildResult {
  services: Array<{
    name: string;
    image: string;
    status: 'success' | 'failed';
    duration: number;
    error?: string;
  }>;
  totalDuration: number;
}

interface ServiceBuildTarget {
  name: string;
  build: { dockerfile: string; context: string; image: string; args?: Record<string, string> };
}

function getServicesToBuild(config: E2EConfig, serviceFilter?: string): ServiceBuildTarget[] {
  const targets: ServiceBuildTarget[] = [];

  if (config.services && config.services.length > 0) {
    for (const svc of config.services) {
      if (serviceFilter && svc.name !== serviceFilter) continue;
      targets.push({ name: svc.name, build: svc.build });
    }
  } else if (config.service) {
    const svc: ServiceConfig = config.service;
    if (!serviceFilter || svc.container.name === serviceFilter) {
      targets.push({ name: svc.container.name, build: svc.build });
    }
  }

  if (serviceFilter && targets.length === 0) {
    throw new SessionError('SERVICE_NOT_FOUND', `Service "${serviceFilter}" not found in configuration`);
  }

  return targets;
}

/**
 * Handle the preflight_build MCP tool call.
 * Builds Docker images for one or all services in the project.
 *
 * @param params - Tool input with projectPath, optional noCache and service filter
 * @param sessionManager - Session store for tracking project state
 * @returns Build results per service with status and timing
 * @throws {SessionError} SESSION_NOT_FOUND if not initialized, SERVICE_NOT_FOUND if filter matches nothing
 */
export async function handleBuild(
  params: { projectPath: string; noCache?: boolean; service?: string },
  sessionManager: SessionManager,
  _server?: unknown,
  _progressToken?: string | number,
): Promise<BuildResult> {
  const session = sessionManager.getOrThrow(params.projectPath);
  const targets = getServicesToBuild(session.config, params.service);

  const totalStart = Date.now();
  const results: BuildResult['services'] = [];

  for (const target of targets) {
    const buildStart = Date.now();
    let lineNumber = 0;
    let buildError: string | undefined;

    try {
      const buildOpts = {
        dockerfile: target.build.dockerfile,
        context: target.build.context,
        imageName: target.build.image,
        buildArgs: target.build.args,
        noCache: params.noCache,
      };

      for await (const event of buildImage(buildOpts)) {
        if (event.type === 'build_log') {
          lineNumber++;
        }
        if (event.type === 'build_end' && !event.success) {
          buildError = event.error;
        }
      }
    } catch (err) {
      buildError = (err as Error).message;
    }

    results.push({
      name: target.name,
      image: target.build.image,
      status: buildError ? 'failed' : 'success',
      duration: Date.now() - buildStart,
      error: buildError,
    });
  }

  const anyFailed = results.some(r => r.status === 'failed');
  if (!anyFailed) {
    sessionManager.transition(params.projectPath, 'built');
  }

  return {
    services: results,
    totalDuration: Date.now() - totalStart,
  };
}
