/**
 * @fileoverview MCP Audit Logging Module
 *
 * Provides comprehensive audit logging for MCP server operations:
 * - Structured audit log persistence
 * - Tool call tracking with inputs/outputs
 * - Resource access logging
 * - Session activity tracking
 * - Audit log queries and export
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { IEvidenceLedger } from '../epistemics/evidence_ledger.js';
import { createSessionId } from '../epistemics/evidence_ledger.js';

// ============================================================================
// TYPES
// ============================================================================

/** Audit event types */
export type AuditEventType =
  | 'tool_call'
  | 'resource_read'
  | 'authorization'
  | 'session'
  | 'error'
  | 'system';

/** Audit event severity */
export type AuditSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

/** Audit event status */
export type AuditStatus = 'success' | 'failure' | 'denied' | 'pending';

/** Structured audit event */
export interface AuditEvent {
  /** Unique event ID */
  id: string;

  /** Event timestamp (ISO 8601) */
  timestamp: string;

  /** Event type */
  type: AuditEventType;

  /** Event severity */
  severity: AuditSeverity;

  /** Operation name (tool name, resource URI, etc.) */
  operation: string;

  /** Event status */
  status: AuditStatus;

  /** Session ID if available */
  sessionId?: string;

  /** Client ID if available */
  clientId?: string;

  /** Workspace path if applicable */
  workspace?: string;

  /** Input data (sanitized) */
  input?: Record<string, unknown>;

  /** Output summary */
  output?: Record<string, unknown>;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Error message if failed */
  error?: string;

  /** Stack trace for errors (debug only) */
  stackTrace?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Hash of sensitive data (for verification without exposure) */
  dataHash?: string;
}

/** Audit query options */
export interface AuditQueryOptions {
  /** Filter by event type */
  type?: AuditEventType | AuditEventType[];

  /** Filter by severity */
  severity?: AuditSeverity | AuditSeverity[];

  /** Filter by status */
  status?: AuditStatus | AuditStatus[];

  /** Filter by session ID */
  sessionId?: string;

  /** Filter by client ID */
  clientId?: string;

  /** Filter by workspace */
  workspace?: string;

  /** Filter by operation name (supports glob patterns) */
  operation?: string;

  /** Start time (ISO 8601) */
  since?: string;

  /** End time (ISO 8601) */
  until?: string;

  /** Maximum results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Sort order */
  order?: 'asc' | 'desc';
}

/** Audit statistics */
export interface AuditStats {
  /** Total event count */
  totalEvents: number;

  /** Events by type */
  byType: Record<AuditEventType, number>;

  /** Events by severity */
  bySeverity: Record<AuditSeverity, number>;

  /** Events by status */
  byStatus: Record<AuditStatus, number>;

  /** Unique sessions */
  uniqueSessions: number;

  /** Unique clients */
  uniqueClients: number;

  /** Time range */
  timeRange: {
    earliest?: string;
    latest?: string;
  };

  /** Average duration for tool calls (ms) */
  avgToolDurationMs: number;

  /** Error rate (percentage) */
  errorRate: number;
}

/** Audit export format */
export type AuditExportFormat = 'json' | 'jsonl' | 'csv';

/** Audit logger configuration */
export interface AuditLoggerConfig {
  /** Maximum in-memory events */
  maxMemoryEvents: number;

  /** Enable file persistence */
  persistToFile: boolean;

  /** Log file directory */
  logDir: string;

  /** Log file prefix */
  logFilePrefix: string;

  /** Maximum log file size (bytes) */
  maxFileSizeBytes: number;

  /** Maximum log files to retain */
  maxFiles: number;

  /** Minimum severity to log */
  minSeverity: AuditSeverity;

  /** Include stack traces for errors */
  includeStackTraces: boolean;

  /** Redact sensitive fields */
  redactSensitiveFields: boolean;

  /** Sensitive field patterns */
  sensitivePatterns: RegExp[];
}

