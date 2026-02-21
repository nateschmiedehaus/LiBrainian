/**
 * @fileoverview TDD (Test-Driven Development) Types
 *
 * Comprehensive type definitions for TDD techniques, skills, and methods
 * exposed through the librainian API for agent-driven development workflows.
 */

// ---------------------------------------------------------------------------
// Test Discovery & Analysis
// ---------------------------------------------------------------------------

export interface TestFile {
  path: string;
  framework: TestFramework;
  testCount: number;
  suiteCount: number;
  skipCount: number;
  lastModified: Date;
}

export type TestFramework =
  | 'vitest'
  | 'jest'
  | 'mocha'
  | 'ava'
  | 'tape'
  | 'node:test'
  | 'pytest'
  | 'unittest'
  | 'go-test'
  | 'unknown';

export interface TestSuite {
  name: string;
  file: string;
  tests: TestCase[];
  beforeAll?: string[];
  afterAll?: string[];
  beforeEach?: string[];
  afterEach?: string[];
  nested: TestSuite[];
}

export interface TestCase {
  name: string;
  file: string;
  line: number;
  status: 'active' | 'skipped' | 'todo' | 'only';
  tags: string[];
  timeout?: number;
  assertions: AssertionInfo[];
}

export interface AssertionInfo {
  type: AssertionType;
  line: number;
  description?: string;
}

export type AssertionType =
  | 'equality'
  | 'truthiness'
  | 'throws'
  | 'async'
  | 'mock'
  | 'snapshot'
  | 'coverage'
  | 'custom';

// ---------------------------------------------------------------------------
// Test Coverage
// ---------------------------------------------------------------------------

export interface CoverageReport {
  files: FileCoverage[];
  summary: CoverageSummary;
  uncoveredFunctions: UncoveredFunction[];
  uncoveredBranches: UncoveredBranch[];
  suggestions: CoverageSuggestion[];
}

export interface FileCoverage {
  path: string;
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  uncoveredLines: number[];
}

export interface CoverageMetric {
  total: number;
  covered: number;
  percentage: number;
}

export interface CoverageSummary {
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  timestamp: Date;
}

