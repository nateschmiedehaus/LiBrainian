/**
 * @fileoverview Quality Issue Registry
 *
 * A persistent, regularly-updated registry of all code quality problems.
 * Agents can query this registry to find work and mark issues as resolved.
 *
 * Key features:
 * - Auto-updates on file changes via file watcher
 * - Full refresh on bootstrap
 * - Query API for agents to find issues by type, severity, file, etc.
 * - Resolution tracking (claimed, in_progress, resolved, wont_fix)
 * - History of issue detection and resolution
 */

import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export type IssueCategory =
  | 'complexity'       // High cyclomatic/cognitive complexity
  | 'size'             // Long methods, large files
  | 'coupling'         // High fan-in/fan-out, circular deps
  | 'dead_code'        // Unreachable code
  | 'test_coverage'    // Missing or inadequate tests
  | 'documentation'    // Missing docs on public API
  | 'security'         // Security vulnerabilities
  | 'architecture'     // Layer violations, design issues
  | 'naming'           // Poor naming conventions
  | 'duplication'      // Duplicated code
  | 'debt';            // TODOs, FIXMEs, technical debt

export type IssueSeverity = 'critical' | 'major' | 'minor' | 'info';

export type IssueStatus =
  | 'open'           // Newly detected, not yet worked on
  | 'claimed'        // An agent has claimed to work on it
  | 'in_progress'    // Work is actively happening
  | 'resolved'       // Fixed and verified
  | 'wont_fix'       // Intentionally not fixing (with reason)
  | 'false_positive'; // Detection was wrong

export interface QualityIssue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;

  // Location
  filePath: string;
  entityId?: string;       // Function/class ID if applicable
  entityName?: string;
  startLine?: number;
  endLine?: number;

  // Description
  title: string;
  description: string;
  evidence: string[];      // Why this was flagged

  // Metrics
  impactScore: number;     // 0-1, how much fixing helps
  effortMinutes: number;   // Estimated fix time
  roi: number;             // impactScore / (effortMinutes / 60)

  // Actionability
  suggestedFix?: string;
  automatable: boolean;
  autoFixCommand?: string;

  // Dependencies
  blockedBy: string[];     // Issue IDs that must be fixed first
  blocks: string[];        // Issue IDs this blocks

  // Tracking
  detectedAt: string;      // ISO timestamp
  detectedByVersion: string;
  lastVerifiedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;     // Agent ID or "human"
  resolutionNote?: string;

  // History
  occurrenceCount: number; // How many times detected (for recurring issues)
  previousResolutions: Array<{
    resolvedAt: string;
    reoccurredAt: string;
  }>;
}

export interface IssueQuery {
  categories?: IssueCategory[];
  severities?: IssueSeverity[];
  statuses?: IssueStatus[];
  filePath?: string;         // Exact match
  filePattern?: string;      // Glob pattern
  entityId?: string;
  minImpact?: number;
  maxEffort?: number;
  minRoi?: number;
  automatable?: boolean;
  limit?: number;
  orderBy?: 'roi' | 'severity' | 'impact' | 'effort' | 'detected';
}

export interface IssueRegistryStats {
  total: number;
  bySeverity: Record<IssueSeverity, number>;
  byCategory: Record<IssueCategory, number>;
  byStatus: Record<IssueStatus, number>;
  totalEffortMinutes: number;
  avgRoi: number;
  oldestUnresolvedDays: number;
}

export interface IssueClaim {
  issueId: string;
  agentId: string;
  claimedAt: string;
  expectedCompletionAt?: string;
}

// ============================================================================
// REGISTRY IMPLEMENTATION
// ============================================================================

/**
 * Quality Issue Registry
 *
 * Maintains a persistent list of all detected quality issues.
 * Updated automatically on file changes and full refresh on bootstrap.
 */
export class QualityIssueRegistry {
  private issues: Map<string, QualityIssue> = new Map();
  private claims: Map<string, IssueClaim> = new Map();
  private version: string;

  constructor(
    private storage: LiBrainianStorage,
    private workspace: string,
  ) {
    this.version = '1.0.0';
  }

  // -------------------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------------------

  /**
   * Load existing issues from storage
   */
  async initialize(): Promise<void> {
    const stored = await this.storage.getState('quality_issues');
    if (stored) {
      const parsed = JSON.parse(stored);
      for (const issue of parsed.issues || []) {
        this.issues.set(issue.id, issue);
      }
      for (const claim of parsed.claims || []) {
        this.claims.set(claim.issueId, claim);
      }
    }
  }

