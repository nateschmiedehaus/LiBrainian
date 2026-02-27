# Universal Epistemic Primitives

**Status**: Research Document
**Version**: 1.0.0
**Date**: 2026-01-29
**Purpose**: Identify the minimal, universal building blocks from which ANY epistemic/coherence structure can be constructed

---

## Executive Summary

This document identifies the **truly primitive** building blocks of epistemology - not specific structures like "philosophy -> principles -> design" but the primitives from which such structures can be **constructed**.

Just as:
- **Set theory** gives us membership (x in S) and constructs numbers, functions, everything
- **Lambda calculus** gives us abstraction and application, constructing any computation
- **Category theory** gives us objects and morphisms, constructing mathematical structure

We seek the **epistemic equivalents** - the minimal set of primitives from which any knowledge structure emerges.

### Key Finding

We identify **six primitive concepts** and **four primitive operations** that together form a complete basis for epistemic construction:

**Primitives**:
1. **Distinguishability** (Delta) - The capacity to differentiate
2. **Content** (C) - That which can be distinguished
3. **Grounding** (G) - The "in virtue of" relation
4. **Attitude** (A) - Epistemic stance toward content
5. **Agent** (a) - Locus of epistemic states
6. **Context** (K) - Situation of evaluation

**Operations**:
1. **CONSTRUCT** - Build complex from simple
2. **RELATE** - Establish grounding connections
3. **EVALUATE** - Assess status given relations
4. **REVISE** - Update under new information

All epistemic structures - beliefs, knowledge, justification hierarchies, coherence networks, scientific theories, legal arguments - emerge as constructions from these primitives.

---

## Table of Contents

