# Track H: Code Review with Diff-Aware Context

> **Addresses**: UC6 from `docs/librarian/specs/use-case-targets.md` - Code Review
> **Scenario**: "Reviewer needs context for a PR with 15 changed files"
> **Current Maturity (subjective, not measured)**: low (no diff-aware context, no "what could break" analysis, no reviewer checklist)
>
> **Librarian Story**: Chapter 8 (The Review) - Making code review intelligent through diff-aware context and impact analysis.
>
> **Related Specifications**:
> - [track-i-multi-repo.md](./track-i-multi-repo.md) - Cross-repo review capabilities
> - [track-c-causal-reasoning.md](./track-c-causal-reasoning.md) - Causal analysis for change impact
> - [track-e-domain.md](./track-e-domain.md) - Domain-specific review checklists
> - [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) - Principled confidence system used throughout
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md).

---

## Executive Summary

Track H addresses the fundamental code review limitation: **Reviewers see the diff, but lack the context to understand its true impact.**

Current code review tools show:
- What lines changed
- Who changed them
- Basic syntax highlighting

But reviewers need:
- Why these changes were made (intent)
- What could break (impact analysis)
- What to focus on (risk areas)
- Domain-specific concerns (security, performance, API)

This specification covers:
- **Diff-Aware Context** - Structured parsing and context assembly for diffs
- **Impact Analysis** - Understanding downstream effects of changes
- **Intent Inference** - Understanding author's purpose
- **Review Primitives** - Typed techniques for review operations
- **Review Compositions** - Complex review workflows
- **Integration Points** - Connecting with other Librarian capabilities

---

## 1. Problem Statement

### The Context Gap in Code Review

Code review is fundamentally about understanding changes in context:

```
+----------------------------------------+
|            WHAT REVIEWERS SEE          |
|                                        |
|   - function processPayment(order) {   |
|   + function processPayment(order, opts) {|
|   +   if (opts.retry) {                |
|   +     return retryPayment(order);    |
|   +   }                                |
|       return gateway.charge(order);     |
|     }                                   |
+----------------------------------------+

+----------------------------------------+
|           WHAT REVIEWERS NEED          |
|                                        |
|   WHY: Adding retry capability per     |
|        JIRA-1234 for failed payments   |
|                                        |
|   IMPACT: 47 callers of processPayment |
|           must be updated. 3 are in    |
|           critical checkout path.       |
|                                        |
|   RISK: retryPayment doesn't exist yet |
|         Type signature changed         |
|         No tests for retry path        |
|                                        |
|   FOCUS: Check retry idempotency       |
|          Verify gateway compatibility  |
+----------------------------------------+
```

### What Current Review Lacks

| Need | Current State | Ideal State |
|------|---------------|-------------|
| Context for changes | Manual file navigation | Automatic context assembly |
| Impact understanding | Guesswork | Explicit dependency analysis |
| Author intent | Commit message (maybe) | Inferred from change patterns |
| Risk identification | Reviewer experience | Systematic risk analysis |
| Review checklist | Generic/none | Change-type-specific |
| Test coverage | Separate tool | Integrated analysis |

### Theoretical Foundation

**McCarthy's Insight**: "Understanding a change requires understanding what didn't change but could have."

**Pearl's Insight**: "The question 'what could break?' is fundamentally causal - it requires understanding causal dependencies, not just structural ones."

---

## 2. Diff-Aware Context

### Core Types

```typescript
/**
 * Complete context for reviewing a diff.
 *
 * PRINCIPLE: The diff alone is insufficient.
 * Context must include: entities, downstream effects, intent, and risks.
 */
interface DiffContext {
  /** Parsed diff with structural information */
  diff: ParsedDiff;

  /** Entities directly modified by the diff */
  changedEntities: Entity[];

  /** Entities affected downstream (dependents of changed entities) */
  affectedEntities: Entity[];

  /** Relevant context packs for understanding changes */
  relevantContext: ContextPack[];

  /** Inferred author intent */
  authorIntent: IntentAnalysis;

  /** Identified risk areas */
  riskAreas: RiskArea[];

  /** Context assembly metadata */
  metadata: DiffContextMetadata;
}

interface DiffContextMetadata {
  /** When context was assembled */
  assembledAt: Date;

  /** Git ref for the diff */
  baseRef: string;
  headRef: string;

  /** Repository information */
  repoId: string;

  /** Confidence in context completeness */
  completenessConfidence: ConfidenceValue;
}

/**
 * Structured representation of a diff.
 * Goes beyond line-by-line changes to understand what changed semantically.
 */
interface ParsedDiff {
  /** Files included in the diff */
  files: DiffFile[];

  /** Aggregate statistics */
  addedLines: number;
  removedLines: number;

  /** Functions that were modified */
  changedFunctions: ChangedFunction[];

  /** Types/interfaces that were modified */
  changedTypes: ChangedType[];

  /** Imports that were added/removed */
  importChanges: ImportChange[];

  /** Parsing confidence */
  confidence: ConfidenceValue;
}

interface DiffFile {
  /** File path */
  path: string;

  /** Old path (if renamed) */
  oldPath?: string;

  /** Change type */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';

  /** Hunks of changes */
  hunks: DiffHunk[];

  /** Language of the file */
  language: string;

  /** Is this a test file? */
  isTestFile: boolean;

  /** Lines added */
  additions: number;

  /** Lines removed */
  deletions: number;
}

interface DiffHunk {
  /** Starting line in old file */
  oldStart: number;

  /** Number of lines in old file */
  oldLines: number;

  /** Starting line in new file */
  newStart: number;

  /** Number of lines in new file */
  newLines: number;

  /** The actual changes */
  changes: DiffChange[];

  /** Context (function/class this hunk is in) */
  context?: string;
}

interface DiffChange {
  /** Change type */
  type: 'add' | 'delete' | 'context';

  /** Line content */
  content: string;

  /** Line number in old file (for delete/context) */
  oldLineNumber?: number;

  /** Line number in new file (for add/context) */
  newLineNumber?: number;
}

interface ChangedFunction {
  /** Function identifier */
  entityId: EntityId;

  /** Function name */
  name: string;

  /** File containing the function */
  file: string;

  /** What changed */
  changeType: FunctionChangeType;

  /** Old signature (if changed) */
  oldSignature?: string;

  /** New signature */
  newSignature: string;

  /** Is this a breaking change? */
  isBreaking: boolean;

  /** Confidence in change classification */
  confidence: ConfidenceValue;
}

type FunctionChangeType =
  | 'added'
  | 'deleted'
  | 'signature_changed'
  | 'body_modified'
  | 'renamed'
  | 'moved';

interface ChangedType {
  /** Type identifier */
  entityId: EntityId;

  /** Type name */
  name: string;

  /** File containing the type */
  file: string;

  /** What changed */
  changeType: TypeChangeType;

  /** Fields added */
  addedFields?: string[];

  /** Fields removed */
  removedFields?: string[];

  /** Fields with changed types */
  modifiedFields?: Array<{
    name: string;
    oldType: string;
    newType: string;
  }>;

  /** Is this a breaking change? */
  isBreaking: boolean;

  /** Confidence in change classification */
  confidence: ConfidenceValue;
}

type TypeChangeType =
  | 'added'
  | 'deleted'
  | 'fields_added'
  | 'fields_removed'
  | 'fields_modified'
  | 'renamed';

interface ImportChange {
  /** File where import changed */
  file: string;

  /** Change type */
  type: 'added' | 'removed' | 'modified';

  /** Module being imported */
  module: string;

  /** Specific imports (for named imports) */
  namedImports?: string[];
}
```

### Intent Analysis

