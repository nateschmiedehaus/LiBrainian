/**
 * @fileoverview Comment/Code Checker
 *
 * Detects mismatches between comments and the code they describe.
 * Outdated or misleading comments are a major source of hallucinations.
 *
 * Mismatch types detected:
 * - Parameter mismatch (JSDoc @param vs actual params)
 * - Return type mismatch (JSDoc @returns vs actual)
 * - Name mismatch (comment describes different action than function name)
 * - Semantic drift (comment mentions outdated concepts)
 * - Stale reference (referenced files/functions don't exist)
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { Project, SourceFile, Node, SyntaxKind, JSDoc, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression } from 'ts-morph';
import type { ASTFact } from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A comment/code pair extracted from source code
 */
export interface CommentCodePair {
  /** The file path */
  file: string;
  /** The line number of the comment */
  line: number;
  /** The comment text */
  comment: string;
  /** The associated code */
  code: string;
  /** The type of comment */
  commentType: 'jsdoc' | 'inline' | 'block' | 'docstring';
}

/**
 * A mismatch detected between a comment and its associated code
 */
export interface MismatchResult {
  /** The comment/code pair */
  pair: CommentCodePair;
  /** The type of mismatch */
  mismatchType: 'parameter_mismatch' | 'return_mismatch' | 'name_mismatch' | 'semantic_drift' | 'stale_reference';
  /** The severity of the mismatch */
  severity: 'high' | 'medium' | 'low';
  /** A description of the mismatch */
  description: string;
  /** An optional suggestion for fixing the mismatch */
  suggestion?: string;
}

/**
 * A report of comment/code mismatches in a repository
 */
export interface CommentCodeReport {
  /** The repository path */
  repoPath: string;
  /** When the analysis was performed */
  analyzedAt: string;
  /** Total number of comment/code pairs analyzed */
  totalPairs: number;
  /** The mismatches found */
  mismatches: MismatchResult[];
  /** The rate of mismatches (mismatches / totalPairs) */
  mismatchRate: number;
  /** Summary statistics */
  summary: {
    /** Counts by mismatch type */
    byType: Record<string, number>;
    /** Counts by severity */
    bySeverity: Record<string, number>;
  };
}

// ============================================================================
// WU-CONTRA-001: NEW INTERFACES
// ============================================================================

/**
 * Analysis of a single comment in source code (WU-CONTRA-001)
 */
export interface CommentAnalysis {
  /** Path to the file containing the comment */
  filePath: string;
  /** Line number where the comment starts */
  lineNumber: number;
  /** The raw comment text */
  commentText: string;
  /** Type of comment */
  commentType: 'inline' | 'block' | 'jsdoc' | 'todo';
  /** The code associated with this comment */
  associatedCode: string;
}

/**
 * A consistency issue detected between comment and code (WU-CONTRA-001)
 */
export interface ConsistencyIssue {
  /** Unique identifier for this issue */
  id: string;
  /** Severity level of the issue */
  severity: 'info' | 'warning' | 'error';
  /** The comment analysis that triggered this issue */
  commentAnalysis: CommentAnalysis;
  /** Type of consistency issue */
  issueType: 'outdated' | 'misleading' | 'incorrect' | 'contradictory';
  /** Human-readable description of the issue */
  description: string;
  /** Optional suggestion for fixing the issue */
  suggestion?: string;
  /** Confidence score for this detection (0-1) */
  confidence: number;
}

/**
 * Report of consistency analysis for a single file (WU-CONTRA-001)
 */
export interface ConsistencyReport {
  /** Path to the analyzed file */
  filePath: string;
  /** Total number of comments found in the file */
  totalComments: number;
  /** Number of comments that were analyzed */
  analyzedComments: number;
  /** List of detected consistency issues */
  issues: ConsistencyIssue[];
  /** Overall consistency score (0-100, higher = more consistent) */
  overallScore: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Common action verbs and their synonyms for semantic comparison
 */
const VERB_SYNONYMS: Record<string, string[]> = {
  get: ['retrieve', 'fetch', 'obtain', 'load', 'find', 'read', 'query'],
  set: ['assign', 'update', 'write', 'store', 'save'],
  create: ['make', 'build', 'generate', 'construct', 'init', 'initialize', 'new'],
  delete: ['remove', 'destroy', 'clear', 'erase', 'drop'],
  validate: ['check', 'verify', 'ensure', 'assert', 'test'],
  format: ['transform', 'convert', 'parse', 'serialize', 'stringify'],
  process: ['handle', 'execute', 'run', 'perform'],
  send: ['emit', 'dispatch', 'publish', 'broadcast', 'transmit'],
  receive: ['accept', 'consume', 'subscribe', 'listen'],
  add: ['append', 'insert', 'push', 'include'],
  calculate: ['compute', 'evaluate', 'determine'],
};

/**
 * Conflicting verb pairs that indicate high severity mismatch
 */
const CONFLICTING_VERBS: Array<[string, string]> = [
  ['create', 'delete'],
  ['add', 'remove'],
  ['get', 'set'],
  ['validate', 'format'],
  ['send', 'receive'],
  ['enable', 'disable'],
  ['start', 'stop'],
  ['open', 'close'],
  ['connect', 'disconnect'],
  ['load', 'save'],
];

// ============================================================================
// COMMENT/CODE CHECKER CLASS
// ============================================================================

/**
 * Detects mismatches between comments and the code they describe
 */
export class CommentCodeChecker {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  /**
   * Check all comment/code pairs in a repository
   */
  async check(repoPath: string): Promise<CommentCodeReport> {
    const analyzedAt = new Date().toISOString();
    const mismatches: MismatchResult[] = [];
    let totalPairs = 0;

    try {
      if (!fs.existsSync(repoPath)) {
        return this.createEmptyReport(repoPath, analyzedAt);
      }

      const files = this.getTypeScriptFiles(repoPath);
      const allFacts = await this.extractAllFacts(repoPath);

      for (const file of files) {
        const pairs = await this.extractPairs(file);
        totalPairs += pairs.length;

        for (const pair of pairs) {
          // Check for all types of mismatches
          const paramMismatch = this.checkParameters(pair);
          if (paramMismatch) mismatches.push(paramMismatch);

          const returnMismatch = this.checkReturnType(pair);
          if (returnMismatch) mismatches.push(returnMismatch);

          const staleMismatch = this.checkStaleReferences(pair, allFacts);
          if (staleMismatch) mismatches.push(staleMismatch);

          // Only check for name mismatch if no other mismatch found
          if (!paramMismatch && !returnMismatch && !staleMismatch) {
            const nameMismatch = this.checkPair(pair);
            if (nameMismatch) mismatches.push(nameMismatch);
          }
        }
      }
    } catch {
      // Return empty report on error
      return this.createEmptyReport(repoPath, analyzedAt);
    }

    const mismatchRate = totalPairs > 0 ? mismatches.length / totalPairs : 0;

    return {
      repoPath,
      analyzedAt,
      totalPairs,
      mismatches,
      mismatchRate,
      summary: this.computeSummary(mismatches),
    };
  }

