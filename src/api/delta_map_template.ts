/**
 * @fileoverview T2 DeltaMap Template Implementation
 *
 * WU-TMPL-002: T2 DeltaMap Template
 *
 * Provides git-based change tracking, component mapping, and impact visualization.
 * This template answers the question: "What changed since X and why does it matter?"
 *
 * Key capabilities:
 * - Track git-based changes (diffs, commits)
 * - Map changes to affected components
 * - Visualize change impact
 * - Support temporal navigation of changes
 *
 * @packageDocumentation
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import type { ContextPack } from '../types.js';
import type {
  ConstructionTemplate,
  TemplateContext,
  TemplateResult,
  TemplateSelectionEvidence,
} from './template_registry.js';
import { deterministic, sequenceConfidence, getEffectiveConfidence, type ConfidenceValue } from '../epistemics/confidence.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for DeltaMap template execution.
 */
export interface DeltaMapInput {
  /** Path to the git repository */
  repoPath: string;
  /** Base reference (e.g., 'main', 'HEAD~1', commit SHA) */
  baseRef: string;
  /** Target reference (e.g., 'HEAD', branch name) */
  targetRef: string;
  /** Glob patterns to include (optional) */
  includePatterns?: string[];
  /** Glob patterns to exclude (optional) */
  excludePatterns?: string[];
}

/**
 * A single hunk within a diff.
 */
export interface DiffHunk {
  /** Starting line number in the target file */
  startLine: number;
  /** Ending line number in the target file */
  endLine: number;
  /** Content of the hunk */
  content: string;
  /** Type of change */
  type: 'add' | 'remove' | 'context';
}

/**
 * Represents changes to a single file.
 */
export interface FileDelta {
  /** File path relative to repository root */
  path: string;
  /** Type of change */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Number of added lines */
  additions: number;
  /** Number of deleted lines */
  deletions: number;
  /** Individual diff hunks */
  hunks: DiffHunk[];
}

/**
 * Output from DeltaMap template execution.
 */
export interface DeltaMapOutput {
  /** Base reference used */
  baseRef: string;
  /** Target reference used */
  targetRef: string;
  /** Total number of changed files */
  totalFiles: number;
  /** Total added lines across all files */
  totalAdditions: number;
  /** Total deleted lines across all files */
  totalDeletions: number;
  /** Individual file deltas */
  deltas: FileDelta[];
  /** Components affected by changes */
  affectedComponents: string[];
  /** Overall risk assessment */
  riskAssessment: 'low' | 'medium' | 'high';
  /** Confidence in the analysis */
  confidence: ConfidenceValue;
}

/**
 * DeltaMap template type alias.
 */
export type DeltaMapTemplate = ConstructionTemplate;

// ============================================================================
// GIT REF VALIDATION
// ============================================================================

/**
 * Dangerous patterns that could indicate shell injection.
 */
const DANGEROUS_PATTERNS = [
  /[;|&$`]/,           // Shell operators
  /\$\(/,              // Command substitution
  /\$\{/,              // Variable expansion
  /`/,                 // Backticks
  /[\n\r]/,            // Newlines
];

/**
 * Valid git ref pattern.
 * Allows: branch names, tags, SHAs, HEAD, HEAD~N, HEAD^, etc.
 */
const VALID_REF_PATTERN = /^[a-zA-Z0-9_\-./^~]+$/;

/**
 * Normalize and validate a git reference.
 *
 * @param ref - The git reference to normalize
 * @returns The normalized reference
 * @throws Error if the reference contains dangerous patterns
 */
export function normalizeGitRef(ref: string): string {
  const trimmed = ref.trim();

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`Invalid git ref: contains dangerous pattern: ${ref}`);
    }
  }

  // Validate against allowed pattern
  if (!VALID_REF_PATTERN.test(trimmed)) {
    throw new Error(`Invalid git ref: does not match allowed pattern: ${ref}`);
  }

  return trimmed;
}

// ============================================================================
// DIFF PARSING
// ============================================================================

/**
 * Parse git diff output into structured FileDelta objects.
 *
 * @param diffOutput - Raw output from git diff
 * @returns Array of parsed file deltas
 */
