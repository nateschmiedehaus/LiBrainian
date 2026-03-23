import path from 'node:path';

export interface ConstructableDetectionSample {
  repo: string;
  primaryLanguage: string | null;
  enabledConstructables: string[];
}

export interface TestingDisciplineThresholds {
  minUseCaseRepos: number;
  minUseCasePassRate: number;
  minUseCaseEvidenceRate: number;
  minUseCaseUsefulSummaryRate: number;
  maxUseCaseStrictFailureShare: number;
  minPrerequisitePassRate: number;
  minTargetPassRate: number;
  minTargetDependencyReadyShare: number;
  minLiveFireRuns: number;
  minSmokeRepos: number;
  minSmokeLanguages: number;
  minConstructableLanguages: number;
}

export interface TestingDisciplineCheck {
  id: string;
  title: string;
  severity: 'blocking' | 'warning';
  passed: boolean;
  observed: string;
  expected: string;
}

export interface TestingDisciplineReport {
  schema: 'TestingDisciplineReport.v1';
  generatedAt: string;
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedBlockingChecks: number;
    warningChecks: number;
  };
  checks: TestingDisciplineCheck[];
  passed: boolean;
}

const STRICT_MARKER_PATTERN = /\b(unverified_by_trace|fallback_to_[a-z0-9_]+|provider_unavailable|retry_safe|retryable|smoke_repo_timeout|bootstrap_warning|storage_locked:indexing in progress|semantic search unavailable|parser unavailable|embeddings skipped|semantic search disabled|degraded)\b/i;

export const DEFAULT_TESTING_DISCIPLINE_THRESHOLDS: TestingDisciplineThresholds = {
  minUseCaseRepos: 4,
  minUseCasePassRate: 0.75,
  minUseCaseEvidenceRate: 0.9,
  minUseCaseUsefulSummaryRate: 0.8,
  maxUseCaseStrictFailureShare: 0,
  minPrerequisitePassRate: 0.75,
  minTargetPassRate: 0.75,
  minTargetDependencyReadyShare: 1,
  minLiveFireRuns: 2,
  minSmokeRepos: 3,
  minSmokeLanguages: 3,
  minConstructableLanguages: 3,
};

function normalizeAbsolutePath(value: string): string {
  return path.resolve(value);
}

