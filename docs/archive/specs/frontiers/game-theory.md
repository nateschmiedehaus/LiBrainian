# Game-Theoretic Resource Allocation Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Based on Vickrey-Clarke-Groves (VCG) mechanisms, Nash equilibrium theory, and algorithmic game theory for multi-agent systems.

---

## Executive Summary

**Current allocation**: Fixed budgets, FIFO queues, or heuristic priority
**Game-Theoretic**: Incentive-compatible mechanisms that achieve efficient allocation with Nash equilibrium guarantees and bounded Price of Anarchy

Multi-agent systems compete for scarce resources (LLM tokens, embedding calls, context windows). Without proper mechanism design, agents may:
- Hoard resources they don't need
- Misreport preferences to gain advantage
- Create coordination failures that waste system capacity

This specification introduces **mechanism design** to allocate resources efficiently while ensuring:
- **Truthful reporting** (incentive compatibility)
- **Stable outcomes** (Nash equilibrium)
- **Bounded inefficiency** (Price of Anarchy < 1.2)

**Target verification**: Nash equilibrium verified, Price of Anarchy < 1.2

---

## 1. The Problem with Naive Resource Allocation

### 1.1 Why Fixed Budgets Fail

```
Scenario: 3 agents sharing 100K tokens/minute

Fixed budget (33.3K each):
- Agent A: Needs 50K for critical analysis → blocked
- Agent B: Needs 10K for simple query → wastes 23.3K capacity
- Agent C: Needs 10K for simple query → wastes 23.3K capacity

Result: 46.6K tokens wasted, critical task blocked

Game-theoretic allocation:
- Agent A bids high value → gets 50K
- Agent B bids low value → gets 10K
- Agent C bids low value → gets 10K
- 30K reserved for burst capacity

Result: All tasks complete, resources efficiently allocated
```

### 1.2 Strategic Behavior Without Proper Incentives

Without incentive-compatible mechanisms, rational agents will:
- **Overreport needs**: "I need 50K tokens" when 10K would suffice
- **Underreport costs**: "This is urgent!" when it can wait
- **Collude**: Two agents agree to inflate each other's priority
- **Free-ride**: Wait for others to pay coordination costs

### 1.3 The Solution: Mechanism Design

Design allocation rules where **truthful reporting is the dominant strategy**, and the resulting allocation is **Pareto efficient** (no agent can be made better off without making another worse off).

---

## 2. Core Types

### 2.1 Resource Model

```typescript
/**
 * A scarce resource that must be allocated among agents.
 *
 * INVARIANT: capacity >= sum of all allocations
 * INVARIANT: Each allocation has a valid agent owner
 */
interface Resource {
  /** Unique resource identifier */
  id: ResourceId;

  /** Resource type */
  type: ResourceType;

  /** Total available capacity per time window */
  capacity: number;

  /** Current allocations */
  allocations: Map<AgentId, Allocation>;

  /** Time window for capacity reset */
  windowMs: number;

  /** Current window start */
  windowStart: Date;

  /** Reserved capacity for burst/priority */
  reservedCapacity: number;
}

type ResourceId = string & { readonly __brand: 'ResourceId' };

type ResourceType =
  | 'llm_tokens'           // LLM API tokens
  | 'embedding_calls'      // Embedding API calls
  | 'context_tokens'       // Context window tokens
  | 'compute_time'         // CPU/GPU time
  | 'memory'               // Memory allocation
  | 'api_calls';           // External API calls

interface Allocation {
  agentId: AgentId;
  resourceId: ResourceId;
  amount: number;
  priority: Priority;
  expiresAt: Date;
  utilization: number;  // Actual usage / allocated
}

type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';
```

### 2.2 Agent Preferences

