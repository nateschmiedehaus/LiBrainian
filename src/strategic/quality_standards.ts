/**
 * @fileoverview World-Class Quality Standards for Software Development
 *
 * Comprehensive quality dimensions that define what "world-class" means
 * for software artifacts. These standards go beyond typical metrics to
 * include epistemic standards unique to AI-augmented development.
 *
 * Key dimensions:
 * - Correctness: Functional, semantic, and structural correctness
 * - Completeness: Requirements coverage and documentation
 * - Reliability: Error rates, availability, latency, and recovery
 * - Maintainability: Dependencies, freshness, and technical debt
 * - Epistemic: Calibration, grounding, and hallucination prevention
 *
 * Industry Standards Incorporated:
 * - DORA Metrics: DevOps Research and Assessment performance benchmarks
 * - Google SRE: Site Reliability Engineering principles (error budgets, SLOs)
 * - ISO 25010: Systems and software Quality Requirements and Evaluation
 * - CISQ: Consortium for Information & Software Quality standards
 * - SQALE: Software Quality Assessment based on Lifecycle Expectations
 * - Robert Martin's Metrics: Afferent/efferent coupling, instability, abstractness
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const QUALITY_STANDARDS_SCHEMA_VERSION = '2.0.0';

// ============================================================================
// DORA METRICS (DevOps Research and Assessment)
// ============================================================================

/**
 * DORA performance levels based on the State of DevOps Report.
 * These metrics measure software delivery and operational performance.
 */
export type DORAPerformanceLevel = 'elite' | 'high' | 'medium' | 'low';

/**
 * DORA Metrics - the four key metrics from DevOps Research and Assessment.
 * Elite performers achieve all four metrics at elite level.
 */
export interface DORAMetrics {
  /**
   * Deployment Frequency - how often an organization successfully releases to production.
   * Elite: Multiple deploys per day (on demand)
   * High: Between once per day and once per week
   * Medium: Between once per week and once per month
   * Low: Between once per month and once every six months
   */
  deploymentFrequency: {
    /** Target deploys per day (elite >= 1, measured over time) */
    minDeploysPerDay: number;
    /** Whether on-demand deployment capability is required */
    requiresOnDemandCapability: boolean;
    /** Maximum allowed days between deployments */
    maxDaysBetweenDeploys: number;
  };

  /**
   * Lead Time for Changes - time from code commit to production.
   * Elite: Less than one hour
   * High: Between one day and one week
   * Medium: Between one week and one month
   * Low: Between one month and six months
   */
  leadTimeForChanges: {
    /** Maximum lead time in minutes (elite: 60) */
    maxMinutes: number;
    /** Target percentile for measuring (usually p50 or p90) */
    percentile: 'p50' | 'p90' | 'p99';
    /** Whether automated pipeline is required */
    requiresAutomatedPipeline: boolean;
  };

  /**
   * Change Failure Rate - percentage of deployments causing a failure.
   * Elite: 0-15%
   * High: 16-30%
   * Medium: 16-30% (same as high per latest research)
   * Low: 46-60%
   */
  changeFailureRate: {
    /** Maximum allowed failure rate (0.0 - 1.0), elite: 0.15 */
    maxRate: number;
    /** Whether automated rollback capability is required */
    requiresAutomatedRollback: boolean;
    /** Whether canary deployments are required */
    requiresCanaryDeployments?: boolean;
    /** Whether feature flags are required for risk mitigation */
    requiresFeatureFlags?: boolean;
  };

  /**
   * Mean Time to Recovery (MTTR) - time to restore service after failure.
   * Elite: Less than one hour
   * High: Less than one day
   * Medium: Between one day and one week
   * Low: Between one week and one month
   */
  meanTimeToRecovery: {
    /** Maximum MTTR in minutes (elite: 60) */
    maxMinutes: number;
    /** Whether automated incident detection is required */
    requiresAutomatedDetection: boolean;
    /** Whether runbooks must be maintained */
    requiresRunbooks: boolean;
    /** Whether chaos engineering is required for resilience testing */
    requiresChaosEngineering?: boolean;
  };
}

/**
 * Get DORA performance level based on metrics.
 */
export function getDORAPerformanceLevel(metrics: DORAMetrics): DORAPerformanceLevel {
  const isElite =
    metrics.deploymentFrequency.minDeploysPerDay >= 1 &&
    metrics.leadTimeForChanges.maxMinutes <= 60 &&
    metrics.changeFailureRate.maxRate <= 0.15 &&
    metrics.meanTimeToRecovery.maxMinutes <= 60;

  if (isElite) return 'elite';

  const isHigh =
    metrics.deploymentFrequency.maxDaysBetweenDeploys <= 7 &&
    metrics.leadTimeForChanges.maxMinutes <= 1440 && // 1 day
    metrics.changeFailureRate.maxRate <= 0.30 &&
    metrics.meanTimeToRecovery.maxMinutes <= 1440;

  if (isHigh) return 'high';

  const isMedium =
    metrics.deploymentFrequency.maxDaysBetweenDeploys <= 30 &&
    metrics.leadTimeForChanges.maxMinutes <= 43200 && // 1 month
    metrics.changeFailureRate.maxRate <= 0.30 &&
    metrics.meanTimeToRecovery.maxMinutes <= 10080; // 1 week

  if (isMedium) return 'medium';

  return 'low';
}

// ============================================================================
// GOOGLE SRE STANDARDS
// ============================================================================

/**
 * Service Level Indicator types based on Google SRE principles.
 */
export type SLIType =
  | 'availability'
  | 'latency'
  | 'throughput'
  | 'error_rate'
  | 'durability'
  | 'freshness'
  | 'correctness';

/**
 * Service Level Indicator (SLI) definition.
 */
export interface ServiceLevelIndicator {
  /** Unique identifier for this SLI */
  id: string;
  /** Human-readable name */
  name: string;
  /** Type of SLI */
  type: SLIType;
  /** Description of what this measures */
  description: string;
  /** Unit of measurement */
  unit: string;
  /** Good event definition (what counts as success) */
  goodEventDefinition: string;
  /** Total event definition (what counts as an attempt) */
  totalEventDefinition: string;
}

/**
 * Service Level Objective (SLO) with error budget.
 */
export interface ServiceLevelObjective {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** The SLI this objective measures */
  sliId: string;
  /** Target value (0.0 - 1.0 for percentages) */
  target: number;
  /** Time window for measurement */
  window: {
    /** Duration in days (typically 30 or 90) */
    days: number;
    /** Whether rolling window or calendar-based */
    type: 'rolling' | 'calendar';
  };
  /** Consequences of missing the SLO */
  consequences?: string[];
}

/**
 * Error budget configuration based on Google SRE practices.
 */
export interface ErrorBudgetConfig {
  /** SLO this budget is derived from */
  sloId: string;
  /** Current budget remaining (0.0 - 1.0) */
  budgetRemaining?: number;

  /**
   * Burn rate alerting thresholds.
   * Burn rate = actual error rate / allowed error rate.
   * A burn rate of 1 means the budget will be exhausted exactly at window end.
   */
  burnRateAlerts: Array<{
    /** Burn rate multiplier (e.g., 14.4 for 2% budget burn in 1 hour) */
    burnRate: number;
    /** Short window for fast alerts (e.g., 5 minutes) */
    shortWindowMinutes: number;
    /** Long window for confirmation (e.g., 1 hour) */
    longWindowMinutes: number;
    /** Alert severity */
    severity: 'page' | 'ticket' | 'log';
    /** Action to take when triggered */
    action: 'freeze_deploys' | 'notify' | 'auto_rollback' | 'escalate';
  }>;

  /** Policy when error budget is exhausted */
  exhaustedPolicy: {
    /** Whether to freeze feature deployments */
    freezeFeatureDeployments: boolean;
    /** Whether to require additional review for changes */
    requireAdditionalReview: boolean;
    /** Whether to prioritize reliability work */
    prioritizeReliabilityWork: boolean;
    /** Maximum percentage of engineering time for reliability (0-100) */
    reliabilityWorkBudgetPercent?: number;
  };
}

/**
 * Toil measurement and reduction targets (Google SRE).
 * Toil is manual, repetitive, automatable work with no enduring value.
 */
export interface ToilMetrics {
  /** Maximum percentage of time spent on toil (Google target: <50%) */
  maxToilPercent: number;
  /** Target toil reduction per quarter (percentage points) */
  quarterlyReductionTarget: number;
  /** Categories of toil to track */
  categories: Array<{
    name: string;
    description: string;
    currentPercent?: number;
    automationPlan?: string;
  }>;
  /** Whether toil tracking is required */
  requiresTracking: boolean;
  /** Whether automation proposals are required for recurring toil */
  requiresAutomationProposals: boolean;
}

/**
 * Complete SRE standards configuration.
 */
export interface SREStandards {
  /** Service level objectives hierarchy */
  slos: ServiceLevelObjective[];
  /** Service level indicators */
  slis: ServiceLevelIndicator[];
  /** Error budget configurations */
  errorBudgets: ErrorBudgetConfig[];
  /** Toil management */
  toil: ToilMetrics;
  /** On-call requirements */
  onCall?: {
    /** Maximum on-call hours per person per week */
    maxHoursPerWeek: number;
    /** Whether secondary on-call is required */
    requiresSecondary: boolean;
    /** Maximum incidents before escalation */
    maxIncidentsPerShift: number;
  };
}

// ============================================================================
// ADVANCED CODE QUALITY METRICS
// ============================================================================

/**
 * Cognitive complexity limits (based on SonarQube's cognitive complexity).
 * Measures how difficult code is to understand.
 */
export interface CognitiveComplexityStandard {
  /** Maximum cognitive complexity per function (SonarQube default: 15) */
  maxPerFunction: number;
  /** Maximum cognitive complexity per class/module */
  maxPerClass: number;
  /** Maximum cognitive complexity per file */
  maxPerFile: number;
  /** Whether to track cognitive complexity trends */
  trackTrends: boolean;
  /** Threshold for mandatory refactoring */
  refactoringThreshold: number;
}

/**
 * Robert Martin's package metrics for measuring modularity.
 */
export interface PackageCouplingMetrics {
  /**
   * Afferent Coupling (Ca) - incoming dependencies.
   * Number of classes outside this package that depend on classes inside.
   * High Ca = package has many dependents (high responsibility).
   */
  afferentCoupling: {
    /** Maximum allowed afferent coupling per package */
    maxPerPackage: number;
    /** Packages that exceed this are "main sequence violators" */
    warnThreshold: number;
  };

  /**
   * Efferent Coupling (Ce) - outgoing dependencies.
   * Number of classes inside this package that depend on classes outside.
   * High Ce = package depends on many others (high dependency).
   */
  efferentCoupling: {
    /** Maximum allowed efferent coupling per package */
    maxPerPackage: number;
    /** Packages that exceed this need review */
    warnThreshold: number;
  };

  /**
   * Instability (I) = Ce / (Ca + Ce)
   * Range: 0 (stable) to 1 (unstable)
   * Stable packages are hard to change, unstable are easy.
   */
  instability: {
    /** Packages at edges should be near 0 (stable) or 1 (unstable) */
    requiresExtremity: boolean;
    /** Maximum distance from 0 or 1 for main sequence */
    maxDistanceFromSequence: number;
  };

  /**
   * Abstractness (A) = abstract classes / total classes
   * Range: 0 (concrete) to 1 (abstract)
   */
  abstractness: {
    /** Target abstractness for core packages */
    corePackageTarget: number;
    /** Target abstractness for implementation packages */
    implPackageTarget: number;
  };

  /**
   * Distance from Main Sequence: D = |A + I - 1|
   * Packages should fall on the line from (0,1) to (1,0).
   * Zone of Pain: concrete and stable (hard to change, too concrete)
   * Zone of Uselessness: abstract and unstable (too abstract, no dependents)
   */
  mainSequenceDistance: {
    /** Maximum distance from main sequence (ideal: 0) */
    maxDistance: number;
    /** Packages in Zone of Pain (A≈0, I≈0) need review */
    flagZoneOfPain: boolean;
    /** Packages in Zone of Uselessness (A≈1, I≈1) need review */
    flagZoneOfUselessness: boolean;
  };
}

/**
 * Technical debt ratio based on SQALE methodology.
 * Technical Debt Ratio = Remediation Cost / Development Cost
 */
export interface TechnicalDebtRatio {
  /** Maximum technical debt ratio (SQALE A rating: <=5%) */
  maxRatio: number;
  /** Target technical debt ratio */
  targetRatio: number;
  /** Hours of debt that trigger action */
  actionThresholdHours: number;
  /** Whether to track debt per category */
  trackByCategory: boolean;
  /** SQALE characteristics to measure */
  categories?: Array<
    | 'maintainability'
    | 'reliability'
    | 'security'
    | 'portability'
    | 'efficiency'
    | 'changeability'
    | 'testability'
    | 'reusability'
  >;
}

/**
 * Advanced code quality standards combining multiple methodologies.
 */
export interface AdvancedCodeQuality {
  /** Cognitive complexity (SonarQube-style) */
  cognitiveComplexity: CognitiveComplexityStandard;
  /** Package coupling metrics (Robert Martin) */
  packageCoupling: PackageCouplingMetrics;
  /** Technical debt ratio (SQALE) */
  technicalDebtRatio: TechnicalDebtRatio;
  /** Code duplication limits */
  duplication: {
    /** Maximum duplicated lines percentage */
    maxDuplicatedLinesPercent: number;
    /** Maximum duplicated blocks */
    maxDuplicatedBlocks: number;
    /** Minimum token length for detection */
    minTokensForDetection: number;
  };
  /** Code smell limits */
  codeSmells: {
    /** Maximum blocker code smells (must fix) */
    maxBlockers: number;
    /** Maximum critical code smells */
    maxCritical: number;
    /** Maximum major code smells */
    maxMajor: number;
  };
}

