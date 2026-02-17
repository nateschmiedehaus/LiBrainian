/**
 * @fileoverview T6 ReproAndBisect Template
 *
 * WU-TMPL-006: T6 ReproAndBisect Template
 *
 * Provides reproduction step generation and git bisect integration
 * for localizing regressions and documenting minimal reproduction cases.
 *
 * @packageDocumentation
 */

import { execSync } from 'node:child_process';
import type { ContextPack } from '../types.js';
import type { AdequacyReport } from './difficulty_detectors.js';
import type { VerificationPlan } from '../strategic/verification_plan.js';
import type {
  ConstructionTemplate,
  TemplateContext,
  TemplateResult,
  TemplateSelectionEvidence,
  OutputEnvelopeSpec,
} from './template_registry.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { absent, bounded, deterministic, getNumericValue } from '../epistemics/confidence.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for the ReproAndBisect template.
 */
export interface ReproAndBisectInput {
  repoPath: string;
  issueDescription: string;
  symptom: string;
  goodRef?: string;  // Known good commit
  badRef?: string;   // Known bad commit (default HEAD)
  testCommand?: string;  // Command to verify bug
}

/**
 * A single step in the reproduction process.
 */
export interface ReproStep {
  stepNumber: number;
  action: string;
  expectedResult: string;
  actualResult?: string;
  command?: string;
}

/**
 * Result from git bisect analysis.
 */
export interface BisectResult {
  firstBadCommit: string;
  commitMessage: string;
  author: string;
  date: string;
  changedFiles: string[];
  confidence: number;
}

/**
 * Output from the ReproAndBisect template.
 */
export interface ReproAndBisectOutput {
  reproductionSteps: ReproStep[];
  reproduced: boolean;
  bisectResult?: BisectResult;
  minimalReproCase?: string;
  suggestedFix?: string;
  confidence: ConfidenceValue;
}

/**
 * Parsed data from issue description.
 */
export interface ParsedIssue {
  errorMessages: string[];
  mentionedFiles: string[];
  triggers: string[];
  stackTraceLines: string[];
  versions?: {
    applicationVersion?: string;
    nodeVersion?: string;
    npmVersion?: string;
  };
}

/**
 * A reproduction attempt record.
 */
export interface ReproAttempt {
  steps: ReproStep[];
  timestamp: string;
  environment: Record<string, string>;
}

/**
 * Tracked reproduction attempt result.
 */
export interface TrackedReproAttempt {
  reproduced: boolean;
  failedAtStep?: number;
  incomplete?: boolean;
  duration?: number;
}

/**
 * Analysis of bisect result.
 */
export interface BisectAnalysis {
  suggestedFix?: string;
  relatedFiles: string[];
  regressionArea?: string;
  recommendation: string;
}

/**
 * Bisect execution options.
 */
export interface BisectOptions {
  repoPath: string;
  goodRef: string;
  badRef: string;
  testCommand?: string;
}

/**
 * The T6 ReproAndBisect template type.
 */
export type ReproAndBisectTemplate = ConstructionTemplate;

// ============================================================================
// DANGEROUS PATTERN DETECTION
// ============================================================================