```typescript
/**
 * An agent's preferences over resource bundles.
 *
 * INVARIANT: Valuation function is monotonic (more resources >= current value)
 * INVARIANT: Preferences are complete and transitive
 */
interface AgentPreferences {
  /** Agent identifier */
  agentId: AgentId;

  /** Valuation function: bundle -> value */
  valuation: ValuationFunction;

  /** Budget constraint */
  budget: Budget;

  /** Demand curve for each resource */
  demands: Map<ResourceId, DemandCurve>;

  /** Cross-resource complementarities */
  complementarities: Complementarity[];
}

type AgentId = string & { readonly __brand: 'AgentId' };

interface ValuationFunction {
  /** Evaluate value of a resource bundle */
  evaluate(bundle: ResourceBundle): number;

  /** Marginal value of additional resource */
  marginalValue(bundle: ResourceBundle, resource: ResourceId, delta: number): number;

  /** Is the valuation submodular? (diminishing returns) */
  isSubmodular: boolean;
}

interface Budget {
  /** Virtual currency for bidding */
  virtualCurrency: number;

  /** Priority tokens (for critical requests) */
  priorityTokens: number;

  /** Credit limit for borrowing */
  creditLimit: number;
}

interface DemandCurve {
  /** Quantity demanded at each price point */
  points: Array<{ price: number; quantity: number }>;

  /** Elasticity of demand */
  elasticity: number;
}

interface Complementarity {
  /** Resources that are complements */
  resources: ResourceId[];

  /** Additional value when used together */
  synergyValue: number;
}

type ResourceBundle = Map<ResourceId, number>;
```

### 2.3 Auction and Mechanism Types

```typescript
/**
 * An auction mechanism for allocating resources.
 */
interface AuctionMechanism {
  /** Mechanism identifier */
  id: MechanismId;

  /** Mechanism type */
  type: MechanismType;

  /** Allocation rule: bids -> allocations */
  allocationRule: AllocationRule;

  /** Payment rule: bids, allocations -> payments */
  paymentRule: PaymentRule;

  /** Properties this mechanism guarantees */
  properties: MechanismProperties;
}

type MechanismId = string & { readonly __brand: 'MechanismId' };

type MechanismType =
  | 'vcg'                  // Vickrey-Clarke-Groves
  | 'first_price'          // First-price sealed bid
  | 'second_price'         // Second-price (Vickrey)
  | 'ascending'            // English auction
  | 'descending'           // Dutch auction
  | 'combinatorial'        // Combinatorial auction
  | 'proportional_share';  // Fair share allocation

interface AllocationRule {
  /** Compute allocation from bids */
  allocate(bids: Bid[], resources: Resource[]): AllocationResult;
}

interface PaymentRule {
  /** Compute payments from bids and allocations */
  computePayments(bids: Bid[], allocations: AllocationResult): Map<AgentId, number>;
}

interface MechanismProperties {
  /** Truthful reporting is dominant strategy */
  incentiveCompatible: boolean;

  /** Sum of payments >= 0 */
  budgetBalanced: boolean;

  /** Allocation is Pareto efficient */
  efficient: boolean;

  /** No agent is worse off than not participating */
  individuallyRational: boolean;

  /** Bound on Price of Anarchy */
  priceOfAnarchyBound?: number;
}

interface Bid {
  agentId: AgentId;
  resourceId: ResourceId;
  quantity: number;
  value: number;           // Reported value
  priority: Priority;
  timestamp: Date;
}

interface AllocationResult {
  allocations: Map<AgentId, ResourceBundle>;
  socialWelfare: number;   // Sum of agent values
  efficiency: number;      // Achieved / optimal welfare
}
```

---

## 3. VCG Mechanism for Resource Allocation

### 3.1 VCG Interface

```typescript
/**
 * Vickrey-Clarke-Groves mechanism for truthful resource allocation.
 *
 * PROPERTY: Truthful reporting is a dominant strategy
 * PROPERTY: Allocation maximizes social welfare
 * PROPERTY: Each agent pays their externality on others
 */
interface IVCGMechanism {
  /**
   * Run VCG auction for resources.
   */
  auction(
    bids: Bid[],
    resources: Resource[],
    constraints: AllocationConstraints
  ): Promise<VCGResult>;

  /**
   * Compute Clarke pivot payment for an agent.
   *
   * Payment = (Social welfare without agent) - (Social welfare of others with agent)
   */
  computeClarkePivot(
    agentId: AgentId,
    bids: Bid[],
    allocation: AllocationResult
  ): number;

  /**
   * Verify truthfulness incentives hold.
   */
  verifyIncentiveCompatibility(
    bids: Bid[],
    allocation: VCGResult
  ): IncentiveVerification;
}

interface AllocationConstraints {
  /** Maximum resources any single agent can receive */
  maxPerAgent: Map<ResourceId, number>;

  /** Minimum guaranteed allocation per agent */
  minGuaranteed: Map<AgentId, ResourceBundle>;

  /** Global capacity constraints */
  capacityConstraints: Resource[];

  /** Fairness constraints */
  fairnessRequirements?: FairnessConstraint[];
}

interface FairnessConstraint {
  type: 'proportional' | 'envy_free' | 'max_min_fair';
  weight: number;
}

interface VCGResult extends AllocationResult {
  /** Clarke pivot payments for each agent */
  payments: Map<AgentId, number>;

  /** Revenue collected */
  revenue: number;

  /** Proof of optimality */
  optimalityProof: OptimalityProof;

  /** Mechanism properties verified */
  verifiedProperties: MechanismProperties;
}

interface OptimalityProof {
  /** Optimal social welfare achievable */
  optimalWelfare: number;

  /** Achieved welfare */
  achievedWelfare: number;

  /** Gap (should be 0 for VCG) */
  gap: number;

  /** Certificate of optimality (for ILP solutions) */
  certificate?: string;
}
```

