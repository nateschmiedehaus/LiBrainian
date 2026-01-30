# Track C: Causal Reasoning Engine

> **Extracted from**: `docs/librarian/THEORETICAL_CRITIQUE.md` (Part XVII.C)
> **Source**: Pearl's do-calculus, structural causal models, and counterfactual reasoning
> **Status**: Specification complete, implementation pending
>
> **Librarian Story**: Chapter 6 (The Causality) - Understanding not just what IS, but what WOULD happen.
>
> **Related Specifications**:
> - [track-c-extended.md](./track-c-extended.md) - P16 Causal Discovery (observational data)
> - [track-f-epistemology.md](./track-f-epistemology.md) - E1 Gettier Risk (counterfactual sensitivity)
> - [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) - Principled confidence system used throughout

---

## Executive Summary

Track C addresses the fundamental limitation of current impact analysis: **It shows what CAN be affected, but not what WILL be affected or HOW.**

Current dependency graph traversal cannot answer:
- "If I change function X, what will break?"
- "What would have happened if we hadn't merged that PR?"
- "Why did the production incident occur?"

This specification covers:
- **Causal Model Types** - DAGs, SCMs, causal Bayesian networks
- **Causal Graph Construction** - Building models from code, git, runtime, and documentation
- **Do-Calculus Implementation** - Computing effects of interventions
- **Counterfactual Reasoning** - "What if" analysis
- **Root Cause Analysis** - Attribution and debugging
- **Causal Primitives** - Typed techniques for causal reasoning

---

## 1. Problem Statement

### The Graph Traversal Limitation

Current impact analysis uses dependency graph traversal:

```typescript
// Current approach: graph traversal
const affected = await librarian.getAffectedEntities('function:parseConfig');
// Returns: ['function:validateConfig', 'function:loadConfig', 'test:config.test.ts', ...]

// Problems:
// 1. Shows ALL possibly affected entities (overapproximation)
// 2. No probability or strength of impact
// 3. Cannot distinguish direct vs indirect effects
// 4. Cannot answer "what would happen if..."
// 5. Cannot trace root causes backward
```

### What Graph Traversal Cannot Answer

| Question | Graph Traversal | Causal Reasoning |
|----------|----------------|------------------|
| "What might be affected?" | Yes (overapproximates) | Yes (precise) |
| "What will likely break?" | No | Yes (with probabilities) |
| "How strong is the impact?" | No | Yes (causal strength) |
| "What if I hadn't changed X?" | No | Yes (counterfactual) |
| "Why did Y fail?" | No | Yes (root cause) |

### Theoretical Foundation

**Pearl's Insight (2000)**: Causal reasoning requires distinguishing:
- **Observation**: P(Y | X=x) - "Given X=x, what's the probability of Y?"
- **Intervention**: P(Y | do(X=x)) - "If we SET X to x, what happens to Y?"
- **Counterfactual**: P(Y_x | X=x', Y=y') - "Given X was x' and Y was y', what would Y be if X had been x?"

These three levels form the **Ladder of Causation**:
1. **Association** (seeing): Correlations and predictions
2. **Intervention** (doing): Effects of actions
3. **Counterfactual** (imagining): What-if reasoning

Librarian needs all three levels to truly understand code impact.

---

## 2. Causal Model Types

### Part 1: Core Type Definitions

```typescript
/**
 * A causal model represents the causal structure of a system.
 *
 * TYPES:
 * - DAG: Directed Acyclic Graph (purely structural)
 * - SCM: Structural Causal Model (with functional mechanisms)
 * - CBN: Causal Bayesian Network (with probabilistic distributions)
 */

/**
 * Base causal model interface.
 * All causal models share this structure.
 */
interface CausalModel {
  /** Unique identifier for this model */
  id: string;

  /** Model type */
  type: 'dag' | 'scm' | 'cbn';

  /** Variables (nodes) in the causal graph */
  variables: CausalVariable[];

  /** Directed edges representing causal relationships */
  edges: CausalEdge[];

  /** When this model was constructed */
  builtAt: Date;

  /** Confidence in the model structure */
  confidence: ConfidenceValue;

  /** Metadata about model construction */
  metadata: CausalModelMetadata;
}

/**
 * A variable in the causal model.
 * Can represent code entities, states, or observations.
 */
interface CausalVariable {
  /** Variable identifier (often an EntityId) */
  id: string;

  /** Human-readable name */
  name: string;

  /** What kind of variable */
  kind: CausalVariableKind;

  /** Domain of possible values */
  domain: VariableDomain;

  /** Is this an observed variable or latent/hidden? */
  observed: boolean;

  /** Is this an exogenous (external) or endogenous (internal) variable? */
  exogenous: boolean;
}

type CausalVariableKind =
  | 'entity'           // Code entity (function, class, module)
  | 'state'            // System state (config, environment)
  | 'behavior'         // Behavioral property (returns X, throws Y)
  | 'test_outcome'     // Test result
  | 'metric'           // Performance/quality metric
  | 'event';           // External event (deploy, commit)

interface VariableDomain {
  /** Domain type */
  type: 'binary' | 'categorical' | 'ordinal' | 'continuous';

  /** Possible values (for discrete domains) */
  values?: string[];

  /** Range (for continuous domains) */
  range?: { min: number; max: number };
}

/**
 * A directed edge representing a causal relationship.
 */
interface CausalEdge {
  /** Source variable (the cause) */
  source: string;

  /** Target variable (the effect) */
  target: string;

  /** Type of causal mechanism */
  mechanism: CausalMechanism;

  /** Strength of causal relationship (0 = no effect, 1 = deterministic) */
  strength: ConfidenceValue;

  /** Evidence supporting this edge */
  evidence: EdgeEvidence[];
}

type CausalMechanism =
  | 'invocation'        // Caller invokes callee
  | 'data_flow'         // Data flows from producer to consumer
  | 'control_flow'      // Control flow dependency
  | 'type_dependency'   // Type definition affects type users
  | 'configuration'     // Config affects configured behavior
  | 'test_coverage'     // Implementation affects test outcome
  | 'temporal'          // Temporal precedence (A happens before B)
  | 'co_occurrence';    // Historical co-occurrence (learned from data)

interface EdgeEvidence {
  /** Type of evidence */
  type: 'structural' | 'historical' | 'runtime' | 'documentation';

  /** Evidence details */
  details: string;

  /** Confidence in this evidence */
  confidence: ConfidenceValue;
}
```

### Structural Causal Model (SCM)

```typescript
/**
 * Structural Causal Model extends the basic DAG with functional mechanisms.
 *
 * An SCM defines, for each variable V:
 *   V = f_V(PA(V), U_V)
 *
 * Where:
 * - PA(V) are the parents (direct causes) of V
 * - U_V is the exogenous noise/error term
 * - f_V is the structural function
 */
interface StructuralCausalModel extends CausalModel {
  type: 'scm';

  /** Structural functions for each endogenous variable */
  structuralFunctions: Map<string, StructuralFunction>;

  /** Distribution of exogenous variables */
  exogenousDistributions: Map<string, Distribution>;
}

interface StructuralFunction {
  /** Variable this function computes */
  variable: string;

  /** Parent variables (inputs) */
  parents: string[];

  /** The function definition */
  function: CausalFunctionDef;
}

type CausalFunctionDef =
  | DeterministicFunction
  | StochasticFunction
  | NeuralFunction;

interface DeterministicFunction {
  type: 'deterministic';

  /** Symbolic expression (e.g., "AND(parent1, parent2)") */
  expression: string;

  /** Evaluation function */
  evaluate: (parents: Map<string, unknown>) => unknown;
}

interface StochasticFunction {
  type: 'stochastic';

  /** Distribution family */
  distribution: DistributionFamily;

  /** How parents affect distribution parameters */
  parameterMapping: (parents: Map<string, unknown>) => DistributionParams;
}

interface NeuralFunction {
  type: 'neural';

  /** Learned function (e.g., from historical data) */
  modelId: string;

  /** Uncertainty in predictions */
  uncertainty: ConfidenceValue;
}
```