```typescript
/**
 * Inferred intent behind the changes.
 *
 * Understanding WHY changes were made is crucial for review.
 * Intent is inferred from:
 * - Commit messages
 * - Change patterns
 * - PR description
 * - Linked issues
 */
interface IntentAnalysis {
  /** Primary intent classification */
  primaryIntent: IntentType;

  /** Confidence in classification */
  intentConfidence: ConfidenceValue;

  /** Secondary intents (if multi-purpose change) */
  secondaryIntents: IntentType[];

  /** Natural language summary of intent */
  summary: string;

  /** Evidence supporting the classification */
  evidence: IntentEvidence[];

  /** Linked issues/tickets */
  linkedIssues: LinkedIssue[];
}

type IntentType =
  | 'bug_fix'
  | 'feature_addition'
  | 'feature_modification'
  | 'refactoring'
  | 'performance_optimization'
  | 'security_fix'
  | 'dependency_update'
  | 'test_addition'
  | 'test_modification'
  | 'documentation'
  | 'configuration'
  | 'cleanup'
  | 'unknown';

interface IntentEvidence {
  /** Source of evidence */
  source: 'commit_message' | 'pr_description' | 'linked_issue' | 'change_pattern' | 'file_names';

  /** The evidence text or pattern */
  content: string;

  /** How strongly this suggests the intent */
  strength: ConfidenceValue;
}

interface LinkedIssue {
  /** Issue identifier */
  id: string;

  /** Issue tracker type */
  tracker: 'github' | 'jira' | 'linear' | 'other';

  /** Issue title */
  title: string;

  /** Issue type */
  type?: 'bug' | 'feature' | 'task' | 'epic';

  /** Link confidence */
  confidence: ConfidenceValue;
}
```

### Risk Areas

```typescript
/**
 * Identified risks in the change set.
 *
 * PRINCIPLE: Not all changes are equally risky.
 * Reviewers should focus attention on high-risk areas.
 */
interface RiskArea {
  /** Risk identifier */
  id: string;

  /** Risk category */
  category: RiskCategory;

  /** Severity level */
  severity: RiskSeverity;

  /** Description of the risk */
  description: string;

  /** Affected entities */
  affectedEntities: EntityId[];

  /** Specific locations to review */
  locations: CodeLocation[];

  /** Suggested review focus */
  reviewFocus: string[];

  /** Mitigation suggestions */
  mitigations: string[];

  /** Risk assessment confidence */
  confidence: ConfidenceValue;
}

type RiskCategory =
  | 'breaking_change'
  | 'security'
  | 'performance'
  | 'data_integrity'
  | 'error_handling'
  | 'concurrency'
  | 'api_compatibility'
  | 'test_coverage'
  | 'complexity_increase'
  | 'external_dependency';

type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

interface CodeLocation {
  /** File path */
  file: string;

  /** Start line */
  startLine: number;

  /** End line */
  endLine: number;

  /** Context description */
  context?: string;
}
```

---

## 3. Review Primitives

### tp_diff_parse

```typescript
/**
 * Parse a diff into structured form.
 *
 * INPUT: Raw diff (unified format) or git refs
 * OUTPUT: Structured ParsedDiff with semantic understanding
 */
export const tp_diff_parse: TechniquePrimitive = {
  id: 'tp_diff_parse',
  name: 'Diff Parser',
  description: 'Parse a diff into structured form with semantic understanding of changes',
  inputs: [
    { name: 'diff', type: 'string | GitRefs' },
    { name: 'repoPath', type: 'string' },
    { name: 'includeContext', type: 'boolean', optional: true, default: true },
  ],
  outputs: [
    { name: 'parsedDiff', type: 'ParsedDiff' },
    { name: 'changedFunctions', type: 'ChangedFunction[]' },
    { name: 'changedTypes', type: 'ChangedType[]' },
  ],
  confidence: { type: 'deterministic', value: 1.0, reason: 'AST-based diff parsing' },
  tier: 1, // Structural analysis
};

interface GitRefs {
  /** Base ref (e.g., 'main', commit hash) */
  base: string;

  /** Head ref (e.g., 'feature-branch', commit hash) */
  head: string;
}

async function parseDiff(
  diff: string | GitRefs,
  repoPath: string,
  includeContext: boolean = true
): Promise<ParsedDiff> {
  // Step 1: Get raw diff if refs provided
  const rawDiff = typeof diff === 'string'
    ? diff
    : await getDiffFromRefs(repoPath, diff.base, diff.head);

  // Step 2: Parse unified diff format
  const files = parseUnifiedDiff(rawDiff);

  // Step 3: For each file, extract semantic changes
  const changedFunctions: ChangedFunction[] = [];
  const changedTypes: ChangedType[] = [];
  const importChanges: ImportChange[] = [];

  for (const file of files) {
    if (file.changeType === 'deleted') continue;

    // Parse AST for new version
    const ast = await parseFile(repoPath, file.path);

    // Identify changed functions
    const fileFunctions = await extractChangedFunctions(file, ast);
    changedFunctions.push(...fileFunctions);

    // Identify changed types
    const fileTypes = await extractChangedTypes(file, ast);
    changedTypes.push(...fileTypes);

    // Identify import changes
    const fileImports = extractImportChanges(file);
    importChanges.push(...fileImports);
  }

  return {
    files,
    addedLines: files.reduce((sum, f) => sum + f.additions, 0),
    removedLines: files.reduce((sum, f) => sum + f.deletions, 0),
    changedFunctions,
    changedTypes,
    importChanges,
    confidence: { type: 'deterministic', value: 1.0, reason: 'AST-verified parsing' }
  };
}
```

### tp_change_context

```typescript
/**
 * Get context for changed code.
 *
 * INPUT: Changed entities
 * OUTPUT: Context packs relevant to understanding the changes
 */
export const tp_change_context: TechniquePrimitive = {
  id: 'tp_change_context',
  name: 'Change Context Assembler',
  description: 'Assemble relevant context for understanding code changes',
  inputs: [
    { name: 'changedEntities', type: 'EntityId[]' },
    { name: 'knowledgeBase', type: 'KnowledgeBase' },
    { name: 'maxContextSize', type: 'number', optional: true },
  ],
  outputs: [
    { name: 'contextPacks', type: 'ContextPack[]' },
    { name: 'relatedEntities', type: 'Entity[]' },
    { name: 'domainConcepts', type: 'DomainConcept[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2, // Requires semantic understanding
};

async function getChangeContext(
  changedEntities: EntityId[],
  knowledgeBase: KnowledgeBase,
  maxContextSize: number = 10000
): Promise<ChangeContextResult> {
  const contextPacks: ContextPack[] = [];
  const relatedEntities: Entity[] = [];
  const seenEntities = new Set<string>();

  for (const entityId of changedEntities) {
    const entity = await knowledgeBase.getEntity(entityId);
    if (!entity) continue;

    // Get direct dependencies
    const dependencies = await knowledgeBase.getDependencies(entityId);

    // Get direct dependents (who calls this?)
    const dependents = await knowledgeBase.getDependents(entityId);

    // Get related entities (same module, similar functionality)
    const related = await knowledgeBase.getRelatedEntities(entityId);

    // Build context pack for this entity
    const pack: ContextPack = {
      entityId,
      entity,
      dependencies: dependencies.slice(0, 10), // Limit for context budget
      dependents: dependents.slice(0, 20),     // More dependents since they're affected
      relatedContext: related.slice(0, 5),
    };

    contextPacks.push(pack);

    // Track related entities
    for (const dep of [...dependencies, ...dependents, ...related]) {
      if (!seenEntities.has(dep.id)) {
        seenEntities.add(dep.id);
        relatedEntities.push(dep);
      }
    }
  }

  // Extract domain concepts from context
  const domainConcepts = await extractDomainConcepts(contextPacks, knowledgeBase);

  return {
    contextPacks,
    relatedEntities,
    domainConcepts,
    confidence: { type: 'absent', reason: 'uncalibrated' }
  };
}
```

### tp_impact_analyze

