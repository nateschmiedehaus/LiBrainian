# Composition Language Investigation

Status: Investigation Complete
Scope: Assessing whether LiBrainian needs a deeper composition language or DSL
Last Verified: 2026-01-28
Owner: Architecture Review
Evidence: Code analysis of src/api/technique_library.ts, src/strategic/techniques.ts, src/api/pattern_catalog.ts, src/api/composition_selector.ts, and related files

## Executive Summary

**VERDICT: DO NOT IMPLEMENT (with partial exception)**

After a comprehensive review of LiBrainian's existing composition infrastructure, I conclude that LiBrainian **already has** a sophisticated composition language embedded in its technique primitive and composition systems. The existing system provides:

1. **119+ technique primitives** covering cognitive, procedural, epistemic, diagnostic, and orchestrating concerns
2. **26 operator types** (sequence, parallel, conditional, loop, gate, fallback, merge, fanout, retry, escalate, checkpoint, etc.)
3. **24 relationship types** (depends_on, blocks, parallel_with, enables, verifies, produces, consumes, etc.)
4. **Composition patterns with archetypes** (investigation, verification, construction, transformation, analysis, coordination, recovery, optimization, evolution)
5. **Semantic selection** with intent matching, keyword fallback, and learning integration
6. **Evolution engine** that discovers patterns, proposes compositions, and suggests mutations from execution traces

The question is not whether to build a composition language, but whether to **formalize and expose** the existing implicit language. The marginal benefit of a formal DSL is low because:
- The existing TypeScript type system already provides strong contracts
- The operator interpreter framework already supports runtime composition
- The learning loop already enables dynamic adaptation
- Adding a parser/compiler layer would increase complexity without clear user benefit

**Exception**: A lightweight declarative YAML/JSON schema for **external agent configuration** would be valuable for non-TypeScript integrations (e.g., Claude Code MCP tools, Cursor extensions).

## Current State Analysis

### Existing Primitives (119+ as of analysis)

The technique library (`src/api/technique_library.ts`) contains a rich set of primitives organized by category:

| Category | Count | Examples |
|----------|-------|----------|
| Framing/Analysis | 10+ | `tp_clarify_goal`, `tp_list_constraints`, `tp_decompose`, `tp_assumption_audit` |
| Debugging/Investigation | 8+ | `tp_hypothesis`, `tp_bisect`, `tp_min_repro`, `tp_root_cause`, `tp_instrument` |
| Verification/Quality | 10+ | `tp_verify_plan`, `tp_review_tests`, `tp_test_gap_analysis`, `tp_assurance_case` |
| Security/Risk | 8+ | `tp_threat_model`, `tp_security_abuse_cases`, `tp_risk_scan`, `tp_prompt_injection_scan` |
| Coordination | 8+ | `tp_blackboard_coordination`, `tp_contract_net_leasing`, `tp_arbitration`, `tp_deliberate` |
| Evidence/Artifact | 10+ | `tp_evidence_pack`, `tp_artifact_envelope`, `tp_replay_pack`, `tp_research_evidence_pack` |
| Operations/Recovery | 8+ | `tp_self_healing`, `tp_graceful_degradation`, `tp_slo_definition`, `tp_recover_from_checkpoint` |
| Meta/Evolution | 12+ | `tp_self_bootstrap`, `tp_hebbian_learning`, `tp_novelty_search`, `tp_evolution_tournament` |
| Domain-Specific | 15+ | `tp_algorithm_trace`, `tp_media_pipeline`, `tp_scale_pattern`, `tp_data_lineage` |

Each primitive has:
- **Formal contract**: inputs, outputs, preconditions, postconditions, invariants
- **JSON Schema validation**: inputSchema, outputSchema with type safety
- **Semantic metadata**: category, semanticProfileId, primitiveKind, abstractionLevel, domains
- **Failure modes**: explicit enumeration of how the primitive can fail
- **Confidence tracking**: optional ConfidenceValue with calibration support

### Existing Composition Mechanisms

#### 1. TechniqueComposition (src/strategic/techniques.ts)

```typescript
interface TechniqueComposition {
  id: string;
  name: string;
  description: string;
  primitiveIds: string[];           // Ordered list of primitives
  operators?: TechniqueOperator[];  // Control flow operators
  relationships?: TechniqueRelationship[];  // Dependencies and flows
  graphVersion?: 1 | 2;             // Schema versioning
}
```

#### 2. TechniqueOperator Types (26 built-in)

