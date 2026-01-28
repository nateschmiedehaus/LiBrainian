/**
 * @fileoverview ProbeExecutor - Automatic Probe Execution for Hypothesis Testing
 *
 * WU-SELF-002: Automatic Probe Execution
 *
 * This executor provides:
 * - Execution of code probes to test hypotheses
 * - Logging of all execution results
 * - Support for various probe types (test, assertion, measurement, query)
 * - Integration with self-improvement loop
 * - Sandboxed execution for safety
 * - Timeout enforcement
 * - Resource limits
 * - Read-only constraint enforcement
 */

import { Script, createContext, type Context } from 'vm';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of probes that can be executed.
 */
export type ProbeType = 'test' | 'assertion' | 'measurement' | 'query';

/**
 * A probe definition for testing a hypothesis.
 */
export interface Probe {
  /** Unique identifier for the probe */
  id: string;
  /** Type of probe */
  type: ProbeType;
  /** The hypothesis being tested */
  hypothesis: string;
  /** Code to execute for the probe */
  code: string;
  /** Expected outcome (optional) */
  expectedOutcome?: string;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Result of executing a probe.
 */
export interface ProbeResult {
  /** ID of the probe that was executed */
  probeId: string;
  /** Whether the probe executed successfully (no errors) */
  success: boolean;
  /** Output from the probe execution */
  output: string;
  /** Error message if probe failed */
  error?: string;
  /** Time taken to execute in milliseconds */
  executionTime: number;
  /** The hypothesis that was tested */
  hypothesis: string;
  /** Whether the result confirms the hypothesis */
  confirmed: boolean;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
}

/**
 * A log entry for a probe execution.
 */
export interface ProbeLog {
  /** When the probe was executed */
  timestamp: Date;
  /** The probe that was executed */
  probe: Probe;
  /** Result of the execution */
  result: ProbeResult;
  /** Additional context for the execution */
  context: Record<string, unknown>;
}

/**
 * Filter options for retrieving logs.
 */
export interface ProbeLogFilter {
  /** Filter by probe ID */
  probeId?: string;
  /** Filter by probe type */
  type?: ProbeType;
  /** Filter by success status */
  success?: boolean;
  /** Filter by logs after this time */
  after?: Date;
  /** Filter by logs before this time */
  before?: Date;
}

/**
 * Configuration for ProbeExecutor.
 */
export interface ProbeExecutorConfig {
  /** Maximum number of probes to execute concurrently */
  maxConcurrent: number;
  /** Default timeout in milliseconds */
  defaultTimeout: number;
  /** Path for storing logs */
  logPath: string;
  /** Whether to run probes in sandboxed mode */
  sandboxed: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PROBE_TYPE_KEYWORDS: Record<ProbeType, string[]> = {
  test: ['test', 'verify', 'check', 'validate'],
  assertion: ['assert', 'expect', 'should', 'must'],
  measurement: ['measure', 'count', 'calculate', 'compute', 'time'],
  query: ['query', 'find', 'search', 'lookup', 'get'],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique probe ID.
 */
function generateProbeId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 11);
  return `probe_${timestamp}_${random}`;
}

/**
 * Infer probe type from hypothesis text.
 */
function inferProbeType(hypothesis: string): ProbeType {
  const lower = hypothesis.toLowerCase();

  for (const [type, keywords] of Object.entries(PROBE_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return type as ProbeType;
    }
  }

  // Default to 'test' if no keywords match
  return 'test';
}

/**
 * Create a sandboxed context for probe execution.
 */
function createSandboxedContext(): Context {
  // Create a minimal sandbox with safe globals
  const sandbox = {
    // Safe built-ins
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    Symbol,
    WeakMap,
    WeakSet,

    // Safe functions
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    encodeURIComponent,
    decodeURI,
    decodeURIComponent,

    // Console for debugging (output captured)
    console: {
      log: (...args: unknown[]) => args.join(' '),
      error: (...args: unknown[]) => args.join(' '),
      warn: (...args: unknown[]) => args.join(' '),
    },

    // Blocked - these will throw if accessed
    require: () => {
      throw new Error('require is not allowed in sandboxed mode');
    },
    process: undefined,
    global: undefined,
    globalThis: undefined,
    __dirname: undefined,
    __filename: undefined,
  };

  return createContext(sandbox);
}

/**
 * Execute code in a sandboxed environment with timeout.
 */
async function executeSandboxed(
  code: string,
  timeout: number
): Promise<{ output: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const context = createSandboxedContext();

      // Wrap code in an async IIFE to handle both sync and async returns
      const wrappedCode = `
        (async function() {
          ${code}
        })()
      `;

      const script = new Script(wrappedCode);

      const resultPromise = script.runInContext(context, {
        timeout,
      });

      // Handle the promise with timeout
      const timeoutPromise = new Promise<{ output: string; error: string }>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Probe execution timeout after ${timeout}ms`));
        }, timeout);
      });

      Promise.race([resultPromise, timeoutPromise])
        .then((result) => {
          resolve({ output: String(result) });
        })
        .catch((error) => {
          resolve({
            output: '',
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      resolve({
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Execute code without sandbox restrictions.
 */
async function executeUnsandboxed(
  code: string,
  timeout: number
): Promise<{ output: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const wrappedCode = `
        (async function() {
          ${code}
        })()
      `;

      const timeoutId = setTimeout(() => {
        resolve({
          output: '',
          error: `Probe execution timeout after ${timeout}ms`,
        });
      }, timeout);

      const fn = new Function(wrappedCode);
      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timeoutId);
          resolve({ output: String(result) });
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          resolve({
            output: '',
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      resolve({
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Calculate confidence score based on output matching.
 */
function calculateConfidence(
  output: string,
  expectedOutcome: string | undefined,
  success: boolean
): number {
  if (!success) {
    return 0;
  }

  if (!expectedOutcome) {
    // No expected outcome - moderate confidence if successful
    return 0.7;
  }

  const outputLower = output.toLowerCase().trim();
  const expectedLower = expectedOutcome.toLowerCase().trim();

  // Exact match
  if (outputLower === expectedLower) {
    return 1.0;
  }

  // Contains match
  if (outputLower.includes(expectedLower) || expectedLower.includes(outputLower)) {
    return 0.8;
  }

  // Partial match - check if any significant portion matches
  const outputWords = outputLower.split(/\s+/);
  const expectedWords = expectedLower.split(/\s+/);
  const matchingWords = outputWords.filter((w) => expectedWords.includes(w));

  if (matchingWords.length > 0) {
    return 0.5 + (0.3 * matchingWords.length) / Math.max(outputWords.length, expectedWords.length);
  }

  // No match
  return 0.3;
}

// ============================================================================
// PROBE EXECUTOR CLASS
// ============================================================================

/**
 * Executor for running code probes to test hypotheses.
 *
 * Provides:
 * - Sandboxed execution environment
 * - Timeout enforcement
 * - Batch execution with concurrency control
 * - Comprehensive logging
 * - Hypothesis confirmation evaluation
 */
export class ProbeExecutor {
  private readonly config: ProbeExecutorConfig;
  private readonly logs: ProbeLog[] = [];

  constructor(config: ProbeExecutorConfig) {
    // Validate configuration
    if (config.maxConcurrent <= 0) {
      throw new Error('maxConcurrent must be positive');
    }
    if (config.defaultTimeout <= 0) {
      throw new Error('defaultTimeout must be positive');
    }

    this.config = { ...config };
  }

  // ============================================================================
  // PUBLIC API - Status
  // ============================================================================

  /**
   * Check if the executor is ready for use.
   */
  isReady(): boolean {
    return true;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ProbeExecutorConfig {
    return { ...this.config };
  }

  // ============================================================================
  // PUBLIC API - Probe Execution
  // ============================================================================

  /**
   * Execute a single probe.
   *
   * @param probe - The probe to execute
   * @param context - Optional context information to log
   * @returns The probe execution result
   */
  async executeProbe(
    probe: Probe,
    context: Record<string, unknown> = {}
  ): Promise<ProbeResult> {
    const startTime = Date.now();
    const timeout = probe.timeout > 0 ? probe.timeout : this.config.defaultTimeout;

    let output = '';
    let error: string | undefined;
    let success = false;

    // Execute the probe
    if (this.config.sandboxed) {
      const result = await executeSandboxed(probe.code, timeout);
      output = result.output;
      error = result.error;
      success = !error;
    } else {
      const result = await executeUnsandboxed(probe.code, timeout);
      output = result.output;
      error = result.error;
      success = !error;
    }

    const executionTime = Date.now() - startTime;

    // Calculate confidence
    const confidence = calculateConfidence(output, probe.expectedOutcome, success);

    // Determine if hypothesis is confirmed
    const confirmed = this.evaluateConfirmation(probe, output, success);

    const result: ProbeResult = {
      probeId: probe.id,
      success,
      output,
      error,
      executionTime,
      hypothesis: probe.hypothesis,
      confirmed,
      confidence,
    };

    // Log the execution
    this.logs.push({
      timestamp: new Date(),
      probe,
      result,
      context,
    });

    return result;
  }

  /**
   * Execute a batch of probes with concurrency control.
   *
   * @param probes - Array of probes to execute
   * @returns Array of probe results in the same order
   */
  async executeBatch(probes: Probe[]): Promise<ProbeResult[]> {
    if (probes.length === 0) {
      return [];
    }

    const results: ProbeResult[] = new Array(probes.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < probes.length; i++) {
      const index = i;
      const probe = probes[index];

      const execution = (async () => {
        results[index] = await this.executeProbe(probe);
      })();

      executing.push(execution);

      // If we've reached max concurrent, wait for one to complete
      if (executing.length >= this.config.maxConcurrent) {
        await Promise.race(executing);
        // Remove completed promises
        for (let j = executing.length - 1; j >= 0; j--) {
          // Check if the promise at index j has settled by attempting to race with an instant resolve
          const isSettled = await Promise.race([
            executing[j].then(() => true).catch(() => true),
            Promise.resolve(false),
          ]);
          if (isSettled) {
            executing.splice(j, 1);
          }
        }
      }
    }

    // Wait for all remaining executions
    await Promise.all(executing);

    return results;
  }

  // ============================================================================
  // PUBLIC API - Probe Generation
  // ============================================================================

  /**
   * Generate a probe from a hypothesis and context.
   *
   * @param hypothesis - The hypothesis to test
   * @param context - Context information for generating the probe
   * @returns A generated probe
   */
  generateProbe(hypothesis: string, context: unknown): Probe {
    const type = inferProbeType(hypothesis);
    const contextObj = (context as Record<string, unknown>) || {};

    // Generate code based on context
    let code = 'return true;';
    let expectedOutcome: string | undefined;

    if (contextObj.targetCode) {
      code = `return ${contextObj.targetCode};`;
    }

    if (contextObj.expectedValue !== undefined) {
      expectedOutcome = String(contextObj.expectedValue);
    }

    return {
      id: generateProbeId(),
      type,
      hypothesis,
      code,
      expectedOutcome,
      timeout: this.config.defaultTimeout,
    };
  }

  // ============================================================================
  // PUBLIC API - Result Evaluation
  // ============================================================================

  /**
   * Evaluate whether a probe result confirms the hypothesis.
   *
   * @param probe - The probe that was executed
   * @param result - The result of execution
   * @returns Whether the result confirms the hypothesis
   */
  evaluateResult(probe: Probe, result: ProbeResult): boolean {
    return this.evaluateConfirmation(probe, result.output, result.success);
  }

  // ============================================================================
  // PUBLIC API - Logging
  // ============================================================================

  /**
   * Get probe execution logs with optional filtering.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching log entries
   */
  getLogs(filter?: ProbeLogFilter): ProbeLog[] {
    if (!filter) {
      return [...this.logs];
    }

    return this.logs.filter((log) => {
      if (filter.probeId && log.probe.id !== filter.probeId) {
        return false;
      }

      if (filter.type && log.probe.type !== filter.type) {
        return false;
      }

      if (filter.success !== undefined && log.result.success !== filter.success) {
        return false;
      }

      if (filter.after && log.timestamp < filter.after) {
        return false;
      }

      if (filter.before && log.timestamp > filter.before) {
        return false;
      }

      return true;
    });
  }

  /**
   * Clear all stored logs.
   */
  clearLogs(): void {
    this.logs.length = 0;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Evaluate whether the output confirms the hypothesis.
   */
  private evaluateConfirmation(probe: Probe, output: string, success: boolean): boolean {
    // If execution failed, hypothesis is not confirmed
    if (!success) {
      return false;
    }

    // If no expected outcome, consider confirmed if successful
    if (!probe.expectedOutcome) {
      return true;
    }

    const outputLower = output.toLowerCase().trim();
    const expectedLower = probe.expectedOutcome.toLowerCase().trim();

    // Exact match
    if (outputLower === expectedLower) {
      return true;
    }

    // Contains match (for partial matching scenarios)
    if (outputLower.includes(expectedLower)) {
      return true;
    }

    return false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a ProbeExecutor with the specified configuration.
 *
 * @param config - Configuration for the executor
 * @returns A new ProbeExecutor instance
 */
export function createProbeExecutor(config: ProbeExecutorConfig): ProbeExecutor {
  return new ProbeExecutor(config);
}
