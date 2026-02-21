/**
 * @fileoverview Universal Knowledge Types for Librarian
 *
 * A single unified knowledge structure per code entity that implicitly provides
 * answers to ANY question ANY stakeholder could ask. This schema covers 150+
 * distinct knowledge needs across Identity, Semantics, Contract, Relationships,
 * Quality, Security, Runtime, Testing, History, Ownership, Rationale, Context,
 * Traceability, and Meta domains.
 *
 * Design Philosophy:
 * - ONE comprehensive record per entity (not separate stakeholder views)
 * - Every field backed by evidence with confidence scores
 * - Self-aware of uncertainty and potential defeaters
 * - Automatically invalidated on code changes
 *
 * Research Sources:
 * - ISO 25010 (Software Quality Model)
 * - ATAM (Architecture Tradeoff Analysis Method)
 * - Epistemology (JTB + Defeaters)
 * - Domain-Driven Design (Ubiquitous Language, Bounded Contexts)
 * - Cognitive Load Theory
 */

// ============================================================================
// ENTITY KIND
// ============================================================================

export type EntityKind =
  | 'function'
  | 'class'
  | 'module'
  | 'type'
  | 'interface'
  | 'variable'
  | 'constant'
  | 'test'
  | 'config'
  | 'schema'
  | 'migration'
  | 'hook'
  | 'middleware'
  | 'route'
  | 'component';

// ============================================================================
// MAIN UNIVERSAL KNOWLEDGE INTERFACE
// ============================================================================

/**
 * Complete knowledge record for a single code entity.
 * Enables answering any of the 150 knowledge questions.
 */
export interface UniversalKnowledge {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY (Questions 1-15)
  // What is this entity? Where is it? What are its basic properties?
  // ═══════════════════════════════════════════════════════════════════════════
  id: string;                        // Unique identifier (hash-based)
  name: string;                      // Canonical name
  qualifiedName: string;             // Full path including namespace
  kind: EntityKind;                  // Entity type
  location: EntityLocation;          // Where in the codebase
  language: string;                  // typescript|javascript|python|go|rust
  framework?: string;                // react|express|django|etc
  module: string;                    // Module/namespace path
  visibility: Visibility;            // Access level
  created: string;                   // ISO timestamp (from git)
  hash: string;                      // Content hash for change detection
  tokenCount: number;                // For LLM context budgeting
  embedding?: Float32Array;          // Semantic vector (384-dim)

  // ═══════════════════════════════════════════════════════════════════════════
  // SEMANTICS (Questions 16-45)
  // The "What" and "Why" and "How" - purpose, domain, mechanism
  // ═══════════════════════════════════════════════════════════════════════════
  semantics: EntitySemantics;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTRACT (Questions 46-60)
  // The Interface - inputs, outputs, guarantees, constraints
  // ═══════════════════════════════════════════════════════════════════════════
  contract: EntityContract;

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS (Questions 61-80)
  // The Graph - dependencies, collaborators, impacts
  // ═══════════════════════════════════════════════════════════════════════════
  relationships: EntityRelationships;

  // ═══════════════════════════════════════════════════════════════════════════
  // QUALITY (Questions 81-100)
  // The Health Assessment - complexity, smells, maintainability
  // ═══════════════════════════════════════════════════════════════════════════
  quality: EntityQuality;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY (Questions 101-115)
  // The Risk Assessment - vulnerabilities, threats, controls
  // ═══════════════════════════════════════════════════════════════════════════
  security: EntitySecurity;

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNTIME (Questions 116-125)
  // The Execution Profile - performance, resources, observability
  // ═══════════════════════════════════════════════════════════════════════════
  runtime: EntityRuntime;

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTING (Questions 126-135)
  // The Verification - coverage, assertions, specs
  // ═══════════════════════════════════════════════════════════════════════════
  testing: EntityTesting;

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORY (Questions 136-145)
  // The Evolution - changes, deprecation, migrations
  // ═══════════════════════════════════════════════════════════════════════════
  history: EntityHistory;

  // ═══════════════════════════════════════════════════════════════════════════
  // OWNERSHIP (Questions 146-150)
  // The Team Knowledge - experts, reviewers, tribal knowledge
  // ═══════════════════════════════════════════════════════════════════════════
  ownership: EntityOwnership;

  // ═══════════════════════════════════════════════════════════════════════════
  // RATIONALE
  // The "Why This Way" - decisions, constraints, tradeoffs
  // ═══════════════════════════════════════════════════════════════════════════
  rationale: EntityRationale;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT
  // The Environment - feature flags, config, infrastructure
  // ═══════════════════════════════════════════════════════════════════════════
  context: EntityContext;

  // ═══════════════════════════════════════════════════════════════════════════
  // TRACEABILITY
  // The Links - requirements, issues, incidents
  // ═══════════════════════════════════════════════════════════════════════════
  traceability: EntityTraceability;

  // ═══════════════════════════════════════════════════════════════════════════
  // META
  // Knowledge About This Knowledge - confidence, evidence, validity
  // ═══════════════════════════════════════════════════════════════════════════
  meta: KnowledgeMeta;

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENTIC
  // Affordances for AI agents - what can be done with this entity
  // Based on "Next Generation Agent Systems" (VLDB 2025)
  // ═══════════════════════════════════════════════════════════════════════════
  agentic?: AgenticAffordances;
}

