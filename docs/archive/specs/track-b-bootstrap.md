# Track B: Bootstrap Pipeline Specification (P8-P10)

> **Extracted from**: `/docs/LiBrainian/THEORETICAL_CRITIQUE.md` (Parts XVIII, XIX)
> **Features**: P8: Zero-Knowledge Bootstrap, P9: Universal Applicability, P10: Epistemic Policy
> **Status**: All three features implemented in `packages/LiBrainian/src/api/`
>
> **LiBrainian Story**: Chapter 4 (The Bootstrap) - Building knowledge from certainty to inference.
>
> **Related Issues**: See [subsystem-problems.md](./subsystem-problems.md) Problems 27-28 for per-file timeout and LLM retry issues.

---

## Executive Summary

Track B addresses the fundamental epistemic problem of LiBrainian: **How does an intelligent system build knowledge from nothing, apply it universally, and maintain honest confidence bounds?**

This specification covers:
- **P8: Zero-Knowledge Bootstrap** - Systematic protocols for building knowledge from complete ignorance
- **P9: Universal Applicability** - Mapping any situation to appropriate protocols
- **P10: Epistemic Policy** - Configuration for honest uncertainty disclosure

---

## Theoretical Foundation

### The Bootstrap Problem

**Core Question**: How does an agent proceed when there is:
- No documentation
- No comments
- No tests
- No known architecture
- Potentially obfuscated or generated code
- Completely unfamiliar technology

**The Epistemic Challenge** (from Part XVIII):

```
The agent must answer questions about code BEFORE understanding the code.
This creates a circular dependency that traditional systems cannot break.
```

### Why Bootstrap is Hard

1. **Confidence Without Calibration**: How do you know what you know when you have no baseline?
2. **Evidence Without Ground Truth**: How do you verify claims when you cannot run tests?
3. **Progress Without Metrics**: How do you measure understanding improvement?
4. **Decisions Without History**: How do you choose strategies without prior experience?

### The Twenty Greats' Insight

From the theoretical critique:

> **Pearl**: "Epistemology without causal structure is mere correlation. LiBrainian must know WHY it believes what it believes."
>
> **McCarthy/Minsky**: "An epistemologically adequate system must distinguish between what it knows, what it believes, what it assumes, and what it doesn't know."

---

## P8: Zero-Knowledge Bootstrap Protocol

### Conceptual Design

The Zero-Knowledge Protocol solves the bootstrap problem through **systematic phase progression** with **calibrated confidence at each step**.

**Key Principle**: Start with what is CERTAIN, expand to what is LIKELY, mark everything else as UNKNOWN.

### Phase Structure

```
Phase 0: IGNORANCE
  - "I have not examined this"
  - Confidence: undefined (literally undefined, not 0)
  - Action: Must bootstrap before any claims

Phase 1: STRUCTURAL CERTAINTIES (confidence: deterministic)
  - Enumerate what EXISTS without interpreting meaning
  - Source: AST parsing → DeterministicConfidence (1.0 or 0.0)

Phase 2: NAMING-BASED INFERENCE (confidence: absent until calibrated)
  - Infer likely purposes from naming conventions
  - Source: Heuristic pattern matching → AbsentConfidence until calibration

Phase 3: STRUCTURAL INFERENCE (confidence: absent until calibrated)
  - Infer architecture from structural patterns
  - Source: Graph analysis → AbsentConfidence until calibration

Phase 4: BEHAVIORAL PROBING (confidence: deterministic for pass/fail)
  - Observe behavior to verify structural inferences
  - Source: Build/test execution → DeterministicConfidence for binary outcomes

Phase 5: SEMANTIC EXTRACTION (confidence: absent until calibrated)
  - Extract meaning using LLM reasoning
  - Source: LLM synthesis → AbsentConfidence until calibration

Phase 6: VERIFICATION LOOP (confidence: varies)
  - Cross-check inferences and calibrate confidence
  - Source: Evidence agreement
```

### Technical Specification

#### Core Types

**File**: `packages/LiBrainian/src/api/zero_knowledge_bootstrap.ts`