### Causal Bayesian Network (CBN)

```typescript
/**
 * Causal Bayesian Network extends SCM with full probabilistic semantics.
 * Enables probabilistic inference under interventions.
 */
interface CausalBayesianNetwork extends CausalModel {
  type: 'cbn';

  /** Conditional probability distributions P(V | PA(V)) */
  conditionalDistributions: Map<string, ConditionalDistribution>;

  /** Joint distribution (can be derived from conditionals and graph) */
  jointDistribution?: JointDistribution;
}

interface ConditionalDistribution {
  /** Variable */
  variable: string;

  /** Parents (conditioning variables) */
  parents: string[];

  /** Probability table or function */
  distribution: Distribution;
}

interface Distribution {
  type: 'table' | 'gaussian' | 'mixture' | 'empirical';

  /** For table: P(V | pa1, pa2, ...) */
  table?: Map<string, number>;

  /** For parametric: parameters */
  parameters?: DistributionParams;

  /** For empirical: samples */
  samples?: unknown[];
}

type DistributionParams = {
  mean?: number;
  variance?: number;
  probabilities?: number[];
  [key: string]: unknown;
};
```

### Model Metadata

```typescript
interface CausalModelMetadata {
  /** How was this model constructed? */
  constructionMethod: ModelConstructionMethod;

  /** Sources used to build the model */
  sources: ModelSource[];

  /** Scope of the model (what part of codebase) */
  scope: ModelScope;

  /** Known limitations */
  limitations: string[];

  /** Model version for updates */
  version: number;
}

type ModelConstructionMethod =
  | 'structural_analysis'   // Built from code structure
  | 'historical_learning'   // Learned from git/runtime data
  | 'hybrid'                // Combined structural + learned
  | 'expert_specified';     // Manually specified

interface ModelSource {
  type: 'code_structure' | 'git_history' | 'runtime_trace' | 'documentation' | 'manual';
  details: string;
  confidence: ConfidenceValue;
}

interface ModelScope {
  /** Entities included in model */
  entities: string[];

  /** Time range (for temporal models) */
  timeRange?: { start: Date; end: Date };

  /** Completeness estimate */
  completeness: ConfidenceValue;
}
```

---

## 3. Causal Graph Construction

### Part 2: CausalGraphBuilder Interface

```typescript
/**
 * Builds causal models from various evidence sources.
 *
 * PRINCIPLE: Causal structure must be INFERRED, not assumed.
 * We use multiple evidence sources and combine them carefully.
 */
interface CausalGraphBuilder {
  /**
   * Build a causal model from all available sources.
   *
   * @param scope - What entities to include
   * @param sources - Which evidence sources to use
   * @returns A causal model with confidence-annotated edges
   */
  buildModel(
    scope: ModelScope,
    sources: CausalEvidenceSource[]
  ): Promise<CausalModel>;

  /**
   * Update an existing model with new evidence.
   *
   * @param model - Existing model
   * @param newEvidence - New evidence to incorporate
   * @returns Updated model
   */
  updateModel(
    model: CausalModel,
    newEvidence: CausalEvidence[]
  ): Promise<CausalModel>;

  /**
   * Validate model against observed data.
   *
   * @param model - Model to validate
   * @param observations - Observed data
   * @returns Validation result with discrepancies
   */
  validateModel(
    model: CausalModel,
    observations: Observation[]
  ): Promise<ModelValidationResult>;
}

type CausalEvidenceSource =
  | 'code_structure'    // AST, call graph, type system
  | 'git_history'       // Commits, PRs, blame
  | 'runtime_traces'    // Execution logs, profiles
  | 'documentation'     // Comments, READMEs, specs
  | 'test_results';     // Test runs, coverage

interface ModelValidationResult {
  /** Does model fit observations? */
  valid: boolean;

  /** Discrepancies found */
  discrepancies: ModelDiscrepancy[];

  /** Suggested model updates */
  suggestions: ModelUpdateSuggestion[];

  /** Overall fit score */
  fitScore: ConfidenceValue;
}
```

### Construction from Code Structure

```typescript
/**
 * Build causal edges from code structure.
 *
 * ALGORITHM:
 * 1. Extract dependency graph from AST
 * 2. REVERSE edges (dependency Y→X becomes cause X→Y)
 * 3. Classify edge types (invocation, data flow, type, etc.)
 * 4. Estimate initial strengths from coupling metrics
 */
async function buildFromCodeStructure(
  entities: Entity[],
  dependencyGraph: DependencyGraph
): Promise<CausalEdge[]> {
  const edges: CausalEdge[] = [];

  // Process dependencies
  for (const [entityId, dependencies] of dependencyGraph.dependencies) {
    for (const dep of dependencies) {
      // Dependency: entity depends on dep
      // Causally: changing dep may affect entity
      edges.push({
        source: dep.id,
        target: entityId,
        mechanism: classifyMechanism(dep.type),
        strength: computeInitialStrength(entityId, dep),
        evidence: [{
          type: 'structural',
          details: `${entityId} depends on ${dep.id} via ${dep.type}`,
          confidence: { type: 'deterministic', value: 1.0, reason: 'AST-verified dependency' }
        }]
      });
    }
  }

  // Process call graph
  for (const [callerId, callees] of dependencyGraph.callGraph) {
    for (const callee of callees) {
      edges.push({
        source: callee,
        target: callerId,
        mechanism: 'invocation',
        strength: computeCallStrength(callerId, callee),
        evidence: [{
          type: 'structural',
          details: `${callerId} calls ${callee}`,
          confidence: { type: 'deterministic', value: 1.0, reason: 'AST-verified call' }
        }]
      });
    }
  }

  return edges;
}

/**
 * Compute initial causal strength from coupling metrics.
 */
function computeInitialStrength(
  dependent: string,
  dependency: Dependency
): ConfidenceValue {
  // Use coupling metrics as proxy for causal strength
  // Higher coupling = changes more likely to propagate
  const coupling = dependency.couplingMetrics;

  return {
    type: 'bounded',
    low: coupling.minimum ?? 0.1,
    high: coupling.maximum ?? 0.9,
    basis: 'theoretical',
    citation: 'Coupling metrics as causal strength proxy (needs calibration)'
  };
}
```

### Construction from Git History

