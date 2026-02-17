# Track F: Epistemology Infrastructure (E1-E4)

> **Source**: Extracted from THEORETICAL_CRITIQUE.md, Part XII.A (Problems 43-46)
> **Part References**: XII.A.43, XII.A.44, XII.A.45, XII.A.46
> **Purpose**: Address deep epistemological gaps: Gettier immunity, social epistemology, epistemic justice, and principled defeasibility
>
> **LiBrainian Story**: Chapter 7 (The Knowledge) - Beyond justified true belief to genuine understanding.
>
> **Dependency**: Requires Track D (ConfidenceValue types) and Track F Calibration (C1-C4). Uses evidence from epistemics module.

---

## Overview

This specification addresses four foundational epistemological problems that undermine LiBrainian's claim to produce genuine knowledge:

| Problem | Name | Core Issue |
|---------|------|------------|
| **P43** | Gettier Problem | Lucky truths mistaken for knowledge |
| **P44** | Social Epistemology | Missing multi-perspective reasoning |
| **P45** | Epistemic Injustice | LLM bias and underrepresentation |
| **P46** | Defeasibility Theory | Shallow defeater system |

### Track F Epistemology Features

| Priority | Feature | Problem | LOC | Dependencies |
|----------|---------|---------|-----|--------------|
| **E1** | Gettier Risk Assessment | P43 | ~250 | Q1-Q4, C1-C2 |
| **E2** | Social Epistemology Framework | P44 | ~300 | E1, epistemics module |
| **E3** | Epistemic Injustice Detection | P45 | ~200 | E2, evidence graph |
| **E4** | Extended Defeater Framework | P46 | ~350 | E1-E3, argumentation theory |

**Total estimated LOC**: ~1,100

---

## Part 1: Gettier Risk Assessment (E1) - Problem 43

### The Problem

> **Gettier (1963)**: Justified true belief is not sufficient for knowledge.

LiBrainian treats knowledge as justified true belief - but this is epistemologically naive. An agent can have:
- A **justified** belief ("this function returns a string" - based on type annotation)
- That belief can be **true** (the function does return a string)
- Yet the justification can be **accidentally correct** (the annotation is stale, but the implementation happens to match)

**Example Gettier Case in LiBrainian**:
1. LiBrainian claims: "Function `parseConfig` returns `Config` type" (confidence: 0.9)
2. Evidence: TypeScript annotation says `Config`
3. Reality: The annotation is wrong, but the function happens to return a `Config`-compatible object by coincidence
4. Status: **Justified, True, but NOT Knowledge** - the justification doesn't explain the truth

### Why This Matters

If agents act on Gettier-knowledge (justified, true, but accidentally so), they will fail when conditions change because their "knowledge" was never properly grounded. The justification was coincidental, not causal.

### Solution: Causal Justification Tracking

```typescript
/**
 * Gettier-immune knowledge requires that justification EXPLAINS why
 * the belief is true, not just that the belief happens to be true.
 *
 * This interface tracks the causal chain from evidence to conclusion.
 */
interface CausalJustification {
  /** The claim being justified */
  claim: Claim;

  /** The evidence chain - each step must causally support the next */
  evidenceChain: CausalLink[];

  /** Does the justification explain WHY the claim is true? */
  explanatoryPower: ExplanatoryAnalysis;

  /** Would the belief still be true if the justification were different? */
  counterfactualSensitivity: CounterfactualAnalysis;

  /** Is this belief "safe" - true in nearby possible worlds? */
  modalSafety: ModalSafetyAnalysis;

  /** Overall Gettier risk score */
  gettierRisk: GettierRiskScore;
}

interface CausalLink {
  /** Source evidence */
  from: EvidenceEntry;

  /** Target (either another evidence or the final claim) */
  to: EvidenceEntry | Claim;

  /** Type of causal relation */
  relation: CausalRelationType;

  /** Strength of causal connection */
  strength: ConfidenceValue;

  /** Could the conclusion hold without this link? */
  isEssential: boolean;
}

type CausalRelationType =
  | 'syntactic_entailment'   // AST structure directly entails conclusion
  | 'semantic_inference'     // Meaning-based inference
  | 'behavioral_observation' // Observed execution confirms
  | 'testimonial'            // From documentation/comments
  | 'abductive'              // Best explanation inference
  | 'inductive';             // Pattern-based generalization
```

### Counterfactual Sensitivity Analysis

```typescript
/**
 * Would the belief still be true if circumstances changed?
 *
 * A belief is Gettier-vulnerable if it would become false under
 * plausible alternative circumstances, even though it happens to be true now.
 */
interface CounterfactualAnalysis {
  /** The actual circumstances */
  actualCircumstances: Circumstance[];

  /** Nearby alternative circumstances examined */
  counterfactuals: CounterfactualWorld[];

  /** Is the belief stable across counterfactuals? */
  stability: 'stable' | 'fragile' | 'brittle';

  /** Which circumstances, if changed, would make belief false? */
  criticalDependencies: Circumstance[];
}

interface CounterfactualWorld {
  /** What's different in this world */
  variation: Circumstance;

  /** Would the belief still be true? */
  beliefStatus: 'still_true' | 'now_false' | 'indeterminate';

  /** Would the JUSTIFICATION still hold? */
  justificationStatus: 'still_valid' | 'now_invalid' | 'indeterminate';

  /** How close is this world to actual? (0 = identical, 1 = maximally different) */
  distance: number;
}

/**
 * Compute counterfactual sensitivity for a belief.
 *
 * METHOD: Generate nearby possible worlds by perturbing key circumstances,
 * then check if belief and justification hold in each world.
 */
function computeCounterfactualSensitivity(
  claim: Claim,
  justification: CausalJustification,
  codebaseState: CodebaseSnapshot
): CounterfactualAnalysis {
  const counterfactuals: CounterfactualWorld[] = [];

  // Generate perturbations based on justification type
  for (const link of justification.evidenceChain) {
    const perturbations = generatePerturbations(link, codebaseState);

    for (const perturbation of perturbations) {
      const world = evaluateCounterfactual(claim, perturbation);
      counterfactuals.push(world);
    }
  }

  // Classify stability
  const falseInNearbyWorld = counterfactuals.some(
    w => w.distance < 0.3 && w.beliefStatus === 'now_false'
  );
  const justificationFailsNearby = counterfactuals.some(
    w => w.distance < 0.3 && w.justificationStatus === 'now_invalid'
  );

  return {
    actualCircumstances: extractCircumstances(codebaseState),
    counterfactuals,
    stability: falseInNearbyWorld ? 'brittle' :
               justificationFailsNearby ? 'fragile' : 'stable',
    criticalDependencies: identifyCriticalDependencies(counterfactuals),
  };
}
```

### Modal Safety Analysis

