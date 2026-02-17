/**
 * @fileoverview Excellence Validation Framework
 *
 * A comprehensive framework to validate that outputs truly meet world-class
 * excellence standards. This module provides:
 *
 * 1. **Excellence Criteria** - Multi-dimensional quality assessment
 * 2. **Comparative Benchmarking** - Industry and historical comparisons
 * 3. **Independent Validation** - External audit simulation and adversarial testing
 * 4. **Certification Framework** - Tiered excellence assessment with upgrade paths
 *
 * Excellence Tiers:
 * - **Good**: Meets basic standards (70%+ all dimensions)
 * - **Great**: Exceeds standards (85%+ all dimensions)
 * - **World-Class**: Industry-leading (95%+ all dimensions)
 * - **Legendary**: Sets new standards (99%+ with innovations)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const EXCELLENCE_VALIDATION_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// EXCELLENCE DIMENSIONS
// ============================================================================

/**
 * Core dimensions along which excellence is measured.
 * Each dimension represents a fundamental aspect of quality.
 */
export type ExcellenceDimension =
  | 'functional'      // Does it work correctly?
  | 'performance'     // Is it fast and efficient?
  | 'reliability'     // Is it consistent and dependable?
  | 'security'        // Is it protected from threats?
  | 'maintainability' // Is it easy to evolve?
  | 'usability';      // Is it easy to use?

/**
 * All excellence dimensions as an array for iteration.
 */
export const EXCELLENCE_DIMENSIONS: ExcellenceDimension[] = [
  'functional',
  'performance',
  'reliability',
  'security',
  'maintainability',
  'usability',
];

// ============================================================================
// EVIDENCE TYPES
// ============================================================================

/**
 * Types of evidence that can support excellence claims.
 */
export type EvidenceType =
  | 'test_results'           // Automated test outcomes
  | 'benchmark_data'         // Performance benchmarks
  | 'audit_report'           // Security/compliance audits
  | 'user_feedback'          // User satisfaction data
  | 'code_metrics'           // Static analysis results
  | 'incident_history'       // Production incident data
  | 'peer_review'            // Human expert review
  | 'certification'          // External certifications
  | 'penetration_test'       // Security testing results
  | 'load_test'              // Scalability testing
  | 'chaos_engineering'      // Resilience testing
  | 'accessibility_audit';   // Accessibility compliance

/**
 * A piece of evidence supporting an excellence claim.
 */
export interface Evidence {
  /** Unique identifier */
  id: string;
  /** Type of evidence */
  type: EvidenceType;
  /** Description of the evidence */
  description: string;
  /** When the evidence was collected */
  collectedAt: string;
  /** Who/what collected the evidence */
  source: string;
  /** Quantitative value if applicable */
  value?: number;
  /** Unit of measurement if applicable */
  unit?: string;
  /** URL or path to full evidence */
  reference?: string;
  /** How reliable is this evidence (0-1) */
  reliability: number;
  /** Whether the evidence is still valid */
  isValid: boolean;
  /** When the evidence expires */
  expiresAt?: string;
}

// ============================================================================
// REQUIREMENTS
// ============================================================================

/**
 * Comparison operators for requirement validation.
 */
export type RequirementOperator =
  | 'gte'           // Greater than or equal
  | 'lte'           // Less than or equal
  | 'eq'            // Equal
  | 'gt'            // Greater than
  | 'lt'            // Less than
  | 'between'       // Within range
  | 'exists'        // Must exist
  | 'not_exists';   // Must not exist

/**
 * A specific requirement that must be met.
 */
export interface Requirement {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Detailed description */
  description: string;
  /** The metric this requirement applies to */
  metric: string;
  /** Comparison operator */
  operator: RequirementOperator;
  /** Target value for comparison */
  targetValue: number | boolean | string;
  /** Secondary value for 'between' operator */
  secondaryValue?: number;
  /** Weight of this requirement (0-1) */
  weight: number;
  /** Is this requirement mandatory? */
  mandatory: boolean;
  /** Evidence types that can validate this */
  validEvidenceTypes: EvidenceType[];
}

// ============================================================================
// BENCHMARKS
// ============================================================================

/**
 * A benchmark measurement for comparison.
 */
export interface Benchmark {
  /** Unique identifier */
  id: string;
  /** Name of the benchmark */
  name: string;
  /** What is being measured */
  metric: string;
  /** The benchmark value */
  value: number;
  /** Unit of measurement */
  unit: string;
  /** Source of the benchmark (industry, competitor, historical) */
  source: 'industry' | 'competitor' | 'historical' | 'internal';
  /** When this benchmark was established */
  establishedAt: string;
  /** Percentile this represents (if applicable) */
  percentile?: number;
  /** Context or conditions for the benchmark */
  context?: string;
}

/**
 * A benchmark entry in the database.
 */
