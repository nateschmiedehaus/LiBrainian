/**
 * @fileoverview EvalRunner pipeline backed by Librarian itself.
 *
 * Used for machine-verifiable retrieval evaluation on real repos without relying
 * on LLM synthesis (fail-closed: LLM disabled by default).
 */

import path from 'node:path';
import type { EvalPipeline, EvalQueryInput, RetrievalResult } from './runner.js';
import { ensureLibrarianReady, resetGate } from '../integration/first_run_gate.js';
import type { LibrarianResponse, LlmRequirement, EmbeddingRequirement } from '../types.js';

export interface LibrarianEvalPipelineOptions {
  /**
   * Maximum number of docs returned per query (EvalRunner k-values top out at 10).
   */
  maxDocs?: number;
  /**
   * Query depth used when calling Librarian.
   */
  depth?: 'L0' | 'L1' | 'L2' | 'L3';
  /**
   * LLM requirement for the query. Default: disabled.
   */
  llmRequirement?: LlmRequirement;
  /**
   * Embedding requirement for the query. Default: optional.
   */
  embeddingRequirement?: EmbeddingRequirement;
  /**
   * Force-disable all LLM usage (including bootstrap enrichment). Default: true.
   */
  skipLlm?: boolean;
  /**
   * Allow degraded bootstrap when embeddings are unavailable. Default: true.
   */
  allowDegradedEmbeddings?: boolean;
  /**
   * Maximum number of open Librarian sessions kept in memory.
   */
  maxOpenWorkspaces?: number;
}

type WorkspaceHandle = {
  workspaceRoot: string;
  lastUsedAt: number;
};

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizeRepoRelativePath(repoRoot: string, candidate: string): string {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedCandidate = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..')) {
    // Best-effort fallback: return original string normalized.
    return toPosix(candidate);
  }
  return toPosix(relative);
}

function collectCandidateFiles(repoRoot: string, response: LibrarianResponse): Map<string, number> {
  const scored = new Map<string, number>();
  const bump = (filePath: string, score: number): void => {
    const normalized = normalizeRepoRelativePath(repoRoot, filePath);
    const prev = scored.get(normalized) ?? 0;
    if (score > prev) scored.set(normalized, score);
  };

  for (const pack of response.packs ?? []) {
    const packScore = typeof pack.confidence === 'number' ? pack.confidence : 0;
    for (const file of pack.relatedFiles ?? []) {
      bump(file, packScore * 0.8);
    }
    for (const snippet of pack.codeSnippets ?? []) {
      bump(snippet.filePath, packScore);
    }
  }

  return scored;
}

async function evictLeastRecentlyUsed(
  handles: Map<string, WorkspaceHandle>,
  maxOpen: number
): Promise<void> {
  if (handles.size <= maxOpen) return;
  const sorted = [...handles.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const toEvict = sorted.slice(0, Math.max(0, handles.size - maxOpen));
  for (const handle of toEvict) {
    await resetGate(handle.workspaceRoot).catch(() => {});
    handles.delete(handle.workspaceRoot);
  }
}

export function createLibrarianEvalPipeline(
  options: LibrarianEvalPipelineOptions = {}
): { pipeline: EvalPipeline; shutdown: () => Promise<void> } {
  const maxDocs = options.maxDocs ?? 12;
  const depth = options.depth ?? 'L1';
  const llmRequirement = options.llmRequirement ?? 'disabled';
  const embeddingRequirement = options.embeddingRequirement ?? 'optional';
  const skipLlm = options.skipLlm ?? true;
  const allowDegradedEmbeddings = options.allowDegradedEmbeddings ?? true;
  const maxOpenWorkspaces = options.maxOpenWorkspaces ?? 2;

  const handles = new Map<string, WorkspaceHandle>();

  const pipeline: EvalPipeline = {
    retrieve: async (input: EvalQueryInput): Promise<RetrievalResult> => {
      const start = Date.now();
      const workspaceKey = path.resolve(input.repoRoot);

      // Ensure stable workspace handling for evaluation: don't auto-detect parent roots.
      const originalAutodetect = process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT;
      process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT = '1';

      try {
        const gate = await ensureLibrarianReady(input.repoRoot, {
          allowDegradedEmbeddings,
          skipLlm,
          throwOnFailure: true,
          timeoutMs: 0,
        });

        const librarian = gate.librarian;
        if (!librarian) {
          throw new Error('unverified_by_trace(initialization_failed): librarian unavailable');
        }

        handles.set(workspaceKey, { workspaceRoot: workspaceKey, lastUsedAt: Date.now() });
        await evictLeastRecentlyUsed(handles, maxOpenWorkspaces);

        const response = await librarian.queryOptional({
          intent: input.query.intent,
          depth,
          llmRequirement,
          embeddingRequirement,
          deterministic: true,
          includeEngines: false,
        });

        const candidates = collectCandidateFiles(workspaceKey, response);
        const sorted = [...candidates.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([file]) => file);
        const docs = sorted.slice(0, Math.max(1, maxDocs));

        return { docs, latencyMs: Date.now() - start };
      } finally {
        if (originalAutodetect === undefined) {
          delete process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT;
        } else {
          process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT = originalAutodetect;
        }
      }
    },
  };

  const shutdown = async (): Promise<void> => {
    const uniqueRoots = [...handles.keys()];
    for (const root of uniqueRoots) {
      await resetGate(root).catch(() => {});
    }
    handles.clear();
  };

  return { pipeline, shutdown };
}
