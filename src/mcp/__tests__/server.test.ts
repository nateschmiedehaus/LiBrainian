/**
 * @fileoverview Tests for MCP Server
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    it('includes get_session_briefing in available tools with onboarding-focused schema', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
        inputSchema?: { properties?: Record<string, { description?: string }> };
      }>;
      const briefingTool = tools.find((tool) => tool.name === 'get_session_briefing');

      expect(briefingTool).toBeDefined();
      expect(briefingTool?.description).toContain('session/workspace orientation');
      expect(briefingTool?.inputSchema?.properties?.includeConstructions?.description).toContain('construction onboarding hints');
    });

    it('includes blast_radius in available tools for pre-edit impact analysis', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
      }>;
      const blastRadiusTool = tools.find((tool) => tool.name === 'blast_radius');

      expect(blastRadiusTool).toBeDefined();
      expect(blastRadiusTool?.description).toContain('Pre-edit transitive impact analysis');
    });

    it('includes semantic_search as primary localization tool', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
      }>;
      const semanticSearchTool = tools.find((tool) => tool.name === 'semantic_search');

      expect(semanticSearchTool).toBeDefined();
      expect(semanticSearchTool?.description).toContain('Primary semantic code localization');
    });

    it('includes pre_commit_check as a semantic submit gate tool', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
      }>;
      const preCommitTool = tools.find((tool) => tool.name === 'pre_commit_check');

      expect(preCommitTool).toBeDefined();
      expect(preCommitTool?.description?.toLowerCase()).toContain('semantic pre-submit gate');
    });

    it('includes claim_work_scope for parallel coordination', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
      }>;
      const claimTool = tools.find((tool) => tool.name === 'claim_work_scope');

      expect(claimTool).toBeDefined();
      expect(claimTool?.description).toContain('parallel agent coordination');
    });

    it('includes find_callers and find_callees semantic navigation tools', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
      }>;
      const findCallersTool = tools.find((tool) => tool.name === 'find_callers');
      const findCalleesTool = tools.find((tool) => tool.name === 'find_callees');

      expect(findCallersTool).toBeDefined();
      expect(findCallersTool?.description?.toLowerCase()).toContain('caller');
      expect(findCalleesTool).toBeDefined();
      expect(findCalleesTool?.description?.toLowerCase()).toContain('callee');
    });

    it('includes append_claim, query_claims, and harvest_session_knowledge tools', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        description?: string;
      }>;
      const appendClaimTool = tools.find((tool) => tool.name === 'append_claim');
      const queryClaimsTool = tools.find((tool) => tool.name === 'query_claims');
      const harvestTool = tools.find((tool) => tool.name === 'harvest_session_knowledge');

      expect(appendClaimTool).toBeDefined();
      expect(appendClaimTool?.description?.toLowerCase()).toContain('claim');
      expect(queryClaimsTool).toBeDefined();
      expect(queryClaimsTool?.description?.toLowerCase()).toContain('claims');
      expect(harvestTool).toBeDefined();
      expect(harvestTool?.description?.toLowerCase()).toContain('session');
    });

    it('documents query tool usage guidance', () => {
      const tools = (server as any).getAvailableTools() as Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, { description?: string }> } }>;
      const queryTool = tools.find((tool) => tool.name === 'query');

      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toContain('Use query for semantic, cross-file context');
      expect(queryTool?.description).toContain('Do not use query for direct file reads');
      expect(queryTool?.inputSchema?.properties?.intent?.description).toContain('Goal-oriented question');
      expect(queryTool?.inputSchema?.properties?.intentType?.description).toContain('understand=explain');
    });

    it('adds MCP safety annotations for every tool', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        annotations?: {
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        };
      }>;

      expect(tools.length).toBeGreaterThanOrEqual(17);
      for (const tool of tools) {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations?.destructiveHint).toBe('boolean');
        expect(typeof tool.annotations?.idempotentHint).toBe('boolean');
        expect(typeof tool.annotations?.openWorldHint).toBe('boolean');
      }

      const queryTool = tools.find((tool) => tool.name === 'query');
      const bootstrapTool = tools.find((tool) => tool.name === 'bootstrap');
      const exportTool = tools.find((tool) => tool.name === 'export_index');

      expect(queryTool?.annotations?.readOnlyHint).toBe(true);
      expect(queryTool?.annotations?.idempotentHint).toBe(true);
      expect(bootstrapTool?.annotations?.readOnlyHint).toBe(false);
      expect(bootstrapTool?.annotations?.idempotentHint).toBe(true);
      expect(exportTool?.annotations?.readOnlyHint).toBe(false);
      expect(exportTool?.annotations?.openWorldHint).toBe(false);
    });

    it('ensures parameter descriptions are usage-guided for prompt injection clients', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        inputSchema?: {
          properties?: Record<string, unknown>;
        };
      }>;

      const collectDescriptions = (node: unknown): string[] => {
        if (!node || typeof node !== 'object') {
          return [];
        }
        const schema = node as {
          description?: unknown;
          properties?: Record<string, unknown>;
          items?: unknown;
        };
        const descriptions: string[] = [];
        if (typeof schema.description === 'string') {
          descriptions.push(schema.description);
        }
        if (schema.properties) {
          for (const value of Object.values(schema.properties)) {
            descriptions.push(...collectDescriptions(value));
          }
        }
        if (schema.items) {
          descriptions.push(...collectDescriptions(schema.items));
        }
        return descriptions;
      };

      for (const tool of tools) {
        const descriptions = collectDescriptions(tool.inputSchema);
        expect(descriptions.length).toBeGreaterThan(0);
        for (const description of descriptions) {
          const words = description.trim().split(/\s+/).filter(Boolean);
          expect(words.length).toBeGreaterThanOrEqual(20);
        }
      }
    });

    it('documents depth levels and affectedFiles path expectations for query', () => {
      const tools = (server as any).getAvailableTools() as Array<{
        name: string;
        inputSchema?: { properties?: Record<string, { description?: string }> };
      }>;
      const queryTool = tools.find((tool) => tool.name === 'query');
      const depthDescription = queryTool?.inputSchema?.properties?.depth?.description ?? '';
      const affectedFilesDescription = queryTool?.inputSchema?.properties?.affectedFiles?.description ?? '';

      expect(depthDescription).toContain('L0');
      expect(depthDescription).toContain('L1');
      expect(depthDescription).toContain('L2');
      expect(depthDescription).toContain('L3');
      expect(depthDescription).toContain('~500');
      expect(depthDescription).toContain('~2000');
      expect(depthDescription).toContain('~5000');
      expect(depthDescription).toContain('~10000');

      expect(affectedFilesDescription).toContain('Absolute paths');
      expect(affectedFilesDescription).toContain('Example');
      expect(affectedFilesDescription).toContain('/workspace/src/');
    });

    it('builds session briefing with bootstrap-first guidance when no workspace is registered', async () => {
      const result = await (server as any).executeGetSessionBriefing({}, {});
      expect(result.success).toBe(true);
      expect(result.workspace).toBeUndefined();
      expect(Array.isArray(result.recommendedActions)).toBe(true);
      expect(result.recommendedActions[0]?.tool).toBe('bootstrap');
      expect(result.constructions?.quickstart).toBe('docs/constructions/quickstart.md');
    });

    it('wraps get_change_impact in blast_radius guidance', async () => {
      vi.spyOn(server as any, 'executeGetChangeImpact').mockResolvedValue({
        success: true,
        summary: { riskLevel: 'high' },
        impacted: [],
      });

      const result = await (server as any).executeBlastRadius({ target: 'src/api/auth.ts' });
      expect(result.success).toBe(true);
      expect(result.tool).toBe('blast_radius');
      expect(result.aliasOf).toBe('get_change_impact');
      expect(result.preEditGuidance?.nextTools).toEqual(
        expect.arrayContaining(['request_human_review', 'synthesize_plan']),
      );
    });

    it('wraps query in semantic_search with related files and next-tool guidance', async () => {
      vi.spyOn(server as any, 'executeQuery').mockResolvedValue({
        packs: [
          { relatedFiles: ['src/auth.ts', 'src/session.ts'] },
          { relatedFiles: ['src/session.ts', 'src/routes.ts'] },
        ],
      });

      const result = await (server as any).executeSemanticSearch({ query: 'auth token refresh' }, {});
      expect(result.tool).toBe('semantic_search');
      expect(result.aliasOf).toBe('query');
      expect(result.searchQuery).toBe('auth token refresh');
      expect(result.relatedFiles).toEqual(['src/auth.ts', 'src/session.ts', 'src/routes.ts']);
      expect(result.recommendedNextTools).toEqual(
        expect.arrayContaining(['find_symbol', 'trace_imports', 'get_change_impact']),
      );
    });

    it('evaluates changed files in pre_commit_check and surfaces pass/fail summary', async () => {
      vi.spyOn(server as any, 'executeGetChangeImpact')
        .mockResolvedValueOnce({ success: true, summary: { riskLevel: 'medium', totalImpacted: 3 } })
        .mockResolvedValueOnce({ success: true, summary: { riskLevel: 'high', totalImpacted: 9 } });

      const result = await (server as any).executePreCommitCheck({
        changedFiles: ['src/api/auth.ts', 'src/session.ts'],
        workspace: '/tmp/workspace',
        maxRiskLevel: 'medium',
      });

      expect(result.success).toBe(true);
      expect(result.tool).toBe('pre_commit_check');
      expect(result.passed).toBe(false);
      expect(result.summary?.failingFiles).toContain('src/session.ts');
      expect(result.recommendedActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: 'request_human_review' }),
          expect.objectContaining({ tool: 'synthesize_plan' }),
        ]),
      );
    });

    it('claims, checks, and releases work scopes with conflict reporting', async () => {
      const first = await (server as any).executeClaimWorkScope({
        scopeId: 'src/api/auth.ts',
        sessionId: 'sess_a',
        owner: 'agent-a',
      });
      expect(first.success).toBe(true);
      expect(first.claimed).toBe(true);

      const conflict = await (server as any).executeClaimWorkScope({
        scopeId: 'src/api/auth.ts',
        sessionId: 'sess_b',
        owner: 'agent-b',
      });
      expect(conflict.success).toBe(true);
      expect(conflict.claimed).toBe(false);
      expect(conflict.conflict?.sessionId).toBe('sess_a');

      const check = await (server as any).executeClaimWorkScope({
        scopeId: 'src/api/auth.ts',
        mode: 'check',
      });
      expect(check.success).toBe(true);
      expect(check.available).toBe(false);

      const releaseDenied = await (server as any).executeClaimWorkScope({
        scopeId: 'src/api/auth.ts',
        mode: 'release',
        sessionId: 'sess_b',
      });
      expect(releaseDenied.success).toBe(true);
      expect(releaseDenied.released).toBe(false);

      const release = await (server as any).executeClaimWorkScope({
        scopeId: 'src/api/auth.ts',
        mode: 'release',
        sessionId: 'sess_a',
      });
      expect(release.success).toBe(true);
      expect(release.released).toBe(true);
    });

    it('appends, queries, and harvests session knowledge claims', async () => {
      const appendedA = await (server as any).executeAppendClaim({
        claim: 'Token refresh retries up to 3 attempts before forcing re-login.',
        sessionId: 'sess_knowledge',
        tags: ['auth', 'reliability'],
        confidence: 0.85,
      }, {});
      const appendedB = await (server as any).executeAppendClaim({
        claim: 'Rate limiting applies stricter thresholds to anonymous sessions.',
        sessionId: 'sess_knowledge',
        tags: ['auth', 'security'],
        confidence: 0.75,
      }, {});

      expect(appendedA.success).toBe(true);
      expect(appendedA.claimId).toMatch(/^clm_/);
      expect(appendedB.success).toBe(true);

      const queryResult = await (server as any).executeQueryClaims({
        sessionId: 'sess_knowledge',
        query: 'token',
      });
      expect(queryResult.success).toBe(true);
      expect(queryResult.totalMatches).toBe(1);
      expect(queryResult.claims[0]?.claim).toContain('Token refresh');

      const harvested = await (server as any).executeHarvestSessionKnowledge({
        sessionId: 'sess_knowledge',
        minConfidence: 0.8,
      }, {});
      expect(harvested.success).toBe(true);
      expect(harvested.summary?.totalClaims).toBe(1);
      expect(harvested.summary?.topTags?.map((entry: { tag: string }) => entry.tag)).toContain('auth');
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