```typescript
/**
 * Modal safety: Is the belief true in nearby possible worlds?
 *
 * From safety epistemology (Sosa, Williamson): knowledge requires that
 * the belief couldn't easily have been false.
 */
interface ModalSafetyAnalysis {
  /** Is belief true in most nearby worlds? */
  safe: boolean;

  /** How many nearby worlds examined */
  worldsExamined: number;

  /** In how many is the belief true? */
  worldsWhereTrue: number;

  /** What's the safety margin? */
  safetyMargin: ConfidenceValue;

  /** Nearest world where belief is false */
  nearestFalseWorld?: CounterfactualWorld;
}

/**
 * Compute modal safety using possible worlds semantics.
 *
 * A belief B is safe iff: in most nearby worlds where S believes B, B is true.
 * Nearness is measured by code structure similarity and git history.
 */
function computeModalSafety(
  claim: Claim,
  codebaseState: CodebaseSnapshot,
  gitHistory: GitHistoryCache
): ModalSafetyAnalysis {
  // Generate nearby possible worlds based on:
  // 1. Recent commits (what the code almost was)
  // 2. Open PRs (what the code might become)
  // 3. Structural variations (rename, refactor)

  const nearbyWorlds = generateNearbyWorlds(codebaseState, gitHistory);
  let trueCount = 0;
  let nearestFalse: CounterfactualWorld | undefined;
  let nearestFalseDistance = Infinity;

  for (const world of nearbyWorlds) {
    const beliefInWorld = evaluateClaimInWorld(claim, world);

    if (beliefInWorld) {
      trueCount++;
    } else if (world.distance < nearestFalseDistance) {
      nearestFalse = world;
      nearestFalseDistance = world.distance;
    }
  }

  const safetyRatio = trueCount / nearbyWorlds.length;

  return {
    safe: safetyRatio > 0.9 && nearestFalseDistance > 0.3,
    worldsExamined: nearbyWorlds.length,
    worldsWhereTrue: trueCount,
    safetyMargin: {
      type: 'measured',
      value: safetyRatio,
      measurement: {
        datasetId: 'modal_safety_analysis',
        sampleSize: nearbyWorlds.length,
        accuracy: safetyRatio,
        confidenceInterval: computeWilsonInterval(trueCount, nearbyWorlds.length, 0.95),
        measuredAt: new Date().toISOString(),
      },
    },
    nearestFalseWorld: nearestFalse,
  };
}
```

### Gettier Risk Score

```typescript
/**
 * Aggregate Gettier risk assessment.
 *
 * A claim has HIGH Gettier risk if:
 * - Justification is non-causal (coincidental)
 * - Belief is counterfactually fragile
 * - Belief is modally unsafe
 */
interface GettierRiskScore {
  /** Overall risk level */
  level: 'low' | 'medium' | 'high' | 'gettier_case';

  /** Numeric risk score (0 = no risk, 1 = certain Gettier case) */
  score: number;

  /** Breakdown of contributing factors */
  factors: {
    /** Is justification causal (explains truth)? */
    causalJustification: ConfidenceValue;

    /** Is belief counterfactually stable? */
    counterfactualStability: ConfidenceValue;

    /** Is belief modally safe? */
    modalSafety: ConfidenceValue;

    /** Does evidence chain have gaps? */
    evidenceCompleteness: ConfidenceValue;
  };

  /** Recommended action */
  recommendation: GettierRecommendation;
}

type GettierRecommendation =
  | { action: 'accept'; reason: string }
  | { action: 'strengthen_justification'; missingEvidence: string[] }
  | { action: 'demote_to_belief'; reason: string }
  | { action: 'flag_for_review'; concerns: string[] }
  | { action: 'reject'; reason: string };

/**
 * Compute overall Gettier risk for a justified belief.
 */
function computeGettierRisk(
  claim: Claim,
  justification: CausalJustification
): GettierRiskScore {
  const causalScore = assessCausalExplanation(justification);
  const counterfactualScore = justification.counterfactualSensitivity.stability === 'stable' ? 0.9 :
                              justification.counterfactualSensitivity.stability === 'fragile' ? 0.5 : 0.2;
  const modalScore = justification.modalSafety.safetyMargin;

  // Weighted combination (causal explanation is most important)
  const riskScore = 1 - (
    0.5 * getNumericValue(causalScore) +
    0.25 * counterfactualScore +
    0.25 * getNumericValue(modalScore)
  );

  const level = riskScore < 0.2 ? 'low' :
                riskScore < 0.4 ? 'medium' :
                riskScore < 0.7 ? 'high' : 'gettier_case';

  return {
    level,
    score: riskScore,
    factors: {
      causalJustification: causalScore,
      counterfactualStability: {
        type: 'derived',
        value: counterfactualScore,
        formula: 'stability_to_score(counterfactual_analysis)',
        inputs: [],
      },
      modalSafety: modalScore,
      evidenceCompleteness: assessEvidenceCompleteness(justification.evidenceChain),
    },
    recommendation: computeRecommendation(level, justification),
  };
}
```

### Acceptance Criteria (E1)

- [ ] `CausalJustification` interface implemented with evidence chain tracking
- [ ] `CausalLink` tracks relation type and essentiality
- [ ] `CounterfactualAnalysis` generates and evaluates nearby worlds
- [ ] `ModalSafetyAnalysis` computes safety margin with Wilson intervals
- [ ] `GettierRiskScore` aggregates factors into actionable recommendation
- [ ] All confidence values use `ConfidenceValue` type (no raw numbers)
- [ ] Integration with existing `Claim` and `EvidenceEntry` types
- [ ] ~250 LOC budget

---

## Part 2: Social Epistemology (E2) - Problem 44

### The Problem

> Knowledge is a social phenomenon, not just individual belief.

LiBrainian treats knowledge as an individual phenomenon. But codebases are **social artifacts**:
- Multiple developers with different expertise
- Different stakeholders (authors, reviewers, maintainers, users)
- Consensus and disagreement about design decisions
- Testimony from documentation, commits, and comments

### Why This Matters

Without social epistemology:
- No way to represent "the team believes X but reviewer Y disagrees"
- No framework for aggregating multiple perspectives
- No model of epistemic authority (who knows what)
- Testimony from comments/docs treated same as inference

### Solution: Multi-Perspective Knowledge Framework