```typescript
export type KnowledgeSource =
  | 'syntactic'    // AST-derived, highest reliability
  | 'naming'       // From naming conventions
  | 'structural'   // From code structure
  | 'behavioral'   // From execution observation
  | 'semantic';    // LLM-synthesized

export interface KnowledgeClaim {
  claim: string;
  source: KnowledgeSource;
  confidence: ConfidenceValue;  // MUST use principled type, not raw number
  evidence: string;
}

export interface KnowledgeState {
  facts: KnowledgeClaim[];       // Verified knowledge
  inferences: KnowledgeClaim[];  // Derived knowledge
  unknowns: string[];            // Explicitly unknown
  contradictions: string[];      // Conflicting signals
}

export interface BootstrapPhase {
  name: string;
  goal: string;
  expectedConfidenceType: 'deterministic' | 'absent' | 'derived';  // What type this phase produces
  steps: string[];
  outputs: string[];
  failureMode: string;
}

export interface ZeroKnowledgeProtocolState {
  phases: BootstrapPhase[];
  currentPhase: number;
  accumulatedKnowledge: KnowledgeState;
  confidenceThreshold: number;
  history: PhaseResult[];
}
```

#### Protocol Phases (Detailed)

```typescript
export const ZERO_KNOWLEDGE_PROTOCOL: BootstrapPhase[] = [
  // PHASE 1: Structural certainties (what we can PROVE from syntax alone)
  {
    name: 'structural_inventory',
    goal: 'Enumerate what exists without interpreting meaning',
    expectedConfidenceType: 'deterministic',  // AST parsing → 1.0 or 0.0
    steps: [
      'Count files by extension (establish language mix)',
      'Parse all parseable files to AST (structural extraction)',
      'List all exported symbols (public interface)',
      'List all imports/dependencies (dependency graph skeleton)',
      'Identify entry points (main functions, index files)',
    ],
    outputs: ['file_inventory', 'language_distribution', 'symbol_table',
              'import_graph', 'entry_points'],
    failureMode: 'If files cannot be parsed, fall back to regex extraction',
  },

  // PHASE 2: Naming-based inference (what we can INFER from names)
  {
    name: 'naming_inference',
    goal: 'Infer likely purposes from naming conventions',
    expectedConfidenceType: 'absent',  // Names are hints - needs calibration
    steps: [
      'Classify files by naming pattern (test, config, util, model, etc.)',
      'Infer function purposes from verb-noun patterns',
      'Identify domain vocabulary (recurring terms)',
      'Map naming conventions (camelCase, snake_case, etc.)',
    ],
    outputs: ['file_classifications', 'function_purposes_inferred',
              'domain_vocabulary'],
    failureMode: 'If names are obfuscated, skip and mark as UNKNOWN',
  },

  // PHASE 3: Structural inference (what we can INFER from structure)
  {
    name: 'structural_inference',
    goal: 'Infer architecture from structural patterns',
    expectedConfidenceType: 'absent',  // Structural patterns need calibration
    steps: [
      'Detect directory-based modules',
      'Identify potential MVC/layered patterns',
      'Find central hub files (high in-degree in import graph)',
      'Identify peripheral files (high out-degree, low in-degree)',
    ],
    outputs: ['likely_modules', 'architectural_pattern_hypothesis',
              'central_files', 'peripheral_files'],
    failureMode: 'If structure is flat, report "no clear architecture"',
  },

  // PHASE 4: Behavioral probing (what we can OBSERVE from running)
  {
    name: 'behavioral_probing',
    goal: 'Observe behavior to verify structural inferences',
    expectedConfidenceType: 'deterministic',  // Pass/fail is binary (1.0 or 0.0)
    steps: [
      'Attempt to build/compile (verify buildability)',
      'Run existing tests (verify current health)',
      'Add instrumentation to entry points (observe call flow)',
      'Execute with sample inputs (observe behavior)',
    ],
    outputs: ['build_status', 'test_results', 'observed_call_graph',
              'runtime_behavior'],
    failureMode: 'If cannot build, stay at static analysis',
  },

  // PHASE 5: Semantic extraction (LLM-powered understanding)
  {
    name: 'semantic_extraction',
    goal: 'Extract meaning using LLM reasoning',
    expectedConfidenceType: 'absent',  // LLM synthesis needs calibration
    steps: [
      'Summarize each file purpose',
      'Extract entity purposes',
      'Identify cross-cutting concerns',
      'Generate architectural summary',
    ],
    outputs: ['file_summaries', 'entity_purposes', 'concerns',
              'architecture_summary'],
    failureMode: 'If LLM unavailable, stop at structural understanding',
  },

  // PHASE 6: Verification loop (calibrate confidence from evidence)
  {
    name: 'verification_loop',
    goal: 'Verify inferences and calibrate confidence',
    confidence: 'varies',
    steps: [
      'Cross-check inferences against behavioral observations',
      'Identify contradictions between phases',
      'Calibrate confidence based on evidence agreement',
      'Mark remaining unknowns explicitly',
    ],
    outputs: ['verified_knowledge', 'contradictions',
              'calibrated_confidence', 'unknowns'],
    failureMode: 'Always produces output (even if all UNKNOWN)',
  },
];
```

