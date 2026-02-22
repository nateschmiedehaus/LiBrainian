import * as fs from 'node:fs';
import * as path from 'node:path';

export const EMBEDDING_BENCHMARK_ARTIFACT_KIND = 'EmbeddingModelBenchmarkArtifact.v1';
export const DEFAULT_EMBEDDING_BENCHMARK_ARTIFACT_PATH = path.join(
  'state',
  'benchmarks',
  'embedding-model-selection.json',
);

export type SupportedEmbeddingModelId =
  | 'all-MiniLM-L6-v2'
  | 'jina-embeddings-v2-base-en'
  | 'bge-small-en-v1.5'
  | 'mxbai-embed-large-v1';

export interface EmbeddingModelBenchmarkSummary {
  modelId: SupportedEmbeddingModelId;
  dimension: number;
  retrieval: {
    recallAt5: number;
    ndcgAt5: number;
    mrr: number;
  };
  latency: {
    p95Ms: number;
    coldStartMs: number;
  };
  footprint: {
    indexBytes: number;
    memoryBytes: number;
  };
  compositeScore: number;
  status: 'evaluated' | 'failed';
  error?: string;
}

export interface EmbeddingModelBenchmarkArtifact {
  kind: typeof EMBEDDING_BENCHMARK_ARTIFACT_KIND;
  schemaVersion: 1;
  generatedAt: string;
  benchmarkDataset: string;
  models: EmbeddingModelBenchmarkSummary[];
  recommendation: {
    modelId: SupportedEmbeddingModelId;
    rationale: string;
    score: number;
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, ' ').trim();
}

export function isMxbaiEmbeddingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw =
    env.LIBRAINIAN_ENABLE_MXBAI_EMBEDDING
    ?? env.LIBRARIAN_ENABLE_MXBAI_EMBEDDING
    ?? '0';
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function isEmbeddingModelEnabled(
  modelId: SupportedEmbeddingModelId,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (modelId === 'mxbai-embed-large-v1') {
    return isMxbaiEmbeddingEnabled(env);
  }
  return true;
}

export function getSupportedEmbeddingModelIds(
  env: NodeJS.ProcessEnv = process.env,
): SupportedEmbeddingModelId[] {
  const models: SupportedEmbeddingModelId[] = [
    'all-MiniLM-L6-v2',
    'jina-embeddings-v2-base-en',
    'bge-small-en-v1.5',
  ];
  if (isMxbaiEmbeddingEnabled(env)) {
    models.push('mxbai-embed-large-v1');
  }
  return models;
}

function resolveArtifactPath(explicitPath: string | undefined, env: NodeJS.ProcessEnv): string {
  if (explicitPath && explicitPath.trim().length > 0) {
    return path.resolve(explicitPath);
  }
  const envPath =
    env.LIBRAINIAN_EMBEDDING_BENCHMARK_ARTIFACT
    ?? env.LIBRARIAN_EMBEDDING_BENCHMARK_ARTIFACT;
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath);
  }
  return path.resolve(process.cwd(), DEFAULT_EMBEDDING_BENCHMARK_ARTIFACT_PATH);
}

export function readEmbeddingModelBenchmarkArtifact(options: {
  artifactPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): EmbeddingModelBenchmarkArtifact | null {
  const env = options.env ?? process.env;
  const artifactPath = resolveArtifactPath(options.artifactPath, env);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(artifactPath, 'utf8');
    const parsed = JSON.parse(raw) as EmbeddingModelBenchmarkArtifact;
    if (parsed.kind !== EMBEDDING_BENCHMARK_ARTIFACT_KIND || parsed.schemaVersion !== 1) {
      return null;
    }
    if (!parsed.recommendation?.modelId || typeof parsed.recommendation.modelId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolveRecommendedEmbeddingModel(options: {
  fallbackModelId?: SupportedEmbeddingModelId;
  artifactPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): SupportedEmbeddingModelId {
  const env = options.env ?? process.env;
  const fallbackModelId = options.fallbackModelId ?? 'all-MiniLM-L6-v2';
  const fallbackSupported = isEmbeddingModelEnabled(fallbackModelId, env)
    ? fallbackModelId
    : getSupportedEmbeddingModelIds(env)[0] ?? 'all-MiniLM-L6-v2';
  const artifact = readEmbeddingModelBenchmarkArtifact({
    artifactPath: options.artifactPath,
    env,
  });
  if (!artifact) {
    return fallbackSupported;
  }

  const recommended = artifact.recommendation.modelId;
  if (!isEmbeddingModelEnabled(recommended, env)) {
    return fallbackSupported;
  }
  return recommended;
}

export function writeEmbeddingModelBenchmarkArtifact(
  artifact: EmbeddingModelBenchmarkArtifact,
  outputPath: string,
): void {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  } catch (error) {
    const message = sanitizeError(error);
    throw new Error(`Failed to write embedding benchmark artifact: ${message}`);
  }
}