```typescript
/**
 * Analyze downstream impact of changes.
 *
 * INPUT: Changed entities and change details
 * OUTPUT: Impact analysis showing what could break
 */
export const tp_impact_analyze: TechniquePrimitive = {
  id: 'tp_impact_analyze',
  name: 'Impact Analyzer',
  description: 'Analyze the downstream impact of code changes',
  inputs: [
    { name: 'changedEntities', type: 'EntityId[]' },
    { name: 'changeDetails', type: 'ChangeDetail[]' },
    { name: 'knowledgeBase', type: 'KnowledgeBase' },
    { name: 'depth', type: 'number', optional: true, default: 3 },
  ],
  outputs: [
    { name: 'impactAnalysis', type: 'ImpactAnalysis' },
    { name: 'affectedTests', type: 'AffectedTest[]' },
    { name: 'breakingChanges', type: 'BreakingChange[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2, // Graph traversal with semantic understanding
};

/**
 * Complete impact analysis for a set of changes.
 */
interface ImpactAnalysis {
  /** Entities directly changed by the diff */
  directImpact: ImpactedEntity[];

  /** Entities affected through dependencies */
  transitiveImpact: ImpactedEntity[];

  /** Overall risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Identified breaking changes */
  breakingChanges: BreakingChange[];

  /** Test coverage analysis for changed code */
  testCoverage: CoverageAnalysis;

  /** Suggested additional tests */
  suggestedTests: TestSuggestion[];

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface ImpactedEntity {
  /** Entity identifier */
  entityId: EntityId;

  /** Entity name */
  name: string;

  /** File location */
  file: string;

  /** Impact type */
  impactType: 'direct' | 'transitive';

  /** Distance from changed entity (1 = direct caller) */
  distance: number;

  /** How is this entity impacted? */
  impactDescription: string;

  /** Severity of impact */
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';

  /** Is this a breaking change for this entity? */
  isBreaking: boolean;

  /** Confidence in impact assessment */
  confidence: ConfidenceValue;
}

interface BreakingChange {
  /** Changed entity */
  changedEntity: EntityId;

  /** What changed */
  changeDescription: string;

  /** Why it's breaking */
  breakingReason: string;

  /** Affected entities */
  affectedEntities: EntityId[];

  /** Suggested fix for affected code */
  suggestedFix?: string;

  /** Confidence in breaking change detection */
  confidence: ConfidenceValue;
}

interface CoverageAnalysis {
  /** Changed lines covered by tests */
  coveredLines: number;

  /** Changed lines not covered */
  uncoveredLines: number;

  /** Coverage percentage for changed code */
  coveragePercentage: number;

  /** Tests that cover changed code */
  coveringTests: string[];

  /** High-risk uncovered areas */
  uncoveredRiskAreas: CodeLocation[];

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface TestSuggestion {
  /** What should be tested */
  description: string;

  /** Target entity/functionality */
  target: EntityId;

  /** Test type */
  testType: 'unit' | 'integration' | 'e2e';

  /** Priority */
  priority: 'low' | 'medium' | 'high';

  /** Why this test is suggested */
  rationale: string;

  /** Suggested test skeleton */
  skeleton?: string;
}

interface AffectedTest {
  /** Test identifier */
  testId: string;

  /** Test name */
  name: string;

  /** Test file */
  file: string;

  /** Why this test is affected */
  affectedReason: string;

  /** Should this test be run? */
  shouldRun: boolean;

  /** Might this test fail? */
  failureRisk: 'low' | 'medium' | 'high';
}
```

### tp_intent_infer

```typescript
/**
 * Infer author's intent from changes.
 *
 * INPUT: Diff, commit messages, PR description, linked issues
 * OUTPUT: Classified intent with evidence
 */
export const tp_intent_infer: TechniquePrimitive = {
  id: 'tp_intent_infer',
  name: 'Intent Inferencer',
  description: 'Infer the author intent behind code changes',
  inputs: [
    { name: 'parsedDiff', type: 'ParsedDiff' },
    { name: 'commitMessages', type: 'string[]' },
    { name: 'prDescription', type: 'string', optional: true },
    { name: 'linkedIssues', type: 'IssueInfo[]', optional: true },
  ],
  outputs: [
    { name: 'intentAnalysis', type: 'IntentAnalysis' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3, // Requires LLM for semantic understanding
};

async function inferIntent(
  parsedDiff: ParsedDiff,
  commitMessages: string[],
  prDescription?: string,
  linkedIssues?: IssueInfo[]
): Promise<IntentAnalysis> {
  const evidence: IntentEvidence[] = [];

  // Analyze commit messages
  for (const message of commitMessages) {
    const patterns = detectIntentPatterns(message);
    evidence.push(...patterns.map(p => ({
      source: 'commit_message' as const,
      content: message,
      strength: p.strength
    })));
  }

  // Analyze PR description
  if (prDescription) {
    const prPatterns = detectIntentPatterns(prDescription);
    evidence.push(...prPatterns.map(p => ({
      source: 'pr_description' as const,
      content: prDescription,
      strength: p.strength
    })));
  }

  // Analyze change patterns
  const changePatterns = analyzeChangePatterns(parsedDiff);
  evidence.push(...changePatterns);

  // Analyze file names
  const fileNamePatterns = analyzeFileNames(parsedDiff.files);
  evidence.push(...fileNamePatterns);

  // Classify primary intent
  const classification = classifyIntent(evidence);

  // Link issues
  const linked = linkedIssues?.map(issue => ({
    id: issue.id,
    tracker: issue.tracker,
    title: issue.title,
    type: issue.type,
    confidence: { type: 'deterministic' as const, value: 1.0, reason: 'Explicitly linked' }
  })) ?? [];

  return {
    primaryIntent: classification.primary,
    intentConfidence: classification.confidence,
    secondaryIntents: classification.secondary,
    summary: generateIntentSummary(classification, evidence),
    evidence,
    linkedIssues: linked
  };
}

/**
 * Detect intent patterns in text.
 */
function detectIntentPatterns(text: string): Array<{ intent: IntentType; strength: ConfidenceValue }> {
  const patterns: Array<{ intent: IntentType; strength: ConfidenceValue }> = [];

  const lowerText = text.toLowerCase();

  // Bug fix patterns
  if (/\b(fix|bug|issue|error|crash|broken)\b/i.test(text)) {
    patterns.push({
      intent: 'bug_fix',
      strength: { type: 'bounded', low: 0.6, high: 0.9, basis: 'theoretical', citation: 'Keyword matching' }
    });
  }

  // Feature patterns
  if (/\b(add|implement|feature|new|introduce)\b/i.test(text)) {
    patterns.push({
      intent: 'feature_addition',
      strength: { type: 'bounded', low: 0.5, high: 0.8, basis: 'theoretical', citation: 'Keyword matching' }
    });
  }

  // Refactoring patterns
  if (/\b(refactor|clean|improve|restructure|extract|rename)\b/i.test(text)) {
    patterns.push({
      intent: 'refactoring',
      strength: { type: 'bounded', low: 0.6, high: 0.9, basis: 'theoretical', citation: 'Keyword matching' }
    });
  }

  // Performance patterns
  if (/\b(performance|optimize|speed|fast|slow|cache|memory)\b/i.test(text)) {
    patterns.push({
      intent: 'performance_optimization',
      strength: { type: 'bounded', low: 0.5, high: 0.8, basis: 'theoretical', citation: 'Keyword matching' }
    });
  }

  // Security patterns
  if (/\b(security|vulnerability|cve|xss|injection|auth)\b/i.test(text)) {
    patterns.push({
      intent: 'security_fix',
      strength: { type: 'bounded', low: 0.7, high: 0.95, basis: 'theoretical', citation: 'Keyword matching' }
    });
  }

  return patterns;
}
```

### tp_risk_identify

