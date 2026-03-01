/**
 * @fileoverview History and Ownership Extractor
 *
 * Extracts history and ownership knowledge (questions 136-150):
 * - History: created, lastModified, commits, evolution, planned changes
 * - Ownership: owner, expertise, tribal knowledge, contact
 *
 * Uses git history integration for accurate historical data.
 * Designed to work with commit_indexer.ts and ownership_indexer.ts data.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  EntityHistory,
  EntityOwnership,
  HistoryEvent,
  CommitSummary,
  EvolutionInfo,
  PlannedChange,
  BreakingChange,
  ChangeType,
  OwnerInfo,
  ExpertiseInfo,
  TribalKnowledgeInfo,
  ContactInfo,
  Expert,
  Reviewer,
  TribalKnowledge,
  Gotcha,
  Tip,
  LearningStep,
  TeamMember,
} from '../universal_types.js';

const execAsync = promisify(exec);

export interface HistoryExtraction {
  history: EntityHistory;
  confidence: number;
}

export interface OwnershipExtraction {
  ownership: EntityOwnership;
  confidence: number;
}

export interface HistoryInput {
  filePath: string;
  startLine?: number;
  endLine?: number;
  workspaceRoot: string;

  // Pre-indexed data (from commit_indexer)
  commits?: IndexedCommit[];

  // Content for deprecated analysis
  content?: string;
}

export interface OwnershipInput {
  filePath: string;
  workspaceRoot: string;

  // Pre-indexed data (from ownership_indexer)
  ownershipData?: IndexedOwnership[];

  // File content for tribal knowledge extraction
  content?: string;

  // Optional wisdom synthesized by semantic extraction
  semanticWisdom?: TribalKnowledgeInfo;

  // Codeowners data
  codeowners?: string[];
}

export interface IndexedCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
  filesChanged?: string[];
}

export interface IndexedOwnership {
  author: string;
  score: number;
  lastModified: string;
  commitCount?: number;
}

// ============================================================================
// HISTORY EXTRACTOR
// ============================================================================

/**
 * Extract history knowledge for a code entity.
 */
export async function extractHistory(input: HistoryInput): Promise<HistoryExtraction> {
  let commits: CommitSummary[] = [];
  let created: HistoryEvent | null = null;
  let lastModified: HistoryEvent | null = null;

  try {
    // Use pre-indexed commits or fetch from git
    if (input.commits && input.commits.length > 0) {
      commits = input.commits.map(c => ({
        hash: c.sha,
        date: c.date,
        author: c.author,
        message: c.message,
        changes: categorizeChange(c.message),
      }));
    } else {
      // Fetch from git
      const gitCommits = await fetchGitHistory(input.filePath, input.workspaceRoot);
      commits = gitCommits;
    }

    // Extract created and lastModified
    if (commits.length > 0) {
      const oldest = commits[commits.length - 1];
      created = {
        at: oldest.date,
        by: oldest.author,
        commit: oldest.hash,
        reason: oldest.message,
      };

      const newest = commits[0];
      lastModified = {
        at: newest.date,
        by: newest.author,
        commit: newest.hash,
        reason: newest.message,
      };
    }
  } catch {
    // Git not available or error - use defaults
  }

  // Extract evolution info
  const evolution = extractEvolution(input.content, commits);

  // Extract planned changes from comments/TODOs
  const plannedChanges = extractPlannedChanges(input.content);

  // Calculate confidence
  const hasGitData = commits.length > 0;
  const hasContent = !!input.content;
  const confidence = 0.3 + (hasGitData ? 0.5 : 0) + (hasContent ? 0.2 : 0);

  return {
    history: {
      created: created || { at: new Date().toISOString(), by: 'unknown', commit: '' },
      lastModified: lastModified || { at: new Date().toISOString(), by: 'unknown', commit: '' },
      commits: commits.slice(0, 20), // Limit to recent
      evolution,
      plannedChanges,
    },
    confidence,
  };
}

async function fetchGitHistory(filePath: string, workspaceRoot: string): Promise<CommitSummary[]> {
  try {
    const relativePath = filePath.replace(workspaceRoot + '/', '');
    const { stdout } = await execAsync(
      `git log --format="%H|%an|%aI|%s" -n 50 -- "${relativePath}"`,
      { cwd: workspaceRoot, timeout: 5000 }
    );

    return stdout.trim().split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [hash, author, date, ...messageParts] = line.split('|');
        const message = messageParts.join('|'); // Handle messages with |
        return {
          hash: hash || '',
          author: author || 'unknown',
          date: date || new Date().toISOString(),
          message: message || '',
          changes: categorizeChange(message),
        };
      });
  } catch {
    return [];
  }
}