  // ============================================================================
  // WU-CONTRA-001: NEW PUBLIC METHODS
  // ============================================================================

  /**
   * Analyze a single file for comment-code consistency issues (WU-CONTRA-001)
   * @param filePath - Path to the file to analyze
   * @returns Consistency report for the file
   */
  async analyzeFile(filePath: string): Promise<ConsistencyReport> {
    try {
      if (!fs.existsSync(filePath)) {
        return this.createEmptyConsistencyReport(filePath);
      }

      const comments = this.extractComments(fs.readFileSync(filePath, 'utf-8'));
      const issues: ConsistencyIssue[] = [];

      // Analyze each comment for consistency issues
      for (const comment of comments) {
        // Set the file path for each comment
        const commentWithPath: CommentAnalysis = {
          ...comment,
          filePath,
        };

        const issue = await this.analyzeComment(commentWithPath);
        if (issue) {
          issues.push(issue);
        }
      }

      // Calculate overall score (100 = perfect, 0 = all comments have issues)
      const overallScore = comments.length > 0
        ? Math.round((1 - issues.length / comments.length) * 100)
        : 100;

      return {
        filePath,
        totalComments: comments.length,
        analyzedComments: comments.length,
        issues,
        overallScore,
      };
    } catch {
      return this.createEmptyConsistencyReport(filePath);
    }
  }

  /**
   * Analyze a single comment for consistency with its associated code (WU-CONTRA-001)
   * @param comment - The comment analysis to check
   * @returns A consistency issue if found, null otherwise
   */
  async analyzeComment(comment: CommentAnalysis): Promise<ConsistencyIssue | null> {
    // Convert CommentAnalysis to CommentCodePair for internal processing
    const pair: CommentCodePair = {
      file: comment.filePath,
      line: comment.lineNumber,
      comment: comment.commentText,
      code: comment.associatedCode,
      commentType: this.mapCommentType(comment.commentType),
    };

    // First, check for high-severity semantic issues (contradictory verbs)
    // This takes priority over parameter/return checks
    const semanticResult = this.compareSemantics(comment.commentText, comment.associatedCode);
    if (!semanticResult.consistent && semanticResult.confidence >= 0.7) {
      return this.createContradictoryIssue(comment, semanticResult.confidence);
    }

    // For WU-CONTRA-001, only flag high-severity parameter mismatches
    // (documented params not in signature, not missing docs)
    const paramMismatch = this.checkParameters(pair);
    if (paramMismatch && paramMismatch.severity === 'high') {
      return this.mismatchToConsistencyIssue(paramMismatch, comment);
    }

    // Check for return type mismatch (only high severity - void mismatch)
    const returnMismatch = this.checkReturnType(pair);
    if (returnMismatch && returnMismatch.severity === 'high') {
      return this.mismatchToConsistencyIssue(returnMismatch, comment);
    }

    // Check for name/semantic mismatch (only high severity)
    const nameMismatch = this.checkPair(pair);
    if (nameMismatch && nameMismatch.severity === 'high') {
      return this.mismatchToConsistencyIssue(nameMismatch, comment);
    }

    return null;
  }

  /**
   * Create a contradictory issue from semantic analysis
   */
  private createContradictoryIssue(comment: CommentAnalysis, confidence: number): ConsistencyIssue {
    const funcName = this.extractFunctionName(comment.associatedCode);
    const commentVerb = this.extractVerbFromComment(comment.commentText);

    return {
      id: `issue-${comment.filePath.replace(/[^a-z0-9]/gi, '-')}-${comment.lineNumber}-${Date.now()}`,
      severity: 'error',
      commentAnalysis: comment,
      issueType: 'contradictory',
      description: `Comment describes "${commentVerb}" but function "${funcName}" suggests opposite behavior`,
      suggestion: 'Update the comment to match the actual function behavior or rename the function',
      confidence,
    };
  }

  /**
   * Extract all comments from source code (WU-CONTRA-001)
   * @param code - The source code to extract comments from
   * @returns Array of comment analyses
   */
  extractComments(code: string): CommentAnalysis[] {
    if (!code || code.trim().length === 0) {
      return [];
    }

    const comments: CommentAnalysis[] = [];
    const lines = code.split('\n');

    // Extract JSDoc comments
    const jsDocRegex = /\/\*\*[\s\S]*?\*\//g;
    let match;
    while ((match = jsDocRegex.exec(code)) !== null) {
      const startIndex = match.index;
      const beforeComment = code.slice(0, startIndex);
      const lineNumber = (beforeComment.match(/\n/g) || []).length + 1;

      // Find associated code (next function/method)
      const afterComment = code.slice(match.index + match[0].length);
      const nextCodeMatch = afterComment.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=|class\s+\w+|(?:\w+)\s*\()[^{]*\{/);
      const associatedCode = nextCodeMatch ? this.extractFunctionBody(afterComment, nextCodeMatch[0]) : '';

      comments.push({
        filePath: '', // Will be set by caller
        lineNumber,
        commentText: match[0],
        commentType: 'jsdoc',
        associatedCode,
      });
    }

    // Extract TODO comments (inline)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[\s:]*(.+)/i);
      if (todoMatch) {
        // Find associated code on next non-empty, non-comment line
        let associatedCode = '';
        for (let j = i + 1; j < lines.length && j < i + 5; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.startsWith('//') && !nextLine.startsWith('/*')) {
            associatedCode = nextLine;
            break;
          }
        }

        comments.push({
          filePath: '',
          lineNumber: i + 1,
          commentText: line.trim(),
          commentType: 'todo',
          associatedCode,
        });
      }
    }