### Evidence-Based Confidence

**Core Algorithm**:

```typescript
/**
 * Compute evidence-based support from multiple evidence sources.
 *
 * RULES:
 * 1. Produce a deterministic "support signal" used for ranking/triage (NOT claim confidence).
 * 2. Epistemic claim confidence MUST be a `ConfidenceValue` (Track D).
 * 3. Before calibration exists, confidence is typically `absent('uncalibrated')`.
 * 4. Contradictions become defeaters; they do not "magically" become a numeric confidence.
 */
export function computeEvidenceBasedSupport(
  claim: string,
  sources: EvidenceSource[]
): { claim: string; evidenceSources: EvidenceSource[]; supportSignal: number; confidence: ConfidenceValue } {
  if (sources.length === 0) {
    return {
      claim,
      evidenceSources: [],
      supportSignal: 0.0,
      confidence: absent('insufficient_data'),
    };
  }

  const agreements = sources.filter(s => s.weight > 0);
  const contradictions = sources.filter(s => s.weight < 0);

  if (contradictions.length > 0) {
    return {
      claim,
      evidenceSources: sources,
      supportSignal: -1.0,
      confidence: absent('uncalibrated'),
    };
  }

  return {
    claim,
    evidenceSources: sources,
    supportSignal: 1.0,
    confidence: absent('uncalibrated'),
  };
}
```

### Progressive Understanding Disclosure

```typescript
/**
 * PROGRESSIVE UNDERSTANDING DISCLOSURE
 *
 * As you learn more, disclose understanding progressively.
 * Never claim more than evidence supports.
 *
 * Level 0: "I can parse this codebase"
 * Level 1: "I see these files and dependencies"
 * Level 2: "I infer these likely purposes"
 * Level 3: "I've verified these behaviors"
 * Level 4: "I understand this architecture"
 */

export type UnderstandingLevel = 0 | 1 | 2 | 3 | 4;

export interface ProgressiveUnderstanding {
  level: UnderstandingLevel;
  whatWeKnow: KnowledgeAtLevel[];
  whatWeInfer: KnowledgeAtLevel[];
  whatWeDoNotKnow: string[];
  nextStepsToImprove: string[];
}
```

### Epistemic Escalation Protocol

When stuck at a confidence level, the system follows an escalation chain:

```typescript
export interface EscalationDecision {
  situation: string;
  currentConfidence: ConfidenceValue;
  requiredConfidenceThreshold: number;
  decision: 'proceed' | 'try_alternative' | 'ask_human' | 'assume_explicit' | 'refuse';
  rationale: string;
  ifProceeding?: {
    uncertaintyBounds: [number, number];
    assumptions: string[];
    riskAcknowledgment: string;
  };
}

/**
 * EPISTEMIC ESCALATION
 *
 * Escalation chain:
 * 1. Try alternative analysis methods
 * 2. Ask clarifying questions (if human available)
 * 3. Make constrained assumptions (explicit)
 * 4. Proceed with uncertainty bounds (wide intervals)
 * 5. Refuse and explain why (honest limits)
 */
```

### API Functions

```typescript
// Create initial protocol state
export function createZeroKnowledgeState(options?: {
  confidenceThreshold?: number
}): ZeroKnowledgeProtocolState;

// Record results of a phase execution
export function recordPhaseResult(
  state: ZeroKnowledgeProtocolState,
  result: PhaseResult
): ZeroKnowledgeProtocolState;

// Compute evidence-based support (signal + ConfidenceValue)
export function computeEvidenceBasedSupport(
  claim: string,
  sources: EvidenceSource[]
): { claim: string; evidenceSources: EvidenceSource[]; supportSignal: number; confidence: ConfidenceValue };

// Generate understanding report
export function reportUnderstanding(
  state: KnowledgeState
): ProgressiveUnderstanding;

// Escalation engine for decision-making
export class EpistemicEscalationEngine {
  constructor(options?: EpistemicEscalationOptions);

  decideEscalation(
    task: string,
    currentKnowledge: KnowledgeState,
    requiredConfidence?: number
  ): EscalationDecision;
}
```