### 3.2 VCG Algorithm

```
ALGORITHM VCGAllocation(bids, resources, constraints):

  1. SOLVE welfare maximization problem:
     maximize: sum over agents i of v_i(x_i)
     subject to: capacity constraints
                 per-agent constraints
                 fairness constraints

     → optimal allocation x*
     → optimal welfare W*

  2. FOR each agent i:
     a. SOLVE same problem WITHOUT agent i:
        → welfare W_{-i}* (others' optimal welfare without i)

     b. COMPUTE others' welfare WITH agent i:
        → W_others = W* - v_i(x_i*)

     c. COMPUTE Clarke pivot payment:
        → p_i = W_{-i}* - W_others

     (Agent pays the externality they impose on others)

  3. VERIFY properties:
     a. Incentive compatibility:
        For all agents, truthful bid maximizes utility
     b. Individual rationality:
        For all agents, v_i(x_i) >= p_i
     c. Efficiency:
        Allocation maximizes social welfare

  RETURN (allocations, payments, proofs)
```

### 3.3 VCG Implementation

```typescript
/**
 * Compute VCG allocation and payments.
 */
async function runVCGAuction(
  bids: Bid[],
  resources: Resource[],
  constraints: AllocationConstraints
): Promise<VCGResult> {
  // Step 1: Solve optimal allocation
  const optimalAllocation = await solveWelfareMaximization(bids, resources, constraints);

  // Step 2: Compute Clarke pivot payments
  const payments = new Map<AgentId, number>();
  const agents = new Set(bids.map(b => b.agentId));

  for (const agent of agents) {
    // Welfare of others in optimal allocation
    const othersWelfare = computeOthersWelfare(optimalAllocation, agent);

    // Optimal welfare without this agent
    const bidsWithoutAgent = bids.filter(b => b.agentId !== agent);
    const allocationWithoutAgent = await solveWelfareMaximization(
      bidsWithoutAgent,
      resources,
      constraints
    );

    // Clarke pivot = what others could have gotten - what others got
    const clarkePivot = allocationWithoutAgent.socialWelfare - othersWelfare;
    payments.set(agent, clarkePivot);
  }

  // Step 3: Verify properties
  const verification = verifyMechanismProperties(bids, optimalAllocation, payments);

  return {
    ...optimalAllocation,
    payments,
    revenue: Array.from(payments.values()).reduce((a, b) => a + b, 0),
    optimalityProof: {
      optimalWelfare: optimalAllocation.socialWelfare,
      achievedWelfare: optimalAllocation.socialWelfare,
      gap: 0,
    },
    verifiedProperties: verification,
  };
}

function computeOthersWelfare(allocation: AllocationResult, excludeAgent: AgentId): number {
  let welfare = 0;
  for (const [agentId, bundle] of allocation.allocations) {
    if (agentId !== excludeAgent) {
      welfare += evaluateBundle(agentId, bundle);
    }
  }
  return welfare;
}
```

---

## 4. Nash Equilibrium Verification

### 4.1 Equilibrium Types

