import * as fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { submitQueryFeedback } from '../../integration/agent_protocol.js';
import { createError } from '../errors.js';

export interface FeedbackCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type Outcome = 'success' | 'failure' | 'partial';

interface CustomRating {
  packId: string;
  relevant: boolean;
  usefulness?: number;
  reason?: string;
}

function parseOutcome(value: string): Outcome {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'success' || normalized === 'failure' || normalized === 'partial') {
    return normalized;
  }
  throw createError('INVALID_ARGUMENT', `Invalid --outcome "${value}" (use success|failure|partial).`);
}

function parseCustomRatings(raw: string): CustomRating[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createError('INVALID_ARGUMENT', `Invalid ratings JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw createError('INVALID_ARGUMENT', 'Ratings must be a JSON array.');
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw createError('INVALID_ARGUMENT', `ratings[${index}] must be an object.`);
    }
    const value = entry as Record<string, unknown>;
    if (typeof value.packId !== 'string' || value.packId.trim().length === 0) {
      throw createError('INVALID_ARGUMENT', `ratings[${index}].packId is required.`);
    }
    if (typeof value.relevant !== 'boolean') {
      throw createError('INVALID_ARGUMENT', `ratings[${index}].relevant must be boolean.`);
    }
    if (typeof value.usefulness !== 'undefined') {
      if (typeof value.usefulness !== 'number' || !Number.isFinite(value.usefulness) || value.usefulness < 0 || value.usefulness > 1) {
        throw createError('INVALID_ARGUMENT', `ratings[${index}].usefulness must be a number between 0 and 1.`);
      }
    }
    if (typeof value.reason !== 'undefined' && typeof value.reason !== 'string') {
      throw createError('INVALID_ARGUMENT', `ratings[${index}].reason must be a string.`);
    }

    return {
      packId: value.packId.trim(),
      relevant: value.relevant,
      usefulness: value.usefulness,
      reason: value.reason,
    };
  });
}

export async function feedbackCommand(options: FeedbackCommandOptions): Promise<void> {
  const { workspace, rawArgs, args } = options;
  const commandArgs = args.length > 0 ? args : rawArgs.slice(1);

  const { values, positionals } = parseArgs({
    args: commandArgs,
    options: {
      outcome: { type: 'string' },
      'agent-id': { type: 'string' },
      'missing-context': { type: 'string' },
      ratings: { type: 'string' },
      'ratings-file': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const feedbackToken = (positionals[0] ?? '').trim();
  if (!feedbackToken) {
    throw createError('INVALID_ARGUMENT', 'feedbackToken is required. Usage: librarian feedback <feedbackToken> --outcome <success|failure|partial>');
  }

  if (typeof values.outcome !== 'string' || values.outcome.trim().length === 0) {
    throw createError('INVALID_ARGUMENT', 'Outcome is required. Use --outcome success|failure|partial.');
  }
  const outcome = parseOutcome(values.outcome);

  const ratingsRaw = typeof values.ratings === 'string' ? values.ratings : undefined;
  const ratingsFile = typeof values['ratings-file'] === 'string' ? values['ratings-file'] : undefined;
  if (ratingsRaw && ratingsFile) {
    throw createError('INVALID_ARGUMENT', 'Use only one of --ratings or --ratings-file.');
  }

  let customRatings: CustomRating[] | undefined;
  if (ratingsRaw) {
    customRatings = parseCustomRatings(ratingsRaw);
  } else if (ratingsFile) {
    const fileText = await fs.readFile(ratingsFile, 'utf8');
    customRatings = parseCustomRatings(fileText);
  }

  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    const result = await submitQueryFeedback(
      feedbackToken,
      outcome,
      storage,
      {
        agentId: typeof values['agent-id'] === 'string' ? values['agent-id'] : undefined,
        missingContext: typeof values['missing-context'] === 'string' ? values['missing-context'] : undefined,
        customRatings,
      }
    );

    const output = {
      feedbackToken,
      outcome,
      success: result.success,
      adjustmentsApplied: result.adjustmentsApplied,
      error: result.error,
    };

    if (values.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (result.success) {
      console.log(`Feedback submitted (${feedbackToken})`);
      console.log(`Outcome: ${outcome}`);
      console.log(`Adjustments applied: ${result.adjustmentsApplied}`);
    } else {
      throw createError('ENTITY_NOT_FOUND', result.error ?? 'Feedback submission failed.');
    }
  } finally {
    await storage.close();
  }
}