```typescript
/**
 * Stakeholder perspective on a claim.
 *
 * Different stakeholders may have different views on the same claim,
 * and their views carry different epistemic weight depending on their role.
 */
interface StakeholderPerspective {
  /** Who holds this perspective */
  stakeholder: Stakeholder;

  /** Their view on the claim */
  stance: Stance;

  /** Evidence supporting their view */
  evidence: EvidenceEntry[];

  /** Epistemic authority in this domain */
  authorityLevel: AuthorityLevel;

  /** When this perspective was recorded */
  recordedAt: string;

  /** Source of this perspective (explicit statement vs inferred) */
  source: PerspectiveSource;
}

interface Stakeholder {
  /** Unique identifier (git author, role, etc.) */
  id: string;

  /** Type of stakeholder */
  type: StakeholderType;

  /** Areas of expertise (file paths, modules, domains) */
  expertise: ExpertiseDomain[];

  /** Historical accuracy (calibrated from past claims) */
  reliability: ConfidenceValue;
}

type StakeholderType =
  | 'author'        // Wrote the code
  | 'reviewer'      // Reviewed/approved the code
  | 'maintainer'    // Maintains the module
  | 'user'          // Uses the API/component
  | 'documentor'    // Wrote documentation
  | 'llm'           // LLM synthesis (LiBrainian itself)
  | 'test';         // Test suite (implicit stakeholder)

type Stance =
  | { type: 'affirm'; strength: ConfidenceValue }
  | { type: 'deny'; strength: ConfidenceValue }
  | { type: 'uncertain'; leaningToward?: 'affirm' | 'deny' }
  | { type: 'abstain'; reason: string };

interface AuthorityLevel {
  /** Domain of authority */
  domain: ExpertiseDomain;

  /** Level of authority in this domain */
  level: 'expert' | 'competent' | 'novice' | 'none';

  /** Evidence for authority level */
  evidence: AuthorityEvidence[];
}

type AuthorityEvidence =
  | { type: 'commit_history'; commits: number; recency: string }
  | { type: 'review_history'; reviews: number; acceptance_rate: number }
  | { type: 'ownership'; files: string[] }
  | { type: 'documentation'; authored: string[] }
  | { type: 'declared'; source: string };
```

### Consensus Level Framework

```typescript
/**
 * Level of agreement among stakeholders on a claim.
 */
enum ConsensusLevel {
  /** All relevant stakeholders agree */
  UNANIMOUS = 'unanimous',

  /** Most stakeholders agree, some dissent */
  MAJORITY = 'majority',

  /** Significant disagreement exists */
  CONTESTED = 'contested',

  /** Not enough perspectives to assess */
  UNKNOWN = 'unknown',
}

interface ConsensusAnalysis {
  /** Overall consensus level */
  level: ConsensusLevel;

  /** All perspectives considered */
  perspectives: StakeholderPerspective[];

  /** Weighted agreement score */
  agreementScore: ConfidenceValue;

  /** Breakdown by stakeholder type */
  byType: Map<StakeholderType, ConsensusLevel>;

  /** Notable dissent */
  dissent: DissentRecord[];

  /** Recommendation based on consensus */
  recommendation: ConsensusRecommendation;
}

interface DissentRecord {
  /** Who dissents */
  stakeholder: Stakeholder;

  /** Their contrary view */
  perspective: StakeholderPerspective;

  /** Weight of their dissent (based on authority) */
  weight: number;

  /** Has their concern been addressed? */
  addressed: boolean;
}

type ConsensusRecommendation =
  | { action: 'accept'; justification: string }
  | { action: 'investigate_dissent'; dissenters: Stakeholder[] }
  | { action: 'defer_to_authority'; authority: Stakeholder }
  | { action: 'escalate'; reason: string };
```

### Epistemic Authority Structures

```typescript
/**
 * Who has expertise in what areas?
 *
 * Authority is earned through demonstrated competence,
 * not just claimed or assumed.
 */
interface EpistemicAuthorityStructure {
  /** Domain -> authorities mapping */
  authorities: Map<ExpertiseDomain, AuthorityRanking>;

  /** How authority was computed */
  computationMethod: AuthorityComputationMethod;

  /** When last updated */
  computedAt: string;
}

interface AuthorityRanking {
  /** Domain of authority */
  domain: ExpertiseDomain;

  /** Ranked list of authorities */
  ranking: RankedAuthority[];

  /** Confidence in ranking */
  rankingConfidence: ConfidenceValue;
}

interface RankedAuthority {
  stakeholder: Stakeholder;
  score: number;
  evidence: AuthorityEvidence[];
}

type AuthorityComputationMethod =
  | 'git_history'       // Computed from commits, reviews, ownership
  | 'declared'          // Explicitly declared (CODEOWNERS, docs)
  | 'inferred'          // Inferred from behavior patterns
  | 'hybrid';           // Combination of methods

/**
 * Compute epistemic authority structure for a codebase.
 */
async function computeAuthorityStructure(
  gitHistory: GitHistoryCache,
  codeowners: CodeOwnersFile | null,
  teamManifest: TeamManifest | null
): Promise<EpistemicAuthorityStructure> {
  const authorities = new Map<ExpertiseDomain, AuthorityRanking>();

  // Extract domains from file structure
  const domains = extractExpertiseDomains(gitHistory);

  for (const domain of domains) {
    // Compute authority from git history
    const gitAuthority = await computeGitBasedAuthority(domain, gitHistory);

    // Incorporate declared ownership
    const declaredAuthority = codeowners
      ? extractDeclaredAuthority(domain, codeowners)
      : [];

    // Merge and rank
    const ranking = mergeAuthorityRankings(gitAuthority, declaredAuthority);

    authorities.set(domain, {
      domain,
      ranking,
      rankingConfidence: {
        type: 'derived',
        value: computeRankingConfidence(ranking),
        formula: 'mean(evidence_strength) * coverage',
        inputs: ranking.map(r => ({
          name: r.stakeholder.id,
          confidence: r.evidence[0]?.type === 'commit_history'
            ? { type: 'measured' as const, value: r.score, measurement: {
                datasetId: 'git_authority',
                sampleSize: (r.evidence[0] as { commits: number }).commits,
                accuracy: r.score,
                confidenceInterval: [r.score - 0.1, r.score + 0.1] as [number, number],
                measuredAt: new Date().toISOString(),
              }}
            : { type: 'absent' as const, reason: 'uncalibrated' as const },
        })),
      },
    });
  }

  return {
    authorities,
    computationMethod: codeowners ? 'hybrid' : 'git_history',
    computedAt: new Date().toISOString(),
  };
}
```

### Testimony Validation

