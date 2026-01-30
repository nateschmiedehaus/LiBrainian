# Part 3: Action Theory Integration

[Back to Index](./index.md) | [Previous: Formal Proofs](./02-formal-proofs.md) | [Next: Use Cases](./04-use-cases.md)

---

## 3.1 Foundational Claim: Practical Reasoning IS Epistemic

**THESIS**: Preferences, intentions, goals, and practical reasoning are epistemic phenomena constructable from the six primitives, though they require attitudinal extensions.

**Argument**:

1. **Preferences have epistemic content**: "I prefer A to B" expresses an epistemic state about relative value
2. **Intentions involve commitment to truth**: "I intend to X" involves accepting "I will X" as something to make true
3. **Goals are desired states**: A goal is content about a future state with positive valence
4. **Practical reasoning is coherence**: Deciding what to do is evaluating coherence of action-belief sets

This aligns with the Belief-Desire-Intention (BDI) model where all three are informational states.

---

## 3.2 PREFERENCE as Epistemic Attitude

**THEOREM 3.2.1**: Preferences are constructable as comparative epistemic attitudes.

**Definition**: A preference P(a, X > Y) means agent a prefers X to Y.

**Construction**:

```typescript
// Extension required: Add 'preferring' attitude type
type ExtendedAttitudeType = AttitudeType | 'preferring';

interface PreferenceContent {
  type: 'preference';
  preferred: Content;
  dispreferred: Content;
  dimension?: string;  // What dimension (e.g., 'utility', 'aesthetics')
}

// Construct preference
const preferenceContent = constructContent({
  type: 'preference',
  preferred: constructContent('Use TypeScript', 'imperative'),
  dispreferred: constructContent('Use JavaScript', 'imperative'),
  dimension: 'type_safety'
}, 'structured');

const preference = constructEpistemicObject(
  preferenceContent,
  constructAttitude('accepting', { value: 0.8, basis: 'estimated' }),
  { source: { type: 'human', description: 'Developer preference' } }
);
```

**Grounding preferences**:
```typescript
// Preference grounded in beliefs about consequences
const typeSafetyBelief = constructEpistemicObject(
  constructContent('TypeScript catches errors at compile time', 'propositional'),
  constructAttitude('accepting', { value: 0.95, basis: 'measured' })
);

const preferenceGrounding = constructGrounding(
  typeSafetyBelief.id,
  preference.id,
  'explanatory',  // The belief EXPLAINS the preference
  { value: 0.85, basis: 'inferential' }
);
```

**Verification**:
- ✓ Content captures the comparative structure (X > Y)
- ✓ Attitude captures the endorsement
- ✓ Grounding captures WHY the preference is held
- ✓ Strength captures preference intensity

**PARTIAL QED** (Requires 'preferring' attitude extension for full native support) ∎

---

## 3.3 INTENTION as Grounded Commitment

**THEOREM 3.3.1**: Intentions are constructable as action-directed accepting attitudes with commitment grounding.

**Definition**: An intention I(a, X) means agent a intends to do X.

**Construction**:

```typescript
interface IntentionContent {
  type: 'intention';
  action: Content;       // What to do
  conditions?: Content[]; // Under what conditions
  deadline?: string;      // By when
}

// Construct intention
const intentionContent = constructContent({
  type: 'intention',
  action: constructContent('Refactor the authentication module', 'imperative'),
  conditions: [constructContent('After code review approval', 'propositional')],
  deadline: '2026-02-15'
}, 'structured');

const intention = constructEpistemicObject(
  intentionContent,
  constructAttitude('accepting', { value: 0.9, basis: 'estimated' }),
  {
    source: { type: 'human', description: 'Developer commitment' },
    status: 'active'
  }
);
```

**Key insight**: Intentions differ from predictions by their GROUNDING structure:

```typescript
// Intention is grounded in GOALS and MEANS-END beliefs
const goal = constructEpistemicObject(
  constructContent('Improve code maintainability', 'propositional'),
  constructAttitude('accepting', { value: 0.95, basis: 'estimated' })
);

const meansEndBelief = constructEpistemicObject(
  constructContent('Refactoring improves maintainability', 'propositional'),
  constructAttitude('accepting', { value: 0.85, basis: 'measured' })
);

// Intention grounded in goal
const goalGrounding = constructGrounding(
  goal.id,
  intention.id,
  'explanatory',
  { value: 0.9, basis: 'inferential' }
);

// Intention grounded in means-end belief
const meansGrounding = constructGrounding(
  meansEndBelief.id,
  intention.id,
  'enabling',
  { value: 0.85, basis: 'inferential' }
);
```

**Distinguishing intention from prediction**:
- Prediction: Grounded in evidence about what WILL happen
- Intention: Grounded in goals about what SHOULD happen + means-end beliefs

**PARTIAL QED** (Full native support would add 'intending' attitude type) ∎

---

## 3.4 GOAL as Desired State with Epistemic Content

**THEOREM 3.4.1**: Goals are constructable as content about desired states with positive valence grounding.

**Construction**:

```typescript
interface GoalContent {
  type: 'goal';
  desiredState: Content;
  priority: number;
  achievementCriteria: Content[];
}

const goalContent = constructContent({
  type: 'goal',
  desiredState: constructContent('System handles 10k requests/second', 'propositional'),
  priority: 1,
  achievementCriteria: [
    constructContent('Load test passes at 10k RPS', 'propositional'),
    constructContent('P99 latency < 100ms', 'propositional')
  ]
}, 'structured');

const goal = constructEpistemicObject(
  goalContent,
  constructAttitude('accepting', { value: 1.0, basis: 'assigned' }),
  { source: { type: 'human', description: 'Product requirement' } }
);
```

