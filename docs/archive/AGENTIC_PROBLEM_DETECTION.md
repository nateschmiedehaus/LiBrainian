# Agentic Problem Detection Guide

**Purpose**: Comprehensive guide for AI agents to detect, diagnose, and prevent problems in complex codebases.

---

## Table of Contents

1. [Pre-Mortem Analysis](#1-pre-mortem-analysis)
2. [AI Slop Detection](#2-ai-slop-detection)
3. [Logical Problem Patterns](#3-logical-problem-patterns)
4. [Architectural Anti-Patterns](#4-architectural-anti-patterns)
5. [Complexity Debt Indicators](#5-complexity-debt-indicators)
6. [Runtime Failure Prediction](#6-runtime-failure-prediction)
7. [Security Vulnerability Patterns](#7-security-vulnerability-patterns)
8. [Testing Blind Spots](#8-testing-blind-spots)
9. [Integration Failure Points](#9-integration-failure-points)
10. [Recovery Strategies](#10-recovery-strategies)

---

## 1. Pre-Mortem Analysis

Pre-mortem analysis anticipates failures *before* they occur. When planning changes, systematically ask: "What could cause this to fail?"

### 1.1 Pre-Mortem Query Template

```typescript
// Use LiBrainian to run pre-mortem analysis
const premortem = await LiBrainian.query({
  intent: "What could cause [proposed change] to fail?",
  taskType: 'debugging',
  depth: 'L2',
  affectedFiles: [/* files you plan to modify */],
  ucRequirements: {
    ucIds: ['UC-PREMORTEM'],
    constraints: ['identify failure modes', 'rank by likelihood', 'suggest mitigations']
  }
});
```

### 1.2 Failure Mode Categories

| Category | Questions to Ask | LiBrainian Query Pattern |
|----------|------------------|------------------------|
| **Data Flow** | Can data be null/undefined at any point? | `"null propagation paths for [function]"` |
| **State** | Can state become inconsistent? | `"state mutation points in [module]"` |
| **Concurrency** | Are there race conditions? | `"async operations in [file] without synchronization"` |
| **Resource** | Can resources leak or exhaust? | `"resource acquisition without release in [scope]"` |
| **Dependency** | Can external dependencies fail? | `"external API calls in [module] error handling"` |
| **Schema** | Can data shape assumptions break? | `"type assertions and casts in [file]"` |

### 1.3 Pre-Mortem Checklist

Before any significant change:

```markdown
## Pre-Mortem Checklist

### Data Integrity
- [ ] Validated all input boundaries
- [ ] Checked null/undefined propagation paths
- [ ] Verified type coercions are safe
- [ ] Confirmed array bounds are checked

### State Consistency
- [ ] Identified all state mutation points
- [ ] Verified atomic operations where needed
- [ ] Checked for partial update scenarios
- [ ] Confirmed rollback paths exist

### Error Handling
- [ ] Every async operation has error handling
- [ ] Errors preserve stack traces
- [ ] Errors are classified appropriately
- [ ] Recovery paths are tested

### Resource Management
- [ ] All acquired resources are released
- [ ] Cleanup runs even on error paths
- [ ] Timeouts exist for blocking operations
- [ ] Memory growth is bounded

### External Dependencies
- [ ] Network calls have timeouts
- [ ] Retries have exponential backoff
- [ ] Circuit breakers for unstable services
- [ ] Fallbacks for critical paths
```

### 1.4 Automated Pre-Mortem via LiBrainian

```typescript
// Comprehensive pre-mortem analysis
async function runPreMortem(affectedFiles: string[]): Promise<PreMortemReport> {
  const analyses = await Promise.all([
    // Data flow analysis
    LiBrainian.query({
      intent: `Identify all places where data could be null or undefined in: ${affectedFiles.join(', ')}`,
      depth: 'L2',
      taskType: 'debugging'
    }),

    // State mutation analysis
    LiBrainian.query({
      intent: `Find state mutations that could leave the system inconsistent in: ${affectedFiles.join(', ')}`,
      depth: 'L2',
      taskType: 'debugging'
    }),

    // Error path analysis
    LiBrainian.query({
      intent: `Identify error handling gaps and unhandled rejection paths in: ${affectedFiles.join(', ')}`,
      depth: 'L2',
      taskType: 'debugging'
    }),

    // Resource leak analysis
    LiBrainian.query({
      intent: `Find resource acquisitions without corresponding releases in: ${affectedFiles.join(', ')}`,
      depth: 'L2',
      taskType: 'debugging'
    }),
  ]);

  return synthesizePreMortemReport(analyses);
}
```

---

## 2. AI Slop Detection

"AI Slop" refers to low-quality AI-generated code that appears functional but contains subtle problems. These patterns are critical for agents to recognize and avoid.

### 2.1 Slop Pattern Taxonomy

#### Category A: Structural Slop

| Pattern | Description | Detection Query |
|---------|-------------|-----------------|
| **Cargo Cult Code** | Copied patterns without understanding | `"unused parameters or variables in recently added functions"` |
| **Over-Abstraction** | Unnecessary interfaces for single implementations | `"interfaces with only one implementation"` |
| **Premature Optimization** | Complex caching/pooling without benchmarks | `"cache implementations without access metrics"` |
| **Comment Noise** | Excessive obvious comments | `"comments that restate the code"` |
| **Type Assertion Abuse** | Excessive `as` casts bypassing type safety | `"type assertions and casts per file"` |

#### Category B: Logic Slop

| Pattern | Description | Detection Query |
|---------|-------------|-----------------|
| **Optimistic Happy Path** | Only handles success cases | `"try blocks without meaningful catch handling"` |
| **Boolean Blindness** | Functions returning booleans without context | `"functions returning only boolean without error info"` |
| **Stringly Typed** | Using strings where enums/types belong | `"string comparisons that could be enums"` |
| **Magic Numbers** | Unexplained numeric constants | `"numeric literals not assigned to named constants"` |
| **Zombie Code** | Dead code kept "just in case" | `"unreachable code or unused exports"` |

#### Category C: Integration Slop

| Pattern | Description | Detection Query |
|---------|-------------|-----------------|
| **Leaky Abstractions** | Implementation details exposed | `"internal types exported from public API"` |
| **Circular Dependencies** | Module A imports B imports A | `"circular import chains"` |
| **God Objects** | Classes/modules doing too much | `"classes with more than 20 methods"` |
| **Feature Envy** | Functions using other module's data excessively | `"functions with more external than internal calls"` |

### 2.2 AI Slop Detection Queries

```typescript
// Comprehensive slop detection
const slopAnalysis = await LiBrainian.query({
  intent: `Detect AI slop patterns in the codebase:
    1. Cargo cult code (copied without understanding)
    2. Over-abstraction (unnecessary complexity)
    3. Optimistic error handling (missing failure cases)
    4. Type assertion abuse (unsafe casts)
    5. Boolean blindness (losing error context)
    6. Dead code (unused but retained)`,
  depth: 'L3',
  taskType: 'code_review'
});
```

### 2.3 Specific Slop Indicators

#### 2.3.1 The "Looks Right" Smell

AI-generated code often "looks right" but has subtle issues:

```typescript
// SLOP: Looks correct but silently fails
async function fetchUser(id: string) {
  try {
    const response = await fetch(`/api/users/${id}`);
    return response.json();  // Missing: response.ok check
  } catch {
    return null;  // Missing: error logging, type info lost
  }
}

// CORRECT: Explicit error handling
async function fetchUser(id: string): Promise<Result<User, FetchError>> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      return err({ code: 'HTTP_ERROR', status: response.status });
    }
    return ok(await response.json() as User);
  } catch (error) {
    return err({ code: 'NETWORK_ERROR', cause: error });
  }
}
```

#### 2.3.2 The "Defensive Overload" Smell

Over-defensive code that handles impossible cases:

```typescript
// SLOP: Unnecessary defensiveness
function processItems(items: Item[]) {
  if (!items) return [];           // Array type can't be null
  if (!Array.isArray(items)) return [];  // TypeScript guarantees this
  if (items.length === 0) return [];     // Empty array is valid input

  return items.map(item => {
    if (!item) return null;        // If Item type is non-nullable, impossible
    if (typeof item !== 'object') return null;  // Type system guarantees this
    return transform(item);
  }).filter(Boolean);
}

// CORRECT: Trust the type system
function processItems(items: Item[]): TransformedItem[] {
  return items.map(transform);
}
```

#### 2.3.3 The "Abstraction Addiction" Smell

Creating abstractions for one-time operations:

```typescript
// SLOP: Unnecessary abstraction
interface DataProcessor<T, R> {
  process(data: T): R;
}

class UserNameProcessor implements DataProcessor<User, string> {
  process(user: User): string {
    return user.name.toUpperCase();
  }
}

const processor = new UserNameProcessor();
const name = processor.process(user);

// CORRECT: Just do the thing
const name = user.name.toUpperCase();
```

### 2.4 Automated Slop Detection Pipeline

```typescript
interface SlopDetectionResult {
  file: string;
  line: number;
  pattern: SlopPattern;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
  confidence: number;
}

async function detectSlop(files: string[]): Promise<SlopDetectionResult[]> {
  const results: SlopDetectionResult[] = [];

  for (const file of files) {
    // Query LiBrainian for function analysis
    const functions = await LiBrainian.query({
      intent: `Analyze functions in ${file} for:
        - Empty catch blocks or generic error swallowing
        - Type assertions (as X) without validation
        - Functions over 50 lines without clear decomposition
        - Unused parameters or imports
        - Boolean returns without error context`,
      depth: 'L2',
      affectedFiles: [file]
    });

    // Parse and score results
    for (const pack of functions.packs) {
      const issues = extractSlopIndicators(pack);
      results.push(...issues);
    }
  }

  return results.sort((a, b) => severityScore(b) - severityScore(a));
}
```

### 2.5 Slop Prevention Guidelines for Agents

When generating code, agents should:

1. **Prefer explicit over implicit**
   - Return `Result<T, E>` instead of `T | null`
   - Use discriminated unions over boolean flags
   - Name error conditions explicitly

2. **Match abstraction to usage**
   - Don't create interfaces for single implementations
   - Don't create factories for single object types
   - Don't create utility functions for one-time operations

3. **Trust the type system**
   - Don't check for impossible null states
   - Don't validate types that TypeScript already guarantees
   - Don't add runtime checks for compile-time contracts

4. **Handle errors completely**
   - Every catch block should log or propagate
   - Never swallow errors silently
   - Preserve error context through the stack

5. **Keep it simple**
   - Three lines of similar code is often better than one abstraction
   - Inline small functions that are only called once
   - Avoid "clever" solutions when straightforward ones work

---

## 3. Logical Problem Patterns

### 3.1 Off-By-One Errors

```typescript
// Detection query
const offByOne = await LiBrainian.query({
  intent: "Find array/loop boundary conditions that might be off by one",
  depth: 'L2',
  taskType: 'debugging'
});

// Common patterns to flag:
// - for (i = 0; i <= arr.length)  // Should be <
// - arr.slice(0, length - 1)     // Excludes last element
// - for (i = 1; i < arr.length)  // Skips first element
```

### 3.2 Null Reference Chains

```typescript
// Detection query
const nullChains = await LiBrainian.query({
  intent: "Find property access chains without null checks: a.b.c.d patterns",
  depth: 'L2',
  taskType: 'debugging'
});

// Patterns to flag:
// - user.profile.settings.theme  // Any could be null
// - response.data.items[0].name  // Array could be empty
```

### 3.3 Race Conditions

```typescript
// Detection query
const raceConditions = await LiBrainian.query({
  intent: "Find check-then-act patterns that could have race conditions",
  depth: 'L2',
  taskType: 'debugging'
});

// Patterns to flag:
// if (cache.has(key)) { return cache.get(key); }  // Key could be deleted
// if (!file.exists()) { file.create(); }          // Could be created between
// if (counter < limit) { counter++; doWork(); }   // Counter could change
```

### 3.4 State Mutation Bugs

```typescript
// Detection query
const stateMutation = await LiBrainian.query({
  intent: "Find places where shared state is mutated without synchronization",
  depth: 'L2',
  taskType: 'debugging'
});

// Patterns to flag:
// - Array.push/pop on shared arrays
// - Object property assignment on shared objects
// - Map/Set modifications without locks
```

### 3.5 Async/Await Pitfalls

```typescript
// Detection query
const asyncIssues = await LiBrainian.query({
  intent: "Find async/await anti-patterns: forgotten awaits, parallel vs sequential confusion",
  depth: 'L2',
  taskType: 'debugging'
});

// Patterns to flag:
// - Promise without await (fire and forget)
// - Sequential awaits that could be parallel
// - await in loops (should be Promise.all)
// - Missing error handling on async boundaries
```

---

## 4. Architectural Anti-Patterns

### 4.1 Detection Queries

```typescript
// God Module Detection
const godModules = await LiBrainian.query({
  intent: "Find modules with excessive responsibility (>20 exports or >1000 lines)",
  depth: 'L2'
});

// Circular Dependency Detection
const circular = await LiBrainian.query({
  intent: "Find circular import chains between modules",
  depth: 'L2'
});

// Leaky Abstraction Detection
const leaky = await LiBrainian.query({
  intent: "Find internal implementation types exposed in public APIs",
  depth: 'L2'
});

// Shotgun Surgery Detection
const shotgun = await LiBrainian.query({
  intent: "Find changes that would require modifying many files (high coupling)",
  depth: 'L2'
});
```

### 4.2 Anti-Pattern Severity Matrix

| Anti-Pattern | Symptoms | Severity | Remediation |
|--------------|----------|----------|-------------|
| **God Module** | >20 exports, >1000 LOC | High | Split by responsibility |
| **Circular Deps** | A→B→C→A import chain | High | Extract shared interface |
| **Feature Envy** | Function uses other module more than own | Medium | Move function to data |
| **Primitive Obsession** | Strings/numbers for domain concepts | Medium | Create value objects |
| **Inappropriate Intimacy** | Modules know each other's internals | High | Define clear interfaces |
| **Speculative Generality** | Unused abstractions "for future" | Low | YAGNI - remove it |

---

## 5. Complexity Debt Indicators

### 5.1 Cyclomatic Complexity Query

```typescript
// Find functions with high cyclomatic complexity
const highComplexity = await LiBrainian.query({
  intent: "Find functions with many conditional branches (>10 if/else/switch cases)",
  depth: 'L2',
  taskType: 'code_review'
});
```

### 5.2 Complexity Thresholds

| Metric | Yellow | Red | Query Pattern |
|--------|--------|-----|---------------|
| Function lines | >50 | >100 | `"functions over 50 lines"` |
| Parameters | >4 | >6 | `"functions with more than 4 parameters"` |
| Nesting depth | >3 | >5 | `"deeply nested conditionals"` |
| Cyclomatic complexity | >10 | >20 | `"functions with many branches"` |
| Dependencies | >10 | >20 | `"files with more than 10 imports"` |

### 5.3 Technical Debt Queries

```typescript
// Comprehensive debt analysis
const debtAnalysis = await Promise.all([
  LiBrainian.query({ intent: "Find TODO and FIXME comments" }),
  LiBrainian.query({ intent: "Find @deprecated items still in use" }),
  LiBrainian.query({ intent: "Find functions without tests" }),
  LiBrainian.query({ intent: "Find copy-pasted code blocks" }),
  LiBrainian.query({ intent: "Find outdated dependencies" }),
]);
```

---

## 6. Runtime Failure Prediction

### 6.1 Memory Leak Indicators

```typescript
const memoryLeaks = await LiBrainian.query({
  intent: `Find potential memory leaks:
    - Event listeners without removal
    - Closures capturing large objects
    - Growing caches without bounds
    - Timers without cleanup`,
  depth: 'L2',
  taskType: 'debugging'
});
```

### 6.2 Resource Exhaustion Patterns

```typescript
const resourceExhaustion = await LiBrainian.query({
  intent: `Find resource exhaustion risks:
    - Unbounded queues
    - Connection pools without limits
    - File handles without cleanup
    - Recursive operations without depth limits`,
  depth: 'L2',
  taskType: 'debugging'
});
```

### 6.3 Deadlock Detection

```typescript
const deadlocks = await LiBrainian.query({
  intent: `Find potential deadlock conditions:
    - Multiple locks acquired in different orders
    - Await inside synchronized blocks
    - Circular wait dependencies`,
  depth: 'L2',
  taskType: 'debugging'
});
```

---

## 7. Security Vulnerability Patterns

### 7.1 OWASP Top 10 Detection

```typescript
const securityScan = await LiBrainian.query({
  intent: `Scan for OWASP vulnerabilities:
    1. Injection (SQL, command, LDAP)
    2. Broken authentication
    3. Sensitive data exposure
    4. XML external entities
    5. Broken access control
    6. Security misconfiguration
    7. XSS
    8. Insecure deserialization
    9. Known vulnerable components
    10. Insufficient logging`,
  depth: 'L3',
  taskType: 'code_review'
});
```

### 7.2 Specific Vulnerability Queries

```typescript
// Injection vulnerabilities
const injection = await LiBrainian.query({
  intent: "Find string concatenation in SQL queries or shell commands",
  taskType: 'code_review'
});

// Authentication issues
const auth = await LiBrainian.query({
  intent: "Find hardcoded credentials, weak password validation, or missing auth checks",
  taskType: 'code_review'
});

// Data exposure
const dataExposure = await LiBrainian.query({
  intent: "Find sensitive data logged, returned in errors, or stored insecurely",
  taskType: 'code_review'
});
```

---

## 8. Testing Blind Spots

### 8.1 Coverage Gap Detection

```typescript
const coverageGaps = await LiBrainian.query({
  intent: `Find testing blind spots:
    - Public functions without test coverage
    - Error paths without test cases
    - Edge cases not covered (empty, null, max values)
    - Integration points without integration tests`,
  depth: 'L2',
  taskType: 'code_review'
});
```

### 8.2 Test Quality Issues

```typescript
const testQuality = await LiBrainian.query({
  intent: `Find test quality issues:
    - Tests without assertions
    - Flaky tests (timing-dependent)
    - Tests that test implementation not behavior
    - Missing negative test cases`,
  depth: 'L2',
  taskType: 'code_review'
});
```

---

## 9. Integration Failure Points

### 9.1 API Contract Violations

```typescript
const apiIssues = await LiBrainian.query({
  intent: `Find API integration risks:
    - Missing request validation
    - Response schema assumptions
    - Timeout handling gaps
    - Retry logic issues`,
  depth: 'L2',
  taskType: 'debugging'
});
```

### 9.2 Database Integration Issues

```typescript
const dbIssues = await LiBrainian.query({
  intent: `Find database integration issues:
    - N+1 query patterns
    - Missing transaction boundaries
    - Inconsistent error handling
    - Connection leak possibilities`,
  depth: 'L2',
  taskType: 'debugging'
});
```

---

## 10. Recovery Strategies

### 10.1 When Problems Are Detected

```typescript
interface RecoveryStrategy {
  problem: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  immediate: string[];      // Steps to take now
  shortTerm: string[];      // Steps for next sprint
  longTerm: string[];       // Architectural changes
}

const strategies: Record<string, RecoveryStrategy> = {
  'memory_leak': {
    problem: 'Memory leak detected',
    severity: 'critical',
    immediate: [
      'Add memory profiling to CI',
      'Implement bounded caches with LRU eviction',
      'Add cleanup handlers to all listeners'
    ],
    shortTerm: [
      'Audit all event subscriptions',
      'Add memory usage metrics'
    ],
    longTerm: [
      'Consider WeakMap/WeakRef for caches',
      'Implement resource pooling'
    ]
  },
  // ... more strategies
};
```

### 10.2 Automated Recovery Query

```typescript
async function getRecoveryPlan(problemType: string): Promise<RecoveryPlan> {
  const analysis = await LiBrainian.query({
    intent: `Given problem: ${problemType}
      1. What is the root cause?
      2. What files need to change?
      3. What is the safest fix approach?
      4. What tests should be added?
      5. How can we prevent recurrence?`,
    depth: 'L3',
    taskType: 'debugging'
  });

  return synthesizeRecoveryPlan(analysis);
}
```

---

## Appendix A: Quick Reference Queries

### Problem Detection One-Liners

```typescript
// Memory issues
"Find closures capturing large objects or arrays"
"Find event listeners without removeEventListener"
"Find setInterval without clearInterval"

// Logic issues
"Find == comparisons that should be ==="
"Find array index access without bounds check"
"Find await inside forEach (should use for...of)"

// Security issues
"Find eval() or Function() constructor usage"
"Find innerHTML assignments with user data"
"Find password or secret in variable names"

// Quality issues
"Find functions with more than 5 parameters"
"Find nested callbacks deeper than 3 levels"
"Find switch statements without default case"

// AI slop issues
"Find empty catch blocks"
"Find type assertions without runtime validation"
"Find unused function parameters"
```

### Health Check Query

```typescript
const healthCheck = await LiBrainian.query({
  intent: `Comprehensive codebase health check:
    - Critical bugs: memory leaks, race conditions, security holes
    - High priority: error handling gaps, missing validation
    - Medium priority: code duplication, complexity debt
    - Low priority: style inconsistencies, documentation gaps`,
  depth: 'L3',
  taskType: 'code_review'
});
```

---

## Appendix B: Agent Self-Check Protocol

Before completing any task, agents should run:

```typescript
async function agentSelfCheck(changedFiles: string[]): Promise<SelfCheckResult> {
  const checks = await Promise.all([
    // Did I introduce any obvious bugs?
    LiBrainian.query({
      intent: "Check for null reference, off-by-one, and type errors",
      affectedFiles: changedFiles
    }),

    // Did I handle errors properly?
    LiBrainian.query({
      intent: "Verify all async operations have error handling",
      affectedFiles: changedFiles
    }),

    // Did I introduce slop patterns?
    LiBrainian.query({
      intent: "Check for AI slop: empty catches, type assertion abuse, over-abstraction",
      affectedFiles: changedFiles
    }),

    // Did I break existing contracts?
    LiBrainian.query({
      intent: "Verify public API contracts are preserved",
      affectedFiles: changedFiles
    }),

    // Did I add proper tests?
    LiBrainian.query({
      intent: "Check test coverage for new/modified functions",
      affectedFiles: changedFiles
    })
  ]);

  return aggregateSelfCheckResults(checks);
}
```

---

*This guide should be used by AI agents as a reference for detecting and preventing problems in complex codebases. Regular queries using these patterns will help maintain code quality and catch issues early.*