const DANGEROUS_PATTERNS = [
  /[;|`$]/,           // Shell metacharacters
  /\$\(/,             // Command substitution
  /&&/,               // Command chaining (for non-test commands)
  /\|\|/,             // Command chaining
  />\s/,              // Redirect
  /<\s/,              // Redirect
  /\brm\b/,           // Remove command
  /\bcurl\b.*\|\s*\bsh\b/, // Curl pipe to shell
];

const SAFE_TEST_COMMANDS = [
  /^npm\s+(test|run\s+test)/,
  /^yarn\s+(test|run\s+test)/,
  /^pnpm\s+(test|run\s+test)/,
  /^make\s+test/,
  /^vitest/,
  /^jest/,
  /^pytest/,
  /^cargo\s+test/,
  /^go\s+test/,
  /^mvn\s+test/,
  /^gradle\s+test/,
];

// ============================================================================
// GIT REF VALIDATION
// ============================================================================

/**
 * Normalize and validate a git ref to prevent injection.
 */
export function normalizeGitRef(ref: string): string {
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(ref)) {
      throw new Error(`Invalid git ref: contains dangerous pattern: ${ref}`);
    }
  }

  // Allow: alphanumeric, /, -, _, ., ^, ~
  const safePattern = /^[a-zA-Z0-9/_\-.\^~]+$/;
  if (!safePattern.test(ref)) {
    throw new Error(`Invalid git ref: contains invalid characters: ${ref}`);
  }

  return ref;
}

/**
 * Validate a test command for safety.
 */
export function validateTestCommand(command: string): boolean {
  // FIRST check for dangerous patterns - safety takes priority
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return false;
    }
  }

  // Check for safe patterns
  for (const pattern of SAFE_TEST_COMMANDS) {
    if (pattern.test(command)) {
      return true;
    }
  }

  // Default: allow if it looks like a simple command
  const simpleCommand = /^[\w-]+(\s+[\w.-]+)*$/;
  return simpleCommand.test(command);
}

// ============================================================================
// ISSUE PARSING
// ============================================================================

/**
 * Parse an issue description to extract relevant information.
 */
export function parseIssueDescription(description: string): ParsedIssue {
  const result: ParsedIssue = {
    errorMessages: [],
    mentionedFiles: [],
    triggers: [],
    stackTraceLines: [],
  };

  if (!description || description.trim() === '') {
    return result;
  }

  // Extract error messages (common patterns)
  // More specific patterns first, then general ones
  const errorPatterns = [
    // Pattern for "TypeError: Cannot read property 'x' of undefined" - capture full message after the colon
    /(?:TypeError|ReferenceError|SyntaxError):\s*(.+?)(?=\n|at\s|$)/gi,
    /(?:Error|Exception):\s*(.+?)(?=\n|at\s|$)/gi,
    /(?:Cannot|Unable to)\s+(.+?)(?=\n|$)/gi,
    /(?:Failed|Failure):\s*(.+?)(?=\n|$)/gi,
  ];

  for (const pattern of errorPatterns) {
    const matches = description.matchAll(pattern);
    for (const match of matches) {
      const msg = match[1].trim();
      // Avoid duplicates
      if (msg && !result.errorMessages.includes(msg)) {
        result.errorMessages.push(msg);
      }
    }
  }

  // Extract file paths - more permissive pattern to catch tsx and other extensions
  // Capture src/path-with-dashes/file.tsx style paths
  const filePathPattern = /(?:^|\s|\/|:)((?:src|lib|app|test|spec|__tests__|components|pages|api|utils|hooks|services|models)\/[a-zA-Z0-9_\/-]+\.(?:tsx?|jsx?|py|rb|go|java|rs|cpp|c|h))/gi;
  const fileMatches = description.matchAll(filePathPattern);
  for (const match of fileMatches) {
    const filePath = match[1];
    if (!result.mentionedFiles.includes(filePath)) {
      result.mentionedFiles.push(filePath);
    }
  }

  // Also capture paths with spaces (quoted) or general file paths
  const quotedPathPattern = /'([^']+\.[a-zA-Z]+)'|"([^"]+\.[a-zA-Z]+)"/gi;
  const quotedMatches = description.matchAll(quotedPathPattern);
  for (const match of quotedMatches) {
    const path = match[1] || match[2];
    if (path.includes('/') && !result.mentionedFiles.includes(path)) {
      result.mentionedFiles.push(path);
    }
  }

  // Capture paths in prose like "in src/path/file.ts"
  const prosePathPattern = /(?:in|at|from|file)\s+([a-zA-Z0-9_\/-]+\/[a-zA-Z0-9_\/-]+\.(?:tsx?|jsx?|py|go|java))/gi;
  const proseMatches = description.matchAll(prosePathPattern);
  for (const match of proseMatches) {
    const filePath = match[1];
    if (!result.mentionedFiles.includes(filePath)) {
      result.mentionedFiles.push(filePath);
    }
  }

  // Extract stack trace lines
  const stackPattern = /at\s+\S+\s+\([^)]+\)/gi;
  const stackMatches = description.matchAll(stackPattern);
  for (const match of stackMatches) {
    result.stackTraceLines.push(match[0]);
  }

  // Extract trigger conditions from numbered steps
  const stepPattern = /^\s*\d+[.)]\s*(.+)$/gm;
  const stepMatches = description.matchAll(stepPattern);
  for (const match of stepMatches) {
    result.triggers.push(match[1].trim());
  }

  // Extract version info
  const versionPatterns = {
    applicationVersion: /version\s+(\d+\.\d+\.\d+)/i,
    nodeVersion: /node(?:\.js)?\s*v?(\d+\.\d+\.\d+)/i,
    npmVersion: /npm\s*v?(\d+\.\d+\.\d+)/i,
  };

  const versions: ParsedIssue['versions'] = {};
  let hasVersions = false;
  for (const [key, pattern] of Object.entries(versionPatterns)) {
    const match = description.match(pattern);
    if (match) {
      versions[key as keyof typeof versionPatterns] = match[1];
      hasVersions = true;
    }
  }
  if (hasVersions) {
    result.versions = versions;
  }

  return result;
}

// ============================================================================
// REPRO STEP GENERATION
// ============================================================================

/**
 * Generate reproduction steps from parsed issue data.
 */
export function generateReproSteps(parsed: ParsedIssue, symptom: string): ReproStep[] {
  const steps: ReproStep[] = [];
  let stepNum = 1;

  // Step 1: Environment setup
  steps.push({
    stepNumber: stepNum++,
    action: 'Setup environment and install dependencies',
    expectedResult: 'Dependencies installed successfully',
    command: 'npm install',
  });

  // Add steps based on triggers
  if (parsed.triggers.length > 0) {
    for (const trigger of parsed.triggers) {
      steps.push({
        stepNumber: stepNum++,
        action: trigger,
        expectedResult: 'Action completed',
      });
    }
  } else {
    // Default step if no triggers found
    steps.push({
      stepNumber: stepNum++,
      action: 'Execute the triggering action',
      expectedResult: 'Application responds',
    });
  }

  // Add verification step for files mentioned
  if (parsed.mentionedFiles.length > 0) {
    steps.push({
      stepNumber: stepNum++,
      action: `Navigate to or interact with ${parsed.mentionedFiles[0]}`,
      expectedResult: 'File/component accessible',
    });
  }

  // Final step: Verify symptom
  steps.push({
    stepNumber: stepNum++,
    action: 'Observe the result',
    expectedResult: `Bug symptom should manifest: ${symptom}`,
  });

  return steps;
}

// ============================================================================
// GIT BISECT EXECUTION
// ============================================================================

/**
 * Execute git bisect to find the first bad commit.
 */
export async function executeBisect(options: BisectOptions): Promise<BisectResult> {
  const { repoPath, goodRef, badRef, testCommand } = options;

  // Validate refs
  const safeGoodRef = normalizeGitRef(goodRef);
  const safeBadRef = normalizeGitRef(badRef);

  const execOptions = { cwd: repoPath, encoding: 'utf-8' as const };

  try {
    // Start bisect
    execSync('git bisect start', execOptions);

    try {
      // Mark bad commit
      execSync(`git bisect bad ${safeBadRef}`, execOptions);

      // Mark good commit
      execSync(`git bisect good ${safeGoodRef}`, execOptions);

      let bisectOutput: string;

      if (testCommand && validateTestCommand(testCommand)) {
        // Run automated bisect
        bisectOutput = execSync(`git bisect run ${testCommand}`, execOptions).toString();
      } else {
        // Manual bisect - just get the first suggestion
        // In real usage, this would require interactive steps
        bisectOutput = execSync('git bisect next 2>&1 || true', execOptions).toString();
      }

      // Find the first bad commit
      const firstBadMatch = bisectOutput.match(/([a-f0-9]{7,40})\s+is the first bad commit/);
      let firstBadCommit = firstBadMatch ? firstBadMatch[1] : '';

      if (!firstBadCommit) {
        // Try to get current bisect commit
        const headOutput = execSync('git rev-parse HEAD', execOptions).toString().trim();
        firstBadCommit = headOutput.slice(0, 12);
      }

      // Get commit details
      let commitMessage = '';
      let author = '';
      let date = '';
      let changedFiles: string[] = [];

      if (firstBadCommit) {
        try {
          const logOutput = execSync(
            `git log -1 --format="%s%n%an <%ae>%n%ad" ${firstBadCommit}`,
            execOptions
          ).toString();
          const lines = logOutput.split('\n');
          commitMessage = lines[0] || '';
          author = lines[1] || '';
          date = lines[2] || '';

          // Get changed files
          const filesOutput = execSync(
            `git show --name-only --format="" ${firstBadCommit}`,
            execOptions
          ).toString();
          changedFiles = filesOutput.split('\n').filter(f => f.trim() !== '');
        } catch {
          // Commit info retrieval failed, use defaults
        }
      }

      // Calculate confidence based on whether automated test was used
      const confidence = testCommand ? 0.9 : 0.6;

      return {
        firstBadCommit,
        commitMessage,
        author,
        date,
        changedFiles,
        confidence,
      };
    } finally {
      // Always reset bisect
      try {
        execSync('git bisect reset', execOptions);
      } catch {
        // Ignore reset errors
      }
    }
  } catch (error) {
    // Attempt cleanup
    try {
      execSync('git bisect reset', execOptions);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// ============================================================================
// REPRO TRACKING
// ============================================================================

/**
 * Track a reproduction attempt and determine success/failure.
 */
export function trackReproAttempt(attempt: ReproAttempt): TrackedReproAttempt {
  const result: TrackedReproAttempt = {
    reproduced: false,
  };

  if (attempt.steps.length === 0) {
    result.incomplete = true;
    return result;
  }

  // Check if all steps have actual results
  let allCompleted = true;
  let failedStep: number | undefined;

  for (const step of attempt.steps) {
    if (step.actualResult === undefined) {
      allCompleted = false;
    } else if (step.actualResult !== step.expectedResult) {
      // Check if this is NOT the expected "bug symptom" step
      const isFinalSymptomStep = step.expectedResult.toLowerCase().includes('symptom') ||
                                  step.expectedResult.toLowerCase().includes('bug') ||
                                  step.expectedResult.toLowerCase().includes('crash') ||
                                  step.expectedResult.toLowerCase().includes('error');
      if (!isFinalSymptomStep) {
        // This is a setup step that failed
        failedStep = step.stepNumber;
        break;
      }
    }
  }

  if (!allCompleted) {
    result.incomplete = true;
    return result;
  }

  if (failedStep !== undefined) {
    result.failedAtStep = failedStep;
    return result;
  }

  // Check if the bug was reproduced
  // The bug is reproduced if all steps completed and expected behavior matches
  // For bug reproduction, we're looking for the symptom to appear
  const lastStep = attempt.steps[attempt.steps.length - 1];
  if (lastStep?.actualResult !== undefined) {
    // If the actual result matches expected (symptom manifestation), bug is reproduced
    if (lastStep.actualResult === lastStep.expectedResult) {
      result.reproduced = true;
    } else {
      // Check if it's a symptom step where actual contains expected behavior
      const isFinalSymptomStep = lastStep.expectedResult.toLowerCase().includes('symptom') ||
                                  lastStep.expectedResult.toLowerCase().includes('crash');
      if (isFinalSymptomStep) {
        // For symptom steps, partial match counts
        const symptomPart = lastStep.expectedResult.split(':')[1]?.trim().toLowerCase() || '';
        if (symptomPart && lastStep.actualResult.toLowerCase().includes(symptomPart)) {
          result.reproduced = true;
        }
      }
    }
  }

  return result;
}

// ============================================================================
// MINIMAL REPRO CASE DOCUMENTATION
// ============================================================================

/**
 * Create markdown documentation for a minimal reproduction case.
 */
export function createMinimalReproCase(
  input: ReproAndBisectInput,
  steps: ReproStep[],
  bisectResult?: BisectResult
): string {
  const lines: string[] = [];

  lines.push('# Minimal Reproduction Case');
  lines.push('');

  lines.push('## Symptom');
  lines.push(input.symptom);
  lines.push('');

  lines.push('## Environment');
  lines.push('');
  lines.push('- Repository: `' + input.repoPath + '`');
  if (input.goodRef) {
    lines.push('- Known good commit: `' + input.goodRef + '`');
  }
  if (input.badRef) {
    lines.push('- Known bad commit: `' + input.badRef + '`');
  }
  lines.push('');

  lines.push('## Steps to Reproduce');
  lines.push('');

  for (const step of steps) {
    lines.push(`${step.stepNumber}. **${step.action}**`);
    if (step.command) {
      lines.push('   ```bash');
      lines.push(`   ${step.command}`);
      lines.push('   ```');
    }
    lines.push(`   - Expected: ${step.expectedResult}`);
    if (step.actualResult) {
      lines.push(`   - Actual: ${step.actualResult}`);
    }
    lines.push('');
  }

  if (bisectResult) {
    lines.push('## First Bad Commit');
    lines.push('');
    lines.push('```');
    lines.push(`Commit: ${bisectResult.firstBadCommit}`);
    lines.push(`Author: ${bisectResult.author}`);
    lines.push(`Date: ${bisectResult.date}`);
    lines.push(`Message: ${bisectResult.commitMessage}`);
    lines.push('```');
    lines.push('');

    if (bisectResult.changedFiles.length > 0) {
      lines.push('### Changed Files');
      lines.push('');
      for (const file of bisectResult.changedFiles) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }

    lines.push(`Confidence: ${(bisectResult.confidence * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

// ============================================================================
// BISECT ANALYSIS
// ============================================================================

/**
 * Analyze bisect results to suggest fixes.
 */
export function analyzeBisectResult(
  bisectResult: BisectResult,
  symptom: string
): BisectAnalysis {
  const analysis: BisectAnalysis = {
    relatedFiles: [...bisectResult.changedFiles],
    recommendation: '',
  };

  // Determine regression area from common parent directory
  if (bisectResult.changedFiles.length > 0) {
    const dirs = bisectResult.changedFiles.map(f => {
      const parts = f.split('/');
      return parts.slice(0, -1).join('/');
    });
    const commonDirs = dirs.reduce((acc, dir) => {
      const common = acc.filter(d => dir.startsWith(d) || d.startsWith(dir));
      return common.length > 0 ? common : [...acc, dir];
    }, [] as string[]);
    if (commonDirs.length === 1 && commonDirs[0]) {
      analysis.regressionArea = commonDirs[0];
    } else if (dirs.length > 0) {
      analysis.regressionArea = dirs[0].split('/').slice(0, 2).join('/');
    }
  }

  // Generate suggested fix based on commit message and symptom
  const commitLower = bisectResult.commitMessage.toLowerCase();
  const symptomLower = symptom.toLowerCase();

  if (commitLower.includes('null') || symptomLower.includes('null')) {
    analysis.suggestedFix = 'Review null/undefined handling in the changed files';
  } else if (commitLower.includes('refactor') || commitLower.includes('rewrite')) {
    analysis.suggestedFix = 'Verify refactored logic maintains original behavior';
  } else if (commitLower.includes('update') || commitLower.includes('upgrade')) {
    analysis.suggestedFix = 'Check for breaking changes in updated dependencies or APIs';
  } else {
    analysis.suggestedFix = `Review changes in: ${bisectResult.changedFiles.slice(0, 3).join(', ')}`;
  }

  // Generate recommendation based on confidence
  if (bisectResult.confidence >= 0.8) {
    analysis.recommendation = `high confidence bisect result - focus on commit ${bisectResult.firstBadCommit}`;
  } else if (bisectResult.confidence >= 0.6) {
    analysis.recommendation = 'medium confidence - verify by manual inspection of the identified commit';
  } else {
    analysis.recommendation = 'low confidence - requires manual review of the commit range';
  }

  return analysis;
}

// ============================================================================
// TEMPLATE IMPLEMENTATION
// ============================================================================

/**
 * Create the T6 ReproAndBisect template.
 */
export function createReproAndBisectTemplate(): ReproAndBisectTemplate {
  const outputEnvelope: OutputEnvelopeSpec = {
    packTypes: ['ReproPack', 'BisectReportPack'],
    requiresAdequacy: true,
    requiresVerificationPlan: true,
  };

  return {
    id: 'T6',
    name: 'ReproAndBisect',
    description: 'Generate repro scripts and localize regressions via bisect.',
    supportedUcs: [],
    requiredMaps: [],
    optionalMaps: ['ChangeMap', 'TestMap'],
    requiredObjects: ['episode', 'pack'],
    requiredArtifacts: ['work_objects'],
    outputEnvelope,

    async execute(context: TemplateContext): Promise<TemplateResult> {
      const now = new Date().toISOString();
      const traceId = `trace_T6_${Date.now()}`;
      const evidence: TemplateSelectionEvidence[] = [];
      const disclosures: string[] = [];
      const packs: ContextPack[] = [];

      evidence.push({
        templateId: 'T6',
        selectedAt: now,
        reason: `ReproAndBisect template selected for intent: ${context.intent}`,
      });

      // Validate input
      if (!context.intent || context.intent.trim() === '') {
        disclosures.push('empty_intent: No issue description provided');
      }

      // Check if repo is valid
      let repoValid = true;
      if (context.workspace) {
        try {
          execSync('git rev-parse --git-dir', { cwd: context.workspace, encoding: 'utf-8' });
        } catch {
          repoValid = false;
          disclosures.push('invalid_repo: Workspace is not a valid git repository');
        }
      } else {
        repoValid = false;
        disclosures.push('no_workspace: No workspace path provided');
      }

      // Parse the issue description
      const parsed = parseIssueDescription(context.intent);

      // Generate repro steps
      const symptom = context.intent.split('.')[0] || 'Bug manifestation';
      const reproSteps = generateReproSteps(parsed, symptom);

      // Try bisect if we have valid repo and refs
      let bisectResult: BisectResult | undefined;
      let bisectAnalysis: BisectAnalysis | undefined;

      // Check for refs in context hints
      const goodRef = context.ucHints?.find(h => h.startsWith('goodRef:'))?.split(':')[1];
      const badRef = context.ucHints?.find(h => h.startsWith('badRef:'))?.split(':')[1] || 'HEAD';

      if (repoValid && goodRef) {
        try {
          bisectResult = await executeBisect({
            repoPath: context.workspace!,
            goodRef,
            badRef,
          });
          bisectAnalysis = analyzeBisectResult(bisectResult, symptom);
        } catch (error) {
          disclosures.push(`bisect_failed: ${(error as Error).message}`);
        }
      } else if (repoValid && !goodRef) {
        disclosures.push('no_known_good: Cannot perform bisect without known good commit');
      }

      // Create minimal repro documentation
      const minimalReproCase = createMinimalReproCase(
        {
          repoPath: context.workspace || '/unknown',
          issueDescription: context.intent,
          symptom,
          goodRef,
          badRef,
        },
        reproSteps,
        bisectResult
      );

      // Calculate overall confidence
      let confidence: ConfidenceValue;
      if (bisectResult && bisectResult.confidence >= 0.8) {
        confidence = bounded(0.7, 0.95, 'theoretical',
          'Automated bisect with test command completed successfully');
      } else if (bisectResult) {
        confidence = bounded(0.5, 0.75, 'theoretical',
          'Bisect completed but without automated verification');
      } else {
        confidence = absent('insufficient_data');
      }

      // Build key facts
      const keyFacts: string[] = [];
      keyFacts.push(`Reproduction steps: ${reproSteps.length} steps generated`);
      if (bisectResult) {
        keyFacts.push(`First bad commit: ${bisectResult.firstBadCommit}`);
        keyFacts.push(`Changed files: ${bisectResult.changedFiles.length}`);
        if (bisectAnalysis?.regressionArea) {
          keyFacts.push(`Regression area: ${bisectAnalysis.regressionArea}`);
        }
      }
      if (!goodRef) {
        keyFacts.push('No known good commit - bisect not performed');
      }

      // Create the repro pack
      const reproPack: ContextPack = {
        packId: `repro_pack_${traceId}`,
        packType: 'change_impact',
        targetId: context.workspace || 'unknown',
        summary: `Reproduction case for: ${symptom}`,
        keyFacts,
        codeSnippets: [],
        relatedFiles: parsed.mentionedFiles,
        confidence: getNumericValue(confidence) ?? 0.5,
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: {
          major: 0,
          minor: 1,
          patch: 0,
          string: '0.1.0',
          qualityTier: 'mvp',
          indexedAt: new Date(),
          indexerVersion: '0.1.0',
          features: ['repro_bisect'],
        },
        invalidationTriggers: parsed.mentionedFiles,
      };

      packs.push(reproPack);

      // If bisect was successful, add a separate bisect report pack
      if (bisectResult) {
        const bisectPack: ContextPack = {
          packId: `bisect_pack_${traceId}`,
          packType: 'change_impact',
          targetId: bisectResult.firstBadCommit,
          summary: `Bisect result: ${bisectResult.commitMessage}`,
          keyFacts: [
            `First bad commit: ${bisectResult.firstBadCommit}`,
            `Author: ${bisectResult.author}`,
            `Date: ${bisectResult.date}`,
            `Files changed: ${bisectResult.changedFiles.length}`,
            bisectAnalysis?.recommendation || '',
          ].filter(Boolean),
          codeSnippets: [],
          relatedFiles: bisectResult.changedFiles,
          confidence: bisectResult.confidence,
          createdAt: new Date(),
          accessCount: 0,
          lastOutcome: 'unknown',
          successCount: 0,
          failureCount: 0,
          version: {
            major: 0,
            minor: 1,
            patch: 0,
            string: '0.1.0',
            qualityTier: 'mvp',
            indexedAt: new Date(),
            indexerVersion: '0.1.0',
            features: ['bisect'],
          },
          invalidationTriggers: bisectResult.changedFiles,
        };

        packs.push(bisectPack);
      }

      return {
        success: repoValid || disclosures.length === 0,
        packs,
        adequacy: null,
        verificationPlan: null,
        disclosures,
        traceId,
        evidence,
      };
    },
  };
}
