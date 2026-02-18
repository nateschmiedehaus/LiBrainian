/**
 * @fileoverview Unified Embedding Pipeline
 *
 * Combines all embedding features into a single, powerful pipeline:
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    UNIFIED EMBEDDING PIPELINE                          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │                                                                         │
 * │  INDEXING PHASE                                                         │
 * │  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐           │
 * │  │ Parse File  │ ──▶ │ Extract      │ ──▶ │ Generate       │           │
 * │  │ into Chunks │     │ Multi-Vector │     │ Embeddings     │           │
 * │  └─────────────┘     └──────────────┘     └────────────────┘           │
 * │         │                   │                     │                     │
 * │         ▼                   ▼                     ▼                     │
 * │  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐           │
 * │  │ LLM Purpose │     │ Co-Change    │     │ Store in       │           │
 * │  │ Extraction  │     │ Analysis     │     │ SQLite         │           │
 * │  └─────────────┘     └──────────────┘     └────────────────┘           │
 * │                                                                         │
 * │  QUERY PHASE                                                            │
 * │  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐           │
 * │  │ Expand      │ ──▶ │ Bi-Encoder   │ ──▶ │ Cross-Encoder  │           │
 * │  │ Query       │     │ Retrieval    │     │ Re-ranking     │           │
 * │  └─────────────┘     └──────────────┘     └────────────────┘           │
 * │         │                   │                     │                     │
 * │         ▼                   ▼                     ▼                     │
 * │  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐           │
 * │  │ Multi-Vector│     │ Co-Change    │     │ Return         │           │
 * │  │ Scoring     │     │ Boost        │     │ Results        │           │
 * │  └─────────────┘     └──────────────┘     └────────────────┘           │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * MODEL SELECTION:
 * - Local models (all-MiniLM, jina-v2): High-volume embedding, zero API cost
 * - Cross-encoder: Re-ranking top results for precision
 * - Haiku 4.5: Purpose extraction at scale (cheap)
 * - Sonnet 4.5: Complex relationship analysis
 * - Codex: Code-specific deep understanding
 */

import {
  generateRealEmbedding,
  cosineSimilarity,
  type EmbeddingModelId,
  EMBEDDING_MODELS,
} from './real_embeddings.js';

import {
  parseFileIntoChunks,
  embedFileChunks,
  computeChunkSimilarity,
  type FileChunks,
  type CodeChunk,
} from './function_chunking.js';

import {
  extractCommitHistory,
  buildCoChangeMatrix,
  computeCoChangeScore,
  boostWithCoChange,
  type CoChangeMatrix,
} from './co_change_signals.js';

import {
  rerank,
  hybridRerank,
  type RerankerResult,
} from './cross_encoder_reranker.js';

import {
  generateMultiVector,
  computeMultiVectorSimilarity,
  queryMultiVectors,
  QUERY_TYPE_WEIGHTS,
  type MultiVector,
  type VectorWeights,
} from './multi_vector_representations.js';

import {
  extractPurpose,
  extractPurposeBatch,
  type ExtractedPurpose,
  type PurposeExtractionModel,
} from './llm_purpose_extractor.js';

import {
  expandQuery,
  extractMetadata,
  computeKeywordScore,
  type FileMetadata,
} from './enhanced_retrieval.js';

import {
  computeGraphAugmentedSimilarity,
  DependencyGraph,
  isLikelyAdversarial,
} from './graph_augmented_similarity.js';

// ============================================================================
// TYPES
// ============================================================================

export interface IndexedFile {
  filePath: string;
  /** File content hash for change detection */
  contentHash: string;
  /** Basic metadata */
  metadata: FileMetadata;
  /** Function-level chunks with embeddings */
  chunks?: FileChunks;
  /** Multi-vector representation */
  multiVector?: MultiVector;
  /** LLM-extracted purpose */
  purpose?: ExtractedPurpose;
  /** Last indexed timestamp */
  indexedAt: number;
}

export interface PipelineConfig {
  /** Base embedding model for retrieval */
  embeddingModel: EmbeddingModelId;
  /** Model for long files (8K context) */
  longContextModel: EmbeddingModelId;
  /** Threshold for using long context model */
  longContextThreshold: number;
  /** Enable function-level chunking */
  enableChunking: boolean;
  /** Enable LLM purpose extraction */
  enablePurposeExtraction: boolean;
  /** Model for purpose extraction */
  purposeExtractionModel: PurposeExtractionModel;
  /** Enable co-change analysis */
  enableCoChange: boolean;
  /** Enable cross-encoder re-ranking */
  enableCrossEncoder: boolean;
  /** Number of results to re-rank */
  rerankTopK: number;
  /** Final number of results */
  returnTopK: number;
}

