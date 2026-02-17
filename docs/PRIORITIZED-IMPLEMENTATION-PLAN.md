# Prioritized Implementation Plan for LiBrainian Query Gaps

**Generated:** 2026-01-31
**Scope:** Fixes for gaps identified in testing evaluation

---

## Executive Summary

This plan addresses 15 identified gaps grouped into 5 work units, totaling approximately **52-68 hours** of development effort. Work units are designed for parallel execution by multiple agents where dependencies allow.

---

## Work Unit 1: WHY/Rationale Query Pipeline (P0)

**Theme:** WHY queries detect the intent but fail to construct rationale responses
**Effort:** 12-16 hours
**Dependencies:** None (can start immediately)

### Gap 1.1: WHY/Rationale queries don't trigger rationale construction (0% pass)

**Root Cause:**
The `runRationaleStage()` in `src/api/query.ts` is called for WHY queries (lines 1823-1861), but:
1. ADR indexer (`src/ingest/adr_indexer.ts`) isn't populating `relatedFiles` properly
2. `extractRationaleSignals()` returns empty results when no ADRs match the target entity
3. The `inferredRationale` fallback only generates generic text without code analysis

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts` - Lines 1823-1861
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/knowledge/extractors/rationale_extractor.ts`
3. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/ingest/adr_indexer.ts`

**Specific Code Changes:**

```typescript
// 1. In src/api/query.ts, enhance runRationaleStage to use LLM synthesis:
async function runRationaleStage(options: {
  storage: LibrarianStorage;
  intent: string;
  topic?: string;
  comparisonTopic?: string;
}): Promise<RationaleStageResult> {
  // CHANGE: Always attempt LLM-based rationale extraction for WHY queries
  // Current code only searches ADRs and returns inferredRationale as fallback

  // ADD: Search for code context related to the topic
  const topicMatches = await storage.searchSimilar(options.topic ?? options.intent, 5);

  // ADD: Call extractRationaleWithLLM with the code context
  if (topicMatches.length > 0) {
    const fileContent = await readFileContent(topicMatches[0].entityId);
    const extraction = await extractRationaleWithLLM({
      filePath: topicMatches[0].entityId,
      workspaceRoot,
      content: fileContent,
      entityName: options.topic,
    }, { provider: 'claude' });

    // Convert extraction to ContextPack
    if (extraction.rationale.decisions.length > 0 ||
        extraction.rationale.tradeoffs.length > 0) {
      // Build pack from extraction...
    }
  }
}

// 2. In rationale_extractor.ts, add fallback pattern matching:
// ADD new function to extract rationale from code comments when no ADRs exist
export function extractRationaleFromComments(content: string): RationaleExtraction {
  // Extract TODO/FIXME/WHY comments
  // Extract "because" / "reason:" / "due to" patterns
  // Return structured rationale even without ADRs
}
```

**Test to Verify:**
```typescript
// File: src/api/__tests__/why_query_rationale.test.ts
describe('WHY query rationale construction', () => {
  it('should construct rationale pack for "why use SQLite"', async () => {
    const response = await queryLibrarian({
      intent: 'why use SQLite instead of PostgreSQL',
      depth: 'L2',
    }, storage);

    expect(response.packs.some(p =>
      p.packType === 'decision_context' ||
      p.summary.toLowerCase().includes('sqlite') ||
      p.summary.toLowerCase().includes('tradeoff')
    )).toBe(true);
    expect(response.totalConfidence).toBeGreaterThan(0.5);
  });
});
```

**Effort:** 6-8 hours

---

### Gap 1.2: Architecture layers needs better semantic matching

**Root Cause:**
The `handleArchitectureQuery()` in `src/api/architecture_overview.ts` uses static directory inference rather than semantic understanding of layer relationships.

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/architecture_overview.ts`

