# Agent Performance Evaluation Track

> **Status**: Design
> **Purpose**: Measure LiBrainian's actual utility by testing with agent workers
> **Principle**: Real task performance > synthetic Q&A correctness

---

## Core Insight

The true test of LiBrainian is: **Do agents perform better WITH it than WITHOUT it?**

Instead of asking "Did LiBrainian answer correctly?", ask:
- Did the agent complete the task?
- How long did it take?
- How many errors did it make?
- Did it recover from mistakes faster?

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TEST ORCHESTRATOR                     │
│  - Selects test repo + task                             │
│  - Configures context level                             │
│  - Spawns worker sub-agents                             │
│  - Records all events                                   │
│  - Compares outcomes                                    │
└─────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐      ┌─────────────────────┐
│   WORKER (Control)  │      │  WORKER (Treatment) │
│   - No LiBrainian    │      │  - Has LiBrainian    │
│   - Limited context │      │  - Same context     │
│   - Same task       │      │  - Same task        │
└─────────────────────┘      └─────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐      ┌─────────────────────┐
│     TEST REPO       │      │     TEST REPO       │
│   (isolated copy)   │      │   (isolated copy)   │
└─────────────────────┘      └─────────────────────┘
```

---

## Context Levels

Simulate real-world scenarios by controlling what context the worker receives:

### Level 0: Cold Start
```
Worker prompt: "Fix the bug in this repo."
Context given: Repo path only. No file contents. No hints.
Simulates: New developer, unfamiliar codebase
```

### Level 1: Minimal Context
```
Worker prompt: "Fix the bug in the auth module."
Context given: Repo path + directory listing
Simulates: Developer with vague task description
```

### Level 2: Partial Context
```
Worker prompt: "Fix the session expiry bug in auth/session.ts"
Context given: The file with the bug + 1-2 related files
Simulates: Developer with partial information
```

### Level 3: Misleading Context
```
Worker prompt: "The bug is in the database layer."
Context given: Wrong files (bug is actually in auth)
Simulates: Incorrect assumptions / misdirection
```

### Level 4: Adversarial Context
```
Worker prompt: "Implement the feature per the spec."
Context given: Outdated spec that contradicts code
Simulates: Stale documentation, conflicting information
```

### Level 5: Full Context (Baseline)
```
Worker prompt: Complete task description with all relevant files
Context given: Everything needed
Simulates: Best case scenario
```

---

## Task Complexity Levels

### Trivial (T1)
- Add a log statement to function X
- Rename a variable
- Fix a typo in a string
- **Expected**: Both workers succeed, minimal difference

### Simple (T2)
- Fix a clear bug with stack trace
- Add a new field to a type
- Update an import path
- **Expected**: Small LiBrainian advantage on time

### Moderate (T3)
- Add new endpoint following existing patterns
- Fix a bug without stack trace
- Implement a feature from spec
- **Expected**: Noticeable LiBrainian advantage

### Hard (T4)
- Refactor module to use different pattern
- Debug intermittent failure
- Add feature requiring understanding of 5+ files
- **Expected**: Significant LiBrainian advantage

### Extreme (T5)
- Debug race condition
- Find security vulnerability
- Understand and modify complex algorithm
- Cross-cutting concern affecting many files
- **Expected**: Large LiBrainian advantage OR reveals LiBrainian limitations

---

## Recording Everything

Every worker session records:

```typescript
interface WorkerSession {
  // Identity
  sessionId: string;
  workerId: string;
  hasLibrarian: boolean;

  // Task
  taskId: string;
  taskComplexity: 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
  contextLevel: 0 | 1 | 2 | 3 | 4 | 5;

  // Timing
  startTime: string;
  endTime: string;
  durationMs: number;

  // Outcome
  success: boolean;
  partialSuccess: boolean;
  failureReason?: string;

  // Behavior
  filesRead: string[];
  filesModified: string[];
  filesCreated: string[];
  commandsRun: string[];
  errorsEncountered: number;
  backtrackCount: number;  // How many times did they undo/retry

  // LiBrainian usage (treatment only)
  librarianQueries?: LibrarianQuery[];
  librarianHelpfulness?: number;  // Self-rated by worker

  // Verification
  testsPassedBefore: number;
  testsPassedAfter: number;
  testsPassing: boolean;
  manualVerification?: boolean;
}