export function parseDiffOutput(diffOutput: string): FileDelta[] {
  if (!diffOutput || diffOutput.trim() === '') {
    return [];
  }

  const deltas: FileDelta[] = [];

  // Split by diff headers
  const diffBlocks = diffOutput.split(/(?=diff --git )/);

  for (const block of diffBlocks) {
    if (!block.trim() || !block.startsWith('diff --git')) {
      continue;
    }

    const delta = parseFileDelta(block);
    deltas.push(delta);
  }

  return deltas;
}

/**
 * Parse a single file's diff block into a FileDelta.
 *
 * @param diffBlock - A single file's diff block
 * @returns Parsed FileDelta
 */
export function parseFileDelta(diffBlock: string): FileDelta {
  const lines = diffBlock.split('\n');

  // Extract file path from diff header
  // Handle both quoted and unquoted paths
  let filePath = '';

  // Try quoted path format first: diff --git "a/path" "b/path"
  const quotedMatch = lines[0].match(/diff --git "a\/(.+?)" "b\/(.+?)"/);
  if (quotedMatch) {
    filePath = quotedMatch[2];
  } else {
    // Unquoted format: diff --git a/path b/path
    const headerMatch = lines[0].match(/diff --git a\/(.+?) b\/(.+)/);
    if (headerMatch) {
      filePath = headerMatch[2];
    }
  }

  // Determine status
  let status: FileDelta['status'] = 'modified';
  if (diffBlock.includes('new file mode')) {
    status = 'added';
  } else if (diffBlock.includes('deleted file mode')) {
    status = 'deleted';
  } else if (diffBlock.includes('rename from') || diffBlock.includes('similarity index')) {
    status = 'renamed';
  }

  // Check for binary file
  const isBinary = diffBlock.includes('Binary files');

  // Count additions and deletions
  let additions = 0;
  let deletions = 0;

  if (!isBinary) {
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }
  }

  // Parse hunks
  const hunks: DiffHunk[] = [];

  if (!isBinary) {
    const hunkRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
    let currentHunk: DiffHunk | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      const hunkMatch = line.match(hunkRegex);
      if (hunkMatch) {
        // Save previous hunk
        if (currentHunk) {
          currentHunk.content = currentContent.join('\n');
          hunks.push(currentHunk);
        }

        // Start new hunk
        const startLine = parseInt(hunkMatch[2], 10);
        currentHunk = {
          startLine,
          endLine: startLine, // Will be updated
          content: '',
          type: 'context',
        };
        currentContent = [line];
      } else if (currentHunk) {
        currentContent.push(line);

        // Update hunk type and end line
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.type = 'add';
          currentHunk.endLine++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          if (currentHunk.type !== 'add') {
            currentHunk.type = 'remove';
          }
        } else if (!line.startsWith('\\')) {
          currentHunk.endLine++;
        }
      }
    }

    // Save final hunk
    if (currentHunk) {
      currentHunk.content = currentContent.join('\n');
      hunks.push(currentHunk);
    }
  }

  return {
    path: filePath,
    status,
    additions,
    deletions,
    hunks,
  };
}

// ============================================================================
// COMPONENT MAPPING
// ============================================================================

/**
 * Identify affected components from file deltas.
 *
 * Components are determined by directory structure.
 *
 * @param deltas - Array of file deltas
 * @returns Array of unique affected component paths
 */
export function identifyAffectedComponents(deltas: FileDelta[]): string[] {
  const components = new Set<string>();

  for (const delta of deltas) {
    const dir = path.dirname(delta.path);
    // Use '.' for root-level files
    components.add(dir === '.' || dir === '' ? '.' : dir);
  }

  return Array.from(components).sort();
}

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

/**
 * High-risk file patterns that increase change risk.
 */
const HIGH_RISK_PATTERNS = [
  /auth/i,
  /security/i,
  /credentials/i,
  /secrets/i,
  /config/i,
  /database/i,
  /migration/i,
  /\.env/,
];

/**
 * Compute risk assessment based on change characteristics.
 *
 * @param deltas - File deltas
 * @param components - Affected components
 * @returns Risk level
 */
