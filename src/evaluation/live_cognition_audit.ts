import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureWave0AdapterRegistration } from '../adapters/wave0_adapter_wiring.js';
import { createDefaultLlmServiceAdapter, type LlmChatMessage } from '../adapters/llm_service.js';
import { resolveLibrarianModelConfigWithDiscovery } from '../api/llm_env.js';
import { removeControlChars } from '../security/sanitization.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { TimeoutError, withTimeout } from '../utils/async.js';

export interface LiveCognitionAuditOptions {
  workspaceRoot: string;
  outputDir: string;
  objective: 'repo_thinking' | 'architectural_critique' | 'design_alternatives';
  maxTokens?: number;
  temperature?: number;
  budget?: Partial<LiveCognitionAuditBudget>;
}

export interface LiveCognitionAuditBudget {
  maxTopLevelFiles: number;
  maxDocs: number;
  maxDocBytes: number;
  maxTotalDocBytes: number;
  maxPromptChars: number;
  timeoutMs: number;
}

export interface LiveCognitionAuditReportV1 {
  schema: 'LiveCognitionAudit.v1';
  generatedAt: string;
  status: 'measured' | 'unverified_by_trace';
  workspaceRoot: string;
  model: { provider: string; modelId: string };
  objective: LiveCognitionAuditOptions['objective'];
  budget: LiveCognitionAuditBudget;
  measurement: {
    topLevelFilesDiscovered: number;
    topLevelFilesIncluded: number;
    docsIncluded: number;
    docsSkippedBudget: number;
    totalDocBytesIncluded: number;
    promptChars: number;
  };
  failure?: {
    reason: string;
    detail: string;
  };
  inputs: {
    topLevelFiles: string[];
    sampledDocs: Array<{ file: string; bytes: number; content: string }>;
  };
  output?: unknown;
  raw?: string;
}

export interface LiveCognitionAuditSuiteObjectiveResult {
  status: 'measured' | 'unverified_by_trace';
  reportPath?: string;
  failureReason?: string;
}

export interface LiveCognitionAuditSuiteReportV1 {
  schema: 'LiveCognitionAuditSuite.v1';
  generatedAt: string;
  status: 'measured' | 'unverified_by_trace';
  workspaceRoot: string;
  budget: LiveCognitionAuditBudget;
  objectives: Record<LiveCognitionAuditOptions['objective'], LiveCognitionAuditSuiteObjectiveResult>;
}

export class LiveCognitionAuditError extends Error {
  readonly reportPath: string;

  constructor(message: string, reportPath: string) {
    super(message);
    this.name = 'LiveCognitionAuditError';
    this.reportPath = reportPath;
  }
}

const DOC_CANDIDATES = [
  'README.md',
  'readme.md',
  'docs/README.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
];

const DEFAULT_BUDGET: LiveCognitionAuditBudget = {
  maxTopLevelFiles: 200,
  maxDocs: 6,
  maxDocBytes: 64 * 1024,
  maxTotalDocBytes: 196 * 1024,
  maxPromptChars: 250_000,
  timeoutMs: 120_000,
};

const ALL_OBJECTIVES: Array<LiveCognitionAuditOptions['objective']> = [
  'repo_thinking',
  'architectural_critique',
  'design_alternatives',
];

function sanitizeText(value: string): string {
  return removeControlChars(value).trim();
}

function resolveBudget(overrides?: Partial<LiveCognitionAuditBudget>): LiveCognitionAuditBudget {
  const merged: LiveCognitionAuditBudget = {
    ...DEFAULT_BUDGET,
    ...overrides,
  };
  if (
    merged.maxTopLevelFiles <= 0
    || merged.maxDocs <= 0
    || merged.maxDocBytes <= 0
    || merged.maxTotalDocBytes <= 0
    || merged.maxPromptChars <= 0
    || merged.timeoutMs <= 0
  ) {
    throw new Error('budget_invalid: all budget values must be positive');
  }
  return merged;
}

async function listTopLevelFiles(workspaceRoot: string, limit: number): Promise<string[]> {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

async function readSmallTextFile(
  workspaceRoot: string,
  relativeFilePath: string,
  maxBytes: number
): Promise<{ file: string; bytes: number; content: string } | null> {
  const filePath = path.join(workspaceRoot, relativeFilePath);
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return null;
    if (s.size > maxBytes) return null;
    const content = await readFile(filePath, 'utf8');
    return { file: relativeFilePath, bytes: s.size, content: sanitizeText(content) };
  } catch {
    return null;
  }
}