// ============================================================================
// IDENTITY TYPES
// ============================================================================

export interface EntityLocation {
  file: string;                      // Absolute path
  line: number;                      // Start line
  column: number;                    // Start column
  endLine: number;                   // End line
  endColumn: number;                 // End column
  byteRange: [number, number];       // Byte offsets for efficient access
}

export type Visibility = 'public' | 'private' | 'protected' | 'internal';

// ============================================================================
// SEMANTICS TYPES
// ============================================================================

export interface EntitySemantics {
  // Purpose (Questions 16-30)
  purpose: SemanticPurpose;
  domain: SemanticDomain;
  intent: SemanticIntent;

  // Mechanism (Questions 31-45)
  mechanism: SemanticMechanism;
  complexity: SemanticComplexity;
}

export interface SemanticPurpose {
  summary: string;                   // One sentence, max 160 chars
  explanation: string;               // Full explanation (1-3 paragraphs)
  problemSolved: string;             // What problem this addresses
  valueProp: string;                 // What breaks/is missing without this
  businessContext?: string;          // Business domain relevance
}

export interface SemanticDomain {
  concepts: string[];                // Domain terms (ubiquitous language)
  boundedContext?: string;           // DDD bounded context
  aggregateRole?: AggregateRole;     // DDD aggregate role
  businessRules: string[];           // Encoded business logic descriptions
}

export type AggregateRole = 'root' | 'entity' | 'value' | 'service' | 'repository';

export interface SemanticIntent {
  primaryUseCase: string;            // Main usage scenario
  secondaryUseCases: string[];       // Other valid uses
  antiUseCases: string[];            // What NOT to use this for
}

export interface SemanticMechanism {
  explanation: string;               // Plain English how it works
  algorithm?: string;                // Named algorithm if applicable
  steps?: string[];                  // Step-by-step breakdown
  approach: string;                  // High-level implementation approach
  approachRationale: string;         // Why this approach was chosen
  patterns: string[];                // Design patterns used
  dataStructures: string[];          // Key data structures
  stateManagement?: string;          // How state is managed
}

export interface SemanticComplexity {
  time: string;                      // Big-O time, e.g., "O(n log n)"
  space: string;                     // Big-O space
  cognitive: CognitiveComplexity;    // Human understandability
  recursionDepth?: number;           // Max recursion if recursive
  iterationBound?: string;           // Loop bounds description
}

export type CognitiveComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

// ============================================================================
// CONTRACT TYPES
// ============================================================================

export interface EntityContract {
  signature: ContractSignature;
  behavior: ContractBehavior;
  bounds: ContractBounds;
  concurrency: ContractConcurrency;
}

export interface ContractSignature {
  raw: string;                       // Raw type signature
  inputs: Parameter[];               // Input parameters with types
  output: TypeInfo;                  // Return type
  generics?: Generic[];              // Generic type parameters
  throws?: string[];                 // Exception types
}

export interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  default?: string;
  description: string;
}

export interface TypeInfo {
  raw: string;
  description: string;
  nullable: boolean;
}

export interface Generic {
  name: string;
  constraint?: string;
  default?: string;
}

export interface ContractBehavior {
  preconditions: Condition[];        // Must be true before call
  postconditions: Condition[];       // Will be true after call
  invariants: Condition[];           // Always true
  sideEffects: SideEffect[];         // External state changes
}

export interface Condition {
  description: string;
  formal?: string;                   // Formal notation
  testedBy?: string[];               // Test files that verify
}

export interface SideEffect {
  type: SideEffectType;
  description: string;
  reversible: boolean;
}

export type SideEffectType = 'io' | 'state' | 'network' | 'db' | 'file' | 'global' | 'log';

export interface ContractBounds {
  inputRanges: InputBound[];         // Valid input ranges
  nullBehavior: string;              // How nulls are handled
  boundaryBehavior: string;          // Edge case handling
  defaultBehaviors: DefaultBehavior[];
}

export interface InputBound {
  parameter: string;
  min?: number | string;
  max?: number | string;
  pattern?: string;
  enum?: string[];
}

export interface DefaultBehavior {
  parameter: string;
  value: string;
  behavior: string;
}

export interface ContractConcurrency {
  threadSafe: boolean;
  asyncSemantics?: AsyncSemantics;
  reentrancy: boolean;
  lockingStrategy?: string;
}

export type AsyncSemantics = 'sync' | 'async' | 'generator' | 'stream';

// ============================================================================
// RELATIONSHIPS TYPES
// ============================================================================

export interface EntityRelationships {
  // Static dependencies
  imports: Reference[];              // What this imports
  exports: Reference[];              // What this exports

  // Call graph
  calls: CallReference[];            // Functions this calls
  calledBy: CallReference[];         // Functions that call this

  // Type hierarchy
  extends?: Reference;               // Parent class/interface
  extendedBy: Reference[];           // Child classes
  implements: Reference[];           // Interfaces implemented
  implementedBy: Reference[];        // Classes that implement this

  // Semantic relationships
  collaborators: Collaborator[];     // Works closely with
  dependents: Dependent[];           // Would break if this changes
  alternatives: Alternative[];       // Other ways to achieve same goal
  conflicts: Reference[];            // Mutually exclusive with
  complements: Reference[];          // Often used together
  similar: SimilarEntity[];          // Semantically similar (from embeddings)

