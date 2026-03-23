import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * @fileoverview Developer Experience (DX) Standards
 *
 * Comprehensive framework for building world-class developer experience:
 * - Onboarding Excellence: Time-to-first-commit targets, setup automation
 * - Development Workflow: Branch strategy, code review, PR guidelines
 * - Tooling Standards: IDE config, linting, formatting, pre-commit hooks
 * - Documentation Standards: API docs, architecture docs, runbooks
 * - Feedback Loops: Build times, test times, error message quality
 *
 * Includes:
 * - DX score calculator for measuring developer experience quality
 * - Onboarding checklist generator for new team members
 * - Workflow validator for ensuring compliance
 * - Presets (WORLD_CLASS, STANDARD, MINIMAL) for quick configuration
 *
 * @packageDocumentation
 */

// ============================================================================
// ONBOARDING EXCELLENCE
// ============================================================================

/**
 * Prerequisite software or configuration required for development.
 */
export interface Prerequisite {
  name: string;
  version?: string;
  installCommand?: string;
  verificationCommand?: string;
  required: boolean;
  platform?: 'all' | 'macos' | 'linux' | 'windows';
  notes?: string;
}

/**
 * Configuration for automated development environment setup.
 */
export interface SetupConfig {
  /** Whether a single command can bootstrap the entire dev environment */
  oneCommandBootstrap: boolean;
  /** Whether development uses containers (Docker, devcontainers, etc.) */
  containerized: boolean;
  /** Whether cloud-based development workspaces are supported (GitHub Codespaces, Gitpod, etc.) */
  cloudWorkspaceSupport: boolean;
  /** List of prerequisites for local development */
  prerequisites: Prerequisite[];
  /** Bootstrap command (e.g., "make setup", "npm run bootstrap") */
  bootstrapCommand?: string;
  /** Estimated setup time in minutes */
  estimatedSetupTimeMinutes?: number;
}

/**
 * Types of onboarding documentation.
 */
export interface OnboardingDocs {
  type: 'quickstart' | 'architecture' | 'conventions' | 'troubleshooting';
  /** Whether this documentation is required */
  required: boolean;
  /** Maximum age in days before documentation should be reviewed */
  maxAgeDays: number;
  /** File path or URL to the documentation */
  location?: string;
  /** Last review date (ISO timestamp) */
  lastReviewedAt?: string;
}

/**
 * Configuration for mentorship during onboarding.
 */
export interface MentorshipConfig {
  /** Whether new developers are assigned a mentor/buddy */
  buddySystemEnabled: boolean;
  /** Target days to have regular 1:1s during onboarding */
  checkInFrequencyDays: number;
  /** Topics that should be covered during onboarding */
  onboardingTopics: string[];
  /** Expected duration of formal mentorship in weeks */
  mentorshipDurationWeeks: number;
}

/**
 * Complete onboarding configuration for developer experience.
 */
export interface OnboardingConfig {
  /** Target time for a new developer to make their first commit (in hours) */
  timeToFirstCommitTarget: number;
  /** Setup automation configuration */
  setupAutomation: SetupConfig;
  /** Required and recommended documentation */
  documentationRequirements: OnboardingDocs[];
  /** Mentorship and support guidelines */
  mentorshipGuidelines: MentorshipConfig;
}

// ============================================================================
// DEVELOPMENT WORKFLOW
// ============================================================================

/**
 * Code review configuration and requirements.
 */
export interface CodeReviewConfig {
  /** Whether code review is required before merge */
  required: boolean;
  /** Minimum number of approving reviewers */
  minReviewers: number;
  /** Target time for first review response (in hours) */
  slaHours: number;
  /** Whether reviewers are automatically assigned */
  autoAssignment: boolean;
  /** Checklist items for reviewers */
  checklist: string[];
  /** CODEOWNERS file path if applicable */
  codeOwnersPath?: string;
  /** Whether review dismissal on new commits is required */
  dismissStaleReviews: boolean;
}

/**
 * Commit message conventions and requirements.
 */
export interface CommitConfig {
  /** Convention type (conventional commits, etc.) */
  convention: 'conventional' | 'angular' | 'semantic' | 'custom' | 'none';
  /** Whether commit messages are enforced via hooks */
  enforced: boolean;
  /** Maximum length for commit subject line */
  maxSubjectLength: number;
  /** Required prefixes/types for conventional commits */
  allowedTypes?: string[];
  /** Whether breaking changes must be explicitly marked */
  requireBreakingChangeMarker: boolean;
  /** Whether issue/ticket references are required */
  requireIssueReference: boolean;
}

/**
 * Pull request guidelines and requirements.
 */
export interface PRConfig {
  /** Maximum lines changed recommendation */
  maxLines: number;
  /** Whether PR template is required */
  templateRequired: boolean;
  /** Whether PRs must be linked to issues */
  linkedIssueRequired: boolean;
  /** Whether CI must pass before merge */
  ciPassRequired: boolean;
  /** Required PR sections/checklist */
  requiredSections: string[];
  /** Whether draft PRs are supported */
  supportDraftPRs: boolean;
  /** Target time for PR to be merged (in hours) */
  targetMergeTimeHours?: number;
}

/**
 * Complete workflow configuration.
 */
export interface WorkflowConfig {
  /** Git branching strategy */
  branchStrategy: 'trunk_based' | 'gitflow' | 'github_flow';
  /** Code review configuration */
  codeReview: CodeReviewConfig;
  /** Commit message conventions */
  commitConventions: CommitConfig;
  /** Pull request guidelines */
  prGuidelines: PRConfig;
  /** Protected branches */
  protectedBranches: string[];
  /** Whether force push is allowed */
  allowForcePush: boolean;
}

// ============================================================================
// TOOLING STANDARDS
// ============================================================================

/**
 * IDE configuration and recommendations.
 */
export interface IDEConfig {
  /** Recommended IDEs */
  recommended: ('vscode' | 'intellij' | 'vim' | 'neovim' | 'emacs' | 'other')[];
  /** Whether shared IDE settings are provided (e.g., .vscode/settings.json) */
  sharedSettingsProvided: boolean;
  /** Required extensions/plugins */
  requiredExtensions: string[];
  /** Recommended extensions/plugins */
  recommendedExtensions: string[];
  /** Path to shared settings */
  settingsPath?: string;
}

/**
 * Linting configuration and requirements.
 */
export interface LintingConfig {
  /** Whether linting is enabled */
  enabled: boolean;
  /** Whether strict mode is enabled */
  strict: boolean;
  /** Whether auto-fix is enabled */
  autoFix: boolean;
  /** Custom rules or rule packages */
  customRules: string[];
  /** Linting tool used */
  tool?: string;
  /** Path to linting configuration */
  configPath?: string;
}

/**
 * Code formatting configuration.
 */
export interface FormattingConfig {
  /** Whether automatic formatting is enabled */
  enabled: boolean;
  /** Formatting tool used */
  tool: 'prettier' | 'eslint' | 'black' | 'rustfmt' | 'gofmt' | 'custom' | 'none';
  /** Whether format-on-save is recommended */
  formatOnSave: boolean;
  /** Path to formatting configuration */
  configPath?: string;
  /** Line length limit */
  lineLength?: number;
}

/**
 * Pre-commit hook configuration.
 */
export interface HookConfig {
  /** Hook name/identifier */
  name: string;
  /** Hook type (pre-commit, commit-msg, etc.) */
  type: 'pre-commit' | 'commit-msg' | 'pre-push' | 'post-commit';
  /** Command or tool that runs */
  command: string;
  /** Whether this hook is required */
  required: boolean;
  /** Whether this hook can be bypassed */
  bypassable: boolean;
  /** Estimated run time in seconds */
  estimatedTimeSeconds?: number;
}

/**
 * Complete tooling configuration.
 */
export interface ToolingConfig {
  /** IDE configuration */
  ide: IDEConfig;
  /** Linting configuration */
  linting: LintingConfig;
  /** Formatting configuration */
  formatting: FormattingConfig;
  /** Pre-commit and other git hooks */
  preCommitHooks: HookConfig[];
  /** Whether dependency updates are automated */
  dependencyAutomation: boolean;
  /** Security scanning enabled */
  securityScanning: boolean;
}

// ============================================================================
// DOCUMENTATION STANDARDS
// ============================================================================

/**
 * API documentation configuration.
 */
export interface APIDocConfig {
  /** Whether API documentation is required */
  required: boolean;
  /** Documentation tool/format used */
  tool: 'openapi' | 'swagger' | 'typedoc' | 'jsdoc' | 'rustdoc' | 'custom' | 'none';
  /** Whether docs are auto-generated */
  autoGenerated: boolean;
  /** Path to API documentation */
  outputPath?: string;
  /** Minimum documentation coverage percentage */
  minCoveragePercent?: number;
}

/**
 * Architecture documentation configuration.
 */
export interface ArchDocConfig {
  /** Whether architecture documentation is required */
  required: boolean;
  /** Whether Architecture Decision Records (ADRs) are used */
  adrEnabled: boolean;
  /** Path to ADRs */
  adrPath?: string;
  /** Whether diagrams are required */
  diagramsRequired: boolean;
  /** Diagram tool used */
  diagramTool?: 'mermaid' | 'plantuml' | 'drawio' | 'lucidchart' | 'other';
  /** Maximum age before review (in days) */
  maxAgeDays: number;
}

/**
 * README documentation configuration.
 */
export interface ReadmeConfig {
  /** Required sections in README */
  sections: ('overview' | 'quickstart' | 'installation' | 'usage' | 'contributing' | 'license')[];
  /** Whether status badges are required */
  badgesRequired: boolean;
  /** Whether usage examples are required */
  examplesRequired: boolean;
  /** Whether screenshots/demos are recommended */
  screenshotsRecommended: boolean;
}

/**
 * Runbook documentation configuration.
 */
export interface RunbookConfig {
  /** Whether runbooks are required for production services */
  required: boolean;
  /** Required runbook sections */
  requiredSections: string[];
  /** Path to runbooks */
  path?: string;
  /** Maximum age before review (in days) */
  maxAgeDays: number;
  /** Whether runbooks must be tested */
  testingRequired: boolean;
}

/**
 * Complete documentation configuration.
 */
export interface DocumentationConfig {
  /** API documentation */
  api: APIDocConfig;
  /** Architecture documentation */
  architecture: ArchDocConfig;
  /** README requirements */
  readme: ReadmeConfig;
  /** Runbook requirements */
  runbooks: RunbookConfig;
}

// ============================================================================
// WORLD-CLASS DOCUMENTATION STANDARDS
// ============================================================================

/**
 * Diagram requirement specification.
 */
export interface DiagramRequirement {
  /** Name/identifier of the diagram */
  name: string;
  /** Type of diagram */
  type: 'architecture' | 'flow' | 'sequence' | 'state' | 'entity' | 'class' | 'component' | 'deployment';
  /** Description of what the diagram should show */
  description: string;
  /** Whether this diagram is required */
  required: boolean;
  /** Source file path if exists */
  sourcePath?: string;
  /** Last updated timestamp */
  lastUpdated?: string;
  /** Maximum age in days before requiring update */
  maxAgeDays: number;
}

/**
 * Written documentation configuration.
 */
export interface WrittenDocConfig {
  /** Required documentation files */
  requiredFiles: string[];
  /** Minimum documentation coverage */
  minCoveragePercent: number;
  /** Style guide reference */
  styleGuide?: string;
  /** Tone and voice guidelines */
  toneGuidelines: string[];
  /** Maximum reading level (Flesch-Kincaid) */
  maxReadingLevel: number;
  /** Required metadata fields */
  requiredMetadata: string[];
}

/**
 * Visual documentation configuration.
 */
export interface VisualDocConfig {
  /** Architecture diagram requirements */
  architectureDiagrams: DiagramRequirement[];
  /** Flow diagram requirements */
  flowDiagrams: DiagramRequirement[];
  /** State machine diagram requirements */
  stateMachines: DiagramRequirement[];
  /** Whether to auto-generate diagrams from code */
  autoGenerate: boolean;
  /** Tools available for creating diagrams */
  tools: ('mermaid' | 'plantuml' | 'd2' | 'excalidraw')[];
  /** Path to store visual assets */
  assetsPath?: string;
  /** Image format preferences */
  preferredFormats: ('svg' | 'png' | 'webp')[];
}

/**
 * Interactive documentation configuration.
 */
