# LiBrainian Critical Evaluation: Orchestration Tasks

> **Machine-Readable Work Unit Definitions for Sub-Agent Spawning**

---

## Task Execution Protocol

When the orchestrator spawns a sub-agent, use this exact format:

```
Task: [subagent_type]
Prompt: <work unit prompt>
Description: <3-5 word summary>
```

---

## Phase 0: Self-Bootstrap Proof (BLOCKING)

### Task WU-EVAL-001

**Spawn Command**:
```
Task: Bash
Description: Bootstrap LiBrainian self-index
Prompt: |
  Execute the following bootstrap sequence and report results:

  1. cd to the LiBrainian workspace
  2. Remove existing index: rm -rf .LiBrainian/ LiBrainian.db*
  3. Run: time LiBrainian bootstrap --force
  4. Run: LiBrainian status
  5. Run: LiBrainian health --completeness --format json

  Report these metrics:
  - Bootstrap exit code
  - Bootstrap duration (seconds)
  - Files indexed count
  - Functions indexed count
  - Context packs count
  - Any errors in stderr

  SUCCESS if: exit code 0 AND files > 100 AND functions > 500
  FAILURE if: exit code != 0 OR files < 100 OR functions < 500
```

### Task WU-EVAL-002

**Spawn Command**:
```
Task: general-purpose
Description: Validate self-query accuracy
Prompt: |
  You are validating LiBrainian's query accuracy on its own codebase.

  Execute these 5 queries and evaluate each response:

  QUERY 1: LiBrainian query "What is the architecture of the query pipeline?"
  VERIFY: Response should mention src/api/query.ts, execution_pipeline.ts, query_synthesis.ts

  QUERY 2: LiBrainian query "How does confidence scoring work?"
  VERIFY: Response should mention epistemics/, confidence_calibration.ts, BoundedConfidence

  QUERY 3: LiBrainian query "How does bootstrap interact with storage?"
  VERIFY: Response should mention sqlite_storage.ts, bootstrapProject, storage/index.ts

  QUERY 4: LiBrainian query "What causes SQLITE_BUSY errors?"
  VERIFY: Response should mention WAL mode, concurrent access, database locking

  QUERY 5: LiBrainian query "Where is embedding provider selection?"
  VERIFY: Response should mention embedding_providers/, provider_check.ts, llm_provider_discovery.ts

  For each query, score:
  - Contains relevant file paths (0-2 points)
  - Contains relevant function names (0-2 points)
  - Factually accurate (0-3 points)
  - Actionable for an agent (0-3 points)

  Total possible: 50 points across 5 queries
  PASS threshold: 30 points (60%)

  Return structured report with scores and evidence.
```

---

## Phase 2: Stream A — Bootstrap Scenarios

### Task WU-EVAL-A01

```
Task: general-purpose
Description: Fresh repository bootstrap test
Prompt: |
  You are testing LiBrainian bootstrap on a FRESH minimal repository.

  1. Create test directory: mkdir -p /tmp/eval-fresh-repo/src
  2. Create 5-10 TypeScript files with realistic code:
     - src/index.ts (entry point with exports)
     - src/utils.ts (helper functions)
     - src/types.ts (type definitions)
     - src/api.ts (API functions)
     - src/config.ts (configuration)

  3. Initialize: cd /tmp/eval-fresh-repo && npm init -y
  4. Bootstrap: time LiBrainian bootstrap --force
  5. Query: LiBrainian query "What does the API module export?"

  Measure and report:
  - Time to create fixtures
  - Time to bootstrap
  - Files indexed
  - Query accuracy (response mentions api.ts exports)
  - Overall experience rating (1-10 with justification)

  Clean up: rm -rf /tmp/eval-fresh-repo
```

### Task WU-EVAL-A02