  // Temporal relationships
  cochanges: Cochange[];             // Files that change together

  // Structural metrics
  coupling: CouplingMetrics;
  cohesion: CohesionMetrics;

  // Architectural
  layer?: string;                    // e.g., "presentation", "domain", "infrastructure"
  boundary?: string;                 // Architectural boundary name
}

export interface Reference {
  id: string;
  name: string;
  file: string;
  line: number;
}

export interface CallReference extends Reference {
  callType: CallType;
  frequency: CallFrequency;
}

export type CallType = 'direct' | 'indirect' | 'callback' | 'dynamic';
export type CallFrequency = 'once' | 'few' | 'many' | 'loop';

export interface Collaborator extends Reference {
  relationship: string;              // How they collaborate
  strength: 'tight' | 'loose';
  intentional: boolean;
}

export interface Dependent extends Reference {
  impactIfChanged: ImpactLevel;
  confidence: number;
}

export type ImpactLevel = 'breaking' | 'behavioral' | 'cosmetic' | 'none';

export interface Alternative extends Reference {
  comparison: string;                // How it compares
  whenToUse: string;                 // When to prefer this
}

export interface SimilarEntity extends Reference {
  similarity: number;                // Cosine similarity 0-1
  reason: string;                    // Why similar
}

export interface Cochange extends Reference {
  strength: number;                  // Cochange probability 0-1
  commits: number;                   // Times changed together
}

export interface CouplingMetrics {
  afferent: number;                  // Incoming dependencies count
  efferent: number;                  // Outgoing dependencies count
  instability: number;               // Efferent / (Afferent + Efferent)
}

export interface CohesionMetrics {
  score: number;                     // 0-1 cohesion metric
  type: CohesionType;
}

export type CohesionType =
  | 'functional'
  | 'sequential'
  | 'communicational'
  | 'procedural'
  | 'temporal'
  | 'logical'
  | 'coincidental';

// ============================================================================
// QUALITY TYPES
// ============================================================================

export interface EntityQuality {
  complexity: QualityComplexity;
  smells: QualityCodeSmell[];
  maintainability: Maintainability;
  coverage: TestCoverage;
  documentation: DocumentationQuality;
  hygiene: CodeHygiene;
  churn: ChangeChurn;
}

export interface QualityComplexity {
  cyclomatic: number;                // McCabe complexity
  cognitive: number;                 // SonarSource cognitive complexity
  nesting: number;                   // Max nesting depth
  lines: number;                     // Lines of code
  statements: number;                // Statement count
  parameters: number;                // Parameter count
  returns: number;                   // Return points
  halstead: HalsteadMetrics;
}

export interface HalsteadMetrics {
  vocabulary: number;
  length: number;
  difficulty: number;
  effort: number;
  bugs: number;                      // Estimated bugs
}

export interface QualityCodeSmell {
  name: string;                      // e.g., "Long Method", "Feature Envy"
  severity: SmellSeverity;
  location: { line: number; column: number };
  description: string;
  refactoring?: string;              // Suggested refactoring
}

export type SmellSeverity = 'blocker' | 'critical' | 'major' | 'minor' | 'info';

export interface Maintainability {
  index: number;                     // 0-100 maintainability index
  rating: MaintainabilityRating;
  technicalDebt: TechnicalDebt;
}

export type MaintainabilityRating = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TechnicalDebt {
  minutes: number;                   // Estimated remediation time
  ratio: number;                     // Debt ratio
  issues: DebtIssue[];               // Specific debt items
}

export interface DebtIssue {
  type: string;
  description: string;
  effort: number;                    // Minutes to fix
  priority: number;
}

export interface TestCoverage {
  line: number;                      // Line coverage percentage
  branch: number;                    // Branch coverage percentage
  function: number;                  // Function coverage percentage
  statement: number;                 // Statement coverage percentage
  mutation?: number;                 // Mutation testing score
}

export interface DocumentationQuality {
  hasDocstring: boolean;
  hasInlineComments: boolean;
  documentationRatio: number;        // Comment lines / code lines
  qualityScore: number;              // Doc quality assessment 0-1
}

export interface CodeHygiene {
  linterViolations: LinterViolation[];
  typeErrors: CodeTypeError[];
  duplications: CodeDuplication[];
  todoCount: number;
  fixmeCount: number;
}

export interface LinterViolation {
  rule: string;
  message: string;
  line: number;
  severity: string;
}

export interface CodeTypeError {
  message: string;
  line: number;
  column: number;
}

export interface CodeDuplication {
  lines: number;
  duplicateOf: Reference;
}

export interface ChangeChurn {
  changeCount: number;               // Times changed (30 days)
  changeFrequency: number;           // Changes per month
  lastChanged: string;               // ISO timestamp
  age: number;                       // Days since creation
  authors: number;                   // Unique authors
}

// ============================================================================
// SECURITY TYPES
// ============================================================================

export interface EntitySecurity {
  vulnerabilities: Vulnerability[];
  cwe: CWEReference[];
  owasp: OWASPReference[];
  threatModel: ThreatModel;
  controls: SecurityControls;
  compliance: ComplianceRequirement[];
  riskScore: RiskScore | null;
}