**Specific Code Changes:**
```typescript
// ADD: Layer keyword mapping for semantic matching
const LAYER_KEYWORDS = {
  'presentation': ['ui', 'view', 'component', 'page', 'screen', 'controller'],
  'application': ['service', 'usecase', 'handler', 'orchestrator', 'workflow'],
  'domain': ['entity', 'model', 'domain', 'core', 'business'],
  'infrastructure': ['repository', 'adapter', 'gateway', 'client', 'persistence'],
  'api': ['api', 'route', 'endpoint', 'rest', 'graphql'],
};

// MODIFY: handleArchitectureQuery to use semantic layer detection
export async function handleArchitectureQuery(
  storage: LibrarianStorage,
  workspaceRoot: string,
  existingPacks: ContextPack[],
  version: LibrarianVersion
): Promise<ContextPack[]> {
  // Current: only infers from directory names
  // ADD: Analyze file contents/exports to determine layer
  const modules = await storage.getModules({ limit: 100 });

  const layerAssignments = new Map<string, string>();
  for (const mod of modules) {
    const layer = inferLayerFromContent(mod);
    layerAssignments.set(mod.path, layer);
  }

  // Build layer graph pack with semantic assignments
}
```

**Test to Verify:**
```typescript
it('should identify architecture layers semantically', async () => {
  const response = await queryLibrarian({
    intent: 'what are the architecture layers',
    depth: 'L2',
  }, storage);

  const archPack = response.packs.find(p => p.packType === 'architecture_overview');
  expect(archPack).toBeDefined();
  expect(archPack?.keyFacts.some(f => f.includes('layer'))).toBe(true);
});
```

**Effort:** 4-6 hours

---

## Work Unit 2: Type/Definition Query Accuracy (P0)

**Theme:** Definition queries return implementations instead of interfaces/types
**Effort:** 8-10 hours
**Dependencies:** None

### Gap 2.1: Type/interface definition queries fail (C grade)

**Root Cause:**
1. Symbol lookup (`src/api/symbol_lookup.ts`) doesn't prioritize type definitions
2. `applyDefinitionBias()` in `src/api/query.ts` applies weak boost (only 50% max)
3. Storage doesn't distinguish interface vs function entities well

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/symbol_lookup.ts`
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts` - `applyDefinitionBias()`
3. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/storage/symbol_storage.ts`

**Specific Code Changes:**
```typescript
// 1. In symbol_lookup.ts, add type-first lookup:
export async function runSymbolLookupStage(options: {
  workspaceRoot: string;
  intent: string;
}): Promise<SymbolLookupResult> {
  // EXISTING: Looks up by name in symbol table
  // ADD: Check if query mentions "interface", "type", "definition"
  const isDefinitionQuery = DEFINITION_QUERY_PATTERNS.some(p => p.test(options.intent));

  if (isDefinitionQuery) {
    // Prioritize interface/type symbols over functions
    const typeSymbols = symbolStorage.findByKind('interface')
      .concat(symbolStorage.findByKind('type'));

    // Match against extracted name
    const matches = typeSymbols.filter(s =>
      options.intent.toLowerCase().includes(s.name.toLowerCase())
    );

    if (matches.length > 0) {
      return {
        shouldShortCircuit: true,  // Return type definitions directly
        symbolPacks: matches.map(convertSymbolToPack),
        // ...
      };
    }
  }
}

// 2. In query.ts, increase definition bias:
export function applyDefinitionBias(
  results: SimilarityResult[],
  definitionBias: number,
  entityNames?: Map<string, string>
): SimilarityResult[] {
  // CHANGE: Increase boost from 1.5x to 2.0x
  const boost = 1 + (definitionBias * 1.0);  // Was 0.5

  // CHANGE: Increase implementation penalty from 15% to 30%
  const penalty = 1 - (definitionBias * 0.3);  // Was 0.15
}
```

**Test to Verify:**
```typescript
describe('Type/interface definition queries', () => {
  it('should return LibrarianStorage interface for "storage interface"', async () => {
    const response = await queryLibrarian({
      intent: 'what is the storage interface',
      depth: 'L1',
    }, storage);

    const topPack = response.packs[0];
    expect(topPack.summary.toLowerCase()).toContain('interface');
    expect(topPack.relatedFiles.some(f => f.includes('types'))).toBe(true);
  });
});
```

**Effort:** 8-10 hours

---

## Work Unit 3: Git/History and File Content Queries (P0)

**Theme:** Temporal queries (recent changes, git history) and file content queries fail
**Effort:** 10-14 hours
**Dependencies:** None

### Gap 3.1: Recent changes/git queries non-functional (D grade)

**Root Cause:**
1. No dedicated stage for git/temporal queries in `queryLibrarian()`
2. Commit indexer data (`src/ingest/commit_indexer.ts`) not integrated into query path
3. No pattern detection for "recent changes", "modified in last X", "what changed"

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query_intent.ts` (new patterns)
3. New file: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/git_query_stage.ts`

**Specific Code Changes:**
```typescript
// 1. Add GIT_QUERY_PATTERNS to query_intent.ts:
const GIT_QUERY_PATTERNS = [
  /\brecent\s+(changes?|commits?|modifications?)\b/i,
  /\b(changed|modified|updated)\s+(recently|lately|this\s+week)\b/i,
  /\bwhat\s+(changed|was\s+modified)\b/i,
  /\bgit\s+(log|history|blame)\b/i,
  /\bcommit\s+(history|messages?)\b/i,
  /\blast\s+\d+\s+(days?|weeks?|commits?)\b/i,
  /\bwho\s+(changed|modified|touched)\b/i,
];