// ============================================================================
// ISO 25010 QUALITY MODEL
// ============================================================================

/**
 * ISO/IEC 25010:2011 Software Quality Model dimensions.
 * International standard for systems and software quality.
 */
export interface ISO25010Quality {
  /**
   * Functional Suitability - degree to which the product provides functions
   * that meet stated and implied needs.
   */
  functionalSuitability: {
    /** Functional completeness - coverage of user requirements */
    completeness: number;
    /** Functional correctness - accuracy of results */
    correctness: number;
    /** Functional appropriateness - facilitates task accomplishment */
    appropriateness: number;
  };

  /**
   * Performance Efficiency - performance relative to resources used.
   */
  performanceEfficiency: {
    /** Time behavior - response and processing times */
    timeBehavior: {
      p50ResponseMs: number;
      p99ResponseMs: number;
    };
    /** Resource utilization - amounts and types of resources used */
    resourceUtilization: {
      maxCpuPercent: number;
      maxMemoryPercent: number;
    };
    /** Capacity - maximum limits of product parameters */
    capacity: {
      maxConcurrentUsers: number;
      maxTransactionsPerSecond: number;
    };
  };

  /**
   * Compatibility - degree to which a product can exchange information
   * with other products and perform required functions.
   */
  compatibility: {
    /** Co-existence - can perform alongside other products */
    coexistence: boolean;
    /** Interoperability - can exchange and use exchanged information */
    interoperability: {
      requiresStandardProtocols: boolean;
      supportedFormats: string[];
    };
  };

  /**
   * Usability - degree to which a product can be used effectively,
   * efficiently, and satisfactorily.
   */
  usability: {
    /** Appropriateness recognizability - can users recognize suitability */
    recognizability: number;
    /** Learnability - can users learn to use the product */
    learnability: {
      maxTimeToProductivityHours: number;
      requiresDocumentation: boolean;
    };
    /** Operability - easy to operate and control */
    operability: number;
    /** User error protection - protects against user errors */
    errorProtection: boolean;
    /** User interface aesthetics - pleasing and satisfying interaction */
    aesthetics?: number;
    /** Accessibility - usable by people with disabilities */
    accessibility: {
      wcagLevel: 'A' | 'AA' | 'AAA';
      requiresKeyboardNavigation: boolean;
      requiresScreenReaderSupport: boolean;
    };
  };

  /**
   * Reliability - degree to which a system performs specified functions
   * under specified conditions for a specified period of time.
   */
  reliability: {
    /** Maturity - meets needs for reliability under normal operation */
    maturity: {
      mtbfHours: number;
      defectDensity: number;
    };
    /** Availability - operational and accessible when needed */
    availability: number;
    /** Fault tolerance - operates despite faults */
    faultTolerance: {
      requiresGracefulDegradation: boolean;
      requiresFailover: boolean;
    };
    /** Recoverability - can recover from failures */
    recoverability: {
      rtoMinutes: number;
      rpoMinutes: number;
    };
  };

  /**
   * Security - degree to which a product protects information and data.
   */
  security: {
    /** Confidentiality - data accessible only to authorized */
    confidentiality: {
      requiresEncryptionAtRest: boolean;
      requiresEncryptionInTransit: boolean;
      minimumKeyLength: number;
    };
    /** Integrity - prevents unauthorized modification */
    integrity: {
      requiresInputValidation: boolean;
      requiresAuditLogging: boolean;
    };
    /** Non-repudiation - actions can be proven */
    nonRepudiation: {
      requiresActionLogging: boolean;
      requiresDigitalSignatures?: boolean;
    };
    /** Authenticity - identity can be proved */
    authenticity: {
      requiresMFA: boolean;
      sessionTimeoutMinutes: number;
    };
    /** Accountability - actions can be traced */
    accountability: {
      requiresUserTracking: boolean;
      auditRetentionDays: number;
    };
  };

  /**
   * Maintainability - degree of effectiveness and efficiency with which
   * a product can be modified.
   */
  maintainability: {
    /** Modularity - composed of discrete components */
    modularity: {
      maxComponentSize: number;
      maxDependencies: number;
    };
    /** Reusability - asset can be used in more than one system */
    reusability: number;
    /** Analysability - can assess impact of changes */
    analysability: {
      requiresDocumentation: boolean;
      maxCyclomaticComplexity: number;
    };
    /** Modifiability - can be modified without degradation */
    modifiability: {
      maxCouplingFactor: number;
      maxRippleEffect: number;
    };
    /** Testability - can establish test criteria and perform tests */
    testability: {
      minCoverage: number;
      requiresUnitTests: boolean;
      requiresIntegrationTests: boolean;
    };
  };

  /**
   * Portability - degree to which a system can be transferred from one
   * environment to another.
   */
  portability: {
    /** Adaptability - can be adapted for different environments */
    adaptability: {
      supportedPlatforms: string[];
      requiresContainerization?: boolean;
    };
    /** Installability - can be installed/uninstalled successfully */
    installability: {
      maxInstallTimeMinutes: number;
      requiresAutomatedInstall: boolean;
    };
    /** Replaceability - can replace another product for same purpose */
    replaceability: {
      requiresDataMigrationPath: boolean;
      requiresBackwardCompatibility: boolean;
    };
  };
}

// ============================================================================
// CISQ QUALITY CHARACTERISTICS
// ============================================================================

/**
 * CISQ (Consortium for Information & Software Quality) automated quality measures.
 * Four quality characteristics with automated measurement.
 */
export interface CISQStandards {
  /**
   * Reliability - probability of failure-free operation.
   */
  reliability: {
    /** Maximum reliability weaknesses (CWE-based) */
    maxWeaknesses: number;
    /** Required reliability patterns */
    requiredPatterns: Array<
      | 'null_checks'
      | 'bounds_checking'
      | 'resource_cleanup'
      | 'exception_handling'
      | 'timeout_handling'
    >;
  };

  /**
   * Security - resistance to malicious attacks.
   */
  security: {
    /** Maximum security weaknesses (CWE-based) */
    maxWeaknesses: number;
    /** Required security controls */
    requiredControls: Array<
      | 'input_validation'
      | 'output_encoding'
      | 'authentication'
      | 'authorization'
      | 'cryptography'
      | 'error_handling'
    >;
    /** OWASP Top 10 compliance required */
    owaspTop10Compliance: boolean;
    /** SANS Top 25 compliance required */
    sansTop25Compliance: boolean;
  };

  /**
   * Performance Efficiency - appropriate response times and resource usage.
   */
  performanceEfficiency: {
    /** Maximum performance weaknesses */
    maxWeaknesses: number;
    /** Required performance patterns */
    requiredPatterns: Array<
      | 'caching'
      | 'lazy_loading'
      | 'connection_pooling'
      | 'pagination'
      | 'async_processing'
    >;
  };

  /**
   * Maintainability - ease of modification.
   */
  maintainability: {
    /** Maximum maintainability weaknesses */
    maxWeaknesses: number;
    /** Required maintainability patterns */
    requiredPatterns: Array<
      | 'documentation'
      | 'naming_conventions'
      | 'code_organization'
      | 'dependency_injection'
      | 'separation_of_concerns'
    >;
    /** Maximum file complexity */
    maxFileComplexity: number;
  };
}

// ============================================================================
// SQALE QUALITY MODEL
// ============================================================================

/**
 * SQALE (Software Quality Assessment based on Lifecycle Expectations) ratings.
 * Based on technical debt ratio thresholds.
 */
export type SQALERating = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * SQALE quality model configuration.
 */
export interface SQALEStandards {
  /** Target rating (A = best, E = worst) */
  targetRating: SQALERating;
  /** Technical debt ratio thresholds */
  ratingThresholds: {
    /** A rating: 0-5% debt ratio */
    A: number;
    /** B rating: 5-10% debt ratio */
    B: number;
    /** C rating: 10-20% debt ratio */
    C: number;
    /** D rating: 20-50% debt ratio */
    D: number;
    /** E rating: >50% debt ratio (default) */
  };
  /** Remediation cost per unit (hours) */
  remediationCostPerUnit: {
    blocker: number;
    critical: number;
    major: number;
    minor: number;
    info: number;
  };
  /** Development cost estimation (lines per hour) */
  developmentCostLinesPerHour: number;
}

/**
 * Calculate SQALE rating from technical debt ratio.
 */
export function calculateSQALERating(debtRatio: number, thresholds: SQALEStandards['ratingThresholds']): SQALERating {
  if (debtRatio <= thresholds.A) return 'A';
  if (debtRatio <= thresholds.B) return 'B';
  if (debtRatio <= thresholds.C) return 'C';
  if (debtRatio <= thresholds.D) return 'D';
  return 'E';
}

// ============================================================================
// FORMAL VERIFICATION STANDARDS
// ============================================================================

/**
 * Formal verification requirements for critical paths.
 */
export interface FormalVerificationStandard {
  /** Whether formal verification is required */
  required: boolean;
  /** Paths that require formal verification */
  criticalPaths: Array<{
    pathPattern: string;
    verificationMethod: 'model_checking' | 'theorem_proving' | 'abstract_interpretation' | 'symbolic_execution';
    properties: string[];
  }>;
  /** Minimum property coverage for verified paths */
  minPropertyCoverage: number;
  /** Whether proofs must be machine-checked */
  requiresMachineCheckedProofs: boolean;
  /** Tools approved for verification */
  approvedTools?: string[];
}

/**
 * Test determinism requirements.
 */
export interface TestDeterminismStandard {
  /** Minimum determinism rate (0.0 - 1.0), e.g., 0.9999 for 99.99% */
  minDeterminismRate: number;
  /** Maximum allowed flaky tests */
  maxFlakyTests: number;
  /** Required flaky test mitigation */
  flakyTestMitigation: {
    /** Automatic quarantine of flaky tests */
    autoQuarantine: boolean;
    /** Retry count before marking as flaky */
    retryCount: number;
    /** Maximum time to fix flaky tests (days) */
    maxFixTimeDays: number;
  };
  /** Test isolation requirements */
  isolation: {
    /** Tests must be isolated from each other */
    requiresIsolation: boolean;
    /** Tests must not depend on external services */
    noExternalDependencies: boolean;
    /** Tests must use deterministic time */
    deterministicTime: boolean;
    /** Tests must use deterministic random */
    deterministicRandom: boolean;
  };
}

/**
 * Zero-downtime deployment requirements.
 */
export interface ZeroDowntimeDeployment {
  /** Whether zero-downtime is required */
  required: boolean;
  /** Deployment strategies that ensure zero downtime */
  strategies: Array<'blue_green' | 'canary' | 'rolling' | 'feature_flags'>;
  /** Database migration requirements */
  databaseMigrations: {
    /** Migrations must be backward compatible */
    backwardCompatible: boolean;
    /** Maximum migration duration */
    maxDurationMinutes: number;
    /** Migrations must be reversible */
    reversible: boolean;
  };
  /** Health check requirements */
  healthChecks: {
    /** Readiness probe required */
    readinessProbe: boolean;
    /** Liveness probe required */
    livenessProbe: boolean;
    /** Startup probe required */
    startupProbe: boolean;
    /** Maximum probe failure before rollback */
    maxFailuresBeforeRollback: number;
  };
  /** Graceful shutdown requirements */
  gracefulShutdown: {
    /** Required signal handling */
    requiresSignalHandling: boolean;
    /** Maximum shutdown time */
    maxShutdownSeconds: number;
    /** Connection draining required */
    connectionDraining: boolean;
  };
}

// ============================================================================
// DOCUMENTATION TYPE
// ============================================================================

/**
 * Types of documentation that can be required.
 */
export type DocumentationType = 'readme' | 'api' | 'architecture' | 'changelog' | 'contributing';

// ============================================================================
// CORRECTNESS STANDARD
// ============================================================================

/**
 * Correctness standards define what it means for code to be "correct."
 * Correctness spans three dimensions: functional, semantic, and structural.
 */
export interface CorrectnessStandard {
  /**
   * Functional correctness - the code does what it's supposed to do.
   * Measured through testing and mutation analysis.
   */
  functional: {
    /** Minimum test coverage (0.0 - 1.0), e.g., 0.80 for 80% */
    testCoverageMin: number;
    /** Minimum mutation score (0.0 - 1.0), measures test effectiveness */
    mutationScoreMin?: number;
    /** Whether integration tests are required */
    requiresIntegrationTests: boolean;
    /** Whether end-to-end tests are required */
    requiresE2ETests?: boolean;
    /** Minimum number of test assertions per public function */
    minAssertionsPerFunction?: number;
  };
  /**
   * Semantic correctness - the code means what it's supposed to mean.
   * Verified through acceptance criteria and user story mapping.
   */
  semantic: {
    /** Whether acceptance criteria must be defined for all features */
    requiresAcceptanceCriteria: boolean;
    /** Whether user story mapping must be maintained */
    requiresUserStoryMapping: boolean;
    /** Whether domain model must be documented */
    requiresDomainModel?: boolean;
    /** Whether invariants must be explicitly documented */
    requiresInvariantDocumentation?: boolean;
  };
  /**
   * Structural correctness - the code is well-organized.
   * Measured through static analysis metrics.
   */
  structural: {
    /** Maximum cyclomatic complexity per function, e.g., 10 */
    maxCyclomaticComplexity: number;
    /** Maximum lines per file */
    maxFileLines: number;
    /** Maximum lines per function */
    maxFunctionLines: number;
    /** Maximum nesting depth */
    maxNestingDepth?: number;
    /** Maximum parameters per function */
    maxParametersPerFunction?: number;
    /** Whether cognitive complexity is tracked */
    trackCognitiveComplexity?: boolean;
    /** Maximum cognitive complexity if tracked */
    maxCognitiveComplexity?: number;
  };
}

