import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { evaluatePublishReadiness, publishGateCommand } from '../publish_gate.js';

const CONVERSATION_INSIGHTS_REVIEW_TOKEN = 'conversation_insights_review_complete';
const CONVERSATION_NO_FALLBACK_TOKEN = 'zero_fallback_retry_degraded_confirmed';

const PASSING_AB_SIGNAL = {
  gates: {
    passed: true,
    thresholds: {
      requireAgentCommandTasks: true,
      minAgentCommandShare: 1,
      minT3SuccessRateLift: 0.25,
      requireT3Significance: true,
      minAgentVerifiedExecutionShare: 1,
      requireBaselineFailureForAgentTasks: true,
      minArtifactIntegrityShare: 1,
      maxVerificationFallbackShare: 0,
    },
  },
  t3PlusLift: {
    successRateLift: 0.3,
    significance: {
      sampleSizeAdequate: true,
      statisticallySignificant: true,
      inconclusiveReason: undefined,
    },
  },
  diagnostics: {
    verificationFallbackRuns: 0,
    verificationFallbackShare: 0,
    modeCounts: {
      deterministic_edit: 0,
      agent_command: 2,
    },
  },
  options: {
    reposRoot: '/tmp/placeholder/eval-corpus/external-repos',
    taskCount: 10,
    workerTypes: ['control', 'treatment'],
    evidenceProfile: 'release',
  },
  results: [
    {
      taskId: 't3-control-1',
      repo: 'repo-a',
      complexity: 'T3',
      workerType: 'control',
      mode: 'agent_command',
      failureReason: null,
      artifacts: { directory: '/tmp/artifacts/control', files: { result: '/tmp/artifacts/control/result.json' } },
      artifactIntegrity: { complete: true },
      verificationPolicy: {
        requireBaselineFailure: true,
        baselineCommandsConfigured: 1,
        verificationCommandsConfigured: 1,
        verificationFallbackUsed: false,
      },
      agentCommand: { command: 'node scripts/ab-agent-codex.mjs' },
      extraContextFiles: [],
    },
    {
      taskId: 't3-treatment-1',
      repo: 'repo-a',
      complexity: 'T3',
      workerType: 'treatment',
      mode: 'agent_command',
      failureReason: null,
      artifacts: { directory: '/tmp/artifacts/treatment', files: { result: '/tmp/artifacts/treatment/result.json' } },
      artifactIntegrity: { complete: true },
      verificationPolicy: {
        requireBaselineFailure: true,
        baselineCommandsConfigured: 1,
        verificationCommandsConfigured: 1,
        verificationFallbackUsed: false,
      },
      agentCommand: { command: 'node scripts/ab-agent-codex.mjs' },
      extraContextFiles: ['src/feature.ts'],
    },
  ],
};

