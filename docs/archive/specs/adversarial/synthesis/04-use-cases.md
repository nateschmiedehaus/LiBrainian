# Part 4: Software Development Use Cases

[Back to Index](./index.md) | [Previous: Action Theory](./03-action-theory.md) | [Next: Bad Agents](./05-bad-agents.md)

---

This section demonstrates epistemic grounding construction for 20 software development scenarios spanning common, rare, unusual, and edge cases.

---

## 4.1 Common Use Cases

### Use Case 1: Bug Fix with Clear Reproduction Steps

**Scenario**: A bug is reported with clear steps to reproduce. Agent needs to understand, locate, and fix the bug.

**Epistemic Construction**:

```
OBJECTS:
  O1: BugReport = "Users see 500 error on /api/users endpoint"
      Attitude: accepting (0.95, measured)
      Level: observation

  O2: ReproductionSteps = "1. Login 2. Call GET /api/users 3. See 500"
      Attitude: accepting (0.98, measured)
      Level: observation

  O3: ErrorLog = "NullPointerException at UserService.java:142"
      Attitude: accepting (1.0, measured)
      Level: observation

  O4: RootCause = "user.getProfile() returns null when profile not set"
      Attitude: accepting (0.85, derived)
      Level: diagnosis

  O5: Fix = "Add null check: if (user.getProfile() != null)"
      Attitude: accepting (0.9, derived)
      Level: implementation

  O6: Verification = "Test passes after fix applied"
      Attitude: accepting (1.0, measured)
      Level: observation

GROUNDINGS:
  G1: O1 evidentially grounds O3 (the error log is evidence of the bug)
  G2: O2 evidentially grounds O3 (reproduction confirms the error)
  G3: O3 evidentially grounds O4 (stack trace points to root cause)
  G4: O4 explanatorily grounds O5 (diagnosis explains the fix)
  G5: O5 inferentially grounds O6 (fix predicts verification)
  G6: O6 evidentially grounds O5 (verification confirms fix correctness)

COHERENCE:
  Network is coherent:
  - No contradictions
  - All non-foundations grounded
  - Grounding flows observation → diagnosis → implementation → verification
```

**Code**:
```typescript
const bugFix = constructCoherenceNetwork([
  constructEpistemicObject(
    constructContent('Users see 500 error on /api/users', 'propositional'),
    constructAttitude('accepting', { value: 0.95, basis: 'measured' }),
    { level: constructAbstractionLevel('observation', 0, 1.0) }
  ),
  // ... other objects
], [
  constructGrounding(errorLog.id, rootCause.id, 'evidential', { value: 0.85, basis: 'evidential' }),
  // ... other groundings
]);

const evaluation = evaluateCoherence(bugFix);
// evaluation.status.coherent === true
// evaluation.recommendations === [] (no issues)
```

---

### Use Case 2: Feature Addition with Well-Defined Requirements

**Scenario**: Add user profile avatars with clear requirements document.

**Epistemic Construction**:

```
HIERARCHY:
  L0: Requirements (entrenchment: 1.0)
  L1: Design (entrenchment: 0.8)
  L2: Implementation (entrenchment: 0.5)
  L3: Tests (entrenchment: 0.3)

OBJECTS:
  R1: "Users can upload profile avatars" (requirement)
  R2: "Avatars must be < 5MB" (requirement)
  R3: "Supported formats: jpg, png, gif" (requirement)

  D1: "AvatarService handles upload/storage" (design)
  D2: "S3 bucket for avatar storage" (design)
  D3: "ImageProcessor for validation/resize" (design)

  I1: "AvatarService.upload() implementation" (implementation)
  I2: "S3Client integration code" (implementation)

  T1: "AvatarServiceTest covers upload scenarios" (test)

GROUNDINGS:
  R1 → D1 (requirement grounds design decision)
  R2 → D3 (size limit grounds need for processor)
  R3 → D3 (format support grounds processor)
  D1 → I1 (design grounds implementation)
  D2 → I2 (storage decision grounds integration)
  I1 → T1 (implementation grounds test)
  T1 → I1 (test verifies implementation) -- Note: bidirectional strengthening
```

---

### Use Case 3: Refactoring for Performance

**Scenario**: Database queries are slow; need to optimize without changing behavior.

**Epistemic Construction**:

```
OBJECTS:
  P1: "Query response time > 2s" (problem, measured)
  P2: "N+1 query pattern detected" (diagnosis, derived)

  C1: "Current behavior: returns user with posts" (constraint)
  C2: "Must maintain API contract" (constraint)

  S1: "Use JOIN instead of N+1 queries" (solution)
  S2: "Add database index on user_id" (solution)

  V1: "Query time reduced to 50ms" (verification, measured)
  V2: "API contract tests pass" (verification, measured)

GROUNDINGS:
  P1 evidentially grounds P2
  P2 explanatorily grounds S1
  P2 explanatorily grounds S2
  C1 enables S1 (constraint shapes solution)
  C2 enables S1
  S1 inferentially grounds V1
  S2 inferentially grounds V1
  V2 evidentially grounds C2 (verification confirms constraint met)

COHERENCE CHECK:
  - S1 must not undermine C1 (behavior preservation)
  - S1 must not undermine C2 (API contract)
  If undermining detected → refactoring violates constraints
```

---

### Use Case 4: Code Review Feedback Integration

**Scenario**: Reviewer provides feedback; agent must understand and address comments.

**Epistemic Construction**:

```
MULTI-AGENT SETUP:
  A1: Author (human, trust: medium)
  A2: Reviewer (human, trust: high)

OBJECTS:
  F1: "Use dependency injection instead of new" (A2 feedback)
      Attitude: accepting (0.9)
      Source: A2

  F2: "Add null check on line 45" (A2 feedback)
      Attitude: accepting (0.95)
      Source: A2

  F3: "Extract method for readability" (A2 feedback)
      Attitude: accepting (0.7)
      Source: A2

  R1: "Addressed: DI implemented" (A1 response)
  R2: "Addressed: null check added" (A1 response)
  R3: "Declined: method extraction reduces locality" (A1 response)
      Includes: Counter-argument content

GROUNDINGS:
  F1 evidentially grounds R1 (feedback grounds response)
  F2 evidentially grounds R2
  F3 evidentially grounds R3

  For R3 (declined):
    Counter-argument undermines F3
    Must evaluate: Is counter-argument stronger than original feedback?

EVALUATION:
  evaluateCoherence([F1, F2, F3, R1, R2, R3, counter_argument])

  If counter_argument.effectiveStrength > F3.effectiveStrength:
    R3 is justified (decline is grounded)
  Else:
    Recommendation: Reconsider F3 - reviewer feedback has stronger grounding
```

---

### Use Case 5: Dependency Update

**Scenario**: Update a dependency with potential breaking changes.

**Epistemic Construction**:

```
OBJECTS:
  D1: "Current: lodash@4.17.20" (fact)
  D2: "Available: lodash@4.17.21" (fact)
  D3: "Changelog: security fix for prototype pollution" (fact)
  D4: "No breaking changes listed" (fact)

  G1: "Goal: Keep dependencies secure" (goal)
  G2: "Goal: Minimize breaking changes" (goal)

  A1: "Action: Update to 4.17.21" (candidate action)

  V1: "Tests pass after update" (verification)
  V2: "Security scan passes" (verification)

PRACTICAL REASONING:
  - A1 is grounded in G1 (via D3 - security fix addresses security goal)
  - A1 is not undermined by G2 (via D4 - no breaking changes)
  - A1 is verified by V1 and V2

COHERENCE:
  Action A1 is coherent with goals and not undermined by constraints
  Recommend: Proceed with update
```

---

## 4.2 Rare Use Cases

### Use Case 6: Major Architecture Overhaul

**Scenario**: Migrating from monolith to microservices.

**Epistemic Construction**:

```
MULTI-LEVEL GROUNDING:

Level 0 (Philosophy):
  P1: "Services should be independently deployable"
  P2: "Failure isolation improves resilience"
  P3: "Teams should own their services"

Level 1 (Principles):
  PR1: "Single responsibility per service" (grounded in P1)
  PR2: "API contracts are sacred" (grounded in P2)
  PR3: "Bounded contexts define service boundaries" (grounded in P3)

Level 2 (Architecture):
  AR1: "UserService handles authentication" (grounded in PR1, PR3)
  AR2: "OrderService handles orders" (grounded in PR1, PR3)
  AR3: "Services communicate via REST" (grounded in PR2)

Level 3 (Design):
  DE1: "UserService API: /auth/*, /users/*"
  DE2: "OrderService API: /orders/*"
  DE3: "Shared authentication via JWT"

Level 4 (Implementation):
  IM1: "UserService Node.js implementation"
  IM2: "OrderService Java implementation"

CONSISTENCY CHECKS:
  For each implementation decision:
    1. Trace grounding chain to philosophy
    2. Verify no contradictions at each level
    3. Flag ungrounded decisions

  Example violation:
    IM3: "Direct database access from OrderService to UserService DB"
    This UNDERMINES: AR1 (independence), PR1 (single responsibility)
    evaluateCoherence flags this as 'contradiction' severity: 'error'
```

