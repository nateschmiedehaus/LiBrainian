const FILE_PATH_EXTENSION_PATTERN = '(?:ts|js|tsx|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala|md|json|yaml|yml|toml|ini|sql|sh)';

interface IntentAnchorHint {
  patterns: RegExp[];
  files: string[];
}

const INTENT_ANCHOR_HINTS: IntentAnchorHint[] = [
  {
    // Query-pipeline orientation should anchor to the orchestrator module, not
    // sibling pipelines that happen to include the word "pipeline".
    patterns: [
      /\bquery\s+pipeline\b/i,
    ],
    files: [
      'src/api/query.ts',
      'src/api/query_synthesis.ts',
      'src/api/query_intent.ts',
    ],
  },
  {
    // Runtime MCP recovery queries should anchor directly to the server-side
    // error envelope path instead of generic tool/error utilities.
    patterns: [
      /\bmcp\b/i,
      /\btool(?:\s+calls?)?\b/i,
      /\b(?:error|errors|timeout|timeouts|failure|failures|retry|fallback|recover|recovery|storage|provider|degraded|unavailable|busy)\b/i,
    ],
    files: [
      'src/mcp/server.ts',
      'src/cli/commands/mcp.ts',
      'src/cli/errors.ts',
    ],
  },
  {
    // Bootstrap debugging and self-hosting queries should anchor to the phase
    // orchestration, postcondition validation, and storage lifecycle paths.
    patterns: [
      /\bbootstrap\b/i,
      /\b(?:semantic[_\s]?index(?:ing)?|postcondition|validation|storage\s+initialization|initialize\(\)|initialized)\b/i,
    ],
    files: [
      'src/api/bootstrap.ts',
      'src/preflight/validation_gates.ts',
      'src/storage/sqlite_storage.ts',
      'src/cli/commands/bootstrap.ts',
    ],
  },
];

function sanitizeExtractedPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replace(/^[`"'([{]+/, '')
    .replace(/[`"'\])},.:;!?]+$/, '')
    .replace(/\\/g, '/');
  if (!normalized || normalized.includes('://')) return undefined;
  return normalized;
}

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
    /where\s+is\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,4})\s+(?:implemented|defined|located)\b/i,
    /find\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,4})\s+feature\b/i,
    /locate\s+(?:the\s+)?(?:implementation|code)\s+(?:for|of)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,4})\b/i,
    /which\s+files?\s+(?:implement|contain|handle)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,4})\b/i,
    /where\s+(?:does|is)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,4})\s+(?:happen|occur|get\s+handled)\b/i,
    /where\s+(?:do|does)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,6})\s+live\b/i,
  ];

  for (const pattern of targetPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1].trim().replace(/\s+/g, ' ');
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
    new RegExp(`review\\s+(?:file\\s+)?["']?([^\\s"']+\\.${FILE_PATH_EXTENSION_PATTERN})["']?`, 'i'),
    new RegExp(`check\\s+["']?([^\\s"']+\\.${FILE_PATH_EXTENSION_PATTERN})["']?`, 'i'),
    new RegExp(`code\\s+review\\s+(?:for\\s+)?["']?([^\\s"']+\\.${FILE_PATH_EXTENSION_PATTERN})["']?`, 'i'),
    new RegExp(`["']([^\\s"']+\\.${FILE_PATH_EXTENSION_PATTERN})["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return sanitizeExtractedPath(match[1]);
    }
  }
  return undefined;
}

/**
 * Extract an explicit file path mention from any intent text.
 * Used to deterministically anchor retrieval for file-specific queries.
 */
export function extractReferencedFilePath(intent: string): string | undefined {
  const patterns = [
    new RegExp(`["'\`]((?:[A-Za-z]:[\\\\/])?(?:[A-Za-z0-9._@-]+[\\\\/])+[A-Za-z0-9._@-]+\\.${FILE_PATH_EXTENSION_PATTERN})["'\`]`, 'i'),
    new RegExp(`((?:[A-Za-z]:[\\\\/])?(?:[A-Za-z0-9._@-]+[\\\\/])+[A-Za-z0-9._@-]+\\.${FILE_PATH_EXTENSION_PATTERN})`, 'i'),
    new RegExp(`["'\`]([A-Za-z0-9._@-]+\\.${FILE_PATH_EXTENSION_PATTERN})["'\`]`, 'i'),
    new RegExp(`\\b([A-Za-z0-9._@-]+\\.${FILE_PATH_EXTENSION_PATTERN})\\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return sanitizeExtractedPath(match[1]);
    }
  }
  return undefined;
}

/**
 * Infer subsystem anchor files from intent text when the user names a runtime
 * surface but not an explicit path. This keeps retrieval grounded in the
 * operational implementation path instead of generic support modules.
 */
export function extractIntentAnchorPaths(intent: string): string[] {
  if (!intent.trim()) return [];

  const anchors: string[] = [];
  for (const hint of INTENT_ANCHOR_HINTS) {
    if (hint.patterns.every((pattern) => pattern.test(intent))) {
      for (const file of hint.files) {
        const normalized = sanitizeExtractedPath(file);
        if (normalized && !anchors.includes(normalized)) {
          anchors.push(normalized);
        }
      }
    }
  }
  return anchors;
}

/**
 * Extract WHY query primary topic and optional comparison target.
 */
export function extractWhyQueryTopics(intent: string): {
  topic?: string;
  comparisonTopic?: string;
} {
  const topicPatterns = [
    /\buse[ds]?\s+([A-Za-z0-9_-]+)\b/i,
    /\bwhy\s+([A-Za-z0-9_-]+)\s+(?:instead|over|rather)/i,
    /\bwhy\s+not\s+(?:use|have)\s+([A-Za-z0-9_-]+)/i,
    /\b(?:choose|chose|chosen|pick|prefer|select|adopt)\s+([A-Za-z0-9_-]+)\b/i,
    /\breasoning\s+behind\s+(?:using\s+)?([A-Za-z0-9_-]+)/i,
    /\brationale\s+(?:for|behind)\s+(?:using\s+)?([A-Za-z0-9_-]+)/i,
    /\bwhy\s+(?:is|are|does|do|did|was|were|the\s+\w+\s+)?(?:use[ds]?\s+)?([A-Za-z0-9_-]+)\s*$/i,
  ];
  const stopWords = [
    'the',
    'this',
    'that',
    'use',
    'uses',
    'used',
    'using',
    'system',
    'project',
    'codebase',
    'code',
    'have',
    'has',
    'had',
    'does',
    'did',
    'is',
    'are',
    'was',
    'were',
  ];

  let topic: string | undefined;
  for (const pattern of topicPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1] && match[1].length > 2 && !stopWords.includes(match[1].toLowerCase())) {
      topic = match[1];
      break;
    }
  }

  const comparisonPatterns = [
    /instead\s+of\s+([A-Za-z0-9_-]+)/i,
    /over\s+([A-Za-z0-9_-]+)/i,
    /rather\s+than\s+([A-Za-z0-9_-]+)/i,
  ];
  let comparisonTopic: string | undefined;
  for (const pattern of comparisonPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      comparisonTopic = match[1];
      break;
    }
  }

  return { topic, comparisonTopic };
}
