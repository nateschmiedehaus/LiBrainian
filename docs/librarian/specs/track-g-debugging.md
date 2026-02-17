# Track G: Debugging Assistant with Executable Support

> **Source**: Extracted from `docs/LiBrainian/specs/use-case-targets.md` (UC4)
> **Guarantee**: LiBrainian will support active, executable debugging workflows - not just passive code reading
>
> **LiBrainian Story**: Chapter 7 (The Diagnostician) - From symptom to root cause through systematic hypothesis testing.
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md) and [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md).
>
> **Related Specifications**:
> - [track-c-causal-reasoning.md](./track-c-causal-reasoning.md) - Causal root cause analysis
> - [track-e-domain.md](./track-e-domain.md) - Performance debugging primitives
> - [use-case-targets.md](./use-case-targets.md) - UC4 Debugging Assistant target interface

---

## CRITICAL: Principled Confidence (No Arbitrary Values)

**All confidence values MUST use `ConfidenceValue` type - raw numbers and any “labeled guess” wrappers are FORBIDDEN.**

```typescript
// FORBIDDEN - arbitrary number
confidence: 0.7

// CORRECT - honest about uncertainty
confidence: {
  type: 'absent',
  reason: 'uncalibrated'
}

// CORRECT - deterministic operation with known outcome
confidence: {
  type: 'deterministic',
  value: 1.0,
  reason: 'git_bisect_binary_search_deterministic'
}

// CORRECT - after calibration with real debugging outcomes
confidence: {
  type: 'measured',
  value: 0.81,
  measurement: {
    datasetId: 'librarian_v1_debugging_calibration',
    sampleSize: 200,
    accuracy: 0.81,
    confidenceInterval: [0.75, 0.87],
    measuredAt: '2026-01-23'
  }
}
```

---

## 1. Problem Statement

### The Passive Debugging Limitation

Current debugging assistance is largely **passive**:

```typescript
// Current approach: read code, suggest fixes
const suggestions = await LiBrainian.analyzeBug({
  error: "TypeError: Cannot read property 'user' of undefined",
  stackTrace: stackTrace
});
// Returns: ['Check if user is null', 'Add null check in auth.ts line 42', ...]

// Problems:
// 1. No verification that suggestions are correct
// 2. No systematic hypothesis testing
// 3. No integration with actual debugging tools (git bisect, instrumentation)
// 4. Cannot distinguish between multiple potential root causes
// 5. No executable tests of hypotheses
```

### What Passive Debugging Cannot Do

| Capability | Passive Debugging | Active Debugging |
|------------|------------------|------------------|
| Read stack traces | Yes | Yes |
| Suggest potential fixes | Yes | Yes |
| **Test hypotheses with code execution** | No | Yes |
| **Bisect to find regression commit** | No | Yes |
| **Instrument code to capture state** | No | Yes |
| **Trace actual execution paths** | No | Yes |
| **Verify root cause before suggesting fix** | No | Yes |

### The Active Debugging Paradigm

**Principle**: Debugging is hypothesis testing. Each hypothesis must be:
1. **Stated explicitly** (with confidence level)
2. **Testable through execution** (not just code reading)
3. **Confirmed, refuted, or inconclusive** (with evidence)
4. **Used to update remaining hypotheses** (Bayesian update)

---

## 2. Debugging Workflow

### The Five-Phase Debugging Process

```
+-------------------------------------------------------------------------+
|                    SYSTEMATIC DEBUGGING WORKFLOW                         |
|                                                                         |
|  Phase 1: SYMPTOM COLLECTION                                            |
|  +-----------------------------------------------------------------+   |
|  | - Error messages and stack traces                                |   |
|  | - Reproduction steps (if known)                                  |   |
|  | - Environmental context (versions, config)                       |   |
|  | - Recent changes (git log, deployments)                          |   |
|  +-----------------------------------------------------------------+   |
|                              |                                          |
|                              v                                          |
|  Phase 2: HYPOTHESIS GENERATION                                         |
|  +-----------------------------------------------------------------+   |
|  | - Code analysis (what could cause this symptom?)                 |   |
|  | - Historical patterns (what caused similar bugs before?)         |   |
|  | - Causal reasoning (track-c integration)                         |   |
|  | - Rank by prior probability                                      |   |
|  +-----------------------------------------------------------------+   |
|                              |                                          |
|                              v                                          |
|  Phase 3: HYPOTHESIS TESTING (EXECUTABLE)                               |
|  +-----------------------------------------------------------------+   |
|  | - Design test for highest-probability hypothesis                 |   |
|  | - Execute test (bisect, instrumentation, trace)                  |   |
|  | - Collect evidence                                               |   |
|  | - Update hypothesis probabilities (Bayesian)                     |   |
|  +-----------------------------------------------------------------+   |
|                              |                                          |
|                              v                                          |
|  Phase 4: ROOT CAUSE IDENTIFICATION                                     |
|  +-----------------------------------------------------------------+   |
|  | - Confirmed hypothesis becomes root cause                        |   |
|  | - Link to causal model (track-c)                                 |   |
|  | - Generate evidence chain                                        |   |
|  +-----------------------------------------------------------------+   |
|                              |                                          |
|                              v                                          |
|  Phase 5: FIX SUGGESTION AND VERIFICATION                               |
|  +-----------------------------------------------------------------+   |
|  | - Propose fix based on confirmed root cause                      |   |
|  | - Verify fix addresses root cause (re-run tests)                 |   |
|  | - Check for regressions                                          |   |
|  +-----------------------------------------------------------------+   |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## 3. Core Interfaces

### Part 1: Debugging Session

```typescript
/**
 * A debugging session tracks the full lifecycle of investigating a bug.
 * From initial symptom through hypothesis testing to confirmed root cause.
 */
interface DebuggingSession {
  /** Unique session identifier */
  id: string;

  /** The observed symptom that initiated debugging */
  symptom: BugSymptom;

  /** Generated hypotheses about the cause */
  hypotheses: Hypothesis[];

  /** Tests executed against hypotheses */
  tests: HypothesisTest[];