    // Extract regular inline comments (not TODOs)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip TODO comments (already handled) and JSDoc comments
      if (trimmed.startsWith('//') && !trimmed.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i) && !trimmed.startsWith('///')) {
        const comment = trimmed.slice(2).trim();
        if (comment.length > 5) {
          // Find associated code on next non-empty, non-comment line
          let associatedCode = '';
          for (let j = i + 1; j < lines.length && j < i + 5; j++) {
            const nextLine = lines[j].trim();
            if (nextLine && !nextLine.startsWith('//') && !nextLine.startsWith('/*')) {
              associatedCode = nextLine;
              break;
            }
          }

          comments.push({
            filePath: '',
            lineNumber: i + 1,
            commentText: comment,
            commentType: 'inline',
            associatedCode,
          });
        }
      }
    }

    // Extract block comments (non-JSDoc)
    const blockCommentRegex = /\/\*(?!\*)[\s\S]*?\*\//g;
    while ((match = blockCommentRegex.exec(code)) !== null) {
      const startIndex = match.index;
      const beforeComment = code.slice(0, startIndex);
      const lineNumber = (beforeComment.match(/\n/g) || []).length + 1;

      const comment = match[0].slice(2, -2).trim();
      if (comment.length > 10) {
        // Find associated code after the comment
        const afterComment = code.slice(match.index + match[0].length);
        const nextCodeMatch = afterComment.match(/^\s*([^\n]+)/);

        comments.push({
          filePath: '',
          lineNumber,
          commentText: comment,
          commentType: 'block',
          associatedCode: nextCodeMatch ? nextCodeMatch[1].trim() : '',
        });
      }
    }

    return comments;
  }

  /**
   * Compare semantic consistency between a comment and code (WU-CONTRA-001)
   * @param comment - The comment text
   * @param code - The code to compare against
   * @returns Object with consistent flag and confidence score
   */
  compareSemantics(comment: string, code: string): { consistent: boolean; confidence: number } {
    // Handle empty inputs
    if (!comment || comment.trim().length === 0) {
      return { consistent: true, confidence: 0.5 };
    }
    if (!code || code.trim().length === 0) {
      return { consistent: true, confidence: 0.5 };
    }

    // Extract verb from comment
    const commentVerb = this.extractVerbFromComment(comment);
    const funcName = this.extractFunctionName(code);
    const funcVerb = funcName ? this.extractVerbFromName(funcName) : null;

    // No verbs to compare
    if (!commentVerb || !funcVerb) {
      return { consistent: true, confidence: 0.3 };
    }

    // Check for conflicting verbs (high confidence inconsistency)
    for (const [v1, v2] of CONFLICTING_VERBS) {
      if ((this.verbMatches(commentVerb, v1) && this.verbMatches(funcVerb, v2)) ||
          (this.verbMatches(commentVerb, v2) && this.verbMatches(funcVerb, v1))) {
        return { consistent: false, confidence: 0.9 };
      }
    }

    // Check for noun mismatch BEFORE checking synonym verbs
    // This catches cases like "Fetches the user" vs "fetchProductDetails"
    const commentNoun = this.extractNounFromComment(comment);
    const funcNoun = funcName ? this.extractNounFromName(funcName) : null;

    if (commentNoun && funcNoun && !this.nounsRelated(commentNoun, funcNoun)) {
      return { consistent: false, confidence: 0.7 };
    }

    // Check for synonyms (high confidence consistency)
    if (this.verbsAreSynonyms(commentVerb, funcVerb)) {
      return { consistent: true, confidence: 0.85 };
    }

    // Verbs don't match but aren't synonyms or conflicts
    if (commentVerb !== funcVerb && !this.verbsAreSynonyms(commentVerb, funcVerb)) {
      return { consistent: false, confidence: 0.6 };
    }

    return { consistent: true, confidence: 0.7 };
  }

  /**
   * Extract comment/code pairs from a file
   */
  async extractPairs(filePath: string): Promise<CommentCodePair[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }

      const pairs: CommentCodePair[] = [];

      // Extract JSDoc comments from all functions (including nested ones)
      const allFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
      for (const func of allFunctions) {
        const jsDocs = func.getJsDocs();
        if (jsDocs.length > 0) {
          pairs.push(this.createPairFromJsDoc(jsDocs[0], func, filePath));
        }
      }

      // Extract JSDoc comments from class methods
      for (const cls of sourceFile.getClasses()) {
        for (const method of cls.getMethods()) {
          const jsDocs = method.getJsDocs();
          if (jsDocs.length > 0) {
            pairs.push(this.createPairFromJsDoc(jsDocs[0], method, filePath));
          }
        }
      }

      // Extract JSDoc comments from arrow functions assigned to variables
      for (const varStmt of sourceFile.getVariableStatements()) {
        const jsDocs = varStmt.getJsDocs();
        if (jsDocs.length > 0) {
          for (const decl of varStmt.getDeclarations()) {
            const initializer = decl.getInitializer();
            if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
              pairs.push(this.createPairFromJsDocVar(jsDocs[0], initializer, decl.getName(), filePath));
            }
          }
        }
      }

      // Extract inline and block comments
      const inlineAndBlockPairs = this.extractInlineAndBlockComments(sourceFile, filePath);
      pairs.push(...inlineAndBlockPairs);

      return pairs;
    } catch {
      return [];
    }
  }

  /**
   * Check a single pair for mismatches (name mismatch and semantic drift)
   */
  checkPair(pair: CommentCodePair): MismatchResult | null {
    // Check for name mismatch
    const nameMismatch = this.detectNameMismatch(pair);
    if (nameMismatch) return nameMismatch;

    // Check for semantic drift
    const semanticDrift = this.detectSemanticDrift(pair);
    if (semanticDrift) return semanticDrift;

    return null;
  }

  /**
   * Check for parameter mismatches (JSDoc @param vs actual params)
   */
  checkParameters(pair: CommentCodePair): MismatchResult | null {
    if (pair.commentType !== 'jsdoc') return null;

    const documentedParams = this.parseJsDocParams(pair.comment);
    const actualParams = this.parseCodeParams(pair.code);

    // If no @param documented and function has params, medium severity
    if (documentedParams.length === 0 && actualParams.length > 0) {
      return {
        pair,
        mismatchType: 'parameter_mismatch',
        severity: 'medium',
        description: `Function has ${actualParams.length} parameter(s) but no @param documentation: ${actualParams.join(', ')}`,
        suggestion: `Add @param documentation for: ${actualParams.join(', ')}`,
      };
    }

    // Check for documented params not in signature
    const missingInCode: string[] = [];
    for (const docParam of documentedParams) {
      if (!actualParams.includes(docParam) && !this.isDestructuredMatch(docParam, pair.code)) {
        missingInCode.push(docParam);
      }
    }

    // Check for actual params not documented
    const missingInDoc: string[] = [];
    for (const actualParam of actualParams) {
      if (!documentedParams.includes(actualParam) && !actualParam.startsWith('_')) {
        // Check if it's a destructured param
        if (!actualParam.startsWith('{')) {
          missingInDoc.push(actualParam);
        }
      }
    }

    if (missingInCode.length > 0) {
      return {
        pair,
        mismatchType: 'parameter_mismatch',
        severity: 'high',
        description: `Documented parameter(s) not in function signature: ${missingInCode.join(', ')}. Actual params: ${actualParams.join(', ')}`,
        suggestion: `Update @param documentation to match actual parameters: ${actualParams.join(', ')}`,
      };
    }

    if (missingInDoc.length > 0 && documentedParams.length > 0) {
      return {
        pair,
        mismatchType: 'parameter_mismatch',
        severity: 'medium',
        description: `Parameter(s) not documented: ${missingInDoc.join(', ')}`,
        suggestion: `Add @param documentation for: ${missingInDoc.join(', ')}`,
      };
    }

    return null;
  }

  /**
   * Check for return type mismatches (JSDoc @returns vs actual)
   */
  checkReturnType(pair: CommentCodePair): MismatchResult | null {
    if (pair.commentType !== 'jsdoc') return null;

    const documentedReturn = this.parseJsDocReturn(pair.comment);
    const actualReturn = this.parseCodeReturnType(pair.code);

    if (!documentedReturn) return null; // No @returns documented is OK

    // Normalize types for comparison
    const normalizedDoc = this.normalizeType(documentedReturn);
    const normalizedActual = this.normalizeType(actualReturn);

    // Check for void mismatch
    if (actualReturn === 'void' && documentedReturn !== 'void') {
      return {
        pair,
        mismatchType: 'return_mismatch',
        severity: 'high',
        description: `Documentation says @returns {${documentedReturn}} but function returns void`,
        suggestion: `Update @returns to match actual return type: void, or add return statement`,
      };
    }

    // Check for type mismatch
    if (normalizedDoc && normalizedActual && normalizedDoc !== normalizedActual) {
      // Handle Promise types
      const docInner = this.extractPromiseInner(normalizedDoc);
      const actualInner = this.extractPromiseInner(normalizedActual);

      if (docInner && actualInner && docInner !== actualInner) {
        return {
          pair,
          mismatchType: 'return_mismatch',
          severity: 'medium',
          description: `Documentation says @returns {${documentedReturn}} but function returns ${actualReturn}`,
          suggestion: `Update @returns to: @returns {${actualReturn}}`,
        };
      }

      if (!docInner && !actualInner && normalizedDoc !== normalizedActual) {
        return {
          pair,
          mismatchType: 'return_mismatch',
          severity: 'medium',
          description: `Documentation says @returns {${documentedReturn}} but function returns ${actualReturn}`,
          suggestion: `Update @returns to: @returns {${actualReturn}}`,
        };
      }
    }

    return null;
  }

  /**
   * Check for stale references (mentioned files/functions that don't exist)
   */
  checkStaleReferences(pair: CommentCodePair, facts: ASTFact[]): MismatchResult | null {
    // Extract references from comment
    const methodRefs = this.extractMethodReferences(pair.comment);
    const fileRefs = this.extractFileReferences(pair.comment);

    // Build set of existing functions/methods
    const existingFunctions = new Set<string>();
    const existingClasses = new Set<string>();
    const existingFiles = new Set<string>();

    for (const fact of facts) {
      if (fact.type === 'function_def') {
        existingFunctions.add(fact.identifier);
        const details = fact.details as { className?: string };
        if (details.className) {
          existingFunctions.add(`${details.className}.${fact.identifier}`);
        }
      }
      if (fact.type === 'class') {
        existingClasses.add(fact.identifier);
      }
      existingFiles.add(path.basename(fact.file));
      existingFiles.add(fact.file);
    }

    // Check method references
    for (const ref of methodRefs) {
      if (!existingFunctions.has(ref)) {
        // Check if it's ClassName.method format
        const parts = ref.split('.');
        if (parts.length === 2) {
          const [className] = parts;
          // If it's ClassName.method format, check if class exists
          if (!existingClasses.has(className) || !existingFunctions.has(ref)) {
            return {
              pair,
              mismatchType: 'stale_reference',
              severity: 'medium',
              description: `Comment references ${ref} which does not exist in the codebase`,
              suggestion: `Update comment to reference the correct method or remove the stale reference`,
            };
          }
        } else {
          // Simple function reference (not ClassName.method format)
          return {
            pair,
            mismatchType: 'stale_reference',
            severity: 'medium',
            description: `Comment references ${ref} which does not exist in the codebase`,
            suggestion: `Update comment to reference the correct function or remove the stale reference`,
          };
        }
      }
    }

    // Check file references
    for (const ref of fileRefs) {
      const basename = path.basename(ref);
      if (!existingFiles.has(basename) && !existingFiles.has(ref)) {
        return {
          pair,
          mismatchType: 'stale_reference',
          severity: 'low',
          description: `Comment references ${ref} which does not exist`,
          suggestion: `Update comment to reference the correct file or remove the stale reference`,
        };
      }
    }

    return null;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private getOrAddSourceFile(filePath: string): SourceFile | undefined {
    try {
      const absolutePath = path.resolve(filePath);
      let sourceFile = this.project.getSourceFile(absolutePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(absolutePath);
      }
      return sourceFile;
    } catch {
      return undefined;
    }
  }

  private getTypeScriptFiles(dirPath: string): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(fullPath);
          } else if (
            entry.isFile() &&
            (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
            !entry.name.endsWith('.d.ts')
          ) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    const stat = fs.statSync(dirPath);
    if (stat.isFile()) {
      return [dirPath];
    }

    walk(dirPath);
    return files;
  }

  private async extractAllFacts(repoPath: string): Promise<ASTFact[]> {
    // Simple fact extraction for stale reference checking
    const facts: ASTFact[] = [];
    const files = this.getTypeScriptFiles(repoPath);

    for (const file of files) {
      try {
        const sourceFile = this.getOrAddSourceFile(file);
        if (!sourceFile) continue;

        // Extract function definitions
        for (const func of sourceFile.getFunctions()) {
          const name = func.getName();
          if (name) {
            facts.push({
              type: 'function_def',
              identifier: name,
              file,
              line: func.getStartLineNumber(),
              details: {},
            });
          }
        }

        // Extract class definitions and methods
        for (const cls of sourceFile.getClasses()) {
          const className = cls.getName();
          if (className) {
            facts.push({
              type: 'class',
              identifier: className,
              file,
              line: cls.getStartLineNumber(),
              details: {},
            });

            for (const method of cls.getMethods()) {
              facts.push({
                type: 'function_def',
                identifier: method.getName(),
                file,
                line: method.getStartLineNumber(),
                details: { className },
              });
            }
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return facts;
  }

  private createPairFromJsDoc(
    jsDoc: JSDoc,
    func: FunctionDeclaration | MethodDeclaration,
    filePath: string
  ): CommentCodePair {
    return {
      file: filePath,
      line: jsDoc.getStartLineNumber(),
      comment: jsDoc.getText(),
      code: func.getText(),
      commentType: 'jsdoc',
    };
  }

  private createPairFromJsDocVar(
    jsDoc: JSDoc,
    func: ArrowFunction | FunctionExpression,
    name: string,
    filePath: string
  ): CommentCodePair {
    return {
      file: filePath,
      line: jsDoc.getStartLineNumber(),
      comment: jsDoc.getText(),
      code: `const ${name} = ${func.getText()}`,
      commentType: 'jsdoc',
    };
  }

  private extractInlineAndBlockComments(sourceFile: SourceFile, filePath: string): CommentCodePair[] {
    const pairs: CommentCodePair[] = [];
    const text = sourceFile.getFullText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Inline comment followed by code
      if (trimmed.startsWith('//') && !trimmed.startsWith('///')) {
        const comment = trimmed.slice(2).trim();
        // Look for code on the next non-empty, non-comment line
        let nextCodeLine = '';
        for (let j = i + 1; j < lines.length && j < i + 5; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.startsWith('//') && !nextLine.startsWith('/*')) {
            nextCodeLine = nextLine;
            break;
          }
        }
        if (nextCodeLine && comment.length > 5) {
          pairs.push({
            file: filePath,
            line: i + 1,
            comment,
            code: nextCodeLine,
            commentType: 'inline',
          });
        }
      }
    }

    // Block comments (non-JSDoc)
    const blockCommentRegex = /\/\*(?!\*)([\s\S]*?)\*\//g;
    let match;
    while ((match = blockCommentRegex.exec(text)) !== null) {
      const comment = match[1].trim();
      const startIndex = match.index;
      const beforeComment = text.slice(0, startIndex);
      const lineNumber = (beforeComment.match(/\n/g) || []).length + 1;

      // Get code after the comment
      const afterComment = text.slice(match.index + match[0].length);
      const nextCodeMatch = afterComment.match(/^\s*([^\n]+)/);
      if (nextCodeMatch && comment.length > 10) {
        pairs.push({
          file: filePath,
          line: lineNumber,
          comment,
          code: nextCodeMatch[1].trim(),
          commentType: 'block',
        });
      }
    }

    return pairs;
  }

  private parseJsDocParams(comment: string): string[] {
    const params: string[] = [];
    const paramRegex = /@param\s+(?:\{[^}]*\}\s+)?(\w+)/g;
    let match;
    while ((match = paramRegex.exec(comment)) !== null) {
      params.push(match[1]);
    }
    return params;
  }

  private parseCodeParams(code: string): string[] {
    // Match function parameters
    const funcMatch = code.match(/(?:function\s+\w+|const\s+\w+\s*=)\s*\(([^)]*)\)/);
    if (!funcMatch) return [];

    const paramsStr = funcMatch[1];
    if (!paramsStr.trim()) return [];

    const params: string[] = [];
    // Split by comma, but respect nested structures
    let depth = 0;
    let current = '';

    for (const char of paramsStr) {
      if (char === '(' || char === '{' || char === '<') depth++;
      if (char === ')' || char === '}' || char === '>') depth--;
      if (char === ',' && depth === 0) {
        const param = this.extractParamName(current.trim());
        if (param) params.push(param);
        current = '';
      } else {
        current += char;
      }
    }

    // Don't forget the last parameter
    const lastParam = this.extractParamName(current.trim());
    if (lastParam) params.push(lastParam);

    return params;
  }

  private extractParamName(paramStr: string): string | null {
    if (!paramStr) return null;

    // Handle destructured params: { id, name }: Type
    if (paramStr.startsWith('{')) {
      return paramStr.split(':')[0].trim();
    }

    // Handle rest params: ...args
    if (paramStr.startsWith('...')) {
      const match = paramStr.match(/\.\.\.(\w+)/);
      return match ? match[1] : null;
    }

    // Handle regular params: name: Type
    const match = paramStr.match(/^(\w+)/);
    return match ? match[1] : null;
  }

  private isDestructuredMatch(docParam: string, code: string): boolean {
    // Check if docParam could be referring to a destructured object
    const destructuredMatch = code.match(/\{\s*([^}]+)\s*\}/);
    if (destructuredMatch) {
      const props = destructuredMatch[1].split(',').map(p => p.trim().split(':')[0].trim());
      return props.includes(docParam);
    }
    return false;
  }

  private parseJsDocReturn(comment: string): string | null {
    const returnMatch = comment.match(/@returns?\s+\{([^}]+)\}/);
    return returnMatch ? returnMatch[1].trim() : null;
  }

  private parseCodeReturnType(code: string): string {
    // Match return type annotation
    const returnMatch = code.match(/\)\s*:\s*([^{=]+)/);
    if (returnMatch) {
      return returnMatch[1].trim().replace(/\s*\{.*$/, '');
    }
    return 'void';
  }

  private normalizeType(type: string): string {
    return type.toLowerCase().replace(/\s+/g, '').replace(/;$/, '');
  }

  private extractPromiseInner(type: string): string | null {
    const match = type.match(/promise<([^>]+)>/i);
    return match ? match[1] : null;
  }

  private detectNameMismatch(pair: CommentCodePair): MismatchResult | null {
    const funcName = this.extractFunctionName(pair.code);
    if (!funcName) return null;

    // Skip @deprecated comments - those are handled by semantic drift detection
    if (pair.comment.toLowerCase().includes('@deprecated')) return null;

    const commentVerb = this.extractVerbFromComment(pair.comment);
    const funcVerb = this.extractVerbFromName(funcName);

    if (!commentVerb || !funcVerb) return null;

    // Check for conflicting verbs (high severity)
    for (const [v1, v2] of CONFLICTING_VERBS) {
      if ((this.verbMatches(commentVerb, v1) && this.verbMatches(funcVerb, v2)) ||
          (this.verbMatches(commentVerb, v2) && this.verbMatches(funcVerb, v1))) {
        return {
          pair,
          mismatchType: 'name_mismatch',
          severity: 'high',
          description: `Comment uses verb "${commentVerb}" but function name suggests "${funcVerb}" (function: ${funcName})`,
          suggestion: `Update the comment to match the function's actual behavior, or rename the function`,
        };
      }
    }

    // Check for noun mismatch even when verbs are synonyms
    const commentNoun = this.extractNounFromComment(pair.comment);
    const funcNoun = this.extractNounFromName(funcName);

    if (commentNoun && funcNoun && !this.nounsRelated(commentNoun, funcNoun)) {
      return {
        pair,
        mismatchType: 'name_mismatch',
        severity: 'medium',
        description: `Comment describes "${commentVerb} ${commentNoun}" but function is named "${funcName}"`,
        suggestion: `Update the comment to describe what the function actually does`,
      };
    }

    // Check for non-synonym verbs (medium severity)
    if (!this.verbsAreSynonyms(commentVerb, funcVerb)) {
      // If just verbs differ significantly
      return {
        pair,
        mismatchType: 'name_mismatch',
        severity: 'medium',
        description: `Comment uses verb "${commentVerb}" but function name uses "${funcVerb}" (function: ${funcName})`,
        suggestion: `Update the comment to match the function's actual behavior`,
      };
    }

    return null;
  }

  private detectSemanticDrift(pair: CommentCodePair): MismatchResult | null {
    const comment = pair.comment.toLowerCase();

    // Check for TODO/FIXME with implemented feature
    if (comment.includes('todo') || comment.includes('fixme')) {
      // Check if the TODO mentions something that appears to be implemented
      if (comment.includes('implement') && pair.code.length > 50) {
        // Heuristic: if code is substantial, the TODO might be stale
        return {
          pair,
          mismatchType: 'semantic_drift',
          severity: 'low',
          description: 'TODO comment may be stale - the feature appears to be implemented',
          suggestion: 'Review and remove the TODO if the feature is complete',
        };
      }
    }

    // Check for deprecated references
    if (comment.includes('deprecated') && comment.includes('instead')) {
      // If comment says to use X instead, but code uses X, the comment might be stale
      const insteadMatch = pair.comment.match(/(?:use|call)\s+(\w+(?:\.\w+)?)\s+instead/i);
      if (insteadMatch) {
        const suggestedMethod = insteadMatch[1];
        if (pair.code.includes(suggestedMethod)) {
          return {
            pair,
            mismatchType: 'semantic_drift',
            severity: 'low',
            description: `Comment suggests using ${suggestedMethod} but code already uses it - deprecation notice may be stale`,
            suggestion: 'Review and update the deprecation notice',
          };
        }
      }
    }

    return null;
  }

  private extractFunctionName(code: string): string | null {
    // Match function name
    const funcMatch = code.match(/function\s+(\w+)/);
    if (funcMatch) return funcMatch[1];

    // Match arrow function assigned to const
    const arrowMatch = code.match(/const\s+(\w+)\s*=/);
    if (arrowMatch) return arrowMatch[1];

    // Match method name
    const methodMatch = code.match(/^\s*(\w+)\s*\(/m);
    if (methodMatch) return methodMatch[1];

    return null;
  }

  private extractVerbFromComment(comment: string): string | null {
    // Look for common patterns like "Gets the user", "Validates input"
    // Handle JSDoc comments which start with /** or *
    const lines = comment.split('\n');
    let firstContentLine = '';

    for (const line of lines) {
      // Remove JSDoc artifacts: /**, *, */
      const cleaned = line
        .replace(/^[\s]*\/\*\*?\s*/, '')  // Remove /** or /*
        .replace(/^[\s]*\*\s*/, '')        // Remove leading *
        .replace(/\*\/[\s]*$/, '')         // Remove trailing */
        .trim();

      // Skip @param, @returns lines and empty lines
      if (cleaned && !cleaned.startsWith('@')) {
        firstContentLine = cleaned;
        break;
      }
    }

    if (!firstContentLine) return null;

    // Extract first word (verb) - handles "Validates the input", "Gets user"
    const match = firstContentLine.match(/^(\w+?)(?:s|es|ed|ing)?\b/i);
    if (!match) return null;

    // Normalize verb - remove common suffixes to get base form
    let verb = match[1].toLowerCase();

    // Handle verbs that don't end with a suffix (e.g., "Get" -> "get")
    // For verbs ending in 's' (e.g., "Fetches"), the regex captures "Fetche"
    // so we need to handle this differently
    const fullWord = firstContentLine.match(/^(\w+)\b/i);
    if (fullWord) {
      const word = fullWord[1].toLowerCase();
      // Strip common verb suffixes and restore base form
      if (word.endsWith('ies')) {
        // "carries" -> "carry"
        verb = word.slice(0, -3) + 'y';
      } else if (word.endsWith('es')) {
        verb = word.slice(0, -2);
        // Handle special cases where base form ends in 'e':
        // "validates" -> "validate", "retrieves" -> "retrieve", "enables" -> "enable"
        // Consonants that commonly precede 'es' in verbs with silent 'e': t, z, v, l, n, s, c, g
        if (verb.endsWith('t') || verb.endsWith('z') || verb.endsWith('v') ||
            verb.endsWith('l') || verb.endsWith('n') || verb.endsWith('c') ||
            verb.endsWith('g') || verb.endsWith('s')) {
          verb = verb + 'e';
        }
      } else if (word.endsWith('s') && !word.endsWith('ss')) {
        verb = word.slice(0, -1);
      } else if (word.endsWith('ed')) {
        verb = word.slice(0, -2);
        if (verb.endsWith('i')) {
          verb = verb.slice(0, -1) + 'y';
        } else if (!verb.endsWith('e') && /[^aeiou][aeiouy][^aeiouwy]$/.test(verb)) {
          // Handle doubled consonants: "stopped" -> "stop" (already handled by slice)
        }
      } else if (word.endsWith('ing')) {
        verb = word.slice(0, -3);
        // Handle "getting" -> "get" (doubled consonant)
        if (verb.length > 2 && verb.slice(-1) === verb.slice(-2, -1)) {
          verb = verb.slice(0, -1);
        }
        // Handle "creating" -> "create" (dropped 'e')
        if (!verb.match(/[aeiou]$/)) {
          // Check if adding 'e' makes a valid-looking verb
          const withE = verb + 'e';
          if (/[aeiou].*[^aeiou]e$/.test(withE)) {
            verb = withE;
          }
        }
      } else {
        verb = word;
      }
    }

    return verb;
  }

  private extractVerbFromName(name: string): string | null {
    // Split camelCase/PascalCase
    const parts = name.split(/(?=[A-Z])/).map(p => p.toLowerCase());
    return parts[0] || null;
  }

  private extractNounFromComment(comment: string): string | null {
    // Find first content line (skip JSDoc artifacts)
    const lines = comment.split('\n');
    let firstContentLine = '';

    for (const line of lines) {
      const cleaned = line
        .replace(/^[\s]*\/\*\*?\s*/, '')
        .replace(/^[\s]*\*\s*/, '')
        .replace(/\*\/[\s]*$/, '')
        .trim();

      if (cleaned && !cleaned.startsWith('@')) {
        firstContentLine = cleaned;
        break;
      }
    }

    if (!firstContentLine) return null;

    // Common adjectives to skip
    const adjectives = ['new', 'old', 'current', 'existing', 'given', 'specified', 'provided', 'valid', 'unique'];

    // Try to match "the/a/an [adjective]* noun"
    const match = firstContentLine.match(/(?:the|a|an)\s+(\w+)(?:\s+(\w+))?/i);
    if (!match) return null;

    // If first word is an adjective, use the second word
    if (adjectives.includes(match[1].toLowerCase()) && match[2]) {
      return match[2].toLowerCase();
    }

    return match[1].toLowerCase();
  }

  private extractNounFromName(name: string): string | null {
    const parts = name.split(/(?=[A-Z])/).map(p => p.toLowerCase());
    return parts.length > 1 ? parts.slice(1).join('') : null;
  }

  private verbMatches(verb: string, target: string): boolean {
    const normalizedVerb = verb.toLowerCase();
    const normalizedTarget = target.toLowerCase();

    if (normalizedVerb === normalizedTarget) return true;
    if (normalizedVerb.startsWith(normalizedTarget)) return true;

    const synonyms = VERB_SYNONYMS[normalizedTarget] || [];
    return synonyms.some(s => normalizedVerb.startsWith(s));
  }

  private verbsAreSynonyms(verb1: string, verb2: string): boolean {
    const v1 = verb1.toLowerCase();
    const v2 = verb2.toLowerCase();

    if (v1 === v2) return true;

    // Check if they're in the same synonym group
    for (const [key, synonyms] of Object.entries(VERB_SYNONYMS)) {
      const group = [key, ...synonyms];
      const v1InGroup = group.some(s => v1.startsWith(s));
      const v2InGroup = group.some(s => v2.startsWith(s));
      if (v1InGroup && v2InGroup) return true;
    }

    return false;
  }

  private nounsRelated(commentNoun: string, funcNoun: string): boolean {
    const n1 = commentNoun.toLowerCase();
    const n2 = funcNoun.toLowerCase();

    // Exact match
    if (n1 === n2) return true;

    // One contains the other (e.g., "user" and "userbyid", "product" and "productdetails")
    if (n2.startsWith(n1) || n2.includes(n1)) return true;
    if (n1.startsWith(n2) || n1.includes(n2)) return true;

    return false;
  }

  private extractMethodReferences(comment: string): string[] {
    const refs: string[] = [];

    // Match patterns like ClassName.methodName() or methodName()
    const methodRegex = /(\w+(?:\.\w+)?)\s*\(\)/g;
    let match;
    while ((match = methodRegex.exec(comment)) !== null) {
      refs.push(match[1]);
    }

    // Also match patterns like "the processData helper function" or "calls processData()"
    // Note: \(\) is optional to handle both "processData" and "processData()"
    const helperRegex = /(?:the|calls?|uses?|invoke[sd]?)\s+(\w+(?:\.\w+)?)\s*(?:\(\))?\s+(?:helper|function|method)/gi;
    while ((match = helperRegex.exec(comment)) !== null) {
      if (!refs.includes(match[1])) {
        refs.push(match[1]);
      }
    }

    return refs;
  }

  private extractFileReferences(comment: string): string[] {
    const refs: string[] = [];

    // Match file paths like src/utils/helpers.ts or ./helpers.ts
    const fileRegex = /(?:(?:\.\/|src\/|lib\/)?[\w/.-]+\.(?:ts|tsx|js|jsx))/g;
    let match;
    while ((match = fileRegex.exec(comment)) !== null) {
      refs.push(match[0]);
    }

    return refs;
  }

  private createEmptyReport(repoPath: string, analyzedAt: string): CommentCodeReport {
    return {
      repoPath,
      analyzedAt,
      totalPairs: 0,
      mismatches: [],
      mismatchRate: 0,
      summary: {
        byType: {},
        bySeverity: {},
      },
    };
  }

  private computeSummary(mismatches: MismatchResult[]): { byType: Record<string, number>; bySeverity: Record<string, number> } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const mismatch of mismatches) {
      byType[mismatch.mismatchType] = (byType[mismatch.mismatchType] || 0) + 1;
      bySeverity[mismatch.severity] = (bySeverity[mismatch.severity] || 0) + 1;
    }

    return { byType, bySeverity };
  }

  // ============================================================================
  // WU-CONTRA-001: NEW PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Create an empty consistency report for a file
   */
  private createEmptyConsistencyReport(filePath: string): ConsistencyReport {
    return {
      filePath,
      totalComments: 0,
      analyzedComments: 0,
      issues: [],
      overallScore: 100,
    };
  }

  /**
   * Map comment type from CommentAnalysis to CommentCodePair format
   */
  private mapCommentType(type: 'inline' | 'block' | 'jsdoc' | 'todo'): 'jsdoc' | 'inline' | 'block' | 'docstring' {
    if (type === 'todo') return 'inline';
    return type;
  }

  /**
   * Convert a MismatchResult to a ConsistencyIssue
   */
  private mismatchToConsistencyIssue(mismatch: MismatchResult, comment: CommentAnalysis): ConsistencyIssue {
    // Generate unique ID
    const id = `issue-${comment.filePath.replace(/[^a-z0-9]/gi, '-')}-${comment.lineNumber}-${Date.now()}`;

    // Map severity
    const severityMap: Record<string, 'info' | 'warning' | 'error'> = {
      high: 'error',
      medium: 'warning',
      low: 'info',
    };
    const severity = severityMap[mismatch.severity] || 'info';

    // Map issue type
    const issueType = this.mapMismatchTypeToIssueType(mismatch);

    // Calculate confidence based on severity
    const confidenceMap: Record<string, number> = {
      high: 0.9,
      medium: 0.7,
      low: 0.5,
    };
    const confidence = confidenceMap[mismatch.severity] || 0.5;

    return {
      id,
      severity,
      commentAnalysis: comment,
      issueType,
      description: mismatch.description,
      suggestion: mismatch.suggestion,
      confidence,
    };
  }

  /**
   * Map mismatch type to issue type
   */
  private mapMismatchTypeToIssueType(mismatch: MismatchResult): 'outdated' | 'misleading' | 'incorrect' | 'contradictory' {
    switch (mismatch.mismatchType) {
      case 'parameter_mismatch':
        return 'incorrect';
      case 'return_mismatch':
        return 'incorrect';
      case 'name_mismatch':
        // Check if it's a conflicting verb (contradictory) or just different (misleading)
        if (mismatch.severity === 'high') {
          return 'contradictory';
        }
        return 'misleading';
      case 'semantic_drift':
        return 'outdated';
      case 'stale_reference':
        return 'outdated';
      default:
        return 'misleading';
    }
  }

  /**
   * Extract function body from code starting at a match
   */
  private extractFunctionBody(code: string, matchStart: string): string {
    const startIndex = code.indexOf(matchStart);
    if (startIndex === -1) return '';

    let depth = 0;
    let inFunction = false;
    let endIndex = startIndex + matchStart.length;

    for (let i = startIndex; i < code.length; i++) {
      const char = code[i];
      if (char === '{') {
        depth++;
        inFunction = true;
      } else if (char === '}') {
        depth--;
        if (inFunction && depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    return code.slice(startIndex, endIndex);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CommentCodeChecker instance
 */
export function createCommentCodeChecker(): CommentCodeChecker {
  return new CommentCodeChecker();
}
