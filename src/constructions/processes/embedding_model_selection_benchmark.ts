import * as path from 'node:path';
import {
  aggregateMetrics,
  computeQueryMetrics,
  type EvaluationQuery,
  type EvaluationResult,
} from '../../measurement/retrieval_quality.js';
import { cosineSimilarity, generateRealEmbedding } from '../../api/embedding_providers/real_embeddings.js';
import {
  EMBEDDING_BENCHMARK_ARTIFACT_KIND,
  writeEmbeddingModelBenchmarkArtifact,
  type EmbeddingModelBenchmarkArtifact,
  type EmbeddingModelBenchmarkSummary,
  type SupportedEmbeddingModelId,
} from '../../api/embedding_providers/model_selection_policy.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export const EMBEDDING_BENCHMARK_DATASET_ID = 'embedding-model-selection-v1';
export const EMBEDDING_BENCHMARK_DEFAULT_OUTPUT_PATH = path.join(
  'state',
  'benchmarks',
  'embedding-model-selection.json',
);
export { EMBEDDING_BENCHMARK_ARTIFACT_KIND };

export const EMBEDDING_BENCHMARK_CANDIDATE_MODELS: SupportedEmbeddingModelId[] = [
  'all-MiniLM-L6-v2',
  'jina-embeddings-v2-base-en',
  'bge-small-en-v1.5',
  'mxbai-embed-large-v1',
];

export interface EmbeddingBenchmarkDocument {
  id: string;
  text: string;
}

export interface EmbeddingBenchmarkQuery {
  id: string;
  text: string;
  relevantDocumentIds: string[];
}

export interface EmbeddingModelSelectionBenchmarkInput {
  modelIds?: SupportedEmbeddingModelId[];
  documents?: EmbeddingBenchmarkDocument[];
  queries?: EmbeddingBenchmarkQuery[];
  outputPath?: string;
  embedText?: (modelId: SupportedEmbeddingModelId, text: string) => Promise<Float32Array>;
}

export interface EmbeddingModelSelectionBenchmarkOutput extends EmbeddingModelBenchmarkArtifact {
  pass: boolean;
}

const DEFAULT_DOCUMENTS: EmbeddingBenchmarkDocument[] = [
  {
    id: 'doc-auth-refresh',
    text: 'Session refresh token rotation and auth middleware validation logic.',
  },
  {
    id: 'doc-vector-migration',
    text: 'SQLite vector index migration for embedding dimension mismatch and recovery.',
  },
  {
    id: 'doc-cli-help',
    text: 'CLI help output contract, machine-readable status json, and command diagnostics.',
  },
  {
    id: 'doc-patrol-loop',
    text: 'Patrol scan issue filing fix generation regression tests and fix verification.',
  },
  {
    id: 'doc-bootstrap-lock',
    text: 'Bootstrap liveness detection stale process recovery and lock conflict diagnostics.',
  },
  {
    id: 'doc-provider-selection',
    text: 'Provider precedence env override host hint and persisted successful provider policy.',
  },
];

const DEFAULT_QUERIES: EmbeddingBenchmarkQuery[] = [
  {
    id: 'query-auth',
    text: 'Where is auth session refresh validation implemented?',
    relevantDocumentIds: ['doc-auth-refresh'],
  },
  {
    id: 'query-dimension-recovery',
    text: 'How does embedding dimension mismatch auto-recovery work?',
    relevantDocumentIds: ['doc-vector-migration'],
  },
  {
    id: 'query-cli-json',
    text: 'What ensures CLI status output remains parseable json?',
    relevantDocumentIds: ['doc-cli-help'],
  },
  {
    id: 'query-patrol',
    text: 'Which pipeline handles patrol issue filing fix and verification?',
    relevantDocumentIds: ['doc-patrol-loop'],
  },
  {
    id: 'query-bootstrap-stall',
    text: 'How do we detect and recover stale bootstrap lock contention?',
    relevantDocumentIds: ['doc-bootstrap-lock'],
  },
  {
    id: 'query-provider-policy',
    text: 'What determines codex versus claude provider selection precedence?',
    relevantDocumentIds: ['doc-provider-selection'],
  },
];

function normalizeVector(vector: Float32Array): Float32Array {
  let normSq = 0;
  for (let i = 0; i < vector.length; i += 1) {
    normSq += vector[i] * vector[i];
  }
  if (normSq <= 0) {
    return vector;
  }
  const norm = Math.sqrt(normSq);
  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    normalized[i] = vector[i] / norm;
  }
  return normalized;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const bounded = Math.min(1, Math.max(0, percentile));
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * bounded));
  return sorted[index] ?? 0;
}

function scoreModel(summary: Omit<EmbeddingModelBenchmarkSummary, 'compositeScore' | 'status'>): number {
  const quality = (summary.retrieval.recallAt5 * 0.5) + (summary.retrieval.ndcgAt5 * 0.35) + (summary.retrieval.mrr * 0.15);
  const latencyPenalty = 1 / (1 + (summary.latency.p95Ms / 500));
  const startupPenalty = 1 / (1 + (summary.latency.coldStartMs / 5000));
  return Number(((quality * 0.75) + (latencyPenalty * 0.15) + (startupPenalty * 0.10)).toFixed(6));
}