// ============================================================================
// COMPLETENESS STANDARD
// ============================================================================

/**
 * Completeness standards ensure all aspects of the system are addressed.
 * Focuses on requirements tracking, edge cases, error handling, and documentation.
 */
export interface CompletenessStandard {
  /** Whether requirements must be tracked bidirectionally (code <-> requirements) */
  requirementsTracking: boolean;
  /** Whether edge cases must be documented explicitly */
  edgeCaseDocumentation: boolean;
  /** Minimum error handling coverage (0.0 - 1.0), e.g., 0.95 */
  errorHandlingCoverage: number;
  /** Documentation types that must be present */
  documentationRequired: DocumentationType[];
  /** Whether API contracts must be formally specified */
  requiresApiContracts?: boolean;
  /** Whether all public APIs must have examples */
  requiresApiExamples?: boolean;
  /** Whether decision records (ADRs) are required for architectural changes */
  requiresDecisionRecords?: boolean;
  /** Minimum documentation coverage for public APIs (0.0 - 1.0) */
  minDocumentationCoverage?: number;
}

// ============================================================================
// RELIABILITY STANDARD
// ============================================================================

/**
 * Reliability standards define operational excellence targets.
 * Covers error rates, availability, latency, and recovery.
 */
export interface ReliabilityStandard {
  /** Target error rate (0.0 - 1.0), e.g., 0.01 for 1% */
  errorRateTarget: number;
  /** Target availability (0.0 - 1.0), e.g., 0.999 for 99.9% */
  availabilityTarget: number;
  /** Latency budgets in milliseconds */
  latencyBudgets: {
    /** 50th percentile latency target in ms */
    p50: number;
    /** 99th percentile latency target in ms */
    p99: number;
    /** 99.9th percentile latency target in ms (optional) */
    p999?: number;
  };
  /** Recovery time objective in seconds */
  recoveryTimeTarget: number;
  /** Recovery point objective in seconds (max data loss) */
  recoveryPointTarget?: number;
  /** Whether chaos engineering tests are required */
  requiresChaosTests?: boolean;
  /** Whether circuit breakers are required for external calls */
  requiresCircuitBreakers?: boolean;
  /** Whether retries with exponential backoff are required */
  requiresRetryPolicy?: boolean;
  /** Mean time between failures target in hours */
  mtbfTarget?: number;
}

// ============================================================================
// MAINTAINABILITY STANDARD
// ============================================================================

/**
 * Maintainability standards ensure long-term code health.
 * Covers dependencies, freshness, and technical debt management.
 */
export interface MaintainabilityStandard {
  /** Maximum number of direct dependencies */
  maxDependencies: number;
  /** Maximum months since last dependency update */
  dependencyFreshnessMonths: number;
  /** Maximum months since documentation last reviewed */
  documentationFreshnessMonths: number;
  /** Technical debt budget in hours per sprint */
  technicalDebtBudget: number;
  /** Maximum allowed security vulnerabilities by severity */
  maxVulnerabilities?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  /** Whether automated dependency updates are required */
  requiresAutomatedDependencyUpdates?: boolean;
  /** Whether code ownership must be defined */
  requiresCodeOwnership?: boolean;
  /** Maximum percentage of code without ownership */
  maxUnownedCodePercent?: number;
  /** Whether dead code detection is required */
  requiresDeadCodeDetection?: boolean;
  /** Target code churn rate (changes per file per month) */
  maxCodeChurnRate?: number;
}

// ============================================================================
// EPISTEMIC STANDARD (UNIQUE TO LIBRARIAN)
// ============================================================================

/**
 * Epistemic standards ensure AI-generated content is well-calibrated
 * and properly grounded in evidence. This is unique to librainian's
 * research-first philosophy.
 */
export interface EpistemicStandard {
  /** Maximum Expected Calibration Error (0.0 - 1.0), e.g., 0.10 */
  maxECE: number;
  /** Required rate of evidence grounding (0.0 - 1.0), e.g., 1.0 means 100% */
  evidenceGroundingRate: number;
  /** Maximum hallucination rate (0.0 - 1.0), e.g., 0.05 for 5% */
  maxHallucinationRate: number;
  /** Whether uncertainty must be explicitly disclosed */
  uncertaintyDisclosureRequired: boolean;
  /** Minimum sample size for calibration claims */
  minCalibrationSampleSize?: number;
  /** Whether contradiction detection is required */
  requiresContradictionDetection?: boolean;
  /** Maximum acceptable contradictions in knowledge base */
  maxUnresolvedContradictions?: number;
  /** Whether provenance must be tracked for all claims */
  requiresProvenanceTracking?: boolean;
  /** Maximum staleness for claims in days before re-verification */
  maxClaimStaleDays?: number;
  /** Whether confidence intervals are required for all estimates */
  requiresConfidenceIntervals?: boolean;
}

// ============================================================================
// COMBINED QUALITY STANDARD
// ============================================================================

/**
 * A complete quality standard combining all dimensions.
 */
export interface QualityStandard {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of when to apply this standard */
  description: string;
  /** Version of this standard definition */
  version: string;
  /** Schema version for compatibility */
  schemaVersion: string;

  /** Correctness standards */
  correctness: CorrectnessStandard;
  /** Completeness standards */
  completeness: CompletenessStandard;
  /** Reliability standards */
  reliability: ReliabilityStandard;
  /** Maintainability standards */
  maintainability: MaintainabilityStandard;
  /** Epistemic standards (AI-specific) */
  epistemic: EpistemicStandard;

  // -------------------------------------------------------------------------
  // INDUSTRY-LEADING STANDARDS (Optional for backward compatibility)
  // -------------------------------------------------------------------------

  /** DORA metrics for DevOps performance (optional) */
  dora?: DORAMetrics;
  /** Google SRE standards (optional) */
  sre?: SREStandards;
  /** Advanced code quality metrics (optional) */
  advancedCodeQuality?: AdvancedCodeQuality;
  /** ISO 25010 quality model (optional) */
  iso25010?: Partial<ISO25010Quality>;
  /** CISQ automated quality measures (optional) */
  cisq?: CISQStandards;
  /** SQALE quality model (optional) */
  sqale?: SQALEStandards;
  /** Formal verification requirements (optional) */
  formalVerification?: FormalVerificationStandard;
  /** Test determinism requirements (optional) */
  testDeterminism?: TestDeterminismStandard;
  /** Zero-downtime deployment requirements (optional) */
  zeroDowntimeDeployment?: ZeroDowntimeDeployment;

  /** When this standard was created */
  createdAt: string;
  /** When this standard was last updated */
  updatedAt: string;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Severity levels for validation violations.
 */
export type ViolationSeverity = 'error' | 'warning' | 'info';

/**
 * A single validation violation.
 */
export interface ValidationViolation {
  /** Which dimension was violated */
  dimension: 'correctness' | 'completeness' | 'reliability' | 'maintainability' | 'epistemic';
  /** Sub-dimension (e.g., 'functional', 'semantic', 'structural') */
  subDimension: string;
  /** Specific field that was violated */
  field: string;
  /** Severity of the violation */
  severity: ViolationSeverity;
  /** Expected value according to standard */
  expected: string | number | boolean;
  /** Actual value observed */
  actual: string | number | boolean;
  /** Human-readable message */
  message: string;
  /** Suggested remediation */
  remediation?: string;
}

/**
 * Result of validating an artifact against a standard.
 */
export interface ValidationResult {
  /** Whether validation passed (no errors) */
  passed: boolean;
  /** Overall compliance score (0.0 - 1.0) */
  score: number;
  /** List of violations found */
  violations: ValidationViolation[];
  /** Dimension-specific scores */
  dimensionScores: {
    correctness: number;
    completeness: number;
    reliability: number;
    maintainability: number;
    epistemic: number;
  };
  /** When validation was performed */
  validatedAt: string;
  /** ID of the standard used */
  standardId: string;
  /** ID of the artifact validated */
  artifactId: string;
}

/**
 * An artifact that can be validated against quality standards.
 */
export interface ValidatableArtifact {
  /** Unique identifier */
  id: string;
  /** Type of artifact */
  type: 'project' | 'module' | 'file' | 'function' | 'component';
  /** Name of the artifact */
  name: string;

  /** Observed metrics for the artifact */
  metrics: ArtifactMetrics;
}

/**
 * Metrics observed for an artifact.
 */
export interface ArtifactMetrics {
  // Correctness metrics
  testCoverage?: number;
  mutationScore?: number;
  hasIntegrationTests?: boolean;
  hasE2ETests?: boolean;
  hasAcceptanceCriteria?: boolean;
  hasUserStoryMapping?: boolean;
  cyclomaticComplexity?: number;
  maxFileLines?: number;
  maxFunctionLines?: number;
  maxNestingDepth?: number;

  // Completeness metrics
  hasRequirementsTracking?: boolean;
  hasEdgeCaseDocumentation?: boolean;
  errorHandlingCoverage?: number;
  documentationPresent?: DocumentationType[];
  apiDocumentationCoverage?: number;

  // Reliability metrics
  observedErrorRate?: number;
  observedAvailability?: number;
  latencyP50?: number;
  latencyP99?: number;
  meanRecoveryTime?: number;

  // Maintainability metrics
  dependencyCount?: number;
  dependencyAgeMonths?: number;
  documentationAgeMonths?: number;
  technicalDebtHours?: number;
  vulnerabilities?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };

  // Epistemic metrics
  calibrationECE?: number;
  evidenceGroundingRate?: number;
  hallucinationRate?: number;
  hasUncertaintyDisclosure?: boolean;
  calibrationSampleSize?: number;
  unresolvedContradictions?: number;

  // -------------------------------------------------------------------------
  // DORA METRICS
  // -------------------------------------------------------------------------
  /** Average deployments per day over measurement period */
  deploysPerDay?: number;
  /** Lead time for changes in minutes (code commit to production) */
  leadTimeMinutes?: number;
  /** Change failure rate (0.0 - 1.0) */
  changeFailureRate?: number;
  /** Mean time to recovery in minutes */
  mttrMinutes?: number;

  // -------------------------------------------------------------------------
  // SRE METRICS
  // -------------------------------------------------------------------------
  /** Error budget remaining (0.0 - 1.0) */
  errorBudgetRemaining?: number;
  /** Current burn rate multiplier */
  burnRate?: number;
  /** Toil percentage of engineering time */
  toilPercent?: number;
  /** SLO compliance rate (0.0 - 1.0) */
  sloComplianceRate?: number;

  // -------------------------------------------------------------------------
  // ADVANCED CODE QUALITY
  // -------------------------------------------------------------------------
  /** Cognitive complexity per function */
  cognitiveComplexity?: number;
  /** Afferent coupling (incoming dependencies) */
  afferentCoupling?: number;
  /** Efferent coupling (outgoing dependencies) */
  efferentCoupling?: number;
  /** Package instability (0.0 - 1.0) */
  instability?: number;
  /** Package abstractness (0.0 - 1.0) */
  abstractness?: number;
  /** Distance from main sequence (0.0 - 1.0) */
  mainSequenceDistance?: number;
  /** Technical debt ratio */
  technicalDebtRatio?: number;
  /** SQALE rating */
  sqaleRating?: SQALERating;
  /** Duplicated lines percentage */
  duplicatedLinesPercent?: number;
  /** Code smells by severity */
  codeSmells?: {
    blocker: number;
    critical: number;
    major: number;
  };

  // -------------------------------------------------------------------------
  // FORMAL VERIFICATION & DETERMINISM
  // -------------------------------------------------------------------------
  /** Formal verification coverage for critical paths */
  formalVerificationCoverage?: number;
  /** Test determinism rate (0.0 - 1.0) */
  testDeterminismRate?: number;
  /** Number of flaky tests */
  flakyTestCount?: number;
  /** Zero-downtime deployment capability */
  hasZeroDowntimeDeployment?: boolean;

  // -------------------------------------------------------------------------
  // CISQ METRICS
  // -------------------------------------------------------------------------
  /** CISQ reliability weakness count */
  cisqReliabilityWeaknesses?: number;
  /** CISQ security weakness count */
  cisqSecurityWeaknesses?: number;
  /** CISQ performance weakness count */
  cisqPerformanceWeaknesses?: number;
  /** CISQ maintainability weakness count */
  cisqMaintainabilityWeaknesses?: number;
}

// ============================================================================
// COMPLIANCE REPORT
// ============================================================================

/**
 * A single project's compliance with standards.
 */
export interface ProjectCompliance {
  /** Project identifier */
  projectId: string;
  /** Project name */
  projectName: string;
  /** Overall compliance score (0.0 - 1.0) */
  overallScore: number;
  /** Compliance level classification */
  complianceLevel: 'world-class-plus' | 'world-class' | 'production' | 'mvp' | 'below-mvp';
  /** Validation result for this project */
  validation: ValidationResult;
  /** Trend compared to previous assessment */
  trend?: 'improving' | 'stable' | 'degrading';
  /** DORA performance level (if DORA metrics are tracked) */
  doraLevel?: DORAPerformanceLevel;
  /** SQALE rating (if SQALE metrics are tracked) */
  sqaleRating?: SQALERating;
}

/**
 * A compliance report for one or more projects.
 */
