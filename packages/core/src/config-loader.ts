/**
 * @module config-loader
 * Configuration loader for e2e-toolkit.
 *
 * Loads `e2e.yaml` configuration files, validates them with Zod schemas,
 * supports `.env` file loading and `{{variable}}` substitution.
 */

import { z } from 'zod';
import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import type { E2EConfig } from './types.js';
import { resolveObjectVariables } from './variable-resolver.js';

// =====================================================================
// Zod Sub-Schemas
// =====================================================================

/** Healthcheck configuration schema */
export const HealthcheckSchema = z.object({
  /** HTTP health check path */
  path: z.string(),
  /** Check interval (e.g., "10s") */
  interval: z.string().default('10s'),
  /** Timeout per check (e.g., "5s") */
  timeout: z.string().default('5s'),
  /** Number of retries before unhealthy */
  retries: z.number().default(10),
  /** Initial grace period (e.g., "30s") */
  startPeriod: z.string().default('30s'),
});

/** Service build configuration schema */
export const ServiceBuildSchema = z.object({
  /** Path to the Dockerfile */
  dockerfile: z.string(),
  /** Build context directory */
  context: z.string().default('.'),
  /** Docker image name (supports variables) */
  image: z.string(),
  /** Build arguments */
  args: z.record(z.string()).optional(),
});

/** Service container configuration schema */
export const ServiceContainerSchema = z.object({
  /** Container name */
  name: z.string(),
  /** Port mappings in "host:container" format */
  ports: z.array(z.string()),
  /** Environment variables */
  environment: z.record(z.string()).optional(),
  /** Volume mounts */
  volumes: z.array(z.string()).optional(),
  /** Health check configuration */
  healthcheck: HealthcheckSchema.optional(),
});

/** Mock route configuration schema */
export const MockRouteSchema = z.object({
  /** HTTP method */
  method: z.string(),
  /** Route path */
  path: z.string(),
  /** Response definition */
  response: z.object({
    /** HTTP status code */
    status: z.number().default(200),
    /** Response headers */
    headers: z.record(z.string()).optional(),
    /** Response body */
    body: z.unknown(),
    /** Simulated response delay (e.g., "100ms", "2s") */
    delay: z.string().optional(),
  }),
  /** Conditional matching rules */
  when: z.object({
    body: z.record(z.unknown()).optional(),
    headers: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
  }).optional(),
});

/** Mock service configuration schema */
export const MockServiceSchema = z.object({
  /** Host port */
  port: z.number(),
  /** Container-internal port */
  containerPort: z.number().optional(),
  /** Mock route definitions */
  routes: z.array(MockRouteSchema).optional(),
  /** Pre-built Docker image (alternative to routes) */
  image: z.string().optional(),
});

/** Test suite configuration schema */
export const TestSuiteSchema = z.object({
  /** Human-readable suite name */
  name: z.string(),
  /** Unique suite identifier */
  id: z.string(),
  /** Test file path */
  file: z.string().optional(),
  /** Runner type (yaml, vitest, pytest, shell, exec) */
  runner: z.string().optional(),
  /** Custom command (for exec runner) */
  command: z.string().optional(),
  /** Runner-specific config file */
  config: z.string().optional(),
});

/** Preset endpoint schema */
export const PresetEndpointSchema = z.object({
  method: z.string(),
  path: z.string(),
  name: z.string(),
  body: z.unknown().optional(),
});

/** Preset group schema */
export const PresetGroupSchema = z.object({
  group: z.string(),
  endpoints: z.array(PresetEndpointSchema),
});

/** Repo configuration schema */
export const RepoConfigSchema = z.object({
  name: z.string(),
  /** Local path (relative to e2e.yaml) */
  path: z.string().optional(),
  /** Remote URL (SSH or HTTPS) */
  url: z.string().optional(),
  /** Default branch name (for remote repos) */
  branch: z.string().optional(),
});

/** Dashboard configuration schema */
export const DashboardSchema = z.object({
  /** API server port */
  port: z.number().default(9095),
  /** UI dev server port */
  uiPort: z.number().default(9091),
  /** Predefined API endpoints for the explorer */
  presets: z.array(PresetGroupSchema).optional(),
  /** Default environment variables for the env editor */
  envDefaults: z.record(z.string()).optional(),
  /** Default directories to browse in container */
  defaultDirs: z.array(z.string()).optional(),
});