```typescript
/**
 * Identify risky aspects of changes.
 *
 * INPUT: Parsed diff, impact analysis, domain context
 * OUTPUT: Prioritized list of risk areas
 */
export const tp_risk_identify: TechniquePrimitive = {
  id: 'tp_risk_identify',
  name: 'Risk Identifier',
  description: 'Identify risky aspects of code changes that need careful review',
  inputs: [
    { name: 'parsedDiff', type: 'ParsedDiff' },
    { name: 'impactAnalysis', type: 'ImpactAnalysis' },
    { name: 'domainContext', type: 'DomainContext', optional: true },
  ],
  outputs: [
    { name: 'riskAreas', type: 'RiskArea[]' },
    { name: 'overallRiskLevel', type: 'RiskSeverity' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3, // Requires semantic understanding
};

async function identifyRisks(
  parsedDiff: ParsedDiff,
  impactAnalysis: ImpactAnalysis,
  domainContext?: DomainContext
): Promise<RiskIdentificationResult> {
  const riskAreas: RiskArea[] = [];

  // Check for breaking changes
  for (const breaking of impactAnalysis.breakingChanges) {
    riskAreas.push({
      id: `breaking-${breaking.changedEntity}`,
      category: 'breaking_change',
      severity: impactAnalysis.breakingChanges.length > 5 ? 'critical' : 'high',
      description: breaking.breakingReason,
      affectedEntities: breaking.affectedEntities,
      locations: [], // Would be populated from entity locations
      reviewFocus: ['Verify backward compatibility', 'Check all callers are updated'],
      mitigations: breaking.suggestedFix ? [breaking.suggestedFix] : [],
      confidence: breaking.confidence
    });
  }

  // Check for security-sensitive changes
  const securityRisks = identifySecurityRisks(parsedDiff, domainContext);
  riskAreas.push(...securityRisks);

  // Check for performance-sensitive changes
  const performanceRisks = identifyPerformanceRisks(parsedDiff, domainContext);
  riskAreas.push(...performanceRisks);

  // Check for test coverage gaps
  if (impactAnalysis.testCoverage.coveragePercentage < 0.5) {
    riskAreas.push({
      id: 'low-test-coverage',
      category: 'test_coverage',
      severity: 'high',
      description: `Only ${(impactAnalysis.testCoverage.coveragePercentage * 100).toFixed(0)}% of changed code is covered by tests`,
      affectedEntities: [],
      locations: impactAnalysis.testCoverage.uncoveredRiskAreas,
      reviewFocus: ['Review untested code paths', 'Consider adding tests before merge'],
      mitigations: ['Add unit tests for uncovered functions', 'Add integration tests for critical paths'],
      confidence: impactAnalysis.testCoverage.confidence
    });
  }

  // Check for complexity increases
  const complexityRisks = identifyComplexityRisks(parsedDiff);
  riskAreas.push(...complexityRisks);

  // Calculate overall risk level
  const overallRiskLevel = calculateOverallRisk(riskAreas);

  return {
    riskAreas: riskAreas.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity)),
    overallRiskLevel,
    confidence: { type: 'absent', reason: 'uncalibrated' }
  };
}

function severityOrder(severity: RiskSeverity): number {
  const order = { 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
  return order[severity];
}
```

### tp_review_checklist

```typescript
/**
 * Generate review checklist for change type.
 *
 * INPUT: Intent analysis, risk areas, domain context
 * OUTPUT: Prioritized review checklist
 */
export const tp_review_checklist: TechniquePrimitive = {
  id: 'tp_review_checklist',
  name: 'Review Checklist Generator',
  description: 'Generate a prioritized review checklist based on change type and risks',
  inputs: [
    { name: 'intentAnalysis', type: 'IntentAnalysis' },
    { name: 'riskAreas', type: 'RiskArea[]' },
    { name: 'domainContext', type: 'DomainContext', optional: true },
    { name: 'customRules', type: 'ChecklistRule[]', optional: true },
  ],
  outputs: [
    { name: 'checklist', type: 'ReviewChecklist' },
  ],
  confidence: { type: 'deterministic', value: 1.0, reason: 'Rule-based generation' },
  tier: 1, // Rule-based
};

interface ReviewChecklist {
  /** Checklist identifier */
  id: string;

  /** Change type this checklist is for */
  changeType: IntentType;

  /** Checklist items grouped by category */
  categories: ChecklistCategory[];

  /** Total items */
  totalItems: number;

  /** Priority items (must review) */
  priorityItems: number;

  /** Generation metadata */
  generatedAt: Date;
}

interface ChecklistCategory {
  /** Category name */
  name: string;

  /** Category description */
  description: string;

  /** Priority (higher = review first) */
  priority: number;

  /** Items in this category */
  items: ChecklistItem[];
}

interface ChecklistItem {
  /** Item identifier */
  id: string;

  /** What to check */
  description: string;

  /** Why this matters */
  rationale: string;

  /** Is this a must-check item? */
  required: boolean;

  /** Specific locations to check (if applicable) */
  locations?: CodeLocation[];

  /** Example of what good looks like */
  goodExample?: string;

  /** Example of what bad looks like */
  badExample?: string;
}

/**
 * Base checklists by change type.
 */
const BASE_CHECKLISTS: Record<IntentType, ChecklistCategory[]> = {
  bug_fix: [
    {
      name: 'Root Cause',
      description: 'Verify the fix addresses the actual root cause',
      priority: 10,
      items: [
        {
          id: 'bug-root-cause',
          description: 'Does this fix the root cause or just the symptom?',
          rationale: 'Symptom fixes lead to recurring bugs',
          required: true
        },
        {
          id: 'bug-regression',
          description: 'Are there tests preventing regression?',
          rationale: 'Bugs without regression tests often return',
          required: true
        }
      ]
    },
    {
      name: 'Side Effects',
      description: 'Check for unintended consequences',
      priority: 8,
      items: [
        {
          id: 'bug-side-effects',
          description: 'Could this fix break other functionality?',
          rationale: 'Bug fixes in shared code can have cascading effects',
          required: false
        }
      ]
    }
  ],

  feature_addition: [
    {
      name: 'Requirements',
      description: 'Verify feature meets requirements',
      priority: 10,
      items: [
        {
          id: 'feature-requirements',
          description: 'Does the implementation match the requirements/spec?',
          rationale: 'Misunderstanding requirements wastes effort',
          required: true
        },
        {
          id: 'feature-edge-cases',
          description: 'Are edge cases handled?',
          rationale: 'Edge cases often cause production issues',
          required: true
        }
      ]
    },
    {
      name: 'Testing',
      description: 'Verify adequate test coverage',
      priority: 9,
      items: [
        {
          id: 'feature-tests',
          description: 'Are there unit tests for the new functionality?',
          rationale: 'Untested features break silently',
          required: true
        },
        {
          id: 'feature-integration',
          description: 'Are there integration tests?',
          rationale: 'Unit tests miss integration issues',
          required: false
        }
      ]
    }
  ],

  refactoring: [
    {
      name: 'Behavior Preservation',
      description: 'Verify no behavior changes',
      priority: 10,
      items: [
        {
          id: 'refactor-behavior',
          description: 'Is external behavior unchanged?',
          rationale: 'Refactoring should not change observable behavior',
          required: true
        },
        {
          id: 'refactor-tests-pass',
          description: 'Do all existing tests still pass?',
          rationale: 'Failing tests indicate behavior change',
          required: true
        }
      ]
    },
    {
      name: 'Code Quality',
      description: 'Verify improvement in code quality',
      priority: 7,
      items: [
        {
          id: 'refactor-improvement',
          description: 'Is the code actually better after this change?',
          rationale: 'Refactoring should improve, not just change',
          required: true
        }
      ]
    }
  ],

  security_fix: [
    {
      name: 'Vulnerability',
      description: 'Verify vulnerability is addressed',
      priority: 10,
      items: [
        {
          id: 'security-fixed',
          description: 'Is the vulnerability actually fixed?',
          rationale: 'Incomplete security fixes leave exposure',
          required: true
        },
        {
          id: 'security-cve',
          description: 'Is there a CVE? Is it referenced?',
          rationale: 'CVE tracking helps with compliance',
          required: false
        }
      ]
    },
    {
      name: 'Attack Surface',
      description: 'Check for new vulnerabilities',
      priority: 9,
      items: [
        {
          id: 'security-new-vuln',
          description: 'Does this fix introduce new vulnerabilities?',
          rationale: 'Security fixes sometimes shift the attack surface',
          required: true
        },
        {
          id: 'security-input-validation',
          description: 'Is input validation adequate?',
          rationale: 'Many vulnerabilities stem from inadequate input validation',
          required: true
        }
      ]
    }
  ],

  // ... other intent types would have their checklists
  feature_modification: [],
  performance_optimization: [],
  dependency_update: [],
  test_addition: [],
  test_modification: [],
  documentation: [],
  configuration: [],
  cleanup: [],
  unknown: []
};

function generateChecklist(
  intentAnalysis: IntentAnalysis,
  riskAreas: RiskArea[],
  domainContext?: DomainContext,
  customRules?: ChecklistRule[]
): ReviewChecklist {
  // Start with base checklist for intent type
  const baseCategories = [...(BASE_CHECKLISTS[intentAnalysis.primaryIntent] || [])];

  // Add risk-specific items
  for (const risk of riskAreas) {
    const riskCategory: ChecklistCategory = {
      name: `Risk: ${risk.category}`,
      description: risk.description,
      priority: severityOrder(risk.severity) * 2 + 5,
      items: risk.reviewFocus.map((focus, i) => ({
        id: `risk-${risk.id}-${i}`,
        description: focus,
        rationale: `Identified as ${risk.severity} risk`,
        required: risk.severity === 'critical' || risk.severity === 'high'
      }))
    };
    baseCategories.push(riskCategory);
  }

  // Add domain-specific items
  if (domainContext?.checklistItems) {
    baseCategories.push({
      name: 'Domain-Specific',
      description: 'Domain-specific review items',
      priority: 7,
      items: domainContext.checklistItems
    });
  }

  // Apply custom rules
  if (customRules) {
    for (const rule of customRules) {
      if (rule.condition(intentAnalysis, riskAreas)) {
        baseCategories.push({
          name: rule.categoryName,
          description: rule.description,
          priority: rule.priority,
          items: rule.items
        });
      }
    }
  }

  // Sort by priority
  const sortedCategories = baseCategories.sort((a, b) => b.priority - a.priority);

  return {
    id: `checklist-${Date.now()}`,
    changeType: intentAnalysis.primaryIntent,
    categories: sortedCategories,
    totalItems: sortedCategories.reduce((sum, c) => sum + c.items.length, 0),
    priorityItems: sortedCategories.reduce((sum, c) => sum + c.items.filter(i => i.required).length, 0),
    generatedAt: new Date()
  };
}
```

