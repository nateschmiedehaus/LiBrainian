import fs from 'node:fs';
import path from 'node:path';

export type DifficultyCategory = 'ml' | 'backend' | 'infra' | 'security' | 'product';
export type DifficultySeverity = 'easy' | 'medium' | 'hard' | 'extreme';

export interface RepositorySignals {
  hasTests: boolean;
  hasIntegrationTests: boolean;
  hasLoadTests: boolean;
  hasCi: boolean;
  hasObservability: boolean;
  hasRollbackPlan: boolean;
  hasMigrations: boolean;
  hasApiContracts: boolean;
  hasAuthz: boolean;
  hasDatasetFiles: boolean;
  hasEvalHarness: boolean;
  hasModelCode: boolean;
  hasMetrics: boolean;
  hasDocs: boolean;
  hasI18n: boolean;
  hasAccessibilityTests: boolean;
  hasSecretsScanning: boolean;
  hasReleaseAutomation: boolean;
}

export type SignalId = keyof RepositorySignals;

export interface DetectorSignal {
  kind: 'signal' | 'keyword';
  id?: SignalId;
  expectation?: 'present' | 'missing';
  keywords?: string[];
  weight?: number;
  description?: string;
}

export interface DifficultyDetector {
  id: string;
  name: string;
  category: DifficultyCategory;
  severity: DifficultySeverity;
  signals: DetectorSignal[];
  minScore?: number;
  remediationCompositionIds: string[];
  adequacySpecRef?: string;
  minimumEvidence: string[];
  evidenceCommands: string[];
}

export interface DifficultyFinding {
  detectorId: string;
  name: string;
  category: DifficultyCategory;
  severity: DifficultySeverity;
  confidence: number;
  evidence: string[];
  remediationCompositionIds: string[];
  adequacySpecRef?: string;
  minimumEvidence: string[];
  evidenceCommands: string[];
}

export type AdequacyEvidenceSource = 'local' | 'ci' | 'telemetry' | 'registry' | 'attestation';

export interface AdequacyRequirement {
  id: string;
  description: string;
  signalId: SignalId;
  severity: 'critical' | 'warning';
  evidenceSources: AdequacyEvidenceSource[];
  evidenceCommands: string[];
}

export interface AdequacySpec {
  id: string;
  taskIntent: string;
  claimBoundaries: string[];
  requirements: AdequacyRequirement[];
  degradedMode: string;
}

export interface AdequacyReport {
  spec: AdequacySpec;
  missingEvidence: AdequacyRequirement[];
  satisfiedEvidence: AdequacyRequirement[];
  blocking: boolean;
  degradedMode: string;
  evidenceCommands: string[];
  signals: RepositorySignals;
  difficulties: DifficultyFinding[];
}

export interface AdequacyScanOptions {
  intent: string;
  taskType?: string;
  workspaceRoot: string;
  signals?: RepositorySignals;
}

const DEFAULT_SIGNALS: RepositorySignals = {
  hasTests: false,
  hasIntegrationTests: false,
  hasLoadTests: false,
  hasCi: false,
  hasObservability: false,
  hasRollbackPlan: false,
  hasMigrations: false,
  hasApiContracts: false,
  hasAuthz: false,
  hasDatasetFiles: false,
  hasEvalHarness: false,
  hasModelCode: false,
  hasMetrics: false,
  hasDocs: false,
  hasI18n: false,
  hasAccessibilityTests: false,
  hasSecretsScanning: false,
  hasReleaseAutomation: false,
};

