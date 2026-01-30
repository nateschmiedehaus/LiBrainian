# Adversarial Analysis: Unconstructable Epistemic Objects

**Status**: Adversarial Analysis Report
**Version**: 1.0.0
**Date**: 2026-01-29
**Analyst**: Adversarial Analyst (tasked with DISPROVING universal constructability)
**Input Files**:
- `src/epistemics/universal_coherence.ts`
- `docs/librarian/specs/research/universal-epistemic-primitives.md`

---

## Executive Summary

This document presents an adversarial analysis attempting to **disprove** the universal constructability claim of Librarian's epistemic primitives. The system claims that six primitives (Distinguishability, Content, Grounding, Attitude, Agent, Context) can construct ANY epistemic object.

### Verdict Summary

| Test Case | Rating | Critical Issue |
|-----------|--------|----------------|
| Indexical Knowledge | **PARTIALLY_CONSTRUCTABLE** | Token-reflexivity lost in serialization |
| De Se Attitudes | **PARTIALLY_CONSTRUCTABLE** | Agent self-reference is shallow |
| Self-Referential Beliefs | **NOT_CONSTRUCTABLE** | Paradox-generating, system cannot handle |
| Ineffable Qualia | **NOT_CONSTRUCTABLE** | Content primitive too narrow |
| Tacit/Procedural Knowledge | **PARTIALLY_CONSTRUCTABLE** | Structural, not executable |
| Collective Beliefs | **CONSTRUCTABLE** | AgentType covers this |
| Future-Directed Intentions | **PARTIALLY_CONSTRUCTABLE** | Attitude set incomplete |
| Partial Beliefs (Vagueness) | **PARTIALLY_CONSTRUCTABLE** | Conflates vagueness with uncertainty |

**Overall Assessment**: The universal constructability claim is **PARTIALLY FALSE**. The primitives fail completely for self-referential beliefs and ineffable qualia, and lose essential information for indexicals, de se attitudes, procedural knowledge, and vague predicates.

---

## 1. Indexical Knowledge

### Test Case
- "I am here now"
- "This is red" (demonstrative)
- Essential question: Can `Content` capture indexicality, or does it lose essential information?

### Attempted Construction

```typescript
// Attempt 1: Naive string representation
const indexicalContent = constructContent("I am here now", 'indexical');
// Result: { id: "content_xxx", value: "I am here now", contentType: 'indexical', ... }

// Attempt 2: Structured representation with context
const structuredIndexical = constructContent({
  speaker: agentId,
  location: "room-123",
  time: "2026-01-29T10:30:00Z",
  demonstratum: "this-red-object"
}, 'indexical');
```

### Analysis

The system provides `'indexical'` as a `ContentType` (line 95 of universal_coherence.ts):
```typescript
| 'indexical' // <this, here, now> - context-dependent
```

However, this is **structurally inadequate** for several reasons:

1. **Token-Reflexivity Lost**: Indexicals are token-reflexive - "I" refers to whoever utters it, "now" to whenever it's uttered. Once serialized into a Content object with a fixed `value`, this reflexivity is destroyed. The system can only store a **description** of an indexical, not the indexical itself.

2. **Context Not Intrinsically Linked**: The `Context` primitive exists separately from `Content`. But for true indexicals, context IS constitutive of content - "I am here now" has no determinate content without knowing who, where, when. The system stores them adjacently but not constitutively.

3. **Kaplan's Distinction Collapsed**: David Kaplan distinguished between **character** (the rule determining reference) and **content** (what's referred to in context). The system can only represent content-after-evaluation, not the character that generates it.

### What's Lost

- The semantic rule that "I" picks out the speaker (character)
- The ability to evaluate the same indexical in different contexts
- The essential context-dependence that makes indexicals special

### Verdict: **PARTIALLY_CONSTRUCTABLE**

The system can **describe** indexicals after evaluation in a context, but cannot represent their pre-contextual semantic character. This is a genuine limitation.

---

## 2. De Se Attitudes