---

## P9: Universal Applicability

### Conceptual Design

The Universal Applicability Matrix provides a **systematic mapping from any situation to the appropriate protocol**.

**The Question**: How does LiBrainian serve ANY software role, task, project, or system?

**The Answer**: A mapping from situations to protocols.

### Situation Vector

```typescript
export interface SituationVector {
  role: Role;
  task: Task;
  projectState: ProjectState;
  knowledgeState: KnowledgeState;
}
```

### Dimension Definitions

#### Roles (WHO is using LiBrainian)

```typescript
export type Role =
  | 'developer'            // Writing new code
  | 'reviewer'             // Reviewing code changes
  | 'architect'            // Designing systems
  | 'debugger'             // Finding and fixing bugs
  | 'learner'              // Understanding existing code
  | 'maintainer'           // Keeping code healthy
  | 'migrator'             // Moving to new technologies
  | 'security_analyst'     // Finding vulnerabilities
  | 'performance_engineer' // Optimizing speed
  | 'documentation_writer' // Creating docs
  ;
```

#### Tasks (WHAT they're trying to do)

```typescript
export type Task =
  | 'understand'  // What does this do?
  | 'modify'      // Change this safely
  | 'verify'      // Is this correct/safe?
  | 'debug'       // Why isn't this working?
  | 'design'      // How should this be structured?
  | 'document'    // Explain this to others
  | 'test'        // What tests are needed?
  | 'optimize'    // Make this faster/smaller
  | 'migrate'     // Move to new tech
  | 'secure'      // Find/fix vulnerabilities
  ;
```

#### Project State (WHAT kind of project)

```typescript
export type ProjectState =
  | 'greenfield'  // New project, clean slate
  | 'active'      // Actively developed
  | 'stable'      // Maintained but not actively developed
  | 'legacy'      // Old technology, needs care
  | 'abandoned'   // No longer maintained
  | 'generated'   // Code generated by tools
  | 'obfuscated'  // Intentionally hard to read
  ;
```

#### Knowledge State (HOW MUCH is documented)

```typescript
export type KnowledgeState =
  | 'excellent'   // Full docs, tests, comments
  | 'good'        // Some docs, reasonable comments
  | 'poor'        // Minimal docs, few comments
  | 'none'        // No docs, no comments
  | 'misleading'  // Docs exist but are wrong
  ;
```

### Protocol Selection

```typescript
export class UniversalProtocolSelector {
  /**
   * Given a situation, return the appropriate LiBrainian protocol.
   */
  selectProtocol(situation: SituationVector): Protocol {
    const { role, task, projectState, knowledgeState } = situation;

    // Start with knowledge acquisition if needed
    if (knowledgeState === 'none' || knowledgeState === 'misleading') {
      return {
        phase1: ZERO_KNOWLEDGE_PROTOCOL,  // Bootstrap first
        phase2: this.selectTaskProtocol(role, task, projectState),
        confidenceRequirements: this.computeRequiredConfidence(role, task),
      };
    }

    // Direct to task protocol
    return {
      phase1: null,  // Skip bootstrapping
      phase2: this.selectTaskProtocol(role, task, projectState),
      confidenceRequirements: this.computeRequiredConfidence(role, task),
    };
  }
}
```

### Task-Specific Protocols

```typescript
const BASE_PROTOCOLS: Record<Task, TaskProtocol> = {
  understand: {
    id: 'protocol_understand',
    name: 'Codebase Understanding',
    goal: 'Build a reliable mental model of the codebase.',
    patterns: ['pattern_codebase_onboarding', 'pattern_documentation'],
    operators: ['sequence', 'loop'],
    evidenceExpectations: ['Inventory of files', 'Architecture summary'],
  },
  modify: {
    id: 'protocol_modify',
    name: 'Safe Modification',
    goal: 'Change behavior while preserving correctness.',
    patterns: ['pattern_change_verification', 'pattern_dependency_update'],
    operators: ['gate', 'loop'],
    evidenceExpectations: ['Impact analysis', 'Verification plan'],
  },
  verify: {
    id: 'protocol_verify',
    name: 'Verification',
    goal: 'Establish strong evidence for correctness.',
    patterns: ['pattern_change_verification', 'pattern_test_generation'],
    operators: ['gate', 'quorum'],
    evidenceExpectations: ['Test results', 'Coverage gaps closed'],
  },
  debug: {
    id: 'protocol_debug',
    name: 'Debugging',
    goal: 'Identify root causes and confirm fixes.',
    patterns: ['pattern_bug_investigation'],
    operators: ['loop'],
    evidenceExpectations: ['Root cause identified', 'Repro confirmed'],
  },
  // ... additional tasks
};
```