function buildPrompt(objective: LiveCognitionAuditOptions['objective']): { system: string; user: string } {
  const system =
    'You are a senior software engineer. Output MUST be strict JSON only (no markdown, no prose outside JSON). ' +
    'Do not fabricate file contents or repo facts. If you are uncertain, include an "unknowns" field.';

  if (objective === 'architectural_critique') {
    return {
      system,
      user:
        'Given the repo file list and selected docs, produce:\n' +
        '1) "critique": top 10 issues/risks (each {title, impact, evidence, recommendation})\n' +
        '2) "strengths": top 5 strengths\n' +
        '3) "unknowns": what you cannot infer from given inputs\n' +
        '4) "next_steps": top 10 concrete actions.\n' +
        'Return JSON with keys: critique, strengths, unknowns, next_steps.',
    };
  }

  if (objective === 'design_alternatives') {
    return {
      system,
      user:
        'Given the repo file list and selected docs, propose 3 design alternatives for improving the system as a codebase knowledge tool for agents.\n' +
        'Each alternative: {name, summary, key_trades, rollout_steps, validation}.\n' +
        'Return JSON with keys: alternatives, unknowns.',
    };
  }

  return {
    system,
    user:
      'Given the repo file list and selected docs, summarize:\n' +
      '1) "architecture_overview"\n' +
      '2) "entrypoints"\n' +
      '3) "critical_paths"\n' +
      '4) "unknowns"\n' +
      'Return JSON with keys: architecture_overview, entrypoints, critical_paths, unknowns.',
  };
}

function classifyFailure(error: unknown): { reason: string; detail: string } {
  const detail = sanitizeText(error instanceof Error ? error.message : String(error)).slice(0, 400);

  if (error instanceof TimeoutError || /timeout/i.test(detail)) {
    return {
      reason: 'unverified_by_trace(cognition_timeout)',
      detail,
    };
  }
  if (/llm_output_invalid_json/i.test(detail)) {
    return {
      reason: 'unverified_by_trace(llm_output_invalid_json)',
      detail,
    };
  }
  if (/budget_/i.test(detail)) {
    return {
      reason: 'unverified_by_trace(cognition_budget_exhausted)',
      detail,
    };
  }
  if (/provider|authentication|api key|rate limit|limit reached|unavailable/i.test(detail)) {
    return {
      reason: 'unverified_by_trace(provider_unavailable)',
      detail,
    };
  }
  return {
    reason: 'unverified_by_trace(cognition_audit_failed)',
    detail,
  };
}

