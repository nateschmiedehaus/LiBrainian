/**
 * @fileoverview Multi-Vector Representations
 *
 * Instead of one embedding per file, we create multiple embeddings
 * for different aspects:
 *
 * 1. SEMANTIC (Purpose) - What the code DOES
 *    → Extracted via LLM (Claude/Codex) for accuracy
 *    → Fallback to heuristic extraction
 *
 * 2. STRUCTURAL - How the code is ORGANIZED
 *    → AST patterns, class hierarchy, function signatures
 *    → Captures architectural similarity
 *
 * 3. DEPENDENCY - What the code USES
 *    → Import graph, external dependencies
 *    → Captures integration relationships
 *
 * 4. USAGE - How the code is CALLED
 *    → Export patterns, function signatures
 *    → Captures API similarity
 *
 * QUERY-TIME WEIGHTING:
 * Different queries need different vectors:
 * - "Find similar functionality" → weight SEMANTIC heavily
 * - "Find files with same patterns" → weight STRUCTURAL
 * - "Find related modules" → weight DEPENDENCY
 * - "Find compatible APIs" → weight USAGE
 */

import * as ts from 'typescript';
import {
  generateRealEmbedding,
  cosineSimilarity,
  type EmbeddingModelId,
} from './real_embeddings.js';

// ============================================================================
// TYPES
// ============================================================================

export interface MultiVector {
  filePath: string;
  /** PURPOSE-ONLY vector: embeds ONLY the extracted purpose statement
   *  This is the primary signal for "what does X do?" queries.
   *  Does NOT include code - pure semantic intent. */
  purpose?: Float32Array;
  purposeInput?: string;
  /** Semantic vector (purpose + code preview, legacy for implementation search) */
  semantic?: Float32Array;
  semanticInput?: string;
  /** Structural pattern vector (how it's organized) */
  structural?: Float32Array;
  structuralInput?: string;
  /** Dependency vector (what it uses) */
  dependency?: Float32Array;
  dependencyInput?: string;
  /** Usage vector (how it's called) */
  usage?: Float32Array;
  usageInput?: string;
  /** LLM-extracted purpose (high quality) */
  llmPurpose?: string;
  /** Metadata */
  lastUpdated: number;
  modelId: EmbeddingModelId;
}

export interface VectorWeights {
  /** Purpose-only weight (for "what does X do?" queries) */
  purpose: number;
  semantic: number;
  structural: number;
  dependency: number;
  usage: number;
}

export type VectorType = keyof VectorWeights;

export interface MultiVectorQuery {
  queryText: string;
  queryEmbedding?: Float32Array;
  weights?: Partial<VectorWeights>;
}

export interface MultiVectorMatch {
  filePath: string;
  scores: {
    purpose: number;
    semantic: number;
    structural: number;
    dependency: number;
    usage: number;
  };
  weightedScore: number;
  matchedAspects: string[];
}

export interface VectorRedundancyAnalysis {
  correlations: Map<string, number>;
  redundantPairs: Array<[VectorType, VectorType]>;
  recommendation: 'keep_all' | 'consolidate' | 'drop_redundant';
}

// ============================================================================
// DEFAULT WEIGHTS BY QUERY TYPE
// ============================================================================

