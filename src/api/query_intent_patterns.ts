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

/**
 * Keywords that indicate a query about entry points.
 * These queries should prioritize entry point knowledge (main files, factories,
 * CLI entries) over random internal functions.
 */
export const ENTRY_POINT_QUERY_PATTERNS: RegExp[] = [
  /\bentry\s*point/i,
  /\bmain\s*(file|module|entry|function)?/i,
  /\bstart(ing)?\s*(point|file)?/i,
  /\binitialize?\b/i,
  /\bwhere\s+(to\s+)?start/i,
  /\bhow\s+to\s+(use|start|run|begin)/i,
  /\bAPI\s*(entry|main)/i,
  /\bcli\s*(entry|command|binary)?/i,
  /\bbin(ary)?\s*(entry)?/i,
  /\bfactory\s*(function)?/i,
  /\bcreate[A-Z]\w+/,
  /\bmake[A-Z]\w+/,
  /\bprimary\s*(export|api)/i,
  /\bpackage\.json\s*(main|bin|exports)/i,
  /\broot\s*(module|file)/i,
  /\bindex\s*(file|module|\.ts|\.js)/i,
];

/**
 * Keywords that indicate a WHY query about rationale/reasoning.
 * These queries should prioritize ADRs, design docs, and explanatory content.
 */
export const WHY_QUERY_PATTERNS: RegExp[] = [
  /\bwhy\b.*\b(use[ds]?|choose|chose|chosen|have|is|are|does|did|was|were|prefer|pick|select|adopt|implement|went\s+with)\b/i,
  /\bwhy\s+[A-Za-z0-9_-]+\b/i,
  /\bwhy\b.*\binstead\s+of\b/i,
  /\bwhy\b.*\bover\b/i,
  /\bwhy\b.*\brather\s+than\b/i,
  /\bwhy\b.*\bnot\b.*\b(use|have)\b/i,
  /\breason(s)?\s+(for|why)\b/i,
  /\brationale\s+(for|behind)\b/i,
  /\bjustification\s+for\b/i,
  /\bdecision\s+(to|behind|for)\b/i,
  /\bdesign\s+decision\b/i,
  /\barchitectural\s+decision\b/i,
  /\bwhat\s+motivated\b/i,
  /\breasoning\s+behind\b/i,
  /\bwhat(?:'s| is) the (?:reason|rationale|motivation)\b/i,
];
