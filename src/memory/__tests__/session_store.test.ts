import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCoreMemoryDisclosure,
  getSessionState,
  recordSessionError,
  recordSessionQuery,
  setSessionCoreMemory,
} from '../session_store.js';

describe('session_store', () => {
  let workspace = '';

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-session-store-'));
  });

  afterEach(async () => {
    if (workspace) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('records query history and recent files across invocations', async () => {
    await recordSessionQuery(workspace, 'Where is auth middleware?', ['src/auth.ts', 'src/session.ts']);
    await recordSessionQuery(workspace, 'How is auth refreshed?', ['src/session.ts']);

    const state = await getSessionState(workspace);
    expect(state.kind).toBe('LibrarianSession.v1');
    expect(state.workingContext.recentQueries[0]).toBe('How is auth refreshed?');
    expect(state.workingContext.recentQueries).toContain('Where is auth middleware?');
    expect(state.workingContext.activeTask).toBe('How is auth refreshed?');
    expect(state.workingContext.recentFiles[0]).toBe('src/session.ts');
    expect(state.workingContext.recentFiles).toContain('src/auth.ts');
    expect(state.episodicLog[0]?.event).toBe('query');
  });

  it('stores core memory facts and emits disclosure text', async () => {
    await setSessionCoreMemory(workspace, 'auth_model', 'JWT expires in 1 hour');
    await recordSessionError(workspace, 'provider timeout');
    const state = await getSessionState(workspace);

    expect(state.workingContext.coreMemory.auth_model).toBe('JWT expires in 1 hour');
    expect(state.episodicLog.some((entry) => entry.event === 'error')).toBe(true);
    expect(buildCoreMemoryDisclosure(state)).toContain('auth_model: JWT expires in 1 hour');
  });
});