export const QUERY_TYPE_WEIGHTS: Record<string, VectorWeights> = {
  // PURPOSE QUERY: "What does X do?", "Explain X", "Purpose of X"
  // Heavily weights the pure purpose vector, ignores implementation details
  'purpose-query': {
    purpose: 0.7,    // Primary signal - pure intent/purpose
    semantic: 0.15,  // Some code context
    structural: 0.05,
    dependency: 0.05,
    usage: 0.05,
  },
  // Find files that do similar things (implementation-focused)
  'similar-purpose': {
    purpose: 0.3,
    semantic: 0.4,
    structural: 0.1,
    dependency: 0.1,
    usage: 0.1,
  },
  // Find files with same architectural patterns
  'similar-structure': {
    purpose: 0.05,
    semantic: 0.1,
    structural: 0.6,
    dependency: 0.15,
    usage: 0.1,
  },
  // Find files in same dependency cluster
  'related-modules': {
    purpose: 0.1,
    semantic: 0.1,
    structural: 0.1,
    dependency: 0.6,
    usage: 0.1,
  },
  // Find files with compatible APIs
  'compatible-apis': {
    purpose: 0.1,
    semantic: 0.1,
    structural: 0.1,
    dependency: 0.1,
    usage: 0.6,
  },
  // Balanced search
  'default': {
    purpose: 0.25,
    semantic: 0.25,
    structural: 0.2,
    dependency: 0.15,
    usage: 0.15,
  },
};

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

/**
 * Extract semantic purpose content for embedding.
 * Uses heuristics - LLM extraction is done separately.
 */
export function extractSemanticContent(
  filePath: string,
  content: string
): string {
  const parts: string[] = [];

  // Add file path context
  parts.push(`File: ${filePath}`);

  // Extract file-level comment if present
  const fileComment = extractFileComment(content);
  if (fileComment) {
    parts.push(`Description: ${fileComment}`);
  }

  // Extract function/class names with brief context
  const symbols = extractSymbolSummary(content);
  if (symbols) {
    parts.push(`Contains: ${symbols}`);
  }

  // Add first 500 chars of actual code for context
  const codePreview = content.slice(0, 500);
  parts.push(`Code preview:\n${codePreview}`);

  return parts.join('\n');
}

/**
 * Extract structural pattern content for embedding.
 */