```typescript
/**
 * Learn causal relationships from git history.
 *
 * INSIGHT: If A and B frequently change together, there may be a causal link.
 * If changes to A are often followed by changes to B, A likely causes B.
 */
interface GitCausalLearner {
  /**
   * Learn causal edges from commit patterns.
   *
   * @param history - Git commit history
   * @param entities - Entities to analyze
   * @returns Learned causal edges with evidence
   */
  learnFromHistory(
    history: GitHistory,
    entities: Entity[]
  ): Promise<CausalEdge[]>;
}

async function learnFromGitHistory(
  history: GitHistory,
  entities: Entity[]
): Promise<CausalEdge[]> {
  const edges: CausalEdge[] = [];

  // Compute change co-occurrence
  const cooccurrence = computeChangeCooccurrence(history);

  // Compute temporal precedence (A changes, then B changes)
  const precedence = computeTemporalPrecedence(history);

  // Analyze bug-fix patterns (what changes fixed what bugs)
  const bugFixPatterns = analyzeBugFixPatterns(history);

  for (const entityA of entities) {
    for (const entityB of entities) {
      if (entityA.id === entityB.id) continue;

      const cooc = cooccurrence.get(`${entityA.id}:${entityB.id}`) ?? 0;
      const prec = precedence.get(`${entityA.id}:${entityB.id}`) ?? 0;
      const bugFix = bugFixPatterns.get(`${entityA.id}:${entityB.id}`) ?? 0;

      // If significant evidence, add edge
      if (cooc > 0.3 || prec > 0.3 || bugFix > 0.3) {
        edges.push({
          source: entityA.id,
          target: entityB.id,
          mechanism: 'co_occurrence',
          strength: {
            type: 'measured',
            value: Math.max(cooc, prec, bugFix),
            measurement: {
              datasetId: `git_history_${history.repoId}`,
              sampleSize: history.commits.length,
              accuracy: Math.max(cooc, prec, bugFix),
              confidenceInterval: [
                Math.max(0, Math.max(cooc, prec, bugFix) - 0.1),
                Math.min(1, Math.max(cooc, prec, bugFix) + 0.1)
              ],
              measuredAt: new Date()
            }
          },
          evidence: [{
            type: 'historical',
            details: `Co-occurrence: ${cooc.toFixed(2)}, Precedence: ${prec.toFixed(2)}, Bug-fix: ${bugFix.toFixed(2)}`,
            confidence: { type: 'measured', value: Math.max(cooc, prec, bugFix), measurement: { /* ... */ } }
          }]
        });
      }
    }
  }

  return edges;
}

/**
 * Compute change co-occurrence: P(A changes | B changes)
 */
function computeChangeCooccurrence(history: GitHistory): Map<string, number> {
  const cooccurrence = new Map<string, number>();

  for (const commit of history.commits) {
    const changedFiles = commit.changedFiles;

    // Count co-occurrences
    for (let i = 0; i < changedFiles.length; i++) {
      for (let j = i + 1; j < changedFiles.length; j++) {
        const key1 = `${changedFiles[i]}:${changedFiles[j]}`;
        const key2 = `${changedFiles[j]}:${changedFiles[i]}`;
        cooccurrence.set(key1, (cooccurrence.get(key1) ?? 0) + 1);
        cooccurrence.set(key2, (cooccurrence.get(key2) ?? 0) + 1);
      }
    }
  }

  // Normalize to [0, 1]
  const maxCount = Math.max(...cooccurrence.values());
  for (const [key, count] of cooccurrence) {
    cooccurrence.set(key, count / maxCount);
  }

  return cooccurrence;
}
```

### Construction from Runtime Traces

```typescript
/**
 * Learn causal relationships from runtime execution traces.
 *
 * INSIGHT: Actual execution order reveals true causal dependencies.
 * If A always executes before B, and B's behavior depends on A's output,
 * then A causally affects B.
 */
interface RuntimeCausalLearner {
  /**
   * Learn causal edges from execution traces.
   *
   * @param traces - Execution traces
   * @returns Learned causal edges
   */
  learnFromTraces(traces: ExecutionTrace[]): Promise<CausalEdge[]>;
}

async function learnFromRuntimeTraces(
  traces: ExecutionTrace[]
): Promise<CausalEdge[]> {
  const edges: CausalEdge[] = [];

  for (const trace of traces) {
    // Analyze call sequences
    const callSequences = extractCallSequences(trace);

    for (const sequence of callSequences) {
      for (let i = 0; i < sequence.length - 1; i++) {
        const caller = sequence[i];
        const callee = sequence[i + 1];

        // Check if callee uses caller's return value
        const dataFlowExists = checkDataFlow(caller, callee, trace);

        edges.push({
          source: caller.entityId,
          target: callee.entityId,
          mechanism: dataFlowExists ? 'data_flow' : 'control_flow',
          strength: {
            type: 'measured',
            value: dataFlowExists ? 0.9 : 0.5,
            measurement: {
              datasetId: `runtime_trace_${trace.id}`,
              sampleSize: traces.length,
              accuracy: dataFlowExists ? 0.9 : 0.5,
              confidenceInterval: [0.4, 0.95],
              measuredAt: new Date()
            }
          },
          evidence: [{
            type: 'runtime',
            details: `Observed in trace ${trace.id}: ${caller.entityId} → ${callee.entityId}`,
            confidence: { type: 'deterministic', value: 1.0, reason: 'Observed execution' }
          }]
        });
      }
    }
  }

  return deduplicateEdges(edges);
}
```

### Construction from Documentation

```typescript
/**
 * Extract causal relationships stated in documentation.
 *
 * INSIGHT: Documentation often explicitly states dependencies and effects.
 * "This function modifies X", "Depends on Y", "Affects Z"
 */
interface DocumentationCausalExtractor {
  /**
   * Extract causal claims from documentation.
   *
   * @param docs - Documentation content
   * @param entities - Known entities
   * @returns Extracted causal edges
   */
  extractFromDocumentation(
    docs: DocumentationContent[],
    entities: Entity[]
  ): Promise<CausalEdge[]>;
}

async function extractFromDocumentation(
  docs: DocumentationContent[],
  entities: Entity[],
  llmProvider: LLMProvider
): Promise<CausalEdge[]> {
  const edges: CausalEdge[] = [];

  for (const doc of docs) {
    // Use LLM to extract causal statements
    const causalStatements = await llmProvider.extractCausalStatements(doc.content);

    for (const statement of causalStatements) {
      // Match entities
      const sourceEntity = findEntity(statement.cause, entities);
      const targetEntity = findEntity(statement.effect, entities);

      if (sourceEntity && targetEntity) {
        edges.push({
          source: sourceEntity.id,
          target: targetEntity.id,
          mechanism: classifyMechanismFromStatement(statement),
          strength: {
            type: 'bounded',
            low: 0.3,
            high: 0.8,
            basis: 'expert_estimate',
            citation: 'Extracted from documentation (may be outdated or incorrect)'
          },
          evidence: [{
            type: 'documentation',
            details: `"${statement.originalText}" from ${doc.path}`,
            confidence: { type: 'absent', reason: 'uncalibrated' }
          }]
        });
      }
    }
  }

  return edges;
}
```

---

## 4. Do-Calculus Implementation

### Part 3: Intervention Semantics

```typescript
/**
 * Do-calculus implementation for computing intervention effects.
 *
 * KEY DISTINCTION:
 * - observe(X=x): Condition on X=x in the current distribution
 * - do(X=x): SET X to x, breaking all incoming causal arrows to X
 *
 * The do() operator removes confounding by cutting the causal links
 * from X's parents to X.
 */
interface DoCalculus {
  /**
   * Compute the effect of an intervention.
   * P(Y | do(X=x))
   *
   * @param model - Causal model
   * @param intervention - The do() operation
   * @param target - Variable to compute distribution for
   * @returns Distribution of target under intervention
   */
  intervene(
    model: CausalModel,
    intervention: Intervention,
    target: string
  ): Promise<InterventionResult>;

  /**
   * Compute causal effect: E[Y | do(X=x)] - E[Y | do(X=x')]
   *
   * @param model - Causal model
   * @param treatment - Variable to intervene on
   * @param treatmentValues - Values to compare (e.g., [changed, unchanged])
   * @param outcome - Outcome variable
   * @returns Causal effect estimate
   */
  computeCausalEffect(
    model: CausalModel,
    treatment: string,
    treatmentValues: [unknown, unknown],
    outcome: string
  ): Promise<CausalEffect>;
}

interface Intervention {
  /** Variable to intervene on */
  variable: string;

  /** Value to set */
  value: unknown;

  /** Type of intervention */
  type: 'hard' | 'soft';

  /** For soft interventions: distribution to shift to */
  targetDistribution?: Distribution;
}

interface InterventionResult {
  /** The intervention applied */
  intervention: Intervention;

  /** Target variable */
  target: string;

  /** Distribution of target under intervention */
  distribution: Distribution;

  /** Expected value */
  expectedValue?: number;

  /** Confidence in result */
  confidence: ConfidenceValue;

  /** Adjustment formula used (for transparency) */
  adjustmentFormula?: string;
}

interface CausalEffect {
  /** Treatment variable */
  treatment: string;

  /** Outcome variable */
  outcome: string;

  /** Average Treatment Effect: E[Y | do(X=1)] - E[Y | do(X=0)] */
  ate: number;

  /** Confidence interval for ATE */
  ateConfidenceInterval: [number, number];

  /** Confidence in estimate */
  confidence: ConfidenceValue;
}
```

