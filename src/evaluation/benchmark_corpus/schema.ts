import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const benchmarkQuerySchema = z.object({
  id: z.string(),
  query: z.string(),
  queryType: z.string(),
  description: z.string().optional(),
  queryCategory: z.string().optional(),
  relevantFiles: z.array(z.string()).min(1),
  relevantFunctions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  difficulty: z.enum(['intro', 'bugfix', 'investigation', 'architecture', 'compliance', 'performance']).optional(),
});

const benchmarkCorpusSchema = z.object({
  schema: z.literal('LCIBQueryCorpus.v1'),
  repoId: z.string(),
  version: z.string(),
  curatedBy: z.string().optional(),
  description: z.string().optional(),
  queries: z.array(benchmarkQuerySchema).min(1),
});

const bootstrapConfigSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const repoConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  gitUrl: z.string().url(),
  defaultBranch: z.string(),
  languages: z.array(z.string()).min(1),
  locEstimate: z.string(),
  stackNotes: z.string().optional(),
  setup: z.object({
    commands: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }).optional(),
  bootstrap: bootstrapConfigSchema.optional(),
  groundTruthFile: z.string(),
  tags: z.array(z.string()).optional(),
});

const repoConfigFileSchema = z.object({
  schema: z.literal('LCIBRepoConfig.v1'),
  updatedAt: z.string(),
  repos: z.array(repoConfigSchema).min(1),
});

export type BenchmarkQuery = z.infer<typeof benchmarkQuerySchema>;
export type BenchmarkCorpus = z.infer<typeof benchmarkCorpusSchema>;
export type BenchmarkRepoConfig = z.infer<typeof repoConfigSchema>;
export type BenchmarkRepoConfigFile = z.infer<typeof repoConfigFileSchema>;

export async function loadRepoConfigs(root = path.join(process.cwd(), 'src', 'evaluation', 'benchmark_corpus')): Promise<BenchmarkRepoConfigFile> {
  const configPath = path.join(root, 'repos.json');
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const validation = repoConfigFileSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(`invalid_repo_config: ${validation.error.message}`);
  }
  return validation.data;
}

export async function loadCorpusForRepo(
  repoId: string,
  root = path.join(process.cwd(), 'src', 'evaluation', 'benchmark_corpus'),
  repoConfigs: BenchmarkRepoConfigFile | null = null,
): Promise<BenchmarkCorpus> {
  const resolvedConfigs = repoConfigs ?? await loadRepoConfigs(root);
  const config = resolvedConfigs.repos.find((repo) => repo.id === repoId);
  if (!config) {
    throw new Error(`unknown_repo: ${repoId}`);
  }
  const corpusPath = path.join(root, config.groundTruthFile);
  const raw = await fs.readFile(corpusPath, 'utf8');
  const parsed = JSON.parse(raw);
  const validation = benchmarkCorpusSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(`invalid_corpus(${repoId}): ${validation.error.message}`);
  }
  if (validation.data.repoId !== repoId) {
    throw new Error(`corpus_repo_mismatch: expected ${repoId}, found ${validation.data.repoId}`);
  }
  return validation.data;
}

export async function loadAllCorpora(root = path.join(process.cwd(), 'src', 'evaluation', 'benchmark_corpus')): Promise<BenchmarkCorpus[]> {
  const config = await loadRepoConfigs(root);
  const corpora: BenchmarkCorpus[] = [];
  for (const repo of config.repos) {
    const corpus = await loadCorpusForRepo(repo.id, root, config);
    corpora.push(corpus);
  }
  return corpora;
}