export function extractStructuralContent(
  filePath: string,
  content: string
): string {
  const parts: string[] = [];

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    // Count by type
    const counts: Record<string, number> = {
      function: 0,
      class: 0,
      interface: 0,
      type: 0,
      enum: 0,
      variable: 0,
    };

    const patterns: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node)) {
        counts.function++;
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          patterns.push('async-function');
        }
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          patterns.push('exported-function');
        }
      } else if (ts.isClassDeclaration(node)) {
        counts.class++;
        if (node.heritageClauses?.length) {
          patterns.push('class-with-inheritance');
        }
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) {
          patterns.push('abstract-class');
        }
      } else if (ts.isInterfaceDeclaration(node)) {
        counts.interface++;
        if (node.heritageClauses?.length) {
          patterns.push('extended-interface');
        }
      } else if (ts.isTypeAliasDeclaration(node)) {
        counts.type++;
      } else if (ts.isEnumDeclaration(node)) {
        counts.enum++;
      } else if (ts.isVariableStatement(node)) {
        counts.variable++;
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer) {
            if (ts.isArrowFunction(decl.initializer)) {
              patterns.push('arrow-function');
            } else if (ts.isObjectLiteralExpression(decl.initializer)) {
              patterns.push('object-literal');
            } else if (ts.isArrayLiteralExpression(decl.initializer)) {
              patterns.push('array-literal');
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Build structural description
    parts.push(`File structure: ${filePath}`);

    const countDesc = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`)
      .join(', ');
    if (countDesc) {
      parts.push(`Contains: ${countDesc}`);
    }

    const uniquePatterns = [...new Set(patterns)];
    if (uniquePatterns.length > 0) {
      parts.push(`Patterns: ${uniquePatterns.join(', ')}`);
    }

    // Estimate complexity
    const loc = content.split('\n').length;
    const complexity = loc < 100 ? 'small' : loc < 300 ? 'medium' : 'large';
    parts.push(`Size: ${complexity} (${loc} lines)`);

  } catch (error) {
    parts.push(`File: ${filePath}`);
    parts.push(`Unable to parse AST`);
  }

  return parts.join('\n');
}

/**
 * Extract dependency content for embedding.
 */
export function extractDependencyContent(
  filePath: string,
  content: string
): string {
  const parts: string[] = [];

  parts.push(`File: ${filePath}`);

  // Extract imports
  const imports: string[] = [];
  const importRegex = /import\s+(?:.*?from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  if (imports.length > 0) {
    // Categorize imports
    const nodeModules = imports.filter((i) => !i.startsWith('.'));
    const localModules = imports.filter((i) => i.startsWith('.'));

    if (nodeModules.length > 0) {
      parts.push(`External dependencies: ${nodeModules.join(', ')}`);
    }
    if (localModules.length > 0) {
      // Simplify local imports
      const simplified = localModules.map((i) =>
        i.replace(/\.\.\//g, '').replace(/\.\//g, '').replace(/\.js$/, '')
      );
      parts.push(`Local imports: ${simplified.join(', ')}`);
    }
  } else {
    parts.push('No imports');
  }

  // Check for specific framework patterns
  const frameworks: string[] = [];
  if (content.includes('React') || content.includes('useState') || content.includes('useEffect')) {
    frameworks.push('React');
  }
  if (content.includes('express') || content.includes('Router()')) {
    frameworks.push('Express');
  }
  if (content.includes('vitest') || content.includes('describe(') || content.includes('it(')) {
    frameworks.push('testing');
  }
  if (content.includes('prisma') || content.includes('sqlite') || content.includes('mongoose')) {
    frameworks.push('database');
  }

  if (frameworks.length > 0) {
    parts.push(`Frameworks: ${frameworks.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Extract usage/API content for embedding.
 */
export function extractUsageContent(
  filePath: string,
  content: string
): string {
  const parts: string[] = [];

  parts.push(`File: ${filePath}`);

  // Extract exports
  const exports: string[] = [];
  const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Also check for export { ... }
  const reExportRegex = /export\s+\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map((n) => n.trim().split(/\s+/)[0]);
    exports.push(...names);
  }

  if (exports.length > 0) {
    parts.push(`Exports: ${exports.join(', ')}`);
  } else {
    parts.push('No exports (internal module)');
  }

  // Extract function signatures for public API
  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const signatures: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const isExported = node.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword
        );
        if (isExported) {
          const params = node.parameters.map((p) => p.name.getText()).join(', ');
          const returnType = node.type ? `: ${node.type.getText()}` : '';
          signatures.push(`${node.name.text}(${params})${returnType}`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (signatures.length > 0) {
      parts.push(`API signatures: ${signatures.slice(0, 10).join('; ')}`);
    }
  } catch {
    // Ignore parse errors
  }

  return parts.join('\n');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractFileComment(content: string): string | null {
  // Look for @fileoverview or @description in first comment
  const commentMatch = content.match(/\/\*\*[\s\S]*?\*\//);
  if (commentMatch) {
    const comment = commentMatch[0];
    const overviewMatch = comment.match(/@fileoverview\s+(.+?)(?:\n|\*\/)/s);
    if (overviewMatch) {
      return overviewMatch[1].replace(/\s*\*\s*/g, ' ').trim();
    }
    const descMatch = comment.match(/@description\s+(.+?)(?:\n|\*\/)/s);
    if (descMatch) {
      return descMatch[1].replace(/\s*\*\s*/g, ' ').trim();
    }
    // Just get first paragraph
    const firstPara = comment
      .replace(/^\/\*\*\s*/, '')
      .replace(/\s*\*\/$/, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s*/, '').trim())
      .filter((l) => l && !l.startsWith('@'))
      .slice(0, 3)
      .join(' ');
    if (firstPara) {
      return firstPara;
    }
  }
  return null;
}

function extractSymbolSummary(content: string): string | null {
  const symbols: string[] = [];

  // Classes
  const classRegex = /(?:export\s+)?class\s+(\w+)/g;
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    symbols.push(`class ${match[1]}`);
  }

  // Functions
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcRegex.exec(content)) !== null) {
    symbols.push(`function ${match[1]}`);
  }

  // Interfaces
  const ifaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
  while ((match = ifaceRegex.exec(content)) !== null) {
    symbols.push(`interface ${match[1]}`);
  }

  // Types
  const typeRegex = /(?:export\s+)?type\s+(\w+)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    symbols.push(`type ${match[1]}`);
  }

  if (symbols.length > 0) {
    return symbols.slice(0, 15).join(', ');
  }
  return null;
}

