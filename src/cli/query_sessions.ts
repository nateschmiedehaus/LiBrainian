import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ContextSession } from '../api/context_sessions.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { createError } from './errors.js';

export interface PersistedQuerySession {
  schemaVersion: 1;
  savedAt: string;
  session: ContextSession;
}

export function resolveQuerySessionsDir(workspace: string): string {
  return path.resolve(workspace, '.librarian', 'query_sessions');
}

export function resolveQuerySessionPath(workspace: string, sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw createError('INVALID_ARGUMENT', `Invalid session ID "${sessionId}".`);
  }
  return path.join(resolveQuerySessionsDir(workspace), `${trimmed}.json`);
}

export async function loadQuerySession(workspace: string, sessionId: string): Promise<ContextSession | null> {
  const filePath = resolveQuerySessionPath(workspace, sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = safeJsonParse<PersistedQuerySession>(raw);
    if (!parsed.ok || !parsed.value?.session) return null;
    return parsed.value.session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT')) return null;
    throw error;
  }
}

export async function saveQuerySession(workspace: string, session: ContextSession): Promise<void> {
  const sessionsDir = resolveQuerySessionsDir(workspace);
  const filePath = resolveQuerySessionPath(workspace, session.sessionId);
  const payload: PersistedQuerySession = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    session,
  };
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