**Goal achievement tracking**:
```typescript
// Goals can be grounded in higher-level goals (goal hierarchy)
const businessGoal = constructEpistemicObject(
  constructContent('Handle enterprise customer load', 'propositional'),
  constructAttitude('accepting')
);

const goalHierarchyGrounding = constructGrounding(
  businessGoal.id,
  goal.id,
  'explanatory',
  { value: 0.9, basis: 'inferential' }
);

// Goal achievement = all criteria satisfied
function evaluateGoalAchievement(
  goal: EpistemicObject,
  network: CoherenceNetwork
): boolean {
  const content = goal.content.value as GoalContent;
  return content.achievementCriteria.every(criterion => {
    const criterionObj = findObjectByContent(network, criterion);
    return criterionObj?.attitude.type === 'accepting' &&
           (criterionObj.attitude.strength?.value ?? 0) > 0.8;
  });
}
```

**QED** ∎

---

## 3.5 PRACTICAL_REASONING as Coherence Evaluation

**THEOREM 3.5.1**: Practical reasoning (deciding what to do) is constructable as coherence evaluation over action-relevant epistemic objects.

**Construction**:

```typescript
interface PracticalReasoningContext extends EvaluationContext {
  goals: EpistemicObject[];           // What we want
  beliefs: EpistemicObject[];         // What we believe
  actions: EpistemicObject[];         // What we could do
  constraints: EpistemicObject[];     // What limits us
}

function evaluatePracticalCoherence(
  context: PracticalReasoningContext
): {
  coherent: boolean;
  recommendedAction: EpistemicObject | null;
  reasoning: string[];
} {
  // Build network of goals, beliefs, actions, constraints
  const allObjects = [
    ...context.goals,
    ...context.beliefs,
    ...context.actions,
    ...context.constraints
  ];

  // Find groundings between them
  const groundings: Grounding[] = [];

  // Actions grounded in means-end beliefs
  for (const action of context.actions) {
    for (const belief of context.beliefs) {
      if (meansEndRelation(action, belief, context.goals)) {
        groundings.push(constructGrounding(
          belief.id,
          action.id,
          'enabling',
          { value: computeMeansEndStrength(action, belief, context.goals), basis: 'inferential' }
        ));
      }
    }
  }

  // Actions defeated by constraints
  for (const action of context.actions) {
    for (const constraint of context.constraints) {
      if (violatesConstraint(action, constraint)) {
        groundings.push(constructGrounding(
          constraint.id,
          action.id,
          'undermining',
          { value: 0.9, basis: 'logical' }
        ));
      }
    }
  }

  const network = constructCoherenceNetwork(allObjects, groundings);
  const evaluation = evaluateCoherence(network, context);

  // Recommended action = highest effective strength, not undermined
  const actionEvaluations = context.actions
    .map(a => ({ action: a, eval: evaluation.objectEvaluations.get(a.id)! }))
    .filter(ae => !ae.eval.contradicted && ae.eval.groundingStatus === 'grounded')
    .sort((a, b) => b.eval.effectiveStrength - a.eval.effectiveStrength);

  return {
    coherent: evaluation.status.coherent,
    recommendedAction: actionEvaluations[0]?.action ?? null,
    reasoning: evaluation.recommendations.map(r => r.description)
  };
}
```

**Key insight**: Practical reasoning is JUST coherence evaluation where:
- Goals are highly entrenched objects
- Actions are evaluated by their grounding in goals via means-end beliefs
- Constraints act as defeaters
- The "best" action has highest effective grounding strength

**QED** ∎

---

## 3.6 Unified Construction: The BDI Agent

**THEOREM 3.6.1**: A complete BDI (Belief-Desire-Intention) agent state is constructable.

**Construction**:

```typescript
interface BDIAgentState {
  agent: Agent;
  beliefs: CoherenceNetwork;      // What the agent believes
  desires: EpistemicObject[];     // What the agent wants (goals)
  intentions: EpistemicObject[];  // What the agent is committed to
}

function constructBDIAgent(
  agentSpec: { name: string; type: AgentType },
  initialBeliefs: Content[],
  initialGoals: Content[],
  initialIntentions: Content[]
): BDIAgentState {
  const agent: Agent = {
    id: createAgentId(agentSpec.name),
    type: agentSpec.type,
    name: agentSpec.name,
    trustLevel: 'medium'
  };

  // Construct belief network
  const beliefObjects = initialBeliefs.map(b =>
    constructEpistemicObject(b, constructAttitude('accepting'))
  );
  const beliefs = constructCoherenceNetwork(beliefObjects, []);

  // Construct desires (goals)
  const desires = initialGoals.map(g =>
    constructEpistemicObject(
      constructContent({ type: 'goal', desiredState: g }, 'structured'),
      constructAttitude('accepting', { value: 1.0, basis: 'assigned' })
    )
  );

  // Construct intentions
  const intentions = initialIntentions.map(i =>
    constructEpistemicObject(
      constructContent({ type: 'intention', action: i }, 'structured'),
      constructAttitude('accepting', { value: 0.9, basis: 'estimated' })
    )
  );

  return { agent, beliefs, desires, intentions };
}
```

**QED** ∎

---

[Back to Index](./index.md) | [Previous: Formal Proofs](./02-formal-proofs.md) | [Next: Use Cases](./04-use-cases.md)