// ============================================================================
// MULTI-VECTOR GENERATION
// ============================================================================

/**
 * Build pure purpose input for embedding.
 * This is ONLY the purpose statement - no code, no file paths, no implementation.
 * Designed for "what does X do?" queries.
 *
 * Fallback priority:
 *   1. llmPurpose — highest quality, LLM-extracted
 *   2. @fileoverview / @description / first JSDoc paragraph from fileContent
 *   3. Filename-derived human-readable name (last resort)
 */
export function buildPurposeOnlyInput(filePath: string, llmPurpose?: string, fileContent?: string): string {
  // Validate filePath to prevent garbage embeddings from empty inputs
  if (!filePath || !filePath.trim()) {
    throw new Error('unverified_by_trace(purpose_input_invalid): filePath is required for purpose embedding');
  }

  if (llmPurpose && llmPurpose.trim()) {
    // Sanitize llmPurpose: limit length and remove control characters
    const sanitized = llmPurpose
      .trim()
      .slice(0, 10000) // Limit to 10KB to prevent embedding corruption
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, ''); // Remove control chars except \t\n\r
    // Use LLM-extracted purpose directly - this is the highest quality signal
    return sanitized;
  }

  // Intermediate fallback: extract @fileoverview / @description / first JSDoc paragraph
  if (fileContent) {
    const docComment = extractFileComment(fileContent);
    if (docComment && docComment.trim()) {
      return docComment.trim();
    }
  }

  // Last resort: derive a human-readable name from the filename
  const basename = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
  const humanReadable = basename
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return `Module: ${humanReadable}`;
}

/**
 * Generate all vectors for a file.
 */
export async function generateMultiVector(
  filePath: string,
  content: string,
  options: {
    modelId?: EmbeddingModelId;
    llmPurpose?: string; // Pre-extracted by Claude/Codex
  } = {}
): Promise<MultiVector> {
  const { modelId = 'all-MiniLM-L6-v2', llmPurpose } = options;

  const result: MultiVector = {
    filePath,
    lastUpdated: Date.now(),
    modelId,
    llmPurpose,
  };

  // Generate PURPOSE-ONLY vector (no code, pure intent)
  // This is the primary signal for "what does X do?" queries
  result.purposeInput = buildPurposeOnlyInput(filePath, llmPurpose, content);
  const purposeResult = await generateRealEmbedding(result.purposeInput, modelId);
  result.purpose = purposeResult.embedding;

  // Generate semantic vector (purpose + code preview for implementation search)
  let semanticInput = extractSemanticContent(filePath, content);
  if (llmPurpose) {
    // Prepend LLM purpose for higher quality semantic embedding
    semanticInput = `Purpose: ${llmPurpose}\n\n${semanticInput}`;
  }
  result.semanticInput = semanticInput;
  const semanticResult = await generateRealEmbedding(semanticInput, modelId);
  result.semantic = semanticResult.embedding;

  // Generate structural vector
  result.structuralInput = extractStructuralContent(filePath, content);
  const structuralResult = await generateRealEmbedding(result.structuralInput, modelId);
  result.structural = structuralResult.embedding;

  // Generate dependency vector
  result.dependencyInput = extractDependencyContent(filePath, content);
  const dependencyResult = await generateRealEmbedding(result.dependencyInput, modelId);
  result.dependency = dependencyResult.embedding;

  // Generate usage vector
  result.usageInput = extractUsageContent(filePath, content);
  const usageResult = await generateRealEmbedding(result.usageInput, modelId);
  result.usage = usageResult.embedding;

  return result;
}

