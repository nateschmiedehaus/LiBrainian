import { parseArgs } from 'node:util';
import { ejectInjectedDocs } from '../../ingest/docs_update.js';

export interface EjectDocsCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export async function ejectDocsCommand(options: EjectDocsCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dryRun = values['dry-run'] as boolean;
  const json = values.json as boolean;
  const result = await ejectInjectedDocs({
    workspace,
    dryRun,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('Eject Docs');
  console.log('=========\n');
  console.log(`Workspace: ${workspace}`);
  console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`Updated: ${result.filesUpdated.length}`);
  console.log(`Skipped: ${result.filesSkipped.length}`);

  if (result.filesUpdated.length > 0) {
    console.log('\nUpdated files:');
    for (const file of result.filesUpdated) {
      console.log(`  - ${file}`);
    }
  }

  if (result.filesSkipped.length > 0) {
    console.log('\nSkipped files:');
    for (const file of result.filesSkipped) {
      console.log(`  - ${file}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`\n${dryRun ? 'Dry run complete.' : 'Injected docs removed where present.'}`);
  }
}