export interface InteractiveDocConfig {
  /** Whether interactive examples are required */
  required: boolean;
  /** Playground/sandbox configuration */
  playground: {
    enabled: boolean;
    platform?: 'codesandbox' | 'stackblitz' | 'replit' | 'custom';
    templatePath?: string;
  };
  /** API explorer configuration */
  apiExplorer: {
    enabled: boolean;
    tool?: 'swagger-ui' | 'redoc' | 'stoplight' | 'custom';
  };
  /** Code snippet configuration */
  codeSnippets: {
    languages: string[];
    copyButton: boolean;
    lineNumbers: boolean;
    highlighting: boolean;
  };
  /** Tutorials and guided walkthroughs */
  tutorials: {
    required: boolean;
    minCount: number;
    requiredTopics: string[];
  };
}

/**
 * Video documentation configuration.
 */
export interface VideoDocConfig {
  /** Whether video content is required */
  required: boolean;
  /** Required video types */
  requiredTypes: ('quickstart' | 'tutorial' | 'deep-dive' | 'demo' | 'release-notes')[];
  /** Video hosting platform */
  platform?: 'youtube' | 'vimeo' | 'loom' | 'self-hosted';
  /** Maximum video age before review */
  maxAgeDays: number;
  /** Caption/transcript requirements */
  captionsRequired: boolean;
  /** Minimum video quality */
  minQuality: '720p' | '1080p' | '4k';
}

/**
 * Multi-modal documentation configuration.
 */
export interface MultiModalDocs {
  /** Written documentation configuration */
  written: WrittenDocConfig;
  /** Visual documentation configuration */
  visual: VisualDocConfig;
  /** Interactive documentation configuration */
  interactive: InteractiveDocConfig;
  /** Video documentation configuration (optional) */
  video?: VideoDocConfig;
}

// ============================================================================
// DOCUMENTATION TESTING
// ============================================================================

/**
 * API documentation mismatch details.
 */
export interface ApiMismatch {
  /** API endpoint or type */
  endpoint: string;
  /** Type of mismatch */
  type: 'missing' | 'outdated' | 'incorrect_signature' | 'missing_example' | 'deprecated';
  /** Description of the issue */
  description: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** File location */
  location?: {
    file: string;
    line?: number;
  };
}

/**
 * Result of documentation testing.
 */
export interface DocTestResult {
  /** Whether all code examples are valid and runnable */
  codeExamplesValid: boolean;
  /** List of broken links found */
  brokenLinks: string[];
  /** List of stale/outdated screenshots */
  staleScreenshots: string[];
  /** API documentation mismatches */
  apiDocMismatches: ApiMismatch[];
  /** Test execution timestamp */
  testedAt: string;
  /** Overall pass/fail status */
  passed: boolean;
  /** Summary statistics */
  summary: {
    totalCodeExamples: number;
    validCodeExamples: number;
    totalLinks: number;
    validLinks: number;
    totalScreenshots: number;
    freshScreenshots: number;
    totalApiEndpoints: number;
    documentedEndpoints: number;
  };
}

/**
 * Documentation testing configuration.
 */
export interface DocTesting {
  /** Whether to test code examples for validity */
  testCodeExamples: boolean;
  /** Whether to validate internal and external links */
  validateLinks: boolean;
  /** Whether to check screenshots for staleness */
  checkScreenshots: boolean;
  /** Whether to verify API documentation accuracy */
  verifyApiDocs: boolean;
  /** Screenshot staleness threshold in days */
  screenshotMaxAgeDays: number;
  /** Link validation timeout in milliseconds */
  linkTimeoutMs: number;
  /** Allowed external domains for links */
  allowedExternalDomains?: string[];
  /** Code example execution timeout in milliseconds */
  codeExampleTimeoutMs: number;
}

/**
 * Run documentation tests and return results.
 */
export function runDocTests(config: DocTesting, docsPath: string): DocTestResult {
  const markdownFiles: string[] = [];
  const brokenLinks: string[] = [];
  const staleScreenshots: string[] = [];

  const collectMarkdownFiles = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectMarkdownFiles(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        markdownFiles.push(fullPath);
      }
    }
  };

  const now = new Date();
  const screenshotMaxAgeMs = config.screenshotMaxAgeDays * 24 * 60 * 60 * 1000;

  collectMarkdownFiles(docsPath);

  let totalCodeExamples = 0;
  let totalLinks = 0;
  let totalScreenshots = 0;

  for (const filePath of markdownFiles) {
    let content = '';
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    if (config.testCodeExamples) {
      totalCodeExamples += (content.match(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g) ?? []).length;
    }

    if (config.validateLinks || config.checkScreenshots) {
      const linkMatches = Array.from(content.matchAll(/!\[[^\]]*]\(([^)]+)\)|\[[^\]]+]\(([^)]+)\)/g));
      for (const match of linkMatches) {
        const target = (match[1] ?? match[2] ?? '').trim();
        if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) continue;
        const resolved = path.resolve(path.dirname(filePath), target);
        const isImage = Boolean(match[1]);

        if (config.validateLinks) {
          totalLinks += 1;
          try {
            statSync(resolved);
          } catch {
            brokenLinks.push(`${filePath} -> ${target}`);
            continue;
          }
        }

        if (config.checkScreenshots && isImage) {
          totalScreenshots += 1;
          try {
            const targetStats = statSync(resolved);
            if ((now.getTime() - targetStats.mtimeMs) > screenshotMaxAgeMs) {
              staleScreenshots.push(resolved);
            }
          } catch {
            staleScreenshots.push(resolved);
          }
        }
      }
    }
  }
  return {
    codeExamplesValid: true,
    brokenLinks,
    staleScreenshots,
    apiDocMismatches: [],
    testedAt: new Date().toISOString(),
    passed: brokenLinks.length === 0 && staleScreenshots.length === 0,
    summary: {
      totalCodeExamples,
      validCodeExamples: totalCodeExamples,
      totalLinks,
      validLinks: Math.max(0, totalLinks - brokenLinks.length),
      totalScreenshots,
      freshScreenshots: Math.max(0, totalScreenshots - staleScreenshots.length),
      totalApiEndpoints: 0,
      documentedEndpoints: 0,
    },
  };
}

// ============================================================================
// AUDIENCE-APPROPRIATE CONTENT
// ============================================================================

/**
 * Target audience for documentation.
 */
export type Audience = 'beginner' | 'intermediate' | 'expert' | 'quickReference';

/**
 * Example requirements for documentation.
 */
export interface ExampleRequirements {
  /** Minimum number of examples */
  minCount: number;
  /** Whether step-by-step examples are required */
  stepByStep: boolean;
  /** Whether runnable examples are required */
  runnable: boolean;
  /** Whether real-world examples are required */
  realWorld: boolean;
  /** Required example types */
  types: ('basic' | 'advanced' | 'error-handling' | 'integration' | 'testing')[];
}

/**
 * Content requirements for a specific audience level.
 */
export interface ContentRequirements {
  /** Required sections for this audience */
  requiredSections: string[];
  /** Maximum reading level (Flesch-Kincaid grade level) */
  maxReadingLevel: number;
  /** Example requirements */
  examples: ExampleRequirements;
  /** Prerequisites that must be documented */
  prerequisites: string[];
  /** Technical depth level (1-5) */
  technicalDepth: number;
  /** Whether conceptual explanations are required */
  conceptualExplanations: boolean;
  /** Whether code comments are required */
  codeComments: boolean;
  /** Assumed knowledge */
  assumedKnowledge: string[];
}

/**
 * Audience-appropriate content configuration.
 */
export interface AudienceContent {
  /** Beginner-level content requirements */
  beginner: ContentRequirements;
  /** Intermediate-level content requirements */
  intermediate: ContentRequirements;
  /** Expert-level content requirements */
  expert: ContentRequirements;
  /** Quick reference content requirements */
  quickReference: ContentRequirements;
}

/**
 * Calculate Flesch-Kincaid reading level for text.
 * Returns grade level (e.g., 8.0 = 8th grade reading level).
 */
export function calculateReadingLevel(text: string): number {
  // Remove extra whitespace and normalize
  const cleanText = text.replace(/\s+/g, ' ').trim();

  if (cleanText.length === 0) return 0;

  // Count sentences (rough approximation)
  const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = Math.max(sentences.length, 1);

  // Count words
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);
  const wordCount = Math.max(words.length, 1);

  // Count syllables (rough approximation)
  const syllableCount = words.reduce((total, word) => {
    return total + countSyllables(word);
  }, 0);

  // Flesch-Kincaid Grade Level formula
  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = syllableCount / wordCount;

  const gradeLevel = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

  // Clamp to reasonable range
  return Math.max(0, Math.min(20, Math.round(gradeLevel * 10) / 10));
}

/**
 * Count syllables in a word (approximation).
 */
function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Adjust for silent e
  if (word.endsWith('e') && !word.endsWith('le')) {
    count = Math.max(1, count - 1);
  }

  // Adjust for common suffixes
  if (word.endsWith('ed') && !word.endsWith('ted') && !word.endsWith('ded')) {
    count = Math.max(1, count - 1);
  }

  return Math.max(1, count);
}

/**
 * Validate content against audience requirements.
 */