function categorizeChange(message: string): ChangeType {
  const lower = message.toLowerCase();

  if (/^add|^create|^new|^implement|^introduce/i.test(lower)) {
    return 'add';
  }
  if (/^delete|^remove|^drop|^deprecate/i.test(lower)) {
    return 'delete';
  }
  if (/^rename|^move|^refactor/i.test(lower)) {
    return 'rename';
  }
  return 'modify';
}

function extractEvolution(content: string | undefined, commits: CommitSummary[]): EvolutionInfo {
  const breaking: BreakingChange[] = [];

  // Look for breaking changes in commits
  for (const commit of commits) {
    if (/breaking|BREAKING/i.test(commit.message)) {
      breaking.push({
        version: 'unknown',
        description: commit.message,
        migration: 'See commit for details',
      });
    }
  }

  // Check for deprecation in content
  let deprecatedIn: string | undefined;
  let deprecationReason: string | undefined;

  if (content) {
    const deprecatedMatch = content.match(/@deprecated(?:\s+since\s+v?([\d.]+))?[^\n]*\n?\s*\*?\s*([^\n*]+)?/i);
    if (deprecatedMatch) {
      deprecatedIn = deprecatedMatch[1] || 'current';
      deprecationReason = deprecatedMatch[2]?.trim();
    }

    // Check for @since annotations
    const sinceMatch = content.match(/@since\s+v?([\d.]+)/i);
    const versionIntroduced = sinceMatch?.[1];

    return {
      versionIntroduced,
      deprecatedIn,
      deprecationReason,
      migrationPath: deprecationReason ? extractMigrationPath(content) : undefined,
      breakingChanges: breaking,
    };
  }

  return {
    breakingChanges: breaking,
  };
}