// 2. Create src/api/git_query_stage.ts:
export interface GitQueryStageResult {
  isGitQuery: boolean;
  commits: CommitRecord[];
  packs: ContextPack[];
  explanation: string;
}

export async function runGitQueryStage(options: {
  storage: LibrarianStorage;
  intent: string;
  workspaceRoot: string;
  version: LibrarianVersion;
}): Promise<GitQueryStageResult> {
  const isGitQuery = GIT_QUERY_PATTERNS.some(p => p.test(options.intent));
  if (!isGitQuery) {
    return { isGitQuery: false, commits: [], packs: [], explanation: '' };
  }

  // Extract time range from intent
  const timeRange = parseTimeRange(options.intent);

  // Query commits from storage
  const commits = await options.storage.getCommits({
    since: timeRange.since,
    limit: 50,
  });

  // Group by affected files and build packs
  const fileChanges = groupCommitsByFile(commits);
  const packs = fileChanges.map(fc => ({
    packId: `git-changes-${fc.file}`,
    packType: 'change_context',
    summary: `${fc.commits.length} recent changes to ${fc.file}`,
    keyFacts: fc.commits.map(c => `${c.hash.slice(0,7)}: ${c.message}`),
    // ...
  }));

  return {
    isGitQuery: true,
    commits,
    packs,
    explanation: `Found ${commits.length} commits in ${timeRange.description}`,
  };
}

// 3. Add to query.ts pipeline (after enumeration stage):
const gitQueryResult = await runGitQueryStage({
  storage, intent: query.intent ?? '', workspaceRoot, version
});
if (gitQueryResult.isGitQuery && gitQueryResult.packs.length > 0) {
  directPacks = [...gitQueryResult.packs, ...directPacks];
  explanationParts.push(gitQueryResult.explanation);
}
```

**Test to Verify:**
```typescript
describe('Git/temporal queries', () => {
  it('should return recent changes for "what changed recently"', async () => {
    const response = await queryLibrarian({
      intent: 'what files changed recently',
      depth: 'L1',
    }, storage);

    expect(response.packs.some(p =>
      p.packType === 'change_context' ||
      p.summary.includes('change')
    )).toBe(true);
  });
});
```

**Effort:** 6-8 hours

---

### Gap 3.2: File content queries treated as semantic search (33%)

**Root Cause:**
When user asks "show me the contents of X.ts", the query goes through semantic search instead of direct file retrieval.

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query_intent.ts`

**Specific Code Changes:**
```typescript
// 1. Add FILE_CONTENT_PATTERNS to query_intent.ts:
const FILE_CONTENT_PATTERNS = [
  /\bshow\s+(me\s+)?(the\s+)?(contents?\s+of|file)\s+([^\s]+\.[a-z]+)/i,
  /\bread\s+([^\s]+\.[a-z]+)/i,
  /\bwhat('s|\s+is)\s+in\s+([^\s]+\.[a-z]+)/i,
  /\bcontents?\s+of\s+([^\s]+\.[a-z]+)/i,
  /\bopen\s+([^\s]+\.[a-z]+)/i,
];

// 2. Add file content detection to QueryClassification:
isFileContentQuery: boolean;
fileContentTarget?: string;

// 3. In query.ts, add early file content handling:
if (queryClassification?.isFileContentQuery && queryClassification.fileContentTarget) {
  // Direct file lookup - skip semantic search
  const filePath = queryClassification.fileContentTarget;
  const fileKnowledge = await storage.getFileByPath(filePath);

  if (fileKnowledge) {
    // Return file content pack directly
    const filePack: ContextPack = {
      packId: `file-content-${filePath}`,
      packType: 'file_content',
      summary: `Contents of ${filePath}`,
      keyFacts: fileKnowledge.exports || [],
      codeSnippets: [{
        path: filePath,
        content: await readFileContent(path.join(workspaceRoot, filePath)),
        startLine: 1
      }],
      relatedFiles: [filePath],
      confidence: 1.0,
      // ...
    };
    return buildResponse([filePack]);
  }
}
```

