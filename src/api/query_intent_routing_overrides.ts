import path from 'node:path';
import type { QueryIntentType } from '../types.js';
import type { EmbeddableEntityType } from '../storage/types.js';

export interface IntentRoutingClassification {
  isMetaQuery: boolean;
  isCodeQuery: boolean;
  isTestQuery: boolean;
  isProjectUnderstandingQuery: boolean;
  isRefactoringSafetyQuery: boolean;
  isBugInvestigationQuery: boolean;
  isSecurityAuditQuery: boolean;
  documentBias: number;
  entityTypes: EmbeddableEntityType[];
  refactoringTarget?: string;
  bugContext?: string;
  securityCheckTypes?: string[];
}

function normalizeEntityTypeOrder(types: EmbeddableEntityType[]): EmbeddableEntityType[] {
  const deduped: EmbeddableEntityType[] = [];
  for (const type of types) {
    if (!deduped.includes(type)) deduped.push(type);
  }
  return deduped;
}

function inferTargetFromAffectedFiles(affectedFiles: string[] | undefined): string | undefined {
  if (!affectedFiles?.length) return undefined;
  const first = affectedFiles.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (!first) return undefined;
  const parsed = path.parse(first.trim());
  if (parsed.name) return parsed.name;
  return undefined;
}

/**
 * Applies deterministic intent-type routing overrides to query classification.
 * This allows explicit intentType callers to steer retrieval even when intent
 * text is ambiguous or generic.
 */
export function applyIntentTypeRoutingOverrides<T extends IntentRoutingClassification>(
  classification: T,
  intentType: QueryIntentType | undefined,
  affectedFiles?: string[]
): T {
  const normalized = intentType ?? 'general';
  if (normalized === 'general' || normalized === 'understand') {
    return classification;
  }

  const routed: T = {
    ...classification,
    entityTypes: [...classification.entityTypes],
    securityCheckTypes: classification.securityCheckTypes ? [...classification.securityCheckTypes] : undefined,
  };

  switch (normalized) {
    case 'document':
      routed.isMetaQuery = true;
      routed.isCodeQuery = false;
      routed.isTestQuery = false;
      routed.documentBias = Math.max(routed.documentBias, 0.9);
      routed.entityTypes = normalizeEntityTypeOrder(['document', 'module', 'function', ...routed.entityTypes]);
      return routed;
    case 'navigate':
      routed.isMetaQuery = false;
      routed.isCodeQuery = true;
      routed.isProjectUnderstandingQuery = false;
      routed.documentBias = Math.min(routed.documentBias, 0.2);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'impact':
      routed.isRefactoringSafetyQuery = true;
      routed.refactoringTarget = routed.refactoringTarget ?? inferTargetFromAffectedFiles(affectedFiles);
      routed.documentBias = Math.max(routed.documentBias, 0.35);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'refactor':
      routed.isRefactoringSafetyQuery = true;
      routed.refactoringTarget = routed.refactoringTarget ?? inferTargetFromAffectedFiles(affectedFiles);
      routed.documentBias = Math.min(routed.documentBias, 0.25);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'debug':
      routed.isBugInvestigationQuery = true;
      routed.bugContext = routed.bugContext ?? inferTargetFromAffectedFiles(affectedFiles);
      routed.documentBias = Math.min(routed.documentBias, 0.25);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'security':
      routed.isSecurityAuditQuery = true;
      routed.securityCheckTypes = routed.securityCheckTypes?.length ? routed.securityCheckTypes : ['all'];
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'test':
      routed.isTestQuery = true;
      routed.isCodeQuery = true;
      routed.isMetaQuery = false;
      routed.documentBias = Math.min(routed.documentBias, 0.15);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    default:
      return routed;
  }
}