const PASSING_USE_CASE_SIGNAL = {
  schema: 'AgenticUseCaseReviewReport.v1',
  options: {
    reposRoot: '/tmp/placeholder/eval-corpus/external-repos',
    selectionMode: 'balanced',
    progressivePrerequisites: true,
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
    reasons: [],
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

const PASSING_TESTING_DISCIPLINE_SIGNAL = {
  schema: 'TestingDisciplineReport.v1',
  generatedAt: new Date(0).toISOString(),
  summary: {
    totalChecks: 10,
    passedChecks: 10,
    failedBlockingChecks: 0,
    warningChecks: 0,
  },
  checks: [
    { id: 'td_01_ab_agent_mode_purity', passed: true, severity: 'blocking' },
    { id: 'td_02_ab_baseline_to_fix_causality', passed: true, severity: 'blocking' },
    { id: 'td_03_ab_treatment_context_localization', passed: true, severity: 'blocking' },
    { id: 'td_04_ab_artifact_integrity_verification', passed: true, severity: 'blocking' },
    { id: 'td_05_ab_no_fallback_no_strict_markers', passed: true, severity: 'blocking' },
    { id: 'td_06_use_case_breadth_and_quality', passed: true, severity: 'blocking' },
    { id: 'td_07_live_fire_objective_coverage', passed: true, severity: 'blocking' },
    { id: 'td_08_external_smoke_cross_language', passed: true, severity: 'blocking' },
    { id: 'td_09_composition_selection_quality', passed: true, severity: 'blocking' },
    { id: 'td_10_constructable_auto_adaptation', passed: true, severity: 'warning' },
  ],
  passed: true,
};

const PASSING_TESTING_TRACKER_SIGNAL = {
  schema: 'TestingTrackerReport.v1',
  generatedAt: new Date(0).toISOString(),
  artifacts: [
    { id: 'ab', present: true },
    { id: 'useCase', present: true },
    { id: 'liveFire', present: true },
    { id: 'smoke', present: true },
    { id: 'testingDiscipline', present: true },
    { id: 'publishGate', present: true },
  ],
  flaws: [
    { id: 'ab_fallback_control', title: 'A/B fallback control', status: 'fixed', evidence: 'verificationFallbackShare=0.000' },
    { id: 'ab_artifact_integrity', title: 'A/B artifact integrity', status: 'fixed', evidence: 'artifactIntegrityShare=1.000' },
    { id: 'ab_verified_execution', title: 'A/B verified execution share', status: 'fixed', evidence: 'agentVerifiedExecutionShare=1.000' },
    { id: 'ab_timeout_fragility', title: 'A/B timeout fragility', status: 'fixed', evidence: 'agent_command_timeout_count=0' },
    { id: 'ab_superiority_signal', title: 'A/B superiority signal', status: 'fixed', evidence: 'lift=0.300, sampleSizeAdequate=true, significant=true' },
    { id: 'use_case_strict_marker_control', title: 'Use-case strict marker control', status: 'fixed', evidence: 'strictFailureShare=0.000' },
    { id: 'live_fire_gate', title: 'Live-fire gate', status: 'fixed', evidence: 'gates.passed=true' },
    { id: 'external_smoke_reliability', title: 'External smoke reliability', status: 'fixed', evidence: 'summary.failures=0' },
    { id: 'testing_discipline_gate', title: 'Testing discipline gate', status: 'fixed', evidence: 'passed=true, failedBlockingChecks=0' },
    { id: 'publish_gate', title: 'Publish gate', status: 'fixed', evidence: 'passed=true, blockerCount=0, warningCount=0' },
  ],
  summary: {
    fixedCount: 10,
    openCount: 0,
    unknownCount: 0,
    publishReady: true,
  },
};

const PASSING_FINAL_VERIFICATION_REPORT = {
  validation_results: {
    phase21: {
      p50LatencyMs: 0,
      p99LatencyMs: 1,
      memoryPerKLOC: 0.01,
      samples: [
        { sourceRoot: 'src', locCount: 1000, heapDeltaMB: 1 },
        { sourceRoot: 'eval-corpus/external-repos/repo-a/src', locCount: 1000, heapDeltaMB: 1 },
        { sourceRoot: 'eval-corpus/external-repos/repo-b/src', locCount: 1000, heapDeltaMB: 1 },
        { sourceRoot: 'eval-corpus/external-repos/repo-c/src', locCount: 1000, heapDeltaMB: 1 },
        { sourceRoot: 'eval-corpus/external-repos/repo-d/src', locCount: 1000, heapDeltaMB: 1 },
        { sourceRoot: 'eval-corpus/external-repos/repo-e/src', locCount: 1000, heapDeltaMB: 1 },
      ],
      benchmarkPlan: {
        requestedSamples: 6,
        selectedCandidates: 6,
        executedSamples: 6,
        skippedSamples: 0,
        skipped: [],
      },
    },
  },
  targets: {
    phase21: {
      memoryPerKLOC: 50,
    },
  },
  targets_met: {
    phase21_memory: true,
  },
};

function createPassingReleaseSignals(overrides?: Partial<Record<string, Partial<{ status: 'pass' | 'fail' | 'warning'; message: string; ageHours: number }>>>): Array<{
  id: string;
  path: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  ageHours: number;
}> {
  const base = [
    { id: 'release.live_fire_quick', path: '/tmp/live-fire.json', status: 'pass' as const, message: 'Live-fire quick gate passed', ageHours: 1 },
    { id: 'release.ab_agentic_bugfix', path: '/tmp/ab.json', status: 'pass' as const, message: 'A/B harness gate passed', ageHours: 1 },
    { id: 'release.agentic_use_case_review', path: '/tmp/use-cases.json', status: 'pass' as const, message: 'Use-case review gate passed', ageHours: 1 },
    { id: 'release.external_smoke_sample', path: '/tmp/smoke.json', status: 'pass' as const, message: 'External smoke sample passed', ageHours: 1 },
    { id: 'release.testing_discipline', path: '/tmp/testing-discipline.json', status: 'pass' as const, message: 'Testing discipline gate passed', ageHours: 1 },
    { id: 'release.testing_tracker', path: '/tmp/testing-tracker.json', status: 'pass' as const, message: 'Testing tracker gate passed', ageHours: 1 },
    { id: 'release.final_verification', path: '/tmp/final-verification.json', status: 'pass' as const, message: 'Final verification gate passed', ageHours: 1 },
    { id: 'release.conversation_insights_review', path: '/tmp/CONVERSATION_INSIGHTS.md', status: 'pass' as const, message: 'Conversation insights review gate passed', ageHours: 1 },
  ];
  if (!overrides) return base;
  return base.map((signal) => ({
    ...signal,
    ...(overrides[signal.id] ?? {}),
  }));
}

async function writeConversationInsightsFixture(root: string, options?: {
  reviewChecked?: boolean;
  noFallbackChecked?: boolean;
}): Promise<string> {
  const reviewChecked = options?.reviewChecked ?? true;
  const noFallbackChecked = options?.noFallbackChecked ?? true;
  const filePath = path.join(root, 'docs', 'librarian', 'CONVERSATION_INSIGHTS.md');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    '# Conversation Insights',
    '',
    '## Context Snapshot',
    '- Date: 2026-02-12',
    '- Objective: Launch readiness',
    '- Conversation source: strategy thread',
    '',
    '## Non-Negotiable Product Signals',
    '- Librarian is the world\'s best knowledge, cognitive support, and organizational support tool for software agents.',
    '',
    '## Agent Failure Modes Observed',
    '- Endless test loops without concept-level diagnosis.',
    '',
    '## OpenClaw Patterns to Borrow (Mapped to LiBrainian files)',
    '- Strict release gates mapped to `src/cli/commands/publish_gate.ts`.',
    '',
    '## Action Items',
    '| ID | Mapping | Owner | File Targets | Gate Impact | Status |',
    '| --- | --- | --- | --- | --- | --- |',
    '| CI-001 | Documentation task | docs | `docs/librarian/README.md` | `release.conversation_insights_review` | active |',
    '',
    '## Accepted Wording for Positioning',
    '- Librarian is the world\'s best knowledge, cognitive support, and organizational support system for codebase agents.',
    '',
    '## Deferred Ideas',
    '- None',
    '',
    '## Evidence Links',
    '- `docs/librarian/CONVERSATION_INSIGHTS.md`',
    '',
    '### Release Gate Signoff Checklist',
    `- [${reviewChecked ? 'x' : ' '}] ${CONVERSATION_INSIGHTS_REVIEW_TOKEN}`,
    `- [${noFallbackChecked ? 'x' : ' '}] ${CONVERSATION_NO_FALLBACK_TOKEN}`,
  ].join('\n'), 'utf8');
  return filePath;
}