### Confidence Requirements by Role/Task

```typescript
/**
 * Compute required confidence for task.
 * High-stakes tasks require higher confidence.
 */
private computeRequiredConfidence(role: Role, task: Task): number {
  const baseConfidence: Record<Task, number> = {
    understand: 0.6,   // Understanding can be iterative
    modify: 0.8,       // Modifications need higher confidence
    verify: 0.9,       // Verification needs very high confidence
    debug: 0.7,        // Debugging is inherently uncertain
    design: 0.7,       // Design can be revised
    document: 0.8,     // Docs should be accurate
    test: 0.7,         // Tests are verifiable
    optimize: 0.7,     // Optimizations are measurable
    migrate: 0.85,     // Migrations are hard to reverse
    secure: 0.95,      // Security needs highest confidence
  };

  const roleMultiplier: Record<Role, number> = {
    developer: 1.0,
    reviewer: 1.1,        // Reviewers need more certainty
    architect: 0.9,       // Architects make reversible decisions
    debugger: 0.9,        // Debugging is exploratory
    learner: 0.7,         // Learning tolerates uncertainty
    maintainer: 1.0,
    migrator: 1.1,
    security_analyst: 1.2, // Security needs highest bar
    performance_engineer: 0.9,
    documentation_writer: 1.0,
  };

  return Math.min(0.95, baseConfidence[task] * roleMultiplier[role]);
}
```

### Project State Adaptations

```typescript
// Legacy/abandoned projects get additional precautions
private wrapWithLegacyPrecautions(protocol: TaskProtocol): TaskProtocol {
  return {
    ...protocol,
    id: `${protocol.id}_legacy`,
    precautions: [
      ...protocol.precautions,
      'Assume hidden dependencies and preserve backward compatibility.',
      'Prefer additive or reversible changes.',
      'Require rollback plan for changes.',
    ],
    patterns: [...protocol.patterns, 'pattern_dependency_update'],
  };
}

// Generated/obfuscated code needs structural analysis first
private wrapWithStructuralAnalysis(protocol: TaskProtocol): TaskProtocol {
  return {
    ...protocol,
    id: `${protocol.id}_structural`,
    precautions: [
      ...protocol.precautions,
      'Verify structural inventory before acting.',
      'Document entry points and generated artifacts.',
    ],
    patterns: [...protocol.patterns, 'pattern_codebase_onboarding'],
  };
}
```

---

## P10: Epistemic Policy Configuration

### Conceptual Design

Epistemic Policy provides **configurable honesty thresholds** for the entire system.

From the theoretical critique (N.3 The Honesty Principle):

> **Dijkstra**: "The competent programmer is fully aware of the strictly limited size of his own skull; therefore he approaches the programming task in full humility."

### Policy Interface

```typescript
export interface EpistemicPolicy {
  claimThreshold: number;         // Don't claim if effective confidence < this
  uncertaintyDisclosure: boolean; // Always report confidence
  evidenceRequired: boolean;      // Every claim needs source
  calibrationFeedback: boolean;   // Feed outcomes back
}

export const DEFAULT_EPISTEMIC_POLICY: EpistemicPolicy = {
  claimThreshold: 0.6,
  uncertaintyDisclosure: true,
  evidenceRequired: true,
  calibrationFeedback: true,
};
```

### Policy Application

```typescript
/**
 * Apply epistemic policy to determine if a claim should be made.
 *
 * Returns true if the claim meets all policy requirements:
 * 1. Confidence >= threshold
 * 2. Evidence provided (if required)
 */
export function applyEpistemicPolicy(
  claim: EpistemicClaim | null,
  confidence: ConfidenceValue,
  policy: EpistemicPolicy
): boolean {
  if (!meetsThreshold(confidence, policy.claimThreshold)) return false;

  if (policy.evidenceRequired) {
    const evidence = claim?.evidence ?? claim?.evidenceChain;
    if (!hasEvidence(evidence)) return false;
  }

  return true;
}
```

