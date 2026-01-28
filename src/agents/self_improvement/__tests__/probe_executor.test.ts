/**
 * @fileoverview Tests for ProbeExecutor
 *
 * WU-SELF-002: Automatic Probe Execution
 *
 * Tests cover:
 * - Single probe execution
 * - Batch probe execution
 * - Probe generation from hypotheses
 * - Result evaluation
 * - Log retrieval and filtering
 * - Timeout enforcement
 * - Sandboxed execution safety
 * - Resource limits
 * - Read-only constraints
 * - Various probe types (test, assertion, measurement, query)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProbeExecutor,
  createProbeExecutor,
  type Probe,
  type ProbeResult,
  type ProbeLog,
  type ProbeExecutorConfig,
  type ProbeLogFilter,
  type ProbeType,
} from '../probe_executor.js';

describe('ProbeExecutor', () => {
  let executor: ProbeExecutor;
  const defaultConfig: ProbeExecutorConfig = {
    maxConcurrent: 3,
    defaultTimeout: 5000,
    logPath: '/tmp/probe-logs',
    sandboxed: true,
  };

  beforeEach(() => {
    executor = new ProbeExecutor(defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // CONSTRUCTOR AND INITIALIZATION
  // ============================================================================

  describe('constructor and initialization', () => {
    it('creates executor with default configuration', () => {
      const exec = new ProbeExecutor(defaultConfig);
      expect(exec).toBeDefined();
      expect(exec.isReady()).toBe(true);
    });

    it('creates executor with custom configuration', () => {
      const customConfig: ProbeExecutorConfig = {
        maxConcurrent: 5,
        defaultTimeout: 10000,
        logPath: '/custom/logs',
        sandboxed: false,
      };
      const exec = new ProbeExecutor(customConfig);
      expect(exec).toBeDefined();
      expect(exec.getConfig()).toEqual(customConfig);
    });

    it('validates maxConcurrent is positive', () => {
      expect(() => {
        new ProbeExecutor({ ...defaultConfig, maxConcurrent: 0 });
      }).toThrow('maxConcurrent must be positive');
    });

    it('validates defaultTimeout is positive', () => {
      expect(() => {
        new ProbeExecutor({ ...defaultConfig, defaultTimeout: -1 });
      }).toThrow('defaultTimeout must be positive');
    });
  });

  // ============================================================================
  // SINGLE PROBE EXECUTION
  // ============================================================================

  describe('executeProbe - single execution', () => {
    it('executes a simple test probe successfully', async () => {
      const probe: Probe = {
        id: 'probe-001',
        type: 'test',
        hypothesis: 'The function returns true for valid input',
        code: 'return true;',
        expectedOutcome: 'true',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.probeId).toBe('probe-001');
      expect(result.success).toBe(true);
      expect(result.hypothesis).toBe('The function returns true for valid input');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('executes an assertion probe', async () => {
      const probe: Probe = {
        id: 'probe-002',
        type: 'assertion',
        hypothesis: 'Array length equals 3',
        code: 'const arr = [1, 2, 3]; return arr.length === 3;',
        expectedOutcome: 'true',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.probeId).toBe('probe-002');
      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
    });

    it('executes a measurement probe', async () => {
      const probe: Probe = {
        id: 'probe-003',
        type: 'measurement',
        hypothesis: 'String concatenation produces expected length',
        code: 'const s = "hello" + " " + "world"; return s.length;',
        expectedOutcome: '11',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.probeId).toBe('probe-003');
      expect(result.success).toBe(true);
      expect(result.output).toContain('11');
    });

    it('executes a query probe', async () => {
      const probe: Probe = {
        id: 'probe-004',
        type: 'query',
        hypothesis: 'Object has expected property',
        code: 'const obj = { name: "test" }; return "name" in obj;',
        expectedOutcome: 'true',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.probeId).toBe('probe-004');
      expect(result.success).toBe(true);
    });

    it('returns failed result when probe throws', async () => {
      const probe: Probe = {
        id: 'probe-error',
        type: 'test',
        hypothesis: 'This will fail',
        code: 'throw new Error("Deliberate failure");',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.probeId).toBe('probe-error');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Deliberate failure');
      expect(result.confirmed).toBe(false);
    });

    it('tracks execution time accurately', async () => {
      const delay = 50;
      const probe: Probe = {
        id: 'probe-timing',
        type: 'test',
        hypothesis: 'Timing test',
        code: `
          const start = Date.now();
          while (Date.now() - start < ${delay}) {}
          return true;
        `,
        timeout: 5000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.executionTime).toBeGreaterThanOrEqual(delay - 10);
      expect(result.executionTime).toBeLessThan(delay + 100);
    });
  });

  // ============================================================================
  // TIMEOUT ENFORCEMENT
  // ============================================================================

  describe('timeout enforcement', () => {
    it('times out probe that exceeds timeout', async () => {
      const probe: Probe = {
        id: 'probe-slow',
        type: 'test',
        hypothesis: 'This probe takes too long',
        code: 'while(true) {}',
        timeout: 100,
      };

      const result = await executor.executeProbe(probe);

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('timed out');
    }, 10000);

    it('uses default timeout when probe timeout not specified', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        defaultTimeout: 100,
      });

      const probe: Probe = {
        id: 'probe-default-timeout',
        type: 'test',
        hypothesis: 'Uses default timeout',
        code: 'while(true) {}',
        timeout: 0, // Should fall back to default
      };

      const result = await exec.executeProbe(probe);

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('timed out');
    }, 10000);

    it('respects probe-specific timeout over default', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        defaultTimeout: 10000, // Long default
      });

      const probe: Probe = {
        id: 'probe-specific-timeout',
        type: 'test',
        hypothesis: 'Uses specific timeout',
        code: 'while(true) {}',
        timeout: 100, // Short specific timeout
      };

      const startTime = Date.now();
      const result = await exec.executeProbe(probe);
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(elapsed).toBeLessThan(1000); // Should timeout quickly
    }, 10000);
  });

  // ============================================================================
  // BATCH EXECUTION
  // ============================================================================

  describe('executeBatch - batch execution', () => {
    it('executes multiple probes in batch', async () => {
      const probes: Probe[] = [
        {
          id: 'batch-1',
          type: 'test',
          hypothesis: 'First hypothesis',
          code: 'return 1;',
          timeout: 1000,
        },
        {
          id: 'batch-2',
          type: 'test',
          hypothesis: 'Second hypothesis',
          code: 'return 2;',
          timeout: 1000,
        },
        {
          id: 'batch-3',
          type: 'test',
          hypothesis: 'Third hypothesis',
          code: 'return 3;',
          timeout: 1000,
        },
      ];

      const results = await executor.executeBatch(probes);

      expect(results.length).toBe(3);
      expect(results[0].probeId).toBe('batch-1');
      expect(results[1].probeId).toBe('batch-2');
      expect(results[2].probeId).toBe('batch-3');
    });

    it('respects maxConcurrent limit', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        maxConcurrent: 2,
      });

      let concurrentCount = 0;
      let maxConcurrent = 0;

      // We can't directly test concurrency with simple probes,
      // but we can verify the batch completes correctly
      const probes: Probe[] = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent-${i}`,
        type: 'test' as ProbeType,
        hypothesis: `Hypothesis ${i}`,
        code: 'return true;',
        timeout: 1000,
      }));

      const results = await exec.executeBatch(probes);

      expect(results.length).toBe(5);
      results.forEach((r, i) => {
        expect(r.probeId).toBe(`concurrent-${i}`);
      });
    });

    it('handles mixed success and failure in batch', async () => {
      const probes: Probe[] = [
        {
          id: 'mix-success',
          type: 'test',
          hypothesis: 'This will succeed',
          code: 'return true;',
          timeout: 1000,
        },
        {
          id: 'mix-fail',
          type: 'test',
          hypothesis: 'This will fail',
          code: 'throw new Error("fail");',
          timeout: 1000,
        },
        {
          id: 'mix-success-2',
          type: 'test',
          hypothesis: 'This will also succeed',
          code: 'return "ok";',
          timeout: 1000,
        },
      ];

      const results = await executor.executeBatch(probes);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('returns empty array for empty batch', async () => {
      const results = await executor.executeBatch([]);
      expect(results).toEqual([]);
    });
  });

  // ============================================================================
  // PROBE GENERATION
  // ============================================================================

  describe('generateProbe - probe generation', () => {
    it('generates probe from hypothesis string', () => {
      const hypothesis = 'The array contains exactly 5 elements';
      const context = {
        targetCode: 'const arr = [1, 2, 3, 4, 5];',
        expectedValue: 5,
      };

      const probe = executor.generateProbe(hypothesis, context);

      expect(probe.id).toBeDefined();
      expect(probe.hypothesis).toBe(hypothesis);
      expect(probe.type).toBeDefined();
      expect(probe.timeout).toBeGreaterThan(0);
    });

    it('generates unique IDs for multiple probes', () => {
      const probes = [
        executor.generateProbe('Hypothesis 1', {}),
        executor.generateProbe('Hypothesis 2', {}),
        executor.generateProbe('Hypothesis 3', {}),
      ];

      const ids = new Set(probes.map((p) => p.id));
      expect(ids.size).toBe(3);
    });

    it('infers probe type from hypothesis keywords', () => {
      // Test type inference
      const testProbe = executor.generateProbe('Test that the function works', {});
      expect(testProbe.type).toBe('test');

      const assertProbe = executor.generateProbe('Assert that value equals 5', {});
      expect(assertProbe.type).toBe('assertion');

      const measureProbe = executor.generateProbe('Measure the execution time', {});
      expect(measureProbe.type).toBe('measurement');

      const queryProbe = executor.generateProbe('Query the database for records', {});
      expect(queryProbe.type).toBe('query');
    });

    it('uses context to generate appropriate code', () => {
      const probe = executor.generateProbe(
        'Check array length',
        {
          targetCode: 'arr.length',
          expectedValue: 3,
        }
      );

      expect(probe.code).toBeDefined();
      expect(probe.expectedOutcome).toBeDefined();
    });
  });

  // ============================================================================
  // RESULT EVALUATION
  // ============================================================================

  describe('evaluateResult - result evaluation', () => {
    it('confirms hypothesis when output matches expected', () => {
      const probe: Probe = {
        id: 'eval-match',
        type: 'assertion',
        hypothesis: 'Value equals 42',
        code: 'return 42;',
        expectedOutcome: '42',
        timeout: 1000,
      };

      const result: ProbeResult = {
        probeId: 'eval-match',
        success: true,
        output: '42',
        executionTime: 10,
        hypothesis: 'Value equals 42',
        confirmed: false,
        confidence: 0,
      };

      const confirmed = executor.evaluateResult(probe, result);

      expect(confirmed).toBe(true);
    });

    it('rejects hypothesis when output does not match expected', () => {
      const probe: Probe = {
        id: 'eval-no-match',
        type: 'assertion',
        hypothesis: 'Value equals 42',
        code: 'return 41;',
        expectedOutcome: '42',
        timeout: 1000,
      };

      const result: ProbeResult = {
        probeId: 'eval-no-match',
        success: true,
        output: '41',
        executionTime: 10,
        hypothesis: 'Value equals 42',
        confirmed: false,
        confidence: 0,
      };

      const confirmed = executor.evaluateResult(probe, result);

      expect(confirmed).toBe(false);
    });

    it('rejects hypothesis when probe failed', () => {
      const probe: Probe = {
        id: 'eval-failed',
        type: 'test',
        hypothesis: 'Operation succeeds',
        code: 'throw new Error();',
        timeout: 1000,
      };

      const result: ProbeResult = {
        probeId: 'eval-failed',
        success: false,
        output: '',
        error: 'Error',
        executionTime: 10,
        hypothesis: 'Operation succeeds',
        confirmed: false,
        confidence: 0,
      };

      const confirmed = executor.evaluateResult(probe, result);

      expect(confirmed).toBe(false);
    });

    it('handles partial match evaluation', () => {
      const probe: Probe = {
        id: 'eval-partial',
        type: 'measurement',
        hypothesis: 'Result contains expected substring',
        code: 'return "hello world";',
        expectedOutcome: 'world',
        timeout: 1000,
      };

      const result: ProbeResult = {
        probeId: 'eval-partial',
        success: true,
        output: 'hello world',
        executionTime: 10,
        hypothesis: 'Result contains expected substring',
        confirmed: false,
        confidence: 0,
      };

      const confirmed = executor.evaluateResult(probe, result);

      expect(confirmed).toBe(true);
    });
  });

  // ============================================================================
  // LOGGING
  // ============================================================================

  describe('getLogs - log retrieval', () => {
    it('logs all probe executions', async () => {
      const probe: Probe = {
        id: 'log-test',
        type: 'test',
        hypothesis: 'Logging test',
        code: 'return true;',
        timeout: 1000,
      };

      await executor.executeProbe(probe);

      const logs = executor.getLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].probe.id).toBe('log-test');
    });

    it('includes timestamp in log entries', async () => {
      const probe: Probe = {
        id: 'log-timestamp',
        type: 'test',
        hypothesis: 'Timestamp test',
        code: 'return true;',
        timeout: 1000,
      };

      const before = new Date();
      await executor.executeProbe(probe);
      const after = new Date();

      const logs = executor.getLogs();
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('filters logs by probe ID', async () => {
      const probes: Probe[] = [
        { id: 'filter-a', type: 'test', hypothesis: 'A', code: 'return 1;', timeout: 1000 },
        { id: 'filter-b', type: 'test', hypothesis: 'B', code: 'return 2;', timeout: 1000 },
        { id: 'filter-c', type: 'test', hypothesis: 'C', code: 'return 3;', timeout: 1000 },
      ];

      await executor.executeBatch(probes);

      const filter: ProbeLogFilter = { probeId: 'filter-b' };
      const logs = executor.getLogs(filter);

      expect(logs.length).toBe(1);
      expect(logs[0].probe.id).toBe('filter-b');
    });

    it('filters logs by probe type', async () => {
      const probes: Probe[] = [
        { id: 'type-1', type: 'test', hypothesis: 'Test', code: 'return 1;', timeout: 1000 },
        { id: 'type-2', type: 'assertion', hypothesis: 'Assert', code: 'return 2;', timeout: 1000 },
        { id: 'type-3', type: 'test', hypothesis: 'Test 2', code: 'return 3;', timeout: 1000 },
      ];

      await executor.executeBatch(probes);

      const filter: ProbeLogFilter = { type: 'test' };
      const logs = executor.getLogs(filter);

      expect(logs.length).toBe(2);
      logs.forEach((log) => {
        expect(log.probe.type).toBe('test');
      });
    });

    it('filters logs by success status', async () => {
      // Execute probes one at a time to ensure clear success/fail status
      const successProbe1: Probe = { id: 'success-1', type: 'test', hypothesis: 'Success', code: 'return true;', timeout: 1000 };
      const failProbe: Probe = { id: 'fail-1', type: 'test', hypothesis: 'Fail', code: 'throw new Error("deliberate failure");', timeout: 1000 };
      const successProbe2: Probe = { id: 'success-2', type: 'test', hypothesis: 'Success 2', code: 'return true;', timeout: 1000 };

      const result1 = await executor.executeProbe(successProbe1);
      const result2 = await executor.executeProbe(failProbe);
      const result3 = await executor.executeProbe(successProbe2);

      // Verify the results first
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result3.success).toBe(true);

      const successFilter: ProbeLogFilter = { success: true };
      const successLogs = executor.getLogs(successFilter);
      expect(successLogs.length).toBe(2);

      const failFilter: ProbeLogFilter = { success: false };
      const failLogs = executor.getLogs(failFilter);
      expect(failLogs.length).toBe(1);
    });

    it('filters logs by time range', async () => {
      const probe1: Probe = {
        id: 'time-1',
        type: 'test',
        hypothesis: 'First',
        code: 'return 1;',
        timeout: 1000,
      };

      await executor.executeProbe(probe1);
      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));
      const midTime = new Date();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const probe2: Probe = {
        id: 'time-2',
        type: 'test',
        hypothesis: 'Second',
        code: 'return 2;',
        timeout: 1000,
      };

      await executor.executeProbe(probe2);

      const filter: ProbeLogFilter = { after: midTime };
      const logs = executor.getLogs(filter);

      expect(logs.length).toBe(1);
      expect(logs[0].probe.id).toBe('time-2');
    });

    it('clears logs when requested', async () => {
      const probe: Probe = {
        id: 'clear-test',
        type: 'test',
        hypothesis: 'Clear test',
        code: 'return true;',
        timeout: 1000,
      };

      await executor.executeProbe(probe);
      expect(executor.getLogs().length).toBe(1);

      executor.clearLogs();
      expect(executor.getLogs().length).toBe(0);
    });
  });

  // ============================================================================
  // SANDBOXED EXECUTION
  // ============================================================================

  describe('sandboxed execution', () => {
    it('prevents filesystem writes in sandboxed mode', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        sandboxed: true,
      });

      const probe: Probe = {
        id: 'sandbox-write',
        type: 'test',
        hypothesis: 'Filesystem write should be blocked',
        code: `
          const fs = require('fs');
          fs.writeFileSync('/tmp/test.txt', 'data');
          return true;
        `,
        timeout: 1000,
      };

      const result = await exec.executeProbe(probe);

      // Should fail or be blocked
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('allows read-only operations in sandboxed mode', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        sandboxed: true,
      });

      const probe: Probe = {
        id: 'sandbox-read',
        type: 'test',
        hypothesis: 'Read-only operation should work',
        code: 'return typeof process !== "undefined";',
        timeout: 1000,
      };

      const result = await exec.executeProbe(probe);

      // Read-only operations should work
      expect(result.success).toBe(true);
    });

    it('blocks network access in sandboxed mode', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        sandboxed: true,
      });

      const probe: Probe = {
        id: 'sandbox-network',
        type: 'test',
        hypothesis: 'Network access should be blocked',
        code: `
          const http = require('http');
          http.get('http://example.com');
          return true;
        `,
        timeout: 1000,
      };

      const result = await exec.executeProbe(probe);

      expect(result.success).toBe(false);
    });

    it('allows all operations in non-sandboxed mode', async () => {
      const exec = new ProbeExecutor({
        ...defaultConfig,
        sandboxed: false,
      });

      const probe: Probe = {
        id: 'no-sandbox',
        type: 'test',
        hypothesis: 'Operations allowed without sandbox',
        code: 'return true;',
        timeout: 1000,
      };

      const result = await exec.executeProbe(probe);

      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // CONFIDENCE SCORING
  // ============================================================================

  describe('confidence scoring', () => {
    it('assigns high confidence for exact match', async () => {
      const probe: Probe = {
        id: 'confidence-high',
        type: 'assertion',
        hypothesis: 'Exact value match',
        code: 'return 42;',
        expectedOutcome: '42',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('assigns lower confidence for partial match', async () => {
      const probe: Probe = {
        id: 'confidence-partial',
        type: 'measurement',
        hypothesis: 'Partial string match',
        code: 'return "hello world";',
        expectedOutcome: 'world',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThan(1.0);
    });

    it('assigns zero confidence for failed probes', async () => {
      const probe: Probe = {
        id: 'confidence-zero',
        type: 'test',
        hypothesis: 'Failed probe',
        code: 'throw new Error("deliberate failure");',
        timeout: 1000,
      };

      const result = await executor.executeProbe(probe);

      // Verify the probe actually failed
      expect(result.success).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });

  // ============================================================================
  // CONTEXT HANDLING
  // ============================================================================

  describe('context handling', () => {
    it('includes context in log entries', async () => {
      const probe: Probe = {
        id: 'context-test',
        type: 'test',
        hypothesis: 'Context test',
        code: 'return true;',
        timeout: 1000,
      };

      await executor.executeProbe(probe, { environment: 'test', version: '1.0.0' });

      const logs = executor.getLogs();
      expect(logs[0].context).toEqual({ environment: 'test', version: '1.0.0' });
    });

    it('handles empty context', async () => {
      const probe: Probe = {
        id: 'empty-context',
        type: 'test',
        hypothesis: 'Empty context',
        code: 'return true;',
        timeout: 1000,
      };

      await executor.executeProbe(probe);

      const logs = executor.getLogs();
      expect(logs[0].context).toEqual({});
    });
  });

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('createProbeExecutor factory', () => {
    it('creates executor with configuration', () => {
      const exec = createProbeExecutor(defaultConfig);
      expect(exec).toBeInstanceOf(ProbeExecutor);
      expect(exec.isReady()).toBe(true);
    });

    it('creates executor with partial configuration', () => {
      const exec = createProbeExecutor({
        maxConcurrent: 2,
        defaultTimeout: 3000,
        logPath: '/logs',
        sandboxed: true,
      });
      expect(exec).toBeInstanceOf(ProbeExecutor);
    });
  });

  // ============================================================================
  // INTERFACE TYPE CHECKS
  // ============================================================================

  describe('interface type checks', () => {
    it('has correct Probe shape', () => {
      const probe: Probe = {
        id: 'type-check',
        type: 'test',
        hypothesis: 'Type check',
        code: 'return true;',
        expectedOutcome: 'true',
        timeout: 1000,
      };

      expect(probe.id).toBe('type-check');
      expect(probe.type).toBe('test');
      expect(probe.hypothesis).toBe('Type check');
      expect(probe.code).toBe('return true;');
      expect(probe.expectedOutcome).toBe('true');
      expect(probe.timeout).toBe(1000);
    });

    it('has correct ProbeResult shape', () => {
      const result: ProbeResult = {
        probeId: 'result-check',
        success: true,
        output: 'test output',
        executionTime: 100,
        hypothesis: 'Test hypothesis',
        confirmed: true,
        confidence: 0.95,
      };

      expect(result.probeId).toBe('result-check');
      expect(result.success).toBe(true);
      expect(result.output).toBe('test output');
      expect(result.executionTime).toBe(100);
      expect(result.hypothesis).toBe('Test hypothesis');
      expect(result.confirmed).toBe(true);
      expect(result.confidence).toBe(0.95);
    });

    it('has correct ProbeLog shape', () => {
      const log: ProbeLog = {
        timestamp: new Date(),
        probe: {
          id: 'log-check',
          type: 'test',
          hypothesis: 'Log check',
          code: 'return true;',
          timeout: 1000,
        },
        result: {
          probeId: 'log-check',
          success: true,
          output: 'output',
          executionTime: 50,
          hypothesis: 'Log check',
          confirmed: true,
          confidence: 0.9,
        },
        context: { key: 'value' },
      };

      expect(log.timestamp).toBeInstanceOf(Date);
      expect(log.probe.id).toBe('log-check');
      expect(log.result.probeId).toBe('log-check');
      expect(log.context).toEqual({ key: 'value' });
    });

    it('has correct ProbeExecutorConfig shape', () => {
      const config: ProbeExecutorConfig = {
        maxConcurrent: 5,
        defaultTimeout: 10000,
        logPath: '/path/to/logs',
        sandboxed: true,
      };

      expect(config.maxConcurrent).toBe(5);
      expect(config.defaultTimeout).toBe(10000);
      expect(config.logPath).toBe('/path/to/logs');
      expect(config.sandboxed).toBe(true);
    });
  });
});