```typescript
/**
 * When should we trust claims from different sources?
 *
 * Testimony (from docs, comments, commit messages) requires validation
 * based on source reliability and corroboration.
 */
interface TestimonyValidation {
  /** The testimonial claim */
  claim: Claim;

  /** Who made the claim */
  source: Stakeholder;

  /** Type of testimony */
  testimonyType: TestimonyType;

  /** Validation result */
  validation: ValidationResult;
}

type TestimonyType =
  | 'documentation'     // From README, docs, JSDoc
  | 'commit_message'    // From git history
  | 'code_comment'      // Inline comments
  | 'review_comment'    // PR review comments
  | 'issue_discussion'  // GitHub issues
  | 'external';         // External sources (Stack Overflow, etc.)

interface ValidationResult {
  /** Is the testimony trustworthy? */
  trustworthy: boolean;

  /** Confidence in trustworthiness assessment */
  confidence: ConfidenceValue;

  /** Factors considered */
  factors: {
    /** Source's track record */
    sourceReliability: ConfidenceValue;

    /** Does code corroborate testimony? */
    codeCorroboration: ConfidenceValue;

    /** Do other sources agree? */
    crossSourceAgreement: ConfidenceValue;

    /** How recent is the testimony? */
    recency: ConfidenceValue;

    /** Is the source authoritative in this domain? */
    domainAuthority: ConfidenceValue;
  };

  /** Recommendation */
  recommendation: TestimonyRecommendation;
}

type TestimonyRecommendation =
  | { action: 'accept'; justification: string }
  | { action: 'verify_against_code'; checks: string[] }
  | { action: 'seek_corroboration'; sources: string[] }
  | { action: 'demote_confidence'; reason: string }
  | { action: 'reject'; reason: string };

/**
 * Validate a testimonial claim.
 */
function validateTestimony(
  claim: Claim,
  source: Stakeholder,
  type: TestimonyType,
  authorityStructure: EpistemicAuthorityStructure,
  codebaseState: CodebaseSnapshot
): TestimonyValidation {
  // Compute source reliability from historical accuracy
  const sourceReliability = source.reliability;

  // Check if code corroborates the testimony
  const codeCorroboration = checkCodeCorroboration(claim, codebaseState);

  // Check for cross-source agreement
  const crossSourceAgreement = checkCrossSourceAgreement(claim, codebaseState);

  // Check recency
  const recency = computeRecencyScore(claim.evidence);

  // Check domain authority
  const domain = inferClaimDomain(claim);
  const domainAuthority = authorityStructure.authorities.get(domain)
    ?.ranking.find(r => r.stakeholder.id === source.id)
    ?.score ?? 0;

  // Aggregate factors
  const factors = {
    sourceReliability,
    codeCorroboration,
    crossSourceAgreement,
    recency,
    domainAuthority: {
      type: 'derived' as const,
      value: domainAuthority,
      formula: 'authority_ranking_score',
      inputs: [],
    },
  };

  // Compute overall trustworthiness
  const trustScore = aggregateTrustFactors(factors);
  const trustworthy = trustScore > 0.6;

  return {
    claim,
    source,
    testimonyType: type,
    validation: {
      trustworthy,
      confidence: {
        type: 'derived',
        value: trustScore,
        formula: 'weighted_mean(factors)',
        inputs: Object.entries(factors).map(([name, conf]) => ({ name, confidence: conf })),
      },
      factors,
      recommendation: computeTestimonyRecommendation(trustworthy, factors),
    },
  };
}
```

### Acceptance Criteria (E2)

- [ ] `StakeholderPerspective` interface with stance and authority
- [ ] `ConsensusLevel` enum with UNANIMOUS, MAJORITY, CONTESTED, UNKNOWN
- [ ] `ConsensusAnalysis` aggregates perspectives with weighted scoring
- [ ] `EpistemicAuthorityStructure` computed from git history and CODEOWNERS
- [ ] `TestimonyValidation` validates claims from documentation/comments
- [ ] All confidence values use `ConfidenceValue` type
- [ ] Integration with git history and evidence graph
- [ ] ~300 LOC budget

---

## Part 3: Epistemic Injustice Detection (E3) - Problem 45

### The Problem

> LLM synthesis inherits biases from training data.

LLM-based knowledge synthesis has systematic biases:
- **Overrepresents** patterns from popular repositories (React, Node, etc.)
- **Underrepresents** minority patterns (Elm, Haskell idioms, non-Western naming)
- **Hallucination risk** varies by domain (higher in niche areas)
- **Normative claims** ("best practice") reflect training data bias, not truth

### Why This Matters

Epistemic injustice occurs when:
- Minority patterns are flagged as "unusual" when they're legitimate
- "Best practices" from popular repos are treated as universal truth
- Confidence is miscalibrated for underrepresented domains
- Bias compounds across the knowledge graph

### Solution: Bias-Aware Knowledge Framework

```typescript
/**
 * Audit for representation bias in knowledge extraction.
 *
 * Detects when minority patterns might be underrepresented or
 * majority patterns might be over-privileged.
 */
interface RepresentationAudit {
  /** Domain being audited */
  domain: ExpertiseDomain;

  /** Representation metrics */
  metrics: RepresentationMetrics;

  /** Identified biases */
  biases: IdentifiedBias[];

  /** Recommended corrections */
  corrections: BiasCorrection[];

  /** Overall representation score */
  score: ConfidenceValue;
}

interface RepresentationMetrics {
  /** Pattern frequency vs expected frequency */
  patternDistribution: PatternDistribution[];

  /** Source diversity */
  sourceDiversity: SourceDiversityMetrics;

  /** Domain coverage */
  domainCoverage: DomainCoverageMetrics;

  /** Confidence calibration by domain */
  calibrationByDomain: Map<string, CalibrationMetrics>;
}

interface PatternDistribution {
  /** The pattern */
  pattern: string;

  /** Observed frequency in knowledge base */
  observedFrequency: number;

  /** Expected frequency (from diverse corpus) */
  expectedFrequency: number;

  /** Is this pattern over/underrepresented? */
  representation: 'over' | 'under' | 'fair';

  /** Ratio of observed to expected */
  ratio: number;
}

interface SourceDiversityMetrics {
  /** Number of unique sources */
  uniqueSources: number;

  /** Concentration (Gini coefficient) */
  concentration: number;

  /** Are minority sources represented? */
  minorityRepresentation: number;

  /** Source type distribution */
  typeDistribution: Map<string, number>;
}
```

### Normative Claim Flagging

```typescript
/**
 * Distinguish factual claims from normative claims.
 *
 * Normative claims ("this is best practice", "this is idiomatic")
 * are particularly susceptible to LLM bias and require flagging.
 */
interface NormativeClaimDetection {
  /** Is this claim normative? */
  isNormative: boolean;

  /** Confidence in normative classification */
  confidence: ConfidenceValue;

  /** Type of normative claim */
  normativeType?: NormativeClaimType;

  /** Evidence of normativity */
  evidence: NormativeEvidence[];

  /** Bias risk assessment */
  biasRisk: BiasRiskAssessment;
}

type NormativeClaimType =
  | 'best_practice'       // "This is the best way to..."
  | 'idiom'               // "This is idiomatic..."
  | 'anti_pattern'        // "This is an anti-pattern..."
  | 'style_preference'    // "The preferred style is..."
  | 'quality_judgment'    // "This code is good/bad..."
  | 'convention';         // "The convention is..."

interface NormativeEvidence {
  /** Signal that indicates normativity */
  signal: string;

  /** Strength of signal */
  strength: number;

  /** Source of signal */
  source: 'linguistic' | 'structural' | 'comparative';
}

interface BiasRiskAssessment {
  /** Overall bias risk level */
  level: 'low' | 'medium' | 'high';

  /** Risk factors */
  factors: {
    /** Is this from a majority pattern domain? */
    majorityPatternRisk: number;

    /** Is the source diverse enough? */
    sourceDiversityRisk: number;

    /** Is LLM confidence calibrated for this domain? */
    calibrationRisk: number;

    /** Are there dissenting perspectives? */
    dissentRisk: number;
  };

  /** Recommended mitigation */
  mitigation: BiasMitigation;
}

type BiasMitigation =
  | { action: 'proceed'; justification: string }
  | { action: 'flag_normative'; warning: string }
  | { action: 'seek_alternatives'; domains: string[] }
  | { action: 'lower_confidence'; factor: number }
  | { action: 'require_human_review'; reason: string };

/**
 * Detect if a claim is normative and assess bias risk.
 */
function detectNormativeClaim(
  claim: Claim,
  representationAudit: RepresentationAudit
): NormativeClaimDetection {
  // Linguistic analysis for normative markers
  const linguisticSignals = detectNormativeLanguage(claim.statement);

  // Check if claim makes comparative judgments
  const comparativeSignals = detectComparativeJudgments(claim);

  // Aggregate evidence
  const evidence: NormativeEvidence[] = [
    ...linguisticSignals.map(s => ({ signal: s.marker, strength: s.strength, source: 'linguistic' as const })),
    ...comparativeSignals.map(s => ({ signal: s.comparison, strength: s.strength, source: 'comparative' as const })),
  ];

  const isNormative = evidence.some(e => e.strength > 0.5);

  // Assess bias risk if normative
  const biasRisk = isNormative
    ? assessBiasRisk(claim, representationAudit)
    : { level: 'low' as const, factors: { majorityPatternRisk: 0, sourceDiversityRisk: 0, calibrationRisk: 0, dissentRisk: 0 }, mitigation: { action: 'proceed' as const, justification: 'Not normative' } };

  return {
    isNormative,
    confidence: {
      type: 'derived',
      value: Math.max(...evidence.map(e => e.strength), 0),
      formula: 'max(evidence_strengths)',
      inputs: evidence.map((e, i) => ({
        name: `evidence_${i}`,
        confidence: { type: 'deterministic' as const, value: e.strength > 0.5 ? 1.0 : 0.0, reason: e.signal },
      })),
    },
    normativeType: isNormative ? classifyNormativeType(evidence) : undefined,
    evidence,
    biasRisk,
  };
}
```