  /** Confirmed root cause (if found) */
  rootCause: RootCause | null;

  /** Proposed fixes for the root cause */
  fixes: ProposedFix[];

  /** Session state */
  state: DebuggingSessionState;

  /** When session was created */
  createdAt: Date;

  /** When session was last updated */
  updatedAt: Date;

  /** Overall confidence in current conclusions */
  confidence: ConfidenceValue;
}

type DebuggingSessionState =
  | 'collecting_symptoms'
  | 'generating_hypotheses'
  | 'testing_hypotheses'
  | 'root_cause_identified'
  | 'fix_proposed'
  | 'fix_verified'
  | 'abandoned';

/**
 * A bug symptom is the observable manifestation of a defect.
 */
interface BugSymptom {
  /** Symptom type */
  type: SymptomType;

  /** Human-readable description */
  description: string;

  /** Error message (if applicable) */
  errorMessage?: string;

  /** Stack trace (if applicable) */
  stackTrace?: ParsedStackTrace;

  /** Steps to reproduce */
  reproductionSteps?: string[];

  /** Environment context */
  environment: EnvironmentContext;

  /** Recent relevant changes */
  recentChanges?: CodeChange[];

  /** When symptom was first observed */
  observedAt: Date;

  /** Severity assessment */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

type SymptomType =
  | 'runtime_error'
  | 'test_failure'
  | 'incorrect_behavior'
  | 'performance_degradation'
  | 'memory_leak'
  | 'security_vulnerability'
  | 'data_corruption'
  | 'integration_failure';

interface ParsedStackTrace {
  /** Raw stack trace string */
  raw: string;

  /** Parsed frames */
  frames: StackFrame[];

  /** Error type */
  errorType: string;

  /** Error message */
  errorMessage: string;
}

interface StackFrame {
  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Column number (if available) */
  column?: number;

  /** Function name */
  function: string;

  /** Is this frame in user code (vs library/node_modules) */
  isUserCode: boolean;

  /** Corresponding entity ID (if resolvable) */
  entityId?: string;
}

interface EnvironmentContext {
  /** Node/runtime version */
  runtimeVersion: string;

  /** Package versions relevant to the bug */
  packageVersions: Map<string, string>;

  /** Environment variables (sanitized) */
  environmentVariables?: Map<string, string>;

  /** Configuration values */
  configuration?: Map<string, unknown>;

  /** Platform (os, arch) */
  platform: string;
}

interface CodeChange {
  /** Commit hash */
  commitHash: string;

  /** Commit message */
  message: string;

  /** Files changed */
  filesChanged: string[];

  /** Author */
  author: string;

  /** When committed */
  committedAt: Date;
}
```

### Part 2: Hypothesis Management

```typescript
/**
 * A hypothesis about what might be causing the bug.
 * Must be testable through executable means.
 */
interface Hypothesis {
  /** Unique hypothesis identifier */
  id: string;

  /** Human-readable description of the hypothesis */
  description: string;

  /** Current confidence in this hypothesis */
  confidence: ConfidenceValue;

  /** Prior confidence (before any testing) */
  priorConfidence: ConfidenceValue;

  /** Strategy for testing this hypothesis */
  testStrategy: TestStrategy;

  /** Evidence gathered for/against this hypothesis */
  evidence: Evidence[];

  /** Current status */
  status: HypothesisStatus;

  /** Entities suspected to be involved */
  suspectedEntities: string[];

  /** Related hypotheses (mutually exclusive, dependent, etc.) */
  relatedHypotheses: HypothesisRelation[];
}

type HypothesisStatus =
  | 'pending'
  | 'testing'
  | 'confirmed'
  | 'refuted'
  | 'inconclusive';

interface TestStrategy {
  /** Type of test to perform */
  type: TestStrategyType;

  /** Specific test parameters */
  parameters: TestParameters;

  /** Expected outcome if hypothesis is true */
  expectedOutcomeIfTrue: string;

  /** Expected outcome if hypothesis is false */
  expectedOutcomeIfFalse: string;

  /** Estimated time to execute */
  estimatedDuration: 'seconds' | 'minutes' | 'hours';

  /** Risk level of the test */
  risk: 'none' | 'low' | 'medium' | 'high';
}

type TestStrategyType =
  | 'bisect'
  | 'instrumentation'
  | 'trace'
  | 'state_inspection'
  | 'unit_test'
  | 'reproduction'
  | 'counterfactual';

type TestParameters =
  | BisectParameters
  | InstrumentationParameters
  | TraceParameters
  | StateInspectionParameters
  | UnitTestParameters
  | ReproductionParameters
  | CounterfactualParameters;

interface BisectParameters {
  type: 'bisect';
  goodCommit: string;
  badCommit: string;
  testCommand: string;
}

interface InstrumentationParameters {
  type: 'instrumentation';
  targetFile: string;
  instrumentationPoints: InstrumentationPoint[];
}

interface TraceParameters {
  type: 'trace';
  entryPoint: string;
  captureDepth: number;
  captureState: boolean;
}

interface StateInspectionParameters {
  type: 'state_inspection';
  targetEntity: string;
  breakCondition: string;
  stateVariables: string[];
}

interface UnitTestParameters {
  type: 'unit_test';
  testCode: string;
  setupCode?: string;
  teardownCode?: string;
}

interface ReproductionParameters {
  type: 'reproduction';
  steps: string[];
  environment: Partial<EnvironmentContext>;
}

interface CounterfactualParameters {
  type: 'counterfactual';
  intervention: string;
  target: string;
}

interface Evidence {
  /** Evidence type */
  type: EvidenceType;

  /** Human-readable description */
  description: string;

  /** Support direction: confirms or refutes hypothesis */
  direction: 'supports' | 'refutes' | 'neutral';

  /** Strength of evidence */
  strength: ConfidenceValue;

  /** Raw data/artifacts */
  data: unknown;

  /** When gathered */
  gatheredAt: Date;

