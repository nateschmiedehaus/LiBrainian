/**
 * @fileoverview Tests for MCP Server
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LibrarianMCPServer,
  createLibrarianMCPServer,
  type ServerState,
  type AuditLogEntry,
} from '../server.js';
import {
  DEFAULT_MCP_SERVER_CONFIG,
  type LibrarianMCPServerConfig,
} from '../types.js';

// ============================================================================
// TEST SETUP
// ============================================================================

describe('MCP Server', () => {
  let server: LibrarianMCPServer;

  beforeEach(async () => {
    server = await createLibrarianMCPServer({
      name: 'test-server',
      version: '1.0.0-test',
      authorization: {
        enabledScopes: ['read', 'write'],
        requireConsent: false,
      },
    });
  });

  afterEach(async () => {
    // Server doesn't need explicit cleanup in tests
  });

  // ============================================================================
  // SERVER CREATION
  // ============================================================================

  describe('server creation', () => {
    it('should create server with default config', async () => {
      const defaultServer = await createLibrarianMCPServer();
      const info = defaultServer.getServerInfo();

      expect(info.name).toBe(DEFAULT_MCP_SERVER_CONFIG.name);
      expect(info.version).toBe(DEFAULT_MCP_SERVER_CONFIG.version);
    });

    it('should create server with custom config', async () => {
      const customServer = await createLibrarianMCPServer({
        name: 'custom-server',
        version: '2.0.0',
      });
      const info = customServer.getServerInfo();

      expect(info.name).toBe('custom-server');
      expect(info.version).toBe('2.0.0');
    });

    it('should initialize with empty state', () => {
      const info = server.getServerInfo();

      expect(info.workspaceCount).toBe(0);
      expect(info.auditLogSize).toBe(0);
    });
  });

  // ============================================================================
  // WORKSPACE MANAGEMENT
  // ============================================================================

  describe('workspace management', () => {
    it('should register a workspace', () => {
      server.registerWorkspace('/path/to/workspace');
      const info = server.getServerInfo();

      expect(info.workspaceCount).toBe(1);
    });

    it('should not duplicate workspace registrations', () => {
      server.registerWorkspace('/path/to/workspace');
      server.registerWorkspace('/path/to/workspace');
      const info = server.getServerInfo();

      expect(info.workspaceCount).toBe(1);
    });

    it('should register multiple workspaces', () => {
      server.registerWorkspace('/path/to/workspace1');
      server.registerWorkspace('/path/to/workspace2');
      server.registerWorkspace('/path/to/workspace3');
      const info = server.getServerInfo();

      expect(info.workspaceCount).toBe(3);
    });

    it('should update workspace state', () => {
      server.registerWorkspace('/path/to/workspace');
      server.updateWorkspaceState('/path/to/workspace', {
        indexState: 'ready',
        indexedAt: new Date().toISOString(),
      });

      // State is internal but registration worked
      const info = server.getServerInfo();
      expect(info.workspaceCount).toBe(1);
    });
  });

  // ============================================================================
  // AUDIT LOGGING
  // ============================================================================

  describe('audit logging', () => {
    it('should return empty audit log initially', () => {
      const log = server.getAuditLog();
      expect(log).toHaveLength(0);
    });

    it('should support limit option', () => {
      // No entries to limit
      const log = server.getAuditLog({ limit: 5 });
      expect(log).toHaveLength(0);
    });

    it('should support since option', () => {
      const log = server.getAuditLog({ since: new Date().toISOString() });
      expect(log).toHaveLength(0);
    });
  });

  // ============================================================================
  // SERVER INFO
  // ============================================================================

  describe('server info', () => {
    it('should return correct server info', () => {
      const info = server.getServerInfo();

      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('version');
      expect(info).toHaveProperty('workspaceCount');
      expect(info).toHaveProperty('auditLogSize');
      expect(typeof info.name).toBe('string');
      expect(typeof info.version).toBe('string');
      expect(typeof info.workspaceCount).toBe('number');
      expect(typeof info.auditLogSize).toBe('number');
    });

    it('should update workspace count after registration', () => {
      expect(server.getServerInfo().workspaceCount).toBe(0);

      server.registerWorkspace('/test1');
      expect(server.getServerInfo().workspaceCount).toBe(1);

      server.registerWorkspace('/test2');
      expect(server.getServerInfo().workspaceCount).toBe(2);
    });
  });

  describe('tool metadata', () => {
    it('documents query tool usage guidance', () => {
      const tools = (server as any).getAvailableTools() as Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, { description?: string }> } }>;
      const queryTool = tools.find((tool) => tool.name === 'query');

      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toContain('Use query for semantic, cross-file context');
      expect(queryTool?.description).toContain('Do not use query for direct file reads');
      expect(queryTool?.inputSchema?.properties?.intent?.description).toContain('Goal-oriented question');
      expect(queryTool?.inputSchema?.properties?.intentType?.description).toContain('understand=explain');
    });
  });

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  describe('configuration', () => {
    it('should merge custom config with defaults', async () => {
      const customServer = await createLibrarianMCPServer({
        name: 'merged-server',
        // Other fields should come from defaults
      });
      const info = customServer.getServerInfo();

      expect(info.name).toBe('merged-server');
    });

    it('should support different authorization scopes', async () => {
      const readOnlyServer = await createLibrarianMCPServer({
        authorization: {
          enabledScopes: ['read'],
          requireConsent: true,
        },
      });

      // Server created successfully with read-only scopes
      const info = readOnlyServer.getServerInfo();
      expect(info.name).toBeDefined();
    });

    it('should support all authorization scopes', async () => {
      const fullAccessServer = await createLibrarianMCPServer({
        authorization: {
          enabledScopes: ['read', 'write', 'execute', 'network', 'admin'],
          requireConsent: false,
        },
      });

      const info = fullAccessServer.getServerInfo();
      expect(info.name).toBeDefined();
    });
  });
});

// ============================================================================
// AUTHENTICATION INTEGRATION TESTS
// ============================================================================

describe('MCP Server Authentication', () => {
  let server: LibrarianMCPServer;

  beforeEach(async () => {
    server = await createLibrarianMCPServer({
      name: 'auth-test-server',
      authorization: {
        enabledScopes: ['read', 'write'],
        requireConsent: true,
      },
    });
  });

  describe('session creation', () => {
    it('should create an authentication session', () => {
      const result = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
      });

      expect(result.token).toBeDefined();
      expect(result.sessionId).toMatch(/^sess_/);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should track active sessions in server info', () => {
      server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
      });

      const info = server.getServerInfo();
      expect(info.activeSessions).toBe(1);
    });
  });

  describe('token validation', () => {
    it('should validate a valid token', () => {
      const { token } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
      });

      const session = server.validateAuthToken(token);
      expect(session).not.toBeNull();
      expect(session!.scopes).toEqual(['read']);
    });

    it('should reject an invalid token', () => {
      const session = server.validateAuthToken('invalid-token');
      expect(session).toBeNull();
    });
  });

  describe('tool authorization', () => {
    it('should authorize read tools with read scope', () => {
      const { token } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
      });

      const result = server.authorizeToolCall(token, 'query');
      expect(result.authorized).toBe(true);
    });

    it('should deny write tools without write scope', () => {
      const { token } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
      });

      const result = server.authorizeToolCall(token, 'bootstrap');
      expect(result.authorized).toBe(false);
      expect(result.missingScopes).toContain('write');
    });

    it('should require consent for high-risk operations', () => {
      const { token } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read', 'write'],
      });

      const result = server.authorizeToolCall(token, 'bootstrap');
      expect(result.authorized).toBe(false);
      expect(result.requiresConsent).toBe(true);
    });

    it('should deny with invalid token', () => {
      const result = server.authorizeToolCall('invalid', 'query');
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('Invalid');
    });
  });

  describe('consent management', () => {
    it('should grant consent for operations', () => {
      const { sessionId } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read', 'write'],
      });

      const granted = server.grantConsent(sessionId, 'bootstrap');
      expect(granted).toBe(true);
    });

    it('should allow operation after consent', () => {
      const { token, sessionId } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read', 'write'],
      });

      // First - requires consent
      const result1 = server.authorizeToolCall(token, 'bootstrap');
      expect(result1.requiresConsent).toBe(true);

      // Grant consent
      server.grantConsent(sessionId, 'bootstrap');

      // Now authorized
      const result2 = server.authorizeToolCall(token, 'bootstrap');
      expect(result2.authorized).toBe(true);
    });

    it('should revoke consent', () => {
      const { token, sessionId } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read', 'write'],
      });

      server.grantConsent(sessionId, 'bootstrap');
      server.revokeConsent(sessionId, 'bootstrap');

      const result = server.authorizeToolCall(token, 'bootstrap');
      expect(result.requiresConsent).toBe(true);
    });
  });

  describe('session lifecycle', () => {
    it('should revoke a session', () => {
      const { token, sessionId } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
      });

      const revoked = server.revokeAuthSession(sessionId);
      expect(revoked).toBe(true);

      const session = server.validateAuthToken(token);
      expect(session).toBeNull();
    });

    it('should refresh a session', () => {
      const { sessionId } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
        ttlMs: 60000,
      });

      const refreshed = server.refreshAuthSession(sessionId);
      expect(refreshed).not.toBeNull();
    });

    it('should return auth stats', () => {
      server.createAuthSession({ clientId: 'client1', scopes: ['read'] });
      server.createAuthSession({ clientId: 'client2', scopes: ['read'] });

      const stats = server.getAuthStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeClients).toBe(2);
    });
  });

  describe('workspace restrictions', () => {
    it('should deny access to restricted workspace', () => {
      const { token } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
        allowedWorkspaces: ['/allowed/path'],
      });

      const result = server.authorizeToolCall(token, 'query', '/forbidden/path');
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('Workspace not allowed');
    });

    it('should allow access to permitted workspace', () => {
      const { token } = server.createAuthSession({
        clientId: 'test-client',
        scopes: ['read'],
        allowedWorkspaces: ['/allowed/path'],
      });

      const result = server.authorizeToolCall(token, 'query', '/allowed/path');
      expect(result.authorized).toBe(true);
    });
  });
});

// ============================================================================
// TYPE TESTS
// ============================================================================

describe('MCP Server Types', () => {
  describe('AuditLogEntry', () => {
    it('should accept valid audit log entry', () => {
      const entry: AuditLogEntry = {
        id: 'test-123',
        timestamp: new Date().toISOString(),
        operation: 'tool_call',
        name: 'query',
        status: 'success',
        durationMs: 100,
      };

      expect(entry.id).toBeDefined();
      expect(entry.operation).toBe('tool_call');
      expect(entry.status).toBe('success');
    });

    it('should support all operation types', () => {
      const operations: AuditLogEntry['operation'][] = [
        'tool_call',
        'resource_read',
        'authorization',
        'error',
      ];

      operations.forEach((op) => {
        const entry: AuditLogEntry = {
          id: 'test',
          timestamp: new Date().toISOString(),
          operation: op,
          name: 'test',
          status: 'success',
        };
        expect(entry.operation).toBe(op);
      });
    });

    it('should support all status types', () => {
      const statuses: AuditLogEntry['status'][] = [
        'success',
        'failure',
        'denied',
      ];

      statuses.forEach((status) => {
        const entry: AuditLogEntry = {
          id: 'test',
          timestamp: new Date().toISOString(),
          operation: 'tool_call',
          name: 'test',
          status,
        };
        expect(entry.status).toBe(status);
      });
    });

    it('should support optional fields', () => {
      const entry: AuditLogEntry = {
        id: 'test',
        timestamp: new Date().toISOString(),
        operation: 'tool_call',
        name: 'test',
        status: 'failure',
        sessionId: 'session-123',
        input: { query: 'test' },
        durationMs: 500,
        error: 'Something went wrong',
      };

      expect(entry.sessionId).toBe('session-123');
      expect(entry.input).toEqual({ query: 'test' });
      expect(entry.durationMs).toBe(500);
      expect(entry.error).toBe('Something went wrong');
    });
  });
});