// ============================================================================
// MULTI-VECTOR SIMILARITY
// ============================================================================

/**
 * Compute weighted similarity between two multi-vectors.
 */
export function computeMultiVectorSimilarity(
  vectorA: MultiVector,
  vectorB: MultiVector,
  weights: VectorWeights = QUERY_TYPE_WEIGHTS['default']
): MultiVectorMatch {
  const scores = {
    purpose: 0,
    semantic: 0,
    structural: 0,
    dependency: 0,
    usage: 0,
  };

  const matchedAspects: string[] = [];

  // Compute PURPOSE similarity (primary for "what does X do?")
  if (vectorA.purpose && vectorB.purpose) {
    scores.purpose = cosineSimilarity(vectorA.purpose, vectorB.purpose);
    if (scores.purpose > 0.5) matchedAspects.push('purpose');
  }

  // Compute individual similarities
  if (vectorA.semantic && vectorB.semantic) {
    scores.semantic = cosineSimilarity(vectorA.semantic, vectorB.semantic);
    if (scores.semantic > 0.5) matchedAspects.push('semantic');
  }

  if (vectorA.structural && vectorB.structural) {
    scores.structural = cosineSimilarity(vectorA.structural, vectorB.structural);
    if (scores.structural > 0.5) matchedAspects.push('structural');
  }

  if (vectorA.dependency && vectorB.dependency) {
    scores.dependency = cosineSimilarity(vectorA.dependency, vectorB.dependency);
    if (scores.dependency > 0.5) matchedAspects.push('dependency');
  }

  if (vectorA.usage && vectorB.usage) {
    scores.usage = cosineSimilarity(vectorA.usage, vectorB.usage);
    if (scores.usage > 0.5) matchedAspects.push('usage');
  }

  // Compute weighted score
  const weightedScore =
    scores.purpose * weights.purpose +
    scores.semantic * weights.semantic +
    scores.structural * weights.structural +
    scores.dependency * weights.dependency +
    scores.usage * weights.usage;

  return {
    filePath: vectorB.filePath,
    scores,
    weightedScore,
    matchedAspects,
  };
}

/**
 * Query against a collection of multi-vectors.
 */
export async function queryMultiVectors(
  query: MultiVectorQuery,
  vectors: MultiVector[],
  options: {
    topK?: number;
    queryType?: keyof typeof QUERY_TYPE_WEIGHTS;
    modelId?: EmbeddingModelId;
  } = {}
): Promise<MultiVectorMatch[]> {
  const {
    topK = 10,
    queryType = 'default',
    modelId = 'all-MiniLM-L6-v2',
  } = options;

  const weights = {
    ...QUERY_TYPE_WEIGHTS[queryType],
    ...query.weights,
  };

  // Generate query embedding if not provided
  let queryEmbedding = query.queryEmbedding;
  if (!queryEmbedding) {
    const result = await generateRealEmbedding(query.queryText, modelId);
    queryEmbedding = result.embedding;
  }

  // Create a pseudo multi-vector for the query
  // Purpose vector uses the query directly (user's intent)
  const queryVector: MultiVector = {
    filePath: 'query',
    purpose: queryEmbedding,  // Query IS the purpose/intent
    semantic: queryEmbedding,
    structural: queryEmbedding,
    dependency: queryEmbedding,
    usage: queryEmbedding,
    lastUpdated: Date.now(),
    modelId,
  };

  // Compute similarity to all vectors
  const matches = vectors.map((v) =>
    computeMultiVectorSimilarity(queryVector, v, weights)
  );

  // Sort by weighted score
  matches.sort((a, b) => b.weightedScore - a.weightedScore);

  return matches.slice(0, topK);
}

const VECTOR_TYPES: VectorType[] = ['purpose', 'semantic', 'structural', 'dependency', 'usage'];