```typescript
/**
 * Nash equilibrium verification for multi-agent resource games.
 */
interface INashEquilibriumVerifier {
  /**
   * Verify if a strategy profile is a Nash equilibrium.
   */
  verifyNashEquilibrium(
    game: ResourceGame,
    strategies: StrategyProfile
  ): Promise<NashVerificationResult>;

  /**
   * Find Nash equilibria of the game.
   */
  findEquilibria(
    game: ResourceGame,
    options: EquilibriumSearchOptions
  ): Promise<NashEquilibrium[]>;

  /**
   * Compute best response for an agent given others' strategies.
   */
  computeBestResponse(
    game: ResourceGame,
    agent: AgentId,
    othersStrategies: Map<AgentId, Strategy>
  ): Promise<Strategy>;

  /**
   * Check if a mechanism induces truthfulness as Nash equilibrium.
   */
  verifyTruthfulNash(
    mechanism: AuctionMechanism,
    game: ResourceGame
  ): Promise<TruthfulNashResult>;
}

interface ResourceGame {
  /** Players in the game */
  agents: AgentId[];

  /** Available strategies for each agent */
  strategySpaces: Map<AgentId, StrategySpace>;

  /** Utility functions */
  utilities: Map<AgentId, UtilityFunction>;

  /** Allocation mechanism */
  mechanism: AuctionMechanism;

  /** Game type */
  type: GameType;
}

type GameType =
  | 'static'              // One-shot game
  | 'repeated'            // Repeated game
  | 'bayesian'            // Incomplete information
  | 'extensive';          // Sequential moves

interface StrategySpace {
  /** Possible bids/actions */
  actions: Action[];

  /** Constraints on strategies */
  constraints: StrategyConstraint[];
}

type Strategy = Map<State, Action>;

interface StrategyProfile {
  strategies: Map<AgentId, Strategy>;
}

interface UtilityFunction {
  /** Compute utility given allocation and payment */
  compute(allocation: ResourceBundle, payment: number): number;
}
```

### 4.2 Nash Verification Result

```typescript
interface NashVerificationResult {
  /** Is this a Nash equilibrium? */
  isNashEquilibrium: boolean;

  /** For each agent: best response check */
  bestResponseChecks: Map<AgentId, BestResponseCheck>;

  /** Epsilon for approximate Nash (0 for exact) */
  epsilon: number;

  /** Type of equilibrium */
  equilibriumType: EquilibriumType;

  /** Proof/certificate */
  proof: NashProof;

  /** Social welfare at equilibrium */
  equilibriumWelfare: number;

  /** Confidence in verification */
  confidence: ConfidenceValue;
}

interface BestResponseCheck {
  agent: AgentId;
  currentStrategy: Strategy;
  bestResponse: Strategy;
  currentUtility: number;
  bestResponseUtility: number;
  improvementGap: number;
  isBestResponse: boolean;
}

type EquilibriumType =
  | 'pure_nash'           // Pure strategy Nash
  | 'mixed_nash'          // Mixed strategy Nash
  | 'dominant_strategy'   // Every agent has dominant strategy
  | 'epsilon_nash'        // Approximate Nash
  | 'correlated';         // Correlated equilibrium

interface NashProof {
  type: 'exhaustive_search' | 'fixed_point' | 'lemke_howson' | 'support_enumeration';
  details: string;
  verificationTime: number;
}
```

### 4.3 Nash Verification Algorithm

```
ALGORITHM VerifyNashEquilibrium(game, strategies):

  FOR each agent i in game.agents:

    1. FIX strategies of all other agents: s_{-i}

    2. COMPUTE best response for agent i:
       br_i = argmax_{s_i} u_i(s_i, s_{-i})

    3. COMPARE to current strategy:
       IF u_i(br_i, s_{-i}) > u_i(s_i, s_{-i}) + epsilon:
         → NOT Nash equilibrium
         → Record profitable deviation

  IF all agents are playing best responses:
    → IS Nash equilibrium
    → Compute equilibrium welfare
    → Generate proof

  RETURN (isNash, bestResponseChecks, proof)
```

### 4.4 Truthful Nash Verification

```typescript
interface TruthfulNashResult {
  /** Is truthful reporting a Nash equilibrium? */
  truthfulIsNash: boolean;

  /** Is it a DOMINANT strategy equilibrium? */
  truthfulIsDominant: boolean;

  /** Profitable deviations from truth-telling */
  profitableDeviations: ProfitableDeviation[];

  /** Robustness of truthful equilibrium */
  robustness: TruthfulRobustness;
}

interface ProfitableDeviation {
  agent: AgentId;
  truthfulBid: Bid;
  deviationBid: Bid;
  utilityGain: number;
  conditions: string;  // When this deviation is profitable
}

interface TruthfulRobustness {
  /** Maximum gain from misreporting (should be 0 for incentive compatible) */
  maxMisreportGain: number;

  /** Fraction of scenarios where truthful is best response */
  truthfulBestResponseRate: number;

  /** Epsilon for approximate incentive compatibility */
  epsilon: number;
}

/**
 * Verify that truthful reporting is a dominant strategy.
 */
async function verifyTruthfulDominant(
  mechanism: AuctionMechanism,
  agent: AgentId,
  truePreferences: AgentPreferences
): Promise<boolean> {
  // For all possible bids by others
  for (const othersBids of generateAllOtherBidProfiles(agent)) {
    const truthfulBid = createTruthfulBid(agent, truePreferences);
    const truthfulUtility = computeUtility(mechanism, truthfulBid, othersBids);

    // Check all possible deviations
    for (const deviationBid of generateAllDeviations(agent, truePreferences)) {
      const deviationUtility = computeUtility(mechanism, deviationBid, othersBids);

      if (deviationUtility > truthfulUtility) {
        return false;  // Found profitable deviation
      }
    }
  }

  return true;  // Truthful is dominant
}
```

