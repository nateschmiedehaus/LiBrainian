import { parseArgs } from 'node:util';
import {
  generatePromptDocs,
  type PromptDocKind,
} from './generate_docs_content.js';

export interface GenerateDocsCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export async function generateDocsCommand(options: GenerateDocsCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'output-dir': { type: 'string' },
      include: { type: 'string' },
      combined: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'max-tokens': { type: 'string' },
      'no-tools': { type: 'boolean', default: false },
      'no-context': { type: 'boolean', default: false },
      'no-rules': { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const include = resolveIncludeKinds(values.include as string | undefined, {
    tools: values['no-tools'] as boolean,
    context: values['no-context'] as boolean,
    rules: values['no-rules'] as boolean,
  });

  const maxTokensRaw = values['max-tokens'] as string | undefined;
  const maxTokens = maxTokensRaw ? Number.parseInt(maxTokensRaw, 10) : undefined;

  const result = await generatePromptDocs({
    workspace,
    outputDir: values['output-dir'] as string | undefined,
    include,
    combined: values.combined as boolean,
    maxTokensPerFile: Number.isFinite(maxTokens) ? maxTokens : undefined,
  });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('Generate Docs');
  console.log('============\n');
  console.log(`Workspace: ${workspace}`);
  console.log(`Output dir: ${result.outputDir}`);
  console.log(`Included: ${result.include.join(', ')}`);
  console.log(`Generated at: ${result.generatedAt}`);
  console.log(`Files written: ${result.filesWritten.length}`);

  for (const file of result.filesWritten) {
    const fileName = file.split('/').pop() ?? file;
    const estimate = result.tokenEstimates[fileName];
    if (typeof estimate === 'number') {
      console.log(`  - ${file} (estimated tokens: ${estimate})`);
    } else {
      console.log(`  - ${file}`);
    }
  }
}

function resolveIncludeKinds(
  includeRaw: string | undefined,
  disabled: { tools: boolean; context: boolean; rules: boolean }
): PromptDocKind[] | undefined {
  if (includeRaw && includeRaw.trim().length > 0) {
    const parsed = includeRaw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is PromptDocKind => value === 'tools' || value === 'context' || value === 'rules');

    const deduped = [...new Set(parsed)];
    return deduped.length > 0 ? deduped : undefined;
  }

  const inferred: PromptDocKind[] = [];
  if (!disabled.tools) inferred.push('tools');
  if (!disabled.context) inferred.push('context');
  if (!disabled.rules) inferred.push('rules');

  return inferred.length > 0 ? inferred : undefined;
}
