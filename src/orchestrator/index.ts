/**
 * @fileoverview Unified LiBrainian Orchestrator Module
 *
 * This module provides the PRIMARY entry point for AI agents to use LiBrainian.
 * A single function call sets up everything needed for optimal codebase understanding.
 *
 * @example
 * ```typescript
 * import { initializeLiBrainian } from 'librainian/orchestrator';
 *
 * // One function call does everything
 * const session = await initializeLiBrainian('/path/to/workspace');
 *
 * // Query the codebase
 * const context = await session.query('How does authentication work?');
 *
 * // Record outcomes for calibration
 * await session.recordOutcome({ success: true, packIds: context.packIds });
 *
 * // Check health
 * const health = session.health();
 * ```
 *
 * @packageDocumentation
 */

export {
  // Main entry point
  initializeLiBrainian,

  // Session management
  hasSession,
  getSession,
  shutdownAllSessions,
  getActiveSessionCount,

  // Types
  type LiBrainianSession,
  type TaskResult,
  type HealthReport,
  type Context,
  type InitializeOptions,
  type QueryOptions,
} from './unified_init.js';
