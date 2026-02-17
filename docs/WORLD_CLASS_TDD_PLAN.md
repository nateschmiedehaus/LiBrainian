# World-Class LiBrainian: TDD Implementation Plan

## Executive Summary

This plan implements the **5 highest-impact, best-understood** enhancements identified from 2025-2026 research papers. Each phase uses **strict TDD**: tests written first, implementation follows, no phase complete until tests pass.

**Research Foundation:**
- [Retrieval-Augmented Code Generation Survey](https://arxiv.org/html/2510.04905v1) - Hybrid retrieval
- [A-MEM: Agentic Memory](https://arxiv.org/abs/2502.12110) - Memory architecture
- [Agentic RAG Survey](https://arxiv.org/abs/2501.09136) - Feedback loops
- [MIRIX Multi-Agent Memory](https://arxiv.org/html/2507.07957v1) - Episodic memory

---

## Phase 1: Hybrid Retrieval (BM25 + Semantic + Graph)

**Impact**: Research consistently shows hybrid retrieval improves recall by 20-30% over pure semantic search.

**Why First**: This is the foundation - better retrieval means everything downstream improves.

### 1.1 Test Specification

```typescript
// File: src/LiBrainian/__tests__/hybrid_retrieval.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { createHybridRetriever, HybridRetriever } from '../api/hybrid_retrieval.js';
import { createTestStorage, seedTestData } from './fixtures/test_storage.js';

describe('Hybrid Retrieval', () => {
  let retriever: HybridRetriever;
  let storage: LibrarianStorage;

  beforeAll(async () => {
    storage = await createTestStorage();
    await seedTestData(storage, 'hybrid_retrieval_fixtures');
    retriever = createHybridRetriever(storage, {
      semantic: { weight: 0.5, provider: 'xenova' },
      lexical: { weight: 0.3, method: 'bm25' },
      graph: { weight: 0.2, maxHops: 2 },
    });
  });

  describe('BM25 Lexical Retrieval', () => {
    it('finds exact function name matches with high score', async () => {
      // TOUGH: Must find "getUserById" even with semantic noise
      const results = await retriever.retrieve('getUserById', { mode: 'lexical' });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity.name).toBe('getUserById');
      expect(results[0].scores.lexical).toBeGreaterThan(0.8);
    });

    it('handles camelCase tokenization correctly', async () => {
      // TOUGH: "get user by id" should match "getUserById"
      const results = await retriever.retrieve('get user by id', { mode: 'lexical' });

      expect(results.some(r => r.entity.name === 'getUserById')).toBe(true);
    });

    it('boosts exact matches over partial matches', async () => {
      // TOUGH: "authenticate" should rank higher than "authenticateUser" for query "authenticate"
      const results = await retriever.retrieve('authenticate', { mode: 'lexical' });

      const exactMatch = results.find(r => r.entity.name === 'authenticate');
      const partialMatch = results.find(r => r.entity.name === 'authenticateUser');

      if (exactMatch && partialMatch) {
        expect(exactMatch.scores.lexical).toBeGreaterThan(partialMatch.scores.lexical);
      }
    });

    it('returns empty for completely unrelated queries', async () => {
      const results = await retriever.retrieve('xyzzy123nonexistent', { mode: 'lexical' });
      expect(results.length).toBe(0);
    });
  });

  describe('Semantic Retrieval', () => {
    it('finds conceptually related functions', async () => {
      // TOUGH: "verify user credentials" should find "authenticateUser" via semantics
      const results = await retriever.retrieve('verify user credentials', { mode: 'semantic' });

      expect(results.some(r =>
        r.entity.name.toLowerCase().includes('auth') ||
        r.entity.name.toLowerCase().includes('login') ||
        r.entity.name.toLowerCase().includes('credential')
      )).toBe(true);
    });

    it('handles synonyms correctly', async () => {
      // TOUGH: "remove" should find "delete" functions
      const results = await retriever.retrieve('remove user from database', { mode: 'semantic' });

      expect(results.some(r =>
        r.entity.name.toLowerCase().includes('delete') ||
        r.entity.name.toLowerCase().includes('remove')
      )).toBe(true);
    });
  });

  describe('Graph Retrieval', () => {
    it('finds callers of a function', async () => {
      // TOUGH: Given "validateInput", find functions that CALL it
      const results = await retriever.retrieve('validateInput', {
        mode: 'graph',
        direction: 'callers'
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.graphPath).toBeDefined();
        expect(result.graphPath!.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('finds callees of a function', async () => {
      // TOUGH: Given "processRequest", find functions it CALLS
      const results = await retriever.retrieve('processRequest', {
        mode: 'graph',
        direction: 'callees'
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('respects hop limit', async () => {
      const results1 = await retriever.retrieve('main', { mode: 'graph', maxHops: 1 });
      const results2 = await retriever.retrieve('main', { mode: 'graph', maxHops: 3 });

      // More hops should yield more (or equal) results
      expect(results2.length).toBeGreaterThanOrEqual(results1.length);
    });
  });

  describe('Hybrid Fusion', () => {
    it('combines all three signals with configured weights', async () => {
      const results = await retriever.retrieve('authenticate user', { mode: 'hybrid' });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.scores.lexical).toBeDefined();
        expect(result.scores.semantic).toBeDefined();
        expect(result.scores.graph).toBeDefined();
        expect(result.scores.combined).toBeDefined();

        // Combined should be weighted sum
        const expected =
          0.5 * result.scores.semantic +
          0.3 * result.scores.lexical +
          0.2 * result.scores.graph;
        expect(result.scores.combined).toBeCloseTo(expected, 2);
      }
    });

    it('ranks exact lexical match higher than semantic-only match', async () => {
      // TOUGH: Searching for "parseJSON" should rank the actual parseJSON function
      // higher than semantically similar "decodeData" function
      const results = await retriever.retrieve('parseJSON', { mode: 'hybrid' });

      const exactMatch = results.find(r => r.entity.name === 'parseJSON');
      const semanticMatch = results.find(r => r.entity.name === 'decodeData');

      if (exactMatch && semanticMatch) {
        expect(exactMatch.scores.combined).toBeGreaterThan(semanticMatch.scores.combined);
      }
    });

    it('boosts graph-connected results', async () => {
      // TOUGH: If A calls B, and query matches A, B should get graph boost
      const results = await retriever.retrieve('handleRequest', { mode: 'hybrid' });

      const graphConnected = results.filter(r => r.scores.graph > 0);
      expect(graphConnected.length).toBeGreaterThan(0);
    });

    it('outperforms pure semantic on exact match queries', async () => {
      // This is the KEY test - hybrid should beat semantic alone
      const hybridResults = await retriever.retrieve('validateEmail', { mode: 'hybrid' });
      const semanticResults = await retriever.retrieve('validateEmail', { mode: 'semantic' });

      // Find the target function in both result sets
      const hybridRank = hybridResults.findIndex(r => r.entity.name === 'validateEmail');
      const semanticRank = semanticResults.findIndex(r => r.entity.name === 'validateEmail');

      // Hybrid should rank it equal or higher (lower index = higher rank)
      if (hybridRank !== -1 && semanticRank !== -1) {
        expect(hybridRank).toBeLessThanOrEqual(semanticRank);
      }
    });
  });

  describe('Performance', () => {
    it('retrieves in under 100ms for 1000 entities', async () => {
      const start = performance.now();
      await retriever.retrieve('test query', { mode: 'hybrid', limit: 10 });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('caches BM25 index for repeated queries', async () => {
      // First query builds index
      const start1 = performance.now();
      await retriever.retrieve('first query', { mode: 'lexical' });
      const elapsed1 = performance.now() - start1;

      // Second query should use cache
      const start2 = performance.now();
      await retriever.retrieve('second query', { mode: 'lexical' });
      const elapsed2 = performance.now() - start2;

      // Cached should be faster (or at least not slower)
      expect(elapsed2).toBeLessThanOrEqual(elapsed1 * 1.5); // Allow some variance
    });
  });
});
```

### 1.2 Implementation Outline

```typescript
// File: src/LiBrainian/api/hybrid_retrieval.ts

export interface HybridRetrieverConfig {
  semantic: { weight: number; provider: EmbeddingProvider };
  lexical: { weight: number; method: 'bm25' | 'tfidf' };
  graph: { weight: number; maxHops: number };
}

export interface RetrievalResult {
  entity: FunctionKnowledge | ModuleKnowledge;
  scores: {
    lexical: number;
    semantic: number;
    graph: number;
    combined: number;
  };
  graphPath?: string[];
}

export function createHybridRetriever(
  storage: LibrarianStorage,
  config: HybridRetrieverConfig
): HybridRetriever;

export class HybridRetriever {
  // BM25 implementation with camelCase tokenization
  private buildBM25Index(): BM25Index;

  // Semantic search using existing embeddings
  private semanticSearch(query: string, limit: number): Promise<ScoredEntity[]>;

  // Graph traversal from matched entities
  private graphExpand(entities: string[], direction: 'callers' | 'callees', maxHops: number): Promise<GraphResult[]>;

  // Reciprocal Rank Fusion for combining results
  private fuseResults(lexical: ScoredEntity[], semantic: ScoredEntity[], graph: GraphResult[]): RetrievalResult[];
}
```

### 1.3 Success Criteria

- [ ] All 15+ tests pass
- [ ] Hybrid outperforms semantic-only on exact match benchmark
- [ ] Query latency < 100ms for 2000 entities
- [ ] BM25 index builds in < 1s for 2000 functions

---

## Phase 2: Feedback Loop + Confidence Learning

**Impact**: Enables the system to learn from outcomes, improving over time. Research shows this is the key differentiator for "agentic" systems.

**Why Second**: With better retrieval (Phase 1), feedback becomes meaningful.

### 2.1 Test Specification

```typescript
// File: src/LiBrainian/__tests__/feedback_learning.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { FeedbackProcessor, createFeedbackProcessor } from '../api/feedback_processor.js';
import { createTestStorage } from './fixtures/test_storage.js';

describe('Feedback Learning', () => {
  let processor: FeedbackProcessor;
  let storage: LibrarianStorage;

  beforeEach(async () => {
    storage = await createTestStorage();
    processor = createFeedbackProcessor(storage);
  });

  describe('Feedback Token Generation', () => {
    it('query response includes unique feedback token', async () => {
      const result = await queryLibrarian(storage, { intent: 'test query' });

      expect(result.feedbackToken).toBeDefined();
      expect(typeof result.feedbackToken).toBe('string');
      expect(result.feedbackToken.length).toBeGreaterThan(16);
    });

    it('feedback token maps to query and returned packs', async () => {
      const result = await queryLibrarian(storage, { intent: 'test query' });
      const mapping = await processor.getTokenMapping(result.feedbackToken);

      expect(mapping).toBeDefined();
      expect(mapping!.queryIntent).toBe('test query');
      expect(mapping!.returnedPackIds).toEqual(result.packs.map(p => p.packId));
    });

    it('token expires after 24 hours', async () => {
      const result = await queryLibrarian(storage, { intent: 'test' });

      // Simulate time passing
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000); // 25 hours

      const mapping = await processor.getTokenMapping(result.feedbackToken);
      expect(mapping).toBeNull();
    });
  });

  describe('Positive Feedback Processing', () => {
    it('increases confidence for relevant pack', async () => {
      const result = await queryLibrarian(storage, { intent: 'test' });
      const packId = result.packs[0].packId;
      const beforeConfidence = result.packs[0].confidence;

      await processor.submitFeedback({
        token: result.feedbackToken,
        ratings: [{ packId, relevant: true, usefulness: 1.0 }],
      });

      const afterPack = await storage.getContextPack(packId);
      expect(afterPack.confidence).toBeGreaterThan(beforeConfidence);
    });

    it('confidence increase is proportional to usefulness', async () => {
      const result = await queryLibrarian(storage, { intent: 'test' });
      const [pack1, pack2] = result.packs.slice(0, 2);

      await processor.submitFeedback({
        token: result.feedbackToken,
        ratings: [
          { packId: pack1.packId, relevant: true, usefulness: 1.0 },
          { packId: pack2.packId, relevant: true, usefulness: 0.5 },
        ],
      });

      const after1 = await storage.getContextPack(pack1.packId);
      const after2 = await storage.getContextPack(pack2.packId);

      const delta1 = after1.confidence - pack1.confidence;
      const delta2 = after2.confidence - pack2.confidence;

      // Higher usefulness should yield higher confidence increase
      expect(delta1).toBeGreaterThan(delta2);
    });

    it('records confidence event with evidence', async () => {
      const result = await queryLibrarian(storage, { intent: 'test' });
      const packId = result.packs[0].packId;

      await processor.submitFeedback({
        token: result.feedbackToken,
        ratings: [{ packId, relevant: true, usefulness: 0.8 }],
      });

      const events = await storage.getConfidenceEvents({ entityId: packId });
      expect(events.length).toBeGreaterThan(0);

      const latestEvent = events[events.length - 1];
      expect(latestEvent.eventType).toBe('positive_feedback');
      expect(latestEvent.delta).toBeGreaterThan(0);
      expect(latestEvent.evidence).toContain('usefulness:0.8');
    });
  });

  describe('Negative Feedback Processing', () => {
    it('decreases confidence for irrelevant pack', async () => {
      const result = await queryLibrarian(storage, { intent: 'test' });
      const packId = result.packs[0].packId;
      const beforeConfidence = result.packs[0].confidence;

      await processor.submitFeedback({
        token: result.feedbackToken,
        ratings: [{ packId, relevant: false }],
      });

      const afterPack = await storage.getContextPack(packId);
      expect(afterPack.confidence).toBeLessThan(beforeConfidence);
    });

    it('logs retrieval gap for analysis', async () => {
      const result = await queryLibrarian(storage, { intent: 'find authentication code' });

      await processor.submitFeedback({
        token: result.feedbackToken,
        ratings: result.packs.map(p => ({ packId: p.packId, relevant: false })),
        expectedButMissing: ['src/auth/login.ts'],
      });

      const gaps = await processor.getRetrievalGaps();
      expect(gaps.some(g =>
        g.queryIntent.includes('authentication') &&
        g.expectedFiles.includes('src/auth/login.ts')
      )).toBe(true);
    });

    it('confidence never drops below floor (0.1)', async () => {
      const result = await queryLibrarian(storage, { intent: 'test' });
      const packId = result.packs[0].packId;

      // Submit many negative feedbacks
      for (let i = 0; i < 20; i++) {
        const r = await queryLibrarian(storage, { intent: 'test' });
        await processor.submitFeedback({
          token: r.feedbackToken,
          ratings: [{ packId, relevant: false }],
        });
      }

      const afterPack = await storage.getContextPack(packId);
      expect(afterPack.confidence).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('Bayesian Confidence Update', () => {
    it('applies Bayesian update formula correctly', async () => {
      const prior = 0.5;
      const likelihood = 0.8; // P(positive feedback | truly relevant)
      const marginal = 0.6;   // P(positive feedback)

      // Bayes: P(relevant | positive) = P(positive | relevant) * P(relevant) / P(positive)
      const expectedPosterior = (likelihood * prior) / marginal;

      const actualPosterior = processor.bayesianUpdate(prior, {
        eventType: 'positive_feedback',
        strength: 1.0,
      });

      expect(actualPosterior).toBeCloseTo(expectedPosterior, 2);
    });

    it('asymmetric update: negative feedback has larger effect', async () => {
      const prior = 0.5;

      const afterPositive = processor.bayesianUpdate(prior, {
        eventType: 'positive_feedback',
        strength: 1.0,
      });

      const afterNegative = processor.bayesianUpdate(prior, {
        eventType: 'negative_feedback',
        strength: 1.0,
      });

      const positiveDelta = afterPositive - prior;
      const negativeDelta = prior - afterNegative;

      // Negative feedback should move confidence more (conservative)
      expect(negativeDelta).toBeGreaterThan(positiveDelta);
    });
  });

  describe('Learning Over Time', () => {
    it('retrieval improves after consistent feedback', async () => {
      // Initial query - may not find best result first
      const before = await queryLibrarian(storage, { intent: 'validate email format' });
      const targetPackId = 'pack-for-validateEmail';

      // Simulate 10 rounds of consistent feedback
      for (let i = 0; i < 10; i++) {
        const result = await queryLibrarian(storage, { intent: 'validate email format' });
        await processor.submitFeedback({
          token: result.feedbackToken,
          ratings: result.packs.map(p => ({
            packId: p.packId,
            relevant: p.packId === targetPackId,
            usefulness: p.packId === targetPackId ? 1.0 : 0.0,
          })),
        });
      }

      // After learning, target should rank higher
      const after = await queryLibrarian(storage, { intent: 'validate email format' });

      const beforeRank = before.packs.findIndex(p => p.packId === targetPackId);
      const afterRank = after.packs.findIndex(p => p.packId === targetPackId);

      // Lower index = higher rank
      expect(afterRank).toBeLessThanOrEqual(beforeRank);
    });
  });
});
```

### 2.2 Implementation Outline

```typescript
// File: src/LiBrainian/api/feedback_processor.ts

export interface FeedbackSubmission {
  token: string;
  ratings: Array<{
    packId: string;
    relevant: boolean;
    usefulness?: number; // 0-1, only for relevant
  }>;
  expectedButMissing?: string[]; // Files that SHOULD have been returned
}

export interface ConfidenceUpdateConfig {
  positiveBaseDelta: number;      // +0.05
  negativeBaseDelta: number;      // -0.10 (asymmetric - conservative)
  usefulnessMultiplier: number;   // 2.0 (scales positive delta by usefulness)
  confidenceFloor: number;        // 0.10
  confidenceCeiling: number;      // 0.95
}

export class FeedbackProcessor {
  constructor(storage: LibrarianStorage, config?: Partial<ConfidenceUpdateConfig>);

  // Generate token when query completes
  generateFeedbackToken(queryId: string, returnedPackIds: string[]): string;

  // Process submitted feedback
  async submitFeedback(feedback: FeedbackSubmission): Promise<void>;

  // Bayesian confidence update
  bayesianUpdate(prior: number, event: ConfidenceEvent): number;

  // Get gaps for analysis
  async getRetrievalGaps(): Promise<RetrievalGap[]>;
}
```

### 2.3 Success Criteria

- [ ] All 15+ tests pass
- [ ] Confidence events recorded in database
- [ ] Retrieval ranking improves after consistent feedback (measurable)
- [ ] Asymmetric update prevents overconfidence

---

## Phase 3: Edge Confidence from Evidence

**Impact**: Currently all edges have hardcoded 0.7/0.9 confidence. Evidence-based confidence enables better ranking and trust.

**Why Third**: With hybrid retrieval and feedback, evidence-based confidence becomes actionable.

### 3.1 Test Specification

```typescript
// File: src/LiBrainian/__tests__/edge_confidence.test.ts

import { describe, it, expect } from 'vitest';
import { computeEdgeConfidence, EdgeConfidenceFactors } from '../agents/edge_confidence.js';
import { AstIndexer } from '../agents/ast_indexer.js';

describe('Edge Confidence Computation', () => {
  describe('computeEdgeConfidence', () => {
    it('returns 0.95 for AST-verified, resolved, unambiguous edge', () => {
      const factors: EdgeConfidenceFactors = {
        source: 'ast_verified',
        hasSourceLine: true,
        isAmbiguous: false,
        targetResolved: true,
        hasTypeInfo: true,
      };

      expect(computeEdgeConfidence(factors)).toBe(0.95);
    });

    it('returns 0.85 for AST-verified with ambiguous overload', () => {
      const factors: EdgeConfidenceFactors = {
        source: 'ast_verified',
        hasSourceLine: true,
        isAmbiguous: true,  // Multiple overloads match
        targetResolved: true,
        hasTypeInfo: true,
      };

      expect(computeEdgeConfidence(factors)).toBe(0.85);
    });

    it('returns 0.75 for unresolved target (external dependency)', () => {
      const factors: EdgeConfidenceFactors = {
        source: 'ast_verified',
        hasSourceLine: true,
        isAmbiguous: false,
        targetResolved: false,  // e.g., fs.readFile
        hasTypeInfo: false,
      };

      expect(computeEdgeConfidence(factors)).toBe(0.75);
    });

    it('returns 0.60 for AST-inferred edge (no exact line)', () => {
      const factors: EdgeConfidenceFactors = {
        source: 'ast_inferred',
        hasSourceLine: false,
        isAmbiguous: false,
        targetResolved: true,
        hasTypeInfo: true,
      };

      expect(computeEdgeConfidence(factors)).toBe(0.60);
    });

    it('returns 0.40 for LLM-fallback edge', () => {
      const factors: EdgeConfidenceFactors = {
        source: 'llm_fallback',
        hasSourceLine: false,
        isAmbiguous: true,
        targetResolved: false,
        hasTypeInfo: false,
      };

      expect(computeEdgeConfidence(factors)).toBe(0.40);
    });

    it('never returns below 0.15', () => {
      const worstCase: EdgeConfidenceFactors = {
        source: 'llm_fallback',
        hasSourceLine: false,
        isAmbiguous: true,
        targetResolved: false,
        hasTypeInfo: false,
      };

      expect(computeEdgeConfidence(worstCase)).toBeGreaterThanOrEqual(0.15);
    });

    it('never returns above 0.95', () => {
      const bestCase: EdgeConfidenceFactors = {
        source: 'ast_verified',
        hasSourceLine: true,
        isAmbiguous: false,
        targetResolved: true,
        hasTypeInfo: true,
      };

      expect(computeEdgeConfidence(bestCase)).toBeLessThanOrEqual(0.95);
    });
  });

  describe('AST Indexer Ambiguity Detection', () => {
    let indexer: AstIndexer;

    beforeEach(() => {
      indexer = new AstIndexer({ /* config */ });
    });

    it('detects ambiguous overload resolution', async () => {
      const source = `
        function foo(x: number): void;
        function foo(x: string): void;
        function foo(x: any): void { }

        function bar() {
          foo(42);  // Ambiguous: could be number overload
        }
      `;

      const result = await indexer.indexSource(source, 'test.ts');
      const callEdge = result.edges.find(e => e.toName === 'foo');

      expect(callEdge).toBeDefined();
      expect(callEdge!.isAmbiguous).toBe(true);
    });

    it('marks non-overloaded calls as unambiguous', async () => {
      const source = `
        function uniqueFunction(x: number): void { }

        function caller() {
          uniqueFunction(42);
        }
      `;

      const result = await indexer.indexSource(source, 'test.ts');
      const callEdge = result.edges.find(e => e.toName === 'uniqueFunction');

      expect(callEdge).toBeDefined();
      expect(callEdge!.isAmbiguous).toBe(false);
    });

    it('marks external dependencies as unresolved', async () => {
      const source = `
        import { readFile } from 'fs';

        function reader() {
          readFile('path', () => {});
        }
      `;

      const result = await indexer.indexSource(source, 'test.ts');
      const callEdge = result.edges.find(e => e.toName === 'readFile');

      expect(callEdge).toBeDefined();
      expect(callEdge!.targetResolved).toBe(false);
    });

    it('marks local imports as resolved', async () => {
      const source = `
        import { localHelper } from './helpers';

        function main() {
          localHelper();
        }
      `;

      const result = await indexer.indexSource(source, 'test.ts', {
        resolveImports: true,
        localModules: ['./helpers'],
      });

      const callEdge = result.edges.find(e => e.toName === 'localHelper');

      expect(callEdge).toBeDefined();
      expect(callEdge!.targetResolved).toBe(true);
    });
  });

  describe('Integration: Edge Confidence in Storage', () => {
    it('persists edges with computed confidence', async () => {
      const storage = await createTestStorage();
      await indexWorkspace(storage, './test-fixtures');

      const edges = await storage.getGraphEdges({});

      // Should have variance, not all 0.7
      const confidences = edges.map(e => e.confidence);
      const uniqueConfidences = new Set(confidences);

      expect(uniqueConfidences.size).toBeGreaterThan(3);
    });

    it('higher confidence edges rank higher in graph traversal', async () => {
      const storage = await createTestStorage();
      await indexWorkspace(storage, './test-fixtures');

      const results = await graphTraverse(storage, 'mainFunction', {
        maxHops: 2,
        weightByConfidence: true,
      });

      // Results should be sorted by path confidence
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].pathConfidence).toBeGreaterThanOrEqual(results[i].pathConfidence);
      }
    });
  });
});
```

### 3.2 Implementation Outline

```typescript
// File: src/LiBrainian/agents/edge_confidence.ts

export interface EdgeConfidenceFactors {
  source: 'ast_verified' | 'ast_inferred' | 'llm_fallback';
  hasSourceLine: boolean;
  isAmbiguous: boolean;
  targetResolved: boolean;
  hasTypeInfo: boolean;
}

const CONFIDENCE_TABLE = {
  // Base confidence by source type
  ast_verified: 0.90,
  ast_inferred: 0.60,
  llm_fallback: 0.40,

  // Adjustments
  sourceLine_bonus: 0.05,
  ambiguity_penalty: -0.10,
  unresolved_penalty: -0.15,
  typeInfo_bonus: 0.05,

  // Bounds
  floor: 0.15,
  ceiling: 0.95,
};

export function computeEdgeConfidence(factors: EdgeConfidenceFactors): number {
  let confidence = CONFIDENCE_TABLE[factors.source];

  if (factors.hasSourceLine) confidence += CONFIDENCE_TABLE.sourceLine_bonus;
  if (factors.isAmbiguous) confidence += CONFIDENCE_TABLE.ambiguity_penalty;
  if (!factors.targetResolved) confidence += CONFIDENCE_TABLE.unresolved_penalty;
  if (factors.hasTypeInfo) confidence += CONFIDENCE_TABLE.typeInfo_bonus;

  return Math.max(CONFIDENCE_TABLE.floor, Math.min(CONFIDENCE_TABLE.ceiling, confidence));
}
```

### 3.3 Success Criteria

- [ ] All 12+ tests pass
- [ ] Edge confidence has >5 distinct values in real codebase
- [ ] Graph traversal uses confidence weighting
- [ ] Ambiguity detection works for TypeScript overloads

---

## Phase 4: Episodic Memory (Query History)

**Impact**: Enables context-aware queries and learning from past interactions.

**Why Fourth**: Builds on feedback loop, adds temporal dimension.

### 4.1 Test Specification

```typescript
// File: src/LiBrainian/__tests__/episodic_memory.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { EpisodicMemory, createEpisodicMemory } from '../memory/episodic.js';

describe('Episodic Memory', () => {
  let memory: EpisodicMemory;

  beforeEach(async () => {
    memory = await createEpisodicMemory({ maxEpisodes: 1000 });
  });

  describe('Episode Recording', () => {
    it('records query episodes with timestamp', async () => {
      const episode = await memory.recordQuery({
        intent: 'find authentication code',
        depth: 'L1',
        returnedPacks: ['pack1', 'pack2'],
        latencyMs: 150,
      });

      expect(episode.id).toBeDefined();
      expect(episode.timestamp).toBeDefined();
      expect(new Date(episode.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('records feedback as episode continuation', async () => {
      const queryEpisode = await memory.recordQuery({
        intent: 'find auth',
        returnedPacks: ['pack1'],
        latencyMs: 100,
      });

      const feedbackEpisode = await memory.recordFeedback({
        parentEpisodeId: queryEpisode.id,
        ratings: [{ packId: 'pack1', relevant: true }],
      });

      expect(feedbackEpisode.parentId).toBe(queryEpisode.id);

      // Should be retrievable together
      const chain = await memory.getEpisodeChain(queryEpisode.id);
      expect(chain.length).toBe(2);
    });
  });

  describe('Similarity Search', () => {
    it('finds similar past queries', async () => {
      // Record some history
      await memory.recordQuery({ intent: 'how does user authentication work', returnedPacks: ['auth1'] });
      await memory.recordQuery({ intent: 'explain the login flow', returnedPacks: ['login1'] });
      await memory.recordQuery({ intent: 'database connection pooling', returnedPacks: ['db1'] });

      // Search for similar
      const similar = await memory.findSimilarQueries('user login authentication', { limit: 2 });

      expect(similar.length).toBe(2);
      expect(similar[0].episode.intent).toContain('authentication');
      expect(similar[1].episode.intent).toContain('login');
    });

    it('returns similarity score', async () => {
      await memory.recordQuery({ intent: 'validate email format', returnedPacks: ['email1'] });

      const similar = await memory.findSimilarQueries('email validation', { limit: 1 });

      expect(similar[0].similarity).toBeGreaterThan(0.5);
      expect(similar[0].similarity).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Context-Aware Retrieval Boost', () => {
    it('boosts packs that were relevant in similar past queries', async () => {
      // Past: user asked about auth, pack 'auth-handler' was marked relevant
      await memory.recordQuery({
        intent: 'authentication flow',
        returnedPacks: ['auth-handler', 'user-model'],
      });
      await memory.recordFeedback({
        parentEpisodeId: (await memory.getLatestEpisode()).id,
        ratings: [
          { packId: 'auth-handler', relevant: true, usefulness: 1.0 },
          { packId: 'user-model', relevant: false },
        ],
      });

      // Now: similar query, should boost auth-handler
      const boost = await memory.getHistoricalBoost('login verification', ['auth-handler', 'user-model']);

      expect(boost['auth-handler']).toBeGreaterThan(0);
      expect(boost['user-model']).toBeLessThanOrEqual(0);
    });
  });

  describe('Recency Weighting', () => {
    it('weights recent episodes higher', async () => {
      // Old episode
      await memory.recordQuery({ intent: 'test query old', returnedPacks: ['old'] });

      // Simulate time passing
      vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000); // 7 days

      // New episode
      await memory.recordQuery({ intent: 'test query new', returnedPacks: ['new'] });

      const similar = await memory.findSimilarQueries('test query', {
        limit: 2,
        recencyWeight: 0.5, // 50% recency, 50% similarity
      });

      // New should rank higher despite equal semantic similarity
      expect(similar[0].episode.returnedPacks).toContain('new');
    });
  });

  describe('Memory Consolidation', () => {
    it('consolidates repeated patterns into semantic memory', async () => {
      // Same pattern 5 times
      for (let i = 0; i < 5; i++) {
        const ep = await memory.recordQuery({
          intent: 'validate user input',
          returnedPacks: ['validator']
        });
        await memory.recordFeedback({
          parentEpisodeId: ep.id,
          ratings: [{ packId: 'validator', relevant: true, usefulness: 1.0 }],
        });
      }

      // Should consolidate into a "semantic rule"
      const rules = await memory.getConsolidatedRules();

      expect(rules.some(r =>
        r.pattern.includes('validate') &&
        r.recommendedPacks.includes('validator')
      )).toBe(true);
    });
  });

  describe('Capacity Management', () => {
    it('evicts oldest episodes when capacity exceeded', async () => {
      const smallMemory = await createEpisodicMemory({ maxEpisodes: 5 });

      // Record 10 episodes
      for (let i = 0; i < 10; i++) {
        await smallMemory.recordQuery({ intent: `query ${i}`, returnedPacks: [] });
      }

      const count = await smallMemory.getEpisodeCount();
      expect(count).toBe(5);

      // Oldest should be gone
      const episodes = await smallMemory.getAllEpisodes();
      expect(episodes.some(e => e.intent === 'query 0')).toBe(false);
      expect(episodes.some(e => e.intent === 'query 9')).toBe(true);
    });
  });
});
```

### 4.2 Success Criteria

- [ ] All 12+ tests pass
- [ ] Query history persists across sessions
- [ ] Similar query detection works with >0.7 precision
- [ ] Historical boost improves retrieval for repeated patterns

---

## Phase 5: Graph-Enhanced Ranking

**Impact**: Uses code structure (calls, imports) to boost contextually relevant results.

**Why Fifth**: Builds on all previous phases, adds structural intelligence.

### 5.1 Test Specification

```typescript
// File: src/LiBrainian/__tests__/graph_ranking.test.ts

import { describe, it, expect } from 'vitest';
import { GraphRanker, createGraphRanker } from '../ranking/graph_ranker.js';

describe('Graph-Enhanced Ranking', () => {
  let ranker: GraphRanker;

  beforeEach(async () => {
    const storage = await createTestStorage();
    await seedGraphData(storage);
    ranker = createGraphRanker(storage);
  });

  describe('Caller/Callee Boost', () => {
    it('boosts callees when query matches caller', async () => {
      // Query matches "handleRequest", should boost functions it calls
      const candidates = await getCandidates(['handleRequest', 'validateInput', 'processData', 'unrelated']);

      const ranked = await ranker.rank(candidates, {
        matchedEntity: 'handleRequest',
        boostCallees: true,
      });

      // validateInput and processData (called by handleRequest) should rank higher
      const validateRank = ranked.findIndex(r => r.entity === 'validateInput');
      const unrelatedRank = ranked.findIndex(r => r.entity === 'unrelated');

      expect(validateRank).toBeLessThan(unrelatedRank);
    });

    it('boosts callers when query is about a utility function', async () => {
      // Query about "formatDate", boost functions that USE it
      const candidates = await getCandidates(['formatDate', 'renderReport', 'generateInvoice', 'unrelated']);

      const ranked = await ranker.rank(candidates, {
        matchedEntity: 'formatDate',
        boostCallers: true,
      });

      // renderReport and generateInvoice (call formatDate) should rank higher
      const renderRank = ranked.findIndex(r => r.entity === 'renderReport');
      const unrelatedRank = ranked.findIndex(r => r.entity === 'unrelated');

      expect(renderRank).toBeLessThan(unrelatedRank);
    });
  });

  describe('Import Graph Boost', () => {
    it('boosts co-imported modules', async () => {
      // If auth.ts imports both userService and tokenService, they're related
      const candidates = await getCandidates(['userService', 'tokenService', 'databasePool']);

      const ranked = await ranker.rank(candidates, {
        contextFile: 'src/auth.ts',
        boostCoImports: true,
      });

      // userService and tokenService should rank higher (co-imported in auth.ts)
      const userRank = ranked.findIndex(r => r.entity === 'userService');
      const dbRank = ranked.findIndex(r => r.entity === 'databasePool');

      expect(userRank).toBeLessThan(dbRank);
    });
  });

  describe('PageRank-Style Authority', () => {
    it('computes authority score based on incoming edges', async () => {
      const authority = await ranker.computeAuthority();

      // Highly-called utilities should have high authority
      expect(authority['validateInput']).toBeGreaterThan(authority['obscureHelper']);
    });

    it('uses authority as ranking signal', async () => {
      const candidates = await getCandidates(['validateInput', 'obscureHelper']);

      const ranked = await ranker.rank(candidates, {
        useAuthority: true,
      });

      expect(ranked[0].entity).toBe('validateInput');
    });
  });

  describe('Path Confidence', () => {
    it('computes path confidence as product of edge confidences', async () => {
      // Path: A --(0.9)--> B --(0.8)--> C
      const pathConfidence = await ranker.computePathConfidence(['A', 'B', 'C']);

      expect(pathConfidence).toBeCloseTo(0.9 * 0.8, 2);
    });

    it('penalizes long paths', async () => {
      const shortPath = await ranker.computePathConfidence(['A', 'B']);
      const longPath = await ranker.computePathConfidence(['A', 'B', 'C', 'D', 'E']);

      // Even with same edge confidences, longer path should have lower score
      expect(longPath).toBeLessThan(shortPath);
    });
  });
});
```

### 5.2 Success Criteria

- [ ] All 10+ tests pass
- [ ] Graph boost measurably improves ranking for structural queries
- [ ] Authority scores computed for all indexed functions
- [ ] Path confidence used in multi-hop retrieval

---

## Execution Timeline

```
Phase 1: Hybrid Retrieval     [Foundation - enables all other phases]
    └── Tests: hybrid_retrieval.test.ts (15 tests)
    └── Duration: ~3 days

Phase 2: Feedback Learning    [Enables system to improve]
    └── Tests: feedback_learning.test.ts (15 tests)
    └── Duration: ~2 days

Phase 3: Edge Confidence      [Evidence-based trust]
    └── Tests: edge_confidence.test.ts (12 tests)
    └── Duration: ~2 days

Phase 4: Episodic Memory      [Context-aware queries]
    └── Tests: episodic_memory.test.ts (12 tests)
    └── Duration: ~2 days

Phase 5: Graph Ranking        [Structural intelligence]
    └── Tests: graph_ranking.test.ts (10 tests)
    └── Duration: ~2 days
```

---

## Verification Commands

```bash
# Phase 1
npm run test -- src/LiBrainian/__tests__/hybrid_retrieval.test.ts

# Phase 2
npm run test -- src/LiBrainian/__tests__/feedback_learning.test.ts

# Phase 3
npm run test -- src/LiBrainian/__tests__/edge_confidence.test.ts

# Phase 4
npm run test -- src/LiBrainian/__tests__/episodic_memory.test.ts

# Phase 5
npm run test -- src/LiBrainian/__tests__/graph_ranking.test.ts

# Full suite
npm run test -- src/LiBrainian/__tests__/*.test.ts

# Benchmark: Hybrid vs Semantic-only
npm run test -- src/LiBrainian/__tests__/retrieval_benchmark.test.ts
```

---

## Success Metrics

| Metric | Current | Target | Phase |
|--------|---------|--------|-------|
| Recall@5 (exact match) | ~60% | ≥85% | Phase 1 |
| Confidence variance | 2 values | ≥6 values | Phase 3 |
| Learning improvement | None | ≥10% after 20 feedbacks | Phase 2 |
| Context-aware boost | None | ≥15% for repeated patterns | Phase 4 |
| Graph-connected precision | ~40% | ≥60% | Phase 5 |

---

## Definition of "World Class"

Based on research, a world-class knowledge system must have:

1. **Hybrid Retrieval**: Lexical + Semantic + Structural (Phase 1)
2. **Learning Capability**: Improves from feedback (Phase 2)
3. **Calibrated Confidence**: Evidence-based, not hardcoded (Phase 3)
4. **Memory**: Learns from history (Phase 4)
5. **Structural Awareness**: Uses code graphs (Phase 5)

All top-tier systems in 2025-2026 papers have these properties. Implementing them makes LiBrainian competitive with state-of-the-art.