export interface ComplianceReport {
  /** Unique report identifier */
  id: string;
  /** Report title */
  title: string;
  /** Standards used for this report */
  standards: QualityStandard;
  /** Individual project compliance results */
  projectCompliance: ProjectCompliance[];
  /** Summary statistics */
  summary: {
    /** Number of projects assessed */
    projectCount: number;
    /** Number meeting standards */
    passingCount: number;
    /** Average compliance score */
    averageScore: number;
    /** Distribution of compliance levels */
    levelDistribution: {
      'world-class-plus': number;
      'world-class': number;
      production: number;
      mvp: number;
      'below-mvp': number;
    };
  };
  /** Top violations across all projects */
  topViolations: Array<{
    violation: ValidationViolation;
    occurrenceCount: number;
    affectedProjects: string[];
  }>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** When report was generated */
  generatedAt: string;
}

// ============================================================================
// STANDARD PRESETS
// ============================================================================

/**
 * World-class standards - the strictest quality level.
 * Use for critical infrastructure, financial systems, and safety-critical software.
 */
export const WORLD_CLASS_STANDARDS: QualityStandard = {
  id: 'world-class',
  name: 'World-Class Standards',
  description: 'The strictest quality standards for critical systems requiring the highest reliability and correctness.',
  version: '1.0.0',
  schemaVersion: QUALITY_STANDARDS_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  correctness: {
    functional: {
      testCoverageMin: 0.95,
      mutationScoreMin: 0.85,
      requiresIntegrationTests: true,
      requiresE2ETests: true,
      minAssertionsPerFunction: 3,
    },
    semantic: {
      requiresAcceptanceCriteria: true,
      requiresUserStoryMapping: true,
      requiresDomainModel: true,
      requiresInvariantDocumentation: true,
    },
    structural: {
      maxCyclomaticComplexity: 8,
      maxFileLines: 300,
      maxFunctionLines: 30,
      maxNestingDepth: 3,
      maxParametersPerFunction: 4,
      trackCognitiveComplexity: true,
      maxCognitiveComplexity: 15,
    },
  },

  completeness: {
    requirementsTracking: true,
    edgeCaseDocumentation: true,
    errorHandlingCoverage: 0.99,
    documentationRequired: ['readme', 'api', 'architecture', 'changelog', 'contributing'],
    requiresApiContracts: true,
    requiresApiExamples: true,
    requiresDecisionRecords: true,
    minDocumentationCoverage: 0.95,
  },

  reliability: {
    errorRateTarget: 0.001,
    availabilityTarget: 0.9999,
    latencyBudgets: {
      p50: 50,
      p99: 200,
      p999: 500,
    },
    recoveryTimeTarget: 60,
    recoveryPointTarget: 0,
    requiresChaosTests: true,
    requiresCircuitBreakers: true,
    requiresRetryPolicy: true,
    mtbfTarget: 8760, // 1 year in hours
  },

  maintainability: {
    maxDependencies: 30,
    dependencyFreshnessMonths: 3,
    documentationFreshnessMonths: 1,
    technicalDebtBudget: 4,
    maxVulnerabilities: {
      critical: 0,
      high: 0,
      medium: 2,
      low: 5,
    },
    requiresAutomatedDependencyUpdates: true,
    requiresCodeOwnership: true,
    maxUnownedCodePercent: 0,
    requiresDeadCodeDetection: true,
    maxCodeChurnRate: 0.5,
  },

  epistemic: {
    maxECE: 0.05,
    evidenceGroundingRate: 1.0,
    maxHallucinationRate: 0.01,
    uncertaintyDisclosureRequired: true,
    minCalibrationSampleSize: 500,
    requiresContradictionDetection: true,
    maxUnresolvedContradictions: 0,
    requiresProvenanceTracking: true,
    maxClaimStaleDays: 7,
    requiresConfidenceIntervals: true,
  },
};

/**
 * Production standards - quality level for production-ready software.
 * Use for business applications, web services, and customer-facing products.
 */
export const PRODUCTION_STANDARDS: QualityStandard = {
  id: 'production',
  name: 'Production Standards',
  description: 'Quality standards for production-ready software that balances quality with practical development velocity.',
  version: '1.0.0',
  schemaVersion: QUALITY_STANDARDS_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  correctness: {
    functional: {
      testCoverageMin: 0.80,
      mutationScoreMin: 0.70,
      requiresIntegrationTests: true,
      requiresE2ETests: false,
      minAssertionsPerFunction: 2,
    },
    semantic: {
      requiresAcceptanceCriteria: true,
      requiresUserStoryMapping: false,
      requiresDomainModel: false,
      requiresInvariantDocumentation: false,
    },
    structural: {
      maxCyclomaticComplexity: 10,
      maxFileLines: 500,
      maxFunctionLines: 50,
      maxNestingDepth: 4,
      maxParametersPerFunction: 5,
      trackCognitiveComplexity: true,
      maxCognitiveComplexity: 20,
    },
  },

  completeness: {
    requirementsTracking: true,
    edgeCaseDocumentation: true,
    errorHandlingCoverage: 0.95,
    documentationRequired: ['readme', 'api'],
    requiresApiContracts: true,
    requiresApiExamples: false,
    requiresDecisionRecords: false,
    minDocumentationCoverage: 0.80,
  },

  reliability: {
    errorRateTarget: 0.01,
    availabilityTarget: 0.999,
    latencyBudgets: {
      p50: 100,
      p99: 500,
      p999: 1000,
    },
    recoveryTimeTarget: 300,
    recoveryPointTarget: 60,
    requiresChaosTests: false,
    requiresCircuitBreakers: true,
    requiresRetryPolicy: true,
    mtbfTarget: 720, // 30 days in hours
  },

  maintainability: {
    maxDependencies: 50,
    dependencyFreshnessMonths: 6,
    documentationFreshnessMonths: 3,
    technicalDebtBudget: 8,
    maxVulnerabilities: {
      critical: 0,
      high: 0,
      medium: 5,
      low: 10,
    },
    requiresAutomatedDependencyUpdates: true,
    requiresCodeOwnership: true,
    maxUnownedCodePercent: 5,
    requiresDeadCodeDetection: false,
    maxCodeChurnRate: 1.0,
  },

  epistemic: {
    maxECE: 0.10,
    evidenceGroundingRate: 0.95,
    maxHallucinationRate: 0.05,
    uncertaintyDisclosureRequired: true,
    minCalibrationSampleSize: 100,
    requiresContradictionDetection: true,
    maxUnresolvedContradictions: 5,
    requiresProvenanceTracking: true,
    maxClaimStaleDays: 30,
    requiresConfidenceIntervals: false,
  },
};

/**
 * MVP standards - minimum viable quality level.
 * Use for prototypes, experiments, and early-stage products.
 */
export const MVP_STANDARDS: QualityStandard = {
  id: 'mvp',
  name: 'MVP Standards',
  description: 'Minimum viable quality standards for prototypes and early-stage development.',
  version: '1.0.0',
  schemaVersion: QUALITY_STANDARDS_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  correctness: {
    functional: {
      testCoverageMin: 0.60,
      mutationScoreMin: undefined,
      requiresIntegrationTests: false,
      requiresE2ETests: false,
      minAssertionsPerFunction: 1,
    },
    semantic: {
      requiresAcceptanceCriteria: false,
      requiresUserStoryMapping: false,
      requiresDomainModel: false,
      requiresInvariantDocumentation: false,
    },
    structural: {
      maxCyclomaticComplexity: 15,
      maxFileLines: 800,
      maxFunctionLines: 100,
      maxNestingDepth: 5,
      maxParametersPerFunction: 7,
      trackCognitiveComplexity: false,
      maxCognitiveComplexity: undefined,
    },
  },

  completeness: {
    requirementsTracking: false,
    edgeCaseDocumentation: false,
    errorHandlingCoverage: 0.80,
    documentationRequired: ['readme'],
    requiresApiContracts: false,
    requiresApiExamples: false,
    requiresDecisionRecords: false,
    minDocumentationCoverage: 0.50,
  },

  reliability: {
    errorRateTarget: 0.05,
    availabilityTarget: 0.99,
    latencyBudgets: {
      p50: 500,
      p99: 2000,
    },
    recoveryTimeTarget: 3600,
    recoveryPointTarget: 3600,
    requiresChaosTests: false,
    requiresCircuitBreakers: false,
    requiresRetryPolicy: false,
    mtbfTarget: 168, // 1 week in hours
  },

  maintainability: {
    maxDependencies: 100,
    dependencyFreshnessMonths: 12,
    documentationFreshnessMonths: 6,
    technicalDebtBudget: 16,
    maxVulnerabilities: {
      critical: 0,
      high: 2,
      medium: 10,
      low: 25,
    },
    requiresAutomatedDependencyUpdates: false,
    requiresCodeOwnership: false,
    maxUnownedCodePercent: 50,
    requiresDeadCodeDetection: false,
    maxCodeChurnRate: 2.0,
  },

  epistemic: {
    maxECE: 0.20,
    evidenceGroundingRate: 0.80,
    maxHallucinationRate: 0.15,
    uncertaintyDisclosureRequired: false,
    minCalibrationSampleSize: 30,
    requiresContradictionDetection: false,
    maxUnresolvedContradictions: 20,
    requiresProvenanceTracking: false,
    maxClaimStaleDays: 90,
    requiresConfidenceIntervals: false,
  },
};

// ============================================================================
// WORLD-CLASS PLUS STANDARDS (Exceeds World-Class)
// ============================================================================

/**
 * World-Class Plus standards - exceeds world-class with industry-leading benchmarks.
 * Use for mission-critical systems, aerospace, medical devices, financial core systems.
 *
 * This preset incorporates:
 * - Elite DORA metrics (multiple deploys/day, <1hr lead time, <15% failure, <1hr MTTR)
 * - Google SRE error budgets with aggressive burn rate alerting
 * - Zero-downtime deployment requirements
 * - Formal verification for critical paths
 * - 99.99% test determinism
 * - Full ISO 25010, CISQ, and SQALE compliance
 */
