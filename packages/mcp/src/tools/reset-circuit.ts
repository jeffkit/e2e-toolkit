/**
 * @module tools/reset-circuit
 * argus_reset_circuit — Reset the circuit breaker to probe Docker availability.
 *
 * When the circuit is open, transitions it to half-open so the next
 * Docker operation acts as a probe. If already closed, this is a no-op.
 */

import type { CircuitState, CircuitBreakerState } from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';

export interface ResetCircuitResult {
  previousState: CircuitState;
  currentState: CircuitState;
  failureHistory: CircuitBreakerState['failureHistory'];
  message: string;
}

/**
 * Handle the argus_reset_circuit MCP tool call.
 *
 * @param params - Tool input with projectPath
 * @param sessionManager - Session store for tracking project state
 * @returns Previous and current circuit breaker state
 */
export async function handleResetCircuit(
  params: { projectPath: string },
  sessionManager: SessionManager,
): Promise<ResetCircuitResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (!session.circuitBreaker) {
    throw new SessionError(
      'INVALID_STATE',
      'No circuit breaker is configured for this session',
    );
  }

  const stateBefore = session.circuitBreaker.getState();
  const { previous, current } = session.circuitBreaker.reset();

  const message =
    previous === current
      ? `Circuit breaker already in "${previous}" state — no action taken`
      : `Circuit breaker transitioned from "${previous}" to "${current}"`;

  return {
    previousState: previous,
    currentState: current,
    failureHistory: stateBefore.failureHistory,
    message,
  };
}
