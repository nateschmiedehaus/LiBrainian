# LiBrainian Quality Methodology

## Problem Statement

The LiBrainian has quality detection infrastructure but it doesn't work reliably in practice:
- **Dead code detection**: Uses query access count, not call graph (many false positives)
- **Importance signals**: Graph too sparse to produce meaningful PageRank/centrality
- **Stale data**: Deleted files remain in index
- **Access tracking**: Not wired into query pipeline

This document defines the methodology to fix these issues and adds universal quality measures.

---

## Part 1: Methodology to Fix Current Problems

### Phase 1: Fix the Data Foundation

#### 1.1 Stale Entry Cleanup

**Problem**: Deleted files remain in the index.

**Solution**: Add file existence verification during queries and periodic cleanup.

```typescript
// Add to query.ts
async function verifyPackFreshness(pack: ContextPack, storage: LibrarianStorage): Promise<boolean> {
  const filePath = pack.metadata?.filePath;
  if (!filePath) return true; // Non-file packs are fine

  try {
    await fs.access(filePath);
    return true;
  } catch {
    // File deleted - mark pack as stale
    await storage.markPackStale(pack.packId, 'file_deleted');
    return false;
  }
}

// In query ranking, filter out stale packs
const validPacks = await Promise.all(
  packs.map(async p => ({ pack: p, valid: await verifyPackFreshness(p, storage) }))
);
return validPacks.filter(p => p.valid).map(p => p.pack);
```

**Periodic cleanup job**:
```typescript
// Add to file_watcher.ts or new cleanup.ts
export async function cleanupStaleEntries(storage: LibrarianStorage, workspace: string): Promise<number> {
  const allFiles = await storage.getAllIndexedFiles();
  let removed = 0;

  for (const file of allFiles) {
    const fullPath = path.join(workspace, file.path);
    try {
      await fs.access(fullPath);
    } catch {
      await storage.removeFile(file.id);
      removed++;
    }
  }

  return removed;
}
```

#### 1.2 Graph Edge Population

**Problem**: Call graph edges are sparse, making PageRank/centrality meaningless.

**Solution**: Ensure AST indexer captures ALL relationships.

Current edge types:
- `calls` (function → function)
- `imports` (file → file)
- `extends/implements` (class → class)

Missing edge types to add:
- `reads` (function → variable/property)
- `writes` (function → variable/property)
- `instantiates` (function → class)
- `throws` (function → error type)
- `awaits` (function → async function)

```typescript
// Add to ast_indexer.ts
interface ExtendedEdge {
  fromId: string;
  toId: string;
  type: 'calls' | 'imports' | 'reads' | 'writes' | 'instantiates' | 'throws' | 'awaits';
  confidence: number;
  sourceLocation?: { line: number; column: number };
}
```

#### 1.3 Access Tracking Wiring

**Problem**: Query access not tracked, so "never accessed" is meaningless.

**Solution**: Wire access tracking into query pipeline.

```typescript
// In query.ts, after ranking packs
for (const pack of rankedPacks) {
  await storage.recordContextPackAccess(pack.packId, {
    queryId: feedbackToken,
    timestamp: new Date().toISOString(),
    wasReturned: true,
    rank: rankedPacks.indexOf(pack),
  });
}
```

### Phase 2: Fix Detection Algorithms

#### 2.1 Dead Code Detection (Use Call Graph)

**Current (broken)**: `accessCount === 0 && pagerank < 0.001`

**Fixed**: Use actual call graph traversal.