### Source Diversity Scoring

```typescript
/**
 * Score the diversity of knowledge sources.
 *
 * Diverse sources reduce bias risk and increase epistemic robustness.
 */
interface SourceDiversityScore {
  /** Overall diversity score (0-1) */
  score: ConfidenceValue;

  /** Breakdown by dimension */
  dimensions: {
    /** Repository diversity */
    reposDiversity: number;

    /** Language/framework diversity */
    languageDiversity: number;

    /** Author diversity */
    authorDiversity: number;

    /** Temporal diversity */
    temporalDiversity: number;

    /** Geographic/cultural diversity (when available) */
    culturalDiversity: number | null;
  };

  /** Concentration metrics */
  concentration: {
    /** Top-1 source percentage */
    top1Pct: number;

    /** Top-5 sources percentage */
    top5Pct: number;

    /** Gini coefficient */
    gini: number;

    /** Effective number of sources (1/sum(p^2)) */
    effectiveN: number;
  };

  /** Recommendations for improving diversity */
  recommendations: DiversityRecommendation[];
}

type DiversityRecommendation =
  | { type: 'seek_alternative_sources'; domains: string[] }
  | { type: 'reduce_majority_weight'; sources: string[]; factor: number }
  | { type: 'flag_monoculture_risk'; warning: string }
  | { type: 'acceptable'; justification: string };
```

### Bias-Aware Confidence Recalibration

```typescript
/**
 * Recalibrate confidence based on bias assessment.
 *
 * Lower confidence for claims with high bias risk;
 * increase uncertainty for underrepresented domains.
 */
interface BiasAwareCalibration {
  /** Original confidence */
  original: ConfidenceValue;

  /** Calibrated confidence after bias adjustment */
  calibrated: ConfidenceValue;

  /** Adjustment applied */
  adjustment: BiasAdjustment;

  /** Justification for adjustment */
  justification: string;
}

interface BiasAdjustment {
  /** Type of adjustment */
  type: 'none' | 'lower' | 'widen_interval' | 'flag_uncertain';

  /** Magnitude of adjustment */
  magnitude: number;

  /** Factors that triggered adjustment */
  triggers: string[];
}

/**
 * Apply bias-aware recalibration to confidence.
 */
function recalibrateForBias(
  confidence: ConfidenceValue,
  biasRisk: BiasRiskAssessment,
  normativeDetection: NormativeClaimDetection
): BiasAwareCalibration {
  // No adjustment for deterministic confidence
  if (confidence.type === 'deterministic') {
    return {
      original: confidence,
      calibrated: confidence,
      adjustment: { type: 'none', magnitude: 0, triggers: [] },
      justification: 'Deterministic confidence not subject to bias adjustment',
    };
  }

  // Compute adjustment magnitude based on bias risk
  const triggers: string[] = [];
  let adjustmentMagnitude = 0;

  if (biasRisk.factors.majorityPatternRisk > 0.5) {
    adjustmentMagnitude += 0.1;
    triggers.push('majority_pattern_risk');
  }

  if (biasRisk.factors.sourceDiversityRisk > 0.5) {
    adjustmentMagnitude += 0.1;
    triggers.push('source_diversity_risk');
  }

  if (normativeDetection.isNormative) {
    adjustmentMagnitude += 0.15;
    triggers.push('normative_claim');
  }

  if (biasRisk.factors.calibrationRisk > 0.5) {
    adjustmentMagnitude += 0.1;
    triggers.push('calibration_risk');
  }

  // Apply adjustment
  const originalValue = getNumericValue(confidence);
  const calibratedValue = Math.max(0, originalValue - adjustmentMagnitude);

  return {
    original: confidence,
    calibrated: {
      type: 'derived',
      value: calibratedValue,
      formula: `original - bias_adjustment(${adjustmentMagnitude.toFixed(2)})`,
      inputs: [{ name: 'original', confidence }],
    },
    adjustment: {
      type: adjustmentMagnitude > 0 ? 'lower' : 'none',
      magnitude: adjustmentMagnitude,
      triggers,
    },
    justification: triggers.length > 0
      ? `Confidence lowered by ${(adjustmentMagnitude * 100).toFixed(0)}% due to: ${triggers.join(', ')}`
      : 'No bias adjustment required',
  };
}
```

### Acceptance Criteria (E3)

- [ ] `RepresentationAudit` with pattern distribution and source diversity metrics
- [ ] `NormativeClaimDetection` identifies "best practice" claims
- [ ] `BiasRiskAssessment` quantifies bias risk factors
- [ ] `SourceDiversityScore` with concentration metrics (Gini, effective N)
- [ ] `BiasAwareCalibration` adjusts confidence for identified biases
- [ ] All confidence values use `ConfidenceValue` type
- [ ] Integration with LLM synthesis pipeline
- [ ] ~200 LOC budget

---

## Part 4: Extended Defeater Framework (E4) - Problem 46

### The Problem

> The current defeater system is shallow.

LiBrainian's defeater system distinguishes rebutting and undercutting defeaters, but doesn't implement:
- **Defeater hierarchies**: Some defeaters defeat other defeaters
- **Priority semantics**: When defeaters conflict, which wins?
- **Loop detection**: Defeater chains can be cyclic
- **Reinstatement**: Defeated arguments can be reinstated by new evidence

### Why This Matters

Without proper defeasibility:
- Simple counter-evidence defeats everything equally
- No way to model "this objection is itself objectionable"
- Cycles cause infinite regress
- Defeated claims can never recover, even with new evidence