export interface Vulnerability {
  id: string;                        // CVE or internal ID
  severity: VulnerabilitySeverity;
  description: string;
  remediation?: string;
  cwe?: string;
}

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CWEReference {
  id: string;                        // e.g., "CWE-79"
  name: string;
  applicability: string;
}

export interface OWASPReference {
  id: string;                        // e.g., "A03:2021"
  name: string;
  relevance: string;
}

export interface ThreatModel {
  attackSurface: string[];           // Entry points for attacks
  threatVectors: ThreatVector[];
  dataClassification: DataClassification;
  sensitiveData: SensitiveDataType[];
}

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export interface ThreatVector {
  name: string;
  description: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  mitigation?: string;
}

export type RiskLevel = 'high' | 'medium' | 'low';

export type SensitiveDataType =
  | 'pii'
  | 'phi'
  | 'financial'
  | 'credentials'
  | 'api_keys'
  | 'tokens'
  | 'secrets';

export interface SecurityControls {
  inputValidation: ValidationControl[];
  outputEncoding: EncodingControl[];
  authentication: AuthRequirement[];
  authorization: AuthzRequirement[];
  cryptography: CryptoUsage[];
}

export interface ValidationControl {
  input: string;
  validation: string;
  sanitization?: string;
}

export interface EncodingControl {
  output: string;
  encoding: string;
  context: string;
}

export interface AuthRequirement {
  type: string;
  level: string;
  mechanism: string;
}

export interface AuthzRequirement {
  resource: string;
  permission: string;
  roles: string[];
}

export interface CryptoUsage {
  purpose: string;
  algorithm: string;
  keyManagement: string;
}

export interface ComplianceRequirement {
  standard: string;                  // e.g., "GDPR", "HIPAA", "SOC2"
  requirement: string;
  status: 'compliant' | 'non_compliant' | 'partial' | 'not_applicable';
}

export interface RiskScore {
  overall: number;                   // 0-10 risk score
  confidentiality: number;
  integrity: number;
  availability: number;
}

// ============================================================================
// RUNTIME TYPES
// ============================================================================

export interface EntityRuntime {
  performance: RuntimePerformance;
  scalability: RuntimeScalability;
  observability: RuntimeObservability;
  resources: RuntimeResources;
}

export interface RuntimePerformance {
  avgExecutionMs?: number;
  p99ExecutionMs?: number;
  hotspots: PerformanceHotspot[];
  memoryProfile?: MemoryProfile;
  cpuProfile?: CPUProfile;
  ioPattern?: IOPattern;
}

export interface PerformanceHotspot {
  location: string;
  type: 'cpu' | 'memory' | 'io' | 'wait';
  impact: string;
  suggestion?: string;
}

export interface MemoryProfile {
  avgBytes: number;
  peakBytes: number;
  allocations: number;
  gcPressure: 'low' | 'medium' | 'high';
}

export interface CPUProfile {
  avgPercent: number;
  peakPercent: number;
  cpuBound: boolean;
}

export interface IOPattern {
  type: 'read_heavy' | 'write_heavy' | 'balanced' | 'minimal';
  avgOpsPerCall: number;
  blocking: boolean;
}

export interface RuntimeScalability {
  profile: ScalabilityProfile;
  bottlenecks: string[];
  recommendations: string[];
}

export type ScalabilityProfile = 'constant' | 'linear' | 'logarithmic' | 'quadratic' | 'exponential';

export interface RuntimeObservability {
  telemetry: TelemetryPoint[];
  metrics: MetricDefinition[];
  logs: LogPattern[];
  traces: TracePoint[];
}

export interface TelemetryPoint {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  description: string;
}

export interface MetricDefinition {
  name: string;
  type: string;
  unit: string;
  description: string;
}

export interface LogPattern {
  level: 'debug' | 'info' | 'warn' | 'error';
  pattern: string;
  context: string[];
}

export interface TracePoint {
  name: string;
  span: string;
  attributes: string[];
}

export interface RuntimeResources {
  lifecycle: ResourceLifecycle;
  disposalPattern?: string;
  cachingBehavior?: string;
}

export type ResourceLifecycle = 'transient' | 'request-scoped' | 'singleton' | 'pooled';

// ============================================================================
// TESTING TYPES
// ============================================================================

export interface EntityTesting {
  tests: TestReference[];
  byType: TestsByType;
  assertions: TestAssertion[];
  edgeCases: EdgeCaseTest[];
  properties: PropertySpec[];
  behaviorSpecs: BehaviorSpec[];
  history: TestHistory;
  dependencies: TestDependencies;
}

export interface TestReference {
  id: string;
  file: string;
  name: string;
  type: TestType;
  assertions: string[];
}

export type TestType = 'unit' | 'integration' | 'e2e' | 'performance' | 'security';

export interface TestsByType {
  unit: TestReference[];
  integration: TestReference[];
  e2e: TestReference[];
  performance: TestReference[];
  security: TestReference[];
}

export interface TestAssertion {
  description: string;
  type: 'equality' | 'truthiness' | 'exception' | 'type' | 'property';
  target: string;
}

export interface EdgeCaseTest {
  description: string;
  input: string;
  expectedBehavior: string;
  tested: boolean;
}

export interface PropertySpec {
  property: string;                  // "forAll x: f(x) > 0"
  description: string;
  generator?: string;
}

export interface BehaviorSpec {
  given: string;
  when: string;
  then: string;
}

