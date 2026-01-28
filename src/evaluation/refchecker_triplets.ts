/**
 * @fileoverview REFCHECKER Knowledge Triplets Extractor (WU-HALU-002)
 *
 * Implements knowledge triplet extraction per REFCHECKER (Amazon EMNLP 2024)
 * for fine-grained hallucination detection in code-related claims.
 *
 * A knowledge triplet represents an atomic fact as:
 * - Subject: The entity being described (e.g., "createUserService")
 * - Predicate: The relationship or property (e.g., "returns", "imports", "calls")
 * - Object: The target entity or value (e.g., "UserService", "void", "validateInput")
 *
 * Code-specific predicates supported:
 * - "imports" - Module imports (X imports Y from Z)
 * - "calls" - Function/method calls (X calls Y)
 * - "extends" - Class inheritance (X extends Y)
 * - "implements" - Interface implementation (X implements Y)
 * - "defines" - Symbol definitions (X defines Y)
 * - "returns" - Return types (X returns Y)
 * - "accepts" - Parameter types (X accepts Y)
 * - "has_property" - Property declarations (X has_property Y)
 * - "has_method" - Method declarations (X has_method Y)
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A knowledge triplet representing an atomic fact about code
 */
export interface KnowledgeTriplet {
  /** The entity being described (subject of the relationship) */
  subject: string;
  /** The relationship or property type */
  predicate: Predicate;
  /** The target entity or value (object of the relationship) */
  object: string;
  /** Confidence score for this triplet (0-1) */
  confidence: number;
  /** Source span in the original text */
  sourceSpan: {
    /** Start character offset */
    start: number;
    /** End character offset */
    end: number;
  };
}

/**
 * Supported predicate types for code-specific triplets
 */
export type Predicate =
  | 'imports'
  | 'calls'
  | 'extends'
  | 'implements'
  | 'defines'
  | 'returns'
  | 'accepts'
  | 'has_property'
  | 'has_method';

/**
 * Result of verifying a triplet against context
 */
export interface TripletVerificationResult {
  /** Whether the triplet was verified as correct */
  verified: boolean;
  /** Confidence in the verification result (0-1) */
  confidence: number;
}

/**
 * Configuration for the triplet extractor
 */
export interface TripletExtractorConfig {
  /** Minimum confidence threshold for extracted triplets (default: 0.5) */
  minConfidence?: number;
  /** Whether to include implicit triplets (default: false) */
  includeImplicitTriplets?: boolean;
  /** Maximum triplets to extract per claim (default: 20) */
  maxTripletsPerClaim?: number;
}

/**
 * Input claim for triplet extraction
 */
export interface Claim {
  /** The text content of the claim */
  content: string;
  /** Unique identifier for the claim */
  id: string;
}

/**
 * Interface for the triplet extractor
 */
export interface TripletExtractor {
  /**
   * Extract knowledge triplets from raw text
   * @param text - The text to extract triplets from
   * @returns Array of extracted knowledge triplets
   */
  extractTriplets(text: string): Promise<KnowledgeTriplet[]>;

  /**
   * Extract knowledge triplets from a structured claim
   * @param claim - The claim to extract triplets from
   * @returns Array of extracted knowledge triplets
   */
  extractFromClaim(claim: Claim): Promise<KnowledgeTriplet[]>;

  /**
   * Verify a triplet against provided context
   * @param triplet - The triplet to verify
   * @param context - The context to verify against (source code or documentation)
   * @returns Verification result with confidence
   */
  verifyTriplet(triplet: KnowledgeTriplet, context: string): Promise<TripletVerificationResult>;
}

// ============================================================================
// TRIPLET EXTRACTION PATTERNS
// ============================================================================

interface TripletPattern {
  /** Regular expression pattern */
  pattern: RegExp;
  /** Predicate type for matched triplets */
  predicate: Predicate;
  /** Extract subject from match */
  extractSubject: (match: RegExpExecArray, fullText: string) => string;
  /** Extract object from match */
  extractObject: (match: RegExpExecArray, fullText: string) => string;
  /** Base confidence for this pattern */
  baseConfidence: number;
}

/**
 * Patterns for extracting triplets from code-related claims
 */
