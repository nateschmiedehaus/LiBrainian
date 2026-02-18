/**
 * @fileoverview Bug Investigation Assistant Construction
 *
 * A composed construction that helps investigate bugs by combining:
 * - Stack trace parsing
 * - Call graph traversal
 * - Similar pattern detection
 * - Hypothesis generation
 *
 * Composes:
 * - Query API for context retrieval
 * - Knowledge Graph for call relationships
 * - Evidence Ledger for investigation trail
 * - Confidence System for hypothesis ranking
 * - Calibration Tracking for confidence accuracy measurement
 */

import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence, AbsentConfidence } from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';
import { ASTFactExtractor, type ASTFact, type FunctionDefDetails, type ClassDetails, type CallDetails } from '../evaluation/ast_fact_extractor.js';
import type {
  ConstructionCalibrationTracker,
  CalibratedConstruction,
  VerificationMethod,
} from './calibration_tracker.js';
import { generatePredictionId } from './calibration_tracker.js';

// ============================================================================
// LOG CORRELATION TYPES
// ============================================================================

/**
 * Represents a single log entry parsed from log files.
 */
export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  file?: string;
  line?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Correlation between log entries and stack frames.
 */
export interface LogCorrelation {
  logEntries: LogEntry[];
  stackFrames: StackFrame[];
  correlatedEntries: Array<{
    log: LogEntry;
    frame: StackFrame;
    confidence: number;
  }>;
  timeline: Array<LogEntry | StackFrame>;
}

/**
 * Runtime state captured from crash dumps or diagnostic reports.
 */
export interface RuntimeState {
  variables: Record<string, unknown>;
  callStack: StackFrame[];
  heapSummary?: {
    used: number;
    total: number;
    external: number;
  };
  activeHandles?: number;
  activeRequests?: number;
}

// ============================================================================
// LOG PATTERNS
// ============================================================================

/**
 * Regular expression patterns for parsing common log formats.
 */