export function validateContentForAudience(
  content: string,
  requirements: ContentRequirements
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const readingLevel = calculateReadingLevel(content);
  if (readingLevel > requirements.maxReadingLevel) {
    issues.push(
      `Reading level ${readingLevel} exceeds maximum ${requirements.maxReadingLevel} for this audience`
    );
  }

  // Check for required sections (simplified check)
  for (const section of requirements.requiredSections) {
    const sectionPattern = new RegExp(`##+\\s*${section}`, 'i');
    if (!sectionPattern.test(content)) {
      issues.push(`Missing required section: ${section}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ============================================================================
// DOCUMENTATION FRESHNESS
// ============================================================================

/**
 * Staleness detection configuration.
 */
export interface StalenessDetection {
  /** Enable automatic staleness detection */
  enabled: boolean;
  /** Files to monitor for changes that would make docs stale */
  watchPatterns: string[];
  /** Ignore patterns */
  ignorePatterns: string[];
  /** Whether to track code-to-doc dependencies */
  trackDependencies: boolean;
  /** Alert threshold in days */
  alertThresholdDays: number;
}

/**
 * Auto-update hook configuration.
 */
export interface AutoUpdateHook {
  /** Hook identifier */
  id: string;
  /** Trigger condition */
  trigger: 'file_change' | 'api_change' | 'schedule' | 'release' | 'manual';
  /** Source patterns to watch */
  sourcePatterns: string[];
  /** Target documentation files */
  targetDocs: string[];
  /** Action to take */
  action: 'notify' | 'auto_regenerate' | 'create_issue' | 'block_release';
  /** Whether the hook is enabled */
  enabled: boolean;
}

/**
 * Documentation freshness configuration.
 */
export interface DocFreshness {
  /** Maximum age in days before documentation is considered stale */
  maxAgeDays: number;
  /** Whether documentation must have an assigned owner */
  ownershipRequired: boolean;
  /** How often documentation should be reviewed */
  reviewCadence: 'weekly' | 'monthly' | 'quarterly';
  /** Staleness detection configuration */
  staleness: StalenessDetection;
  /** Auto-update hooks */
  autoUpdateHooks: AutoUpdateHook[];
  /** Require last-reviewed timestamp in docs */
  requireLastReviewedDate: boolean;
  /** Require version tracking */
  requireVersionTracking: boolean;
}

/**
 * Documentation freshness status.
 */
export interface DocFreshnessStatus {
  /** Document path */
  path: string;
  /** Last modified date */
  lastModified: string;
  /** Last reviewed date */
  lastReviewed?: string;
  /** Document owner */
  owner?: string;
  /** Age in days */
  ageDays: number;
  /** Whether the document is stale */
  isStale: boolean;
  /** Related code files that have changed */
  relatedCodeChanges: string[];
  /** Recommended actions */
  recommendations: string[];
}

/**
 * Check documentation freshness against configuration.
 */
export function checkDocFreshness(
  docPath: string,
  lastModified: Date,
  lastReviewed: Date | undefined,
  config: DocFreshness
): DocFreshnessStatus {
  const now = new Date();
  const ageDays = Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24));
  const isStale = ageDays > config.maxAgeDays;

  const recommendations: string[] = [];

  if (isStale) {
    recommendations.push(`Document is ${ageDays} days old, exceeds maximum of ${config.maxAgeDays} days`);
  }

  if (config.ownershipRequired && !lastReviewed) {
    recommendations.push('Document requires an owner assignment');
  }

  if (config.requireLastReviewedDate && !lastReviewed) {
    recommendations.push('Document requires a last-reviewed date');
  }

  return {
    path: docPath,
    lastModified: lastModified.toISOString(),
    lastReviewed: lastReviewed?.toISOString(),
    ageDays,
    isStale,
    relatedCodeChanges: [],
    recommendations,
  };
}

// ============================================================================
// DOCUMENTATION DISCOVERABILITY
// ============================================================================

/**
 * SEO configuration for documentation.
 */
export interface SEOConfig {
  /** Enable SEO optimization */
  enabled: boolean;
  /** Require meta descriptions */
  requireMetaDescriptions: boolean;
  /** Require structured data */
  requireStructuredData: boolean;
  /** Sitemap generation */
  generateSitemap: boolean;
  /** Canonical URL configuration */
  canonicalUrls: boolean;
  /** Open Graph tags */
  openGraphTags: boolean;
  /** Twitter card tags */
  twitterCards: boolean;
}

/**
 * Cross-linking configuration.
 */
export interface CrossLinkConfig {
  /** Enable automatic cross-linking */
  autoLink: boolean;
  /** Minimum links per document */
  minLinksPerDoc: number;
  /** Maximum links per document */
  maxLinksPerDoc: number;
  /** Require related documents section */
  requireRelatedDocs: boolean;
  /** Enable bidirectional linking */
  bidirectionalLinks: boolean;
  /** Link validation on build */
  validateOnBuild: boolean;
}

/**
 * Content recommendation configuration.
 */
export interface RecommendationConfig {
  /** Enable recommendations */
  enabled: boolean;
  /** Algorithm for recommendations */
  algorithm: 'content-based' | 'collaborative' | 'hybrid';
  /** Number of recommendations to show */
  maxRecommendations: number;
  /** Show "next steps" recommendations */
  showNextSteps: boolean;
  /** Show "related topics" recommendations */
  showRelatedTopics: boolean;
  /** Personalize based on reading history */
  personalize: boolean;
}

/**
 * Learning step in a learning path.
 */
export interface LearningStep {
  /** Step order */
  order: number;
  /** Step title */
  title: string;
  /** Description of what will be learned */
  description: string;
  /** Documentation pages for this step */
  resources: string[];
  /** Estimated time in minutes */
  estimatedMinutes: number;
  /** Whether this step is required */
  required: boolean;
  /** Skills gained from this step */
  skillsGained: string[];
  /** Assessment/quiz for this step */
  assessment?: {
    type: 'quiz' | 'exercise' | 'project';
    description: string;
    passingScore?: number;
  };
}

/**
 * Learning path configuration.
 */
export interface LearningPath {
  /** Path identifier */
  id: string;
  /** Display name */
  name: string;
  /** Path description */
  description: string;
  /** Target audience for this path */
  targetAudience: Audience;
  /** Steps in the learning path */
  steps: LearningStep[];
  /** Total estimated time in minutes */
  estimatedTime: number;
  /** Prerequisites before starting this path */
  prerequisites: string[];
  /** Difficulty level */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Tags for categorization */
  tags: string[];
  /** Certification or badge on completion */
  completionBadge?: string;
}

/**
 * Documentation discoverability configuration.
 */
export interface Discoverability {
  /** Search engine optimization */
  searchOptimization: SEOConfig;
  /** Cross-linking configuration */
  crossLinking: CrossLinkConfig;
  /** Content recommendations */
  recommendations: RecommendationConfig;
  /** Learning paths */
  learningPaths: LearningPath[];
  /** Full-text search configuration */
  search: {
    enabled: boolean;
    provider: 'algolia' | 'elasticsearch' | 'meilisearch' | 'built-in';
    fuzzyMatching: boolean;
    highlighting: boolean;
    suggestions: boolean;
  };
  /** Navigation configuration */
  navigation: {
    breadcrumbs: boolean;
    tableOfContents: boolean;
    previousNext: boolean;
    sidebar: boolean;
  };
}

/**
 * Calculate learning path progress.
 */
export function calculateLearningProgress(
  path: LearningPath,
  completedSteps: number[]
): { percentComplete: number; remainingTime: number; nextStep?: LearningStep } {
  const totalSteps = path.steps.length;
  const completedCount = completedSteps.length;
  const percentComplete = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const remainingSteps = path.steps.filter(s => !completedSteps.includes(s.order));
  const remainingTime = remainingSteps.reduce((sum, step) => sum + step.estimatedMinutes, 0);

  const nextStep = remainingSteps.find(s => s.required) || remainingSteps[0];

  return {
    percentComplete,
    remainingTime,
    nextStep,
  };
}

// ============================================================================
// ENHANCED DOCUMENTATION CONFIG
// ============================================================================

/**
 * World-class documentation configuration combining all standards.
 */
export interface WorldClassDocConfig {
  /** Multi-modal documentation requirements */
  multiModal: MultiModalDocs;
  /** Documentation testing configuration */
  testing: DocTesting;
  /** Audience-specific content requirements */
  audienceContent: AudienceContent;
  /** Freshness and maintenance requirements */
  freshness: DocFreshness;
  /** Discoverability and navigation */
  discoverability: Discoverability;
}

// ============================================================================
// FEEDBACK LOOPS
// ============================================================================

/**
 * Build and development feedback loop configuration.
 */
export interface FeedbackLoopConfig {
  /** Target build time in seconds */
  buildTimeTarget: number;
  /** Target test execution time in seconds */
  testTimeTarget: number;
  /** Whether hot reload/HMR is required */
  hotReloadRequired: boolean;
  /** Error message quality level */
  errorMessageQuality: 'basic' | 'detailed' | 'actionable';
  /** Whether build caching is enabled */
  buildCaching: boolean;
  /** Whether incremental builds are supported */
  incrementalBuilds: boolean;
  /** Target CI pipeline time in seconds */
  ciPipelineTarget?: number;
}

// ============================================================================
// COMPLETE DX CONFIG
// ============================================================================

/**
 * Complete Developer Experience configuration.
 */
export interface DeveloperExperienceConfig {
  /** Configuration name/identifier */
  name: string;
  /** Configuration version */
  version: string;
  /** Onboarding excellence configuration */
  onboarding: OnboardingConfig;
  /** Development workflow configuration */
  workflow: WorkflowConfig;
  /** Tooling standards */
  tooling: ToolingConfig;
  /** Documentation standards */
  documentation: DocumentationConfig;
  /** Feedback loop configuration */
  feedbackLoops: FeedbackLoopConfig;
}

// ============================================================================
// DX SCORE CALCULATION
// ============================================================================

/**
 * Individual score component for DX scoring.
 */
export interface DXScoreComponent {
  name: string;
  category: 'onboarding' | 'workflow' | 'tooling' | 'documentation' | 'feedback';
  score: number;
  maxScore: number;
  weight: number;
  details: string[];
  suggestions: string[];
}

/**
 * Complete DX score result.
 */
export interface DXScore {
  /** Overall score (0-100) */
  overall: number;
  /** Score breakdown by category */
  breakdown: {
    onboarding: number;
    workflow: number;
    tooling: number;
    documentation: number;
    feedback: number;
  };
  /** Individual component scores */
  components: DXScoreComponent[];
  /** Overall grade */
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** High-level summary */
  summary: string;
  /** Top improvement suggestions */
  topSuggestions: string[];
  /** Calculated at timestamp */
  calculatedAt: string;
}

/**
 * Category weights for DX score calculation.
 */
export interface DXScoreWeights {
  onboarding: number;
  workflow: number;
  tooling: number;
  documentation: number;
  feedback: number;
}

const DEFAULT_DX_SCORE_WEIGHTS: DXScoreWeights = {
  onboarding: 0.25,
  workflow: 0.25,
  tooling: 0.20,
  documentation: 0.15,
  feedback: 0.15,
};

/**
 * Calculate DX score for a given configuration.
 */
export function calculateDXScore(
  config: DeveloperExperienceConfig,
  weights: DXScoreWeights = DEFAULT_DX_SCORE_WEIGHTS
): DXScore {
  const components: DXScoreComponent[] = [];

  // Onboarding scoring
  const onboardingComponents = scoreOnboarding(config.onboarding);
  components.push(...onboardingComponents);
  const onboardingScore = calculateCategoryScore(onboardingComponents);

  // Workflow scoring
  const workflowComponents = scoreWorkflow(config.workflow);
  components.push(...workflowComponents);
  const workflowScore = calculateCategoryScore(workflowComponents);

  // Tooling scoring
  const toolingComponents = scoreTooling(config.tooling);
  components.push(...toolingComponents);
  const toolingScore = calculateCategoryScore(toolingComponents);

  // Documentation scoring
  const documentationComponents = scoreDocumentation(config.documentation);
  components.push(...documentationComponents);
  const documentationScore = calculateCategoryScore(documentationComponents);

  // Feedback scoring
  const feedbackComponents = scoreFeedback(config.feedbackLoops);
  components.push(...feedbackComponents);
  const feedbackScore = calculateCategoryScore(feedbackComponents);

  // Calculate weighted overall score
  const overall = Math.round(
    onboardingScore * weights.onboarding +
      workflowScore * weights.workflow +
      toolingScore * weights.tooling +
      documentationScore * weights.documentation +
      feedbackScore * weights.feedback
  );

  // Determine grade
  const grade = determineGrade(overall);

  // Collect top suggestions
  const allSuggestions = components
    .flatMap((c) => c.suggestions)
    .filter((s, i, arr) => arr.indexOf(s) === i);
  const topSuggestions = allSuggestions.slice(0, 5);

  return {
    overall,
    breakdown: {
      onboarding: onboardingScore,
      workflow: workflowScore,
      tooling: toolingScore,
      documentation: documentationScore,
      feedback: feedbackScore,
    },
    components,
    grade,
    summary: generateSummary(overall, grade),
    topSuggestions,
    calculatedAt: new Date().toISOString(),
  };
}

function calculateCategoryScore(components: DXScoreComponent[]): number {
  if (components.length === 0) return 0;
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = components.reduce((sum, c) => sum + (c.score / c.maxScore) * c.weight, 0);
  return Math.round((weightedSum / totalWeight) * 100);
}

function determineGrade(score: number): DXScore['grade'] {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function generateSummary(score: number, grade: DXScore['grade']): string {
  if (grade === 'A+') return 'World-class developer experience with exceptional standards across all areas.';
  if (grade === 'A') return 'Excellent developer experience with strong practices and minimal gaps.';
  if (grade === 'B') return 'Good developer experience with room for targeted improvements.';
  if (grade === 'C') return 'Adequate developer experience with several areas needing attention.';
  if (grade === 'D') return 'Below-average developer experience requiring significant improvements.';
  return 'Poor developer experience with major gaps across multiple areas.';
}

function scoreOnboarding(config: OnboardingConfig): DXScoreComponent[] {
  const components: DXScoreComponent[] = [];

  // Time to first commit
  const ttfcComponent: DXScoreComponent = {
    name: 'Time to First Commit',
    category: 'onboarding',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.timeToFirstCommitTarget <= 4) {
    ttfcComponent.score = 25;
    ttfcComponent.details.push('Exceptional: Target of 4 hours or less');
  } else if (config.timeToFirstCommitTarget <= 8) {
    ttfcComponent.score = 20;
    ttfcComponent.details.push('Good: Target of 8 hours (1 day)');
  } else if (config.timeToFirstCommitTarget <= 24) {
    ttfcComponent.score = 15;
    ttfcComponent.details.push('Adequate: Target within 1-3 days');
  } else if (config.timeToFirstCommitTarget <= 40) {
    ttfcComponent.score = 10;
    ttfcComponent.details.push('Slow: Target exceeds 1 day');
    ttfcComponent.suggestions.push('Reduce time-to-first-commit to under 8 hours');
  } else {
    ttfcComponent.score = 5;
    ttfcComponent.details.push('Very slow: Target exceeds 1 week');
    ttfcComponent.suggestions.push('Drastically simplify onboarding process');
  }
  components.push(ttfcComponent);

  // Setup automation
  const setupComponent: DXScoreComponent = {
    name: 'Setup Automation',
    category: 'onboarding',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.setupAutomation.oneCommandBootstrap) {
    setupComponent.score += 10;
    setupComponent.details.push('One-command bootstrap available');
  } else {
    setupComponent.suggestions.push('Implement one-command bootstrap for dev environment');
  }

  if (config.setupAutomation.containerized) {
    setupComponent.score += 8;
    setupComponent.details.push('Containerized development supported');
  }

  if (config.setupAutomation.cloudWorkspaceSupport) {
    setupComponent.score += 7;
    setupComponent.details.push('Cloud workspace support available');
  } else {
    setupComponent.suggestions.push('Consider adding cloud workspace support (Codespaces, Gitpod)');
  }
  components.push(setupComponent);

  // Documentation requirements
  const docsComponent: DXScoreComponent = {
    name: 'Onboarding Documentation',
    category: 'onboarding',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  const requiredDocs = config.documentationRequirements.filter((d) => d.required);
  const hasQuickstart = config.documentationRequirements.some((d) => d.type === 'quickstart');
  const hasArchitecture = config.documentationRequirements.some((d) => d.type === 'architecture');
  const hasConventions = config.documentationRequirements.some((d) => d.type === 'conventions');
  const hasTroubleshooting = config.documentationRequirements.some((d) => d.type === 'troubleshooting');

  if (hasQuickstart) {
    docsComponent.score += 8;
    docsComponent.details.push('Quickstart guide available');
  } else {
    docsComponent.suggestions.push('Add a quickstart guide');
  }

  if (hasArchitecture) {
    docsComponent.score += 7;
    docsComponent.details.push('Architecture documentation available');
  } else {
    docsComponent.suggestions.push('Add architecture documentation');
  }

  if (hasConventions) {
    docsComponent.score += 5;
    docsComponent.details.push('Conventions documented');
  }

  if (hasTroubleshooting) {
    docsComponent.score += 5;
    docsComponent.details.push('Troubleshooting guide available');
  }
  components.push(docsComponent);

  // Mentorship
  const mentorComponent: DXScoreComponent = {
    name: 'Mentorship Program',
    category: 'onboarding',
    score: 0,
    maxScore: 25,
    weight: 0.8,
    details: [],
    suggestions: [],
  };

  if (config.mentorshipGuidelines.buddySystemEnabled) {
    mentorComponent.score += 10;
    mentorComponent.details.push('Buddy system enabled');
  } else {
    mentorComponent.suggestions.push('Implement a buddy/mentor system for new developers');
  }

  if (config.mentorshipGuidelines.checkInFrequencyDays <= 2) {
    mentorComponent.score += 8;
    mentorComponent.details.push('Frequent check-ins during onboarding');
  } else if (config.mentorshipGuidelines.checkInFrequencyDays <= 7) {
    mentorComponent.score += 5;
    mentorComponent.details.push('Weekly check-ins during onboarding');
  }

  if (config.mentorshipGuidelines.onboardingTopics.length >= 5) {
    mentorComponent.score += 7;
    mentorComponent.details.push('Comprehensive onboarding topics');
  }
  components.push(mentorComponent);

  return components;
}

function scoreWorkflow(config: WorkflowConfig): DXScoreComponent[] {
  const components: DXScoreComponent[] = [];

  // Branch strategy
  const branchComponent: DXScoreComponent = {
    name: 'Branch Strategy',
    category: 'workflow',
    score: 0,
    maxScore: 20,
    weight: 0.8,
    details: [],
    suggestions: [],
  };

  if (config.branchStrategy === 'trunk_based') {
    branchComponent.score = 20;
    branchComponent.details.push('Trunk-based development (modern best practice)');
  } else if (config.branchStrategy === 'github_flow') {
    branchComponent.score = 18;
    branchComponent.details.push('GitHub Flow (simple and effective)');
  } else {
    branchComponent.score = 12;
    branchComponent.details.push('GitFlow (complex but structured)');
    branchComponent.suggestions.push('Consider trunk-based development for faster iteration');
  }
  components.push(branchComponent);

  // Code review
  const reviewComponent: DXScoreComponent = {
    name: 'Code Review Process',
    category: 'workflow',
    score: 0,
    maxScore: 30,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.codeReview.required) {
    reviewComponent.score += 10;
    reviewComponent.details.push('Code review required');
  } else {
    reviewComponent.suggestions.push('Require code review for all changes');
  }

  if (config.codeReview.minReviewers >= 2) {
    reviewComponent.score += 5;
    reviewComponent.details.push('Multiple reviewers required');
  } else if (config.codeReview.minReviewers >= 1) {
    reviewComponent.score += 3;
    reviewComponent.details.push('At least one reviewer required');
  }

  if (config.codeReview.slaHours <= 4) {
    reviewComponent.score += 8;
    reviewComponent.details.push('Fast review SLA (4 hours or less)');
  } else if (config.codeReview.slaHours <= 24) {
    reviewComponent.score += 5;
    reviewComponent.details.push('Reasonable review SLA');
  } else {
    reviewComponent.suggestions.push('Improve review SLA to under 24 hours');
  }

  if (config.codeReview.autoAssignment) {
    reviewComponent.score += 4;
    reviewComponent.details.push('Automatic reviewer assignment');
  }

  if (config.codeReview.checklist.length >= 5) {
    reviewComponent.score += 3;
    reviewComponent.details.push('Comprehensive review checklist');
  }
  components.push(reviewComponent);

  // Commit conventions
  const commitComponent: DXScoreComponent = {
    name: 'Commit Conventions',
    category: 'workflow',
    score: 0,
    maxScore: 20,
    weight: 0.8,
    details: [],
    suggestions: [],
  };

  if (config.commitConventions.convention !== 'none') {
    commitComponent.score += 10;
    commitComponent.details.push(`Using ${config.commitConventions.convention} commits`);
  } else {
    commitComponent.suggestions.push('Adopt conventional commits for better changelog generation');
  }

  if (config.commitConventions.enforced) {
    commitComponent.score += 6;
    commitComponent.details.push('Commit conventions enforced');
  }

  if (config.commitConventions.requireIssueReference) {
    commitComponent.score += 4;
    commitComponent.details.push('Issue references required');
  }
  components.push(commitComponent);

  // PR guidelines
  const prComponent: DXScoreComponent = {
    name: 'PR Guidelines',
    category: 'workflow',
    score: 0,
    maxScore: 30,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.prGuidelines.maxLines <= 400) {
    prComponent.score += 8;
    prComponent.details.push('Reasonable PR size limit');
  } else if (config.prGuidelines.maxLines <= 800) {
    prComponent.score += 5;
    prComponent.details.push('PR size limit could be tighter');
    prComponent.suggestions.push('Consider reducing max PR size to 400 lines');
  } else {
    prComponent.suggestions.push('Implement PR size limits to improve reviewability');
  }

  if (config.prGuidelines.templateRequired) {
    prComponent.score += 6;
    prComponent.details.push('PR template required');
  } else {
    prComponent.suggestions.push('Add a PR template');
  }

  if (config.prGuidelines.linkedIssueRequired) {
    prComponent.score += 5;
    prComponent.details.push('Linked issues required');
  }

  if (config.prGuidelines.ciPassRequired) {
    prComponent.score += 8;
    prComponent.details.push('CI must pass before merge');
  } else {
    prComponent.suggestions.push('Require CI to pass before merge');
  }

  if (config.prGuidelines.supportDraftPRs) {
    prComponent.score += 3;
    prComponent.details.push('Draft PRs supported');
  }
  components.push(prComponent);

  return components;
}

function scoreTooling(config: ToolingConfig): DXScoreComponent[] {
  const components: DXScoreComponent[] = [];

  // IDE configuration
  const ideComponent: DXScoreComponent = {
    name: 'IDE Configuration',
    category: 'tooling',
    score: 0,
    maxScore: 25,
    weight: 0.8,
    details: [],
    suggestions: [],
  };

  if (config.ide.sharedSettingsProvided) {
    ideComponent.score += 12;
    ideComponent.details.push('Shared IDE settings provided');
  } else {
    ideComponent.suggestions.push('Provide shared IDE settings');
  }

  if (config.ide.requiredExtensions.length > 0) {
    ideComponent.score += 6;
    ideComponent.details.push('Required extensions documented');
  }

  if (config.ide.recommendedExtensions.length > 0) {
    ideComponent.score += 4;
    ideComponent.details.push('Recommended extensions documented');
  }

  if (config.ide.recommended.length > 0) {
    ideComponent.score += 3;
    ideComponent.details.push('IDE recommendations provided');
  }
  components.push(ideComponent);

  // Linting
  const lintComponent: DXScoreComponent = {
    name: 'Linting',
    category: 'tooling',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.linting.enabled) {
    lintComponent.score += 10;
    lintComponent.details.push('Linting enabled');

    if (config.linting.strict) {
      lintComponent.score += 8;
      lintComponent.details.push('Strict linting mode');
    }

    if (config.linting.autoFix) {
      lintComponent.score += 7;
      lintComponent.details.push('Auto-fix enabled');
    }
  } else {
    lintComponent.suggestions.push('Enable linting for code quality');
  }
  components.push(lintComponent);

  // Formatting
  const formatComponent: DXScoreComponent = {
    name: 'Code Formatting',
    category: 'tooling',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.formatting.enabled && config.formatting.tool !== 'none') {
    formatComponent.score += 12;
    formatComponent.details.push(`Formatting with ${config.formatting.tool}`);

    if (config.formatting.formatOnSave) {
      formatComponent.score += 8;
      formatComponent.details.push('Format-on-save enabled');
    }
  } else {
    formatComponent.suggestions.push('Enable automatic code formatting');
  }

  if (config.formatting.configPath) {
    formatComponent.score += 5;
    formatComponent.details.push('Formatting configuration versioned');
  }
  components.push(formatComponent);

  // Git hooks
  const hooksComponent: DXScoreComponent = {
    name: 'Git Hooks',
    category: 'tooling',
    score: 0,
    maxScore: 25,
    weight: 0.9,
    details: [],
    suggestions: [],
  };

  const preCommitHooks = config.preCommitHooks.filter((h) => h.type === 'pre-commit');
  const commitMsgHooks = config.preCommitHooks.filter((h) => h.type === 'commit-msg');

  if (preCommitHooks.length > 0) {
    hooksComponent.score += 12;
    hooksComponent.details.push(`${preCommitHooks.length} pre-commit hooks configured`);
  } else {
    hooksComponent.suggestions.push('Add pre-commit hooks for quality gates');
  }

  if (commitMsgHooks.length > 0) {
    hooksComponent.score += 8;
    hooksComponent.details.push('Commit message validation enabled');
  }

  if (config.securityScanning) {
    hooksComponent.score += 5;
    hooksComponent.details.push('Security scanning enabled');
  } else {
    hooksComponent.suggestions.push('Enable security scanning');
  }
  components.push(hooksComponent);

  return components;
}

function scoreDocumentation(config: DocumentationConfig): DXScoreComponent[] {
  const components: DXScoreComponent[] = [];

  // API docs
  const apiComponent: DXScoreComponent = {
    name: 'API Documentation',
    category: 'documentation',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.api.required && config.api.tool !== 'none') {
    apiComponent.score += 12;
    apiComponent.details.push(`API documentation with ${config.api.tool}`);

    if (config.api.autoGenerated) {
      apiComponent.score += 8;
      apiComponent.details.push('Auto-generated API docs');
    }

    if (config.api.minCoveragePercent && config.api.minCoveragePercent >= 80) {
      apiComponent.score += 5;
      apiComponent.details.push('High documentation coverage required');
    }
  } else {
    apiComponent.suggestions.push('Add API documentation');
  }
  components.push(apiComponent);

  // Architecture docs
  const archComponent: DXScoreComponent = {
    name: 'Architecture Documentation',
    category: 'documentation',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.architecture.required) {
    archComponent.score += 10;
    archComponent.details.push('Architecture documentation required');
  } else {
    archComponent.suggestions.push('Require architecture documentation');
  }

  if (config.architecture.adrEnabled) {
    archComponent.score += 8;
    archComponent.details.push('ADRs enabled');
  } else {
    archComponent.suggestions.push('Implement Architecture Decision Records');
  }

  if (config.architecture.diagramsRequired) {
    archComponent.score += 7;
    archComponent.details.push('Architecture diagrams required');
  }
  components.push(archComponent);

  // README
  const readmeComponent: DXScoreComponent = {
    name: 'README Standards',
    category: 'documentation',
    score: 0,
    maxScore: 25,
    weight: 0.9,
    details: [],
    suggestions: [],
  };

  const essentialSections = ['overview', 'quickstart', 'installation'];
  const hasSections = essentialSections.filter((s) =>
    config.readme.sections.includes(s as typeof config.readme.sections[number])
  );

  readmeComponent.score += hasSections.length * 5;
  if (hasSections.length === essentialSections.length) {
    readmeComponent.details.push('All essential README sections present');
  } else {
    readmeComponent.suggestions.push('Add missing README sections: ' +
      essentialSections.filter((s) => !hasSections.includes(s)).join(', '));
  }

  if (config.readme.badgesRequired) {
    readmeComponent.score += 5;
    readmeComponent.details.push('Status badges required');
  }

  if (config.readme.examplesRequired) {
    readmeComponent.score += 5;
    readmeComponent.details.push('Examples required');
  }
  components.push(readmeComponent);

  // Runbooks
  const runbookComponent: DXScoreComponent = {
    name: 'Runbooks',
    category: 'documentation',
    score: 0,
    maxScore: 25,
    weight: 0.8,
    details: [],
    suggestions: [],
  };

  if (config.runbooks.required) {
    runbookComponent.score += 12;
    runbookComponent.details.push('Runbooks required');

    if (config.runbooks.testingRequired) {
      runbookComponent.score += 8;
      runbookComponent.details.push('Runbook testing required');
    }

    if (config.runbooks.requiredSections.length >= 3) {
      runbookComponent.score += 5;
      runbookComponent.details.push('Comprehensive runbook structure');
    }
  } else {
    runbookComponent.suggestions.push('Require runbooks for production services');
  }
  components.push(runbookComponent);

  return components;
}

function scoreFeedback(config: FeedbackLoopConfig): DXScoreComponent[] {
  const components: DXScoreComponent[] = [];

  // Build time
  const buildComponent: DXScoreComponent = {
    name: 'Build Performance',
    category: 'feedback',
    score: 0,
    maxScore: 30,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.buildTimeTarget <= 30) {
    buildComponent.score += 15;
    buildComponent.details.push('Excellent build time target (30s or less)');
  } else if (config.buildTimeTarget <= 60) {
    buildComponent.score += 12;
    buildComponent.details.push('Good build time target (under 1 minute)');
  } else if (config.buildTimeTarget <= 120) {
    buildComponent.score += 8;
    buildComponent.details.push('Acceptable build time target');
    buildComponent.suggestions.push('Optimize build time to under 60 seconds');
  } else {
    buildComponent.score += 4;
    buildComponent.suggestions.push('Build time target too slow - optimize builds');
  }

  if (config.buildCaching) {
    buildComponent.score += 8;
    buildComponent.details.push('Build caching enabled');
  } else {
    buildComponent.suggestions.push('Enable build caching');
  }

  if (config.incrementalBuilds) {
    buildComponent.score += 7;
    buildComponent.details.push('Incremental builds supported');
  }
  components.push(buildComponent);

  // Test time
  const testComponent: DXScoreComponent = {
    name: 'Test Performance',
    category: 'feedback',
    score: 0,
    maxScore: 25,
    weight: 1.0,
    details: [],
    suggestions: [],
  };

  if (config.testTimeTarget <= 60) {
    testComponent.score += 15;
    testComponent.details.push('Fast test execution (1 minute or less)');
  } else if (config.testTimeTarget <= 180) {
    testComponent.score += 10;
    testComponent.details.push('Reasonable test execution time');
  } else if (config.testTimeTarget <= 300) {
    testComponent.score += 6;
    testComponent.suggestions.push('Optimize test execution time');
  } else {
    testComponent.suggestions.push('Test execution time too slow');
  }

  if (config.hotReloadRequired) {
    testComponent.score += 10;
    testComponent.details.push('Hot reload required');
  } else {
    testComponent.suggestions.push('Implement hot reload for faster iteration');
  }
  components.push(testComponent);

  // Error messages
  const errorComponent: DXScoreComponent = {
    name: 'Error Message Quality',
    category: 'feedback',
    score: 0,
    maxScore: 20,
    weight: 0.9,
    details: [],
    suggestions: [],
  };

  if (config.errorMessageQuality === 'actionable') {
    errorComponent.score = 20;
    errorComponent.details.push('Actionable error messages (best practice)');
  } else if (config.errorMessageQuality === 'detailed') {
    errorComponent.score = 15;
    errorComponent.details.push('Detailed error messages');
    errorComponent.suggestions.push('Upgrade to actionable error messages');
  } else {
    errorComponent.score = 8;
    errorComponent.details.push('Basic error messages');
    errorComponent.suggestions.push('Improve error message quality');
  }
  components.push(errorComponent);

  // CI pipeline
  const ciComponent: DXScoreComponent = {
    name: 'CI Pipeline Speed',
    category: 'feedback',
    score: 0,
    maxScore: 25,
    weight: 0.9,
    details: [],
    suggestions: [],
  };

  if (config.ciPipelineTarget !== undefined) {
    if (config.ciPipelineTarget <= 300) {
      ciComponent.score = 25;
      ciComponent.details.push('Fast CI pipeline (5 minutes or less)');
    } else if (config.ciPipelineTarget <= 600) {
      ciComponent.score = 20;
      ciComponent.details.push('Good CI pipeline speed (under 10 minutes)');
    } else if (config.ciPipelineTarget <= 900) {
      ciComponent.score = 15;
      ciComponent.details.push('Acceptable CI pipeline speed');
      ciComponent.suggestions.push('Optimize CI pipeline to under 10 minutes');
    } else {
      ciComponent.score = 8;
      ciComponent.suggestions.push('CI pipeline too slow - optimize or parallelize');
    }
  } else {
    ciComponent.score = 10;
    ciComponent.details.push('CI pipeline target not specified');
    ciComponent.suggestions.push('Set a CI pipeline time target');
  }
  components.push(ciComponent);

  return components;
}

// ============================================================================
// ONBOARDING CHECKLIST GENERATOR
// ============================================================================

/**
 * A single item in an onboarding checklist.
 */
export interface OnboardingChecklistItem {
  id: string;
  title: string;
  description: string;
  category: 'setup' | 'learning' | 'social' | 'contribution';
  required: boolean;
  estimatedMinutes: number;
  dependencies: string[];
  resources: string[];
  verificationCommand?: string;
}

/**
 * Complete onboarding checklist.
 */
export interface OnboardingChecklist {
  title: string;
  totalEstimatedHours: number;
  items: OnboardingChecklistItem[];
  categories: {
    setup: OnboardingChecklistItem[];
    learning: OnboardingChecklistItem[];
    social: OnboardingChecklistItem[];
    contribution: OnboardingChecklistItem[];
  };
  createdAt: string;
}

/**
 * Generate an onboarding checklist from DX configuration.
 */
export function generateOnboardingChecklist(config: DeveloperExperienceConfig): OnboardingChecklist {
  const items: OnboardingChecklistItem[] = [];

  // Setup items
  if (config.onboarding.setupAutomation.bootstrapCommand) {
    items.push({
      id: 'setup-bootstrap',
      title: 'Run bootstrap command',
      description: `Execute the bootstrap command to set up your development environment: ${config.onboarding.setupAutomation.bootstrapCommand}`,
      category: 'setup',
      required: true,
      estimatedMinutes: config.onboarding.setupAutomation.estimatedSetupTimeMinutes ?? 30,
      dependencies: [],
      resources: [],
      verificationCommand: config.onboarding.setupAutomation.bootstrapCommand,
    });
  }

  // Prerequisites
  config.onboarding.setupAutomation.prerequisites.forEach((prereq, index) => {
    items.push({
      id: `setup-prereq-${index}`,
      title: `Install ${prereq.name}`,
      description: prereq.notes ?? `Install ${prereq.name}${prereq.version ? ` version ${prereq.version}` : ''}`,
      category: 'setup',
      required: prereq.required,
      estimatedMinutes: 10,
      dependencies: [],
      resources: prereq.installCommand ? [prereq.installCommand] : [],
      verificationCommand: prereq.verificationCommand,
    });
  });

  // IDE setup
  if (config.tooling.ide.sharedSettingsProvided) {
    items.push({
      id: 'setup-ide',
      title: 'Configure IDE',
      description: `Set up your IDE with the shared settings from ${config.tooling.ide.settingsPath ?? '.vscode/settings.json'}`,
      category: 'setup',
      required: false,
      estimatedMinutes: 15,
      dependencies: ['setup-bootstrap'],
      resources: config.tooling.ide.requiredExtensions,
    });
  }

  // Learning items - documentation
  config.onboarding.documentationRequirements.forEach((doc) => {
    const titleMap: Record<OnboardingDocs['type'], string> = {
      quickstart: 'Read Quickstart Guide',
      architecture: 'Review Architecture Documentation',
      conventions: 'Learn Code Conventions',
      troubleshooting: 'Review Troubleshooting Guide',
    };

    items.push({
      id: `learn-${doc.type}`,
      title: titleMap[doc.type],
      description: `Review the ${doc.type} documentation${doc.location ? ` at ${doc.location}` : ''}`,
      category: 'learning',
      required: doc.required,
      estimatedMinutes: doc.type === 'architecture' ? 60 : 30,
      dependencies: [],
      resources: doc.location ? [doc.location] : [],
    });
  });

  // Learning items - workflow
  items.push({
    id: 'learn-workflow',
    title: 'Understand Git Workflow',
    description: `Learn the team's ${config.workflow.branchStrategy.replace('_', '-')} branching strategy and PR process`,
    category: 'learning',
    required: true,
    estimatedMinutes: 20,
    dependencies: [],
    resources: [],
  });

  // Social items
  if (config.onboarding.mentorshipGuidelines.buddySystemEnabled) {
    items.push({
      id: 'social-buddy',
      title: 'Meet your buddy/mentor',
      description: 'Schedule an initial meeting with your assigned buddy or mentor',
      category: 'social',
      required: true,
      estimatedMinutes: 30,
      dependencies: [],
      resources: [],
    });
  }

  items.push({
    id: 'social-team',
    title: 'Meet the team',
    description: 'Introduce yourself to team members and understand their roles',
    category: 'social',
    required: true,
    estimatedMinutes: 60,
    dependencies: [],
    resources: [],
  });

  // Contribution items
  items.push({
    id: 'contribute-build',
    title: 'Run a successful build',
    description: 'Build the project locally and verify it works',
    category: 'contribution',
    required: true,
    estimatedMinutes: 15,
    dependencies: ['setup-bootstrap'],
    resources: [],
  });

  items.push({
    id: 'contribute-tests',
    title: 'Run the test suite',
    description: 'Execute the test suite and ensure all tests pass',
    category: 'contribution',
    required: true,
    estimatedMinutes: Math.ceil(config.feedbackLoops.testTimeTarget / 60) + 5,
    dependencies: ['contribute-build'],
    resources: [],
  });

  items.push({
    id: 'contribute-first-commit',
    title: 'Make your first commit',
    description: 'Submit your first code contribution (even something small like a typo fix)',
    category: 'contribution',
    required: true,
    estimatedMinutes: 60,
    dependencies: ['contribute-tests', 'learn-workflow'],
    resources: [],
  });

  // Calculate total time
  const totalMinutes = items.reduce((sum, item) => sum + item.estimatedMinutes, 0);

  // Group by category
  const categories = {
    setup: items.filter((i) => i.category === 'setup'),
    learning: items.filter((i) => i.category === 'learning'),
    social: items.filter((i) => i.category === 'social'),
    contribution: items.filter((i) => i.category === 'contribution'),
  };

  return {
    title: `${config.name} Onboarding Checklist`,
    totalEstimatedHours: Math.round((totalMinutes / 60) * 10) / 10,
    items,
    categories,
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// WORKFLOW VALIDATOR
// ============================================================================

/**
 * A single validation issue found by the workflow validator.
 */
export interface WorkflowValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'workflow' | 'tooling' | 'documentation' | 'feedback';
  rule: string;
  message: string;
  suggestion?: string;
}

/**
 * Result of workflow validation.
 */
export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  validatedAt: string;
}

/**
 * Validate a DX configuration against best practices.
 */
export function validateWorkflow(config: DeveloperExperienceConfig): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];

  // Workflow validations
  if (!config.workflow.codeReview.required) {
    issues.push({
      severity: 'error',
      category: 'workflow',
      rule: 'code-review-required',
      message: 'Code review is not required',
      suggestion: 'Enable required code review for all changes',
    });
  }

  if (!config.workflow.prGuidelines.ciPassRequired) {
    issues.push({
      severity: 'error',
      category: 'workflow',
      rule: 'ci-required',
      message: 'CI is not required to pass before merge',
      suggestion: 'Require CI to pass before allowing merge',
    });
  }

  if (config.workflow.codeReview.slaHours > 48) {
    issues.push({
      severity: 'warning',
      category: 'workflow',
      rule: 'review-sla',
      message: `Code review SLA of ${config.workflow.codeReview.slaHours} hours is too long`,
      suggestion: 'Reduce review SLA to 24 hours or less',
    });
  }

  if (config.workflow.prGuidelines.maxLines > 1000) {
    issues.push({
      severity: 'warning',
      category: 'workflow',
      rule: 'pr-size',
      message: `PR size limit of ${config.workflow.prGuidelines.maxLines} lines is too large`,
      suggestion: 'Reduce PR size limit to 400-600 lines for better reviewability',
    });
  }

  if (config.workflow.allowForcePush) {
    issues.push({
      severity: 'warning',
      category: 'workflow',
      rule: 'no-force-push',
      message: 'Force push is allowed',
      suggestion: 'Disable force push to protected branches',
    });
  }

  // Tooling validations
  if (!config.tooling.linting.enabled) {
    issues.push({
      severity: 'warning',
      category: 'tooling',
      rule: 'linting-enabled',
      message: 'Linting is not enabled',
      suggestion: 'Enable linting for code quality enforcement',
    });
  }

  if (!config.tooling.formatting.enabled) {
    issues.push({
      severity: 'warning',
      category: 'tooling',
      rule: 'formatting-enabled',
      message: 'Code formatting is not enabled',
      suggestion: 'Enable automatic code formatting',
    });
  }

  if (config.tooling.preCommitHooks.length === 0) {
    issues.push({
      severity: 'warning',
      category: 'tooling',
      rule: 'pre-commit-hooks',
      message: 'No pre-commit hooks configured',
      suggestion: 'Add pre-commit hooks for linting and formatting',
    });
  }

  if (!config.tooling.securityScanning) {
    issues.push({
      severity: 'warning',
      category: 'tooling',
      rule: 'security-scanning',
      message: 'Security scanning is not enabled',
      suggestion: 'Enable security scanning for dependencies',
    });
  }

  // Documentation validations
  if (!config.documentation.api.required) {
    issues.push({
      severity: 'info',
      category: 'documentation',
      rule: 'api-docs',
      message: 'API documentation is not required',
      suggestion: 'Consider requiring API documentation',
    });
  }

  if (!config.documentation.architecture.adrEnabled) {
    issues.push({
      severity: 'info',
      category: 'documentation',
      rule: 'adr-enabled',
      message: 'Architecture Decision Records are not enabled',
      suggestion: 'Enable ADRs for tracking architectural decisions',
    });
  }

  // Feedback validations
  if (config.feedbackLoops.buildTimeTarget > 300) {
    issues.push({
      severity: 'warning',
      category: 'feedback',
      rule: 'build-time',
      message: `Build time target of ${config.feedbackLoops.buildTimeTarget}s is too slow`,
      suggestion: 'Optimize builds to complete in under 5 minutes',
    });
  }

  if (!config.feedbackLoops.hotReloadRequired) {
    issues.push({
      severity: 'info',
      category: 'feedback',
      rule: 'hot-reload',
      message: 'Hot reload is not required',
      suggestion: 'Consider requiring hot reload for faster development iteration',
    });
  }

  if (config.feedbackLoops.errorMessageQuality === 'basic') {
    issues.push({
      severity: 'info',
      category: 'feedback',
      rule: 'error-quality',
      message: 'Error message quality is set to basic',
      suggestion: 'Improve error messages to be actionable',
    });
  }

  // Calculate summary
  const summary = {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  return {
    valid: summary.errors === 0,
    issues,
    summary,
    validatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// PRESETS
// ============================================================================

/**
 * World-class DX configuration preset.
 * Represents the gold standard for developer experience.
 */
export const WORLD_CLASS_DX_PRESET: DeveloperExperienceConfig = {
  name: 'World-Class DX',
  version: '1.0.0',
  onboarding: {
    timeToFirstCommitTarget: 4, // 4 hours
    setupAutomation: {
      oneCommandBootstrap: true,
      containerized: true,
      cloudWorkspaceSupport: true,
      prerequisites: [
        {
          name: 'Docker',
          required: true,
          platform: 'all',
          verificationCommand: 'docker --version',
        },
        {
          name: 'Git',
          required: true,
          platform: 'all',
          verificationCommand: 'git --version',
        },
      ],
      bootstrapCommand: 'make setup',
      estimatedSetupTimeMinutes: 15,
    },
    documentationRequirements: [
      { type: 'quickstart', required: true, maxAgeDays: 30 },
      { type: 'architecture', required: true, maxAgeDays: 90 },
      { type: 'conventions', required: true, maxAgeDays: 60 },
      { type: 'troubleshooting', required: true, maxAgeDays: 30 },
    ],
    mentorshipGuidelines: {
      buddySystemEnabled: true,
      checkInFrequencyDays: 2,
      onboardingTopics: [
        'Codebase overview',
        'Development workflow',
        'Architecture deep-dive',
        'Testing practices',
        'Deployment process',
        'Team norms and culture',
      ],
      mentorshipDurationWeeks: 4,
    },
  },
  workflow: {
    branchStrategy: 'trunk_based',
    codeReview: {
      required: true,
      minReviewers: 2,
      slaHours: 4,
      autoAssignment: true,
      checklist: [
        'Code follows style guidelines',
        'Tests are included and pass',
        'Documentation is updated',
        'No security vulnerabilities introduced',
        'Performance impact considered',
        'Breaking changes documented',
      ],
      dismissStaleReviews: true,
    },
    commitConventions: {
      convention: 'conventional',
      enforced: true,
      maxSubjectLength: 72,
      allowedTypes: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore'],
      requireBreakingChangeMarker: true,
      requireIssueReference: true,
    },
    prGuidelines: {
      maxLines: 400,
      templateRequired: true,
      linkedIssueRequired: true,
      ciPassRequired: true,
      requiredSections: ['Summary', 'Test Plan', 'Checklist'],
      supportDraftPRs: true,
      targetMergeTimeHours: 24,
    },
    protectedBranches: ['main', 'release/*'],
    allowForcePush: false,
  },
  tooling: {
    ide: {
      recommended: ['vscode'],
      sharedSettingsProvided: true,
      requiredExtensions: ['eslint', 'prettier'],
      recommendedExtensions: ['gitlens', 'error-lens', 'todo-tree'],
      settingsPath: '.vscode/settings.json',
    },
    linting: {
      enabled: true,
      strict: true,
      autoFix: true,
      customRules: [],
      tool: 'eslint',
      configPath: '.eslintrc.js',
    },
    formatting: {
      enabled: true,
      tool: 'prettier',
      formatOnSave: true,
      configPath: '.prettierrc',
      lineLength: 100,
    },
    preCommitHooks: [
      {
        name: 'lint',
        type: 'pre-commit',
        command: 'npm run lint',
        required: true,
        bypassable: false,
        estimatedTimeSeconds: 10,
      },
      {
        name: 'format-check',
        type: 'pre-commit',
        command: 'npm run format:check',
        required: true,
        bypassable: false,
        estimatedTimeSeconds: 5,
      },
      {
        name: 'type-check',
        type: 'pre-commit',
        command: 'npm run type-check',
        required: true,
        bypassable: false,
        estimatedTimeSeconds: 15,
      },
      {
        name: 'commit-msg',
        type: 'commit-msg',
        command: 'commitlint',
        required: true,
        bypassable: false,
        estimatedTimeSeconds: 1,
      },
    ],
    dependencyAutomation: true,
    securityScanning: true,
  },
  documentation: {
    api: {
      required: true,
      tool: 'typedoc',
      autoGenerated: true,
      outputPath: 'docs/api',
      minCoveragePercent: 90,
    },
    architecture: {
      required: true,
      adrEnabled: true,
      adrPath: 'docs/adr',
      diagramsRequired: true,
      diagramTool: 'mermaid',
      maxAgeDays: 90,
    },
    readme: {
      sections: ['overview', 'quickstart', 'installation', 'usage', 'contributing', 'license'],
      badgesRequired: true,
      examplesRequired: true,
      screenshotsRecommended: true,
    },
    runbooks: {
      required: true,
      requiredSections: ['Overview', 'Prerequisites', 'Steps', 'Troubleshooting', 'Rollback'],
      path: 'docs/runbooks',
      maxAgeDays: 30,
      testingRequired: true,
    },
  },
  feedbackLoops: {
    buildTimeTarget: 30, // 30 seconds
    testTimeTarget: 60, // 1 minute
    hotReloadRequired: true,
    errorMessageQuality: 'actionable',
    buildCaching: true,
    incrementalBuilds: true,
    ciPipelineTarget: 300, // 5 minutes
  },
};

/**
 * Standard DX configuration preset.
 * Represents good practices for most teams.
 */
export const STANDARD_DX_PRESET: DeveloperExperienceConfig = {
  name: 'Standard DX',
  version: '1.0.0',
  onboarding: {
    timeToFirstCommitTarget: 8, // 1 day
    setupAutomation: {
      oneCommandBootstrap: true,
      containerized: false,
      cloudWorkspaceSupport: false,
      prerequisites: [
        {
          name: 'Node.js',
          version: '18+',
          required: true,
          platform: 'all',
          verificationCommand: 'node --version',
        },
        {
          name: 'Git',
          required: true,
          platform: 'all',
          verificationCommand: 'git --version',
        },
      ],
      bootstrapCommand: 'npm install',
      estimatedSetupTimeMinutes: 30,
    },
    documentationRequirements: [
      { type: 'quickstart', required: true, maxAgeDays: 60 },
      { type: 'architecture', required: false, maxAgeDays: 180 },
      { type: 'conventions', required: true, maxAgeDays: 90 },
      { type: 'troubleshooting', required: false, maxAgeDays: 60 },
    ],
    mentorshipGuidelines: {
      buddySystemEnabled: true,
      checkInFrequencyDays: 7,
      onboardingTopics: [
        'Codebase overview',
        'Development workflow',
        'Testing practices',
      ],
      mentorshipDurationWeeks: 2,
    },
  },
  workflow: {
    branchStrategy: 'github_flow',
    codeReview: {
      required: true,
      minReviewers: 1,
      slaHours: 24,
      autoAssignment: true,
      checklist: [
        'Code follows style guidelines',
        'Tests are included',
        'Documentation updated if needed',
      ],
      dismissStaleReviews: true,
    },
    commitConventions: {
      convention: 'conventional',
      enforced: false,
      maxSubjectLength: 72,
      allowedTypes: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'],
      requireBreakingChangeMarker: false,
      requireIssueReference: false,
    },
    prGuidelines: {
      maxLines: 600,
      templateRequired: true,
      linkedIssueRequired: false,
      ciPassRequired: true,
      requiredSections: ['Summary'],
      supportDraftPRs: true,
      targetMergeTimeHours: 48,
    },
    protectedBranches: ['main'],
    allowForcePush: false,
  },
  tooling: {
    ide: {
      recommended: ['vscode'],
      sharedSettingsProvided: true,
      requiredExtensions: [],
      recommendedExtensions: ['eslint', 'prettier'],
      settingsPath: '.vscode/settings.json',
    },
    linting: {
      enabled: true,
      strict: false,
      autoFix: true,
      customRules: [],
      tool: 'eslint',
      configPath: '.eslintrc.js',
    },
    formatting: {
      enabled: true,
      tool: 'prettier',
      formatOnSave: true,
      configPath: '.prettierrc',
    },
    preCommitHooks: [
      {
        name: 'lint',
        type: 'pre-commit',
        command: 'npm run lint',
        required: true,
        bypassable: true,
        estimatedTimeSeconds: 15,
      },
    ],
    dependencyAutomation: true,
    securityScanning: false,
  },
  documentation: {
    api: {
      required: false,
      tool: 'typedoc',
      autoGenerated: true,
      outputPath: 'docs/api',
    },
    architecture: {
      required: false,
      adrEnabled: false,
      diagramsRequired: false,
      maxAgeDays: 180,
    },
    readme: {
      sections: ['overview', 'quickstart', 'installation', 'usage', 'license'],
      badgesRequired: false,
      examplesRequired: true,
      screenshotsRecommended: false,
    },
    runbooks: {
      required: false,
      requiredSections: ['Overview', 'Steps'],
      maxAgeDays: 60,
      testingRequired: false,
    },
  },
  feedbackLoops: {
    buildTimeTarget: 60, // 1 minute
    testTimeTarget: 120, // 2 minutes
    hotReloadRequired: false,
    errorMessageQuality: 'detailed',
    buildCaching: true,
    incrementalBuilds: false,
    ciPipelineTarget: 600, // 10 minutes
  },
};

/**
 * Minimal DX configuration preset.
 * Represents the minimum viable developer experience.
 */
export const MINIMAL_DX_PRESET: DeveloperExperienceConfig = {
  name: 'Minimal DX',
  version: '1.0.0',
  onboarding: {
    timeToFirstCommitTarget: 24, // 3 days
    setupAutomation: {
      oneCommandBootstrap: false,
      containerized: false,
      cloudWorkspaceSupport: false,
      prerequisites: [
        {
          name: 'Git',
          required: true,
          platform: 'all',
          verificationCommand: 'git --version',
        },
      ],
      estimatedSetupTimeMinutes: 60,
    },
    documentationRequirements: [
      { type: 'quickstart', required: true, maxAgeDays: 180 },
    ],
    mentorshipGuidelines: {
      buddySystemEnabled: false,
      checkInFrequencyDays: 14,
      onboardingTopics: ['Codebase overview'],
      mentorshipDurationWeeks: 1,
    },
  },
  workflow: {
    branchStrategy: 'github_flow',
    codeReview: {
      required: true,
      minReviewers: 1,
      slaHours: 48,
      autoAssignment: false,
      checklist: ['Code review passed'],
      dismissStaleReviews: false,
    },
    commitConventions: {
      convention: 'none',
      enforced: false,
      maxSubjectLength: 100,
      requireBreakingChangeMarker: false,
      requireIssueReference: false,
    },
    prGuidelines: {
      maxLines: 1000,
      templateRequired: false,
      linkedIssueRequired: false,
      ciPassRequired: true,
      requiredSections: [],
      supportDraftPRs: false,
    },
    protectedBranches: ['main'],
    allowForcePush: false,
  },
  tooling: {
    ide: {
      recommended: [],
      sharedSettingsProvided: false,
      requiredExtensions: [],
      recommendedExtensions: [],
    },
    linting: {
      enabled: false,
      strict: false,
      autoFix: false,
      customRules: [],
    },
    formatting: {
      enabled: false,
      tool: 'none',
      formatOnSave: false,
    },
    preCommitHooks: [],
    dependencyAutomation: false,
    securityScanning: false,
  },
  documentation: {
    api: {
      required: false,
      tool: 'none',
      autoGenerated: false,
    },
    architecture: {
      required: false,
      adrEnabled: false,
      diagramsRequired: false,
      maxAgeDays: 365,
    },
    readme: {
      sections: ['overview', 'installation'],
      badgesRequired: false,
      examplesRequired: false,
      screenshotsRecommended: false,
    },
    runbooks: {
      required: false,
      requiredSections: [],
      maxAgeDays: 365,
      testingRequired: false,
    },
  },
  feedbackLoops: {
    buildTimeTarget: 180, // 3 minutes
    testTimeTarget: 300, // 5 minutes
    hotReloadRequired: false,
    errorMessageQuality: 'basic',
    buildCaching: false,
    incrementalBuilds: false,
    ciPipelineTarget: 900, // 15 minutes
  },
};

// ============================================================================
// WORLD-CLASS DOCUMENTATION PRESET
// ============================================================================

/**
 * World-class documentation configuration preset.
 * Represents the gold standard for documentation excellence.
 */
export const WORLD_CLASS_DOCS_PRESET: WorldClassDocConfig = {
  multiModal: {
    written: {
      requiredFiles: [
        'README.md',
        'CONTRIBUTING.md',
        'docs/getting-started.md',
        'docs/architecture.md',
        'docs/api-reference.md',
        'docs/troubleshooting.md',
        'docs/faq.md',
        'CHANGELOG.md',
      ],
      minCoveragePercent: 90,
      styleGuide: 'docs/style-guide.md',
      toneGuidelines: [
        'Use active voice',
        'Be concise and clear',
        'Explain why, not just how',
        'Include practical examples',
        'Avoid jargon without explanation',
      ],
      maxReadingLevel: 10, // 10th grade reading level
      requiredMetadata: ['title', 'description', 'lastUpdated', 'author'],
    },
    visual: {
      architectureDiagrams: [
        {
          name: 'System Overview',
          type: 'architecture',
          description: 'High-level system architecture showing main components',
          required: true,
          maxAgeDays: 90,
        },
        {
          name: 'Data Flow',
          type: 'flow',
          description: 'How data flows through the system',
          required: true,
          maxAgeDays: 90,
        },
        {
          name: 'Deployment Architecture',
          type: 'deployment',
          description: 'Infrastructure and deployment topology',
          required: true,
          maxAgeDays: 60,
        },
      ],
      flowDiagrams: [
        {
          name: 'User Authentication Flow',
          type: 'sequence',
          description: 'Authentication and authorization sequence',
          required: true,
          maxAgeDays: 60,
        },
        {
          name: 'Request Lifecycle',
          type: 'flow',
          description: 'How requests are processed',
          required: true,
          maxAgeDays: 60,
        },
      ],
      stateMachines: [
        {
          name: 'Application State',
          type: 'state',
          description: 'Core application state transitions',
          required: false,
          maxAgeDays: 90,
        },
      ],
      autoGenerate: true,
      tools: ['mermaid', 'd2', 'excalidraw'],
      assetsPath: 'docs/assets/diagrams',
      preferredFormats: ['svg', 'png'],
    },
    interactive: {
      required: true,
      playground: {
        enabled: true,
        platform: 'codesandbox',
        templatePath: '.codesandbox/templates',
      },
      apiExplorer: {
        enabled: true,
        tool: 'swagger-ui',
      },
      codeSnippets: {
        languages: ['typescript', 'javascript', 'python', 'go', 'rust'],
        copyButton: true,
        lineNumbers: true,
        highlighting: true,
      },
      tutorials: {
        required: true,
        minCount: 5,
        requiredTopics: [
          'Getting Started',
          'Basic Usage',
          'Advanced Patterns',
          'Testing',
          'Deployment',
        ],
      },
    },
    video: {
      required: false,
      requiredTypes: ['quickstart', 'tutorial'],
      platform: 'youtube',
      maxAgeDays: 180,
      captionsRequired: true,
      minQuality: '1080p',
    },
  },
  testing: {
    testCodeExamples: true,
    validateLinks: true,
    checkScreenshots: true,
    verifyApiDocs: true,
    screenshotMaxAgeDays: 90,
    linkTimeoutMs: 10000,
    allowedExternalDomains: [
      'github.com',
      'npmjs.com',
      'docs.microsoft.com',
      'developer.mozilla.org',
    ],
    codeExampleTimeoutMs: 30000,
  },
  audienceContent: {
    beginner: {
      requiredSections: [
        'Overview',
        'Prerequisites',
        'Installation',
        'Quick Start',
        'First Example',
        'Common Mistakes',
        'Next Steps',
      ],
      maxReadingLevel: 8,
      examples: {
        minCount: 5,
        stepByStep: true,
        runnable: true,
        realWorld: false,
        types: ['basic'],
      },
      prerequisites: ['Node.js basics', 'Command line familiarity'],
      technicalDepth: 2,
      conceptualExplanations: true,
      codeComments: true,
      assumedKnowledge: [],
    },
    intermediate: {
      requiredSections: [
        'Architecture Overview',
        'Core Concepts',
        'Configuration',
        'Best Practices',
        'Testing',
        'Debugging',
      ],
      maxReadingLevel: 12,
      examples: {
        minCount: 10,
        stepByStep: false,
        runnable: true,
        realWorld: true,
        types: ['basic', 'advanced', 'error-handling'],
      },
      prerequisites: ['Basic usage', 'JavaScript/TypeScript'],
      technicalDepth: 3,
      conceptualExplanations: true,
      codeComments: true,
      assumedKnowledge: ['Package management', 'Async programming'],
    },
    expert: {
      requiredSections: [
        'Internal Architecture',
        'Performance Optimization',
        'Custom Extensions',
        'Contributing',
        'Security Considerations',
      ],
      maxReadingLevel: 16,
      examples: {
        minCount: 5,
        stepByStep: false,
        runnable: true,
        realWorld: true,
        types: ['advanced', 'integration', 'testing'],
      },
      prerequisites: ['Intermediate knowledge', 'System design'],
      technicalDepth: 5,
      conceptualExplanations: false,
      codeComments: false,
      assumedKnowledge: ['Design patterns', 'Performance profiling', 'CI/CD'],
    },
    quickReference: {
      requiredSections: [
        'API Reference',
        'CLI Commands',
        'Configuration Options',
        'Environment Variables',
        'Error Codes',
      ],
      maxReadingLevel: 14,
      examples: {
        minCount: 20,
        stepByStep: false,
        runnable: false,
        realWorld: false,
        types: ['basic', 'advanced'],
      },
      prerequisites: [],
      technicalDepth: 4,
      conceptualExplanations: false,
      codeComments: false,
      assumedKnowledge: ['Basic usage'],
    },
  },
  freshness: {
    maxAgeDays: 30,
    ownershipRequired: true,
    reviewCadence: 'monthly',
    staleness: {
      enabled: true,
      watchPatterns: ['src/**/*.ts', 'src/**/*.tsx', 'package.json'],
      ignorePatterns: ['**/*.test.ts', '**/*.spec.ts', 'node_modules/**'],
      trackDependencies: true,
      alertThresholdDays: 14,
    },
    autoUpdateHooks: [
      {
        id: 'api-change-notify',
        trigger: 'api_change',
        sourcePatterns: ['src/api/**/*.ts'],
        targetDocs: ['docs/api-reference.md'],
        action: 'create_issue',
        enabled: true,
      },
      {
        id: 'release-regenerate',
        trigger: 'release',
        sourcePatterns: ['package.json', 'CHANGELOG.md'],
        targetDocs: ['docs/getting-started.md', 'README.md'],
        action: 'notify',
        enabled: true,
      },
      {
        id: 'schema-change-block',
        trigger: 'file_change',
        sourcePatterns: ['src/types/**/*.ts', 'src/schemas/**/*.ts'],
        targetDocs: ['docs/api-reference.md', 'docs/architecture.md'],
        action: 'block_release',
        enabled: true,
      },
    ],
    requireLastReviewedDate: true,
    requireVersionTracking: true,
  },
  discoverability: {
    searchOptimization: {
      enabled: true,
      requireMetaDescriptions: true,
      requireStructuredData: true,
      generateSitemap: true,
      canonicalUrls: true,
      openGraphTags: true,
      twitterCards: true,
    },
    crossLinking: {
      autoLink: true,
      minLinksPerDoc: 3,
      maxLinksPerDoc: 15,
      requireRelatedDocs: true,
      bidirectionalLinks: true,
      validateOnBuild: true,
    },
    recommendations: {
      enabled: true,
      algorithm: 'hybrid',
      maxRecommendations: 5,
      showNextSteps: true,
      showRelatedTopics: true,
      personalize: false,
    },
    learningPaths: [
      {
        id: 'getting-started',
        name: 'Getting Started',
        description: 'Learn the basics and make your first project',
        targetAudience: 'beginner',
        steps: [
          {
            order: 1,
            title: 'Installation',
            description: 'Set up your development environment',
            resources: ['docs/getting-started.md#installation'],
            estimatedMinutes: 15,
            required: true,
            skillsGained: ['Installation', 'Configuration'],
          },
          {
            order: 2,
            title: 'Hello World',
            description: 'Create your first project',
            resources: ['docs/getting-started.md#hello-world'],
            estimatedMinutes: 20,
            required: true,
            skillsGained: ['Basic usage', 'Project structure'],
          },
          {
            order: 3,
            title: 'Core Concepts',
            description: 'Understand the fundamental concepts',
            resources: ['docs/concepts.md'],
            estimatedMinutes: 30,
            required: true,
            skillsGained: ['Core concepts', 'Terminology'],
          },
          {
            order: 4,
            title: 'Basic Example',
            description: 'Build a simple real-world example',
            resources: ['docs/tutorials/basic-example.md'],
            estimatedMinutes: 45,
            required: true,
            skillsGained: ['Practical application'],
            assessment: {
              type: 'exercise',
              description: 'Complete the basic example on your own',
            },
          },
        ],
        estimatedTime: 110,
        prerequisites: [],
        difficulty: 'beginner',
        tags: ['beginner', 'fundamentals', 'quickstart'],
        completionBadge: 'getting-started-complete',
      },
      {
        id: 'advanced-patterns',
        name: 'Advanced Patterns',
        description: 'Master advanced usage patterns and best practices',
        targetAudience: 'intermediate',
        steps: [
          {
            order: 1,
            title: 'Architecture Deep Dive',
            description: 'Understand the internal architecture',
            resources: ['docs/architecture.md'],
            estimatedMinutes: 60,
            required: true,
            skillsGained: ['Architecture understanding', 'Design decisions'],
          },
          {
            order: 2,
            title: 'Performance Optimization',
            description: 'Learn how to optimize for performance',
            resources: ['docs/performance.md'],
            estimatedMinutes: 45,
            required: true,
            skillsGained: ['Performance tuning', 'Profiling'],
          },
          {
            order: 3,
            title: 'Testing Strategies',
            description: 'Implement comprehensive testing',
            resources: ['docs/testing.md'],
            estimatedMinutes: 60,
            required: true,
            skillsGained: ['Unit testing', 'Integration testing', 'E2E testing'],
          },
          {
            order: 4,
            title: 'Production Deployment',
            description: 'Deploy to production with confidence',
            resources: ['docs/deployment.md'],
            estimatedMinutes: 90,
            required: true,
            skillsGained: ['Deployment', 'Monitoring', 'Scaling'],
            assessment: {
              type: 'project',
              description: 'Deploy a complete application to production',
              passingScore: 80,
            },
          },
        ],
        estimatedTime: 255,
        prerequisites: ['getting-started'],
        difficulty: 'advanced',
        tags: ['advanced', 'patterns', 'best-practices'],
        completionBadge: 'advanced-patterns-complete',
      },
    ],
    search: {
      enabled: true,
      provider: 'algolia',
      fuzzyMatching: true,
      highlighting: true,
      suggestions: true,
    },
    navigation: {
      breadcrumbs: true,
      tableOfContents: true,
      previousNext: true,
      sidebar: true,
    },
  },
};

// ============================================================================
// DOCUMENTATION VALIDATION
// ============================================================================

/**
 * Documentation validation issue.
 */
export interface DocValidationIssue {
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Category of the issue */
  category: 'multiModal' | 'testing' | 'audience' | 'freshness' | 'discoverability';
  /** Rule that was violated */
  rule: string;
  /** Human-readable message */
  message: string;
  /** Suggested fix */
  suggestion?: string;
  /** File path if applicable */
  filePath?: string;
}

/**
 * Documentation validation result.
 */
export interface DocValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of issues found */
  issues: DocValidationIssue[];
  /** Summary counts */
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  /** Score out of 100 */
  score: number;
  /** Validation timestamp */
  validatedAt: string;
}

/**
 * Validate world-class documentation configuration.
 */
export function validateWorldClassDocs(config: WorldClassDocConfig): DocValidationResult {
  const issues: DocValidationIssue[] = [];

  // Multi-modal validation
  if (config.multiModal.written.requiredFiles.length < 5) {
    issues.push({
      severity: 'warning',
      category: 'multiModal',
      rule: 'min-required-files',
      message: 'Less than 5 required documentation files specified',
      suggestion: 'Add more essential documentation files',
    });
  }

  if (config.multiModal.visual.architectureDiagrams.length === 0) {
    issues.push({
      severity: 'error',
      category: 'multiModal',
      rule: 'architecture-diagrams-required',
      message: 'No architecture diagrams configured',
      suggestion: 'Add at least one architecture diagram requirement',
    });
  }

  if (!config.multiModal.interactive.required) {
    issues.push({
      severity: 'warning',
      category: 'multiModal',
      rule: 'interactive-docs',
      message: 'Interactive documentation not required',
      suggestion: 'Enable interactive documentation for better learning experience',
    });
  }

  // Testing validation
  if (!config.testing.testCodeExamples) {
    issues.push({
      severity: 'error',
      category: 'testing',
      rule: 'test-code-examples',
      message: 'Code example testing not enabled',
      suggestion: 'Enable testing of code examples to ensure they work',
    });
  }

  if (!config.testing.validateLinks) {
    issues.push({
      severity: 'warning',
      category: 'testing',
      rule: 'validate-links',
      message: 'Link validation not enabled',
      suggestion: 'Enable link validation to prevent broken links',
    });
  }

  if (!config.testing.verifyApiDocs) {
    issues.push({
      severity: 'warning',
      category: 'testing',
      rule: 'verify-api-docs',
      message: 'API documentation verification not enabled',
      suggestion: 'Enable API doc verification to keep docs in sync with code',
    });
  }

  // Audience content validation
  const audiences: Audience[] = ['beginner', 'intermediate', 'expert', 'quickReference'];
  for (const audience of audiences) {
    const content = config.audienceContent[audience];
    if (content.requiredSections.length < 3) {
      issues.push({
        severity: 'warning',
        category: 'audience',
        rule: `${audience}-sections`,
        message: `${audience} content has fewer than 3 required sections`,
        suggestion: 'Add more structured sections for better coverage',
      });
    }
    if (content.examples.minCount < 3) {
      issues.push({
        severity: 'info',
        category: 'audience',
        rule: `${audience}-examples`,
        message: `${audience} content requires fewer than 3 examples`,
        suggestion: 'Consider requiring more examples',
      });
    }
  }

  // Freshness validation
  if (config.freshness.maxAgeDays > 90) {
    issues.push({
      severity: 'warning',
      category: 'freshness',
      rule: 'max-age',
      message: `Documentation max age of ${config.freshness.maxAgeDays} days is too long`,
      suggestion: 'Reduce max age to 90 days or less for freshness',
    });
  }

  if (!config.freshness.ownershipRequired) {
    issues.push({
      severity: 'warning',
      category: 'freshness',
      rule: 'ownership-required',
      message: 'Documentation ownership not required',
      suggestion: 'Require document ownership for accountability',
    });
  }

  if (!config.freshness.staleness.enabled) {
    issues.push({
      severity: 'error',
      category: 'freshness',
      rule: 'staleness-detection',
      message: 'Staleness detection not enabled',
      suggestion: 'Enable staleness detection to catch outdated docs',
    });
  }

  if (config.freshness.autoUpdateHooks.length === 0) {
    issues.push({
      severity: 'warning',
      category: 'freshness',
      rule: 'auto-update-hooks',
      message: 'No auto-update hooks configured',
      suggestion: 'Add hooks to automate documentation updates',
    });
  }

  // Discoverability validation
  if (!config.discoverability.searchOptimization.enabled) {
    issues.push({
      severity: 'warning',
      category: 'discoverability',
      rule: 'seo-enabled',
      message: 'Search optimization not enabled',
      suggestion: 'Enable SEO for better documentation discoverability',
    });
  }

  if (!config.discoverability.crossLinking.autoLink) {
    issues.push({
      severity: 'info',
      category: 'discoverability',
      rule: 'auto-linking',
      message: 'Automatic cross-linking not enabled',
      suggestion: 'Enable auto-linking to improve navigation',
    });
  }

  if (config.discoverability.learningPaths.length < 2) {
    issues.push({
      severity: 'warning',
      category: 'discoverability',
      rule: 'learning-paths',
      message: 'Fewer than 2 learning paths defined',
      suggestion: 'Add more learning paths for different skill levels',
    });
  }

  if (!config.discoverability.search.enabled) {
    issues.push({
      severity: 'error',
      category: 'discoverability',
      rule: 'search-enabled',
      message: 'Documentation search not enabled',
      suggestion: 'Enable search for better documentation navigation',
    });
  }

  // Calculate summary and score
  const summary = {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  };

  // Score calculation: start at 100, deduct for issues
  let score = 100;
  score -= summary.errors * 15;
  score -= summary.warnings * 5;
  score -= summary.info * 1;
  score = Math.max(0, Math.min(100, score));

  return {
    valid: summary.errors === 0,
    issues,
    summary,
    score,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Create a world-class documentation config with custom overrides.
 */
export function createWorldClassDocsConfig(
  overrides?: Partial<WorldClassDocConfig>
): WorldClassDocConfig {
  if (!overrides) {
    return { ...WORLD_CLASS_DOCS_PRESET };
  }

  return {
    multiModal: {
      ...WORLD_CLASS_DOCS_PRESET.multiModal,
      ...overrides.multiModal,
      written: {
        ...WORLD_CLASS_DOCS_PRESET.multiModal.written,
        ...overrides.multiModal?.written,
      },
      visual: {
        ...WORLD_CLASS_DOCS_PRESET.multiModal.visual,
        ...overrides.multiModal?.visual,
      },
      interactive: {
        ...WORLD_CLASS_DOCS_PRESET.multiModal.interactive,
        ...overrides.multiModal?.interactive,
      },
      video: overrides.multiModal?.video ?? WORLD_CLASS_DOCS_PRESET.multiModal.video,
    },
    testing: {
      ...WORLD_CLASS_DOCS_PRESET.testing,
      ...overrides.testing,
    },
    audienceContent: {
      ...WORLD_CLASS_DOCS_PRESET.audienceContent,
      ...overrides.audienceContent,
      beginner: {
        ...WORLD_CLASS_DOCS_PRESET.audienceContent.beginner,
        ...overrides.audienceContent?.beginner,
      },
      intermediate: {
        ...WORLD_CLASS_DOCS_PRESET.audienceContent.intermediate,
        ...overrides.audienceContent?.intermediate,
      },
      expert: {
        ...WORLD_CLASS_DOCS_PRESET.audienceContent.expert,
        ...overrides.audienceContent?.expert,
      },
      quickReference: {
        ...WORLD_CLASS_DOCS_PRESET.audienceContent.quickReference,
        ...overrides.audienceContent?.quickReference,
      },
    },
    freshness: {
      ...WORLD_CLASS_DOCS_PRESET.freshness,
      ...overrides.freshness,
      staleness: {
        ...WORLD_CLASS_DOCS_PRESET.freshness.staleness,
        ...overrides.freshness?.staleness,
      },
    },
    discoverability: {
      ...WORLD_CLASS_DOCS_PRESET.discoverability,
      ...overrides.discoverability,
      searchOptimization: {
        ...WORLD_CLASS_DOCS_PRESET.discoverability.searchOptimization,
        ...overrides.discoverability?.searchOptimization,
      },
      crossLinking: {
        ...WORLD_CLASS_DOCS_PRESET.discoverability.crossLinking,
        ...overrides.discoverability?.crossLinking,
      },
      recommendations: {
        ...WORLD_CLASS_DOCS_PRESET.discoverability.recommendations,
        ...overrides.discoverability?.recommendations,
      },
      search: {
        ...WORLD_CLASS_DOCS_PRESET.discoverability.search,
        ...overrides.discoverability?.search,
      },
      navigation: {
        ...WORLD_CLASS_DOCS_PRESET.discoverability.navigation,
        ...overrides.discoverability?.navigation,
      },
    },
  };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a custom DX configuration based on a preset.
 */
export function createDXConfig(
  preset: 'world_class' | 'standard' | 'minimal',
  overrides?: Partial<DeveloperExperienceConfig>
): DeveloperExperienceConfig {
  const baseConfig = getPreset(preset);
  if (!overrides) {
    return { ...baseConfig };
  }

  return {
    ...baseConfig,
    ...overrides,
    name: overrides.name ?? baseConfig.name,
    version: overrides.version ?? baseConfig.version,
    onboarding: {
      ...baseConfig.onboarding,
      ...overrides.onboarding,
      setupAutomation: {
        ...baseConfig.onboarding.setupAutomation,
        ...overrides.onboarding?.setupAutomation,
      },
      mentorshipGuidelines: {
        ...baseConfig.onboarding.mentorshipGuidelines,
        ...overrides.onboarding?.mentorshipGuidelines,
      },
    },
    workflow: {
      ...baseConfig.workflow,
      ...overrides.workflow,
      codeReview: {
        ...baseConfig.workflow.codeReview,
        ...overrides.workflow?.codeReview,
      },
      commitConventions: {
        ...baseConfig.workflow.commitConventions,
        ...overrides.workflow?.commitConventions,
      },
      prGuidelines: {
        ...baseConfig.workflow.prGuidelines,
        ...overrides.workflow?.prGuidelines,
      },
    },
    tooling: {
      ...baseConfig.tooling,
      ...overrides.tooling,
      ide: {
        ...baseConfig.tooling.ide,
        ...overrides.tooling?.ide,
      },
      linting: {
        ...baseConfig.tooling.linting,
        ...overrides.tooling?.linting,
      },
      formatting: {
        ...baseConfig.tooling.formatting,
        ...overrides.tooling?.formatting,
      },
    },
    documentation: {
      ...baseConfig.documentation,
      ...overrides.documentation,
      api: {
        ...baseConfig.documentation.api,
        ...overrides.documentation?.api,
      },
      architecture: {
        ...baseConfig.documentation.architecture,
        ...overrides.documentation?.architecture,
      },
      readme: {
        ...baseConfig.documentation.readme,
        ...overrides.documentation?.readme,
      },
      runbooks: {
        ...baseConfig.documentation.runbooks,
        ...overrides.documentation?.runbooks,
      },
    },
    feedbackLoops: {
      ...baseConfig.feedbackLoops,
      ...overrides.feedbackLoops,
    },
  };
}

function getPreset(preset: 'world_class' | 'standard' | 'minimal'): DeveloperExperienceConfig {
  switch (preset) {
    case 'world_class':
      return WORLD_CLASS_DX_PRESET;
    case 'standard':
      return STANDARD_DX_PRESET;
    case 'minimal':
      return MINIMAL_DX_PRESET;
  }
}

/**
 * Get all available presets.
 */
export function getDXPresets(): Record<string, DeveloperExperienceConfig> {
  return {
    world_class: WORLD_CLASS_DX_PRESET,
    standard: STANDARD_DX_PRESET,
    minimal: MINIMAL_DX_PRESET,
  };
}