### Test Case
- "I believe that I am the messy shopper" (Lewis's problem)
- Self-locating beliefs
- Essential question: Is the `Agent` primitive sufficient for de se attitudes?

### Background

David Lewis's famous "Two Gods" puzzle and "Messy Shopper" cases show that de se attitudes (beliefs about oneself, qua oneself) cannot be reduced to de dicto attitudes (beliefs about propositions). The messy shopper realizes "I am the one making the mess" - this cannot be captured by believing a proposition about some person who happens to be him.

### Attempted Construction

```typescript
// Agent definition
const agent: Agent = {
  id: createAgentId('shopper'),
  type: 'human',
  name: 'John',
  trustLevel: 'high'
};

// Attempt 1: De dicto representation
const deDictoContent = constructContent("John is the messy shopper", 'propositional');
// PROBLEM: This is a belief about John, not a self-locating belief

// Attempt 2: Using Agent ID in content
const deSeAttempt = constructContent({
  subject: agent.id,
  predicate: "is the messy shopper",
  mode: "first-person"
}, 'structured');
// PROBLEM: Still describes the belief, doesn't capture first-person character
```

### Analysis

The `Agent` primitive (lines 164-193) provides:
```typescript
export interface Agent {
  readonly id: AgentId;
  readonly type: AgentType;
  readonly name: string;
  readonly version?: string;
  readonly trustLevel?: TrustLevel;
}
```

This is fundamentally **third-personal** - it describes an agent from the outside. There is no mechanism for:
- **Self-reference that is constitutively first-personal**
- **Immunity to error through misidentification** (I can't be wrong that it's ME who is in pain)
- **The special epistemological status of self-knowledge**

### Grounding Problem

The deeper issue is that the grounding relation (`GROUNDS`) is extensional - if two propositions are true of the same entity, they should ground the same conclusions. But de se attitudes are hyperintensional - believing "I am the messy shopper" has different cognitive and behavioral consequences than believing "John is the messy shopper" even when I am John.

### What's Lost

- The first-person perspective that is constitutive of de se attitudes
- Immunity to error through misidentification
- The action-guiding character (de se beliefs explain action in a way de dicto beliefs can't)

### Verdict: **PARTIALLY_CONSTRUCTABLE**

The system can represent **that** an agent has a belief about themselves, but cannot capture **the first-personal mode of presentation** that makes de se attitudes distinctive. This is a genuine expressive limitation.

---

## 3. Self-Referential Beliefs

### Test Case
- "This belief is unjustified"
- "I know that I know P" (KK principle)
- Essential question: Can the system handle self-reference without paradox?

### Attempted Construction

```typescript
// Attempt: Create a self-referential epistemic object
const selfRefContent = constructContent({
  type: "self-reference",
  target: "this-belief",
  predicate: "is unjustified"
}, 'propositional');

const selfRefObject = constructEpistemicObject(selfRefContent,
  constructAttitude('accepting'),
  { id: createObjectId('self-ref') }
);

// NOW: Try to ground it
// If we accept "this belief is unjustified", should EVALUATE return 'grounded' or 'ungrounded'?
// If grounded: The belief is justified, so it's FALSE
// If ungrounded: The belief is true, so it SHOULD be grounded
// PARADOX
```

### Analysis

The system has **no mechanism to handle self-reference**:

1. **Content Cannot Reference Its Container**: The `Content` interface has no way to reference the `EpistemicObject` that contains it. Content is constructed before the object, so circular reference is structurally impossible.

2. **Grounding Cannot Be Self-Referential**: The irreflexivity axiom (line 911-913) explicitly forbids self-grounding:
   ```typescript
   if (from === to) {
     throw new GroundingError('REFLEXIVITY_VIOLATION', 'Object cannot ground itself');
   }
   ```

3. **No Fixpoint Semantics**: Self-referential beliefs require fixpoint semantics (like Kripke's theory of truth). The system has no such mechanism.

4. **Evaluation Loops**: Attempting to evaluate a self-referential belief would cause infinite regress or contradiction, depending on the self-reference type.

### The KK Principle

For "I know that I know P":
```typescript
const knowsP = constructEpistemicObject(constructContent("P"), constructAttitude('accepting'));
const knowsKnowsP = constructEpistemicObject(
  constructContent({ target: knowsP.id, predicate: "is knowledge" }),
  constructAttitude('accepting')
);
// This requires evaluating whether knowsP is knowledge, which requires evaluating knowsKnowsP...
```

The system can represent hierarchical meta-knowledge, but:
- It cannot represent the **iterative** aspect (knowing that one knows that one knows...)
- It has no principled semantics for when meta-knowledge holds

### What's Lost

- All self-referential epistemic content
- Paradoxical beliefs (though arguably this is a feature, not a bug)
- Legitimate self-referential knowledge (introspection about one's own beliefs)

### Verdict: **NOT_CONSTRUCTABLE**

Self-referential beliefs are **not constructable** within this system. The irreflexivity constraints and lack of fixpoint semantics make genuine self-reference impossible. This is a **fundamental limitation**, though one could argue paradox-avoidance is intentional.

---

## 4. Ineffable Qualia

### Test Case
- "The redness of red"
- "What it's like to taste coffee"
- Essential question: Can `Content` capture qualitative character?

### Attempted Construction

```typescript
// Attempt 1: Describe the quale
const redQualia = constructContent("The experience of seeing red", 'perceptual');

// Attempt 2: Point to it structurally
const coffeeQualia = constructContent({
  type: "quale",
  modality: "taste",
  stimulus: "coffee",
  subject: agentId
}, 'perceptual');

// Attempt 3: Use procedural content for "what it's like"
const whatItsLike = constructContent(
  "The phenomenal character of tasting coffee cannot be communicated propositionally",
  'perceptual'
);
```

### Analysis

The system provides `'perceptual'` as a `ContentType`:
```typescript
| 'perceptual' // <visual field state> - sensory
```

But this is **fundamentally inadequate** for qualia:

1. **The Hard Problem**: Qualia are characterized by their intrinsic, subjective, qualitative character. ANY public representation - including `Content` objects - necessarily loses this character. The system can only represent **descriptions of** qualia, not qualia themselves.

2. **Mary's Room**: Mary knows all physical facts about red but doesn't know what red looks like until she sees it. The `Content` primitive can only store public, shareable information - exactly the kind Mary already has.

3. **Inverted Spectrum**: If your "red" quale is my "green" quale, our `Content` objects would be identical (both say "the experience of red") despite referring to different qualia.

4. **Private vs. Public**: `Content` is defined as "anything distinguishable" (line 144), but distinguishability is a **public** criterion. Qualia are distinguished by their **private** character.

### Philosophical Position

The system implicitly assumes **functionalism** or **representationalism** about mind - mental states are individuated by their functional/representational role. Qualia resist this because they have an intrinsic qualitative character beyond function.

### What's Lost

- The intrinsic qualitative character of experience
- Privacy of mental states
- The explanatory gap between functional description and phenomenal reality

### Verdict: **NOT_CONSTRUCTABLE**

Qualia are **not constructable** from these primitives. This is arguably the deepest limitation - the system can represent beliefs ABOUT qualia but not qualia themselves. This limitation applies to ANY propositional/computational system and reflects the hard problem of consciousness.

---

## 5. Tacit/Procedural Knowledge

### Test Case
- Knowing how to ride a bike
- Implicit knowledge of grammar
- Essential question: Is propositional `Content` too narrow?

### Attempted Construction

```typescript
// Attempt 1: Use procedural ContentType
const bikeKnowledge = constructContent(
  "Procedure for riding a bike: maintain balance, pedal, steer",
  'procedural'
);

// Attempt 2: Use function (from inferContentType line 711)
const grammarKnowledge = constructContent(
  (sentence: string) => isGrammatical(sentence),
  'procedural'
);
// ContentType inferred as 'procedural' for functions

// Attempt 3: Structured procedural content
const implicitGrammar = constructContent({
  type: "grammar_rule",
  pattern: "NP -> Det N",
  application: "implicit"
}, 'procedural');
```

### Analysis

The system does provide `'procedural'` content type:
```typescript
| 'procedural' // <how to do X> - know-how
```

And the `inferContentType` function (lines 704-715) recognizes functions:
```typescript
if (typeof data === 'function') return 'procedural';
```

However, there are **fundamental problems**:

1. **Representation vs. Execution**: The system can store a function object, but:
   - It cannot **execute** the function
   - The function's behavior is opaque to the grounding system
   - You cannot establish grounding relations based on procedural behavior

2. **Ryle's Distinction**: Gilbert Ryle distinguished knowing-how from knowing-that. Procedural knowledge is:
   - Non-propositional (can't be fully stated)
   - Dispositional (manifested in action)
   - Often unconscious

   The system can only store **descriptions** or **programs**, not the dispositional capacity itself.

3. **Polanyi's Tacit Dimension**: "We know more than we can tell." Tacit knowledge is:
   - Acquired through practice, not instruction
   - Cannot be fully articulated
   - Guides action without conscious awareness

   By definition, if it can be represented in `Content`, it's not truly tacit.

4. **Grounding Problem**: How do you ground procedural knowledge? The system's grounding types include `'evidential'`, `'explanatory'`, etc. - all propositional. There's no `'demonstrational'` or `'practical'` grounding type.

### Partial Success

The system CAN represent:
- Explicit procedures (recipes, algorithms)
- Declarative knowledge about procedures
- Function objects (opaque to grounding)

### What's Lost

- The dispositional/ability aspect of know-how
- The implicit, non-articulated nature of tacit knowledge
- The practical manifestation that constitutes procedural knowledge

### Verdict: **PARTIALLY_CONSTRUCTABLE**

The system can represent **explicit procedures** and **function objects**, but cannot capture **genuine tacit/procedural knowledge** as understood in epistemology. The gap is between **storing a description of how** and **actually knowing how**.

---

## 6. Collective Beliefs

### Test Case
- "The committee believes X"
- Group knowledge that no individual has
- Essential question: Is `Agent` too individualistic?

### Attempted Construction

```typescript
// The Agent type explicitly supports collectives
const committee: Agent = {
  id: createAgentId('committee'),
  type: 'collective', // Supported! (line 166)
  name: 'Ethics Committee',
  trustLevel: 'high'
};

// Collective belief
const collectiveBelief = constructContent(
  "The project should be approved",
  'propositional'
);

const collectiveObject = constructEpistemicObject(
  collectiveBelief,
  constructAttitude('accepting', { value: 0.9, basis: 'measured' }),
  { source: { type: 'human', description: 'Committee vote' } }
);
```

### Analysis

**GOOD NEWS**: The system explicitly handles this case!

From lines 165-169:
```typescript
export type AgentType =
  | 'human' // Individual human
  | 'ai' // AI system
  | 'collective' // Group (jury, committee, community)
  | 'idealized'; // Theoretical reasoner
```

The `'collective'` agent type is built into the primitives.

### Remaining Issues

1. **Aggregation Problem**: The system doesn't specify HOW collective beliefs emerge from individual beliefs. Is it majority vote? Consensus? Intersection?

2. **Discursive Dilemma**: Groups can have inconsistent beliefs through different aggregation of component propositions (Pettit). The system has no mechanism to detect or handle this.

3. **Distributed Knowledge**: Knowledge that exists in a group but not in any individual (each knows part of a password) requires more than just `type: 'collective'`.

### What's Present vs. Missing

**Present**:
- Collective agent type
- Ability to attribute beliefs to collectives

**Missing**:
- Aggregation mechanisms
- Handling of discursive dilemma
- Truly distributed (vs. aggregated) knowledge

### Verdict: **CONSTRUCTABLE**

The primitives CAN construct collective beliefs. The agent type explicitly supports collectives. Implementation details about aggregation are missing but not fundamentally blocked by the primitive design.

---

## 7. Future-Directed Intentions

### Test Case
- "I intend to X tomorrow"
- Prospective vs retrospective attitudes
- Essential question: Is the `Attitude` set complete?

### Attempted Construction

```typescript
// Available attitudes (lines 129-134):
// 'entertaining' | 'accepting' | 'rejecting' | 'questioning' | 'suspending'

// Attempt: Use 'accepting' for intention
const intention = constructContent(
  "I will exercise tomorrow",
  'propositional' // Or 'imperative'?
);

const intentionObject = constructEpistemicObject(
  intention,
  constructAttitude('accepting', { value: 0.8, basis: 'estimated' })
);
// PROBLEM: 'accepting' is for beliefs, not intentions
// Intentions are not truth-apt in the same way
```

### Analysis

The `AttitudeType` enum is:
```typescript
export type AttitudeType =
  | 'entertaining' // C is before the mind
  | 'accepting' // C is taken to hold
  | 'rejecting' // C is taken not to hold
  | 'questioning' // C's status is open
  | 'suspending'; // C's status is deliberately deferred
```

**Critical Gap**: These are all **doxastic** attitudes (belief-related). Missing are:

1. **Conative Attitudes**:
   - Intending (practical commitment to action)
   - Desiring (attraction toward state of affairs)
   - Preferring (ranking of alternatives)

2. **Prospective Character**: Intentions are:
   - Future-directed (about what will happen)
   - Commitment-involving (not just prediction)
   - Action-guiding (motivate behavior)

   'Accepting' that "I will X tomorrow" is a **prediction**, not an **intention**.

3. **Practical Reasoning**: Intentions enter into practical syllogisms:
   - I intend to X
   - Doing Y is necessary for X
   - Therefore I should do Y

   The system has no mechanism for practical inference.

### The Philosophy

Michael Bratman's work distinguishes intentions from beliefs:
- Intentions control conduct
- Intentions involve commitment
- Intentions resist reconsideration
- Intentions support practical reasoning

None of these distinctions can be captured with `'accepting'`.

### What's Lost

- The practical/conative nature of intentions
- The commitment-involving character
- Future-directedness as a mode (vs. content)
- Practical reasoning patterns

### Verdict: **PARTIALLY_CONSTRUCTABLE**

The system can represent **the content** of an intention (what I intend) but cannot capture **the attitudinal mode** that makes intentions different from beliefs. A future intention looks identical to a confident prediction in this system.

---

## 8. Partial Beliefs (Vagueness)

### Test Case
- Vague predicates ("tall")
- Degrees of truth
- Essential question: Does `GradedStrength` capture this, or conflate it with confidence?

### Attempted Construction

```typescript
// GradedStrength interface (lines 144-150):
// { value: number, basis: 'measured' | 'derived' | 'estimated' | 'absent' }

// Attempt: Represent "Tom is tall" where Tom is borderline
const tallContent = constructContent("Tom is tall", 'propositional');
const partialBelief = constructAttitude('accepting', {
  value: 0.6, // 60% tall?
  basis: 'estimated'
});

// PROBLEM: What does 0.6 mean?
// (A) 60% confident Tom is tall? (epistemic)
// (B) Tom is tall to degree 0.6? (semantic/ontic)
// These are DIFFERENT things!
```

### Analysis

The system has `GradedStrength`:
```typescript
export interface GradedStrength {
  readonly value: number;
  readonly basis: StrengthBasis;
}
```

But this **conflates two fundamentally different phenomena**:

1. **Epistemic Uncertainty**: "I'm 60% confident X is true"
   - Full truth, partial belief
   - Would be resolved by more information
   - Governs betting behavior

2. **Semantic Vagueness**: "X is 60% true" (degrees of truth)
   - Partial truth, full belief
   - Cannot be resolved by more information
   - The predicate itself is vague

### The Sorites Paradox

Consider: "A heap is > 10,000 grains. Removing one grain from a heap leaves a heap."
- At 10,001 grains: clearly a heap (truth value 1)
- At 9,999 grains: clearly not (truth value 0)
- At 10,000 grains: borderline (truth value ???)

The system would represent this as either:
- `accepting` with `strength: 0.5` (conflates with epistemic uncertainty)
- `questioning` (but this is wrong - we KNOW Tom is borderline, we're not uncertain)
- `suspending` (but we're not deferring judgment, we're asserting borderline-ness)

### Supervaluationism vs. Degree Theory

Different theories of vagueness:
- **Supervaluationism**: Borderline cases lack truth value
- **Degree theory**: Truth comes in degrees
- **Epistemicism**: Sharp boundaries, unknown location

The system's `GradedStrength` implicitly assumes degree theory but doesn't distinguish it from confidence.

### What's Lost

- The distinction between partial truth and partial belief
- The three-valued (true/false/borderline) structure of vagueness
- Higher-order vagueness (borderline borderline cases)
- The sorites-specific dynamics

### Verdict: **PARTIALLY_CONSTRUCTABLE**

The system can REPRESENT graded attitudes numerically, but **conflates fundamentally different phenomena**. A `strength: 0.6` could mean "60% confident" or "60% true" - these have completely different logical and inferential properties.

---

## Synthesis: Universality Assessment

### Fundamental Limitations

1. **Self-Reference**: The system **cannot** handle self-referential beliefs due to irreflexivity constraints and lack of fixpoint semantics. This is a **hard failure**.

2. **Qualia**: The system **cannot** represent qualitative character. This reflects the hard problem of consciousness and applies to any computational system. This is a **hard failure** (though arguably principled).

3. **De Se / Indexicals**: The system can **describe** but not **capture** first-person and context-dependent content. Essential semantic properties are lost.

4. **Procedural Knowledge**: The system can **store** but not **execute** or properly **ground** procedural content.

5. **Vagueness**: The system **conflates** fundamentally different phenomena (partial truth vs. partial belief).

6. **Intentions**: The attitude set is **incomplete**, missing conative attitudes.

### Where the System Succeeds

- **Collective beliefs**: Explicitly supported via AgentType
- **Propositional knowledge**: Core use case, well-handled
- **Explicit procedural descriptions**: Can be stored as Content
- **Graded confidence**: Well-modeled (when it IS confidence)

### Philosophical Implications

The system's primitives implicitly assume:
- **Propositionalism**: All knowledge is propositional or reducible to propositions
- **Functionalism**: Mental states are individuated by function, not intrinsic character
- **Extensionalism**: Grounding is extensional (same extension = same grounding)
- **Third-Person Perspective**: All content is publicly describable

These assumptions are philosophically contestable. The "universal constructability" claim fails precisely where these assumptions are challenged.

### Recommendations for Improvement

1. **Self-Reference**: Implement fixpoint semantics for self-referential content (but carefully - paradoxes are real).

2. **Indexicals**: Add a `character` field to Content that specifies how content is determined by context, not just what it is after evaluation.

3. **De Se**: Add a `perspective` field distinguishing first-person from third-person content.

4. **Qualia**: Acknowledge this as a principled limitation. Perhaps add a `phenomenal` flag indicating the content describes but does not capture qualia.

5. **Procedural**: Add grounding types for practical justification. Consider integration with execution environments.

6. **Vagueness**: Split `GradedStrength` into `EpistemicConfidence` and `DegreOfTruth` with different inferential behaviors.

7. **Intentions**: Add conative attitudes: `intending`, `desiring`, `preferring`.

---

## Final Verdict

**The universal constructability claim is PARTIALLY FALSE.**

The six primitives (Distinguishability, Content, Grounding, Attitude, Agent, Context) are **insufficient** to construct:
- Self-referential beliefs (hard failure)
- Qualitative conscious experience (hard failure, principled)
- The first-person character of de se attitudes (essential loss)
- Pre-contextual indexical characters (essential loss)
- Genuine tacit knowledge (essential loss)
- The distinction between partial truth and partial belief (conflation)
- Conative attitudes like intention (gap in primitive set)

The primitives **succeed** for:
- Standard propositional knowledge
- Collective epistemic agents
- Explicit procedural descriptions
- Graded epistemic confidence

The system is a **good model of third-person, propositional, functionally-individuated knowledge** but fails to be universal across all epistemic phenomena.

---

## Appendix: Test Matrix

| Phenomenon | Constructable? | What's Captured | What's Lost |
|------------|---------------|-----------------|-------------|
| Indexical "I am here now" | Partial | Description after context evaluation | Character, token-reflexivity |
| De se "I believe I am the messy shopper" | Partial | That agent has self-belief | First-person mode, immunity to error |
| Self-referential "This belief is unjustified" | No | Nothing | Self-reference itself (paradox) |
| Qualia "The redness of red" | No | Description of quale | Qualitative character |
| Tacit "Knowing how to ride a bike" | Partial | Procedure description | Dispositional know-how |
| Collective "The committee believes X" | Yes | Collective belief | Aggregation mechanism |
| Intention "I intend to X tomorrow" | Partial | Content of intention | Attitudinal mode |
| Vagueness "Tom is tall" (borderline) | Partial | Graded value | Distinction from confidence |

---

*This adversarial analysis was conducted with the explicit goal of finding failures. Where constructions succeed, they are acknowledged. Where they fail, the precise nature of the failure is documented.*
