import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluatePublishReadiness,
  publishGateCommand,
  type PublishGateSignal,
} from '../publish_gate.js';

const STATUS_OK = '# Status\n\n| Metric | Status |\n| --- | --- |\n| answer relevancy | MET |\n';
const STATUS_NOT_MET = '# Status\n\n| Metric | Status |\n| --- | --- |\n| answer relevancy | NOT MET |\n';

const GATES_OK = {
  summary: {
    layer0: { pass: 1, total: 1 },
  },
  tasks: {
    ready: { status: 'pass' },
  },
};

const PASSING_SIGNALS: PublishGateSignal[] = [
  { id: 'release.live_fire_quick', path: '/tmp/live-fire.json', status: 'pass', message: 'Live-fire quick gate passed', ageHours: 1 },
  { id: 'release.agentic_use_case_review', path: '/tmp/use-cases.json', status: 'pass', message: 'Agentic use-case review gate passed', ageHours: 1 },
  { id: 'release.external_smoke_sample', path: '/tmp/smoke.json', status: 'pass', message: 'External smoke sample passed', ageHours: 1 },
  { id: 'release.testing_discipline', path: '/tmp/testing-discipline.json', status: 'pass', message: 'Testing-discipline gate passed', ageHours: 1 },
  { id: 'release.testing_tracker', path: '/tmp/testing-tracker.json', status: 'pass', message: 'Testing tracker gate passed', ageHours: 1 },
  { id: 'release.conversation_insights_review', path: '/tmp/CONVERSATION_INSIGHTS.md', status: 'pass', message: 'Conversation insights review gate passed', ageHours: 1 },
];

function conversationInsightsMarkdown(): string {
  return [
    '# Conversation Insights',
    '',
    '## Context Snapshot',
    '- Date: 2026-03-20',
    '- Objective: first public release readiness',
    '',
    '## Non-Negotiable Product Signals',
    '- Release evidence is fail-closed.',
    '',
    '## Agent Failure Modes Observed',
    '- Blind retry loops.',
    '',
    '## OpenClaw Patterns to Borrow (Mapped to LiBrainian files)',
    '- Keep the shipped surface narrower than the internal repo surface.',
    '',
    '## Action Items',
    '- Remove dead release lanes from the active contract.',
    '',
    '## Accepted Wording for Positioning',
    '- LiBrainian is a codebase intelligence layer for serious coding agents.',
    '',
    '## Deferred Ideas',
    '- Reintroduce comparative A/B release evidence only after the subsystem is rebuilt.',
    '',
    '## Evidence Links',
    '- `package.json`',
    '- `src/cli/commands/publish_gate.ts`',
    '',
    '### Release Gate Signoff Checklist',
    '- [x] conversation_insights_review_complete',
    '- [x] zero_fallback_retry_degraded_confirmed',
    '',
  ].join('\n');
}

function createLiveFireReport(reposRoot: string) {
  return {
    schema: 'LiveFireTrialReport.v1',
    gates: { passed: true },
    aggregate: { passRate: 1, totalRuns: 2 },
    options: {
      reposRoot,
      llmModes: ['disabled', 'optional'],
      protocol: 'objective',
      strictObjective: true,
      includeSmoke: true,
    },
    runs: [
      { llmMode: 'disabled', journey: { total: 1 }, smoke: { total: 1 } },
      { llmMode: 'optional', journey: { total: 1 }, smoke: { total: 1 } },
    ],
  };
}

function createUseCaseReport(reposRoot: string) {
  return {
    schema: 'AgenticUseCaseReviewReport.v1',
    options: {
      reposRoot,
      selectionMode: 'balanced',
      deterministicQueries: false,
      evidenceProfile: 'release',
    },
    summary: {
      passRate: 0.9,
      evidenceRate: 0.95,
      usefulSummaryRate: 0.9,
      strictFailureShare: 0,
      uniqueRepos: 6,
      progression: {
        enabled: true,
        prerequisitePassRate: 0.9,
        targetPassRate: 0.9,
        targetDependencyReadyShare: 1,
      },
    },
    gate: {
      passed: true,
      thresholds: {
        minPassRate: 0.75,
        minEvidenceRate: 0.9,
        minUsefulSummaryRate: 0.8,
        maxStrictFailureShare: 0,
        minPrerequisitePassRate: 0.75,
        minTargetPassRate: 0.75,
        minTargetDependencyReadyShare: 1,
      },
    },
  };
}

