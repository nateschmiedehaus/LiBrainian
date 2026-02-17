import type { CompositionUtilityReport } from './composition_utility.js';

export type TestingDisciplineSeverity = 'blocking' | 'warning';

export interface TestingDisciplineThresholds {
  minUseCaseRepos: number;
  minUseCaseIds: number;
  minUseCasePassRate: number;
  minUseCaseEvidenceRate: number;
  minUseCaseUsefulSummaryRate: number;
  maxUseCaseStrictFailureShare: number;
  minLiveFireRuns: number;
  minLiveFireRetrievedContextRate: number;
  maxLiveFireBlockingValidationRate: number;
  minSmokeRepos: number;
  minSmokeLanguages: number;
  minCompositionPassRate: number;
  minCompositionTop1Accuracy: number;
  minCompositionTop3Recall: number;
  minConstructableLanguages: number;
}

export interface TestingDisciplineCheck {
  id: string;
  weakness: string;
  fix: string;
  severity: TestingDisciplineSeverity;
  passed: boolean;
  observed: string;
  expected: string;
  hint?: string;
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
  thresholds: TestingDisciplineThresholds;
  checks: TestingDisciplineCheck[];
  passed: boolean;
}

interface AbTaskRunLike {
  workerType?: string;
  mode?: string;
  success?: boolean;
  failureReason?: string | null;
  extraContextFiles?: string[];
  verification?: {
    baseline?: { passed?: boolean };
    tests?: { passed?: boolean };
  };
  verificationPolicy?: {
    verificationCommandsConfigured?: number;
    verificationFallbackUsed?: boolean;
  };
  artifactIntegrity?: { complete?: boolean };
}

interface AbReportLike {
  diagnostics?: {
    modeCounts?: { deterministic_edit?: number; agent_command?: number };
    verificationFallbackShare?: number;
    verificationFallbackRuns?: number;
  };
  results?: AbTaskRunLike[];
}

interface UseCaseReportLike {
  summary?: {
    totalRuns?: number;
    passRate?: number;
    evidenceRate?: number;
    usefulSummaryRate?: number;
    strictFailureShare?: number;
    uniqueRepos?: number;
    uniqueUseCases?: number;
  };
}

interface LiveFireReportLike {
  options?: {
    llmModes?: string[];
  };
  aggregate?: {
    totalRuns?: number;
    passRate?: number;
    meanRetrievedContextRate?: number;
    meanBlockingValidationRate?: number;
  };
  gates?: { passed?: boolean };
}

interface ExternalSmokeReportLike {
  summary?: {
    total?: number;
    failures?: number;
  };
  results?: Array<{
    repo?: string;
    language?: string;
    success?: boolean;
    status?: string;
    failureReason?: string | null;
  }>;
}

export interface ConstructableDetectionSample {
  repo: string;
  primaryLanguage: string | null;
  enabledConstructables: string[];
}

export interface TestingDisciplineInput {
  abReport: AbReportLike;
  useCaseReport: UseCaseReportLike;
  liveFireReport: LiveFireReportLike;
  externalSmokeReport: ExternalSmokeReportLike;
  compositionUtilityReport: CompositionUtilityReport;
  constructableSamples: ConstructableDetectionSample[];
  thresholds?: Partial<TestingDisciplineThresholds>;
}

