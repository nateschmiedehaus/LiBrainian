import { emitJsonOutput } from '../json_output.js';
import { generatePrivacyReport } from '../../security/privacy_audit.js';
import { printKeyValue } from '../progress.js';

export interface PrivacyReportCommandOptions {
  workspace: string;
  since?: string;
  format?: 'text' | 'json';
  out?: string;
}

export async function privacyReportCommand(options: PrivacyReportCommandOptions): Promise<number> {
  const { workspace, since, format = 'text', out } = options;
  const summary = await generatePrivacyReport(workspace, { since });
  const payload = {
    workspace,
    requestedSince: since ?? null,
    ...summary,
  };

  if (format === 'json') {
    await emitJsonOutput(payload, out);
    return summary.externalContentSentEvents === 0 ? 0 : 1;
  }

  console.log('Privacy Report');
  console.log('==============\n');
  printKeyValue([
    { key: 'Workspace', value: workspace },
    { key: 'Log Path', value: summary.logPath },
    { key: 'From', value: summary.since ?? 'n/a' },
    { key: 'Until', value: summary.until ?? 'n/a' },
    { key: 'Total Events', value: summary.totalEvents },
    { key: 'Blocked Events', value: summary.blockedEvents },
    { key: 'Local-Only Events', value: summary.localOnlyEvents },
    { key: 'External Content Sent', value: summary.externalContentSentEvents },
  ]);
  console.log();

  if (Object.keys(summary.operations).length > 0) {
    console.log('Operations:');
    printKeyValue(
      Object.entries(summary.operations).map(([key, value]) => ({
        key,
        value,
      })),
    );
    console.log();
  }

  if (summary.externalContentSentEvents === 0) {
    console.log('Compliance Summary: 0 external API calls sent file content.');
    return 0;
  }

  console.log('Compliance Summary: external content transmission detected. Review privacy.log immediately.');
  return 1;
}