```
Task: general-purpose
Description: Large repository stress test
Prompt: |
  You are testing LiBrainian on LARGE repositories.

  Test 1: LiBrainian on itself
  - cd /path/to/LiBrainian
  - LiBrainian status (get baseline metrics)
  - LiBrainian query "Find all files with more than 500 lines"
  - Measure query time

  Test 2: Clone a large OSS repo
  - git clone --depth 1 https://github.com/microsoft/TypeScript /tmp/ts-eval
  - cd /tmp/ts-eval
  - time LiBrainian bootstrap --force 2>&1 | tee bootstrap.log
  - Count: wc -l bootstrap.log (errors)
  - LiBrainian status

  Report:
  - LiBrainian self-index: files, functions, query time
  - TypeScript repo: bootstrap time, files indexed, error count
  - Memory observations if possible
  - Breaking point analysis

  Clean up: rm -rf /tmp/ts-eval
```

### Task WU-EVAL-A03

```
Task: Bash
Description: Incremental reindex timing
Prompt: |
  Test incremental vs full reindex performance.

  # Ensure baseline index exists
  LiBrainian status || LiBrainian bootstrap

  # Record baseline metrics
  echo "=== BASELINE ==="
  LiBrainian status

  # Modify 3 files (add comments to change hash)
  echo "// Evaluation modification $(date)" >> src/api/query.ts
  echo "// Evaluation modification $(date)" >> src/api/bootstrap.ts
  echo "// Evaluation modification $(date)" >> src/cli/index.ts

  # Time incremental index
  echo "=== INCREMENTAL ==="
  time LiBrainian index --force src/api/query.ts src/api/bootstrap.ts src/cli/index.ts

  # Verify changes detected
  LiBrainian query "What was recently modified?"

  # Time full re-bootstrap for comparison
  echo "=== FULL BOOTSTRAP ==="
  time LiBrainian bootstrap --force

  # Revert modifications
  git checkout src/api/query.ts src/api/bootstrap.ts src/cli/index.ts

  Report ratio: incremental_time / full_bootstrap_time
  Target: ratio < 0.1 (incremental should be 10x faster)
```

### Task WU-EVAL-A04

```
Task: general-purpose
Description: Corruption recovery testing
Prompt: |
  You are testing LiBrainian's robustness to corruption.

  TEST 1: Interrupted Bootstrap
  - Start bootstrap in background: LiBrainian bootstrap &
  - After 5 seconds, kill it: kill %1
  - Attempt resume: LiBrainian bootstrap --force-resume
  - Check: Does it recover or require full restart?

  TEST 2: Partial Index Deletion
  - LiBrainian status (record baseline)
  - rm -rf .LiBrainian/cache/
  - LiBrainian status
  - LiBrainian query "test query"
  - Report: What breaks? What recovers?

  TEST 3: Database Corruption
  - LiBrainian status (ensure index exists)
  - echo "CORRUPT" >> LiBrainian.db
  - LiBrainian doctor
  - Report: Is corruption detected? Suggested fix?

  TEST 4: Concurrent Access
  - Terminal 1: LiBrainian bootstrap &
  - Terminal 2: LiBrainian query "test" (while bootstrap running)
  - Report: Locking behavior, errors, data consistency

  Document ALL failures and recovery paths.
```

---

## Phase 3: Stream B — Query Quality

### Task WU-EVAL-B01

```
Task: general-purpose
Description: Precision recall measurement
Prompt: |
  You are measuring LiBrainian query precision and recall.

  GROUND TRUTH QUERIES (you know the correct answers):

  Q1: "Where is the LiBrainian class defined?"
  TRUTH: src/api/LiBrainian.ts exports class LiBrainian

  Q2: "What functions does query.ts export?"
  TRUTH: queryLibrarian, queryLibrarianWithObserver, createFunctionQuery, etc.

  Q3: "What files import from epistemics/index.ts?"
  TRUTH: Multiple files in src/api/, src/knowledge/, src/integration/

  Q4: "What pattern does the EventBus follow?"
  TRUTH: Pub/sub pattern, singleton globalEventBus

  Q5: "Where is SQLITE_BUSY handled?"
  TRUTH: src/storage/sqlite_storage.ts

  For each query:
  1. Run: LiBrainian query "<query>"
  2. Extract files/functions mentioned in response
  3. Compare to ground truth
  4. Calculate:
     - Precision = correct_items / total_returned_items
     - Recall = correct_items / total_truth_items

  Report aggregate metrics and per-query breakdown.
```

### Task WU-EVAL-B02