---

### Use Case 7: Framework Migration (React Class to Hooks)

**Scenario**: Systematically convert class components to functional components with hooks.

**Epistemic Construction**:

```
OBJECTS:

Knowledge Base:
  K1: "Class components use this.state" (fact)
  K2: "Hooks use useState for state" (fact)
  K3: "componentDidMount → useEffect with []" (mapping)
  K4: "componentDidUpdate → useEffect with deps" (mapping)
  K5: "this.setState → setState from useState" (mapping)

Current State:
  C1: "UserProfile is class component" (observed)
  C2: "UserProfile uses this.state.user" (observed)
  C3: "UserProfile has componentDidMount" (observed)

Transformation:
  T1: "Convert UserProfile to function" (action)
  T2: "Replace this.state.user with useState" (action, grounded in K2, C2)
  T3: "Replace componentDidMount with useEffect" (action, grounded in K3, C3)

Verification:
  V1: "Behavior unchanged after migration" (goal)
  V2: "No this references remain" (check)
  V3: "Tests pass" (check)

GROUNDING CHAIN:
  C2 + K2 → T2 (observation + knowledge grounds transformation)
  C3 + K3 → T3
  T1 + T2 + T3 → V1 (transformations ground behavior preservation)

COHERENCE:
  If any Ti undermines V1 → flag for review
  If any observation Ci not covered by transformation → flag incomplete migration
```

---

### Use Case 8: Security Vulnerability Response

**Scenario**: CVE announced affecting a critical dependency.

**Epistemic Construction**:

```
URGENCY-AWARE GROUNDING:

High-Stakes Context:
  context.stakes = 'critical'
  context.standards.minimumGroundingStrength = 0.9  // Higher threshold

Objects:
  CVE: "CVE-2026-12345: RCE in log4j < 2.17" (threat, authoritative source)
      Attitude: accepting (1.0, measured)
      TrustLevel: authoritative (from NVD)

  DEP: "Our system uses log4j 2.15" (fact, measured)

  VULN: "Our system is vulnerable" (diagnosis)
      Grounded in: CVE + DEP

  PATCH: "Upgrade to log4j 2.17" (action)
      Grounded in: CVE (fix version specified)

  MITIGATE: "Set log4j2.formatMsgNoLookups=true" (interim action)
      Grounded in: CVE (mitigation specified)

  VERIFY: "Vulnerability scanner shows clean" (verification)
      Grounded in: PATCH applied

PRACTICAL REASONING:
  Goals:
    G1: "System must be secure" (critical priority)
    G2: "Minimize downtime" (high priority)

  Action evaluation:
    PATCH: Strong grounding in G1, may undermine G2 (requires deployment)
    MITIGATE: Partial grounding in G1, preserves G2

  Recommended sequence:
    1. MITIGATE immediately (fast, addresses G1 partially)
    2. PATCH in planned deployment (full fix)

COHERENCE:
  After VERIFY, VULN should be undermined (defeated)
  If VULN still grounded → patching incomplete
```

---

### Use Case 9: Database Schema Migration

**Scenario**: Add new column with data migration, zero downtime required.

**Epistemic Construction**:

```
CONSTRAINTS:
  CON1: "Zero downtime required" (hard constraint)
  CON2: "Data must be preserved" (hard constraint)
  CON3: "Old code must work during migration" (compatibility)

MIGRATION PHASES:
  Phase 1: Add nullable column
    M1: "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255)"
    M1 NOT undermined by CON1 (non-blocking DDL)
    M1 NOT undermined by CON2 (additive)
    M1 NOT undermined by CON3 (nullable = old code ignores it)

  Phase 2: Backfill data
    M2: "UPDATE users SET avatar_url = ... WHERE avatar_url IS NULL"
    M2 grounded in: Phase 1 complete
    M2 must NOT undermine CON1 (batch updates required)

  Phase 3: Make non-nullable
    M3: "ALTER TABLE users ALTER COLUMN avatar_url SET NOT NULL"
    M3 grounded in: Phase 2 complete (all rows have data)
    M3 undermines CON3 unless: Old code updated first

  Phase 4: Update code
    M4: "Deploy code that writes to avatar_url"
    M4 grounded in: Phase 3 complete

COHERENCE CHECK:
  evaluateCoherence([M1, M2, M3, M4, CON1, CON2, CON3])

  If M3 attempted before M2 complete:
    M3 undermined by: "NULL values still exist"
    Violation: data integrity

  If M4 attempted before M3:
    M4 may write NULLs, violating future constraint
```

---

### Use Case 10: API Versioning Change

**Scenario**: Introduce v2 API while maintaining v1 compatibility.

**Epistemic Construction**:

```
OBJECTS:

Contracts:
  V1_CONTRACT: "GET /api/v1/users returns {id, name, email}"
  V2_CONTRACT: "GET /api/v2/users returns {id, name, email, profile}"

Implementations:
  V1_IMPL: "UserControllerV1 implements V1_CONTRACT"
  V2_IMPL: "UserControllerV2 implements V2_CONTRACT"

Compatibility:
  COMPAT: "V1 clients continue working unchanged"

Groundings:
  V1_CONTRACT grounds V1_IMPL (contract → implementation)
  V2_CONTRACT grounds V2_IMPL
  V1_IMPL grounds COMPAT (v1 implementation grounds v1 compatibility)

Potential Violation:
  If V2_IMPL modifies shared code that V1_IMPL depends on:
    V2_IMPL may UNDERMINE COMPAT

  Detection:
    shared_code_changes = diff(V2_IMPL, baseline)
    v1_dependencies = dependencies(V1_IMPL)
    overlap = intersect(shared_code_changes, v1_dependencies)

    If overlap not empty:
      constructGrounding(V2_IMPL.id, COMPAT.id, 'undermining')
      evaluateCoherence flags contradiction
```

---

## 4.3 Unusual Use Cases

### Use Case 11: Debugging Production Crash with Only Logs

**Scenario**: System crashed at 3 AM. Only evidence: logs and a stack trace. No reproduction possible.

**Epistemic Construction**:

```
EPISTEMIC SITUATION:
  - High uncertainty (cannot reproduce)
  - Multiple hypotheses (abductive reasoning)
  - Limited evidence

OBJECTS:

Evidence (Observations):
  E1: "java.lang.OutOfMemoryError at 03:14:22" (log, measured)
  E2: "Heap usage 98% at 03:14:00" (metric, measured)
  E3: "Batch job started at 03:00:00" (log, measured)
  E4: "Batch processed 1M records" (log, measured)
  E5: "No similar crash in past 30 days" (history, measured)

Hypotheses (Candidate Explanations):
  H1: "Batch job caused memory exhaustion"
      Grounded in: E1, E2, E3, E4
      Strength: 0.75 (temporal correlation, causal plausibility)

  H2: "Memory leak accumulated over time"
      Grounded in: E1, E2
      Weakened by: E5 (no prior crashes suggests sudden event)
      Strength: 0.3

  H3: "Unusual data volume in batch"
      Grounded in: E3, E4
      Needs: Comparison to normal batch size
      Strength: 0.5 (pending evidence)

ABDUCTIVE EVALUATION:
  Best explanation = highest grounding strength after all evidence

  Gather additional evidence:
    E6: "Normal batch: 100K records, this batch: 1M (10x)" (measured)
    E6 strengthens H3: 0.5 → 0.85
    H3 + H1 compatible: "Unusual batch size caused OOM"

  Combined hypothesis:
    H_COMBINED: "10x batch size exhausted memory"
    Grounded in: E1, E2, E3, E4, E6
    Strength: 0.9

RECOMMENDED ACTIONS:
  A1: "Add batch size limit" (grounded in H_COMBINED)
  A2: "Increase heap size" (grounded in E2, weaker)
  A3: "Add memory monitoring alert" (grounded in detection gap)
```

---

### Use Case 12: Inheriting Undocumented Legacy Codebase

**Scenario**: Took over a codebase with no documentation, original author left.

**Epistemic Construction**:

```
EPISTEMIC SITUATION:
  - Minimal foundational knowledge
  - Must build up from observation
  - High uncertainty, gradual confidence building

INITIAL STATE:
  All objects at entrenchment 0.3 (low confidence)

OBSERVATION PHASE:
  O1: "Directory structure suggests MVC" (observed)
      Attitude: entertaining (0.5) -- tentative

  O2: "Database schema has 47 tables" (observed)
      Attitude: accepting (0.9) -- directly measurable

  O3: "Main entry point is index.php" (observed)
      Attitude: accepting (0.95)

HYPOTHESIS BUILDING:
  H1: "System is PHP MVC framework"
      Grounded in: O1, O3
      Attitude: entertaining → accepting as more evidence

  H2: "User table is central entity"
      Grounded in: O2 + FK analysis
      Strength increases with more FK evidence

CONFIDENCE PROGRESSION:
  Day 1: Most hypotheses at 'entertaining' (0.3-0.5)
  Day 7: Key patterns at 'accepting' (0.6-0.8)
  Day 30: Core architecture understood (0.8-0.95)

GROUNDING GAPS:
  evaluateCoherence identifies:
  - Ungrounded: "Why does function X exist?"
  - Ungrounded: "What is the purpose of table Y?"

  These become investigation tasks:
  TaskCreate("Understand function X", "Examine usage and add grounding")
```

---

### Use Case 13: Fixing Intermittent Race Condition

**Scenario**: Test fails 5% of the time with no clear pattern.

**Epistemic Construction**:

```
EPISTEMIC CHALLENGE:
  - Non-deterministic behavior
  - Evidence appears and disappears
  - Timing-dependent causation

OBJECTS:

Observations:
  O1: "TestX fails approximately 5% of runs" (statistical, measured)
  O2: "Failure is 'AssertionError: expected 2, got 1'" (specific failure)
  O3: "Test involves async operations" (code observation)
  O4: "Failure rate higher under load" (correlation, measured)

Race Condition Pattern:
  RCP: "Read-Modify-Write without synchronization"
      Matches: O2 (count off by one), O3 (async), O4 (more contention)

Diagnosis:
  D1: "Counter increment is not atomic"
      Grounded in: RCP pattern match
      Verification: Code inspection finds `count++` not synchronized

Fix:
  F1: "Use AtomicInteger instead of int"
      Grounded in: D1 (atomic operations prevent race)

Verification Challenge:
  V1: "Test passes 1000x in a row"
      Grounding strength: statistical (p-value calculation)
      Cannot prove absence of bug, only reduce probability

  Confidence calculation:
    Prior: 5% failure rate
    Observed: 0 failures in 1000 runs
    P(bug_fixed | 0_failures_in_1000) = ?

    Using Bayesian:
    P(0 in 1000 | not fixed) = 0.95^1000 ≈ 0
    P(0 in 1000 | fixed) ≈ 1
    P(fixed | 0 in 1000) ≈ 1 (strong evidence)

  V1 confidence: 0.99+ (but not 1.0 -- asymptotic)

COHERENCE:
  After F1 applied and V1 observed:
    D1 transitions from 'entertaining' to 'accepting' (0.95)
    F1 transitions from 'proposed' to 'verified' (0.99)
```

---

### Use Case 14: Recovering from Corrupted Git History

**Scenario**: Force push to main overwrote last week of commits. Need to recover.

**Epistemic Construction**:

```
EPISTEMIC SITUATION:
  - Known prior state (partial)
  - Distributed evidence (developer machines)
  - Reconstruction required

OBJECTS:

Known Facts:
  F1: "HEAD is now at abc123" (current corrupted state)
  F2: "Last known good was def456, 7 days ago"
  F3: "reflog shows push --force at 14:30 today"

Evidence Sources:
  S1: "Developer A's local main at abc789" (potential)
  S2: "Developer B's local main at xyz123" (potential)
  S3: "CI server cached checkout at fed987" (potential)
  S4: "GitHub Events API shows merge of PR #42" (audit log)

Reconstruction Hypothesis:
  H1: "True history is in Developer A's local"
      Grounded in: S1 fetch, compare to S4
      If S1 contains PR #42 merge → H1 confidence high

  H2: "Need to combine multiple sources"
      If no single source has full history

Recovery Actions:
  A1: "git fetch from all potential sources"
  A2: "Identify most complete history"
  A3: "Force push corrected history"
  A4: "Notify team to reset locals"

GROUNDINGS:
  S4 (audit log) is AUTHORITATIVE -- grounds truth of what happened
  S1, S2, S3 must be consistent with S4 to be valid recovery sources

  Validation:
    For each Si:
      commits_in_Si = git log Si
      events_in_S4 = GitHub Events
      if commits_in_Si.includes(events_in_S4):
        Si.validity.strengthen()
      else:
        Si.validity.undermine()

COHERENCE:
  Recovery is complete when:
    - Reconstructed history is consistent with S4 (audit log)
    - All known PRs/commits are present
    - Team members confirm sync
```