const STRICT_MARKERS = [
  /\bunverified_by_trace\(/i,
  /\bverification_fallback_share_above_threshold:/i,
  /\bfallback_context_file_selection\b/i,
  /\bjourney_fallback_context_detected\b/i,
  /provider_unavailable/i,
  /validation_unavailable/i,
  /\bjourney_unverified_trace_detected\b/i,
];

const DEFAULT_THRESHOLDS: TestingDisciplineThresholds = {
  minUseCaseRepos: 4,
  minUseCaseIds: 12,
  minUseCasePassRate: 0.75,
  minUseCaseEvidenceRate: 0.9,
  minUseCaseUsefulSummaryRate: 0.8,
  maxUseCaseStrictFailureShare: 0,
  minLiveFireRuns: 2,
  minLiveFireRetrievedContextRate: 0.98,
  maxLiveFireBlockingValidationRate: 0,
  minSmokeRepos: 3,
  minSmokeLanguages: 3,
  minCompositionPassRate: 0.9,
  minCompositionTop1Accuracy: 0.5,
  minCompositionTop3Recall: 0.9,
  minConstructableLanguages: 3,
};

function inferLanguageFromRepoName(repo: string | undefined): string | null {
  if (!repo) return null;
  const normalized = repo.toLowerCase();
  if (normalized.endsWith('-ts') || normalized.endsWith('-typescript')) return 'typescript';
  if (normalized.endsWith('-js') || normalized.endsWith('-javascript')) return 'javascript';
  if (normalized.endsWith('-py') || normalized.endsWith('-python')) return 'python';
  if (normalized.endsWith('-go')) return 'go';
  if (normalized.endsWith('-rs') || normalized.endsWith('-rust')) return 'rust';
  if (normalized.endsWith('-java')) return 'java';
  if (normalized.endsWith('-c')) return 'c';
  if (normalized.endsWith('-cpp') || normalized.endsWith('-cxx')) return 'cpp';
  if (normalized.endsWith('-csharp') || normalized.endsWith('-cs') || normalized.endsWith('-dotnet')) return 'csharp';
  if (normalized.endsWith('-php')) return 'php';
  if (normalized.endsWith('-rb') || normalized.endsWith('-ruby')) return 'ruby';
  if (normalized.endsWith('-swift')) return 'swift';
  if (normalized.endsWith('-kt') || normalized.endsWith('-kotlin')) return 'kotlin';
  if (normalized.endsWith('-scala')) return 'scala';
  if (normalized.endsWith('-lua')) return 'lua';
  if (normalized.endsWith('-sh') || normalized.endsWith('-bash') || normalized.endsWith('-shell')) return 'bash';
  if (normalized.endsWith('-r')) return 'r';
  if (normalized.endsWith('-ex') || normalized.endsWith('-elixir')) return 'elixir';
  if (normalized.endsWith('-clj') || normalized.endsWith('-clojure')) return 'clojure';
  if (normalized.endsWith('-dart')) return 'dart';
  if (normalized.endsWith('-m') || normalized.endsWith('-objc') || normalized.endsWith('-objective-c')) return 'objective-c';
  if (normalized.endsWith('-hs') || normalized.endsWith('-haskell')) return 'haskell';
  if (normalized.endsWith('-pl') || normalized.endsWith('-perl')) return 'perl';
  return null;
}

function normalizeLanguageName(language: string): string {
  const normalized = language.trim().toLowerCase();
  const aliases: Record<string, string> = {
    ts: 'typescript',
    typescript: 'typescript',
    js: 'javascript',
    javascript: 'javascript',
    py: 'python',
    python: 'python',
    rs: 'rust',
    rust: 'rust',
    cs: 'csharp',
    csharp: 'csharp',
    'c#': 'csharp',
    cpp: 'cpp',
    'c++': 'cpp',
    shell: 'bash',
    sh: 'bash',
    bash: 'bash',
    objc: 'objective-c',
    'objective-c': 'objective-c',
    kt: 'kotlin',
    rb: 'ruby',
    pl: 'perl',
    ex: 'elixir',
    clj: 'clojure',
    m: 'objective-c',
  };
  return aliases[normalized] ?? normalized;
}

function expectedPatternIdsForLanguage(language: string): string[] {
  const normalizedLanguage = normalizeLanguageName(language);
  if (normalizedLanguage === 'javascript' || normalizedLanguage === 'typescript') {
    return ['typescript-patterns', 'javascript-patterns'];
  }
  if (normalizedLanguage === 'cpp') {
    return ['cpp-patterns', 'c++-patterns'];
  }
  if (normalizedLanguage === 'csharp') {
    return ['csharp-patterns', 'c#-patterns'];
  }
  return [`${normalizedLanguage}-patterns`];
}

function inferLanguageFromSmokeResult(result: { repo?: string; language?: string }): string | null {
  if (typeof result.language === 'string' && result.language.trim().length > 0) {
    return normalizeLanguageName(result.language);
  }
  return inferLanguageFromRepoName(result.repo);
}

function hasStrictMarker(payload: unknown): boolean {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(payload, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
    }
    return value;
  });
  return STRICT_MARKERS.some((pattern) => pattern.test(serialized));
}

function buildCheck(input: Omit<TestingDisciplineCheck, 'observed' | 'expected'> & { observed: string; expected: string }): TestingDisciplineCheck {
  return input;
}