export interface UncoveredFunction {
  name: string;
  file: string;
  line: number;
  complexity: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export interface UncoveredBranch {
  file: string;
  line: number;
  type: 'if' | 'switch' | 'ternary' | 'logical';
  condition: string;
  uncoveredPath: 'true' | 'false' | 'case';
}

export interface CoverageSuggestion {
  target: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  suggestedTest: string;
}

// ---------------------------------------------------------------------------
// Test Generation
// ---------------------------------------------------------------------------

export interface TestGenerationRequest {
  target: TestTarget;
  style: TestStyle;
  coverage: CoverageGoal;
  constraints?: TestConstraint[];
}

export interface TestTarget {
  type: 'function' | 'class' | 'module' | 'file';
  path: string;
  name?: string;
  signature?: string;
}

export interface TestStyle {
  framework: TestFramework;
  pattern: TestPattern;
  assertionStyle: 'expect' | 'assert' | 'should';
  asyncStyle: 'async-await' | 'promises' | 'callbacks';
  mockingLibrary?: 'vitest' | 'jest' | 'sinon' | 'testdouble';
}

export type TestPattern =
  | 'arrange-act-assert'
  | 'given-when-then'
  | 'setup-exercise-verify'
  | 'four-phase';

export interface CoverageGoal {
  minimumLineCoverage: number;
  minimumBranchCoverage: number;
  edgeCases: boolean;
  errorPaths: boolean;
  boundaryConditions: boolean;
}

export interface TestConstraint {
  type: 'no-mocks' | 'integration' | 'unit' | 'e2e' | 'property-based';
  reason?: string;
}

export interface GeneratedTest {
  code: string;
  file: string;
  testCases: GeneratedTestCase[];
  imports: string[];
  setupCode?: string;
  teardownCode?: string;
  mocks: MockRequirement[];
  estimatedCoverage: number;
}

export interface GeneratedTestCase {
  name: string;
  description: string;
  input: unknown;
  expectedOutput: unknown;
  type: 'happy-path' | 'edge-case' | 'error-path' | 'boundary' | 'property';
  assertions: string[];
}

// ---------------------------------------------------------------------------
// Test Doubles (Mocks, Stubs, Spies, Fakes)
// ---------------------------------------------------------------------------

export interface MockRequirement {
  target: string;
  type: TestDoubleType;
  reason: string;
  suggestedImplementation?: string;
}

export type TestDoubleType = 'mock' | 'stub' | 'spy' | 'fake' | 'dummy';

export interface MockAnalysis {
  dependencies: DependencyToMock[];
  externalServices: ExternalServiceMock[];
  sideEffects: SideEffectMock[];
  recommendations: MockRecommendation[];
}

export interface DependencyToMock {
  name: string;
  importPath: string;
  type: 'module' | 'class' | 'function' | 'constant';
  usedMethods: string[];
  suggestedDoubleType: TestDoubleType;
}

export interface ExternalServiceMock {
  service: string;
  operations: string[];
  suggestedApproach: 'stub' | 'fake-server' | 'contract';
  contractFile?: string;
}

export interface SideEffectMock {
  effect: string;
  type: 'filesystem' | 'network' | 'database' | 'time' | 'random' | 'env';
  suggestedApproach: string;
}

export interface MockRecommendation {
  recommendation: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Property-Based Testing
// ---------------------------------------------------------------------------

export interface PropertyTestSuggestion {
  property: string;
  description: string;
  generators: GeneratorSpec[];
  shrinkable: boolean;
  examples: PropertyExample[];
}

export interface GeneratorSpec {
  name: string;
  type: string;
  constraints?: Record<string, unknown>;
}

export interface PropertyExample {
  input: unknown;
  expectedBehavior: string;
}

// ---------------------------------------------------------------------------
// Test Patterns & Best Practices
// ---------------------------------------------------------------------------

export interface TestPatternMatch {
  pattern: KnownTestPattern;
  file: string;
  location: { startLine: number; endLine: number };
  quality: 'exemplary' | 'good' | 'needs-improvement' | 'antipattern';
  notes?: string;
}

export interface KnownTestPattern {
  name: string;
  category: TestPatternCategory;
  description: string;
  example: string;
}

export type TestPatternCategory =
  | 'setup'
  | 'assertion'
  | 'isolation'
  | 'fixture'
  | 'async'
  | 'mocking'
  | 'organization'
  | 'naming';

export interface TestAntiPattern {
  name: string;
  file: string;
  line: number;
  description: string;
  suggestion: string;
  severity: 'warning' | 'error';
}

// ---------------------------------------------------------------------------
// Red-Green-Refactor Workflow
// ---------------------------------------------------------------------------

export interface TddCycleState {
  phase: TddPhase;
  testFile?: string;
  implementationFile?: string;
  currentTest?: TestCase;
  history: TddCycleStep[];
}

export type TddPhase = 'red' | 'green' | 'refactor' | 'complete';

export interface TddCycleStep {
  phase: TddPhase;
  timestamp: Date;
  description: string;
  files: string[];
  outcome: 'success' | 'failure' | 'skipped';
}

export interface TddGuidance {
  currentPhase: TddPhase;
  nextAction: string;
  rationale: string;
  suggestions: string[];
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Test Dependencies & Isolation
// ---------------------------------------------------------------------------

export interface TestDependencyGraph {
  tests: TestNode[];
  dependencies: TestDependency[];
  isolationScore: number;
  issues: IsolationIssue[];
}

export interface TestNode {
  id: string;
  file: string;
  name: string;
  type: 'unit' | 'integration' | 'e2e';
}

export interface TestDependency {
  from: string;
  to: string;
  type: 'fixture' | 'state' | 'order' | 'resource';
  removable: boolean;
}

export interface IsolationIssue {
  test: string;
  issue: string;
  severity: 'high' | 'medium' | 'low';
  fix: string;
}

// ---------------------------------------------------------------------------
// Test Prioritization
// ---------------------------------------------------------------------------

export interface TestPriority {
  test: string;
  file: string;
  priority: number;
  factors: PriorityFactor[];
  estimatedDuration: number;
}

export interface PriorityFactor {
  factor: string;
  weight: number;
  contribution: number;
}

export interface TestPrioritizationRequest {
  changedFiles: string[];
  strategy: PrioritizationStrategy;
  maxTests?: number;
  maxDuration?: number;
}

export type PrioritizationStrategy =
  | 'affected-first'
  | 'fast-first'
  | 'flaky-last'
  | 'coverage-based'
  | 'risk-based'
  | 'historical';

// ---------------------------------------------------------------------------
// Contract Testing
// ---------------------------------------------------------------------------

export interface ContractTest {
  provider: string;
  consumer: string;
  interactions: ContractInteraction[];
  verified: boolean;
  lastVerified?: Date;
}

export interface ContractInteraction {
  description: string;
  request: ContractRequest;
  response: ContractResponse;
  providerState?: string;
}

export interface ContractRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ContractResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

// ---------------------------------------------------------------------------
// Mutation Testing
// ---------------------------------------------------------------------------

export interface MutationReport {
  file: string;
  mutants: Mutant[];
  killed: number;
  survived: number;
  timeout: number;
  score: number;
  weakTests: WeakTest[];
}

export interface Mutant {
  id: string;
  type: MutationType;
  location: { line: number; column: number };
  original: string;
  replacement: string;
  status: 'killed' | 'survived' | 'timeout' | 'no-coverage';
  killedBy?: string;
}

export type MutationType =
  | 'arithmetic'
  | 'comparison'
  | 'logical'
  | 'assignment'
  | 'return'
  | 'boundary'
  | 'negation';

export interface WeakTest {
  test: string;
  file: string;
  survivedMutants: string[];
  suggestion: string;
}

// ---------------------------------------------------------------------------
// TDD Agent Questions
// ---------------------------------------------------------------------------

export type TddQuestion =
  | { type: 'discover_tests'; scope: string[] }
  | { type: 'analyze_coverage'; files: string[] }
  | { type: 'generate_tests'; request: TestGenerationRequest }
  | { type: 'find_patterns'; in: string[] }
  | { type: 'analyze_mocks'; for: string }
  | { type: 'suggest_properties'; for: string }
  | { type: 'check_isolation'; tests: string[] }
  | { type: 'prioritize_tests'; request: TestPrioritizationRequest }
  | { type: 'tdd_guidance'; state: TddCycleState }
  | { type: 'analyze_mutations'; file: string }
  | { type: 'find_contracts'; between: [string, string] }
  | { type: 'suggest_fixtures'; for: string[] };

export interface TddAnswer {
  answer: unknown;
  confidence: number;
  reasoning: string;
  caveats: string[];
  followUp?: TddQuestion[];
}

// ---------------------------------------------------------------------------
// TDD Agent Actions
// ---------------------------------------------------------------------------

export type TddAction =
  | { type: 'run_tests'; scope: string[]; options?: TestRunOptions }
  | { type: 'generate_coverage_report'; format: 'json' | 'html' | 'lcov' }
  | { type: 'record_test_outcome'; test: string; outcome: TestOutcome }
  | { type: 'update_test_mapping'; source: string; tests: string[] }
  | { type: 'mark_flaky'; test: string; evidence: string[] };

export interface TestRunOptions {
  watch?: boolean;
  coverage?: boolean;
  bail?: boolean;
  timeout?: number;
  filter?: string;
}

export interface TestOutcome {
  passed: boolean;
  duration: number;
  error?: string;
  skipped?: boolean;
}

export interface TddActionResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}