---

## 5. Price of Anarchy Analysis

### 5.1 Price of Anarchy Types

```typescript
/**
 * Price of Anarchy: ratio of optimal welfare to worst-case Nash welfare.
 *
 * PoA = OPT / min_{Nash} Welfare(Nash)
 *
 * A PoA of 1.2 means worst-case Nash loses at most 20% efficiency.
 */
interface IPriceOfAnarchyAnalyzer {
  /**
   * Compute Price of Anarchy for a mechanism.
   */
  computePoA(
    mechanism: AuctionMechanism,
    gameClass: GameClass
  ): Promise<PoAResult>;

  /**
   * Compute Price of Stability (best-case Nash).
   */
  computePoS(
    mechanism: AuctionMechanism,
    gameClass: GameClass
  ): Promise<PoSResult>;

  /**
   * Bound PoA analytically for mechanism class.
   */
  boundPoA(
    mechanismType: MechanismType,
    gameProperties: GameProperties
  ): PoABound;

  /**
   * Find worst-case Nash equilibrium.
   */
  findWorstCaseNash(
    mechanism: AuctionMechanism,
    game: ResourceGame
  ): Promise<WorstCaseNashResult>;
}

interface GameClass {
  /** Number of agents */
  numAgents: IntegerRange;

  /** Number of resources */
  numResources: IntegerRange;

  /** Valuation class */
  valuationClass: ValuationClass;

  /** Distribution over game instances */
  distribution?: Distribution;
}

type ValuationClass =
  | 'unit_demand'         // Each agent wants at most 1 item
  | 'additive'            // v(S) = sum of v(i) for i in S
  | 'submodular'          // Diminishing returns
  | 'supermodular'        // Increasing returns (complements)
  | 'gross_substitutes'   // Items are substitutes
  | 'general';            // No restrictions

interface IntegerRange {
  min: number;
  max: number;
}
```

### 5.2 PoA Result Types

```typescript
interface PoAResult {
  /** Price of Anarchy value */
  priceOfAnarchy: number;

  /** Price of Stability (best Nash) */
  priceOfStability: number;

  /** Optimal social welfare */
  optimalWelfare: number;

  /** Worst-case Nash welfare */
  worstNashWelfare: number;

  /** Best-case Nash welfare */
  bestNashWelfare: number;

  /** Bound type (exact, upper, lower) */
  boundType: 'exact' | 'upper_bound' | 'lower_bound';

  /** Analysis method */
  method: PoAMethod;

  /** Proof/certificate */
  proof: PoAProof;

  /** Whether target (PoA < 1.2) is achieved */
  achievesTarget: boolean;
}

type PoAMethod =
  | 'smoothness'          // Smoothness argument
  | 'potential_function'  // Potential game analysis
  | 'enumeration'         // Exhaustive search
  | 'simulation'          // Monte Carlo
  | 'analytic';           // Closed-form

interface PoAProof {
  method: PoAMethod;
  smoothnessParams?: { lambda: number; mu: number };
  potentialFunction?: string;
  worstCaseInstance?: ResourceGame;
  confidence: ConfidenceValue;
}

interface PoABound {
  /** Upper bound on PoA */
  upperBound: number;

  /** Lower bound on PoA (worst case can be this bad) */
  lowerBound: number;

  /** Is this bound tight? */
  isTight: boolean;

  /** Conditions for bound */
  conditions: string[];
}
```

### 5.3 Smoothness Analysis for PoA Bounds