export interface TestHistory {
  failureCount: number;
  flakyScore: number;                // 0-1 flakiness metric
  lastFailure?: string;
  failurePatterns: string[];
}

export interface TestDependencies {
  mocks: MockDependency[];
  fixtures: TestFixture[];
  setup: string[];
}

export interface MockDependency {
  target: string;
  type: string;
  reason: string;
}

export interface TestFixture {
  name: string;
  type: string;
  scope: 'test' | 'file' | 'suite';
}

// ============================================================================
// HISTORY TYPES
// ============================================================================

export interface EntityHistory {
  created: HistoryEvent;
  lastModified: HistoryEvent;
  commits: CommitSummary[];
  evolution: EvolutionInfo;
  plannedChanges: PlannedChange[];
}

export interface HistoryEvent {
  at: string;                        // ISO timestamp
  by: string;                        // Author
  commit: string;                    // Commit hash
  reason?: string;                   // Why (from commit message)
}

export interface CommitSummary {
  hash: string;
  date: string;
  author: string;
  message: string;
  changes: ChangeType;
}

export type ChangeType = 'add' | 'modify' | 'delete' | 'rename';

export interface EvolutionInfo {
  versionIntroduced?: string;        // Semver when added
  deprecatedIn?: string;             // Semver when deprecated
  removedIn?: string;                // Semver when removed
  deprecationReason?: string;
  migrationPath?: string;            // How to migrate away
  breakingChanges: BreakingChange[];
}

export interface BreakingChange {
  version: string;
  description: string;
  migration: string;
}

export interface PlannedChange {
  description: string;
  targetVersion?: string;
  source: string;                    // Where this was mentioned
}

// ============================================================================
// OWNERSHIP TYPES
// ============================================================================

export interface EntityOwnership {
  owner: OwnerInfo;
  expertise: ExpertiseInfo;
  knowledge: TribalKnowledgeInfo;
  contact: ContactInfo;
}

export interface OwnerInfo {
  primary: TeamMember;
  team?: string;
}

export interface TeamMember {
  name: string;
  email?: string;
  github?: string;
}

export interface ExpertiseInfo {
  experts: Expert[];
  reviewers: Reviewer[];
  escalation: string;
}

export interface Expert extends TeamMember {
  expertise: number;                 // 0-1 expertise level
  recentActivity: number;            // Days since last touch
}

export interface Reviewer extends TeamMember {
  specialty?: string[];
}

export interface TribalKnowledgeInfo {
  tribal: TribalKnowledge[];
  gotchas: Gotcha[];
  tips: Tip[];
  learningPath: LearningStep[];
}

export interface TribalKnowledge {
  knowledge: string;
  source: string;                    // Who knows this
  importance: KnowledgeImportance;
}

export type KnowledgeImportance = 'critical' | 'important' | 'nice-to-know';

export interface Gotcha {
  description: string;
  consequence: string;
  prevention: string;
}

export interface Tip {
  description: string;
  context: string;
}

export interface LearningStep {
  order: number;
  description: string;
  resources?: string[];
}

export interface ContactInfo {
  slack?: string;
  email?: string;
  oncall?: string;
}

// ============================================================================
// RATIONALE TYPES
// ============================================================================

export interface EntityRationale {
  decisions: ArchitecturalDecision[];
  constraints: RationaleConstraint[];
  tradeoffs: Tradeoff[];
  alternatives: ConsideredAlternative[];
  assumptions: Assumption[];
  risks: AcceptedRisk[];
}

export interface ArchitecturalDecision {
  id: string;                        // e.g., "ADR-001"
  title: string;
  status: DecisionStatus;
  context: string;
  decision: string;
  consequences: string;
  supersededBy?: string;
}

export type DecisionStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface RationaleConstraint {
  type: ConstraintType;
  description: string;
  source: string;
}

export type ConstraintType = 'technical' | 'business' | 'regulatory' | 'resource';

export interface Tradeoff {
  gained: string;
  sacrificed: string;
  rationale: string;
}

export interface ConsideredAlternative {
  approach: string;
  rejected: string;                  // Why rejected
  source?: string;
}

export interface Assumption {
  assumption: string;
  validated: boolean;
  evidence?: string;
}

export interface AcceptedRisk {
  risk: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  mitigation?: string;
  acceptedBy?: string;
}

// ============================================================================
// CONTEXT TYPES
// ============================================================================

export interface EntityContext {
  environments: EnvironmentBehavior[];
  featureFlags: FeatureFlagDep[];
  configuration: ConfigDep[];
  infrastructure: InfraDep[];
}

export interface EnvironmentBehavior {
  environment: EnvironmentType;
  behavior: string;
  differences: string[];
}

export type EnvironmentType = 'production' | 'staging' | 'development' | 'test';

export interface FeatureFlagDep {
  flag: string;
  behavior: string;
}

export interface ConfigDep {
  key: string;
  type: string;
  default?: string;
  required: boolean;
}

export interface InfraDep {
  resource: string;
  type: string;
  required: boolean;
}

// ============================================================================
// TRACEABILITY TYPES
// ============================================================================

export interface EntityTraceability {
  requirements: RequirementLink[];
  userStories: UserStoryLink[];
  issues: IssueLink[];
  incidents: IncidentLink[];
  deployments: DeploymentLink[];
  documentation: DocLink[];
}

