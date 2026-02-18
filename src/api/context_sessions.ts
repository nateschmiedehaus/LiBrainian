import { randomUUID } from 'node:crypto';
import type { LibrarianQuery, LibrarianResponse, ContextPack } from '../types.js';

const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_PACKS_PER_SESSION = 200;
const MAX_QUESTION_LENGTH = 500;

export interface ContextSession {
  sessionId: string;
  initialQuery: LibrarianQuery;
  context: AccumulatedContext;
  history: ConversationTurn[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

export interface ConversationTurn {
  id: string;
  type: 'start' | 'follow_up' | 'drill_down' | 'summary';
  question?: string;
  response?: string;
  packIds: string[];
  createdAt: string;
}

export interface QAPair {
  question: string;
  answer: string;
  packIds: string[];
  timestamp: string;
}

export interface FocusArea {
  type: 'intent' | 'entity';
  id: string;
  label?: string;
}

export interface AccumulatedContext {
  packs: ContextPack[];
  exploredEntities: string[];
  qaHistory: QAPair[];
  focusArea?: FocusArea;
}

export interface FollowUpResponse {
  answer: string;
  newPacks: ContextPack[];
  suggestedFollowUps: string[];
  drillDownSuggestions: string[];
  session: ContextSession;
}

export interface DrillDownResponse {
  entityId: string;
  answer: string;
  newPacks: ContextPack[];
  suggestedFollowUps: string[];
  session: ContextSession;
}

export interface ContextSummary {
  summary: string;
  keyFacts: string[];
  packCount: number;
  exploredEntities: string[];
  lastUpdatedAt: string;
}

export interface ContextAssemblySession {
  start(query: LibrarianQuery): Promise<ContextSession>;
  followUp(sessionId: string, question: string): Promise<FollowUpResponse>;
  drillDown(sessionId: string, entityId: string): Promise<DrillDownResponse>;
  summarize(sessionId: string): Promise<ContextSummary>;
  close(sessionId: string): Promise<void>;
  restore(session: ContextSession): ContextSession;
  snapshot(sessionId: string): ContextSession;
}

export interface ContextAssemblySessionOptions {
  query: (query: LibrarianQuery) => Promise<LibrarianResponse>;
  now?: () => string;
  maxSessions?: number;
  sessionTtlMs?: number;
  maxPacksPerSession?: number;
}

interface SessionState {
  session: ContextSession;
  packIndex: Map<string, ContextPack>;
}

export class ContextAssemblySessionManager implements ContextAssemblySession {
  private queryRunner: (query: LibrarianQuery) => Promise<LibrarianResponse>;
  private now: () => string;
  private maxSessions: number;
  private sessionTtlMs: number;
  private maxPacksPerSession: number;
  private sessions = new Map<string, SessionState>();
  private sessionLocks = new Map<string, Promise<void>>();
  private startLock = Promise.resolve();
  private pendingStarts = 0;

  constructor(options: ContextAssemblySessionOptions) {
    this.queryRunner = options.query;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.maxPacksPerSession = options.maxPacksPerSession ?? DEFAULT_MAX_PACKS_PER_SESSION;
  }

  async start(query: LibrarianQuery): Promise<ContextSession> {
    await this.withStartLock(() => {
      this.pruneExpired();
      this.pruneOverflow();
      if (this.sessions.size + this.pendingStarts >= this.maxSessions) {
        throw new Error('unverified_by_trace(context_session_limit_exceeded)');
      }
      this.pendingStarts += 1;
    });

    let pendingReleased = false;
    try {
      const response = await this.queryRunner(query);
      const createdAt = this.now();
      const packIndex = buildPackIndex(response.packs);
      if (packIndex.size > this.maxPacksPerSession) {
        throw new Error('unverified_by_trace(context_session_pack_limit_exceeded)');
      }
      const answer = extractAnswer(response);
      const packIds = response.packs.map((pack) => pack.packId);
      const session: ContextSession = {
        sessionId: `sess_${randomUUID()}`,
        initialQuery: query,
        context: {
          packs: Array.from(packIndex.values()),
          exploredEntities: [],
          qaHistory: [{
            question: query.intent,
            answer,
            packIds,
            timestamp: createdAt,
          }],
          focusArea: { type: 'intent', id: query.intent },
        },
        history: [{
          id: `turn_${randomUUID()}`,
          type: 'start',
          question: query.intent,
          response: answer,
          packIds,
          createdAt,
        }],
        createdAt,
        updatedAt: createdAt,
        lastAccessedAt: createdAt,
      };
      await this.withStartLock(() => {
        this.sessions.set(session.sessionId, { session, packIndex });
        this.pruneOverflow();
        this.pendingStarts = Math.max(0, this.pendingStarts - 1);
        pendingReleased = true;
      });
      return session;
    } finally {
      if (!pendingReleased) {
        await this.withStartLock(() => {
          this.pendingStarts = Math.max(0, this.pendingStarts - 1);
        });
      }
    }
  }

  async followUp(sessionId: string, question: string): Promise<FollowUpResponse> {
    return this.withSessionLock(sessionId, async () => {
      this.pruneExpired();
      const state = this.getSession(sessionId);
      const trimmed = question.trim();
      if (!trimmed || trimmed.length > MAX_QUESTION_LENGTH) {
        throw new Error('unverified_by_trace(context_session_question_invalid)');
      }
      const followUpQuery = buildFollowUpQuery(state.session, trimmed);
      const response = await this.queryRunner(followUpQuery);
      const answer = extractAnswer(response);
      const timestamp = this.now();
      const update = mergePackIndex(state.packIndex, response.packs);
      if (update.packs.length > this.maxPacksPerSession) {
        throw new Error('unverified_by_trace(context_session_pack_limit_exceeded)');
      }
      const nextQaHistory = [...state.session.context.qaHistory, {
        question: trimmed,
        answer,
        packIds: response.packs.map((pack) => pack.packId),
        timestamp,
      }];
      const nextHistory: ConversationTurn[] = [...state.session.history, {
        id: `turn_${randomUUID()}`,
        type: 'follow_up',
        question: trimmed,
        response: answer,
        packIds: response.packs.map((pack) => pack.packId),
        createdAt: timestamp,
      }];
      const nextSession: ContextSession = {
        ...state.session,
        context: {
          packs: update.packs,
          exploredEntities: [...state.session.context.exploredEntities],
          qaHistory: nextQaHistory,
          focusArea: state.session.context.focusArea
            ? { ...state.session.context.focusArea }
            : undefined,
        },
        history: nextHistory,
        updatedAt: timestamp,
        lastAccessedAt: timestamp,
      };
      state.session = nextSession;
      state.packIndex = update.packIndex;

      return {
        answer,
        newPacks: update.newPacks,
        suggestedFollowUps: response.drillDownHints ?? [],
        drillDownSuggestions: suggestDrillDowns(response.packs, state.session.context.exploredEntities),
        session: state.session,
      };
    });
  }

  async drillDown(sessionId: string, entityId: string): Promise<DrillDownResponse> {
    return this.withSessionLock(sessionId, async () => {
      this.pruneExpired();
      const state = this.getSession(sessionId);
      const trimmed = entityId.trim();
      if (!trimmed || trimmed.length > MAX_QUESTION_LENGTH) {
        throw new Error('unverified_by_trace(context_session_entity_invalid)');
      }
      const drillQuery = buildDrillDownQuery(state.session, trimmed);
      const response = await this.queryRunner(drillQuery);
      const answer = extractAnswer(response);
      const timestamp = this.now();
      const update = mergePackIndex(state.packIndex, response.packs);
      if (update.packs.length > this.maxPacksPerSession) {
        throw new Error('unverified_by_trace(context_session_pack_limit_exceeded)');
      }
      const exploredEntities = state.session.context.exploredEntities.includes(trimmed)
        ? [...state.session.context.exploredEntities]
        : [...state.session.context.exploredEntities, trimmed];
      const nextHistory: ConversationTurn[] = [...state.session.history, {
        id: `turn_${randomUUID()}`,
        type: 'drill_down',
        question: trimmed,
        response: answer,
        packIds: response.packs.map((pack) => pack.packId),
        createdAt: timestamp,
      }];
      const nextSession: ContextSession = {
        ...state.session,
        context: {
          packs: update.packs,
          exploredEntities,
          qaHistory: [...state.session.context.qaHistory],
          focusArea: { type: 'entity', id: trimmed },
        },
        history: nextHistory,
        updatedAt: timestamp,
        lastAccessedAt: timestamp,
      };
      state.session = nextSession;
      state.packIndex = update.packIndex;

      return {
        entityId: trimmed,
        answer,
        newPacks: update.newPacks,
        suggestedFollowUps: response.drillDownHints ?? [],
        session: state.session,
      };
    });
  }

  async summarize(sessionId: string): Promise<ContextSummary> {
    return this.withSessionLock(sessionId, async () => {
      this.pruneExpired();
      const state = this.getSession(sessionId);
      const keyFacts = collectKeyFacts(state.session.context.packs);
      const summary = buildSummary(state.session, keyFacts);
      const timestamp = this.now();
      const nextHistory: ConversationTurn[] = [...state.session.history, {
        id: `turn_${randomUUID()}`,
        type: 'summary',
        response: summary,
        packIds: state.session.context.packs.map((pack) => pack.packId),
        createdAt: timestamp,
      }];
      state.session = {
        ...state.session,
        history: nextHistory,
        updatedAt: timestamp,
        lastAccessedAt: timestamp,
      };

      return {
        summary,
        keyFacts,
        packCount: state.session.context.packs.length,
        exploredEntities: [...state.session.context.exploredEntities],
        lastUpdatedAt: state.session.updatedAt,
      };
    });
  }

  async close(sessionId: string): Promise<void> {
    return this.withSessionLock(sessionId, async () => {
      this.sessions.delete(sessionId);
      this.sessionLocks.delete(sessionId);
    });
  }

  restore(session: ContextSession): ContextSession {
    this.pruneExpired();
    const cloned = structuredClone(session);
    const packIndex = buildPackIndex(cloned.context.packs);
    if (packIndex.size > this.maxPacksPerSession) {
      throw new Error('unverified_by_trace(context_session_pack_limit_exceeded)');
    }
    this.sessions.set(cloned.sessionId, { session: cloned, packIndex });
    this.pruneOverflow();
    return structuredClone(cloned);
  }

  snapshot(sessionId: string): ContextSession {
    this.pruneExpired();
    const state = this.getSession(sessionId);
    return structuredClone(state.session);
  }

  private getSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`unverified_by_trace(context_session_missing): ${sessionId}`);
    }
    return state;
  }

  private pruneExpired(): void {
    if (!this.sessionTtlMs || this.sessionTtlMs <= 0) return;
    const nowParsed = Date.parse(this.now());
    if (!Number.isFinite(nowParsed)) {
      throw new Error('unverified_by_trace(context_session_now_invalid)');
    }
    const now = nowParsed;
    const entries = Array.from(this.sessions.entries());
    for (const [sessionId, state] of entries) {
      const lastAccessed = Date.parse(state.session.lastAccessedAt);
      if (!Number.isFinite(lastAccessed)) continue;
      if (now - lastAccessed > this.sessionTtlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private pruneOverflow(): void {
    if (this.sessions.size <= this.maxSessions) return;
    const entries = Array.from(this.sessions.entries()).sort((a, b) => {
      return a[1].session.lastAccessedAt.localeCompare(b[1].session.lastAccessedAt);
    });
    const removeCount = entries.length - this.maxSessions;
    for (let i = 0; i < removeCount; i += 1) {
      this.sessions.delete(entries[i][0]);
    }
  }

  private async withSessionLock<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const safePrevious = previous.catch(() => {});
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const chain = safePrevious.then(() => gate);
    this.sessionLocks.set(sessionId, chain);

    await safePrevious;
    try {
      return await work();
    } finally {
      release();
      if (this.sessionLocks.get(sessionId) === chain) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  private async withStartLock<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = this.startLock;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    this.startLock = previous.then(() => gate).catch(() => gate);

    await previous.catch(() => {});
    try {
      return await work();
    } finally {
      release();
    }
  }
}

function buildPackIndex(packs: ContextPack[]): Map<string, ContextPack> {
  const index = new Map<string, ContextPack>();
  for (const pack of packs) {
    index.set(pack.packId, pack);
  }
  return index;
}

function mergePackIndex(
  packIndex: Map<string, ContextPack>,
  packs: ContextPack[]
): { packIndex: Map<string, ContextPack>; packs: ContextPack[]; newPacks: ContextPack[] } {
  const nextIndex = new Map(packIndex);
  const newPacks: ContextPack[] = [];
  for (const pack of packs) {
    if (nextIndex.has(pack.packId)) continue;
    nextIndex.set(pack.packId, pack);
    newPacks.push(pack);
  }
  return { packIndex: nextIndex, packs: Array.from(nextIndex.values()), newPacks };
}

function buildFollowUpQuery(session: ContextSession, question: string): LibrarianQuery {
  return {
    ...session.initialQuery,
    intent: question,
    affectedFiles: session.context.exploredEntities.length
      ? [...session.context.exploredEntities]
      : session.initialQuery.affectedFiles,
  };
}

function buildDrillDownQuery(session: ContextSession, entityId: string): LibrarianQuery {
  const depth = session.initialQuery.depth === 'L0' ? 'L1' : session.initialQuery.depth;
  return {
    ...session.initialQuery,
    intent: `Drill down: ${entityId}`,
    affectedFiles: [entityId],
    depth,
  };
}

function extractAnswer(response: LibrarianResponse): string {
  if (response.synthesis?.answer) return response.synthesis.answer;
  if (response.explanation) return response.explanation;
  const packs = Array.isArray(response.packs) ? response.packs : [];
  const summaries = packs.map((pack) => pack.summary).filter(Boolean);
  return summaries.slice(0, 3).join(' ') || 'No synthesis available.';
}

function suggestDrillDowns(packs: ContextPack[], explored: string[]): string[] {
  const suggestions: string[] = [];
  const seen = new Set(explored);
  for (const pack of packs) {
    for (const file of pack.relatedFiles) {
      if (!file || seen.has(file)) continue;
      seen.add(file);
      suggestions.push(file);
      if (suggestions.length >= 5) return suggestions;
    }
  }
  return suggestions;
}

function collectKeyFacts(packs: ContextPack[]): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const fact of pack.keyFacts) {
      if (!fact || seen.has(fact)) continue;
      seen.add(fact);
      facts.push(fact);
      if (facts.length >= 12) return facts;
    }
  }
  return facts;
}

function buildSummary(session: ContextSession, keyFacts: string[]): string {
  const packCount = session.context.packs.length;
  const explored = session.context.exploredEntities.length;
  const factsSnippet = keyFacts.slice(0, 3).join(' | ');
  if (factsSnippet) {
    return `Collected ${packCount} context packs across ${explored} entities. Key facts: ${factsSnippet}.`;
  }
  return `Collected ${packCount} context packs across ${explored} entities.`;
}