```typescript
/**
 * Smoothness framework for bounding Price of Anarchy.
 *
 * A mechanism is (lambda, mu)-smooth if for all bid profiles b, b*:
 *   sum_i u_i(b*_i, b_{-i}) >= lambda * OPT(v) - mu * Revenue(b)
 *
 * This implies PoA <= (1 + mu) / lambda
 */
interface SmoothnessAnalysis {
  /** Lambda parameter */
  lambda: number;

  /** Mu parameter */
  mu: number;

  /** Implied PoA bound */
  impliedPoABound: number;

  /** Is the mechanism smooth? */
  isSmooth: boolean;

  /** Proof of smoothness */
  proof: SmoothnessProof;
}

interface SmoothnessProof {
  /** Derivation steps */
  derivation: string[];

  /** Key inequality */
  keyInequality: string;

  /** Verified for game class */
  verifiedFor: GameClass;
}

/**
 * Verify smoothness and derive PoA bound.
 */
function analyzeSmoothnessPoA(
  mechanism: AuctionMechanism,
  gameClass: GameClass
): SmoothnessAnalysis {
  // For VCG with unit-demand bidders: (1, 1)-smooth
  // PoA <= (1 + 1) / 1 = 2

  // For proportional sharing with submodular valuations:
  // PoA <= 2 (Roughgarden)

  // For our context allocation:
  // Need to verify (lambda, mu) such that PoA < 1.2
  // This requires lambda > (1 + mu) / 1.2

  const { lambda, mu } = deriveSmoothhnessParams(mechanism, gameClass);
  const impliedPoABound = (1 + mu) / lambda;

  return {
    lambda,
    mu,
    impliedPoABound,
    isSmooth: lambda > 0 && mu >= 0,
    proof: {
      derivation: [`lambda = ${lambda}`, `mu = ${mu}`, `PoA <= ${impliedPoABound}`],
      keyInequality: `sum_i u_i(b*_i, b_{-i}) >= ${lambda} * OPT - ${mu} * Rev`,
      verifiedFor: gameClass,
    },
  };
}
```

---

## 6. Incentive-Compatible Context Token Allocation

### 6.1 Context Allocation Interface

```typescript
/**
 * Allocates context window tokens among competing agents.
 *
 * GOAL: Maximize total value of context usage
 * CONSTRAINT: Total tokens <= context window size
 * PROPERTY: Truthful reporting is optimal
 */
interface IContextAllocator {
  /**
   * Allocate context tokens based on agent requests.
   */
  allocate(
    requests: ContextRequest[],
    windowSize: number,
    constraints: ContextConstraints
  ): Promise<ContextAllocationResult>;

  /**
   * Update allocation based on actual usage.
   */
  updateAllocation(
    currentAllocations: ContextAllocation[],
    usageReport: UsageReport
  ): Promise<ContextAllocationResult>;

  /**
   * Compute incentive-compatible prices.
   */
  computePrices(
    requests: ContextRequest[],
    allocation: ContextAllocationResult
  ): Map<AgentId, ContextPrice>;
}

interface ContextRequest {
  agentId: AgentId;

  /** Desired number of tokens */
  requestedTokens: number;

  /** Reported value per token */
  valuePerToken: number;

  /** Task type (affects priority) */
  taskType: TaskType;

  /** Urgency level */
  urgency: Priority;

  /** Minimum viable allocation */
  minimumTokens: number;

  /** Maximum useful allocation (diminishing returns above this) */
  saturationPoint: number;
}

type TaskType =
  | 'code_analysis'
  | 'code_generation'
  | 'explanation'
  | 'search'
  | 'synthesis';

interface ContextConstraints {
  /** Total context window */
  totalTokens: number;

  /** Reserved for system prompts */
  systemReserved: number;

  /** Minimum per-agent guarantee */
  minPerAgent: number;

  /** Maximum per-agent cap */
  maxPerAgent: number;

  /** Fairness constraint */
  fairness?: FairnessConstraint;
}

interface ContextAllocationResult {
  /** Token allocations */
  allocations: Map<AgentId, ContextAllocation>;

  /** Total allocated */
  totalAllocated: number;

  /** Remaining for burst/priority */
  remaining: number;

  /** Social welfare achieved */
  socialWelfare: number;

  /** Efficiency ratio */
  efficiency: number;
}

interface ContextAllocation {
  agentId: AgentId;
  allocatedTokens: number;
  price: number;
  priority: Priority;
  expiresAt: Date;
}

interface ContextPrice {
  /** Per-token price */
  pricePerToken: number;

  /** Total payment */
  totalPayment: number;

  /** Price type */
  priceType: 'vcg' | 'uniform' | 'discriminatory';
}
```

### 6.2 Context Allocation Algorithm