function toEvaluationQueries(queries: EmbeddingBenchmarkQuery[]): EvaluationQuery[] {
  return queries.map((query) => ({
    queryId: query.id,
    query: query.text,
    queryType: 'default',
    relevantTargets: query.relevantDocumentIds,
  }));
}

export function createEmbeddingModelSelectionBenchmarkConstruction(): Construction<
  EmbeddingModelSelectionBenchmarkInput,
  EmbeddingModelSelectionBenchmarkOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'embedding-model-selection-benchmark',
    name: 'Embedding Model Selection Benchmark',
    description: 'Runs deterministic retrieval/latency benchmark across local embedding candidates and emits recommendation artifact.',
    async execute(input: EmbeddingModelSelectionBenchmarkInput = {}) {
      const modelIds = input.modelIds ?? EMBEDDING_BENCHMARK_CANDIDATE_MODELS;
      const documents = input.documents ?? DEFAULT_DOCUMENTS;
      const queries = input.queries ?? DEFAULT_QUERIES;
      const embedText = input.embedText ?? (async (modelId, text) => {
        const result = await generateRealEmbedding(text, modelId);
        return result.embedding;
      });
      const evalQueries = toEvaluationQueries(queries);
      const summaries: EmbeddingModelBenchmarkSummary[] = [];

      for (const modelId of modelIds) {
        const memoryBefore = process.memoryUsage().rss;
        const coldStartStartedAt = Date.now();
        try {
          await embedText(modelId, '__benchmark_probe__');
        } catch (error) {
          summaries.push({
            modelId,
            dimension: 0,
            retrieval: { recallAt5: 0, ndcgAt5: 0, mrr: 0 },
            latency: { p95Ms: 0, coldStartMs: Date.now() - coldStartStartedAt },
            footprint: { indexBytes: 0, memoryBytes: 0 },
            compositeScore: 0,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const coldStartMs = Date.now() - coldStartStartedAt;
        const documentEmbeddings = await Promise.all(
          documents.map(async (document) => ({
            id: document.id,
            vector: normalizeVector(await embedText(modelId, document.text)),
          })),
        );
        const dimension = documentEmbeddings[0]?.vector.length ?? 0;
        const latencySamples: number[] = [];
        const queryResults: EvaluationResult[] = [];

        for (const query of queries) {
          const startedAt = Date.now();
          const queryVector = normalizeVector(await embedText(modelId, query.text));
          const scored = documentEmbeddings
            .map((documentEmbedding) => ({
              id: documentEmbedding.id,
              score: cosineSimilarity(queryVector, documentEmbedding.vector),
            }))
            .sort((left, right) => {
              if (right.score !== left.score) {
                return right.score - left.score;
              }
              return left.id.localeCompare(right.id);
            });

          const latencyMs = Date.now() - startedAt;
          latencySamples.push(latencyMs);
          queryResults.push({
            queryId: query.id,
            retrievedIds: scored.map((entry) => entry.id),
            scores: scored.map((entry) => entry.score),
            latencyMs,
            method: 'single-vector',
          });
        }

        const perQuery = evalQueries.map((query, index) => computeQueryMetrics(query, queryResults[index]!));
        const aggregate = aggregateMetrics(perQuery);
        const summaryInput = {
          modelId,
          dimension,
          retrieval: {
            recallAt5: aggregate.meanRecallAtK[5] ?? 0,
            ndcgAt5: aggregate.meanNdcgAtK[5] ?? 0,
            mrr: aggregate.meanMrr,
          },
          latency: {
            p95Ms: calculatePercentile(latencySamples, 0.95),
            coldStartMs,
          },
          footprint: {
            indexBytes: dimension * documents.length * Float32Array.BYTES_PER_ELEMENT,
            memoryBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
          },
        };
        summaries.push({
          ...summaryInput,
          compositeScore: scoreModel(summaryInput),
          status: 'evaluated',
        });
      }

      const evaluated = summaries.filter((summary) => summary.status === 'evaluated');
      const ranked = [...evaluated].sort((left, right) => right.compositeScore - left.compositeScore);
      const winner = ranked[0] ?? null;
      const recommendation = winner
        ? {
            modelId: winner.modelId,
            rationale: `Selected by deterministic benchmark: score=${winner.compositeScore.toFixed(3)} recall@5=${winner.retrieval.recallAt5.toFixed(3)} ndcg@5=${winner.retrieval.ndcgAt5.toFixed(3)} p95=${winner.latency.p95Ms.toFixed(1)}ms`,
            score: winner.compositeScore,
          }
        : {
            modelId: 'all-MiniLM-L6-v2' as SupportedEmbeddingModelId,
            rationale: 'No model produced an evaluated benchmark result.',
            score: 0,
          };

      const artifact: EmbeddingModelSelectionBenchmarkOutput = {
        kind: EMBEDDING_BENCHMARK_ARTIFACT_KIND,
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        benchmarkDataset: EMBEDDING_BENCHMARK_DATASET_ID,
        models: summaries,
        recommendation,
        pass: evaluated.length === modelIds.length,
      };

      if (input.outputPath) {
        writeEmbeddingModelBenchmarkArtifact(artifact, path.resolve(input.outputPath));
      }

      return ok<EmbeddingModelSelectionBenchmarkOutput, ConstructionError>(artifact);
    },
  };
}