### tp_review_comment

```typescript
/**
 * Generate review comments for specific issues.
 *
 * INPUT: Risk area or code concern
 * OUTPUT: Formatted review comment
 */
export const tp_review_comment: TechniquePrimitive = {
  id: 'tp_review_comment',
  name: 'Review Comment Generator',
  description: 'Generate helpful review comments for identified issues',
  inputs: [
    { name: 'issue', type: 'ReviewIssue' },
    { name: 'context', type: 'CodeContext' },
    { name: 'tone', type: 'CommentTone', optional: true, default: 'constructive' },
  ],
  outputs: [
    { name: 'comment', type: 'ReviewComment' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3, // LLM-assisted generation
};

interface ReviewIssue {
  /** Issue type */
  type: 'risk' | 'question' | 'suggestion' | 'nitpick' | 'blocker';

  /** Issue description */
  description: string;

  /** Code location */
  location: CodeLocation;

  /** Severity */
  severity: 'info' | 'warning' | 'error';

  /** Suggested fix (if any) */
  suggestedFix?: string;
}

type CommentTone = 'constructive' | 'direct' | 'questioning';

interface ReviewComment {
  /** Comment body */
  body: string;

  /** Code location */
  location: CodeLocation;

  /** Comment type label */
  label?: string;

  /** Is this a blocking comment? */
  blocking: boolean;

  /** Suggested code change (for suggestion comments) */
  suggestion?: string;
}
```

---

## 4. Review Compositions

### tc_comprehensive_review

```typescript
/**
 * Full code review workflow.
 *
 * COMPOSITION: Combines all review primitives for complete review context.
 */
export const tc_comprehensive_review: TechniqueComposition = {
  id: 'tc_comprehensive_review',
  name: 'Comprehensive Code Review',
  description: 'Full code review workflow with diff parsing, context assembly, impact analysis, and checklist generation',
  primitives: [
    'tp_diff_parse',
    'tp_change_context',
    'tp_impact_analyze',
    'tp_intent_infer',
    'tp_risk_identify',
    'tp_review_checklist',
  ],
  inputs: [
    { name: 'diff', type: 'string | GitRefs' },
    { name: 'repoPath', type: 'string' },
    { name: 'knowledgeBase', type: 'KnowledgeBase' },
    { name: 'commitMessages', type: 'string[]' },
    { name: 'prDescription', type: 'string', optional: true },
    { name: 'linkedIssues', type: 'IssueInfo[]', optional: true },
  ],
  outputs: [
    { name: 'reviewContext', type: 'ComprehensiveReviewContext' },
    { name: 'checklist', type: 'ReviewChecklist' },
    { name: 'suggestedComments', type: 'ReviewComment[]' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

interface ComprehensiveReviewContext {
  /** Diff context with all assembled information */
  diffContext: DiffContext;

  /** Impact analysis */
  impactAnalysis: ImpactAnalysis;

  /** Intent analysis */
  intentAnalysis: IntentAnalysis;

  /** Identified risks */
  riskAreas: RiskArea[];

  /** Review checklist */
  checklist: ReviewChecklist;

  /** Suggested review comments */
  suggestedComments: ReviewComment[];

  /** Review summary */
  summary: ReviewSummary;

  /** Overall confidence */
  confidence: ConfidenceValue;
}

interface ReviewSummary {
  /** One-line summary */
  oneLiner: string;

  /** Key points to focus on */
  keyPoints: string[];

  /** Estimated review time */
  estimatedReviewTime: string;

  /** Complexity rating */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

  /** Recommendation */
  recommendation: 'approve' | 'request_changes' | 'needs_discussion';
}
```

### tc_security_review

```typescript
/**
 * Security-focused code review.
 *
 * COMPOSITION: Review workflow with security emphasis.
 */
export const tc_security_review: TechniqueComposition = {
  id: 'tc_security_review',
  name: 'Security Code Review',
  description: 'Security-focused code review with vulnerability scanning and threat modeling',
  primitives: [
    'tp_diff_parse',
    'tp_change_context',
    'tp_impact_analyze',
    'tp_risk_identify',
    'tp_security_scan',      // Security-specific primitive
    'tp_threat_model',       // From track-e-domain
    'tp_review_checklist',
  ],
  inputs: [
    { name: 'diff', type: 'string | GitRefs' },
    { name: 'repoPath', type: 'string' },
    { name: 'knowledgeBase', type: 'KnowledgeBase' },
    { name: 'securityContext', type: 'SecurityContext', optional: true },
  ],
  outputs: [
    { name: 'securityReview', type: 'SecurityReviewResult' },
    { name: 'vulnerabilities', type: 'Vulnerability[]' },
    { name: 'threatModel', type: 'ThreatModel' },
    { name: 'securityChecklist', type: 'ReviewChecklist' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

interface SecurityReviewResult {
  /** Security-specific diff context */
  diffContext: DiffContext;

  /** Identified vulnerabilities */
  vulnerabilities: Vulnerability[];

  /** Threat model for changes */
  threatModel: ThreatModel;

  /** Security-focused checklist */
  checklist: ReviewChecklist;

  /** OWASP categories affected */
  owaspCategories: string[];

  /** Security rating */
  securityRating: 'secure' | 'low_risk' | 'medium_risk' | 'high_risk' | 'critical_risk';

  /** Confidence in security assessment */
  confidence: ConfidenceValue;
}

interface Vulnerability {
  /** Vulnerability identifier */
  id: string;

  /** CWE identifier (if applicable) */
  cweId?: string;

  /** Vulnerability type */
  type: string;

  /** Description */
  description: string;

  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Affected code location */
  location: CodeLocation;

  /** Evidence */
  evidence: string;

  /** Suggested remediation */
  remediation: string;

  /** Detection confidence */
  confidence: ConfidenceValue;
}

interface ThreatModel {
  /** Assets affected by changes */
  assets: string[];

  /** Threat actors */
  threatActors: string[];

  /** Attack vectors introduced/modified */
  attackVectors: AttackVector[];

  /** Security controls affected */
  affectedControls: string[];

  /** Model confidence */
  confidence: ConfidenceValue;
}

interface AttackVector {
  /** Vector name */
  name: string;

  /** Description */
  description: string;

  /** Likelihood */
  likelihood: 'low' | 'medium' | 'high';

  /** Impact */
  impact: 'low' | 'medium' | 'high' | 'critical';

  /** Mitigations in place */
  mitigations: string[];
}
```