  /** How it was gathered */
  source: string;
}

type EvidenceType =
  | 'bisect_result'
  | 'trace_output'
  | 'state_capture'
  | 'test_result'
  | 'code_analysis'
  | 'historical_pattern';

interface HypothesisRelation {
  /** Related hypothesis ID */
  hypothesisId: string;

  /** Type of relation */
  type: 'mutually_exclusive' | 'dependent' | 'subhypothesis' | 'alternative';
}
```

### Part 3: Hypothesis Testing

```typescript
/**
 * A test executed to confirm or refute a hypothesis.
 */
interface HypothesisTest {
  /** Unique test identifier */
  id: string;

  /** Hypothesis being tested */
  hypothesisId: string;

  /** Test that was executed */
  test: ExecutableTest;

  /** Test result */
  result: TestResult;

  /** Conclusion drawn from this test */
  conclusion: 'confirmed' | 'refuted' | 'inconclusive';

  /** Confidence in the conclusion */
  conclusionConfidence: ConfidenceValue;

  /** When test was executed */
  executedAt: Date;

  /** Duration of test */
  durationMs: number;
}

/**
 * An executable test that can be run to gather evidence.
 */
interface ExecutableTest {
  /** Test type */
  type: ExecutableTestType;

  /** Test configuration */
  config: TestConfiguration;

  /** Pre-conditions that must hold */
  preconditions: string[];

  /** What this test is designed to reveal */
  intent: string;
}

type ExecutableTestType =
  | 'git_bisect'
  | 'code_instrumentation'
  | 'execution_trace'
  | 'state_inspection'
  | 'hypothesis_test'
  | 'reproduction_attempt';

type TestConfiguration =
  | GitBisectConfig
  | InstrumentationConfig
  | TraceConfig
  | StateInspectionConfig
  | HypothesisTestConfig
  | ReproductionConfig;

interface GitBisectConfig {
  type: 'git_bisect';
  goodCommit: string;
  badCommit: string;
  testCommand: string;
  maxSteps?: number;
}

interface InstrumentationConfig {
  type: 'code_instrumentation';
  targetFile: string;
  points: InstrumentationPoint[];
  outputFormat: 'json' | 'console' | 'file';
}

interface InstrumentationPoint {
  /** Location to instrument */
  location: CodeLocation;

  /** What to capture */
  capture: CaptureType[];

  /** Condition for capture (if any) */
  condition?: string;
}

interface CodeLocation {
  file: string;
  line: number;
  column?: number;
}

type CaptureType =
  | 'arguments'
  | 'return_value'
  | 'local_variables'
  | 'this_context'
  | 'stack_trace'
  | 'timestamp'
  | 'custom_expression';

interface TraceConfig {
  type: 'execution_trace';
  entryPoint: string;
  maxDepth: number;
  captureState: boolean;
  captureTimings: boolean;
  filterPattern?: string;
}

interface StateInspectionConfig {
  type: 'state_inspection';
  targetEntity: string;
  inspectionPoint: 'entry' | 'exit' | 'custom';
  customBreakCondition?: string;
  variablesToCapture: string[];
}

interface HypothesisTestConfig {
  type: 'hypothesis_test';
  testCode: string;
  assertionType: 'throws' | 'returns' | 'modifies' | 'calls';
  expectedOutcome: unknown;
}

interface ReproductionConfig {
  type: 'reproduction_attempt';
  steps: ReproductionStep[];
  environment: Partial<EnvironmentContext>;
  timeout: number;
}

interface ReproductionStep {
  action: string;
  input?: unknown;
  expectedResult?: unknown;
}

/**
 * Result of executing a test.
 */
interface TestResult {
  /** Did test complete successfully? */
  completed: boolean;

  /** If not completed, why? */
  failureReason?: string;

  /** Output from the test */
  output: TestOutput;

  /** Any errors encountered */
  errors: TestError[];

  /** Artifacts produced */
  artifacts: TestArtifact[];
}

interface TestOutput {
  /** Stdout */
  stdout: string;

  /** Stderr */
  stderr: string;

  /** Structured output (if any) */
  structured?: unknown;

  /** Exit code */
  exitCode: number;
}

interface TestError {
  type: string;
  message: string;
  stack?: string;
}

interface TestArtifact {
  name: string;
  type: 'log' | 'trace' | 'state_dump' | 'screenshot' | 'other';
  path: string;
  size: number;
}
```

### Part 4: Root Cause and Fix

```typescript
/**
 * Confirmed root cause of a bug.
 */
interface RootCause {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** The hypothesis that led to this root cause */
  confirmedHypothesisId: string;

  /** Entities identified as the source of the bug */
  sourceEntities: string[];

  /** The causal chain from root cause to symptom */
  causalChain: CausalChainLink[];

  /** Confidence in this being the true root cause */
  confidence: ConfidenceValue;

  /** Evidence supporting this root cause */
  evidence: Evidence[];

  /** Category of root cause */
  category: RootCauseCategory;
}

type RootCauseCategory =
  | 'null_reference'
  | 'type_mismatch'
  | 'race_condition'
  | 'off_by_one'
  | 'missing_validation'
  | 'incorrect_logic'
  | 'state_corruption'
  | 'configuration_error'
  | 'dependency_issue'
  | 'resource_exhaustion'
  | 'other';

interface CausalChainLink {
  /** Entity in the chain */
  entityId: string;

  /** What happened at this link */
  event: string;

  /** How it led to the next link */
  mechanism: string;

  /** Order in chain (1 = root cause, higher = closer to symptom) */
  order: number;
}

/**
 * A proposed fix for a root cause.
 */
interface ProposedFix {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Root cause this fix addresses */
  rootCauseId: string;

  /** Type of fix */
  type: FixType;

  /** Code changes required */
  changes: CodeChange[];

  /** Confidence this fix will work */
  confidence: ConfidenceValue;

  /** Risk assessment */
  risk: FixRisk;

  /** Verification status */
  verificationStatus: 'unverified' | 'verified' | 'failed';