1. [Motivation: Why Primitives?](#1-motivation-why-primitives)
2. [The Primitive Objects](#2-the-primitive-objects)
3. [The Primitive Relations](#3-the-primitive-relations)
4. [The Primitive Operations](#4-the-primitive-operations)
5. [Emergence of Structure](#5-emergence-of-structure)
6. [Universality Tests](#6-universality-tests)
7. [Connection to Existing Theory](#7-connection-to-existing-theory)
8. [Formal Specification](#8-formal-specification)
9. [Implementation Implications](#9-implementation-implications)
10. [References](#10-references)

---

## 1. Motivation: Why Primitives?

### 1.1 The Problem with Non-Primitive Approaches

Most epistemological frameworks start with relatively high-level concepts:
- "Belief" and "knowledge" (epistemic logic)
- "Justification" and "evidence" (traditional epistemology)
- "Claims" and "arguments" (argumentation theory)
- "Probability" and "credence" (Bayesian epistemology)

These are not primitive. They are **constructed** from more basic elements:
- A "belief" is an attitude toward content held by an agent
- "Justification" is grounding of one thing in another
- A "claim" is content with an assertive attitude
- "Probability" is a measure over possibilities (which presupposes distinguishability)

### 1.2 The Analogy to Foundations of Mathematics

In mathematics, we learned that:

1. **Numbers are not primitive** - They can be constructed from sets (von Neumann: 0 = {}, 1 = {{}}, ...)
2. **Functions are not primitive** - They are sets of ordered pairs
3. **Everything reduces to membership** - The single relation x in S

Similarly, in computation:

1. **Conditionals are not primitive** - Church booleans encode if-then-else
2. **Recursion is not primitive** - Y combinator provides it
3. **Everything reduces to abstraction and application** - lambda x.M and (M N)

### 1.3 What We Seek

We seek the **epistemic membership relation** - the truly primitive concept(s) from which:
- Beliefs, knowledge, justification emerge
- Coherence and truth emerge
- Scientific method, legal reasoning, everyday cognition emerge

The criterion is **constructive completeness**: Can we build any epistemic structure from these primitives?

---

## 2. The Primitive Objects

### 2.1 Distinguishability (Delta) - The Most Primitive

**Claim**: The most primitive epistemic concept is **distinguishability** - the capacity to differentiate one thing from another.

**Justification**:

Before there can be knowledge, belief, or any epistemic state, there must be the capacity to distinguish:
- This from that
- Now from then
- Here from there
- True from false
- Known from unknown

Without distinguishability, there is no cognition whatsoever.

**Formal Statement**:

```
Delta: U x U -> {distinguished, indistinguished}

Where U is the universe of potential contents.

Delta(x, y) = distinguished iff x and y can be differentiated
Delta(x, x) = indistinguished (reflexivity: nothing distinguishes from itself)
```

**Philosophical Grounding**:

- Parmenides: Being is what is distinguishable from non-being
- Leibniz's Identity of Indiscernibles: Objects are identical iff indistinguishable
- Information theory: A bit is a distinction between two states
- Category theory: Morphisms preserve/create distinctions

**From Distinction, Everything Follows**:

As argued in recent categorical approaches to mind ([Dietrich et al.](https://link.springer.com/chapter/10.1007/978-3-319-68246-4_3)), from distinction alone we can construct:
- States (distinguished regions of possibility space)
- Transitions (distinguished changes between states)
- Identity (the relation of indistinguishability)
- Content (that which is distinguished)

### 2.2 Content (C) - That Which Can Be Distinguished

**Definition**: Content is anything that can be the object of an epistemic state - anything that can be distinguished.

**Clarification**: This is NOT "proposition" which carries logical structure. Content is more primitive:

```
Content = anything distinguishable

Types of content include (but are not limited to):
- Propositional content: "The cat is on the mat"
- Perceptual content: <visual field state>
- Procedural content: <how to ride a bike>
- Indexical content: <this, here, now>
- Interrogative content: "Is the cat on the mat?"
```

**Why Not Start With Propositions?**

Propositions assume:
- A language or representation system
- Truth-evaluability
- Compositional structure

But infants, animals, and pre-linguistic cognition have epistemic states without propositions. Content is what these states are **about**, regardless of linguistic expression.

**Formal Characterization**:

```
C is content iff:
1. C can be distinguished (Delta(C, not-C) = distinguished)
2. C can be the target of an attitude (see Section 2.4)
```

### 2.3 Grounding (G) - The "In Virtue Of" Relation

**Definition**: Grounding is the primitive relation of one thing holding **in virtue of** another.

**Claim**: Grounding is more primitive than "support," "justification," "entailment," or "causation."

**Justification**:

All other epistemic relations can be constructed from grounding:
- **Support**: X supports Y = X partially grounds Y
- **Justification**: X justifies Y = X grounds the acceptability of Y
- **Entailment**: X entails Y = X fully grounds Y's truth
- **Explanation**: X explains Y = X grounds Y's being the case

**Formal Properties** (following [Fine 2012](https://plato.stanford.edu/entries/grounding/), [Rosen 2010]):

```
Grounding G: Content x Content -> {grounds, does_not_ground}

Structural properties:
1. Irreflexivity: not G(x, x) - nothing grounds itself
2. Asymmetry: G(x, y) implies not G(y, x)
3. Transitivity: G(x, y) and G(y, z) implies G(x, z)
4. Well-foundedness: No infinite descending G-chains (controversial)
```

**Grounding vs. Causation**:

- Causation is temporal (cause precedes effect)
- Grounding is constitutive (ground need not precede grounded)
- Example: The set {Socrates} is grounded in Socrates existing, but doesn't follow temporally

**Grounding as the Primitive Epistemic Relation**:

If we have only Delta (distinguishability) and G (grounding), we can construct:
- **Coherence**: Mutual grounding compatibility
- **Hierarchy**: Chains of grounding
- **Foundation**: Ungrounded grounders
- **Defeat**: Grounding of negation

### 2.4 Attitude (A) - Epistemic Stance Toward Content

**Definition**: An attitude is a mode of relating to content epistemically.

**Clarification**: This is NOT just "belief" or "credence." Attitudes are more primitive:

```
Primitive attitudes include:
- Entertaining: C is before the mind
- Accepting: C is taken to hold
- Rejecting: C is taken not to hold
- Questioning: C's status is open
- Suspending: C's status is deliberately deferred
```

**Formal Characterization**:

```
Attitude A: Agent x Content -> AttitudeType

Where AttitudeType in {entertaining, accepting, rejecting, questioning, suspending, ...}
```

**From Primitive Attitudes, Complex States Emerge**:

- **Belief** = stable accepting attitude
- **Disbelief** = stable rejecting attitude
- **Doubt** = questioning attitude
- **Knowledge** = accepting + grounding + truth (according to various analyses)
- **Credence** = graded accepting attitude

### 2.5 Agent (a) - Locus of Epistemic States

**Definition**: An agent is anything that can hold attitudes toward contents.

**Why Agents Are Primitive**:

Epistemic states don't float free - they are always states **of** something. Even "objective" knowledge is knowledge **available to** some class of agents.

**Minimal Agent Requirements**:

```
x is an agent iff:
1. x can distinguish (has Delta capacity)
2. x can hold attitudes toward contents
3. x's attitudes can change over time
```

This allows:
- Humans
- AI systems
- Collectives (juries, scientific communities)
- Idealized reasoners (for theoretical purposes)

### 2.6 Context (K) - Situation of Evaluation

**Definition**: Context is the complete situation in which epistemic evaluation occurs.

**Why Context Is Primitive**:

Knowledge claims are not absolute - they are always relative to:
- What information is available
- What standards are in play
- What the practical stakes are
- What alternatives are relevant

**Formal Characterization**:

```
Context K includes:
- Available information: I_K (what evidence/background is accessible)
- Standards: S_K (what counts as sufficient grounding)
- Stakes: R_K (practical consequences of being wrong)
- Alternatives: A_K (relevant alternatives to consider)
```

**Contextualism in Epistemology**:

The insight from [epistemic contextualism](https://plato.stanford.edu/entries/contextualism-epistemology/) is that knowledge attributions shift with context. Our primitive framework captures this:

```
"a knows C" is true in K iff:
- a has attitude of accepting toward C in K
- a has sufficient grounding for C relative to S_K
- a has ruled out alternatives in A_K
```

---

## 3. The Primitive Relations

### 3.1 GROUNDS - The Fundamental Epistemic Relation

**Definition**: X GROUNDS Y means Y holds (at least partially) in virtue of X.

This is the primitive from which all other epistemic relations are constructed.

**Formal Specification**:

```
GROUNDS(X, Y) where X, Y are Contents

Properties:
- Irreflexive: not GROUNDS(X, X)
- Asymmetric: GROUNDS(X, Y) implies not GROUNDS(Y, X)
- Transitive: GROUNDS(X, Y) and GROUNDS(Y, Z) implies GROUNDS(X, Z)

Variations:
- FULLY_GROUNDS(X, Y): Y holds entirely in virtue of X
- PARTIALLY_GROUNDS(X, Y): Y holds partially in virtue of X
- GROUNDS_WITH(X, Y, Z): X and Y together ground Z
```

### 3.2 CONFLICTS - Incompatibility Relation

**Definition**: X CONFLICTS Y means X and Y cannot both hold in the same context.

**Derivation from GROUNDS**:

```
CONFLICTS(X, Y) iff GROUNDS(X, not-Y) or GROUNDS(Y, not-X)
```

Or more fundamentally: X and Y conflict when accepting both leads to incoherence.

**Formal Properties**:

```
CONFLICTS(X, Y)

Properties:
- Symmetric: CONFLICTS(X, Y) iff CONFLICTS(Y, X)
- Irreflexive: not CONFLICTS(X, X) (nothing conflicts with itself)
- Not transitive: CONFLICTS(X, Y) and CONFLICTS(Y, Z) does not imply CONFLICTS(X, Z)
```

### 3.3 COHERES - Compatibility Relation

**Definition**: X COHERES Y means X and Y can both hold together and (optionally) provide mutual support.

**Derivation**:

```
Weak coherence: COHERES(X, Y) iff not CONFLICTS(X, Y)
Strong coherence: COHERES(X, Y) iff not CONFLICTS(X, Y) and
                  (GROUNDS(X, Y) or GROUNDS(Y, X) or EXISTS Z: GROUNDS(Z, X) and GROUNDS(Z, Y))
```

### 3.4 Emergence of Complex Relations

From GROUNDS and CONFLICTS, we construct:

**Justification**:
```
JUSTIFIES(X, Y) iff GROUNDS(X, acceptability(Y))
```

**Evidence**:
```
EVIDENCE_FOR(E, H) iff GROUNDS(E, increased_probability(H))
```

**Defeater**:
```
DEFEATS(D, X for Y) iff:
  - GROUNDS(X, Y) and
  - GROUNDS(D, undermined(X grounds Y)) -- undercutting defeater
  OR
  - GROUNDS(D, not-Y) -- rebutting defeater
```

**Support**:
```
SUPPORTS(X, Y) iff PARTIALLY_GROUNDS(X, Y) and not FULLY_GROUNDS(X, Y)
```

**Entailment**:
```
ENTAILS(X, Y) iff FULLY_GROUNDS(X, truth(Y))
```

---

## 4. The Primitive Operations

### 4.1 CONSTRUCT - Building Complex from Simple

**Definition**: CONSTRUCT takes primitive elements and produces complex epistemic objects.

**Formal Specification**:

```
CONSTRUCT: Primitives* -> EpistemicObject

Where EpistemicObject can be:
- Simple content
- Structured content (propositions, arguments, theories)
- Epistemic states (beliefs, knowledge states)
- Epistemic structures (belief networks, justification hierarchies)
```

**Construction Rules**:

1. **Content Construction**:
```
CONSTRUCT(c1, c2, ..., cn, structure) -> ComplexContent
Example: CONSTRUCT("cat", "mat", on) -> "The cat is on the mat"
```

2. **State Construction**:
```
CONSTRUCT(agent, attitude, content) -> EpistemicState
Example: CONSTRUCT(Alice, accepting, "cat on mat") -> Alice believes the cat is on the mat
```

3. **Structure Construction**:
```
CONSTRUCT(states, relations) -> EpistemicStructure
Example: CONSTRUCT({belief1, belief2}, {GROUNDS(belief1, belief2)}) -> Justification hierarchy
```

### 4.2 RELATE - Establishing Grounding Connections

**Definition**: RELATE establishes or discovers grounding relations between contents.

**Formal Specification**:

```
RELATE(X, Y) -> Relation(X, Y)

Where Relation in {GROUNDS, CONFLICTS, COHERES, unrelated}
```

**Properties**:

- RELATE is the fundamental operation for building epistemic structure
- It may be performed by reasoning, observation, or analysis
- It can be defeasible (relations may be revised)

### 4.3 EVALUATE - Assessing Status Given Relations

**Definition**: EVALUATE determines the epistemic status of content given the grounding network.

**Formal Specification**:

```
EVALUATE(content, groundingNetwork, context) -> Status

Where Status includes:
- Grounded: Has sufficient grounding in network
- Ungrounded: Lacks sufficient grounding
- Defeated: Grounding is undercut or rebutted
- Contradicted: Conflicts with something grounded
- Incoherent: Part of a conflict set
- Unknown: Status cannot be determined
```

**Evaluation Procedure**:

```
EVALUATE(C, N, K):
1. Find all G in N such that GROUNDS(G, C)
2. Check for defeaters D such that DEFEATS(D, G, C)
3. Check for conflicts X such that CONFLICTS(X, C) and EVALUATE(X, N, K) = grounded
4. Apply context standards S_K to determine if grounding is sufficient
5. Return status
```

### 4.4 REVISE - Update Under New Information

**Definition**: REVISE modifies the grounding network when new information arrives.

**Formal Specification**:

```
REVISE(network, newContent, attitude) -> UpdatedNetwork

Operations:
- EXPAND: Add new content with its groundings
- CONTRACT: Remove content and dependent groundings
- REPLACE: Substitute new for old content
```

**Revision Principles** (following [AGM theory](https://plato.stanford.edu/entries/logic-belief-revision/)):

```
1. Closure: Revised network maintains coherence
2. Success: New content is incorporated (unless contradictory)
3. Inclusion: Revision doesn't add more than necessary
4. Vacuity: If new content is consistent, revision = expansion
5. Consistency: Revision maintains consistency if possible
6. Minimal Change: Give up as little as possible
```

**Connection to Defeaters**:

When new content defeats existing content:
```
REVISE(N, D, accepting):
  If DEFEATS(D, G, C) for some GROUNDS(G, C) in N:
    Either: Remove GROUNDS(G, C) from N
    Or: Mark C as defeated (retain for history)
```

---

## 5. Emergence of Structure

### 5.1 How Hierarchy Emerges

**Claim**: Hierarchical structure is not primitive - it emerges from grounding chains.

**Construction**:

```
X is more fundamental than Y iff GROUNDS(X, Y) or EXISTS Z: GROUNDS(X, Z) and GROUNDS(Z, Y)

Level assignment:
- Level 0: Ungrounded grounders (foundations)
- Level n+1: Content grounded only by content at level <= n
```

**Example - Philosophy -> Principles -> Design Hierarchy**:

```
Philosophical commitment: "Systems should be transparent"
  GROUNDS
Principle: "All decisions must be explainable"
  GROUNDS
Design decision: "Use interpretable models"
```

The hierarchy exists because of the grounding relations, not independently.

### 5.2 How Coherence Emerges

**Claim**: Coherence is not a primitive property - it emerges from absence of conflicts in the transitive closure of relations.

**Construction**:

```
Network N is coherent iff:
1. No contradictions: not EXISTS X, Y in N: CONFLICTS(X, Y) and both grounded
2. No cycles in grounding: No X such that GROUNDS+(X, X) where GROUNDS+ is transitive closure
3. Well-foundedness: Every grounding chain terminates (optional, debatable)
```

**Degrees of Coherence**:

Rather than binary coherence, we can measure:
```
coherence(N) = 1 - (|conflicts in N| / |possible pairs in N|)
```

Or more sophisticated measures considering:
- Centrality of conflicting nodes
- Strength of grounding relations
- Resolution possibilities

### 5.3 How Justification Emerges

**Claim**: Justification is constructed from grounding relations relative to standards.

**Construction**:

```
C is justified in context K iff:
1. EXISTS G: GROUNDS(G, C) -- there is a ground
2. G is acceptable in K -- the ground meets standards
3. No undefeated defeater D for GROUNDS(G, C) -- grounding not undercut
```

**Foundationalism vs. Coherentism**:

Both emerge from the same primitives with different structural constraints:

**Foundationalist Structure**:
```
Network N is foundationalist iff:
- EXISTS F subset N: members of F are ungrounded (foundations)
- FORALL C in N - F: EXISTS path G1, G2, ..., Gn, C where G1 in F
```

**Coherentist Structure**:
```
Network N is coherentist iff:
- Not EXISTS F: members of F ungrounded (no foundations required)
- Justification from mutual COHERES relations
```

### 5.4 How Knowledge Emerges

**Claim**: Knowledge is constructed from attitude + grounding + truth + modal stability.

**Construction** (following various analyses):

```
Agent a knows C in context K iff:
1. a has accepting attitude toward C
2. C is true (GROUNDS(world, C))
3. GROUNDS(a's grounds, C) -- a's acceptance is grounded
4. STABLE(a's grounds, C) -- grounding is modally robust
5. Meets K's standards -- context-appropriate grounding
```

Different knowledge analyses (JTB, safety, sensitivity, virtue) emerge as different specifications of conditions 3-5.

---

## 6. Universality Tests

### 6.1 Scientific Method

**Can our primitives construct scientific reasoning?**

**Hypothesis**: Content representing possible world state
**Evidence**: Content representing observations
**Theory**: Structured content representing law-like regularities

```
Scientific Reasoning in Primitives:

1. CONSTRUCT(observations) -> hypothesis H
2. CONSTRUCT(experiment) -> prediction P
3. RELATE(observations, H) -> GROUNDS(observations, H) or CONFLICTS(observations, H)
4. EVALUATE(H, observationNetwork, scientificStandards)
5. REVISE(theoryNetwork, new_observations, accepting)
```

**Confirmation**: GROUNDS(E, increased_probability(H))
**Disconfirmation**: GROUNDS(E, decreased_probability(H)) or CONFLICTS(E, prediction(H))
**Theory Change**: REVISE when accumulated defeats exceed threshold

**Verdict**: YES - Scientific method is constructible.

### 6.2 Legal Reasoning

**Can our primitives construct legal argumentation?**

**Legal Claim**: Content representing what law requires/permits
**Evidence**: Content representing facts of case
**Precedent**: Grounding relations from prior decisions

```
Legal Reasoning in Primitives:

1. CONSTRUCT(factual_claims, legal_claims) -> case
2. RELATE(precedent, current_claim) -> GROUNDS(precedent, current_claim)
3. RELATE(opposing_evidence, claim) -> DEFEATS(opposing_evidence, grounds, claim)
4. EVALUATE(claim, evidenceNetwork, legalStandards)
```

**Burden of Proof**: Standard S_K specifying required grounding strength
**Beyond Reasonable Doubt**: S_K requiring no undefeated alternatives
**Preponderance**: S_K requiring more grounding than opposing position

**Verdict**: YES - Legal reasoning is constructible.

### 6.3 Software Architecture

**Can our primitives construct architectural knowledge?**

**Architectural Decision**: Content representing design choice
**Rationale**: Grounding for decision
**Constraint**: Content that conflicts with certain decisions

```
Architectural Reasoning in Primitives:

1. CONSTRUCT(requirements, constraints) -> decision_space
2. CONSTRUCT(decision, rationale) -> architectural_decision_record
3. RELATE(decision1, decision2) -> COHERES or CONFLICTS
4. RELATE(requirement, decision) -> GROUNDS(requirement, decision)
5. EVALUATE(decision, decisionNetwork, architecturalStandards)
```

**Trade-off**: CONFLICTS(decision_A_benefit, decision_B_benefit) with neither fully grounding the other
**Technical Debt**: GROUNDS(shortcut, immediate_benefit) but GROUNDS(shortcut, future_cost)

**Verdict**: YES - Architectural reasoning is constructible.

### 6.4 Mathematical Proof

**Can our primitives construct mathematical reasoning?**

**Theorem**: Content representing mathematical statement
**Axiom**: Ungrounded grounder (foundational)
**Proof**: Chain of grounding relations from axioms to theorem

```
Mathematical Reasoning in Primitives:

1. CONSTRUCT(axioms) -> foundation
2. CONSTRUCT(inference_step) -> lemma
3. RELATE(premises, conclusion) -> GROUNDS(premises, conclusion)
4. Proof = Chain: GROUNDS(axioms, lemma1), GROUNDS(lemma1, lemma2), ..., GROUNDS(lemma_n, theorem)
5. EVALUATE(theorem, proofNetwork, mathematicalStandards)
```

**Mathematical Standards**:
- S_K requires FULL_GROUNDS (not partial)
- S_K requires no gaps in chain
- S_K requires axioms be accepted

**Constructive vs. Classical**: Different standards for what counts as grounding

**Verdict**: YES - Mathematical proof is constructible.

### 6.5 Artistic Judgment

**Can our primitives construct aesthetic evaluation?**

This is the hardest test - aesthetic judgment seems resistant to systematization.

**Aesthetic Claim**: Content representing quality judgment ("This painting is beautiful")
**Aesthetic Evidence**: Perceptual/formal properties
**Aesthetic Standards**: Context-dependent criteria

```
Aesthetic Reasoning in Primitives:

1. CONSTRUCT(perceptual_features) -> aesthetic_content
2. RELATE(formal_properties, aesthetic_judgment) -> GROUNDS(formal_properties, judgment)
3. RELATE(contextual_features, judgment) -> modifies grounding strength
4. EVALUATE(judgment, aestheticNetwork, communityStandards)
```

**Key Insight**: Aesthetic judgment has grounding, but:
- Grounds are often implicit/hard to articulate
- Standards S_K vary dramatically across contexts
- CONFLICTS between judgments may not be resolvable

**Verdict**: YES with caveats - Aesthetic judgment is constructible, but grounding is often implicit and standards are highly contextual.

### 6.6 Universality Assessment

| Domain | Constructible? | Notes |
|--------|---------------|-------|
| Scientific Method | YES | Standard case |
| Legal Reasoning | YES | Standards are explicit |
| Software Architecture | YES | Trade-offs natural |
| Mathematical Proof | YES | Strongest grounding |
| Everyday Reasoning | YES | Implicit grounding |
| Aesthetic Judgment | YES* | Implicit grounding, contextual standards |
| Ethical Reasoning | YES* | Contested grounding, value conflicts |
| Religious/Faith | Partial | Some content taken as ungrounded |

*With caveats about implicit grounding and contested standards.

---

## 7. Connection to Existing Theory

### 7.1 Category Theory: Objects and Morphisms

**Category Theory Primitives**:
- Objects: Things
- Morphisms: Structure-preserving maps between things
- Composition: Combining morphisms
- Identity: Morphism from object to itself

**Mapping to Epistemic Primitives**:

```
Category Theory          Epistemic Primitives
--------------          -------------------
Objects            <->   Contents
Morphisms          <->   Grounding relations
Composition        <->   Transitive grounding
Identity           <->   Reflexive coherence
Functors           <->   Structure-preserving CONSTRUCT
```

**The Epistemic Category**:

We can define a category **Epist** where:
- Objects = Contents
- Morphisms = Grounding relations
- Composition = Transitivity of grounding
- Identity = Self-coherence

This connects our primitives to the rich structure of category theory.

### 7.2 Type Theory: Types and Terms

**Type Theory Primitives**:
- Types: Classifications of terms
- Terms: Inhabitants of types
- Judgment: Assertion that term has type
- Propositions-as-Types: Propositions are types, proofs are terms

**Mapping to Epistemic Primitives**:

```
Type Theory             Epistemic Primitives
-----------             -------------------
Types              <->   Content schemas
Terms              <->   Specific contents
Judgment           <->   Attitude toward content
Proof              <->   Grounding chain
Dependent Types    <->   Context-dependent content
```

**Epistemic Type Theory**:

Under the Curry-Howard correspondence:
- Propositions = Types = Contents
- Proofs = Terms = Groundings
- Judgment "a : A" = "a grounds A"

Our GROUNDS relation is the epistemic analog of the typing judgment.

### 7.3 Formal Epistemology: Modal Logic

**Epistemic Logic Primitives** ([Hintikka 1962](https://plato.stanford.edu/entries/logic-epistemic/)):
- K_a(P): Agent a knows P
- B_a(P): Agent a believes P
- Possible worlds semantics

**Mapping to Epistemic Primitives**:

```
Epistemic Logic         Epistemic Primitives
---------------         -------------------
K_a(P)             <->   EVALUATE(P, a's_network, knowledge_standards) = grounded
B_a(P)             <->   Agent a has accepting attitude toward P
Possible worlds    <->   Distinguished possibilities (via Delta)
Accessibility      <->   Compatibility (not CONFLICTS)
```

**Derivation**: Modal operators emerge from our primitives:
```
K_a(P) in context K iff:
- Attitude(a, P) = accepting
- EVALUATE(P, N, K) = grounded
- Truth: P holds at actual world
- Stability: P holds at all accessible worlds (= worlds not ruled out by grounding)
```

### 7.4 Argumentation Theory: Dung Frameworks

**Abstract Argumentation Primitives** ([Dung 1995](https://en.wikipedia.org/wiki/Argumentation_framework)):
- Arguments: Abstract entities
- Attack relation: Binary relation on arguments
- Extensions: Acceptable sets of arguments

**Mapping to Epistemic Primitives**:

```
Argumentation           Epistemic Primitives
-------------           -------------------
Argument           <->   Content with attitude
Attack             <->   DEFEATS (constructed from GROUNDS + CONFLICTS)
Defense            <->   Counter-defeating
Extension          <->   Coherent network under EVALUATE
```

**Key Insight**: Dung's attack relation is not primitive - it's constructed from grounding and conflict:
```
A attacks B iff:
- GROUNDS(A, not-B) -- rebutting attack
- OR GROUNDS(A, undermined(C grounds B)) for some C -- undercutting attack
```

### 7.5 Bayesian Epistemology: Probability

**Bayesian Primitives**:
- Credence: Degree of belief in [0,1]
- Conditionalization: Updating on evidence
- Coherence: Satisfying probability axioms

**Mapping to Epistemic Primitives**:

```
Bayesian                Epistemic Primitives
--------                -------------------
Credence           <->   Graded attitude (accepting with strength)
Prior              <->   Initial grounding strength
Likelihood         <->   Grounding strength of evidence given hypothesis
Posterior          <->   Updated grounding strength after REVISE
Dutch Book         <->   Incoherence under certain CONFLICTS patterns
```

**Derivation**: Probability emerges from counting distinguished possibilities:
```
P(A) = |{distinguished worlds where A}| / |{distinguished worlds}|
```

This requires Delta (distinguishability) as primitive.

### 7.6 Summary: What's Truly Primitive?

Across all formal frameworks, we find the same primitives in different guises:

| Framework | Our Primitives | Their Name |
|-----------|---------------|------------|
| Category Theory | Content, Grounding | Objects, Morphisms |
| Type Theory | Content, Grounding | Types, Typing judgment |
| Epistemic Logic | Agent, Attitude, Content | K_a(P), B_a(P) |
| Argumentation | Content+Attitude, DEFEATS | Arguments, Attack |
| Bayesian | Graded Attitude, REVISE | Credence, Conditionalization |
| Set Theory | Distinguishability | Membership |

Our primitives unify these frameworks.

---

## 8. Formal Specification

### 8.1 Primitive Signature

```
EPISTEMIC_PRIMITIVES ::=

  // Primitive Objects
  Delta    : U x U -> {distinguished, indistinguished}
  Content  : {x | Delta(x, not-x) = distinguished}
  Agent    : {a | can_hold_attitudes(a)}
  Context  : (Information, Standards, Stakes, Alternatives)

  // Primitive Attitudes
  Attitude : Agent x Content -> AttitudeType
  AttitudeType ::= entertaining | accepting | rejecting | questioning | suspending

  // Primitive Relations
  GROUNDS  : Content x Content -> Bool
    with: irreflexive, asymmetric, transitive

  CONFLICTS : Content x Content -> Bool
    with: symmetric, irreflexive
    derived: CONFLICTS(X,Y) <-> GROUNDS(X, not-Y) or GROUNDS(Y, not-X)

  COHERES : Content x Content -> Bool
    derived: COHERES(X,Y) <-> not CONFLICTS(X,Y)

  // Primitive Operations
  CONSTRUCT : Primitives* -> EpistemicObject
  RELATE    : Content x Content -> Relation
  EVALUATE  : Content x Network x Context -> Status
  REVISE    : Network x Content x Attitude -> Network
```

### 8.2 Axioms

```
// Distinguishability Axioms
Ax1. Delta(x, x) = indistinguished                    (reflexivity)
Ax2. Delta(x, y) = distinguished implies Delta(y, x) = distinguished  (symmetry)

// Grounding Axioms
Ax3. not GROUNDS(x, x)                                (irreflexivity)
Ax4. GROUNDS(x, y) implies not GROUNDS(y, x)          (asymmetry)
Ax5. GROUNDS(x, y) and GROUNDS(y, z) implies GROUNDS(x, z)  (transitivity)

// Conflict Axioms
Ax6. not CONFLICTS(x, x)                              (irreflexivity)
Ax7. CONFLICTS(x, y) iff CONFLICTS(y, x)              (symmetry)

// Attitude Axioms
Ax8. Attitude(a, c) = accepting implies not Attitude(a, c) = rejecting
Ax9. Attitude(a, c) = rejecting implies not Attitude(a, c) = accepting

// Evaluation Axioms
Ax10. GROUNDS(g, c) and EVALUATE(g, N, K) = grounded and no_undefeated_defeater(g, c, N)
      implies EVALUATE(c, N, K) = grounded
Ax11. CONFLICTS(c, d) and EVALUATE(c, N, K) = grounded
      implies EVALUATE(d, N, K) in {defeated, contradicted}

// Revision Axioms (AGM-style)
Ax12. REVISE(N, c, accepting) produces N' where c in N' or CONFLICTS(c, something_in_N)
Ax13. REVISE preserves maximal non-conflicting subset
```

### 8.3 Theorems

From these axioms, we can derive:

```
Thm1. (Hierarchy Emergence)
      GROUNDS-chains induce a strict partial order on contents.

Thm2. (Coherence as Consistency)
      Network N is coherent iff no CONFLICTS between grounded members.

Thm3. (Defeat Functionality)
      D defeats the grounding of C by G iff GROUNDS(D, undermined(GROUNDS(G,C)))

Thm4. (Knowledge Construction)
      Knowledge = accepting attitude + true content + grounded + stable

Thm5. (Justification Relativity)
      Justification is relative to context K via standards S_K
```

---

## 9. Implementation Implications

### 9.1 For LiBrainian's Epistemic System

The primitive analysis suggests LiBrainian should organize its epistemics around:

**1. Distinguishability as Foundation**

Every epistemic operation ultimately traces to distinguishing:
- True from false
- Grounded from ungrounded
- This claim from that claim

```typescript
// Core distinguishability
interface Distinguishable {
  canDistinguish(other: Distinguishable): boolean;
  identity(): string;  // What makes this distinguishable
}
```

**2. Grounding as Primary Relation**

The evidence graph's edge types should be understood as varieties of grounding:
- `supports` = partial grounding
- `defeats` = grounding of undermining
- `contradicts` = grounding of negation

```typescript
// Grounding-centric edge model
interface GroundingEdge {
  from: ContentId;
  to: ContentId;
  type: 'full' | 'partial' | 'undermining' | 'rebutting';
  strength: number;
}
```

**3. Context-Sensitive Evaluation**

Evaluation should explicitly take context parameters:

```typescript
interface EvaluationContext {
  availableInformation: Evidence[];
  standards: EpistemicStandards;
  stakes: number;  // Affects required grounding strength
  relevantAlternatives: Content[];
}

function evaluate(
  content: Content,
  network: GroundingNetwork,
  context: EvaluationContext
): EpistemicStatus;
```

**4. Principled Revision**

Belief revision should follow AGM-style principles:

```typescript
interface RevisionResult {
  network: GroundingNetwork;
  changes: Change[];
  minimality: boolean;  // Did we change minimally?
  consistency: boolean; // Is result consistent?
}

function revise(
  network: GroundingNetwork,
  newContent: Content,
  attitude: Attitude
): RevisionResult;
```

### 9.2 Type System Implications

The primitives suggest a richer type system:

```typescript
// Content with provenance
type Content<T = unknown> = {
  data: T;
  distinguisher: string;  // What makes this content unique
};

// Grounded content
type Grounded<C extends Content> = {
  content: C;
  grounds: GroundingChain;
  status: 'grounded' | 'partially_grounded' | 'ungrounded';
};

// Agent-attributed
type Attributed<C extends Content, A extends Agent> = {
  content: C;
  holder: A;
  attitude: AttitudeType;
};

// Context-relative
type InContext<C extends Content, K extends Context> = {
  content: C;
  context: K;
  evaluation: EpistemicStatus;
};
```

### 9.3 Operation Signatures

```typescript
// CONSTRUCT: Build complex from simple
function construct<T extends Content>(
  parts: Content[],
  structure: StructureType
): T;

// RELATE: Establish grounding
function relate(
  from: Content,
  to: Content
): GroundingRelation | ConflictRelation | null;

// EVALUATE: Assess status
function evaluate(
  content: Content,
  network: GroundingNetwork,
  context: EvaluationContext
): EpistemicStatus;

// REVISE: Update network
function revise(
  network: GroundingNetwork,
  newContent: Content,
  attitude: AttitudeType
): RevisionResult;
```

---

## 10. References

### Foundational Philosophy

- Aristotle. *Posterior Analytics*. (Original theory of epistemic grounds)
- Plato. *Theaetetus*. (Knowledge as justified true belief)
- Leibniz, G.W. *Monadology*. (Identity of indiscernibles)

### Formal Epistemology

- [Hintikka, J. (1962)](https://plato.stanford.edu/entries/logic-epistemic/). *Knowledge and Belief*. Cornell University Press.
- [Alchourron, C., Gardenfors, P., & Makinson, D. (1985)](https://philpapers.org/browse/agm-belief-revision-theory). "On the Logic of Theory Change." *Journal of Symbolic Logic*.
- [Williamson, T. (2000)](https://www.rep.routledge.com/articles/overview/epistemology/v-3/sections/knowledge-first-epistemology-1). *Knowledge and Its Limits*. Oxford University Press.

### Grounding Theory

- [Fine, K. (2012)](https://plato.stanford.edu/entries/grounding/). "Guide to Ground." In *Metaphysical Grounding*.
- [Rosen, G. (2010)](https://link.springer.com/article/10.1007/s10670-022-00561-7). "Metaphysical Dependence." In *Modality*.
- [Schaffer, J. (2009)](https://plato.stanford.edu/entries/grounding/). "On What Grounds What." In *Metametaphysics*.

### Category Theory and Epistemology

- [Awodey, S. (2010)](https://plato.stanford.edu/entries/category-theory/). *Category Theory*. Oxford University Press.
- [Spivak, D.I. (2014)](https://link.springer.com/chapter/10.1007/978-3-319-68246-4_3). *Category Theory for the Sciences*. MIT Press.

### Type Theory

- [Martin-Lof, P. (1984)](https://plato.stanford.edu/entries/type-theory-intuitionistic/). *Intuitionistic Type Theory*. Bibliopolis.
- [Pfenning, F. & Davies, R. (2001)](https://www.cs.cmu.edu/~fp/papers/mscs00.pdf). "A Judgmental Reconstruction of Modal Logic."

### Argumentation Theory

- [Dung, P.M. (1995)](https://en.wikipedia.org/wiki/Argumentation_framework). "On the Acceptability of Arguments." *Artificial Intelligence*.
- [Pollock, J. (1987)](https://iep.utm.edu/defeaters-in-epistemology/). "Defeasible Reasoning." *Cognitive Science*.

### Bayesian Epistemology

- [Titelbaum, M. (2022)](https://plato.stanford.edu/entries/epistemology-bayesian/). *Fundamentals of Bayesian Epistemology*. Oxford University Press.
- [Jeffrey, R. (1983)](https://plato.stanford.edu/entries/epistemology-bayesian/). *The Logic of Decision*. University of Chicago Press.

### Contextualism

- [DeRose, K. (2009)](https://plato.stanford.edu/entries/contextualism-epistemology/). *The Case for Contextualism*. Oxford University Press.
- [Lewis, D. (1996)](https://plato.stanford.edu/entries/contextualism-epistemology/). "Elusive Knowledge." *Australasian Journal of Philosophy*.

### Information Theory

- [Dretske, F. (1981)](https://philpapers.org/rec/DREKAT). *Knowledge and the Flow of Information*. MIT Press.
- [Shannon, C.E. (1948)](https://plato.stanford.edu/entries/information/). "A Mathematical Theory of Communication."

---

## Appendix A: Comparison With Alternative Primitive Sets

### A.1 Williamson's Knowledge-First

Timothy Williamson proposes knowledge as primitive, with belief, evidence, etc. derived.

**Assessment**:
- Advantages: Elegant, unified
- Problems: Knowledge presupposes truth, which presupposes distinguishability

Our primitives are more fundamental: Knowledge = attitude + grounding + truth + stability

### A.2 Chisholm's Epistemic Preferability

Roderick Chisholm uses "more reasonable than" as primitive.

**Assessment**:
- Advantages: Single primitive for comparative epistemology
- Problems: Presupposes contents to compare, presupposes standards

Our primitives are more fundamental: Preferability = better grounded in context K

### A.3 Doxastic Primitives

Some start with belief (doxastic states) as primitive.

**Assessment**:
- Advantages: Psychologically natural
- Problems: Belief presupposes content, attitude, agent

Our primitives are more fundamental: Belief = agent + accepting attitude + content

### A.4 Information-Theoretic

Fred Dretske proposes information as primitive, with knowledge as information-caused belief.

**Assessment**:
- Advantages: Naturalistic, connects to physics
- Problems: Information presupposes distinguishability

Our primitives are compatible: Information flow = pattern of GROUNDS relations

---

## Appendix B: Universality Proof Sketch

**Claim**: Any epistemic structure can be constructed from our primitives.

**Proof Sketch**:

1. **Any epistemic state involves**:
   - Something it's about (content)
   - Someone holding it (agent)
   - How they hold it (attitude)

   These are covered by Content, Agent, Attitude primitives.

2. **Any epistemic relation involves**:
   - One thing bearing on another
   - This is either grounding, conflict, or coherence

   These are covered by GROUNDS, CONFLICTS, COHERES.

3. **Any epistemic structure involves**:
   - Components (constructed from primitives)
   - Relations between components (established by RELATE)
   - Status assignments (computed by EVALUATE)
   - Changes over time (performed by REVISE)

   These are covered by our four operations.

4. **By induction**:
   - Base case: Single content with attitude = primitive state
   - Inductive case: Complex structure = CONSTRUCT from simpler structures

   Therefore any epistemic structure is constructible.

**QED** (informal)

---

## Appendix C: Connection to LiBrainian's Existing Types

| LiBrainian Type | Primitive Correspondence |
|----------------|-------------------------|
| `Claim` | Content + assertive attitude |
| `ClaimId` | Distinguishability identifier |
| `ConfidenceValue` | Graded accepting attitude |
| `EvidenceEdge` | Grounding relation |
| `ExtendedDefeater` | DEFEATS construction |
| `Contradiction` | CONFLICTS relation |
| `EvidenceGraph` | Grounding network |
| `ClaimSource` | Agent specification |
| `ClaimStatus` | EVALUATE result |

LiBrainian's existing architecture is compatible with and can be understood through these primitives.

---

*This document establishes the foundational primitives for epistemic construction. All more complex epistemic structures - from everyday beliefs to scientific theories to legal arguments - emerge from these six primitives and four operations.*