```typescript
export async function detectDeadCode(storage: LibrarianStorage): Promise<DeadCodeCandidate[]> {
  const allFunctions = await storage.getFunctions({});
  const allEdges = await storage.getGraphEdges({ type: 'calls' });

  // Build reverse call map: who calls this function?
  const calledBy = new Map<string, Set<string>>();
  for (const edge of allEdges) {
    if (!calledBy.has(edge.toId)) calledBy.set(edge.toId, new Set());
    calledBy.get(edge.toId)!.add(edge.fromId);
  }

  // Find entry points (exported, main, handlers, tests)
  const entryPoints = new Set(
    allFunctions
      .filter(fn => isEntryPoint(fn))
      .map(fn => fn.id)
  );

  // BFS from entry points to find all reachable functions
  const reachable = new Set<string>();
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    // Find what this function calls
    const callsEdges = allEdges.filter(e => e.fromId === current);
    for (const edge of callsEdges) {
      if (!reachable.has(edge.toId)) {
        queue.push(edge.toId);
      }
    }
  }

  // Functions not reachable from entry points = dead code candidates
  const deadCode = allFunctions
    .filter(fn => !reachable.has(fn.id))
    .map(fn => ({
      id: fn.id,
      name: fn.name,
      filePath: fn.filePath,
      line: fn.startLine,
      confidence: calledBy.has(fn.id) ? 0.3 : 0.9, // Low confidence if called somewhere
      reason: calledBy.has(fn.id)
        ? 'Not reachable from entry points but has internal callers'
        : 'Never called anywhere',
    }));

  return deadCode;
}

function isEntryPoint(fn: FunctionRecord): boolean {
  // Exported functions
  if (fn.exported) return true;

  // Main functions
  if (['main', 'run', 'start', 'init', 'bootstrap'].includes(fn.name.toLowerCase())) return true;

  // Event handlers
  if (fn.name.startsWith('on') || fn.name.startsWith('handle')) return true;

  // Test functions
  if (fn.name.includes('test') || fn.name.includes('spec')) return true;

  // CLI commands
  if (fn.filePath.includes('/cli/') || fn.filePath.includes('/bin/')) return true;

  return false;
}
```

#### 2.2 Importance Scoring (Multi-Factor)

**Current (broken)**: Just PageRank, which needs dense graph.

**Fixed**: Multi-factor importance that works with sparse graphs.

```typescript
export interface ImportanceFactors {
  // Structural importance (from graph when available)
  pagerank: number;        // 0-1, how central in call flow
  fanIn: number;           // How many things call this
  fanOut: number;          // How many things this calls
  isBridge: boolean;       // Connects otherwise separate components

  // Usage importance (from actual behavior)
  queryAccessCount: number; // How often agents query for this
  changeFrequency: number;  // How often this changes
  testCoverage: number;     // How well tested

  // Semantic importance (from code characteristics)
  isPublicApi: boolean;     // Exported from module
  isEntryPoint: boolean;    // Main, handler, CLI
  hasDocumentation: boolean; // Well documented
  complexity: number;       // Higher complexity = more important to understand

  // Business importance (from naming/context)
  domainRelevance: number;  // Matches business domain terms
  errorHandling: boolean;   // Handles errors (critical path)
  securityRelevant: boolean; // Auth, crypto, validation
}

export function computeImportance(factors: ImportanceFactors): number {
  // Weights for each factor
  const weights = {
    structural: 0.25,
    usage: 0.20,
    semantic: 0.30,
    business: 0.25,
  };

  // Structural score (works even with sparse graph)
  const structuralScore = (
    (factors.pagerank * 0.3) +
    (Math.min(1, factors.fanIn / 10) * 0.3) +
    (Math.min(1, factors.fanOut / 10) * 0.2) +
    (factors.isBridge ? 0.2 : 0)
  );

  // Usage score
  const usageScore = (
    (Math.min(1, factors.queryAccessCount / 50) * 0.4) +
    (Math.min(1, factors.changeFrequency / 10) * 0.3) +
    (factors.testCoverage * 0.3)
  );

  // Semantic score
  const semanticScore = (
    (factors.isPublicApi ? 0.3 : 0) +
    (factors.isEntryPoint ? 0.3 : 0) +
    (factors.hasDocumentation ? 0.2 : 0) +
    (Math.min(1, factors.complexity / 20) * 0.2)
  );

  // Business score
  const businessScore = (
    (factors.domainRelevance * 0.4) +
    (factors.errorHandling ? 0.3 : 0) +
    (factors.securityRelevant ? 0.3 : 0)
  );

  return (
    structuralScore * weights.structural +
    usageScore * weights.usage +
    semanticScore * weights.semantic +
    businessScore * weights.business
  );
}
```

---

## Part 2: Universal Quality Measures

These measures work for ANY codebase and provide actionable insights.

### Category 1: Code Health (Function/File Level)

| Metric | What It Measures | Why It Matters | Implementation |
|--------|------------------|----------------|----------------|
| **Cyclomatic Complexity** | Decision points in code | Hard to test, understand | ✅ Exists in quality_extractor |
| **Cognitive Complexity** | Mental effort to understand | Maintainability | ✅ Exists |
| **Halstead Metrics** | Code vocabulary, effort | Bug prediction | ✅ Exists |
| **Nesting Depth** | Deeply nested logic | Readability | ✅ Exists |
| **Function Length** | Lines per function | Refactoring need | ✅ Exists |
| **Parameter Count** | Function arguments | Interface complexity | ✅ Exists |
| **Return Complexity** | Multiple return paths | Testing difficulty | ⚠️ Partial |