/** Default audit logger configuration */
export const DEFAULT_AUDIT_CONFIG: AuditLoggerConfig = {
  maxMemoryEvents: 10000,
  persistToFile: false,
  logDir: '.librarian/audit',
  logFilePrefix: 'audit',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  maxFiles: 10,
  minSeverity: 'info',
  includeStackTraces: false,
  redactSensitiveFields: true,
  sensitivePatterns: [
    /password/i,
    /secret/i,
    /token/i,
    /key/i,
    /credential/i,
    /auth/i,
  ],
};

// ============================================================================
// SEVERITY LEVELS
// ============================================================================

const SEVERITY_LEVELS: Record<AuditSeverity, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

// ============================================================================
// AUDIT LOGGER
// ============================================================================

/**
 * Structured audit logger for MCP operations.
 */
export class AuditLogger {
  private events: AuditEvent[] = [];
  private config: AuditLoggerConfig;
  private currentLogFile: string | null = null;
  private currentFileSize: number = 0;
  private writeQueue: AuditEvent[] = [];
  private isWriting: boolean = false;
  private ledger?: IEvidenceLedger;
  private pendingLedgerWrites: Promise<unknown>[] = [];

  constructor(config: Partial<AuditLoggerConfig> = {}, options: { ledger?: IEvidenceLedger } = {}) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
    this.ledger = options.ledger;
  }

  async flushLedgerWrites(): Promise<void> {
    if (this.pendingLedgerWrites.length === 0) return;
    const pending = this.pendingLedgerWrites;
    this.pendingLedgerWrites = [];
    await Promise.all(pending);
  }

  // ==========================================================================
  // EVENT LOGGING
  // ==========================================================================

  /**
   * Log an audit event.
   */
  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    // Check minimum severity
    if (SEVERITY_LEVELS[event.severity] < SEVERITY_LEVELS[this.config.minSeverity]) {
      return { ...event, id: '', timestamp: '' } as AuditEvent;
    }

    const fullEvent: AuditEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
    };

    // Redact sensitive fields
    if (this.config.redactSensitiveFields && fullEvent.input) {
      fullEvent.input = this.redactSensitive(fullEvent.input);
    }

    // Add data hash for verification
    if (fullEvent.input || fullEvent.output) {
      fullEvent.dataHash = this.hashData(fullEvent.input, fullEvent.output);
    }

    // Store in memory
    this.events.push(fullEvent);

    // Trim if over limit
    while (this.events.length > this.config.maxMemoryEvents) {
      this.events.shift();
    }

    // Persist to file if enabled
    if (this.config.persistToFile) {
      this.queueWrite(fullEvent);
    }

    if (this.ledger) {
      this.pendingLedgerWrites.push(this.appendToEvidenceLedger(fullEvent));
    }

    return fullEvent;
  }

  private async appendToEvidenceLedger(event: AuditEvent): Promise<void> {
    const ledger = this.ledger;
    if (!ledger) return;

    try {
      if (event.type !== 'tool_call') return;

      const sessionId = event.sessionId ? createSessionId(event.sessionId) : undefined;
      const estimated = this.estimateToolCallMetrics(event);
      const metadata = event.metadata && typeof event.metadata === 'object'
        ? event.metadata as Record<string, unknown>
        : {};
      const explicitCost = this.toFiniteNumber(metadata.costUsd);
      const explicitAttempt = this.toFiniteNumber(metadata.attemptNumber);
      const cacheHit = this.toBoolean(metadata.cacheHit)
        ?? this.toBoolean((event.output as Record<string, unknown> | undefined)?.cacheHit)
        ?? false;
      await ledger.append({
        kind: 'tool_call',
        payload: {
          toolName: event.operation,
          arguments: event.input ?? {},
          result: event.output ?? null,
          success: event.status === 'success',
          durationMs: event.durationMs ?? 0,
          costUsd: explicitCost ?? estimated.costUsd,
          agentId: event.clientId,
          attemptNumber: explicitAttempt ? Math.max(1, Math.trunc(explicitAttempt)) : 1,
          cacheHit,
          tokenUsage: estimated.tokenUsage,
          errorMessage: event.error,
        },
        provenance: {
          source: 'tool_output',
          method: 'mcp_audit_logger',
          agent: {
            type: 'tool',
            identifier: event.clientId ?? 'mcp',
          },
          inputHash: event.dataHash,
          config: {
            severity: event.severity,
            status: event.status,
            workspace: event.workspace,
            estimatedCost: explicitCost === null,
          },
        },
        relatedEntries: [],
        sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.push({
        id: this.generateEventId(),
        timestamp: new Date().toISOString(),
        type: 'error',
        severity: 'error',
        operation: 'evidence_ledger_append',
        status: 'failure',
        error: `unverified_by_trace(evidence_ledger_append_failed): ${message}`,
      });
    }
  }

  /**
   * Log a tool call event.
   */
  logToolCall(options: {
    operation: string;
    status: AuditStatus;
    sessionId?: string;
    clientId?: string;
    workspace?: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    durationMs?: number;
    metadata?: Record<string, unknown>;
    error?: string;
  }): AuditEvent {
    return this.log({
      type: 'tool_call',
      severity: options.status === 'failure' ? 'error' : 'info',
      ...options,
    });
  }

  /**
   * Log a resource access event.
   */
  logResourceAccess(options: {
    operation: string;
    status: AuditStatus;
    sessionId?: string;
    clientId?: string;
    workspace?: string;
    durationMs?: number;
    error?: string;
  }): AuditEvent {
    return this.log({
      type: 'resource_read',
      severity: options.status === 'failure' ? 'warning' : 'debug',
      ...options,
    });
  }

  /**
   * Log an authorization event.
   */
  logAuthorization(options: {
    operation: string;
    status: AuditStatus;
    sessionId?: string;
    clientId?: string;
    workspace?: string;
    metadata?: Record<string, unknown>;
    error?: string;
  }): AuditEvent {
    return this.log({
      type: 'authorization',
      severity: options.status === 'denied' ? 'warning' : 'info',
      ...options,
    });
  }

  /**
   * Log a session event.
   */
  logSession(options: {
    operation: string;
    status: AuditStatus;
    sessionId?: string;
    clientId?: string;
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    return this.log({
      type: 'session',
      severity: 'info',
      ...options,
    });
  }

  /**
   * Log an error event.
   */
  logError(options: {
    operation: string;
    error: string;
    sessionId?: string;
    clientId?: string;
    workspace?: string;
    stackTrace?: string;
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    return this.log({
      type: 'error',
      severity: 'error',
      status: 'failure',
      ...options,
      stackTrace: this.config.includeStackTraces ? options.stackTrace : undefined,
    });
  }

  /**
   * Log a system event.
   */
  logSystem(options: {
    operation: string;
    severity?: AuditSeverity;
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    return this.log({
      type: 'system',
      severity: options.severity ?? 'info',
      status: 'success',
      ...options,
    });
  }

  // ==========================================================================
  // QUERYING
  // ==========================================================================

  /**
   * Query audit events.
   */
  query(options: AuditQueryOptions = {}): AuditEvent[] {
    let results = [...this.events];

    // Apply filters
    if (options.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type];
      results = results.filter((e) => types.includes(e.type));
    }

    if (options.severity) {
      const severities = Array.isArray(options.severity)
        ? options.severity
        : [options.severity];
      results = results.filter((e) => severities.includes(e.severity));
    }

    if (options.status) {
      const statuses = Array.isArray(options.status)
        ? options.status
        : [options.status];
      results = results.filter((e) => statuses.includes(e.status));
    }

    if (options.sessionId) {
      results = results.filter((e) => e.sessionId === options.sessionId);
    }

    if (options.clientId) {
      results = results.filter((e) => e.clientId === options.clientId);
    }

    if (options.workspace) {
      results = results.filter((e) => e.workspace === options.workspace);
    }

    if (options.operation) {
      const pattern = this.globToRegex(options.operation);
      results = results.filter((e) => pattern.test(e.operation));
    }

    if (options.since) {
      const since = new Date(options.since);
      results = results.filter((e) => new Date(e.timestamp) >= since);
    }

    if (options.until) {
      const until = new Date(options.until);
      results = results.filter((e) => new Date(e.timestamp) <= until);
    }

    // Sort
    results.sort((a, b) => {
      const order = options.order === 'asc' ? 1 : -1;
      return order * (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    });

    // Pagination
    if (options.offset) {
      results = results.slice(options.offset);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get the most recent events.
   */
  getRecent(limit: number = 100): AuditEvent[] {
    return this.query({ limit, order: 'desc' });
  }

  /**
   * Get events for a session.
   */
  getSessionEvents(sessionId: string): AuditEvent[] {
    return this.query({ sessionId, order: 'asc' });
  }

  /**
   * Get error events.
   */
  getErrors(since?: string): AuditEvent[] {
    return this.query({
      type: 'error',
      since,
      order: 'desc',
    });
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get audit statistics.
   */
  getStats(): AuditStats {
    const byType: Record<AuditEventType, number> = {
      tool_call: 0,
      resource_read: 0,
      authorization: 0,
      session: 0,
      error: 0,
      system: 0,
    };

    const bySeverity: Record<AuditSeverity, number> = {
      debug: 0,
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };

    const byStatus: Record<AuditStatus, number> = {
      success: 0,
      failure: 0,
      denied: 0,
      pending: 0,
    };

    const sessions = new Set<string>();
    const clients = new Set<string>();
    let totalToolDuration = 0;
    let toolCallCount = 0;
    let errorCount = 0;

    for (const event of this.events) {
      byType[event.type]++;
      bySeverity[event.severity]++;
      byStatus[event.status]++;

      if (event.sessionId) sessions.add(event.sessionId);
      if (event.clientId) clients.add(event.clientId);

      if (event.type === 'tool_call' && event.durationMs !== undefined) {
        totalToolDuration += event.durationMs;
        toolCallCount++;
      }

      if (event.status === 'failure') {
        errorCount++;
      }
    }

    return {
      totalEvents: this.events.length,
      byType,
      bySeverity,
      byStatus,
      uniqueSessions: sessions.size,
      uniqueClients: clients.size,
      timeRange: {
        earliest: this.events[0]?.timestamp,
        latest: this.events[this.events.length - 1]?.timestamp,
      },
      avgToolDurationMs: toolCallCount > 0 ? totalToolDuration / toolCallCount : 0,
      errorRate: this.events.length > 0 ? (errorCount / this.events.length) * 100 : 0,
    };
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /**
   * Export audit log to a file.
   */
  async export(
    outputPath: string,
    format: AuditExportFormat = 'json',
    options: AuditQueryOptions = {}
  ): Promise<{ path: string; eventCount: number }> {
    const events = this.query(options);
    const resolvedPath = path.resolve(outputPath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    let content: string;
    switch (format) {
      case 'json':
        content = JSON.stringify(events, null, 2);
        break;
      case 'jsonl':
        content = events.map((e) => JSON.stringify(e)).join('\n');
        break;
      case 'csv':
        content = this.toCSV(events);
        break;
    }

    await fs.writeFile(resolvedPath, content, 'utf-8');

    return { path: resolvedPath, eventCount: events.length };
  }

  /**
   * Clear all events from memory.
   */
  clear(): number {
    const count = this.events.length;
    this.events = [];
    return count;
  }

  /**
   * Get total event count.
   */
  get size(): number {
    return this.events.length;
  }

  // ==========================================================================
  // FILE PERSISTENCE
  // ==========================================================================

  /**
   * Initialize file persistence.
   */
  async initPersistence(baseDir: string): Promise<void> {
    this.config.persistToFile = true;
    this.config.logDir = path.join(baseDir, this.config.logDir);

    await fs.mkdir(this.config.logDir, { recursive: true });
    await this.rotateLogFile();
  }

  /**
   * Flush pending writes to disk.
   */
  async flush(): Promise<void> {
    if (this.writeQueue.length === 0) return;

    const toWrite = [...this.writeQueue];
    this.writeQueue = [];

    if (!this.currentLogFile) {
      await this.rotateLogFile();
    }

    const lines = toWrite.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(this.currentLogFile!, lines, 'utf-8');

    this.currentFileSize += Buffer.byteLength(lines, 'utf-8');

    if (this.currentFileSize >= this.config.maxFileSizeBytes) {
      await this.rotateLogFile();
    }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private generateEventId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `evt_${timestamp}_${random}`;
  }

  private redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const isSensitive = this.config.sensitivePatterns.some((p) => p.test(key));

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        redacted[key] = this.redactSensitive(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  private hashData(
    input?: Record<string, unknown>,
    output?: Record<string, unknown>
  ): string {
    const data = JSON.stringify({ input, output });
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private toCSV(events: AuditEvent[]): string {
    const headers = [
      'id',
      'timestamp',
      'type',
      'severity',
      'operation',
      'status',
      'sessionId',
      'clientId',
      'workspace',
      'durationMs',
      'error',
    ];

    const rows = events.map((e) =>
      headers
        .map((h) => {
          const value = e[h as keyof AuditEvent];
          if (value === undefined || value === null) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value).includes(',') ? `"${value}"` : String(value);
        })
        .join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  private queueWrite(event: AuditEvent): void {
    this.writeQueue.push(event);

    if (!this.isWriting && this.writeQueue.length >= 100) {
      this.isWriting = true;
      this.flush()
        .catch(console.error)
        .finally(() => {
          this.isWriting = false;
        });
    }
  }

  private async rotateLogFile(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(
      this.config.logDir,
      `${this.config.logFilePrefix}-${timestamp}.jsonl`
    );
    this.currentFileSize = 0;

    // Clean up old files
    await this.cleanupOldFiles();
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.logDir);
      const logFiles = files
        .filter((f) => f.startsWith(this.config.logFilePrefix) && f.endsWith('.jsonl'))
        .sort()
        .reverse();

      // Remove files beyond retention limit
      for (const file of logFiles.slice(this.config.maxFiles)) {
        await fs.unlink(path.join(this.config.logDir, file));
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private estimateToolCallMetrics(event: AuditEvent): {
    costUsd: number;
    tokenUsage: {
      input: number;
      output: number;
      total: number;
      estimator: 'chars_div_4';
      model?: string;
    };
  } {
    const metadata = event.metadata && typeof event.metadata === 'object'
      ? event.metadata as Record<string, unknown>
      : {};
    const model = typeof metadata.model === 'string' ? metadata.model : undefined;
    const inputTokens = this.estimateTokens(event.input);
    const outputTokens = this.estimateTokens(event.output);
    const totalTokens = inputTokens + outputTokens;

    const inputRate = this.readCostRate('LIBRARIAN_COST_INPUT_PER_1M', 3);
    const outputRate = this.readCostRate('LIBRARIAN_COST_OUTPUT_PER_1M', 15);
    const costUsd = Number((((inputTokens / 1_000_000) * inputRate) + ((outputTokens / 1_000_000) * outputRate)).toFixed(8));

    return {
      costUsd,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
        estimator: 'chars_div_4',
        ...(model ? { model } : {}),
      },
    };
  }

  private estimateTokens(value: unknown): number {
    if (value === undefined || value === null) return 0;
    try {
      return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
    } catch {
      return 0;
    }
  }

  private readCostRate(envVar: string, fallback: number): number {
    const raw = process.env[envVar];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return null;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an audit logger with configuration.
 */
export function createAuditLogger(
  config?: Partial<AuditLoggerConfig>,
  options: { ledger?: IEvidenceLedger } = {}
): AuditLogger {
  return new AuditLogger(config, options);
}
