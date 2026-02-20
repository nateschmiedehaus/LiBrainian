import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface LibrarianSessionEvent {
  timestamp: string;
  event: 'query' | 'error' | 'task_start' | 'task_update';
  content: string;
}

export interface LibrarianSessionState {
  schema_version: 1;
  kind: 'LibrarianSession.v1';
  startedAt: string;
  lastActiveAt: string;
  workingContext: {
    activeTask?: string;
    recentQueries: string[];
    recentFiles: string[];
    coreMemory: Record<string, string>;
  };
  episodicLog: LibrarianSessionEvent[];
}

const MAX_RECENT_QUERIES = 20;
const MAX_RECENT_FILES = 30;
const MAX_EPISODIC_EVENTS = 50;
const MAX_CORE_MEMORY_CHARS = 5000;

function createInitialSession(nowIso: string): LibrarianSessionState {
  return {
    schema_version: 1,
    kind: 'LibrarianSession.v1',
    startedAt: nowIso,
    lastActiveAt: nowIso,
    workingContext: {
      recentQueries: [],
      recentFiles: [],
      coreMemory: {},
    },
    episodicLog: [],
  };
}

function sessionPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.librarian', 'session.json');
}

function clampCoreMemory(coreMemory: Record<string, string>): Record<string, string> {
  const entries = Object.entries(coreMemory);
  let total = entries.reduce((sum, [, value]) => sum + value.length, 0);
  if (total <= MAX_CORE_MEMORY_CHARS) {
    return coreMemory;
  }
  const trimmed = Object.fromEntries(entries);
  for (const key of Object.keys(trimmed)) {
    if (total <= MAX_CORE_MEMORY_CHARS) break;
    total -= trimmed[key]?.length ?? 0;
    delete trimmed[key];
  }
  return trimmed;
}

function dedupeRecent(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

async function readSession(workspaceRoot: string): Promise<LibrarianSessionState> {
  const nowIso = new Date().toISOString();
  const filePath = sessionPath(workspaceRoot);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LibrarianSessionState>;
    if (parsed?.kind !== 'LibrarianSession.v1' || parsed.schema_version !== 1) {
      return createInitialSession(nowIso);
    }
    return {
      schema_version: 1,
      kind: 'LibrarianSession.v1',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : nowIso,
      lastActiveAt: typeof parsed.lastActiveAt === 'string' ? parsed.lastActiveAt : nowIso,
      workingContext: {
        activeTask: typeof parsed.workingContext?.activeTask === 'string' ? parsed.workingContext.activeTask : undefined,
        recentQueries: Array.isArray(parsed.workingContext?.recentQueries)
          ? parsed.workingContext!.recentQueries.filter((entry): entry is string => typeof entry === 'string')
          : [],
        recentFiles: Array.isArray(parsed.workingContext?.recentFiles)
          ? parsed.workingContext!.recentFiles.filter((entry): entry is string => typeof entry === 'string')
          : [],
        coreMemory: parsed.workingContext?.coreMemory && typeof parsed.workingContext.coreMemory === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.workingContext.coreMemory)
                .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
            )
          : {},
      },
      episodicLog: Array.isArray(parsed.episodicLog)
        ? parsed.episodicLog
            .filter((entry): entry is LibrarianSessionEvent =>
              Boolean(entry)
              && typeof entry === 'object'
              && typeof (entry as LibrarianSessionEvent).timestamp === 'string'
              && typeof (entry as LibrarianSessionEvent).event === 'string'
              && typeof (entry as LibrarianSessionEvent).content === 'string')
        : [],
    };
  } catch {
    return createInitialSession(nowIso);
  }
}

async function writeSession(workspaceRoot: string, state: LibrarianSessionState): Promise<void> {
  const filePath = sessionPath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function getSessionState(workspaceRoot: string): Promise<LibrarianSessionState> {
  return readSession(workspaceRoot);
}

export async function setSessionCoreMemory(workspaceRoot: string, key: string, value: string): Promise<LibrarianSessionState> {
  const state = await readSession(workspaceRoot);
  const nowIso = new Date().toISOString();
  state.lastActiveAt = nowIso;
  const coreMemory = { ...state.workingContext.coreMemory, [key]: value };
  state.workingContext.coreMemory = clampCoreMemory(coreMemory);
  const event: LibrarianSessionEvent = {
    timestamp: nowIso,
    event: 'task_update',
    content: `core_memory:${key}`,
  };
  state.episodicLog = [
    event,
    ...state.episodicLog,
  ].slice(0, MAX_EPISODIC_EVENTS);
  await writeSession(workspaceRoot, state);
  return state;
}

export async function recordSessionQuery(
  workspaceRoot: string,
  queryIntent: string,
  relatedFiles: string[] = [],
): Promise<void> {
  const state = await readSession(workspaceRoot);
  const nowIso = new Date().toISOString();
  state.lastActiveAt = nowIso;
  state.workingContext.activeTask = queryIntent || state.workingContext.activeTask;
  state.workingContext.recentQueries = dedupeRecent(
    [queryIntent, ...state.workingContext.recentQueries],
    MAX_RECENT_QUERIES,
  );
  state.workingContext.recentFiles = dedupeRecent(
    [...relatedFiles, ...state.workingContext.recentFiles],
    MAX_RECENT_FILES,
  );
  const event: LibrarianSessionEvent = {
    timestamp: nowIso,
    event: 'query',
    content: queryIntent,
  };
  state.episodicLog = [
    event,
    ...state.episodicLog,
  ].slice(0, MAX_EPISODIC_EVENTS);
  await writeSession(workspaceRoot, state);
}

export async function recordSessionError(workspaceRoot: string, message: string): Promise<void> {
  const state = await readSession(workspaceRoot);
  const nowIso = new Date().toISOString();
  state.lastActiveAt = nowIso;
  const event: LibrarianSessionEvent = {
    timestamp: nowIso,
    event: 'error',
    content: message,
  };
  state.episodicLog = [
    event,
    ...state.episodicLog,
  ].slice(0, MAX_EPISODIC_EVENTS);
  await writeSession(workspaceRoot, state);
}

export function buildCoreMemoryDisclosure(state: LibrarianSessionState): string | null {
  const entries = Object.entries(state.workingContext.coreMemory);
  if (entries.length === 0) return null;
  const payload = entries.map(([key, value]) => `${key}: ${value}`).join(' | ');
  return `session_core_memory: ${payload}`;
}
