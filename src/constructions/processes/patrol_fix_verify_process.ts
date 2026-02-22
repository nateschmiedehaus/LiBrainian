import type { Construction } from '../types.js';
import { fail, ok, unwrapConstructionExecutionResult } from '../types.js';
import { atom, seq } from '../operators.js';
import { ConstructionError, ConstructionInputError } from '../base/construction_base.js';
import type { ProcessInput, ProcessOutput } from './process_base.js';
import { createAgentDispatchConstruction } from './agent_dispatch_construction.js';
import { createObservationExtractionConstruction } from './observation_extraction_construction.js';

const ISSUE_URL_PATTERN = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+/;
const PR_URL_PATTERN = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/;

export interface PatrolFixVerifyCommandConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  dryRun?: boolean;
}

export interface PatrolFixVerifyInput extends ProcessInput {
  trigger?: 'manual' | 'schedule';
  knownBugHint?: string;
  patrolScan?: PatrolFixVerifyCommandConfig;
  issueFiler?: PatrolFixVerifyCommandConfig;
  fixGenerator?: PatrolFixVerifyCommandConfig;
  regressionTest?: PatrolFixVerifyCommandConfig;
  fixVerifier?: PatrolFixVerifyCommandConfig;
}

export interface PatrolFinding {
  category: string;
  severity: string;
  title: string;
  detail: string;
}

export interface PatrolScanResult {
  commandLine: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  findings: PatrolFinding[];
  stdout: string;
  stderr: string;
}

export interface IssueFilerResult {
  issueUrl: string;
  commandLine: string;
  exitCode: number | null;
  durationMs: number;
}

export interface FixGeneratorResult {
  prUrl: string;
  commandLine: string;
  exitCode: number | null;
  durationMs: number;
}

export interface RegressionTestResult {
  passed: boolean;
  generatedTests: string[];
  commandLine: string;
  exitCode: number | null;
  durationMs: number;
}

export interface FixVerifierResult {
  passed: boolean;
  commandLine: string;
  exitCode: number | null;
  durationMs: number;
}

interface PatrolFixVerifyState {
  input: PatrolFixVerifyInput;
  trigger: 'manual' | 'schedule';
  startedAtMs: number;
  patrol?: PatrolScanResult;
  issue?: IssueFilerResult;
  fix?: FixGeneratorResult;
  regression?: RegressionTestResult;
  verifier?: FixVerifierResult;
}

export interface PatrolFixVerifyOutput extends ProcessOutput {
  kind: 'PatrolFixVerifyResult.v1';
  trigger: 'manual' | 'schedule';
  issueUrl: string;
  fixPrUrl: string;
  findings: PatrolFinding[];
  regressionTest: RegressionTestResult;
  verification: FixVerifierResult;
}

function syntheticPatrolOutput(knownBugHint: string): string {
  return [
    'PATROL_OBS: {"type":"negative","category":"api","severity":"high","title":"Known bug reproduced","detail":"Synthetic patrol finding for closed-loop validation."}',
    'PATROL_OBSERVATION_JSON_START',
    JSON.stringify({
      overallVerdict: {
        npsScore: 5,
        wouldRecommend: false,
      },
      negativeFindingsMandatory: [
        {
          category: 'api',
          severity: 'high',
          title: `Known bug: ${knownBugHint}`,
          detail: 'Patrol identified a deterministic bug used to validate fix pipeline.',
        },
      ],
    }),
    'PATROL_OBSERVATION_JSON_END',
  ].join('\n');
}

function ensureFindingList(
  findings: PatrolFinding[],
  fallbackHint: string,
): PatrolFinding[] {
  if (findings.length > 0) return findings;
  return [
    {
      category: 'api',
      severity: 'high',
      title: `Known bug: ${fallbackHint}`,
      detail: 'Fallback finding generated because patrol output had no parseable findings.',
    },
  ];
}

function extractFirstUrl(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0];
}

function parseGeneratedTests(output: string): string[] {
  const tests = output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('GENERATED_TEST:'))
    .map((line) => line.slice('GENERATED_TEST:'.length).trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(tests));
}

function isDryRun(config?: PatrolFixVerifyCommandConfig): boolean {
  return config?.dryRun !== false || !config?.command;
}