export const WORLD_CLASS_PLUS_STANDARDS: QualityStandard = {
  id: 'world-class-plus',
  name: 'World-Class Plus Standards',
  description: 'Industry-leading quality standards that exceed world-class, incorporating DORA elite metrics, Google SRE practices, formal verification, and zero-downtime deployment.',
  version: '1.0.0',
  schemaVersion: QUALITY_STANDARDS_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  // -------------------------------------------------------------------------
  // CORE QUALITY DIMENSIONS (Enhanced from World-Class)
  // -------------------------------------------------------------------------

  correctness: {
    functional: {
      testCoverageMin: 0.98,
      mutationScoreMin: 0.90,
      requiresIntegrationTests: true,
      requiresE2ETests: true,
      minAssertionsPerFunction: 5,
    },
    semantic: {
      requiresAcceptanceCriteria: true,
      requiresUserStoryMapping: true,
      requiresDomainModel: true,
      requiresInvariantDocumentation: true,
    },
    structural: {
      maxCyclomaticComplexity: 6,
      maxFileLines: 250,
      maxFunctionLines: 25,
      maxNestingDepth: 2,
      maxParametersPerFunction: 3,
      trackCognitiveComplexity: true,
      maxCognitiveComplexity: 10,
    },
  },

  completeness: {
    requirementsTracking: true,
    edgeCaseDocumentation: true,
    errorHandlingCoverage: 1.0,
    documentationRequired: ['readme', 'api', 'architecture', 'changelog', 'contributing'],
    requiresApiContracts: true,
    requiresApiExamples: true,
    requiresDecisionRecords: true,
    minDocumentationCoverage: 1.0,
  },

  reliability: {
    errorRateTarget: 0.0001, // 99.99% success rate
    availabilityTarget: 0.99999, // Five 9s
    latencyBudgets: {
      p50: 25,
      p99: 100,
      p999: 250,
    },
    recoveryTimeTarget: 30, // 30 seconds
    recoveryPointTarget: 0,
    requiresChaosTests: true,
    requiresCircuitBreakers: true,
    requiresRetryPolicy: true,
    mtbfTarget: 43800, // 5 years in hours
  },

  maintainability: {
    maxDependencies: 20,
    dependencyFreshnessMonths: 1,
    documentationFreshnessMonths: 0.5,
    technicalDebtBudget: 2,
    maxVulnerabilities: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 2,
    },
    requiresAutomatedDependencyUpdates: true,
    requiresCodeOwnership: true,
    maxUnownedCodePercent: 0,
    requiresDeadCodeDetection: true,
    maxCodeChurnRate: 0.3,
  },

  epistemic: {
    maxECE: 0.03,
    evidenceGroundingRate: 1.0,
    maxHallucinationRate: 0.005,
    uncertaintyDisclosureRequired: true,
    minCalibrationSampleSize: 1000,
    requiresContradictionDetection: true,
    maxUnresolvedContradictions: 0,
    requiresProvenanceTracking: true,
    maxClaimStaleDays: 3,
    requiresConfidenceIntervals: true,
  },

  // -------------------------------------------------------------------------
  // DORA METRICS (Elite Level)
  // -------------------------------------------------------------------------

  dora: {
    deploymentFrequency: {
      minDeploysPerDay: 3, // Multiple deploys per day
      requiresOnDemandCapability: true,
      maxDaysBetweenDeploys: 0.5, // Must deploy at least twice daily
    },
    leadTimeForChanges: {
      maxMinutes: 30, // Under 30 minutes (exceeds elite 1 hour)
      percentile: 'p90',
      requiresAutomatedPipeline: true,
    },
    changeFailureRate: {
      maxRate: 0.05, // 5% (exceeds elite 15%)
      requiresAutomatedRollback: true,
      requiresCanaryDeployments: true,
      requiresFeatureFlags: true,
    },
    meanTimeToRecovery: {
      maxMinutes: 15, // 15 minutes (exceeds elite 1 hour)
      requiresAutomatedDetection: true,
      requiresRunbooks: true,
      requiresChaosEngineering: true,
    },
  },

  // -------------------------------------------------------------------------
  // GOOGLE SRE STANDARDS
  // -------------------------------------------------------------------------

  sre: {
    slis: [
      {
        id: 'availability-sli',
        name: 'Service Availability',
        type: 'availability',
        description: 'Percentage of successful requests',
        unit: 'percentage',
        goodEventDefinition: 'HTTP status < 500 or graceful degradation',
        totalEventDefinition: 'All HTTP requests',
      },
      {
        id: 'latency-sli',
        name: 'Request Latency',
        type: 'latency',
        description: 'Request completion time',
        unit: 'milliseconds',
        goodEventDefinition: 'Request completed within p99 budget',
        totalEventDefinition: 'All requests',
      },
    ],
    slos: [
      {
        id: 'availability-slo',
        name: '99.99% Availability',
        sliId: 'availability-sli',
        target: 0.9999,
        window: { days: 30, type: 'rolling' },
        consequences: ['Feature freeze', 'Reliability sprint required'],
      },
      {
        id: 'latency-slo',
        name: 'P99 Latency < 100ms',
        sliId: 'latency-sli',
        target: 0.999,
        window: { days: 30, type: 'rolling' },
        consequences: ['Performance optimization required'],
      },
    ],
    errorBudgets: [
      {
        sloId: 'availability-slo',
        burnRateAlerts: [
          {
            burnRate: 14.4, // 2% of 30-day budget in 1 hour
            shortWindowMinutes: 5,
            longWindowMinutes: 60,
            severity: 'page',
            action: 'auto_rollback',
          },
          {
            burnRate: 6, // 5% of 30-day budget in 6 hours
            shortWindowMinutes: 30,
            longWindowMinutes: 360,
            severity: 'page',
            action: 'freeze_deploys',
          },
          {
            burnRate: 3, // 10% of 30-day budget in 24 hours
            shortWindowMinutes: 60,
            longWindowMinutes: 1440,
            severity: 'ticket',
            action: 'notify',
          },
        ],
        exhaustedPolicy: {
          freezeFeatureDeployments: true,
          requireAdditionalReview: true,
          prioritizeReliabilityWork: true,
          reliabilityWorkBudgetPercent: 100,
        },
      },
    ],
    toil: {
      maxToilPercent: 25, // More aggressive than Google's 50%
      quarterlyReductionTarget: 10,
      categories: [
        { name: 'Manual deployments', description: 'Non-automated deployment steps' },
        { name: 'Incident response', description: 'Manual investigation and remediation' },
        { name: 'Configuration changes', description: 'Manual config updates' },
      ],
      requiresTracking: true,
      requiresAutomationProposals: true,
    },
    onCall: {
      maxHoursPerWeek: 12,
      requiresSecondary: true,
      maxIncidentsPerShift: 2,
    },
  },

  // -------------------------------------------------------------------------
  // ADVANCED CODE QUALITY
  // -------------------------------------------------------------------------

  advancedCodeQuality: {
    cognitiveComplexity: {
      maxPerFunction: 10,
      maxPerClass: 50,
      maxPerFile: 100,
      trackTrends: true,
      refactoringThreshold: 8,
    },
    packageCoupling: {
      afferentCoupling: {
        maxPerPackage: 20,
        warnThreshold: 15,
      },
      efferentCoupling: {
        maxPerPackage: 15,
        warnThreshold: 10,
      },
      instability: {
        requiresExtremity: true,
        maxDistanceFromSequence: 0.1,
      },
      abstractness: {
        corePackageTarget: 0.7,
        implPackageTarget: 0.2,
      },
      mainSequenceDistance: {
        maxDistance: 0.15,
        flagZoneOfPain: true,
        flagZoneOfUselessness: true,
      },
    },
    technicalDebtRatio: {
      maxRatio: 0.02, // SQALE A+ rating
      targetRatio: 0.01,
      actionThresholdHours: 4,
      trackByCategory: true,
      categories: ['maintainability', 'reliability', 'security', 'testability'],
    },
    duplication: {
      maxDuplicatedLinesPercent: 1,
      maxDuplicatedBlocks: 0,
      minTokensForDetection: 50,
    },
    codeSmells: {
      maxBlockers: 0,
      maxCritical: 0,
      maxMajor: 5,
    },
  },

  // -------------------------------------------------------------------------
  // ISO 25010 QUALITY MODEL
  // -------------------------------------------------------------------------

  iso25010: {
    functionalSuitability: {
      completeness: 1.0,
      correctness: 1.0,
      appropriateness: 0.95,
    },
    performanceEfficiency: {
      timeBehavior: {
        p50ResponseMs: 25,
        p99ResponseMs: 100,
      },
      resourceUtilization: {
        maxCpuPercent: 50,
        maxMemoryPercent: 60,
      },
      capacity: {
        maxConcurrentUsers: 100000,
        maxTransactionsPerSecond: 10000,
      },
    },
    reliability: {
      maturity: {
        mtbfHours: 43800, // 5 years
        defectDensity: 0.01,
      },
      availability: 0.99999,
      faultTolerance: {
        requiresGracefulDegradation: true,
        requiresFailover: true,
      },
      recoverability: {
        rtoMinutes: 1,
        rpoMinutes: 0,
      },
    },
    security: {
      confidentiality: {
        requiresEncryptionAtRest: true,
        requiresEncryptionInTransit: true,
        minimumKeyLength: 256,
      },
      integrity: {
        requiresInputValidation: true,
        requiresAuditLogging: true,
      },
      nonRepudiation: {
        requiresActionLogging: true,
        requiresDigitalSignatures: true,
      },
      authenticity: {
        requiresMFA: true,
        sessionTimeoutMinutes: 15,
      },
      accountability: {
        requiresUserTracking: true,
        auditRetentionDays: 2555, // 7 years
      },
    },
    maintainability: {
      modularity: {
        maxComponentSize: 500,
        maxDependencies: 10,
      },
      reusability: 0.7,
      analysability: {
        requiresDocumentation: true,
        maxCyclomaticComplexity: 6,
      },
      modifiability: {
        maxCouplingFactor: 0.3,
        maxRippleEffect: 0.1,
      },
      testability: {
        minCoverage: 0.98,
        requiresUnitTests: true,
        requiresIntegrationTests: true,
      },
    },
    usability: {
      recognizability: 0.95,
      learnability: {
        maxTimeToProductivityHours: 2,
        requiresDocumentation: true,
      },
      operability: 0.95,
      errorProtection: true,
      accessibility: {
        wcagLevel: 'AAA',
        requiresKeyboardNavigation: true,
        requiresScreenReaderSupport: true,
      },
    },
    portability: {
      adaptability: {
        supportedPlatforms: ['linux', 'kubernetes', 'cloud-agnostic'],
        requiresContainerization: true,
      },
      installability: {
        maxInstallTimeMinutes: 5,
        requiresAutomatedInstall: true,
      },
      replaceability: {
        requiresDataMigrationPath: true,
        requiresBackwardCompatibility: true,
      },
    },
  },

  // -------------------------------------------------------------------------
  // CISQ STANDARDS
  // -------------------------------------------------------------------------

  cisq: {
    reliability: {
      maxWeaknesses: 0,
      requiredPatterns: [
        'null_checks',
        'bounds_checking',
        'resource_cleanup',
        'exception_handling',
        'timeout_handling',
      ],
    },
    security: {
      maxWeaknesses: 0,
      requiredControls: [
        'input_validation',
        'output_encoding',
        'authentication',
        'authorization',
        'cryptography',
        'error_handling',
      ],
      owaspTop10Compliance: true,
      sansTop25Compliance: true,
    },
    performanceEfficiency: {
      maxWeaknesses: 0,
      requiredPatterns: [
        'caching',
        'lazy_loading',
        'connection_pooling',
        'pagination',
        'async_processing',
      ],
    },
    maintainability: {
      maxWeaknesses: 0,
      requiredPatterns: [
        'documentation',
        'naming_conventions',
        'code_organization',
        'dependency_injection',
        'separation_of_concerns',
      ],
      maxFileComplexity: 10,
    },
  },

  // -------------------------------------------------------------------------
  // SQALE STANDARDS
  // -------------------------------------------------------------------------

  sqale: {
    targetRating: 'A',
    ratingThresholds: {
      A: 0.02, // Stricter than default 5%
      B: 0.05,
      C: 0.10,
      D: 0.20,
    },
    remediationCostPerUnit: {
      blocker: 4,
      critical: 2,
      major: 1,
      minor: 0.25,
      info: 0.1,
    },
    developmentCostLinesPerHour: 20,
  },

  // -------------------------------------------------------------------------
  // FORMAL VERIFICATION
  // -------------------------------------------------------------------------

  formalVerification: {
    required: true,
    criticalPaths: [
      {
        pathPattern: '**/security/**',
        verificationMethod: 'theorem_proving',
        properties: ['authentication_correctness', 'authorization_completeness'],
      },
      {
        pathPattern: '**/core/**',
        verificationMethod: 'model_checking',
        properties: ['invariant_preservation', 'deadlock_freedom'],
      },
      {
        pathPattern: '**/financial/**',
        verificationMethod: 'abstract_interpretation',
        properties: ['numeric_overflow', 'precision_loss'],
      },
    ],
    minPropertyCoverage: 0.95,
    requiresMachineCheckedProofs: true,
    approvedTools: ['TLA+', 'Alloy', 'Coq', 'Isabelle', 'SPARK'],
  },

  // -------------------------------------------------------------------------
  // TEST DETERMINISM
  // -------------------------------------------------------------------------

  testDeterminism: {
    minDeterminismRate: 0.9999, // 99.99% determinism
    maxFlakyTests: 0,
    flakyTestMitigation: {
      autoQuarantine: true,
      retryCount: 3,
      maxFixTimeDays: 1,
    },
    isolation: {
      requiresIsolation: true,
      noExternalDependencies: true,
      deterministicTime: true,
      deterministicRandom: true,
    },
  },

  // -------------------------------------------------------------------------
  // ZERO-DOWNTIME DEPLOYMENT
  // -------------------------------------------------------------------------

  zeroDowntimeDeployment: {
    required: true,
    strategies: ['blue_green', 'canary', 'feature_flags'],
    databaseMigrations: {
      backwardCompatible: true,
      maxDurationMinutes: 5,
      reversible: true,
    },
    healthChecks: {
      readinessProbe: true,
      livenessProbe: true,
      startupProbe: true,
      maxFailuresBeforeRollback: 1,
    },
    gracefulShutdown: {
      requiresSignalHandling: true,
      maxShutdownSeconds: 30,
      connectionDraining: true,
    },
  },
};

// ============================================================================
// ELITE DORA PRESET (Standalone)
// ============================================================================

/**
 * Standalone elite DORA metrics configuration.
 * Use this to add DORA metrics to existing standards.
 */
export const ELITE_DORA_METRICS: DORAMetrics = {
  deploymentFrequency: {
    minDeploysPerDay: 1,
    requiresOnDemandCapability: true,
    maxDaysBetweenDeploys: 1,
  },
  leadTimeForChanges: {
    maxMinutes: 60,
    percentile: 'p90',
    requiresAutomatedPipeline: true,
  },
  changeFailureRate: {
    maxRate: 0.15,
    requiresAutomatedRollback: true,
    requiresCanaryDeployments: false,
  },
  meanTimeToRecovery: {
    maxMinutes: 60,
    requiresAutomatedDetection: true,
    requiresRunbooks: true,
  },
};

/**
 * High-performing DORA metrics configuration.
 */
export const HIGH_DORA_METRICS: DORAMetrics = {
  deploymentFrequency: {
    minDeploysPerDay: 0.2, // About once per week
    requiresOnDemandCapability: false,
    maxDaysBetweenDeploys: 7,
  },
  leadTimeForChanges: {
    maxMinutes: 1440, // 1 day
    percentile: 'p90',
    requiresAutomatedPipeline: true,
  },
  changeFailureRate: {
    maxRate: 0.30,
    requiresAutomatedRollback: false,
  },
  meanTimeToRecovery: {
    maxMinutes: 1440, // 1 day
    requiresAutomatedDetection: true,
    requiresRunbooks: true,
  },
};

// ============================================================================
// VALIDATOR FUNCTIONS
// ============================================================================

/**
 * Validate a single numeric metric against a threshold.
 */
function validateNumericMetric(
  actual: number | undefined,
  expected: number,
  operator: 'min' | 'max',
  dimension: ValidationViolation['dimension'],
  subDimension: string,
  field: string,
  message: string,
  severity: ViolationSeverity = 'error'
): ValidationViolation | null {
  if (actual === undefined) {
    return {
      dimension,
      subDimension,
      field,
      severity: 'warning',
      expected,
      actual: 'undefined',
      message: `${message} - metric not provided`,
      remediation: `Measure and report the ${field} metric`,
    };
  }

  const passed = operator === 'min' ? actual >= expected : actual <= expected;
  if (passed) {
    return null;
  }

  return {
    dimension,
    subDimension,
    field,
    severity,
    expected,
    actual,
    message: `${message}: ${actual} ${operator === 'min' ? '<' : '>'} ${expected}`,
    remediation: `${operator === 'min' ? 'Increase' : 'Decrease'} ${field} to meet the ${expected} ${operator === 'min' ? 'minimum' : 'maximum'}`,
  };
}

/**
 * Validate a boolean requirement.
 */
function validateBooleanMetric(
  actual: boolean | undefined,
  required: boolean,
  dimension: ValidationViolation['dimension'],
  subDimension: string,
  field: string,
  message: string,
  severity: ViolationSeverity = 'error'
): ValidationViolation | null {
  if (!required) {
    return null; // Not required, so no violation
  }

  if (actual === undefined) {
    return {
      dimension,
      subDimension,
      field,
      severity: 'warning',
      expected: true,
      actual: 'undefined',
      message: `${message} - metric not provided`,
      remediation: `Verify and report whether ${field} is satisfied`,
    };
  }

  if (actual === true) {
    return null;
  }

  return {
    dimension,
    subDimension,
    field,
    severity,
    expected: true,
    actual: false,
    message,
    remediation: `Implement ${field} requirement`,
  };
}

