/**
 * @fileoverview Hybrid Retrieval Fusion (WU-RET-007)
 *
 * Combines BM25 (lexical), dense (semantic), and graph-based retrieval using
 * Reciprocal Rank Fusion (RRF) to merge results. This approach leverages the
 * strengths of each retrieval method:
 *
 * - BM25: Precise lexical matching, good for exact terms
 * - Dense: Semantic similarity, captures meaning beyond keywords
 * - Graph: Relationship-based retrieval, finds connected concepts
 *
 * RRF Formula: score(d) = Σ 1/(k + rank_i(d)) for each retriever i
 *
 * Target: MRR >= 0.75
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result from a single retrieval method
 */
export interface RetrievalResult {
  /** Unique document identifier */
  id: string;
  /** Document content */
  content: string;
  /** Relevance score from the retriever (0 to 1) */
  score: number;
  /** Which retrieval method produced this result */
  source: 'bm25' | 'dense' | 'graph';
  /** Additional metadata from the retriever */
  metadata: Record<string, unknown>;
}

/**
 * Configuration for hybrid retrieval fusion
 */
export interface FusionConfig {
  /** Weight for BM25 (lexical) results */
  bm25Weight: number;
  /** Weight for dense (semantic) results */
  denseWeight: number;
  /** Weight for graph-based results */
  graphWeight: number;
  /** RRF parameter k, typically 60 */
  rrfK: number;
  /** Maximum number of results to return */
  maxResults: number;
}

/**
 * Input for hybrid retrieval
 */
export interface HybridRetrievalInput {
  /** The search query */
  query: string;
  /** Corpus of documents to search */
  corpus: string[];
  /** Optional configuration overrides */
  config?: Partial<FusionConfig>;
}

/**
 * Output from hybrid retrieval
 */
export interface HybridRetrievalOutput {
  /** Fused and ranked results */
  results: FusedResult[];
  /** Metrics about the retrieval process */
  metrics: {
    /** Number of results from BM25 */
    bm25Count: number;
    /** Number of results from dense retrieval */
    denseCount: number;
    /** Number of results from graph retrieval */
    graphCount: number;
    /** Time spent on fusion in milliseconds */
    fusionTime: number;
  };
}

/**
 * A single fused result combining multiple retrieval methods
 */
export interface FusedResult {
  /** Unique document identifier */
  id: string;
  /** Document content */
  content: string;
  /** Combined score from RRF */
  fusedScore: number;
  /** Original scores from each retrieval method */
  componentScores: {
    bm25?: number;
    dense?: number;
    graph?: number;
  };
  /** Final rank after fusion (1-indexed) */
  rank: number;
}

/**
 * Default fusion configuration
 */
export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  bm25Weight: 0.4,
  denseWeight: 0.4,
  graphWeight: 0.2,
  rrfK: 60,
  maxResults: 10,
};

// ============================================================================
// BM25 IMPLEMENTATION
// ============================================================================

/**
 * BM25 parameters
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * Simple tokenizer for BM25
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Compute term frequencies for a document
 */
function computeTermFrequencies(tokens: string[]): Map<string, number> {
  const freqs = new Map<string, number>();
  for (const token of tokens) {
    freqs.set(token, (freqs.get(token) || 0) + 1);
  }
  return freqs;
}

/**
 * BM25 scoring implementation
 */
class BM25Index {
  private documents: string[];
  private docTokens: string[][];
  private docLengths: number[];
  private avgDocLength: number;
  private termDocFreqs: Map<string, number>;
  private N: number;

