import { randomUUID } from 'node:crypto';
import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack, LiBrainianQuery, LiBrainianResponse } from '../types.js';
import type { Episode } from '../strategic/building_blocks.js';
import type { EpisodeEvent, EpisodeOutcome } from '../strategic/building_blocks.js';
import { createEpisode } from '../strategic/episodes.js';
import { recordEpisode } from '../state/episodes_state.js';

export interface QueryEpisodeInput {
  query: LiBrainianQuery;
  response?: LiBrainianResponse;
  error?: string;
  timestamp?: Date;
  durationMs?: number;
  episodeId?: string;
}

export function buildQueryEpisode(input: QueryEpisodeInput): Episode | null {
  const intent = (input.query.intent ?? '').trim();
  if (!intent) return null;

  const response = input.response;
  const duration = input.durationMs ?? response?.latencyMs ?? 0;
  const eventTimestamp = input.timestamp ?? new Date();
  const outcome: EpisodeOutcome = {
    success: !input.error,
    result: response ? summarizeResponse(response) : undefined,
    error: input.error,
    duration,
  };

  const events: EpisodeEvent[] = [
    {
      order: 1,
      timestamp: eventTimestamp,
      type: input.error ? 'query_failed' : 'query_completed',
      description: input.error ? 'Query failed' : 'Query completed',
      data: response ? summarizeEvent(response) : { error: input.error },
    },
  ];

  const relatedFiles = collectRelatedFiles(input.query, response?.packs);

  return createEpisode({
    id: input.episodeId ?? `ep_${randomUUID()}`,
    timestamp: eventTimestamp,
    type: 'discovery',
    context: {
      environment: 'librainian.query',
      state: {
        intent,
        depth: input.query.depth,
        taskType: input.query.taskType,
        affectedFiles: input.query.affectedFiles ?? [],
        ucRequirements: input.query.ucRequirements,
        minConfidence: input.query.minConfidence,
      },
    },
    outcome,
    events,
    metadata: {
      feedbackToken: response?.feedbackToken,
      version: response?.version?.string,
      cacheHit: response?.cacheHit,
      relatedFiles,
      adequacy: response?.adequacy
        ? {
            specId: response.adequacy.spec.id,
            blocking: response.adequacy.blocking,
            missingEvidence: response.adequacy.missingEvidence.map((req) => req.id),
            difficulties: response.adequacy.difficulties.map((finding) => finding.detectorId),
          }
        : undefined,
    },
  });
}

export async function recordQueryEpisode(storage: LiBrainianStorage, input: QueryEpisodeInput): Promise<Episode | null> {
  const episode = buildQueryEpisode(input);
  if (!episode) return null;
  await recordEpisode(storage, episode);
  return episode;
}

function summarizeResponse(response: LiBrainianResponse): Record<string, unknown> {
  return {
    packCount: response.packs.length,
    totalConfidence: response.totalConfidence,
    synthesisConfidence: response.synthesis?.confidence ?? null,
    cacheHit: response.cacheHit,
    latencyMs: response.latencyMs,
    coverageGaps: response.coverageGaps ?? [],
    adequacyBlocking: response.adequacy?.blocking ?? false,
  };
}

function summarizeEvent(response: LiBrainianResponse): Record<string, unknown> {
  return {
    packCount: response.packs.length,
    totalConfidence: response.totalConfidence,
    cacheHit: response.cacheHit,
    adequacyBlocking: response.adequacy?.blocking ?? false,
  };
}

function collectRelatedFiles(query: LiBrainianQuery, packs?: ContextPack[]): string[] {
  const files = new Set<string>();
  for (const file of query.affectedFiles ?? []) {
    if (file) files.add(file);
  }
  for (const pack of packs ?? []) {
    for (const file of pack.relatedFiles ?? []) {
      if (file) files.add(file);
    }
  }
  return Array.from(files).sort();
}
