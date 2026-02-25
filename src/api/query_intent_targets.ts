/**
 * Extract the refactoring target from a refactoring safety query.
 * Returns the entity name/identifier that the user wants to refactor.
 */
export function extractRefactoringTarget(intent: string): string | undefined {
  const targetPatterns = [
    /(?:changed?|modif(?:y|ied)|renamed?|deleted?|removed?)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    /(?:rename|change|delete|modify|remove|refactor)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    /(?:changing|modifying|renaming|deleting|removing)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    /refactor(?:ing)?\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    /(?:depends\s+on|uses|calls|imports)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
  ];

  for (const pattern of targetPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Extract bug context from a bug investigation query.
 * Returns error description, stack trace hints, or suspected file/module.
 */
export function extractBugContext(intent: string): string | undefined {
  const contextPatterns = [
    /(?:error|bug|issue|problem)\s+in\s+([A-Za-z0-9_./-]+)/i,
    /(null\s*pointer|undefined\s+error|type\s*error|reference\s*error)/i,
    /(?:error|exception|crash):\s*(.+?)(?:\.|$)/i,
    /(?:crash|fail|error)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/i,
  ];

  for (const pattern of contextPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

/**
 * Extract security check types from a security audit query.
 * Returns the specific vulnerability types to check.
 */
export function extractSecurityCheckTypes(intent: string): string[] {
  const types: string[] = [];

  if (/sql\s*injection/i.test(intent)) types.push('injection');
  if (/xss|cross.?site/i.test(intent)) types.push('injection');
  if (/command\s*injection/i.test(intent)) types.push('injection');
  if (/auth|authentication|authorization/i.test(intent)) types.push('auth');
  if (/crypto|encryption|hash/i.test(intent)) types.push('crypto');
  if (/expos|leak|sensitive/i.test(intent)) types.push('exposure');

  if (types.length === 0) {
    types.push('injection', 'auth', 'crypto', 'exposure');
  }

  return types;
}

/**
 * Extract the feature target from a feature location query.
 * Returns the feature name/functionality being searched for.
 */
export function extractFeatureTarget(intent: string): string | undefined {
  const targetPatterns = [
    /where\s+is\s+(?:the\s+)?(\w+)\s+(?:implemented|defined|located)/i,
    /find\s+(?:the\s+)?(\w+)\s+feature/i,
    /locate\s+(?:the\s+)?(?:implementation|code)\s+(?:for|of)\s+(\w+)/i,
    /which\s+files?\s+(?:implement|contain|handle)\s+(?:the\s+)?(\w+)/i,
    /where\s+(?:does|is)\s+(?:the\s+)?(\w+)\s+(?:happen|occur|get\s+handled)/i,
  ];

  for (const pattern of targetPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Extract file path from a code review query.
 * Returns the file path to review if mentioned.
 */
export function extractCodeReviewFilePath(intent: string): string | undefined {
  const patterns = [
    /review\s+(?:file\s+)?["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']?/i,
    /check\s+["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']?/i,
    /code\s+review\s+(?:for\s+)?["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']?/i,
    /["']([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}
