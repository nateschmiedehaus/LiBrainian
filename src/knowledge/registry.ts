/**
 * @fileoverview Knowledge Object Registry
 *
 * Provides deterministic registration and retrieval of canonical knowledge
 * objects (RepoFacts, Maps, Claims, Packs, Episodes, Outcomes).
 */

import { randomUUID } from 'node:crypto';
import type { ContextPack } from '../types.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';

export type KnowledgeObjectKind = 'repo_fact' | 'map' | 'claim' | 'pack' | 'episode' | 'outcome';

export const REQUIRED_KNOWLEDGE_OBJECT_KINDS: KnowledgeObjectKind[] = [
  'repo_fact',
  'map',
  'claim',
  'pack',
  'episode',
  'outcome',
];

export type KnowledgeInvalidationTrigger =
  | 'file_change'
  | 'repo_change'
  | 'index_refresh'
  | 'time_elapsed'
  | 'evidence_update'
  | 'map_update'
  | 'claim_update'
  | 'pack_update'
  | 'external_signal';

export type KnowledgeInvalidationMode = 'invalidate' | 'immutable';

export interface KnowledgeInvalidationRule {
  id: string;
  description: string;
  mode: KnowledgeInvalidationMode;
  triggers?: KnowledgeInvalidationTrigger[];
}

export interface KnowledgeObjectBase {
  id: string;
  kind: KnowledgeObjectKind;
  createdAt: string;
  updatedAt?: string;
  source?: string;
}

export interface RepoFactObject extends KnowledgeObjectBase {
  kind: 'repo_fact';
  factType: string;
  data: Record<string, unknown>;
  evidenceIds?: string[];
}

export interface KnowledgeMapObject extends KnowledgeObjectBase {
  kind: 'map';
  mapType: string;
  entries: Record<string, unknown> | Array<Record<string, unknown>>;
  coverage?: {
    indexedFiles?: number;
    totalFiles?: number;
    notes?: string[];
  };
}

export interface KnowledgeClaimObject extends KnowledgeObjectBase {
  kind: 'claim';
  statement: string;
  subject: string;
  evidenceIds: string[];
  defeaterIds: string[];
  confidence?: ConfidenceValue;
}

export interface KnowledgePackObject extends KnowledgeObjectBase {
  kind: 'pack';
  pack: ContextPack;
}

export interface KnowledgeEpisodeObject extends KnowledgeObjectBase {
  kind: 'episode';
  episodeType: string;
  summary: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  outcomes?: string[];
}

export interface KnowledgeOutcomeObject extends KnowledgeObjectBase {
  kind: 'outcome';
  outcomeType: string;
  observation: string;
  result: 'success' | 'failure' | 'partial' | 'unknown';
}

export type KnowledgeObject =
  | RepoFactObject
  | KnowledgeMapObject
  | KnowledgeClaimObject
  | KnowledgePackObject
  | KnowledgeEpisodeObject
  | KnowledgeOutcomeObject;

export type KnowledgeObjectInput<T extends KnowledgeObjectBase> = Omit<T, 'id' | 'kind' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export interface KnowledgeObjectDefinition<T extends KnowledgeObjectBase> {
  kind: KnowledgeObjectKind;
  name: string;
  description: string;
  create: (input: KnowledgeObjectInput<T>) => T;
  invalidationRule: KnowledgeInvalidationRule;
}

const createObjectId = (prefix: string, id?: string): string => id ?? `${prefix}_${randomUUID()}`;
const nowIso = (): string => new Date().toISOString();

const REPO_FACT_INVALIDATION: KnowledgeInvalidationRule = {
  id: 'repo_fact_refresh',
  description: 'Refresh repo facts when repository manifests or ownership data change.',
  mode: 'invalidate',
  triggers: ['repo_change', 'file_change', 'time_elapsed'],
};

const MAP_INVALIDATION: KnowledgeInvalidationRule = {
  id: 'map_refresh',
  description: 'Invalidate maps when indexed files or graph inputs change.',
  mode: 'invalidate',
  triggers: ['file_change', 'index_refresh', 'repo_change'],
};

const CLAIM_INVALIDATION: KnowledgeInvalidationRule = {
  id: 'claim_refresh',
  description: 'Invalidate claims when supporting evidence or maps change.',
  mode: 'invalidate',
  triggers: ['evidence_update', 'map_update', 'time_elapsed'],
};