export function createPatrolScanConstruction(): Construction<
  PatrolFixVerifyState,
  PatrolFixVerifyState,
  ConstructionError,
  unknown
> {
  const dispatchConstruction = createAgentDispatchConstruction();
  const extractionConstruction = createObservationExtractionConstruction();

  return atom(
    'patrol-fix-verify:patrol-scan',
    async (state) => {
      const knownBugHint = state.input.knownBugHint ?? 'hallucinated package method reference';
      const config = state.input.patrolScan;
      let commandLine = 'synthetic:patrol-scan';
      let exitCode: number | null = 0;
      let timedOut = false;
      let durationMs = 0;
      let stdout = syntheticPatrolOutput(knownBugHint);
      let stderr = '';

      if (!isDryRun(config)) {
        const dispatch = unwrapConstructionExecutionResult(await dispatchConstruction.execute({
          command: config!.command!,
          args: config?.args ?? [],
          cwd: config?.cwd,
          env: config?.env,
          timeoutMs: config?.timeoutMs ?? state.input.timeoutMs,
        }));
        commandLine = dispatch.commandLine;
        exitCode = dispatch.exitCode;
        timedOut = dispatch.timedOut;
        durationMs = dispatch.durationMs;
        stdout = dispatch.stdout;
        stderr = dispatch.stderr;
      }

      const extraction = unwrapConstructionExecutionResult(
        await extractionConstruction.execute({ output: stdout }),
      );
      const observation = extraction.fullObservation as
        | { negativeFindingsMandatory?: unknown[] }
        | null;
      const parsed = (observation?.negativeFindingsMandatory ?? [])
        .filter((value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
        .map((entry) => ({
          category: String(entry.category ?? 'unknown'),
          severity: String(entry.severity ?? 'medium'),
          title: String(entry.title ?? 'Untitled finding'),
          detail: String(entry.detail ?? ''),
        }));

      return {
        ...state,
        patrol: {
          commandLine,
          exitCode,
          timedOut,
          durationMs,
          stdout,
          stderr,
          findings: ensureFindingList(parsed, knownBugHint),
        },
      };
    },
    'PatrolScanConstruction',
  );
}

export function createIssueFilerConstruction(): Construction<
  PatrolFixVerifyState,
  PatrolFixVerifyState,
  ConstructionError,
  unknown
> {
  const dispatchConstruction = createAgentDispatchConstruction();

  return atom(
    'patrol-fix-verify:issue-filer',
    async (state) => {
      const finding = state.patrol?.findings[0];
      if (!finding) {
        throw new ConstructionInputError(
          'Issue filing requires at least one patrol finding',
          'patrol-fix-verify:issue-filer',
          'patrol.findings[0]',
        );
      }

      const config = state.input.issueFiler;
      let commandLine = 'synthetic:issue-filer';
      let exitCode: number | null = 0;
      let durationMs = 0;
      let issueUrl = 'https://github.com/example/LiBrainian/issues/1';

      if (!isDryRun(config)) {
        const dispatch = unwrapConstructionExecutionResult(await dispatchConstruction.execute({
          command: config!.command!,
          args: config?.args ?? [],
          cwd: config?.cwd,
          env: {
            ...config?.env,
            LIBRAINIAN_FINDING_TITLE: finding.title,
            LIBRAINIAN_FINDING_DETAIL: finding.detail,
          },
          timeoutMs: config?.timeoutMs ?? state.input.timeoutMs,
        }));
        commandLine = dispatch.commandLine;
        exitCode = dispatch.exitCode;
        durationMs = dispatch.durationMs;
        const parsedIssueUrl = extractFirstUrl(`${dispatch.stdout}\n${dispatch.stderr}`, ISSUE_URL_PATTERN);
        if (!parsedIssueUrl) {
          throw new ConstructionError(
            'Issue filer command did not emit a GitHub issue URL',
            'patrol-fix-verify:issue-filer',
          );
        }
        issueUrl = parsedIssueUrl;
      }

      return {
        ...state,
        issue: {
          issueUrl,
          commandLine,
          exitCode,
          durationMs,
        },
      };
    },
    'IssueFilerConstruction',
  );
}

export function createFixGeneratorConstruction(): Construction<
  PatrolFixVerifyState,
  PatrolFixVerifyState,
  ConstructionError,
  unknown
> {
  const dispatchConstruction = createAgentDispatchConstruction();

  return atom(
    'patrol-fix-verify:fix-generator',
    async (state) => {
      const issueUrl = state.issue?.issueUrl;
      if (!issueUrl) {
        throw new ConstructionInputError(
          'Fix generation requires issueUrl from issue filer step',
          'patrol-fix-verify:fix-generator',
          'issue.issueUrl',
        );
      }

      const config = state.input.fixGenerator;
      let commandLine = 'synthetic:fix-generator';
      let exitCode: number | null = 0;
      let durationMs = 0;
      let prUrl = 'https://github.com/example/LiBrainian/pull/1';

      if (!isDryRun(config)) {
        const dispatch = unwrapConstructionExecutionResult(await dispatchConstruction.execute({
          command: config!.command!,
          args: config?.args ?? [],
          cwd: config?.cwd,
          env: {
            ...config?.env,
            LIBRAINIAN_ISSUE_URL: issueUrl,
          },
          timeoutMs: config?.timeoutMs ?? state.input.timeoutMs,
        }));
        commandLine = dispatch.commandLine;
        exitCode = dispatch.exitCode;
        durationMs = dispatch.durationMs;
        const parsedPrUrl = extractFirstUrl(`${dispatch.stdout}\n${dispatch.stderr}`, PR_URL_PATTERN);
        if (!parsedPrUrl) {
          throw new ConstructionError(
            'Fix generator command did not emit a GitHub pull request URL',
            'patrol-fix-verify:fix-generator',
          );
        }
        prUrl = parsedPrUrl;
      }

      return {
        ...state,
        fix: {
          prUrl,
          commandLine,
          exitCode,
          durationMs,
        },
      };
    },
    'FixGeneratorConstruction',
  );
}

export function createRegressionTestConstruction(): Construction<
  PatrolFixVerifyState,
  PatrolFixVerifyState,
  ConstructionError,
  unknown
> {
  const dispatchConstruction = createAgentDispatchConstruction();

  return atom(
    'patrol-fix-verify:regression-test',
    async (state) => {
      const config = state.input.regressionTest;
      let commandLine = 'synthetic:regression-test';
      let exitCode: number | null = 0;
      let durationMs = 0;
      let generatedTests = ['src/__tests__/regressions/known_bug_regression.test.ts'];

      if (!isDryRun(config)) {
        const dispatch = unwrapConstructionExecutionResult(await dispatchConstruction.execute({
          command: config!.command!,
          args: config?.args ?? [],
          cwd: config?.cwd,
          env: config?.env,
          timeoutMs: config?.timeoutMs ?? state.input.timeoutMs,
        }));
        commandLine = dispatch.commandLine;
        exitCode = dispatch.exitCode;
        durationMs = dispatch.durationMs;
        generatedTests = parseGeneratedTests(dispatch.stdout);
      }

      return {
        ...state,
        regression: {
          passed: exitCode === 0,
          generatedTests,
          commandLine,
          exitCode,
          durationMs,
        },
      };
    },
    'RegressionTestConstruction',
  );
}

export function createFixVerifierConstruction(): Construction<
  PatrolFixVerifyState,
  PatrolFixVerifyState,
  ConstructionError,
  unknown
> {
  const dispatchConstruction = createAgentDispatchConstruction();

  return atom(
    'patrol-fix-verify:fix-verifier',
    async (state) => {
      const config = state.input.fixVerifier;
      let commandLine = 'synthetic:fix-verifier';
      let exitCode: number | null = 0;
      let durationMs = 0;

      if (!isDryRun(config)) {
        const dispatch = unwrapConstructionExecutionResult(await dispatchConstruction.execute({
          command: config!.command!,
          args: config?.args ?? [],
          cwd: config?.cwd,
          env: config?.env,
          timeoutMs: config?.timeoutMs ?? state.input.timeoutMs,
        }));
        commandLine = dispatch.commandLine;
        exitCode = dispatch.exitCode;
        durationMs = dispatch.durationMs;
      } else if (state.regression?.passed === false) {
        exitCode = 1;
      }

      return {
        ...state,
        verifier: {
          passed: exitCode === 0,
          commandLine,
          exitCode,
          durationMs,
        },
      };
    },
    'FixVerifierConstruction',
  );
}

function createPatrolFixVerifyPipeline(): Construction<
  PatrolFixVerifyState,
  PatrolFixVerifyState,
  ConstructionError,
  unknown
> {
  return seq(
    seq(
      seq(
        seq(
          createPatrolScanConstruction(),
          createIssueFilerConstruction(),
          'patrol-fix-verify:pipeline:scan>issue',
          'PatrolThenIssue',
        ),
        createFixGeneratorConstruction(),
        'patrol-fix-verify:pipeline:scan>issue>fix',
        'PatrolIssueFix',
      ),
      createRegressionTestConstruction(),
      'patrol-fix-verify:pipeline:scan>issue>fix>regression',
      'PatrolIssueFixRegression',
    ),
    createFixVerifierConstruction(),
    'patrol-fix-verify:pipeline:scan>issue>fix>regression>verify',
    'PatrolIssueFixRegressionVerify',
  );
}

export const PATROL_FIX_VERIFY_DESCRIPTION =
  'Closed-loop construction pipeline: patrol scan -> issue filing -> fix generation -> regression test -> fix verification.';

export const PATROL_FIX_VERIFY_EXAMPLE_INPUT: PatrolFixVerifyInput = {
  trigger: 'manual',
  knownBugHint: 'hallucinated package method reference',
  patrolScan: { dryRun: true },
  issueFiler: { dryRun: true },
  fixGenerator: { dryRun: true },
  regressionTest: { dryRun: true },
  fixVerifier: { dryRun: true },
};

export function createPatrolFixVerifyProcessConstruction(): Construction<
  PatrolFixVerifyInput,
  PatrolFixVerifyOutput,
  ConstructionError,
  unknown
> {
  const pipeline = createPatrolFixVerifyPipeline();
  return {
    id: 'patrol-fix-verify-process',
    name: 'Patrol Fix Verify Process',
    description: PATROL_FIX_VERIFY_DESCRIPTION,
    async execute(input: PatrolFixVerifyInput) {
      const trigger = input.trigger ?? 'manual';
      const startedAtMs = Date.now();
      const initialState: PatrolFixVerifyState = {
        input,
        trigger,
        startedAtMs,
      };

      const pipelineResult = await pipeline.execute(initialState);
      if (!pipelineResult.ok) {
        return fail<PatrolFixVerifyOutput, ConstructionError>(
          pipelineResult.error,
          undefined,
          pipelineResult.errorAt,
        );
      }

      const finalState = pipelineResult.value;
      if (!finalState.issue?.issueUrl) {
        return fail(
          new ConstructionError(
            'Closed-loop pipeline completed without issue URL output',
            'patrol-fix-verify-process',
          ),
        );
      }
      if (!finalState.fix?.prUrl) {
        return fail(
          new ConstructionError(
            'Closed-loop pipeline completed without fix PR URL output',
            'patrol-fix-verify-process',
          ),
        );
      }
      if (!finalState.regression) {
        return fail(
          new ConstructionError(
            'Closed-loop pipeline completed without regression test output',
            'patrol-fix-verify-process',
          ),
        );
      }
      if (!finalState.verifier) {
        return fail(
          new ConstructionError(
            'Closed-loop pipeline completed without verification output',
            'patrol-fix-verify-process',
          ),
        );
      }

      const completed = finalState.regression.passed && finalState.verifier.passed;
      return ok<PatrolFixVerifyOutput, ConstructionError>({
        kind: 'PatrolFixVerifyResult.v1',
        trigger,
        issueUrl: finalState.issue.issueUrl,
        fixPrUrl: finalState.fix.prUrl,
        findings: finalState.patrol?.findings ?? [],
        regressionTest: finalState.regression,
        verification: finalState.verifier,
        observations: {
          patrol: finalState.patrol,
          issue: finalState.issue,
          fix: finalState.fix,
          regression: finalState.regression,
          verification: finalState.verifier,
        },
        costSummary: {
          durationMs: Date.now() - finalState.startedAtMs,
        },
        exitReason: completed ? 'completed' : 'failed',
        events: [
          {
            stage: 'patrol-fix-verify',
            type: completed ? 'stage_end' : 'warning',
            timestamp: new Date().toISOString(),
            detail: completed
              ? 'closed_loop_completed'
              : 'closed_loop_failed_verification',
          },
        ],
      });
    },
  };
}