function computeAverageCorrelation(
  samples: MultiVector[],
  typeA: VectorType,
  typeB: VectorType
): number {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    const vecA = sample[typeA];
    const vecB = sample[typeB];
    if (!vecA || !vecB) continue;
    sum += cosineSimilarity(vecA, vecB);
    count += 1;
  }
  if (count === 0) return 0;
  return sum / count;
}

function vectorPairKey(typeA: VectorType, typeB: VectorType): string {
  return `${typeA}|${typeB}`;
}

const REDUNDANCY_CANDIDATES = new Set<string>([
  vectorPairKey('purpose', 'semantic'),
]);

function isRedundancyCandidate(typeA: VectorType, typeB: VectorType): boolean {
  return REDUNDANCY_CANDIDATES.has(vectorPairKey(typeA, typeB));
}

export function analyzeVectorRedundancy(
  samples: MultiVector[],
  correlationThreshold: number = 0.95
): VectorRedundancyAnalysis {
  const correlations = new Map<string, number>();
  const redundantPairs: Array<[VectorType, VectorType]> = [];

  for (let i = 0; i < VECTOR_TYPES.length; i++) {
    const typeA = VECTOR_TYPES[i]!;
    for (const typeB of VECTOR_TYPES.slice(i + 1)) {
      const correlation = computeAverageCorrelation(samples, typeA, typeB);
      correlations.set(vectorPairKey(typeA, typeB), correlation);
      if (correlation >= correlationThreshold && isRedundancyCandidate(typeA, typeB)) {
        redundantPairs.push([typeA, typeB]);
      }
    }
  }

  let recommendation: VectorRedundancyAnalysis['recommendation'] = 'keep_all';
  if (redundantPairs.length > 2) {
    recommendation = 'consolidate';
  } else if (redundantPairs.length > 0) {
    recommendation = 'drop_redundant';
  }

  return { correlations, redundantPairs, recommendation };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

export interface SerializedMultiVector {
  filePath: string;
  purpose?: number[];
  purposeInput?: string;
  semantic?: number[];
  semanticInput?: string;
  structural?: number[];
  structuralInput?: string;
  dependency?: number[];
  dependencyInput?: string;
  usage?: number[];
  usageInput?: string;
  llmPurpose?: string;
  lastUpdated: number;
  modelId: EmbeddingModelId;
}

export function serializeMultiVector(vector: MultiVector): SerializedMultiVector {
  return {
    filePath: vector.filePath,
    purpose: vector.purpose ? Array.from(vector.purpose) : undefined,
    purposeInput: vector.purposeInput,
    semantic: vector.semantic ? Array.from(vector.semantic) : undefined,
    semanticInput: vector.semanticInput,
    structural: vector.structural ? Array.from(vector.structural) : undefined,
    structuralInput: vector.structuralInput,
    dependency: vector.dependency ? Array.from(vector.dependency) : undefined,
    dependencyInput: vector.dependencyInput,
    usage: vector.usage ? Array.from(vector.usage) : undefined,
    usageInput: vector.usageInput,
    llmPurpose: vector.llmPurpose,
    lastUpdated: vector.lastUpdated,
    modelId: vector.modelId,
  };
}

export function deserializeMultiVector(data: SerializedMultiVector): MultiVector {
  return {
    filePath: data.filePath,
    purpose: data.purpose ? new Float32Array(data.purpose) : undefined,
    purposeInput: data.purposeInput,
    semantic: data.semantic ? new Float32Array(data.semantic) : undefined,
    semanticInput: data.semanticInput,
    structural: data.structural ? new Float32Array(data.structural) : undefined,
    structuralInput: data.structuralInput,
    dependency: data.dependency ? new Float32Array(data.dependency) : undefined,
    dependencyInput: data.dependencyInput,
    usage: data.usage ? new Float32Array(data.usage) : undefined,
    usageInput: data.usageInput,
    llmPurpose: data.llmPurpose,
    lastUpdated: data.lastUpdated,
    modelId: data.modelId,
  };
}

// All exports are inline above