export function computeRiskAssessment(
  deltas: FileDelta[],
  components: string[]
): 'low' | 'medium' | 'high' {
  // Calculate risk factors
  let riskScore = 0;

  // Factor 1: Number of files changed
  const fileCount = deltas.length;
  if (fileCount > 15) {
    riskScore += 3;
  } else if (fileCount > 3) {
    riskScore += 1;
  }

  // Factor 2: Total lines changed
  const totalChanges = deltas.reduce(
    (sum, d) => sum + d.additions + d.deletions,
    0
  );
  if (totalChanges > 500) {
    riskScore += 3;
  } else if (totalChanges > 50) {
    riskScore += 1;
  }

  // Factor 3: Number of components affected
  if (components.length > 5) {
    riskScore += 2;
  } else if (components.length > 1) {
    riskScore += 1;
  }

  // Factor 4: Deletions (breaking changes)
  const hasDeleted = deltas.some((d) => d.status === 'deleted');
  if (hasDeleted) {
    riskScore += 3;
  }

  // Factor 5: High-risk file patterns
  for (const delta of deltas) {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(delta.path)) {
        riskScore += 3;
        break; // Only count once per file
      }
    }
  }

  // Map score to risk level
  if (riskScore >= 5) {
    return 'high';
  } else if (riskScore >= 2) {
    return 'medium';
  }
  return 'low';
}

// ============================================================================
// GIT COMMAND EXECUTION
// ============================================================================

/**
 * Execute git diff command with the given input parameters.
 *
 * @param input - DeltaMap input parameters
 * @returns Raw diff output
 * @throws Error if git command fails
 */