### Category 2: Architecture Health (Module/System Level)

| Metric | What It Measures | Why It Matters | Implementation |
|--------|------------------|----------------|----------------|
| **Fan-In** | Incoming dependencies | Importance, fragility | ❌ Missing |
| **Fan-Out** | Outgoing dependencies | Coupling | ❌ Missing |
| **Coupling Score** | Inter-module dependencies | Change isolation | ❌ Missing |
| **Cohesion Score** | Intra-module relatedness | Module quality | ❌ Missing |
| **Circular Dependencies** | A→B→C→A cycles | Build issues, complexity | ❌ Missing |
| **Layer Violations** | Crossing architecture boundaries | Design decay | ❌ Missing |
| **API Surface Ratio** | Public vs private code | Encapsulation | ❌ Missing |

### Category 3: Change Risk (Evolution Level)

| Metric | What It Measures | Why It Matters | Implementation |
|--------|------------------|----------------|----------------|
| **Change Frequency** | How often code changes | Stability | ✅ Exists in churn |
| **Hotspots** | High change + high complexity | Priority targets | ⚠️ Data exists, not combined |
| **Change Coupling** | Files that change together | Hidden dependencies | ❌ Missing |
| **Bug Density** | Bugs per LOC historically | Quality indicator | ❌ Missing |
| **Fix Recurrence** | Same code fixed repeatedly | Systemic issues | ❌ Missing |
| **Breaking Change Risk** | Public API modification | Compatibility | ❌ Missing |

### Category 4: Knowledge Health (Understanding Level)

| Metric | What It Measures | Why It Matters | Implementation |
|--------|------------------|----------------|----------------|
| **Understanding Coverage** | % with good purpose docs | Agent effectiveness | ⚠️ Can compute from data |
| **Confidence Distribution** | Spread of confidence scores | Reliability | ⚠️ Can compute |
| **Query Success Rate** | Queries that return useful results | System quality | ❌ Missing |
| **Knowledge Staleness** | Age of last verification | Trustworthiness | ⚠️ Partial |
| **Gap Density** | Unanswered queries per module | Missing knowledge | ❌ Missing |
| **Bus Factor** | People who understand code | Risk assessment | ❌ Missing |

### Category 5: Test Health (Verification Level)

| Metric | What It Measures | Why It Matters | Implementation |
|--------|------------------|----------------|----------------|
| **Line Coverage** | Lines executed in tests | Basic coverage | ✅ Exists |
| **Branch Coverage** | Decision paths tested | Thorough coverage | ✅ Exists |
| **Mutation Score** | Tests catch changes | Test effectiveness | ⚠️ Schema exists |
| **Test-to-Code Ratio** | Test LOC vs code LOC | Investment level | ❌ Missing |
| **Assertion Density** | Assertions per test | Test thoroughness | ❌ Missing |
| **Flaky Test Rate** | Non-deterministic tests | CI reliability | ❌ Missing |

### Category 6: Security Health (Risk Level)

| Metric | What It Measures | Why It Matters | Implementation |
|--------|------------------|----------------|----------------|
| **Vulnerability Count** | Known CVEs in deps | Security posture | ❌ Missing |
| **Secret Exposure Risk** | Hardcoded secrets | Data breach risk | ⚠️ Partial |
| **Input Validation Coverage** | Boundaries with validation | Attack surface | ❌ Missing |
| **Auth Check Coverage** | Protected endpoints | Access control | ❌ Missing |
| **Dependency Freshness** | Outdated packages | Patch gap | ❌ Missing |

---

## Part 3: Implementation Priority

### Tier 1: Fix What's Broken (Immediate)

1. **Stale entry cleanup** - Add file existence check
2. **Dead code via call graph** - Replace access-based detection
3. **Wire access tracking** - Track query usage properly

### Tier 2: Add High-Value Metrics (Next)

4. **Fan-in/Fan-out** - Essential for importance
5. **Hotspot detection** - Change frequency × complexity
6. **Understanding coverage** - % with good purpose descriptions
7. **Circular dependency detection** - Architecture health