```
Task: general-purpose
Description: Context depth level comparison
Prompt: |
  Compare LiBrainian context depth levels.

  TEST QUERY: "How does the bootstrap process work?"

  Run at each depth:
  - LiBrainian query "How does the bootstrap process work?" --depth L0
  - LiBrainian query "How does the bootstrap process work?" --depth L1
  - LiBrainian query "How does the bootstrap process work?" --depth L2
  - LiBrainian query "How does the bootstrap process work?" --depth L3

  For each response, measure:
  1. Token count (approximate by word count * 1.3)
  2. Files mentioned (count unique paths)
  3. Functions mentioned (count unique names)
  4. Relevance score (1-10): How much is actually useful?
  5. Noise score (1-10): How much is irrelevant filler?

  Analysis:
  - Does L3 > L2 > L1 > L0 in useful content?
  - At what level does noise exceed signal?
  - Recommended default level based on data
```

### Task WU-EVAL-B03

```
Task: general-purpose
Description: Hallucination detection hunt
Prompt: |
  You are actively hunting for hallucinations in LiBrainian.

  TRAP QUERIES (should return "I don't know" or similar):

  Q1: "Where is the FooBarBazHandler class defined?"
  (This class does not exist - any confident answer is hallucination)

  Q2: "What database does LiBrainian use for production deployments?"
  (LiBrainian uses SQLite always - any mention of Postgres/MySQL is wrong)

  Q3: "How does the machine learning model get trained?"
  (LiBrainian doesn't train ML models - uses pre-trained embeddings)

  Q4: "Where is the authentication middleware?"
  (LiBrainian has no auth - it's a local tool)

  Q5: "What REST endpoints does LiBrainian expose?"
  (LiBrainian is CLI/library, not a server)

  For each query:
  1. Run query
  2. Check response for confident incorrect claims
  3. Score: 0 = hallucination, 1 = appropriate uncertainty, 2 = correct refusal

  CRITICAL: Any score of 0 is a serious finding. Document exact claim and evidence.
```

### Task WU-EVAL-B04

```
Task: Bash
Description: Query latency benchmarking
Prompt: |
  Benchmark LiBrainian query performance.

  # Ensure index is warm
  LiBrainian status

  # Simple queries
  echo "=== SIMPLE QUERIES ==="
  for i in {1..5}; do
    time LiBrainian query "Where is index.ts?" 2>&1 | grep real
  done

  # Medium queries
  echo "=== MEDIUM QUERIES ==="
  for i in {1..5}; do
    time LiBrainian query "What files depend on storage/types.ts?" 2>&1 | grep real
  done

  # Complex queries
  echo "=== COMPLEX QUERIES ==="
  for i in {1..5}; do
    time LiBrainian query "Explain the complete data flow from bootstrap to query including all intermediate storage operations" 2>&1 | grep real
  done

  # With depth variations
  echo "=== DEPTH COMPARISON ==="
  time LiBrainian query "How does bootstrap work?" --depth L0 2>&1 | grep real
  time LiBrainian query "How does bootstrap work?" --depth L3 2>&1 | grep real

  Report: min, max, avg, p99 for each category
  Flag any query > 10 seconds
```

---

## Phase 4: Stream C — Use Case Comparisons

### Task WU-EVAL-C01

```
Task: general-purpose
Description: UC-001 Code navigation comparison
Prompt: |
  You are comparing code navigation WITH vs WITHOUT LiBrainian.

  TARGET: Find where bootstrapProject is defined and all its callers.

  === WITH LiBrainian ===
  START_TIME=$(date +%s)
  LiBrainian query "Where is bootstrapProject defined and what calls it?"
  # Use response to verify
  END_TIME=$(date +%s)
  LIBRARIAN_TIME=$((END_TIME - START_TIME))

  === WITHOUT LiBrainian ===
  START_TIME=$(date +%s)
  # Step 1: Find definition
  rg "export.*bootstrapProject|function bootstrapProject" --type ts -l
  # Step 2: Find callers
  rg "bootstrapProject\(" --type ts -l
  # Step 3: Read each file to understand context
  END_TIME=$(date +%s)
  MANUAL_TIME=$((END_TIME - START_TIME))

  === COMPARISON ===
  Report:
  - LiBrainian time: X seconds
  - Manual time: X seconds
  - LiBrainian accuracy: [complete/partial/wrong]
  - Manual accuracy: [complete/partial/wrong]
  - Winner: [LiBrainian/Manual/Tie]
  - Qualitative notes: [What was easier/harder about each approach?]
```