  /** Verification evidence */
  verificationEvidence?: Evidence[];
}

type FixType =
  | 'null_check'
  | 'type_guard'
  | 'validation'
  | 'logic_correction'
  | 'state_management'
  | 'configuration'
  | 'dependency_update'
  | 'refactoring';

interface FixRisk {
  /** Overall risk level */
  level: 'low' | 'medium' | 'high';

  /** Potential side effects */
  sideEffects: string[];

  /** Regression risk areas */
  regressionRisks: string[];

  /** Recommended additional testing */
  recommendedTests: string[];
}

interface CodeChange {
  /** File to change */
  file: string;

  /** Type of change */
  type: 'modify' | 'add' | 'delete';

  /** Line range affected */
  lineRange?: { start: number; end: number };

  /** Proposed new content (for modify/add) */
  newContent?: string;

  /** Rationale for this change */
  rationale: string;
}
```

---

## 4. Executable Debugging Primitives

### Part 5: Primitive Definitions

```typescript
/**
 * Debugging technique primitives for executable debugging support.
 * Each primitive has typed inputs, outputs, and confidence semantics.
 */

/**
 * tp_git_bisect - Binary search for bug introduction
 *
 * Uses git bisect to find the exact commit that introduced a bug.
 * This is a deterministic algorithm - confidence depends only on
 * whether the test command reliably distinguishes good from bad.
 */
export const tp_git_bisect: TechniquePrimitive = {
  id: 'tp_git_bisect',
  name: 'Git Bisect',
  description: 'Binary search through git history to find the commit that introduced a bug',
  inputs: [
    { name: 'goodCommit', type: 'string', description: 'Known good commit (bug absent)' },
    { name: 'badCommit', type: 'string', description: 'Known bad commit (bug present)' },
    { name: 'testCommand', type: 'string', description: 'Command to test for bug (exit 0 = good, exit 1 = bad)' },
  ],
  outputs: [
    { name: 'firstBadCommit', type: 'string', description: 'First commit where bug appears' },
    { name: 'bisectLog', type: 'BisectStep[]', description: 'Log of bisect steps' },
    { name: 'commitDetails', type: 'CommitInfo', description: 'Details of the bad commit' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'git_bisect_is_deterministic_binary_search'
  },
  tier: 1,  // Pure execution, no LLM
};

/**
 * tp_instrument_code - Add debugging instrumentation to code
 *
 * Injects logging, state capture, or profiling at specified points.
 * The instrumentation itself is deterministic; usefulness of output
 * depends on choosing good instrumentation points (which may need LLM).
 */
export const tp_instrument_code: TechniquePrimitive = {
  id: 'tp_instrument_code',
  name: 'Code Instrumentation',
  description: 'Inject debugging instrumentation at specified code locations',
  inputs: [
    { name: 'targetFile', type: 'string', description: 'File to instrument' },
    { name: 'instrumentationPoints', type: 'InstrumentationPoint[]', description: 'Where and what to capture' },
    { name: 'outputFormat', type: 'string', description: 'Format for captured data: json|console|file' },
  ],
  outputs: [
    { name: 'instrumentedFile', type: 'string', description: 'Path to instrumented file' },
    { name: 'revertPatch', type: 'string', description: 'Patch to remove instrumentation' },
    { name: 'capturePoints', type: 'CapturePointInfo[]', description: 'Info about each capture point' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'ast_transformation_is_deterministic'
  },
  tier: 1,  // AST transformation
};

/**
 * tp_trace_execution - Trace runtime execution path
 *
 * Records the actual execution path through code, including
 * function calls, returns, and optionally state at each point.
 */
export const tp_trace_execution: TechniquePrimitive = {
  id: 'tp_trace_execution',
  name: 'Execution Trace',
  description: 'Trace the runtime execution path through code',
  inputs: [
    { name: 'entryPoint', type: 'string', description: 'Function/file to start tracing from' },
    { name: 'captureDepth', type: 'number', description: 'Maximum call depth to trace' },
    { name: 'captureState', type: 'boolean', description: 'Whether to capture variable state' },
    { name: 'triggerCondition', type: 'string', description: 'When to start tracing (optional)' },
  ],
  outputs: [
    { name: 'trace', type: 'ExecutionTraceNode[]', description: 'Tree of execution events' },
    { name: 'timing', type: 'TimingInfo', description: 'Timing information per node' },
    { name: 'stateSnapshots', type: 'StateSnapshot[]', description: 'Captured state (if requested)' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'execution_tracing_records_actual_behavior'
  },
  tier: 1,  // Runtime observation
};

/**
 * tp_inspect_state - Inspect runtime state at a point
 *
 * Captures variable values, object state, or memory at a specific
 * point in execution.
 */
export const tp_inspect_state: TechniquePrimitive = {
  id: 'tp_inspect_state',
  name: 'State Inspection',
  description: 'Inspect runtime state at a specific point in execution',
  inputs: [
    { name: 'targetEntity', type: 'string', description: 'Function/class to inspect' },
    { name: 'inspectionPoint', type: 'string', description: 'When to inspect: entry|exit|custom' },
    { name: 'variablesToCapture', type: 'string[]', description: 'Variables to capture' },
    { name: 'condition', type: 'string', description: 'Condition for when to capture (optional)' },
  ],
  outputs: [
    { name: 'stateCaptures', type: 'StateCapture[]', description: 'Captured state instances' },
    { name: 'captureCount', type: 'number', description: 'How many times state was captured' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'state_inspection_records_actual_values'
  },
  tier: 1,
};

/**
 * tp_hypothesis_test - Test a hypothesis with code execution
 *
 * Executes code to test whether a specific hypothesis about
 * behavior is correct.
 */
export const tp_hypothesis_test: TechniquePrimitive = {
  id: 'tp_hypothesis_test',
  name: 'Hypothesis Test',
  description: 'Execute code to test a specific debugging hypothesis',
  inputs: [
    { name: 'hypothesis', type: 'Hypothesis', description: 'The hypothesis to test' },
    { name: 'testCode', type: 'string', description: 'Code that tests the hypothesis' },
    { name: 'expectedOutcome', type: 'unknown', description: 'Expected result if hypothesis is true' },
  ],
  outputs: [
    { name: 'actualOutcome', type: 'unknown', description: 'Actual result of the test' },
    { name: 'conclusion', type: 'string', description: 'confirmed|refuted|inconclusive' },
    { name: 'evidence', type: 'Evidence', description: 'Evidence gathered from the test' },
  ],
  confidence: {
    type: 'derived',
    value: 0.0,  // Depends on test quality
    formula: 'test_design_quality * execution_reliability',
    inputs: []
  },
  tier: 2,  // May need LLM to design good tests
};

/**
 * tp_reproduce_bug - Attempt to reproduce a reported bug
 *
 * Executes reproduction steps to verify a bug exists and
 * establish a reliable reproduction case.
 */
export const tp_reproduce_bug: TechniquePrimitive = {
  id: 'tp_reproduce_bug',
  name: 'Bug Reproduction',
  description: 'Attempt to reproduce a reported bug using given steps',
  inputs: [
    { name: 'reproductionSteps', type: 'ReproductionStep[]', description: 'Steps to reproduce the bug' },
    { name: 'expectedSymptom', type: 'BugSymptom', description: 'What symptom should appear' },
    { name: 'environment', type: 'EnvironmentContext', description: 'Environment to reproduce in' },
    { name: 'maxAttempts', type: 'number', description: 'Maximum reproduction attempts' },
  ],
  outputs: [
    { name: 'reproduced', type: 'boolean', description: 'Whether bug was reproduced' },
    { name: 'reproductionRate', type: 'number', description: 'Rate of successful reproduction (0-1)' },
    { name: 'actualSymptoms', type: 'BugSymptom[]', description: 'Symptoms observed' },
    { name: 'reproductionLog', type: 'ReproductionAttempt[]', description: 'Log of reproduction attempts' },
  ],
  confidence: {
    type: 'derived',
    value: 0.0,  // Depends on reproduction success
    formula: 'reproduction_rate * environment_match',
    inputs: []
  },
  tier: 1,
};
```

---

## 5. Git Bisect Integration

### Part 6: Bisect Session Management

```typescript
/**
 * Git bisect session for binary searching through history.
 */
interface BisectSession {
  /** Session identifier */
  id: string;

  /** Known good commit (bug not present) */
  goodCommit: string;

  /** Known bad commit (bug present) */
  badCommit: string;

  /** Command to test if bug is present (exit 0 = good, exit 1 = bad) */
  testCommand: string;

  /** Currently checked-out commit being tested */
  currentCommit: string;

  /** History of bisect steps */
  history: BisectStep[];

  /** Result: first bad commit (null if not yet found) */
  result: string | null;

  /** Session state */
  state: BisectSessionState;

  /** When session started */
  startedAt: Date;

  /** Theoretical maximum steps (log2 of commit range) */
  maxSteps: number;
}

type BisectSessionState =
  | 'initializing'
  | 'testing'
  | 'completed'
  | 'failed'
  | 'abandoned';

interface BisectStep {
  /** Step number */
  stepNumber: number;

  /** Commit being tested */
  commit: string;

  /** Test result */
  result: 'good' | 'bad' | 'skip';

  /** Test output */
  testOutput: TestOutput;

  /** Commits remaining to test after this step */
  remainingCommits: number;

  /** When step was executed */
  executedAt: Date;

  /** Duration of this step */
  durationMs: number;
}

/**
 * Execute a complete git bisect session.
 */
async function executeBisect(
  goodCommit: string,
  badCommit: string,
  testCommand: string
): Promise<BisectSession> {
  const session: BisectSession = {
    id: generateId(),
    goodCommit,
    badCommit,
    testCommand,
    currentCommit: '',
    history: [],
    result: null,
    state: 'initializing',
    startedAt: new Date(),
    maxSteps: calculateMaxSteps(goodCommit, badCommit),
  };

  try {
    // Initialize bisect
    await exec(`git bisect start`);
    await exec(`git bisect bad ${badCommit}`);
    await exec(`git bisect good ${goodCommit}`);

    session.state = 'testing';

    // Run automated bisect
    const bisectResult = await exec(`git bisect run ${testCommand}`);

    // Parse result to find first bad commit
    session.result = parseBisectResult(bisectResult);
    session.state = 'completed';

    // Get bisect log for history
    const log = await exec(`git bisect log`);
    session.history = parseBisectLog(log);

  } catch (error) {
    session.state = 'failed';
    throw error;
  } finally {
    // Always clean up
    await exec(`git bisect reset`);
  }

  return session;
}

/**
 * Interactive bisect step (for manual testing).
 */
async function bisectStep(
  session: BisectSession,
  result: 'good' | 'bad' | 'skip'
): Promise<BisectSession> {
  const step: BisectStep = {
    stepNumber: session.history.length + 1,
    commit: session.currentCommit,
    result,
    testOutput: { stdout: '', stderr: '', exitCode: 0, structured: null },
    remainingCommits: 0,
    executedAt: new Date(),
    durationMs: 0,
  };

  // Mark the commit
  const markResult = await exec(`git bisect ${result}`);

  // Parse remaining commits and next commit
  const parsed = parseBisectOutput(markResult);
  step.remainingCommits = parsed.remaining;

  session.history.push(step);

  if (parsed.finished) {
    session.result = parsed.firstBadCommit;
    session.state = 'completed';
    await exec(`git bisect reset`);
  } else {
    session.currentCommit = parsed.nextCommit;
  }

  return session;
}
```

---

## 6. Instrumentation Support

### Part 7: Instrumentation Types

```typescript
/**
 * Types of instrumentation that can be injected into code.
 */

/**
 * Logging injection - Add console/file logging at specific points.
 */
interface LoggingInstrumentation {
  type: 'logging';

  /** What to log */
  logContent: LogContent;

  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** Output destination */
  destination: 'console' | 'file' | 'structured';

  /** File path (if destination is 'file') */
  filePath?: string;
}

type LogContent =
  | { type: 'message'; message: string }
  | { type: 'variable'; variableName: string }
  | { type: 'expression'; expression: string }
  | { type: 'arguments' }
  | { type: 'return_value' }
  | { type: 'timestamp' };

/**
 * State capture - Capture variable/object state at a point.
 */
interface StateCaptureInstrumentation {
  type: 'state_capture';

  /** Variables to capture */
  variables: string[];

  /** Depth for object serialization */
  serializationDepth: number;

  /** Storage for captures */
  storage: StateCaptureStorage;

  /** Max captures to store (circular buffer) */
  maxCaptures: number;
}

interface StateCaptureStorage {
  type: 'memory' | 'file' | 'remote';
  config: unknown;
}

/**
 * Performance profiling - Add timing measurements.
 */
interface ProfilingInstrumentation {
  type: 'profiling';

  /** What to measure */
  measure: 'duration' | 'memory' | 'cpu' | 'all';

  /** Sampling rate (1.0 = every call) */
  samplingRate: number;

  /** Aggregation for high-frequency calls */
  aggregation: 'none' | 'average' | 'percentiles';
}

/**
 * Network interception - Intercept HTTP/network requests.
 */
interface NetworkInterceptionInstrumentation {
  type: 'network_interception';

  /** What to capture */
  capture: ('request' | 'response' | 'timing' | 'headers' | 'body')[];

  /** URL patterns to intercept */
  urlPatterns: string[];

  /** Whether to allow modification */
  allowModification: boolean;
}

/**
 * Apply instrumentation to a file.
 */
async function instrumentFile(
  filePath: string,
  instrumentations: InstrumentationPoint[]
): Promise<InstrumentationResult> {
  // Read file
  const source = await readFile(filePath);

  // Parse AST
  const ast = parseAST(source);

  // Apply each instrumentation
  const patches: ASTPatch[] = [];
  for (const inst of instrumentations) {
    const patch = generateInstrumentationPatch(ast, inst);
    patches.push(patch);
  }

  // Apply patches (in reverse order to preserve line numbers)
  const instrumentedSource = applyPatches(source, patches.reverse());

  // Generate revert patch
  const revertPatch = generateRevertPatch(source, instrumentedSource);

  // Write instrumented file
  const instrumentedPath = filePath.replace(/\.ts$/, '.instrumented.ts');
  await writeFile(instrumentedPath, instrumentedSource);

  return {
    originalPath: filePath,
    instrumentedPath,
    revertPatch,
    instrumentationCount: instrumentations.length,
    confidence: {
      type: 'deterministic',
      value: 1.0,
      reason: 'ast_transformation_successful'
    }
  };
}

interface InstrumentationResult {
  originalPath: string;
  instrumentedPath: string;
  revertPatch: string;
  instrumentationCount: number;
  confidence: ConfidenceValue;
}
```

---

## 7. Debugging Compositions

### Part 8: Composition Definitions

```typescript
/**
 * Debugging workflow compositions combining multiple primitives.
 */

/**
 * tc_systematic_debug - Full debugging workflow
 *
 * Complete debugging workflow from symptom to verified fix.
 * Uses all phases: symptom collection, hypothesis generation,
 * hypothesis testing, root cause identification, fix suggestion.
 */
const tc_systematic_debug: TechniqueComposition = {
  id: 'tc_systematic_debug',
  name: 'Systematic Debugging',
  description: 'Complete debugging workflow from symptom to verified fix',
  primitives: [
    'tp_reproduce_bug',      // Phase 1: Verify symptom
    'tp_hypothesis_test',    // Phase 3: Test hypotheses
    'tp_trace_execution',    // Phase 3: Gather evidence
    'tp_inspect_state',      // Phase 3: Capture state
    'tp_git_bisect',         // Phase 3: Find regression
    'tp_instrument_code',    // Phase 3: Add instrumentation
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_reproduce_bug', 'hypothesis_generation'] },
    { type: 'parallel', inputs: ['tp_trace_execution', 'tp_inspect_state'] },
    { type: 'conditional', inputs: ['tp_git_bisect'], condition: 'is_regression' },
  ],
  patterns: ['pattern_bug_investigation', 'pattern_change_verification'],
};

/**
 * tc_bisect_and_analyze - Bisect + root cause analysis
 *
 * When a bug is known to be a regression, use bisect to find
 * the introducing commit, then analyze that commit for root cause.
 */
const tc_bisect_and_analyze: TechniqueComposition = {
  id: 'tc_bisect_and_analyze',
  name: 'Bisect and Analyze',
  description: 'Find regression commit via bisect, then analyze for root cause',
  primitives: [
    'tp_git_bisect',         // Find first bad commit
    'tp_trace_execution',    // Trace behavior change
    'tp_inspect_state',      // Compare state before/after
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_git_bisect', 'commit_analysis'] },
    { type: 'parallel', inputs: ['tp_trace_execution', 'tp_inspect_state'] },
  ],
  patterns: ['pattern_bug_investigation'],
};

/**
 * tc_instrument_and_trace - Add instrumentation, collect trace, analyze
 *
 * For bugs that are hard to reproduce or understand, add
 * instrumentation to capture detailed state and execution flow.
 */
const tc_instrument_and_trace: TechniqueComposition = {
  id: 'tc_instrument_and_trace',
  name: 'Instrument and Trace',
  description: 'Add instrumentation, collect detailed trace, analyze for root cause',
  primitives: [
    'tp_instrument_code',    // Add logging/state capture
    'tp_reproduce_bug',      // Trigger the bug with instrumentation
    'tp_trace_execution',    // Collect execution trace
    'tp_inspect_state',      // Analyze captured state
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_instrument_code', 'tp_reproduce_bug'] },
    { type: 'parallel', inputs: ['tp_trace_execution', 'tp_inspect_state'] },
  ],
  patterns: ['pattern_bug_investigation', 'pattern_performance_investigation'],
};

/**
 * tc_hypothesis_driven_debug - Hypothesis-first debugging
 *
 * Generate hypotheses first, then systematically test each
 * one using the most efficient test for that hypothesis.
 */
const tc_hypothesis_driven_debug: TechniqueComposition = {
  id: 'tc_hypothesis_driven_debug',
  name: 'Hypothesis-Driven Debugging',
  description: 'Generate and systematically test debugging hypotheses',
  primitives: [
    'tp_hypothesis_test',    // Core hypothesis testing
    'tp_trace_execution',    // Evidence gathering
    'tp_inspect_state',      // State verification
    'tp_git_bisect',         // For regression hypotheses
  ],
  operators: [
    { type: 'loop', inputs: ['tp_hypothesis_test'], condition: 'hypotheses_remaining' },
    { type: 'conditional', inputs: ['tp_git_bisect'], condition: 'hypothesis_is_regression' },
    { type: 'parallel', inputs: ['tp_trace_execution', 'tp_inspect_state'] },
  ],
  patterns: ['pattern_bug_investigation'],
};
```

---

## 8. Integration Points

### Integration with Track C (Causal Reasoning)

```typescript
/**
 * Integration with track-c-causal-reasoning.md for root cause analysis.
 *
 * Debugging benefits from causal reasoning by:
 * 1. Using causal models to generate better hypotheses
 * 2. Tracing causal chains from symptom to root cause
 * 3. Predicting side effects of proposed fixes
 */
interface CausalDebuggingIntegration {
  /**
   * Use causal model to generate debugging hypotheses.
   * More likely causes (stronger causal links to symptom) get higher prior.
   */
  generateCausalHypotheses(
    symptom: BugSymptom,
    model: CausalModel
  ): Promise<Hypothesis[]>;

  /**
   * Trace causal chain from confirmed root cause to symptom.
   * Produces the explanation of HOW the bug manifests.
   */
  traceCausalChain(
    rootCause: RootCause,
    symptom: BugSymptom,
    model: CausalModel
  ): Promise<CausalChainLink[]>;

  /**
   * Predict effects of a proposed fix using causal model.
   * Identifies potential side effects and regressions.
   */
  predictFixEffects(
    fix: ProposedFix,
    model: CausalModel
  ): Promise<CausalEffect[]>;
}

/**
 * Generate hypotheses using causal model.
 */
async function generateCausalHypotheses(
  symptom: BugSymptom,
  model: CausalModel
): Promise<Hypothesis[]> {
  // Find all potential causes of symptom in causal model
  const symptomVar = symptomToVariable(symptom);
  const ancestors = getAncestors(model, symptomVar);

  // Score each ancestor by causal strength to symptom
  const hypotheses: Hypothesis[] = [];
  for (const ancestor of ancestors) {
    const causalStrength = computeCausalStrength(model, ancestor, symptomVar);

    hypotheses.push({
      id: generateId(),
      description: `Bug caused by ${ancestor}: ${describeEntity(ancestor)}`,
      confidence: {
        type: 'absent',
        reason: 'uncalibrated'  // Will be updated through testing
      },
      priorConfidence: causalStrength,  // Use causal strength as prior
      testStrategy: selectTestStrategy(ancestor, symptom),
      evidence: [],
      status: 'pending',
      suspectedEntities: [ancestor],
      relatedHypotheses: [],
    });
  }

  // Sort by prior confidence
  return hypotheses.sort((a, b) =>
    getNumericValue(b.priorConfidence) - getNumericValue(a.priorConfidence)
  );
}
```

### Integration with Track E (Domain Primitives)

```typescript
/**
 * Integration with track-e-domain.md for domain-specific debugging.
 *
 * Performance debugging uses Track E primitives:
 * - tp_timing_bound for latency analysis
 * - tp_metric_trace for performance metric tracing
 * - tp_scale_pattern for distributed debugging
 */
interface DomainDebuggingIntegration {
  /**
   * Performance debugging using domain primitives.
   */
  debugPerformance(
    symptom: BugSymptom & { type: 'performance_degradation' },
    domain: DomainComposition
  ): Promise<DebuggingSession>;

  /**
   * Domain-specific instrumentation points.
   * Different domains have different critical points to instrument.
   */
  getDomainInstrumentationPoints(
    domain: DomainComposition,
    symptom: BugSymptom
  ): Promise<InstrumentationPoint[]>;
}

/**
 * Performance debugging composition using domain primitives.
 */
const tc_performance_debug: TechniqueComposition = {
  id: 'tc_performance_debug',
  name: 'Performance Debugging',
  description: 'Debug performance issues using profiling and timing analysis',
  primitives: [
    'tp_timing_bound',       // From track-e: timing analysis
    'tp_metric_trace',       // From track-e: metric tracing
    'tp_instrument_code',    // Add profiling instrumentation
    'tp_trace_execution',    // Collect execution trace with timing
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_timing_bound', 'tp_metric_trace'] },
    { type: 'sequence', inputs: ['tp_instrument_code', 'tp_trace_execution'] },
  ],
  patterns: ['pattern_performance_investigation'],
};
```

### Integration with Evidence Ledger

```typescript
/**
 * Integration with LiBrainian's evidence ledger.
 *
 * All debugging evidence is recorded in the ledger for:
 * 1. Future reference (similar bugs)
 * 2. Learning (improving hypothesis generation)
 * 3. Audit trail (why did we conclude this root cause?)
 */
interface EvidenceLedgerIntegration {
  /**
   * Record debugging session to evidence ledger.
   */
  recordDebuggingSession(
    session: DebuggingSession
  ): Promise<EvidenceEntry>;

  /**
   * Query ledger for similar past debugging sessions.
   * Useful for hypothesis generation and fix suggestions.
   */
  querySimilarDebuggingSessions(
    symptom: BugSymptom
  ): Promise<DebuggingSession[]>;

  /**
   * Learn from debugging outcomes to improve future sessions.
   */
  learnFromDebuggingOutcome(
    session: DebuggingSession,
    outcome: DebuggingOutcome
  ): Promise<void>;
}

interface DebuggingOutcome {
  /** Was the fix successful? */
  fixSuccessful: boolean;

  /** Did the fix introduce regressions? */
  regressionsIntroduced: boolean;

  /** Time from symptom to fix */
  timeToFix: number;

  /** Hypotheses tested before finding root cause */
  hypothesesTested: number;

  /** Human feedback on the process */
  humanFeedback?: string;
}
```

---

## 9. Implementation Roadmap

### Phase 1: Core Types (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/types.ts

// Deliverables:
// - DebuggingSession, Hypothesis, HypothesisTest types
// - BugSymptom, RootCause, ProposedFix types
// - TestStrategy, Evidence types
// - All supporting interfaces
```

**Estimated effort**: 1 day

### Phase 2: Debugging Session Management (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/session.ts

// Deliverables:
// - createDebuggingSession()
// - addHypothesis(), updateHypothesis()
// - recordTestResult()
// - confirmRootCause()
// - proposeFix()
```

**Estimated effort**: 1.5 days

### Phase 3: Git Bisect Integration (~150 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/bisect.ts

// Deliverables:
// - executeBisect() - automated bisect
// - bisectStep() - interactive bisect
// - parseBisectOutput()
// - BisectSession management
```

**Estimated effort**: 1 day

### Phase 4: Code Instrumentation (~250 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/instrumentation.ts

// Deliverables:
// - instrumentFile() - apply instrumentation
// - generateInstrumentationPatch() - AST transformation
// - revertInstrumentation()
// - Logging, state capture, profiling instrumentation types
```

**Estimated effort**: 2 days

### Phase 5: Execution Tracing (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/trace.ts

// Deliverables:
// - traceExecution() - capture execution trace
// - inspectState() - capture state at point
// - parseTraceOutput()
// - StateSnapshot management
```

**Estimated effort**: 1.5 days

### Phase 6: Hypothesis Management (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/hypothesis.ts

// Deliverables:
// - generateHypotheses() - from symptom + context
// - testHypothesis() - execute test strategy
// - updateHypothesisProbabilities() - Bayesian update
// - rankHypotheses()
```

**Estimated effort**: 1.5 days

### Phase 7: Primitives and Compositions (~150 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/primitives.ts
// - src/LiBrainian/api/debugging/compositions.ts

// Deliverables:
// - 6 debugging primitives registered
// - 4 debugging compositions registered
// - Integration with technique catalog
```

**Estimated effort**: 1 day

### Phase 8: Integration (~150 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/integration.ts

// Deliverables:
// - Track C integration (causal hypotheses)
// - Track E integration (performance debugging)
// - Evidence ledger integration
```

**Estimated effort**: 1 day

### Phase 9: Tests (~300 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/debugging/__tests__/session.test.ts
// - src/LiBrainian/api/debugging/__tests__/bisect.test.ts
// - src/LiBrainian/api/debugging/__tests__/instrumentation.test.ts
// - src/LiBrainian/api/debugging/__tests__/hypothesis.test.ts

// Deliverables:
// - Unit tests for all modules
// - Integration tests with mock git repo
// - Example debugging scenarios
```

**Estimated effort**: 2 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types | 200 | 1 |
| Session Management | 200 | 1.5 |
| Git Bisect | 150 | 1 |
| Instrumentation | 250 | 2 |
| Execution Tracing | 200 | 1.5 |
| Hypothesis Management | 200 | 1.5 |
| Primitives/Compositions | 150 | 1 |
| Integration | 150 | 1 |
| Tests | 300 | 2 |
| **Total** | **~1,800** | **~12.5** |

---

## 10. Acceptance Criteria

### Core Functionality

- [ ] DebuggingSession tracks full debugging lifecycle
- [ ] Hypothesis can be generated from symptoms
- [ ] HypothesisTest records test execution and conclusions
- [ ] RootCause links to confirming evidence
- [ ] All confidence values use ConfidenceValue type (no raw numbers)

### Executable Debugging

- [ ] `tp_git_bisect` can find regression commit
- [ ] `tp_instrument_code` can inject logging/state capture
- [ ] `tp_trace_execution` records actual execution path
- [ ] `tp_inspect_state` captures variable values
- [ ] `tp_hypothesis_test` executes hypothesis tests
- [ ] `tp_reproduce_bug` verifies bug reproduction

### Workflow Support

- [ ] `tc_systematic_debug` orchestrates full debugging workflow
- [ ] `tc_bisect_and_analyze` handles regression debugging
- [ ] `tc_instrument_and_trace` handles hard-to-reproduce bugs
- [ ] Hypothesis prioritization uses Bayesian updates

### Integration

- [ ] Track C integration provides causal hypotheses
- [ ] Track E integration supports performance debugging
- [ ] Evidence ledger records debugging sessions
- [ ] Past debugging sessions inform future hypothesis generation

---

## 11. Evidence Commands

```bash
# Run debugging tests
cd packages/LiBrainian && npx vitest run src/api/debugging/__tests__/

# Verify exports
node -e "import('LiBrainian').then(m => console.log(Object.keys(m).filter(k => k.includes('Debug'))))"

# Start debugging session (when implemented)
cd packages/LiBrainian && npx tsx src/cli/index.ts debug --symptom "TypeError: Cannot read property 'user' of undefined"

# Run git bisect
cd packages/LiBrainian && npx tsx src/cli/index.ts debug bisect --good abc123 --bad def456 --test "npm test"

# Instrument code for debugging
cd packages/LiBrainian && npx tsx src/cli/index.ts debug instrument --file src/auth.ts --points "line:42,line:67"

# Test a hypothesis
cd packages/LiBrainian && npx tsx src/cli/index.ts debug hypothesis --id h123 --test "unit_test"

# Check implementation status
ls -la packages/LiBrainian/src/api/debugging/
```

---

## 12. References

- Zeller, A. (2009). *Why Programs Fail: A Guide to Systematic Debugging*. Morgan Kaufmann.
- Parnin, C., & Orso, A. (2011). Are automated debugging techniques actually helping programmers? *ISSTA '11*.
- Ko, A. J., & Myers, B. A. (2008). Debugging reinvented: Asking and answering why and why not questions about program behavior. *ICSE '08*.
- Git Documentation. (2024). git-bisect - Use binary search to find the commit that introduced a bug.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification addressing UC4 from use-case-targets.md |