```
ALGORITHM AllocateContextTokens(requests, windowSize, constraints):

  1. SORT requests by value density:
     density_i = value_i / requested_i
     sorted = requests.sortBy(density, descending)

  2. ALLOCATE greedily respecting constraints:
     allocated = {}
     remaining = windowSize - constraints.systemReserved

     FOR each request r in sorted:
       allocation = min(r.requestedTokens,
                        constraints.maxPerAgent,
                        remaining)
       IF allocation >= r.minimumTokens:
         allocated[r.agentId] = allocation
         remaining -= allocation

  3. ENSURE minimum guarantees:
     FOR each agent a not in allocated:
       IF remaining >= constraints.minPerAgent:
         allocated[a] = constraints.minPerAgent
         remaining -= constraints.minPerAgent

  4. COMPUTE VCG payments:
     FOR each agent a in allocated:
       payment_a = clarkePayment(a, requests, allocated)

  5. VERIFY incentive compatibility:
     FOR each agent:
       Assert: truthful reporting maximizes utility

  RETURN (allocated, payments, proofs)
```

---

## 7. Auction Mechanisms for Scarce Resources

### 7.1 LLM Token Auction

```typescript
/**
 * Auction mechanism for LLM API tokens.
 */
interface ITokenAuction {
  /**
   * Run periodic token auction.
   */
  runAuction(
    window: TimeWindow,
    capacity: number,
    bids: TokenBid[]
  ): Promise<TokenAuctionResult>;

  /**
   * Handle real-time token requests.
   */
  handleRequest(
    request: TokenRequest,
    currentState: AuctionState
  ): Promise<TokenGrant>;

  /**
   * Rebalance allocations based on usage.
   */
  rebalance(
    currentAllocations: TokenAllocation[],
    usageStats: UsageStats
  ): Promise<RebalanceResult>;
}

interface TokenBid {
  agentId: AgentId;
  requestedTokens: number;
  maxPrice: number;
  urgency: Priority;
  estimatedDuration: number;
  taskDescription: string;
}

interface TokenAuctionResult {
  /** Winners and their allocations */
  winners: Map<AgentId, TokenAllocation>;

  /** Clearing price */
  clearingPrice: number;

  /** Revenue collected */
  revenue: number;

  /** Unsatisfied demand */
  unsatisfiedDemand: number;

  /** Auction efficiency */
  efficiency: number;
}

interface TokenAllocation {
  agentId: AgentId;
  tokensAllocated: number;
  pricePerToken: number;
  totalCost: number;
  validUntil: Date;
  allowBurst: boolean;
  burstLimit: number;
}

interface TimeWindow {
  start: Date;
  end: Date;
  durationMs: number;
}
```

### 7.2 Embedding Call Auction

```typescript
/**
 * Auction mechanism for embedding API calls.
 */
interface IEmbeddingAuction {
  /**
   * Allocate embedding calls for a time window.
   */
  allocate(
    window: TimeWindow,
    capacity: number,
    requests: EmbeddingRequest[]
  ): Promise<EmbeddingAllocationResult>;

  /**
   * Priority queue for real-time requests.
   */
  enqueue(
    request: EmbeddingRequest,
    currentQueue: EmbeddingQueue
  ): Promise<QueuePosition>;
}

interface EmbeddingRequest {
  agentId: AgentId;
  documentCount: number;
  documentPriority: Priority;
  valuePerDocument: number;
  deadline?: Date;
}

interface EmbeddingAllocationResult {
  allocations: Map<AgentId, EmbeddingAllocation>;
  queuedRequests: EmbeddingRequest[];
  utilizationRate: number;
}

interface EmbeddingAllocation {
  agentId: AgentId;
  callsAllocated: number;
  rateLimit: number;  // calls per second
  validWindow: TimeWindow;
}
```

---

## 8. TDD Test Specifications

### 8.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `vcg_allocation_optimal` | 3 agents, 2 resources | Welfare-maximizing allocation |
| `vcg_payment_correct` | Known Clarke payments | Payments match formula |
| `vcg_incentive_compatible` | All bid profiles | No profitable deviation |
| `nash_pure_verified` | 2-player game | Correct equilibrium check |
| `nash_deviation_detected` | Non-equilibrium | Deviation identified |
| `poa_simple_game` | Known PoA game | PoA = expected value |
| `poa_bound_correct` | Smoothness params | Bound matches formula |
| `context_allocation_respects_constraints` | Overconstrained | All constraints satisfied |
| `context_allocation_fair` | Equal values | Proportional allocation |
| `token_auction_clears` | Supply = demand | Market clears |