  /**
   * Save current state to storage
   */
  async persist(): Promise<void> {
    const data = {
      version: this.version,
      updatedAt: new Date().toISOString(),
      issues: Array.from(this.issues.values()),
      claims: Array.from(this.claims.values()),
    };
    await this.storage.setState('quality_issues', JSON.stringify(data));
  }

  // -------------------------------------------------------------------------
  // DETECTION (called during indexing)
  // -------------------------------------------------------------------------

  /**
   * Register a newly detected issue
   */
  async registerIssue(issue: Omit<QualityIssue, 'id' | 'status' | 'detectedAt' | 'detectedByVersion' | 'lastVerifiedAt' | 'occurrenceCount' | 'previousResolutions'>): Promise<QualityIssue> {
    const id = this.generateIssueId(issue);

    // Check if this issue already exists
    const existing = this.issues.get(id);
    if (existing) {
      // Update verification time, increment occurrence if it reoccurred
      existing.lastVerifiedAt = new Date().toISOString();
      if (existing.status === 'resolved') {
        // Issue reoccurred after resolution
        existing.previousResolutions.push({
          resolvedAt: existing.resolvedAt!,
          reoccurredAt: new Date().toISOString(),
        });
        existing.status = 'open';
        existing.resolvedAt = undefined;
        existing.resolvedBy = undefined;
        existing.occurrenceCount++;
      }
      this.issues.set(id, existing);
      return existing;
    }

    // New issue
    const newIssue: QualityIssue = {
      ...issue,
      id,
      status: 'open',
      detectedAt: new Date().toISOString(),
      detectedByVersion: this.version,
      lastVerifiedAt: new Date().toISOString(),
      occurrenceCount: 1,
      previousResolutions: [],
    };

    this.issues.set(id, newIssue);
    return newIssue;
  }

  /**
   * Mark issues in a file as stale (file was re-indexed but issue not detected)
   */
  async markFileIssuesResolved(filePath: string, verifiedIssueIds: Set<string>): Promise<number> {
    let resolved = 0;
    for (const [id, issue] of this.issues) {
      if (issue.filePath === filePath && issue.status === 'open' && !verifiedIssueIds.has(id)) {
        // Issue was not re-detected, mark as resolved
        issue.status = 'resolved';
        issue.resolvedAt = new Date().toISOString();
        issue.resolvedBy = 'auto-detection';
        issue.resolutionNote = 'Issue no longer detected after re-indexing';
        resolved++;
      }
    }
    return resolved;
  }

  // -------------------------------------------------------------------------
  // QUERIES (for agents to find work)
  // -------------------------------------------------------------------------

  /**
   * Query issues matching criteria
   */
  query(q: IssueQuery): QualityIssue[] {
    let results = Array.from(this.issues.values());

    // Filter by criteria
    if (q.categories?.length) {
      results = results.filter(i => q.categories!.includes(i.category));
    }
    if (q.severities?.length) {
      results = results.filter(i => q.severities!.includes(i.severity));
    }
    if (q.statuses?.length) {
      results = results.filter(i => q.statuses!.includes(i.status));
    }
    if (q.filePath) {
      results = results.filter(i => i.filePath === q.filePath);
    }
    if (q.filePattern) {
      const pattern = new RegExp(q.filePattern.replace(/\*/g, '.*'));
      results = results.filter(i => pattern.test(i.filePath));
    }
    if (q.entityId) {
      results = results.filter(i => i.entityId === q.entityId);
    }
    if (q.minImpact !== undefined) {
      results = results.filter(i => i.impactScore >= q.minImpact!);
    }
    if (q.maxEffort !== undefined) {
      results = results.filter(i => i.effortMinutes <= q.maxEffort!);
    }
    if (q.minRoi !== undefined) {
      results = results.filter(i => i.roi >= q.minRoi!);
    }
    if (q.automatable !== undefined) {
      results = results.filter(i => i.automatable === q.automatable);
    }

    // Sort
    const orderBy = q.orderBy || 'roi';
    results.sort((a, b) => {
      switch (orderBy) {
        case 'roi': return b.roi - a.roi;
        case 'severity':
          const sevOrder = { critical: 0, major: 1, minor: 2, info: 3 };
          return sevOrder[a.severity] - sevOrder[b.severity];
        case 'impact': return b.impactScore - a.impactScore;
        case 'effort': return a.effortMinutes - b.effortMinutes;
        case 'detected': return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
        default: return 0;
      }
    });

    // Limit
    if (q.limit) {
      results = results.slice(0, q.limit);
    }

    return results;
  }

