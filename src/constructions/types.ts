import type { Librarian } from '../api/librarian.js';
import type { IEvidenceLedger } from '../epistemics/evidence_ledger.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import type { ConstructionError } from './base/construction_base.js';
import type { ConstructionCalibrationTracker } from './calibration_tracker.js';

/**
 * Base dependency requirements for constructions.
 */
export interface ConstructionRequirements {
  readonly librarian: Librarian;
}

/**
 * Default dependency context for canonical constructions.
 */
export interface LibrarianContext extends ConstructionRequirements {
  readonly librarian: Librarian;
  readonly calibrationTracker?: ConstructionCalibrationTracker;
  readonly evidenceLedger?: IEvidenceLedger;
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
  traceContext?: Record<string, unknown>;
}

/**
 * Layer pattern: upgrade a context with additional requirement capabilities.
 */
export type Layer<R1, R2 extends R1> = (base: Context<R1>) => Context<R2>;

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
