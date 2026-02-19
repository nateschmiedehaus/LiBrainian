/**
 * @fileoverview Tests for MCP Schema Validation
 *
 * Tests cover:
 * - Schema validation for all tool inputs
 * - Type guards
 * - Error reporting
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  validateToolInput,
  listToolSchemas,
  getToolSchema,
  parseToolInput,
  safeParseToolInput,
  BootstrapToolInputSchema,
  GetSessionBriefingToolInputSchema,
  QueryToolInputSchema,
  SemanticSearchToolInputSchema,
  SynthesizePlanToolInputSchema,
  BlastRadiusToolInputSchema,
  PreCommitCheckToolInputSchema,
  ClaimWorkScopeToolInputSchema,
  AppendClaimToolInputSchema,
  QueryClaimsToolInputSchema,
  HarvestSessionKnowledgeToolInputSchema,
  ResetSessionStateToolInputSchema,
  RequestHumanReviewToolInputSchema,
  ListConstructionsToolInputSchema,
  InvokeConstructionToolInputSchema,
  DescribeConstructionToolInputSchema,
  ExplainOperatorToolInputSchema,
  CheckConstructionTypesToolInputSchema,
  SubmitFeedbackToolInputSchema,
  ExplainFunctionToolInputSchema,
  FindUsagesToolInputSchema,
  TraceImportsToolInputSchema,
  VerifyClaimToolInputSchema,
  RunAuditToolInputSchema,
  DiffRunsToolInputSchema,
  ExportIndexToolInputSchema,
  GetContextPackBundleToolInputSchema,
  FindSymbolToolInputSchema,
  queryToolJsonSchema,
  type ToolName,
} from '../schema.js';
import {
  MCP_SCHEMA_VERSION,
  isBootstrapToolInput,
  isGetSessionBriefingToolInput,
  isQueryToolInput,
  isSemanticSearchToolInput,
  isSynthesizePlanToolInput,
  isBlastRadiusToolInput,
  isPreCommitCheckToolInput,
  isClaimWorkScopeToolInput,
  isAppendClaimToolInput,
  isQueryClaimsToolInput,
  isHarvestSessionKnowledgeToolInput,
  isResetSessionStateToolInput,
  isRequestHumanReviewToolInput,
  isListConstructionsToolInput,
  isInvokeConstructionToolInput,
  isDescribeConstructionToolInput,
  isExplainOperatorToolInput,
  isCheckConstructionTypesToolInput,
  isSubmitFeedbackToolInput,
  isExplainFunctionToolInput,
  isFindUsagesToolInput,
  isTraceImportsToolInput,
  isVerifyClaimToolInput,
  isRunAuditToolInput,
  isDiffRunsToolInput,
  isExportIndexToolInput,
  isGetContextPackBundleToolInput,
  isFindSymbolToolInput,
} from '../types.js';

describe('MCP Schema', () => {
  describe('Schema Version', () => {
    it('should have a valid semantic version', () => {
      expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(MCP_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Schema Registry', () => {
    it('should list all tool schemas', () => {
      const schemas = listToolSchemas();
      expect(schemas).toContain('bootstrap');
      expect(schemas).toContain('get_session_briefing');
      expect(schemas).toContain('system_contract');
      expect(schemas).toContain('diagnose_self');
      expect(schemas).toContain('status');
      expect(schemas).toContain('semantic_search');
      expect(schemas).toContain('query');
      expect(schemas).toContain('synthesize_plan');
      expect(schemas).toContain('reset_session_state');
      expect(schemas).toContain('request_human_review');
      expect(schemas).toContain('list_constructions');
      expect(schemas).toContain('invoke_construction');
      expect(schemas).toContain('describe_construction');
      expect(schemas).toContain('explain_operator');
      expect(schemas).toContain('check_construction_types');
      expect(schemas).toContain('submit_feedback');
      expect(schemas).toContain('explain_function');
      expect(schemas).toContain('find_usages');
      expect(schemas).toContain('trace_imports');
      expect(schemas).toContain('verify_claim');
      expect(schemas).toContain('run_audit');
      expect(schemas).toContain('list_runs');
      expect(schemas).toContain('diff_runs');
      expect(schemas).toContain('export_index');
      expect(schemas).toContain('get_context_pack_bundle');
      expect(schemas).toContain('list_verification_plans');
      expect(schemas).toContain('list_episodes');
      expect(schemas).toContain('list_technique_primitives');
      expect(schemas).toContain('list_technique_compositions');
      expect(schemas).toContain('select_technique_compositions');
      expect(schemas).toContain('compile_technique_composition');
      expect(schemas).toContain('compile_intent_bundles');
      expect(schemas).toContain('get_change_impact');
      expect(schemas).toContain('blast_radius');
      expect(schemas).toContain('pre_commit_check');
      expect(schemas).toContain('claim_work_scope');
      expect(schemas).toContain('append_claim');
      expect(schemas).toContain('query_claims');
      expect(schemas).toContain('harvest_session_knowledge');
      expect(schemas).toContain('find_symbol');
      expect(schemas).toHaveLength(40);
    });

    it('should return schema for known tools', () => {
      expect(getToolSchema('bootstrap')).toBeDefined();
      expect(getToolSchema('query')).toBeDefined();
      expect(getToolSchema('unknown')).toBeUndefined();
    });
  });

  describe('Bootstrap Tool Schema', () => {
    it('should validate correct input', () => {
      const input = { workspace: '/path/to/workspace' };
      const result = validateToolInput('bootstrap', input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate input with all options', () => {
      const input = {
        workspace: '/path/to/workspace',
        force: true,
        include: ['**/*.ts', '**/*.js'],
        exclude: ['node_modules/**'],
        llmProvider: 'claude',
        maxFiles: 100,
      };
      const result = validateToolInput('bootstrap', input);
      expect(result.valid).toBe(true);
    });

    it('should reject missing workspace', () => {
      const result = validateToolInput('bootstrap', {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('workspace'))).toBe(true);
    });

    it('should reject empty workspace', () => {
      const result = validateToolInput('bootstrap', { workspace: '' });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid llmProvider', () => {
      const result = validateToolInput('bootstrap', {
        workspace: '/test',
        llmProvider: 'invalid',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject extra properties (strict mode)', () => {
      const result = validateToolInput('bootstrap', {
        workspace: '/test',
        unknownField: 'value',
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isBootstrapToolInput({ workspace: '/test' })).toBe(true);
      expect(isBootstrapToolInput({})).toBe(false);
      expect(isBootstrapToolInput(null)).toBe(false);
    });
  });

  describe('Get Session Briefing Tool Schema', () => {
    it('should validate empty input', () => {
      const result = validateToolInput('get_session_briefing', {});
      expect(result.valid).toBe(true);
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('get_session_briefing', {
        workspace: '/tmp/workspace',
        sessionId: 'sess_123',
        includeConstructions: false,
      });
      expect(result.valid).toBe(true);
      expect(GetSessionBriefingToolInputSchema).toBeDefined();
    });

    it('should reject extra properties (strict mode)', () => {
      const result = validateToolInput('get_session_briefing', {
        workspace: '/tmp/workspace',
        unknownField: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isGetSessionBriefingToolInput({})).toBe(true);
      expect(isGetSessionBriefingToolInput({ sessionId: 'sess_1' })).toBe(true);
      expect(isGetSessionBriefingToolInput({ includeConstructions: true })).toBe(true);
      expect(isGetSessionBriefingToolInput({ includeConstructions: 'yes' })).toBe(false);
      expect(isGetSessionBriefingToolInput(null)).toBe(false);
    });
  });

  describe('Query Tool Schema', () => {
    it('should validate correct input', () => {
      const input = { intent: 'How does authentication work?' };
      const result = validateToolInput('query', input);
      expect(result.valid).toBe(true);
    });

    it('should validate input with all options', () => {
      const input = {
        intent: 'How does authentication work?',
        intentType: 'understand',
        affectedFiles: ['src/auth.ts'],
        minConfidence: 0.7,
        depth: 'L2',
        includeEngines: true,
        includeEvidence: true,
        pageSize: 10,
        pageIdx: 1,
        outputFile: '/tmp/query.json',
      };
      const result = validateToolInput('query', input);
      expect(result.valid).toBe(true);
    });

    it('should validate streaming options', () => {
      const input = {
        intent: 'Trace auth request lifecycle',
        stream: true,
        streamChunkSize: 3,
      };
      const result = validateToolInput('query', input);
      expect(result.valid).toBe(true);
    });

    it('should reject missing intent', () => {
      const result = validateToolInput('query', {});
      expect(result.valid).toBe(false);
    });

    it('should reject empty intent', () => {
      const result = validateToolInput('query', { intent: '' });
      expect(result.valid).toBe(false);
    });

    it('should reject intent exceeding max length', () => {
      const result = validateToolInput('query', {
        intent: 'a'.repeat(2001),
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid intentType', () => {
      const result = validateToolInput('query', {
        intent: 'test',
        intentType: 'invalid',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject minConfidence out of range', () => {
      expect(validateToolInput('query', { intent: 'test', minConfidence: -0.1 }).valid).toBe(false);
      expect(validateToolInput('query', { intent: 'test', minConfidence: 1.1 }).valid).toBe(false);
    });

    it('should reject invalid depth', () => {
      const result = validateToolInput('query', {
        intent: 'test',
        depth: 'L5',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid pagination values', () => {
      expect(validateToolInput('query', { intent: 'test', pageSize: 0 }).valid).toBe(false);
      expect(validateToolInput('query', { intent: 'test', pageIdx: -1 }).valid).toBe(false);
    });

    it('should reject invalid streaming chunk sizes', () => {
      expect(validateToolInput('query', { intent: 'test', stream: true, streamChunkSize: 0 }).valid).toBe(false);
      expect(validateToolInput('query', { intent: 'test', stream: true, streamChunkSize: 201 }).valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isQueryToolInput({ intent: 'test' })).toBe(true);
      expect(isQueryToolInput({})).toBe(false);
    });

    it('documents confidence behavior contract for agents', () => {
      expect(String(queryToolJsonSchema.description)).toContain('confidence_tier');
      expect(String(queryToolJsonSchema.description)).toContain('request_human_review');
    });

    it('should provide agent-usable query guidance descriptions', () => {
      expect(queryToolJsonSchema.description).toContain('semantic, cross-file retrieval');
      expect(queryToolJsonSchema.properties.intent?.description).toContain('Goal-oriented question');
      expect(queryToolJsonSchema.properties.intentType?.description).toContain('understand=explain');
    });
  });

  describe('Semantic Search Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('semantic_search', {
        query: 'where is auth token refresh implemented',
      });
      expect(result.valid).toBe(true);
      expect(SemanticSearchToolInputSchema).toBeDefined();
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('semantic_search', {
        query: 'auth middleware',
        workspace: '/tmp/workspace',
        sessionId: 'sess_1',
        minConfidence: 0.6,
        depth: 'L2',
        limit: 25,
        includeEngines: true,
        includeEvidence: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing query', () => {
      const result = validateToolInput('semantic_search', {});
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isSemanticSearchToolInput({ query: 'auth flow' })).toBe(true);
      expect(isSemanticSearchToolInput({ query: 'auth flow', depth: 'L3' })).toBe(true);
      expect(isSemanticSearchToolInput({ query: 'auth flow', depth: 'invalid' })).toBe(false);
      expect(isSemanticSearchToolInput(null)).toBe(false);
    });
  });

  describe('Submit Feedback Tool Schema', () => {
    it('should validate correct input', () => {
      const result = validateToolInput('submit_feedback', {
        feedbackToken: 'fbk_123',
        outcome: 'success',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate input with optional fields', () => {
      const result = validateToolInput('submit_feedback', {
        feedbackToken: 'fbk_123',
        outcome: 'partial',
        workspace: '/tmp/workspace',
        agentId: 'codex-cli',
        missingContext: 'Need auth lifecycle docs',
        customRatings: [{ packId: 'pack-1', relevant: true, usefulness: 0.8 }],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing required fields', () => {
      expect(validateToolInput('submit_feedback', { outcome: 'success' }).valid).toBe(false);
      expect(validateToolInput('submit_feedback', { feedbackToken: 'fbk_123' }).valid).toBe(false);
    });

    it('should reject invalid outcome', () => {
      const result = validateToolInput('submit_feedback', {
        feedbackToken: 'fbk_123',
        outcome: 'invalid',
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isSubmitFeedbackToolInput({ feedbackToken: 'fbk_123', outcome: 'failure' })).toBe(true);
      expect(isSubmitFeedbackToolInput({ feedbackToken: 'fbk_123', outcome: 'bad' })).toBe(false);
    });
  });

  describe('Blast Radius Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('blast_radius', {
        target: 'src/api/auth.ts',
      });
      expect(result.valid).toBe(true);
      expect(BlastRadiusToolInputSchema).toBeDefined();
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('blast_radius', {
        target: 'src/api/auth.ts',
        depth: 4,
        maxResults: 50,
        changeType: 'modify',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing target', () => {
      const result = validateToolInput('blast_radius', {});
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isBlastRadiusToolInput({ target: 'src/api/auth.ts' })).toBe(true);
      expect(isBlastRadiusToolInput({ target: 'src/api/auth.ts', changeType: 'rename' })).toBe(true);
      expect(isBlastRadiusToolInput({ target: 'src/api/auth.ts', changeType: 'invalid' })).toBe(false);
      expect(isBlastRadiusToolInput(null)).toBe(false);
    });
  });

  describe('Pre Commit Check Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('pre_commit_check', {
        changedFiles: ['src/api/auth.ts'],
      });
      expect(result.valid).toBe(true);
      expect(PreCommitCheckToolInputSchema).toBeDefined();
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('pre_commit_check', {
        changedFiles: ['src/api/auth.ts', 'src/session.ts'],
        workspace: '/tmp/workspace',
        strict: true,
        maxRiskLevel: 'medium',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject empty changedFiles', () => {
      const result = validateToolInput('pre_commit_check', {
        changedFiles: [],
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isPreCommitCheckToolInput({ changedFiles: ['src/a.ts'] })).toBe(true);
      expect(isPreCommitCheckToolInput({ changedFiles: ['src/a.ts'], maxRiskLevel: 'critical' })).toBe(true);
      expect(isPreCommitCheckToolInput({ changedFiles: ['src/a.ts'], maxRiskLevel: 'invalid' })).toBe(false);
      expect(isPreCommitCheckToolInput(null)).toBe(false);
    });
  });

  describe('Claim Work Scope Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('claim_work_scope', {
        scopeId: 'src/api/auth.ts',
      });
      expect(result.valid).toBe(true);
      expect(ClaimWorkScopeToolInputSchema).toBeDefined();
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('claim_work_scope', {
        scopeId: 'src/api/auth.ts',
        workspace: '/tmp/workspace',
        sessionId: 'sess_1',
        owner: 'agent-a',
        mode: 'claim',
        ttlSeconds: 600,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid mode', () => {
      const result = validateToolInput('claim_work_scope', {
        scopeId: 'src/api/auth.ts',
        mode: 'invalid',
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isClaimWorkScopeToolInput({ scopeId: 'src/a.ts' })).toBe(true);
      expect(isClaimWorkScopeToolInput({ scopeId: 'src/a.ts', mode: 'release' })).toBe(true);
      expect(isClaimWorkScopeToolInput({ scopeId: 'src/a.ts', mode: 'invalid' })).toBe(false);
      expect(isClaimWorkScopeToolInput(null)).toBe(false);
    });
  });

  describe('Session Knowledge Tools Schemas', () => {
    it('validates append_claim required and optional fields', () => {
      const result = validateToolInput('append_claim', {
        claim: 'Auth token refresh retries after transient provider failures',
        sessionId: 'sess_1',
        tags: ['auth', 'reliability'],
        confidence: 0.8,
      });
      expect(result.valid).toBe(true);
      expect(AppendClaimToolInputSchema).toBeDefined();
      expect(isAppendClaimToolInput({ claim: 'x' })).toBe(true);
      expect(isAppendClaimToolInput({ claim: 'x', confidence: 2 })).toBe(false);
      expect(isAppendClaimToolInput({})).toBe(false);
    });

    it('validates query_claims filters and type guard', () => {
      const result = validateToolInput('query_claims', {
        query: 'auth token',
        tags: ['auth'],
        limit: 20,
      });
      expect(result.valid).toBe(true);
      expect(QueryClaimsToolInputSchema).toBeDefined();
      expect(isQueryClaimsToolInput({})).toBe(true);
      expect(isQueryClaimsToolInput({ limit: 0 })).toBe(false);
      expect(isQueryClaimsToolInput(null)).toBe(false);
    });

    it('validates harvest_session_knowledge filters and type guard', () => {
      const result = validateToolInput('harvest_session_knowledge', {
        sessionId: 'sess_1',
        maxItems: 10,
        minConfidence: 0.6,
      });
      expect(result.valid).toBe(true);
      expect(HarvestSessionKnowledgeToolInputSchema).toBeDefined();
      expect(isHarvestSessionKnowledgeToolInput({})).toBe(true);
      expect(isHarvestSessionKnowledgeToolInput({ minConfidence: -1 })).toBe(false);
      expect(isHarvestSessionKnowledgeToolInput(null)).toBe(false);
    });
  });

  describe('Symbol Lookup Tool Schemas', () => {
    it('validates explain_function input and type guard', () => {
      const result = validateToolInput('explain_function', { name: 'queryLibrarian' });
      expect(result.valid).toBe(true);
      expect(isExplainFunctionToolInput({ name: 'queryLibrarian' })).toBe(true);
      expect(isExplainFunctionToolInput({})).toBe(false);
      expect(ExplainFunctionToolInputSchema).toBeDefined();
    });

    it('validates find_usages input and type guard', () => {
      const result = validateToolInput('find_usages', { symbol: 'createLibrarian', limit: 10 });
      expect(result.valid).toBe(true);
      expect(isFindUsagesToolInput({ symbol: 'createLibrarian' })).toBe(true);
      expect(isFindUsagesToolInput({})).toBe(false);
      expect(FindUsagesToolInputSchema).toBeDefined();
    });

    it('validates trace_imports input and type guard', () => {
      const result = validateToolInput('trace_imports', { filePath: 'src/api/index.ts', direction: 'both' });
      expect(result.valid).toBe(true);
      expect(isTraceImportsToolInput({ filePath: 'src/api/index.ts', direction: 'imports' })).toBe(true);
      expect(isTraceImportsToolInput({ filePath: 'src/api/index.ts', direction: 'invalid' })).toBe(false);
      expect(TraceImportsToolInputSchema).toBeDefined();
    });
  });

  describe('Reset Session State Tool Schema', () => {
    it('should validate empty input', () => {
      const result = validateToolInput('reset_session_state', {});
      expect(result.valid).toBe(true);
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('reset_session_state', {
        sessionId: 'sess_123',
        workspace: '/tmp/workspace',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject extra properties (strict mode)', () => {
      const result = validateToolInput('reset_session_state', {
        sessionId: 'sess_123',
        unknownField: 'value',
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isResetSessionStateToolInput({ sessionId: 'sess_123' })).toBe(true);
      expect(isResetSessionStateToolInput({ workspace: '/tmp/workspace' })).toBe(true);
      expect(isResetSessionStateToolInput(null)).toBe(false);
    });
  });

  describe('Synthesize Plan Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('synthesize_plan', {
        task: 'Stabilize auth token refresh flow',
        context_pack_ids: ['pack-auth-1', 'pack-auth-2'],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing required fields', () => {
      expect(validateToolInput('synthesize_plan', {
        task: 'Missing packs',
      }).valid).toBe(false);

      expect(validateToolInput('synthesize_plan', {
        context_pack_ids: ['pack-auth-1'],
      }).valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isSynthesizePlanToolInput({
        task: 'Investigate auth race',
        context_pack_ids: ['pack-1'],
      })).toBe(true);
      expect(isSynthesizePlanToolInput({
        task: 'Invalid empty packs',
        context_pack_ids: [],
      })).toBe(false);
      expect(SynthesizePlanToolInputSchema).toBeDefined();
    });
  });

  describe('Request Human Review Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('request_human_review', {
        reason: 'Ambiguous function ownership across two modules',
        context_summary: 'Two candidate implementations returned with conflicting confidence.',
        proposed_action: 'Patch auth/session.ts to alter token refresh behavior',
        confidence_tier: 'uncertain',
        risk_level: 'high',
        blocking: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = validateToolInput('request_human_review', {
        reason: 'Need approval',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid enum values', () => {
      const result = validateToolInput('request_human_review', {
        reason: 'Need approval',
        context_summary: 'Low confidence retrieval',
        proposed_action: 'Delete module',
        confidence_tier: 'medium',
        risk_level: 'critical',
        blocking: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isRequestHumanReviewToolInput({
        reason: 'Need approval',
        context_summary: 'Low confidence retrieval',
        proposed_action: 'Modify auth flow',
        confidence_tier: 'low',
        risk_level: 'medium',
        blocking: false,
      })).toBe(true);
      expect(isRequestHumanReviewToolInput(null)).toBe(false);
    });
  });

  describe('Construction Registry Tool Schemas', () => {
    it('validates list_constructions input and type guard', () => {
      const result = validateToolInput('list_constructions', {
        tags: ['security'],
        requires: ['librarian'],
        language: 'typescript',
        trustTier: 'official',
        availableOnly: true,
      });
      expect(result.valid).toBe(true);
      expect(isListConstructionsToolInput({
        tags: ['security'],
        trustTier: 'community',
      })).toBe(true);
      expect(isListConstructionsToolInput({
        trustTier: 'invalid',
      })).toBe(false);
      expect(ListConstructionsToolInputSchema).toBeDefined();
    });

    it('validates invoke_construction input and type guard', () => {
      const result = validateToolInput('invoke_construction', {
        constructionId: 'librainian:security-audit-helper',
        input: {
          files: ['src/index.ts'],
          checkTypes: ['injection'],
        },
      });
      expect(result.valid).toBe(true);
      expect(isInvokeConstructionToolInput({
        constructionId: 'librainian:security-audit-helper',
        input: {},
      })).toBe(true);
      expect(isInvokeConstructionToolInput({
        constructionId: 'librainian:security-audit-helper',
      })).toBe(false);
      expect(InvokeConstructionToolInputSchema).toBeDefined();
    });

    it('validates describe_construction input and type guard', () => {
      const result = validateToolInput('describe_construction', {
        id: 'librainian:security-audit-helper',
        includeExample: true,
        includeCompositionHints: true,
      });
      expect(result.valid).toBe(true);
      expect(isDescribeConstructionToolInput({
        id: 'librainian:security-audit-helper',
      })).toBe(true);
      expect(isDescribeConstructionToolInput({})).toBe(false);
      expect(DescribeConstructionToolInputSchema).toBeDefined();
    });

    it('validates explain_operator input and type guard', () => {
      const byOperator = validateToolInput('explain_operator', {
        operator: 'fanout',
      });
      const bySituation = validateToolInput('explain_operator', {
        situation: 'Run call graph and tests lookup in parallel',
      });

      expect(byOperator.valid).toBe(true);
      expect(bySituation.valid).toBe(true);
      expect(isExplainOperatorToolInput({ operator: 'seq' })).toBe(true);
      expect(isExplainOperatorToolInput({ situation: 'Need a recommendation' })).toBe(true);
      expect(isExplainOperatorToolInput({})).toBe(false);
      expect(ExplainOperatorToolInputSchema).toBeDefined();
    });

    it('validates check_construction_types input and type guard', () => {
      const result = validateToolInput('check_construction_types', {
        first: 'librainian:security-audit-helper',
        second: 'librainian:comprehensive-quality-construction',
        operator: 'seq',
      });
      expect(result.valid).toBe(true);
      expect(isCheckConstructionTypesToolInput({
        first: 'a',
        second: 'b',
        operator: 'fanout',
      })).toBe(true);
      expect(isCheckConstructionTypesToolInput({
        first: 'a',
        second: 'b',
        operator: 'bad',
      })).toBe(false);
      expect(CheckConstructionTypesToolInputSchema).toBeDefined();
    });
  });

  describe('Verify Claim Tool Schema', () => {
    it('should validate correct input', () => {
      const result = validateToolInput('verify_claim', { claimId: 'claim_123' });
      expect(result.valid).toBe(true);
    });

    it('should validate with force option', () => {
      const result = validateToolInput('verify_claim', {
        claimId: 'claim_123',
        force: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing claimId', () => {
      const result = validateToolInput('verify_claim', {});
      expect(result.valid).toBe(false);
    });

    it('should reject empty claimId', () => {
      const result = validateToolInput('verify_claim', { claimId: '' });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isVerifyClaimToolInput({ claimId: 'test' })).toBe(true);
      expect(isVerifyClaimToolInput({})).toBe(false);
    });
  });

  describe('Find Symbol Tool Schema', () => {
    it('should validate required fields', () => {
      const result = validateToolInput('find_symbol', {
        query: 'authenticateUser',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate optional fields', () => {
      const result = validateToolInput('find_symbol', {
        query: 'auth token',
        kind: 'claim',
        workspace: '/tmp/workspace',
        limit: 10,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid kind and limit', () => {
      expect(validateToolInput('find_symbol', { query: 'x', kind: 'invalid' }).valid).toBe(false);
      expect(validateToolInput('find_symbol', { query: 'x', limit: 0 }).valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isFindSymbolToolInput({ query: 'auth' })).toBe(true);
      expect(isFindSymbolToolInput({ query: 'auth', kind: 'function', limit: 20 })).toBe(true);
      expect(isFindSymbolToolInput({})).toBe(false);
    });

    it('exports FindSymbolToolInputSchema', () => {
      expect(FindSymbolToolInputSchema).toBeDefined();
    });
  });

  describe('Run Audit Tool Schema', () => {
    it('should validate correct input', () => {
      const result = validateToolInput('run_audit', { type: 'full' });
      expect(result.valid).toBe(true);
    });

    it('should validate all audit types', () => {
      const types = ['full', 'claims', 'coverage', 'security', 'freshness'];
      for (const type of types) {
        const result = validateToolInput('run_audit', { type });
        expect(result.valid).toBe(true);
      }
    });

    it('should validate with scope', () => {
      const result = validateToolInput('run_audit', {
        type: 'security',
        scope: ['src/**/*.ts'],
        generateReport: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing type', () => {
      const result = validateToolInput('run_audit', {});
      expect(result.valid).toBe(false);
    });

    it('should reject invalid type', () => {
      const result = validateToolInput('run_audit', { type: 'invalid' });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isRunAuditToolInput({ type: 'full' })).toBe(true);
      expect(isRunAuditToolInput({})).toBe(false);
    });
  });

  describe('Diff Runs Tool Schema', () => {
    it('should validate correct input', () => {
      const result = validateToolInput('diff_runs', {
        runIdA: 'run_1',
        runIdB: 'run_2',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate with detailed option', () => {
      const result = validateToolInput('diff_runs', {
        workspace: '/tmp/workspace',
        runIdA: 'run_1',
        runIdB: 'run_2',
        detailed: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing runIdA', () => {
      const result = validateToolInput('diff_runs', { runIdB: 'run_2' });
      expect(result.valid).toBe(false);
    });

    it('should reject missing runIdB', () => {
      const result = validateToolInput('diff_runs', { runIdA: 'run_1' });
      expect(result.valid).toBe(false);
    });

    it('should reject empty run IDs', () => {
      expect(validateToolInput('diff_runs', { runIdA: '', runIdB: 'run_2' }).valid).toBe(false);
      expect(validateToolInput('diff_runs', { runIdA: 'run_1', runIdB: '' }).valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isDiffRunsToolInput({ runIdA: 'a', runIdB: 'b' })).toBe(true);
      expect(isDiffRunsToolInput({ runIdA: 'a' })).toBe(false);
    });
  });

  describe('List Runs Tool Schema', () => {
    it('should validate default input', () => {
      const result = validateToolInput('list_runs', {});
      expect(result.valid).toBe(true);
    });

    it('should validate with workspace and limit', () => {
      const result = validateToolInput('list_runs', {
        workspace: '/tmp/workspace',
        limit: 10,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject non-positive limit', () => {
      const result = validateToolInput('list_runs', {
        workspace: '/tmp/workspace',
        limit: 0,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('Export Index Tool Schema', () => {
    it('should validate correct input', () => {
      const result = validateToolInput('export_index', {
        format: 'json',
        outputPath: '/output/index.json',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate all formats', () => {
      const formats = ['json', 'sqlite', 'scip', 'lsif'];
      for (const format of formats) {
        const result = validateToolInput('export_index', {
          format,
          outputPath: '/output/index',
        });
        expect(result.valid).toBe(true);
      }
    });

    it('should validate with all options', () => {
      const result = validateToolInput('export_index', {
        format: 'sqlite',
        outputPath: '/output/index.db',
        includeEmbeddings: true,
        scope: ['src/**/*.ts'],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing format', () => {
      const result = validateToolInput('export_index', { outputPath: '/test' });
      expect(result.valid).toBe(false);
    });

    it('should reject missing outputPath', () => {
      const result = validateToolInput('export_index', { format: 'json' });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid format', () => {
      const result = validateToolInput('export_index', {
        format: 'invalid',
        outputPath: '/test',
      });
      expect(result.valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isExportIndexToolInput({ format: 'json', outputPath: '/test' })).toBe(true);
      expect(isExportIndexToolInput({ format: 'json' })).toBe(false);
    });
  });

  describe('Get Context Pack Bundle Tool Schema', () => {
    it('should validate correct input', () => {
      const result = validateToolInput('get_context_pack_bundle', {
        entityIds: ['entity_1', 'entity_2'],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate with all options', () => {
      const result = validateToolInput('get_context_pack_bundle', {
        entityIds: ['entity_1'],
        bundleType: 'comprehensive',
        maxTokens: 50000,
        pageSize: 10,
        pageIdx: 1,
        outputFile: '/tmp/bundle.json',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate all bundle types', () => {
      const types = ['minimal', 'standard', 'comprehensive'];
      for (const bundleType of types) {
        const result = validateToolInput('get_context_pack_bundle', {
          entityIds: ['entity_1'],
          bundleType,
        });
        expect(result.valid).toBe(true);
      }
    });

    it('should reject missing entityIds', () => {
      const result = validateToolInput('get_context_pack_bundle', {});
      expect(result.valid).toBe(false);
    });

    it('should reject empty entityIds array', () => {
      const result = validateToolInput('get_context_pack_bundle', {
        entityIds: [],
      });
      expect(result.valid).toBe(false);
    });

    it('should reject maxTokens out of range', () => {
      expect(validateToolInput('get_context_pack_bundle', {
        entityIds: ['e1'],
        maxTokens: 50,
      }).valid).toBe(false);
      expect(validateToolInput('get_context_pack_bundle', {
        entityIds: ['e1'],
        maxTokens: 200000,
      }).valid).toBe(false);
    });

    it('should reject invalid pagination values', () => {
      expect(validateToolInput('get_context_pack_bundle', {
        entityIds: ['e1'],
        pageSize: 0,
      }).valid).toBe(false);
      expect(validateToolInput('get_context_pack_bundle', {
        entityIds: ['e1'],
        pageIdx: -1,
      }).valid).toBe(false);
    });

    it('should pass type guard', () => {
      expect(isGetContextPackBundleToolInput({ entityIds: ['e1'] })).toBe(true);
      expect(isGetContextPackBundleToolInput({ entityIds: [] })).toBe(true); // Array.isArray passes
      expect(isGetContextPackBundleToolInput({})).toBe(false);
    });
  });

  describe('List Tool Pagination Schema', () => {
    it('accepts page controls and outputFile for list_verification_plans', () => {
      const result = validateToolInput('list_verification_plans', {
        workspace: '/tmp/workspace',
        pageSize: 10,
        pageIdx: 2,
        outputFile: '/tmp/plans-page.json',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid page controls for list_verification_plans', () => {
      expect(validateToolInput('list_verification_plans', { pageSize: 0 }).valid).toBe(false);
      expect(validateToolInput('list_verification_plans', { pageIdx: -1 }).valid).toBe(false);
    });
  });

  describe('Unknown Tool', () => {
    it('should reject unknown tool names', () => {
      const result = validateToolInput('unknown_tool', { any: 'data' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('unknown_tool');
    });
  });

  describe('Parse Functions', () => {
    it('parseToolInput should return typed data', () => {
      const data = parseToolInput('bootstrap', { workspace: '/test' });
      expect(data.workspace).toBe('/test');
      expect(data.force).toBe(false); // default
    });

    it('parseToolInput should throw on invalid input', () => {
      expect(() => parseToolInput('bootstrap', {})).toThrow();
    });

    it('safeParseToolInput should return success result', () => {
      const result = safeParseToolInput('bootstrap', { workspace: '/test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workspace).toBe('/test');
      }
    });

    it('safeParseToolInput should return error result', () => {
      const result = safeParseToolInput('bootstrap', {});
      expect(result.success).toBe(false);
    });
  });

  describe('Validation Error Reporting', () => {
    it('should report multiple errors', () => {
      const result = validateToolInput('diff_runs', {});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should include path in errors', () => {
      const result = validateToolInput('query', { intent: '' });
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.path.includes('intent'));
      expect(error).toBeDefined();
    });

    it('should include error code', () => {
      const result = validateToolInput('bootstrap', {});
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBeDefined();
    });
  });
});
