import type { EmbeddableEntityType } from '../storage/types.js';

export interface QueryIntentBiasProfileInput {
  metaMatches: number;
  definitionMatches: number;
  entryPointMatches: number;
  projectUnderstandingMatches: number;
  whyMatches: number;
  architectureOverviewMatches: number;
  isMetaQuery: boolean;
  isCodeQuery: boolean;
  isDefinitionQuery: boolean;
  isTestQuery: boolean;
  isEntryPointQuery: boolean;
  isProjectUnderstandingQuery: boolean;
  isWhyQuery: boolean;
  isArchitectureOverviewQuery: boolean;
}

export interface QueryIntentBiasProfile {
  documentBias: number;
  definitionBias: number;
  entryPointBias: number;
  projectUnderstandingBias: number;
  rationaleBias: number;
  architectureOverviewBias: number;
  entityTypes: EmbeddableEntityType[];
}

/**
 * Derive retrieval biases and entity-type routing from classified query intent.
 * This function must remain behavior-compatible with the legacy logic from query.ts.
 */
export function buildQueryIntentBiasProfile(input: QueryIntentBiasProfileInput): QueryIntentBiasProfile {
  const {
    metaMatches,
    definitionMatches,
    entryPointMatches,
    projectUnderstandingMatches,
    whyMatches,
    architectureOverviewMatches,
    isMetaQuery,
    isCodeQuery,
    isDefinitionQuery,
    isTestQuery,
    isEntryPointQuery,
    isProjectUnderstandingQuery,
    isWhyQuery,
    isArchitectureOverviewQuery,
  } = input;

  let documentBias = 0.3;
  if (isWhyQuery) {
    documentBias = 0.9;
  } else if (isProjectUnderstandingQuery) {
    documentBias = 0.95;
  } else if (isMetaQuery) {
    documentBias = 0.7 + (metaMatches * 0.05);
  } else if (isCodeQuery || isTestQuery) {
    documentBias = 0.1;
  }
  documentBias = Math.min(1.0, documentBias);

  let definitionBias = 0.0;
  if (isDefinitionQuery) {
    definitionBias = 0.6 + (definitionMatches * 0.1);
    definitionBias = Math.min(1.0, definitionBias);
  }

  let entryPointBias = 0.0;
  if (isEntryPointQuery) {
    entryPointBias = 0.6 + (entryPointMatches * 0.1);
    entryPointBias = Math.min(1.0, entryPointBias);
  }

  let projectUnderstandingBias = 0.0;
  if (isProjectUnderstandingQuery) {
    projectUnderstandingBias = 0.8 + (projectUnderstandingMatches * 0.05);
    projectUnderstandingBias = Math.min(1.0, projectUnderstandingBias);
  }

  let rationaleBias = 0.0;
  if (isWhyQuery) {
    rationaleBias = 0.7 + (whyMatches * 0.1);
    rationaleBias = Math.min(1.0, rationaleBias);
  }

  let architectureOverviewBias = 0.0;
  if (isArchitectureOverviewQuery) {
    architectureOverviewBias = 0.75 + (architectureOverviewMatches * 0.05);
    architectureOverviewBias = Math.min(1.0, architectureOverviewBias);
    documentBias = Math.max(documentBias, 0.8);
  }

  const entityTypes: EmbeddableEntityType[] = [];
  if (isTestQuery) {
    entityTypes.push('function', 'module');
  } else if (isWhyQuery) {
    entityTypes.push('document', 'function', 'module');
  } else if (isProjectUnderstandingQuery) {
    entityTypes.push('document');
  } else if (isArchitectureOverviewQuery) {
    entityTypes.push('module', 'document');
  } else if (isMetaQuery) {
    entityTypes.push('document', 'function', 'module');
  } else if (isCodeQuery) {
    entityTypes.push('function', 'module');
  } else {
    entityTypes.push('function', 'module', 'document');
  }

  return {
    documentBias,
    definitionBias,
    entryPointBias,
    projectUnderstandingBias,
    rationaleBias,
    architectureOverviewBias,
    entityTypes,
  };
}