**Test to Verify:**
```typescript
it('should return file contents for "show me query.ts"', async () => {
  const response = await queryLibrarian({
    intent: 'show me the contents of src/api/query.ts',
    depth: 'L1',
  }, storage);

  expect(response.packs[0].packType).toBe('file_content');
  expect(response.packs[0].codeSnippets.length).toBeGreaterThan(0);
});
```

**Effort:** 4-6 hours

---

## Work Unit 4: Test and Documentation Queries (P0/P1)

**Theme:** Test discovery and documentation queries underperform
**Effort:** 12-16 hours
**Dependencies:** None

### Gap 4.1: Test discovery for specific classes fails (33%)

**Root Cause:**
`classifyTestQuery()` in `src/api/test_file_correlation.ts` extracts targets but:
1. Doesn't handle class name extraction (e.g., "tests for SqliteStorage class")
2. Only matches file paths, not class/function names
3. `correlateTestFiles()` doesn't search by class name in test files

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/test_file_correlation.ts`
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/storage/sqlite_storage.ts` (add test mapping method)

**Specific Code Changes:**
```typescript
// 1. In test_file_correlation.ts, enhance TARGET_FILE_PATTERNS:
const TARGET_FILE_PATTERNS = [
  // EXISTING patterns...

  // ADD: Class name extraction patterns
  /\btests?\s+for\s+(?:the\s+)?([A-Z][a-zA-Z0-9]+)(?:\s+class)?$/i,
  /\btest(?:s|ing)?\s+([A-Z][a-zA-Z0-9]+)/i,
  /\bunit\s+tests?\s+for\s+([A-Z][a-zA-Z0-9]+)/i,
];

// 2. Add class-to-file resolution:
async function resolveClassToFile(
  className: string,
  storage: LibrarianStorage
): Promise<string | null> {
  // Search symbol table for class definition
  const symbolStorage = createSymbolStorage(workspaceRoot);
  await symbolStorage.initialize();
  const classSymbol = symbolStorage.findByName(className, 'class');
  await symbolStorage.close();

  if (classSymbol) {
    return classSymbol.file;
  }
  return null;
}

// 3. Enhance correlateTestFiles to search by class name:
export async function correlateTestFiles(
  sourcePath: string,
  storage: LibrarianStorage,
  options: TestCorrelationOptions = {}
): Promise<TestCorrelationResult> {
  // EXISTING: Path-based correlation

  // ADD: Search test files that import or reference the class name
  const className = path.basename(sourcePath, path.extname(sourcePath));
  const testFiles = await storage.getFiles({ category: 'test' });

  for (const testFile of testFiles) {
    const content = await readFileContent(testFile.path);
    // Check if test file imports or describes this class
    if (content.includes(className) ||
        content.includes(`describe('${className}`) ||
        content.includes(`describe("${className}`)) {
      correlatedTests.push({
        testPath: testFile.relativePath,
        correlationType: 'class_reference',
        confidence: 0.85,
        patternName: 'class_import_match',
      });
    }
  }
}
```

**Test to Verify:**
```typescript
it('should find tests for "SqliteStorage class"', async () => {
  const response = await queryLibrarian({
    intent: 'tests for SqliteStorage class',
    depth: 'L1',
  }, storage);

  expect(response.packs.some(p =>
    p.relatedFiles.some(f => f.includes('sqlite') && f.includes('test'))
  )).toBe(true);
});
```

**Effort:** 6-8 hours

---

### Gap 4.2: Documentation queries fail (11% pass)

**Root Cause:**
1. Document bias (`documentBias: 0.7`) is applied but doesn't overcome semantic similarity
2. Meta-query patterns don't capture all documentation queries
3. Documentation packs aren't boosted enough in ranking

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts` - Lines 630-728
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/packs.ts`

**Specific Code Changes:**
```typescript
// 1. In query.ts classifyQueryIntent, add more meta patterns:
const META_QUERY_PATTERNS = [
  // EXISTING patterns...

  // ADD: More documentation query patterns
  /\bdocs?\s+for\b/i,
  /\bdocumentation\s+(for|about|on)\b/i,
  /\bread\s+the\s+(docs?|documentation|readme)\b/i,
  /\bwhere\s+is\s+(the\s+)?documentation\b/i,
  /\bapi\s+docs?\b/i,
];