### Implementing intervene()

```typescript
/**
 * Compute P(Y | do(X=x)) using the truncated factorization formula.
 *
 * For an SCM with variables V and edges E:
 *   P(V | do(X=x)) = Product over V_i not in X of P(V_i | PA(V_i))
 *                    evaluated at X=x
 *
 * This "truncates" the factorization by removing terms for X.
 */
async function intervene(
  model: CausalModel,
  intervention: Intervention,
  target: string
): Promise<InterventionResult> {
  // Step 1: Create intervened model (remove edges into X)
  const intervenedModel = applyIntervention(model, intervention);

  // Step 2: Check if target is identifiable from intervention
  const identifiable = checkIdentifiability(model, intervention.variable, target);

  if (!identifiable.identifiable) {
    return {
      intervention,
      target,
      distribution: { type: 'empirical', samples: [] },
      confidence: {
        type: 'absent',
        reason: 'not_applicable'
      }
    };
  }

  // Step 3: Apply adjustment formula
  const adjustedDistribution = await computeAdjustedDistribution(
    intervenedModel,
    intervention,
    target,
    identifiable.adjustmentSet
  );

  return {
    intervention,
    target,
    distribution: adjustedDistribution.distribution,
    expectedValue: adjustedDistribution.mean,
    confidence: {
      type: 'derived',
      value: adjustedDistribution.confidence,
      formula: `P(${target} | do(${intervention.variable}=${intervention.value}))`,
      inputs: [{ name: 'model_confidence', value: model.confidence }]
    },
    adjustmentFormula: identifiable.formula
  };
}

/**
 * Apply intervention to model by removing edges into the intervened variable.
 */
function applyIntervention(
  model: CausalModel,
  intervention: Intervention
): CausalModel {
  return {
    ...model,
    edges: model.edges.filter(edge => edge.target !== intervention.variable),
    metadata: {
      ...model.metadata,
      limitations: [
        ...model.metadata.limitations,
        `Intervened on ${intervention.variable} = ${intervention.value}`
      ]
    }
  };
}
```

### Backdoor and Frontdoor Criteria

```typescript
/**
 * Check if causal effect is identifiable and find adjustment set.
 *
 * BACKDOOR CRITERION (Pearl):
 * A set Z satisfies the backdoor criterion relative to (X, Y) if:
 * 1. No node in Z is a descendant of X
 * 2. Z blocks all backdoor paths from X to Y
 *
 * If backdoor satisfied: P(Y | do(X)) = Sum over Z of P(Y | X, Z) P(Z)
 */
interface IdentifiabilityChecker {
  /**
   * Check if P(Y | do(X)) is identifiable from observational data.
   */
  checkIdentifiability(
    model: CausalModel,
    treatment: string,
    outcome: string
  ): IdentifiabilityResult;

  /**
   * Find a valid adjustment set using backdoor criterion.
   */
  findBackdoorSet(
    model: CausalModel,
    treatment: string,
    outcome: string
  ): AdjustmentSet | null;

  /**
   * Find a valid adjustment set using frontdoor criterion.
   */
  findFrontdoorSet(
    model: CausalModel,
    treatment: string,
    outcome: string
  ): AdjustmentSet | null;
}

interface IdentifiabilityResult {
  /** Is the causal effect identifiable? */
  identifiable: boolean;

  /** Which criterion was used */
  criterion: 'backdoor' | 'frontdoor' | 'do_calculus' | 'none';

  /** Adjustment set (variables to condition on) */
  adjustmentSet?: string[];

  /** Adjustment formula */
  formula?: string;

  /** If not identifiable, why not */
  reason?: string;
}

interface AdjustmentSet {
  /** Variables to adjust for */
  variables: string[];

  /** Why this set is valid */
  justification: string;
}

/**
 * Find backdoor adjustment set.
 */
function findBackdoorSet(
  model: CausalModel,
  treatment: string,
  outcome: string
): AdjustmentSet | null {
  // Get descendants of treatment (cannot include these)
  const descendants = getDescendants(model, treatment);

  // Get all non-descendants as candidate adjusters
  const candidates = model.variables
    .map(v => v.id)
    .filter(v => v !== treatment && v !== outcome && !descendants.has(v));

  // Find minimal set that blocks all backdoor paths
  const backdoorPaths = findBackdoorPaths(model, treatment, outcome);

  // Use greedy algorithm to find blocking set
  const blockingSet: string[] = [];
  for (const path of backdoorPaths) {
    // Check if path is already blocked
    if (pathIsBlocked(path, blockingSet, model)) continue;

    // Find a candidate that blocks this path
    for (const candidate of candidates) {
      if (candidateBlocksPath(candidate, path, model)) {
        blockingSet.push(candidate);
        break;
      }
    }
  }

  // Verify the set is valid
  if (allPathsBlocked(backdoorPaths, blockingSet, model)) {
    return {
      variables: blockingSet,
      justification: `Blocks all ${backdoorPaths.length} backdoor paths`
    };
  }

  return null;
}
```

### Adjustment Formulas for Confounding

```typescript
/**
 * Apply backdoor adjustment formula.
 *
 * P(Y | do(X)) = Sum over Z of P(Y | X, Z) P(Z)
 */
async function applyBackdoorAdjustment(
  model: CausalModel,
  treatment: string,
  outcome: string,
  adjustmentSet: string[],
  treatmentValue: unknown
): Promise<AdjustedDistribution> {
  // If model is a CBN with tables, compute exactly
  if (model.type === 'cbn') {
    const cbn = model as CausalBayesianNetwork;
    return computeExactAdjustment(cbn, treatment, outcome, adjustmentSet, treatmentValue);
  }

  // Otherwise, use Monte Carlo estimation
  return monteCarloAdjustment(model, treatment, outcome, adjustmentSet, treatmentValue);
}

/**
 * Apply frontdoor adjustment formula.
 *
 * For X → M → Y with no backdoor from X to Y through M:
 * P(Y | do(X)) = Sum over M of P(M | X) Sum over X' of P(Y | M, X') P(X')
 */
async function applyFrontdoorAdjustment(
  model: CausalModel,
  treatment: string,
  outcome: string,
  mediator: string,
  treatmentValue: unknown
): Promise<AdjustedDistribution> {
  // Step 1: Compute P(M | do(X)) = P(M | X) (no backdoor from X to M)
  const mGivenDoX = await computeConditional(model, mediator, treatment, treatmentValue);

  // Step 2: Compute P(Y | do(M)) using backdoor adjustment on M → Y
  const yGivenDoM = await applyBackdoorAdjustment(model, mediator, outcome, [treatment], undefined);

  // Step 3: Combine using frontdoor formula
  return combineFrontdoor(mGivenDoX, yGivenDoM);
}
```

