import { parseArgs } from 'node:util';
import { LIBRARIAN_VERSION, LIBRAINIAN_PACKAGE_VERSION } from '../../index.js';
import { collectFeatureRegistry, type FeatureEntry } from '../../features/registry.js';
import { createError } from '../errors.js';
import { emitJsonOutput } from '../json_output.js';

export interface FeaturesCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function internalCommandsEnabled(): boolean {
  return process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS === '1';
}

function filterFeatures(entries: FeatureEntry[], includeAll: boolean): FeatureEntry[] {
  if (includeAll) {
    return entries;
  }
  return entries.filter((entry) => entry.surface === 'public');
}

function statusLabel(status: FeatureEntry['status']): string {
  switch (status) {
    case 'active':
      return '[active]';
    case 'limited':
      return '[limited]';
    case 'inactive':
      return '[inactive]';
    case 'experimental':
      return '[experimental]';
    case 'not_implemented':
      return '[not implemented]';
    default:
      return `[${status}]`;
  }
}

function renderFeatureLine(entry: FeatureEntry, verbose: boolean): string {
  const base = `${statusLabel(entry.status)} ${entry.name} - ${entry.description}`;
  if (!verbose) return base;
  const details = [
    `requiresConfig=${entry.requiresConfig}`,
    `docs=${entry.docs}`,
    entry.configHint ? `hint=${entry.configHint}` : null,
  ].filter(Boolean);
  return `${base}\n    ${details.join(' | ')}`;
}

export async function featuresCommand(options: FeaturesCommandOptions): Promise<void> {
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });
  const json = Boolean(values.json);
  const verbose = Boolean(values.verbose);
  const includeAll = Boolean(values.all);
  const out = typeof values.out === 'string' ? values.out : undefined;

  if (includeAll && !internalCommandsEnabled()) {
    throw createError(
      'INVALID_ARGUMENT',
      'The full feature inventory is unavailable in the public release surface.',
      {
        recoveryHints: [
          'Run `librainian features` for the supported public inventory.',
          'Maintainers can opt into internal inventory from a source checkout with LIBRAINIAN_ENABLE_INTERNAL_COMMANDS=1.',
        ],
      },
    );
  }

  const startedAtMs = Date.now();
  const allFeatures = await collectFeatureRegistry(options.workspace);
  const features = filterFeatures(allFeatures, includeAll);
  const elapsedMs = Date.now() - startedAtMs;

  const payload = {
    kind: 'LiBrainianFeatures.v1',
    workspace: options.workspace,
    version: LIBRAINIAN_PACKAGE_VERSION,
    schemaVersion: 1,
    productSchemaVersion: LIBRARIAN_VERSION.string,
    surface: includeAll ? 'full' : 'public',
    generatedAt: new Date().toISOString(),
    durationMs: elapsedMs,
    counts: {
      visible: features.length,
      hidden: Math.max(0, allFeatures.length - features.length),
    },
    features: features.map((entry) => ({
      name: entry.name,
      id: entry.id,
      category: entry.category,
      surface: entry.surface,
      status: entry.status,
      description: entry.description,
      requiresConfig: entry.requiresConfig,
      configHint: entry.configHint,
      docs: entry.docs,
    })),
  };

  if (json) {
    await emitJsonOutput(payload, out);
    return;
  }

  const core = features.filter((entry) => entry.category === 'core');
  const experimental = features.filter((entry) => entry.category === 'experimental');

  console.log(`LIBRAINIAN FEATURE STATUS (v${LIBRAINIAN_PACKAGE_VERSION})`);
  console.log(`Schema version: ${LIBRARIAN_VERSION.string}`);
  console.log(`Surface: ${includeAll ? 'full inventory' : 'public release surface'}`);
  console.log('');
  console.log('Core Features:');
  for (const entry of core) {
    console.log(`  ${renderFeatureLine(entry, verbose)}`);
  }

  if (experimental.length > 0) {
    console.log('');
    console.log('Experimental Features:');
    for (const entry of experimental) {
      console.log(`  ${renderFeatureLine(entry, verbose)}`);
    }
  }

  if (verbose) {
    console.log('');
    if (!includeAll) {
      console.log(`Hidden internal/planned entries: ${Math.max(0, allFeatures.length - features.length)} (source checkout internal inventory only)`);
      console.log('');
    }
    console.log(`Generated in ${elapsedMs}ms`);
  }
}
