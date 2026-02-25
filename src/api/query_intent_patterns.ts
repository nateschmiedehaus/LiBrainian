/**
 * Keywords that indicate a meta-query about usage, integration, or concepts.
 * These queries should prefer documentation over code.
 */
export const META_QUERY_PATTERNS: RegExp[] = [
  /\bhow\s+(should|do|does|can|to)\b/i,
  /\bhow\s+.*\s+(use|integrate|work|configure)\b/i,
  /\bwhat\s+is\b/i,
  /\bwhat\s+are\b/i,
  /\bexplain\b/i,
  /\bguide\b/i,
  /\bdocumentation\b/i,
  /\bintroduction\b/i,
  /\bgetting\s+started\b/i,
  /\boverview\b/i,
  /\bworkflow\b/i,
  /\bbest\s+practice/i,
  /\bagent\b.*\buse\b/i,
  /\buse\b.*\bagent\b/i,
  /\blibrarian\b/i,
];

/**
 * Keywords that indicate a code-specific query (implementation details).
 * These queries should prefer code entities over documentation.
 */
export const CODE_QUERY_PATTERNS: RegExp[] = [
  /\bfunction\b.*\b(called|named|does)\b/i,
  /\bmethod\b/i,
  /\bclass\b.*\b(called|named)\b/i,
  /\bimplementation\b/i,
  /\bbug\b/i,
  /\bfix\b/i,
  /\berror\b/i,
  /\bwhere\s+is\b.*\b(defined|implemented)\b/i,
  /\bcall\s+graph\b/i,
  /\bdependenc(y|ies)\b/i,
];

/**
 * Keywords that indicate a definition/contract query.
 * These queries should prioritize TypeScript interface/type declarations
 * over function implementations (abstract boundaries over concrete code).
 */
export const DEFINITION_QUERY_PATTERNS: RegExp[] = [
  /\binterface\b/i,
  /\btype\s+(alias|definition|declaration)\b/i,
  /\btype\b.*\b(for|of)\b/i,
  /\btype\s+definitions?\b/i,
  /\bcontract\b/i,
  /\babstract(ion|ions)?\b/i,
  /\bdefinition\b/i,
  /\bdeclare[ds]?\b/i,
  /\bschema\b/i,
  /\bsignature\b/i,
  /\bapi\s+(surface|boundary|contract)\b/i,
  /\bwhat\s+(is|are)\s+the\s+(storage|query|embedding)\s+interface/i,
  /\bstorage\s+interface\b/i,
  /\bquery\s+interface\b/i,
  /\b(\w+)\s+interface\s+definition\b/i,
  /\b(\w+)\s+type\s+definition\b/i,
  /\bwhere\s+is\s+(\w+)\s+(interface|type)\b/i,
];
