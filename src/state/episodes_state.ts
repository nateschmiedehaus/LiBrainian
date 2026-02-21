import type { LiBrainianStorage } from '../storage/types.js';
import type { Episode, EpisodeEvent } from '../strategic/building_blocks.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

type EpisodeRecord = Omit<Episode, 'timestamp' | 'events'> & {
  timestamp: string;
  events: Array<Omit<EpisodeEvent, 'timestamp'> & { timestamp: string }>;
};

type EpisodeState = {
  schema_version: 1;
  updatedAt: string;
  items: EpisodeRecord[];
};

const EPISODES_KEY = 'librarian.episodes.v1';

export async function recordEpisode(
  storage: LiBrainianStorage,
  episode: Episode,
  options: { maxEpisodes?: number } = {}
): Promise<void> {
  const records = await loadEpisodeRecords(storage);
  const filtered = records.filter((item) => item.id !== episode.id);
  filtered.push(serializeEpisode(episode));
  const sorted = filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const maxEpisodes = options.maxEpisodes;
  const trimmed = maxEpisodes && sorted.length > maxEpisodes
    ? sorted.slice(sorted.length - maxEpisodes)
    : sorted;
  await writeEpisodeRecords(storage, trimmed);
}

export async function listEpisodes(storage: LiBrainianStorage): Promise<Episode[]> {
  const records = await loadEpisodeRecords(storage);
  return records.map((record) => hydrateEpisode(record));
}

export async function getEpisode(storage: LiBrainianStorage, id: string): Promise<Episode | null> {
  const records = await loadEpisodeRecords(storage);
  const record = records.find((item) => item.id === id);
  return record ? hydrateEpisode(record) : null;
}

function serializeEpisode(episode: Episode): EpisodeRecord {
  return {
    ...episode,
    timestamp: episode.timestamp.toISOString(),
    events: episode.events.map((event) => ({
      ...event,
      timestamp: event.timestamp.toISOString(),
    })),
  };
}

function hydrateEpisode(record: EpisodeRecord): Episode {
  return {
    ...record,
    timestamp: new Date(record.timestamp),
    events: record.events.map((event) => ({
      ...event,
      timestamp: new Date(event.timestamp),
    })),
  };
}

async function loadEpisodeRecords(storage: LiBrainianStorage): Promise<EpisodeRecord[]> {
  const raw = await storage.getState(EPISODES_KEY);
  if (!raw) return [];
  const parsed = safeJsonParseSimple<EpisodeState>(raw);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((item) => ({ ...item }));
}

async function writeEpisodeRecords(storage: LiBrainianStorage, items: EpisodeRecord[]): Promise<void> {
  const payload: EpisodeState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  await storage.setState(EPISODES_KEY, JSON.stringify(payload));
}
