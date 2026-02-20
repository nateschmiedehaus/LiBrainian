import { parseArgs } from 'node:util';
import { LIBRARIAN_VERSION } from '../../index.js';
import { collectFeatureRegistry, type FeatureEntry } from '../../features/registry.js';
import { emitJsonOutput } from '../json_output.js';

export interface FeaturesCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
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
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });
  const json = Boolean(values.json);
  const verbose = Boolean(values.verbose);
  const out = typeof values.out === 'string' ? values.out : undefined;

  const startedAtMs = Date.now();
  const features = await collectFeatureRegistry(options.workspace);
  const elapsedMs = Date.now() - startedAtMs;

  const payload = {
    workspace: options.workspace,
    version: LIBRARIAN_VERSION.string,
    generatedAt: new Date().toISOString(),
    durationMs: elapsedMs,
    features: features.map((entry) => ({
      name: entry.name,
      id: entry.id,
      category: entry.category,
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

  console.log(`LIBRAINIAN FEATURE STATUS (v${LIBRARIAN_VERSION.string})`);
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
    console.log(`Generated in ${elapsedMs}ms`);
  }
}
