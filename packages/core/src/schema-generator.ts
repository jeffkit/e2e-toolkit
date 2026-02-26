/**
 * @module schema-generator
 * Converts Zod schemas from config-loader into JSON Schema files.
 *
 * Uses zod-to-json-schema to produce standard JSON Schema Draft 7
 * output, suitable for IDE validation (VS Code YAML extension) and
 * programmatic config validation.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'node:fs/promises';
import path from 'node:path';
import { E2EConfigSchema, TestSuiteSchema } from './config-loader.js';

export interface SchemaDefinition {
  name: string;
  filename: string;
  title: string;
  description: string;
}

const SCHEMA_DEFINITIONS: SchemaDefinition[] = [
  {
    name: 'E2EConfigSchema',
    filename: 'e2e-config.schema.json',
    title: 'Preflight E2E Configuration',
    description: 'Schema for preflight e2e.yaml configuration files. Defines services, mocks, test suites, and infrastructure settings.',
  },
  {
    name: 'TestSuiteSchema',
    filename: 'test-suite.schema.json',
    title: 'Preflight Test Suite',
    description: 'Schema for individual test suite configuration within the tests.suites array.',
  },
];

/**
 * Generate JSON Schema files from the Zod schemas.
 *
 * @param outputDir - Directory to write schema files into
 * @returns Array of generated file paths
 */
export async function generateSchemas(outputDir: string): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const schemas: Record<string, ReturnType<typeof zodToJsonSchema>> = {
    E2EConfigSchema: zodToJsonSchema(E2EConfigSchema, {
      name: 'E2EConfig',
      $refStrategy: 'none',
    }),
    TestSuiteSchema: zodToJsonSchema(TestSuiteSchema, {
      name: 'TestSuite',
      $refStrategy: 'none',
    }),
  };

  const writtenPaths: string[] = [];

  for (const def of SCHEMA_DEFINITIONS) {
    const schema = schemas[def.name];
    if (!schema) continue;

    const enriched = {
      ...schema,
      title: def.title,
      description: def.description,
    };

    const filePath = path.join(outputDir, def.filename);
    await fs.writeFile(filePath, JSON.stringify(enriched, null, 2) + '\n', 'utf-8');
    writtenPaths.push(filePath);
  }

  return writtenPaths;
}

/**
 * Convert E2EConfigSchema to a JSON Schema object (in-memory, no file I/O).
 */
export function getE2EConfigJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(E2EConfigSchema, {
    name: 'E2EConfig',
    $refStrategy: 'none',
  });
  return {
    ...schema,
    title: 'Preflight E2E Configuration',
    description: 'Schema for preflight e2e.yaml configuration files.',
  } as Record<string, unknown>;
}

/**
 * Convert TestSuiteSchema to a JSON Schema object (in-memory, no file I/O).
 */
export function getTestSuiteJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(TestSuiteSchema, {
    name: 'TestSuite',
    $refStrategy: 'none',
  });
  return {
    ...schema,
    title: 'Preflight Test Suite',
    description: 'Schema for individual test suite configuration.',
  } as Record<string, unknown>;
}