| Operator | Purpose | Example Use |
|----------|---------|-------------|
| `sequence` | Ordered execution | Ensure planning precedes execution |
| `parallel` | Concurrent execution | Run independent verification sweeps |
| `conditional` | Branch on state | Choose path based on context |
| `loop` | Iterate until condition | Hypothesis-test cycles |
| `gate` | Stop if condition met | Block release on missing evidence |
| `fallback` | Try alternatives | Graceful degradation paths |
| `merge` | Combine outputs | Join parallel results |
| `fanout`/`fanin` | Distribute/collect | Multi-agent task distribution |
| `retry` | Retry on failure | Transient error handling |
| `escalate` | Promote to human | Risk escalation paths |
| `checkpoint` | Save state | Resumable execution |
| `timebox` | Time limit | Budget enforcement |
| `quorum`/`consensus` | Multi-agent agreement | Byzantine verification |
| `circuit_breaker` | Failure isolation | Service protection |

#### 3. TechniqueRelationship Types (24 built-in)

Dependencies: `depends_on`, `blocks`, `parallel_with`, `enables`
Data flow: `produces`, `consumes`, `requires_context`, `affects`, `causes`
Verification: `verifies`, `validates`, `evidence_for`, `invalidates`
Evolution: `refines`, `supersedes`, `fallback_for`, `derived_from`
Semantic: `reinforces`, `conflicts_with`, `covers`, `duplicate_of`, `equivalent_to`, `alternative_to`, `mitigates`

#### 4. CompositionPattern Catalog (src/api/pattern_catalog.ts)

The pattern catalog provides meta-level composition guidance:

```typescript
interface CompositionPattern {
  id: PatternId;
  archetype: CompositionArchetype;
  situations: Situation[];           // When to apply
  corePrimitives: PrimitiveId[];     // Required primitives
  optionalPrimitives: OptionalPrimitive[];  // Context-dependent additions
  operators: OperatorRecommendation[];  // Suggested control flow
  antiPatterns: AntiPattern[];       // What NOT to do
  successSignals: string[];
  failureSignals: string[];
}
```

**15 built-in patterns** covering:
- Bug Investigation, Performance Investigation
- Change Verification, Release Verification
- Feature Construction, Safe Refactoring
- Multi-Agent Coordination, Self-Improvement
- Codebase Onboarding, Security Audit, API Design Review
- Incident Response, Dependency Update
- Technical Debt Assessment, Test Generation, Documentation

#### 5. TechniqueCompositionBuilder (src/api/technique_composition_builder.ts)

A fluent builder API for programmatic composition construction:

```typescript
const composition = new TechniqueCompositionBuilder({
  id: 'tc_custom',
  name: 'Custom workflow',
  description: 'Build custom compositions',
})
  .addPrimitive('tp_clarify_goal')
  .addPrimitive('tp_decompose', { after: 'tp_clarify_goal' })
  .addOperator({
    id: 'op_parallel',
    type: 'parallel',
    inputs: ['tp_hypothesis', 'tp_instrument'],
  })
  .relate('tp_clarify_goal', 'enables', 'tp_decompose')
  .build({ primitives, now: new Date().toISOString() });
```

#### 6. SemanticCompositionSelector (src/api/composition_selector.ts)

Selection modes:
- **semantic**: Embedding-based intent matching
- **keyword**: Fallback keyword matching
- **hybrid**: Combined approach

Learning integration:
- Records usage outcomes (success/failure)
- Boosts compositions based on historical success rate
- Integrates with LearningLoop for recommendations

#### 7. CompositionEvolutionEngine (src/api/composition_evolution.ts)

Automated evolution capabilities:
- **Pattern mining**: Discovers recurring primitive sequences
- **Composition proposals**: Generates new compositions from patterns
- **Mutation suggestions**: Recommends improvements to existing compositions
- **Deprecation identification**: Flags low-performing compositions

### Current Limitations

Despite the rich infrastructure, several limitations exist:

1. **No Text DSL**: Compositions must be defined in TypeScript; no human-readable text format
2. **Limited Dynamic Composition**: Runtime composition building requires code changes
3. **No Cross-Agent Portability**: Compositions are tightly coupled to the TypeScript runtime
4. **No Visual Editor**: No graphical composition builder
5. **Implicit Operator Semantics**: Operator behavior is implemented, not declaratively specified

## Gap Analysis

### Project Type Coverage

| Project Type | Current Support | Gaps |
|--------------|-----------------|------|
| Monorepos | `tp_repo_map`, `tp_arch_mapping`, `tp_dependency_map` | None significant |
| Microservices | `tp_distribution_map`, `tp_scale_pattern`, `tp_realtime_flow` | None significant |
| Legacy Codebases | `tp_via_negativa`, `tp_change_impact`, `tp_failure_mode_analysis` | None significant |
| ML/Data Pipelines | `tp_data_lineage`, `tp_algorithm_trace`, `tp_metric_trace` | None significant |
| Frontend Apps | `tp_component_graph`, `tp_artifact_trace`, `tp_timing_bound` | None significant |

