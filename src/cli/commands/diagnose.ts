import { Librarian } from '../../api/librarian.js';

export interface DiagnoseCommandOptions {
  workspace?: string;
  pretty?: boolean;
  config?: boolean;
  heal?: boolean;
  riskTolerance?: 'safe' | 'low' | 'medium';
  format?: 'json' | 'text';
}

export async function diagnoseCommand(options: DiagnoseCommandOptions): Promise<void> {
  const workspace = options.workspace || process.cwd();
  const pretty = options.pretty ?? false;
  const format = options.format ?? 'json';
  const includeConfig = Boolean(options.config || options.heal);
  const runHeal = Boolean(options.heal);
  const riskTolerance = options.riskTolerance ?? 'low';

  const envProvider = process.env.LIBRARIAN_LLM_PROVIDER;
  const envModel = process.env.LIBRARIAN_LLM_MODEL;
  const llmProvider = envProvider === 'claude' || envProvider === 'codex' ? envProvider : undefined;
  const llmModelId = typeof envModel === 'string' && envModel.trim().length > 0 ? envModel : undefined;
  const hasLlmConfig = Boolean(llmProvider && llmModelId);

  const librarian = new Librarian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: hasLlmConfig ? llmProvider : undefined,
    llmModelId: hasLlmConfig ? llmModelId : undefined,
  });

  await librarian.initialize();
  const diagnosis = await librarian.diagnoseSelf();
  let outputPayload: unknown = diagnosis;

  if (includeConfig) {
    const configReport = await librarian.diagnoseConfig();
    const healingResult = runHeal ? await librarian.healConfig({ riskTolerance }) : undefined;
    outputPayload = {
      self: diagnosis,
      config: configReport,
      ...(healingResult ? { healing: healingResult } : {}),
    };
  }

  if (format === 'text') {
    const base = diagnosis;
    console.log('Self Diagnosis');
    console.log('==============');
    console.log(`Status: ${base.status}`);
    const issues = Array.isArray(base.issues) ? base.issues : [];
    if (issues.length > 0) {
      console.log(`Issues: ${issues.join(', ')}`);
    }
    if (typeof base.stopReason === 'string' && base.stopReason) {
      console.log(`Stop Reason: ${base.stopReason}`);
    }
    if (includeConfig && typeof outputPayload === 'object' && outputPayload !== null) {
      const payload = outputPayload as { config?: { healthScore?: number; isOptimal?: boolean } };
      if (payload.config) {
        console.log(`Config Health: ${payload.config.healthScore ?? 'unknown'}`);
        if (typeof payload.config.isOptimal === 'boolean') {
          console.log(`Config Optimal: ${payload.config.isOptimal}`);
        }
      }
    }
  } else {
    const output = JSON.stringify(outputPayload, null, pretty ? 2 : 0);
    console.log(output);
  }
  await librarian.shutdown();
}
