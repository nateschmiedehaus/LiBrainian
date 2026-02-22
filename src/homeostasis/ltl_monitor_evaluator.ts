/**
 * @fileoverview LTL safety monitor evaluator.
 *
 * Evaluates registered safety properties on indexing completion and emits
 * `safety_violation` events for violations.
 */

import type { LibrarianEventBus } from '../events.js';
import { createSafetyViolationEvent } from '../events.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { GraphEdge, LibrarianEvent } from '../types.js';

export type SafetyViolationSeverity = 'warn' | 'block';

export interface SafetyViolationEvidence {
  sourceFile: string;
  importPath: string;
  edgeType: 'imports';
  fromId: string;
  toId: string;
  sourceLine: number | null;
}

export interface SafetyViolation {
  monitorId: string;
  violatedProperty: string;
  severity: SafetyViolationSeverity;
  evidence: SafetyViolationEvidence;
  description: string;
}

export interface LTLSafetyProperty {
  id: string;
  evaluate(edges: readonly GraphEdge[]): SafetyViolation[];
}

interface BlockedImportRule {
  monitorId: string;
  violatedProperty: string;
  severity: SafetyViolationSeverity;
  description: string;
  fromPattern: RegExp;
  toPattern: RegExp;
}

const DEFAULT_BLOCKED_IMPORT_RULE: BlockedImportRule = {
  monitorId: 'ltl.no_direct_mcp_to_storage_imports',
  violatedProperty: 'G(no_direct_mcp_to_storage_imports)',
  severity: 'block',
  description: 'MCP modules must import storage via API abstractions, never directly.',
  fromPattern: /(^|\/)src\/mcp\//,
  toPattern: /(^|\/)src\/storage\//,
};

function normalizePath(pathLike: string): string {
  return pathLike
    .replace(/\\/g, '/')
    .replace(/^module:/, '')
    .replace(/^file:/, '');
}

function createBlockedImportProperty(rule: BlockedImportRule): LTLSafetyProperty {
  return {
    id: rule.monitorId,
    evaluate(edges: readonly GraphEdge[]): SafetyViolation[] {
      const violations: SafetyViolation[] = [];

      for (const edge of edges) {
        if (edge.edgeType !== 'imports') {
          continue;
        }

        const sourceFile = normalizePath(edge.sourceFile || edge.fromId);
        const importPath = normalizePath(edge.toId);
        if (!sourceFile || !importPath) {
          continue;
        }

        if (!rule.fromPattern.test(sourceFile) || !rule.toPattern.test(importPath)) {
          continue;
        }

        violations.push({
          monitorId: rule.monitorId,
          violatedProperty: rule.violatedProperty,
          severity: rule.severity,
          description: rule.description,
          evidence: {
            sourceFile,
            importPath,
            edgeType: 'imports',
            fromId: edge.fromId,
            toId: edge.toId,
            sourceLine: edge.sourceLine ?? null,
          },
        });
      }

      return violations;
    },
  };
}

export interface LTLMonitorEvaluatorConfig {
  storage: Pick<LibrarianStorage, 'getGraphEdges'>;
  eventBus: LibrarianEventBus;
  properties?: readonly LTLSafetyProperty[];
}

/**
 * Evaluates safety properties whenever indexing completes.
 */
export class LTLMonitorEvaluator {
  private readonly storage: Pick<LibrarianStorage, 'getGraphEdges'>;
  private readonly eventBus: LibrarianEventBus;
  private readonly properties: LTLSafetyProperty[];

  constructor(config: LTLMonitorEvaluatorConfig) {
    this.storage = config.storage;
    this.eventBus = config.eventBus;
    this.properties = [...(config.properties ?? [createBlockedImportProperty(DEFAULT_BLOCKED_IMPORT_RULE)])];
  }

  registerProperty(property: LTLSafetyProperty): void {
    this.properties.push(property);
  }

  async evaluateOnIndexingComplete(event: LibrarianEvent): Promise<SafetyViolation[]> {
    if (event.type !== 'indexing_complete') {
      return [];
    }

    const importEdges = await this.storage.getGraphEdges({ edgeTypes: ['imports'] });
    const violations = this.evaluateEdges(importEdges);

    for (const violation of violations) {
      await this.eventBus.emit(createSafetyViolationEvent(violation));
    }

    return violations;
  }

  evaluateEdges(edges: readonly GraphEdge[]): SafetyViolation[] {
    const violations: SafetyViolation[] = [];
    for (const property of this.properties) {
      violations.push(...property.evaluate(edges));
    }
    return violations;
  }
}

export function createLTLMonitorEvaluator(config: LTLMonitorEvaluatorConfig): LTLMonitorEvaluator {
  return new LTLMonitorEvaluator(config);
}