### Tier 3: Complete the Picture (Later)

8. **Change coupling** - Files that change together
9. **Layer violation detection** - Architecture boundary checks
10. **Query success tracking** - Measure LiBrainian effectiveness

---

## Part 4: Quality Dashboard Schema

```typescript
export interface QualityDashboard {
  // Summary scores (0-100)
  overallHealth: number;
  codeHealth: number;
  architectureHealth: number;
  testHealth: number;
  knowledgeHealth: number;

  // Actionable items
  criticalIssues: QualityIssue[];
  hotspots: Hotspot[];
  deadCode: DeadCodeCandidate[];
  circularDeps: CircularDependency[];

  // Trends
  healthTrend: 'improving' | 'stable' | 'degrading';
  recentChanges: QualityChange[];

  // Coverage
  understandingCoverage: number; // % of code with good purpose
  testCoverage: number;          // % of code tested
  docCoverage: number;           // % of public API documented
}

export interface Hotspot {
  filePath: string;
  functionName?: string;
  complexity: number;
  changeFrequency: number;
  hotspotScore: number; // complexity × changeFrequency
  recommendation: string;
}

export interface CircularDependency {
  cycle: string[]; // [A, B, C, A]
  severity: 'critical' | 'major' | 'minor';
  breakingPoint: string; // Best place to break the cycle
}
```

---

## Part 5: CLI Commands

```bash
# Overall health dashboard
LiBrainian health

# Specific quality checks
LiBrainian quality --check=dead-code
LiBrainian quality --check=hotspots
LiBrainian quality --check=circular-deps
LiBrainian quality --check=understanding-coverage

# Fix suggestions
LiBrainian quality --fix-suggestions
LiBrainian quality --prioritize  # Order by impact

# Export for CI
LiBrainian quality --format=json > quality-report.json
LiBrainian quality --fail-on=critical  # Exit 1 if critical issues
```

---

## Part 6: Integration with Agent Workflows

### Pre-Task Quality Check

Before an agent starts a task, check quality of relevant code:

```typescript
async function preTaskQualityCheck(task: Task, storage: LibrarianStorage): Promise<QualityWarning[]> {
  const relevantFiles = await findRelevantFiles(task);
  const warnings: QualityWarning[] = [];

  for (const file of relevantFiles) {
    const quality = await storage.getFileQuality(file);

    if (quality.hotspotScore > 0.7) {
      warnings.push({
        type: 'hotspot',
        message: `${file} is a hotspot (high complexity + frequent changes). Extra care recommended.`,
        severity: 'warning',
      });
    }

    if (quality.circularDeps.length > 0) {
      warnings.push({
        type: 'circular-dependency',
        message: `${file} is part of circular dependency. Changes may have unexpected effects.`,
        severity: 'warning',
      });
    }
  }

  return warnings;
}
```

### Post-Task Quality Gate

After agent completes task, verify quality didn't degrade:

```typescript
async function postTaskQualityGate(task: Task, changedFiles: string[], storage: LibrarianStorage): Promise<QualityGateResult> {
  const beforeQuality = task.snapshot.quality;
  const afterQuality = await computeQuality(changedFiles);

  const degradations: QualityDegradation[] = [];

  for (const file of changedFiles) {
    const before = beforeQuality[file];
    const after = afterQuality[file];

    if (after.complexity > before.complexity * 1.2) {
      degradations.push({
        file,
        metric: 'complexity',
        before: before.complexity,
        after: after.complexity,
        severity: after.complexity > 20 ? 'critical' : 'warning',
      });
    }

    // Check other metrics...
  }

  return {
    passed: degradations.filter(d => d.severity === 'critical').length === 0,
    degradations,
    suggestions: generateFixSuggestions(degradations),
  };
}
```

---

## Summary

**To fix current problems:**
1. Add stale entry cleanup (file existence check)
2. Replace access-based dead code detection with call graph traversal
3. Wire access tracking into query pipeline
4. Add more edge types to make graph denser

**Universal quality measures to add:**
1. **Architecture**: Fan-in/out, coupling, cohesion, circular deps
2. **Risk**: Hotspots (complexity × change frequency), change coupling
3. **Knowledge**: Understanding coverage, query success rate, gap density
4. **Actionable**: Quality dashboard with prioritized fix suggestions

**Key principle**: Quality detection must be actionable. Every metric should answer "what should I fix and why?"