export async function runLiveCognitionAudit(
  options: LiveCognitionAuditOptions
): Promise<{ reportPath: string; report: LiveCognitionAuditReportV1 }> {
  const { workspaceRoot, outputDir, objective } = options;
  const maxTokens = options.maxTokens ?? 1200;
  const temperature = options.temperature ?? 0.2;
  const budget = resolveBudget(options.budget);

  let topLevelFiles: string[] = [];
  const sampledDocs: Array<{ file: string; bytes: number; content: string }> = [];
  let docsSkippedBudget = 0;
  let totalDocBytesIncluded = 0;
  let promptChars = 0;

  const writeReport = async (
    report: LiveCognitionAuditReportV1
  ): Promise<string> => {
    await mkdir(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `LiveCognitionAudit.v1_${Date.now()}.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return reportPath;
  };

  try {
    await ensureWave0AdapterRegistration(workspaceRoot);
    const model = await resolveLibrarianModelConfigWithDiscovery();
    const llm = createDefaultLlmServiceAdapter();

    topLevelFiles = await listTopLevelFiles(workspaceRoot, budget.maxTopLevelFiles);
    for (const candidate of DOC_CANDIDATES) {
      const doc = await readSmallTextFile(workspaceRoot, candidate, budget.maxDocBytes);
      if (!doc) continue;
      if (sampledDocs.length >= budget.maxDocs) {
        docsSkippedBudget += 1;
        continue;
      }
      if ((totalDocBytesIncluded + doc.bytes) > budget.maxTotalDocBytes) {
        docsSkippedBudget += 1;
        continue;
      }
      sampledDocs.push(doc);
      totalDocBytesIncluded += doc.bytes;
    }

    if (sampledDocs.length === 0) {
      throw new Error('budget_docs_exhausted: no documentation input within budget');
    }

    const { system, user } = buildPrompt(objective);
    const messages: LlmChatMessage[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `${user}\n\n` +
          `Repo top-level files:\n${topLevelFiles.join('\n')}\n\n` +
          `Selected docs:\n` +
          sampledDocs.map((doc) => `--- ${doc.file} (${doc.bytes} bytes)\n${doc.content}`).join('\n\n'),
      },
    ];

    promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (promptChars > budget.maxPromptChars) {
      throw new Error(`budget_prompt_exhausted: prompt chars ${promptChars} exceed ${budget.maxPromptChars}`);
    }

    const response = await withTimeout(
      llm.chat({
        provider: model.provider,
        modelId: model.modelId,
        messages,
        maxTokens,
        temperature,
        disableTools: true,
      }),
      budget.timeoutMs,
      { context: 'live_cognition_audit.llm_chat', errorCode: 'COGNITION_TIMEOUT' }
    );

    const raw = sanitizeText(response.content);
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      throw new Error(`llm_output_invalid_json: ${parsed.error}`);
    }

    const report: LiveCognitionAuditReportV1 = {
      schema: 'LiveCognitionAudit.v1',
      generatedAt: new Date().toISOString(),
      status: 'measured',
      workspaceRoot,
      model: { provider: model.provider, modelId: model.modelId },
      objective,
      budget,
      measurement: {
        topLevelFilesDiscovered: topLevelFiles.length,
        topLevelFilesIncluded: topLevelFiles.length,
        docsIncluded: sampledDocs.length,
        docsSkippedBudget,
        totalDocBytesIncluded,
        promptChars,
      },
      inputs: { topLevelFiles, sampledDocs },
      output: parsed.value,
      raw,
    };

    const reportPath = await writeReport(report);
    return { reportPath, report };
  } catch (error) {
    const model = await resolveLibrarianModelConfigWithDiscovery().catch(() => ({
      provider: 'unknown',
      modelId: 'unknown',
    }));
    const failure = classifyFailure(error);
    const report: LiveCognitionAuditReportV1 = {
      schema: 'LiveCognitionAudit.v1',
      generatedAt: new Date().toISOString(),
      status: 'unverified_by_trace',
      workspaceRoot,
      model: { provider: model.provider, modelId: model.modelId },
      objective,
      budget,
      measurement: {
        topLevelFilesDiscovered: topLevelFiles.length,
        topLevelFilesIncluded: topLevelFiles.length,
        docsIncluded: sampledDocs.length,
        docsSkippedBudget,
        totalDocBytesIncluded,
        promptChars,
      },
      failure,
      inputs: { topLevelFiles, sampledDocs },
    };
    const reportPath = await writeReport(report);
    throw new LiveCognitionAuditError(`${failure.reason}: ${failure.detail}`, reportPath);
  }
}

export async function runLiveCognitionAuditSuite(options: {
  workspaceRoot: string;
  outputDir: string;
  maxTokens?: number;
  temperature?: number;
  budget?: Partial<LiveCognitionAuditBudget>;
}): Promise<{ reportPath: string; report: LiveCognitionAuditSuiteReportV1 }> {
  const budget = resolveBudget(options.budget);
  const objectiveResults: Record<LiveCognitionAuditOptions['objective'], LiveCognitionAuditSuiteObjectiveResult> = {
    repo_thinking: { status: 'unverified_by_trace' },
    architectural_critique: { status: 'unverified_by_trace' },
    design_alternatives: { status: 'unverified_by_trace' },
  };

  for (const objective of ALL_OBJECTIVES) {
    try {
      const result = await runLiveCognitionAudit({
        workspaceRoot: options.workspaceRoot,
        outputDir: path.join(options.outputDir, objective),
        objective,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        budget,
      });
      objectiveResults[objective] = {
        status: result.report.status,
        reportPath: result.reportPath,
      };
    } catch (error) {
      const message = sanitizeText(error instanceof Error ? error.message : String(error)).slice(0, 300);
      const reportPath = error instanceof LiveCognitionAuditError ? error.reportPath : undefined;
      objectiveResults[objective] = {
        status: 'unverified_by_trace',
        reportPath,
        failureReason: message,
      };
    }
  }

  const failedObjectives = ALL_OBJECTIVES.filter((objective) => objectiveResults[objective].status !== 'measured');
  const report: LiveCognitionAuditSuiteReportV1 = {
    schema: 'LiveCognitionAuditSuite.v1',
    generatedAt: new Date().toISOString(),
    status: failedObjectives.length === 0 ? 'measured' : 'unverified_by_trace',
    workspaceRoot: options.workspaceRoot,
    budget,
    objectives: objectiveResults,
  };

  await mkdir(options.outputDir, { recursive: true });
  const reportPath = path.join(options.outputDir, `LiveCognitionAuditSuite.v1_${Date.now()}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (failedObjectives.length > 0) {
    throw new LiveCognitionAuditError(
      `unverified_by_trace(cognition_suite_incomplete): ${failedObjectives.join(',')}`,
      reportPath
    );
  }

  return { reportPath, report };
}
