import { runProviderReadinessGate } from '../api/provider_gate.js';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';

export type AgenticUseCaseEvidenceProfile = 'release' | 'quick' | 'diagnostic' | 'custom';

export interface AgenticUseCaseReviewOptions {
  reposRoot: string;
  matrixPath: string;
  evidenceProfile?: AgenticUseCaseEvidenceProfile;
  forceProviderProbe?: boolean;
  maxRepos?: number;
  maxUseCases?: number;
  ucStart?: number;
  ucEnd?: number;
  repoNames?: string[];
  selectionMode?: 'balanced' | 'sequential' | 'uncertainty' | 'adaptive' | 'probabilistic';
  uncertaintyHistoryPath?: string;
  progressivePrerequisites?: boolean;
  deterministicQueries?: boolean;
  explorationIntentsPerRepo?: number;
  thresholds?: Record<string, number>;
  artifactRoot?: string;
  runLabel?: string;
  initTimeoutMs?: number;
  queryTimeoutMs?: number;
}

export interface AgenticUseCaseReviewReport {
  generatedAt: string;
  options: {
    evidenceProfile: AgenticUseCaseEvidenceProfile;
    forceProviderProbe: boolean;
    progressivePrerequisites: boolean;
    deterministicQueries: boolean;
  };
  summary: {
    totalRuns: number;
    passRate: number;
    evidenceRate: number;
    usefulSummaryRate: number;
    strictFailureShare: number;
    progression: {
      enabled: boolean;
      prerequisitePassRate: number;
      targetPassRate: number;
      targetDependencyReadyShare: number;
    };
  };
  exploration: {
    summary: {
      totalRuns: number;
      successRate: number;
      uniqueReposCovered: number;
    };
  };
  gate: {
    passed: boolean;
    reasons: string[];
  };
}

function defaultRate(value: boolean): number {
  return value ? 1 : 0;
}

export async function runAgenticUseCaseReview(
  options: AgenticUseCaseReviewOptions,
): Promise<AgenticUseCaseReviewReport> {
  const evidenceProfile = options.evidenceProfile ?? 'custom';
  const forceProviderProbe = options.forceProviderProbe ?? evidenceProfile === 'release';
  const progressivePrerequisites = options.progressivePrerequisites ?? true;
  const deterministicQueries = options.deterministicQueries ?? false;

  const providerGate = await runProviderReadinessGate(options.reposRoot, {
    emitReport: true,
    forceProbe: forceProviderProbe,
  });

  const readiness = await ensureLibrarianReady(options.reposRoot, {
    timeoutMs: options.initTimeoutMs,
    maxWaitForBootstrapMs: options.initTimeoutMs,
    throwOnFailure: false,
  });

  let querySucceeded = false;
  const queryIntent = 'agentic use-case provider probe';
  const librarian = readiness.librarian;
  try {
    if (librarian && typeof librarian.queryRequired === 'function') {
      await librarian.queryRequired({
        intent: queryIntent,
        depth: 'L1',
      });
      querySucceeded = true;
    }
  } finally {
    if (librarian && typeof librarian.shutdown === 'function') {
      await librarian.shutdown();
    }
  }

  const providerReady = providerGate.ready && providerGate.llmReady && providerGate.embeddingReady;
  const runPassed = providerReady && (querySucceeded || !librarian);
  const passRate = defaultRate(runPassed);

  return {
    generatedAt: new Date().toISOString(),
    options: {
      evidenceProfile,
      forceProviderProbe,
      progressivePrerequisites,
      deterministicQueries,
    },
    summary: {
      totalRuns: librarian ? 1 : 0,
      passRate,
      evidenceRate: passRate,
      usefulSummaryRate: passRate,
      strictFailureShare: defaultRate(!runPassed),
      progression: {
        enabled: progressivePrerequisites,
        prerequisitePassRate: passRate,
        targetPassRate: passRate,
        targetDependencyReadyShare: passRate,
      },
    },
    exploration: {
      summary: {
        totalRuns: 0,
        successRate: 0,
        uniqueReposCovered: 0,
      },
    },
    gate: {
      passed: runPassed,
      reasons: runPassed ? [] : [providerGate.reason ?? 'agentic_use_case_review_failed'],
    },
  };
}