/**
 * Validate an artifact against a quality standard.
 *
 * @param artifact - The artifact to validate
 * @param standard - The quality standard to validate against
 * @returns Validation result with violations and scores
 */
export function validateAgainstStandard(
  artifact: ValidatableArtifact,
  standard: QualityStandard
): ValidationResult {
  const violations: ValidationViolation[] = [];
  const { metrics } = artifact;

  // -------------------------------------------------------------------------
  // CORRECTNESS VALIDATION
  // -------------------------------------------------------------------------

  // Functional correctness
  const testCoverageViolation = validateNumericMetric(
    metrics.testCoverage,
    standard.correctness.functional.testCoverageMin,
    'min',
    'correctness',
    'functional',
    'testCoverageMin',
    'Test coverage below minimum'
  );
  if (testCoverageViolation) violations.push(testCoverageViolation);

  if (standard.correctness.functional.mutationScoreMin !== undefined) {
    const mutationViolation = validateNumericMetric(
      metrics.mutationScore,
      standard.correctness.functional.mutationScoreMin,
      'min',
      'correctness',
      'functional',
      'mutationScoreMin',
      'Mutation score below minimum'
    );
    if (mutationViolation) violations.push(mutationViolation);
  }

  const integrationTestViolation = validateBooleanMetric(
    metrics.hasIntegrationTests,
    standard.correctness.functional.requiresIntegrationTests,
    'correctness',
    'functional',
    'requiresIntegrationTests',
    'Integration tests are required but not present'
  );
  if (integrationTestViolation) violations.push(integrationTestViolation);

  if (standard.correctness.functional.requiresE2ETests) {
    const e2eViolation = validateBooleanMetric(
      metrics.hasE2ETests,
      true,
      'correctness',
      'functional',
      'requiresE2ETests',
      'End-to-end tests are required but not present'
    );
    if (e2eViolation) violations.push(e2eViolation);
  }

  // Semantic correctness
  const acceptanceViolation = validateBooleanMetric(
    metrics.hasAcceptanceCriteria,
    standard.correctness.semantic.requiresAcceptanceCriteria,
    'correctness',
    'semantic',
    'requiresAcceptanceCriteria',
    'Acceptance criteria are required but not defined'
  );
  if (acceptanceViolation) violations.push(acceptanceViolation);

  const userStoryViolation = validateBooleanMetric(
    metrics.hasUserStoryMapping,
    standard.correctness.semantic.requiresUserStoryMapping,
    'correctness',
    'semantic',
    'requiresUserStoryMapping',
    'User story mapping is required but not maintained'
  );
  if (userStoryViolation) violations.push(userStoryViolation);

  // Structural correctness
  const complexityViolation = validateNumericMetric(
    metrics.cyclomaticComplexity,
    standard.correctness.structural.maxCyclomaticComplexity,
    'max',
    'correctness',
    'structural',
    'maxCyclomaticComplexity',
    'Cyclomatic complexity exceeds maximum'
  );
  if (complexityViolation) violations.push(complexityViolation);

  const fileLinesViolation = validateNumericMetric(
    metrics.maxFileLines,
    standard.correctness.structural.maxFileLines,
    'max',
    'correctness',
    'structural',
    'maxFileLines',
    'File lines exceed maximum'
  );
  if (fileLinesViolation) violations.push(fileLinesViolation);

  const functionLinesViolation = validateNumericMetric(
    metrics.maxFunctionLines,
    standard.correctness.structural.maxFunctionLines,
    'max',
    'correctness',
    'structural',
    'maxFunctionLines',
    'Function lines exceed maximum'
  );
  if (functionLinesViolation) violations.push(functionLinesViolation);

  if (standard.correctness.structural.maxNestingDepth !== undefined) {
    const nestingViolation = validateNumericMetric(
      metrics.maxNestingDepth,
      standard.correctness.structural.maxNestingDepth,
      'max',
      'correctness',
      'structural',
      'maxNestingDepth',
      'Nesting depth exceeds maximum'
    );
    if (nestingViolation) violations.push(nestingViolation);
  }

  // -------------------------------------------------------------------------
  // COMPLETENESS VALIDATION
  // -------------------------------------------------------------------------

  const reqTrackingViolation = validateBooleanMetric(
    metrics.hasRequirementsTracking,
    standard.completeness.requirementsTracking,
    'completeness',
    'requirements',
    'requirementsTracking',
    'Requirements tracking is required but not implemented'
  );
  if (reqTrackingViolation) violations.push(reqTrackingViolation);

  const edgeCaseViolation = validateBooleanMetric(
    metrics.hasEdgeCaseDocumentation,
    standard.completeness.edgeCaseDocumentation,
    'completeness',
    'documentation',
    'edgeCaseDocumentation',
    'Edge case documentation is required but not present'
  );
  if (edgeCaseViolation) violations.push(edgeCaseViolation);

  const errorHandlingViolation = validateNumericMetric(
    metrics.errorHandlingCoverage,
    standard.completeness.errorHandlingCoverage,
    'min',
    'completeness',
    'errorHandling',
    'errorHandlingCoverage',
    'Error handling coverage below minimum'
  );
  if (errorHandlingViolation) violations.push(errorHandlingViolation);

  // Check required documentation types
  const presentDocs = metrics.documentationPresent ?? [];
  for (const requiredDoc of standard.completeness.documentationRequired) {
    if (!presentDocs.includes(requiredDoc)) {
      violations.push({
        dimension: 'completeness',
        subDimension: 'documentation',
        field: 'documentationRequired',
        severity: 'error',
        expected: requiredDoc,
        actual: 'missing',
        message: `Required documentation type '${requiredDoc}' is not present`,
        remediation: `Create ${requiredDoc} documentation`,
      });
    }
  }

  if (standard.completeness.minDocumentationCoverage !== undefined) {
    const docCoverageViolation = validateNumericMetric(
      metrics.apiDocumentationCoverage,
      standard.completeness.minDocumentationCoverage,
      'min',
      'completeness',
      'documentation',
      'minDocumentationCoverage',
      'API documentation coverage below minimum'
    );
    if (docCoverageViolation) violations.push(docCoverageViolation);
  }

  // -------------------------------------------------------------------------
  // RELIABILITY VALIDATION
  // -------------------------------------------------------------------------

  const errorRateViolation = validateNumericMetric(
    metrics.observedErrorRate,
    standard.reliability.errorRateTarget,
    'max',
    'reliability',
    'errors',
    'errorRateTarget',
    'Error rate exceeds target'
  );
  if (errorRateViolation) violations.push(errorRateViolation);

  const availabilityViolation = validateNumericMetric(
    metrics.observedAvailability,
    standard.reliability.availabilityTarget,
    'min',
    'reliability',
    'availability',
    'availabilityTarget',
    'Availability below target'
  );
  if (availabilityViolation) violations.push(availabilityViolation);

  const p50Violation = validateNumericMetric(
    metrics.latencyP50,
    standard.reliability.latencyBudgets.p50,
    'max',
    'reliability',
    'latency',
    'latencyBudgets.p50',
    'P50 latency exceeds budget'
  );
  if (p50Violation) violations.push(p50Violation);

  const p99Violation = validateNumericMetric(
    metrics.latencyP99,
    standard.reliability.latencyBudgets.p99,
    'max',
    'reliability',
    'latency',
    'latencyBudgets.p99',
    'P99 latency exceeds budget'
  );
  if (p99Violation) violations.push(p99Violation);

  const recoveryViolation = validateNumericMetric(
    metrics.meanRecoveryTime,
    standard.reliability.recoveryTimeTarget,
    'max',
    'reliability',
    'recovery',
    'recoveryTimeTarget',
    'Mean recovery time exceeds target'
  );
  if (recoveryViolation) violations.push(recoveryViolation);

  // -------------------------------------------------------------------------
  // MAINTAINABILITY VALIDATION
  // -------------------------------------------------------------------------

  const depCountViolation = validateNumericMetric(
    metrics.dependencyCount,
    standard.maintainability.maxDependencies,
    'max',
    'maintainability',
    'dependencies',
    'maxDependencies',
    'Dependency count exceeds maximum'
  );
  if (depCountViolation) violations.push(depCountViolation);

  const depFreshnessViolation = validateNumericMetric(
    metrics.dependencyAgeMonths,
    standard.maintainability.dependencyFreshnessMonths,
    'max',
    'maintainability',
    'dependencies',
    'dependencyFreshnessMonths',
    'Dependencies are stale'
  );
  if (depFreshnessViolation) violations.push(depFreshnessViolation);

  const docFreshnessViolation = validateNumericMetric(
    metrics.documentationAgeMonths,
    standard.maintainability.documentationFreshnessMonths,
    'max',
    'maintainability',
    'documentation',
    'documentationFreshnessMonths',
    'Documentation is stale'
  );
  if (docFreshnessViolation) violations.push(docFreshnessViolation);

  const debtViolation = validateNumericMetric(
    metrics.technicalDebtHours,
    standard.maintainability.technicalDebtBudget,
    'max',
    'maintainability',
    'debt',
    'technicalDebtBudget',
    'Technical debt exceeds budget'
  );
  if (debtViolation) violations.push(debtViolation);

  // Vulnerability checks
  if (standard.maintainability.maxVulnerabilities && metrics.vulnerabilities) {
    const vulnLimits = standard.maintainability.maxVulnerabilities;
    const vulns = metrics.vulnerabilities;

    if (vulns.critical > vulnLimits.critical) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'security',
        field: 'maxVulnerabilities.critical',
        severity: 'error',
        expected: vulnLimits.critical,
        actual: vulns.critical,
        message: `Critical vulnerabilities (${vulns.critical}) exceed limit (${vulnLimits.critical})`,
        remediation: 'Fix all critical security vulnerabilities immediately',
      });
    }

    if (vulns.high > vulnLimits.high) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'security',
        field: 'maxVulnerabilities.high',
        severity: 'error',
        expected: vulnLimits.high,
        actual: vulns.high,
        message: `High vulnerabilities (${vulns.high}) exceed limit (${vulnLimits.high})`,
        remediation: 'Fix high-severity security vulnerabilities',
      });
    }
  }

  // -------------------------------------------------------------------------
  // EPISTEMIC VALIDATION
  // -------------------------------------------------------------------------

  const eceViolation = validateNumericMetric(
    metrics.calibrationECE,
    standard.epistemic.maxECE,
    'max',
    'epistemic',
    'calibration',
    'maxECE',
    'Expected Calibration Error exceeds maximum'
  );
  if (eceViolation) violations.push(eceViolation);

  const groundingViolation = validateNumericMetric(
    metrics.evidenceGroundingRate,
    standard.epistemic.evidenceGroundingRate,
    'min',
    'epistemic',
    'grounding',
    'evidenceGroundingRate',
    'Evidence grounding rate below minimum'
  );
  if (groundingViolation) violations.push(groundingViolation);

  const hallucinationViolation = validateNumericMetric(
    metrics.hallucinationRate,
    standard.epistemic.maxHallucinationRate,
    'max',
    'epistemic',
    'hallucination',
    'maxHallucinationRate',
    'Hallucination rate exceeds maximum'
  );
  if (hallucinationViolation) violations.push(hallucinationViolation);

  const uncertaintyViolation = validateBooleanMetric(
    metrics.hasUncertaintyDisclosure,
    standard.epistemic.uncertaintyDisclosureRequired,
    'epistemic',
    'transparency',
    'uncertaintyDisclosureRequired',
    'Uncertainty disclosure is required but not implemented'
  );
  if (uncertaintyViolation) violations.push(uncertaintyViolation);

  if (standard.epistemic.minCalibrationSampleSize !== undefined) {
    const sampleSizeViolation = validateNumericMetric(
      metrics.calibrationSampleSize,
      standard.epistemic.minCalibrationSampleSize,
      'min',
      'epistemic',
      'calibration',
      'minCalibrationSampleSize',
      'Calibration sample size below minimum'
    );
    if (sampleSizeViolation) violations.push(sampleSizeViolation);
  }

  if (standard.epistemic.maxUnresolvedContradictions !== undefined) {
    const contradictionViolation = validateNumericMetric(
      metrics.unresolvedContradictions,
      standard.epistemic.maxUnresolvedContradictions,
      'max',
      'epistemic',
      'coherence',
      'maxUnresolvedContradictions',
      'Unresolved contradictions exceed maximum'
    );
    if (contradictionViolation) violations.push(contradictionViolation);
  }

  // -------------------------------------------------------------------------
  // COMPUTE SCORES
  // -------------------------------------------------------------------------

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;

  // Dimension-specific violation counts
  const dimensionViolations = {
    correctness: violations.filter((v) => v.dimension === 'correctness' && v.severity === 'error').length,
    completeness: violations.filter((v) => v.dimension === 'completeness' && v.severity === 'error').length,
    reliability: violations.filter((v) => v.dimension === 'reliability' && v.severity === 'error').length,
    maintainability: violations.filter((v) => v.dimension === 'maintainability' && v.severity === 'error').length,
    epistemic: violations.filter((v) => v.dimension === 'epistemic' && v.severity === 'error').length,
  };

  // Estimate max possible violations per dimension (rough)
  const maxPerDimension = 10;
  const dimensionScores = {
    correctness: Math.max(0, 1 - dimensionViolations.correctness / maxPerDimension),
    completeness: Math.max(0, 1 - dimensionViolations.completeness / maxPerDimension),
    reliability: Math.max(0, 1 - dimensionViolations.reliability / maxPerDimension),
    maintainability: Math.max(0, 1 - dimensionViolations.maintainability / maxPerDimension),
    epistemic: Math.max(0, 1 - dimensionViolations.epistemic / maxPerDimension),
  };

  const overallScore = (
    dimensionScores.correctness +
    dimensionScores.completeness +
    dimensionScores.reliability +
    dimensionScores.maintainability +
    dimensionScores.epistemic
  ) / 5;

  return {
    passed: errorCount === 0,
    score: overallScore,
    violations,
    dimensionScores,
    validatedAt: new Date().toISOString(),
    standardId: standard.id,
    artifactId: artifact.id,
  };
}