### Configuration Storage

Policy files are stored at `.LiBrainian/epistemic_policy.json`:

```json
{
  "claimThreshold": 0.6,
  "uncertaintyDisclosure": true,
  "evidenceRequired": true,
  "calibrationFeedback": true
}
```

### Loading and Persistence

```typescript
/**
 * Load epistemic policy from workspace.
 * Falls back to defaults if file doesn't exist.
 */
export async function loadEpistemicPolicy(
  workspaceRoot?: string
): Promise<EpistemicPolicy>;
```

---

## The Principled Confidence System

### The Problem with Arbitrary Numbers

From Part XIX.N.4:

> **Dijkstra**: "These numbers are wishes, not measurements. A confidence of 0.7 that hasn't been validated against outcomes is epistemically meaningless."
>
> **Pearl**: "These are priors without posteriors. Bayesian reasoning requires updating beliefs based on evidence. Where is the evidence?"

### The Solution: ConfidenceValue (Not “Labeled Guess” Confidence)

**CRITICAL**: The old “labeled guess” approach was documentation theater — a labeled guess is still a guess.

Every confidence value MUST be one of 5 principled types:

| Type | When to Use | Example |
|------|-------------|---------|
| **Deterministic** | Syntactic operations (AST, regex) | `{ type: 'deterministic', value: 1.0, reason: 'ast_parse' }` |
| **Derived** | Computed from other confidences | `{ type: 'derived', value: 0.64, formula: 'min(a, b)', inputs: [...] }` |
| **Measured** | Calibrated from outcome data | `{ type: 'measured', value: 0.73, measurement: {...} }` |
| **Bounded** | Theoretical range with citation | `{ type: 'bounded', low: 0.4, high: 0.8, citation: '...' }` |
| **Absent** | Unknown - system degrades gracefully | `{ type: 'absent', reason: 'uncalibrated' }` |

**NO RAW NUMBERS** like `confidence: 0.7` - TypeScript will reject them.

See [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) and [track-d-quantification.md](./track-d-quantification.md) for full specification.

### Bootstrap Phase Confidence Types

| Phase | Confidence Type | Rationale |
|-------|-----------------|-----------|
| Phase 1 (Structural) | `deterministic` | AST parsing success is binary |
| Phase 2 (Naming) | `absent` | Naming inference needs calibration |
| Phase 3 (Structural Inference) | `absent` | Pattern detection needs calibration |
| Phase 4 (Behavioral) | `deterministic` | Test pass/fail is binary |
| Phase 5 (Semantic) | `absent` | LLM synthesis needs calibration |
| Phase 6 (Verification) | `derived` | Combines evidence from other phases |

---

## Interface Definitions

### P8 Exports

```typescript
// From packages/LiBrainian/src/api/zero_knowledge_bootstrap.ts

export type KnowledgeSource;
export interface KnowledgeClaim;
export interface KnowledgeState;
export interface BootstrapPhase;
export interface ZeroKnowledgeProtocolState;
export interface PhaseResult;
export interface EvidenceSource;
export interface EvidenceBasedConfidence;
export type UnderstandingLevel;
export interface ProgressiveUnderstanding;
export interface KnowledgeAtLevel;
export interface EscalationDecision;
export interface EpistemicEscalationOptions;

export const ZERO_KNOWLEDGE_PROTOCOL: BootstrapPhase[];

export function getZeroKnowledgeProtocol(): BootstrapPhase[];
export function createZeroKnowledgeState(options?): ZeroKnowledgeProtocolState;
export function recordPhaseResult(state, result): ZeroKnowledgeProtocolState;
export function computeEvidenceBasedConfidence(claim, sources): EvidenceBasedConfidence;
export function reportUnderstanding(state): ProgressiveUnderstanding;
export class EpistemicEscalationEngine;
```

### P9 Exports

```typescript
// From packages/LiBrainian/src/api/universal_applicability.ts

export type Role;
export type Task;
export type ProjectState;
export type KnowledgeState;
export interface SituationVector;
export interface TaskProtocol;
export interface Protocol;

export class UniversalProtocolSelector {
  selectProtocol(situation: SituationVector): Protocol;
}
```

### P10 Exports

