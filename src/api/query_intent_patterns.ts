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
  /\bmain\s+(entry\s*point|entry|file|function|module\s+entry)\b/i,
  /\bstart(ing)?\s*(point|file)?/i,
  /\binitialize\s+(the\s+)?(app|application|program|service|server|cli)\b/i,
  /\bhow\s+to\s+initialize\b/i,
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

/**
 * Patterns that indicate a REFACTORING SAFETY query.
 * These queries ask about the impact of changing, renaming, or modifying code.
 * Examples: "what would break if I changed X", "can I safely rename X", "impact of modifying X"
 */
export const REFACTORING_SAFETY_PATTERNS: RegExp[] = [
  /what\s+would\s+break\s+if\s+(?:I\s+|we\s+)?(?:changed?|modif(?:y|ied)|renamed?|deleted?|removed?)/i,
  /can\s+(?:I|we)\s+safely\s+(?:rename|change|delete|modify|remove|refactor)/i,
  /is\s+it\s+safe\s+to\s+(?:rename|change|delete|modify|remove|refactor)/i,
  /impact\s+of\s+(?:changing|modifying|renaming|deleting|removing)/i,
  /safe\s+to\s+refactor/i,
  /refactor(?:ing)?\s+.*\s+(?:safely|safe|break|impact)/i,
  /what\s+(?:depends\s+on|uses|calls|imports)\s+.*\s+(?:if|when)\s+(?:I\s+)?(?:change|modify|rename|delete)/i,
  /breaking\s+changes?\s+(?:if|when|for)\s+(?:changing|modifying|renaming)/i,
  /(?:rename|change|modify|delete)\s+.*\s+(?:breaking|safely|impact)/i,
];

/**
 * Patterns that indicate a BUG INVESTIGATION query.
 * These queries ask about debugging errors, investigating bugs, or tracing issues.
 * Examples: "debug this bug", "investigate the error", "what caused this crash"
 */
export const BUG_INVESTIGATION_PATTERNS: RegExp[] = [
  /debug\s+(?:this|the|a)\s+(?:bug|issue|error|problem)/i,
  /investigate\s+(?:bug|error|issue|crash)/i,
  /what\s+(?:caused|causes)\s+(?:this|the)\s+(?:error|bug|crash)/i,
  /trace\s+(?:the\s+)?(?:error|stack|exception)/i,
  /null\s*pointer|undefined\s+error/i,
  /find\s+(?:the\s+)?(?:root\s+)?cause/i,
  /why\s+(?:is|does|did)\s+(?:this|it)\s+(?:crash|fail|error|throw)/i,
  /stack\s+trace\s+(?:analysis|for)/i,
];

/**
 * Patterns that indicate a SECURITY AUDIT query.
 * These queries ask about security vulnerabilities, audits, or injection risks.
 * Examples: "find security vulnerabilities", "check for SQL injection"
 */
export const SECURITY_AUDIT_PATTERNS: RegExp[] = [
  /security\s+(?:audit|check|scan|review)/i,
  /vulnerability\s+(?:check|scan|find)/i,
  /injection\s+(?:risk|check|vulnerability)/i,
  /find\s+security\s+(?:issues|vulnerabilities)/i,
  /(?:sql|xss|command)\s+injection/i,
  /security\s+(?:vulnerabilities|issues|risks)/i,
  /(?:check|scan|find)\s+(?:for\s+)?(?:security|vulnerabilities)/i,
  /(?:insecure|unsafe)\s+(?:code|patterns?)/i,
];

/**
 * Patterns that indicate an ARCHITECTURE VERIFICATION query.
 * These queries ask about architectural compliance, layer violations, or boundary checks.
 * Examples: "verify architecture", "check layer violations", "circular dependencies"
 */
export const ARCHITECTURE_VERIFICATION_PATTERNS: RegExp[] = [
  /verify\s+(?:architecture|layers|boundaries)/i,
  /check\s+(?:layer|boundary)\s+violations?/i,
  /architectural\s+(?:compliance|rules)/i,
  /circular\s+dependenc/i,
  /layer\s+violations?/i,
  /architecture\s+(?:check|verification|validation)/i,
  /(?:dependency|import)\s+(?:cycle|loop)/i,
  /boundary\s+(?:check|violations?)/i,
];

/**
 * Patterns that indicate a CODE QUALITY query.
 * These queries ask about code quality metrics, complexity, duplication, or code smells.
 * Examples: "code quality report", "check complexity", "find code smells"
 */