/**
 * Determine compliance level based on validation score.
 */
function determineComplianceLevel(score: number): ProjectCompliance['complianceLevel'] {
  if (score >= 0.99) return 'world-class-plus';
  if (score >= 0.95) return 'world-class';
  if (score >= 0.80) return 'production';
  if (score >= 0.60) return 'mvp';
  return 'below-mvp';
}

/**
 * Generate a compliance report for multiple projects against a standard.
 *
 * @param projects - Array of projects to validate (each as a validatable artifact)
 * @param standard - The quality standard to validate against
 * @returns Compliance report with summary statistics and recommendations
 */
export function generateComplianceReport(
  projects: Array<{ artifact: ValidatableArtifact; name?: string }>,
  standard: QualityStandard
): ComplianceReport {
  const projectCompliance: ProjectCompliance[] = [];
  const violationOccurrences = new Map<string, { violation: ValidationViolation; projectIds: string[] }>();

  for (const { artifact, name } of projects) {
    const validation = validateAgainstStandard(artifact, standard);
    const level = determineComplianceLevel(validation.score);

    projectCompliance.push({
      projectId: artifact.id,
      projectName: name ?? artifact.name,
      overallScore: validation.score,
      complianceLevel: level,
      validation,
    });

    // Track violation occurrences
    for (const violation of validation.violations) {
      const key = `${violation.dimension}:${violation.subDimension}:${violation.field}`;
      if (!violationOccurrences.has(key)) {
        violationOccurrences.set(key, { violation, projectIds: [] });
      }
      violationOccurrences.get(key)!.projectIds.push(artifact.id);
    }
  }

  // Build top violations list
  const topViolations = Array.from(violationOccurrences.values())
    .map((entry) => ({
      violation: entry.violation,
      occurrenceCount: entry.projectIds.length,
      affectedProjects: entry.projectIds,
    }))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, 10);

  // Compute summary statistics
  const levelDistribution = {
    'world-class-plus': projectCompliance.filter((p) => p.complianceLevel === 'world-class-plus').length,
    'world-class': projectCompliance.filter((p) => p.complianceLevel === 'world-class').length,
    production: projectCompliance.filter((p) => p.complianceLevel === 'production').length,
    mvp: projectCompliance.filter((p) => p.complianceLevel === 'mvp').length,
    'below-mvp': projectCompliance.filter((p) => p.complianceLevel === 'below-mvp').length,
  };

  const passingCount = projectCompliance.filter((p) => p.validation.passed).length;
  const averageScore = projectCompliance.length > 0
    ? projectCompliance.reduce((sum, p) => sum + p.overallScore, 0) / projectCompliance.length
    : 0;

  // Generate recommendations based on top violations
  const recommendations: string[] = [];
  for (const { violation, occurrenceCount, affectedProjects } of topViolations.slice(0, 5)) {
    if (occurrenceCount >= projects.length * 0.5) {
      recommendations.push(
        `High Priority: ${violation.message} affects ${Math.round(occurrenceCount / projects.length * 100)}% of projects. ` +
        `Remediation: ${violation.remediation ?? 'Review and improve this metric across all projects.'}`
      );
    }
  }

  if (levelDistribution['below-mvp'] > 0) {
    recommendations.push(
      `${levelDistribution['below-mvp']} project(s) fall below MVP standards and require immediate attention.`
    );
  }

  if (averageScore < 0.80) {
    recommendations.push(
      'Overall portfolio quality is below production standards. Consider a quality improvement initiative.'
    );
  }

  return {
    id: `compliance-report-${randomUUID()}`,
    title: `Compliance Report against ${standard.name}`,
    standards: standard,
    projectCompliance,
    summary: {
      projectCount: projects.length,
      passingCount,
      averageScore,
      levelDistribution,
    },
    topViolations,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a custom quality standard by merging with a base standard.
 *
 * @param base - The base standard to extend
 * @param overrides - Partial overrides to apply
 * @returns A new quality standard with the overrides applied
 */
export function createCustomStandard(
  base: QualityStandard,
  overrides: {
    id: string;
    name: string;
    description?: string;
    correctness?: Partial<CorrectnessStandard>;
    completeness?: Partial<CompletenessStandard>;
    reliability?: Partial<ReliabilityStandard>;
    maintainability?: Partial<MaintainabilityStandard>;
    epistemic?: Partial<EpistemicStandard>;
  }
): QualityStandard {
  const now = new Date().toISOString();

  return {
    ...base,
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? base.description,
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
    correctness: {
      functional: { ...base.correctness.functional, ...overrides.correctness?.functional },
      semantic: { ...base.correctness.semantic, ...overrides.correctness?.semantic },
      structural: { ...base.correctness.structural, ...overrides.correctness?.structural },
    },
    completeness: { ...base.completeness, ...overrides.completeness },
    reliability: {
      ...base.reliability,
      ...overrides.reliability,
      latencyBudgets: {
        ...base.reliability.latencyBudgets,
        ...overrides.reliability?.latencyBudgets,
      },
    },
    maintainability: {
      ...base.maintainability,
      ...overrides.maintainability,
      maxVulnerabilities: overrides.maintainability?.maxVulnerabilities ?? base.maintainability.maxVulnerabilities,
    },
    epistemic: { ...base.epistemic, ...overrides.epistemic },
  };
}

/**
 * Create a validatable artifact from metrics.
 *
 * @param params - Artifact parameters and metrics
 * @returns A validatable artifact ready for validation
 */
export function createArtifact(params: {
  id?: string;
  name: string;
  type: ValidatableArtifact['type'];
  metrics: ArtifactMetrics;
}): ValidatableArtifact {
  return {
    id: params.id ?? `artifact-${randomUUID()}`,
    name: params.name,
    type: params.type,
    metrics: params.metrics,
  };
}

/**
 * Get a standard preset by ID.
 *
 * @param id - Standard ID ('world-class-plus', 'world-class', 'production', or 'mvp')
 * @returns The matching standard or undefined
 */
export function getStandardById(id: string): QualityStandard | undefined {
  switch (id) {
    case 'world-class-plus':
      return WORLD_CLASS_PLUS_STANDARDS;
    case 'world-class':
      return WORLD_CLASS_STANDARDS;
    case 'production':
      return PRODUCTION_STANDARDS;
    case 'mvp':
      return MVP_STANDARDS;
    default:
      return undefined;
  }
}

/**
 * Get all available standard presets.
 *
 * @returns Array of all standard presets (ordered from strictest to most lenient)
 */
export function getAllStandardPresets(): QualityStandard[] {
  return [WORLD_CLASS_PLUS_STANDARDS, WORLD_CLASS_STANDARDS, PRODUCTION_STANDARDS, MVP_STANDARDS];
}

// ============================================================================
// DORA VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate DORA metrics for an artifact.
 *
 * @param metrics - Artifact metrics to validate
 * @param doraStandard - DORA standard to validate against
 * @returns Array of validation violations
 */
export function validateDORAMetrics(
  metrics: ArtifactMetrics,
  doraStandard: DORAMetrics
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Deployment Frequency
  if (metrics.deploysPerDay !== undefined) {
    if (metrics.deploysPerDay < doraStandard.deploymentFrequency.minDeploysPerDay) {
      violations.push({
        dimension: 'reliability',
        subDimension: 'dora',
        field: 'deploymentFrequency',
        severity: 'error',
        expected: doraStandard.deploymentFrequency.minDeploysPerDay,
        actual: metrics.deploysPerDay,
        message: `Deployment frequency (${metrics.deploysPerDay}/day) below target (${doraStandard.deploymentFrequency.minDeploysPerDay}/day)`,
        remediation: 'Implement CI/CD pipeline improvements to enable more frequent deployments',
      });
    }
  }

  // Lead Time for Changes
  if (metrics.leadTimeMinutes !== undefined) {
    if (metrics.leadTimeMinutes > doraStandard.leadTimeForChanges.maxMinutes) {
      violations.push({
        dimension: 'reliability',
        subDimension: 'dora',
        field: 'leadTimeForChanges',
        severity: 'error',
        expected: doraStandard.leadTimeForChanges.maxMinutes,
        actual: metrics.leadTimeMinutes,
        message: `Lead time (${metrics.leadTimeMinutes}min) exceeds target (${doraStandard.leadTimeForChanges.maxMinutes}min)`,
        remediation: 'Optimize CI/CD pipeline, reduce manual gates, implement trunk-based development',
      });
    }
  }

  // Change Failure Rate
  if (metrics.changeFailureRate !== undefined) {
    if (metrics.changeFailureRate > doraStandard.changeFailureRate.maxRate) {
      violations.push({
        dimension: 'reliability',
        subDimension: 'dora',
        field: 'changeFailureRate',
        severity: 'error',
        expected: doraStandard.changeFailureRate.maxRate,
        actual: metrics.changeFailureRate,
        message: `Change failure rate (${(metrics.changeFailureRate * 100).toFixed(1)}%) exceeds target (${(doraStandard.changeFailureRate.maxRate * 100).toFixed(1)}%)`,
        remediation: 'Implement better testing, canary deployments, and feature flags',
      });
    }
  }

  // Mean Time to Recovery
  if (metrics.mttrMinutes !== undefined) {
    if (metrics.mttrMinutes > doraStandard.meanTimeToRecovery.maxMinutes) {
      violations.push({
        dimension: 'reliability',
        subDimension: 'dora',
        field: 'meanTimeToRecovery',
        severity: 'error',
        expected: doraStandard.meanTimeToRecovery.maxMinutes,
        actual: metrics.mttrMinutes,
        message: `MTTR (${metrics.mttrMinutes}min) exceeds target (${doraStandard.meanTimeToRecovery.maxMinutes}min)`,
        remediation: 'Improve observability, automated rollback, and incident response procedures',
      });
    }
  }

  return violations;
}

/**
 * Validate SRE metrics for an artifact.
 *
 * @param metrics - Artifact metrics to validate
 * @param sreStandard - SRE standard to validate against
 * @returns Array of validation violations
 */
export function validateSREMetrics(
  metrics: ArtifactMetrics,
  sreStandard: SREStandards
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Toil percentage
  if (metrics.toilPercent !== undefined) {
    if (metrics.toilPercent > sreStandard.toil.maxToilPercent) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'sre',
        field: 'toilPercent',
        severity: 'error',
        expected: sreStandard.toil.maxToilPercent,
        actual: metrics.toilPercent,
        message: `Toil percentage (${metrics.toilPercent}%) exceeds target (${sreStandard.toil.maxToilPercent}%)`,
        remediation: 'Automate repetitive operational tasks',
      });
    }
  }

  // Error budget
  if (metrics.errorBudgetRemaining !== undefined) {
    if (metrics.errorBudgetRemaining <= 0) {
      violations.push({
        dimension: 'reliability',
        subDimension: 'sre',
        field: 'errorBudget',
        severity: 'error',
        expected: 'positive budget',
        actual: metrics.errorBudgetRemaining,
        message: 'Error budget exhausted - feature freeze required',
        remediation: 'Freeze feature deployments, focus on reliability improvements',
      });
    } else if (metrics.errorBudgetRemaining < 0.25) {
      violations.push({
        dimension: 'reliability',
        subDimension: 'sre',
        field: 'errorBudget',
        severity: 'warning',
        expected: 'budget > 25%',
        actual: metrics.errorBudgetRemaining,
        message: `Error budget low (${(metrics.errorBudgetRemaining * 100).toFixed(1)}% remaining)`,
        remediation: 'Prioritize reliability work, reduce deployment velocity',
      });
    }
  }

  // Burn rate
  if (metrics.burnRate !== undefined) {
    for (const alert of sreStandard.errorBudgets[0]?.burnRateAlerts ?? []) {
      if (metrics.burnRate >= alert.burnRate) {
        violations.push({
          dimension: 'reliability',
          subDimension: 'sre',
          field: 'burnRate',
          severity: alert.severity === 'page' ? 'error' : 'warning',
          expected: `< ${alert.burnRate}`,
          actual: metrics.burnRate,
          message: `Burn rate (${metrics.burnRate.toFixed(1)}x) exceeds threshold (${alert.burnRate}x)`,
          remediation: `Action required: ${alert.action}`,
        });
        break; // Only report the most severe alert
      }
    }
  }

  return violations;
}

/**
 * Validate advanced code quality metrics.
 *
 * @param metrics - Artifact metrics to validate
 * @param standard - Advanced code quality standard to validate against
 * @returns Array of validation violations
 */