  /**
   * Get issues ready for work (open, unclaimed, not blocked)
   */
  getActionableIssues(limit = 20): QualityIssue[] {
    return this.query({
      statuses: ['open'],
      limit,
      orderBy: 'roi',
    }).filter(issue => {
      // Not claimed by another agent
      if (this.claims.has(issue.id)) return false;
      // Not blocked by unresolved issues
      const blockedByUnresolved = issue.blockedBy.some(
        bid => this.issues.get(bid)?.status !== 'resolved'
      );
      if (blockedByUnresolved) return false;
      return true;
    });
  }

  /**
   * Get high-ROI quick wins (low effort, high impact)
   */
  getQuickWins(maxEffortMinutes = 30, limit = 10): QualityIssue[] {
    return this.query({
      statuses: ['open'],
      maxEffort: maxEffortMinutes,
      minRoi: 1.0,
      orderBy: 'roi',
      limit,
    });
  }

  /**
   * Get critical issues requiring immediate attention
   */
  getCriticalIssues(limit = 10): QualityIssue[] {
    return this.query({
      severities: ['critical'],
      statuses: ['open'],
      orderBy: 'impact',
      limit,
    });
  }

  /**
   * Get issues for a specific file (useful when agent is already editing)
   */
  getIssuesForFile(filePath: string): QualityIssue[] {
    return this.query({
      filePath,
      statuses: ['open'],
      orderBy: 'roi',
    });
  }

  // -------------------------------------------------------------------------
  // WORK MANAGEMENT (for agents to claim and resolve)
  // -------------------------------------------------------------------------

  /**
   * Claim an issue to work on
   */
  claimIssue(issueId: string, agentId: string, expectedMinutes?: number): IssueClaim | null {
    const issue = this.issues.get(issueId);
    if (!issue) return null;
    if (issue.status !== 'open') return null;
    if (this.claims.has(issueId)) return null;

    issue.status = 'claimed';
    const claim: IssueClaim = {
      issueId,
      agentId,
      claimedAt: new Date().toISOString(),
      expectedCompletionAt: expectedMinutes
        ? new Date(Date.now() + expectedMinutes * 60000).toISOString()
        : undefined,
    };
    this.claims.set(issueId, claim);
    return claim;
  }

  /**
   * Mark issue as being actively worked on
   */
  startWork(issueId: string, agentId: string): boolean {
    const issue = this.issues.get(issueId);
    const claim = this.claims.get(issueId);
    if (!issue || !claim) return false;
    if (claim.agentId !== agentId) return false;

    issue.status = 'in_progress';
    return true;
  }

  /**
   * Mark issue as resolved
   */
  resolveIssue(issueId: string, agentId: string, note?: string): boolean {
    const issue = this.issues.get(issueId);
    if (!issue) return false;

    issue.status = 'resolved';
    issue.resolvedAt = new Date().toISOString();
    issue.resolvedBy = agentId;
    issue.resolutionNote = note;
    this.claims.delete(issueId);
    return true;
  }

  /**
   * Mark issue as won't fix
   */
  wontFix(issueId: string, agentId: string, reason: string): boolean {
    const issue = this.issues.get(issueId);
    if (!issue) return false;

    issue.status = 'wont_fix';
    issue.resolvedAt = new Date().toISOString();
    issue.resolvedBy = agentId;
    issue.resolutionNote = reason;
    this.claims.delete(issueId);
    return true;
  }

  /**
   * Mark issue as false positive (improves detection over time)
   */
  markFalsePositive(issueId: string, agentId: string, reason: string): boolean {
    const issue = this.issues.get(issueId);
    if (!issue) return false;

    issue.status = 'false_positive';
    issue.resolvedAt = new Date().toISOString();
    issue.resolvedBy = agentId;
    issue.resolutionNote = reason;
    this.claims.delete(issueId);
    return true;
  }

  /**
   * Abandon a claim (agent couldn't complete work)
   */
  abandonClaim(issueId: string, agentId: string): boolean {
    const issue = this.issues.get(issueId);
    const claim = this.claims.get(issueId);
    if (!issue || !claim) return false;
    if (claim.agentId !== agentId) return false;

    issue.status = 'open';
    this.claims.delete(issueId);
    return true;
  }

