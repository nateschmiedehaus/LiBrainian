/**
 * @fileoverview Export structural ground truth into eval-corpus schema.
 */

import path from 'node:path';
import type { ASTFact } from './ast_fact_extractor.js';
import type {
  StructuralGroundTruthCorpus,
  StructuralGroundTruthQuery,
  StructuralQueryCategory,
  StructuralQueryDifficulty,
} from './ground_truth_generator.js';
import type {
  GroundTruthCategory,
  GroundTruthDifficulty,
  GroundTruthQuery,
  RepoManifest,
  EvidenceRef,
} from './runner.js';

export interface RepoMetaInput {
  repoId: string;
  name: string;
  languages: string[];
  hasTests?: boolean;
  fileCount?: number;
  annotationLevel?: RepoManifest['annotationLevel'];
  documentationDensity?: RepoManifest['characteristics']['documentationDensity'];
  testCoverage?: RepoManifest['characteristics']['testCoverage'];
  architecturalClarity?: RepoManifest['characteristics']['architecturalClarity'];
  codeQuality?: RepoManifest['characteristics']['codeQuality'];
}

export interface StructuralGroundTruthExport {
  version: string;
  repoId: string;
  manifest: RepoManifest;
  queries: GroundTruthQuery[];
}

const CATEGORY_MAP: Record<StructuralQueryCategory, GroundTruthCategory> = {
  structural: 'structural',
  behavioral: 'behavioral',
  architectural: 'architectural',
};

const DIFFICULTY_MAP: Record<StructuralQueryDifficulty, GroundTruthDifficulty> = {
  easy: 'trivial',
  medium: 'moderate',
  hard: 'hard',
};

export function exportStructuralGroundTruth(input: {
  corpus: StructuralGroundTruthCorpus;
  repoMeta: RepoMetaInput;
  version?: string;
  verifiedBy?: string;
  lastVerified?: string;
}): StructuralGroundTruthExport {
  const { corpus, repoMeta } = input;
  const repoRoot = path.resolve(corpus.repoPath);
  const version = input.version ?? '1.0.0';
  const lastVerified = normalizeDate(input.lastVerified ?? corpus.generatedAt);
  const verifiedBy = input.verifiedBy ?? 'librarian:ground_truth_generator';

  const manifest: RepoManifest = {
    repoId: repoMeta.repoId,
    name: repoMeta.name,
    languages: repoMeta.languages,
    fileCount: repoMeta.fileCount ?? countEvidenceFiles(corpus),
    annotationLevel: repoMeta.annotationLevel ?? 'sparse',
    characteristics: {
      documentationDensity: repoMeta.documentationDensity ?? 'medium',
      testCoverage: repoMeta.testCoverage ?? (repoMeta.hasTests ? 'medium' : 'low'),
      architecturalClarity: repoMeta.architecturalClarity ?? 'moderate',
      codeQuality: repoMeta.codeQuality ?? 'average',
    },
  };

  const queries = corpus.queries.map((query) =>
    mapQuery(query, repoMeta.repoId, repoRoot, lastVerified, verifiedBy)
  );

  return {
    version,
    repoId: repoMeta.repoId,
    manifest,
    queries,
  };
}

function mapQuery(
  query: StructuralGroundTruthQuery,
  repoId: string,
  repoRoot: string,
  lastVerified: string,
  verifiedBy: string
): GroundTruthQuery {
  const evidenceFacts = query.expectedAnswer.evidence ?? [];
  const evidenceRefs = buildEvidenceRefs(query.id, evidenceFacts, repoRoot);
  const mustIncludeFiles = unique(
    evidenceFacts
      .map((fact) => normalizeRepoRelativePath(repoRoot, fact.file))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );

  return {
    queryId: query.id,
    repoId,
    intent: query.query,
    category: CATEGORY_MAP[query.category],
    difficulty: DIFFICULTY_MAP[query.difficulty],
    correctAnswer: {
      summary: buildSummary(query),
      mustIncludeFiles,
      shouldIncludeFiles: [],
      mustIncludeFacts: buildFacts(query),
      mustNotClaim: [],
      acceptableVariations: [],
      evidenceRefs,
    },
    lastVerified,
    verifiedBy,
    verificationNotes: 'Generated from AST facts.',
    tags: ['machine_generated', 'structural_ground_truth'],
  };
}

function buildSummary(query: StructuralGroundTruthQuery): string {
  const value = query.expectedAnswer.value;
  if (query.expectedAnswer.type === 'count') {
    return `Expected count: ${value}`;
  }
  if (query.expectedAnswer.type === 'exists') {
    return `Expected existence: ${value}`;
  }
  if (query.expectedAnswer.type === 'contains' && Array.isArray(value)) {
    return `Expected to include: ${value.join(', ')}`;
  }
  return `Expected answer: ${String(value)}`;
}

function buildFacts(query: StructuralGroundTruthQuery): string[] {
  const value = query.expectedAnswer.value;
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return [String(value)];
}

function buildEvidenceRefs(queryId: string, facts: ASTFact[], repoRoot: string): EvidenceRef[] {
  return facts.map((fact, index) => ({
    refId: buildRefId(queryId, index),
    kind: 'file',
    label: `${fact.type}:${fact.identifier ?? 'unknown'}`,
    path: normalizeRepoRelativePath(repoRoot, fact.file),
    location: fact.line
      ? {
          startLine: fact.line,
          endLine: fact.line,
        }
      : undefined,
  }));
}

function buildRefId(queryId: string, index: number): string {
  const sanitized = queryId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `ev-${sanitized}-${index + 1}`;
}

function countEvidenceFiles(corpus: StructuralGroundTruthCorpus): number {
  const repoRoot = path.resolve(corpus.repoPath);
  const files = new Set<string>();
  for (const query of corpus.queries) {
    for (const fact of query.expectedAnswer.evidence ?? []) {
      const relative = normalizeRepoRelativePath(repoRoot, fact.file);
      if (typeof relative === 'string' && relative.length > 0) files.add(relative);
    }
  }
  return files.size;
}

function normalizeDate(input?: string): string {
  if (!input) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeRepoRelativePath(repoRoot: string, filePath?: string | null): string | undefined {
  if (!filePath) return undefined;
  const normalizedRepoRoot = path.resolve(repoRoot);
  const normalizedFilePath = path.resolve(filePath);
  const relative = path.relative(normalizedRepoRoot, normalizedFilePath);

  // If the path escapes the repo root, keep the original as a best-effort fallback.
  // This should be rare, but failing hard would make ground-truth unusable.
  const safeRelative = relative.startsWith('..') ? filePath : relative;
  return safeRelative.split(path.sep).join('/');
}