**Finding**: Project type coverage is comprehensive via domain-specific primitives and compositions. No composition language needed.

### Agent Environment Coverage

| Agent Environment | Current Support | Integration Point |
|-------------------|-----------------|-------------------|
| Claude Code | MCP server tools | `src/mcp/tools/` |
| Cursor/Windsurf | Same MCP interface | Standard MCP protocol |
| Custom Agents | TypeScript API | `src/api/index.ts` |
| External Tools | REST/CLI (planned) | `src/cli/` |

**Finding**: Agent environments are served via the MCP protocol. A composition DSL wouldn't improve this; agents don't need to write compositions, they need to invoke them.

### Cognitive Demand Coverage

The 9 composition archetypes map directly to cognitive demands:

| Cognitive Demand | Archetype | Example Pattern |
|------------------|-----------|-----------------|
| Debugging | `investigation` | `pattern_bug_investigation` |
| Feature Implementation | `construction` | `pattern_feature_construction` |
| Code Review | `verification` | `pattern_change_verification` |
| Refactoring | `transformation` | `pattern_refactoring` |
| Architecture Analysis | `analysis` | `pattern_codebase_onboarding` |
| Incident Response | `recovery` | `pattern_incident_response` |
| Performance Tuning | `optimization` | `pattern_technical_debt` |
| Multi-Agent Work | `coordination` | `pattern_multi_agent_task` |
| Self-Improvement | `evolution` | `pattern_self_improvement` |

**Finding**: All major cognitive demands are covered by existing archetypes.

### Composition Pattern Expressibility

Testing what can and cannot be expressed:

| Pattern | Expressible? | How |
|---------|--------------|-----|
| Sequential execution | Yes | `primitiveIds` order + `sequence` operator |
| Parallel execution | Yes | `parallel` operator |
| Conditional branching | Yes | `conditional` operator with conditions |
| Loops with termination | Yes | `loop` operator with conditions |
| Nested compositions | Partial | Primitives reference other compositions |
| Dynamic primitive selection | Partial | Via LearningLoop recommendations |
| Cross-composition dependencies | Yes | `relationships` with inter-composition IDs |
| Budget-constrained execution | Yes | `timebox`, `budget_cap`, `throttle` operators |
| Consensus requirements | Yes | `quorum`, `consensus` operators |
| Failure recovery | Yes | `fallback`, `retry`, `circuit_breaker` operators |

**Finding**: The existing operator set covers all standard control flow patterns. The only gap is first-class composition nesting.

## Research Survey

### Related Systems

#### LangChain (Python)

LangChain uses a chain/agent abstraction:
- **Chains**: Linear sequences of operations
- **Agents**: Tool-calling loops with LLM decision-making
- **LCEL**: LangChain Expression Language for composition

LiBrainian comparison:
- LiBrainian's operator system is **more expressive** than LCEL (supports quorum, consensus, circuit breaker)
- LiBrainian has **stronger contracts** (JSON Schema, preconditions, postconditions)
- LangChain has a **text DSL** (LCEL); LiBrainian does not

#### DSPy (Stanford)

DSPy provides:
- **Signatures**: Input/output type specifications
- **Modules**: Composable prompt components
- **Optimizers**: Automatic prompt tuning

LiBrainian comparison:
- LiBrainian's primitives are analogous to DSPy signatures but **broader in scope**
- LiBrainian's LearningLoop is analogous to DSPy optimizers
- DSPy focuses on **prompt optimization**; LiBrainian focuses on **knowledge retrieval and reasoning**

#### Semantic Kernel (Microsoft)

Semantic Kernel offers:
- **Skills**: Reusable capabilities
- **Plans**: Generated execution plans
- **Connectors**: Integrations with external services

LiBrainian comparison:
- LiBrainian's primitives are richer than Semantic Kernel skills
- Both support **operator-based composition**
- Semantic Kernel has **dynamic planning** via LLM; LiBrainian has **pattern-based selection**

### Academic Research

Relevant papers and their implications:

1. **"Language Models as Compilers: Simulating Pseudocode Execution Improves Algorithmic Reasoning"** (2024)
   - Finding: Explicit step-by-step execution helps reasoning
   - Implication: LiBrainian's primitive decomposition is theoretically sound

2. **"DSL for LLM Workflow Orchestration"** (various workshop papers)
   - Finding: DSLs reduce errors in complex workflows
   - Implication: A DSL *could* help, but TypeScript types already provide this benefit

3. **"Executable Specifications for AI Systems"** (formal methods community)
   - Finding: Executable specs enable verification
   - Implication: LiBrainian's JSON Schema contracts serve this purpose