async function writePassingReleaseArtifacts(root: string, options?: {
  statusMarkdown?: string;
  liveFire?: unknown;
  ab?: unknown;
  smoke?: unknown;
  useCase?: unknown;
  testingDiscipline?: unknown;
  testingTracker?: unknown;
  finalVerification?: unknown;
}): Promise<{
  gatesPath: string;
  statusPath: string;
  liveFirePath: string;
  abPath: string;
  smokePath: string;
  useCasePath: string;
  testingDisciplinePath: string;
  testingTrackerPath: string;
  finalVerificationPath: string;
}> {
  const gatesPath = path.join(root, 'GATES.json');
  const statusPath = path.join(root, 'STATUS.md');
  const liveFirePath = path.join(root, 'live-fire.json');
  const abPath = path.join(root, 'ab.json');
  const smokePath = path.join(root, 'smoke.json');
  const useCasePath = path.join(root, 'use-cases.json');
  const testingDisciplinePath = path.join(root, 'state', 'eval', 'testing-discipline', 'report.json');
  const testingTrackerPath = path.join(root, 'state', 'eval', 'testing-discipline', 'testing-tracker.json');
  const finalVerificationPath = path.join(root, 'eval-results', 'final-verification.json');

  await writeFile(gatesPath, JSON.stringify({
    summary: { layer0: { total: 1, pass: 1 } },
    tasks: { 'layer0.typecheck': { status: 'pass' } },
  }, null, 2), 'utf8');
  await writeFile(statusPath, options?.statusMarkdown ?? [
    '| Metric | Target | Measured | Status |',
    '| --- | --- | --- | --- |',
    '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
  ].join('\n'), 'utf8');
  await writeFile(liveFirePath, JSON.stringify(options?.liveFire ?? {
    schema: 'LiveFireTrialReport.v1',
    gates: { passed: true },
    aggregate: { passRate: 1, totalRuns: 2 },
    options: {
      reposRoot: path.join(root, 'eval-corpus', 'external-repos'),
      llmModes: ['disabled', 'optional'],
      protocol: 'objective',
      includeSmoke: true,
      strictObjective: true,
    },
    runs: [
      { llmMode: 'disabled', journey: { total: 1 }, smoke: { total: 1 } },
      { llmMode: 'optional', journey: { total: 1 }, smoke: { total: 1 } },
    ],
  }, null, 2), 'utf8');
  await writeFile(abPath, JSON.stringify(options?.ab ?? {
    ...PASSING_AB_SIGNAL,
    options: {
      reposRoot: path.join(root, 'eval-corpus', 'external-repos'),
      taskCount: 10,
      workerTypes: ['control', 'treatment'],
      evidenceProfile: 'release',
    },
  }, null, 2), 'utf8');
  await writeFile(smokePath, JSON.stringify(options?.smoke ?? {
    schema: 'ExternalRepoSmokeRunArtifact.v1',
    options: {
      reposRoot: path.join(root, 'eval-corpus', 'external-repos'),
      maxRepos: 3,
    },
    summary: { total: 3, failures: 0 },
    results: [
      { repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] },
      { repo: 'repo-b', overviewOk: true, contextOk: true, errors: [] },
      { repo: 'repo-c', overviewOk: true, contextOk: true, errors: [] },
    ],
  }, null, 2), 'utf8');
  await writeFile(useCasePath, JSON.stringify(options?.useCase ?? {
    ...PASSING_USE_CASE_SIGNAL,
    options: {
      ...PASSING_USE_CASE_SIGNAL.options,
      reposRoot: path.join(root, 'eval-corpus', 'external-repos'),
    },
  }, null, 2), 'utf8');
  await mkdir(path.dirname(testingDisciplinePath), { recursive: true });
  await writeFile(testingDisciplinePath, JSON.stringify(options?.testingDiscipline ?? PASSING_TESTING_DISCIPLINE_SIGNAL, null, 2), 'utf8');
  await writeFile(testingTrackerPath, JSON.stringify(options?.testingTracker ?? PASSING_TESTING_TRACKER_SIGNAL, null, 2), 'utf8');
  await mkdir(path.dirname(finalVerificationPath), { recursive: true });
  await writeFile(finalVerificationPath, JSON.stringify(options?.finalVerification ?? PASSING_FINAL_VERIFICATION_REPORT, null, 2), 'utf8');
  await mkdir(path.join(root, 'eval-corpus', 'external-repos'), { recursive: true });
  await writeFile(path.join(root, 'eval-corpus', 'external-repos', 'manifest.json'), JSON.stringify({
    repos: [
      { name: 'repo-a', language: 'typescript' },
      { name: 'repo-b', language: 'python' },
      { name: 'repo-c', language: 'go' },
    ],
  }, null, 2), 'utf8');

  return { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath, testingDisciplinePath, testingTrackerPath, finalVerificationPath };
}