### tc_performance_review

```typescript
/**
 * Performance-focused code review.
 *
 * COMPOSITION: Review workflow with performance emphasis.
 */
export const tc_performance_review: TechniqueComposition = {
  id: 'tc_performance_review',
  name: 'Performance Code Review',
  description: 'Performance-focused code review with complexity analysis and hotspot detection',
  primitives: [
    'tp_diff_parse',
    'tp_change_context',
    'tp_impact_analyze',
    'tp_risk_identify',
    'tp_complexity_analyze',  // Performance-specific primitive
    'tp_hotspot_detect',      // Performance-specific primitive
    'tp_review_checklist',
  ],
  inputs: [
    { name: 'diff', type: 'string | GitRefs' },
    { name: 'repoPath', type: 'string' },
    { name: 'knowledgeBase', type: 'KnowledgeBase' },
    { name: 'performanceBaseline', type: 'PerformanceBaseline', optional: true },
  ],
  outputs: [
    { name: 'performanceReview', type: 'PerformanceReviewResult' },
    { name: 'complexityChanges', type: 'ComplexityChange[]' },
    { name: 'hotspots', type: 'PerformanceHotspot[]' },
    { name: 'performanceChecklist', type: 'ReviewChecklist' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

interface PerformanceReviewResult {
  /** Performance-specific diff context */
  diffContext: DiffContext;

  /** Complexity changes */
  complexityChanges: ComplexityChange[];

  /** Performance hotspots */
  hotspots: PerformanceHotspot[];

  /** Performance-focused checklist */
  checklist: ReviewChecklist;

  /** Big-O changes */
  bigOChanges: BigOChange[];

  /** Performance rating */
  performanceRating: 'improved' | 'unchanged' | 'minor_regression' | 'major_regression';

  /** Confidence in performance assessment */
  confidence: ConfidenceValue;
}

interface ComplexityChange {
  /** Entity affected */
  entityId: EntityId;

  /** Old cyclomatic complexity */
  oldComplexity?: number;

  /** New cyclomatic complexity */
  newComplexity: number;

  /** Change direction */
  direction: 'increased' | 'decreased' | 'unchanged' | 'new';

  /** Is this concerning? */
  concerning: boolean;

  /** Location */
  location: CodeLocation;
}

interface PerformanceHotspot {
  /** Hotspot identifier */
  id: string;

  /** Description */
  description: string;

  /** Location */
  location: CodeLocation;

  /** Hotspot type */
  type: 'loop' | 'recursion' | 'io' | 'memory' | 'network' | 'database';

  /** Severity */
  severity: 'info' | 'warning' | 'critical';

  /** Suggestion */
  suggestion?: string;
}

interface BigOChange {
  /** Entity affected */
  entityId: EntityId;

  /** Old complexity */
  oldBigO?: string;

  /** New complexity */
  newBigO: string;

  /** Is this a regression? */
  isRegression: boolean;

  /** Explanation */
  explanation: string;
}
```

### tc_api_review

```typescript
/**
 * API change review.
 *
 * COMPOSITION: Review workflow for API changes with backward compatibility analysis.
 */
export const tc_api_review: TechniqueComposition = {
  id: 'tc_api_review',
  name: 'API Change Review',
  description: 'API-focused code review with backward compatibility and contract analysis',
  primitives: [
    'tp_diff_parse',
    'tp_change_context',
    'tp_impact_analyze',
    'tp_api_contract_check',  // API-specific primitive
    'tp_backward_compat',     // API-specific primitive
    'tp_review_checklist',
  ],
  inputs: [
    { name: 'diff', type: 'string | GitRefs' },
    { name: 'repoPath', type: 'string' },
    { name: 'knowledgeBase', type: 'KnowledgeBase' },
    { name: 'apiSpec', type: 'APISpecification', optional: true },
  ],
  outputs: [
    { name: 'apiReview', type: 'APIReviewResult' },
    { name: 'breakingChanges', type: 'APIBreakingChange[]' },
    { name: 'contractViolations', type: 'ContractViolation[]' },
    { name: 'apiChecklist', type: 'ReviewChecklist' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

interface APIReviewResult {
  /** API-specific diff context */
  diffContext: DiffContext;

  /** Breaking changes */
  breakingChanges: APIBreakingChange[];

  /** Contract violations */
  contractViolations: ContractViolation[];

  /** API-focused checklist */
  checklist: ReviewChecklist;

  /** Versioning recommendation */
  versioningRecommendation: VersioningRecommendation;

  /** API stability rating */
  stabilityRating: 'stable' | 'minor_change' | 'breaking' | 'major_breaking';

  /** Confidence in API assessment */
  confidence: ConfidenceValue;
}

interface APIBreakingChange {
  /** Change identifier */
  id: string;

  /** Endpoint or function affected */
  endpoint: string;

  /** Change type */
  changeType: 'removed' | 'signature_changed' | 'behavior_changed' | 'type_changed';

  /** Description */
  description: string;

  /** Affected consumers (if known) */
  affectedConsumers: string[];

  /** Migration path */
  migrationPath?: string;

  /** Location */
  location: CodeLocation;

  /** Confidence */
  confidence: ConfidenceValue;
}

interface ContractViolation {
  /** Violation identifier */
  id: string;

  /** Contract type */
  contractType: 'openapi' | 'graphql' | 'grpc' | 'typescript' | 'json_schema';

  /** Violation description */
  description: string;

  /** Severity */
  severity: 'error' | 'warning';

  /** Location */
  location: CodeLocation;

  /** How to fix */
  fix?: string;
}

interface VersioningRecommendation {
  /** Recommended version bump */
  bump: 'patch' | 'minor' | 'major';

  /** Rationale */
  rationale: string;

  /** Current version (if known) */
  currentVersion?: string;

  /** Recommended new version */
  recommendedVersion?: string;
}
```

---

## 5. Review Checklists

### Per-Change-Type Checklists

The system maintains base checklists for each change type (see `tp_review_checklist`). These are augmented by:

1. **Risk-based items**: Added automatically based on identified risks
2. **Domain-specific items**: Added based on domain context (security, performance, etc.)
3. **Custom rules**: Organization-specific review requirements

### Domain-Specific Checklists

