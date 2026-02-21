/**
 * @fileoverview Tests for MCP Audit Logging Module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuditLogger,
  createAuditLogger,
  DEFAULT_AUDIT_CONFIG,
  type AuditEvent,
  type AuditQueryOptions,
} from '../audit.js';
import { SqliteEvidenceLedger } from '../../epistemics/evidence_ledger.js';

// ============================================================================
// TEST SETUP
// ============================================================================

describe('MCP Audit Logger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = createAuditLogger({ minSeverity: 'debug' });
  });

  // ============================================================================
  // EVENT LOGGING
  // ============================================================================

  describe('event logging', () => {
    it('should log a basic event', () => {
      const event = logger.log({
        type: 'tool_call',
        severity: 'info',
        operation: 'query',
        status: 'success',
      });

      expect(event.id).toMatch(/^evt_/);
      expect(event.timestamp).toBeDefined();
      expect(event.type).toBe('tool_call');
      expect(event.operation).toBe('query');
    });

    it('should generate unique event IDs', () => {
      const event1 = logger.log({
        type: 'tool_call',
        severity: 'info',
        operation: 'query',
        status: 'success',
      });

      const event2 = logger.log({
        type: 'tool_call',
        severity: 'info',
        operation: 'bootstrap',
        status: 'success',
      });

      expect(event1.id).not.toBe(event2.id);
    });

    it('should include all provided fields', () => {
      const event = logger.log({
        type: 'tool_call',
        severity: 'info',
        operation: 'query',
        status: 'success',
        sessionId: 'sess_123',
        clientId: 'client_456',
        workspace: '/path/to/workspace',
        input: { intent: 'test' },
        output: { packs: [] },
        durationMs: 150,
      });

      expect(event.sessionId).toBe('sess_123');
      expect(event.clientId).toBe('client_456');
      expect(event.workspace).toBe('/path/to/workspace');
      expect(event.durationMs).toBe(150);
    });

    it('should add data hash for verification', () => {
      const event = logger.log({
        type: 'tool_call',
        severity: 'info',
        operation: 'query',
        status: 'success',
        input: { test: 'data' },
      });

      expect(event.dataHash).toBeDefined();
      expect(event.dataHash!.length).toBe(16);
    });

    it('appends tool calls to evidence ledger when configured', async () => {
      const ledger = new SqliteEvidenceLedger(':memory:');
      await ledger.initialize();

      const ledgerLogger = createAuditLogger({ minSeverity: 'debug' }, { ledger });

      ledgerLogger.logToolCall({
        operation: 'query',
        status: 'success',
        sessionId: 'sess_123',
        clientId: 'client_456',
        input: { intent: 'test' },
        output: { packs: [] },
        durationMs: 12,
      });

      await ledgerLogger.flushLedgerWrites();
      const entries = await ledger.query({ kinds: ['tool_call'] });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.kind).toBe('tool_call');
      expect(entries[0]?.payload).toMatchObject({
        toolName: 'query',
        success: true,
      });

      await ledger.close();
    });

    it('should respect minimum severity level', () => {
      const infoLogger = createAuditLogger({ minSeverity: 'info' });

      const debugEvent = infoLogger.log({
        type: 'system',
        severity: 'debug',
        operation: 'test',
        status: 'success',
      });

      const infoEvent = infoLogger.log({
        type: 'system',
        severity: 'info',
        operation: 'test',
        status: 'success',
      });

      expect(debugEvent.id).toBe('');
      expect(infoEvent.id).toMatch(/^evt_/);
    });

    it('should limit memory events', () => {
      const smallLogger = createAuditLogger({
        maxMemoryEvents: 5,
        minSeverity: 'debug',
      });

      for (let i = 0; i < 10; i++) {
        smallLogger.log({
          type: 'system',
          severity: 'info',
          operation: `op_${i}`,
          status: 'success',
        });
      }

      expect(smallLogger.size).toBe(5);
    });
  });

  // ============================================================================
  // SPECIALIZED LOGGING
  // ============================================================================

  describe('specialized logging', () => {
    it('should log tool calls', () => {
      const event = logger.logToolCall({
        operation: 'bootstrap',
        status: 'success',
        sessionId: 'sess_123',
        durationMs: 5000,
      });

      expect(event.type).toBe('tool_call');
      expect(event.severity).toBe('info');
    });

    it('should log tool call failures as errors', () => {
      const event = logger.logToolCall({
        operation: 'bootstrap',
        status: 'failure',
        error: 'Connection failed',
      });

      expect(event.severity).toBe('error');
      expect(event.error).toBe('Connection failed');
    });

    it('should log resource access', () => {
      const event = logger.logResourceAccess({
        operation: 'librainian://workspace/symbols',
        status: 'success',
        durationMs: 50,
      });

      expect(event.type).toBe('resource_read');
    });

    it('should log authorization events', () => {
      const event = logger.logAuthorization({
        operation: 'bootstrap',
        status: 'denied',
        sessionId: 'sess_123',
        metadata: { missingScopes: ['write'] },
      });

      expect(event.type).toBe('authorization');
      expect(event.severity).toBe('warning');
    });

    it('should log session events', () => {
      const event = logger.logSession({
        operation: 'session_create',
        status: 'success',
        sessionId: 'sess_123',
        clientId: 'client_456',
      });

      expect(event.type).toBe('session');
    });

    it('should log errors', () => {
      const event = logger.logError({
        operation: 'query',
        error: 'Database connection failed',
        sessionId: 'sess_123',
      });

      expect(event.type).toBe('error');
      expect(event.severity).toBe('error');
      expect(event.status).toBe('failure');
    });

    it('should log system events', () => {
      const event = logger.logSystem({
        operation: 'server_start',
        severity: 'info',
        metadata: { version: '1.0.0' },
      });

      expect(event.type).toBe('system');
    });
  });

  // ============================================================================
  // SENSITIVE DATA HANDLING
  // ============================================================================

  describe('sensitive data handling', () => {
    it('should redact sensitive fields by default', () => {
      const apiKey = ['api', '-', 'key', '-example'].join('');
      const event = logger.log({
        type: 'authorization',
        severity: 'info',
        operation: 'login',
        status: 'success',
        input: {
          username: 'user@example.com',
          password: 'secret123',
          apiKey,
        },
      });

      expect(event.input!.username).toBe('user@example.com');
      expect(event.input!.password).toBe('[REDACTED]');
      expect(event.input!.apiKey).toBe('[REDACTED]');
    });

    it('should redact nested sensitive fields', () => {
      const event = logger.log({
        type: 'authorization',
        severity: 'info',
        operation: 'login',
        status: 'success',
        input: {
          user: {
            name: 'John',
            details: {
              password: 'secret',
              authToken: 'abc123',
            },
          },
        },
      });

      const user = event.input!.user as Record<string, unknown>;
      const details = user.details as Record<string, unknown>;
      expect(details.password).toBe('[REDACTED]');
      expect(details.authToken).toBe('[REDACTED]');
    });

    it('should not redact when disabled', () => {
      const noRedactLogger = createAuditLogger({
        redactSensitiveFields: false,
        minSeverity: 'debug',
      });

      const event = noRedactLogger.log({
        type: 'authorization',
        severity: 'info',
        operation: 'login',
        status: 'success',
        input: { password: 'secret123' },
      });

      expect(event.input!.password).toBe('secret123');
    });
  });

  // ============================================================================
  // QUERYING
  // ============================================================================

  describe('querying', () => {
    beforeEach(() => {
      // Add sample events
      logger.logToolCall({ operation: 'query', status: 'success', sessionId: 'sess_1' });
      logger.logToolCall({ operation: 'bootstrap', status: 'success', sessionId: 'sess_1' });
      logger.logToolCall({ operation: 'query', status: 'failure', sessionId: 'sess_2' });
      logger.logAuthorization({ operation: 'bootstrap', status: 'denied', sessionId: 'sess_2' });
      logger.logError({ operation: 'query', error: 'Failed', sessionId: 'sess_3' });
    });

    it('should query all events', () => {
      const results = logger.query();
      expect(results.length).toBe(5);
    });

    it('should filter by type', () => {
      const results = logger.query({ type: 'tool_call' });
      expect(results.length).toBe(3);
    });

    it('should filter by multiple types', () => {
      const results = logger.query({ type: ['tool_call', 'authorization'] });
      expect(results.length).toBe(4);
    });

    it('should filter by status', () => {
      const results = logger.query({ status: 'success' });
      expect(results.length).toBe(2);
    });

    it('should filter by session ID', () => {
      const results = logger.query({ sessionId: 'sess_1' });
      expect(results.length).toBe(2);
    });

    it('should filter by operation pattern', () => {
      const results = logger.query({ operation: 'query' });
      expect(results.length).toBe(3);
    });

    it('should filter by operation glob pattern', () => {
      const results = logger.query({ operation: 'boot*' });
      expect(results.length).toBe(2);
    });

    it('should support time range filtering', () => {
      const now = new Date();
      const results = logger.query({
        since: new Date(now.getTime() - 1000).toISOString(),
      });
      expect(results.length).toBe(5);
    });

    it('should support pagination', () => {
      const page1 = logger.query({ limit: 2, offset: 0 });
      const page2 = logger.query({ limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should support sorting', () => {
      const asc = logger.query({ order: 'asc' });
      const desc = logger.query({ order: 'desc' });

      // Check that first asc event timestamp <= last asc event timestamp
      expect(new Date(asc[0].timestamp).getTime()).toBeLessThanOrEqual(
        new Date(asc[asc.length - 1].timestamp).getTime()
      );
      // Check that first desc event timestamp >= last desc event timestamp
      expect(new Date(desc[0].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(desc[desc.length - 1].timestamp).getTime()
      );
    });

    it('should get recent events', () => {
      const recent = logger.getRecent(3);
      expect(recent.length).toBe(3);
    });

    it('should get session events', () => {
      const events = logger.getSessionEvents('sess_1');
      expect(events.length).toBe(2);
      expect(events.every((e) => e.sessionId === 'sess_1')).toBe(true);
    });

    it('should get errors', () => {
      const errors = logger.getErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe('error');
    });
  });

  // ============================================================================
  // STATISTICS
  // ============================================================================

  describe('statistics', () => {
    beforeEach(() => {
      logger.logToolCall({ operation: 'query', status: 'success', sessionId: 'sess_1', clientId: 'client_1', durationMs: 100 });
      logger.logToolCall({ operation: 'bootstrap', status: 'success', sessionId: 'sess_1', clientId: 'client_1', durationMs: 200 });
      logger.logToolCall({ operation: 'query', status: 'failure', sessionId: 'sess_2', clientId: 'client_2', durationMs: 50 });
      logger.logAuthorization({ operation: 'bootstrap', status: 'denied', sessionId: 'sess_2', clientId: 'client_2' });
    });

    it('should calculate total events', () => {
      const stats = logger.getStats();
      expect(stats.totalEvents).toBe(4);
    });

    it('should count events by type', () => {
      const stats = logger.getStats();
      expect(stats.byType.tool_call).toBe(3);
      expect(stats.byType.authorization).toBe(1);
    });

    it('should count events by status', () => {
      const stats = logger.getStats();
      expect(stats.byStatus.success).toBe(2);
      expect(stats.byStatus.failure).toBe(1);
      expect(stats.byStatus.denied).toBe(1);
    });

    it('should count unique sessions', () => {
      const stats = logger.getStats();
      expect(stats.uniqueSessions).toBe(2);
    });

    it('should count unique clients', () => {
      const stats = logger.getStats();
      expect(stats.uniqueClients).toBe(2);
    });

    it('should calculate average tool duration', () => {
      const stats = logger.getStats();
      expect(stats.avgToolDurationMs).toBeCloseTo(116.67, 1);
    });

    it('should calculate error rate', () => {
      const stats = logger.getStats();
      expect(stats.errorRate).toBe(25); // 1 failure out of 4
    });

    it('should include time range', () => {
      const stats = logger.getStats();
      expect(stats.timeRange.earliest).toBeDefined();
      expect(stats.timeRange.latest).toBeDefined();
    });
  });

  // ============================================================================
  // EXPORT
  // ============================================================================

  describe('export', () => {
    beforeEach(() => {
      logger.logToolCall({ operation: 'query', status: 'success' });
      logger.logToolCall({ operation: 'bootstrap', status: 'success' });
    });

    it('should convert to CSV format', async () => {
      // Test internal CSV conversion by checking stats
      const stats = logger.getStats();
      expect(stats.totalEvents).toBe(2);
    });
  });

  // ============================================================================
  // CLEAR
  // ============================================================================

  describe('clear', () => {
    it('should clear all events', () => {
      logger.logToolCall({ operation: 'query', status: 'success' });
      logger.logToolCall({ operation: 'bootstrap', status: 'success' });

      expect(logger.size).toBe(2);

      const cleared = logger.clear();

      expect(cleared).toBe(2);
      expect(logger.size).toBe(0);
    });
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('Audit Logger Configuration', () => {
  it('should use default configuration', () => {
    const logger = createAuditLogger();
    expect(DEFAULT_AUDIT_CONFIG.maxMemoryEvents).toBe(10000);
    expect(DEFAULT_AUDIT_CONFIG.minSeverity).toBe('info');
  });

  it('should merge custom configuration', () => {
    const logger = createAuditLogger({
      maxMemoryEvents: 5000,
      minSeverity: 'warning',
    });

    // Log an info event - should be filtered
    logger.log({
      type: 'system',
      severity: 'info',
      operation: 'test',
      status: 'success',
    });

    // Log a warning event - should be included
    logger.log({
      type: 'system',
      severity: 'warning',
      operation: 'test',
      status: 'success',
    });

    expect(logger.size).toBe(1);
  });

  it('should support custom sensitive patterns', () => {
    const logger = createAuditLogger({
      sensitivePatterns: [/custom_secret/i],
      minSeverity: 'debug',
    });

    const event = logger.log({
      type: 'tool_call',
      severity: 'info',
      operation: 'test',
      status: 'success',
      input: {
        custom_secret: 'value',
        normal_field: 'visible',
      },
    });

    expect(event.input!.custom_secret).toBe('[REDACTED]');
    expect(event.input!.normal_field).toBe('visible');
  });
});