### State of Prompt Programming Languages

The field has explored:
- **LMQL**: Query language for LLMs with constraints
- **Guidance**: Grammar-constrained LLM output
- **Outlines**: JSON schema-constrained generation

LiBrainian's approach is different:
- Not constraining LLM output format
- Constraining **what knowledge to retrieve** and **how to compose reasoning**

## Cost-Benefit Analysis

### Benefits of a Formal Composition Language

| Benefit | Value | Already Achieved? |
|---------|-------|-------------------|
| Type safety | High | Yes (TypeScript + JSON Schema) |
| Composability | High | Yes (operators, relationships) |
| Learnability | Medium | Partial (requires TypeScript knowledge) |
| Portability | Medium | Partial (MCP interface is portable) |
| Visual editing | Low | No |
| Version control friendliness | Medium | Yes (JSON is diffable) |

### Costs of Building a Composition Language

| Cost | Magnitude | Justification |
|------|-----------|---------------|
| Parser/compiler implementation | High | 2-4 weeks of development |
| Language design | High | Potential for scope creep |
| Documentation | Medium | New concepts to explain |
| Maintenance burden | High | Two systems to keep in sync |
| Testing | Medium | New test surface |
| Migration | Medium | Existing compositions need conversion |

### Net Assessment

The **marginal benefit** of a composition language is **low** because:
1. TypeScript already provides strong typing
2. JSON/YAML can represent compositions declaratively
3. The builder API provides programmatic composition
4. The pattern catalog provides meta-level guidance

The **cost** is **medium-high** because:
1. Parser implementation is non-trivial
2. Language design requires careful thought
3. Two representations (TypeScript + DSL) create sync issues

**Conclusion**: The ROI is negative for a full DSL implementation.

## Recommendation

**VERDICT**: DO NOT IMPLEMENT (with partial exception)

**Reasoning**: LiBrainian already has a comprehensive composition system that is:
- Strongly typed via TypeScript
- Semantically rich via operators and relationships
- Learnable via the pattern catalog
- Evolvable via the evolution engine
- Selectable via semantic matching

### What DOES Exist That Addresses the Need

1. **`TechniqueComposition` interface** - Full composition definition
2. **`TechniqueCompositionBuilder`** - Fluent builder API
3. **`COMPOSITION_PATTERN_CATALOG`** - Meta-level guidance
4. **`SemanticCompositionSelector`** - Intent-based selection
5. **`CompositionEvolutionEngine`** - Automated evolution
6. **`OperatorInterpreterRegistry`** - Runtime execution

### Partial Exception: YAML/JSON Configuration Schema

For external agent integration, a **lightweight declarative schema** would be valuable:

```yaml
# Example: LiBrainian.composition.yaml
composition:
  id: tc_custom_review
  name: Custom Code Review
  description: Evidence-led review workflow
  primitives:
    - tp_assumption_audit
    - tp_change_impact
    - tp_verify_plan
  operators:
    - id: op_parallel_sweeps
      type: parallel
      inputs: [tp_assumption_audit, tp_change_impact]
  relationships:
    - from: tp_change_impact
      to: tp_verify_plan
      type: enables
```

This would:
- Enable configuration-driven composition without code changes
- Support agent environments that can't run TypeScript
- Maintain full compatibility with existing TypeScript types

**Proposed Work Unit** (if external agent configuration is prioritized):

| WU ID | Name | Description | Dependencies |
|-------|------|-------------|--------------|
| WU-COMPOSITION-YAML | Composition YAML Schema | Define JSON Schema for YAML composition files; add loader to parse into TechniqueComposition | None |
| WU-COMPOSITION-LOADER | Composition Loader CLI | Add `LiBrainian compose --file composition.yaml` command | WU-COMPOSITION-YAML |

**Estimated effort**: 3-5 days
**Priority**: Low (existing TypeScript API is sufficient for current use cases)

## Appendix: Code References

All paths are relative to repository root: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian`

| File | Purpose |
|------|---------|
| `src/api/technique_library.ts` | 119+ default primitives |
| `src/strategic/techniques.ts` | Type definitions, operators, relationships |
| `src/api/pattern_catalog.ts` | Composition patterns with archetypes |
| `src/api/composition_selector.ts` | Semantic/keyword selection |
| `src/api/technique_compositions.ts` | 25+ default compositions |
| `src/api/technique_composition_builder.ts` | Fluent builder API |
| `src/api/operator_interpreters.ts` | Runtime operator execution |
| `src/api/operator_registry.ts` | Operator registration and execution plans |
| `src/api/composition_evolution.ts` | Pattern mining and evolution |
| `src/api/learning_loop.ts` | Closed-loop learning |