---

## 5. Counterfactual Reasoning

### Part 4: Counterfactual Queries

```typescript
/**
 * Counterfactual reasoning: "What would Y be if X had been x?"
 *
 * This is the highest level of the causal ladder.
 * Given what actually happened (observation), imagine what would have
 * happened under different circumstances.
 */
interface CounterfactualReasoner {
  /**
   * Answer a counterfactual query.
   *
   * @param model - Causal model (must be SCM for counterfactuals)
   * @param query - Counterfactual query
   * @returns Counterfactual answer
   */
  counterfactual(
    model: StructuralCausalModel,
    query: CounterfactualQuery
  ): Promise<CounterfactualResult>;
}

/**
 * A counterfactual query: "Given observation O, what would Y be if X had been x?"
 */
interface CounterfactualQuery {
  /** What was actually observed */
  observation: Observation;

  /** What we're imagining was different */
  hypothetical: Intervention;

  /** What we want to know about */
  target: string;

  /** Human-readable form of the question */
  naturalLanguage: string;
}

interface Observation {
  /** Observed variable values */
  values: Map<string, unknown>;

  /** When the observation was made */
  timestamp?: Date;

  /** Context of observation */
  context?: string;
}

interface CounterfactualResult {
  /** The query answered */
  query: CounterfactualQuery;

  /** What target would have been */
  hypotheticalValue: unknown;

  /** Distribution over possible values (for stochastic models) */
  distribution?: Distribution;

  /** How different from actual */
  difference: CounterfactualDifference;

  /** Confidence in the counterfactual */
  confidence: ConfidenceValue;

  /** Explanation of the reasoning */
  explanation: string;
}

interface CounterfactualDifference {
  /** Actual observed value */
  actual: unknown;

  /** Hypothetical value */
  hypothetical: unknown;

  /** Type of change */
  changeType: 'no_change' | 'value_change' | 'qualitative_change';

  /** Magnitude if applicable */
  magnitude?: number;
}
```

### Abduction-Action-Prediction Procedure

```typescript
/**
 * Three-step procedure for counterfactual reasoning (Pearl, 2000).
 *
 * 1. ABDUCTION: Given observations, infer exogenous noise values U
 * 2. ACTION: Modify model with intervention (cut edges, set values)
 * 3. PREDICTION: Compute target variable in modified model with inferred U
 */
async function computeCounterfactual(
  model: StructuralCausalModel,
  query: CounterfactualQuery
): Promise<CounterfactualResult> {
  // STEP 1: ABDUCTION
  // Given observations, infer the exogenous noise values
  const inferredNoise = await abduction(model, query.observation);

  // STEP 2: ACTION
  // Create modified model with intervention
  const modifiedModel = applyIntervention(model, query.hypothetical);

  // STEP 3: PREDICTION
  // Compute target in modified model using inferred noise
  const hypotheticalValue = await predict(modifiedModel, query.target, inferredNoise);

  // Compute actual value for comparison
  const actualValue = query.observation.values.get(query.target);

  return {
    query,
    hypotheticalValue,
    difference: computeDifference(actualValue, hypotheticalValue),
    confidence: deriveCounterfactualConfidence(model, inferredNoise),
    explanation: generateCounterfactualExplanation(query, actualValue, hypotheticalValue, model)
  };
}

/**
 * Abduction: Infer exogenous noise values from observations.
 *
 * For each observed variable V with structural equation V = f(PA(V), U_V):
 * Solve for U_V given observed V and PA(V).
 */
async function abduction(
  model: StructuralCausalModel,
  observation: Observation
): Promise<Map<string, unknown>> {
  const noise = new Map<string, unknown>();

  // Topological sort (ancestors before descendants)
  const sortedVars = topologicalSort(model);

  for (const variable of sortedVars) {
    if (observation.values.has(variable)) {
      const observedValue = observation.values.get(variable);
      const structuralFn = model.structuralFunctions.get(variable);

      if (structuralFn && structuralFn.function.type === 'deterministic') {
        // Solve for noise: U = f^{-1}(observed, parents)
        const parentValues = getParentValues(variable, observation.values, model);
        const inferredNoise = invertStructuralFunction(
          structuralFn.function,
          observedValue,
          parentValues
        );
        noise.set(`U_${variable}`, inferredNoise);
      }
    }
  }

  return noise;
}

/**
 * Prediction: Compute target value in modified model with inferred noise.
 */
async function predict(
  model: StructuralCausalModel,
  target: string,
  noise: Map<string, unknown>
): Promise<unknown> {
  // Topological sort
  const sortedVars = topologicalSort(model);
  const computed = new Map<string, unknown>();

  for (const variable of sortedVars) {
    const structuralFn = model.structuralFunctions.get(variable);

    if (structuralFn) {
      const parentValues = new Map<string, unknown>();
      for (const parent of structuralFn.parents) {
        parentValues.set(parent, computed.get(parent));
      }

      // Add noise
      const noiseValue = noise.get(`U_${variable}`);

      // Evaluate structural function
      const value = evaluateStructuralFunction(
        structuralFn.function,
        parentValues,
        noiseValue
      );

      computed.set(variable, value);
    }
  }

  return computed.get(target);
}
```

### Example: "What if we hadn't merged that PR?"

```typescript
/**
 * Real-world counterfactual example for code.
 */
async function whatIfNotMerged(
  model: StructuralCausalModel,
  prId: string,
  currentState: CodebaseState
): Promise<CounterfactualResult> {
  // Build observation from current state
  const observation: Observation = {
    values: new Map([
      ['pr_merged', true],
      ['tests_passing', currentState.testsPass],
      ['production_stable', currentState.productionStable],
      ['code_state', currentState.fileHashes]
    ])
  };

  // Hypothetical: PR was not merged
  const hypothetical: Intervention = {
    variable: 'pr_merged',
    value: false,
    type: 'hard'
  };

  // Query: What would test status be?
  const query: CounterfactualQuery = {
    observation,
    hypothetical,
    target: 'tests_passing',
    naturalLanguage: `If PR ${prId} had not been merged, would tests still be passing?`
  };

  return await computeCounterfactual(model, query);
}
```

---

## 6. Root Cause Analysis

### Part 5: Root Cause Analysis Engine

