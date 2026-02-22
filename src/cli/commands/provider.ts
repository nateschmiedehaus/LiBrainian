import { parseArgs } from 'node:util';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { emitJsonOutput } from '../json_output.js';
import { createError } from '../errors.js';
import { printKeyValue, printTable } from '../progress.js';
import { getAllProviderStatus } from '../../api/llm_provider_discovery.js';
import {
  isRegisteredProvider,
  listRegisteredProviders,
  readBootstrapLlmSelection,
  readUserLlmSelection,
  resolveProviderDefaultModel,
  writeUserLlmSelection,
  type LlmSelectionSource,
} from '../provider_selection.js';
import { loadQuerySession, saveQuerySession } from '../query_sessions.js';
import type { ContextSession } from '../../api/context_sessions.js';

export interface ProviderCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type ProviderCommandName = 'list' | 'current' | 'use';

interface EffectiveSelection {
  provider: string | null;
  modelId: string | null;
  source: LlmSelectionSource;
}

function resolveProviderCommandArgs(rawArgs: string[], args: string[]): string[] {
  const providerIndex = rawArgs.findIndex((arg) => arg === 'provider');
  if (providerIndex >= 0) {
    const sliced = rawArgs.slice(providerIndex + 1);
    if (sliced.length > 0) {
      return sliced;
    }
  }
  return args;
}

function inferAvailableSelection(
  providers: Array<{ id: string; available: boolean; authenticated: boolean; defaultModel: string }>
): EffectiveSelection {
  const available = providers.find((provider) => provider.available && provider.authenticated);
  if (!available) {
    return { provider: null, modelId: null, source: 'none' };
  }
  return {
    provider: available.id,
    modelId: available.defaultModel,
    source: 'discovery',
  };
}

async function resolveCurrentSelection(options: {
  workspace: string;
  storage: { getState(key: string): Promise<string | null> };
  sessionId?: string;
  providers: Array<{ id: string; available: boolean; authenticated: boolean; defaultModel: string }>;
}): Promise<{
  effective: EffectiveSelection;
  sessionOverride: EffectiveSelection;
  userDefault: EffectiveSelection;
  bootstrapDefault: EffectiveSelection;
}> {
  const { workspace, storage, sessionId, providers } = options;

  let sessionOverride: EffectiveSelection = { provider: null, modelId: null, source: 'none' };
  if (sessionId) {
    const persisted = await loadQuerySession(workspace, sessionId);
    if (!persisted) {
      throw createError('INVALID_ARGUMENT', `Session "${sessionId}" was not found. Start one with --session new.`);
    }
    if (persisted.llmSelection?.provider && persisted.llmSelection.modelId) {
      sessionOverride = {
        provider: persisted.llmSelection.provider,
        modelId: persisted.llmSelection.modelId,
        source: 'session',
      };
    }
  }

  const userSelection = await readUserLlmSelection(storage);
  const bootstrapSelection = await readBootstrapLlmSelection(storage);
  const userDefault: EffectiveSelection = userSelection
    ? { provider: userSelection.provider, modelId: userSelection.modelId, source: 'user_default' }
    : { provider: null, modelId: null, source: 'none' };
  const bootstrapDefault: EffectiveSelection = bootstrapSelection
    ? { provider: bootstrapSelection.provider, modelId: bootstrapSelection.modelId, source: 'bootstrap_default' }
    : { provider: null, modelId: null, source: 'none' };

  const effective =
    sessionOverride.provider && sessionOverride.modelId
      ? sessionOverride
      : userDefault.provider && userDefault.modelId
        ? userDefault
        : bootstrapDefault.provider && bootstrapDefault.modelId
          ? bootstrapDefault
          : inferAvailableSelection(providers);

  return {
    effective,
    sessionOverride,
    userDefault,
    bootstrapDefault,
  };
}