### Solution: ASPIC+ Argumentation Framework

```typescript
/**
 * Argumentation engine based on ASPIC+ formal framework.
 *
 * Implements structured argumentation with:
 * - Attack relations (rebut, undercut, undermine)
 * - Priority semantics
 * - Extension-based semantics (grounded, preferred, stable)
 */
interface ArgumentationEngine {
  /** Add an argument to the framework */
  addArgument(argument: Argument): void;

  /** Add an attack relation */
  addAttack(attack: Attack): void;

  /** Compute defeat graph */
  computeDefeatGraph(): DefeatGraph;

  /** Compute argument acceptability under given semantics */
  computeAcceptability(semantics: AcceptanceSemantics): AcceptabilityResult;

  /** Check for cycles in the defeat graph */
  detectCycles(): Cycle[];

  /** Get the status of a specific argument */
  getStatus(argumentId: string, semantics: AcceptanceSemantics): ArgumentStatus;
}

/**
 * An argument in the ASPIC+ framework.
 *
 * Arguments are built from premises using inference rules.
 */
interface Argument {
  /** Unique identifier */
  id: string;

  /** Conclusion of the argument */
  conclusion: Claim;

  /** Premises (can be other arguments or axioms) */
  premises: (Argument | Axiom)[];

  /** Inference rule used */
  rule: InferenceRule;

  /** Strength of the argument */
  strength: ConfidenceValue;

  /** Is this a strict or defeasible argument? */
  type: 'strict' | 'defeasible';
}

interface Axiom {
  /** Unique identifier */
  id: string;

  /** The axiom (assumed true) */
  claim: Claim;

  /** Source of axiom */
  source: 'observation' | 'stipulation' | 'prior_knowledge';
}

interface InferenceRule {
  /** Rule identifier */
  id: string;

  /** Rule name */
  name: string;

  /** Is this a strict or defeasible rule? */
  type: 'strict' | 'defeasible';

  /** Rule priority (higher = stronger) */
  priority: number;
}
```

### Attack Relations

```typescript
/**
 * Attack relation between arguments.
 *
 * Three types of attack (ASPIC+):
 * - Rebut: Attack the conclusion
 * - Undercut: Attack the inference rule
 * - Undermine: Attack a premise
 */
interface Attack {
  /** Unique identifier */
  id: string;

  /** Attacking argument */
  attacker: Argument;

  /** Attacked argument */
  target: Argument;

  /** Type of attack */
  type: AttackType;

  /** Where in the target is the attack? */
  attackPoint: AttackPoint;

  /** Strength of attack */
  strength: ConfidenceValue;
}

type AttackType =
  | 'rebut'      // Attacker's conclusion contradicts target's conclusion
  | 'undercut'   // Attacker attacks the inference rule of target
  | 'undermine'; // Attacker attacks a premise of target

interface AttackPoint {
  /** What is being attacked */
  type: 'conclusion' | 'premise' | 'rule';

  /** Reference to the attacked element */
  reference: string;
}

/**
 * Determine if attack succeeds based on priorities.
 *
 * In ASPIC+, attacks succeed only if the attacker is at least as strong as
 * the attacked sub-argument.
 */
function attackSucceeds(
  attack: Attack,
  argumentPriorities: Map<string, number>,
  rulePriorities: Map<string, number>
): boolean {
  const attackerStrength = getArgumentStrength(attack.attacker, argumentPriorities, rulePriorities);
  const targetStrength = getTargetStrength(attack.target, attack.attackPoint, argumentPriorities, rulePriorities);

  // Attack succeeds if attacker is at least as strong
  return attackerStrength >= targetStrength;
}
```

### Defeat Graph

```typescript
/**
 * Defeat graph representation.
 *
 * A directed graph where nodes are arguments and edges are successful attacks (defeats).
 */
interface DefeatGraph {
  /** All arguments in the graph */
  arguments: Map<string, Argument>;

  /** Defeat edges (successful attacks only) */
  defeats: Defeat[];

  /** Reinstatement tracking */
  reinstatements: Reinstatement[];

  /** Detected cycles */
  cycles: Cycle[];

  /** Graph statistics */
  statistics: GraphStatistics;
}

interface Defeat {
  /** Attacking argument */
  attacker: string;

  /** Defeated argument */
  defeated: string;

  /** Original attack */
  attack: Attack;

  /** Is this defeat currently active? (considering reinstatement) */
  active: boolean;
}

interface Reinstatement {
  /** The reinstated argument */
  argument: string;

  /** What defeats the defeater */
  reinstater: string;

  /** Chain of reinstatement */
  chain: string[];
}

interface Cycle {
  /** Arguments in the cycle */
  arguments: string[];

  /** Edges forming the cycle */
  edges: Defeat[];

  /** Type of cycle */
  type: 'odd' | 'even';
}

interface GraphStatistics {
  /** Number of arguments */
  argumentCount: number;

  /** Number of defeats */
  defeatCount: number;

  /** Number of cycles */
  cycleCount: number;

  /** Maximum cycle length */
  maxCycleLength: number;

  /** Is the graph acyclic? */
  acyclic: boolean;

  /** Connectivity */
  stronglyConnectedComponents: number;
}
```

### Loop Detection

```typescript
/**
 * Detect cycles in the defeat graph.
 *
 * Uses Tarjan's algorithm for strongly connected components,
 * then filters for non-trivial cycles.
 */
function detectDefeaterCycles(graph: DefeatGraph): Cycle[] {
  const cycles: Cycle[] = [];

  // Find strongly connected components
  const sccs = tarjanSCC(graph);

  // Non-trivial SCCs are cycles
  for (const scc of sccs) {
    if (scc.length > 1) {
      const edges = extractCycleEdges(scc, graph.defeats);
      cycles.push({
        arguments: scc,
        edges,
        type: scc.length % 2 === 0 ? 'even' : 'odd',
      });
    }
  }

  return cycles;
}

/**
 * Tarjan's algorithm for strongly connected components.
 */
function tarjanSCC(graph: DefeatGraph): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let currentIndex = 0;

  function strongConnect(v: string) {
    index.set(v, currentIndex);
    lowlink.set(v, currentIndex);
    currentIndex++;
    stack.push(v);
    onStack.add(v);

    // Consider successors
    for (const defeat of graph.defeats) {
      if (defeat.attacker === v) {
        const w = defeat.defeated;
        if (!index.has(w)) {
          strongConnect(w);
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
        }
      }
    }

    // Root of SCC
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const argId of graph.arguments.keys()) {
    if (!index.has(argId)) {
      strongConnect(argId);
    }
  }

  return sccs;
}
```

### Acceptance Semantics