/** Network configuration schema */
export const NetworkSchema = z.object({
  /** Docker network name */
  name: z.string().default('e2e-network'),
});

// =====================================================================
// Complete E2E Configuration Schema
// =====================================================================

/** Complete E2E configuration Zod schema */
export const E2EConfigSchema = z.object({
  /** Config schema version */
  version: z.string().default('1'),
  /** Project metadata */
  project: z.object({
    name: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
  /** Service under test */
  service: z.object({
    build: ServiceBuildSchema,
    container: ServiceContainerSchema,
    vars: z.record(z.string()).optional(),
  }),
  /** Mock service definitions */
  mocks: z.record(MockServiceSchema).optional(),
  /** Test suite definitions */
  tests: z.object({
    suites: z.array(TestSuiteSchema),
  }).optional(),
  /** Dashboard configuration */
  dashboard: DashboardSchema.optional(),
  /** Docker network configuration */
  network: NetworkSchema.optional(),
  /** Git repositories for branch selection */
  repos: z.array(RepoConfigSchema).optional(),
});

/** Validated configuration type inferred from the Zod schema */
export type ValidatedE2EConfig = z.infer<typeof E2EConfigSchema>;

// =====================================================================
// Config Loader
// =====================================================================

/**
 * Load and validate an e2e-toolkit configuration file.
 *
 * Steps:
 * 1. Load `.env` from the config file's directory
 * 2. Read the YAML configuration file
 * 3. Parse YAML content
 * 4. Substitute `{{env.XXX}}` and `{{config.xxx}}` variables
 * 5. Validate with Zod schema
 *
 * @param configPath - Path to the configuration file.
 *   Defaults to `e2e.yaml` or `e2e.yml` in the current working directory.
 * @returns Validated E2E configuration
 * @throws {Error} If file not found, YAML syntax error, or validation fails
 */
export async function loadConfig(configPath?: string): Promise<E2EConfig> {
  // Resolve config file path
  const resolvedPath = await resolveConfigPath(configPath);

  // 1. Load .env file from the config file's directory
  const configDir = path.dirname(resolvedPath);
  dotenv.config({ path: path.resolve(configDir, '.env') });

  // 2. Read YAML file
  let rawContent: string;
  try {
    rawContent = await fs.readFile(resolvedPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${resolvedPath}`);
    }
    throw err;
  }

  // 3. Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(rawContent);
  } catch (err) {
    throw new Error(
      `YAML syntax error in ${resolvedPath}: ${(err as Error).message}`,
    );
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    throw new Error(
      `Configuration file is empty or not a valid object: ${resolvedPath}`,
    );
  }

  // 4. Variable substitution (env variables + config vars)
  const rawConfig = parsed as Record<string, unknown>;
  const vars = extractVars(rawConfig);
  const context = {
    config: vars,
    runtime: {},
    env: { ...process.env } as Record<string, string>,
  };
  const resolved = resolveObjectVariables(rawConfig, context);

  // 5. Zod validation
  const result = E2EConfigSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }

  return result.data as E2EConfig;
}

// =====================================================================
// Internal Helpers
// =====================================================================

/**
 * Resolve the configuration file path.
 * If no explicit path is given, looks for `e2e.yaml` then `e2e.yml` in cwd.
 */
async function resolveConfigPath(configPath?: string): Promise<string> {
  if (configPath) {
    return path.resolve(configPath);
  }

  const cwd = process.cwd();
  const yamlPath = path.resolve(cwd, 'e2e.yaml');
  const ymlPath = path.resolve(cwd, 'e2e.yml');

  try {
    await fs.access(yamlPath);
    return yamlPath;
  } catch {
    // Try .yml extension
  }

  try {
    await fs.access(ymlPath);
    return ymlPath;
  } catch {
    // Neither found
  }

  throw new Error(
    `Configuration file not found. Looked for:\n  - ${yamlPath}\n  - ${ymlPath}`,
  );
}

/**
 * Extract `service.vars` from the raw parsed config object (before Zod validation).
 * This allows variable substitution to use config-defined vars.
 */
function extractVars(raw: Record<string, unknown>): Record<string, string> {
  const service = raw['service'];
  if (service && typeof service === 'object' && service !== null) {
    const vars = (service as Record<string, unknown>)['vars'];
    if (vars && typeof vars === 'object' && vars !== null) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(vars as Record<string, unknown>)) {
        result[key] = String(value);
      }
      return result;
    }
  }
  return {};
}