export function validateAdvancedCodeQuality(
  metrics: ArtifactMetrics,
  standard: AdvancedCodeQuality
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Cognitive complexity
  if (metrics.cognitiveComplexity !== undefined) {
    if (metrics.cognitiveComplexity > standard.cognitiveComplexity.maxPerFunction) {
      violations.push({
        dimension: 'correctness',
        subDimension: 'cognitive',
        field: 'cognitiveComplexity',
        severity: 'error',
        expected: standard.cognitiveComplexity.maxPerFunction,
        actual: metrics.cognitiveComplexity,
        message: `Cognitive complexity (${metrics.cognitiveComplexity}) exceeds limit (${standard.cognitiveComplexity.maxPerFunction})`,
        remediation: 'Refactor complex functions into smaller, more focused units',
      });
    }
  }

  // Main sequence distance (package coupling)
  if (metrics.mainSequenceDistance !== undefined) {
    if (metrics.mainSequenceDistance > standard.packageCoupling.mainSequenceDistance.maxDistance) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'coupling',
        field: 'mainSequenceDistance',
        severity: 'error',
        expected: standard.packageCoupling.mainSequenceDistance.maxDistance,
        actual: metrics.mainSequenceDistance,
        message: `Package falls outside main sequence (distance: ${metrics.mainSequenceDistance.toFixed(2)})`,
        remediation: 'Review package abstraction level and dependency structure',
      });
    }
  }

  // Technical debt ratio
  if (metrics.technicalDebtRatio !== undefined) {
    if (metrics.technicalDebtRatio > standard.technicalDebtRatio.maxRatio) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'debt',
        field: 'technicalDebtRatio',
        severity: 'error',
        expected: standard.technicalDebtRatio.maxRatio,
        actual: metrics.technicalDebtRatio,
        message: `Technical debt ratio (${(metrics.technicalDebtRatio * 100).toFixed(1)}%) exceeds limit (${(standard.technicalDebtRatio.maxRatio * 100).toFixed(1)}%)`,
        remediation: 'Allocate time for debt reduction, prioritize high-impact issues',
      });
    }
  }

  // Code duplication
  if (metrics.duplicatedLinesPercent !== undefined) {
    if (metrics.duplicatedLinesPercent > standard.duplication.maxDuplicatedLinesPercent) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'duplication',
        field: 'duplicatedLinesPercent',
        severity: 'error',
        expected: standard.duplication.maxDuplicatedLinesPercent,
        actual: metrics.duplicatedLinesPercent,
        message: `Code duplication (${metrics.duplicatedLinesPercent}%) exceeds limit (${standard.duplication.maxDuplicatedLinesPercent}%)`,
        remediation: 'Extract common code into shared modules or utilities',
      });
    }
  }

  // Code smells
  if (metrics.codeSmells) {
    if (metrics.codeSmells.blocker > standard.codeSmells.maxBlockers) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'smells',
        field: 'codeSmells.blocker',
        severity: 'error',
        expected: standard.codeSmells.maxBlockers,
        actual: metrics.codeSmells.blocker,
        message: `Blocker code smells (${metrics.codeSmells.blocker}) exceed limit (${standard.codeSmells.maxBlockers})`,
        remediation: 'Fix all blocker code smells immediately',
      });
    }
    if (metrics.codeSmells.critical > standard.codeSmells.maxCritical) {
      violations.push({
        dimension: 'maintainability',
        subDimension: 'smells',
        field: 'codeSmells.critical',
        severity: 'error',
        expected: standard.codeSmells.maxCritical,
        actual: metrics.codeSmells.critical,
        message: `Critical code smells (${metrics.codeSmells.critical}) exceed limit (${standard.codeSmells.maxCritical})`,
        remediation: 'Fix critical code smells in next sprint',
      });
    }
  }

  // Test determinism
  if (metrics.testDeterminismRate !== undefined) {
    // Note: This uses a default threshold, actual threshold would come from testDeterminism standard
    const minRate = 0.99;
    if (metrics.testDeterminismRate < minRate) {
      violations.push({
        dimension: 'correctness',
        subDimension: 'testing',
        field: 'testDeterminismRate',
        severity: 'error',
        expected: minRate,
        actual: metrics.testDeterminismRate,
        message: `Test determinism (${(metrics.testDeterminismRate * 100).toFixed(2)}%) below minimum (${(minRate * 100).toFixed(2)}%)`,
        remediation: 'Fix or quarantine flaky tests, ensure test isolation',
      });
    }
  }

  return violations;
}

// ============================================================================
// LIBRARIAN-ENHANCED VALIDATION (Semantic Analysis)
// ============================================================================

import type { LiBrainian } from '../api/librainian.js';
import type { LiBrainianResponse, LlmOptional, ContextPack } from '../types.js';
import type { EvidenceRef } from '../api/evidence.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { bounded, absent, deriveSequentialConfidence, getNumericValue } from '../epistemics/confidence.js';

/**
 * Semantic quality issue discovered through librainian analysis.
 */
export interface SemanticQualityIssue {
  /** Type of semantic issue */
  type:
    | 'missing_error_handling'
    | 'insufficient_validation'
    | 'complexity_smell'
    | 'dependency_issue'
    | 'naming_inconsistency'
    | 'documentation_gap'
    | 'test_gap'
    | 'security_concern'
    | 'performance_concern'
    | 'maintainability_concern';
  /** Description of the issue */
  description: string;
  /** Severity level */
  severity: ViolationSeverity;
  /** File path where issue was found */
  filePath: string;
  /** Optional line number */
  line?: number;
  /** Suggested remediation */
  remediation: string;
  /** Evidence supporting this finding */
  evidence: EvidenceRef[];
}

/**
 * Result of librainian-enhanced validation.
 * Combines static validation with semantic analysis.
 */
export interface LiBrainianEnhancedValidationResult extends ValidationResult {
  /** Semantic issues found through librainian analysis */
  semanticIssues: SemanticQualityIssue[];
  /** Overall confidence in the validation result */
  confidence: ConfidenceValue;
  /** Evidence references for traceability */
  evidenceRefs: EvidenceRef[];
  /** Whether librainian was available for semantic analysis */
  librainianAvailable: boolean;
  /** LiBrainian query trace ID */
  traceId?: string;
}

/**
 * Extract semantic quality issues from librainian query results.
 */
function extractSemanticIssuesFromQuery(
  queryResult: LlmOptional<LiBrainianResponse> | null,
  standardName: string
): SemanticQualityIssue[] {
  const issues: SemanticQualityIssue[] = [];

  if (!queryResult || !queryResult.packs || queryResult.packs.length === 0) {
    return issues;
  }

  for (const pack of queryResult.packs) {
    // Analyze code snippets for quality issues
    for (const snippet of pack.codeSnippets) {
      const snippetIssues = analyzeCodeSnippetForQuality(snippet, standardName, pack);
      issues.push(...snippetIssues);
    }
  }

  return issues;
}

/**
 * Analyze a code snippet for quality issues related to the standard.
 */
function analyzeCodeSnippetForQuality(
  snippet: { filePath: string; startLine: number; endLine: number; content: string },
  standardName: string,
  pack: ContextPack
): SemanticQualityIssue[] {
  const issues: SemanticQualityIssue[] = [];
  const content = snippet.content.toLowerCase();

  // Check for common quality issues based on patterns
  // Missing error handling
  if ((content.includes('catch') && content.includes('{}')) ||
      (content.includes('catch') && !content.includes('log') && content.includes('// ignore'))) {
    issues.push({
      type: 'missing_error_handling',
      description: 'Empty or inadequate catch block detected',
      severity: 'error',
      filePath: snippet.filePath,
      line: snippet.startLine,
      remediation: 'Add proper error handling: log the error, rethrow, or handle gracefully',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: snippet.content.slice(0, 200),
        claim: 'Empty catch block indicates missing error handling',
        confidence: 'inferred',
      }],
    });
  }

  // Check for TODO/FIXME indicating incomplete work
  if (content.includes('todo') || content.includes('fixme') || content.includes('hack')) {
    issues.push({
      type: 'documentation_gap',
      description: 'TODO/FIXME/HACK comment indicates incomplete implementation',
      severity: 'warning',
      filePath: snippet.filePath,
      line: snippet.startLine,
      remediation: 'Address the TODO/FIXME item or create a tracked issue',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: snippet.content.slice(0, 200),
        claim: 'TODO/FIXME comment found',
        confidence: 'verified',
      }],
    });
  }

  // Check for potential complexity issues
  const nestingDepth = (content.match(/\{/g) || []).length;
  if (nestingDepth > 5) {
    issues.push({
      type: 'complexity_smell',
      description: `High nesting depth detected (${nestingDepth} levels)`,
      severity: 'warning',
      filePath: snippet.filePath,
      line: snippet.startLine,
      remediation: 'Consider extracting nested logic into separate functions',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: snippet.content.slice(0, 200),
        claim: `Nesting depth of ${nestingDepth} exceeds recommended limit`,
        confidence: 'inferred',
      }],
    });
  }

  // Check for any patterns in pack summary
  if (pack.summary.toLowerCase().includes('security') ||
      pack.summary.toLowerCase().includes('vulnerability')) {
    issues.push({
      type: 'security_concern',
      description: `Security-related code identified: ${pack.summary.slice(0, 100)}`,
      severity: 'warning',
      filePath: snippet.filePath,
      line: snippet.startLine,
      remediation: 'Review security implications and ensure proper controls are in place',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: pack.summary.slice(0, 200),
        claim: 'Security-related code requires review',
        confidence: 'inferred',
      }],
    });
  }

  return issues;
}

/**
 * Build evidence references from librainian query results.
 */
function buildEvidenceRefsFromQuery(
  queryResult: LlmOptional<LiBrainianResponse> | null
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];

  if (!queryResult || !queryResult.packs) {
    return refs;
  }

  // Collect evidence from packs
  for (const pack of queryResult.packs) {
    for (const snippet of pack.codeSnippets) {
      refs.push({
        file: snippet.filePath,
        line: snippet.startLine,
        endLine: snippet.endLine,
        snippet: snippet.content.slice(0, 300),
        claim: pack.summary.slice(0, 100),
        confidence: pack.confidence > 0.7 ? 'verified' : 'inferred',
      });
    }
  }

  // Include evidence by pack if available
  if (queryResult.evidenceByPack) {
    for (const packId of Object.keys(queryResult.evidenceByPack)) {
      const packEvidence = queryResult.evidenceByPack[packId];
      refs.push(...packEvidence);
    }
  }

  return refs;
}

/**
 * Derive confidence value from query result and static validation.
 */
function deriveValidationConfidence(
  queryResult: LlmOptional<LiBrainianResponse> | null,
  staticResult: ValidationResult
): ConfidenceValue {
  // Static validation confidence is deterministic
  const staticConfidence = bounded(
    staticResult.score * 0.9,
    staticResult.score,
    'formal_analysis',
    'Static validation produces deterministic results with slight uncertainty from metric collection'
  );

  // If no librainian result, return static confidence only
  if (!queryResult || !queryResult.llmAvailable) {
    return staticConfidence;
  }

  // LiBrainian confidence from query
  const librainianConfidence = queryResult.totalConfidence > 0
    ? bounded(
        queryResult.totalConfidence * 0.8,
        queryResult.totalConfidence,
        'literature',
        'LiBrainian semantic analysis confidence based on retrieved context relevance'
      )
    : absent('insufficient_data');

  // Derive combined confidence
  return deriveSequentialConfidence([staticConfidence, librainianConfidence]);
}

/**
 * Validate an artifact against a quality standard with librainian-enhanced semantic analysis.
 *
 * This function combines traditional static validation with semantic code analysis
 * from the librainian. It queries the librainian for code quality issues, analyzes
 * patterns that static analysis might miss, and provides evidence-backed findings.
 *
 * @param artifact - The artifact to validate
 * @param standard - The quality standard to validate against
 * @param librainian - LiBrainian instance for semantic analysis
 * @returns Enhanced validation result with semantic issues and confidence
 *
 * @example
 * ```typescript
 * const result = await validateWithLiBrainian(myArtifact, WORLD_CLASS_STANDARDS, librainian);
 * console.log(result.semanticIssues); // Issues found through semantic analysis
 * console.log(result.confidence); // Overall confidence in the validation
 * ```
 */
export async function validateWithLiBrainian(
  artifact: ValidatableArtifact,
  standard: QualityStandard,
  librainian: LiBrainian
): Promise<LiBrainianEnhancedValidationResult> {
  // Perform static validation first
  const staticResult = validateAgainstStandard(artifact, standard);

  // Build librainian query for semantic analysis
  let queryResult: LlmOptional<LiBrainianResponse> | null = null;
  let librainianAvailable = false;

  try {
    queryResult = await librainian.queryOptional({
      intent: `Find code quality issues and patterns that violate ${standard.name} quality standards. ` +
              `Look for: error handling gaps, validation issues, complexity smells, ` +
              `security concerns, maintainability problems, and test coverage gaps.`,
      depth: 'L2',
      taskType: 'understand',
    });
    librainianAvailable = queryResult.llmAvailable ?? false;
  } catch {
    // LiBrainian query failed, proceed with static validation only
    librainianAvailable = false;
  }

  // Extract semantic issues from librainian analysis
  const semanticIssues = extractSemanticIssuesFromQuery(queryResult, standard.name);

  // Build evidence references
  const evidenceRefs = buildEvidenceRefsFromQuery(queryResult);

  // Derive overall confidence
  const confidence = deriveValidationConfidence(queryResult, staticResult);

  // Adjust score based on semantic issues
  const semanticPenalty = semanticIssues.reduce((penalty, issue) => {
    switch (issue.severity) {
      case 'error': return penalty + 0.1;
      case 'warning': return penalty + 0.05;
      case 'info': return penalty + 0.01;
      default: return penalty;
    }
  }, 0);
  const adjustedScore = Math.max(0, staticResult.score - semanticPenalty);

  return {
    ...staticResult,
    score: adjustedScore,
    passed: adjustedScore >= 0.8 && !semanticIssues.some(i => i.severity === 'error'),
    semanticIssues,
    confidence,
    evidenceRefs,
    librainianAvailable,
    traceId: queryResult?.traceId,
  };
}
