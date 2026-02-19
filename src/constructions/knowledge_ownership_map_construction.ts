/**
 * @fileoverview Knowledge Ownership Map Construction
 *
 * Builds a code ownership map from existing storage capabilities.
 *
 * Data source order:
 * 1) Knowledge graph `authored_by` edges
 * 2) Ownership storage (`getOwnerships`) fallback
 */

import type { Librarian } from '../api/librarian.js';
import { getOwnershipMap, type OwnershipMapResult } from '../graphs/knowledge_graph.js';
import type { FileOwnership, LibrarianStorage } from '../storage/types.js';

const DEFAULT_MIN_OWNERSHIP = 0.1;

type OwnershipEntity = OwnershipMapResult['entities'][number];
type AuthorSummary = OwnershipMapResult['authorSummary'];

export interface KnowledgeOwnershipMapOptions {
  /**
   * Optional file/directory filter. Accepts relative file paths or directory prefixes.
   * Examples: `src/api` or `src/api/server.ts`.
   */
  path?: string;
  /**
   * Minimum ownership threshold (0-1).
   * Used to filter contributors in each entity.
   */
  minOwnership?: number;
}

export interface KnowledgeOwnershipMapResult extends OwnershipMapResult {
  options: {
    path?: string;
    minOwnership: number;
  };
  source: 'knowledge_graph' | 'ownership_storage' | 'none';
  missingStorage: boolean;
}

export class KnowledgeOwnershipMapConstruction {
  static readonly CONSTRUCTION_ID = 'KnowledgeOwnershipMapConstruction';

  constructor(private readonly librarian: Librarian) {}

  async construct(
    options: KnowledgeOwnershipMapOptions = {}
  ): Promise<KnowledgeOwnershipMapResult> {
    const minOwnership = normalizeMinOwnership(options.minOwnership);
    const pathFilter = normalizePathForMatch(options.path);
    const storage = this.getStorage();

    if (!storage) {
      return createResult([], {
        path: options.path,
        minOwnership,
      }, 'none', true);
    }

    const graphMap = await getOwnershipMap(storage, { minOwnership });
    const graphEntities = filterEntitiesByPath(graphMap.entities, pathFilter);
    if (graphEntities.length > 0) {
      return createResult(
        graphEntities,
        {
          path: options.path,
          minOwnership,
        },
        'knowledge_graph',
        false
      );
    }

    const ownershipRecords = await storage.getOwnerships({ minScore: minOwnership });
    const fallbackEntities = buildEntitiesFromOwnershipRecords(
      ownershipRecords,
      pathFilter,
      minOwnership
    );

    return createResult(
      fallbackEntities,
      {
        path: options.path,
        minOwnership,
      },
      fallbackEntities.length > 0 ? 'ownership_storage' : 'none',
      false
    );
  }

  private getStorage(): LibrarianStorage | null {
    const maybeGetStorage = (this.librarian as { getStorage?: () => LibrarianStorage | null }).getStorage;
    return typeof maybeGetStorage === 'function'
      ? maybeGetStorage.call(this.librarian)
      : null;
  }
}

function createResult(
  entities: OwnershipEntity[],
  options: KnowledgeOwnershipMapResult['options'],
  source: KnowledgeOwnershipMapResult['source'],
  missingStorage: boolean
): KnowledgeOwnershipMapResult {
  return {
    entities,
    authorSummary: buildAuthorSummary(entities),
    options,
    source,
    missingStorage,
  };
}

function normalizeMinOwnership(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_MIN_OWNERSHIP;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizePathForMatch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || undefined;
}

function matchesPathFilter(entityPath: string, pathFilter?: string): boolean {
  if (!pathFilter) return true;

  const normalizedEntity = normalizePathForMatch(entityPath);
  if (!normalizedEntity) return false;

  return normalizedEntity === pathFilter || normalizedEntity.startsWith(`${pathFilter}/`);
}

function filterEntitiesByPath(entities: OwnershipEntity[], pathFilter?: string): OwnershipEntity[] {
  return entities.filter((entity) => matchesPathFilter(entity.entityId, pathFilter));
}

function buildEntitiesFromOwnershipRecords(
  ownershipRecords: FileOwnership[],
  pathFilter: string | undefined,
  minOwnership: number
): OwnershipEntity[] {
  const byFile = new Map<string, FileOwnership[]>();

  for (const record of ownershipRecords) {
    if (!matchesPathFilter(record.filePath, pathFilter)) {
      continue;
    }

    if (!byFile.has(record.filePath)) {
      byFile.set(record.filePath, []);
    }
    byFile.get(record.filePath)!.push(record);
  }

  const entities: OwnershipEntity[] = [];
  for (const [filePath, records] of byFile.entries()) {
    const sorted = [...records].sort((a, b) => b.score - a.score);
    const primary = sorted[0];
    if (!primary) continue;

    entities.push({
      entityId: filePath,
      entityType: 'file',
      primaryAuthor: primary.author,
      ownership: primary.score,
      contributors: sorted
        .filter((record) => record.score >= minOwnership)
        .map((record) => ({
          author: record.author,
          percentage: record.score,
        })),
    });
  }

  return entities.sort((a, b) => a.entityId.localeCompare(b.entityId));
}

function buildAuthorSummary(entities: OwnershipEntity[]): AuthorSummary {
  const summary: AuthorSummary = {};

  for (const entity of entities) {
    for (const contributor of entity.contributors) {
      if (!summary[contributor.author]) {
        summary[contributor.author] = {
          totalEntities: 0,
          totalLines: 0,
          primaryOwner: [],
        };
      }

      summary[contributor.author].totalEntities += 1;
      if (contributor.author === entity.primaryAuthor) {
        summary[contributor.author].primaryOwner.push(entity.entityId);
      }
    }
  }

  return summary;
}
