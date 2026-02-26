/**
 * @module resilience/error-codes
 * Structured error types, error code registry, and factory for the resilience subsystem.
 *
 * Provides machine-readable error codes so AI Agents can programmatically
 * decide recovery actions without parsing free-text messages.
 */

// =====================================================================
// Error Code Union & Enums
// =====================================================================

/** All known ArgusAI infrastructure error codes. */
export type ArgusErrorCode =
  | 'DOCKER_UNAVAILABLE'
  | 'DISK_SPACE_LOW'
  | 'PORT_CONFLICT'
  | 'PORT_EXHAUSTION'
  | 'CONTAINER_OOM'
  | 'CONTAINER_CRASH'
  | 'CONTAINER_RESTART_EXHAUSTED'
  | 'HEALTH_CHECK_TIMEOUT'
  | 'NETWORK_UNREACHABLE'
  | 'DNS_RESOLUTION_FAILED'
  | 'CIRCUIT_OPEN'
  | 'ORPHAN_DETECTED'
  | 'CLEANUP_FAILED';

/** Broad classification of error origin. */
export type ErrorCategory = 'infrastructure' | 'container' | 'network' | 'system';

/** Impact severity guiding recovery strategy. */
export type ErrorSeverity = 'fatal' | 'recoverable' | 'warning';

/** Machine-readable error object returned by all resilience operations. */
export interface StructuredError {
  code: ArgusErrorCode;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  details: Record<string, unknown>;
  suggestedActions: string[];
  timestamp: number;
}

// =====================================================================
// Error Metadata Registry
// =====================================================================

interface ErrorMetadataEntry {
  category: ErrorCategory;
  defaultSeverity: ErrorSeverity;
  suggestedActions: string[];
}

/** Default classification and recovery hints for every error code. */
export const ERROR_METADATA: ReadonlyMap<ArgusErrorCode, ErrorMetadataEntry> = new Map<ArgusErrorCode, ErrorMetadataEntry>([
  ['DOCKER_UNAVAILABLE', {
    category: 'infrastructure',
    defaultSeverity: 'fatal',
    suggestedActions: ['Start Docker daemon', 'Check DOCKER_HOST environment variable', 'Verify Docker installation'],
  }],
  ['DISK_SPACE_LOW', {
    category: 'infrastructure',
    defaultSeverity: 'warning',
    suggestedActions: ['Run docker system prune', 'Free disk space', 'Increase disk space threshold in config'],
  }],
  ['PORT_CONFLICT', {
    category: 'network',
    defaultSeverity: 'recoverable',
    suggestedActions: ['Use auto port resolution', 'Stop conflicting process', 'Change configured port'],
  }],
  ['PORT_EXHAUSTION', {
    category: 'network',
    defaultSeverity: 'fatal',
    suggestedActions: ['Release occupied ports', 'Reduce number of services', 'Check for port leaks'],
  }],
  ['CONTAINER_OOM', {
    category: 'container',
    defaultSeverity: 'recoverable',
    suggestedActions: ['Increase container memory limit', 'Optimize application memory usage', 'Enable container auto-restart'],
  }],
  ['CONTAINER_CRASH', {
    category: 'container',
    defaultSeverity: 'recoverable',
    suggestedActions: ['Check container logs', 'Verify container configuration', 'Enable container auto-restart'],
  }],
  ['CONTAINER_RESTART_EXHAUSTED', {
    category: 'container',
    defaultSeverity: 'fatal',
    suggestedActions: ['Inspect restart history diagnostics', 'Fix underlying application error', 'Increase maxRestarts if transient'],
  }],
  ['HEALTH_CHECK_TIMEOUT', {
    category: 'container',
    defaultSeverity: 'recoverable',
    suggestedActions: ['Increase health check timeout', 'Check health check endpoint', 'Inspect container logs'],
  }],
  ['NETWORK_UNREACHABLE', {
    category: 'network',
    defaultSeverity: 'recoverable',
    suggestedActions: ['Verify Docker network configuration', 'Check container network attachments', 'Recreate Docker network'],
  }],
  ['DNS_RESOLUTION_FAILED', {
    category: 'network',
    defaultSeverity: 'recoverable',
    suggestedActions: ['Verify containers are on the same network', 'Check container hostnames', 'Restart Docker DNS'],
  }],
  ['CIRCUIT_OPEN', {
    category: 'system',
    defaultSeverity: 'fatal',
    suggestedActions: ['Call argus_reset_circuit to probe', 'Fix underlying Docker issue', 'Check Docker daemon status'],
  }],
  ['ORPHAN_DETECTED', {
    category: 'infrastructure',
    defaultSeverity: 'warning',
    suggestedActions: ['Enable cleanOrphans in preflight config', 'Run argus_preflight_check with autoFix', 'Manually remove orphaned resources'],
  }],
  ['CLEANUP_FAILED', {
    category: 'infrastructure',
    defaultSeverity: 'warning',
    suggestedActions: ['Check Docker daemon connectivity', 'Manually remove stuck resources', 'Check filesystem mount status'],
  }],
]);

// =====================================================================
// Factory Function
// =====================================================================

/**
 * Create a complete StructuredError from an error code.
 *
 * Resolves category and severity from the registry, with optional overrides.
 *
 * @param code - ArgusAI error code
 * @param message - Human-readable error message
 * @param details - Additional contextual data
 * @param severityOverride - Override the default severity from the registry
 * @returns Complete StructuredError object
 */
export function createStructuredError(
  code: ArgusErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  severityOverride?: ErrorSeverity,
): StructuredError {
  const metadata = ERROR_METADATA.get(code);
  if (!metadata) {
    return {
      code,
      category: 'system',
      severity: severityOverride ?? 'fatal',
      message,
      details,
      suggestedActions: [],
      timestamp: Date.now(),
    };
  }

  return {
    code,
    category: metadata.category,
    severity: severityOverride ?? metadata.defaultSeverity,
    message,
    details,
    suggestedActions: [...metadata.suggestedActions],
    timestamp: Date.now(),
  };
}

// =====================================================================
// ArgusError Class
// =====================================================================

/**
 * Error subclass wrapping a StructuredError for throw/catch patterns.
 *
 * Use `toJSON()` for serialization into MCP response envelopes.
 */
export class ArgusError extends Error {
  public readonly structuredError: StructuredError;

  constructor(
    code: ArgusErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    severityOverride?: ErrorSeverity,
  ) {
    super(message);
    this.name = 'ArgusError';
    this.structuredError = createStructuredError(code, message, details, severityOverride);
  }

  /** Serialize the structured error payload for JSON transport. */
  toJSON(): StructuredError {
    return this.structuredError;
  }

  get code(): ArgusErrorCode {
    return this.structuredError.code;
  }

  get category(): ErrorCategory {
    return this.structuredError.category;
  }

  get severity(): ErrorSeverity {
    return this.structuredError.severity;
  }
}