function createSmokeReport(reposRoot: string) {
  return {
    schema: 'ExternalRepoSmokeRunArtifact.v1',
    options: { reposRoot },
    summary: { failures: 0, total: 3 },
    results: [
      { repo: 'repo-ts', errors: [], overviewOk: true, contextOk: true },
      { repo: 'repo-py', errors: [], overviewOk: true, contextOk: true },
      { repo: 'repo-go', errors: [], overviewOk: true, contextOk: true },
    ],
  };
}

async function writeReleaseFixtures(root: string): Promise<{
  gatesPath: string;
  statusPath: string;
  liveFirePointerPath: string;
  useCaseReportPath: string;
  smokeReportPath: string;
  testingDisciplineReportPath: string;
  testingTrackerReportPath: string;
  conversationInsightsPath: string;
}> {
  const reposRoot = path.join(root, 'eval-corpus', 'external-repos');
  const liveFireDir = path.join(root, 'state', 'eval', 'live-fire', 'hardcore');
  const smokeDir = path.join(root, 'state', 'eval', 'smoke', 'external', 'all-repos');
  const docsDir = path.join(root, 'docs', 'librarian');
  const evalResultsDir = path.join(root, 'eval-results');
  const testingDisciplineDir = path.join(root, 'state', 'eval', 'testing-discipline');

  await mkdir(reposRoot, { recursive: true });
  await mkdir(liveFireDir, { recursive: true });
  await mkdir(smokeDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });
  await mkdir(evalResultsDir, { recursive: true });
  await mkdir(testingDisciplineDir, { recursive: true });

  await writeFile(
    path.join(reposRoot, 'manifest.json'),
    JSON.stringify({
      repos: [
        { name: 'repo-ts', language: 'TypeScript' },
        { name: 'repo-py', language: 'Python' },
        { name: 'repo-go', language: 'Go' },
      ],
    }, null, 2),
    'utf8',
  );

  const gatesPath = path.join(docsDir, 'GATES.json');
  const statusPath = path.join(docsDir, 'STATUS.md');
  await writeFile(gatesPath, JSON.stringify(GATES_OK, null, 2), 'utf8');
  await writeFile(statusPath, STATUS_OK, 'utf8');

  const liveFireReportPath = path.join(liveFireDir, 'report.json');
  await writeFile(liveFireReportPath, JSON.stringify(createLiveFireReport(reposRoot), null, 2), 'utf8');
  const liveFirePointerPath = path.join(liveFireDir, 'latest.json');
  await writeFile(liveFirePointerPath, JSON.stringify({
    schema: 'LiveFireLatestPointer.v1',
    reportPath: './report.json',
  }, null, 2), 'utf8');

  const useCaseReportPath = path.join(evalResultsDir, 'agentic-use-case-review.json');
  await writeFile(useCaseReportPath, JSON.stringify(createUseCaseReport(reposRoot), null, 2), 'utf8');

  const smokeReportPath = path.join(smokeDir, 'report.json');
  await writeFile(smokeReportPath, JSON.stringify(createSmokeReport(reposRoot), null, 2), 'utf8');

  const testingDisciplineReportPath = path.join(testingDisciplineDir, 'report.json');
  await writeFile(testingDisciplineReportPath, JSON.stringify({
    schema: 'TestingDisciplineReport.v1',
    passed: true,
    summary: {
      totalChecks: 8,
      passedChecks: 8,
      failedBlockingChecks: 0,
      warningChecks: 0,
    },
  }, null, 2), 'utf8');

  const testingTrackerReportPath = path.join(testingDisciplineDir, 'testing-tracker.json');
  await writeFile(testingTrackerReportPath, JSON.stringify({
    schema: 'TestingTrackerReport.v1',
    summary: {
      fixedCount: 4,
      openCount: 0,
      unknownCount: 0,
      publishReady: true,
    },
  }, null, 2), 'utf8');

  const conversationInsightsPath = path.join(docsDir, 'CONVERSATION_INSIGHTS.md');
  await writeFile(conversationInsightsPath, conversationInsightsMarkdown(), 'utf8');

  return {
    gatesPath,
    statusPath,
    liveFirePointerPath,
    useCaseReportPath,
    smokeReportPath,
    testingDisciplineReportPath,
    testingTrackerReportPath,
    conversationInsightsPath,
  };
}