```typescript
/**
 * Root cause analysis for bugs, incidents, and failures.
 *
 * Uses causal model to trace backward from symptom to root cause,
 * and attribute responsibility among multiple factors.
 */
interface RootCauseAnalyzer {
  /**
   * Find root causes of an observed symptom.
   *
   * @param model - Causal model
   * @param symptom - Observed failure/bug/incident
   * @returns Root cause analysis
   */
  rootCauseAnalysis(
    model: CausalModel,
    symptom: Symptom
  ): Promise<RootCauseAnalysisResult>;

  /**
   * Attribute responsibility among multiple factors.
   * Uses Shapley values for fair attribution.
   *
   * @param model - Causal model
   * @param outcome - Outcome to attribute
   * @param factors - Potential causal factors
   * @returns Attribution for each factor
   */
  computeAttribution(
    model: CausalModel,
    outcome: string,
    factors: string[]
  ): Promise<CausalAttribution[]>;
}

interface Symptom {
  /** Variable representing the symptom */
  variable: string;

  /** Observed value (the "bad" state) */
  observedValue: unknown;

  /** Expected value (the "good" state) */
  expectedValue: unknown;

  /** When symptom was observed */
  observedAt: Date;

  /** Context */
  context?: Map<string, unknown>;
}

interface RootCauseAnalysisResult {
  /** The symptom analyzed */
  symptom: Symptom;

  /** Ranked list of root causes */
  rootCauses: RootCause[];

  /** Causal paths from each root cause to symptom */
  causalPaths: CausalPath[];

  /** Contributing factors (not root causes but amplifiers) */
  contributingFactors: ContributingFactor[];

  /** Confidence in analysis */
  confidence: ConfidenceValue;

  /** Recommended fixes */
  recommendations: FixRecommendation[];
}

interface RootCause {
  /** Entity identified as root cause */
  entity: string;

  /** What about this entity caused the issue */
  cause: string;

  /** Confidence that this is a root cause */
  confidence: ConfidenceValue;

  /** Attribution score (how much this contributed) */
  attributionScore: number;

  /** Evidence supporting this as root cause */
  evidence: CausalEvidence[];
}

interface CausalPath {
  /** Sequence of entities from root cause to symptom */
  entities: string[];

  /** Edges along the path */
  edges: CausalEdge[];

  /** Total path strength (product of edge strengths) */
  strength: ConfidenceValue;
}

interface ContributingFactor {
  /** Factor that contributed but isn't root cause */
  entity: string;

  /** How it contributed */
  contribution: string;

  /** Would issue have occurred without this factor? */
  necessary: 'yes' | 'no' | 'uncertain';
}

interface FixRecommendation {
  /** What to fix */
  target: string;

  /** Recommended action */
  action: string;

  /** Expected impact on symptom */
  expectedImpact: string;

  /** Confidence in recommendation */
  confidence: ConfidenceValue;
}
```

### Root Cause Tracing Algorithm

```typescript
/**
 * Find root causes by tracing causal paths backward.
 */
async function findRootCauses(
  model: CausalModel,
  symptom: Symptom
): Promise<RootCauseAnalysisResult> {
  // Step 1: Find all ancestors of symptom (potential causes)
  const ancestors = getAncestors(model, symptom.variable);

  // Step 2: Find all causal paths from ancestors to symptom
  const paths = findCausalPaths(model, ancestors, symptom.variable);

  // Step 3: Score each ancestor by causal contribution
  const attributions = await computeAttributions(
    model,
    symptom.variable,
    ancestors
  );

  // Step 4: Identify root causes (high attribution, no further upstream causes)
  const rootCauses = identifyRootCauses(ancestors, attributions, model);

  // Step 5: Generate fix recommendations
  const recommendations = generateRecommendations(rootCauses, paths, model);

  return {
    symptom,
    rootCauses,
    causalPaths: paths,
    contributingFactors: identifyContributingFactors(ancestors, rootCauses, attributions),
    confidence: deriveAnalysisConfidence(model, paths),
    recommendations
  };
}

/**
 * Find all causal paths from potential causes to symptom.
 */
function findCausalPaths(
  model: CausalModel,
  sources: Set<string>,
  target: string
): CausalPath[] {
  const paths: CausalPath[] = [];

  // DFS from each source
  for (const source of sources) {
    const foundPaths = dfsAllPaths(model, source, target);
    paths.push(...foundPaths);
  }

  // Sort by path strength (strongest first)
  return paths.sort((a, b) => getNumericValue(b.strength) - getNumericValue(a.strength));
}

/**
 * Identify true root causes from candidate ancestors.
 * Root cause: High attribution, and either exogenous or all parents have low attribution.
 */
function identifyRootCauses(
  ancestors: Set<string>,
  attributions: Map<string, number>,
  model: CausalModel
): RootCause[] {
  const rootCauses: RootCause[] = [];

  for (const ancestor of ancestors) {
    const attribution = attributions.get(ancestor) ?? 0;

    // Skip low attribution
    if (attribution < 0.1) continue;

    // Check if this is a "root" (exogenous or parents have lower attribution)
    const variable = model.variables.find(v => v.id === ancestor);
    const isExogenous = variable?.exogenous ?? false;

    const parents = getParents(model, ancestor);
    const parentsHaveLowerAttribution = parents.every(p => {
      const parentAttribution = attributions.get(p) ?? 0;
      return parentAttribution < attribution * 0.5;
    });

    if (isExogenous || parentsHaveLowerAttribution) {
      rootCauses.push({
        entity: ancestor,
        cause: 'Identified via backward causal tracing',
        confidence: {
          type: 'derived',
          value: attribution,
          formula: 'Shapley attribution score',
          inputs: []
        },
        attributionScore: attribution,
        evidence: gatherEvidence(model, ancestor)
      });
    }
  }

  return rootCauses.sort((a, b) => b.attributionScore - a.attributionScore);
}
```

### Causal Attribution with Shapley Values

```typescript
/**
 * Compute fair attribution using Shapley values.
 *
 * Shapley value for factor i:
 *   phi_i = Sum over subsets S not containing i of
 *           [|S|!(n-|S|-1)!/n!] * [v(S ∪ {i}) - v(S)]
 *
 * Where v(S) is the "value" (here: causal effect) with factors S present.
 */
interface CausalAttribution {
  /** Factor being attributed */
  factor: string;

  /** Shapley value (0-1, sums to 1 across factors) */
  shapleyValue: number;

  /** Marginal contribution */
  marginalContribution: number;

  /** Confidence in attribution */
  confidence: ConfidenceValue;
}

async function computeShapleyAttribution(
  model: CausalModel,
  outcome: string,
  factors: string[]
): Promise<CausalAttribution[]> {
  const n = factors.length;
  const shapleyValues = new Map<string, number>();

  // Initialize
  for (const factor of factors) {
    shapleyValues.set(factor, 0);
  }

  // For each subset S
  for (let mask = 0; mask < (1 << n); mask++) {
    const S = factors.filter((_, i) => (mask & (1 << i)) !== 0);

    // For each factor not in S
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) continue;

      const factor = factors[i];

      // v(S ∪ {i}) - v(S)
      const vWithFactor = await computeValue(model, outcome, [...S, factor]);
      const vWithoutFactor = await computeValue(model, outcome, S);
      const marginal = vWithFactor - vWithoutFactor;

      // Weight: |S|!(n-|S|-1)!/n!
      const weight = factorial(S.length) * factorial(n - S.length - 1) / factorial(n);

      shapleyValues.set(
        factor,
        shapleyValues.get(factor)! + weight * marginal
      );
    }
  }

  // Normalize to sum to 1
  const total = [...shapleyValues.values()].reduce((a, b) => a + b, 0);

  return factors.map(factor => ({
    factor,
    shapleyValue: shapleyValues.get(factor)! / total,
    marginalContribution: shapleyValues.get(factor)!,
    confidence: {
      type: 'derived',
      value: 0.8, // Depends on model quality
      formula: 'Shapley value computation',
      inputs: [{ name: 'model_confidence', value: model.confidence }]
    }
  }));
}

/**
 * Compute "value" of a coalition of factors.
 * Here: the causal effect on outcome when these factors are "activated".
 */
async function computeValue(
  model: CausalModel,
  outcome: string,
  activeFactors: string[]
): Promise<number> {
  // Intervene to set active factors to their "active" state
  // and inactive factors to their "inactive" state
  let interventionEffect = 0;

  for (const factor of activeFactors) {
    const effect = await computeSingleFactorEffect(model, factor, outcome);
    interventionEffect += effect;
  }

  return interventionEffect;
}
```

### Integration with Debugging Workflow