```typescript
// From packages/LiBrainian/src/api/epistemic_policy.ts

export interface EpistemicPolicy;
export interface EpistemicClaim;
export const DEFAULT_EPISTEMIC_POLICY: EpistemicPolicy;

export async function loadEpistemicPolicy(workspaceRoot?): Promise<EpistemicPolicy>;
export function applyEpistemicPolicy(claim, confidence, policy): boolean;
```

---

## Dependencies

### Internal Dependencies

| Feature | Depends On |
|---------|-----------|
| P8 | None (foundational) |
| P9 | P8 (uses ZERO_KNOWLEDGE_PROTOCOL) |
| P10 | None (orthogonal configuration) |

### External Dependencies

| Dependency | Used For |
|------------|----------|
| `node:fs/promises` | P10 policy file loading |
| `node:path` | Path resolution |
| `../security/sanitization.js` | P10 path sanitization |
| `../utils/safe_json.js` | P10 JSON parsing |

---

## Acceptance Criteria

### P8: Zero-Knowledge Bootstrap

- [ ] `createZeroKnowledgeState()` returns valid initial state
- [ ] `recordPhaseResult()` correctly accumulates knowledge
- [ ] `computeEvidenceBasedConfidence()` caps contradictory evidence at 0.5
- [ ] `reportUnderstanding()` returns appropriate level based on evidence
- [ ] `EpistemicEscalationEngine` follows escalation chain correctly
- [ ] All phase confidence values are documented as configurable or placeholder

### P9: Universal Applicability

- [ ] `UniversalProtocolSelector` handles all Role/Task/ProjectState/KnowledgeState combinations
- [ ] Zero-knowledge protocol injected when `knowledgeState === 'none' || 'misleading'`
- [ ] Legacy/abandoned projects get precautions wrapper
- [ ] Generated/obfuscated projects get structural analysis wrapper
- [ ] Confidence requirements scale by role and task

### P10: Epistemic Policy

- [ ] Default policy loads when no file exists
- [ ] Custom policy loads from `.LiBrainian/epistemic_policy.json`
- [ ] `applyEpistemicPolicy()` enforces threshold and evidence requirements
- [ ] Invalid policy files throw descriptive errors
- [ ] Path sanitization prevents traversal attacks

---

## Evidence Commands

```bash
# Run P8/P9/P10 tests
cd packages/LiBrainian && npx vitest run src/api/__tests__/zero_knowledge_bootstrap.test.ts
cd packages/LiBrainian && npx vitest run src/api/__tests__/universal_applicability.test.ts
cd packages/LiBrainian && npx vitest run src/api/__tests__/epistemic_policy.test.ts

# Verify exports
node -e "import('LiBrainian').then(m => console.log(Object.keys(m)))"

# Check implementation exists
ls -la packages/LiBrainian/src/api/zero_knowledge_bootstrap.ts
ls -la packages/LiBrainian/src/api/universal_applicability.ts
ls -la packages/LiBrainian/src/api/epistemic_policy.ts
```

---

## Implementation Notes

### Commit References

| Feature | Commit | Status |
|---------|--------|--------|
| P8: Zero-Knowledge Bootstrap | `dfa1e68a` | Historical reference (not a verification signal) |
| P9: Universal Applicability | `97fcd5e4` | Historical reference (not a verification signal) |
| P10: Epistemic Policy | `377f1b0a` | Historical reference (not a verification signal) |

### Source Reliability Constants (Deprecated)

```typescript
/**
 * WARNING: Any `KnowledgeSource -> number` mapping is a heuristic *signal*, not epistemic confidence.
 *
 * - Use `ConfidenceValue` for claim confidence (Track D / Confidence Boundary).
 * - If you want a numeric scalar for ranking/triage, call it `score`/`signalStrength`.
 * - Any "reliability" constants MUST NOT be presented as calibrated unless backed by measured outcomes.
 */
```

### Design Decisions

1. **Never claim certainty**: Maximum confidence capped at 0.95
2. **Contradiction penalty**: Any contradicting evidence caps confidence at 0.5
3. **Explicit unknowns**: Unknown items are tracked, not hidden
4. **Fail honestly**: When escalation fails, the system refuses rather than guessing

---

## Related Specifications

- **Part XVIII**: Theoretical Breakthroughs and Epistemic Bootstrapping
- **Part XIX**: Modular Configuration Language
- **Track A**: Core retrieval and query pipeline
- **Track C**: Learning loop and prediction-oriented memory

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-22 | Initial extraction from THEORETICAL_CRITIQUE.md |