export function evaluateTestingDiscipline(input: TestingDisciplineInput): TestingDisciplineReport {
  const thresholdOverrides = Object.fromEntries(
    Object.entries(input.thresholds ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<TestingDisciplineThresholds>;
  const thresholds: TestingDisciplineThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholdOverrides,
  };
  const checks: TestingDisciplineCheck[] = [];

  const abResults = Array.isArray(input.abReport.results) ? input.abReport.results : [];
  const modeCounts = input.abReport.diagnostics?.modeCounts ?? {};
  const deterministicRuns = modeCounts.deterministic_edit ?? 0;
  const agentRuns = modeCounts.agent_command ?? 0;
  const deterministicRunsFromResults = abResults.filter((result) => result.mode === 'deterministic_edit').length;
  const agentRunsFromResults = abResults.filter((result) => result.mode === 'agent_command').length;
  const unsupportedModeRuns = abResults.filter((result) => {
    if (!result.mode) return false;
    return result.mode !== 'agent_command' && result.mode !== 'deterministic_edit';
  }).length;
  const modeAccountingAligned =
    deterministicRuns === deterministicRunsFromResults
    && agentRuns === agentRunsFromResults;

  checks.push(buildCheck({
    id: 'td_01_ab_agent_mode_purity',
    weakness: 'We treated deterministic edits as equivalent to real agent execution.',
    fix: 'Require pure `agent_command` mode for release evidence.',
    severity: 'blocking',
    passed:
      deterministicRuns === 0
      && agentRuns > 0
      && agentRunsFromResults > 0
      && modeAccountingAligned
      && unsupportedModeRuns === 0,
    observed: `diagnosticDeterministic=${deterministicRuns}, diagnosticAgent=${agentRuns}, resultDeterministic=${deterministicRunsFromResults}, resultAgent=${agentRunsFromResults}, unsupportedModes=${unsupportedModeRuns}, modeAccountingAligned=${modeAccountingAligned}`,
    expected: 'diagnosticDeterministic=0, diagnosticAgent>0, resultAgent>0, unsupportedModes=0, modeAccountingAligned=true',
    hint: 'Remove deterministic-edit runs from release evidence.',
  }));

  const agentCommandRuns = abResults.filter((result) => result.mode === 'agent_command');
  const missingCausalityMetadata = agentCommandRuns.filter((result) => (
    typeof result.verification?.baseline?.passed !== 'boolean'
    || typeof result.verification?.tests?.passed !== 'boolean'
  )).length;
  const baselineFixFailures = agentCommandRuns.filter((result) => {
    const baselineFailed = result.verification?.baseline?.passed === false;
    const testsPassed = result.verification?.tests?.passed === true;
    return !(baselineFailed && testsPassed && result.success === true);
  }).length;
  checks.push(buildCheck({
    id: 'td_02_ab_baseline_to_fix_causality',
    weakness: 'We passed runs without proving baseline failure then successful fix.',
    fix: 'Require baseline-fail + post-fix-pass + run success for each agent run.',
    severity: 'blocking',
    passed: agentCommandRuns.length > 0 && missingCausalityMetadata === 0 && baselineFixFailures === 0,
    observed: `agentRuns=${agentCommandRuns.length}, missingCausalityMetadata=${missingCausalityMetadata}, failingRuns=${baselineFixFailures}`,
    expected: 'agentRuns>0, missingCausalityMetadata=0, failingRuns=0',
    hint: 'Audit verification.baseline/tests per run and fail closed.',
  }));

  const treatmentRuns = abResults.filter((result) => result.workerType === 'treatment' && result.mode === 'agent_command');
  const controlRuns = abResults.filter((result) => result.workerType === 'control' && result.mode === 'agent_command');
  const treatmentMissingContext = treatmentRuns.filter((result) => !Array.isArray(result.extraContextFiles) || result.extraContextFiles.length === 0).length;
  const controlContextContamination = controlRuns.filter((result) => Array.isArray(result.extraContextFiles) && result.extraContextFiles.length > 0).length;
  checks.push(buildCheck({
    id: 'td_03_ab_treatment_context_localization',
    weakness: 'Treatment could “pass” without actually using Librarian-provided context.',
    fix: 'Require non-empty treatment `extraContextFiles` and zero control contamination.',
    severity: 'blocking',
    passed:
      treatmentMissingContext === 0
      && treatmentRuns.length > 0
      && controlRuns.length > 0
      && controlContextContamination === 0,
    observed: `treatmentRuns=${treatmentRuns.length}, controlRuns=${controlRuns.length}, missingTreatmentContext=${treatmentMissingContext}, controlContextContamination=${controlContextContamination}`,
    expected: 'treatmentRuns>0, controlRuns>0, missingTreatmentContext=0, controlContextContamination=0',
    hint: 'Ensure Librarian retrieval succeeds before agent execution.',
  }));

  const integrityFailures = agentCommandRuns.filter((result) => {
    const complete = result.artifactIntegrity?.complete === true;
    const verificationConfigured = (result.verificationPolicy?.verificationCommandsConfigured ?? 0) > 0;
    return !(complete && verificationConfigured);
  }).length;
  const missingVerificationPolicy = agentCommandRuns.filter((result) => !result.verificationPolicy).length;
  checks.push(buildCheck({
    id: 'td_04_ab_artifact_integrity_verification',
    weakness: 'Runs were counted without complete artifacts or verification command coverage.',
    fix: 'Require complete artifact bundles and non-zero verification commands.',
    severity: 'blocking',
    passed: agentCommandRuns.length > 0 && integrityFailures === 0 && missingVerificationPolicy === 0,
    observed: `agentRuns=${agentCommandRuns.length}, integrityFailures=${integrityFailures}, missingVerificationPolicy=${missingVerificationPolicy}`,
    expected: 'agentRuns>0, integrityFailures=0, missingVerificationPolicy=0',
    hint: 'Fail any run missing required artifact evidence.',
  }));

  const fallbackShare = input.abReport.diagnostics?.verificationFallbackShare ?? 0;
  const fallbackRuns = input.abReport.diagnostics?.verificationFallbackRuns ?? 0;
  const perRunFallbackUsages = abResults.filter((result) => result.verificationPolicy?.verificationFallbackUsed === true).length;
  const abHasStrictMarkers = hasStrictMarker(input.abReport);
  const useCaseHasStrictMarkers = hasStrictMarker(input.useCaseReport);
  const liveFireHasStrictMarkers = hasStrictMarker(input.liveFireReport);
  const smokeHasStrictMarkers = hasStrictMarker(input.externalSmokeReport);
  const compositionHasStrictMarkers = hasStrictMarker(input.compositionUtilityReport);
  const constructableHasStrictMarkers = hasStrictMarker(input.constructableSamples);
  const strictMarkerSources = [
    ['abReport', abHasStrictMarkers],
    ['useCaseReport', useCaseHasStrictMarkers],
    ['liveFireReport', liveFireHasStrictMarkers],
    ['externalSmokeReport', smokeHasStrictMarkers],
    ['compositionUtilityReport', compositionHasStrictMarkers],
    ['constructableSamples', constructableHasStrictMarkers],
  ].filter(([, hasMarker]) => hasMarker).map(([source]) => source);
  const strictMarkerTotal = strictMarkerSources.length;
  checks.push(buildCheck({
    id: 'td_05_ab_no_fallback_no_strict_markers',
    weakness: 'Fallback/retry/degraded traces were implicitly tolerated.',
    fix: 'Fail closed on fallback usage and strict marker presence.',
    severity: 'blocking',
    passed: fallbackShare === 0 && fallbackRuns === 0 && perRunFallbackUsages === 0 && strictMarkerTotal === 0,
    observed: `fallbackShare=${fallbackShare.toFixed(3)}, fallbackRuns=${fallbackRuns}, perRunFallbacks=${perRunFallbackUsages}, strictMarkerReports=${strictMarkerTotal}, strictMarkerSources=[${strictMarkerSources.join(',')}]`,
    expected: 'fallbackShare=0, fallbackRuns=0, perRunFallbacks=0, strictMarkerReports=0, strictMarkerSources=[]',
    hint: 'Eliminate fallback paths from release-evidence runs.',
  }));

  const useCaseSummary = input.useCaseReport.summary ?? {};
  const useCasePass = useCaseSummary.passRate ?? 0;
  const useCaseEvidence = useCaseSummary.evidenceRate ?? 0;
  const useCaseUseful = useCaseSummary.usefulSummaryRate ?? 0;
  const useCaseStrict = useCaseSummary.strictFailureShare ?? 1;
  const useCaseRepos = useCaseSummary.uniqueRepos ?? 0;
  const useCaseIds = useCaseSummary.uniqueUseCases ?? 0;
  const useCaseGatePass =
    useCaseRepos >= thresholds.minUseCaseRepos
    && useCaseIds >= thresholds.minUseCaseIds
    && useCasePass >= thresholds.minUseCasePassRate
    && useCaseEvidence >= thresholds.minUseCaseEvidenceRate
    && useCaseUseful >= thresholds.minUseCaseUsefulSummaryRate
    && useCaseStrict <= thresholds.maxUseCaseStrictFailureShare;
  checks.push(buildCheck({
    id: 'td_06_use_case_breadth_and_quality',
    weakness: 'We overfit to narrow use cases without explicit breadth and quality floors.',
    fix: 'Enforce repo breadth, use-case diversity, and quality-rate minimums.',
    severity: 'blocking',
    passed: useCaseGatePass,
    observed: `repos=${useCaseRepos}, useCases=${useCaseIds}, pass=${useCasePass.toFixed(3)}, evidence=${useCaseEvidence.toFixed(3)}, useful=${useCaseUseful.toFixed(3)}, strict=${useCaseStrict.toFixed(3)}`,
    expected: `repos>=${thresholds.minUseCaseRepos}, useCases>=${thresholds.minUseCaseIds}, pass>=${thresholds.minUseCasePassRate.toFixed(2)}, evidence>=${thresholds.minUseCaseEvidenceRate.toFixed(2)}, useful>=${thresholds.minUseCaseUsefulSummaryRate.toFixed(2)}, strict<=${thresholds.maxUseCaseStrictFailureShare.toFixed(2)}`,
  }));

  const liveFireModes = new Set(input.liveFireReport.options?.llmModes ?? []);
  const liveTotalRuns = input.liveFireReport.aggregate?.totalRuns ?? 0;
  const liveRetrievedRate = input.liveFireReport.aggregate?.meanRetrievedContextRate ?? 0;
  const liveBlockingRate = input.liveFireReport.aggregate?.meanBlockingValidationRate ?? 1;
  const livePassRate = input.liveFireReport.aggregate?.passRate ?? 0;
  const livePassed = input.liveFireReport.gates?.passed === true;
  const liveFireGatePass =
    livePassed
    && liveTotalRuns >= thresholds.minLiveFireRuns
    && livePassRate === 1
    && liveRetrievedRate >= thresholds.minLiveFireRetrievedContextRate
    && liveBlockingRate <= thresholds.maxLiveFireBlockingValidationRate
    && liveFireModes.has('disabled')
    && liveFireModes.has('optional');
  checks.push(buildCheck({
    id: 'td_07_live_fire_objective_coverage',
    weakness: 'Live-fire did not consistently enforce objective protocol across LLM modes.',
    fix: 'Require disabled+optional mode coverage, perfect pass rate, and retrieval quality.',
    severity: 'blocking',
    passed: liveFireGatePass,
    observed: `runs=${liveTotalRuns}, pass=${livePassRate.toFixed(3)}, retrieved=${liveRetrievedRate.toFixed(3)}, blocking=${liveBlockingRate.toFixed(3)}, modes=[${Array.from(liveFireModes).join(',')}]`,
    expected: `runs>=${thresholds.minLiveFireRuns}, pass=1.000, retrieved>=${thresholds.minLiveFireRetrievedContextRate.toFixed(2)}, blocking<=${thresholds.maxLiveFireBlockingValidationRate.toFixed(2)}, modes include disabled+optional`,
  }));

  const smokeSummary = input.externalSmokeReport.summary ?? {};
  const smokeResults = Array.isArray(input.externalSmokeReport.results) ? input.externalSmokeReport.results : [];
  const smokeTotal = smokeSummary.total ?? smokeResults.length;
  const smokeFailures = smokeSummary.failures ?? 0;
  const derivedSmokeFailures = smokeResults.filter((result) => {
    if (result.success === false) return true;
    if (typeof result.failureReason === 'string' && result.failureReason.length > 0) return true;
    if (typeof result.status === 'string') {
      const normalizedStatus = result.status.trim().toLowerCase();
      return normalizedStatus === 'fail' || normalizedStatus === 'failed' || normalizedStatus === 'error';
    }
    return false;
  }).length;
  const smokeSummaryMatchesResults =
    (smokeSummary.total === undefined || smokeSummary.total === smokeResults.length)
    && (smokeSummary.failures === undefined || smokeSummary.failures === derivedSmokeFailures);
  const smokeLanguages = new Set(
    smokeResults
      .map((result) => inferLanguageFromSmokeResult(result))
      .filter((value): value is string => Boolean(value))
  );
  const smokePass =
    smokeFailures === 0
    && smokeTotal >= thresholds.minSmokeRepos
    && smokeLanguages.size >= thresholds.minSmokeLanguages
    && smokeSummaryMatchesResults;
  checks.push(buildCheck({
    id: 'td_08_external_smoke_cross_language',
    weakness: 'Smoke testing was repo-count based, not language-diversity based.',
    fix: 'Require cross-language smoke evidence with zero failures.',
    severity: 'blocking',
    passed: smokePass,
    observed: `repos=${smokeTotal}, failures=${smokeFailures}, derivedFailures=${derivedSmokeFailures}, languages=${smokeLanguages.size}, summaryMatchesResults=${smokeSummaryMatchesResults}`,
    expected: `repos>=${thresholds.minSmokeRepos}, failures=0, derivedFailures=0, languages>=${thresholds.minSmokeLanguages}, summaryMatchesResults=true`,
  }));

  const compositionPassRate = input.compositionUtilityReport.passRate;
  const compositionTop1 = input.compositionUtilityReport.top1Accuracy;
  const compositionTop3 = input.compositionUtilityReport.top3Recall;
  const compositionScenarios = input.compositionUtilityReport.totalScenarios;
  const compositionPass =
    compositionScenarios > 0
    && compositionPassRate >= thresholds.minCompositionPassRate
    && compositionTop1 >= thresholds.minCompositionTop1Accuracy
    && compositionTop3 >= thresholds.minCompositionTop3Recall;
  checks.push(buildCheck({
    id: 'td_09_composition_selection_quality',
    weakness: 'Composition tests only checked “present somewhere”, not ranking quality.',
    fix: 'Enforce top-1 accuracy and top-3 recall floors for composition routing.',
    severity: 'blocking',
    passed: compositionPass,
    observed: `scenarios=${compositionScenarios}, passRate=${compositionPassRate.toFixed(3)}, top1=${compositionTop1.toFixed(3)}, top3=${compositionTop3.toFixed(3)}`,
    expected: `scenarios>0, passRate>=${thresholds.minCompositionPassRate.toFixed(2)}, top1>=${thresholds.minCompositionTop1Accuracy.toFixed(2)}, top3>=${thresholds.minCompositionTop3Recall.toFixed(2)}`,
  }));

  const constructableLanguages = new Set(
    input.constructableSamples
      .map((sample) => sample.primaryLanguage)
      .filter((language): language is string => Boolean(language))
  );
  const languagePatternCoverage = input.constructableSamples.filter((sample) => {
    const language = sample.primaryLanguage;
    if (!language) return false;
    const expectedPatternIds = expectedPatternIdsForLanguage(language);
    return expectedPatternIds.some((expectedPatternId) => sample.enabledConstructables.includes(expectedPatternId));
  }).length;
  const missingLanguagePatterns = input.constructableSamples.filter((sample) => {
    if (!sample.primaryLanguage) return false;
    const expectedPatternIds = expectedPatternIdsForLanguage(sample.primaryLanguage);
    return !expectedPatternIds.some((expectedPatternId) => sample.enabledConstructables.includes(expectedPatternId));
  }).length;
  const constructablePass =
    constructableLanguages.size >= thresholds.minConstructableLanguages
    && languagePatternCoverage >= thresholds.minConstructableLanguages
    && missingLanguagePatterns === 0;
  checks.push(buildCheck({
    id: 'td_10_constructable_auto_adaptation',
    weakness: 'We did not verify constructable adaptation across language ecosystems.',
    fix: 'Require language-diverse repos with matching language constructables enabled.',
    severity: 'blocking',
    passed: constructablePass,
    observed: `languages=${constructableLanguages.size}, languagePatternCoverage=${languagePatternCoverage}, missingLanguagePatterns=${missingLanguagePatterns}, samples=${input.constructableSamples.length}`,
    expected: `languages>=${thresholds.minConstructableLanguages}, languagePatternCoverage>=${thresholds.minConstructableLanguages}, missingLanguagePatterns=0`,
    hint: 'Increase sampled repos/languages in constructable adaptation probe.',
  }));

  const failedBlockingChecks = checks.filter((check) => !check.passed && check.severity === 'blocking').length;
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
    thresholds,
    checks,
    passed: failedBlockingChecks === 0,
  };
}