### 8.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `vcg_with_real_agents` | 5 agents, 3 resources | Truthful is best response |
| `nash_verification_complex` | 10-player game | All equilibria found |
| `poa_across_mechanisms` | VCG vs proportional | PoA comparison correct |
| `context_allocation_dynamic` | Changing demands | Reallocation works |
| `auction_under_load` | 100 requests/second | Latency < 10ms |

### 8.3 Tier-2 Tests (Live)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `truthful_in_practice` | Real multi-agent session | No agent benefits from lying |
| `poa_empirical` | 1000 game instances | PoA < 1.2 in 95%+ cases |
| `efficiency_real_workload` | Production traffic | 90%+ resource utilization |
| `nash_verified_live` | Live agent coordination | Equilibrium maintained |

---

## 9. BDD Scenarios

```gherkin
Feature: VCG Mechanism for Resource Allocation
  As a multi-agent system
  I want truthful resource allocation
  So that resources go to agents who value them most

  Scenario: VCG allocates to highest value bidder
    Given agents with valuations:
      | Agent | Value for Resource X |
      | A     | 100                  |
      | B     | 80                   |
      | C     | 50                   |
    And resource X has capacity 1
    When I run VCG auction
    Then Agent A receives Resource X
    And Agent A pays 80 (second-highest value)
    And truthful bidding is verified as optimal

  Scenario: No profitable deviation exists
    Given an agent with true value 100
    When the agent considers all possible bids
    Then reporting 100 yields highest utility
    And no misreport improves outcome

Feature: Nash Equilibrium Verification
  As a system designer
  I want to verify Nash equilibria
  So that I can guarantee stable outcomes

  Scenario: Verify pure Nash equilibrium
    Given a resource game with 3 agents
    And a strategy profile S
    When I verify Nash equilibrium for S
    Then each agent is playing best response
    And equilibrium welfare is computed
    And a proof certificate is generated

  Scenario: Detect deviation from equilibrium
    Given a strategy profile that is NOT Nash
    When I verify Nash equilibrium
    Then a profitable deviation is identified
    And the improving agent is specified
    And the improvement gain is computed

Feature: Price of Anarchy Bounds
  As a mechanism designer
  I want to bound efficiency loss
  So that decentralized allocation is near-optimal

  Scenario: PoA is within target bound
    Given a resource allocation mechanism
    And target PoA < 1.2
    When I analyze Price of Anarchy
    Then computed PoA is less than 1.2
    And a smoothness proof is provided
    And worst-case instance is identified

  Scenario: Compare mechanisms by PoA
    Given VCG and proportional share mechanisms
    When I compute PoA for both
    Then VCG has PoA = 1.0 (optimal)
    And proportional share has PoA <= 2.0
    And mechanism recommendation is provided

Feature: Incentive-Compatible Context Allocation
  As an agent system
  I want truthful context token allocation
  So that agents report true needs

  Scenario: Context tokens allocated by value
    Given 3 agents requesting context:
      | Agent | Tokens Requested | Value/Token |
      | A     | 4000             | 10          |
      | B     | 2000             | 15          |
      | C     | 1000             | 5           |
    And total context window is 5000 tokens
    When I allocate context tokens
    Then Agent B receives 2000 (highest density)
    Then Agent A receives up to remaining
    And allocations are incentive-compatible

  Scenario: Minimum guarantees respected
    Given minimum guarantee of 500 tokens per agent
    And 5 agents requesting tokens
    When I allocate context tokens
    Then each agent receives at least 500 tokens
    And remaining is allocated by value
```

---

## 10. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Orchestrator | Requests resource allocations | Reads |
| Agent Registry | Provides agent preferences | Reads |
| Evidence Ledger | Records allocation decisions | Writes |
| Calibration | Uses outcomes to tune valuations | Reads/Writes |
| Query Engine | Receives context allocation | Reads |
| Rate Limiter | Enforces token allocations | Reads |
| Billing/Credits | Tracks virtual currency | Reads/Writes |

---

## 11. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] VCG mechanism implemented
- [ ] Nash equilibrium verifier implemented
- [ ] Price of Anarchy analyzer implemented
- [ ] Context token allocator implemented
- [ ] Token auction mechanism implemented
- [ ] Embedding call auction implemented
- [ ] Gate passed: Nash equilibrium verified
- [ ] Gate passed: Price of Anarchy < 1.2

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