export interface QueryConfig {
  /** Query type for vector weighting */
  queryType?: keyof typeof QUERY_TYPE_WEIGHTS;
  /** Custom vector weights */
  weights?: Partial<VectorWeights>;
  /** Apply co-change boost */
  useCoChangeBoost?: boolean;
  /** Use cross-encoder for final ranking */
  useCrossEncoder?: boolean;
  /** Minimum score threshold */
  minScore?: number;
}

export interface QueryResult {
  filePath: string;
  /** Semantic similarity score */
  semanticScore: number;
  /** Keyword match score */
  keywordScore: number;
  /** Multi-vector weighted score */
  multiVectorScore: number;
  /** Co-change boost */
  coChangeBoost: number;
  /** Cross-encoder score (if used) */
  crossEncoderScore?: number;
  /** Final combined score */
  finalScore: number;
  /** Matched aspects */
  matchedAspects: string[];
  /** Purpose (if extracted) */
  purpose?: string;
  /** Best matching chunks */
  bestChunks?: Array<{
    name: string;
    type: string;
    score: number;
  }>;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: PipelineConfig = {
  // Use same model for both to avoid dimension mismatch issues
  // all-MiniLM is faster and sufficient for most code files
  embeddingModel: 'all-MiniLM-L6-v2',
  longContextModel: 'all-MiniLM-L6-v2', // Keep same model for consistency
  longContextThreshold: 2000, // Threshold for chunking strategy
  enableChunking: true,
  enablePurposeExtraction: false, // Requires LLM provider
  purposeExtractionModel: 'haiku-4.5',
  enableCoChange: true,
  enableCrossEncoder: true,
  rerankTopK: 50,
  returnTopK: 10,
};

// ============================================================================
// UNIFIED PIPELINE CLASS
// ============================================================================

export class UnifiedEmbeddingPipeline {
  private config: PipelineConfig;
  private indexedFiles: Map<string, IndexedFile> = new Map();
  private dependencyGraph: DependencyGraph = new DependencyGraph();
  private coChangeMatrix: CoChangeMatrix | null = null;
  private initialized: boolean = false;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ========================================================================
  // INITIALIZATION
  // ========================================================================

  /**
   * Initialize the pipeline with repository context.
   */
  async initialize(repoPath: string): Promise<void> {
    console.error('[pipeline] Initializing unified embedding pipeline...');

    // Build co-change matrix from git history
    if (this.config.enableCoChange) {
      console.error('[pipeline] Extracting commit history...');
      const commits = extractCommitHistory(repoPath, {
        maxCommits: 500,
        daysBack: 180,
      });
      this.coChangeMatrix = buildCoChangeMatrix(commits);
      console.error(`[pipeline] Built co-change matrix from ${commits.length} commits`);
    }

    this.initialized = true;
    console.error('[pipeline] Initialization complete');
  }

  // ========================================================================
  // INDEXING
  // ========================================================================

  /**
   * Index a single file.
   */
  async indexFile(
    filePath: string,
    content: string,
    options: {
      forceReindex?: boolean;
    } = {}
  ): Promise<IndexedFile> {
    const contentHash = this.hashContent(content);

    // Check if already indexed with same content
    const existing = this.indexedFiles.get(filePath);
    if (existing && existing.contentHash === contentHash && !options.forceReindex) {
      return existing;
    }

    console.error(`[pipeline] Indexing ${filePath}...`);

    // Extract metadata
    const metadata = extractMetadata(filePath, content);

    // Choose model based on content length
    const estimatedTokens = content.length / 4; // Rough estimate
    const model = estimatedTokens > this.config.longContextThreshold
      ? this.config.longContextModel
      : this.config.embeddingModel;

    const indexed: IndexedFile = {
      filePath,
      contentHash,
      metadata,
      indexedAt: Date.now(),
    };

    // Generate chunks if enabled
    if (this.config.enableChunking) {
      indexed.chunks = await embedFileChunks(filePath, content, model);
    }

    // Generate multi-vector representation
    let llmPurpose: string | undefined;
    if (this.config.enablePurposeExtraction) {
      try {
        const result = await extractPurpose(filePath, content, {
          model: this.config.purposeExtractionModel,
        });
        indexed.purpose = result.purpose;
        if (result.purpose.source === 'llm') {
          llmPurpose = result.purpose.purpose;
        }
      } catch (error) {
        console.warn(`[pipeline] Purpose extraction failed for ${filePath}:`, error);
      }
    }

    indexed.multiVector = await generateMultiVector(filePath, content, {
      modelId: model,
      llmPurpose,
    });

    // Add to dependency graph
    this.dependencyGraph.addNode({
      filePath,
      moduleName: metadata.moduleName,
      imports: metadata.imports,
      importedBy: [],
      calls: [],
      calledBy: [],
    });

    // Store
    this.indexedFiles.set(filePath, indexed);

    return indexed;
  }