export interface RequirementLink {
  id: string;
  description: string;
  status: RequirementStatus;
}

export type RequirementStatus = 'implemented' | 'partial' | 'planned';

export interface UserStoryLink {
  id: string;
  title: string;
}

export interface IssueLink {
  id: string;
  title: string;
  type: IssueType;
  status: string;
}

export type IssueType = 'feature' | 'bug' | 'improvement';

export interface IncidentLink {
  id: string;
  title: string;
  severity: string;
  date: string;
  rootCause?: string;
}

export interface DeploymentLink {
  environment: string;
  version: string;
  deployedAt: string;
}

export interface DocLink {
  title: string;
  url: string;
  type: DocType;
}

export type DocType = 'api' | 'guide' | 'tutorial' | 'reference' | 'architecture';

// ============================================================================
// META TYPES
// ============================================================================

export interface KnowledgeMeta {
  confidence: MetaConfidence;
  evidence: Evidence[];
  generatedAt: string;
  generatedBy: string;               // Model/version that generated
  /**
   * LLM mandate evidence (provider/model/promptDigest) for semantic sections.
   * Present when a section was produced via LLM synthesis.
   */
  llmEvidence?: Record<string, {
    provider: 'claude' | 'codex';
    modelId: string;
    promptDigest: string;
    timestamp: string;
  }>;
  validUntil?: string;               // When this becomes stale
  defeaters: Defeater[];             // What could invalidate this
  lastValidated?: string;
}

export interface MetaConfidence {
  overall: number;                   // 0-1 overall confidence
  bySection: Record<string, number>; // Per-section confidence

  // Epistemic Uncertainty Taxonomy (per KDD 2025 UQ survey)
  uncertainty?: UncertaintyProfile;
}

/**
 * Epistemic Uncertainty Profile
 *
 * Based on "Uncertainty Quantification and Confidence Calibration in LLMs" (KDD 2025)
 * and "From Aleatoric to Epistemic" (arXiv 2501.03282).
 *
 * Distinguishes between:
 * - Aleatoric: Inherent randomness/noise in the data (irreducible)
 * - Epistemic: Model's lack of knowledge (reducible with more data)
 * - Reasoning: Divergence in inference paths
 */
export interface UncertaintyProfile {
  aleatoric: number;                 // 0-1: Inherent uncertainty from code ambiguity
  epistemic: number;                 // 0-1: Uncertainty from limited training/context
  reasoning?: number;                // 0-1: Divergence in reasoning paths

  // Calibration metrics
  calibration?: CalibrationMetrics;

  // What would reduce uncertainty
  reducibleBy?: UncertaintyReducer[];
}

export interface CalibrationMetrics {
  expectedCalibrationError?: number; // ECE: How well confidence matches accuracy
  maxCalibrationError?: number;      // MCE: Worst-case calibration
  brier?: number;                    // Brier score for probabilistic predictions
}

export interface UncertaintyReducer {
  action: 'more_context' | 'more_tests' | 'expert_review' | 'runtime_data' | 'documentation';
  description: string;
  expectedReduction: number;         // Estimated reduction in epistemic uncertainty
}

export interface Evidence {
  type: EvidenceType;
  source: string;
  description: string;
  confidence: number;
}

export type EvidenceType = 'code' | 'test' | 'commit' | 'comment' | 'usage' | 'doc' | 'inferred';

export interface Defeater {
  type: DefeaterType;
  description: string;
  detected?: string;
}

export type DefeaterType = 'code_change' | 'test_failure' | 'contradiction' | 'new_info';

// ============================================================================
// AGENTIC TYPES
// Based on "Next Generation Agent Systems: From RAG to Agentic AI" (VLDB 2025)
// and "Knowledge Graphs for Agentic AI" (ZBrain, 2025)
// ============================================================================

/**
 * Agentic Affordances
 *
 * Describes what an AI agent can DO with this code entity.
 * Enables agents to understand not just what code IS, but what can be done with it.
 */
export interface AgenticAffordances {
  // Actions this entity enables
  actions: AgenticAction[];

  // How to invoke/use this entity
  invocation?: InvocationGuide;

  // Planning hints for agents
  planning?: PlanningHints;

  // Tool metadata for agent interoperability
  toolMetadata?: ToolMetadata;
}

export interface AgenticAction {
  verb: string;                      // e.g., "validate", "transform", "query", "create"
  object: string;                    // What is acted upon
  preconditions: string[];           // What must be true before
  postconditions: string[];          // What becomes true after
  sideEffects: string[];             // External state changes
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  riskLevel: 'safe' | 'cautious' | 'risky' | 'destructive';
}

export interface InvocationGuide {
  // How to call this (for functions)
  callPattern?: string;              // e.g., "await fetch(url, options)"
  requiredSetup?: string[];          // What must be done first
  errorHandling?: string;            // How to handle failures
  bestPractices?: string[];          // Recommended usage patterns
  antiPatterns?: string[];           // What NOT to do
}

export interface PlanningHints {
  // For agent task planning
  whenToUse: string[];               // Conditions favoring this entity
  whenNotToUse: string[];            // Conditions against using it
  alternatives: string[];            // Other options to consider
  composesWellWith: string[];        // Entities that work well together
  estimatedLatency?: string;         // e.g., "O(1)", "O(n)", "network-bound"
  resourceRequirements?: string[];   // CPU, memory, network, etc.
}