  constructor(documents: string[]) {
    this.documents = documents;
    this.N = documents.length;
    this.docTokens = documents.map(tokenize);
    this.docLengths = this.docTokens.map((t) => t.length);
    this.avgDocLength = this.docLengths.length > 0
      ? this.docLengths.reduce((a, b) => a + b, 0) / this.docLengths.length
      : 0;

    // Compute document frequencies for each term
    this.termDocFreqs = new Map();
    for (const tokens of this.docTokens) {
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        this.termDocFreqs.set(term, (this.termDocFreqs.get(term) || 0) + 1);
      }
    }
  }

  /**
   * Compute IDF for a term
   */
  private idf(term: string): number {
    const df = this.termDocFreqs.get(term) || 0;
    if (df === 0) return 0;
    return Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
  }

  /**
   * Score a document against a query
   */
  score(queryTokens: string[], docIndex: number): number {
    if (docIndex >= this.docTokens.length) return 0;

    const docTokensList = this.docTokens[docIndex];
    const docLength = this.docLengths[docIndex];
    const termFreqs = computeTermFrequencies(docTokensList);

    let score = 0;
    for (const term of queryTokens) {
      const tf = termFreqs.get(term) || 0;
      if (tf === 0) continue;

      const idfScore = this.idf(term);
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / this.avgDocLength));
      score += idfScore * (numerator / denominator);
    }

    return score;
  }

  /**
   * Search and return ranked results
   */
  search(query: string, topK: number = 100): Array<{ docIndex: number; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores: Array<{ docIndex: number; score: number }> = [];

    for (let i = 0; i < this.documents.length; i++) {
      const s = this.score(queryTokens, i);
      if (s > 0) {
        scores.push({ docIndex: i, score: s });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK);
  }

  getDocument(index: number): string {
    return this.documents[index] || '';
  }
}

// ============================================================================
// DENSE RETRIEVAL IMPLEMENTATION (Simplified)
// ============================================================================

/**
 * Simple dense retrieval using character n-gram similarity
 * In production, this would use actual embeddings (e.g., sentence-transformers)
 */
class SimpleDenseRetriever {
  private documents: string[];
  private docVectors: Map<string, number>[];

  constructor(documents: string[]) {
    this.documents = documents;
    this.docVectors = documents.map((doc) => this.computeNgramVector(doc));
  }

  /**
   * Compute character n-gram vector (simplified embedding)
   */
  private computeNgramVector(text: string, n: number = 3): Map<string, number> {
    const vector = new Map<string, number>();
    const normalized = text.toLowerCase();

    for (let i = 0; i <= normalized.length - n; i++) {
      const ngram = normalized.slice(i, i + n);
      vector.set(ngram, (vector.get(ngram) || 0) + 1);
    }

    return vector;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(v1: Map<string, number>, v2: Map<string, number>): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const [key, val] of v1) {
      norm1 += val * val;
      if (v2.has(key)) {
        dotProduct += val * (v2.get(key) || 0);
      }
    }