  /**
   * Index multiple files.
   */
  async indexFiles(
    files: Array<{ path: string; content: string }>,
    options: {
      onProgress?: (completed: number, total: number) => void;
    } = {}
  ): Promise<Map<string, IndexedFile>> {
    const results = new Map<string, IndexedFile>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const indexed = await this.indexFile(file.path, file.content);
        results.set(file.path, indexed);
      } catch (error) {
        console.warn(`[pipeline] Failed to index ${file.path}:`, error);
      }
      options.onProgress?.(i + 1, files.length);
    }

    return results;
  }

  // ========================================================================
  // QUERYING
  // ========================================================================

  /**
   * Query the indexed files.
   */
  async query(
    queryText: string,
    config: QueryConfig = {}
  ): Promise<QueryResult[]> {
    const {
      queryType = 'default',
      weights,
      useCoChangeBoost = this.config.enableCoChange,
      useCrossEncoder = this.config.enableCrossEncoder,
      minScore = 0,
    } = config;

    if (queryText.trim().length === 0) {
      return Array.from(this.indexedFiles.entries())
        .map(([filePath, indexed]) => ({
          filePath,
          semanticScore: 0,
          keywordScore: 0,
          multiVectorScore: 0,
          coChangeBoost: 0,
          finalScore: 0,
          matchedAspects: [],
          purpose: indexed.purpose?.purpose,
          bestChunks: [],
        }))
        .sort((a, b) => a.filePath.localeCompare(b.filePath))
        .slice(0, this.config.returnTopK);
    }

    // Step 1: Expand query
    const expandedQuery = expandQuery(queryText);
    console.error(`[pipeline] Query: "${queryText}" → "${expandedQuery}"`);

    // Step 2: Generate query embedding
    const queryResult = await generateRealEmbedding(expandedQuery, this.config.embeddingModel);
    const queryEmbedding = queryResult.embedding;

    // Step 3: Compute initial scores for all files
    const results: QueryResult[] = [];

    for (const [filePath, indexed] of this.indexedFiles) {
      // Semantic score from multi-vector
      let multiVectorScore = 0;
      let matchedAspects: string[] = [];

      if (indexed.multiVector) {
        const mvResults = await queryMultiVectors(
          { queryText: expandedQuery, queryEmbedding },
          [indexed.multiVector],
          { queryType, modelId: this.config.embeddingModel }
        );

        if (mvResults.length > 0) {
          multiVectorScore = mvResults[0].weightedScore;
          matchedAspects = mvResults[0].matchedAspects;
        }
      }

      // Semantic score from raw embedding
      let semanticScore = 0;
      if (indexed.multiVector?.semantic) {
        semanticScore = cosineSimilarity(queryEmbedding, indexed.multiVector.semantic);
      }

      // Keyword score
      const keywordScore = computeKeywordScore(
        queryText,
        indexed.metadata,
        '' // We don't have content here, but metadata suffices
      );

      // Co-change boost
      let coChangeBoost = 0;
      if (useCoChangeBoost && this.coChangeMatrix && results.length > 0) {
        // Boost based on co-change with top results
        const topFiles = results.slice(0, 5).map((r) => r.filePath);
        for (const topFile of topFiles) {
          const score = computeCoChangeScore(filePath, topFile, this.coChangeMatrix);
          const boost = boostWithCoChange(0, score, { maxBoost: 0.1 });
          coChangeBoost = Math.max(coChangeBoost, boost.coChangeContribution);
        }
      }

      // Adversarial detection
      let adversarialPenalty = 1.0;
      for (const otherResult of results.slice(0, 3)) {
        const detection = isLikelyAdversarial(
          filePath,
          otherResult.filePath,
          semanticScore,
          this.dependencyGraph.computeGraphProximity(filePath, otherResult.filePath)
        );
        if (detection.isAdversarial) {
          adversarialPenalty = 0.7;
          break;
        }
      }

      // Best matching chunks
      let bestChunks: QueryResult['bestChunks'];
      if (indexed.chunks?.embeddings?.length) {
        // Find chunks most similar to query
        const chunkScores = indexed.chunks.embeddings.map((emb) => ({
          name: emb.chunk.name,
          type: emb.chunk.type,
          score: cosineSimilarity(queryEmbedding, emb.embedding),
        }));
        chunkScores.sort((a, b) => b.score - a.score);
        bestChunks = chunkScores.slice(0, 3);
      }

      // Combine scores
      const finalScore = (
        0.4 * multiVectorScore +
        0.3 * semanticScore +
        0.2 * keywordScore +
        0.1 * coChangeBoost
      ) * adversarialPenalty;

      results.push({
        filePath,
        semanticScore,
        keywordScore,
        multiVectorScore,
        coChangeBoost,
        finalScore,
        matchedAspects,
        purpose: indexed.purpose?.purpose,
        bestChunks,
      });
    }

    // Step 4: Sort by final score
    results.sort((a, b) => b.finalScore - a.finalScore);

    // Step 5: Cross-encoder re-ranking (if enabled)
    if (useCrossEncoder && results.length > 0) {
      const topResults = results.slice(0, this.config.rerankTopK);

      // Prepare documents for re-ranking
      const documents = topResults.map((r) => {
        const indexed = this.indexedFiles.get(r.filePath);
        return indexed?.multiVector?.semanticInput || r.filePath;
      });

      const reranked = await hybridRerank(expandedQuery,
        topResults.map((r, i) => ({
          document: documents[i],
          biEncoderScore: r.finalScore,
          metadata: { originalIndex: i },
        })),
        {
          topK: this.config.rerankTopK,
          returnTopN: this.config.returnTopK,
        }
      );

      // Update results with cross-encoder scores
      for (const ranked of reranked) {
        const originalIndex = (ranked.metadata as { originalIndex: number }).originalIndex;
        topResults[originalIndex].crossEncoderScore = ranked.score;
        topResults[originalIndex].finalScore = ranked.hybridScore;
      }

      // Re-sort
      results.sort((a, b) => b.finalScore - a.finalScore);
    }

    // Filter and return
    return results
      .filter((r) => r.finalScore >= minScore)
      .slice(0, this.config.returnTopK);
  }

  // ========================================================================
  // SIMILARITY
  // ========================================================================

  /**
   * Find files similar to a given file.
   */
  async findSimilar(
    filePath: string,
    topK: number = 10
  ): Promise<Array<{
    filePath: string;
    similarity: number;
    aspects: string[];
  }>> {
    const indexed = this.indexedFiles.get(filePath);
    if (!indexed?.multiVector) {
      return [];
    }

    const results: Array<{
      filePath: string;
      similarity: number;
      aspects: string[];
    }> = [];

    for (const [otherPath, other] of this.indexedFiles) {
      if (otherPath === filePath) continue;
      if (!other.multiVector) continue;

      const match = computeMultiVectorSimilarity(
        indexed.multiVector,
        other.multiVector,
        QUERY_TYPE_WEIGHTS['default']
      );

      // Apply adversarial penalty
      const detection = isLikelyAdversarial(
        filePath,
        otherPath,
        match.scores.semantic,
        this.dependencyGraph.computeGraphProximity(filePath, otherPath)
      );

      const similarity = detection.isAdversarial
        ? match.weightedScore * 0.5
        : match.weightedScore;

      results.push({
        filePath: otherPath,
        similarity,
        aspects: match.matchedAspects,
      });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Get pipeline statistics.
   */
  getStats(): {
    indexedFiles: number;
    totalChunks: number;
    coChangeEnabled: boolean;
    coChangePairs: number;
    graphNodes: number;
  } {
    let totalChunks = 0;
    for (const indexed of this.indexedFiles.values()) {
      totalChunks += indexed.chunks?.chunks.length || 0;
    }

    return {
      indexedFiles: this.indexedFiles.size,
      totalChunks,
      coChangeEnabled: this.config.enableCoChange,
      coChangePairs: this.coChangeMatrix?.pairCounts.size || 0,
      graphNodes: this.dependencyGraph.size,
    };
  }

  /**
   * Export configuration.
   */
  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  updateConfig(updates: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// DEFAULT_CONFIG needs explicit export (not inline)
export { DEFAULT_CONFIG };
