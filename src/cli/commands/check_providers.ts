/**
 * @fileoverview Check Providers command - Check provider availability and authentication
 */

import { parseArgs } from 'node:util';
import { checkAllProviders, type AllProviderStatus } from '../../api/provider_check.js';
import { runProviderReadinessGate } from '../../api/provider_gate.js';
import { printKeyValue, printTable } from '../progress.js';
import { emitJsonOutput } from '../json_output.js';

export interface CheckProvidersCommandOptions {
  workspace: string;
  format?: 'text' | 'json';
  out?: string;
}

export async function checkProvidersCommand(options: CheckProvidersCommandOptions): Promise<void> {
  const { workspace, format = 'text', out } = options;

  const gateResult = await runProviderReadinessGate(workspace, { emitReport: false });
  const status = await checkAllProviders({ workspaceRoot: workspace });
  const envVars = [
    'WAVE0_LLM_PROVIDER',
    'WAVE0_LLM_MODEL',
    'LIBRARIAN_LLM_PROVIDER',
    'LIBRARIAN_LLM_MODEL',
    'LIBRARIAN_EMBED_MODEL',
    'WAVE0_EMBED_MODEL',
  ];

  if (format === 'json') {
    const payload = {
      workspace,
      status,
      gate: gateResult,
      env: envVars.reduce<Record<string, string | null>>((acc, name) => {
        acc[name] = process.env[name] ?? null;
        return acc;
      }, {}),
    };
    await emitJsonOutput(payload, out);
    return;
  }

  console.log('Provider Availability Check');
  console.log('===========================\n');

  // Run the full provider readiness gate
  // (already computed above)

  // Output detailed results
  console.log('LLM Provider:');
  printKeyValue([
    { key: 'Available', value: status.llm.available },
    { key: 'Provider', value: status.llm.provider },
    { key: 'Model', value: status.llm.model },
    { key: 'Latency', value: `${status.llm.latencyMs}ms` },
  ]);
  if (status.llm.error) {
    console.log(`  Error: ${status.llm.error}`);
  }
  console.log();

  console.log('Embedding Provider:');
  printKeyValue([
    { key: 'Available', value: status.embedding.available },
    { key: 'Provider', value: status.embedding.provider },
    { key: 'Model', value: status.embedding.model },
    { key: 'Latency', value: `${status.embedding.latencyMs}ms` },
  ]);
  if (status.embedding.error) {
    console.log(`  Error: ${status.embedding.error}`);
  }
  console.log();

  // Show provider details from gate
  if (gateResult.providers.length > 0) {
    console.log('Provider Details:');
    printTable(
      ['Provider', 'Available', 'Authenticated', 'Error'],
      gateResult.providers.map((p) => [
        p.provider,
        p.available ? 'Yes' : 'No',
        p.authenticated ? 'Yes' : 'No',
        p.error || '-',
      ]),
    );
    console.log();
  }

  // Overall status
  console.log('Overall Status:');
  printKeyValue([
    { key: 'Ready', value: gateResult.ready },
    { key: 'Selected Provider', value: gateResult.selectedProvider || 'None' },
  ]);
  if (gateResult.reason) {
    console.log(`  Reason: ${gateResult.reason}`);
  }
  console.log();

  // Remediation steps
  if (gateResult.remediationSteps && gateResult.remediationSteps.length > 0) {
    console.log('Remediation Steps:');
    for (let i = 0; i < gateResult.remediationSteps.length; i++) {
      console.log(`  ${i + 1}. ${gateResult.remediationSteps[i]}`);
    }
    console.log();
  }

  // Environment variables
  console.log('Environment Variables:');
  for (const varName of envVars) {
    const value = process.env[varName];
    const display = value ? (varName.includes('KEY') ? '[SET]' : value) : '[NOT SET]';
    console.log(`  ${varName}: ${display}`);
  }
  console.log();

  // Recommendations
  if (!gateResult.ready) {
    console.log('Recommendations:');
    if (!status.llm.available) {
      console.log('  - Authenticate via CLI: Claude (`claude setup-token` or run `claude`), Codex (`codex login`)');
    }
    if (!status.embedding.available) {
      console.log('  - Install a real embedding provider: @xenova/transformers or sentence-transformers');
    }
    console.log();
  } else {
    console.log('All providers are ready. You can run `librarian bootstrap` to initialize.');
  }
}