  /**
   * Release stale claims (claimed > 1 hour ago, not in_progress)
   */
  releaseStaleClaimsInternal(): number {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let released = 0;

    for (const [issueId, claim] of this.claims) {
      const issue = this.issues.get(issueId);
      if (!issue) continue;
      if (issue.status === 'in_progress') continue; // Don't release active work

      if (new Date(claim.claimedAt).getTime() < oneHourAgo) {
        issue.status = 'open';
        this.claims.delete(issueId);
        released++;
      }
    }

    return released;
  }

  // -------------------------------------------------------------------------
  // STATISTICS
  // -------------------------------------------------------------------------

  getStats(): IssueRegistryStats {
    const issues = Array.from(this.issues.values());

    const bySeverity: Record<IssueSeverity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
    const byCategory: Record<IssueCategory, number> = {
      complexity: 0, size: 0, coupling: 0, dead_code: 0, test_coverage: 0,
      documentation: 0, security: 0, architecture: 0, naming: 0, duplication: 0, debt: 0,
    };
    const byStatus: Record<IssueStatus, number> = {
      open: 0, claimed: 0, in_progress: 0, resolved: 0, wont_fix: 0, false_positive: 0,
    };

    let totalEffort = 0;
    let totalRoi = 0;
    let oldestOpen: Date | null = null;

    for (const issue of issues) {
      bySeverity[issue.severity]++;
      byCategory[issue.category]++;
      byStatus[issue.status]++;
      totalEffort += issue.effortMinutes;
      totalRoi += issue.roi;

      if (issue.status === 'open') {
        const detected = new Date(issue.detectedAt);
        if (!oldestOpen || detected < oldestOpen) {
          oldestOpen = detected;
        }
      }
    }

    return {
      total: issues.length,
      bySeverity,
      byCategory,
      byStatus,
      totalEffortMinutes: totalEffort,
      avgRoi: issues.length > 0 ? totalRoi / issues.length : 0,
      oldestUnresolvedDays: oldestOpen
        ? Math.floor((Date.now() - oldestOpen.getTime()) / (1000 * 60 * 60 * 24))
        : 0,
    };
  }

  // -------------------------------------------------------------------------
  // EXPORT
  // -------------------------------------------------------------------------

  /**
   * Export all issues as JSON (for external tools, CI)
   */
  exportJson(): string {
    return JSON.stringify({
      version: this.version,
      exportedAt: new Date().toISOString(),
      workspace: this.workspace,
      stats: this.getStats(),
      issues: Array.from(this.issues.values()),
    }, null, 2);
  }

  /**
   * Export for agent prompt (concise summary)
   */
  exportForAgent(limit = 20): string {
    const actionable = this.getActionableIssues(limit);
    const stats = this.getStats();

    let prompt = `## Code Quality Issues (${stats.byStatus.open} open)\n\n`;
    prompt += `**Summary**: ${stats.bySeverity.critical} critical, ${stats.bySeverity.major} major, ~${Math.round(stats.totalEffortMinutes / 60)}h total effort\n\n`;

    if (actionable.length === 0) {
      prompt += `No actionable issues found.\n`;
      return prompt;
    }

    prompt += `### Top ${actionable.length} Issues by ROI:\n\n`;
    for (const issue of actionable) {
      prompt += `- **[${issue.severity.toUpperCase()}]** ${issue.title}\n`;
      prompt += `  - File: \`${issue.filePath}:${issue.startLine || 1}\`\n`;
      prompt += `  - Effort: ${issue.effortMinutes}min | Impact: ${(issue.impactScore * 100).toFixed(0)}% | ROI: ${issue.roi.toFixed(1)}\n`;
      if (issue.suggestedFix) {
        prompt += `  - Fix: ${issue.suggestedFix}\n`;
      }
      prompt += `\n`;
    }

    return prompt;
  }

  // -------------------------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------------------------

  private generateIssueId(issue: Pick<QualityIssue, 'category' | 'filePath' | 'entityId' | 'title'>): string {
    // Deterministic ID so we can track the same issue over time
    const parts = [
      issue.category,
      issue.filePath,
      issue.entityId || 'file',
      issue.title.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 50),
    ];
    return parts.join(':');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let registryInstance: QualityIssueRegistry | null = null;

export async function getQualityRegistry(
  storage: LiBrainianStorage,
  workspace: string,
): Promise<QualityIssueRegistry> {
  if (!registryInstance) {
    registryInstance = new QualityIssueRegistry(storage, workspace);
    await registryInstance.initialize();
  }
  return registryInstance;
}

export function resetQualityRegistry(): void {
  registryInstance = null;
}