const DETECTORS: DifficultyDetector[] = [
  // A) ML / Data / Analytics (10)
  {
    id: 'dd_missing_datasets',
    name: 'Missing datasets / labels',
    category: 'ml',
    severity: 'hard',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      signal('hasDatasetFiles', 'missing', 'No dataset artifacts found.'),
    ],
    minScore: 2,
    remediationCompositionIds: ['tc_evidence_pack_pipeline'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Regime suite results', 'Real data evaluation'],
    evidenceCommands: ['ls data', 'rg -n "dataset|label|eval" .'],
  },
  {
    id: 'dd_distribution_shift',
    name: 'Distribution shift / drift risk',
    category: 'ml',
    severity: 'hard',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['drift', 'shift', 'seasonality', 'time series'], 'Intent references drift/seasonality.'),
    ],
    minScore: 1.5,
    remediationCompositionIds: ['tc_performance_reliability'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Slice metrics over time/regimes'],
    evidenceCommands: ['rg -n "drift|shift|season" .'],
  },
  {
    id: 'dd_metric_misspec',
    name: 'Metric mis-specification',
    category: 'ml',
    severity: 'hard',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      signal('hasMetrics', 'missing', 'No metric contract or dashboards detected.'),
    ],
    minScore: 1.5,
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Metric contract + calibration report'],
    evidenceCommands: ['rg -n "metric|kpi|accuracy|f1" .'],
  },
  {
    id: 'dd_data_leakage',
    name: 'Data leakage',
    category: 'ml',
    severity: 'hard',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['leak', 'target leakage', 'label leakage'], 'Intent references leakage.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Leakage tests + corrected eval'],
    evidenceCommands: ['rg -n "leak|train_test|validation" .'],
  },
  {
    id: 'dd_label_noise',
    name: 'Label noise / weak supervision',
    category: 'ml',
    severity: 'medium',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['label', 'annotation', 'heuristic'], 'Intent references labeling.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_evidence_pack_pipeline'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Audited samples + robustness eval'],
    evidenceCommands: ['rg -n "label|annotat|weak" .'],
  },
  {
    id: 'dd_reproducibility_gaps',
    name: 'Reproducibility gaps',
    category: 'ml',
    severity: 'medium',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['seed', 'repro', 'deterministic'], 'Intent references reproducibility.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Repro logs + stable outputs'],
    evidenceCommands: ['rg -n "seed|random" .'],
  },
  {
    id: 'dd_offline_online_mismatch',
    name: 'Offline/online feature mismatch',
    category: 'ml',
    severity: 'hard',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['feature store', 'offline', 'online'], 'Intent references offline/online features.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Parity suite passes'],
    evidenceCommands: ['rg -n "feature store|offline|online" .'],
  },
  {
    id: 'dd_uncalibrated_confidence',
    name: 'Uncalibrated confidence',
    category: 'ml',
    severity: 'medium',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['calibration', 'confidence'], 'Intent references confidence calibration.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_performance_reliability'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Calibration evidence + typed thresholds'],
    evidenceCommands: ['rg -n "calibration|confidence" .'],
  },
  {
    id: 'dd_data_pipeline_integrity',
    name: 'Data pipeline integrity',
    category: 'ml',
    severity: 'medium',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['pipeline', 'ingest', 'etl'], 'Intent references data pipeline.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['Row invariants + audits'],
    evidenceCommands: ['rg -n "pipeline|etl|ingest" .'],
  },
  {
    id: 'dd_privacy_pii_training',
    name: 'Privacy/PII in training data',
    category: 'ml',
    severity: 'hard',
    signals: [
      signal('hasModelCode', 'present', 'Model/training code detected.'),
      keyword(['pii', 'privacy', 'gdpr', 'hipaa'], 'Intent references PII or privacy.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_model_validity',
    minimumEvidence: ['PII scan + redaction evidence'],
    evidenceCommands: ['rg -n "pii|privacy|gdpr|hipaa" .'],
  },
  // B) Backend / APIs / Distributed Systems (12)
  {
    id: 'dd_missing_contract_tests',
    name: 'Missing contract tests',
    category: 'backend',
    severity: 'hard',
    signals: [
      signal('hasApiContracts', 'present', 'API schemas detected.'),
      signal('hasIntegrationTests', 'missing', 'No integration/contract tests found.'),
    ],
    minScore: 1.5,
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Contract suite results'],
    evidenceCommands: ['rg -n "openapi|swagger|graphql" .'],
  },
  {
    id: 'dd_idempotency_missing',
    name: 'Idempotency missing',
    category: 'backend',
    severity: 'hard',
    signals: [
      keyword(['retry', 'idempotency', 'dedupe'], 'Intent references retry/idempotency.'),
    ],
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Replay tests + invariants'],
    evidenceCommands: ['rg -n "idempotent|dedupe|retry" .'],
  },
  {
    id: 'dd_retry_storms',
    name: 'Retry storms / thundering herd',
    category: 'backend',
    severity: 'hard',
    signals: [
      keyword(['retry', 'thundering herd', 'backoff'], 'Intent references retries/backoff.'),
    ],
    remediationCompositionIds: ['tc_performance_reliability'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Load test evidence + error budgets'],
    evidenceCommands: ['rg -n "retry|backoff|jitter" .'],
  },
  {
    id: 'dd_backpressure_absent',
    name: 'Backpressure absent',
    category: 'backend',
    severity: 'hard',
    signals: [
      keyword(['queue', 'backpressure', 'timeout'], 'Intent references queues or timeouts.'),
    ],
    remediationCompositionIds: ['tc_performance_reliability'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Saturation tests + SLOs'],
    evidenceCommands: ['rg -n "queue|timeout|backpressure" .'],
  },
  {
    id: 'dd_cache_invalidation',
    name: 'Cache invalidation bugs',
    category: 'backend',
    severity: 'medium',
    signals: [
      keyword(['cache', 'ttl', 'invalidate'], 'Intent references cache invalidation.'),
    ],
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Cache correctness tests'],
    evidenceCommands: ['rg -n "cache|ttl|invalidate" .'],
  },
  {
    id: 'dd_race_conditions',
    name: 'Race conditions',
    category: 'backend',
    severity: 'hard',
    signals: [
      keyword(['race', 'concurrency', 'thread', 'lock'], 'Intent references concurrency.'),
    ],
    remediationCompositionIds: ['tc_root_cause_recovery'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Stress run + race reproducer'],
    evidenceCommands: ['rg -n "race|lock|mutex|concurrency" .'],
  },
  {
    id: 'dd_partial_failure_handling',
    name: 'Partial failure handling',
    category: 'backend',
    severity: 'hard',
    signals: [
      keyword(['timeout', 'fallback', 'bulkhead'], 'Intent references timeouts/fallbacks.'),
    ],
    remediationCompositionIds: ['tc_performance_reliability'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Fault-injection results'],
    evidenceCommands: ['rg -n "timeout|fallback|bulkhead" .'],
  },
  {
    id: 'dd_event_ordering',
    name: 'Event ordering assumptions',
    category: 'backend',
    severity: 'medium',
    signals: [
      keyword(['event', 'ordering', 'sequence'], 'Intent references event ordering.'),
    ],
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Property tests + chaos runs'],
    evidenceCommands: ['rg -n "event|ordering|sequence" .'],
  },
  {
    id: 'dd_exactly_once_myth',
    name: 'Exactly-once myth',
    category: 'backend',
    severity: 'hard',
    signals: [
      keyword(['exactly once', 'exactly-once'], 'Intent references exactly-once semantics.'),
    ],
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Evidence-backed semantics + tests'],
    evidenceCommands: ['rg -n "exactly once|exactly-once" .'],
  },
  {
    id: 'dd_hot_partitions',
    name: 'Hot partitions',
    category: 'backend',
    severity: 'medium',
    signals: [
      keyword(['partition', 'shard', 'hot key'], 'Intent references partitioning.'),
    ],
    remediationCompositionIds: ['tc_scaling_readiness'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Load distribution evidence'],
    evidenceCommands: ['rg -n "partition|shard|hot key" .'],
  },
  {
    id: 'dd_clock_skew',
    name: 'Clock skew/time semantics',
    category: 'backend',
    severity: 'medium',
    signals: [
      keyword(['clock', 'ttl', 'expiry', 'time'], 'Intent references time semantics.'),
    ],
    remediationCompositionIds: ['tc_architecture_assurance'],
    adequacySpecRef: 'adequacy_backend',
    minimumEvidence: ['Time travel tests + logs'],
    evidenceCommands: ['rg -n "clock|ttl|expiry|timestamp" .'],
  },
  {
    id: 'dd_schema_compatibility',
    name: 'Schema compatibility across services',
    category: 'backend',
    severity: 'hard',
    signals: [
      signal('hasMigrations', 'present', 'Schema migrations detected.'),
      keyword(['compatibility', 'schema', 'version'], 'Intent references schema compatibility.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_release_readiness'],
    adequacySpecRef: 'adequacy_migration',
    minimumEvidence: ['Compatibility matrix + canary'],
    evidenceCommands: ['rg -n "migration|schema" .'],
  },
  // C) Infra / DevOps / Release Engineering (11)
  {
    id: 'dd_build_gates_red',
    name: 'Build/typecheck gates red',
    category: 'infra',
    severity: 'hard',
    signals: [
      signal('hasCi', 'missing', 'No CI configuration detected.'),
    ],
    remediationCompositionIds: ['tc_release_readiness'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Build + typecheck green'],
    evidenceCommands: ['npm run build', 'npm run test:tier0'],
  },
  {
    id: 'dd_flaky_ci',
    name: 'Flaky CI',
    category: 'infra',
    severity: 'medium',
    signals: [
      keyword(['flaky', 'nondeterministic'], 'Intent references flaky tests.'),
    ],
    remediationCompositionIds: ['tc_repo_rehab_triage'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Flake rate reduced + evidence'],
    evidenceCommands: ['npm test -- --runInBand'],
  },
  {
    id: 'dd_dependency_risk',
    name: 'Dependency/supply-chain risk',
    category: 'infra',
    severity: 'medium',
    signals: [
      signal('hasSecretsScanning', 'missing', 'No dependency/security scanning detected.'),
    ],
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Audit report + pinned deps'],
    evidenceCommands: ['npm audit --production'],
  },
  {
    id: 'dd_environment_drift',
    name: 'Environment drift',
    category: 'infra',
    severity: 'medium',
    signals: [
      keyword(['devcontainer', 'toolchain', 'environment'], 'Intent references environment issues.'),
    ],
    remediationCompositionIds: ['tc_repo_rehab_triage'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Repro build evidence'],
    evidenceCommands: ['rg -n "devcontainer|toolchain" .'],
  },
  {
    id: 'dd_no_rollback_strategy',
    name: 'No rollback strategy',
    category: 'infra',
    severity: 'hard',
    signals: [
      signal('hasRollbackPlan', 'missing', 'No rollback plan detected.'),
    ],
    remediationCompositionIds: ['tc_release_readiness'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Rollback tested + canary'],
    evidenceCommands: ['rg -n "rollback" docs || true'],
  },
  {
    id: 'dd_zero_downtime_migrations',
    name: 'Zero-downtime migrations',
    category: 'infra',
    severity: 'hard',
    signals: [
      signal('hasMigrations', 'present', 'Schema migrations detected.'),
      keyword(['zero downtime', 'expand', 'contract'], 'Intent references zero-downtime migrations.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_release_readiness'],
    adequacySpecRef: 'adequacy_migration',
    minimumEvidence: ['Dual-read/write evidence'],
    evidenceCommands: ['rg -n "migrations|expand|contract" .'],
  },
  {
    id: 'dd_missing_observability',
    name: 'Missing observability',
    category: 'infra',
    severity: 'hard',
    signals: [
      signal('hasObservability', 'missing', 'No observability signals detected.'),
    ],
    remediationCompositionIds: ['tc_release_readiness'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Trace evidence for key flows'],
    evidenceCommands: ['rg -n "telemetry|opentelemetry|metrics" .'],
  },
  {
    id: 'dd_incident_response_gaps',
    name: 'Incident response gaps',
    category: 'infra',
    severity: 'medium',
    signals: [
      signal('hasDocs', 'missing', 'No docs/runbooks detected.'),
    ],
    remediationCompositionIds: ['tc_repo_rehab_triage'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Drill results + dashboards'],
    evidenceCommands: ['rg -n "runbook|incident" docs || true'],
  },
  {
    id: 'dd_capacity_planning_absent',
    name: 'Capacity planning absent',
    category: 'infra',
    severity: 'medium',
    signals: [
      signal('hasLoadTests', 'missing', 'No load test harness detected.'),
      keyword(['scale', 'throughput', 'capacity'], 'Intent references scaling.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_scaling_readiness'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Capacity report + SLOs'],
    evidenceCommands: ['rg -n "load|benchmark|k6" .'],
  },
  {
    id: 'dd_cost_blowups',
    name: 'Cost blowups',
    category: 'infra',
    severity: 'medium',
    signals: [
      keyword(['cost', 'budget', 'usage'], 'Intent references budget or cost.'),
    ],
    remediationCompositionIds: ['tc_governance_durability'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Budget telemetry + enforcement'],
    evidenceCommands: ['rg -n "budget|cost" .'],
  },
  {
    id: 'dd_release_safety_missing',
    name: 'Release safety missing',
    category: 'infra',
    severity: 'hard',
    signals: [
      signal('hasReleaseAutomation', 'missing', 'No release automation detected.'),
    ],
    remediationCompositionIds: ['tc_release_readiness'],
    adequacySpecRef: 'adequacy_release',
    minimumEvidence: ['Canary evidence + kill switch'],
    evidenceCommands: ['rg -n "release|canary|feature flag" .'],
  },
  // D) Security / Compliance / Trust Boundaries (7)
  {
    id: 'dd_secrets_exposure',
    name: 'Secrets exposure',
    category: 'security',
    severity: 'extreme',
    signals: [
      keyword(['secret', 'token', 'credential', 'apikey'], 'Intent references secrets.'),
    ],
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Secret scan report + fixes'],
    evidenceCommands: ['rg -n "secret|token|apikey" .'],
  },
  {
    id: 'dd_injection_risks',
    name: 'Injection risks',
    category: 'security',
    severity: 'extreme',
    signals: [
      keyword(['injection', 'sanitize', 'eval'], 'Intent references injection.'),
    ],
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Security tests + audit'],
    evidenceCommands: ['rg -n "eval\(|sanitize|escape" .'],
  },
  {
    id: 'dd_ssrf_path_traversal',
    name: 'SSRF/path traversal',
    category: 'security',
    severity: 'extreme',
    signals: [
      keyword(['ssrf', 'path traversal', 'url'], 'Intent references SSRF or path traversal.'),
    ],
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Exploit tests blocked'],
    evidenceCommands: ['rg -n "url|path" .'],
  },
  {
    id: 'dd_authz_edge_cases',
    name: 'AuthZ edge cases',
    category: 'security',
    severity: 'hard',
    signals: [
      signal('hasAuthz', 'present', 'Authorization indicators detected.'),
      keyword(['rbac', 'permission', 'authz'], 'Intent references authorization.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Policy suite coverage'],
    evidenceCommands: ['rg -n "rbac|permission|policy" .'],
  },
  {
    id: 'dd_data_retention',
    name: 'Data retention/compliance',
    category: 'security',
    severity: 'hard',
    signals: [
      keyword(['retention', 'compliance', 'gdpr'], 'Intent references retention/compliance.'),
    ],
    remediationCompositionIds: ['tc_governance_durability'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Retention tests + policy docs'],
    evidenceCommands: ['rg -n "retention|gdpr|policy" .'],
  },
  {
    id: 'dd_auditability_missing',
    name: 'Auditability missing',
    category: 'security',
    severity: 'hard',
    signals: [
      keyword(['audit', 'log', 'traceability'], 'Intent references auditability.'),
    ],
    remediationCompositionIds: ['tc_governance_durability'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Audit queries + integrity'],
    evidenceCommands: ['rg -n "audit" .'],
  },
  {
    id: 'dd_threat_model_absent',
    name: 'Threat model absent',
    category: 'security',
    severity: 'hard',
    signals: [
      signal('hasDocs', 'missing', 'No threat model/docs detected.'),
      keyword(['threat', 'abuse', 'attack'], 'Intent references security modeling.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_security_review'],
    adequacySpecRef: 'adequacy_security',
    minimumEvidence: ['Reviewed model + mitigations'],
    evidenceCommands: ['rg -n "threat model" docs || true'],
  },
  // E) Product / UX / Docs / Developer Experience (5)
  {
    id: 'dd_documentation_drift',
    name: 'Documentation drift',
    category: 'product',
    severity: 'medium',
    signals: [
      signal('hasDocs', 'present', 'Docs detected.'),
      keyword(['docs', 'documentation', 'readme'], 'Intent references docs.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_evidence_pack_pipeline'],
    adequacySpecRef: 'adequacy_product',
    minimumEvidence: ['Updated evidence commands'],
    evidenceCommands: ['rg -n "TODO" docs || true'],
  },
  {
    id: 'dd_poor_onboarding',
    name: 'Poor onboarding',
    category: 'product',
    severity: 'medium',
    signals: [
      signal('hasDocs', 'missing', 'No onboarding docs detected.'),
      keyword(['onboarding', 'start', 'setup'], 'Intent references onboarding.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_ux_discovery'],
    adequacySpecRef: 'adequacy_product',
    minimumEvidence: ['Onboarding checklist passes'],
    evidenceCommands: ['rg -n "onboarding|getting started" docs || true'],
  },
  {
    id: 'dd_accessibility_gaps',
    name: 'Accessibility gaps',
    category: 'product',
    severity: 'medium',
    signals: [
      signal('hasAccessibilityTests', 'missing', 'No accessibility checks detected.'),
      keyword(['a11y', 'accessibility'], 'Intent references accessibility.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_ux_discovery'],
    adequacySpecRef: 'adequacy_product',
    minimumEvidence: ['Accessibility suite results'],
    evidenceCommands: ['rg -n "axe|a11y|accessibility" .'],
  },
  {
    id: 'dd_i18n_gaps',
    name: 'Internationalization gaps',
    category: 'product',
    severity: 'medium',
    signals: [
      signal('hasI18n', 'missing', 'No i18n/l10n infra detected.'),
      keyword(['i18n', 'localization', 'translation'], 'Intent references i18n.'),
    ],
    minScore: 1,
    remediationCompositionIds: ['tc_ux_discovery'],
    adequacySpecRef: 'adequacy_product',
    minimumEvidence: ['Locale tests + coverage'],
    evidenceCommands: ['rg -n "i18n|locales|translation" .'],
  },
  {
    id: 'dd_shallow_tests',
    name: 'Tests pass but prove nothing',
    category: 'product',
    severity: 'hard',
    signals: [
      signal('hasTests', 'missing', 'No tests detected.'),
    ],
    remediationCompositionIds: ['tc_evidence_pack_pipeline'],
    adequacySpecRef: 'adequacy_product',
    minimumEvidence: ['Evidence-linked verifications'],
    evidenceCommands: ['npm test'],
  },
];

const REQUIREMENT_CATALOG: Record<string, AdequacyRequirement> = {
  tests: requirement('tests', 'Run relevant test suite for changes.', 'hasTests', 'critical', ['local', 'ci'], ['npm test']),
  integration_tests: requirement('integration_tests', 'Run integration/contract tests.', 'hasIntegrationTests', 'warning', ['ci'], ['npm run test:integration']),
  load_tests: requirement('load_tests', 'Run load/perf tests for performance claims.', 'hasLoadTests', 'warning', ['ci', 'telemetry'], ['npm run test:load']),
  rollback_plan: requirement('rollback_plan', 'Document and rehearse rollback plan.', 'hasRollbackPlan', 'critical', ['local'], ['rg -n "rollback" docs || true']),
  observability: requirement('observability', 'Ensure observability (logs/metrics/traces) exists.', 'hasObservability', 'critical', ['telemetry'], ['rg -n "telemetry|metrics|trace" .']),
  datasets: requirement('datasets', 'Provide dataset artifacts for evaluation.', 'hasDatasetFiles', 'critical', ['registry', 'local'], ['ls data']),
  eval_harness: requirement('eval_harness', 'Provide evaluation harness for model validity.', 'hasEvalHarness', 'critical', ['local'], ['rg -n "eval|benchmark" .']),
};

function signal(id: SignalId, expectation: 'present' | 'missing', description: string, weight = 1): DetectorSignal {
  return { kind: 'signal', id, expectation, description, weight };
}

function keyword(keywords: string[], description: string, weight = 1): DetectorSignal {
  return { kind: 'keyword', keywords, description, weight };
}

function requirement(
  id: string,
  description: string,
  signalId: SignalId,
  severity: 'critical' | 'warning',
  sources: AdequacyEvidenceSource[],
  commands: string[]
): AdequacyRequirement {
  return {
    id,
    description,
    signalId,
    severity,
    evidenceSources: sources,
    evidenceCommands: commands,
  };
}

export function listDifficultyDetectors(): DifficultyDetector[] {
  return [...DETECTORS];
}

export function scanRepositorySignals(workspaceRoot: string): RepositorySignals {
  const roots = collectWorkspaceRoots(workspaceRoot);
  const packageJsons = roots
    .map((root) => readPackageJson(path.join(root, 'package.json')))
    .filter((pkg): pkg is Record<string, unknown> => Boolean(pkg));
  const dependencySet = new Set<string>();
  for (const pkg of packageJsons) {
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = pkg[group];
      if (deps && typeof deps === 'object') {
        for (const name of Object.keys(deps as Record<string, unknown>)) {
          dependencySet.add(name);
        }
      }
    }
  }
  const hasDocs = existsAny(workspaceRoot, ['README.md', 'docs']);

  return {
    hasTests: hasAnyDirectory(roots, [
      'test',
      'tests',
      '__tests__',
      'spec',
      'specs',
      'src/__tests__',
      'src/tests',
      'src/test',
      'src/api/__tests__',
    ]),
    hasIntegrationTests: hasAnyDirectory(roots, ['integration', 'e2e', 'contract', 'src/integration', 'src/e2e']),
    hasLoadTests: hasAnyDirectory(roots, ['load', 'perf', 'performance', 'benchmark', 'benchmarks', 'k6', 'locust', 'src/perf']),
    hasCi: existsAny(workspaceRoot, ['.github/workflows', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml']),
    hasObservability: hasDependency(dependencySet, ['@opentelemetry', 'sentry', 'datadog', 'prom-client', 'winston', 'pino']) ||
      hasAnyDirectory(roots, ['observability', 'telemetry', 'metrics']),
    hasRollbackPlan: existsAny(workspaceRoot, ['ROLLBACK.md', 'docs/rollback.md', 'docs/runbooks/rollback.md', 'runbooks/rollback.md']),
    hasMigrations: hasAnyDirectory(roots, ['migrations', 'db/migrate', 'prisma/migrations']),
    hasApiContracts: existsAny(workspaceRoot, ['openapi.yml', 'openapi.yaml', 'swagger.yml', 'swagger.yaml', 'schema.graphql', 'openapi.json']),
    hasAuthz: hasAnyDirectory(roots, ['rbac', 'authz', 'permissions', 'policy', 'policies']),
    hasDatasetFiles: hasAnyDirectory(roots, ['data', 'dataset', 'datasets']),
    hasEvalHarness: hasAnyDirectory(roots, ['eval', 'evaluation', 'benchmark']),
    hasModelCode: hasAnyDirectory(roots, ['model', 'models', 'training', 'ml', 'notebooks', 'experiments']) ||
      hasDependency(dependencySet, ['tensorflow', 'torch', 'sklearn', 'xgboost', 'onnx', 'pytorch']),
    hasMetrics: hasAnyDirectory(roots, ['metrics', 'kpi']) ||
      hasDependency(dependencySet, ['prom-client', '@opentelemetry/api']),
    hasDocs,
    hasI18n: hasAnyDirectory(roots, ['locales', 'i18n']) ||
      hasDependency(dependencySet, ['i18next', 'react-intl', '@formatjs/intl']),
    hasAccessibilityTests: hasAnyDirectory(roots, ['a11y', 'accessibility']) ||
      hasDependency(dependencySet, ['axe-core', 'jest-axe', '@axe-core/playwright']),
    hasSecretsScanning: existsAny(workspaceRoot, ['.github/dependabot.yml', '.github/workflows/dependency-review.yml']) ||
      hasDependency(dependencySet, ['@snyk/protect', 'snyk', 'gitleaks', 'trufflehog']),
    hasReleaseAutomation: existsAny(workspaceRoot, ['.github/workflows/release.yml', '.changeset', 'release.config.js']) ||
      hasDependency(dependencySet, ['semantic-release']),
  };
}

export function buildAdequacySpec(
  intent: string,
  taskType: string | undefined,
  signals: RepositorySignals
): AdequacySpec {
  const normalizedIntent = `${intent} ${taskType ?? ''}`.toLowerCase();
  const taskIntent = inferTaskIntent(normalizedIntent, signals);
  const requirements: AdequacyRequirement[] = [];

  if (taskIntent === 'model_validity') {
    requirements.push(REQUIREMENT_CATALOG.datasets, REQUIREMENT_CATALOG.eval_harness, REQUIREMENT_CATALOG.tests);
  } else if (taskIntent === 'migration' || taskIntent === 'release') {
    requirements.push(
      REQUIREMENT_CATALOG.tests,
      REQUIREMENT_CATALOG.rollback_plan,
      REQUIREMENT_CATALOG.observability,
      REQUIREMENT_CATALOG.integration_tests
    );
  } else if (taskIntent === 'performance') {
    requirements.push(REQUIREMENT_CATALOG.tests, REQUIREMENT_CATALOG.load_tests, REQUIREMENT_CATALOG.observability);
  } else if (taskIntent === 'security') {
    requirements.push(REQUIREMENT_CATALOG.tests, REQUIREMENT_CATALOG.integration_tests);
  } else {
    requirements.push(REQUIREMENT_CATALOG.tests);
  }

  const claimBoundaries = buildClaimBoundaries(taskIntent);

  return {
    id: `adequacy_${taskIntent}`,
    taskIntent,
    claimBoundaries,
    requirements,
    degradedMode: 'Return bounded advice and flag missing evidence as unverified_by_trace(adequacy_missing).',
  };
}

export function evaluateAdequacy(spec: AdequacySpec, signals: RepositorySignals): AdequacyReport {
  const missing: AdequacyRequirement[] = [];
  const satisfied: AdequacyRequirement[] = [];
  for (const req of spec.requirements) {
    if (signals[req.signalId]) {
      satisfied.push(req);
    } else {
      missing.push(req);
    }
  }
  const blocking = missing.some((req) => req.severity === 'critical');
  const evidenceCommands = missing.flatMap((req) => req.evidenceCommands);
  return {
    spec,
    missingEvidence: missing,
    satisfiedEvidence: satisfied,
    blocking,
    degradedMode: spec.degradedMode,
    evidenceCommands,
    signals,
    difficulties: [],
  };
}

export function runDifficultyDetectors(options: {
  intent: string;
  taskType?: string;
  signals: RepositorySignals;
}): DifficultyFinding[] {
  const normalizedIntent = `${options.intent} ${options.taskType ?? ''}`.toLowerCase();
  const findings: DifficultyFinding[] = [];
  for (const detector of DETECTORS) {
    const { score, matched } = scoreDetector(detector, normalizedIntent, options.signals);
    const minScore = detector.minScore ?? 1;
    if (score >= minScore && matched.length > 0) {
      findings.push({
        detectorId: detector.id,
        name: detector.name,
        category: detector.category,
        severity: detector.severity,
        confidence: Math.min(1, score / Math.max(minScore, detector.signals.length || 1)),
        evidence: matched,
        remediationCompositionIds: detector.remediationCompositionIds,
        adequacySpecRef: detector.adequacySpecRef,
        minimumEvidence: detector.minimumEvidence,
        evidenceCommands: detector.evidenceCommands,
      });
    }
  }
  return findings;
}

export function runAdequacyScan(options: AdequacyScanOptions): AdequacyReport {
  const signals = options.signals ?? scanRepositorySignals(options.workspaceRoot);
  const spec = buildAdequacySpec(options.intent, options.taskType, signals);
  const baseReport = evaluateAdequacy(spec, signals);
  const difficulties = runDifficultyDetectors({
    intent: options.intent,
    taskType: options.taskType,
    signals,
  });
  return {
    ...baseReport,
    difficulties,
  };
}

function scoreDetector(
  detector: DifficultyDetector,
  normalizedIntent: string,
  signals: RepositorySignals
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const signalSpec of detector.signals) {
    const weight = signalSpec.weight ?? 1;
    if (signalSpec.kind === 'signal' && signalSpec.id) {
      const expectation = signalSpec.expectation ?? 'present';
      const matches = expectation === 'present' ? signals[signalSpec.id] : !signals[signalSpec.id];
      if (matches) {
        score += weight;
        matched.push(signalSpec.description ?? `${signalSpec.id}:${expectation}`);
      }
    }
    if (signalSpec.kind === 'keyword' && signalSpec.keywords) {
      if (signalSpec.keywords.some((keyword) => normalizedIntent.includes(keyword))) {
        score += weight;
        matched.push(signalSpec.description ?? `intent:${signalSpec.keywords.join('|')}`);
      }
    }
  }
  return { score, matched };
}

function inferTaskIntent(text: string, signals: RepositorySignals): string {
  if (signals.hasModelCode || /\b(model|ml|dataset|train|eval)\b/.test(text)) {
    return 'model_validity';
  }
  const hasSchema = /\bschema\b/.test(text);
  const hasMigrationAction = /\b(migration|migrate|migrating|backfill|cutover)\b/.test(text);
  const hasReleaseAction = /\b(rollout|deploy(?:ment|ed|ing)?|release|ship|launch)\b/.test(text);
  const hasSchemaChangeAction = hasSchema && /\b(change|alter|modify|update|add|remove|drop|rename|evolv|version)\b/.test(text);
  if (hasMigrationAction || hasSchemaChangeAction) {
    return 'migration';
  }
  if (hasReleaseAction) {
    return 'release';
  }
  if (/\b(performance|latency|throughput|scale)\b/.test(text)) {
    return 'performance';
  }
  if (/\b(security|threat|audit)\b/.test(text)) {
    return 'security';
  }
  if (/\b(bug|fix|incident|regression)\b/.test(text)) {
    return 'bugfix';
  }
  return 'general';
}

function buildClaimBoundaries(taskIntent: string): string[] {
  switch (taskIntent) {
    case 'model_validity':
      return ['Do not claim model correctness without evaluation evidence.'];
    case 'migration':
      return ['Do not claim migration safety without rollback and compatibility evidence.'];
    case 'release':
      return ['Do not claim release safety without rollback + observability evidence.'];
    case 'performance':
      return ['Do not claim performance improvements without load test evidence.'];
    case 'security':
      return ['Do not claim security without audit evidence.'];
    default:
      return ['Do not claim correctness without tests or evidence.'];
  }
}

function collectWorkspaceRoots(workspaceRoot: string): string[] {
  const roots = [workspaceRoot];
  const packagesDir = path.join(workspaceRoot, 'packages');
  try {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        roots.push(path.join(packagesDir, entry.name));
      }
    }
  } catch {
    return roots;
  }
  return roots;
}

function hasAnyDirectory(roots: string[], names: string[]): boolean {
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (isDirectory(candidate)) return true;
    }
  }
  return false;
}

function existsAny(root: string, relativePaths: string[]): boolean {
  for (const rel of relativePaths) {
    const candidate = path.join(root, rel);
    if (fs.existsSync(candidate)) return true;
  }
  return false;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function readPackageJson(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hasDependency(deps: Set<string>, prefixes: string[]): boolean {
  for (const name of deps) {
    for (const prefix of prefixes) {
      if (name === prefix || name.startsWith(prefix + '/')) {
        return true;
      }
    }
  }
  return false;
}

export function mergeSignals(signals: Partial<RepositorySignals>): RepositorySignals {
  return { ...DEFAULT_SIGNALS, ...signals };
}