const PACK_INVALIDATION: KnowledgeInvalidationRule = {
  id: 'pack_refresh',
  description: 'Invalidate packs when upstream claims or maps change.',
  mode: 'invalidate',
  triggers: ['claim_update', 'map_update', 'time_elapsed'],
};

const EPISODE_INVALIDATION: KnowledgeInvalidationRule = {
  id: 'episode_immutable',
  description: 'Episodes are immutable historical records.',
  mode: 'immutable',
  triggers: [],
};

const OUTCOME_INVALIDATION: KnowledgeInvalidationRule = {
  id: 'outcome_immutable',
  description: 'Outcomes are immutable historical observations.',
  mode: 'immutable',
  triggers: [],
};

// Type for the heterogeneous array of definitions
type AnyKnowledgeObjectDefinition =
  | KnowledgeObjectDefinition<RepoFactObject>
  | KnowledgeObjectDefinition<KnowledgeMapObject>
  | KnowledgeObjectDefinition<KnowledgeClaimObject>
  | KnowledgeObjectDefinition<KnowledgePackObject>
  | KnowledgeObjectDefinition<KnowledgeEpisodeObject>
  | KnowledgeObjectDefinition<KnowledgeOutcomeObject>;

export const DEFAULT_KNOWLEDGE_OBJECT_DEFINITIONS: AnyKnowledgeObjectDefinition[] = [
  {
    kind: 'repo_fact',
    name: 'RepoFacts',
    description: 'Stable repository metadata such as runtimes, build/test commands, and owners.',
    create: (input: KnowledgeObjectInput<RepoFactObject>): RepoFactObject => ({
      id: createObjectId('rf', input.id),
      kind: 'repo_fact',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: input.updatedAt,
      source: input.source,
      factType: input.factType,
      data: input.data,
      evidenceIds: input.evidenceIds ?? [],
    }),
    invalidationRule: REPO_FACT_INVALIDATION,
  },
  {
    kind: 'map',
    name: 'Maps',
    description: 'Structured relationship maps such as dependency, call, or ownership maps.',
    create: (input: KnowledgeObjectInput<KnowledgeMapObject>): KnowledgeMapObject => ({
      id: createObjectId('map', input.id),
      kind: 'map',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: input.updatedAt,
      source: input.source,
      mapType: input.mapType,
      entries: input.entries,
      coverage: input.coverage,
    }),
    invalidationRule: MAP_INVALIDATION,
  },
  {
    kind: 'claim',
    name: 'Claims',
    description: 'Atomic propositions backed by evidence and defeaters.',
    create: (input: KnowledgeObjectInput<KnowledgeClaimObject>): KnowledgeClaimObject => ({
      id: createObjectId('cl', input.id),
      kind: 'claim',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: input.updatedAt,
      source: input.source,
      statement: input.statement,
      subject: input.subject,
      evidenceIds: input.evidenceIds ?? [],
      defeaterIds: input.defeaterIds ?? [],
      confidence: input.confidence,
    }),
    invalidationRule: CLAIM_INVALIDATION,
  },
  {
    kind: 'pack',
    name: 'Packs',
    description: 'Agent-delivery packs (context, task, or verification packs).',
    create: (input: KnowledgeObjectInput<KnowledgePackObject>): KnowledgePackObject => ({
      id: createObjectId('pk', input.id ?? input.pack.packId),
      kind: 'pack',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: input.updatedAt,
      source: input.source,
      pack: input.pack,
    }),
    invalidationRule: PACK_INVALIDATION,
  },
  {
    kind: 'episode',
    name: 'Episodes',
    description: 'Historical execution episodes for calibration and replay.',
    create: (input: KnowledgeObjectInput<KnowledgeEpisodeObject>): KnowledgeEpisodeObject => ({
      id: createObjectId('ep', input.id),
      kind: 'episode',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: input.updatedAt,
      source: input.source,
      episodeType: input.episodeType,
      summary: input.summary,
      inputs: input.inputs,
      outputs: input.outputs,
      outcomes: input.outcomes ?? [],
    }),
    invalidationRule: EPISODE_INVALIDATION,
  },
  {
    kind: 'outcome',
    name: 'Outcomes',
    description: 'Observed outcomes for claims or episodes.',
    create: (input: KnowledgeObjectInput<KnowledgeOutcomeObject>): KnowledgeOutcomeObject => ({
      id: createObjectId('oc', input.id),
      kind: 'outcome',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: input.updatedAt,
      source: input.source,
      outcomeType: input.outcomeType,
      observation: input.observation,
      result: input.result,
    }),
    invalidationRule: OUTCOME_INVALIDATION,
  },
];