```typescript
/**
 * Domain-specific checklist extensions.
 */
interface DomainChecklistConfig {
  /** Security domain checklist items */
  security: ChecklistCategory[];

  /** Performance domain checklist items */
  performance: ChecklistCategory[];

  /** API domain checklist items */
  api: ChecklistCategory[];

  /** Data handling checklist items */
  data: ChecklistCategory[];

  /** Accessibility checklist items */
  accessibility: ChecklistCategory[];
}

const SECURITY_CHECKLIST: ChecklistCategory[] = [
  {
    name: 'Authentication & Authorization',
    description: 'Check auth-related changes',
    priority: 10,
    items: [
      {
        id: 'sec-auth-bypass',
        description: 'Could this change allow auth bypass?',
        rationale: 'Auth bypass is a critical vulnerability',
        required: true
      },
      {
        id: 'sec-authz-check',
        description: 'Are authorization checks in place?',
        rationale: 'Missing authz leads to privilege escalation',
        required: true
      }
    ]
  },
  {
    name: 'Input Validation',
    description: 'Check input handling',
    priority: 9,
    items: [
      {
        id: 'sec-input-validation',
        description: 'Is all user input validated?',
        rationale: 'Unvalidated input leads to injection attacks',
        required: true
      },
      {
        id: 'sec-output-encoding',
        description: 'Is output properly encoded?',
        rationale: 'Prevents XSS and injection',
        required: true
      }
    ]
  },
  {
    name: 'Data Protection',
    description: 'Check data handling',
    priority: 8,
    items: [
      {
        id: 'sec-sensitive-data',
        description: 'Is sensitive data properly protected?',
        rationale: 'Exposed sensitive data is a breach',
        required: true
      },
      {
        id: 'sec-logging',
        description: 'Are sensitive values excluded from logs?',
        rationale: 'Logs are often exposed',
        required: false
      }
    ]
  }
];

const PERFORMANCE_CHECKLIST: ChecklistCategory[] = [
  {
    name: 'Algorithmic Efficiency',
    description: 'Check algorithmic complexity',
    priority: 9,
    items: [
      {
        id: 'perf-big-o',
        description: 'Is the algorithmic complexity appropriate?',
        rationale: 'Poor algorithms cause scaling issues',
        required: true
      },
      {
        id: 'perf-n-plus-one',
        description: 'Are there N+1 query patterns?',
        rationale: 'N+1 queries devastate database performance',
        required: true
      }
    ]
  },
  {
    name: 'Resource Usage',
    description: 'Check resource consumption',
    priority: 8,
    items: [
      {
        id: 'perf-memory',
        description: 'Is memory usage bounded?',
        rationale: 'Unbounded memory leads to OOM crashes',
        required: false
      },
      {
        id: 'perf-connections',
        description: 'Are connections properly pooled/closed?',
        rationale: 'Connection leaks cause resource exhaustion',
        required: true
      }
    ]
  }
];

const API_CHECKLIST: ChecklistCategory[] = [
  {
    name: 'Backward Compatibility',
    description: 'Check API compatibility',
    priority: 10,
    items: [
      {
        id: 'api-breaking',
        description: 'Is this a breaking change?',
        rationale: 'Breaking changes require major version bump',
        required: true
      },
      {
        id: 'api-deprecation',
        description: 'Are deprecated features marked appropriately?',
        rationale: 'Sudden removal breaks consumers',
        required: false
      }
    ]
  },
  {
    name: 'Documentation',
    description: 'Check API documentation',
    priority: 7,
    items: [
      {
        id: 'api-docs-updated',
        description: 'Is API documentation updated?',
        rationale: 'Outdated docs cause consumer confusion',
        required: true
      },
      {
        id: 'api-examples',
        description: 'Are there usage examples?',
        rationale: 'Examples improve API adoption',
        required: false
      }
    ]
  }
];
```

### Custom Checklist Configuration

```typescript
/**
 * Custom checklist rules that organizations can define.
 */
interface ChecklistRule {
  /** Rule identifier */
  id: string;

  /** Condition for applying this rule */
  condition: (intent: IntentAnalysis, risks: RiskArea[]) => boolean;

  /** Category name */
  categoryName: string;

  /** Category description */
  description: string;

  /** Priority */
  priority: number;

  /** Items to add */
  items: ChecklistItem[];
}

/**
 * Example custom rules.
 */
const EXAMPLE_CUSTOM_RULES: ChecklistRule[] = [
  {
    id: 'payment-changes',
    condition: (intent, risks) => {
      // Apply when changes touch payment-related files
      return risks.some(r => r.description.toLowerCase().includes('payment'));
    },
    categoryName: 'Payment System',
    description: 'Extra checks for payment-related changes',
    priority: 10,
    items: [
      {
        id: 'payment-idempotency',
        description: 'Is the operation idempotent?',
        rationale: 'Non-idempotent payment operations cause double-charging',
        required: true
      },
      {
        id: 'payment-audit-log',
        description: 'Are all payment operations logged for audit?',
        rationale: 'Payment audit trails are required for compliance',
        required: true
      }
    ]
  },
  {
    id: 'database-migrations',
    condition: (intent, risks) => {
      return intent.primaryIntent === 'feature_addition' &&
             risks.some(r => r.category === 'data_integrity');
    },
    categoryName: 'Database Migration',
    description: 'Checks for database schema changes',
    priority: 9,
    items: [
      {
        id: 'db-rollback',
        description: 'Is there a rollback migration?',
        rationale: 'Rollback migrations enable safe deployments',
        required: true
      },
      {
        id: 'db-zero-downtime',
        description: 'Is this a zero-downtime migration?',
        rationale: 'Blocking migrations cause outages',
        required: false
      }
    ]
  }
];
```

---

## 6. Integration Points

### Integration with track-i-multi-repo.md

```typescript
/**
 * Cross-repo review capabilities.
 *
 * When changes span multiple repositories, review must consider
 * cross-repo impacts and coordination requirements.
 */
interface CrossRepoReviewIntegration {
  /**
   * Analyze cross-repo impact of changes.
   */
  analyzeCrossRepoImpact(
    diff: ParsedDiff,
    federation: MultiRepoIndex
  ): Promise<CrossRepoImpactAnalysis>;

  /**
   * Generate coordinated review checklist.
   */
  generateCrossRepoChecklist(
    impact: CrossRepoImpactAnalysis
  ): Promise<CrossRepoReviewChecklist>;

  /**
   * Find affected repos.
   */
  findAffectedRepos(
    changedEntities: EntityId[],
    federation: MultiRepoIndex
  ): Promise<AffectedRepo[]>;
}

interface CrossRepoImpactAnalysis {
  /** Source repo of changes */
  sourceRepo: RepoId;

  /** Repos affected by changes */
  affectedRepos: AffectedRepo[];

  /** Cross-repo breaking changes */
  crossRepoBreakingChanges: CrossRepoBreakingChange[];

  /** Recommended coordination */
  coordinationPlan: CoordinationPlan;

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface CrossRepoBreakingChange {
  /** Change in source repo */
  sourceChange: BreakingChange;

  /** Affected entities in other repos */
  affectedEntities: Array<{
    repoId: RepoId;
    entityId: EntityId;
    impact: string;
  }>;

  /** Required coordinated changes */
  requiredChanges: CoordinatedChange[];
}

interface CoordinationPlan {
  /** Order of repo updates */
  updateOrder: RepoId[];

  /** Blocking dependencies */
  blockingDependencies: Array<{
    blocked: RepoId;
    blockedBy: RepoId;
    reason: string;
  }>;

  /** Suggested PR strategy */
  prStrategy: 'single_pr' | 'stacked_prs' | 'coordinated_merge';
}

interface CrossRepoReviewChecklist extends ReviewChecklist {
  /** Per-repo checklists */
  repoChecklists: Map<RepoId, ReviewChecklist>;

  /** Cross-repo coordination items */
  coordinationItems: ChecklistItem[];
}
```

### Integration with track-c-causal-reasoning.md