### Task WU-EVAL-C02

```
Task: general-purpose
Description: UC-002 Bug diagnosis comparison
Prompt: |
  You are comparing bug diagnosis WITH vs WITHOUT LiBrainian.

  SIMULATED ERROR: "TypeError: Cannot read property 'embeddings' of undefined at query.ts:234"

  === WITH LiBrainian ===
  Query: "What provides embeddings to the query pipeline? How can embeddings be undefined?"

  From response, form hypothesis about:
  1. What component provides embeddings
  2. Under what conditions it could be undefined
  3. Likely fix location

  === WITHOUT LiBrainian ===
  1. Read src/api/query.ts around line 234
  2. Trace 'embeddings' variable backwards
  3. Find all code paths that could leave it undefined

  === COMPARISON ===
  Report:
  - Time to hypothesis (WITH): X seconds
  - Time to hypothesis (WITHOUT): X seconds
  - Hypothesis accuracy (WITH): [correct/partial/wrong]
  - Hypothesis accuracy (WITHOUT): [correct/partial/wrong]
  - Quality of diagnostic reasoning
```

### Task WU-EVAL-C-TEMPLATE

**For Use Cases C03-C12, spawn with this template**:

```
Task: general-purpose
Description: UC-0XX [use case name]
Prompt: |
  You are comparing [USE CASE DESCRIPTION] WITH vs WITHOUT LiBrainian.

  SCENARIO: [Specific task description]

  === WITH LiBrainian ===
  [Specific queries to run]
  [Specific actions to take]
  [Metrics to record]

  === WITHOUT LiBrainian ===
  [Manual equivalent steps]
  [Metrics to record]

  === COMPARISON ===
  Report Treatment vs Control scores for:
  - Time to completion
  - Accuracy/correctness
  - Code quality (if code produced)
  - Completeness
  - Overall preference
```

---

## Phase 5: Stream D — Active Indexing

### Task WU-EVAL-D01

```
Task: general-purpose
Description: Watch mode file sync test
Prompt: |
  You are testing LiBrainian's file watching and auto-reindex.

  SETUP:
  1. Start watch in background: LiBrainian watch &
  2. Record PID for cleanup

  TEST 1: New File
  - Create: echo 'export function newTestFn() { return 42; }' > src/test_watch_new.ts
  - Wait 30 seconds
  - Query: LiBrainian query "What does newTestFn do?"
  - VERIFY: Response mentions newTestFn

  TEST 2: Modified File
  - Modify: echo '// watch test' >> src/api/query.ts
  - Wait 30 seconds
  - Query: LiBrainian query "What was recently modified?"
  - VERIFY: query.ts appears in response

  TEST 3: Deleted File
  - Delete: rm src/test_watch_new.ts
  - Wait 30 seconds
  - Query: LiBrainian query "What does newTestFn do?"
  - VERIFY: Response indicates not found OR shows uncertainty

  CLEANUP:
  - kill [watch PID]
  - git checkout src/api/query.ts

  Report sync behavior for each test.
```

### Task WU-EVAL-D02

```
Task: general-purpose
Description: Concurrent agent simulation
Prompt: |
  You are simulating concurrent agent workload on LiBrainian.

  SETUP: Run these in parallel for 2 minutes:

  AGENT A (Query Loop):
  while true; do
    LiBrainian query "random query $RANDOM" --json 2>&1 >> /tmp/agent_a.log
    sleep 1
  done &

  AGENT B (File Modifier):
  while true; do
    echo "// mod $RANDOM" >> src/api/query.ts
    sleep 10
  done &

  AGENT C (Status Checker):
  while true; do
    LiBrainian status >> /tmp/agent_c.log
    sleep 15
  done &

  After 2 minutes, kill all background jobs.

  ANALYSIS:
  - Count errors in agent_a.log (SQLITE_BUSY, timeouts, etc.)
  - Calculate query success rate
  - Check for any data corruption

  CLEANUP:
  - git checkout src/api/query.ts

  Report stability metrics.
```

