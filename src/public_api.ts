/**
 * @fileoverview Stable public npm surface for LiBrainian.
 *
 * Keep this file intentionally narrow. The repository contains broader
 * internal modules and contributor tooling, but the published package root
 * should expose only the first-release contract.
 *
 * @packageDocumentation
 */

export {
  initializeLibrarian,
  hasSession,
  getSession,
  shutdownAllSessions,
  getActiveSessionCount,
} from './orchestrator/index.js';
export type {
  LibrarianSession,
  TaskResult,
  HealthReport,
  Context,
  InitializeOptions,
  QueryOptions,
} from './orchestrator/index.js';