```typescript
/**
 * Causal reasoning for change impact.
 *
 * Uses causal models to understand the true impact of changes,
 * not just structural dependencies.
 */
interface CausalReviewIntegration {
  /**
   * Build causal model for changed code.
   */
  buildChangesCausalModel(
    changedEntities: EntityId[],
    knowledgeBase: KnowledgeBase
  ): Promise<CausalModel>;

  /**
   * Analyze causal impact of changes.
   */
  analyzeCausalImpact(
    model: CausalModel,
    changes: ChangeDetail[]
  ): Promise<CausalImpactAnalysis>;

  /**
   * Answer counterfactual questions about changes.
   */
  whatIfAnalysis(
    model: CausalModel,
    hypothetical: string
  ): Promise<CounterfactualResult>;
}

interface CausalImpactAnalysis {
  /** Direct causal effects */
  directEffects: CausalEffect[];

  /** Indirect/transitive effects */
  indirectEffects: CausalEffect[];

  /** Potential side effects */
  sideEffects: CausalEffect[];

  /** Causal paths from changes to impacts */
  causalPaths: CausalPath[];

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface CausalEffect {
  /** Affected entity */
  entityId: EntityId;

  /** Effect description */
  description: string;

  /** Effect probability */
  probability: ConfidenceValue;

  /** Effect severity if it occurs */
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';

  /** Causal mechanism */
  mechanism: string;
}
```

### Integration with track-e-domain.md

```typescript
/**
 * Domain-specific review capabilities.
 *
 * Leverages domain knowledge for more accurate review context.
 */
interface DomainReviewIntegration {
  /**
   * Get domain context for changes.
   */
  getDomainContext(
    changedEntities: EntityId[],
    knowledgeBase: KnowledgeBase
  ): Promise<DomainContext>;

  /**
   * Get domain-specific risks.
   */
  getDomainRisks(
    changes: ParsedDiff,
    domain: DomainContext
  ): Promise<RiskArea[]>;

  /**
   * Get domain-specific checklist.
   */
  getDomainChecklist(
    domain: DomainContext,
    changeType: IntentType
  ): Promise<ChecklistCategory[]>;
}

interface DomainContext {
  /** Identified domain */
  domain: string;

  /** Domain-specific concepts in changes */
  concepts: DomainConcept[];

  /** Domain rules that apply */
  applicableRules: DomainRule[];

  /** Domain checklist items */
  checklistItems: ChecklistItem[];

  /** Domain experts to consult */
  experts?: string[];

  /** Context confidence */
  confidence: ConfidenceValue;
}

interface DomainConcept {
  /** Concept name */
  name: string;

  /** Concept description */
  description: string;

  /** Entities implementing this concept */
  entities: EntityId[];

  /** Importance in domain */
  importance: 'core' | 'supporting' | 'peripheral';
}

interface DomainRule {
  /** Rule identifier */
  id: string;

  /** Rule description */
  description: string;

  /** Rule category */
  category: string;

  /** Severity of violation */
  violationSeverity: RiskSeverity;

  /** How to check this rule */
  checkMethod: 'automated' | 'manual' | 'llm_assisted';
}
```

---

## 7. Implementation Roadmap

### Phase 1: Core Types and Diff Parsing (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/types.ts
// - src/librarian/api/review/diff_parser.ts

// Deliverables:
// - All type definitions from this spec
// - tp_diff_parse implementation
// - Git diff extraction utilities
// - AST-based change detection
```

**Estimated effort**: 2 days

### Phase 2: Context Assembly (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/context.ts

// Deliverables:
// - tp_change_context implementation
// - Context pack assembly
// - Related entity discovery
// - Domain concept extraction
```

**Estimated effort**: 2 days

### Phase 3: Impact Analysis (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/impact.ts

// Deliverables:
// - tp_impact_analyze implementation
// - Dependency traversal
// - Breaking change detection
// - Test coverage analysis
```

**Estimated effort**: 2 days

### Phase 4: Intent and Risk (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/intent.ts
// - src/librarian/api/review/risk.ts

// Deliverables:
// - tp_intent_infer implementation
// - tp_risk_identify implementation
// - Pattern matching for intent
// - Risk classification
```

**Estimated effort**: 2 days

### Phase 5: Checklists and Comments (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/checklist.ts
// - src/librarian/api/review/comments.ts

// Deliverables:
// - tp_review_checklist implementation
// - tp_review_comment implementation
// - Base checklist definitions
// - Domain-specific checklists
```

**Estimated effort**: 2 days

### Phase 6: Compositions (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/compositions.ts

// Deliverables:
// - tc_comprehensive_review implementation
// - tc_security_review implementation
// - tc_performance_review implementation
// - tc_api_review implementation
```

**Estimated effort**: 2 days

### Phase 7: Integration and Testing (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/review/__tests__/diff_parser.test.ts
// - src/librarian/api/review/__tests__/impact.test.ts
// - src/librarian/api/review/__tests__/compositions.test.ts

// Deliverables:
// - Integration with track-i (multi-repo)
// - Integration with track-c (causal)
// - Integration with track-e (domain)
// - Comprehensive tests
```

**Estimated effort**: 3 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types & Diff Parsing | 200 | 2 |
| Context Assembly | 150 | 2 |
| Impact Analysis | 200 | 2 |
| Intent and Risk | 200 | 2 |
| Checklists and Comments | 150 | 2 |
| Compositions | 200 | 2 |
| Integration & Testing | 200 | 3 |
| **Total** | **~1,300** | **~15** |

---

## 8. Acceptance Criteria

### Diff Parsing

- [ ] Can parse unified diff format
- [ ] Can extract from git refs
- [ ] Correctly identifies changed functions
- [ ] Correctly identifies changed types
- [ ] Correctly identifies import changes
- [ ] Handles renamed/moved files

### Context Assembly

- [ ] Assembles context for all changed entities
- [ ] Includes direct dependencies
- [ ] Includes direct dependents
- [ ] Respects context budget
- [ ] Extracts domain concepts

### Impact Analysis

- [ ] Identifies all affected entities
- [ ] Calculates transitive impact
- [ ] Detects breaking changes
- [ ] Analyzes test coverage
- [ ] Suggests additional tests

### Intent Inference

- [ ] Classifies primary intent correctly
- [ ] Identifies secondary intents
- [ ] Links to issues when available
- [ ] Provides evidence for classification

### Risk Identification

- [ ] Identifies breaking change risks
- [ ] Identifies security risks
- [ ] Identifies performance risks
- [ ] Identifies test coverage gaps
- [ ] Calculates overall risk level

### Checklists

- [ ] Generates change-type-specific checklists
- [ ] Adds risk-based items
- [ ] Supports domain-specific items
- [ ] Supports custom rules

### Confidence

- [ ] All confidence values use `ConfidenceValue` type
- [ ] Primitives use `absent` confidence until calibrated
- [ ] Deterministic operations use `deterministic` confidence
- [ ] No raw numeric confidence values

---

## 9. Evidence Commands

```bash
# Run review tests
cd packages/librarian && npx vitest run src/api/review/__tests__/

# Verify exports
node -e "import('librarian').then(m => console.log(Object.keys(m).filter(k => k.includes('Review') || k.includes('Diff'))))"

# Parse a diff (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts review-diff --base main --head feature-branch

# Get comprehensive review context (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts review --pr 123

# Generate review checklist (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts review-checklist --diff /path/to/diff

# Check implementation status
ls -la packages/librarian/src/api/review/
```

---

## 10. References

- Rigby, P. C., & Bird, C. (2013). *Convergent contemporary software peer review practices*. ACM FSE.
- McIntosh, S., Kamei, Y., Adams, B., & Hassan, A. E. (2014). *The impact of code review coverage and code review participation on software quality*. MSR.
- Bacchelli, A., & Bird, C. (2013). *Expectations, outcomes, and challenges of modern code review*. ICSE.
- Czerwonka, J., Greiler, M., & Tilford, J. (2015). *Code reviews do not find bugs: How the current code review best practice slows us down*. ICSE.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification for UC6: Code Review |