export class KnowledgeObjectRegistry {
  private definitions = new Map<KnowledgeObjectKind, KnowledgeObjectDefinition<KnowledgeObjectBase>>();
  private objectsByKind = new Map<KnowledgeObjectKind, Map<string, KnowledgeObjectBase>>();
  private objectIds = new Set<string>();

  registerDefinition(definition: KnowledgeObjectDefinition<KnowledgeObjectBase>): void {
    if (this.definitions.has(definition.kind)) {
      throw new Error(`unverified_by_trace(knowledge_object_definition_duplicate): ${definition.kind}`);
    }
    this.definitions.set(definition.kind, definition);
    if (!this.objectsByKind.has(definition.kind)) {
      this.objectsByKind.set(definition.kind, new Map());
    }
  }

  registerDefinitions(definitions: AnyKnowledgeObjectDefinition[]): void {
    for (const definition of definitions) {
      // Safe cast: the union type AnyKnowledgeObjectDefinition is structurally compatible
      // with KnowledgeObjectDefinition<KnowledgeObjectBase> at runtime
      this.registerDefinition(definition as unknown as KnowledgeObjectDefinition<KnowledgeObjectBase>);
    }
  }

  getDefinition(kind: KnowledgeObjectKind): KnowledgeObjectDefinition<KnowledgeObjectBase> | null {
    return this.definitions.get(kind) ?? null;
  }

  getDefinitionOrThrow(kind: KnowledgeObjectKind): KnowledgeObjectDefinition<KnowledgeObjectBase> {
    const definition = this.getDefinition(kind);
    if (!definition) {
      throw new Error(`unverified_by_trace(knowledge_object_definition_missing): ${kind}`);
    }
    return definition;
  }

  listDefinitions(): KnowledgeObjectDefinition<KnowledgeObjectBase>[] {
    return Array.from(this.definitions.values());
  }

  create<T extends KnowledgeObjectBase>(kind: KnowledgeObjectKind, input: KnowledgeObjectInput<T>): T {
    const definition = this.getDefinitionOrThrow(kind);
    const object = definition.create(input as KnowledgeObjectInput<KnowledgeObjectBase>) as T;
    this.register(object as KnowledgeObjectBase);
    return object;
  }

  register(object: KnowledgeObjectBase): void {
    if (!this.definitions.has(object.kind)) {
      throw new Error(`unverified_by_trace(knowledge_object_definition_missing): ${object.kind}`);
    }
    if (this.objectIds.has(object.id)) {
      throw new Error(`unverified_by_trace(knowledge_object_duplicate): ${object.id}`);
    }
    const bucket = this.objectsByKind.get(object.kind);
    if (!bucket) {
      throw new Error(`unverified_by_trace(knowledge_object_bucket_missing): ${object.kind}`);
    }
    bucket.set(object.id, object);
    this.objectIds.add(object.id);
  }

  get<T extends KnowledgeObjectBase>(kind: KnowledgeObjectKind, id: string): T | null {
    const bucket = this.objectsByKind.get(kind);
    if (!bucket) return null;
    return (bucket.get(id) as T | undefined) ?? null;
  }

  list<T extends KnowledgeObjectBase>(kind?: KnowledgeObjectKind): T[] {
    if (kind) {
      const bucket = this.objectsByKind.get(kind);
      return bucket ? (Array.from(bucket.values()) as T[]) : [];
    }
    const results: T[] = [];
    for (const bucket of this.objectsByKind.values()) {
      results.push(...(Array.from(bucket.values()) as T[]));
    }
    return results;
  }

  size(kind?: KnowledgeObjectKind): number {
    if (kind) {
      return this.objectsByKind.get(kind)?.size ?? 0;
    }
    let total = 0;
    for (const bucket of this.objectsByKind.values()) {
      total += bucket.size;
    }
    return total;
  }
}

export function createKnowledgeObjectRegistry(
  definitions: AnyKnowledgeObjectDefinition[] = DEFAULT_KNOWLEDGE_OBJECT_DEFINITIONS
): KnowledgeObjectRegistry {
  const registry = new KnowledgeObjectRegistry();
  registry.registerDefinitions(definitions);
  return registry;
}
