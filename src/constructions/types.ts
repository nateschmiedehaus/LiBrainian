import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import type { ConstructionError } from './base/construction_base.js';

/**
 * Default dependency context for canonical constructions.
 */
export interface LibrarianContext {
  librarian: Librarian;
}

/**
 * Call-time execution context for canonical constructions.
 */
export interface Context<R = LibrarianContext> {
  deps: R;
  signal: AbortSignal;
  sessionId: string;
  tokenBudget?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Canonical construction interface used for composition and adapter bridging.
 *
 * Type parameters:
 * - I: input type
 * - O: output type
 * - E: error type channel (reserved for typed-outcome migration)
 * - R: dependency context requirements
 */
export interface Construction<
  I,
  O,
  E extends ConstructionError = ConstructionError,
  R = LibrarianContext,
> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  execute(input: I, context?: Context<R>): Promise<O>;
  getEstimatedConfidence?(): ConfidenceValue;
  readonly __errorType?: E;
}
