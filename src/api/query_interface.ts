import type { LiBrainianQuery, LiBrainianResponse, ContextPack } from '../types.js';
import type { EmbeddableEntityType } from '../storage/types.js';

export interface SimilarMatch {
  entityId: string;
  entityType: EmbeddableEntityType;
  similarity: number;
}

export interface SearchResult {
  packId: string;
  packType: string;
  summary: string;
  confidence: number;
  relatedFiles: string[];
}

export interface SearchOptions {
  limit?: number;
}

export interface QueryInterface {
  queryIntent(intent: string): Promise<LiBrainianResponse>;
  queryFile(path: string): Promise<LiBrainianResponse>;
  queryFunction(name: string, file: string): Promise<LiBrainianResponse>;
  querySimilar(snippet: string, limit?: number): Promise<SimilarMatch[]>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export interface QueryRunner {
  query: (query: LiBrainianQuery) => Promise<LiBrainianResponse>;
  searchSimilar?: (snippet: string, limit?: number) => Promise<SimilarMatch[]>;
}

function packsToSearchResults(packs: ContextPack[], limit?: number): SearchResult[] {
  const results = packs.map((pack) => ({
    packId: pack.packId,
    packType: pack.packType,
    summary: pack.summary,
    confidence: pack.confidence,
    relatedFiles: pack.relatedFiles,
  }));
  return typeof limit === 'number' ? results.slice(0, Math.max(1, limit)) : results;
}

export function createQueryInterface(runner: QueryRunner): QueryInterface {
  return {
    queryIntent: (intent: string) => runner.query({ intent, depth: 'L1' }),
    queryFile: (path: string) => runner.query({ intent: `Explain ${path}`, affectedFiles: [path], depth: 'L1' }),
    queryFunction: (name: string, file: string) => runner.query({ intent: `How does ${name} work?`, affectedFiles: [file], depth: 'L1' }),
    querySimilar: async (snippet: string, limit?: number) => {
      if (runner.searchSimilar) return runner.searchSimilar(snippet, limit);
      const response = await runner.query({ intent: `Find similar code to: ${snippet}`, depth: 'L1' });
      return packsToSearchResults(response.packs, limit).map((pack) => ({
        entityId: pack.packId,
        entityType: pack.packType === 'function_context' ? 'function' : 'module',
        similarity: pack.confidence,
      }));
    },
    search: async (query: string, options?: SearchOptions) => {
      const response = await runner.query({ intent: query, depth: 'L1' });
      return packsToSearchResults(response.packs, options?.limit);
    },
  };
}