```typescript
/**
 * Integration point: Root cause analysis for debugging.
 */
interface DebuggingIntegration {
  /**
   * Analyze a test failure to find root cause.
   */
  analyzeTestFailure(
    failure: TestFailure,
    codebaseState: CodebaseState
  ): Promise<RootCauseAnalysisResult>;

  /**
   * Analyze a production incident.
   */
  analyzeIncident(
    incident: ProductionIncident,
    model: CausalModel
  ): Promise<RootCauseAnalysisResult>;

  /**
   * Suggest debug steps based on causal analysis.
   */
  suggestDebugSteps(
    analysis: RootCauseAnalysisResult
  ): DebugStep[];
}

interface TestFailure {
  testId: string;
  testName: string;
  errorMessage: string;
  stackTrace?: string;
  failedAt: Date;
  recentChanges: CodeChange[];
}

interface ProductionIncident {
  incidentId: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedServices: string[];
  startTime: Date;
  metrics: Map<string, number[]>;
}

interface DebugStep {
  order: number;
  action: string;
  target: string;
  expectedOutcome: string;
  confidence: ConfidenceValue;
}
```

---

## 7. Causal Primitives

### Part 6: Typed Technique Primitives

```typescript
/**
 * Causal reasoning primitives for the technique catalog.
 * Each primitive has typed inputs, outputs, and confidence semantics.
 */

/**
 * tp_causal_graph_build
 *
 * Construct a causal model from available evidence sources.
 */
interface CausalGraphBuildPrimitive {
  id: 'tp_causal_graph_build';

  input: {
    /** Scope of model to build */
    scope: ModelScope;

    /** Which evidence sources to use */
    sources: CausalEvidenceSource[];

    /** Model type to construct */
    modelType: 'dag' | 'scm' | 'cbn';
  };

  output: {
    /** Constructed causal model */
    model: CausalModel;

    /** Build statistics */
    stats: {
      variableCount: number;
      edgeCount: number;
      sourceBreakdown: Map<CausalEvidenceSource, number>;
    };

    /** Confidence in model structure */
    confidence: ConfidenceValue;
  };

  /** Expected confidence type */
  expectedConfidenceType: 'bounded' | 'measured';

  /** Failure modes */
  failureModes: [
    'insufficient_evidence',
    'cyclic_structure',
    'scope_too_large',
    'sources_unavailable'
  ];
}

/**
 * tp_intervention_analyze
 *
 * Analyze what happens if we do(X=x).
 */
interface InterventionAnalyzePrimitive {
  id: 'tp_intervention_analyze';

  input: {
    /** Causal model */
    model: CausalModel;

    /** Intervention to analyze */
    intervention: Intervention;

    /** Target variables to compute effects for */
    targets: string[];
  };

  output: {
    /** Effects on each target */
    effects: InterventionResult[];

    /** Summary of analysis */
    summary: string;

    /** Confidence in analysis */
    confidence: ConfidenceValue;
  };

  /** Expected confidence type */
  expectedConfidenceType: 'derived';

  /** Failure modes */
  failureModes: [
    'target_not_identifiable',
    'model_incomplete',
    'intervention_invalid'
  ];
}

/**
 * tp_counterfactual_query
 *
 * Answer "what would have happened if Y?"
 */
interface CounterfactualQueryPrimitive {
  id: 'tp_counterfactual_query';

  input: {
    /** Structural causal model (required for counterfactuals) */
    model: StructuralCausalModel;

    /** Counterfactual query */
    query: CounterfactualQuery;
  };

  output: {
    /** Counterfactual result */
    result: CounterfactualResult;

    /** Natural language explanation */
    explanation: string;

    /** Confidence in counterfactual */
    confidence: ConfidenceValue;
  };

  /** Expected confidence type */
  expectedConfidenceType: 'derived';

  /** Failure modes */
  failureModes: [
    'model_not_scm',
    'observation_incomplete',
    'structural_function_not_invertible',
    'counterfactual_undefined'
  ];
}

/**
 * tp_root_cause_find
 *
 * Find root cause of a symptom/failure.
 */
interface RootCauseFindPrimitive {
  id: 'tp_root_cause_find';

  input: {
    /** Causal model */
    model: CausalModel;

    /** Observed symptom */
    symptom: Symptom;

    /** Maximum depth to search */
    maxDepth?: number;
  };

  output: {
    /** Root cause analysis result */
    analysis: RootCauseAnalysisResult;

    /** Confidence in analysis */
    confidence: ConfidenceValue;
  };

  /** Expected confidence type */
  expectedConfidenceType: 'derived';

  /** Failure modes */
  failureModes: [
    'symptom_not_in_model',
    'no_ancestors_found',
    'attribution_failed',
    'multiple_competing_causes'
  ];
}

/**
 * tp_causal_explain
 *
 * Generate natural language explanation of a causal chain.
 */
interface CausalExplainPrimitive {
  id: 'tp_causal_explain';

  input: {
    /** Causal model */
    model: CausalModel;

    /** Path or analysis to explain */
    subject: CausalPath | RootCauseAnalysisResult | CounterfactualResult;

    /** Audience level */
    audience: 'technical' | 'non_technical';
  };

  output: {
    /** Natural language explanation */
    explanation: string;

    /** Key insights */
    insights: string[];

    /** Visual representation (mermaid diagram) */
    diagram?: string;

    /** Confidence in explanation accuracy */
    confidence: ConfidenceValue;
  };

  /** Expected confidence type */
  expectedConfidenceType: 'absent'; // LLM-generated

  /** Failure modes */
  failureModes: [
    'subject_too_complex',
    'llm_unavailable'
  ];
}
```

### Primitive Implementation Registry

```typescript
/**
 * Registry of causal reasoning primitives.
 */
const CAUSAL_PRIMITIVES = {
  tp_causal_graph_build: {
    execute: buildCausalModel,
    validate: validateBuildInput,
    estimateCost: estimateBuildCost,
  },

  tp_intervention_analyze: {
    execute: analyzeIntervention,
    validate: validateInterventionInput,
    estimateCost: () => ({ llmCalls: 0, complexity: 'O(V*E)' }),
  },

  tp_counterfactual_query: {
    execute: computeCounterfactual,
    validate: validateCounterfactualInput,
    estimateCost: () => ({ llmCalls: 0, complexity: 'O(V^2)' }),
  },

  tp_root_cause_find: {
    execute: findRootCauses,
    validate: validateRootCauseInput,
    estimateCost: estimateRootCauseCost,
  },

  tp_causal_explain: {
    execute: generateCausalExplanation,
    validate: validateExplainInput,
    estimateCost: () => ({ llmCalls: 1, complexity: 'O(1)' }),
  },
} as const;
```

---

## 8. Integration Points

### Part 7: System Integration

```typescript
/**
 * Integration with Librarian's evidence graph.
 *
 * Claims in the evidence graph can have causal support:
 * "This function returns X BECAUSE it processes Y"
 */
interface EvidenceGraphIntegration {
  /**
   * Add causal support to a claim.
   */
  addCausalSupport(
    claim: Claim,
    causalPath: CausalPath
  ): EvidenceEntry;

  /**
   * Query claims with causal explanations.
   */
  queryWithCausalExplanation(
    query: string
  ): Promise<ClaimWithCausalSupport[]>;
}

interface ClaimWithCausalSupport {
  claim: Claim;
  causalSupport?: {
    cause: string;
    effect: string;
    path: CausalPath;
    strength: ConfidenceValue;
  };
}
```

