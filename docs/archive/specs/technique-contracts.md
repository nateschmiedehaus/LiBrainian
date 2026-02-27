# Technique Contracts Specification

> **Source**: Addresses Problem 17 from THEORETICAL_CRITIQUE.md: "Technique Primitives as Prose"
>
> **Problem Statement**: 64 primitives have prose `actions`, not executable contracts
>
> **Purpose**: Transform technique primitives from documentation into executable specifications with machine-checkable contracts

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [Problem Statement](#1-problem-statement) | Why prose actions are insufficient |
| [Contract Structure](#2-contract-structure) | The TechniqueContract interface |
| [Condition Types](#3-condition-types) | Machine-checkable condition definitions |
| [Verification Strategies](#4-verification-strategies) | How contracts are verified |
| [Example Contract](#5-example-contract) | Full contract for `tp_clarify_goal` |
| [Contract Validation Utilities](#6-contract-validation-utilities) | Runtime validation functions |
| [Integration with Execution Engine](#7-integration-with-execution-engine) | Execution-time contract checking |
| [Migration Path](#8-migration-path) | Incremental adoption strategy |
| [Implementation Roadmap](#9-implementation-roadmap) | Phased delivery plan |

---

## 1. Problem Statement

### Current State: Primitives as Documentation

The current technique primitives define `actions` as prose strings:

```typescript
// From technique_library.ts
createTechniquePrimitive({
  id: 'tp_clarify_goal',
  name: 'Clarify goal and scope',
  intent: 'Turn a vague request into an explicit goal and scope.',
  triggers: ['ambiguous request', 'conflicting requirements', 'missing success criteria'],
  inputsRequired: ['initial request', 'constraints', 'stakeholders'],
  actions: ['Ask clarifying questions', 'Define success criteria', 'Confirm scope and exclusions'],
  failureModes: ['Assumes unstated requirements', 'Overly broad scope'],
  outputs: ['goal statement', 'scope boundaries', 'success criteria'],
});
```

### Why This Is Insufficient

| Aspect | Prose Actions | Executable Contracts |
|--------|---------------|---------------------|
| **Verifiability** | Cannot verify execution | Machine-checkable pre/postconditions |
| **Input validation** | "initial request" - what type? required? | JSON Schema with types, constraints |
| **Output validation** | "goal statement" - what structure? | Typed output schema |
| **Composition** | No way to ensure compatibility | Contract compatibility checking |
| **Testing** | Cannot generate tests | Auto-generated property tests |
| **LLM guidance** | Vague instructions | Structured constraints |

### The Core Issue

Prose actions are **documentation**, not **specifications**. An agent reading "Ask clarifying questions" has no machine-checkable way to:
- Know when the action has been completed
- Verify the output meets requirements
- Detect contract violations
- Compose primitives safely

---

## 2. Contract Structure

### TechniqueContract Interface

```typescript
import type { ConfidenceValue } from '../epistemics/confidence.js';

/**
 * JSON Schema subset for contract definitions.
 * Uses JSON Schema draft-07 semantics.
 */
export interface JSONSchema {
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | ('string' | 'number' | 'boolean' | 'object' | 'array' | 'null')[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'date-time' | 'uri' | 'email' | 'uuid';
  description?: string;
  default?: unknown;
}

/**
 * A machine-checkable condition for contracts.
 */
export interface ContractCondition {
  /** Unique identifier for this condition */
  id: string;

  /** Human-readable description */
  description: string;

  /** The type of check to perform */
  checkType: ContractCheckType;

  /** The expression or configuration for the check */
  check: ContractCheck;

  /** How critical is this condition? */
  severity: 'error' | 'warning' | 'info';

  /** Can this condition be verified automatically? */
  automatable: boolean;

  /** If not automatable, what verification strategy to use? */
  fallbackStrategy?: 'llm_assisted' | 'human_review' | 'skip';
}

export type ContractCheckType =
  | 'type_check'           // Input/output type validation
  | 'value_constraint'     // Min/max, enum, pattern
  | 'state_assertion'      // Pre/postcondition on state
  | 'structural_check'     // Schema compliance
  | 'semantic_check'       // LLM-verified semantic property
  | 'temporal_check'       // Ordering, timing constraints
  | 'evidence_check';      // Required evidence exists

export type ContractCheck =
  | TypeCheck
  | ValueConstraint
  | StateAssertion
  | StructuralCheck
  | SemanticCheck
  | TemporalCheck
  | EvidenceCheck;

/**
 * Example showing input/output pairs for contract validation.
 */
export interface ContractExample {
  /** Descriptive name for this example */
  name: string;

  /** Example input satisfying inputSchema */
  input: Record<string, unknown>;

  /** Expected output satisfying outputSchema */
  expectedOutput: Record<string, unknown>;

  /** Why this example is useful */
  rationale: string;

  /** Is this a positive or negative example? */
  kind: 'positive' | 'negative' | 'edge_case';
}

/**
 * Strategy for verifying contract compliance.
 */
export interface VerificationStrategy {
  /** Primary verification method */
  primary: 'static_analysis' | 'runtime_validation' | 'llm_assisted' | 'hybrid';

  /** Fallback if primary fails */
  fallback?: 'llm_assisted' | 'human_review' | 'skip';

  /** Confidence threshold for LLM verification */
  llmConfidenceThreshold?: number;

  /** Timeout for verification in milliseconds */
  timeoutMs?: number;

  /** Should verification block execution? */
  blocking: boolean;
}

/**
 * Complete contract for a technique primitive.
 * Transforms primitives from documentation to executable specifications.
 */
export interface TechniqueContract {
  /** Primitive this contract applies to */
  primitiveId: string;

  /** Contract version for evolution tracking */
  version: string;

  /** JSON Schema for required inputs */
  inputSchema: JSONSchema;

  /** JSON Schema for expected outputs */
  outputSchema: JSONSchema;

  /** Conditions that must hold BEFORE execution */
  preconditions: ContractCondition[];

  /** Conditions that must hold AFTER execution */
  postconditions: ContractCondition[];

  /** Conditions that must hold throughout execution */
  invariants: ContractCondition[];

  /** How to verify this contract */
  verification: VerificationStrategy;

  /** Example inputs/outputs for validation and testing */
  examples: ContractExample[];

  /** Contract creation timestamp */
  createdAt: string;

  /** Last modification timestamp */
  updatedAt: string;

  /** Confidence in contract completeness */
  confidence: ConfidenceValue;
}
```

---

## 3. Condition Types

### Type Checks

Verify that inputs and outputs have the correct types.

```typescript
export interface TypeCheck {
  kind: 'type_check';

  /** Path to the field being checked (dot notation) */
  path: string;

  /** Expected type(s) */
  expectedType: JSONSchema['type'];

  /** Allow null values? */
  nullable?: boolean;

  /** Allow undefined values? */
  optional?: boolean;
}

// Example
const goalStatementTypeCheck: ContractCondition = {
  id: 'post_goal_statement_type',
  description: 'Goal statement must be a non-empty string',
  checkType: 'type_check',
  check: {
    kind: 'type_check',
    path: 'output.goalStatement',
    expectedType: 'string',
    nullable: false,
    optional: false,
  },
  severity: 'error',
  automatable: true,
};
```

### Value Constraints

Enforce value bounds, patterns, and enumerations.

```typescript
export interface ValueConstraint {
  kind: 'value_constraint';

  /** Path to the field being checked */
  path: string;

  /** Constraint type */
  constraint:
    | { type: 'minimum'; value: number }
    | { type: 'maximum'; value: number }
    | { type: 'range'; min: number; max: number }
    | { type: 'minLength'; value: number }
    | { type: 'maxLength'; value: number }
    | { type: 'pattern'; regex: string }
    | { type: 'enum'; values: unknown[] }
    | { type: 'const'; value: unknown };
}

// Example
const scopeBoundariesConstraint: ContractCondition = {
  id: 'post_scope_boundaries_count',
  description: 'Scope boundaries must have at least one item',
  checkType: 'value_constraint',
  check: {
    kind: 'value_constraint',
    path: 'output.scopeBoundaries.length',
    constraint: { type: 'minimum', value: 1 },
  },
  severity: 'error',
  automatable: true,
};
```

### State Assertions

Check conditions on execution state before/after primitive runs.

```typescript
export interface StateAssertion {
  kind: 'state_assertion';

  /** What state aspect to check */
  stateAspect: 'input' | 'output' | 'context' | 'execution';

  /** The assertion expression (simplified predicate language) */
  assertion: string;

  /** Variables available for assertion */
  variables: Array<{
    name: string;
    path: string;
    type: JSONSchema['type'];
  }>;
}

// Example
const inputRequestExistsAssertion: ContractCondition = {
  id: 'pre_request_exists',
  description: 'Initial request must be provided',
  checkType: 'state_assertion',
  check: {
    kind: 'state_assertion',
    stateAspect: 'input',
    assertion: 'initialRequest != null && initialRequest.length > 0',
    variables: [
      { name: 'initialRequest', path: 'input.initialRequest', type: 'string' },
    ],
  },
  severity: 'error',
  automatable: true,
};
```

### Structural Checks

Validate complete objects against JSON Schema.

```typescript
export interface StructuralCheck {
  kind: 'structural_check';

  /** What to validate */
  target: 'input' | 'output' | 'context';

  /** Schema to validate against */
  schema: JSONSchema;

  /** Additional validation options */
  options?: {
    /** Allow additional properties not in schema? */
    allowAdditional?: boolean;
    /** Coerce types where possible? */
    coerceTypes?: boolean;
  };
}
```

### Semantic Checks

LLM-assisted verification of semantic properties that cannot be checked structurally.

```typescript
export interface SemanticCheck {
  kind: 'semantic_check';

  /** Natural language description of what to verify */
  requirement: string;

  /** Specific questions for the LLM to answer */
  verificationQuestions: string[];

  /** Expected answers (for binary questions) */
  expectedAnswers?: ('yes' | 'no')[];

  /** Minimum confidence for acceptance */
  confidenceThreshold: number;

  /** Context to provide to LLM */
  contextPaths: string[];
}

// Example
const goalClarityCheck: ContractCondition = {
  id: 'post_goal_clarity',
  description: 'Goal statement must be clear and actionable',
  checkType: 'semantic_check',
  check: {
    kind: 'semantic_check',
    requirement: 'The goal statement should be specific, measurable, and actionable',
    verificationQuestions: [
      'Is the goal statement specific enough to act on?',
      'Does the goal statement have implicit success criteria?',
      'Could two people read this and agree on what "done" looks like?',
    ],
    expectedAnswers: ['yes', 'yes', 'yes'],
    confidenceThreshold: 0.7,
    contextPaths: ['input.initialRequest', 'output.goalStatement'],
  },
  severity: 'warning',
  automatable: true,
  fallbackStrategy: 'human_review',
};
```

### Temporal Checks

Verify ordering and timing constraints.

```typescript
export interface TemporalCheck {
  kind: 'temporal_check';

  /** Type of temporal constraint */
  constraint:
    | { type: 'before'; event: string }
    | { type: 'after'; event: string }
    | { type: 'within'; durationMs: number }
    | { type: 'ordered'; sequence: string[] };
}
```

### Evidence Checks

Verify that required evidence exists.

```typescript
export interface EvidenceCheck {
  kind: 'evidence_check';

  /** Type of evidence required */
  evidenceType: 'trace' | 'artifact' | 'assertion' | 'measurement';

  /** Description of what evidence is needed */
  requirement: string;

  /** Path where evidence should be found */
  evidencePath?: string;
}

// Example
const clarificationEvidenceCheck: ContractCondition = {
  id: 'post_clarification_evidence',
  description: 'Evidence of clarifying questions asked must exist',
  checkType: 'evidence_check',
  check: {
    kind: 'evidence_check',
    evidenceType: 'trace',
    requirement: 'At least one clarifying question was asked or documented',
    evidencePath: 'output.clarificationTrace',
  },
  severity: 'warning',
  automatable: false,
  fallbackStrategy: 'llm_assisted',
};
```

---

## 4. Verification Strategies

### Static Analysis

Checks that can be performed without execution, using type information and schema validation.

```typescript
interface StaticAnalysisStrategy {
  type: 'static_analysis';

  /** Schema validation (Ajv, Zod, etc.) */
  schemaValidation: boolean;

  /** TypeScript type checking */
  typeChecking: boolean;

  /** Pattern matching on code */
  patternMatching: boolean;
}
```

**Applicable to**:
- Type checks
- Value constraints (static values)
- Structural checks
- Some state assertions (pure predicates)

### Runtime Validation

Checks performed during or after execution.

```typescript
interface RuntimeValidationStrategy {
  type: 'runtime_validation';

  /** Check inputs before execution */
  validateInputs: boolean;

  /** Check outputs after execution */
  validateOutputs: boolean;

  /** Check invariants during execution */
  validateInvariants: boolean;

  /** How to handle failures */
  onFailure: 'throw' | 'log' | 'emit_event';
}
```

**Applicable to**:
- All type checks
- All value constraints
- All structural checks
- State assertions
- Evidence checks (existence)

### LLM-Assisted Verification

Verification requiring semantic understanding.

```typescript
interface LlmAssistedStrategy {
  type: 'llm_assisted';

  /** Provider to use for verification */
  provider?: string;

  /** Model to use */
  model?: string;

  /** Confidence threshold for acceptance */
  confidenceThreshold: number;

  /** Maximum attempts */
  maxAttempts: number;

  /** Whether to cache verification results */
  cacheResults: boolean;

  /** Prompt template for verification */
  promptTemplate?: string;
}
```

**Applicable to**:
- Semantic checks
- Complex state assertions
- Evidence quality assessment

### Hybrid Strategy

Combines multiple strategies for comprehensive verification.

```typescript
interface HybridVerificationStrategy {
  type: 'hybrid';

  strategies: Array<{
    strategy: 'static_analysis' | 'runtime_validation' | 'llm_assisted';
    conditions: string[];  // Condition IDs handled by this strategy
    priority: number;
  }>;

  /** How to combine results */
  aggregation: 'all_must_pass' | 'majority' | 'weighted';
}
```

---

## 5. Example Contract

### Full Contract for `tp_clarify_goal`

```typescript
import type { TechniqueContract, ContractCondition } from './types.js';

export const TP_CLARIFY_GOAL_CONTRACT: TechniqueContract = {
  primitiveId: 'tp_clarify_goal',
  version: '1.0.0',

  inputSchema: {
    type: 'object',
    properties: {
      initialRequest: {
        type: 'string',
        description: 'The original, possibly vague, user request',
        minLength: 1,
      },
      constraints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['hard', 'soft'] },
          },
          required: ['name'],
        },
        description: 'Known constraints that bound the solution',
      },
      stakeholders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            concerns: { type: 'array', items: { type: 'string' } },
          },
          required: ['role'],
        },
        description: 'Stakeholders with interests in the outcome',
      },
      context: {
        type: 'object',
        additionalProperties: true,
        description: 'Additional context for clarification',
      },
    },
    required: ['initialRequest'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      goalStatement: {
        type: 'string',
        description: 'Clear, specific statement of what success looks like',
        minLength: 10,
      },
      scopeBoundaries: {
        type: 'object',
        properties: {
          included: {
            type: 'array',
            items: { type: 'string' },
            description: 'What is explicitly in scope',
          },
          excluded: {
            type: 'array',
            items: { type: 'string' },
            description: 'What is explicitly out of scope',
          },
        },
        required: ['included', 'excluded'],
      },
      successCriteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterion: { type: 'string' },
            measurable: { type: 'boolean' },
            verificationMethod: { type: 'string' },
          },
          required: ['criterion'],
        },
        description: 'Criteria for determining success',
        minItems: 1,
      },
      clarificationTrace: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
            source: { type: 'string', enum: ['user', 'inferred', 'default'] },
          },
          required: ['question'],
        },
        description: 'Record of clarifying questions and answers',
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Assumptions made during clarification',
      },
      confidence: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          value: { type: 'number' },
          reason: { type: 'string' },
        },
        description: 'Confidence in the clarified goal',
      },
    },
    required: ['goalStatement', 'scopeBoundaries', 'successCriteria'],
  },

  preconditions: [
    {
      id: 'pre_request_exists',
      description: 'Initial request must be provided and non-empty',
      checkType: 'state_assertion',
      check: {
        kind: 'state_assertion',
        stateAspect: 'input',
        assertion: 'initialRequest != null && initialRequest.trim().length > 0',
        variables: [
          { name: 'initialRequest', path: 'input.initialRequest', type: 'string' },
        ],
      },
      severity: 'error',
      automatable: true,
    },
    {
      id: 'pre_request_not_already_clear',
      description: 'Request should have some ambiguity to clarify',
      checkType: 'semantic_check',
      check: {
        kind: 'semantic_check',
        requirement: 'The request should have at least one aspect that needs clarification',
        verificationQuestions: [
          'Does this request have any ambiguous terms?',
          'Are there multiple possible interpretations?',
          'Is the scope clearly defined?',
        ],
        confidenceThreshold: 0.5,
        contextPaths: ['input.initialRequest'],
      },
      severity: 'info',
      automatable: true,
      fallbackStrategy: 'skip',
    },
  ],

  postconditions: [
    {
      id: 'post_goal_exists',
      description: 'A goal statement must be produced',
      checkType: 'type_check',
      check: {
        kind: 'type_check',
        path: 'output.goalStatement',
        expectedType: 'string',
        nullable: false,
        optional: false,
      },
      severity: 'error',
      automatable: true,
    },
    {
      id: 'post_goal_length',
      description: 'Goal statement must be substantive (at least 10 characters)',
      checkType: 'value_constraint',
      check: {
        kind: 'value_constraint',
        path: 'output.goalStatement.length',
        constraint: { type: 'minimum', value: 10 },
      },
      severity: 'error',
      automatable: true,
    },
    {
      id: 'post_scope_defined',
      description: 'Both included and excluded scope must be defined',
      checkType: 'structural_check',
      check: {
        kind: 'structural_check',
        target: 'output',
        schema: {
          type: 'object',
          properties: {
            scopeBoundaries: {
              type: 'object',
              properties: {
                included: { type: 'array', minItems: 1 },
                excluded: { type: 'array' },
              },
              required: ['included', 'excluded'],
            },
          },
          required: ['scopeBoundaries'],
        },
      },
      severity: 'error',
      automatable: true,
    },
    {
      id: 'post_success_criteria_exist',
      description: 'At least one success criterion must be defined',
      checkType: 'value_constraint',
      check: {
        kind: 'value_constraint',
        path: 'output.successCriteria.length',
        constraint: { type: 'minimum', value: 1 },
      },
      severity: 'error',
      automatable: true,
    },
    {
      id: 'post_goal_clarity',
      description: 'Goal statement must be clear and actionable',
      checkType: 'semantic_check',
      check: {
        kind: 'semantic_check',
        requirement: 'The goal statement should be specific enough that two people would agree on what "done" looks like',
        verificationQuestions: [
          'Is the goal statement specific and unambiguous?',
          'Does the goal statement have implicit success criteria?',
          'Could you verify completion of this goal objectively?',
        ],
        expectedAnswers: ['yes', 'yes', 'yes'],
        confidenceThreshold: 0.7,
        contextPaths: ['input.initialRequest', 'output.goalStatement', 'output.successCriteria'],
      },
      severity: 'warning',
      automatable: true,
      fallbackStrategy: 'human_review',
    },
    {
      id: 'post_no_assumed_unstated',
      description: 'Should not assume unstated requirements (failure mode)',
      checkType: 'semantic_check',
      check: {
        kind: 'semantic_check',
        requirement: 'The clarified goal should not introduce requirements not implicit in the original request',
        verificationQuestions: [
          'Does the goal introduce requirements not mentioned or implied in the original request?',
          'Are all additions justified by the clarification trace?',
        ],
        expectedAnswers: ['no', 'yes'],
        confidenceThreshold: 0.6,
        contextPaths: ['input.initialRequest', 'output.goalStatement', 'output.clarificationTrace', 'output.assumptions'],
      },
      severity: 'warning',
      automatable: true,
      fallbackStrategy: 'llm_assisted',
    },
  ],

  invariants: [
    {
      id: 'inv_no_scope_creep',
      description: 'Clarification should not expand scope beyond original intent',
      checkType: 'semantic_check',
      check: {
        kind: 'semantic_check',
        requirement: 'The clarified scope should be a refinement of the original request, not an expansion',
        verificationQuestions: [
          'Does the clarified scope stay within the bounds of the original request?',
        ],
        expectedAnswers: ['yes'],
        confidenceThreshold: 0.7,
        contextPaths: ['input.initialRequest', 'output.scopeBoundaries'],
      },
      severity: 'warning',
      automatable: true,
      fallbackStrategy: 'human_review',
    },
  ],

  verification: {
    primary: 'hybrid',
    fallback: 'human_review',
    llmConfidenceThreshold: 0.7,
    timeoutMs: 30000,
    blocking: false,
  },

  examples: [
    {
      name: 'Vague feature request',
      input: {
        initialRequest: 'Add dark mode to the app',
        constraints: [
          { name: 'timeline', description: '2 weeks', type: 'soft' },
        ],
        stakeholders: [
          { role: 'user', concerns: ['eye strain', 'battery life'] },
        ],
      },
      expectedOutput: {
        goalStatement: 'Implement a user-togglable dark color scheme for all screens that reduces eye strain in low-light conditions and persists across sessions',
        scopeBoundaries: {
          included: [
            'All existing screens and components',
            'User preference persistence',
            'System preference detection',
          ],
          excluded: [
            'Custom theme colors beyond dark/light',
            'Scheduling/automatic switching',
            'Per-screen theme settings',
          ],
        },
        successCriteria: [
          {
            criterion: 'All text has sufficient contrast ratio (WCAG AA)',
            measurable: true,
            verificationMethod: 'Automated contrast checker',
          },
          {
            criterion: 'Theme persists after app restart',
            measurable: true,
            verificationMethod: 'Manual test',
          },
          {
            criterion: 'Toggle is discoverable in settings',
            measurable: false,
            verificationMethod: 'User testing',
          },
        ],
        clarificationTrace: [
          {
            question: 'Should dark mode follow system settings?',
            answer: 'Yes, with manual override option',
            source: 'inferred',
          },
          {
            question: 'Which screens are in scope?',
            answer: 'All existing screens',
            source: 'default',
          },
        ],
        assumptions: [
          'Standard dark theme (no custom colors)',
          'Two-week timeline is flexible',
        ],
      },
      rationale: 'Demonstrates clarifying a common but vague request with reasonable defaults',
      kind: 'positive',
    },
    {
      name: 'Already clear request',
      input: {
        initialRequest: 'Fix bug #1234: Login button unresponsive on iOS 17.2',
        constraints: [],
        stakeholders: [],
      },
      expectedOutput: {
        goalStatement: 'Fix the login button click handler to respond correctly on iOS 17.2 Safari WebKit',
        scopeBoundaries: {
          included: ['Login button click handler', 'iOS 17.2 Safari testing'],
          excluded: ['Other browsers', 'Other iOS versions', 'Other buttons'],
        },
        successCriteria: [
          {
            criterion: 'Login button responds to tap on iOS 17.2',
            measurable: true,
            verificationMethod: 'Device testing',
          },
        ],
        clarificationTrace: [],
        assumptions: ['Bug is reproducible on iOS 17.2'],
      },
      rationale: 'Shows that already-clear requests still benefit from explicit scope and criteria',
      kind: 'edge_case',
    },
    {
      name: 'Overly broad scope (negative example)',
      input: {
        initialRequest: 'Improve the app',
        constraints: [],
        stakeholders: [],
      },
      expectedOutput: {
        goalStatement: 'Improve the app',
        scopeBoundaries: {
          included: ['Everything'],
          excluded: [],
        },
        successCriteria: [],
      },
      rationale: 'This output would FAIL validation - goal is too vague, no success criteria',
      kind: 'negative',
    },
  ],

  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  confidence: {
    type: 'bounded',
    low: 0.6,
    high: 0.9,
    basis: 'theoretical',
    citation: 'Contract completeness estimated based on coverage of documented failure modes',
  },
};
```

---

## 6. Contract Validation Utilities

### Core Validation Functions

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * Validates input against a contract's input schema.
 */
export function validateInput(
  contract: TechniqueContract,
  input: unknown
): ValidationResult {
  const validate = ajv.compile(contract.inputSchema);
  const valid = validate(input);

  return {
    valid,
    errors: valid ? [] : formatAjvErrors(validate.errors),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Validates output against a contract's output schema.
 */
export function validateOutput(
  contract: TechniqueContract,
  output: unknown
): ValidationResult {
  const validate = ajv.compile(contract.outputSchema);
  const valid = validate(output);

  return {
    valid,
    errors: valid ? [] : formatAjvErrors(validate.errors),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Checks all preconditions against the current state.
 */
export async function checkPreconditions(
  contract: TechniqueContract,
  context: ExecutionContext
): Promise<ConditionCheckResult[]> {
  const results: ConditionCheckResult[] = [];

  for (const condition of contract.preconditions) {
    const result = await checkCondition(condition, context);
    results.push(result);

    // Stop on first error if blocking
    if (result.status === 'failed' && condition.severity === 'error') {
      break;
    }
  }

  return results;
}

/**
 * Checks all postconditions against the execution result.
 */
export async function checkPostconditions(
  contract: TechniqueContract,
  context: ExecutionContext,
  output: unknown
): Promise<ConditionCheckResult[]> {
  const results: ConditionCheckResult[] = [];
  const enrichedContext = { ...context, output };

  for (const condition of contract.postconditions) {
    const result = await checkCondition(condition, enrichedContext);
    results.push(result);
  }

  return results;
}

/**
 * Checks invariants (can be called during execution).
 */
export async function checkInvariants(
  contract: TechniqueContract,
  context: ExecutionContext
): Promise<ConditionCheckResult[]> {
  const results: ConditionCheckResult[] = [];

  for (const invariant of contract.invariants) {
    const result = await checkCondition(invariant, context);
    results.push(result);
  }

  return results;
}
```

### Condition Checker Implementation

```typescript
async function checkCondition(
  condition: ContractCondition,
  context: ExecutionContext
): Promise<ConditionCheckResult> {
  const startTime = Date.now();

  try {
    switch (condition.checkType) {
      case 'type_check':
        return checkTypeCondition(condition, context);

      case 'value_constraint':
        return checkValueConstraint(condition, context);

      case 'state_assertion':
        return checkStateAssertion(condition, context);

      case 'structural_check':
        return checkStructural(condition, context);

      case 'semantic_check':
        return await checkSemantic(condition, context);

      case 'temporal_check':
        return checkTemporal(condition, context);

      case 'evidence_check':
        return checkEvidence(condition, context);

      default:
        return {
          conditionId: condition.id,
          status: 'skipped',
          reason: `Unknown check type: ${(condition as ContractCondition).checkType}`,
          durationMs: Date.now() - startTime,
        };
    }
  } catch (error) {
    return {
      conditionId: condition.id,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

function checkTypeCondition(
  condition: ContractCondition,
  context: ExecutionContext
): ConditionCheckResult {
  const check = condition.check as TypeCheck;
  const value = getValueAtPath(context, check.path);

  if (value === undefined && check.optional) {
    return { conditionId: condition.id, status: 'passed', durationMs: 0 };
  }

  if (value === null && check.nullable) {
    return { conditionId: condition.id, status: 'passed', durationMs: 0 };
  }

  const actualType = Array.isArray(value) ? 'array' : typeof value;
  const expectedTypes = Array.isArray(check.expectedType)
    ? check.expectedType
    : [check.expectedType];

  const valid = expectedTypes.includes(actualType as any);

  return {
    conditionId: condition.id,
    status: valid ? 'passed' : 'failed',
    reason: valid ? undefined : `Expected ${expectedTypes.join('|')}, got ${actualType}`,
    durationMs: 0,
  };
}

async function checkSemantic(
  condition: ContractCondition,
  context: ExecutionContext
): Promise<ConditionCheckResult> {
  const check = condition.check as SemanticCheck;

  // Gather context for LLM
  const contextData: Record<string, unknown> = {};
  for (const path of check.contextPaths) {
    contextData[path] = getValueAtPath(context, path);
  }

  // Build verification prompt
  const prompt = buildSemanticVerificationPrompt(check, contextData);

  // Call LLM for verification
  const result = await callLlmForVerification(prompt, check.confidenceThreshold);

  return {
    conditionId: condition.id,
    status: result.allPassed ? 'passed' : 'failed',
    reason: result.allPassed ? undefined : result.failedQuestions.join('; '),
    confidence: {
      type: 'measured',
      value: result.confidence,
      measurement: {
        datasetId: 'semantic_verification',
        sampleSize: 1,
        accuracy: result.confidence,
        confidenceInterval: [result.confidence - 0.1, result.confidence + 0.1],
        measuredAt: new Date(),
      },
    },
    durationMs: result.durationMs,
  };
}
```

### Result Types

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  checkedAt: string;
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ConditionCheckResult {
  conditionId: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  reason?: string;
  confidence?: ConfidenceValue;
  durationMs: number;
}

export interface ContractValidationReport {
  contractId: string;
  primitiveId: string;
  timestamp: string;

  inputValidation: ValidationResult;
  outputValidation: ValidationResult;

  preconditions: ConditionCheckResult[];
  postconditions: ConditionCheckResult[];
  invariants: ConditionCheckResult[];

  overallStatus: 'passed' | 'failed' | 'partial';

  summary: {
    totalConditions: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
  };
}
```

---

## 7. Integration with Execution Engine

### Contract-Aware Primitive Execution

```typescript
import { TechniqueExecutionEngine } from './technique_execution.js';
import type { TechniqueContract } from './contracts.js';

export class ContractAwareExecutionEngine extends TechniqueExecutionEngine {
  private contractRegistry: Map<string, TechniqueContract> = new Map();

  registerContract(contract: TechniqueContract): void {
    this.contractRegistry.set(contract.primitiveId, contract);
  }

  async executePrimitive(
    primitive: TechniquePrimitive,
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<PrimitiveExecutionResult> {
    const contract = this.contractRegistry.get(primitive.id);

    // Phase 1: Input validation
    if (contract) {
      const inputValidation = validateInput(contract, input);
      if (!inputValidation.valid) {
        return {
          primitiveId: primitive.id,
          status: 'failed',
          error: `Input validation failed: ${inputValidation.errors.map(e => e.message).join(', ')}`,
          evidence: [],
          output: {},
          contractViolations: inputValidation.errors,
        };
      }

      // Phase 2: Precondition checking
      const preconditionResults = await checkPreconditions(contract, { ...context, input });
      const failedPreconditions = preconditionResults.filter(
        r => r.status === 'failed' && contract.preconditions.find(p => p.id === r.conditionId)?.severity === 'error'
      );

      if (failedPreconditions.length > 0) {
        return {
          primitiveId: primitive.id,
          status: 'failed',
          error: `Preconditions failed: ${failedPreconditions.map(p => p.reason).join(', ')}`,
          evidence: [],
          output: {},
          contractViolations: failedPreconditions.map(p => ({
            conditionId: p.conditionId,
            message: p.reason ?? 'Unknown',
          })),
        };
      }
    }

    // Phase 3: Execute primitive
    const result = await super.executePrimitive(primitive, input, context);

    // Phase 4: Output validation and postcondition checking
    if (contract && result.status === 'success') {
      const outputValidation = validateOutput(contract, result.output);
      if (!outputValidation.valid) {
        return {
          ...result,
          status: 'failed',
          error: `Output validation failed: ${outputValidation.errors.map(e => e.message).join(', ')}`,
          contractViolations: outputValidation.errors,
        };
      }

      const postconditionResults = await checkPostconditions(
        contract,
        { ...context, input },
        result.output
      );

      const failedPostconditions = postconditionResults.filter(
        r => r.status === 'failed' && contract.postconditions.find(p => p.id === r.conditionId)?.severity === 'error'
      );

      if (failedPostconditions.length > 0) {
        return {
          ...result,
          status: 'failed',
          error: `Postconditions failed: ${failedPostconditions.map(p => p.reason).join(', ')}`,
          contractViolations: failedPostconditions.map(p => ({
            conditionId: p.conditionId,
            message: p.reason ?? 'Unknown',
          })),
        };
      }

      // Attach validation report to result
      result.contractValidation = {
        inputValidation,
        outputValidation,
        preconditions: preconditionResults,
        postconditions: postconditionResults,
      };
    }

    return result;
  }
}
```

### Execution Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Primitive Execution                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. INPUT VALIDATION (Schema)                                │
│     └─ validateInput(contract, input)                       │
│         ├─ Pass → Continue                                   │
│         └─ Fail → Return error with violations              │
│                                                              │
│  2. PRECONDITION CHECKING                                    │
│     └─ checkPreconditions(contract, context)                │
│         ├─ All pass → Continue                              │
│         └─ Error severity fails → Return error              │
│                                                              │
│  3. PRIMITIVE EXECUTION                                      │
│     └─ executePrimitive(primitive, input, context)          │
│         ├─ Success → Continue                               │
│         └─ Failure → Return with error                      │
│                                                              │
│  4. OUTPUT VALIDATION (Schema)                               │
│     └─ validateOutput(contract, output)                     │
│         ├─ Pass → Continue                                   │
│         └─ Fail → Return error with violations              │
│                                                              │
│  5. POSTCONDITION CHECKING                                   │
│     └─ checkPostconditions(contract, context, output)       │
│         ├─ All pass → Return success with report            │
│         └─ Error severity fails → Return error              │
│                                                              │
│  6. INVARIANT CHECKING (periodic during long operations)     │
│     └─ checkInvariants(contract, context)                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Migration Path

### Phase 1: Infrastructure (Week 1-2)

**Goal**: Build contract types and validation utilities without changing existing primitives.

| Task | LOC Estimate |
|------|--------------|
| Contract type definitions | ~150 |
| JSON Schema validation utilities | ~100 |
| Condition checker implementations | ~200 |
| LLM-assisted verification integration | ~150 |
| **Phase 1 Total** | **~600** |

**Deliverables**:
- `packages/LiBrainian/src/contracts/types.ts`
- `packages/LiBrainian/src/contracts/validation.ts`
- `packages/LiBrainian/src/contracts/checkers.ts`
- Unit tests for all validators

### Phase 2: Contract Registry (Week 2-3)

**Goal**: Create storage and retrieval for contracts, integrated with existing primitive storage.

| Task | LOC Estimate |
|------|--------------|
| Contract registry storage | ~100 |
| Contract loading/caching | ~80 |
| Contract-primitive linkage | ~50 |
| **Phase 2 Total** | **~230** |

**Deliverables**:
- `packages/LiBrainian/src/contracts/registry.ts`
- Database schema for contracts
- Migration scripts

### Phase 3: Pilot Contracts (Week 3-4)

**Goal**: Create contracts for 5 high-use primitives to validate the system.

| Primitive | Priority | Complexity |
|-----------|----------|------------|
| `tp_clarify_goal` | P0 | Medium |
| `tp_decompose` | P0 | Medium |
| `tp_verify_plan` | P0 | High |
| `tp_hypothesis` | P1 | Medium |
| `tp_root_cause` | P1 | High |

| Task | LOC Estimate |
|------|--------------|
| 5 pilot contracts | ~500 |
| Contract-specific tests | ~200 |
| **Phase 3 Total** | **~700** |

### Phase 4: Execution Integration (Week 4-5)

**Goal**: Wire contract checking into the execution engine.

| Task | LOC Estimate |
|------|--------------|
| ContractAwareExecutionEngine | ~300 |
| Execution hooks for contract checking | ~100 |
| Evidence emission for contract violations | ~80 |
| **Phase 4 Total** | **~480** |

### Phase 5: Remaining Primitives (Week 5-8)

**Goal**: Add contracts to all 64 primitives incrementally.

| Batch | Primitives | LOC Estimate |
|-------|------------|--------------|
| Batch 1: Core reasoning (10 primitives) | tp_list_constraints, tp_search_history, etc. | ~1,000 |
| Batch 2: Analysis (12 primitives) | tp_arch_mapping, tp_dependency_map, etc. | ~1,200 |
| Batch 3: Verification (10 primitives) | tp_review_tests, tp_risk_scan, etc. | ~1,000 |
| Batch 4: Execution (15 primitives) | tp_experiment, tp_instrument, etc. | ~1,500 |
| Batch 5: Remaining (12 primitives) | Miscellaneous | ~1,200 |
| **Phase 5 Total** | **~5,900** |

### Migration Checklist per Primitive

- [ ] Analyze existing prose actions and failure modes
- [ ] Define input schema from `inputsRequired`
- [ ] Define output schema from `outputs`
- [ ] Convert failure modes to postcondition checks
- [ ] Add semantic checks for non-structural requirements
- [ ] Create positive, negative, and edge case examples
- [ ] Set appropriate confidence level
- [ ] Add tests for contract validation
- [ ] Update documentation

---

## 9. Implementation Roadmap

### Summary

| Phase | Description | LOC | Duration |
|-------|-------------|-----|----------|
| **Phase 1** | Infrastructure | ~600 | 2 weeks |
| **Phase 2** | Contract Registry | ~230 | 1 week |
| **Phase 3** | Pilot Contracts (5) | ~700 | 1 week |
| **Phase 4** | Execution Integration | ~480 | 1 week |
| **Phase 5** | Remaining 59 Primitives | ~5,900 | 3-4 weeks |
| **Total** | | **~7,910** | **8-9 weeks** |

### Success Criteria

| Metric | Target |
|--------|--------|
| Primitives with contracts | 64/64 (100%) |
| Automated precondition checks | >80% of all preconditions |
| Automated postcondition checks | >70% of all postconditions |
| Contract validation test coverage | >90% |
| LLM verification success rate | >85% accuracy |

### Evidence Commands

```bash
# Contract type tests
cd packages/LiBrainian && npx vitest src/contracts/__tests__/types.test.ts

# Validation utility tests
cd packages/LiBrainian && npx vitest src/contracts/__tests__/validation.test.ts

# Pilot contract tests
cd packages/LiBrainian && npx vitest src/contracts/__tests__/pilot_contracts.test.ts

# Integration tests
cd packages/LiBrainian && npx vitest src/contracts/__tests__/execution_integration.test.ts

# Full contract suite
npm run test:contracts
```

### Dependencies

| This Spec | Depends On |
|-----------|------------|
| Semantic checks | LLM Provider Discovery (P0) |
| Contract execution | Operator Execution Layer (P1) |
| Contract storage | LibrarianStorage |
| Confidence types | CONFIDENCE_REDESIGN.md |

---

## Related Specifications

- [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) - Confidence value types used in contracts
- [track-a-core-pipeline.md](./track-a-core-pipeline.md) - Operator execution layer integration
- [track-d-quantification.md](./track-d-quantification.md) - Quantification and measurement
- [track-f-calibration.md](./track-f-calibration.md) - Calibration for measured confidence