describe('publish gate', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'publish-gate-'));
    process.exitCode = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(workspace, { recursive: true, force: true });
  });

  it('flags broad-profile backlog drift and unmet metrics', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: '/tmp/GATES.json',
      statusFilePath: '/tmp/STATUS.md',
      gates: {
        summary: {
          layer0: { pass: 1, fail: 2, total: 3 },
        },
        tasks: {
          pending_task: { status: 'pending' },
        },
      },
      statusMarkdown: STATUS_NOT_MET,
      profile: 'broad',
    });

    expect(report.passed).toBe(false);
    expect(report.blockers.some((item) => item.id === 'summary.layer0.fail')).toBe(true);
    expect(report.blockers.some((item) => item.id === 'tasks.pending')).toBe(true);
    expect(report.blockers.some((item) => item.id === 'metrics.answer_relevancy')).toBe(false);
  });

  it('passes release profile with the maintained signals only', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: '/tmp/GATES.json',
      statusFilePath: '/tmp/STATUS.md',
      gates: GATES_OK,
      statusMarkdown: STATUS_OK,
      profile: 'release',
      releaseSignals: PASSING_SIGNALS,
    });

    expect(report.passed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.release?.signals).toHaveLength(6);
  });

  it('fails release profile when a required maintained signal is missing', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: '/tmp/GATES.json',
      statusFilePath: '/tmp/STATUS.md',
      gates: GATES_OK,
      statusMarkdown: STATUS_OK,
      profile: 'release',
      releaseSignals: PASSING_SIGNALS.slice(1),
    });

    expect(report.passed).toBe(false);
    expect(report.blockers.some((item) => item.id === 'release.live_fire_quick')).toBe(true);
  });

  it('fails release profile on failing signals and strict markers', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: '/tmp/GATES.json',
      statusFilePath: '/tmp/STATUS.md',
      gates: GATES_OK,
      statusMarkdown: 'unverified_by_trace(example)',
      profile: 'release',
      releaseSignals: PASSING_SIGNALS.map((signal) =>
        signal.id === 'release.external_smoke_sample'
          ? { ...signal, status: 'fail', message: 'External smoke sample has failures' }
          : signal
      ),
    });

    expect(report.passed).toBe(false);
    expect(report.blockers.some((item) => item.id === 'release.external_smoke_sample')).toBe(true);
    expect(report.warnings.some((item) => item.id === 'release.status_strict_markers')).toBe(false);
  });

  it('writes a passing release report from maintained artifacts only', async () => {
    const fixtures = await writeReleaseFixtures(workspace);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--gates-file', fixtures.gatesPath,
        '--status-file', fixtures.statusPath,
        '--live-fire-pointer', fixtures.liveFirePointerPath,
        '--use-case-report', fixtures.useCaseReportPath,
        '--smoke-report', fixtures.smokeReportPath,
        '--testing-discipline-report', fixtures.testingDisciplineReportPath,
        '--testing-tracker-report', fixtures.testingTrackerReportPath,
        '--conversation-insights-file', fixtures.conversationInsightsPath,
      ],
    });

    expect(consoleSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);

    const latestPath = path.join(workspace, 'state', 'eval', 'publish-gate', 'latest.json');
    const report = JSON.parse(await readFile(latestPath, 'utf8')) as {
      passed: boolean;
      summary: { blockerCount: number; warningCount: number };
      release?: { signals: PublishGateSignal[] };
    };

    expect(report.passed).toBe(true);
    expect(report.summary).toEqual({ blockerCount: 0, warningCount: 0 });
    expect(report.release?.signals).toHaveLength(6);
  });

  it('fails when use-case evidence is quick or deterministic', async () => {
    const fixtures = await writeReleaseFixtures(workspace);
    const reposRoot = path.join(workspace, 'eval-corpus', 'external-repos');
    await writeFile(
      fixtures.useCaseReportPath,
      JSON.stringify({
        ...createUseCaseReport(reposRoot),
        options: {
          reposRoot,
          selectionMode: 'adaptive',
          deterministicQueries: true,
          evidenceProfile: 'quick',
        },
      }, null, 2),
      'utf8',
    );

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--gates-file', fixtures.gatesPath,
        '--status-file', fixtures.statusPath,
        '--live-fire-pointer', fixtures.liveFirePointerPath,
        '--use-case-report', fixtures.useCaseReportPath,
        '--smoke-report', fixtures.smokeReportPath,
        '--testing-discipline-report', fixtures.testingDisciplineReportPath,
        '--testing-tracker-report', fixtures.testingTrackerReportPath,
        '--conversation-insights-file', fixtures.conversationInsightsPath,
      ],
    });

    expect(consoleSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    const latestPath = path.join(workspace, 'state', 'eval', 'publish-gate', 'latest.json');
    const report = JSON.parse(await readFile(latestPath, 'utf8')) as {
      blockers: Array<{ id: string }>;
    };
    expect(report.blockers.some((item) => item.id === 'release.agentic_use_case_review')).toBe(true);
  });
});