const TRIPLET_PATTERNS: TripletPattern[] = [
  // Import patterns
  {
    // "X imports Y from Z" or "file/module imports Y"
    pattern: /(?:the\s+)?(?:file|module|code|class)?\s*[`']?(\w+)?[`']?\s*imports?\s+[`']?(\w+)[`']?\s*(?:from\s+[`']?[\w\-./]+[`']?)?/gi,
    predicate: 'imports',
    extractSubject: (match, fullText) => {
      // If subject captured, use it; otherwise use "file" or context-based subject
      const subject = match[1];
      if (subject && subject.toLowerCase() !== 'the') {
        return subject;
      }
      // Look for a subject before "imports" in a wider context
      const beforeMatch = fullText.slice(Math.max(0, match.index - 50), match.index);
      const subjectMatch = beforeMatch.match(/[`']?(\w+)[`']?\s*$/);
      return subjectMatch ? subjectMatch[1] : 'file';
    },
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.85,
  },

  // Call patterns
  {
    // "X calls Y" or "function/method X calls Y"
    pattern: /(?:the\s+)?(?:function|method)?\s*[`']?(\w+(?:\.\w+)?)[`']?\s*(?:function|method)?\s*calls?\s+[`']?(\w+(?:\.\w+)?)[`']?/gi,
    predicate: 'calls',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.85,
  },
  {
    // "and calls Y" pattern for compound sentences (extracts from context)
    pattern: /(?:,?\s*and\s+)?calls?\s+[`']?(\w+(?:\.\w+)?)[`']?/gi,
    predicate: 'calls',
    extractSubject: (match, fullText) => {
      // Look for subject earlier in the sentence
      const beforeMatch = fullText.slice(Math.max(0, match.index - 100), match.index);
      // Try to find "The X" or just a CamelCase identifier
      const subjectMatch = beforeMatch.match(/(?:the\s+)?[`']?(\w+)[`']?\s+(?:class\s+)?(?:extends|implements)/i);
      if (subjectMatch) {
        return subjectMatch[1];
      }
      // Fallback to first CamelCase word
      const camelMatch = beforeMatch.match(/[`']?([A-Z][a-zA-Z0-9]+)[`']?/);
      return camelMatch ? camelMatch[1] : 'unknown';
    },
    extractObject: (match) => match[1] || '',
    baseConfidence: 0.8,
  },

  // Extends patterns
  {
    // "class X extends Y"
    pattern: /(?:the\s+)?(?:class\s+)?[`']?(\w+)[`']?\s*(?:class\s+)?extends\s+[`']?(\w+)[`']?/gi,
    predicate: 'extends',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.9,
  },

  // Implements patterns
  {
    // "class X implements Y" or "X implements Y interface"
    pattern: /(?:the\s+)?(?:class\s+)?[`']?(\w+)[`']?\s*(?:class\s+)?implements\s+[`']?(\w+)[`']?\s*(?:interface)?/gi,
    predicate: 'implements',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.9,
  },
  {
    // "and implements Y" or ", implements Y" pattern for compound sentences
    pattern: /(?:,\s*|\s+and\s+)implements\s+[`']?(\w+)[`']?\s*(?:interface)?/gi,
    predicate: 'implements',
    extractSubject: (match, fullText) => {
      // Look for subject earlier in the sentence (same logic as calls)
      const beforeMatch = fullText.slice(Math.max(0, match.index - 100), match.index);
      // Try to find "The X" at start of sentence
      const subjectMatch = beforeMatch.match(/(?:the\s+)?[`']?(\w+)[`']?\s+(?:class\s+)?(?:extends|implements)/i);
      if (subjectMatch) {
        return subjectMatch[1];
      }
      // Fallback to first CamelCase word
      const camelMatch = beforeMatch.match(/[`']?([A-Z][a-zA-Z0-9]+)[`']?/);
      return camelMatch ? camelMatch[1] : 'unknown';
    },
    extractObject: (match) => match[1] || '',
    baseConfidence: 0.85,
  },

  // Defines patterns
  {
    // "module/file defines X" or "defines a/an X"
    pattern: /(?:the\s+)?(?:module|file|code)?\s*[`']?(\w+)?[`']?\s*defines?\s+(?:a(?:n)?\s+)?[`']?(\w+)[`']?\s*(?:interface|class|function|type)?/gi,
    predicate: 'defines',
    extractSubject: (match, fullText) => {
      const subject = match[1];
      if (subject && !['the', 'a', 'an'].includes(subject.toLowerCase())) {
        return subject;
      }
      // Default to "module" or extract from context
      const beforeMatch = fullText.slice(Math.max(0, match.index - 50), match.index);
      const subjectMatch = beforeMatch.match(/[`']?(\w+)[`']?\s*$/);
      return subjectMatch ? subjectMatch[1] : 'module';
    },
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.8,
  },

  // Returns patterns
  {
    // "function X returns Y" or "X returns Y"
    pattern: /(?:the\s+)?(?:function|method)?\s*[`']?(\w+)[`']?\s*(?:function|method)?\s*returns?\s+(?:a(?:n)?\s+)?[`']?(\w+(?:<[^>]+>)?(?:\s+(?:or|of)\s+\w+)?)[`']?/gi,
    predicate: 'returns',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.85,
  },

  // Accepts/takes parameter patterns
  {
    // "function X accepts/takes Y parameter"
    pattern: /(?:the\s+)?(?:function|method)?\s*[`']?(\w+)[`']?\s*(?:function|method)?\s*(?:accepts?|takes?)\s+(?:a(?:n)?\s+)?[`']?(\w+)[`']?\s*parameter/gi,
    predicate: 'accepts',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.85,
  },
  {
    // "function X takes Y, Z, and W parameters"
    pattern: /(?:the\s+)?(?:function|method)?\s*[`']?(\w+)[`']?\s*(?:function|method)?\s*(?:takes?|accepts?)\s+([^.]+)\s*parameters?/gi,
    predicate: 'accepts',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => {
      // Extract first parameter from list
      const paramList = match[2] || '';
      const firstParam = paramList.match(/[`']?(\w+)[`']?/);
      return firstParam ? firstParam[1] : paramList.trim();
    },
    baseConfidence: 0.8,
  },

  // Has property patterns
  {
    // "class/type X has a Y property"
    pattern: /(?:the\s+)?(?:class|type|interface)?\s*[`']?(\w+)[`']?\s*(?:class|type)?\s*has\s+(?:a(?:n)?\s+)?[`']?(\w+)[`']?\s*property/gi,
    predicate: 'has_property',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.85,
  },

  // Has method patterns
  {
    // "class X has a Y method"
    pattern: /(?:the\s+)?(?:class|type)?\s*[`']?(\w+)[`']?\s*(?:class)?\s*has\s+(?:a(?:n)?\s+)?[`']?(\w+)[`']?\s*method/gi,
    predicate: 'has_method',
    extractSubject: (match) => match[1] || '',
    extractObject: (match) => match[2] || '',
    baseConfidence: 0.85,
  },
];

// ============================================================================
// CONFIDENCE ADJUSTMENT PATTERNS
// ============================================================================

/**
 * Words that indicate high confidence in claims
 */
const HIGH_CONFIDENCE_INDICATORS = [
  'explicitly',
  'definitely',
  'always',
  'directly',
  'specifically',
  'clearly',
];

/**
 * Words that indicate low confidence in claims
 */
const LOW_CONFIDENCE_INDICATORS = [
  'probably',
  'might',
  'maybe',
  'possibly',
  'perhaps',
  'likely',
  'seems',
  'appears',
  'could',
];

// ============================================================================
// TRIPLET EXTRACTOR IMPLEMENTATION
// ============================================================================

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<TripletExtractorConfig> = {
  minConfidence: 0.5,
  includeImplicitTriplets: false,
  maxTripletsPerClaim: 20,
};

/**
 * Implementation of the TripletExtractor interface
 */
class TripletExtractorImpl implements TripletExtractor {
  private config: Required<TripletExtractorConfig>;

  constructor(config?: TripletExtractorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract knowledge triplets from raw text
   */
  async extractTriplets(text: string): Promise<KnowledgeTriplet[]> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    return this.extractTripletsFromText(text, 0);
  }

  /**
   * Extract knowledge triplets from a structured claim
   */
  async extractFromClaim(claim: Claim): Promise<KnowledgeTriplet[]> {
    if (!claim.content || claim.content.trim().length === 0) {
      return [];
    }

    return this.extractTripletsFromText(claim.content, 0);
  }

  /**
   * Verify a triplet against provided context
   */
  async verifyTriplet(triplet: KnowledgeTriplet, context: string): Promise<TripletVerificationResult> {
    if (!context || context.trim().length === 0) {
      return { verified: false, confidence: 0 };
    }

    const contextLower = context.toLowerCase();
    const subjectLower = triplet.subject.toLowerCase();
    const objectLower = triplet.object.toLowerCase();

    // Verification strategies based on predicate type
    switch (triplet.predicate) {
      case 'imports':
        return this.verifyImportTriplet(subjectLower, objectLower, contextLower, context);

      case 'extends':
        return this.verifyExtendsTriplet(subjectLower, objectLower, contextLower, context);

      case 'implements':
        return this.verifyImplementsTriplet(subjectLower, objectLower, contextLower, context);

      case 'calls':
        return this.verifyCallsTriplet(subjectLower, objectLower, contextLower, context);

      case 'defines':
        return this.verifyDefinesTriplet(objectLower, contextLower, context);

      case 'returns':
        return this.verifyReturnsTriplet(subjectLower, objectLower, contextLower, context);

      case 'accepts':
        return this.verifyAcceptsTriplet(subjectLower, objectLower, contextLower, context);

      case 'has_property':
        return this.verifyHasPropertyTriplet(subjectLower, objectLower, contextLower, context);

      case 'has_method':
        return this.verifyHasMethodTriplet(subjectLower, objectLower, contextLower, context);

      default:
        // Generic verification: check if both subject and object appear in context
        return this.verifyGenericTriplet(subjectLower, objectLower, contextLower);
    }
  }

  // ============================================================================
  // PRIVATE EXTRACTION METHODS
  // ============================================================================

  private extractTripletsFromText(text: string, baseOffset: number): KnowledgeTriplet[] {
    const triplets: KnowledgeTriplet[] = [];
    const seenTriplets = new Set<string>();

    for (const patternDef of TRIPLET_PATTERNS) {
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const subject = patternDef.extractSubject(match, text);
        const object = patternDef.extractObject(match, text);

        // Skip if subject or object is empty or just articles
        if (!this.isValidEntity(subject) || !this.isValidEntity(object)) {
          continue;
        }

        // Create unique key to avoid duplicates
        const tripletKey = `${subject.toLowerCase()}:${patternDef.predicate}:${object.toLowerCase()}`;
        if (seenTriplets.has(tripletKey)) {
          continue;
        }
        seenTriplets.add(tripletKey);

        // Calculate confidence with adjustments
        const confidence = this.calculateConfidence(text, match, patternDef.baseConfidence);

        // Skip low confidence triplets if configured
        if (confidence < this.config.minConfidence) {
          continue;
        }

        triplets.push({
          subject: this.cleanEntity(subject),
          predicate: patternDef.predicate,
          object: this.cleanEntity(object),
          confidence,
          sourceSpan: {
            start: baseOffset + match.index,
            end: baseOffset + match.index + match[0].length,
          },
        });

        // Respect max triplets limit
        if (triplets.length >= this.config.maxTripletsPerClaim) {
          return triplets;
        }
      }
    }

    return triplets;
  }

  private isValidEntity(entity: string): boolean {
    if (!entity || entity.trim().length === 0) {
      return false;
    }

    const lower = entity.toLowerCase().trim();

    // Skip common articles and prepositions
    const invalidWords = ['the', 'a', 'an', 'to', 'from', 'with', 'of', 'for', 'in', 'on', 'at'];
    if (invalidWords.includes(lower)) {
      return false;
    }

    // Must have at least 2 characters
    return lower.length >= 2;
  }

  private cleanEntity(entity: string): string {
    // Remove backticks, quotes, and trim
    return entity
      .replace(/[`'"]/g, '')
      .replace(/^(the|a|an)\s+/i, '')
      .trim();
  }

  private calculateConfidence(text: string, match: RegExpExecArray, baseConfidence: number): number {
    let confidence = baseConfidence;
    const textLower = text.toLowerCase();

    // Increase confidence for explicit indicators
    for (const indicator of HIGH_CONFIDENCE_INDICATORS) {
      if (textLower.includes(indicator)) {
        confidence = Math.min(1, confidence + 0.05);
      }
    }

    // Decrease confidence for uncertainty indicators
    for (const indicator of LOW_CONFIDENCE_INDICATORS) {
      if (textLower.includes(indicator)) {
        confidence = Math.max(0.1, confidence - 0.15);
      }
    }

    // Increase confidence if both entities are in backticks (explicit code references)
    const backtickCount = (match[0].match(/`/g) || []).length;
    if (backtickCount >= 2) {
      confidence = Math.min(1, confidence + 0.05);
    }

    return Math.round(confidence * 100) / 100;
  }

  // ============================================================================
  // PRIVATE VERIFICATION METHODS
  // ============================================================================

  private verifyImportTriplet(
    _subjectLower: string,
    objectLower: string,
    contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for import statement containing the object
    const importPattern = new RegExp(`import\\s+.*\\b${this.escapeRegex(objectLower)}\\b`, 'i');
    const importMatch = importPattern.test(context);

    if (importMatch) {
      return { verified: true, confidence: 0.9 };
    }

    // Also check for require statements
    const requirePattern = new RegExp(`require\\s*\\(.*${this.escapeRegex(objectLower)}`, 'i');
    if (requirePattern.test(context)) {
      return { verified: true, confidence: 0.85 };
    }

    // Check if object appears anywhere (lower confidence)
    if (contextLower.includes(objectLower)) {
      return { verified: false, confidence: 0.3 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyExtendsTriplet(
    subjectLower: string,
    objectLower: string,
    _contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for "class Subject extends Object"
    const extendsPattern = new RegExp(
      `class\\s+${this.escapeRegex(subjectLower)}\\s+extends\\s+${this.escapeRegex(objectLower)}`,
      'i'
    );

    if (extendsPattern.test(context)) {
      return { verified: true, confidence: 0.95 };
    }

    // Check for subject extends something (partial match)
    const partialPattern = new RegExp(`class\\s+${this.escapeRegex(subjectLower)}\\s+extends`, 'i');
    if (partialPattern.test(context)) {
      return { verified: false, confidence: 0.4 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyImplementsTriplet(
    subjectLower: string,
    objectLower: string,
    _contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for "class Subject ... implements Object"
    const implementsPattern = new RegExp(
      `class\\s+${this.escapeRegex(subjectLower)}[^{]*implements\\s+[^{]*\\b${this.escapeRegex(objectLower)}\\b`,
      'i'
    );

    if (implementsPattern.test(context)) {
      return { verified: true, confidence: 0.95 };
    }

    // Check for subject implements something
    const partialPattern = new RegExp(`class\\s+${this.escapeRegex(subjectLower)}[^{]*implements`, 'i');
    if (partialPattern.test(context)) {
      return { verified: false, confidence: 0.4 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyCallsTriplet(
    subjectLower: string,
    objectLower: string,
    contextLower: string,
    _context: string
  ): TripletVerificationResult {
    // Look for function call pattern: object(
    const callPattern = new RegExp(`\\b${this.escapeRegex(objectLower)}\\s*\\(`, 'i');

    if (callPattern.test(contextLower)) {
      // Check if it's within a function that matches the subject
      const functionPattern = new RegExp(
        `(?:function|async\\s+function|const|let|var)?\\s*${this.escapeRegex(subjectLower)}[^{]*\\{[^}]*${this.escapeRegex(objectLower)}\\s*\\(`,
        'i'
      );

      if (functionPattern.test(contextLower)) {
        return { verified: true, confidence: 0.9 };
      }

      // Object is called somewhere (medium confidence)
      return { verified: true, confidence: 0.7 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyDefinesTriplet(
    objectLower: string,
    contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for definition patterns
    const definitionPatterns = [
      new RegExp(`interface\\s+${this.escapeRegex(objectLower)}`, 'i'),
      new RegExp(`class\\s+${this.escapeRegex(objectLower)}`, 'i'),
      new RegExp(`type\\s+${this.escapeRegex(objectLower)}`, 'i'),
      new RegExp(`function\\s+${this.escapeRegex(objectLower)}`, 'i'),
      new RegExp(`const\\s+${this.escapeRegex(objectLower)}\\s*=`, 'i'),
      new RegExp(`export\\s+(?:function|class|interface|type|const)\\s+${this.escapeRegex(objectLower)}`, 'i'),
    ];

    for (const pattern of definitionPatterns) {
      if (pattern.test(context)) {
        return { verified: true, confidence: 0.9 };
      }
    }

    // Check if object appears at all
    if (contextLower.includes(objectLower)) {
      return { verified: false, confidence: 0.3 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyReturnsTriplet(
    subjectLower: string,
    objectLower: string,
    _contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for function with return type annotation
    const returnTypePattern = new RegExp(
      `(?:function|async\\s+function)?\\s*${this.escapeRegex(subjectLower)}[^{]*:\\s*[^{]*${this.escapeRegex(objectLower)}`,
      'i'
    );

    if (returnTypePattern.test(context)) {
      return { verified: true, confidence: 0.9 };
    }

    // Look for return statement within function
    const returnPattern = new RegExp(
      `${this.escapeRegex(subjectLower)}[^}]*return\\s+[^;]*${this.escapeRegex(objectLower)}`,
      'i'
    );

    if (returnPattern.test(context)) {
      return { verified: true, confidence: 0.75 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyAcceptsTriplet(
    subjectLower: string,
    objectLower: string,
    _contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for function parameter with type
    const paramPattern = new RegExp(
      `(?:function|async\\s+function)?\\s*${this.escapeRegex(subjectLower)}\\s*\\([^)]*\\b${this.escapeRegex(objectLower)}\\b`,
      'i'
    );

    if (paramPattern.test(context)) {
      return { verified: true, confidence: 0.9 };
    }

    // Check for parameter name match
    const paramNamePattern = new RegExp(
      `${this.escapeRegex(subjectLower)}\\s*\\([^)]*${this.escapeRegex(objectLower)}\\s*[,:\\)]`,
      'i'
    );

    if (paramNamePattern.test(context)) {
      return { verified: true, confidence: 0.8 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyHasPropertyTriplet(
    subjectLower: string,
    objectLower: string,
    _contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for property in class/interface
    const propertyPattern = new RegExp(
      `(?:class|interface)\\s+${this.escapeRegex(subjectLower)}[^}]*\\b${this.escapeRegex(objectLower)}\\s*[?:]`,
      'i'
    );

    if (propertyPattern.test(context)) {
      return { verified: true, confidence: 0.9 };
    }

    // Check for property access pattern
    const accessPattern = new RegExp(`${this.escapeRegex(subjectLower)}\\.${this.escapeRegex(objectLower)}`, 'i');
    if (accessPattern.test(context)) {
      return { verified: true, confidence: 0.75 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyHasMethodTriplet(
    subjectLower: string,
    objectLower: string,
    _contextLower: string,
    context: string
  ): TripletVerificationResult {
    // Look for method in class
    const methodPattern = new RegExp(
      `class\\s+${this.escapeRegex(subjectLower)}[^}]*(?:async\\s+)?${this.escapeRegex(objectLower)}\\s*\\(`,
      'i'
    );

    if (methodPattern.test(context)) {
      return { verified: true, confidence: 0.9 };
    }

    // Check for method call pattern
    const callPattern = new RegExp(`\\.${this.escapeRegex(objectLower)}\\s*\\(`, 'i');
    if (callPattern.test(context)) {
      return { verified: true, confidence: 0.7 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private verifyGenericTriplet(
    subjectLower: string,
    objectLower: string,
    contextLower: string
  ): TripletVerificationResult {
    const hasSubject = contextLower.includes(subjectLower);
    const hasObject = contextLower.includes(objectLower);

    if (hasSubject && hasObject) {
      return { verified: true, confidence: 0.6 };
    }

    if (hasSubject || hasObject) {
      return { verified: false, confidence: 0.3 };
    }

    return { verified: false, confidence: 0.1 };
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new TripletExtractor instance
 *
 * @param config - Optional configuration
 * @returns A new TripletExtractor instance
 *
 * @example
 * ```typescript
 * const extractor = createTripletExtractor();
 * const triplets = await extractor.extractTriplets("The UserService extends BaseService");
 * // Returns: [{ subject: 'UserService', predicate: 'extends', object: 'BaseService', ... }]
 * ```
 */
export function createTripletExtractor(config?: TripletExtractorConfig): TripletExtractor {
  return new TripletExtractorImpl(config);
}