---

### Use Case 15: Merging Conflicting Feature Branches

**Scenario**: Two long-running branches both modified the same files significantly.

**Epistemic Construction**:

```
OBJECTS:

Branch States:
  B1: "feature/auth-refactor: 47 commits, modifies AuthService"
  B2: "feature/oauth-support: 32 commits, modifies AuthService"
  MAIN: "Current main branch"

Conflict Analysis:
  C1: "Both modify AuthService.authenticate()"
  C2: "B1 renames method to authenticateUser()"
  C3: "B2 adds OAuth parameter to authenticate()"

Semantic Intentions:
  I1: "B1 intent: Improve naming clarity"
  I2: "B2 intent: Support OAuth authentication"

Compatibility Check:
  Q1: "Are I1 and I2 compatible?"
      Analysis: I1 is rename, I2 is functionality
      These are orthogonal changes → compatible

  Q2: "Can merged result satisfy both intents?"
      Merged: "authenticateUser(oauthToken?: string)"
      Satisfies I1: Better name ✓
      Satisfies I2: OAuth support ✓

Merge Strategy:
  M1: "Rename method as per B1"
  M2: "Add OAuth parameter as per B2"
  M3: "Update all call sites for new signature"

GROUNDINGS:
  I1 grounds M1
  I2 grounds M2
  M1 + M2 ground M3 (both changes require call site updates)

COHERENCE VERIFICATION:
  Post-merge tests must pass for both:
    T1: "Auth refactor tests" (verifies I1 preserved)
    T2: "OAuth integration tests" (verifies I2 preserved)

  If any test fails:
    Identify which intent is violated
    Refine merge strategy
```

---

## 4.4 Edge Cases

### Use Case 16: Conflicting Requirements from Stakeholders

**Scenario**: PM wants feature X, Security wants to block feature X, Legal has third opinion.

**Epistemic Construction**:

```
MULTI-AGENT CONFLICT:

Agents:
  PM: ProductManager (trust: high for business requirements)
  SEC: SecurityTeam (trust: authoritative for security)
  LEGAL: LegalTeam (trust: authoritative for compliance)

Requirements:
  R1: "Feature: Allow users to download all their data" (PM)
      Grounded in: "GDPR data portability requirement"
      Attitude: accepting (0.9)

  R2: "Block: Bulk data export enables data theft" (SEC)
      Grounded in: "Security threat model"
      Attitude: accepting (0.85)
      Type: UNDERMINES R1

  R3: "Required: GDPR mandates data export capability" (LEGAL)
      Grounded in: "GDPR Article 20"
      Attitude: accepting (0.95)
      Type: GROUNDS R1

CONFLICT RESOLUTION:

Step 1: Identify conflict
  evaluateCoherence([R1, R2, R3])
  Returns: contradiction between R1 and R2

Step 2: Evaluate grounding strengths
  R1 effective strength: 0.9 + 0.95 (from R3) = boosted
  R2 effective strength: 0.85
  R3: Authoritative source (legal) gives priority

Step 3: Find synthesis
  S1: "Implement data export WITH security controls"
      - Rate limiting
      - Re-authentication required
      - Audit logging
      - Download notification to user

  S1 is grounded in:
    R1 (satisfies PM need)
    R3 (satisfies legal requirement)
    Not undermined by R2 if security controls address threat

Step 4: Verify synthesis
  Ask SEC: "Do these controls address the threat?"
  If YES: R2.undermining_of_S1 = null (conflict resolved)
  If NO: Iterate on controls

COHERENCE:
  Final network: [R1, R2, R3, S1, controls]
  S1 is the synthesis that satisfies all stakeholders
  No unresolved contradictions
```

---

### Use Case 17: Impossible Deadline with Incomplete Specs