describe('publishGateCommand', () => {
  let workspace: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'librarian-publish-gate-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    await writeConversationInsightsFixture(workspace);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
    await rm(workspace, { recursive: true, force: true });
  });

  it('fails when gates and metrics include blocking states', async () => {
    const gatesPath = path.join(workspace, 'GATES.json');
    const statusPath = path.join(workspace, 'STATUS.md');

    await writeFile(gatesPath, JSON.stringify({
      summary: {
        layer0: { total: 2, unverified: 1, pass: 1 },
      },
      tasks: {
        'layer0.typecheck': { status: 'unverified' },
        'layer5.retrievalRecall': { status: 'pass' },
      },
    }, null, 2), 'utf8');

    await writeFile(statusPath, [
      '| Metric | Target | Measured | Status |',
      '| --- | --- | --- | --- |',
      '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
      '| Memory per 1K LOC | 50 MB | 84 MB | NOT MET |',
    ].join('\n'), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: ['publish-gate', '--json', '--profile', 'broad', '--gates-file', gatesPath, '--status-file', statusPath],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id.startsWith('summary.layer0.unverified'))).toBe(true);
    expect(report.blockers.some((item: { id: string }) => item.id === 'tasks.unverified')).toBe(true);
    expect(report.blockers.some((item: { id: string }) => item.id.startsWith('metrics.memory_per_1k_loc'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('passes when no blocking summary/task status and all metrics are met', async () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: path.join(workspace, 'GATES.json'),
      statusFilePath: path.join(workspace, 'STATUS.md'),
      profile: 'broad',
      gates: {
        summary: {
          layer0: { total: 2, pass: 2 },
        },
        tasks: {
          'layer0.typecheck': { status: 'pass' },
        },
      },
      statusMarkdown: [
        '| Metric | Target | Measured | Status |',
        '| --- | --- | --- | --- |',
        '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
      ].join('\n'),
    });

    expect(report.passed).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('release profile passes when release signals pass and only non-critical metrics miss', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: path.join(workspace, 'GATES.json'),
      statusFilePath: path.join(workspace, 'STATUS.md'),
      profile: 'release',
      maxArtifactAgeHours: 168,
      releaseSignals: createPassingReleaseSignals(),
      gates: {
        summary: {
          layer3: { total: 10, unverified: 9, pass: 1 },
        },
      },
      statusMarkdown: [
        '| Metric | Target | Measured | Status |',
        '| --- | --- | --- | --- |',
        '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
        '| Memory per 1K LOC | 50 MB | 84 MB | NOT MET |',
      ].join('\n'),
    });

    expect(report.passed).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings.some((item) => item.id === 'metrics.memory_per_1k_loc')).toBe(true);
    expect(report.warnings.some((item) => item.id === 'release.backlog_status_drift')).toBe(false);
  });

  it('release profile can emit backlog drift warning when explicitly enabled', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: path.join(workspace, 'GATES.json'),
      statusFilePath: path.join(workspace, 'STATUS.md'),
      profile: 'release',
      includeBacklogStatusWarning: true,
      maxArtifactAgeHours: 168,
      releaseSignals: createPassingReleaseSignals(),
      gates: {
        summary: {
          layer3: { total: 10, unverified: 9, pass: 1 },
        },
      },
      statusMarkdown: [
        '| Metric | Target | Measured | Status |',
        '| --- | --- | --- | --- |',
        '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
      ].join('\n'),
    });

    expect(report.warnings.some((item) => item.id === 'release.backlog_status_drift')).toBe(true);
  });

  it('release profile fails when a required release signal fails', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: path.join(workspace, 'GATES.json'),
      statusFilePath: path.join(workspace, 'STATUS.md'),
      profile: 'release',
      maxArtifactAgeHours: 168,
      releaseSignals: createPassingReleaseSignals({
        'release.live_fire_quick': {
          status: 'fail',
          message: 'Live-fire quick gate failed',
        },
      }),
      gates: {
        summary: {
          layer0: { total: 1, pass: 1 },
        },
      },
      statusMarkdown: [
        '| Metric | Target | Measured | Status |',
        '| --- | --- | --- | --- |',
        '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.blockers.some((item) => item.id === 'release.live_fire_quick')).toBe(true);
  });

  it('release profile fails when required release signals are missing', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: path.join(workspace, 'GATES.json'),
      statusFilePath: path.join(workspace, 'STATUS.md'),
      profile: 'release',
      maxArtifactAgeHours: 168,
      releaseSignals: createPassingReleaseSignals().filter((signal) => signal.id !== 'release.testing_discipline'),
      gates: {
        summary: {
          layer0: { total: 1, pass: 1 },
        },
      },
      statusMarkdown: [
        '| Metric | Target | Measured | Status |',
        '| --- | --- | --- | --- |',
        '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.blockers.some((item) => item.id === 'release.testing_discipline')).toBe(true);
  });

  it('release profile fails when GATES/STATUS contain strict failure markers', () => {
    const report = evaluatePublishReadiness({
      workspace,
      gatesFilePath: path.join(workspace, 'GATES.json'),
      statusFilePath: path.join(workspace, 'STATUS.md'),
      profile: 'release',
      maxArtifactAgeHours: 168,
      releaseSignals: createPassingReleaseSignals(),
      gates: {
        summary: {
          layer0: { total: 1, pass: 1 },
        },
        tasks: {
          'layer0.typecheck': {
            status: 'pass',
          },
        },
        release_notes: {
          note: 'unverified_by_trace(evidence_manifest_missing): unresolved release note',
        },
      },
      statusMarkdown: [
        '# Status',
        '',
        '- unverified_by_trace(provider_unavailable): historical claim',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.blockers.some((item) => item.id === 'release.gates_strict_markers')).toBe(true);
    expect(report.blockers.some((item) => item.id === 'release.status_strict_markers')).toBe(true);
  });

  it('release command passes when release evidence and conversation checklist are complete', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace);

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(report.release.signals.some((signal: { id: string; status: string }) =>
      signal.id === 'release.conversation_insights_review' && signal.status === 'pass')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('release command accepts probabilistic use-case selection mode', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace, {
      useCase: {
        ...PASSING_USE_CASE_SIGNAL,
        options: {
          ...PASSING_USE_CASE_SIGNAL.options,
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          selectionMode: 'probabilistic',
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });

  it('release command allows disabled progression without prerequisite thresholds', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace, {
      useCase: {
        ...PASSING_USE_CASE_SIGNAL,
        options: {
          ...PASSING_USE_CASE_SIGNAL.options,
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          selectionMode: 'probabilistic',
          progressivePrerequisites: true,
        },
        summary: {
          ...PASSING_USE_CASE_SIGNAL.summary,
          progression: {
            enabled: false,
            prerequisiteUseCases: 0,
            targetUseCases: 120,
            totalPlannedUseCases: 120,
            prerequisiteRuns: 0,
            prerequisitePassRate: 0,
            targetRuns: 120,
            targetPassRate: 1,
            targetDependencyReadyShare: 1,
            byLayer: {
              L0: { runs: 10, passRate: 1 },
              L1: { runs: 20, passRate: 1 },
              L2: { runs: 50, passRate: 1 },
              L3: { runs: 40, passRate: 1 },
              L4: { runs: 0, passRate: 0 },
              unknown: { runs: 0, passRate: 0 },
            },
          },
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });

  it('writes latest publish-gate report artifact for downstream trackers', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace);

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const latestPath = path.join(workspace, 'state', 'eval', 'publish-gate', 'latest.json');
    const latestRaw = await readFile(latestPath, 'utf8');
    const latest = JSON.parse(latestRaw);

    expect(latest.schema).toBe('PublishReadinessReport.v1');
    expect(latest.passed).toBe(true);
  });

  it('release command fails when testing-discipline report is not clean', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace, {
      testingDiscipline: {
        ...PASSING_TESTING_DISCIPLINE_SIGNAL,
        summary: {
          ...PASSING_TESTING_DISCIPLINE_SIGNAL.summary,
          warningChecks: 1,
        },
        passed: false,
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.testing_discipline')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when conversation insights review checkbox is not checked', async () => {
    await writeConversationInsightsFixture(workspace, { reviewChecked: false });
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace);

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.conversation_insights_review')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when artifact records retry usage', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace, {
      liveFire: {
        gates: { passed: true },
        aggregate: { passRate: 1 },
        options: { llmModes: ['optional'] },
        runs: [{ llmMode: 'optional', retryCount: 1 }],
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.live_fire_quick')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile fails when live-fire evidence is disabled-only', async () => {
    const gatesPath = path.join(workspace, 'GATES.json');
    const statusPath = path.join(workspace, 'STATUS.md');
    const liveFirePath = path.join(workspace, 'live-fire.json');
    const abPath = path.join(workspace, 'ab.json');
    const smokePath = path.join(workspace, 'smoke.json');

    await writeFile(gatesPath, JSON.stringify({
      summary: { layer0: { total: 1, pass: 1 } },
      tasks: { 'layer0.typecheck': { status: 'pass' } },
    }, null, 2), 'utf8');
    await writeFile(statusPath, [
      '| Metric | Target | Measured | Status |',
      '| --- | --- | --- | --- |',
      '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
    ].join('\n'), 'utf8');
    await writeFile(liveFirePath, JSON.stringify({
      gates: { passed: true },
      aggregate: { passRate: 1 },
      options: { llmModes: ['disabled'] },
      runs: [{ llmMode: 'disabled' }],
    }, null, 2), 'utf8');
    await writeFile(abPath, JSON.stringify(PASSING_AB_SIGNAL, null, 2), 'utf8');
    await writeFile(smokePath, JSON.stringify({
      summary: { failures: 0 },
      results: [{ repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] }],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.live_fire_quick')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile fails when evidence contains strict failure markers', async () => {
    const gatesPath = path.join(workspace, 'GATES.json');
    const statusPath = path.join(workspace, 'STATUS.md');
    const liveFirePath = path.join(workspace, 'live-fire.json');
    const abPath = path.join(workspace, 'ab.json');
    const smokePath = path.join(workspace, 'smoke.json');

    await writeFile(gatesPath, JSON.stringify({
      summary: { layer0: { total: 1, pass: 1 } },
      tasks: { 'layer0.typecheck': { status: 'pass' } },
    }, null, 2), 'utf8');
    await writeFile(statusPath, [
      '| Metric | Target | Measured | Status |',
      '| --- | --- | --- | --- |',
      '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
    ].join('\n'), 'utf8');
    await writeFile(liveFirePath, JSON.stringify({
      gates: { passed: true },
      aggregate: { passRate: 1 },
      options: { llmModes: ['optional'] },
      runs: [{ llmMode: 'optional' }],
    }, null, 2), 'utf8');
    await writeFile(abPath, JSON.stringify({
      ...PASSING_AB_SIGNAL,
      notes: 'unverified_by_trace(provider_unavailable): test fixture',
    }, null, 2), 'utf8');
    await writeFile(smokePath, JSON.stringify({
      summary: { failures: 0 },
      results: [{ repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] }],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile fails when A/B T3+ lift is below worldclass threshold', async () => {
    const gatesPath = path.join(workspace, 'GATES.json');
    const statusPath = path.join(workspace, 'STATUS.md');
    const liveFirePath = path.join(workspace, 'live-fire.json');
    const abPath = path.join(workspace, 'ab.json');
    const smokePath = path.join(workspace, 'smoke.json');

    await writeFile(gatesPath, JSON.stringify({
      summary: { layer0: { total: 1, pass: 1 } },
      tasks: { 'layer0.typecheck': { status: 'pass' } },
    }, null, 2), 'utf8');
    await writeFile(statusPath, [
      '| Metric | Target | Measured | Status |',
      '| --- | --- | --- | --- |',
      '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
    ].join('\n'), 'utf8');
    await writeFile(liveFirePath, JSON.stringify({
      gates: { passed: true },
      aggregate: { passRate: 1 },
      options: { llmModes: ['optional'] },
      runs: [{ llmMode: 'optional' }],
    }, null, 2), 'utf8');
    await writeFile(abPath, JSON.stringify({
      ...PASSING_AB_SIGNAL,
      t3PlusLift: {
        successRateLift: 0.05,
        significance: {
          sampleSizeAdequate: true,
          statisticallySignificant: true,
          inconclusiveReason: undefined,
        },
      },
    }, null, 2), 'utf8');
    await writeFile(smokePath, JSON.stringify({
      summary: { failures: 0 },
      results: [{ repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] }],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile accepts ceiling-mode A/B evidence with strong effective time reduction', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
    } = await writePassingReleaseArtifacts(workspace, {
      ab: {
        ...PASSING_AB_SIGNAL,
        options: {
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          taskCount: 10,
          workerTypes: ['control', 'treatment'],
          evidenceProfile: 'release',
        },
        lift: {
          successRateLift: 0,
          absoluteSuccessRateDelta: 0,
          controlSuccessRate: 1,
          treatmentSuccessRate: 1,
          timeReduction: 0.005,
          agentCommandTimeReduction: 0.02,
          significance: {
            sampleSizeAdequate: true,
            statisticallySignificant: null,
            inconclusiveReason: 'zero_standard_error',
          },
        },
        t3PlusLift: {
          successRateLift: 0,
          absoluteSuccessRateDelta: 0,
          controlSuccessRate: 1,
          treatmentSuccessRate: 1,
          timeReduction: 0.005,
          agentCommandTimeReduction: 0.02,
          significance: {
            sampleSizeAdequate: true,
            statisticallySignificant: null,
            inconclusiveReason: 'zero_standard_error',
          },
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(true);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('release profile ignores timeout option fields in live-fire imperfection scan', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
    } = await writePassingReleaseArtifacts(workspace, {
      liveFire: {
        schema: 'LiveFireTrialReport.v1',
        gates: { passed: true },
        aggregate: { passRate: 1, totalRuns: 2 },
        options: {
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          llmModes: ['disabled', 'optional'],
          protocol: 'objective',
          includeSmoke: true,
          strictObjective: true,
          journeyTimeoutMs: 180000,
          smokeTimeoutMs: 180000,
        },
        runs: [
          { llmMode: 'disabled', journey: { total: 1 }, smoke: { total: 1 } },
          { llmMode: 'optional', journey: { total: 1 }, smoke: { total: 1 } },
        ],
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(true);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.live_fire_quick')).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('release profile fails in ceiling mode when time reduction is too small', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
    } = await writePassingReleaseArtifacts(workspace, {
      ab: {
        ...PASSING_AB_SIGNAL,
        options: {
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          taskCount: 10,
          workerTypes: ['control', 'treatment'],
          evidenceProfile: 'release',
        },
        t3PlusLift: {
          successRateLift: 0,
          absoluteSuccessRateDelta: 0,
          controlSuccessRate: 1,
          treatmentSuccessRate: 1,
          timeReduction: 0.005,
          agentCommandTimeReduction: 0.005,
          significance: {
            sampleSizeAdequate: true,
            statisticallySignificant: null,
            inconclusiveReason: 'zero_standard_error',
          },
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile enforces ceiling-mode time reduction even when A/B threshold disables it', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
    } = await writePassingReleaseArtifacts(workspace, {
      ab: {
        ...PASSING_AB_SIGNAL,
        options: {
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          taskCount: 10,
          workerTypes: ['control', 'treatment'],
          evidenceProfile: 'release',
        },
        gates: {
          passed: true,
          thresholds: {
            ...PASSING_AB_SIGNAL.gates.thresholds,
            requireT3CeilingTimeReduction: false,
          },
        },
        t3PlusLift: {
          successRateLift: 0,
          absoluteSuccessRateDelta: 0,
          controlSuccessRate: 1,
          treatmentSuccessRate: 1,
          timeReduction: -0.03,
          agentCommandTimeReduction: -0.02,
          significance: {
            sampleSizeAdequate: true,
            statisticallySignificant: null,
            inconclusiveReason: 'zero_standard_error',
          },
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile fails when A/B evidence reports verification fallback usage', async () => {
    const gatesPath = path.join(workspace, 'GATES.json');
    const statusPath = path.join(workspace, 'STATUS.md');
    const liveFirePath = path.join(workspace, 'live-fire.json');
    const abPath = path.join(workspace, 'ab.json');
    const smokePath = path.join(workspace, 'smoke.json');

    await writeFile(gatesPath, JSON.stringify({
      summary: { layer0: { total: 1, pass: 1 } },
      tasks: { 'layer0.typecheck': { status: 'pass' } },
    }, null, 2), 'utf8');
    await writeFile(statusPath, [
      '| Metric | Target | Measured | Status |',
      '| --- | --- | --- | --- |',
      '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
    ].join('\n'), 'utf8');
    await writeFile(liveFirePath, JSON.stringify({
      gates: { passed: true },
      aggregate: { passRate: 1 },
      options: { llmModes: ['optional'] },
      runs: [{ llmMode: 'optional' }],
    }, null, 2), 'utf8');
    await writeFile(abPath, JSON.stringify({
      ...PASSING_AB_SIGNAL,
      diagnostics: {
        verificationFallbackRuns: 1,
        verificationFallbackShare: 0.1,
      },
    }, null, 2), 'utf8');
    await writeFile(smokePath, JSON.stringify({
      summary: { failures: 0 },
      results: [{ repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] }],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release profile fails when warnings exist and --zero-warning is enabled', async () => {
    const gatesPath = path.join(workspace, 'GATES.json');
    const statusPath = path.join(workspace, 'STATUS.md');
    const liveFirePath = path.join(workspace, 'live-fire.json');
    const abPath = path.join(workspace, 'ab.json');
    const smokePath = path.join(workspace, 'smoke.json');

    await writeFile(gatesPath, JSON.stringify({
      summary: { layer0: { total: 1, pass: 1 } },
      tasks: { 'layer0.typecheck': { status: 'pass' } },
    }, null, 2), 'utf8');
    await writeFile(statusPath, [
      '| Metric | Target | Measured | Status |',
      '| --- | --- | --- | --- |',
      '| Retrieval Recall@5 | 0.80 | 0.82 | MET |',
      '| Memory per 1K LOC | 50 MB | 84 MB | NOT MET |',
    ].join('\n'), 'utf8');
    await writeFile(liveFirePath, JSON.stringify({
      gates: { passed: true },
      aggregate: { passRate: 1 },
      options: { llmModes: ['optional'] },
      runs: [{ llmMode: 'optional' }],
    }, null, 2), 'utf8');
    await writeFile(abPath, JSON.stringify(PASSING_AB_SIGNAL, null, 2), 'utf8');
    await writeFile(smokePath, JSON.stringify({
      summary: { failures: 0 },
      results: [{ repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] }],
    }, null, 2), 'utf8');
    const useCasePath = path.join(workspace, 'use-cases.json');
    await writeFile(useCasePath, JSON.stringify({
      ...PASSING_USE_CASE_SIGNAL,
      options: {
        ...PASSING_USE_CASE_SIGNAL.options,
        reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
      },
    }, null, 2), 'utf8');
    await mkdir(path.join(workspace, 'eval-corpus', 'external-repos'), { recursive: true });
    await writeFile(path.join(workspace, 'eval-corpus', 'external-repos', 'manifest.json'), JSON.stringify({
      repos: [
        { name: 'repo-a', language: 'typescript' },
        { name: 'repo-b', language: 'python' },
        { name: 'repo-c', language: 'go' },
      ],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--zero-warning',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.warning_budget_exceeded')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when live-fire pointer is missing reportPath', async () => {
    const { gatesPath, statusPath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace);
    const liveFirePointerPath = path.join(workspace, 'live-fire-pointer.json');
    await writeFile(liveFirePointerPath, JSON.stringify({
      schema: 'LiveFireLatestPointer.v1',
      profile: 'hardcore',
      reportPath: null,
      options: { llmModes: ['disabled', 'optional'], strictObjective: true, includeSmoke: true },
      gates: { passed: true, reasons: [] },
      aggregate: { passRate: 1 },
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePointerPath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.live_fire_quick')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when A/B evidence profile is quick', async () => {
    const { gatesPath, statusPath, liveFirePath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace);
    const abPath = path.join(workspace, 'ab-quick-profile.json');
    await writeFile(abPath, JSON.stringify({
      ...PASSING_AB_SIGNAL,
      options: {
        ...PASSING_AB_SIGNAL.options,
        reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
        evidenceProfile: 'quick',
      },
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when A/B thresholds are weakened below strict release policy', async () => {
    const { gatesPath, statusPath, liveFirePath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace);
    const abPath = path.join(workspace, 'ab-weak-thresholds.json');
    await writeFile(abPath, JSON.stringify({
      ...PASSING_AB_SIGNAL,
      options: {
        ...PASSING_AB_SIGNAL.options,
        reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
        evidenceProfile: 'release',
      },
      gates: {
        ...PASSING_AB_SIGNAL.gates,
        thresholds: {
          ...PASSING_AB_SIGNAL.gates.thresholds,
          minAgentVerifiedExecutionShare: 0.9,
          requireT3Significance: false,
        },
      },
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when use-case report is missing', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath } = await writePassingReleaseArtifacts(workspace);

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.agentic_use_case_review')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when external smoke language coverage is too narrow', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace, {
      smoke: {
        schema: 'ExternalRepoSmokeRunArtifact.v1',
        options: {
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          maxRepos: 3,
        },
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'repo-b', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'repo-c', overviewOk: true, contextOk: true, errors: [] },
        ],
      },
    });
    await writeFile(path.join(workspace, 'eval-corpus', 'external-repos', 'manifest.json'), JSON.stringify({
      repos: [
        { name: 'repo-a', language: 'typescript' },
        { name: 'repo-b', language: 'typescript' },
        { name: 'repo-c', language: 'typescript' },
      ],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.external_smoke_sample')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command enforces top-language smoke coverage when manifest supports it', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath, smokePath, useCasePath } = await writePassingReleaseArtifacts(workspace, {
      smoke: {
        schema: 'ExternalRepoSmokeRunArtifact.v1',
        options: {
          reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
          maxRepos: 3,
        },
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'repo-ts', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'repo-py', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'repo-go', overviewOk: true, contextOk: true, errors: [] },
        ],
      },
    });

    await writeFile(path.join(workspace, 'eval-corpus', 'external-repos', 'manifest.json'), JSON.stringify({
      repos: [
        { name: 'repo-ts', language: 'typescript' },
        { name: 'repo-js', language: 'javascript' },
        { name: 'repo-py', language: 'python' },
        { name: 'repo-go', language: 'go' },
        { name: 'repo-rs', language: 'rust' },
        { name: 'repo-java', language: 'java' },
        { name: 'repo-c', language: 'c' },
        { name: 'repo-cpp', language: 'cpp' },
        { name: 'repo-cs', language: 'csharp' },
        { name: 'repo-php', language: 'php' },
        { name: 'repo-rb', language: 'ruby' },
        { name: 'repo-swift', language: 'swift' },
        { name: 'repo-kt', language: 'kotlin' },
        { name: 'repo-scala', language: 'scala' },
        { name: 'repo-dart', language: 'dart' },
        { name: 'repo-lua', language: 'lua' },
        { name: 'repo-sh', language: 'shell' },
        { name: 'repo-sql', language: 'sql' },
        { name: 'repo-html', language: 'html' },
        { name: 'repo-css', language: 'css' },
      ],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.external_smoke_sample')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when testing tracker is not publish-ready', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
      testingTrackerPath,
    } = await writePassingReleaseArtifacts(workspace, {
      testingTracker: {
        ...PASSING_TESTING_TRACKER_SIGNAL,
        summary: {
          ...PASSING_TESTING_TRACKER_SIGNAL.summary,
          openCount: 1,
          publishReady: false,
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
        '--testing-tracker-report', testingTrackerPath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.testing_tracker')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when final verification benchmark sample plan shows skipped runs', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
    } = await writePassingReleaseArtifacts(workspace, {
      finalVerification: {
        ...PASSING_FINAL_VERIFICATION_REPORT,
        validation_results: {
          ...PASSING_FINAL_VERIFICATION_REPORT.validation_results,
          phase21: {
            ...PASSING_FINAL_VERIFICATION_REPORT.validation_results.phase21,
            benchmarkPlan: {
              requestedSamples: 6,
              selectedCandidates: 6,
              executedSamples: 4,
              skippedSamples: 2,
              skipped: [
                { sourceRoot: 'eval-corpus/external-repos/repo-d/src', reason: 'timeout:45000ms' },
                { sourceRoot: 'eval-corpus/external-repos/repo-e/src', reason: 'invalid_payload' },
              ],
            },
          },
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.final_verification')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when final verification report is missing phase21 target proof', async () => {
    const {
      gatesPath,
      statusPath,
      liveFirePath,
      abPath,
      smokePath,
      useCasePath,
    } = await writePassingReleaseArtifacts(workspace, {
      finalVerification: {
        validation_results: {
          phase21: {
            p50LatencyMs: 0,
            p99LatencyMs: 1,
            memoryPerKLOC: 0.1,
            samples: [],
          },
        },
        targets: {
          phase21: {
            memoryPerKLOC: 50,
          },
        },
        targets_met: {
          phase21_memory: false,
        },
      },
    });

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
        '--use-case-report', useCasePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.final_verification')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when A/B report includes deterministic-edit runs', async () => {
    const { gatesPath, statusPath, liveFirePath, smokePath } = await writePassingReleaseArtifacts(workspace);
    const abPath = path.join(workspace, 'ab-deterministic.json');
    await writeFile(abPath, JSON.stringify({
      ...PASSING_AB_SIGNAL,
      options: {
        reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
        taskCount: 10,
        workerTypes: ['control', 'treatment'],
        evidenceProfile: 'release',
      },
      diagnostics: {
        ...PASSING_AB_SIGNAL.diagnostics,
        modeCounts: { deterministic_edit: 1, agent_command: 1 },
      },
      results: [
        {
          ...PASSING_AB_SIGNAL.results[0],
          mode: 'deterministic_edit',
        },
        PASSING_AB_SIGNAL.results[1],
      ],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.ab_agentic_bugfix')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('release command fails when external smoke coverage is too small', async () => {
    const { gatesPath, statusPath, liveFirePath, abPath } = await writePassingReleaseArtifacts(workspace);
    const smokePath = path.join(workspace, 'smoke-small.json');
    await writeFile(smokePath, JSON.stringify({
      schema: 'ExternalRepoSmokeRunArtifact.v1',
      options: {
        reposRoot: path.join(workspace, 'eval-corpus', 'external-repos'),
        maxRepos: 1,
      },
      summary: { total: 1, failures: 0 },
      results: [{ repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] }],
    }, null, 2), 'utf8');

    await publishGateCommand({
      workspace,
      args: [],
      rawArgs: [
        'publish-gate',
        '--json',
        '--profile', 'release',
        '--gates-file', gatesPath,
        '--status-file', statusPath,
        '--live-fire-pointer', liveFirePath,
        '--ab-report', abPath,
        '--smoke-report', smokePath,
      ],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"PublishReadinessReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const report = JSON.parse(payload!);
    expect(report.passed).toBe(false);
    expect(report.blockers.some((item: { id: string }) => item.id === 'release.external_smoke_sample')).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});