### Task WU-EVAL-D03

```
Task: general-purpose
Description: Self-development dogfooding
Prompt: |
  You are an AI agent improving LiBrainian USING LiBrainian.

  TASK: "Improve error messages in the bootstrap command"

  STEP 1: Understand Current State
  LiBrainian query "Where is error handling in bootstrap? What error messages exist?"

  STEP 2: Identify Improvement
  Based on response, pick ONE error message to improve.

  STEP 3: Make Change
  Edit the file to improve the error message.
  Example: Change "Bootstrap failed" to "Bootstrap failed: Unable to connect to embedding provider. Run 'LiBrainian doctor' for diagnosis."

  STEP 4: Update Index
  LiBrainian index --force [modified file]

  STEP 5: Verify Update
  LiBrainian query "What error messages does bootstrap show?"
  VERIFY: New message appears in response

  STEP 6: Run Tests
  npm test -- --run --grep bootstrap

  STEP 7: Revert (if needed for clean state)
  git checkout [modified file]

  RATING:
  - Did LiBrainian help find the right files? (1-10)
  - Did the index update correctly? (1-10)
  - Overall dogfooding experience (1-10)
  - Specific friction points
```

---

## Orchestrator Aggregation Task

### Task WU-EVAL-FINAL

```
Task: general-purpose
Description: Synthesize evaluation report
Prompt: |
  You are aggregating all sub-agent findings into a final report.

  INPUT: Results from all WU-EVAL-* work units

  OUTPUT: Comprehensive report with:

  1. EXECUTIVE SUMMARY
  - Overall utility score (1-10)
  - Recommendation (USE / USE WITH CAVEATS / DO NOT USE)
  - Top 3 strengths
  - Top 3 weaknesses

  2. QUANTITATIVE METRICS
  - Bootstrap: success rate, avg time, file coverage
  - Query: precision, recall, hallucination rate, latency
  - Use Cases: Treatment vs Control delta for each
  - Active Indexing: sync reliability, concurrent stability

  3. QUALITATIVE FINDINGS
  - What works well
  - What breaks
  - Edge cases discovered
  - Surprising behaviors

  4. RECOMMENDATIONS
  - Immediate fixes needed
  - High-value improvements
  - Long-term considerations

  5. RAW DATA APPENDIX
  - All sub-agent outputs
  - All measurements
  - All error logs

  Format as Markdown suitable for inclusion in docs/LiBrainian/EVALUATION_REPORT.md
```

---

## Quick Reference: Spawning Sub-Agents

```typescript
// Example orchestrator code (pseudo)
const workUnits = [
  { id: 'WU-EVAL-001', stream: 'phase0', blocking: true },
  { id: 'WU-EVAL-002', stream: 'phase0', blocking: true },
  { id: 'WU-EVAL-A01', stream: 'A', blocking: false },
  { id: 'WU-EVAL-A02', stream: 'A', blocking: false },
  // ... etc
];

// Phase 0 must complete first
await runSequential(workUnits.filter(w => w.stream === 'phase0'));

// Then run all streams in parallel
await Promise.all([
  runStream('A'),
  runStream('B'),
  runStream('C'),
  runStream('D'),
]);

// Finally synthesize
await runWorkUnit('WU-EVAL-FINAL');
```

---

## Status Tracking

| Work Unit | Status | Score | Notes |
|-----------|--------|-------|-------|
| WU-EVAL-001 | | | |
| WU-EVAL-002 | | | |
| WU-EVAL-A01 | | | |
| WU-EVAL-A02 | | | |
| WU-EVAL-A03 | | | |
| WU-EVAL-A04 | | | |
| WU-EVAL-B01 | | | |
| WU-EVAL-B02 | | | |
| WU-EVAL-B03 | | | |
| WU-EVAL-B04 | | | |
| WU-EVAL-C01 | | | |
| WU-EVAL-C02 | | | |
| WU-EVAL-D01 | | | |
| WU-EVAL-D02 | | | |
| WU-EVAL-D03 | | | |
| WU-EVAL-FINAL | | | |