**Scenario**: "Ship feature Y by Friday, specs coming tomorrow, it's Wednesday."

**Epistemic Construction**:

```
UNCERTAINTY MODELING:

Objects:
  DEADLINE: "Feature Y ships Friday EOD" (constraint)
      Attitude: accepting (1.0) -- non-negotiable per stakeholder

  SPEC_GAP: "Full specs not available until Thursday" (fact)
      Attitude: accepting (1.0) -- measured

  EFFORT_UNKNOWN: "Cannot estimate without specs" (epistemic limitation)
      Attitude: accepting (0.9)

Risk Objects:
  RISK1: "May build wrong thing without specs" (risk)
      Grounded in: SPEC_GAP

  RISK2: "May not finish in time even with specs" (risk)
      Grounded in: SPEC_GAP (late specs = less time)

  RISK3: "Cutting corners may introduce bugs" (risk)
      Grounded in: time pressure

PRACTICAL REASONING:

Goals:
  G1: "Ship feature Y" (high priority)
  G2: "Feature Y works correctly" (high priority)
  G3: "No critical bugs shipped" (critical priority)

Actions:
  A1: "Wait for specs, then build"
      Grounded in: G2 (correctness)
      May undermine G1 (deadline)

  A2: "Build based on assumptions, iterate"
      Grounded in: G1 (deadline)
      May undermine G2 (might build wrong thing)

  A3: "Negotiate deadline extension"
      Grounded in: G2, G3
      Undermined by: DEADLINE (stakeholder won't budge)

  A4: "Ship minimal viable + iterate post-ship"
      Grounded in: G1 (ships something)
      Partially satisfies G2 (minimal is correct, full comes later)
      Must NOT undermine G3 (minimal must be bug-free)

EVALUATION:
  evaluatePracticalCoherence([G1, G2, G3, A1, A2, A3, A4, DEADLINE])

  Result:
    A3: Undermined (deadline fixed)
    A1: High risk of missing deadline
    A2: High risk of wasted work
    A4: Best balance -- ship minimal, verify quality, iterate

RECOMMENDATION:
  "Ship minimal feature with core functionality by Friday.
   Full feature in subsequent release.
   Document scope reduction and reasoning."

  Grounding trace:
    SPEC_GAP → EFFORT_UNKNOWN → cannot_guarantee_full → A4
    G3 (no bugs) → minimal_must_be_tested → A4 includes testing
```

---

### Use Case 18: Code That "Works" But Nobody Knows Why

**Scenario**: Critical function has comments "DON'T TOUCH - IT WORKS" but no explanation.

**Epistemic Construction**:

```
EPISTEMIC SITUATION:
  - Functional behavior confirmed
  - Causal understanding absent
  - High risk of Chesterton's Fence

Objects:
  FUNC: "MysteryFunction() produces correct output" (observed)
      Attitude: accepting (0.95) -- tests pass

  WHY: "Why MysteryFunction() works" (unknown)
      Attitude: questioning -- explicitly unknown
      Grounding: NONE (the core problem)

  WARNING: "Comment: DON'T TOUCH - IT WORKS" (social evidence)
      Attitude: entertaining (0.6)
      Interpretation: Previous developer also didn't understand

  TESTS: "Test suite covers MysteryFunction()" (verification)
      Attitude: accepting (0.9)

Chesterton's Fence Principle:
  CF: "Don't remove until you understand why it exists"
      Grounded in: Historical wisdom
      Applies to: FUNC

Understanding Process:
  U1: "Trace execution with debugger" (action)
  U2: "Identify edge cases being handled" (discovery)
  U3: "Document discovered behavior" (capture knowledge)
  U4: "Explain WHY in comments" (share knowledge)

GROUNDING CONSTRUCTION:
  Before: FUNC has no grounding for WHY
  After U1-U4:
    U2 discoveries ground WHY
    WHY grounds FUNC (now we understand)

Modification Safety:
  SAFE_TO_MODIFY: "Can modify MysteryFunction"
      Requires: WHY.attitude = 'accepting' with strength > 0.8
      Until then: WARNING applies

COHERENCE:
  Network evolves:
    Initial: FUNC grounded, WHY ungrounded (warning applies)
    After investigation: WHY grounded → SAFE_TO_MODIFY enabled

  If attempted modification while WHY ungrounded:
    System generates warning:
    "Modification attempted on code with ungrounded understanding.
     Risk: May break unknown invariants.
     Recommendation: Complete understanding tasks U1-U4 first."
```