export async function providerCommand(options: ProviderCommandOptions): Promise<void> {
  const { workspace, rawArgs, args } = options;
  const commandArgs = resolveProviderCommandArgs(rawArgs, args);
  const { values, positionals } = parseArgs({
    args: commandArgs,
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      session: { type: 'string' },
      model: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const subcommand = (positionals[0] ?? 'current') as ProviderCommandName;
  const outputJson = values.json as boolean;
  const outputPath = typeof values.out === 'string' && values.out.trim().length > 0
    ? values.out.trim()
    : undefined;
  if (outputPath && !outputJson) {
    throw createError('INVALID_ARGUMENT', '--out requires --json output mode.');
  }
  const sessionId = typeof values.session === 'string' ? values.session.trim() : '';
  const modelFlag = typeof values.model === 'string' ? values.model.trim() : '';

  if (subcommand !== 'list' && subcommand !== 'current' && subcommand !== 'use') {
    throw createError('INVALID_ARGUMENT', `Unknown provider subcommand "${subcommand}". Use list|current|use.`);
  }

  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    const registeredProviders = listRegisteredProviders();
    const status = await getAllProviderStatus();
    const providers = registeredProviders.map((provider) => {
      const providerStatus = status.find((entry) => entry.descriptor.id === provider.id)?.status;
      return {
        id: provider.id,
        name: provider.name,
        defaultModel: provider.defaultModel,
        priority: provider.priority,
        available: Boolean(providerStatus?.available),
        authenticated: Boolean(providerStatus?.authenticated),
        error: providerStatus?.error ?? null,
      };
    });

    if (subcommand === 'list') {
      const current = await resolveCurrentSelection({
        workspace,
        storage,
        sessionId: sessionId || undefined,
        providers: providers.map((provider) => ({
          id: provider.id,
          available: provider.available,
          authenticated: provider.authenticated,
          defaultModel: provider.defaultModel,
        })),
      });
      const payload = {
        providers,
        current: current.effective,
        sessionOverride: current.sessionOverride,
        userDefault: current.userDefault,
        bootstrapDefault: current.bootstrapDefault,
      };
      if (outputJson) {
        await emitJsonOutput(payload, outputPath);
        return;
      }
      console.log('Provider List');
      console.log('=============\n');
      printTable(
        ['Provider', 'Default Model', 'Available', 'Authenticated', 'Error'],
        providers.map((provider) => [
          provider.id,
          provider.defaultModel,
          provider.available ? 'Yes' : 'No',
          provider.authenticated ? 'Yes' : 'No',
          provider.error ?? '-',
        ])
      );
      console.log();
      printKeyValue([
        { key: 'Current Provider', value: current.effective.provider ?? 'none' },
        { key: 'Current Model', value: current.effective.modelId ?? 'none' },
        { key: 'Source', value: current.effective.source },
      ]);
      return;
    }

    if (subcommand === 'current') {
      const current = await resolveCurrentSelection({
        workspace,
        storage,
        sessionId: sessionId || undefined,
        providers: providers.map((provider) => ({
          id: provider.id,
          available: provider.available,
          authenticated: provider.authenticated,
          defaultModel: provider.defaultModel,
        })),
      });
      const payload = {
        current: current.effective,
        sessionOverride: current.sessionOverride,
        userDefault: current.userDefault,
        bootstrapDefault: current.bootstrapDefault,
      };
      if (outputJson) {
        await emitJsonOutput(payload, outputPath);
        return;
      }
      console.log('Provider Selection');
      console.log('==================\n');
      printKeyValue([
        { key: 'Current Provider', value: current.effective.provider ?? 'none' },
        { key: 'Current Model', value: current.effective.modelId ?? 'none' },
        { key: 'Source', value: current.effective.source },
      ]);
      if (sessionId) {
        console.log();
        printKeyValue([
          { key: 'Session Override', value: current.sessionOverride.provider ?? 'none' },
          { key: 'Session Model', value: current.sessionOverride.modelId ?? 'none' },
        ]);
      }
      return;
    }

    const provider = positionals[1]?.trim();
    if (!provider) {
      throw createError('INVALID_ARGUMENT', 'Usage: librarian provider use <provider> [--model <id>] [--session <id>] [--json]');
    }
    if (!isRegisteredProvider(provider)) {
      throw createError(
        'INVALID_ARGUMENT',
        `Unknown provider "${provider}". Run "librarian provider list" to see registered providers.`
      );
    }

    const modelId = modelFlag || resolveProviderDefaultModel(provider);
    if (!modelId) {
      throw createError(
        'INVALID_ARGUMENT',
        `No default model available for provider "${provider}". Pass --model <id>.`
      );
    }

    let scope: 'user_default' | 'session' = 'user_default';
    let updatedSession: ContextSession | null = null;

    if (sessionId) {
      if (sessionId.toLowerCase() === 'new') {
        throw createError('INVALID_ARGUMENT', 'Session-scoped provider override requires an existing --session <id>.');
      }
      const persisted = await loadQuerySession(workspace, sessionId);
      if (!persisted) {
        throw createError('INVALID_ARGUMENT', `Session "${sessionId}" was not found. Start one with --session new.`);
      }
      updatedSession = {
        ...persisted,
        llmSelection: {
          provider,
          modelId,
          updatedAt: new Date().toISOString(),
        },
      };
      await saveQuerySession(workspace, updatedSession);
      scope = 'session';
    } else {
      await writeUserLlmSelection(storage, { provider, modelId });
    }

    process.env.LIBRARIAN_LLM_PROVIDER = provider;
    process.env.LIBRARIAN_LLM_MODEL = modelId;

    const payload = {
      ok: true,
      provider,
      modelId,
      scope,
      sessionId: updatedSession?.sessionId ?? null,
      appliedAt: new Date().toISOString(),
      nextCallDeterministic: true,
    };
    if (outputJson) {
      await emitJsonOutput(payload, outputPath);
      return;
    }

    console.log(`Provider set to ${provider} (${modelId}) [scope=${scope}]`);
    console.log('Next LiBrainian call will use this selection without restart.');
  } finally {
    await storage.close();
  }
}
