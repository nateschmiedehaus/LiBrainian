#!/usr/bin/env tsx

import path from 'node:path';
import {
  createEmbeddingModelSelectionBenchmarkConstruction,
  EMBEDDING_BENCHMARK_CANDIDATE_MODELS,
  EMBEDDING_BENCHMARK_DEFAULT_OUTPUT_PATH,
} from '../src/constructions/processes/embedding_model_selection_benchmark.js';
import { unwrapConstructionExecutionResult } from '../src/constructions/types.js';
import type { SupportedEmbeddingModelId } from '../src/api/embedding_providers/model_selection_policy.js';

function parseArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${key}`);
  }
  return value;
}

function parseModelList(raw: string | undefined): SupportedEmbeddingModelId[] | undefined {
  if (!raw) return undefined;
  const models = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const allowed = new Set<string>(EMBEDDING_BENCHMARK_CANDIDATE_MODELS);
  for (const model of models) {
    if (!allowed.has(model)) {
      throw new Error(
        `Unsupported model in --models: ${model}. Allowed: ${EMBEDDING_BENCHMARK_CANDIDATE_MODELS.join(', ')}`,
      );
    }
  }
  return models as SupportedEmbeddingModelId[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputArg = parseArgValue(args, '--output');
  const modelsArg = parseArgValue(args, '--models');
  const outputPath = path.resolve(outputArg ?? EMBEDDING_BENCHMARK_DEFAULT_OUTPUT_PATH);
  const modelIds = parseModelList(modelsArg);

  const construction = createEmbeddingModelSelectionBenchmarkConstruction();
  const result = unwrapConstructionExecutionResult(
    await construction.execute({
      modelIds,
      outputPath,
    }),
  );

  const evaluated = result.models.filter((model) => model.status === 'evaluated').length;
  console.log(
    `[embedding-benchmark] complete pass=${result.pass} evaluated=${evaluated}/${result.models.length} recommended=${result.recommendation.modelId} output=${outputPath}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[embedding-benchmark] failed: ${message}`);
  process.exitCode = 1;
});