export function executeGitDiff(input: DeltaMapInput): string {
  // Validate and normalize refs
  const baseRef = normalizeGitRef(input.baseRef);
  const targetRef = normalizeGitRef(input.targetRef);

  // Build command
  let command = `git diff ${baseRef}...${targetRef}`;

  // Add path specs
  const pathSpecs: string[] = [];

  if (input.includePatterns && input.includePatterns.length > 0) {
    pathSpecs.push('--', ...input.includePatterns);
  }

  if (input.excludePatterns && input.excludePatterns.length > 0) {
    // Git pathspec exclude syntax
    const excludes = input.excludePatterns.map((p) => `':!${p}'`);
    if (pathSpecs.length === 0) {
      pathSpecs.push('--');
    }
    pathSpecs.push(...excludes);
  }

  if (pathSpecs.length > 0) {
    command += ' ' + pathSpecs.join(' ');
  }

  try {
    const output = execSync(command, {
      cwd: input.repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git diff failed: ${message}`);
  }
}

// ============================================================================
// TEMPLATE CREATION
// ============================================================================

/**
 * Create the T2 DeltaMap template.
 *
 * @returns DeltaMap construction template
 */
export function createDeltaMapTemplate(): DeltaMapTemplate {
  return {
    id: 'T2',
    name: 'DeltaMap',
    description: 'Track git-based changes and map their impact to affected components.',
    supportedUcs: ['UC-041', 'UC-042', 'UC-049'],
    requiredMaps: ['ChangeMap', 'FreshnessCursor'],
    optionalMaps: ['ImpactMap'],
    requiredObjects: ['repo_fact', 'map', 'episode', 'pack'],
    requiredCapabilities: ['tool:git'],
    outputEnvelope: {
      packTypes: ['DeltaPack'],
      requiresAdequacy: true,
      requiresVerificationPlan: false,
    },
    execute: executeDeltaMap,
  };
}

/**
 * Execute the DeltaMap template.
 *
 * @param context - Template execution context
 * @returns Template execution result
 */
async function executeDeltaMap(context: TemplateContext): Promise<TemplateResult> {
  const now = new Date().toISOString();
  const evidence: TemplateSelectionEvidence[] = [{
    templateId: 'T2',
    selectedAt: now,
    reason: 'DeltaMap template selected for change analysis',
    intentKeywords: extractIntentKeywords(context.intent),
  }];

  const disclosures: string[] = [];

  // Extract refs from context or use defaults
  const baseRef = extractRefFromIntent(context.intent, 'base') || 'main';
  const targetRef = extractRefFromIntent(context.intent, 'target') || 'HEAD';

  // Create DeltaMapInput
  const input: DeltaMapInput = {
    repoPath: context.workspace || process.cwd(),
    baseRef,
    targetRef,
    includePatterns: context.affectedFiles,
  };

  let deltas: FileDelta[] = [];
  let gitConfidence: ConfidenceValue = deterministic(true, 'git_diff_executed');

  try {
    const diffOutput = executeGitDiff(input);
    deltas = parseDiffOutput(diffOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    disclosures.push(`git_error: ${message}`);
    gitConfidence = deterministic(false, 'git_diff_failed');
  }

  // Handle empty results
  if (deltas.length === 0) {
    disclosures.push('no_changes: no differences found between refs');
  }

  // Compute derived data
  const affectedComponents = identifyAffectedComponents(deltas);
  const riskAssessment = computeRiskAssessment(deltas, affectedComponents);

  // Compute totals
  const totalAdditions = deltas.reduce((sum, d) => sum + d.additions, 0);
  const totalDeletions = deltas.reduce((sum, d) => sum + d.deletions, 0);

  // Build confidence from pipeline
  const parseConfidence = deterministic(true, 'diff_parsed');
  const componentConfidence = deterministic(affectedComponents.length > 0 || deltas.length === 0, 'components_identified');
  const riskConfidence = deterministic(true, 'risk_computed');

  const overallConfidence = sequenceConfidence([
    gitConfidence,
    parseConfidence,
    componentConfidence,
    riskConfidence,
  ]);

  // Build output
  const deltaMapOutput: DeltaMapOutput = {
    baseRef,
    targetRef,
    totalFiles: deltas.length,
    totalAdditions,
    totalDeletions,
    deltas,
    affectedComponents,
    riskAssessment,
    confidence: overallConfidence,
  };

  // Create context pack
  const contextPack = buildContextPack(deltaMapOutput, context);

  return {
    success: true,
    packs: [contextPack],
    adequacy: null,
    verificationPlan: null,
    disclosures,
    traceId: `trace_T2_${Date.now()}`,
    evidence,
  };
}

/**
 * Build a ContextPack from DeltaMapOutput.
 */
function buildContextPack(output: DeltaMapOutput, context: TemplateContext): ContextPack {
  const keyFacts: string[] = [
    `Changes between ${output.baseRef} and ${output.targetRef}`,
    `${output.totalFiles} files changed`,
    `+${output.totalAdditions} / -${output.totalDeletions} lines`,
    `Risk assessment: ${output.riskAssessment}`,
    `Affected components: ${output.affectedComponents.join(', ') || 'none'}`,
  ];

  // Add file summaries
  for (const delta of output.deltas.slice(0, 10)) {
    keyFacts.push(`${delta.status}: ${delta.path} (+${delta.additions}/-${delta.deletions})`);
  }

  if (output.deltas.length > 10) {
    keyFacts.push(`... and ${output.deltas.length - 10} more files`);
  }

  const confidenceValue = getEffectiveConfidence(output.confidence);

  return {
    packId: `delta_pack_${Date.now()}`,
    packType: 'change_impact',
    targetId: `${output.baseRef}...${output.targetRef}`,
    summary: `DeltaMap analysis: ${output.totalFiles} files, ${output.riskAssessment} risk`,
    keyFacts,
    codeSnippets: [],
    relatedFiles: output.deltas.map((d) => d.path),
    confidence: confidenceValue,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'mvp',
      indexedAt: new Date(),
      indexerVersion: '1.0.0',
      features: ['delta_map'],
    },
    invalidationTriggers: output.deltas.map((d) => d.path),
  };
}

/**
 * Extract intent keywords for evidence.
 */
function extractIntentKeywords(intent: string): string[] {
  const keywords = ['change', 'delta', 'diff', 'commit', 'modified', 'since', 'between'];
  const intentLower = intent.toLowerCase();
  return keywords.filter((k) => intentLower.includes(k));
}

/**
 * Extract git ref from intent string.
 */
function extractRefFromIntent(intent: string, type: 'base' | 'target'): string | null {
  const intentLower = intent.toLowerCase();

  // Common patterns
  if (type === 'base') {
    // "since main", "from develop", "compared to HEAD~5"
    const basePatterns = [
      /since\s+([a-zA-Z0-9_\-./^~]+)/i,
      /from\s+([a-zA-Z0-9_\-./^~]+)/i,
      /compared\s+to\s+([a-zA-Z0-9_\-./^~]+)/i,
      /between\s+([a-zA-Z0-9_\-./^~]+)\s+and/i,
    ];

    for (const pattern of basePatterns) {
      const match = intent.match(pattern);
      if (match) {
        return match[1];
      }
    }
  } else {
    // "to HEAD", "and feature-branch"
    const targetPatterns = [
      /to\s+([a-zA-Z0-9_\-./^~]+)/i,
      /and\s+([a-zA-Z0-9_\-./^~]+)/i,
    ];

    for (const pattern of targetPatterns) {
      const match = intent.match(pattern);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}
