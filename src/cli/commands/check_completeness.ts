import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import { emitJsonOutput } from '../json_output.js';
import { createError } from '../errors.js';
import {
  runCompletenessOracle,
  type CompletenessOracleReport,
  type CompletenessCounterevidence,
} from '../../api/completeness_oracle.js';

export interface CheckCompletenessCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type OutputFormat = 'text' | 'json';

interface ParsedOptions {
  mode: 'auto' | 'changed' | 'full';
  supportThreshold: number;
  format: OutputFormat;
  out?: string;
  changedFiles: string[];
}

export async function checkCompletenessCommand(options: CheckCompletenessCommandOptions): Promise<number> {
  const parseSource = options.rawArgs.length > 1 ? options.rawArgs.slice(1) : options.args;
  const parsed = parseOptions(parseSource);
  const workspaceRoot = path.resolve(options.workspace);

  const dbPath = await resolveDbPath(workspaceRoot);
  const storage = createSqliteStorage(dbPath, workspaceRoot);

  try {
    await storage.initialize();
  } catch {
    const report = createUncheckedReport(workspaceRoot, parsed.mode, 'Run librainian bootstrap first.');
    await emitReport(report, parsed.format, parsed.out);
    return 2;
  }

  try {
    const bootstrap = await isBootstrapRequired(workspaceRoot, storage);
    if (bootstrap.required) {
      const report = createUncheckedReport(workspaceRoot, parsed.mode, 'Run librainian bootstrap first.');
      await emitReport(report, parsed.format, parsed.out);
      return 2;
    }

    const report = await runCompletenessOracle({
      workspaceRoot,
      storage,
      mode: parsed.mode,
      supportThreshold: parsed.supportThreshold,
      changedFiles: parsed.changedFiles,
    });

    await emitReport(report, parsed.format, parsed.out);

    if (report.gaps.length > 0) return 1;
    return 0;
  } finally {
    await storage.close();
  }
}

function parseOptions(args: string[]): ParsedOptions {
  const { values } = parseArgs({
    args,
    options: {
      mode: { type: 'string' },
      'support-threshold': { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      'changed-files': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const modeValue = typeof values.mode === 'string' ? values.mode.trim().toLowerCase() : 'auto';
  if (modeValue !== 'auto' && modeValue !== 'changed' && modeValue !== 'full') {
    throw createError('INVALID_ARGUMENT', 'Invalid --mode. Expected auto|changed|full');
  }

  const thresholdRaw = typeof values['support-threshold'] === 'string'
    ? Number(values['support-threshold'])
    : 5;
  if (!Number.isFinite(thresholdRaw) || thresholdRaw < 1) {
    throw createError('INVALID_ARGUMENT', 'Invalid --support-threshold. Expected a positive integer.');
  }

  const rawFormat = (values.json ? 'json' : values.format) ?? 'text';
  if (rawFormat !== 'text' && rawFormat !== 'json') {
    throw createError('INVALID_ARGUMENT', 'Invalid --format. Expected text|json');
  }

  const out = typeof values.out === 'string' && values.out.trim().length > 0
    ? values.out.trim()
    : undefined;

  const changedFiles = parseCommaSeparated(values['changed-files']);

  return {
    mode: modeValue,
    supportThreshold: Math.max(1, Math.trunc(thresholdRaw)),
    format: rawFormat,
    out,
    changedFiles,
  };
}

function parseCommaSeparated(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  return Array.from(new Set(value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)));
}

type UncheckedReport = {
  kind: 'LibrarianCompletenessCheck.v1';
  status: 'unchecked';
  workspace: string;
  mode: string;
  message: string;
  generatedAt: string;
};

function createUncheckedReport(workspace: string, mode: string, message: string): UncheckedReport {
  return {
    kind: 'LibrarianCompletenessCheck.v1',
    status: 'unchecked',
    workspace,
    mode,
    message,
    generatedAt: new Date().toISOString(),
  };
}

async function emitReport(
  report: CompletenessOracleReport | UncheckedReport,
  format: OutputFormat,
  out?: string,
): Promise<void> {
  if (format === 'json') {
    await emitJsonOutput(report, out);
    return;
  }

  const text = renderText(report);
  await writeOutput(text, out);
}

function renderText(report: CompletenessOracleReport | UncheckedReport): string {
  const lines: string[] = [
    'LiBrainian Completeness Check',
    '=============================',
    `Workspace: ${report.workspace}`,
    `Mode: ${report.mode}`,
    `Generated: ${report.generatedAt}`,
  ];

  if ('status' in report && report.status === 'unchecked') {
    lines.push('', `Status: ${report.status.toUpperCase()}`, report.message);
    return lines.join('\n');
  }

  const checkedReport = report as CompletenessOracleReport;

  lines.push(
    '',
    `Checked elements: ${checkedReport.checkedElements}`,
    `Templates: ${checkedReport.templates.length}`,
    `Enforced gaps: ${checkedReport.gaps.length}`,
    `Informational suggestions: ${checkedReport.suggestions.length}`,
    `Counterevidence matched/suppressed: ${checkedReport.counterevidence.matched}/${checkedReport.counterevidence.suppressed}`,
    `False-positive estimate: ${(checkedReport.falsePositiveRateEstimate * 100).toFixed(1)}%`,
  );

  if (checkedReport.gaps.length > 0) {
    lines.push('', 'Enforced gaps:');
    for (const gap of checkedReport.gaps.slice(0, 20)) {
      lines.push(`- ${gap.file}: missing ${gap.artifact} (confidence=${gap.confidence.toFixed(2)} support=${gap.support})`);
      if (gap.examples.length > 0) {
        lines.push(`  examples: ${gap.examples.join(', ')}`);
      }
    }
  }

  if (checkedReport.suggestions.length > 0) {
    lines.push('', 'Informational suggestions:');
    for (const gap of checkedReport.suggestions.slice(0, 20)) {
      lines.push(`- ${gap.file}: consider ${gap.artifact} (support=${gap.support})`);
    }
  }

  return lines.join('\n');
}

async function writeOutput(content: string, out?: string): Promise<void> {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  if (!out) {
    console.log(normalized.trimEnd());
    return;
  }

  const resolved = path.resolve(out);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, normalized, 'utf8');
  process.stderr.write(`Output written to ${resolved}\n`);
}

export function normalizeCounterevidenceInput(input: unknown): CompletenessCounterevidence[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const artifact = typeof entry.artifact === 'string' ? entry.artifact : '';
      const reason = typeof entry.reason === 'string' ? entry.reason : '';
      const pattern = typeof entry.pattern === 'string' ? entry.pattern : undefined;
      const filePattern = typeof entry.filePattern === 'string' ? entry.filePattern : undefined;
      const weight = typeof entry.weight === 'number' ? entry.weight : undefined;
      return {
        artifact,
        reason,
        pattern,
        filePattern,
        weight,
      } as CompletenessCounterevidence;
    })
    .filter((entry) => entry.artifact.length > 0 && entry.reason.length > 0);
}