```typescript
/**
 * Extension-based acceptance semantics.
 *
 * Different semantics give different interpretations of "acceptable":
 * - Grounded: Most skeptical, unique extension
 * - Preferred: Maximal admissible sets
 * - Stable: Complete and conflict-free (may not exist)
 * - Credulous: Accepted in at least one preferred extension
 * - Skeptical: Accepted in all preferred extensions
 */
type AcceptanceSemantics =
  | 'grounded'    // Unique minimal extension
  | 'preferred'   // Maximal admissible sets
  | 'stable'      // Attack all non-members
  | 'credulous'   // In some preferred extension
  | 'skeptical';  // In all preferred extensions

interface AcceptabilityResult {
  /** Semantics used */
  semantics: AcceptanceSemantics;

  /** Extensions (sets of mutually acceptable arguments) */
  extensions: Extension[];

  /** Status of each argument */
  argumentStatuses: Map<string, ArgumentStatus>;

  /** Computation metadata */
  metadata: {
    computedAt: string;
    computationTimeMs: number;
    cyclesHandled: number;
  };
}

interface Extension {
  /** Arguments in this extension */
  arguments: Set<string>;

  /** Is this extension admissible? */
  admissible: boolean;

  /** Is this extension complete? */
  complete: boolean;

  /** Is this extension stable? */
  stable: boolean;
}

type ArgumentStatus =
  | { status: 'accepted'; extensions: string[] }
  | { status: 'rejected'; defeatedBy: string[] }
  | { status: 'undecided'; reason: string };

/**
 * Compute grounded extension (skeptical, unique).
 *
 * The grounded extension is the least fixed point of the characteristic
 * function: start with unattacked arguments, iteratively add arguments
 * defended by the current set.
 */
function computeGroundedExtension(graph: DefeatGraph): Extension {
  const accepted = new Set<string>();
  const rejected = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    for (const [argId, _] of graph.arguments) {
      if (accepted.has(argId) || rejected.has(argId)) continue;

      // Check if all attackers are rejected
      const attackers = graph.defeats
        .filter(d => d.defeated === argId && d.active)
        .map(d => d.attacker);

      if (attackers.every(a => rejected.has(a))) {
        // All attackers defeated - accept this argument
        accepted.add(argId);
        changed = true;
      } else if (attackers.some(a => accepted.has(a))) {
        // At least one attacker accepted - reject this argument
        rejected.add(argId);
        changed = true;
      }
    }
  }

  return {
    arguments: accepted,
    admissible: true,  // Grounded is always admissible
    complete: true,    // Grounded is always complete
    stable: rejected.size + accepted.size === graph.arguments.size,
  };
}

/**
 * Compute preferred extensions (credulous, multiple possible).
 */
function computePreferredExtensions(graph: DefeatGraph): Extension[] {
  // Start with grounded extension
  const grounded = computeGroundedExtension(graph);

  // Find maximal admissible extensions containing grounded
  const preferred: Extension[] = [];

  // Use branch-and-bound search for maximal admissible sets
  function findMaximalAdmissible(
    current: Set<string>,
    remaining: string[]
  ): void {
    // Check if current is admissible
    if (!isAdmissible(current, graph)) return;

    // Try to extend
    let canExtend = false;
    for (let i = 0; i < remaining.length; i++) {
      const arg = remaining[i];
      const extended = new Set(current);
      extended.add(arg);

      if (isAdmissible(extended, graph)) {
        canExtend = true;
        findMaximalAdmissible(extended, remaining.slice(i + 1));
      }
    }

    // If can't extend, this is maximal
    if (!canExtend) {
      // Check if this is actually maximal (not subset of existing)
      if (!preferred.some(ext => isSubset(current, ext.arguments))) {
        preferred.push({
          arguments: current,
          admissible: true,
          complete: isComplete(current, graph),
          stable: isStable(current, graph),
        });
      }
    }
  }

  const undecided = Array.from(graph.arguments.keys())
    .filter(a => !grounded.arguments.has(a));
  findMaximalAdmissible(grounded.arguments, undecided);

  return preferred.length > 0 ? preferred : [grounded];
}

function isAdmissible(extension: Set<string>, graph: DefeatGraph): boolean {
  // Conflict-free: no internal attacks
  for (const defeat of graph.defeats) {
    if (defeat.active &&
        extension.has(defeat.attacker) &&
        extension.has(defeat.defeated)) {
      return false;
    }
  }

  // Self-defending: defends all members
  for (const arg of extension) {
    const attackers = graph.defeats
      .filter(d => d.defeated === arg && d.active)
      .map(d => d.attacker);

    for (const attacker of attackers) {
      // Must have a counter-attack from extension
      const defended = graph.defeats.some(
        d => d.active && d.attacker === attacker && extension.has(d.defeated)
      );
      if (!defended && !extension.has(attacker)) {
        return false;
      }
    }
  }

  return true;
}
```

### Reinstatement Tracking

```typescript
/**
 * Track reinstatement of defeated arguments.
 *
 * An argument A defeated by B can be reinstated if:
 * - C defeats B, and
 * - C is acceptable
 */
interface ReinstatementTracker {
  /** Check if an argument can be reinstated */
  canReinstate(
    argument: string,
    graph: DefeatGraph,
    semantics: AcceptanceSemantics
  ): ReinstatementAnalysis;

  /** Apply reinstatement to update defeat graph */
  applyReinstatement(
    reinstatement: Reinstatement,
    graph: DefeatGraph
  ): DefeatGraph;

  /** Get reinstatement history for an argument */
  getHistory(argument: string): ReinstatementHistory;
}

interface ReinstatementAnalysis {
  /** Can the argument be reinstated? */
  canReinstate: boolean;

  /** Potential reinstaters */
  potentialReinstaters: PotentialReinstater[];

  /** Current status */
  currentStatus: ArgumentStatus;

  /** Status after reinstatement (if possible) */
  potentialStatus?: ArgumentStatus;
}

interface PotentialReinstater {
  /** The argument that could reinstate */
  argument: string;

  /** What it defeats */
  defeats: string;

  /** Is the reinstater itself acceptable? */
  reinstaterAcceptable: boolean;

  /** Confidence in reinstatement */
  confidence: ConfidenceValue;
}

interface ReinstatementHistory {
  /** Argument being tracked */
  argument: string;

  /** History of status changes */
  changes: StatusChange[];
}

interface StatusChange {
  /** Previous status */
  from: ArgumentStatus;

  /** New status */
  to: ArgumentStatus;

  /** What caused the change */
  cause: 'attack' | 'reinstatement' | 'new_evidence';

  /** Related arguments */
  relatedArguments: string[];

  /** Timestamp */
  timestamp: string;
}
```

### Acceptance Criteria (E4)

- [ ] `ArgumentationEngine` interface with add/compute/query methods
- [ ] `Argument` with premises, rules, and defeasibility type
- [ ] `Attack` with rebut/undercut/undermine types
- [ ] `DefeatGraph` with reinstatement tracking
- [ ] `detectDefeaterCycles()` using Tarjan's algorithm
- [ ] `computeGroundedExtension()` for skeptical acceptance
- [ ] `computePreferredExtensions()` for credulous acceptance
- [ ] `ReinstatementTracker` for defeated argument recovery
- [ ] All confidence values use `ConfidenceValue` type
- [ ] ~350 LOC budget

---

## Part 5: Integration Points

### Track D Integration (Quantification)