function extractMigrationPath(content: string): string | undefined {
  // Look for migration hints in deprecation comments
  const migrationMatch = content.match(/(?:use|migrate\s+to|replace\s+with|see)\s+[`'"]?(\w+)[`'"]?/i);
  return migrationMatch ? `Use ${migrationMatch[1]} instead` : undefined;
}

function extractPlannedChanges(content: string | undefined): PlannedChange[] {
  const planned: PlannedChange[] = [];

  if (!content) return planned;

  // Look for TODO/FIXME with context
  const todoMatches = content.matchAll(/(?:TODO|FIXME|HACK|XXX)(?:\s*\([^)]+\))?:?\s*([^\n]+)/gi);
  for (const match of todoMatches) {
    planned.push({
      description: match[1].trim(),
      source: 'Code comment',
    });
  }

  // Look for @todo annotations
  const atTodoMatches = content.matchAll(/@todo\s+([^\n@]+)/gi);
  for (const match of atTodoMatches) {
    planned.push({
      description: match[1].trim(),
      source: 'JSDoc @todo',
    });
  }

  return planned.slice(0, 10); // Limit
}

// ============================================================================
// OWNERSHIP EXTRACTOR
// ============================================================================

/**
 * Extract ownership knowledge for a code entity.
 */
export async function extractOwnership(input: OwnershipInput): Promise<OwnershipExtraction> {
  let experts: Expert[] = [];
  let owner: TeamMember | null = null;

  try {
    // Use pre-indexed ownership or compute from git blame
    if (input.ownershipData && input.ownershipData.length > 0) {
      experts = input.ownershipData.map(o => ({
        name: o.author,
        expertise: o.score,
        recentActivity: daysSince(o.lastModified),
      }));
      owner = {
        name: input.ownershipData[0].author,
      };
    } else {
      // Compute from git blame
      const blameData = await computeOwnershipFromBlame(input.filePath, input.workspaceRoot);
      experts = blameData.experts;
      owner = blameData.owner;
    }
  } catch {
    // Git not available
  }

  // Use CODEOWNERS if available
  const codeownersOwner = input.codeowners?.[0];
  if (codeownersOwner && !owner) {
    owner = { name: codeownersOwner };
  }

  // Build reviewer list
  const reviewers = buildReviewerList(experts);

  // Extract tribal knowledge from comments + semantic LLM wisdom
  const knowledge = mergeTribalKnowledge(
    extractTribalKnowledge(input.content),
    input.semanticWisdom,
  );

  // Build contact info (would come from external source in production)
  const contact = buildContactInfo(owner);

  // Calculate confidence
  const hasOwnership = experts.length > 0 || !!owner;
  const hasCodeowners = (input.codeowners?.length ?? 0) > 0;
  const hasContent = !!input.content;
  const confidence = 0.3 + (hasOwnership ? 0.3 : 0) + (hasCodeowners ? 0.2 : 0) + (hasContent ? 0.2 : 0);

  return {
    ownership: {
      owner: {
        primary: owner || { name: 'unknown' },
        team: inferTeam(input.filePath, input.codeowners),
      },
      expertise: {
        experts: experts.slice(0, 5),
        reviewers,
        escalation: buildEscalationPath(owner, input.codeowners),
      },
      knowledge,
      contact,
    },
    confidence,
  };
}

async function computeOwnershipFromBlame(filePath: string, workspaceRoot: string): Promise<{
  experts: Expert[];
  owner: TeamMember | null;
}> {
  try {
    const relativePath = filePath.replace(workspaceRoot + '/', '');
    const { stdout } = await execAsync(
      `git blame --line-porcelain "${relativePath}" 2>/dev/null | grep "^author " | sort | uniq -c | sort -rn | head -10`,
      { cwd: workspaceRoot, timeout: 10000 }
    );

    const lines = stdout.trim().split('\n').filter(l => l.length > 0);
    const totalLines = lines.reduce((sum, line) => {
      const count = parseInt(line.trim().split(/\s+/)[0]) || 0;
      return sum + count;
    }, 0);

    const experts: Expert[] = lines.map(line => {
      const parts = line.trim().split(/\s+/);
      const count = parseInt(parts[0]) || 0;
      const name = parts.slice(2).join(' '); // "author Name"
      return {
        name: name || 'unknown',
        expertise: totalLines > 0 ? count / totalLines : 0,
        recentActivity: 0, // Would need additional git command
      };
    });

    return {
      experts,
      owner: experts.length > 0 ? { name: experts[0].name } : null,
    };
  } catch {
    return { experts: [], owner: null };
  }
}

function daysSince(dateStr: string): number {
  try {
    const then = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

function buildReviewerList(experts: Expert[]): Reviewer[] {
  // Top experts with high expertise should be reviewers
  return experts
    .filter(e => e.expertise > 0.1)
    .slice(0, 3)
    .map(e => ({
      name: e.name,
      specialty: undefined, // Would need more context
    }));
}

function extractTribalKnowledge(content: string | undefined): TribalKnowledgeInfo {
  const tribal: TribalKnowledge[] = [];
  const gotchas: Gotcha[] = [];
  const tips: Tip[] = [];
  const learningPath: LearningStep[] = [];

  if (!content) {
    return { tribal, gotchas, tips, learningPath };
  }

  // Extract warnings/cautions
  const warningMatches = content.matchAll(/(?:WARNING|CAUTION|IMPORTANT|NOTE|NB):?\s*([^\n]+)/gi);
  for (const match of warningMatches) {
    tribal.push({
      knowledge: match[1].trim(),
      source: 'Code comment',
      importance: 'important',
    });
  }

  // Extract gotchas from specific patterns
  const gotchaMatches = content.matchAll(/(?:GOTCHA|HACK|WORKAROUND|QUIRK):?\s*([^\n]+)/gi);
  for (const match of gotchaMatches) {
    gotchas.push({
      description: match[1].trim(),
      consequence: 'May cause unexpected behavior',
      prevention: 'Follow documented pattern',
    });
  }

  // Extract tips from @see or "see also" patterns
  const tipMatches = content.matchAll(/@see\s+([^\n]+)|see\s+also:?\s+([^\n]+)/gi);
  for (const match of tipMatches) {
    tips.push({
      description: (match[1] || match[2]).trim(),
      context: 'Related documentation',
    });
  }

  return {
    tribal: tribal.slice(0, 5),
    gotchas: gotchas.slice(0, 5),
    tips: tips.slice(0, 5),
    learningPath,
  };
}

function mergeTribalKnowledge(
  extracted: TribalKnowledgeInfo,
  semanticWisdom?: TribalKnowledgeInfo,
): TribalKnowledgeInfo {
  if (!semanticWisdom) {
    return extracted;
  }

  const tribal = [...extracted.tribal];
  const gotchas = [...extracted.gotchas];
  const tips = [...extracted.tips];
  const learningPath = [...extracted.learningPath];

  const tribalSeen = new Set(tribal.map((item) => item.knowledge.trim().toLowerCase()));
  for (const item of semanticWisdom.tribal ?? []) {
    const key = item.knowledge.trim().toLowerCase();
    if (!key || tribalSeen.has(key)) continue;
    tribalSeen.add(key);
    tribal.push(item);
  }

  const gotchaSeen = new Set(gotchas.map((item) => item.description.trim().toLowerCase()));
  for (const item of semanticWisdom.gotchas ?? []) {
    const key = item.description.trim().toLowerCase();
    if (!key || gotchaSeen.has(key)) continue;
    gotchaSeen.add(key);
    gotchas.push(item);
  }

  const tipSeen = new Set(tips.map((item) => item.description.trim().toLowerCase()));
  for (const item of semanticWisdom.tips ?? []) {
    const key = item.description.trim().toLowerCase();
    if (!key || tipSeen.has(key)) continue;
    tipSeen.add(key);
    tips.push(item);
  }

  const learningSeen = new Set(learningPath.map((item) => item.description.trim().toLowerCase()));
  for (const item of semanticWisdom.learningPath ?? []) {
    const key = item.description.trim().toLowerCase();
    if (!key || learningSeen.has(key)) continue;
    learningSeen.add(key);
    learningPath.push(item);
  }

  return {
    tribal: tribal.slice(0, 5),
    gotchas: gotchas.slice(0, 5),
    tips: tips.slice(0, 5),
    learningPath: learningPath
      .sort((a, b) => a.order - b.order)
      .slice(0, 8),
  };
}

function inferTeam(filePath: string, codeowners?: string[]): string | undefined {
  // Try to infer team from codeowners
  if (codeowners?.[0]?.startsWith('@')) {
    const team = codeowners[0].split('/')[0].replace('@', '');
    return team;
  }

  // Infer from path
  const pathParts = filePath.split('/');
  const knownTeams = ['frontend', 'backend', 'api', 'infra', 'platform', 'core', 'mobile', 'web'];
  for (const part of pathParts) {
    if (knownTeams.includes(part.toLowerCase())) {
      return part;
    }
  }

  return undefined;
}

function buildContactInfo(owner: TeamMember | null): ContactInfo {
  // In production, would integrate with directory service
  return {
    // Would be populated from external source
  };
}

function buildEscalationPath(owner: TeamMember | null, codeowners?: string[]): string {
  const parts: string[] = [];

  if (owner?.name && owner.name !== 'unknown') {
    parts.push(`Primary: ${owner.name}`);
  }

  if (codeowners && codeowners.length > 1) {
    parts.push(`Team: ${codeowners[1]}`);
  }

  if (parts.length === 0) {
    return 'Contact repository maintainers';
  }

  return parts.join(' → ');
}

// ============================================================================
// COMBINED EXTRACTOR
// ============================================================================

export interface HistoryAndOwnershipExtraction {
  history: EntityHistory;
  ownership: EntityOwnership;
  confidence: number;
}

/**
 * Extract both history and ownership in one pass.
 * More efficient as it shares git data.
 */
export async function extractHistoryAndOwnership(
  input: HistoryInput & OwnershipInput
): Promise<HistoryAndOwnershipExtraction> {
  const [historyResult, ownershipResult] = await Promise.all([
    extractHistory(input),
    extractOwnership(input),
  ]);

  // Cross-reference: use history data to improve ownership
  if (historyResult.history.lastModified.by !== 'unknown') {
    const lastModifier = historyResult.history.lastModified.by;
    const hasExpert = ownershipResult.ownership.expertise.experts.some(
      e => e.name === lastModifier
    );
    if (!hasExpert) {
      ownershipResult.ownership.expertise.experts.unshift({
        name: lastModifier,
        expertise: 0.5,
        recentActivity: 0,
      });
    }
  }

  // VISION: Use geometric mean for confidence - represents combined certainty
  const confidences = [
    Math.max(0.01, historyResult.confidence),
    Math.max(0.01, ownershipResult.confidence),
  ];
  const logSum = confidences.reduce((sum, c) => sum + Math.log(c), 0);
  const geometricConfidence = Math.exp(logSum / confidences.length);

  return {
    history: historyResult.history,
    ownership: ownershipResult.ownership,
    confidence: geometricConfidence,
  };
}
