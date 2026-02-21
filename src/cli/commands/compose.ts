import { parseArgs } from 'node:util';
import { LiBrainian } from '../../api/librarian.js';
import { createError } from '../errors.js';
import { composeConstructions } from '../../constructions/lego_pipeline.js';

export interface ComposeCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

const DEFAULT_COMPOSE_TIMEOUT_MS = 5 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 1000;

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  if (timeoutMs <= 0) return operation;
  return await new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(createError('TIMEOUT', `Compose timed out after ${timeoutMs}ms during ${stage}.`));
    }, timeoutMs);

    operation
      .then((result) => {
        clearTimeout(timeoutHandle);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
  });
}

export async function composeCommand(options: ComposeCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;

  const { values, positionals } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      limit: { type: 'string' },
      'include-primitives': { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
      mode: { type: 'string', default: 'constructions' },
      timeout: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const intent = positionals.join(' ');
  if (!intent) {
    throw createError('INVALID_ARGUMENT', 'Compose intent is required. Usage: librarian compose "<intent>"');
  }

  const includePrimitives = values['include-primitives'] as boolean;
  const pretty = values.pretty as boolean;
  const modeRaw = String(values.mode ?? 'constructions').toLowerCase();
  const mode = modeRaw === 'techniques' || modeRaw === 'constructions'
    ? modeRaw
    : 'constructions';
  if (modeRaw !== 'techniques' && modeRaw !== 'constructions') {
    throw createError('INVALID_ARGUMENT', `Invalid mode "${modeRaw}". Use constructions|techniques.`);
  }
  const limitRaw = typeof values.limit === 'string' ? values.limit : '';
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    throw createError('INVALID_ARGUMENT', 'Limit must be a positive integer.');
  }
  const limit = parsedLimit;

  const timeoutRaw = typeof values.timeout === 'string' ? values.timeout : '';
  const parsedTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : DEFAULT_COMPOSE_TIMEOUT_MS;
  if (!Number.isFinite(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
    throw createError('INVALID_ARGUMENT', 'Timeout must be a positive integer in milliseconds.');
  }
  const timeoutMs = parsedTimeoutMs;
  const verbose = values.verbose as boolean;

  const librarian = new LiBrainian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: (process.env.LIBRARIAN_LLM_PROVIDER as 'claude' | 'codex') || 'claude',
    llmModelId: process.env.LIBRARIAN_LLM_MODEL,
  });
  const startedAt = Date.now();
  let currentStage = 'init';
  const progressHandle = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    console.error(`[compose] progress stage=${currentStage} elapsedMs=${elapsedMs}`);
  }, PROGRESS_INTERVAL_MS);
  let caughtError: unknown;
  try {
    if (verbose) {
      console.error('[compose] init:start');
    }
    await withTimeout(librarian.initialize(), timeoutMs, 'initialization');
    if (verbose) {
      console.error('[compose] init:done');
    }

    currentStage = mode === 'constructions' ? 'compose' : 'techniques';
    if (verbose) {
      console.error(`[compose] ${currentStage}:start`);
    }

    const outputPayload = mode === 'constructions'
      ? await withTimeout(composeConstructions(librarian, intent), timeoutMs, 'compose execution')
      : {
          mode: 'techniques',
          intent,
          bundles: await withTimeout(
            librarian.compileTechniqueBundlesFromIntent(intent, {
              limit,
              includePrimitives,
            }),
            timeoutMs,
            'technique compilation',
          ),
        };
    if (verbose) {
      console.error(`[compose] ${currentStage}:done`);
    }
    const output = JSON.stringify(outputPayload, null, pretty ? 2 : 0);
    console.log(output);
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    clearInterval(progressHandle);
    try {
      await librarian.shutdown();
      if (verbose) {
        console.error('[compose] shutdown:done');
      }
    } catch (shutdownError) {
      if (!caughtError) {
        throw shutdownError;
      }
      if (verbose) {
        const message = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
        console.error(`[compose] shutdown:error ${message}`);
      }
    }
  }
}