interface LibrarianQuery {
  query: string;
  responseTime: number;
  usedInSolution: boolean;
  helpfulnessRating: 1 | 2 | 3 | 4 | 5;
  citationsVerified: boolean;
}
```

---

## Metrics

### Primary Metrics

| Metric | Definition | Goal |
|--------|------------|------|
| Success Rate Lift | (Treatment success - Control success) / Control success | > 20% |
| Time Reduction | (Control time - Treatment time) / Control time | > 30% |
| Error Reduction | (Control errors - Treatment errors) / Control errors | > 40% |

### Secondary Metrics

| Metric | Definition |
|--------|------------|
| Recovery Rate | How often does worker recover from wrong path |
| Context Efficiency | Success rate at lower context levels |
| Complexity Ceiling | Highest complexity level with >50% success |
| Query Efficiency | Useful queries / Total queries |

### Per-Complexity Analysis

```
Complexity  Control Success  Treatment Success  Lift
T1 Trivial       95%              97%            +2%
T2 Simple        80%              90%           +12%
T3 Moderate      60%              80%           +33%
T4 Hard          30%              55%           +83%
T5 Extreme       10%              35%          +250%
```

The bigger the lift at higher complexity, the more valuable LiBrainian is.

---

## Test Repo Requirements

### Characteristics
- Real, working codebase (not synthetic)
- Has test suite for verification
- Multiple complexity levels possible
- Clear success criteria

### Repo Types
1. **Small TypeScript** (~1K LOC): API server with auth
2. **Medium Python** (~5K LOC): Data pipeline with transforms
3. **Large Mixed** (~20K LOC): Full-stack app with frontend/backend
4. **Monorepo** (~50K LOC): Multiple packages with dependencies

### Task Bank Per Repo
Each repo has pre-defined tasks at each complexity level:
- 5 T1 tasks (trivial)
- 5 T2 tasks (simple)
- 5 T3 tasks (moderate)
- 3 T4 tasks (hard)
- 2 T5 tasks (extreme)

Total: 20 tasks × 4 repos = 80 tasks

---

## Experiment Protocol

### Single Experiment Run

```
1. SELECT task from task bank
2. CLONE test repo to isolated directory (×2 copies)
3. CONFIGURE context level
4. SPAWN control worker (no LiBrainian)
5. SPAWN treatment worker (with LiBrainian)
6. RECORD all events from both
7. WAIT for completion or timeout
8. VERIFY outcomes (run tests, check diffs)
9. STORE results
```

### Full Evaluation Suite

```
FOR each repo IN [small-ts, medium-py, large-mixed, monorepo]:
  FOR each task IN repo.taskBank:
    FOR each contextLevel IN [0, 1, 2, 3, 4, 5]:
      RUN experiment(repo, task, contextLevel)
      RECORD results

COMPUTE aggregate metrics
GENERATE report
```

### Statistical Validity
- Run each (task, context) combination 3× to reduce variance
- Use paired comparisons (same task, same context, ±LiBrainian)
- Report confidence intervals, not just point estimates

---

## Worker Prompt Templates

### Design Principle: Human-Level Prompting

**Workers should receive prompts that simulate how a REAL HUMAN would ask.**

- Vague task descriptions ("fix the bug", not "fix the null check on line 47")
- No tutorials on tools
- Incomplete context
- Sometimes wrong assumptions
- Natural language, not structured specs

This tests REAL-WORLD usability, not ideal-condition performance.

---

### LiBrainian Awareness Levels (for Treatment workers)

**Level L0: No Mention**
```
Worker knows: Nothing about LiBrainian
Discovery: Must find it in environment (MCP tools, help commands)
Tests: Discoverability
```

**Level L1: Exists, No Instructions**
```
Worker knows: "There's a tool called LiBrainian that might help"
Discovery: Must figure out how to use it
Tests: Intuitive usability
```

**Level L2: Basic Hint**
```
Worker knows: "You can ask LiBrainian questions about the codebase"
Discovery: Must figure out what to ask
Tests: Query formulation
```

**Level L3: Example Query**
```
Worker knows: "Try asking LiBrainian: 'Where is X defined?'"
Discovery: Must generalize from example
Tests: Adaptation
```

**Level L4: Full Documentation (Baseline)**
```
Worker knows: Complete LiBrainian usage guide
Tests: Optimal usage ceiling
```

---

### Control Worker (No LiBrainian)

```
You're a developer. Here's a task.

{task_description_human_style}

The code is at: {repo_path}

Figure it out and fix it. Let me know when you're done or if you're stuck.
```

**Example task descriptions (human-style):**
- "There's a bug somewhere in auth, users are getting logged out randomly"
- "Can you add a feature to export data as CSV?"
- "The tests are failing, not sure why"
- "Make the API faster"
- "Something's wrong with the database queries"

---

### Treatment Worker — Level L0 (No Mention)

```
You're a developer. Here's a task.

{task_description_human_style}

The code is at: {repo_path}

Figure it out and fix it. Let me know when you're done or if you're stuck.
```

*LiBrainian is available as an MCP tool but not mentioned. Worker must discover it.*

---

### Treatment Worker — Level L1 (Exists, No Instructions)

```
You're a developer. Here's a task.

{task_description_human_style}

The code is at: {repo_path}

There's some tool called "LiBrainian" that might help with understanding the code,
but I haven't used it myself.