export interface ToolMetadata {
  // Standardized metadata for agent tool use
  name: string;                      // Tool name for agents
  description: string;               // What this tool does
  inputSchema?: Record<string, unknown>;  // JSON Schema for inputs
  outputSchema?: Record<string, unknown>; // JSON Schema for outputs
  examples?: ToolExample[];          // Usage examples
  capabilities: string[];            // What this tool can do
  limitations: string[];             // What this tool cannot do
}

export interface ToolExample {
  input: unknown;
  output: unknown;
  description: string;
}

// ============================================================================
// FACTORY FUNCTIONS FOR EMPTY/DEFAULT VALUES
// ============================================================================

/**
 * Creates a minimal UniversalKnowledge record with all required fields.
 * Use this as a starting point for building knowledge incrementally.
 */
export function createEmptyKnowledge(
  id: string,
  name: string,
  kind: EntityKind,
  file: string,
  line: number
): UniversalKnowledge {
  const now = new Date().toISOString();

  return {
    id,
    name,
    qualifiedName: name,
    kind,
    location: {
      file,
      line,
      column: 0,
      endLine: line,
      endColumn: 0,
      byteRange: [0, 0],
    },
    language: 'typescript',
    module: file,
    visibility: 'public',
    created: now,
    hash: '',
    tokenCount: 0,

    semantics: {
      purpose: {
        summary: '',
        explanation: '',
        problemSolved: '',
        valueProp: '',
      },
      domain: {
        concepts: [],
        businessRules: [],
      },
      intent: {
        primaryUseCase: '',
        secondaryUseCases: [],
        antiUseCases: [],
      },
      mechanism: {
        explanation: '',
        approach: '',
        approachRationale: '',
        patterns: [],
        dataStructures: [],
      },
      complexity: {
        time: 'O(1)',
        space: 'O(1)',
        cognitive: 'simple',
      },
    },

    contract: {
      signature: {
        raw: '',
        inputs: [],
        output: { raw: 'void', description: '', nullable: false },
      },
      behavior: {
        preconditions: [],
        postconditions: [],
        invariants: [],
        sideEffects: [],
      },
      bounds: {
        inputRanges: [],
        nullBehavior: 'throws',
        boundaryBehavior: 'unknown',
        defaultBehaviors: [],
      },
      concurrency: {
        threadSafe: true,
        reentrancy: true,
      },
    },

    relationships: {
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      extendedBy: [],
      implements: [],
      implementedBy: [],
      collaborators: [],
      dependents: [],
      alternatives: [],
      conflicts: [],
      complements: [],
      similar: [],
      cochanges: [],
      coupling: { afferent: 0, efferent: 0, instability: 0 },
      cohesion: { score: 1, type: 'functional' },
    },

    quality: {
      complexity: {
        cyclomatic: 1,
        cognitive: 0,
        nesting: 0,
        lines: 1,
        statements: 1,
        parameters: 0,
        returns: 1,
        halstead: {
          vocabulary: 0,
          length: 0,
          difficulty: 0,
          effort: 0,
          bugs: 0,
        },
      },
      smells: [],
      maintainability: {
        index: 100,
        rating: 'A',
        technicalDebt: { minutes: 0, ratio: 0, issues: [] },
      },
      coverage: {
        line: 0,
        branch: 0,
        function: 0,
        statement: 0,
      },
      documentation: {
        hasDocstring: false,
        hasInlineComments: false,
        documentationRatio: 0,
        qualityScore: 0,
      },
      hygiene: {
        linterViolations: [],
        typeErrors: [],
        duplications: [],
        todoCount: 0,
        fixmeCount: 0,
      },
      churn: {
        changeCount: 0,
        changeFrequency: 0,
        lastChanged: now,
        age: 0,
        authors: 1,
      },
    },

    security: {
      vulnerabilities: [],
      cwe: [],
      owasp: [],
      threatModel: {
        attackSurface: [],
        threatVectors: [],
        dataClassification: 'internal',
        sensitiveData: [],
      },
      controls: {
        inputValidation: [],
        outputEncoding: [],
        authentication: [],
        authorization: [],
        cryptography: [],
      },
      compliance: [],
      riskScore: null,
    },

    runtime: {
      performance: {
        hotspots: [],
      },
      scalability: {
        profile: 'constant',
        bottlenecks: [],
        recommendations: [],
      },
      observability: {
        telemetry: [],
        metrics: [],
        logs: [],
        traces: [],
      },
      resources: {
        lifecycle: 'transient',
      },
    },

    testing: {
      tests: [],
      byType: {
        unit: [],
        integration: [],
        e2e: [],
        performance: [],
        security: [],
      },
      assertions: [],
      edgeCases: [],
      properties: [],
      behaviorSpecs: [],
      history: {
        failureCount: 0,
        flakyScore: 0,
        failurePatterns: [],
      },
      dependencies: {
        mocks: [],
        fixtures: [],
        setup: [],
      },
    },

    history: {
      created: { at: now, by: 'unknown', commit: '' },
      lastModified: { at: now, by: 'unknown', commit: '' },
      commits: [],
      evolution: {
        breakingChanges: [],
      },
      plannedChanges: [],
    },

    ownership: {
      owner: {
        primary: { name: 'unknown' },
      },
      expertise: {
        experts: [],
        reviewers: [],
        escalation: '',
      },
      knowledge: {
        tribal: [],
        gotchas: [],
        tips: [],
        learningPath: [],
      },
      contact: {},
    },

    rationale: {
      decisions: [],
      constraints: [],
      tradeoffs: [],
      alternatives: [],
      assumptions: [],
      risks: [],
    },

    context: {
      environments: [],
      featureFlags: [],
      configuration: [],
      infrastructure: [],
    },

    traceability: {
      requirements: [],
      userStories: [],
      issues: [],
      incidents: [],
      deployments: [],
      documentation: [],
    },

    meta: {
      confidence: {
        overall: 0.5,
        bySection: {},
      },
      evidence: [],
      generatedAt: now,
      generatedBy: 'librarian',
      llmEvidence: {},
      defeaters: [],
    },
  };
}