// 2. In packs.ts rankContextPacks, increase doc boost for meta queries:
export function rankContextPacks(options: {
  packs: ContextPack[];
  scoreByTarget: Map<string, number>;
  maxPacks: number;
  taskType?: TaskType;
  depth?: string;
}): RankedPacks {
  // CHANGE: For 'guidance' taskType, apply 2x boost to documents
  if (taskType === 'guidance') {
    for (const pack of packs) {
      if (pack.packType === 'document_summary' ||
          pack.relatedFiles.some(f => f.endsWith('.md'))) {
        // Increase from 1.3x to 2.0x
        const score = scoreByTarget.get(pack.targetId) ?? pack.confidence;
        scoreByTarget.set(pack.targetId, score * 2.0);
      }
    }
  }
}

// 3. In query.ts, ensure document-only search for strong meta queries:
if (queryClassification.documentBias > 0.8) {
  // Filter semantic results to documents only
  semanticResult.candidates = semanticResult.candidates.filter(
    c => c.entityType === 'document'
  );
}
```

**Test to Verify:**
```typescript
it('should return documentation for "how to use LiBrainian"', async () => {
  const response = await queryLibrarian({
    intent: 'how do I use LiBrainian',
    depth: 'L1',
  }, storage);

  expect(response.packs.some(p =>
    p.packType === 'document_summary' ||
    p.relatedFiles.some(f => f.endsWith('.md'))
  )).toBe(true);
});
```

**Effort:** 4-6 hours

---

### Gap 4.3: How-to queries need synthesis (0% direct pass)

**Root Cause:**
How-to queries require LLM synthesis to provide step-by-step guidance, but synthesis is often skipped or returns generic responses.

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query_synthesis.ts`
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`

**Specific Code Changes:**
```typescript
// 1. In query_synthesis.ts, add how-to specialized synthesis:
export async function synthesizeHowToAnswer(
  intent: string,
  packs: ContextPack[],
  llmService: LlmServiceAdapter
): Promise<QuerySynthesisResult> {
  const prompt = `Given the following code context, provide step-by-step instructions for: "${intent}"

Context:
${packs.map(p => `## ${p.summary}\n${p.keyFacts.join('\n')}`).join('\n\n')}

Provide:
1. Prerequisites
2. Step-by-step instructions
3. Example code if applicable
4. Common pitfalls to avoid`;

  const response = await llmService.chat({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1500,
  });

  return {
    answer: response.content,
    confidence: 0.85,
    synthesized: true,
  };
}

// 2. In query.ts, detect how-to and force synthesis:
const isHowToQuery = /\bhow\s+(do|can|to|should)\s+/i.test(query.intent ?? '');
if (isHowToQuery && synthesisEnabled && finalPacks.length > 0) {
  // Force synthesis for how-to queries
  const howToSynthesis = await synthesizeHowToAnswer(
    query.intent ?? '',
    finalPacks.slice(0, 5),
    llmService
  );

  if (howToSynthesis.synthesized) {
    // Prepend synthesis pack
    const synthesisPack: ContextPack = {
      packId: generateUUID('howto_'),
      packType: 'synthesis',
      summary: howToSynthesis.answer.slice(0, 200),
      keyFacts: [howToSynthesis.answer],
      // ...
    };
    finalPacks = [synthesisPack, ...finalPacks];
  }
}
```

**Test to Verify:**
```typescript
it('should provide synthesis for "how do I add a new query type"', async () => {
  const response = await queryLibrarian({
    intent: 'how do I add a new query type to LiBrainian',
    depth: 'L2',
    llmRequirement: 'required',
  }, storage);

  expect(response.packs.some(p =>
    p.packType === 'synthesis' ||
    p.keyFacts.some(f => f.includes('step') || f.includes('1.'))
  )).toBe(true);
});
```

**Effort:** 4-6 hours

---

## Work Unit 5: Query Mode and Confidence Fixes (P1/P2)

**Theme:** Exhaustive mode triggers incorrectly, confidence scoring issues
**Effort:** 10-12 hours
**Dependencies:** None

### Gap 5.1: "breaking changes" incorrectly triggers exhaustive mode

**Root Cause:**
`EXHAUSTIVE_PATTERNS` in `src/api/query_intent.ts` includes `/\bbreaking\s+change/i` which matches queries about breaking changes conceptually, not just exhaustive dependency enumeration.

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query_intent.ts` - Lines 171-188

**Specific Code Changes:**
```typescript
// CHANGE: Make exhaustive patterns more specific
const EXHAUSTIVE_PATTERNS = [
  /\ball\b.*\b(depend|import|use|call)/i,
  /\bevery\b.*\b(depend|import|use|call)/i,
  /\bcomplete\s+list/i,
  /\bfull\s+list/i,
  /\bexhaustive/i,
  /\btransitive/i,
  // REMOVE or refine: /\bbreaking\s+change/i,
  // CHANGE: Only trigger for "list all breaking changes" not "what are breaking changes"
  /\b(list|enumerate|find)\s+(all\s+)?breaking\s+changes?\b/i,
  /\bimpact\s+analysis/i,
  /\btotal\s+count/i,
  /\bhow\s+many\b.*\b(depend|import|use)/i,
  // Refactor patterns - only with enumeration context
  /\b(all|list|every)\b.*\brefactor/i,
  /\brefactor.*\b(all|list|every)\b/i,
  // NOT: /\brefactor.*\b(break|affect|impact|what\s+would)/i,
];

// ADD: Separate pattern for impact analysis (different handling)
const IMPACT_ANALYSIS_PATTERNS = [
  /\bwhat\s+would\s+break\b/i,
  /\bbreaking\s+changes?\s+if\b/i,
  /\bimpact\s+of\s+(changing|modifying|removing)\b/i,
];
```

**Test to Verify:**
```typescript
it('should not trigger exhaustive for "what are breaking changes"', () => {
  const intent = classifyUnifiedQueryIntent('what are breaking changes');
  expect(intent.requiresExhaustive).toBe(false);
});

it('should trigger exhaustive for "list all breaking changes"', () => {
  const intent = classifyUnifiedQueryIntent('list all breaking changes');
  expect(intent.requiresExhaustive).toBe(true);
});
```

**Effort:** 2-3 hours

---

### Gap 5.2: Call flow returns fragments, not sequences

**Root Cause:**
Graph traversal returns individual edges/nodes but doesn't construct the full call sequence/flow.

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/dependency_query.ts`
2. New file: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/call_flow_builder.ts`

**Specific Code Changes:**
```typescript
// 1. Create src/api/call_flow_builder.ts:
export interface CallFlowStep {
  caller: string;
  callee: string;
  file: string;
  line?: number;
}

export interface CallFlowResult {
  entryPoint: string;
  steps: CallFlowStep[];
  endPoints: string[];
  flowDescription: string;
}

export async function buildCallFlow(
  storage: LibrarianStorage,
  startEntity: string,
  direction: 'forward' | 'backward',
  maxDepth: number = 10
): Promise<CallFlowResult> {
  const steps: CallFlowStep[] = [];
  const visited = new Set<string>();
  const queue = [{ entity: startEntity, depth: 0 }];

  while (queue.length > 0) {
    const { entity, depth } = queue.shift()!;
    if (visited.has(entity) || depth >= maxDepth) continue;
    visited.add(entity);

    const edges = direction === 'forward'
      ? await storage.getOutgoingEdges(entity, 'calls')
      : await storage.getIncomingEdges(entity, 'calls');

    for (const edge of edges) {
      steps.push({
        caller: direction === 'forward' ? entity : edge.target,
        callee: direction === 'forward' ? edge.target : entity,
        file: edge.metadata?.file,
        line: edge.metadata?.line,
      });
      queue.push({ entity: edge.target, depth: depth + 1 });
    }
  }

  return {
    entryPoint: startEntity,
    steps,
    endPoints: findEndpoints(steps),
    flowDescription: formatFlowDescription(steps),
  };
}

// 2. In dependency_query.ts, use call flow builder for "call flow" queries:
if (intent.includes('call flow') || intent.includes('call sequence')) {
  const flow = await buildCallFlow(storage, targetEntity, 'forward');
  // Convert to pack with full sequence
}
```

**Test to Verify:**
```typescript
it('should return full call sequence for "call flow of queryLibrarian"', async () => {
  const response = await queryLibrarian({
    intent: 'show the call flow of queryLibrarian',
    depth: 'L2',
  }, storage);

  const flowPack = response.packs.find(p => p.packType === 'call_flow');
  expect(flowPack).toBeDefined();
  expect(flowPack?.keyFacts.length).toBeGreaterThan(1);
});
```

**Effort:** 6-8 hours

---

### Gap 5.3: Confidence too high for ambiguous queries

**Root Cause:**
Confidence calibration doesn't sufficiently penalize ambiguous, short queries like "config".

**Files to Modify:**
1. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/confidence_calibration.ts`
2. `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`

**Specific Code Changes:**
```typescript
// 1. In confidence_calibration.ts, add ambiguity penalty:
export function computeQueryAmbiguityPenalty(intent: string): number {
  // Short queries are ambiguous
  const wordCount = intent.split(/\s+/).length;
  if (wordCount <= 1) return 0.4;  // Heavy penalty for single word
  if (wordCount <= 2) return 0.2;
  if (wordCount <= 3) return 0.1;

  // Generic terms are ambiguous
  const genericTerms = ['config', 'data', 'util', 'helper', 'service', 'handler'];
  const hasGenericOnly = genericTerms.some(t =>
    intent.toLowerCase() === t ||
    intent.toLowerCase() === `${t}s`
  );
  if (hasGenericOnly) return 0.3;

  return 0;
}

// 2. In query.ts, apply ambiguity penalty:
let totalConfidence = finalPacks.length
  ? Math.exp(finalPacks.reduce((sum, p) => sum + Math.log(Math.max(0.01, p.confidence)), 0) / finalPacks.length)
  : 0;

// ADD: Apply ambiguity penalty
const ambiguityPenalty = computeQueryAmbiguityPenalty(query.intent ?? '');
if (ambiguityPenalty > 0) {
  totalConfidence *= (1 - ambiguityPenalty);
  disclosures.push(`unverified_by_trace(ambiguous_query): Query "${query.intent}" is ambiguous. Confidence reduced by ${(ambiguityPenalty * 100).toFixed(0)}%.`);
}
```

**Test to Verify:**
```typescript
it('should have low confidence for ambiguous query "config"', async () => {
  const response = await queryLibrarian({
    intent: 'config',
    depth: 'L1',
  }, storage);

  expect(response.totalConfidence).toBeLessThan(0.6);
  expect(response.disclosures.some(d => d.includes('ambiguous'))).toBe(true);
});
```

**Effort:** 3-4 hours

---

## Summary: Implementation Order by Priority

| Work Unit | Gaps Covered | Priority | Effort | Parallel Safe |
|-----------|-------------|----------|--------|---------------|
| **WU-1: WHY/Rationale** | 1.1, 1.2 | P0 | 12-16h | Yes |
| **WU-2: Type Definitions** | 2.1 | P0 | 8-10h | Yes |
| **WU-3: Git/File Content** | 3.1, 3.2 | P0 | 10-14h | Yes |
| **WU-4: Test/Docs** | 4.1, 4.2, 4.3 | P0/P1 | 12-16h | Yes |
| **WU-5: Query Modes** | 5.1, 5.2, 5.3 | P1/P2 | 10-12h | Yes |

**Total Estimated Effort:** 52-68 hours

---

## Remaining P2 Gaps (Not in Work Units)

These gaps are lower priority and can be addressed after the main work units:

1. **Performance queries lack profiling data** - Requires adding performance metrics collection during indexing
2. **Coding conventions not indexed** - Requires new extractor for style/convention patterns
3. **Environment variables not tracked** - Requires new extractor for .env files and process.env references
4. **Troubleshooting returns code not guides** - Related to documentation query improvements in WU-4

---

## Agent Handoff Instructions

Each work unit can be assigned to a separate agent. To begin:

1. **Create feature branch:** `git checkout -b fix/wu-{N}-{theme}`
2. **Read the specific files** listed in the work unit
3. **Implement changes** as specified with the code examples
4. **Write/run the verification tests** to confirm fix
5. **Create PR** with test results and before/after query examples

For coordination:
- Work Units 1-5 have no inter-dependencies
- All agents should base work on `main` branch
- Merge order: WU-1, WU-2, WU-3, WU-4, WU-5 (by priority)