Figure it out and fix it. Let me know when you're done or if you're stuck.
```

---

### Treatment Worker — Level L2 (Basic Hint)

```
You're a developer. Here's a task.

{task_description_human_style}

The code is at: {repo_path}

If you need help understanding the codebase, you can ask LiBrainian questions
about it. Not sure exactly how it works but supposedly it knows about the code.

Figure it out and fix it.
```

---

### Treatment Worker — Level L3 (Example)

```
You're a developer. Here's a task.

{task_description_human_style}

The code is at: {repo_path}

Tip: You can ask LiBrainian things like "Where is the auth logic?" or
"What calls this function?" to understand the code faster.

Good luck.
```

---

### Human-Style Task Descriptions

**DO NOT USE:**
```
Fix the NullPointerException in UserService.java at line 47 where
getUser() returns null when the user ID is not found in the database.
```

**USE INSTEAD:**
```
Users are complaining they see an error page sometimes. Not sure what's
causing it. Can you look into it?
```

**More examples:**

| Over-specified (bad) | Human-style (good) |
|---------------------|-------------------|
| "Add null check to line 47" | "It crashes sometimes, probably a null thing?" |
| "Implement OAuth2 flow per RFC 6749" | "We need Google login" |
| "Refactor AuthService to use dependency injection" | "The auth code is a mess, clean it up" |
| "Fix race condition in SessionManager.refresh()" | "Users get logged out randomly, super annoying" |
| "Add index on users.email column" | "The user search is slow" |

---

### Recording LiBrainian Discovery & Usage

For treatment workers, record:

```typescript
interface LibrarianUsageRecord {
  // Discovery
  discoveredLibrarian: boolean;
  discoveryMethod: 'mcp_tools' | 'help_command' | 'error_message' | 'guessed' | 'not_discovered';
  timeToDiscovery: number;  // ms from start, null if not discovered

  // Usage attempts
  queries: {
    query: string;
    wasHelpful: boolean;  // Did they use the response?
    queryQuality: 'good' | 'vague' | 'wrong_question';
    responseUsedInSolution: boolean;
  }[];

  // Outcome correlation
  usedLibrarianBeforeSuccess: boolean;
  usedLibrarianBeforeGivingUp: boolean;
}
```

---

## Implementation Phases

### Phase 1: Harness Infrastructure
- Worker spawning with isolation
- Event recording system
- Timeout handling
- Result storage

### Phase 2: Test Repos + Task Bank
- Clone/create 4 test repos
- Define 20 tasks per repo
- Verify tasks are solvable
- Define success criteria per task

### Phase 3: Context Level System
- Implement context filtering
- Test each level produces expected behavior
- Calibrate difficulty

### Phase 4: LiBrainian Integration
- Wire LiBrainian into treatment workers
- Query recording
- Helpfulness self-rating

### Phase 5: Analysis Pipeline
- Aggregate metrics computation
- Statistical significance testing
- Report generation
- Visualization

---

## Success Criteria

LiBrainian is considered successful if:

1. **Significant lift at T3+**: >25% success rate improvement on moderate+ tasks
2. **Time reduction**: >30% faster completion on successful tasks
3. **Context efficiency**: Treatment succeeds at Level 2 where Control needs Level 4
4. **No degradation**: Treatment never performs worse than Control
5. **Extreme task enablement**: Treatment achieves >30% success on T5 tasks

### NEW: Human-Realistic Success Criteria

6. **Discoverability**: >70% of L0 workers discover and use LiBrainian
7. **Intuitive usage**: L1 workers achieve >50% of L4 (full docs) performance
8. **Vague query handling**: LiBrainian provides useful answers to human-style queries >60% of time
9. **Wrong question recovery**: When worker asks wrong question, LiBrainian redirects usefully >40% of time

### The Real Test

**If workers with NO instructions about LiBrainian (L0) still perform better than Control,
LiBrainian is genuinely useful in the real world.**

| Comparison | What it tests |
|-----------|---------------|
| L0 Treatment vs Control | Real-world discoverability + value |
| L1 Treatment vs Control | Minimal-hint usability |
| L0 Treatment vs L4 Treatment | Cost of poor documentation |
| L4 Treatment vs Control | Theoretical maximum value |

---

## Failure Modes to Detect

1. **LiBrainian slows workers down**: Treatment takes longer despite same success
2. **Hallucination harm**: Treatment makes worse errors due to bad LiBrainian info
3. **Over-reliance**: Treatment fails when LiBrainian gives partial info
4. **Complexity ceiling**: LiBrainian doesn't help at T4/T5
5. **Context level insensitivity**: Same performance regardless of context

---

## Integration with Other Tracks

- **Machine-Verifiable Eval**: Use AST verification on worker outputs
- **Calibration**: Track confidence of LiBrainian responses vs worker success
- **Hallucination Detection**: Flag cases where LiBrainian led worker astray