function hasStrictMarkers(value: unknown, fieldName?: string): boolean {
  if (Array.isArray(value)) {
    if ((fieldName === 'strictSignals' || fieldName === 'errors') && value.length > 0) {
      return true;
    }
    return value.some((entry) => hasStrictMarkers(entry, fieldName));
  }
  if (typeof value === 'string') {
    return STRICT_MARKER_PATTERN.test(value);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(([key, entry]) => hasStrictMarkers(entry, key));
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

export function evaluateTestingDiscipline(input: {
  useCaseReport: unknown;
  liveFireReport: unknown;
  externalSmokeReport: unknown;
  constructableSamples: ConstructableDetectionSample[];
  thresholds?: Partial<TestingDisciplineThresholds>;
}): TestingDisciplineReport {
  const thresholds: TestingDisciplineThresholds = {
    ...DEFAULT_TESTING_DISCIPLINE_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  const useCase = asObject(input.useCaseReport) ?? {};
  const liveFire = asObject(input.liveFireReport) ?? {};
  const smoke = asObject(input.externalSmokeReport) ?? {};

  const useCaseOptions = asObject(useCase.options) ?? {};
  const useCaseSummary = asObject(useCase.summary) ?? {};
  const useCaseProgression = asObject(useCaseSummary.progression) ?? {};
  const liveFireOptions = asObject(liveFire.options) ?? {};
  const liveFireAggregate = asObject(liveFire.aggregate) ?? {};
  const liveFireGates = asObject(liveFire.gates) ?? {};
  const smokeOptions = asObject(smoke.options) ?? {};
  const smokeSummary = asObject(smoke.summary) ?? {};
  const smokeResults = Array.isArray(smoke.results) ? smoke.results : [];

  const useCaseReposRoot = typeof useCaseOptions.reposRoot === 'string' ? useCaseOptions.reposRoot : '';
  const smokeReposRoot = typeof smokeOptions.reposRoot === 'string' ? smokeOptions.reposRoot : '';
  const expectedReposRoot = useCaseReposRoot.length > 0 ? normalizeAbsolutePath(useCaseReposRoot) : '';
  const actualSmokeReposRoot = smokeReposRoot.length > 0 ? normalizeAbsolutePath(smokeReposRoot) : '';
  const liveFireReposRoot = typeof liveFireOptions.reposRoot === 'string' ? normalizeAbsolutePath(liveFireOptions.reposRoot) : '';

  const constructableLanguages = new Set(
    input.constructableSamples
      .map((sample) => sample.primaryLanguage)
      .filter((language): language is string => typeof language === 'string' && language.length > 0)
  );
  const constructableCoverage = input.constructableSamples.filter((sample) => sample.enabledConstructables.length > 0).length;

  const checks: TestingDisciplineCheck[] = [
    {
      id: 'td_01_use_case_release_profile',
      title: 'Use-case review uses real-release evidence settings',
      severity: 'blocking',
      passed:
        useCase.schema === 'AgenticUseCaseReviewReport.v1'
        && useCaseOptions.evidenceProfile === 'release'
        && typeof useCaseOptions.selectionMode === 'string'
        && ['balanced', 'probabilistic'].includes(useCaseOptions.selectionMode)
        && expectedReposRoot.length > 0,
      observed: `schema=${String(useCase.schema ?? 'missing')}; profile=${String(useCaseOptions.evidenceProfile ?? 'missing')}; selectionMode=${String(useCaseOptions.selectionMode ?? 'missing')}; reposRoot=${useCaseReposRoot || 'missing'}`,
      expected: 'AgenticUseCaseReviewReport.v1 with evidenceProfile=release, selectionMode=balanced|probabilistic, and real external reposRoot',
    },
    {
      id: 'td_02_use_case_breadth_and_quality',
      title: 'Use-case review clears breadth and quality thresholds',
      severity: 'blocking',
      passed:
        numberOrZero(useCaseSummary.uniqueRepos) >= thresholds.minUseCaseRepos
        && numberOrZero(useCaseSummary.passRate) >= thresholds.minUseCasePassRate
        && numberOrZero(useCaseSummary.evidenceRate) >= thresholds.minUseCaseEvidenceRate
        && numberOrZero(useCaseSummary.usefulSummaryRate) >= thresholds.minUseCaseUsefulSummaryRate
        && numberOrZero(useCaseSummary.strictFailureShare) <= thresholds.maxUseCaseStrictFailureShare,
      observed: `repos=${numberOrZero(useCaseSummary.uniqueRepos)}; passRate=${numberOrZero(useCaseSummary.passRate).toFixed(3)}; evidenceRate=${numberOrZero(useCaseSummary.evidenceRate).toFixed(3)}; usefulSummaryRate=${numberOrZero(useCaseSummary.usefulSummaryRate).toFixed(3)}; strictFailureShare=${numberOrZero(useCaseSummary.strictFailureShare).toFixed(3)}`,
      expected: `repos>=${thresholds.minUseCaseRepos}; passRate>=${thresholds.minUseCasePassRate.toFixed(2)}; evidenceRate>=${thresholds.minUseCaseEvidenceRate.toFixed(2)}; usefulSummaryRate>=${thresholds.minUseCaseUsefulSummaryRate.toFixed(2)}; strictFailureShare<=${thresholds.maxUseCaseStrictFailureShare.toFixed(2)}`,
    },
    {
      id: 'td_03_use_case_progression_integrity',
      title: 'Use-case progression is dependency-safe',
      severity: 'blocking',
      passed:
        useCaseProgression.enabled === true
        && numberOrZero(useCaseProgression.prerequisitePassRate) >= thresholds.minPrerequisitePassRate
        && numberOrZero(useCaseProgression.targetPassRate) >= thresholds.minTargetPassRate
        && numberOrZero(useCaseProgression.targetDependencyReadyShare) >= thresholds.minTargetDependencyReadyShare,
      observed: `enabled=${String(useCaseProgression.enabled)}; prerequisitePassRate=${numberOrZero(useCaseProgression.prerequisitePassRate).toFixed(3)}; targetPassRate=${numberOrZero(useCaseProgression.targetPassRate).toFixed(3)}; targetDependencyReadyShare=${numberOrZero(useCaseProgression.targetDependencyReadyShare).toFixed(3)}`,
      expected: `enabled=true; prerequisitePassRate>=${thresholds.minPrerequisitePassRate.toFixed(2)}; targetPassRate>=${thresholds.minTargetPassRate.toFixed(2)}; targetDependencyReadyShare>=${thresholds.minTargetDependencyReadyShare.toFixed(2)}`,
    },
    {
      id: 'td_04_live_fire_objective_coverage',
      title: 'Live-fire evidence is objective, strict, and sufficiently broad',
      severity: 'blocking',
      passed:
        liveFire.schema === 'LiveFireTrialReport.v1'
        && liveFireGates.passed === true
        && liveFireOptions.protocol === 'objective'
        && liveFireOptions.strictObjective === true
        && liveFireOptions.includeSmoke === true
        && liveFireAggregate.totalRuns === numberOrZero(liveFireAggregate.totalRuns)
        && numberOrZero(liveFireAggregate.totalRuns) >= thresholds.minLiveFireRuns
        && expectedReposRoot.length > 0
        && liveFireReposRoot === expectedReposRoot
        && stringArray(liveFireOptions.llmModes).includes('optional'),
      observed: `schema=${String(liveFire.schema ?? 'missing')}; gatesPassed=${String(liveFireGates.passed)}; protocol=${String(liveFireOptions.protocol ?? 'missing')}; strictObjective=${String(liveFireOptions.strictObjective)}; includeSmoke=${String(liveFireOptions.includeSmoke)}; totalRuns=${numberOrZero(liveFireAggregate.totalRuns)}; llmModes=${stringArray(liveFireOptions.llmModes).join(',') || 'missing'}; reposRoot=${String(liveFireOptions.reposRoot ?? 'missing')}`,
      expected: `LiveFireTrialReport.v1 with gates.passed=true, protocol=objective, strictObjective=true, includeSmoke=true, totalRuns>=${thresholds.minLiveFireRuns}, optional llm mode, and reposRoot matching the use-case corpus`,
    },
    {
      id: 'td_05_release_artifacts_have_no_strict_markers',
      title: 'Release evidence contains no fallback/retry/degraded markers',
      severity: 'blocking',
      passed: !hasStrictMarkers(input.useCaseReport) && !hasStrictMarkers(input.liveFireReport) && !hasStrictMarkers(input.externalSmokeReport),
      observed: `useCaseMarkers=${hasStrictMarkers(input.useCaseReport)}; liveFireMarkers=${hasStrictMarkers(input.liveFireReport)}; smokeMarkers=${hasStrictMarkers(input.externalSmokeReport)}`,
      expected: 'No strict failure markers in use-case, live-fire, or external-smoke artifacts',
    },
    {
      id: 'td_06_external_smoke_cross_language',
      title: 'External smoke covers a language-diverse real corpus',
      severity: 'blocking',
      passed:
        smoke.schema === 'ExternalRepoSmokeRunArtifact.v1'
        && expectedReposRoot.length > 0
        && actualSmokeReposRoot === expectedReposRoot
        && numberOrZero(smokeSummary.total) >= thresholds.minSmokeRepos
        && smokeResults.length >= thresholds.minSmokeRepos
        && new Set(
          smokeResults
            .map((entry) => asObject(entry))
            .map((entry) => entry?.language)
            .filter((language): language is string => typeof language === 'string' && language.length > 0)
        ).size >= thresholds.minSmokeLanguages,
      observed: `schema=${String(smoke.schema ?? 'missing')}; total=${numberOrZero(smokeSummary.total)}; resultCount=${smokeResults.length}; languages=${new Set(smokeResults.map((entry) => asObject(entry)?.language).filter((language): language is string => typeof language === 'string' && language.length > 0)).size}; reposRoot=${String(smokeOptions.reposRoot ?? 'missing')}`,
      expected: `ExternalRepoSmokeRunArtifact.v1 with reposRoot matching use-case corpus, repo coverage>=${thresholds.minSmokeRepos}, and language coverage>=${thresholds.minSmokeLanguages}`,
    },
    {
      id: 'td_07_external_smoke_zero_failures',
      title: 'External smoke runs are clean',
      severity: 'blocking',
      passed:
        numberOrZero(smokeSummary.failures) === 0
        && smokeResults.every((entry) => {
          const candidate = asObject(entry) ?? {};
          const errors = Array.isArray(candidate.errors) ? candidate.errors : [];
          return candidate.overviewOk === true && candidate.contextOk === true && errors.length === 0;
        }),
      observed: `failures=${numberOrZero(smokeSummary.failures)}; dirtyRuns=${smokeResults.filter((entry) => {
        const candidate = asObject(entry) ?? {};
        const errors = Array.isArray(candidate.errors) ? candidate.errors : [];
        return candidate.overviewOk !== true || candidate.contextOk !== true || errors.length > 0;
      }).length}`,
      expected: 'summary.failures=0 and every smoke result has overviewOk/contextOk=true with no errors',
    },
    {
      id: 'td_08_constructable_auto_adaptation',
      title: 'Constructable auto-detection adapts across multiple languages',
      severity: 'warning',
      passed:
        constructableLanguages.size >= thresholds.minConstructableLanguages
        && constructableCoverage >= thresholds.minConstructableLanguages,
      observed: `languages=${constructableLanguages.size}; reposWithConstructables=${constructableCoverage}; samples=${input.constructableSamples.length}`,
      expected: `languages>=${thresholds.minConstructableLanguages} and reposWithConstructables>=${thresholds.minConstructableLanguages}`,
    },
  ];

  const failedBlockingChecks = checks.filter((check) => check.severity === 'blocking' && !check.passed).length;
  const warningChecks = checks.filter((check) => check.severity === 'warning' && !check.passed).length;
  const passedChecks = checks.filter((check) => check.passed).length;

  return {
    schema: 'TestingDisciplineReport.v1',
    generatedAt: new Date().toISOString(),
    summary: {
      totalChecks: checks.length,
      passedChecks,
      failedBlockingChecks,
      warningChecks,
    },
    checks,
    passed: failedBlockingChecks === 0 && warningChecks === 0,
  };
}