// ============================================================================
// QUESTION MAPPING
// The 150 knowledge questions and which fields answer them
// ============================================================================

/**
 * Maps question categories to their answering fields.
 * This documents how the schema implicitly answers all 150 questions.
 */
export const KNOWLEDGE_QUESTION_MAP = {
  // Identity (1-15)
  'what_is_this': ['kind', 'name'],
  'canonical_name': ['qualifiedName'],
  'location': ['location.file', 'location.line'],
  'language_framework': ['language', 'framework'],
  'module_namespace': ['module'],
  'visibility': ['visibility'],
  'created_when': ['created'],
  'content_hash': ['hash'],
  'token_count': ['tokenCount'],
  'embedding': ['embedding'],
  'unique_id': ['id'],

  // Purpose (16-30)
  'why_exists': ['semantics.purpose.explanation'],
  'problem_solved': ['semantics.purpose.problemSolved'],
  'what_breaks_without': ['semantics.purpose.valueProp'],
  'business_requirement': ['semantics.domain.businessRules'],
  'use_cases': ['semantics.intent.primaryUseCase', 'semantics.intent.secondaryUseCases'],
  'domain_concepts': ['semantics.domain.concepts'],
  'bounded_context': ['semantics.domain.boundedContext'],
  'summary': ['semantics.purpose.summary'],

  // Mechanism (31-45)
  'how_works': ['semantics.mechanism.explanation'],
  'algorithm': ['semantics.mechanism.algorithm'],
  'data_structures': ['semantics.mechanism.dataStructures'],
  'time_complexity': ['semantics.complexity.time'],
  'space_complexity': ['semantics.complexity.space'],
  'steps': ['semantics.mechanism.steps'],
  'approach': ['semantics.mechanism.approach'],
  'patterns': ['semantics.mechanism.patterns'],

  // Interface (46-60)
  'inputs': ['contract.signature.inputs'],
  'outputs': ['contract.signature.output'],
  'types': ['contract.signature.raw'],
  'preconditions': ['contract.behavior.preconditions'],
  'postconditions': ['contract.behavior.postconditions'],
  'side_effects': ['contract.behavior.sideEffects'],
  'exceptions': ['contract.signature.throws'],
  'thread_safety': ['contract.concurrency.threadSafe'],

  // Dependencies (61-80)
  'imports': ['relationships.imports'],
  'exports': ['relationships.exports'],
  'calls': ['relationships.calls'],
  'called_by': ['relationships.calledBy'],
  'extends': ['relationships.extends'],
  'implements': ['relationships.implements'],
  'collaborators': ['relationships.collaborators'],
  'dependents': ['relationships.dependents'],
  'coupling': ['relationships.coupling'],
  'layer': ['relationships.layer'],

  // Quality (81-100)
  'cyclomatic_complexity': ['quality.complexity.cyclomatic'],
  'cognitive_complexity': ['quality.complexity.cognitive'],
  'code_smells': ['quality.smells'],
  'maintainability': ['quality.maintainability.index'],
  'technical_debt': ['quality.maintainability.technicalDebt'],
  'test_coverage': ['quality.coverage'],
  'churn': ['quality.churn'],

  // Security (101-115)
  'vulnerabilities': ['security.vulnerabilities'],
  'cwe': ['security.cwe'],
  'owasp': ['security.owasp'],
  'attack_surface': ['security.threatModel.attackSurface'],
  'threat_vectors': ['security.threatModel.threatVectors'],
  'risk_score': ['security.riskScore.overall'],

  // Runtime (116-125)
  'performance': ['runtime.performance'],
  'scalability': ['runtime.scalability.profile'],
  'observability': ['runtime.observability'],
  'resource_lifecycle': ['runtime.resources.lifecycle'],

  // Testing (126-135)
  'tests': ['testing.tests'],
  'test_types': ['testing.byType'],
  'assertions': ['testing.assertions'],
  'edge_cases': ['testing.edgeCases'],
  'test_history': ['testing.history'],

  // History (136-145)
  'last_modified': ['history.lastModified'],
  'commit_history': ['history.commits'],
  'deprecation': ['history.evolution.deprecatedIn'],
  'breaking_changes': ['history.evolution.breakingChanges'],

  // Ownership (146-150)
  'owner': ['ownership.owner'],
  'experts': ['ownership.expertise.experts'],
  'reviewers': ['ownership.expertise.reviewers'],
  'tribal_knowledge': ['ownership.knowledge.tribal'],
  'learning_path': ['ownership.knowledge.learningPath'],
} as const;
