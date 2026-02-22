import { sha256Hex } from '../../spine/hashes.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { ContextPack, LibrarianVersion } from '../../types.js';
import { ConstructionError } from '../base/construction_base.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';

const DEFAULT_MIN_CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_MAX_PACKS_PER_SESSION = 100;

export interface SessionHarvestClaim {
  readonly intentType: string;
  readonly scope: string;
  readonly confidence: number;
  readonly summary: string;
  readonly keyFacts: string[];
  readonly relatedFiles: string[];
}

export interface SessionKnowledgeHarvestInput {
  readonly sessionId: string;
  readonly claims: SessionHarvestClaim[];
}

export interface SessionKnowledgeHarvestOutput {
  readonly kind: 'SessionKnowledgeHarvestResult.v1';
  readonly claimsAnalyzed: number;
  readonly newPacksSeeded: string[];
}

export interface SessionKnowledgeHarvestOptions {
  readonly minConfidenceThreshold?: number;
  readonly maxPacksPerSession?: number;
  readonly packType?: ContextPack['packType'];
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function createSeededPackVersion(now: Date): LibrarianVersion {
  return {
    major: 0,
    minor: 0,
    patch: 0,
    string: '0.0.0',
    qualityTier: 'full',
    indexedAt: now,
    indexerVersion: 'seeded_from_construction',
    features: ['session_knowledge_harvest'],
  };
}

function createSeededPack(
  claim: SessionHarvestClaim,
  sessionId: string,
  packType: ContextPack['packType']
): ContextPack {
  const now = new Date();
  const targetId = `${claim.intentType}:${claim.scope}`;
  const packId = `seeded_${sha256Hex(`${sessionId}:${targetId}:${claim.summary}`).slice(0, 24)}`;
  const invalidationTriggers = claim.relatedFiles.length > 0 ? claim.relatedFiles : [claim.scope];
  const tokenEstimate = estimateTokens([claim.summary, ...claim.keyFacts].join('\n'));

  return {
    packId,
    packType,
    targetId,
    intentType: claim.intentType,
    scope: claim.scope,
    provenance: 'seeded_from_construction',
    tokenEstimate,
    sourceConstructionId: 'SessionKnowledgeHarvest',
    sessionId,
    schemaVersion: 1,
    summary: claim.summary,
    keyFacts: [...claim.keyFacts],
    codeSnippets: [],
    relatedFiles: [...claim.relatedFiles],
    confidence: claim.confidence,
    createdAt: now,
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: createSeededPackVersion(now),
    invalidationTriggers,
  };
}

export function createSessionKnowledgeHarvestConstruction(
  storage: LiBrainianStorage,
  options: SessionKnowledgeHarvestOptions = {}
): Construction<SessionKnowledgeHarvestInput, SessionKnowledgeHarvestOutput, ConstructionError, unknown> {
  const threshold = options.minConfidenceThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const maxPacksPerSession = Math.max(1, options.maxPacksPerSession ?? DEFAULT_MAX_PACKS_PER_SESSION);
  const packType = options.packType ?? 'pattern_context';

  return {
    id: 'SessionKnowledgeHarvest',
    name: 'Session Knowledge Harvest',
    description: 'Seeds context packs from high-confidence claims at the end of a session.',
    async execute(input: SessionKnowledgeHarvestInput) {
      const dedupe = new Set<string>();
      const newPacksSeeded: string[] = [];

      const sortedClaims = [...input.claims]
        .sort((a, b) => b.confidence - a.confidence);

      for (const claim of sortedClaims) {
        if (claim.confidence < threshold) {
          continue;
        }
        if (newPacksSeeded.length >= maxPacksPerSession) {
          break;
        }

        const dedupeKey = `${claim.intentType}:${claim.scope}`;
        if (dedupe.has(dedupeKey)) {
          continue;
        }
        dedupe.add(dedupeKey);

        const existing = await storage.findByIntentAndScope(claim.intentType, claim.scope, { limit: 1 });
        if (existing.length > 0) {
          continue;
        }

        const pack = createSeededPack(claim, input.sessionId, packType);
        await storage.upsertContextPack(pack);
        newPacksSeeded.push(pack.packId);
      }

      return ok<SessionKnowledgeHarvestOutput, ConstructionError>({
        kind: 'SessionKnowledgeHarvestResult.v1',
        claimsAnalyzed: input.claims.length,
        newPacksSeeded,
      });
    },
  };
}