```typescript
/**
 * Integration with debugging subsystem.
 */
interface DebuggingSubsystemIntegration {
  /**
   * Use causal model to diagnose failures.
   */
  diagnoseWithCausalModel(
    failure: Failure,
    model: CausalModel
  ): Promise<Diagnosis>;

  /**
   * Suggest fixes based on root cause analysis.
   */
  suggestFixes(
    diagnosis: Diagnosis
  ): Promise<FixSuggestion[]>;
}

interface Diagnosis {
  rootCauses: RootCause[];
  causalChain: CausalPath;
  confidence: ConfidenceValue;
}

interface FixSuggestion {
  target: string;
  action: string;
  expectedOutcome: string;
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
  confidence: ConfidenceValue;
}
```

```typescript
/**
 * Integration with planning subsystem.
 *
 * Before executing a plan, predict causal consequences.
 */
interface PlanningIntegration {
  /**
   * Predict consequences of a planned action.
   */
  predictConsequences(
    plan: Plan,
    model: CausalModel
  ): Promise<ConsequencePrediction>;

  /**
   * Identify risky actions based on causal analysis.
   */
  identifyRisks(
    plan: Plan,
    model: CausalModel
  ): Promise<RiskAssessment[]>;
}

interface ConsequencePrediction {
  /** Direct effects */
  directEffects: InterventionResult[];

  /** Indirect effects (through causal chains) */
  indirectEffects: InterventionResult[];

  /** Potential side effects */
  sideEffects: InterventionResult[];

  /** Overall risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Confidence in prediction */
  confidence: ConfidenceValue;
}

interface RiskAssessment {
  action: string;
  risk: string;
  probability: ConfidenceValue;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
}
```

```typescript
/**
 * Integration with learning subsystem.
 *
 * Use causal attribution to understand why outcomes occurred.
 */
interface LearningIntegration {
  /**
   * Attribute outcome to causal factors.
   */
  attributeOutcome(
    outcome: TaskOutcome,
    factors: string[],
    model: CausalModel
  ): Promise<CausalAttribution[]>;

  /**
   * Learn from outcomes to improve model.
   */
  updateModelFromOutcome(
    model: CausalModel,
    outcome: TaskOutcome,
    attribution: CausalAttribution[]
  ): Promise<CausalModel>;
}

interface TaskOutcome {
  taskId: string;
  success: boolean;
  metrics: Map<string, number>;
  context: Map<string, unknown>;
}
```

---

## 9. Implementation Roadmap

### Phase 1: Core Types (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/types.ts

// Deliverables:
// - CausalModel, CausalEdge, CausalVariable types
// - StructuralCausalModel, CausalBayesianNetwork types
// - Intervention, CounterfactualQuery types
```

**Estimated effort**: 1 day

### Phase 2: Graph Construction (~250 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/builder.ts

// Deliverables:
// - CausalGraphBuilder implementation
// - Construction from code structure
// - Construction from git history
// - Edge deduplication and merging
```

**Estimated effort**: 2 days

### Phase 3: Do-Calculus (~300 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/do_calculus.ts

// Deliverables:
// - intervene() implementation
// - Backdoor criterion implementation
// - Frontdoor criterion implementation
// - Adjustment formula computation
```

**Estimated effort**: 3 days

### Phase 4: Counterfactual Reasoning (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/counterfactual.ts

// Deliverables:
// - Abduction-action-prediction procedure
// - counterfactual() implementation
// - Difference computation
// - Explanation generation
```

**Estimated effort**: 2 days

### Phase 5: Root Cause Analysis (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/root_cause.ts

// Deliverables:
// - rootCauseAnalysis() implementation
// - Causal path finding
// - Shapley attribution
// - Fix recommendations
```

**Estimated effort**: 2 days

### Phase 6: Primitives and Integration (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/primitives.ts
// - src/librarian/api/causal/integration.ts

// Deliverables:
// - Primitive implementations
// - Evidence graph integration
// - Debugging integration
// - Learning integration
```

**Estimated effort**: 2 days

### Phase 7: Tests (~350 LOC)

```typescript
// Files to create:
// - src/librarian/api/causal/__tests__/builder.test.ts
// - src/librarian/api/causal/__tests__/do_calculus.test.ts
// - src/librarian/api/causal/__tests__/counterfactual.test.ts
// - src/librarian/api/causal/__tests__/root_cause.test.ts

// Deliverables:
// - Unit tests for all modules
// - Integration tests
// - Example scenarios
```

**Estimated effort**: 2 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types | 150 | 1 |
| Graph Construction | 250 | 2 |
| Do-Calculus | 300 | 3 |
| Counterfactual | 200 | 2 |
| Root Cause | 200 | 2 |
| Primitives/Integration | 150 | 2 |
| Tests | 350 | 2 |
| **Total** | **~1,600** | **~14** |

---

## 10. Acceptance Criteria

### Core Functionality

- [ ] CausalModel can represent DAG, SCM, and CBN
- [ ] CausalEdge includes mechanism type and strength (as ConfidenceValue)
- [ ] All confidence values use ConfidenceValue type (no raw numbers)

### Graph Construction

- [ ] Can build causal model from code structure
- [ ] Can learn causal edges from git history
- [ ] Can combine multiple evidence sources
- [ ] Edge strengths are calibrated from historical data (when available)

### Do-Calculus

- [ ] `intervene()` correctly removes edges to intervened variable
- [ ] Backdoor criterion correctly identifies adjustment sets
- [ ] Frontdoor criterion works when backdoor fails
- [ ] Adjustment formulas produce correct distributions

### Counterfactual Reasoning

- [ ] Abduction correctly infers exogenous noise from observations
- [ ] Prediction uses inferred noise in modified model
- [ ] Can answer "what if" questions about code changes
- [ ] Explanations are human-readable

### Root Cause Analysis

- [ ] Can trace backward from symptom to root causes
- [ ] Shapley attribution fairly distributes responsibility
- [ ] Recommendations are actionable
- [ ] Integration with debugging workflow works

### Primitives

- [ ] All 5 primitives implemented and registered
- [ ] Each primitive has typed input/output
- [ ] Each primitive handles failure modes gracefully
- [ ] Confidence semantics are correct for each primitive

---

## 11. Evidence Commands

```bash
# Run causal reasoning tests
cd packages/librarian && npx vitest run src/api/causal/__tests__/

# Verify exports
node -e "import('librarian').then(m => console.log(Object.keys(m).filter(k => k.includes('Causal'))))"

# Build causal model for a real codebase (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts causal-model /path/to/codebase

# Analyze intervention effect
cd packages/librarian && npx tsx src/cli/index.ts intervene --entity function:parseConfig --change "modify return type"

# Run counterfactual query
cd packages/librarian && npx tsx src/cli/index.ts counterfactual --what-if "PR 123 not merged" --target tests_passing

# Find root cause
cd packages/librarian && npx tsx src/cli/index.ts root-cause --symptom "test:auth.test.ts failing"

# Check implementation status
ls -la packages/librarian/src/api/causal/
```

---

## 12. References

- Pearl, J. (2000). *Causality: Models, Reasoning, and Inference*. Cambridge University Press.
- Pearl, J. (2009). *Causal inference in statistics: An overview*. Statistics Surveys, 3, 96-146.
- Pearl, J., Glymour, M., & Jewell, N. P. (2016). *Causal Inference in Statistics: A Primer*. Wiley.
- Peters, J., Janzing, D., & Scholkopf, B. (2017). *Elements of Causal Inference*. MIT Press.
- Shapley, L. S. (1953). A value for n-person games. *Contributions to the Theory of Games*, 2, 307-317.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification extracted from THEORETICAL_CRITIQUE.md Part XVII.C |