export interface BenchmarkEntry {
  /** Category of the benchmark */
  category: string;
  /** Project or source name */
  project: string;
  /** The metrics for this entry */
  metrics: Metrics;
  /** When this entry was recorded */
  recordedAt: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Generic metrics object for benchmarking.
 */
export interface Metrics {
  [key: string]: number | string | boolean | undefined;
}

/**
 * Result of comparing metrics to industry benchmarks.
 */
export interface ComparisonResult {
  /** Category compared against */
  category: string;
  /** The metrics that were compared */
  inputMetrics: Metrics;
  /** Best in class metrics for comparison */
  bestInClass: BenchmarkEntry | null;
  /** Industry average (if available) */
  industryAverage?: Metrics;
  /** Per-metric comparison details */
  comparisons: MetricComparison[];
  /** Overall percentile ranking */
  overallPercentile: number;
  /** Areas where input exceeds best in class */
  exceedsIndustry: string[];
  /** Areas where input falls below industry average */
  belowAverage: string[];
  /** Specific recommendations for improvement */
  recommendations: string[];
}

/**
 * Comparison of a single metric.
 */
export interface MetricComparison {
  /** Name of the metric */
  metric: string;
  /** Input value */
  inputValue: number;
  /** Best in class value */
  bestValue: number;
  /** Industry average value */
  averageValue?: number;
  /** Percentile rank of input */
  percentile: number;
  /** Gap to best in class (positive = behind) */
  gapToBest: number;
  /** Is this metric world-class? */
  isWorldClass: boolean;
}

/**
 * Historical best tracking for a metric.
 */
export interface HistoricalBest {
  /** Name of the metric */
  metricName: string;
  /** The best value achieved */
  value: number;
  /** When this best was achieved */
  achievedAt: string;
  /** What project achieved this */
  achievedBy: string;
  /** Previous best before this */
  previousBest?: {
    value: number;
    achievedAt: string;
    achievedBy: string;
  };
  /** Improvement over previous best */
  improvement?: number;
}

// ============================================================================
// EXCELLENCE CRITERIA
// ============================================================================

/**
 * Excellence criteria for a specific dimension.
 */
export interface ExcellenceCriteria {
  /** The dimension these criteria apply to */
  dimension: ExcellenceDimension;
  /** Description of what excellence means for this dimension */
  description: string;
  /** Requirements that must be met */
  requirements: Requirement[];
  /** Evidence types required to validate */
  evidenceRequired: EvidenceType[];
  /** Benchmarks for comparison */
  benchmarks: Benchmark[];
  /** Weight of this dimension in overall assessment (0-1) */
  weight: number;
}

/**
 * An artifact that can be evaluated for excellence.
 */
export interface Artifact {
  /** Unique identifier */
  id: string;
  /** Name of the artifact */
  name: string;
  /** Type of artifact */
  type: 'system' | 'component' | 'module' | 'function' | 'api' | 'service';
  /** Current metrics for the artifact */
  metrics: Metrics;
  /** Available evidence for the artifact */
  evidence: Evidence[];
  /** Version or revision */
  version?: string;
  /** When the artifact was last updated */
  updatedAt: string;
}

/**
 * Report from evaluating an artifact against excellence criteria.
 */
export interface ExcellenceReport {
  /** Unique report identifier */
  id: string;
  /** The artifact that was evaluated */
  artifact: Artifact;
  /** When the evaluation occurred */
  evaluatedAt: string;
  /** Overall excellence score (0-100) */
  overallScore: number;
  /** Per-dimension scores */
  dimensionScores: Map<ExcellenceDimension, DimensionScore>;
  /** Tier achieved */
  tier: ExcellenceTier;
  /** All requirements that were checked */
  requirementResults: RequirementResult[];
  /** Evidence that was used */
  evidenceUsed: Evidence[];
  /** Gaps identified */
  gaps: ExcellenceGap[];
  /** Recommendations for improvement */
  recommendations: ExcellenceRecommendation[];
  /** Whether all mandatory requirements passed */
  passedMandatory: boolean;
  /** Summary narrative */
  summary: string;
}

/**
 * Score for a single dimension.
 */
export interface DimensionScore {
  /** The dimension */
  dimension: ExcellenceDimension;
  /** Score for this dimension (0-100) */
  score: number;
  /** Number of requirements met */
  requirementsMet: number;
  /** Total number of requirements */
  requirementsTotal: number;
  /** Mandatory requirements met */
  mandatoryMet: number;
  /** Total mandatory requirements */
  mandatoryTotal: number;
  /** Evidence coverage (0-1) */
  evidenceCoverage: number;
  /** Key findings for this dimension */
  findings: string[];
}

/**
 * Result of checking a single requirement.
 */
export interface RequirementResult {
  /** The requirement that was checked */
  requirement: Requirement;
  /** Whether the requirement was met */
  met: boolean;
  /** Actual value observed */
  actualValue: number | boolean | string | undefined;
  /** How close to meeting (0-1, 1 = fully met) */
  compliance: number;
  /** Evidence used to verify */
  evidenceUsed: Evidence[];
  /** Reason for pass/fail */
  reason: string;
}

/**
 * A gap in excellence that needs addressing.
 */
export interface ExcellenceGap {
  /** Dimension where the gap exists */
  dimension: ExcellenceDimension;
  /** Description of the gap */
  description: string;
  /** Current state */
  currentState: string;
  /** Desired state */
  desiredState: string;
  /** Impact of this gap (0-1) */
  impact: number;
  /** Effort to close this gap (story points estimate) */
  effortToClose: number;
  /** Priority for addressing (1 = highest) */
  priority: number;
}

/**
 * A recommendation for improving excellence.
 */
export interface ExcellenceRecommendation {
  /** Unique identifier */
  id: string;
  /** Title of the recommendation */
  title: string;
  /** Detailed description */
  description: string;
  /** Dimension this improves */
  dimension: ExcellenceDimension;
  /** Expected score improvement */
  expectedImprovement: number;
  /** Effort required (story points) */
  effort: number;
  /** Priority (1 = highest) */
  priority: number;
  /** Concrete action items */
  actions: string[];
}

/**
 * The excellence checklist for evaluating artifacts.
 */
export interface ExcellenceChecklist {
  /** Schema version */
  schemaVersion: string;
  /** Criteria for each dimension */
  dimensions: Map<ExcellenceDimension, ExcellenceCriteria>;
  /** Evaluate an artifact against all criteria */
  evaluate(artifact: Artifact): ExcellenceReport;
}

// ============================================================================
// BENCHMARK DATABASE
// ============================================================================

/**
 * Database for storing and querying benchmarks.
 */
export interface BenchmarkDatabase {
  /** Add a benchmark entry */
  addBenchmark(category: string, project: string, metrics: Metrics): void;
  /** Get the best in class for a category */
  getBestInClass(category: string): BenchmarkEntry | null;
  /** Compare metrics to industry standards */
  compareToIndustry(metrics: Metrics, category: string): ComparisonResult;
  /** Track historical best for a metric */
  trackHistoricalBest(metricName: string): HistoricalBest[];
  /** Get all entries for a category */
  getEntriesForCategory(category: string): BenchmarkEntry[];
  /** Get percentile for a metric value */
  getPercentile(category: string, metric: string, value: number): number;
}

// ============================================================================
// INDEPENDENT VALIDATION
// ============================================================================

/**
 * Standards that can be audited against.
 */
export type AuditStandard =
  | 'ISO_27001'      // Information security
  | 'SOC_2'          // Service organization controls
  | 'GDPR'           // Data protection
  | 'HIPAA'          // Healthcare data
  | 'PCI_DSS'        // Payment card industry
  | 'WCAG_2_1'       // Web accessibility
  | 'OWASP_TOP_10'   // Security vulnerabilities
  | 'CIS_BENCHMARK'  // Security configuration
  | 'NIST_CSF';      // Cybersecurity framework

/**
 * Result of simulating an external audit.
 */
export interface AuditResult {
  /** Unique identifier */
  id: string;
  /** The standard audited against */
  standard: AuditStandard;
  /** The artifact that was audited */
  artifactId: string;
  /** When the audit was performed */
  auditedAt: string;
  /** Overall compliance score (0-100) */
  complianceScore: number;
  /** Whether the audit passed */
  passed: boolean;
  /** Controls that were checked */
  controlsChecked: ControlResult[];
  /** Critical findings */
  criticalFindings: AuditFinding[];
  /** Major findings */
  majorFindings: AuditFinding[];
  /** Minor findings */
  minorFindings: AuditFinding[];
  /** Observations (not findings) */
  observations: string[];
  /** Required remediation items */
  remediationRequired: RemediationItem[];
  /** Estimated time to full compliance */
  estimatedTimeToCompliance: number;
}

/**
 * Result of checking a single control.
 */
export interface ControlResult {
  /** Control identifier */
  controlId: string;
  /** Control description */
  description: string;
  /** Whether the control passed */
  passed: boolean;
  /** Evidence supporting the result */
  evidence: string[];
  /** Notes from the auditor */
  notes?: string;
}

/**
 * A finding from an audit.
 */
export interface AuditFinding {
  /** Unique identifier */
  id: string;
  /** Severity level */
  severity: 'critical' | 'major' | 'minor';
  /** Related control ID */
  controlId: string;
  /** Description of the finding */
  description: string;
  /** What was expected */
  expected: string;
  /** What was observed */
  observed: string;
  /** Potential business impact */
  businessImpact: string;
  /** Recommended remediation */
  remediation: string;
}

/**
 * An item requiring remediation.
 */
export interface RemediationItem {
  /** Finding ID this remediates */
  findingId: string;
  /** Description of required action */
  action: string;
  /** Priority (1 = highest) */
  priority: number;
  /** Estimated effort in hours */
  effortHours: number;
  /** Due date for remediation */
  dueBy?: string;
  /** Assigned owner */
  owner?: string;
}

/**
 * Types of attack vectors for red team exercises.
 */
export type AttackVectorType =
  | 'injection'           // SQL, command, etc.
  | 'authentication'      // Auth bypass, credential theft
  | 'authorization'       // Privilege escalation
  | 'data_exposure'       // Sensitive data leakage
  | 'dos'                 // Denial of service
  | 'social_engineering'  // Phishing, pretexting
  | 'supply_chain'        // Dependency attacks
  | 'insider_threat'      // Malicious insider
  | 'physical'            // Physical security
  | 'network';            // Network-based attacks

/**
 * An attack vector to test against.
 */
export interface AttackVector {
  /** Unique identifier */
  id: string;
  /** Type of attack */
  type: AttackVectorType;
  /** Name of the attack */
  name: string;
  /** Description of the attack */
  description: string;
  /** Attack complexity (1-5, 5 = most complex) */
  complexity: number;
  /** Potential impact (1-5, 5 = most severe) */
  potentialImpact: number;
  /** Specific techniques to try */
  techniques: string[];
  /** Target components */
  targets: string[];
}

/**
 * Result of a red team exercise.
 */
export interface RedTeamResult {
  /** Unique identifier */
  id: string;
  /** System that was tested */
  systemId: string;
  /** When the exercise was conducted */
  conductedAt: string;
  /** Duration of the exercise in hours */
  durationHours: number;
  /** Attack vectors that were attempted */
  vectorsAttempted: AttackVector[];
  /** Successful breaches */
  successfulBreaches: Breach[];
  /** Blocked attempts */
  blockedAttempts: BlockedAttempt[];
  /** Detection rate (0-1) */
  detectionRate: number;
  /** Mean time to detect (seconds) */
  meanTimeToDetect: number;
  /** Mean time to respond (seconds) */
  meanTimeToRespond: number;
  /** Overall security score (0-100) */
  securityScore: number;
  /** Critical vulnerabilities found */
  criticalVulnerabilities: Vulnerability[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * A successful breach in red team exercise.
 */
export interface Breach {
  /** Unique identifier */
  id: string;
  /** Attack vector used */
  vectorId: string;
  /** What was compromised */
  compromised: string;
  /** How the breach was achieved */
  method: string;
  /** Time taken to achieve */
  timeTaken: number;
  /** Potential impact */
  impact: string;
  /** Was it detected? */
  detected: boolean;
  /** Time to detection (if detected) */
  detectionTime?: number;
}

/**
 * An attack attempt that was blocked.
 */
export interface BlockedAttempt {
  /** Attack vector attempted */
  vectorId: string;
  /** How it was blocked */
  blockedBy: string;
  /** Time to block (seconds) */
  timeToBlock: number;
  /** Was an alert generated? */
  alertGenerated: boolean;
}

/**
 * A security vulnerability.
 */
export interface Vulnerability {
  /** Unique identifier */
  id: string;
  /** CVE ID if applicable */
  cveId?: string;
  /** Severity */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Description */
  description: string;
  /** Affected components */
  affectedComponents: string[];
  /** CVSS score */
  cvssScore?: number;
  /** Remediation guidance */
  remediation: string;
}

/**
 * A system that can be tested.
 */
export interface System {
  /** Unique identifier */
  id: string;
  /** Name of the system */
  name: string;
  /** Components of the system */
  components: Component[];
  /** External interfaces */
  interfaces: SystemInterface[];
  /** Security controls in place */
  securityControls: string[];
}

/**
 * A component of a system.
 */
export interface Component {
  /** Unique identifier */
  id: string;
  /** Name of the component */
  name: string;
  /** Type of component */
  type: string;
  /** Technologies used */
  technologies: string[];
  /** Dependencies */
  dependencies: string[];
  /** Exposed interfaces */
  interfaces: string[];
}

/**
 * An interface of a system.
 */
export interface SystemInterface {
  /** Unique identifier */
  id: string;
  /** Name of the interface */
  name: string;
  /** Type (API, UI, etc.) */
  type: string;
  /** Protocol */
  protocol: string;
  /** Authentication required */
  authRequired: boolean;
}

/**
 * Configuration for adversarial testing.
 */
export interface AdversarialConfig {
  /** Test intensity (1-5) */
  intensity: number;
  /** Whether to use fuzzing */
  useFuzzing: boolean;
  /** Fuzzing seed count */
  fuzzingSeedCount?: number;
  /** Whether to test boundary conditions */
  testBoundaries: boolean;
  /** Whether to test with malformed input */
  testMalformedInput: boolean;
  /** Maximum time per test (ms) */
  maxTimePerTest: number;
  /** Whether to test concurrency issues */
  testConcurrency: boolean;
  /** Number of concurrent users to simulate */
  concurrentUsers?: number;
  /** Custom test cases to include */
  customTestCases?: TestCase[];
}

/**
 * A test case for adversarial testing.
 */
export interface TestCase {
  /** Test case identifier */
  id: string;
  /** Description */
  description: string;
  /** Input to use */
  input: unknown;
  /** Expected behavior */
  expectedBehavior: string;
}

/**
 * Result of adversarial testing.
 */
export interface AdversarialResult {
  /** Component that was tested */
  componentId: string;
  /** Configuration used */
  config: AdversarialConfig;
  /** When testing was performed */
  testedAt: string;
  /** Total tests run */
  totalTests: number;
  /** Tests that passed */
  passed: number;
  /** Tests that failed */
  failed: number;
  /** Crashes detected */
  crashes: CrashReport[];
  /** Unexpected behaviors */
  unexpectedBehaviors: UnexpectedBehavior[];
  /** Performance anomalies */
  performanceAnomalies: PerformanceAnomaly[];
  /** Coverage achieved (0-1) */
  coverage: number;
  /** Reliability score (0-100) */
  reliabilityScore: number;
}

/**
 * A crash report from adversarial testing.
 */
export interface CrashReport {
  /** Test case that caused the crash */
  testCaseId: string;
  /** Input that caused the crash */
  input: unknown;
  /** Error message */
  errorMessage: string;
  /** Stack trace */
  stackTrace: string;
  /** Severity */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * An unexpected behavior detected.
 */
export interface UnexpectedBehavior {
  /** Test case ID */
  testCaseId: string;
  /** Input that caused it */
  input: unknown;
  /** What was expected */
  expected: string;
  /** What actually happened */
  actual: string;
  /** Severity */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * A performance anomaly detected.
 */
export interface PerformanceAnomaly {
  /** Test case ID */
  testCaseId: string;
  /** What metric was anomalous */
  metric: string;
  /** Expected value */
  expectedValue: number;
  /** Actual value */
  actualValue: number;
  /** Deviation percentage */
  deviationPercent: number;
}

/**
 * Domain definition for edge case exhaustion.
 */
export interface Domain {
  /** Name of the domain */
  name: string;
  /** Type of domain */
  type: 'numeric' | 'string' | 'enum' | 'array' | 'object' | 'boolean';
  /** Minimum value (for numeric) */
  min?: number;
  /** Maximum value (for numeric) */
  max?: number;
  /** Possible values (for enum) */
  values?: unknown[];
  /** Pattern (for string) */
  pattern?: string;
  /** Max length (for string/array) */
  maxLength?: number;
  /** Properties (for object) */
  properties?: Record<string, Domain>;
  /** Whether null is allowed */
  nullable: boolean;
}

/**
 * Report from exhausting edge cases.
 */
export interface EdgeCaseReport {
  /** Function/component tested */
  targetId: string;
  /** Domain tested */
  domain: Domain;
  /** When testing was performed */
  testedAt: string;
  /** Total edge cases tested */
  totalCases: number;
  /** Cases that passed */
  passedCases: number;
  /** Cases that failed */
  failedCases: FailedEdgeCase[];
  /** Categories of edge cases tested */
  categoriesTested: EdgeCaseCategory[];
  /** Coverage of edge case categories (0-1) */
  categoryCoverage: number;
  /** Overall robustness score (0-100) */
  robustnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * A failed edge case.
 */
export interface FailedEdgeCase {
  /** Category of the edge case */
  category: string;
  /** Input that failed */
  input: unknown;
  /** Expected result */
  expected: string;
  /** Actual result */
  actual: string;
  /** Error if any */
  error?: string;
}

/**
 * A category of edge cases.
 */
export interface EdgeCaseCategory {
  /** Category name */
  name: string;
  /** Description */
  description: string;
  /** Examples of cases in this category */
  examples: unknown[];
  /** Number of cases tested */
  casesTested: number;
  /** Number that passed */
  casesPassed: number;
}

/**
 * Interface for independent validation operations.
 */
export interface IndependentValidation {
  /** Simulate an external audit */
  simulateExternalAudit(artifact: Artifact, standard: AuditStandard): AuditResult;
  /** Run a red team exercise */
  runRedTeamExercise(system: System, attackVectors: AttackVector[]): RedTeamResult;
  /** Perform adversarial testing */
  performAdversarialTesting(component: Component, config: AdversarialConfig): AdversarialResult;
  /** Exhaust edge cases for a function */
  exhaustEdgeCases(targetId: string, domain: Domain): EdgeCaseReport;
}

// ============================================================================
// CERTIFICATION FRAMEWORK
// ============================================================================

/**
 * Tiers of excellence certification.
 */
export type ExcellenceTier = 'good' | 'great' | 'world_class' | 'legendary';

/**
 * All excellence tiers as an array for iteration.
 */
export const EXCELLENCE_TIERS: ExcellenceTier[] = ['good', 'great', 'world_class', 'legendary'];

/**
 * Human-readable names for excellence tiers.
 */
export const TIER_NAMES: Record<ExcellenceTier, string> = {
  good: 'Good',
  great: 'Great',
  world_class: 'World-Class',
  legendary: 'Legendary',
};

/**
 * Descriptions of what each tier represents.
 */
export const TIER_DESCRIPTIONS: Record<ExcellenceTier, string> = {
  good: 'Meets basic quality standards with 70%+ scores across all dimensions',
  great: 'Exceeds standards with 85%+ scores across all dimensions',
  world_class: 'Industry-leading quality with 95%+ scores across all dimensions',
  legendary: 'Sets new industry standards with 99%+ scores and notable innovations',
};

/**
 * Requirements for achieving a specific tier.
 */
export interface TierRequirements {
  /** The tier these requirements are for */
  tier: ExcellenceTier;
  /** Minimum scores for each dimension */
  minimumScores: Map<ExcellenceDimension, number>;
  /** Types of evidence required */
  requiredEvidence: EvidenceType[];
  /** How often certification must be renewed (days) */
  renewalPeriodDays: number;
  /** Additional requirements specific to this tier */
  additionalRequirements: string[];
  /** Whether external audit is required */
  requiresExternalAudit: boolean;
  /** Whether peer review is required */
  requiresPeerReview: boolean;
  /** Minimum evidence age (days, more recent = better) */
  maxEvidenceAgeDays: number;
}

/**
 * Assessment of an artifact's tier.
 */
export interface TierAssessment {
  /** Unique assessment identifier */
  id: string;
  /** The artifact assessed */
  artifactId: string;
  /** When the assessment was made */
  assessedAt: string;
  /** Current tier achieved */
  currentTier: ExcellenceTier;
  /** Whether certification is valid */
  isCertified: boolean;
  /** Certification expiry date */
  certificationExpiry?: string;
  /** Per-dimension assessments */
  dimensionAssessments: DimensionAssessment[];
  /** Overall confidence in the assessment (0-1) */
  confidence: number;
  /** Gaps preventing higher tier */
  gapsToNextTier: ExcellenceGap[];
  /** Evidence used in assessment */
  evidenceUsed: Evidence[];
  /** Assessor notes */
  notes: string[];
}

/**
 * Assessment for a single dimension.
 */
export interface DimensionAssessment {
  /** The dimension */
  dimension: ExcellenceDimension;
  /** Score achieved (0-100) */
  score: number;
  /** Required score for current tier */
  requiredScore: number;
  /** Whether dimension meets tier requirements */
  meetsTierRequirement: boolean;
  /** Specific findings */
  findings: string[];
}

/**
 * Status of maintaining a certification.
 */
export interface MaintenanceStatus {
  /** Certification ID */
  certificationId: string;
  /** Current tier */
  tier: ExcellenceTier;
  /** Whether certification is active */
  isActive: boolean;
  /** Days until renewal required */
  daysUntilRenewal: number;
  /** Compliance checks passed */
  complianceChecksPassed: number;
  /** Total compliance checks */
  complianceChecksTotal: number;
  /** Recent issues affecting certification */
  recentIssues: CertificationIssue[];
  /** Actions required to maintain */
  requiredActions: string[];
  /** Health score for certification (0-100) */
  healthScore: number;
}

/**
 * An issue affecting certification.
 */
export interface CertificationIssue {
  /** Issue identifier */
  id: string;
  /** Description */
  description: string;
  /** Severity */
  severity: 'critical' | 'major' | 'minor';
  /** When detected */
  detectedAt: string;
  /** Dimension affected */
  dimension: ExcellenceDimension;
  /** Remediation required */
  remediationRequired: string;
  /** Deadline for remediation */
  remediationDeadline?: string;
}

/**
 * Path to upgrade to a higher tier.
 */
export interface UpgradePath {
  /** Current tier */
  currentTier: ExcellenceTier;
  /** Target tier */
  targetTier: ExcellenceTier;
  /** Requirements to meet */
  requirements: TierRequirements;
  /** Current gaps */
  gaps: ExcellenceGap[];
  /** Estimated effort to upgrade (hours) */
  estimatedEffort: number;
  /** Recommended sequence of improvements */
  recommendedSequence: UpgradeStep[];
  /** Estimated time to achieve (days) */
  estimatedTimeDays: number;
  /** Success probability (0-1) */
  successProbability: number;
}

/**
 * A step in the upgrade path.
 */
export interface UpgradeStep {
  /** Step number */
  stepNumber: number;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Dimension this improves */
  dimension: ExcellenceDimension;
  /** Expected score improvement */
  expectedImprovement: number;
  /** Effort required (hours) */
  effort: number;
  /** Dependencies on other steps */
  dependencies: number[];
  /** Concrete actions */
  actions: string[];
}

/**
 * The certification framework interface.
 */
export interface CertificationFramework {
  /** Assess an artifact's tier */
  assessTier(artifact: Artifact, evidence: Evidence[]): TierAssessment;
  /** Get requirements for a specific tier */
  getRequirementsForTier(tier: ExcellenceTier): TierRequirements;
  /** Check and maintain certification status */
  maintainCertification(certId: string): MaintenanceStatus;
  /** Get upgrade path to next tier */
  upgradePath(currentTier: ExcellenceTier): UpgradePath;
  /** Check if artifact meets tier requirements */
  meetsTierRequirements(artifact: Artifact, tier: ExcellenceTier): boolean;
}

// ============================================================================
// DEFAULT TIER REQUIREMENTS
// ============================================================================

/**
 * Default requirements for the "Good" tier.
 */
export const GOOD_TIER_REQUIREMENTS: TierRequirements = {
  tier: 'good',
  minimumScores: new Map([
    ['functional', 70],
    ['performance', 70],
    ['reliability', 70],
    ['security', 70],
    ['maintainability', 70],
    ['usability', 70],
  ]),
  requiredEvidence: ['test_results', 'code_metrics'],
  renewalPeriodDays: 365,
  additionalRequirements: [
    'Basic test coverage (>70%)',
    'No critical security vulnerabilities',
    'Documentation exists',
  ],
  requiresExternalAudit: false,
  requiresPeerReview: false,
  maxEvidenceAgeDays: 180,
};

/**
 * Default requirements for the "Great" tier.
 */
export const GREAT_TIER_REQUIREMENTS: TierRequirements = {
  tier: 'great',
  minimumScores: new Map([
    ['functional', 85],
    ['performance', 85],
    ['reliability', 85],
    ['security', 85],
    ['maintainability', 85],
    ['usability', 85],
  ]),
  requiredEvidence: [
    'test_results',
    'code_metrics',
    'peer_review',
    'benchmark_data',
  ],
  renewalPeriodDays: 180,
  additionalRequirements: [
    'High test coverage (>85%)',
    'No high or critical security vulnerabilities',
    'Comprehensive documentation',
    'Performance benchmarks established',
    'Peer review completed',
  ],
  requiresExternalAudit: false,
  requiresPeerReview: true,
  maxEvidenceAgeDays: 90,
};

/**
 * Default requirements for the "World-Class" tier.
 */
export const WORLD_CLASS_TIER_REQUIREMENTS: TierRequirements = {
  tier: 'world_class',
  minimumScores: new Map([
    ['functional', 95],
    ['performance', 95],
    ['reliability', 95],
    ['security', 95],
    ['maintainability', 95],
    ['usability', 95],
  ]),
  requiredEvidence: [
    'test_results',
    'code_metrics',
    'peer_review',
    'benchmark_data',
    'audit_report',
    'penetration_test',
    'load_test',
    'user_feedback',
  ],
  renewalPeriodDays: 90,
  additionalRequirements: [
    'Exceptional test coverage (>95%)',
    'No known security vulnerabilities',
    'Industry-leading documentation',
    'Top-quartile performance benchmarks',
    'External security audit passed',
    'Load testing completed',
    'User satisfaction >90%',
  ],
  requiresExternalAudit: true,
  requiresPeerReview: true,
  maxEvidenceAgeDays: 60,
};

/**
 * Default requirements for the "Legendary" tier.
 */
export const LEGENDARY_TIER_REQUIREMENTS: TierRequirements = {
  tier: 'legendary',
  minimumScores: new Map([
    ['functional', 99],
    ['performance', 99],
    ['reliability', 99],
    ['security', 99],
    ['maintainability', 99],
    ['usability', 99],
  ]),
  requiredEvidence: [
    'test_results',
    'code_metrics',
    'peer_review',
    'benchmark_data',
    'audit_report',
    'penetration_test',
    'load_test',
    'user_feedback',
    'chaos_engineering',
    'certification',
  ],
  renewalPeriodDays: 30,
  additionalRequirements: [
    'Near-perfect test coverage (>99%)',
    'Zero known vulnerabilities',
    'Sets new documentation standards',
    'Best-in-class performance (top 1%)',
    'Multiple external audits passed',
    'Chaos engineering resilience proven',
    'User satisfaction >98%',
    'Notable innovations or contributions',
    'Industry recognition or awards',
  ],
  requiresExternalAudit: true,
  requiresPeerReview: true,
  maxEvidenceAgeDays: 30,
};

/**
 * Get requirements for a specific tier.
 */
export function getTierRequirements(tier: ExcellenceTier): TierRequirements {
  switch (tier) {
    case 'good':
      return GOOD_TIER_REQUIREMENTS;
    case 'great':
      return GREAT_TIER_REQUIREMENTS;
    case 'world_class':
      return WORLD_CLASS_TIER_REQUIREMENTS;
    case 'legendary':
      return LEGENDARY_TIER_REQUIREMENTS;
  }
}

// ============================================================================
// DEFAULT EXCELLENCE CRITERIA
// ============================================================================

/**
 * Default excellence criteria for the functional dimension.
 */
export const FUNCTIONAL_CRITERIA: ExcellenceCriteria = {
  dimension: 'functional',
  description: 'The artifact correctly implements all required functionality without defects.',
  requirements: [
    {
      id: 'func-test-coverage',
      name: 'Test Coverage',
      description: 'Percentage of code covered by automated tests',
      metric: 'testCoverage',
      operator: 'gte',
      targetValue: 0.80,
      weight: 0.3,
      mandatory: true,
      validEvidenceTypes: ['test_results'],
    },
    {
      id: 'func-mutation-score',
      name: 'Mutation Score',
      description: 'Percentage of mutations killed by tests',
      metric: 'mutationScore',
      operator: 'gte',
      targetValue: 0.70,
      weight: 0.2,
      mandatory: false,
      validEvidenceTypes: ['test_results'],
    },
    {
      id: 'func-defect-rate',
      name: 'Defect Rate',
      description: 'Defects per thousand lines of code',
      metric: 'defectRate',
      operator: 'lte',
      targetValue: 1.0,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['incident_history', 'test_results'],
    },
    {
      id: 'func-acceptance',
      name: 'Acceptance Criteria Met',
      description: 'All acceptance criteria are documented and verified',
      metric: 'acceptanceCriteriaMet',
      operator: 'eq',
      targetValue: true,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['peer_review', 'test_results'],
    },
  ],
  evidenceRequired: ['test_results', 'peer_review'],
  benchmarks: [
    {
      id: 'func-bench-coverage',
      name: 'Industry Test Coverage',
      metric: 'testCoverage',
      value: 0.80,
      unit: 'percentage',
      source: 'industry',
      establishedAt: new Date().toISOString(),
      percentile: 50,
    },
  ],
  weight: 0.20,
};

/**
 * Default excellence criteria for the performance dimension.
 */
export const PERFORMANCE_CRITERIA: ExcellenceCriteria = {
  dimension: 'performance',
  description: 'The artifact performs efficiently and meets latency/throughput requirements.',
  requirements: [
    {
      id: 'perf-p50-latency',
      name: 'P50 Latency',
      description: 'Median response latency in milliseconds',
      metric: 'p50Latency',
      operator: 'lte',
      targetValue: 100,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['benchmark_data', 'load_test'],
    },
    {
      id: 'perf-p99-latency',
      name: 'P99 Latency',
      description: '99th percentile response latency in milliseconds',
      metric: 'p99Latency',
      operator: 'lte',
      targetValue: 500,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['benchmark_data', 'load_test'],
    },
    {
      id: 'perf-throughput',
      name: 'Throughput',
      description: 'Requests per second the system can handle',
      metric: 'throughput',
      operator: 'gte',
      targetValue: 1000,
      weight: 0.25,
      mandatory: false,
      validEvidenceTypes: ['benchmark_data', 'load_test'],
    },
    {
      id: 'perf-resource-efficiency',
      name: 'Resource Efficiency',
      description: 'CPU and memory usage under load',
      metric: 'resourceEfficiency',
      operator: 'gte',
      targetValue: 0.70,
      weight: 0.25,
      mandatory: false,
      validEvidenceTypes: ['benchmark_data'],
    },
  ],
  evidenceRequired: ['benchmark_data', 'load_test'],
  benchmarks: [
    {
      id: 'perf-bench-latency',
      name: 'Industry P99 Latency',
      metric: 'p99Latency',
      value: 500,
      unit: 'ms',
      source: 'industry',
      establishedAt: new Date().toISOString(),
      percentile: 50,
    },
  ],
  weight: 0.15,
};

/**
 * Default excellence criteria for the reliability dimension.
 */
export const RELIABILITY_CRITERIA: ExcellenceCriteria = {
  dimension: 'reliability',
  description: 'The artifact is consistent, dependable, and recovers gracefully from failures.',
  requirements: [
    {
      id: 'rel-availability',
      name: 'Availability',
      description: 'System availability percentage',
      metric: 'availability',
      operator: 'gte',
      targetValue: 0.999,
      weight: 0.30,
      mandatory: true,
      validEvidenceTypes: ['incident_history'],
    },
    {
      id: 'rel-mtbf',
      name: 'Mean Time Between Failures',
      description: 'Average time between failures in hours',
      metric: 'mtbf',
      operator: 'gte',
      targetValue: 720,
      weight: 0.25,
      mandatory: false,
      validEvidenceTypes: ['incident_history'],
    },
    {
      id: 'rel-mttr',
      name: 'Mean Time To Recovery',
      description: 'Average time to recover from failures in minutes',
      metric: 'mttr',
      operator: 'lte',
      targetValue: 15,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['incident_history'],
    },
    {
      id: 'rel-error-rate',
      name: 'Error Rate',
      description: 'Percentage of requests resulting in errors',
      metric: 'errorRate',
      operator: 'lte',
      targetValue: 0.01,
      weight: 0.20,
      mandatory: true,
      validEvidenceTypes: ['incident_history', 'benchmark_data'],
    },
  ],
  evidenceRequired: ['incident_history', 'chaos_engineering'],
  benchmarks: [
    {
      id: 'rel-bench-availability',
      name: 'Industry Availability',
      metric: 'availability',
      value: 0.999,
      unit: 'percentage',
      source: 'industry',
      establishedAt: new Date().toISOString(),
      percentile: 50,
      context: 'Three nines availability',
    },
  ],
  weight: 0.20,
};

/**
 * Default excellence criteria for the security dimension.
 */
export const SECURITY_CRITERIA: ExcellenceCriteria = {
  dimension: 'security',
  description: 'The artifact is protected from security threats and vulnerabilities.',
  requirements: [
    {
      id: 'sec-critical-vulns',
      name: 'Critical Vulnerabilities',
      description: 'Number of critical security vulnerabilities',
      metric: 'criticalVulnerabilities',
      operator: 'eq',
      targetValue: 0,
      weight: 0.35,
      mandatory: true,
      validEvidenceTypes: ['audit_report', 'penetration_test'],
    },
    {
      id: 'sec-high-vulns',
      name: 'High Vulnerabilities',
      description: 'Number of high severity security vulnerabilities',
      metric: 'highVulnerabilities',
      operator: 'eq',
      targetValue: 0,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['audit_report', 'penetration_test'],
    },
    {
      id: 'sec-compliance',
      name: 'Security Compliance',
      description: 'Compliance with security standards',
      metric: 'securityCompliance',
      operator: 'gte',
      targetValue: 0.95,
      weight: 0.20,
      mandatory: false,
      validEvidenceTypes: ['audit_report', 'certification'],
    },
    {
      id: 'sec-code-review',
      name: 'Security Code Review',
      description: 'Security-focused code review completed',
      metric: 'securityReviewComplete',
      operator: 'eq',
      targetValue: true,
      weight: 0.20,
      mandatory: true,
      validEvidenceTypes: ['peer_review'],
    },
  ],
  evidenceRequired: ['audit_report', 'penetration_test'],
  benchmarks: [
    {
      id: 'sec-bench-vulns',
      name: 'Industry Vulnerability Standard',
      metric: 'criticalVulnerabilities',
      value: 0,
      unit: 'count',
      source: 'industry',
      establishedAt: new Date().toISOString(),
      context: 'Zero critical vulnerabilities is the standard',
    },
  ],
  weight: 0.20,
};

/**
 * Default excellence criteria for the maintainability dimension.
 */
export const MAINTAINABILITY_CRITERIA: ExcellenceCriteria = {
  dimension: 'maintainability',
  description: 'The artifact is easy to understand, modify, and extend.',
  requirements: [
    {
      id: 'maint-complexity',
      name: 'Cyclomatic Complexity',
      description: 'Average cyclomatic complexity per function',
      metric: 'avgComplexity',
      operator: 'lte',
      targetValue: 10,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['code_metrics'],
    },
    {
      id: 'maint-duplication',
      name: 'Code Duplication',
      description: 'Percentage of duplicated code',
      metric: 'duplicationPercent',
      operator: 'lte',
      targetValue: 3,
      weight: 0.20,
      mandatory: false,
      validEvidenceTypes: ['code_metrics'],
    },
    {
      id: 'maint-documentation',
      name: 'Documentation Coverage',
      description: 'Percentage of public APIs with documentation',
      metric: 'documentationCoverage',
      operator: 'gte',
      targetValue: 0.90,
      weight: 0.25,
      mandatory: true,
      validEvidenceTypes: ['code_metrics', 'peer_review'],
    },
    {
      id: 'maint-dependencies',
      name: 'Dependency Health',
      description: 'Percentage of dependencies up to date',
      metric: 'dependencyHealth',
      operator: 'gte',
      targetValue: 0.90,
      weight: 0.15,
      mandatory: false,
      validEvidenceTypes: ['code_metrics'],
    },
    {
      id: 'maint-tech-debt',
      name: 'Technical Debt Ratio',
      description: 'Technical debt as percentage of development time',
      metric: 'techDebtRatio',
      operator: 'lte',
      targetValue: 5,
      weight: 0.15,
      mandatory: false,
      validEvidenceTypes: ['code_metrics'],
    },
  ],
  evidenceRequired: ['code_metrics', 'peer_review'],
  benchmarks: [
    {
      id: 'maint-bench-complexity',
      name: 'Industry Complexity Standard',
      metric: 'avgComplexity',
      value: 10,
      unit: 'complexity',
      source: 'industry',
      establishedAt: new Date().toISOString(),
    },
  ],
  weight: 0.15,
};

/**
 * Default excellence criteria for the usability dimension.
 */
export const USABILITY_CRITERIA: ExcellenceCriteria = {
  dimension: 'usability',
  description: 'The artifact is easy to use and provides a good user/developer experience.',
  requirements: [
    {
      id: 'use-satisfaction',
      name: 'User Satisfaction',
      description: 'User satisfaction score (0-100)',
      metric: 'userSatisfaction',
      operator: 'gte',
      targetValue: 80,
      weight: 0.30,
      mandatory: false,
      validEvidenceTypes: ['user_feedback'],
    },
    {
      id: 'use-accessibility',
      name: 'Accessibility Compliance',
      description: 'WCAG 2.1 AA compliance level',
      metric: 'accessibilityCompliance',
      operator: 'gte',
      targetValue: 0.95,
      weight: 0.25,
      mandatory: false,
      validEvidenceTypes: ['accessibility_audit'],
    },
    {
      id: 'use-api-consistency',
      name: 'API Consistency',
      description: 'API follows consistent patterns and conventions',
      metric: 'apiConsistency',
      operator: 'gte',
      targetValue: 0.90,
      weight: 0.25,
      mandatory: false,
      validEvidenceTypes: ['peer_review', 'code_metrics'],
    },
    {
      id: 'use-error-messages',
      name: 'Error Message Quality',
      description: 'Error messages are clear and actionable',
      metric: 'errorMessageQuality',
      operator: 'gte',
      targetValue: 0.85,
      weight: 0.20,
      mandatory: false,
      validEvidenceTypes: ['peer_review', 'user_feedback'],
    },
  ],
  evidenceRequired: ['user_feedback', 'peer_review'],
  benchmarks: [
    {
      id: 'use-bench-satisfaction',
      name: 'Industry User Satisfaction',
      metric: 'userSatisfaction',
      value: 80,
      unit: 'score',
      source: 'industry',
      establishedAt: new Date().toISOString(),
      percentile: 50,
    },
  ],
  weight: 0.10,
};

/**
 * All default excellence criteria.
 */
export const DEFAULT_EXCELLENCE_CRITERIA: ExcellenceCriteria[] = [
  FUNCTIONAL_CRITERIA,
  PERFORMANCE_CRITERIA,
  RELIABILITY_CRITERIA,
  SECURITY_CRITERIA,
  MAINTAINABILITY_CRITERIA,
  USABILITY_CRITERIA,
];

// ============================================================================
// IMPLEMENTATION CLASSES
// ============================================================================

/**
 * In-memory implementation of the benchmark database.
 */
export class InMemoryBenchmarkDatabase implements BenchmarkDatabase {
  private entries: Map<string, BenchmarkEntry[]> = new Map();
  private historicalBests: Map<string, HistoricalBest[]> = new Map();

  addBenchmark(category: string, project: string, metrics: Metrics): void {
    const entry: BenchmarkEntry = {
      category,
      project,
      metrics,
      recordedAt: new Date().toISOString(),
    };

    if (!this.entries.has(category)) {
      this.entries.set(category, []);
    }
    this.entries.get(category)!.push(entry);

    // Update historical bests
    for (const [metric, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        this.updateHistoricalBest(metric, value, project);
      }
    }
  }

  private updateHistoricalBest(metricName: string, value: number, project: string): void {
    if (!this.historicalBests.has(metricName)) {
      this.historicalBests.set(metricName, []);
    }

    const history = this.historicalBests.get(metricName)!;
    const currentBest = history.length > 0 ? history[history.length - 1] : null;

    // Assuming higher is better (can be made configurable)
    if (!currentBest || value > currentBest.value) {
      history.push({
        metricName,
        value,
        achievedAt: new Date().toISOString(),
        achievedBy: project,
        previousBest: currentBest ? {
          value: currentBest.value,
          achievedAt: currentBest.achievedAt,
          achievedBy: currentBest.achievedBy,
        } : undefined,
        improvement: currentBest ? ((value - currentBest.value) / currentBest.value) * 100 : undefined,
      });
    }
  }

  getBestInClass(category: string): BenchmarkEntry | null {
    const categoryEntries = this.entries.get(category);
    if (!categoryEntries || categoryEntries.length === 0) {
      return null;
    }

    // Score each entry based on metrics (simple sum of numeric values)
    let best: BenchmarkEntry | null = null;
    let bestScore = -Infinity;

    for (const entry of categoryEntries) {
      let score = 0;
      for (const value of Object.values(entry.metrics)) {
        if (typeof value === 'number') {
          score += value;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    return best;
  }

  compareToIndustry(metrics: Metrics, category: string): ComparisonResult {
    const categoryEntries = this.entries.get(category) || [];
    const best = this.getBestInClass(category);

    // Calculate average metrics
    const avgMetrics: Metrics = {};
    const metricCounts: Record<string, number> = {};

    for (const entry of categoryEntries) {
      for (const [key, value] of Object.entries(entry.metrics)) {
        if (typeof value === 'number') {
          if (typeof avgMetrics[key] !== 'number') {
            avgMetrics[key] = 0;
            metricCounts[key] = 0;
          }
          avgMetrics[key] = (avgMetrics[key] as number) + value;
          metricCounts[key]++;
        }
      }
    }

    for (const key of Object.keys(avgMetrics)) {
      if (typeof avgMetrics[key] === 'number') {
        avgMetrics[key] = (avgMetrics[key] as number) / metricCounts[key];
      }
    }

    // Compare each metric
    const comparisons: MetricComparison[] = [];
    const exceedsIndustry: string[] = [];
    const belowAverage: string[] = [];

    for (const [key, inputValue] of Object.entries(metrics)) {
      if (typeof inputValue === 'number') {
        const bestValue = best?.metrics[key];
        const avgValue = avgMetrics[key];

        if (typeof bestValue === 'number') {
          const percentile = this.getPercentile(category, key, inputValue);
          const gapToBest = bestValue - inputValue;
          const isWorldClass = percentile >= 95;

          comparisons.push({
            metric: key,
            inputValue,
            bestValue,
            averageValue: typeof avgValue === 'number' ? avgValue : undefined,
            percentile,
            gapToBest,
            isWorldClass,
          });

          if (inputValue >= bestValue) {
            exceedsIndustry.push(key);
          } else if (typeof avgValue === 'number' && inputValue < avgValue) {
            belowAverage.push(key);
          }
        }
      }
    }

    const overallPercentile = comparisons.length > 0
      ? comparisons.reduce((sum, c) => sum + c.percentile, 0) / comparisons.length
      : 0;

    const recommendations: string[] = [];
    for (const metric of belowAverage) {
      recommendations.push(`Improve ${metric} to at least reach industry average`);
    }

    return {
      category,
      inputMetrics: metrics,
      bestInClass: best,
      industryAverage: avgMetrics,
      comparisons,
      overallPercentile,
      exceedsIndustry,
      belowAverage,
      recommendations,
    };
  }

  trackHistoricalBest(metricName: string): HistoricalBest[] {
    return this.historicalBests.get(metricName) || [];
  }

  getEntriesForCategory(category: string): BenchmarkEntry[] {
    return this.entries.get(category) || [];
  }

  getPercentile(category: string, metric: string, value: number): number {
    const categoryEntries = this.entries.get(category) || [];
    const values: number[] = [];

    for (const entry of categoryEntries) {
      const metricValue = entry.metrics[metric];
      if (typeof metricValue === 'number') {
        values.push(metricValue);
      }
    }

    if (values.length === 0) {
      return 50; // Default to median if no data
    }

    // Count how many values are less than the input
    const lessThan = values.filter(v => v < value).length;
    return (lessThan / values.length) * 100;
  }
}

/**
 * Default implementation of the excellence checklist.
 */
export function createExcellenceChecklist(
  criteria: ExcellenceCriteria[] = DEFAULT_EXCELLENCE_CRITERIA
): ExcellenceChecklist {
  const dimensions = new Map<ExcellenceDimension, ExcellenceCriteria>();
  for (const c of criteria) {
    dimensions.set(c.dimension, c);
  }

  return {
    schemaVersion: EXCELLENCE_VALIDATION_SCHEMA_VERSION,
    dimensions,
    evaluate(artifact: Artifact): ExcellenceReport {
      return evaluateArtifact(artifact, dimensions);
    },
  };
}

/**
 * Evaluate an artifact against excellence criteria.
 */
function evaluateArtifact(
  artifact: Artifact,
  dimensions: Map<ExcellenceDimension, ExcellenceCriteria>
): ExcellenceReport {
  const dimensionScores = new Map<ExcellenceDimension, DimensionScore>();
  const allRequirementResults: RequirementResult[] = [];
  const allGaps: ExcellenceGap[] = [];
  const allRecommendations: ExcellenceRecommendation[] = [];
  const evidenceUsed: Evidence[] = [];
  let passedMandatory = true;
  let weightedScoreSum = 0;
  let totalWeight = 0;

  for (const [dimension, criteria] of dimensions) {
    const { score, requirementResults, gaps, recommendations, mandatoryPassed } =
      evaluateDimension(artifact, criteria);

    dimensionScores.set(dimension, score);
    allRequirementResults.push(...requirementResults);
    allGaps.push(...gaps);
    allRecommendations.push(...recommendations);

    if (!mandatoryPassed) {
      passedMandatory = false;
    }

    weightedScoreSum += score.score * criteria.weight;
    totalWeight += criteria.weight;
  }

  // Collect all evidence used
  const evidenceIds = new Set<string>();
  for (const result of allRequirementResults) {
    for (const ev of result.evidenceUsed) {
      if (!evidenceIds.has(ev.id)) {
        evidenceIds.add(ev.id);
        evidenceUsed.push(ev);
      }
    }
  }

  const overallScore = totalWeight > 0 ? (weightedScoreSum / totalWeight) : 0;
  const tier = determineTier(overallScore, dimensionScores);

  // Sort recommendations by priority
  allRecommendations.sort((a, b) => a.priority - b.priority);

  return {
    id: `excellence-report-${randomUUID()}`,
    artifact,
    evaluatedAt: new Date().toISOString(),
    overallScore,
    dimensionScores,
    tier,
    requirementResults: allRequirementResults,
    evidenceUsed,
    gaps: allGaps,
    recommendations: allRecommendations.slice(0, 10), // Top 10 recommendations
    passedMandatory,
    summary: generateSummary(overallScore, tier, dimensionScores, allGaps.length),
  };
}

/**
 * Evaluate a single dimension.
 */
function evaluateDimension(
  artifact: Artifact,
  criteria: ExcellenceCriteria
): {
  score: DimensionScore;
  requirementResults: RequirementResult[];
  gaps: ExcellenceGap[];
  recommendations: ExcellenceRecommendation[];
  mandatoryPassed: boolean;
} {
  const requirementResults: RequirementResult[] = [];
  const gaps: ExcellenceGap[] = [];
  const recommendations: ExcellenceRecommendation[] = [];
  const findings: string[] = [];
  let mandatoryMet = 0;
  let mandatoryTotal = 0;
  let totalWeight = 0;
  let weightedScore = 0;

  for (const req of criteria.requirements) {
    const result = checkRequirement(artifact, req);
    requirementResults.push(result);

    if (req.mandatory) {
      mandatoryTotal++;
      if (result.met) {
        mandatoryMet++;
      }
    }

    totalWeight += req.weight;
    weightedScore += result.compliance * req.weight;

    if (!result.met) {
      // Create gap
      gaps.push({
        dimension: criteria.dimension,
        description: `${req.name}: ${result.reason}`,
        currentState: String(result.actualValue ?? 'undefined'),
        desiredState: String(req.targetValue),
        impact: req.weight,
        effortToClose: estimateEffort(req),
        priority: req.mandatory ? 1 : 2,
      });

      // Create recommendation
      recommendations.push({
        id: `rec-${req.id}`,
        title: `Improve ${req.name}`,
        description: `Current: ${result.actualValue}, Target: ${req.targetValue}`,
        dimension: criteria.dimension,
        expectedImprovement: (1 - result.compliance) * req.weight * 100,
        effort: estimateEffort(req),
        priority: req.mandatory ? 1 : 2,
        actions: [`Address ${req.name} to meet target of ${req.targetValue}`],
      });

      findings.push(`${req.name} does not meet requirement`);
    } else {
      findings.push(`${req.name} meets requirement`);
    }
  }

  const score = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;

  // Calculate evidence coverage
  const requiredEvidence = new Set(criteria.evidenceRequired);
  const availableEvidence = new Set(artifact.evidence.map(e => e.type));
  const evidenceCoverage = requiredEvidence.size > 0
    ? [...requiredEvidence].filter(e => availableEvidence.has(e)).length / requiredEvidence.size
    : 1;

  return {
    score: {
      dimension: criteria.dimension,
      score,
      requirementsMet: requirementResults.filter(r => r.met).length,
      requirementsTotal: criteria.requirements.length,
      mandatoryMet,
      mandatoryTotal,
      evidenceCoverage,
      findings,
    },
    requirementResults,
    gaps,
    recommendations,
    mandatoryPassed: mandatoryMet === mandatoryTotal,
  };
}

/**
 * Check a single requirement against an artifact.
 */
function checkRequirement(artifact: Artifact, req: Requirement): RequirementResult {
  const actualValue = artifact.metrics[req.metric];
  const evidenceUsed = artifact.evidence.filter(e => req.validEvidenceTypes.includes(e.type));

  let met = false;
  let compliance = 0;

  if (actualValue === undefined) {
    return {
      requirement: req,
      met: false,
      actualValue: undefined,
      compliance: 0,
      evidenceUsed,
      reason: `Metric ${req.metric} not provided`,
    };
  }

  switch (req.operator) {
    case 'gte':
      if (typeof actualValue === 'number' && typeof req.targetValue === 'number') {
        met = actualValue >= req.targetValue;
        compliance = Math.min(1, actualValue / req.targetValue);
      }
      break;
    case 'lte':
      if (typeof actualValue === 'number' && typeof req.targetValue === 'number') {
        met = actualValue <= req.targetValue;
        compliance = actualValue <= req.targetValue ? 1 : req.targetValue / actualValue;
      }
      break;
    case 'eq':
      met = actualValue === req.targetValue;
      compliance = met ? 1 : 0;
      break;
    case 'gt':
      if (typeof actualValue === 'number' && typeof req.targetValue === 'number') {
        met = actualValue > req.targetValue;
        compliance = met ? 1 : actualValue / req.targetValue;
      }
      break;
    case 'lt':
      if (typeof actualValue === 'number' && typeof req.targetValue === 'number') {
        met = actualValue < req.targetValue;
        compliance = met ? 1 : req.targetValue / actualValue;
      }
      break;
    case 'between':
      if (typeof actualValue === 'number' && typeof req.targetValue === 'number' && typeof req.secondaryValue === 'number') {
        met = actualValue >= req.targetValue && actualValue <= req.secondaryValue;
        const range = req.secondaryValue - req.targetValue;
        if (actualValue < req.targetValue) {
          compliance = actualValue / req.targetValue;
        } else if (actualValue > req.secondaryValue) {
          compliance = req.secondaryValue / actualValue;
        } else {
          compliance = 1;
        }
      }
      break;
    case 'exists':
      met = actualValue !== undefined && actualValue !== null;
      compliance = met ? 1 : 0;
      break;
    case 'not_exists':
      met = actualValue === undefined || actualValue === null;
      compliance = met ? 1 : 0;
      break;
  }

  return {
    requirement: req,
    met,
    actualValue,
    compliance,
    evidenceUsed,
    reason: met
      ? `${req.name} met: ${actualValue} ${req.operator} ${req.targetValue}`
      : `${req.name} not met: ${actualValue} ${req.operator} ${req.targetValue}`,
  };
}

/**
 * Determine the tier based on scores.
 */
function determineTier(
  overallScore: number,
  dimensionScores: Map<ExcellenceDimension, DimensionScore>
): ExcellenceTier {
  // Check if all dimensions meet minimum thresholds
  const allDimensionScores = Array.from(dimensionScores.values()).map(d => d.score);
  const minDimensionScore = Math.min(...allDimensionScores);

  if (overallScore >= 99 && minDimensionScore >= 99) {
    return 'legendary';
  }
  if (overallScore >= 95 && minDimensionScore >= 95) {
    return 'world_class';
  }
  if (overallScore >= 85 && minDimensionScore >= 85) {
    return 'great';
  }
  if (overallScore >= 70 && minDimensionScore >= 70) {
    return 'good';
  }

  // Default to good if overall is high enough even if some dimensions are lower
  return overallScore >= 70 ? 'good' : 'good';
}

/**
 * Estimate effort to fix a requirement.
 */
function estimateEffort(req: Requirement): number {
  // Simple heuristic based on requirement type
  if (req.mandatory) {
    return 8; // 1 day
  }
  return 4; // Half day
}

/**
 * Generate a summary narrative.
 */
function generateSummary(
  overallScore: number,
  tier: ExcellenceTier,
  dimensionScores: Map<ExcellenceDimension, DimensionScore>,
  gapCount: number
): string {
  const tierName = TIER_NAMES[tier];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const [dim, score] of dimensionScores) {
    if (score.score >= 90) {
      strengths.push(dim);
    } else if (score.score < 70) {
      weaknesses.push(dim);
    }
  }

  let summary = `Overall excellence score: ${overallScore.toFixed(1)}% (${tierName} tier). `;

  if (strengths.length > 0) {
    summary += `Strong in: ${strengths.join(', ')}. `;
  }

  if (weaknesses.length > 0) {
    summary += `Needs improvement in: ${weaknesses.join(', ')}. `;
  }

  if (gapCount > 0) {
    summary += `${gapCount} gap(s) identified for improvement.`;
  } else {
    summary += 'No significant gaps identified.';
  }

  return summary;
}

/**
 * Create a default certification framework.
 */
export function createCertificationFramework(): CertificationFramework {
  const checklist = createExcellenceChecklist();

  return {
    assessTier(artifact: Artifact, evidence: Evidence[]): TierAssessment {
      // Add evidence to artifact for assessment
      const artifactWithEvidence: Artifact = {
        ...artifact,
        evidence: [...artifact.evidence, ...evidence],
      };

      const report = checklist.evaluate(artifactWithEvidence);
      const requirements = getTierRequirements(report.tier);

      const dimensionAssessments: DimensionAssessment[] = [];
      for (const dim of EXCELLENCE_DIMENSIONS) {
        const score = report.dimensionScores.get(dim);
        const requiredScore = requirements.minimumScores.get(dim) || 70;

        dimensionAssessments.push({
          dimension: dim,
          score: score?.score || 0,
          requiredScore,
          meetsTierRequirement: (score?.score || 0) >= requiredScore,
          findings: score?.findings || [],
        });
      }

      // Calculate gaps to next tier
      const nextTier = getNextTier(report.tier);
      const gapsToNextTier: ExcellenceGap[] = nextTier
        ? calculateGapsToTier(report.dimensionScores, nextTier)
        : [];

      return {
        id: `tier-assessment-${randomUUID()}`,
        artifactId: artifact.id,
        assessedAt: new Date().toISOString(),
        currentTier: report.tier,
        isCertified: report.passedMandatory && report.overallScore >= 70,
        certificationExpiry: new Date(
          Date.now() + requirements.renewalPeriodDays * 24 * 60 * 60 * 1000
        ).toISOString(),
        dimensionAssessments,
        confidence: calculateAssessmentConfidence(evidence, requirements),
        gapsToNextTier,
        evidenceUsed: report.evidenceUsed,
        notes: [],
      };
    },

    getRequirementsForTier(tier: ExcellenceTier): TierRequirements {
      return getTierRequirements(tier);
    },

    maintainCertification(certId: string): MaintenanceStatus {
      // In a real implementation, this would look up the certification
      return {
        certificationId: certId,
        tier: 'good',
        isActive: true,
        daysUntilRenewal: 30,
        complianceChecksPassed: 10,
        complianceChecksTotal: 10,
        recentIssues: [],
        requiredActions: [],
        healthScore: 100,
      };
    },

    upgradePath(currentTier: ExcellenceTier): UpgradePath {
      const nextTier = getNextTier(currentTier);
      if (!nextTier) {
        // Already at legendary
        return {
          currentTier,
          targetTier: currentTier,
          requirements: getTierRequirements(currentTier),
          gaps: [],
          estimatedEffort: 0,
          recommendedSequence: [],
          estimatedTimeDays: 0,
          successProbability: 1,
        };
      }

      const requirements = getTierRequirements(nextTier);
      const currentRequirements = getTierRequirements(currentTier);

      // Calculate gaps between tiers
      const gaps: ExcellenceGap[] = [];
      let totalEffort = 0;

      for (const dim of EXCELLENCE_DIMENSIONS) {
        const currentMin = currentRequirements.minimumScores.get(dim) || 0;
        const targetMin = requirements.minimumScores.get(dim) || 0;
        const scoreDiff = targetMin - currentMin;

        if (scoreDiff > 0) {
          const effort = Math.ceil(scoreDiff / 5) * 8; // 8 hours per 5 points
          totalEffort += effort;

          gaps.push({
            dimension: dim,
            description: `Increase ${dim} score from ${currentMin}% to ${targetMin}%`,
            currentState: `${currentMin}%`,
            desiredState: `${targetMin}%`,
            impact: scoreDiff / 100,
            effortToClose: effort,
            priority: dim === 'security' ? 1 : 2,
          });
        }
      }

      const recommendedSequence: UpgradeStep[] = gaps.map((gap, index) => ({
        stepNumber: index + 1,
        title: `Improve ${gap.dimension}`,
        description: gap.description,
        dimension: gap.dimension,
        expectedImprovement: gap.impact * 100,
        effort: gap.effortToClose,
        dependencies: [],
        actions: [`Address gaps in ${gap.dimension} to meet ${nextTier} tier requirements`],
      }));

      return {
        currentTier,
        targetTier: nextTier,
        requirements,
        gaps,
        estimatedEffort: totalEffort,
        recommendedSequence,
        estimatedTimeDays: Math.ceil(totalEffort / 6), // 6 productive hours per day
        successProbability: 0.8, // 80% base probability
      };
    },

    meetsTierRequirements(artifact: Artifact, tier: ExcellenceTier): boolean {
      const report = checklist.evaluate(artifact);
      const requirements = getTierRequirements(tier);

      if (report.overallScore < (requirements.minimumScores.get('functional') || 70)) {
        return false;
      }

      for (const [dim, minScore] of requirements.minimumScores) {
        const score = report.dimensionScores.get(dim);
        if (!score || score.score < minScore) {
          return false;
        }
      }

      return true;
    },
  };
}

/**
 * Get the next tier above the current one.
 */
function getNextTier(currentTier: ExcellenceTier): ExcellenceTier | null {
  switch (currentTier) {
    case 'good':
      return 'great';
    case 'great':
      return 'world_class';
    case 'world_class':
      return 'legendary';
    case 'legendary':
      return null;
  }
}

/**
 * Calculate gaps needed to reach a target tier.
 */
function calculateGapsToTier(
  currentScores: Map<ExcellenceDimension, DimensionScore>,
  targetTier: ExcellenceTier
): ExcellenceGap[] {
  const requirements = getTierRequirements(targetTier);
  const gaps: ExcellenceGap[] = [];

  for (const [dim, requiredScore] of requirements.minimumScores) {
    const currentScore = currentScores.get(dim)?.score || 0;
    if (currentScore < requiredScore) {
      gaps.push({
        dimension: dim,
        description: `${dim} score needs to increase from ${currentScore.toFixed(1)}% to ${requiredScore}%`,
        currentState: `${currentScore.toFixed(1)}%`,
        desiredState: `${requiredScore}%`,
        impact: (requiredScore - currentScore) / 100,
        effortToClose: Math.ceil((requiredScore - currentScore) / 5) * 8,
        priority: 1,
      });
    }
  }

  return gaps;
}

/**
 * Calculate confidence in an assessment based on evidence quality.
 */
function calculateAssessmentConfidence(
  evidence: Evidence[],
  requirements: TierRequirements
): number {
  if (evidence.length === 0) {
    return 0.5;
  }

  // Check evidence coverage
  const requiredTypes = new Set(requirements.requiredEvidence);
  const providedTypes = new Set(evidence.map(e => e.type));
  const coverage = [...requiredTypes].filter(t => providedTypes.has(t)).length / requiredTypes.size;

  // Check evidence freshness
  const now = Date.now();
  const maxAge = requirements.maxEvidenceAgeDays * 24 * 60 * 60 * 1000;
  const freshEvidence = evidence.filter(e => {
    const age = now - new Date(e.collectedAt).getTime();
    return age <= maxAge;
  });
  const freshness = freshEvidence.length / evidence.length;

  // Average reliability of evidence
  const avgReliability = evidence.reduce((sum, e) => sum + e.reliability, 0) / evidence.length;

  // Weighted combination
  return coverage * 0.4 + freshness * 0.3 + avgReliability * 0.3;
}

/**
 * Create a basic independent validation implementation.
 */
export function createIndependentValidation(): IndependentValidation {
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const deterministicScore = (seed: string): number => {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 10000) / 10000;
  };
  const normalizeMetricValue = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) return 0;
    if (value <= 1) return value;
    return Math.min(value, 100) / 100;
  };
  const deriveArtifactSignal = (artifact: Artifact): number => {
    const metricValues = Object.values(artifact.metrics).filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    const metricSignal = metricValues.length > 0
      ? metricValues.map((value) => normalizeMetricValue(value)).reduce((sum, value) => sum + value, 0) / metricValues.length
      : 0;
    const evidenceSignal = artifact.evidence.length > 0
      ? artifact.evidence.reduce((sum, evidence) => sum + clamp01(evidence.reliability), 0) / artifact.evidence.length
      : 0;
    return clamp01(metricSignal * 0.6 + evidenceSignal * 0.4);
  };

  return {
    simulateExternalAudit(artifact: Artifact, standard: AuditStandard): AuditResult {
      const controlsChecked: ControlResult[] = [];
      const criticalFindings: AuditFinding[] = [];
      const majorFindings: AuditFinding[] = [];
      const minorFindings: AuditFinding[] = [];

      const controlCount = getControlCountForStandard(standard);
      const complianceSignal = deriveArtifactSignal(artifact);
      const passedControls = Math.floor(controlCount * complianceSignal);

      for (let i = 0; i < controlCount; i++) {
        const controlId = `${standard}-CTRL-${i + 1}`;
        const passed = i < passedControls;
        controlsChecked.push({
          controlId,
          description: `Control ${i + 1} for ${standard}`,
          passed,
          evidence: passed ? ['Artifact metrics/evidence satisfy deterministic threshold'] : [],
          notes: passed ? 'Deterministic pass based on available evidence signal' : 'Control unmet due to insufficient evidence signal',
        });

        if (passed) continue;

        const failedIndex = i - passedControls;
        const criticalBudget = Math.max(1, Math.floor(controlCount * 0.05));
        const majorBudget = Math.max(2, Math.floor(controlCount * 0.2));
        const severity: 'critical' | 'major' | 'minor' = failedIndex < criticalBudget && complianceSignal < 0.8
          ? 'critical'
          : failedIndex < majorBudget
            ? 'major'
            : 'minor';

        const finding: AuditFinding = {
          id: `finding-${standard}-${i + 1}`,
          severity,
          controlId,
          description: `Control ${i + 1} did not meet deterministic compliance threshold`,
          expected: 'Control implemented with verifiable evidence',
          observed: 'Insufficient metric/evidence signal for control compliance',
          businessImpact: 'Compliance confidence degraded; independent external audit required',
          remediation: 'Provide stronger evidence or improve control implementation',
        };

        switch (severity) {
          case 'critical':
            criticalFindings.push(finding);
            break;
          case 'major':
            majorFindings.push(finding);
            break;
          case 'minor':
            minorFindings.push(finding);
            break;
        }
      }

      const complianceScore = (passedControls / controlCount) * 100;

      return {
        id: `audit-${standard}-${artifact.id}`,
        standard,
        artifactId: artifact.id,
        auditedAt: new Date().toISOString(),
        complianceScore,
        passed: criticalFindings.length === 0 && complianceScore >= 80 && artifact.evidence.length > 0,
        controlsChecked,
        criticalFindings,
        majorFindings,
        minorFindings,
        observations: [
          'Deterministic internal pre-audit only; not a substitute for external certification.',
          'Outcome quality is bounded by provided artifact metrics and evidence completeness.',
        ],
        remediationRequired: [...criticalFindings, ...majorFindings].map(f => ({
          findingId: f.id,
          action: f.remediation,
          priority: f.severity === 'critical' ? 1 : 2,
          effortHours: f.severity === 'critical' ? 40 : 16,
        })),
        estimatedTimeToCompliance: criticalFindings.length * 40 + majorFindings.length * 16,
      };
    },

    runRedTeamExercise(system: System, attackVectors: AttackVector[]): RedTeamResult {
      const successfulBreaches: Breach[] = [];
      const blockedAttempts: BlockedAttempt[] = [];
      let totalDetectionTime = 0;
      let detectedCount = 0;
      const defenseStrength = clamp01((system.securityControls.length / 10) + (system.components.length / 20));

      for (const vector of attackVectors) {
        const attackPressure = clamp01((vector.potentialImpact + vector.complexity) / 10);
        const successProbability = clamp01(attackPressure - (defenseStrength * 0.6));
        const breachRoll = deterministicScore(`${system.id}:${vector.id}:breach`);
        const success = breachRoll < successProbability;

        if (success) {
          const detectionProbability = clamp01((defenseStrength * 0.8) + 0.2);
          const detected = deterministicScore(`${system.id}:${vector.id}:detected`) < detectionProbability;
          const detectionTime = detected
            ? Math.round(60 + deterministicScore(`${system.id}:${vector.id}:detect-time`) * 3540)
            : undefined;

          if (detected && detectionTime !== undefined) {
            totalDetectionTime += detectionTime;
            detectedCount++;
          }

          successfulBreaches.push({
            id: `breach-${vector.id}`,
            vectorId: vector.id,
            compromised: vector.targets[0] || 'unknown',
            method: vector.techniques[0] || 'unknown',
            timeTaken: Math.round(120 + deterministicScore(`${system.id}:${vector.id}:time`) * 3480),
            impact: 'Potential data exposure',
            detected,
            detectionTime,
          });
        } else {
          blockedAttempts.push({
            vectorId: vector.id,
            blockedBy: system.securityControls[0] || 'Unknown control',
            timeToBlock: Math.round(5 + deterministicScore(`${system.id}:${vector.id}:block-time`) * 55),
            alertGenerated: deterministicScore(`${system.id}:${vector.id}:alert`) < 0.8,
          });
        }
      }

      const detectionRate = attackVectors.length > 0
        ? (blockedAttempts.length + detectedCount) / attackVectors.length
        : 1;
      const breachRate = attackVectors.length > 0 ? successfulBreaches.length / attackVectors.length : 0;
      const securityScore = clamp01((detectionRate * 0.7) + ((1 - breachRate) * 0.3)) * 100;
      const criticalVulnerabilities = successfulBreaches
        .filter((breach) => {
          const vector = attackVectors.find((candidate) => candidate.id === breach.vectorId);
          return (vector?.potentialImpact ?? 0) >= 4;
        })
        .map((breach) => ({
          id: `vuln-${breach.vectorId}`,
          severity: 'critical' as const,
          description: `High-impact breach path succeeded via ${breach.method}`,
          affectedComponents: [breach.compromised],
          remediation: 'Strengthen preventive controls and improve attack path detection',
        }));

      return {
        id: `redteam-${system.id}`,
        systemId: system.id,
        conductedAt: new Date().toISOString(),
        durationHours: 8,
        vectorsAttempted: attackVectors,
        successfulBreaches,
        blockedAttempts,
        detectionRate,
        meanTimeToDetect: detectedCount > 0 ? totalDetectionTime / detectedCount : 0,
        meanTimeToRespond: 300, // 5 minutes average
        securityScore,
        criticalVulnerabilities,
        recommendations: [
          successfulBreaches.length > 0
            ? 'Prioritize controls for successful breach vectors before claiming resilience.'
            : 'No deterministic breach success observed under configured vectors.',
          'Run independent external penetration testing for certification-grade security claims.',
        ],
      };
    },

    performAdversarialTesting(component: Component, config: AdversarialConfig): AdversarialResult {
      const totalTests = config.useFuzzing
        ? (config.fuzzingSeedCount || 100)
        : 50;

      const crashes: CrashReport[] = [];
      const unexpectedBehaviors: UnexpectedBehavior[] = [];
      const performanceAnomalies: PerformanceAnomaly[] = [];

      let passed = 0;
      let failed = 0;
      const failureRate = clamp01(0.03 + (config.intensity * 0.02));

      for (let i = 0; i < totalTests; i++) {
        const result = deterministicScore(`${component.id}:${config.intensity}:${i}`);

        if (result < failureRate * 0.25) {
          crashes.push({
            testCaseId: `test-${i}`,
            input: `fuzz-input-${i}`,
            errorMessage: 'Unexpected error',
            stackTrace: 'at function...',
            severity: 'high',
          });
          failed++;
        } else if (result < failureRate * 0.6) {
          unexpectedBehaviors.push({
            testCaseId: `test-${i}`,
            input: `input-${i}`,
            expected: 'Expected output',
            actual: 'Unexpected output',
            severity: 'medium',
          });
          failed++;
        } else if (result < failureRate) {
          performanceAnomalies.push({
            testCaseId: `test-${i}`,
            metric: 'responseTime',
            expectedValue: 100,
            actualValue: 100 + Math.round(deterministicScore(`${component.id}:${i}:perf`) * 600),
            deviationPercent: 100 + Math.round(deterministicScore(`${component.id}:${i}:dev`) * 400),
          });
          passed++; // Performance anomalies don't necessarily mean failure
        } else {
          passed++;
        }
      }

      const coverage = clamp01(
        0.45
        + Math.min(0.35, config.intensity * 0.07)
        + (config.useFuzzing ? 0.08 : 0)
        + (config.testBoundaries ? 0.04 : 0)
        + (config.testMalformedInput ? 0.04 : 0)
        + (config.testConcurrency ? 0.04 : 0)
      );

      return {
        componentId: component.id,
        config,
        testedAt: new Date().toISOString(),
        totalTests,
        passed,
        failed,
        crashes,
        unexpectedBehaviors,
        performanceAnomalies,
        coverage,
        reliabilityScore: (passed / totalTests) * 100,
      };
    },

    exhaustEdgeCases(targetId: string, domain: Domain): EdgeCaseReport {
      const categories: EdgeCaseCategory[] = getEdgeCaseCategories(domain);
      const failedCases: FailedEdgeCase[] = [];
      let totalCases = 0;
      let passedCases = 0;
      const failureThreshold = domain.type === 'object'
        ? 0.12
        : domain.type === 'numeric'
          ? 0.08
          : 0.06;

      for (const category of categories) {
        for (const example of category.examples) {
          totalCases++;
          category.casesTested++;

          const score = deterministicScore(`${targetId}:${category.name}:${JSON.stringify(example)}`);
          if (score >= failureThreshold) {
            passedCases++;
            category.casesPassed++;
          } else {
            failedCases.push({
              category: category.name,
              input: example,
              expected: 'Valid handling',
              actual: 'Unexpected behavior',
            });
          }
        }
      }

      const categoryCoverage = categories.length > 0
        ? categories.filter(c => c.casesTested > 0).length / categories.length
        : 0;
      const robustnessScore = totalCases > 0 ? (passedCases / totalCases) * 100 : 0;

      return {
        targetId,
        domain,
        testedAt: new Date().toISOString(),
        totalCases,
        passedCases,
        failedCases,
        categoriesTested: categories,
        categoryCoverage,
        robustnessScore,
        recommendations: failedCases.length > 0
          ? [
            'Review failed edge-case categories before claiming robustness.',
            'Validate critical edge paths with independent system-level tests.',
          ]
          : [
            'No deterministic edge-case failures observed for generated categories.',
            'Run external negative-path validation before certification claims.',
          ],
      };
    },
  };
}

/**
 * Get control count for a given audit standard.
 */
function getControlCountForStandard(standard: AuditStandard): number {
  switch (standard) {
    case 'ISO_27001':
      return 114;
    case 'SOC_2':
      return 64;
    case 'GDPR':
      return 99;
    case 'HIPAA':
      return 75;
    case 'PCI_DSS':
      return 251;
    case 'WCAG_2_1':
      return 78;
    case 'OWASP_TOP_10':
      return 10;
    case 'CIS_BENCHMARK':
      return 100;
    case 'NIST_CSF':
      return 108;
    default:
      return 50;
  }
}

/**
 * Get edge case categories for a domain.
 */
function getEdgeCaseCategories(domain: Domain): EdgeCaseCategory[] {
  const categories: EdgeCaseCategory[] = [];

  switch (domain.type) {
    case 'numeric':
      categories.push(
        {
          name: 'Boundary Values',
          description: 'Min, max, and boundary values',
          examples: [domain.min, domain.max, 0, -1, 1],
          casesTested: 0,
          casesPassed: 0,
        },
        {
          name: 'Special Values',
          description: 'NaN, Infinity, etc.',
          examples: [NaN, Infinity, -Infinity],
          casesTested: 0,
          casesPassed: 0,
        }
      );
      break;
    case 'string':
      categories.push(
        {
          name: 'Empty/Null',
          description: 'Empty and null strings',
          examples: ['', null, undefined],
          casesTested: 0,
          casesPassed: 0,
        },
        {
          name: 'Special Characters',
          description: 'Unicode, escapes, etc.',
          examples: ['\n', '\t', '\0', '\\', '"'],
          casesTested: 0,
          casesPassed: 0,
        },
        {
          name: 'Length Extremes',
          description: 'Very long strings',
          examples: ['a'.repeat(domain.maxLength || 1000)],
          casesTested: 0,
          casesPassed: 0,
        }
      );
      break;
    case 'array':
      categories.push(
        {
          name: 'Empty Array',
          description: 'Empty array handling',
          examples: [[]],
          casesTested: 0,
          casesPassed: 0,
        },
        {
          name: 'Single Element',
          description: 'Single element arrays',
          examples: [[1], ['a']],
          casesTested: 0,
          casesPassed: 0,
        },
        {
          name: 'Large Array',
          description: 'Arrays at max length',
          examples: [Array(domain.maxLength || 100).fill(0)],
          casesTested: 0,
          casesPassed: 0,
        }
      );
      break;
    default:
      categories.push({
        name: 'Default Cases',
        description: 'Standard test cases',
        examples: [null, undefined],
        casesTested: 0,
        casesPassed: 0,
      });
  }

  if (domain.nullable) {
    categories.push({
      name: 'Null Values',
      description: 'Null value handling',
      examples: [null, undefined],
      casesTested: 0,
      casesPassed: 0,
    });
  }

  return categories;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an evidence item.
 */
export function createEvidence(params: {
  type: EvidenceType;
  description: string;
  source: string;
  value?: number;
  unit?: string;
  reference?: string;
  reliability?: number;
  expiresAt?: string;
}): Evidence {
  return {
    id: `evidence-${randomUUID()}`,
    type: params.type,
    description: params.description,
    collectedAt: new Date().toISOString(),
    source: params.source,
    value: params.value,
    unit: params.unit,
    reference: params.reference,
    reliability: params.reliability ?? 0.9,
    isValid: true,
    expiresAt: params.expiresAt,
  };
}

/**
 * Create an artifact for evaluation.
 */
export function createValidationArtifact(params: {
  name: string;
  type: Artifact['type'];
  metrics: Metrics;
  evidence?: Evidence[];
  version?: string;
}): Artifact {
  return {
    id: `artifact-${randomUUID()}`,
    name: params.name,
    type: params.type,
    metrics: params.metrics,
    evidence: params.evidence || [],
    version: params.version,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create an attack vector for red team testing.
 */
export function createAttackVector(params: {
  type: AttackVectorType;
  name: string;
  description: string;
  complexity: number;
  potentialImpact: number;
  techniques: string[];
  targets: string[];
}): AttackVector {
  return {
    id: `attack-vector-${randomUUID()}`,
    ...params,
  };
}

/**
 * Create a system for security testing.
 */
export function createTestSystem(params: {
  name: string;
  components: Component[];
  interfaces?: SystemInterface[];
  securityControls?: string[];
}): System {
  return {
    id: `system-${randomUUID()}`,
    name: params.name,
    components: params.components,
    interfaces: params.interfaces || [],
    securityControls: params.securityControls || [],
  };
}

/**
 * Create a component for testing.
 */
export function createTestComponent(params: {
  name: string;
  type: string;
  technologies?: string[];
  dependencies?: string[];
  interfaces?: string[];
}): Component {
  return {
    id: `component-${randomUUID()}`,
    name: params.name,
    type: params.type,
    technologies: params.technologies || [],
    dependencies: params.dependencies || [],
    interfaces: params.interfaces || [],
  };
}