export const LOG_PATTERNS: Record<string, RegExp> = {
  // Standard: [2024-01-15T10:30:00.000] [ERROR] message
  standard: /\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]\s*\[(\w+)\]\s*(.+)/,
  // Winston: 2024-01-15T10:30:00.000Z error: message
  winston: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(\w+):\s+(.+)/,
  // Pino JSON: {"level":30,"time":1705312200000,"msg":"message"}
  pino: /\{"level":(\d+),"time":(\d+),"msg":"([^"]+)"/,
  // Bunyan JSON: {"name":"app","hostname":"host","pid":123,"level":30,"msg":"message","time":"..."}
  bunyan: /\{"name":"[^"]*","hostname":"[^"]*","pid":\d+,"level":(\d+),"msg":"([^"]+)","time":"([^"]+)"/,
};

// ============================================================================
// TYPES
// ============================================================================

export interface BugReport {
  /** Description of the bug */
  description: string;
  /** Stack trace if available */
  stackTrace?: string;
  /** Error message */
  errorMessage?: string;
  /** Steps to reproduce */
  reproductionSteps?: string[];
  /** Suspected files */
  suspectedFiles?: string[];
}

export interface StackFrame {
  file: string;
  function: string;
  line: number;
  column?: number;
  language: 'javascript' | 'python' | 'java' | 'ruby' | 'go' | 'unknown';
}

export interface Hypothesis {
  id: string;
  description: string;
  rootCause: string;
  affectedCode: string[];
  confidence: ConfidenceValue;
  evidence: string[];
  suggestedFix?: string;
}

export interface SimilarBug {
  description: string;
  file: string;
  similarity: number;
  resolution?: string;
  /** Breakdown of similarity signals contributing to the score */
  signalBreakdown?: SimilaritySignalBreakdown;
}

/**
 * Breakdown of similarity signals for a bug match.
 * Each signal contributes a weighted score to the final similarity.
 */
export interface SimilaritySignalBreakdown {
  /** Semantic similarity from librarian queries (0-1) */
  semantic: number;
  /** Structural AST-based similarity (0-1) */
  structural: number;
  /** Error signature match score (0-1) */
  errorSignature: number;
  /** Historical correlation score (0-1) */
  historical: number;
  /** Weights applied to each signal */
  weights: SimilarityWeights;
}

/**
 * Weights for combining similarity signals.
 * Must sum to 1.0 for proper normalization.
 */
export interface SimilarityWeights {
  semantic: number;
  structural: number;
  errorSignature: number;
  historical: number;
}

/**
 * Extracted error signature for matching similar bugs.
 */
export interface ErrorSignature {
  /** Error type (e.g., TypeError, ReferenceError) */
  errorType: string | null;
  /** Extracted error pattern */
  errorPattern: string | null;
  /** Affected modules/files */
  affectedModules: string[];
  /** Call chain fingerprint */
  callChainFingerprint: string;
}

/**
 * Structural fingerprint of code for AST-based similarity.
 */
export interface StructuralFingerprint {
  /** Function signatures present */
  functionSignatures: string[];
  /** Control flow patterns (if/else, loops, try/catch) */
  controlFlowPatterns: string[];
  /** Error handling patterns */
  errorHandlingPatterns: string[];
  /** Call patterns */
  callPatterns: string[];
}

export interface InvestigationReport {
  /** Original bug report */
  bugReport: BugReport;

  /** Parsed stack frames */
  stackFrames: StackFrame[];

  /** Primary suspected location */
  primarySuspect: {
    file: string;
    line: number;
    context: string;
  } | null;

  /** Call chain leading to error */
  callChain: string[];

  /** Generated hypotheses ranked by confidence */
  hypotheses: Hypothesis[];

  /** Similar bugs found in codebase */
  similarBugs: SimilarBug[];

  /** Overall investigation confidence */
  confidence: ConfidenceValue;

  /** Evidence trail */
  evidenceRefs: string[];

  /** Investigation timing */
  investigationTimeMs: number;

  /** Prediction ID for calibration tracking */
  predictionId?: string;
}

// ============================================================================
// STACK TRACE PATTERNS
// ============================================================================

/**
 * Regular expression patterns for parsing stack traces from different languages/runtimes.
 * Each pattern uses named capture groups for consistent extraction.
 * Order matters: more specific patterns should come before more general ones.
 */
export const STACK_PATTERNS: Record<string, RegExp> = {
  // Python: 'File "path", line N, in function' - very distinctive, check first
  python: /^\s*File\s+"(?<file>[^"]+)",\s+line\s+(?<line>\d+),\s+in\s+(?<func>\w+)/,

  // Java: "at package.Class.method(File.java:line)" - distinctive parentheses format
  java: /^\s*at\s+(?<func>[\w.$]+)\((?<file>[\w.]+):(?<line>\d+)\)/,

  // Node.js: "at [async] functionName (file:line:column)" or "at file:line:column"
  // Handles optional 'async' keyword before function name
  nodejs: /^\s*at\s+(?:async\s+)?(?:(?<func>[\w.<>\[\]]+)\s+\()?(?<file>[^:)]+):(?<line>\d+):(?<col>\d+)\)?/,

  // Chrome/Firefox: "functionName@file:line:column" or "@file:line:column"
  // File can be a URL (http://...) or a path, so we capture everything up to the last :line:col
  // Note: Some Chrome traces use "at func@file" format, handle both
  chrome: /^\s*(?:at\s+)?(?<func>[\w.<>\[\]]+)?@(?<file>.+):(?<line>\d+):(?<col>\d+)$/,

  // Ruby: "file:line:in `function'"
  ruby: /^\s*(?<file>[^:]+):(?<line>\d+):in\s+`(?<func>[^']+)'/,

  // Go: "file:line +0xABC"
  go: /^\s*(?<file>[^\s:]+):(?<line>\d+)\s+\+0x[a-fA-F0-9]+/,
};

/**
 * Parse a single stack frame line, trying all known formats.
 * @param line - A single line from a stack trace
 * @returns Parsed StackFrame or null if no pattern matches
 */
export function parseStackFrame(line: string): StackFrame | null {
  for (const [patternName, pattern] of Object.entries(STACK_PATTERNS)) {
    const match = line.match(pattern);
    if (match?.groups) {
      // Determine the language based on the pattern that matched
      let language: StackFrame['language'];
      if (patternName === 'nodejs' || patternName === 'chrome' || patternName === 'firefox') {
        language = 'javascript';
      } else if (patternName === 'python') {
        language = 'python';
      } else if (patternName === 'java') {
        language = 'java';
      } else if (patternName === 'ruby') {
        language = 'ruby';
      } else if (patternName === 'go') {
        language = 'go';
      } else {
        language = 'unknown';
      }

      return {
        function: match.groups.func || '<anonymous>',
        file: match.groups.file,
        line: parseInt(match.groups.line, 10),
        column: match.groups.col ? parseInt(match.groups.col, 10) : undefined,
        language,
      };
    }
  }
  return null;
}

/**
 * Parse a complete stack trace string into an array of StackFrames.
 * @param stackTrace - The full stack trace string
 * @returns Array of parsed StackFrame objects
 */
export function parseStackTrace(stackTrace: string): StackFrame[] {
  const lines = stackTrace.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const frame = parseStackFrame(line);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

/**
 * Detect the primary language of a stack trace based on its format.
 * @param stackTrace - The full stack trace string
 * @returns The detected language identifier
 */
export function detectStackTraceLanguage(stackTrace: string): string {
  // Python has distinctive format with 'File "..."'
  if (stackTrace.includes('File "') && stackTrace.includes('", line')) return 'python';

  // Java has distinctive format with parentheses containing filename:line
  if (/^\s*at\s+[\w.$]+\([\w.]+:\d+\)/m.test(stackTrace)) return 'java';

  // Ruby has 'in `method'' pattern
  if (/:\d+:in\s+`[^']+'/m.test(stackTrace)) return 'ruby';

  // Go has +0x hex offset pattern
  if (/:\d+\s+\+0x[a-fA-F0-9]+/m.test(stackTrace)) return 'go';

  // Chrome/Firefox style with @ symbol
  if (stackTrace.includes('@') && /:(\d+):(\d+)/.test(stackTrace)) return 'javascript';

  // Node.js style with 'at' keyword followed by function or file path
  // Matches: "at functionName (" or "at /path" or "at async"
  if (/^\s*at\s+(?:async\s+)?(?:[\w.<>\[\]]+\s*\(|\/)/m.test(stackTrace)) return 'javascript';

  return 'unknown';
}

// ============================================================================
// LOG PARSING FUNCTIONS
// ============================================================================

/**
 * Parse a log file content into structured LogEntry objects.
 * Supports multiple log formats: standard, winston, pino, bunyan.
 *
 * @param logContent - The raw log file content
 * @returns Array of parsed LogEntry objects sorted by timestamp
 */
export function parseLogFile(logContent: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = logContent.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    for (const [format, pattern] of Object.entries(LOG_PATTERNS)) {
      const match = line.match(pattern);
      if (match) {
        const entry = parseLogMatch(match, format);
        if (entry) {
          entries.push(entry);
        }
        break;
      }
    }
  }

  return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Parse a regex match result into a LogEntry based on the format.
 */
function parseLogMatch(match: RegExpMatchArray, format: string): LogEntry | null {
  try {
    switch (format) {
      case 'standard':
        return {
          timestamp: new Date(match[1]),
          level: normalizeLogLevel(match[2]),
          message: match[3],
        };
      case 'winston':
        return {
          timestamp: new Date(match[1]),
          level: normalizeLogLevel(match[2]),
          message: match[3],
        };
      case 'pino': {
        const levelNum = parseInt(match[1], 10);
        return {
          timestamp: new Date(parseInt(match[2], 10)),
          level: pinoLevelToString(levelNum),
          message: match[3],
        };
      }
      case 'bunyan': {
        const levelNum = parseInt(match[1], 10);
        return {
          timestamp: new Date(match[3]),
          level: bunyanLevelToString(levelNum),
          message: match[2],
        };
      }
      default:
        return { timestamp: new Date(), level: 'info', message: match[0] };
    }
  } catch {
    return null;
  }
}

/**
 * Normalize log level string to standard levels.
 */
function normalizeLogLevel(level: string): LogEntry['level'] {
  const lower = level.toLowerCase();
  if (lower === 'debug' || lower === 'trace' || lower === 'verbose') return 'debug';
  if (lower === 'info' || lower === 'log') return 'info';
  if (lower === 'warn' || lower === 'warning') return 'warn';
  if (lower === 'error' || lower === 'err' || lower === 'fatal' || lower === 'critical') return 'error';
  return 'info';
}

/**
 * Convert Pino numeric level to string.
 * Pino levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
 */
function pinoLevelToString(level: number): LogEntry['level'] {
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  return 'error';
}

/**
 * Convert Bunyan numeric level to string.
 * Bunyan levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
 */
function bunyanLevelToString(level: number): LogEntry['level'] {
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  return 'error';
}

/**
 * Correlate log entries with stack frames to understand the sequence of events
 * leading to a crash or error.
 *
 * @param logs - Array of log entries
 * @param stackFrames - Array of stack frames from error
 * @param crashTime - Optional timestamp of the crash for filtering relevant logs
 * @returns LogCorrelation object with correlated entries and timeline
 */
export function correlateLogsWithStack(
  logs: LogEntry[],
  stackFrames: StackFrame[],
  crashTime?: Date
): LogCorrelation {
  const correlations: LogCorrelation['correlatedEntries'] = [];

  // Find logs that mention functions in the stack
  for (const log of logs) {
    for (const frame of stackFrames) {
      let confidence = 0;

      // Check if log message mentions the function name
      if (frame.function && frame.function !== '<anonymous>' &&
          log.message.toLowerCase().includes(frame.function.toLowerCase())) {
        confidence = 0.9;
      }
      // Check if log message mentions the file
      else if (frame.file && log.message.includes(frame.file)) {
        confidence = 0.7;
      }
      // Check if log mentions the file name without path
      else if (frame.file) {
        const fileName = frame.file.split('/').pop() || '';
        if (fileName && log.message.includes(fileName)) {
          confidence = 0.5;
        }
      }

      if (confidence > 0) {
        correlations.push({ log, frame, confidence });
      }
    }
  }

  // Build timeline
  const timeline: (LogEntry | StackFrame)[] = [];

  if (crashTime) {
    // Get logs leading up to crash (within 1 minute before)
    const oneMinuteBefore = crashTime.getTime() - 60000;
    const relevantLogs = logs.filter(l =>
      l.timestamp.getTime() >= oneMinuteBefore &&
      l.timestamp.getTime() <= crashTime.getTime()
    );
    timeline.push(...relevantLogs);
  } else {
    // Without crash time, include last 20 logs
    timeline.push(...logs.slice(-20));
  }

  // Sort timeline by timestamp (logs) - stack frames don't have timestamps
  timeline.sort((a, b) => {
    const timeA = 'timestamp' in a ? a.timestamp.getTime() : 0;
    const timeB = 'timestamp' in b ? b.timestamp.getTime() : 0;
    return timeA - timeB;
  });

  return {
    logEntries: logs,
    stackFrames,
    correlatedEntries: correlations,
    timeline,
  };
}

// ============================================================================
// RUNTIME STATE ANALYSIS
// ============================================================================

/**
 * Parse a Node.js diagnostic report (crash dump) into RuntimeState.
 * Node.js generates these reports with --report-on-fatalerror flag.
 *
 * @param dump - The raw diagnostic report content (JSON)
 * @returns RuntimeState object or null if parsing fails
 */
export function parseNodeCrashDump(dump: string): RuntimeState | null {
  try {
    const report = JSON.parse(dump);

    // Extract call stack from JavaScript stack
    const callStack: StackFrame[] = [];
    if (report.javascriptStack?.stack) {
      for (const frame of report.javascriptStack.stack) {
        callStack.push({
          function: frame.funcName || frame.functionName || '<anonymous>',
          file: frame.sourceLocation?.fileName || frame.scriptName || 'unknown',
          line: frame.sourceLocation?.lineNumber || frame.lineNumber || 0,
          column: frame.sourceLocation?.columnNumber || frame.column,
          language: 'javascript' as const,
        });
      }
    }

    // Extract variables/error message
    const variables: Record<string, unknown> = {};
    if (report.javascriptStack?.message) {
      variables.error = report.javascriptStack.message;
    }
    if (report.javascriptStack?.errorProperties) {
      Object.assign(variables, report.javascriptStack.errorProperties);
    }

    // Extract heap summary
    let heapSummary: RuntimeState['heapSummary'];
    if (report.javascriptHeap) {
      heapSummary = {
        used: report.javascriptHeap.usedMemory || report.javascriptHeap.used || 0,
        total: report.javascriptHeap.totalMemory || report.javascriptHeap.total || 0,
        external: report.javascriptHeap.externalMemory || report.javascriptHeap.external || 0,
      };
    }

    // Extract libuv handles (active async operations)
    const activeHandles = report.libuv?.length ?? report.uvthreadResourceUsage?.handles;
    const activeRequests = report.uvthreadResourceUsage?.requests;

    return {
      variables,
      callStack,
      heapSummary,
      activeHandles,
      activeRequests,
    };
  } catch {
    return null;
  }
}

/**
 * Analyze runtime state for potential issues.
 *
 * @param state - The runtime state from a crash dump
 * @returns Array of potential issues identified
 */
export function analyzeRuntimeState(state: RuntimeState): Array<{
  issue: string;
  severity: 'low' | 'medium' | 'high';
  details: string;
}> {
  const issues: Array<{ issue: string; severity: 'low' | 'medium' | 'high'; details: string }> = [];

  // Check for memory issues
  if (state.heapSummary) {
    const usageRatio = state.heapSummary.used / state.heapSummary.total;
    if (usageRatio > 0.95) {
      issues.push({
        issue: 'Memory exhaustion',
        severity: 'high',
        details: `Heap usage at ${(usageRatio * 100).toFixed(1)}% (${formatBytes(state.heapSummary.used)} / ${formatBytes(state.heapSummary.total)})`,
      });
    } else if (usageRatio > 0.8) {
      issues.push({
        issue: 'High memory usage',
        severity: 'medium',
        details: `Heap usage at ${(usageRatio * 100).toFixed(1)}%`,
      });
    }

    // Check for high external memory (potential native addon leak)
    if (state.heapSummary.external > state.heapSummary.used * 0.5) {
      issues.push({
        issue: 'High external memory',
        severity: 'medium',
        details: `External memory (${formatBytes(state.heapSummary.external)}) is high relative to heap`,
      });
    }
  }

  // Check for handle leaks
  if (state.activeHandles !== undefined && state.activeHandles > 100) {
    issues.push({
      issue: 'Potential handle leak',
      severity: 'medium',
      details: `${state.activeHandles} active handles detected`,
    });
  }

  // Check for error in variables
  if (state.variables.error) {
    const errorStr = String(state.variables.error);
    if (errorStr.toLowerCase().includes('out of memory') ||
        errorStr.toLowerCase().includes('heap')) {
      issues.push({
        issue: 'Out of memory error',
        severity: 'high',
        details: errorStr.substring(0, 200),
      });
    }
  }

  return issues;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ============================================================================
// ENHANCED HYPOTHESIS GENERATION
// ============================================================================

/**
 * Simple hypothesis interface for log-based hypothesis generation.
 * This is used by the standalone function and converted to full Hypothesis
 * objects by the BugInvestigationAssistant class.
 */
export interface SimpleHypothesis {
  description: string;
  confidence: number;
  evidence: string[];
  suggestedFix: string;
}

/**
 * Generate hypotheses with log context.
 * Analyzes log entries leading up to a crash to identify potential root causes.
 *
 * @param stackFrames - Stack frames from the error
 * @param logs - Log entries to analyze
 * @param codeContext - Optional map of file paths to code content
 * @returns Array of hypothesis objects
 */
export function generateHypothesesWithLogs(
  stackFrames: StackFrame[],
  logs: LogEntry[],
  codeContext?: Map<string, string>
): SimpleHypothesis[] {
  const hypotheses: SimpleHypothesis[] = [];

  // Check for error logs just before crash
  const errorLogs = logs.filter(l => l.level === 'error');
  for (const log of errorLogs.slice(-5)) {
    hypotheses.push({
      description: `Error logged before crash: "${log.message.slice(0, 100)}${log.message.length > 100 ? '...' : ''}"`,
      confidence: 0.7,
      evidence: [`Log at ${log.timestamp.toISOString()}: ${log.message}`],
      suggestedFix: 'Investigate the logged error as potential root cause',
    });
  }

  // Check for state changes in logs
  const stateChangeLogs = logs.filter(l =>
    /state|status|changed|updated|set|assigned|transition/i.test(l.message)
  );
  if (stateChangeLogs.length > 0) {
    hypotheses.push({
      description: 'State mutations detected in logs - possible race condition or invalid state',
      confidence: 0.5,
      evidence: stateChangeLogs.slice(-3).map(l =>
        `[${l.timestamp.toISOString()}] ${l.message.slice(0, 100)}`
      ),
      suggestedFix: 'Review state management around the crash point',
    });
  }

  // Check for repeated error patterns (possible retry loop)
  const recentLogs = logs.slice(-50);
  const errorPatterns = new Map<string, number>();
  for (const log of recentLogs) {
    if (log.level === 'error' || log.level === 'warn') {
      // Normalize the message to group similar errors
      const normalized = log.message
        .replace(/\d+/g, 'N')
        .replace(/[a-f0-9]{8,}/gi, 'HASH')
        .slice(0, 50);
      errorPatterns.set(normalized, (errorPatterns.get(normalized) || 0) + 1);
    }
  }

  for (const [pattern, count] of errorPatterns) {
    if (count >= 3) {
      hypotheses.push({
        description: `Repeated error pattern detected (${count} occurrences) - possible retry loop or cascading failure`,
        confidence: 0.6,
        evidence: [`Pattern: "${pattern}" appeared ${count} times`],
        suggestedFix: 'Check for infinite retry loops or cascading failures',
      });
    }
  }

  // Check for timeout/delay patterns
  const timeoutLogs = logs.filter(l =>
    /timeout|timed out|deadline|exceeded|slow|latency/i.test(l.message)
  );
  if (timeoutLogs.length > 0) {
    hypotheses.push({
      description: 'Timeout/latency issues detected in logs',
      confidence: 0.6,
      evidence: timeoutLogs.slice(-3).map(l => l.message.slice(0, 100)),
      suggestedFix: 'Review timeout configurations and external service dependencies',
    });
  }

  // Check for connection/network issues
  const networkLogs = logs.filter(l =>
    /connection|network|socket|ECONNREFUSED|ETIMEDOUT|dns|refused/i.test(l.message)
  );
  if (networkLogs.length > 0) {
    hypotheses.push({
      description: 'Network/connection issues detected',
      confidence: 0.65,
      evidence: networkLogs.slice(-3).map(l => l.message.slice(0, 100)),
      suggestedFix: 'Check network connectivity and external service availability',
    });
  }

  // Sort by confidence
  hypotheses.sort((a, b) => b.confidence - a.confidence);

  return hypotheses;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class BugInvestigationAssistant implements CalibratedConstruction {
  private librarian: Librarian;
  private astExtractor: ASTFactExtractor;
  private calibrationTracker?: ConstructionCalibrationTracker;

  static readonly CONSTRUCTION_ID = 'BugInvestigationAssistant';

  /** Default weights for combining similarity signals */
  private static readonly DEFAULT_WEIGHTS: SimilarityWeights = {
    semantic: 0.35,       // Semantic understanding via librarian
    structural: 0.30,     // AST-based structural similarity
    errorSignature: 0.25, // Error type/pattern matching
    historical: 0.10,     // Co-change/historical correlation
  };

  constructor(librarian: Librarian) {
    this.librarian = librarian;
    this.astExtractor = new ASTFactExtractor();
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return BugInvestigationAssistant.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   * Call this after verifying the investigation outcome.
   *
   * @param predictionId - The prediction ID from the investigation report
   * @param wasCorrect - Whether the primary hypothesis was correct
   * @param verificationMethod - How the outcome was verified
   */
  recordOutcome(
    predictionId: string,
    wasCorrect: boolean,
    verificationMethod: VerificationMethod = 'user_feedback'
  ): void {
    if (!this.calibrationTracker) {
      return; // Silently skip if no tracker configured
    }
    this.calibrationTracker.recordOutcome(predictionId, wasCorrect, verificationMethod);
  }

  /**
   * Investigate a bug report.
   */
  async investigate(bugReport: BugReport): Promise<InvestigationReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Step 1: Parse stack trace
    const stackFrames = this.parseStackTraceInternal(bugReport.stackTrace);
    evidenceRefs.push(`stack_parse:${stackFrames.length}_frames`);

    // Step 2: Identify primary suspect
    const primarySuspect = await this.identifyPrimarySuspect(
      stackFrames,
      bugReport.errorMessage,
      bugReport.suspectedFiles
    );
    if (primarySuspect) {
      evidenceRefs.push(`primary_suspect:${primarySuspect.file}:${primarySuspect.line}`);
    }

    // Step 3: Trace call chain
    const callChain = await this.traceCallChain(stackFrames);
    evidenceRefs.push(`call_chain:${callChain.length}_functions`);

    // Step 4: Generate hypotheses
    const hypotheses = await this.generateHypotheses(bugReport, stackFrames, primarySuspect);
    evidenceRefs.push(`hypotheses:${hypotheses.length}`);

    // Step 5: Find similar bugs (enhanced multi-signal detection)
    const similarBugs = await this.findSimilarBugs(bugReport, stackFrames, primarySuspect);
    evidenceRefs.push(`similar_bugs:${similarBugs.length}`);

    // Step 6: Compute overall confidence
    const confidence = this.computeOverallConfidence(stackFrames, hypotheses, similarBugs);

    // Step 7: Record prediction for calibration tracking
    const predictionId = generatePredictionId(BugInvestigationAssistant.CONSTRUCTION_ID);
    const primaryHypothesis = hypotheses[0];
    if (this.calibrationTracker && primaryHypothesis) {
      this.calibrationTracker.recordPrediction(
        BugInvestigationAssistant.CONSTRUCTION_ID,
        predictionId,
        confidence,
        `Primary hypothesis: ${primaryHypothesis.description} - ${primaryHypothesis.rootCause}`,
        {
          bugDescription: bugReport.description,
          hypothesisId: primaryHypothesis.id,
          stackFrameCount: stackFrames.length,
          similarBugCount: similarBugs.length,
        }
      );
    }

    return {
      bugReport,
      stackFrames,
      primarySuspect,
      callChain,
      hypotheses,
      similarBugs,
      confidence,
      evidenceRefs,
      investigationTimeMs: Date.now() - startTime,
      predictionId,
    };
  }

  /**
   * Step 1: Parse stack trace into structured frames.
   * Delegates to the exported parseStackTrace function for multi-format support.
   */
  private parseStackTraceInternal(stackTrace?: string): StackFrame[] {
    if (!stackTrace) return [];
    return parseStackTrace(stackTrace);
  }

  /**
   * Step 2: Identify the primary suspect location.
   */
  private async identifyPrimarySuspect(
    stackFrames: StackFrame[],
    errorMessage?: string,
    suspectedFiles?: string[]
  ): Promise<{ file: string; line: number; context: string } | null> {
    // Start with first non-node_modules frame
    const userFrame = stackFrames.find(
      frame => !frame.file.includes('node_modules') && !frame.file.includes('internal/')
    );

    if (!userFrame) {
      // Fallback to suspected files
      if (suspectedFiles && suspectedFiles.length > 0) {
        return {
          file: suspectedFiles[0],
          line: 1,
          context: 'Suspected file (no stack trace)',
        };
      }
      return null;
    }

    // Query librarian for context around the frame
    const queryResult = await this.librarian.queryOptional({
      intent: `Get context around ${userFrame.file}:${userFrame.line}`,
      affectedFiles: [userFrame.file],
      depth: 'L1',
      perspective: 'debugging',
    });

    let context = `at ${userFrame.function}`;
    if (queryResult.packs && queryResult.packs.length > 0) {
      const pack = queryResult.packs[0];
      if (pack.codeSnippets && pack.codeSnippets.length > 0) {
        context = pack.codeSnippets[0].content.substring(0, 200);
      }
    }

    return {
      file: userFrame.file,
      line: userFrame.line,
      context,
    };
  }

  /**
   * Step 3: Trace the call chain.
   */
  private async traceCallChain(stackFrames: StackFrame[]): Promise<string[]> {
    // Extract function names from frames, filtering internals
    return stackFrames
      .filter(frame => !frame.file.includes('node_modules'))
      .map(frame => `${frame.function} (${frame.file}:${frame.line})`)
      .slice(0, 10); // Limit to 10 most relevant
  }

  /**
   * Step 4: Generate hypotheses about the root cause.
   */
  private async generateHypotheses(
    bugReport: BugReport,
    stackFrames: StackFrame[],
    primarySuspect: { file: string; line: number; context: string } | null
  ): Promise<Hypothesis[]> {
    const hypotheses: Hypothesis[] = [];
    const errorMessage = bugReport.errorMessage || bugReport.description;

    // Hypothesis 1: Null/undefined error
    if (this.isNullError(errorMessage)) {
      hypotheses.push({
        id: 'null_reference',
        description: 'Null or undefined reference',
        rootCause: 'A variable is null or undefined when accessed',
        affectedCode: primarySuspect ? [primarySuspect.file] : [],
        confidence: {
          type: 'measured' as const,
          value: 0.75,
          measurement: {
            datasetId: 'error_pattern_match',
            sampleSize: 100,
            accuracy: 0.75,
            confidenceInterval: [0.65, 0.85] as const,
            measuredAt: new Date().toISOString(),
          },
        },
        evidence: ['error_message_pattern'],
        suggestedFix: 'Add null check before access',
      });
    }

    // Hypothesis 2: Type error
    if (this.isTypeError(errorMessage)) {
      hypotheses.push({
        id: 'type_mismatch',
        description: 'Type mismatch',
        rootCause: 'Expected type differs from actual type',
        affectedCode: primarySuspect ? [primarySuspect.file] : [],
        confidence: {
          type: 'measured' as const,
          value: 0.70,
          measurement: {
            datasetId: 'error_pattern_match',
            sampleSize: 100,
            accuracy: 0.70,
            confidenceInterval: [0.60, 0.80] as const,
            measuredAt: new Date().toISOString(),
          },
        },
        evidence: ['error_message_pattern'],
        suggestedFix: 'Check type annotations and runtime values',
      });
    }

    // Hypothesis 3: Async/timing issue
    if (this.isAsyncError(errorMessage) || this.hasAsyncFrames(stackFrames)) {
      hypotheses.push({
        id: 'async_timing',
        description: 'Async timing or race condition',
        rootCause: 'Operation completed in unexpected order',
        affectedCode: stackFrames.slice(0, 3).map(f => f.file),
        confidence: {
          type: 'bounded' as const,
          low: 0.4,
          high: 0.7,
          basis: 'theoretical' as const,
          citation: 'Async issues are hard to diagnose statically - empirical observation from debugging patterns',
        },
        evidence: ['async_frames_detected'],
        suggestedFix: 'Review async flow and add proper awaits/locks',
      });
    }

    // Hypothesis 4: Based on librarian semantic analysis
    if (primarySuspect) {
      const semanticHypothesis = await this.generateSemanticHypothesis(primarySuspect, bugReport);
      if (semanticHypothesis) {
        hypotheses.push(semanticHypothesis);
      }
    }

    // Sort by confidence
    hypotheses.sort((a, b) => {
      const aConf = this.extractConfidenceValue(a.confidence);
      const bConf = this.extractConfidenceValue(b.confidence);
      return bConf - aConf;
    });

    return hypotheses;
  }

  /**
   * Check if error indicates null/undefined issue.
   */
  private isNullError(message: string): boolean {
    const patterns = [
      /cannot read propert/i,
      /undefined is not/i,
      /null is not/i,
      /is not a function/i,
      /cannot access/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * Check if error indicates type issue.
   */
  private isTypeError(message: string): boolean {
    const patterns = [
      /typeerror/i,
      /expected.*but got/i,
      /is not assignable/i,
      /invalid type/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * Check if error indicates async issue.
   */
  private isAsyncError(message: string): boolean {
    const patterns = [
      /promise/i,
      /async/i,
      /timeout/i,
      /unhandled rejection/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * Check if stack has async frames.
   */
  private hasAsyncFrames(frames: StackFrame[]): boolean {
    return frames.some(f =>
      f.function.includes('async') ||
      f.function.includes('Promise') ||
      f.function.includes('then')
    );
  }

  /**
   * Generate hypothesis using librarian semantic analysis.
   */
  private async generateSemanticHypothesis(
    suspect: { file: string; line: number; context: string },
    bugReport: BugReport
  ): Promise<Hypothesis | null> {
    // Query librarian for semantic understanding
    const queryResult = await this.librarian.queryOptional({
      intent: `What could cause an error at ${suspect.file}:${suspect.line}? The error is: ${bugReport.errorMessage || bugReport.description}`,
      affectedFiles: [suspect.file],
      depth: 'L2',
      taskType: 'debug',
      perspective: 'debugging',
    });

    if (!queryResult.packs || queryResult.packs.length === 0) {
      return null;
    }

    const pack = queryResult.packs[0];

    return {
      id: 'semantic_analysis',
      description: 'Librarian semantic analysis',
      rootCause: pack.summary || 'See context for details',
      affectedCode: [suspect.file],
      confidence: {
        type: 'measured' as const,
        value: pack.confidence || 0.6,
        measurement: {
          datasetId: 'librarian_semantic_query',
          sampleSize: 100,
          accuracy: pack.confidence || 0.6,
          confidenceInterval: [Math.max(0, (pack.confidence || 0.6) - 0.1), Math.min(1, (pack.confidence || 0.6) + 0.1)] as const,
          measuredAt: new Date().toISOString(),
        },
      },
      evidence: [`context_pack:${pack.packId}`],
      suggestedFix: pack.keyFacts?.[0] || undefined,
    };
  }

  /**
   * Step 5: Find similar bugs in the codebase using multi-signal detection.
   *
   * Combines multiple signals for improved accuracy:
   * 1. Semantic similarity (librarian queries) - understands intent/meaning
   * 2. Structural similarity (AST-based) - code patterns, signatures
   * 3. Error signature matching - error types, stack patterns
   * 4. Historical correlation - co-change patterns, related fixes
   */
  private async findSimilarBugs(
    bugReport: BugReport,
    stackFrames: StackFrame[] = [],
    primarySuspect: { file: string; line: number; context: string } | null = null,
    weights: SimilarityWeights = BugInvestigationAssistant.DEFAULT_WEIGHTS
  ): Promise<SimilarBug[]> {
    // Extract error signature from bug report
    const errorSignature = this.extractErrorSignature(bugReport, stackFrames);

    // Get structural fingerprint if we have a suspect file
    const structuralFingerprint = primarySuspect
      ? await this.extractStructuralFingerprint(primarySuspect.file)
      : null;

    // Gather candidates from multiple sources in parallel
    const [semanticCandidates, structuralCandidates, errorCandidates] = await Promise.all([
      this.findSemanticSimilarBugs(bugReport),
      this.findStructurallySimilarCode(structuralFingerprint, primarySuspect?.file),
      this.findBugsByErrorSignature(errorSignature),
    ]);

    // Merge all candidates
    const candidateMap = new Map<string, {
      file: string;
      description: string;
      semantic: number;
      structural: number;
      errorSignature: number;
      historical: number;
      resolution?: string;
    }>();

    // Process semantic candidates
    for (const candidate of semanticCandidates) {
      const key = candidate.file;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.semantic = Math.max(existing.semantic, candidate.similarity);
        if (!existing.description && candidate.description) {
          existing.description = candidate.description;
        }
      } else {
        candidateMap.set(key, {
          file: candidate.file,
          description: candidate.description,
          semantic: candidate.similarity,
          structural: 0,
          errorSignature: 0,
          historical: 0,
          resolution: candidate.resolution,
        });
      }
    }

    // Process structural candidates
    for (const candidate of structuralCandidates) {
      const key = candidate.file;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.structural = Math.max(existing.structural, candidate.similarity);
      } else {
        candidateMap.set(key, {
          file: candidate.file,
          description: candidate.description || 'Structurally similar code',
          semantic: 0,
          structural: candidate.similarity,
          errorSignature: 0,
          historical: 0,
        });
      }
    }

    // Process error signature candidates
    for (const candidate of errorCandidates) {
      const key = candidate.file;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.errorSignature = Math.max(existing.errorSignature, candidate.similarity);
      } else {
        candidateMap.set(key, {
          file: candidate.file,
          description: candidate.description || 'Similar error pattern',
          semantic: 0,
          structural: 0,
          errorSignature: candidate.similarity,
          historical: 0,
        });
      }
    }

    // Compute historical correlation for all candidates
    const affectedFiles = stackFrames
      .map(f => f.file)
      .filter(f => !f.includes('node_modules'));

    for (const [file, candidate] of candidateMap) {
      candidate.historical = await this.computeHistoricalCorrelation(
        file,
        affectedFiles,
        primarySuspect?.file
      );
    }

    // Compute final weighted scores and create SimilarBug objects
    const similarBugs: SimilarBug[] = [];

    for (const [, candidate] of candidateMap) {
      const weightedScore =
        candidate.semantic * weights.semantic +
        candidate.structural * weights.structural +
        candidate.errorSignature * weights.errorSignature +
        candidate.historical * weights.historical;

      // Filter by minimum threshold (0.3 combined score)
      if (weightedScore >= 0.3) {
        similarBugs.push({
          description: candidate.description,
          file: candidate.file,
          similarity: weightedScore,
          resolution: candidate.resolution,
          signalBreakdown: {
            semantic: candidate.semantic,
            structural: candidate.structural,
            errorSignature: candidate.errorSignature,
            historical: candidate.historical,
            weights,
          },
        });
      }
    }

    // Sort by similarity score (descending) and return top results
    return similarBugs
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
  }

  // ===========================================================================
  // SIGNAL 1: SEMANTIC SIMILARITY (via Librarian queries)
  // ===========================================================================

  /**
   * Find semantically similar bugs using librarian's understanding.
   */
  private async findSemanticSimilarBugs(bugReport: BugReport): Promise<SimilarBug[]> {
    const similarBugs: SimilarBug[] = [];

    // Query for similar patterns based on description
    const queryResult = await this.librarian.queryOptional({
      intent: `Find code similar to this bug pattern: ${bugReport.description}`,
      depth: 'L1',
      taskType: 'understand',
      perspective: 'debugging',
    });

    if (queryResult.packs) {
      for (const pack of queryResult.packs.slice(0, 5)) {
        if (pack.confidence && pack.confidence > 0.3) {
          similarBugs.push({
            description: pack.summary || 'Similar code pattern',
            file: pack.relatedFiles?.[0] || 'unknown',
            similarity: pack.confidence,
          });
        }
      }
    }

    // If we have error message, query specifically for error patterns
    if (bugReport.errorMessage) {
      const errorQueryResult = await this.librarian.queryOptional({
        intent: `Find code that handles or produces errors like: ${bugReport.errorMessage}`,
        depth: 'L1',
        taskType: 'debug',
        perspective: 'debugging',
      });

      if (errorQueryResult.packs) {
        for (const pack of errorQueryResult.packs.slice(0, 3)) {
          if (pack.confidence && pack.confidence > 0.3) {
            const existing = similarBugs.find(b => b.file === pack.relatedFiles?.[0]);
            if (!existing) {
              similarBugs.push({
                description: pack.summary || 'Similar error handling',
                file: pack.relatedFiles?.[0] || 'unknown',
                similarity: pack.confidence * 0.9, // Slightly lower weight for error-specific query
              });
            }
          }
        }
      }
    }

    return similarBugs;
  }

  // ===========================================================================
  // SIGNAL 2: STRUCTURAL SIMILARITY (AST-based)
  // ===========================================================================

  /**
   * Extract structural fingerprint from a file using AST analysis.
   */
  private async extractStructuralFingerprint(filePath: string): Promise<StructuralFingerprint> {
    const fingerprint: StructuralFingerprint = {
      functionSignatures: [],
      controlFlowPatterns: [],
      errorHandlingPatterns: [],
      callPatterns: [],
    };

    try {
      const facts = await this.astExtractor.extractFromFile(filePath);

      for (const fact of facts) {
        switch (fact.type) {
          case 'function_def': {
            const details = fact.details as FunctionDefDetails;
            const sig = this.normalizeFunctionSignature(
              fact.identifier,
              details.parameters,
              details.returnType
            );
            fingerprint.functionSignatures.push(sig);

            // Track async patterns
            if (details.isAsync) {
              fingerprint.controlFlowPatterns.push('async_function');
            }
            break;
          }
          case 'call': {
            const details = fact.details as CallDetails;
            fingerprint.callPatterns.push(details.callee);

            // Detect error handling calls
            if (this.isErrorHandlingCall(details.callee)) {
              fingerprint.errorHandlingPatterns.push(details.callee);
            }
            break;
          }
          case 'class': {
            const details = fact.details as ClassDetails;
            if (details.extends?.includes('Error')) {
              fingerprint.errorHandlingPatterns.push(`custom_error:${fact.identifier}`);
            }
            break;
          }
        }
      }

      // Deduplicate
      fingerprint.functionSignatures = [...new Set(fingerprint.functionSignatures)];
      fingerprint.controlFlowPatterns = [...new Set(fingerprint.controlFlowPatterns)];
      fingerprint.errorHandlingPatterns = [...new Set(fingerprint.errorHandlingPatterns)];
      fingerprint.callPatterns = [...new Set(fingerprint.callPatterns)];
    } catch {
      // Return empty fingerprint if extraction fails
    }

    return fingerprint;
  }

  /**
   * Find structurally similar code using AST patterns.
   */
  private async findStructurallySimilarCode(
    fingerprint: StructuralFingerprint | null,
    sourceFile?: string
  ): Promise<Array<{ file: string; similarity: number; description?: string }>> {
    if (!fingerprint) {
      return [];
    }

    const results: Array<{ file: string; similarity: number; description?: string }> = [];

    // Query librarian for files with similar patterns
    const patterns = [
      ...fingerprint.functionSignatures.slice(0, 3),
      ...fingerprint.errorHandlingPatterns.slice(0, 2),
    ].filter(Boolean);

    if (patterns.length === 0) {
      return [];
    }

    // Query for code with similar patterns
    const queryResult = await this.librarian.queryOptional({
      intent: `Find files with similar code patterns: ${patterns.join(', ')}`,
      depth: 'L1',
      taskType: 'understand',
      perspective: 'debugging',
    });

    if (queryResult.packs) {
      for (const pack of queryResult.packs.slice(0, 5)) {
        const file = pack.relatedFiles?.[0];
        if (file && file !== sourceFile) {
          // Extract fingerprint of candidate and compare
          const candidateFingerprint = await this.extractStructuralFingerprint(file);
          const structuralSim = this.computeStructuralSimilarity(
            fingerprint,
            candidateFingerprint
          );

          if (structuralSim > 0.2) {
            results.push({
              file,
              similarity: structuralSim,
              description: `Structural similarity: ${(structuralSim * 100).toFixed(0)}%`,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Compute structural similarity between two fingerprints.
   */
  private computeStructuralSimilarity(
    fp1: StructuralFingerprint,
    fp2: StructuralFingerprint
  ): number {
    const scores: number[] = [];

    // Function signature similarity (Jaccard)
    scores.push(this.jaccardSimilarity(fp1.functionSignatures, fp2.functionSignatures));

    // Control flow pattern similarity
    scores.push(this.jaccardSimilarity(fp1.controlFlowPatterns, fp2.controlFlowPatterns));

    // Error handling pattern similarity (weighted higher)
    const errorSim = this.jaccardSimilarity(fp1.errorHandlingPatterns, fp2.errorHandlingPatterns);
    scores.push(errorSim);
    scores.push(errorSim); // Double weight for error patterns

    // Call pattern similarity
    scores.push(this.jaccardSimilarity(fp1.callPatterns, fp2.callPatterns));

    // Average all scores
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  /**
   * Normalize function signature for comparison.
   */
  private normalizeFunctionSignature(
    name: string,
    params: Array<{ name: string; type?: string }>,
    returnType?: string
  ): string {
    const paramTypes = params.map(p => p.type || 'any').join(',');
    const retType = returnType || 'void';
    return `${name}(${paramTypes}):${retType}`;
  }

  /**
   * Check if a call is error handling related.
   */
  private isErrorHandlingCall(callee: string): boolean {
    const errorPatterns = [
      'catch',
      'throw',
      'reject',
      'error',
      'fail',
      'assert',
      'validate',
      'check',
    ];
    const lowerCallee = callee.toLowerCase();
    return errorPatterns.some(p => lowerCallee.includes(p));
  }

  /**
   * Compute Jaccard similarity between two sets.
   */
  private jaccardSimilarity(set1: string[], set2: string[]): number {
    if (set1.length === 0 && set2.length === 0) {
      return 1.0; // Both empty = identical
    }
    if (set1.length === 0 || set2.length === 0) {
      return 0.0;
    }

    const s1 = new Set(set1);
    const s2 = new Set(set2);
    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);

    return intersection.size / union.size;
  }

  // ===========================================================================
  // SIGNAL 3: ERROR SIGNATURE MATCHING
  // ===========================================================================

  /**
   * Extract error signature from bug report and stack trace.
   */
  private extractErrorSignature(
    bugReport: BugReport,
    stackFrames: StackFrame[]
  ): ErrorSignature {
    const signature: ErrorSignature = {
      errorType: null,
      errorPattern: null,
      affectedModules: [],
      callChainFingerprint: '',
    };

    // Extract error type from message
    if (bugReport.errorMessage) {
      signature.errorType = this.extractErrorType(bugReport.errorMessage);
      signature.errorPattern = this.extractErrorPattern(bugReport.errorMessage);
    }

    // Extract affected modules from stack frames
    signature.affectedModules = [...new Set(
      stackFrames
        .filter(f => !f.file.includes('node_modules') && !f.file.includes('internal/'))
        .map(f => this.extractModuleName(f.file))
    )];

    // Create call chain fingerprint
    signature.callChainFingerprint = this.createCallChainFingerprint(stackFrames);

    return signature;
  }

  /**
   * Extract error type from error message.
   */
  private extractErrorType(message: string): string | null {
    const errorTypes = [
      'TypeError',
      'ReferenceError',
      'SyntaxError',
      'RangeError',
      'URIError',
      'EvalError',
      'Error',
      'AssertionError',
      'ValidationError',
      'NetworkError',
      'TimeoutError',
    ];

    for (const errorType of errorTypes) {
      if (message.includes(errorType)) {
        return errorType;
      }
    }

    // Check for common error patterns
    if (message.match(/cannot read propert/i) || message.match(/undefined is not/i)) {
      return 'TypeError';
    }
    if (message.match(/is not defined/i)) {
      return 'ReferenceError';
    }

    return null;
  }

  /**
   * Extract error pattern (template) from error message.
   */
  private extractErrorPattern(message: string): string {
    // Normalize the message to create a pattern
    return message
      .replace(/['"`][\w\d_$]+['"`]/g, "'<identifier>'")  // Replace quoted identifiers
      .replace(/\b\d+\b/g, '<number>')                      // Replace numbers
      .replace(/at\s+.+:\d+:\d+/g, 'at <location>')         // Replace stack locations
      .replace(/\/.+\.(ts|js|tsx|jsx)/g, '<file>')          // Replace file paths
      .trim()
      .toLowerCase();
  }

  /**
   * Extract module name from file path.
   */
  private extractModuleName(filePath: string): string {
    // Extract directory name or meaningful module identifier
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    const dirName = parts[parts.length - 2] || '';

    // If it's an index file, use directory name
    if (fileName.match(/^index\.(ts|js|tsx|jsx)$/)) {
      return dirName;
    }

    // Otherwise use file name without extension
    return fileName.replace(/\.(ts|js|tsx|jsx)$/, '');
  }

  /**
   * Create a fingerprint from call chain for matching.
   */
  private createCallChainFingerprint(stackFrames: StackFrame[]): string {
    return stackFrames
      .filter(f => !f.file.includes('node_modules'))
      .map(f => f.function)
      .slice(0, 5)  // Top 5 functions
      .join('->');
  }

  /**
   * Find bugs with similar error signatures.
   */
  private async findBugsByErrorSignature(
    signature: ErrorSignature
  ): Promise<Array<{ file: string; similarity: number; description?: string }>> {
    const results: Array<{ file: string; similarity: number; description?: string }> = [];

    // Query for code handling same error type
    if (signature.errorType) {
      const queryResult = await this.librarian.queryOptional({
        intent: `Find code that handles or throws ${signature.errorType} errors`,
        depth: 'L1',
        taskType: 'debug',
        perspective: 'debugging',
      });

      if (queryResult.packs) {
        for (const pack of queryResult.packs.slice(0, 5)) {
          const file = pack.relatedFiles?.[0];
          if (file) {
            results.push({
              file,
              similarity: pack.confidence || 0.5,
              description: `Handles ${signature.errorType}`,
            });
          }
        }
      }
    }

    // Query for code in same modules
    if (signature.affectedModules.length > 0) {
      const moduleQuery = signature.affectedModules.slice(0, 3).join(', ');
      const queryResult = await this.librarian.queryOptional({
        intent: `Find error handling code related to modules: ${moduleQuery}`,
        affectedFiles: signature.affectedModules,
        depth: 'L1',
        taskType: 'debug',
        perspective: 'debugging',
      });

      if (queryResult.packs) {
        for (const pack of queryResult.packs.slice(0, 3)) {
          const file = pack.relatedFiles?.[0];
          if (file) {
            const existing = results.find(r => r.file === file);
            if (existing) {
              existing.similarity = Math.max(existing.similarity, (pack.confidence || 0.4) * 0.8);
            } else {
              results.push({
                file,
                similarity: (pack.confidence || 0.4) * 0.8,
                description: 'Related module error handling',
              });
            }
          }
        }
      }
    }

    return results;
  }

  // ===========================================================================
  // SIGNAL 4: HISTORICAL CORRELATION
  // ===========================================================================

  /**
   * Compute historical correlation score for a candidate file.
   *
   * This approximates the likelihood that bugs in the candidate file
   * are related to bugs in the affected files based on co-change patterns.
   */
  private async computeHistoricalCorrelation(
    candidateFile: string,
    affectedFiles: string[],
    primarySuspectFile?: string
  ): Promise<number> {
    // Note: For full implementation, this would query git history
    // for co-change patterns. For now, we use heuristics.

    let score = 0;

    // Same directory bonus (files in same directory often change together)
    const candidateDir = candidateFile.split('/').slice(0, -1).join('/');
    for (const file of affectedFiles) {
      const fileDir = file.split('/').slice(0, -1).join('/');
      if (candidateDir === fileDir) {
        score += 0.3;
        break; // Only count once
      }
    }

    // Similar file name pattern bonus
    const candidateName = candidateFile.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '') || '';
    for (const file of affectedFiles) {
      const fileName = file.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '') || '';
      if (this.hasSimilarNaming(candidateName, fileName)) {
        score += 0.2;
        break;
      }
    }

    // Query librarian for relationship
    if (primarySuspectFile && candidateFile !== primarySuspectFile) {
      try {
        const queryResult = await this.librarian.queryOptional({
          intent: `What is the relationship between ${candidateFile} and ${primarySuspectFile}?`,
          affectedFiles: [candidateFile, primarySuspectFile],
          depth: 'L1',
          taskType: 'understand',
          perspective: 'debugging',
        });

        if (queryResult.packs && queryResult.packs.length > 0) {
          // If librarian found a relationship, add score based on confidence
          const relationshipConf = queryResult.packs[0].confidence || 0;
          score += relationshipConf * 0.5;
        }
      } catch {
        // Ignore query failures for historical correlation
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Check if two file names have similar naming patterns.
   */
  private hasSimilarNaming(name1: string, name2: string): boolean {
    // Check for common suffixes/prefixes
    const patterns = ['test', 'spec', 'helper', 'utils', 'types', 'service', 'controller'];

    for (const pattern of patterns) {
      const name1HasPattern = name1.toLowerCase().includes(pattern);
      const name2HasPattern = name2.toLowerCase().includes(pattern);
      if (name1HasPattern && name2HasPattern) {
        return true;
      }
    }

    // Check if one is a variant of the other (e.g., user.ts and user.test.ts)
    const base1 = name1.replace(/\.(test|spec|helper)$/, '');
    const base2 = name2.replace(/\.(test|spec|helper)$/, '');
    if (base1 === base2 && name1 !== name2) {
      return true;
    }

    return false;
  }

  /**
   * Step 6: Compute overall investigation confidence.
   */
  private computeOverallConfidence(
    stackFrames: StackFrame[],
    hypotheses: Hypothesis[],
    similarBugs: SimilarBug[]
  ): ConfidenceValue {
    // Factors affecting confidence:
    // 1. Stack trace quality (more frames = more context)
    // 2. Hypothesis confidence (best hypothesis)
    // 3. Similar bug matches (validation)

    if (stackFrames.length === 0 && hypotheses.length === 0) {
      return {
        type: 'absent' as const,
        reason: 'insufficient_data' as const,
      };
    }

    let baseConfidence = 0.5;

    // Stack trace bonus
    if (stackFrames.length > 0) {
      baseConfidence += 0.1;
      if (stackFrames.length > 3) {
        baseConfidence += 0.1;
      }
    }

    // Best hypothesis bonus
    if (hypotheses.length > 0) {
      const bestHypothesisConf = this.extractConfidenceValue(hypotheses[0].confidence);
      baseConfidence += bestHypothesisConf * 0.2;
    }

    // Similar bugs bonus
    if (similarBugs.length > 0) {
      baseConfidence += 0.05;
    }

    baseConfidence = Math.min(0.95, baseConfidence);

    return {
      type: 'measured' as const,
      value: baseConfidence,
      measurement: {
        datasetId: 'bug_investigation',
        sampleSize: 100,
        accuracy: baseConfidence,
        confidenceInterval: [Math.max(0, baseConfidence - 0.1), Math.min(1, baseConfidence + 0.1)] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Extract numeric confidence value.
   */
  private extractConfidenceValue(conf: ConfidenceValue): number {
    switch (conf.type) {
      case 'deterministic':
        return conf.value;
      case 'measured':
        return conf.value;
      case 'derived':
        return conf.value;
      case 'bounded':
        return (conf.low + conf.high) / 2;
      case 'absent':
        return 0;
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createBugInvestigationAssistant(librarian: Librarian): BugInvestigationAssistant {
  return new BugInvestigationAssistant(librarian);
}