---

### Use Case 19: Test Suite Passes But Production Fails

**Scenario**: All tests green, but production is broken in the same scenario.

**Epistemic Construction**:

```
CONTRADICTION DETECTION:

Objects:
  TEST: "Test for scenario X passes" (measured in CI)
      Attitude: accepting (1.0)

  PROD: "Scenario X fails in production" (measured by users)
      Attitude: accepting (1.0)

Contradiction Analysis:
  TEST and PROD appear contradictory
  Both are measured facts → both accepted

  Resolution requires: Finding disanalogy between test and prod environments

Gap Analysis Objects:
  G1: "Test uses mock database, prod uses real database" (potential)
  G2: "Test uses localhost, prod uses load balancer" (potential)
  G3: "Test data is clean, prod data is messy" (potential)
  G4: "Test runs sequentially, prod runs concurrently" (potential)

ABDUCTIVE REASONING:
  For each Gi:
    Does Gi explain TEST ∧ ¬PROD?

  G3 Analysis:
    H: "Prod data contains edge case not in test data"
    If H:
      TEST passes (edge case not present)
      PROD fails (edge case triggers bug)
    H explains the contradiction

  Verification:
    V1: "Examine prod data for edge cases"
    V2: "If edge case found, add to test data"
    V3: "Test now fails → contradiction explained"

GROUNDINGS:
  G3 (disanalogy) grounds H (hypothesis)
  H explains (TEST ∧ ¬PROD)
  V3 confirms H

CORRECTIVE ACTIONS:
  A1: "Fix bug revealed by edge case" (grounded in H)
  A2: "Add edge case to test suite" (grounded in gap)
  A3: "Add prod data sampling to test generation" (systemic fix)

COHERENCE RESTORATION:
  After A1, A2:
    TEST passes (including edge case)
    PROD passes (bug fixed)
    Contradiction resolved
```

---

### Use Case 20: Documentation Says One Thing, Code Does Another

**Scenario**: README says "Set MAX_CONNECTIONS=100" but code ignores this and uses 10.

**Epistemic Construction**:

```
CONFLICTING SOURCES:

Objects:
  DOC: "README: Set MAX_CONNECTIONS environment variable (default: 100)"
      Source: documentation
      Attitude: accepting (0.7) -- docs can be wrong

  CODE: "config.js: const MAX_CONN = 10; // hardcoded"
      Source: code inspection
      Attitude: accepting (0.95) -- code is ground truth for behavior

  BEHAVIOR: "System uses 10 connections regardless of env var"
      Source: runtime observation
      Attitude: accepting (1.0) -- measured

CONFLICT IDENTIFICATION:
  DOC ↔ CODE: Documentation claims configurability, code is hardcoded
  DOC ↔ BEHAVIOR: Documentation claims default 100, behavior shows 10
  CODE ↔ BEHAVIOR: CONSISTENT (code dictates behavior)

SOURCE CREDIBILITY:
  For BEHAVIOR: Code > Documentation
    CODE grounds BEHAVIOR
    DOC contradicted by BEHAVIOR

  Therefore: DOC is INCORRECT

TRUTH DETERMINATION:
  "System uses 10 connections, ignores MAX_CONNECTIONS env var"
      Grounded in: CODE, BEHAVIOR
      Undermines: DOC

CORRECTIVE ACTIONS:
  Option A: "Update documentation to match code"
      If: Current behavior is intentional

  Option B: "Update code to match documentation"
      If: Documentation reflects intended behavior

DECISION GROUNDING:
  Need: Intent of original design

  I1: "Commit history shows MAX_CONNECTIONS was once used" (archaeology)
  I2: "PR #123 hardcoded for performance" (historical decision)

  If I2 found:
    Option A is correct (hardcoding was intentional)
    DOC is stale, needs update

  If I1 but no I2:
    Possible regression → Option B
    Or: Ask stakeholder for intent

COHERENCE:
  After resolution:
    Either DOC updated and consistent with CODE/BEHAVIOR
    Or CODE updated and DOC now accurate
    No contradictions remain
```

---

[Back to Index](./index.md) | [Previous: Action Theory](./03-action-theory.md) | [Next: Bad Agents](./05-bad-agents.md)
