/**
 * @module tools/mock-generate
 * argus_mock_generate — Generate e2e.yaml mock config from an OpenAPI spec.
 */

import path from 'node:path';
import { loadAndDereferenceSpec } from 'argusai-core';
import type { MockGenerateResult } from 'argusai-core';

export interface MockGenerateParams {
  projectPath: string;
  specPath: string;
  mockName?: string;
  port?: number;
  mode?: 'auto' | 'record' | 'replay' | 'smart';
  validate?: boolean;
  target?: string;
}

/**
 * Handle the argus_mock_generate MCP tool call.
 *
 * @param params - Tool input
 * @returns Generated YAML snippet and summary
 */
export async function handleMockGenerate(params: MockGenerateParams): Promise<MockGenerateResult> {
  const { projectPath, specPath, mockName, port = 9090, mode, validate, target } = params;

  const absoluteSpecPath = path.isAbsolute(specPath)
    ? specPath
    : path.resolve(projectPath, specPath);

  const spec = await loadAndDereferenceSpec(absoluteSpecPath);

  const derivedName = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'api-mock';
  const serviceName = mockName ?? derivedName;

  const methods: Record<string, number> = {};
  for (const route of spec.routes) {
    methods[route.method] = (methods[route.method] ?? 0) + 1;
  }

  let yamlLines = [
    'mocks:',
    `  ${serviceName}:`,
    `    port: ${port}`,
    `    openapi: ${specPath}`,
  ];

  if (mode && mode !== 'auto') {
    yamlLines.push(`    mode: ${mode}`);
  }
  if (validate) {
    yamlLines.push(`    validate: true`);
  }
  if (target) {
    yamlLines.push(`    target: ${target}`);
  }

  const yamlStr = yamlLines.join('\n') + '\n';

  return {
    yaml: yamlStr,
    summary: {
      specTitle: spec.title,
      specVersion: spec.openApiVersion,
      totalEndpoints: spec.routes.length,
      methods,
    },
  };
}