export const CODE_QUALITY_PATTERNS: RegExp[] = [
  /code\s+quality\s+(?:report|analysis|check)/i,
  /complexity\s+(?:analysis|check|score)/i,
  /duplication\s+(?:check|analysis|find)/i,
  /code\s+smells?/i,
  /quality\s+(?:metrics|report|assessment)/i,
  /(?:check|analyze)\s+(?:code\s+)?quality/i,
  /cyclomatic\s+complexity/i,
  /technical\s+debt/i,
];

/**
 * Patterns that indicate a REFACTORING OPPORTUNITIES query.
 * These queries ask about what code should be refactored or improved.
 * Examples: "what should I refactor", "refactoring opportunities", "code improvements"
 */
export const REFACTORING_OPPORTUNITIES_PATTERNS: RegExp[] = [
  /what\s+should\s+(?:I|we)\s+refactor/i,
  /refactoring\s+opportunit/i,
  /refactor(?:ing)?\s+suggestions?/i,
  /code\s+improvements?\s+(?:needed|opportunities|suggestions)/i,
  /(?:find|show|list|identify)\s+(?:code\s+)?(?:to\s+)?refactor/i,
  /(?:areas?|code|files?)\s+(?:that\s+)?(?:needs?|requiring?)\s+refactor/i,
  /what\s+(?:code|files?)\s+(?:needs?|should|could)\s+(?:be\s+)?(?:refactor|improv)/i,
  /suggest\s+(?:code\s+)?(?:refactoring|improvements)/i,
  /where\s+(?:should|can)\s+(?:I|we)\s+(?:refactor|improve)/i,
  /improve\s+(?:code\s+)?quality/i,
  /clean\s*up\s+(?:code|opportunities|suggestions)/i,
];

/**
 * Patterns that indicate a CODE REVIEW query.
 * These queries ask for code review feedback or issue detection.
 * Examples: "review this file", "code review for changes", "check code for issues"
 */
export const CODE_REVIEW_QUERY_PATTERNS: RegExp[] = [
  /\breview\s+(?:this\s+)?(?:file|code|changes?)\b/i,
  /\bcode\s+review\b/i,
  /\bcheck\s+(?:this\s+)?(?:file|code)\s+for\s+issues?\b/i,
  /\banalyze\s+(?:this\s+)?(?:file|code)\s+quality\b/i,
  /\bfind\s+issues?\s+in\s+(?:this\s+)?(?:file|code)\b/i,
  /\bquality\s+check\b/i,
  /\bpre[- ]commit\s+review\b/i,
  /\bwhat\s+(?:issues?|problems?)\s+(?:are\s+)?(?:in|with)\s+(?:this\s+)?(?:file|code)\b/i,
  /\breview\s+(?:before\s+)?(?:commit|merge|push)\b/i,
];

/**
 * Patterns that indicate a FEATURE LOCATION query.
 * These queries ask about where features are implemented or how to find functionality.
 * Examples: "where is authentication implemented", "find the login feature"
 */
export const FEATURE_LOCATION_PATTERNS: RegExp[] = [
  /where\s+is\s+(?:the\s+)?(?:\w+)\s+(?:implemented|defined|located)/i,
  /find\s+(?:the\s+)?(?:\w+)\s+feature/i,
  /locate\s+(?:the\s+)?(?:implementation|code)\s+(?:for|of)/i,
  /which\s+files?\s+(?:implement|contain|handle)\s+(?:the\s+)?(?:\w+)/i,
  /where\s+(?:does|is)\s+(?:the\s+)?(?:\w+)\s+(?:happen|occur|get\s+handled)/i,
  /feature\s+location/i,
];

/**
 * Names that indicate an entry point (factory functions, main exports, etc.)
 */
export const ENTRY_POINT_NAME_PATTERNS: RegExp[] = [
  /^create[A-Z]/,
  /^make[A-Z]/,
  /^build[A-Z]/,
  /^init[A-Z]/,
  /^setup[A-Z]/,
  /^bootstrap/i,
  /^main$/i,
  /^run$/i,
  /^start$/i,
  /^launch$/i,
  /^index$/i,
];

/**
 * Path patterns that indicate an entry point file.
 */
export const ENTRY_POINT_PATH_PATTERNS: RegExp[] = [
  /\/index\.(ts|js|tsx|jsx|mjs|cjs)$/,
  /\/main\.(ts|js|tsx|jsx|mjs|cjs)$/,
  /\/bin\//,
  /\/cli\//,
  /\/src\/index\./,
  /\/src\/main\./,
];