All epistemology features use the `ConfidenceValue` type system from Track D:

```typescript
// From track-d-quantification.md
import { ConfidenceValue, DerivedConfidence, MeasuredConfidence } from './confidence';

// Gettier risk scores use derived confidence
const gettierRisk: GettierRiskScore = {
  factors: {
    causalJustification: { type: 'derived', value: 0.8, formula: '...', inputs: [] },
    // ...
  },
};

// Consensus analysis uses measured confidence when calibrated
const consensus: ConsensusAnalysis = {
  agreementScore: {
    type: 'measured',
    value: 0.75,
    measurement: { datasetId: 'consensus_calibration', sampleSize: 100, ... },
  },
};
```

### Epistemics Module Integration

The epistemology features integrate with the existing epistemics module:

```typescript
// Evidence graph provides input to defeater framework
interface EvidenceGraphIntegration {
  /** Convert evidence chain to argument structure */
  evidenceToArgument(evidence: EvidenceEntry[]): Argument;

  /** Find attacks based on contradictory evidence */
  findAttacks(graph: EvidenceGraph): Attack[];

  /** Update evidence graph with acceptability results */
  updateWithAcceptability(result: AcceptabilityResult): void;
}
```

### Evidence Ledger Integration

All epistemology operations are recorded in the evidence ledger:

```typescript
// Record Gettier analysis as evidence
ledger.append({
  type: 'decision',
  input: { claim, justification },
  output: { gettierRisk },
  metadata: { analysisType: 'gettier_risk_assessment' },
});

// Record consensus deliberation
ledger.append({
  type: 'decision',
  input: { claim, perspectives },
  output: { consensus },
  metadata: { analysisType: 'social_epistemology' },
});
```

### Calibration Integration (Track F Calibration)

Epistemology features feed into calibration:

```typescript
// Track Gettier predictions vs outcomes
calibrationProtocol.recordClaim(
  { type: 'gettier_prediction', context: claim.id },
  gettierRisk.score
);

// Later, record outcome
calibrationProtocol.recordOutcome(claimId, wasActuallyGettierCase);
```

---

## Part 6: Implementation Roadmap

### Phase 1: Gettier Risk Assessment (E1) - Week 1-2

| Deliverable | LOC | Acceptance |
|-------------|-----|------------|
| `CausalJustification` type | 50 | Evidence chain tracking works |
| `CounterfactualAnalysis` | 80 | Nearby worlds generated and evaluated |
| `ModalSafetyAnalysis` | 60 | Safety margin computed with CI |
| `GettierRiskScore` computation | 60 | Risk levels correctly classified |
| **Total** | **250** | |

**Dependencies**: Track D (ConfidenceValue types)

### Phase 2: Social Epistemology (E2) - Week 2-3

| Deliverable | LOC | Acceptance |
|-------------|-----|------------|
| `StakeholderPerspective` type | 70 | Perspectives tracked with authority |
| `ConsensusAnalysis` | 80 | Consensus levels correctly computed |
| `EpistemicAuthorityStructure` | 80 | Authority computed from git/CODEOWNERS |
| `TestimonyValidation` | 70 | Testimony validated against code |
| **Total** | **300** | |

**Dependencies**: E1, git history access

### Phase 3: Epistemic Injustice Detection (E3) - Week 3-4

| Deliverable | LOC | Acceptance |
|-------------|-----|------------|
| `RepresentationAudit` | 60 | Pattern distribution analyzed |
| `NormativeClaimDetection` | 50 | Normative claims flagged |
| `SourceDiversityScore` | 40 | Diversity metrics computed |
| `BiasAwareCalibration` | 50 | Confidence adjusted for bias |
| **Total** | **200** | |

**Dependencies**: E2, LLM synthesis pipeline

### Phase 4: Extended Defeater Framework (E4) - Week 4-6

| Deliverable | LOC | Acceptance |
|-------------|-----|------------|
| `ArgumentationEngine` | 80 | ASPIC+ framework operational |
| `DefeatGraph` with cycles | 80 | Tarjan's algorithm detects cycles |
| `AcceptanceSemantics` | 100 | Grounded/preferred computed |
| `ReinstatementTracker` | 90 | Defeated arguments recoverable |
| **Total** | **350** | |

**Dependencies**: E1-E3

### Phase 5: Integration & Testing - Week 6-7

| Deliverable | LOC | Acceptance |
|-------------|-----|------------|
| Track D integration | 50 | All confidence uses ConfidenceValue |
| Evidence ledger integration | 50 | All operations logged |
| Calibration integration | 50 | Outcomes tracked for calibration |
| Test suite | 200 | >80% coverage |
| **Total** | **350** | |

---

## Evidence Commands

```bash
# Verify Gettier risk types
rg "CausalJustification|GettierRiskScore" packages/LiBrainian/src

# Verify social epistemology types
rg "StakeholderPerspective|ConsensusLevel|EpistemicAuthorityStructure" packages/LiBrainian/src

# Verify epistemic injustice types
rg "RepresentationAudit|NormativeClaimDetection|BiasAwareCalibration" packages/LiBrainian/src

# Verify argumentation framework
rg "ArgumentationEngine|DefeatGraph|AcceptanceSemantics" packages/LiBrainian/src

# Run epistemology tests
npm run test -- --grep "epistemology"

# Verify no raw confidence numbers
rg "confidence:\s*0\.\d" packages/LiBrainian/src --glob '*.ts' | wc -l
# Should return 0
```

---

## The 25 Greats' Verdict

**Gettier**: "Finally, a system that takes the distinction between lucky truth and genuine knowledge seriously."

**Goldman**: "The social epistemology framework correctly recognizes that testimony requires validation based on source reliability and corroboration."

**Fricker**: "The epistemic injustice detection addresses a real problem - LLM bias creates systematic underrepresentation that undermines knowledge claims."

**Dung**: "The ASPIC+ framework is the right choice for structured argumentation with priority semantics and reinstatement."

**Pollock**: "Defeater hierarchies and loop detection are essential for any serious defeasibility theory."

**Dijkstra**: "The formalization is rigorous. The confidence values are principled. This is how epistemology should be done in software systems."

---

## Summary

Track F Epistemology Infrastructure addresses four foundational epistemological gaps:

1. **E1 (Gettier Risk Assessment)**: Detects lucky truths through causal justification tracking, counterfactual sensitivity, and modal safety analysis

2. **E2 (Social Epistemology)**: Models multi-perspective knowledge with stakeholder perspectives, consensus levels, epistemic authority structures, and testimony validation

3. **E3 (Epistemic Injustice Detection)**: Identifies LLM bias through representation audits, normative claim flagging, source diversity scoring, and bias-aware confidence recalibration

4. **E4 (Extended Defeater Framework)**: Implements ASPIC+ argumentation with attack relations, defeat graphs, cycle detection, and reinstatement tracking

**Total estimated LOC**: ~1,100

Without these epistemological foundations, LiBrainian's "knowledge" is philosophically naive. With them, LiBrainian produces genuine understanding that agents can act on with appropriate confidence.