    for (const val of v2.values()) {
      norm2 += val * val;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Search for similar documents
   */
  search(query: string, topK: number = 100): Array<{ docIndex: number; score: number }> {
    if (!query.trim()) return [];

    const queryVector = this.computeNgramVector(query);
    const scores: Array<{ docIndex: number; score: number }> = [];

    for (let i = 0; i < this.documents.length; i++) {
      const similarity = this.cosineSimilarity(queryVector, this.docVectors[i]);
      if (similarity > 0) {
        scores.push({ docIndex: i, score: similarity });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  getDocument(index: number): string {
    return this.documents[index] || '';
  }
}

// ============================================================================
// GRAPH RETRIEVAL IMPLEMENTATION (Simplified)
// ============================================================================

/**
 * Simple graph-based retrieval using term co-occurrence
 * In production, this would use an actual knowledge graph
 */
class SimpleGraphRetriever {
  private termGraph: Map<string, Set<string>>;
  private termDocuments: Map<string, Set<number>>;
  private documents: string[];

  constructor(documents: string[]) {
    this.documents = documents;
    this.termGraph = new Map();
    this.termDocuments = new Map();
    this.buildGraph(documents);
  }

  /**
   * Build term co-occurrence graph
   */
  private buildGraph(documents: string[]): void {
    for (let docIdx = 0; docIdx < documents.length; docIdx++) {
      const tokens = tokenize(documents[docIdx]);
      const uniqueTokens = [...new Set(tokens)];

      // Track which documents contain each term
      for (const token of uniqueTokens) {
        if (!this.termDocuments.has(token)) {
          this.termDocuments.set(token, new Set());
        }
        this.termDocuments.get(token)!.add(docIdx);
      }

      // Build co-occurrence edges (terms in same document are related)
      for (let i = 0; i < uniqueTokens.length; i++) {
        for (let j = i + 1; j < uniqueTokens.length; j++) {
          const t1 = uniqueTokens[i];
          const t2 = uniqueTokens[j];

          if (!this.termGraph.has(t1)) {
            this.termGraph.set(t1, new Set());
          }
          if (!this.termGraph.has(t2)) {
            this.termGraph.set(t2, new Set());
          }

          this.termGraph.get(t1)!.add(t2);
          this.termGraph.get(t2)!.add(t1);
        }
      }
    }
  }

  /**
   * Find related terms through graph traversal
   */
  private expandQuery(queryTerms: string[], hops: number = 1): Set<string> {
    const expanded = new Set<string>(queryTerms);

    for (let h = 0; h < hops; h++) {
      const currentTerms = [...expanded];
      for (const term of currentTerms) {
        const related = this.termGraph.get(term);
        if (related) {
          for (const r of related) {
            expanded.add(r);
          }
        }
      }
    }

    return expanded;
  }

  /**
   * Search using graph expansion
   */
  search(query: string, topK: number = 100): Array<{ docIndex: number; score: number; hops: number }> {
    if (!query.trim()) return [];

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    // Direct term matches (hops = 0)
    const directDocs = new Map<number, number>();
    for (const term of queryTerms) {
      const docs = this.termDocuments.get(term);
      if (docs) {
        for (const docIdx of docs) {
          directDocs.set(docIdx, (directDocs.get(docIdx) || 0) + 1);
        }
      }
    }

    // Expanded matches (hops = 1)
    const expandedTerms = this.expandQuery(queryTerms, 1);
    const expandedDocs = new Map<number, number>();
    for (const term of expandedTerms) {
      if (!queryTerms.includes(term)) {
        const docs = this.termDocuments.get(term);
        if (docs) {
          for (const docIdx of docs) {
            if (!directDocs.has(docIdx)) {
              expandedDocs.set(docIdx, (expandedDocs.get(docIdx) || 0) + 1);
            }
          }
        }
      }
    }

    // Combine results with scoring
    const results: Array<{ docIndex: number; score: number; hops: number }> = [];

    // Direct matches get higher scores
    for (const [docIdx, count] of directDocs) {
      const score = count / queryTerms.length;
      results.push({ docIndex: docIdx, score, hops: 0 });
    }

    // Expanded matches get lower scores
    for (const [docIdx, count] of expandedDocs) {
      const score = (count / expandedTerms.size) * 0.5; // Discount for expansion
      results.push({ docIndex: docIdx, score, hops: 1 });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  getDocument(index: number): string {
    return this.documents[index] || '';
  }
}

// ============================================================================
// HYBRID RETRIEVER CLASS
// ============================================================================

/**
 * Hybrid retriever combining BM25, dense, and graph-based retrieval
 */
export class HybridRetriever {
  private defaultConfig: FusionConfig;

  constructor(defaultConfig?: Partial<FusionConfig>) {
    this.defaultConfig = { ...DEFAULT_FUSION_CONFIG, ...defaultConfig };
  }

  /**
   * Main retrieval method combining all retrieval approaches
   */
  async retrieve(input: HybridRetrievalInput): Promise<HybridRetrievalOutput> {
    const config = { ...this.defaultConfig, ...input.config };
    const { query, corpus } = input;

    // Handle edge cases
    if (!query.trim() || corpus.length === 0) {
      return {
        results: [],
        metrics: {
          bm25Count: 0,
          denseCount: 0,
          graphCount: 0,
          fusionTime: 0,
        },
      };
    }

    if (config.maxResults <= 0) {
      return {
        results: [],
        metrics: {
          bm25Count: 0,
          denseCount: 0,
          graphCount: 0,
          fusionTime: 0,
        },
      };
    }

    // Handle invalid RRF k
    const rrfK = Math.abs(config.rrfK) || DEFAULT_FUSION_CONFIG.rrfK;

    const fusionStart = Date.now();

    // Run all retrievers
    const bm25Results = config.bm25Weight > 0
      ? this.bm25Search(query, corpus)
      : [];

    const denseResults = config.denseWeight > 0
      ? await this.denseSearch(query, corpus)
      : [];

    const graphResults = config.graphWeight > 0
      ? this.graphSearch(query, corpus)
      : [];

    // Apply weights by repeating results based on weight ratios
    const weightedResults: RetrievalResult[][] = [];

    if (config.bm25Weight > 0 && bm25Results.length > 0) {
      weightedResults.push(bm25Results);
    }
    if (config.denseWeight > 0 && denseResults.length > 0) {
      weightedResults.push(denseResults);
    }
    if (config.graphWeight > 0 && graphResults.length > 0) {
      weightedResults.push(graphResults);
    }

    // Fuse results
    const fusedResults = this.reciprocalRankFusion(weightedResults, rrfK);

    const fusionTime = Date.now() - fusionStart;

    return {
      results: fusedResults.slice(0, config.maxResults),
      metrics: {
        bm25Count: bm25Results.length,
        denseCount: denseResults.length,
        graphCount: graphResults.length,
        fusionTime,
      },
    };
  }

  /**
   * BM25 (lexical) search
   */
  bm25Search(query: string, corpus: string[]): RetrievalResult[] {
    if (!query.trim() || corpus.length === 0) {
      return [];
    }

    const index = new BM25Index(corpus);
    const rawResults = index.search(query);

    // Normalize scores to 0-1 range
    const maxScore = rawResults.length > 0 ? rawResults[0].score : 1;

    return rawResults.map((r) => ({
      id: `doc-${r.docIndex}`,
      content: index.getDocument(r.docIndex),
      score: maxScore > 0 ? r.score / maxScore : 0,
      source: 'bm25' as const,
      metadata: {
        rawScore: r.score,
        docIndex: r.docIndex,
      },
    }));
  }

  /**
   * Dense (semantic) search
   */
  async denseSearch(query: string, corpus: string[]): Promise<RetrievalResult[]> {
    if (!query.trim() || corpus.length === 0) {
      return [];
    }

    const retriever = new SimpleDenseRetriever(corpus);
    const rawResults = retriever.search(query);

    return rawResults.map((r) => ({
      id: `doc-${r.docIndex}`,
      content: retriever.getDocument(r.docIndex),
      score: r.score, // Already normalized cosine similarity
      source: 'dense' as const,
      metadata: {
        similarity: r.score,
        docIndex: r.docIndex,
      },
    }));
  }

  /**
   * Graph-based search
   */
  graphSearch(query: string, corpus?: string[]): RetrievalResult[] {
    if (!query.trim()) {
      return [];
    }

    // If no corpus provided, return empty (would need external graph)
    if (!corpus || corpus.length === 0) {
      return [];
    }

    const retriever = new SimpleGraphRetriever(corpus);
    const rawResults = retriever.search(query);

    return rawResults.map((r) => ({
      id: `doc-${r.docIndex}`,
      content: retriever.getDocument(r.docIndex),
      score: r.score,
      source: 'graph' as const,
      metadata: {
        hops: r.hops,
        docIndex: r.docIndex,
      },
    }));
  }

  /**
   * Reciprocal Rank Fusion
   *
   * Formula: score(d) = Σ 1/(k + rank_i(d)) for each retriever i
   */
  reciprocalRankFusion(resultSets: RetrievalResult[][], k: number): FusedResult[] {
    if (resultSets.length === 0) {
      return [];
    }

    // Map to accumulate scores: id -> { content, fusedScore, componentScores }
    const fusedMap = new Map<string, {
      content: string;
      fusedScore: number;
      componentScores: {
        bm25?: number;
        dense?: number;
        graph?: number;
      };
    }>();

    // Process each result set
    for (const results of resultSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const rrfScore = 1 / (k + rank + 1); // rank is 0-indexed, so rank+1 for 1-indexed

        if (!fusedMap.has(result.id)) {
          fusedMap.set(result.id, {
            content: result.content,
            fusedScore: 0,
            componentScores: {},
          });
        }

        const entry = fusedMap.get(result.id)!;
        entry.fusedScore += rrfScore;

        // Store the original score from this retriever
        if (result.source === 'bm25') {
          entry.componentScores.bm25 = result.score;
        } else if (result.source === 'dense') {
          entry.componentScores.dense = result.score;
        } else if (result.source === 'graph') {
          entry.componentScores.graph = result.score;
        }
      }
    }

    // Convert to array and sort by fused score
    const fusedArray: FusedResult[] = [];
    for (const [id, data] of fusedMap) {
      fusedArray.push({
        id,
        content: data.content,
        fusedScore: data.fusedScore,
        componentScores: data.componentScores,
        rank: 0, // Will be set after sorting
      });
    }

    fusedArray.sort((a, b) => b.fusedScore - a.fusedScore);

    // Assign ranks (1-indexed)
    for (let i = 0; i < fusedArray.length; i++) {
      fusedArray[i].rank = i + 1;
    }

    return fusedArray;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new HybridRetriever instance
 */
export function createHybridRetriever(
  defaultConfig?: Partial<FusionConfig>
): HybridRetriever {
  return new HybridRetriever(defaultConfig);
}
