import { describe, expect, it } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import { createConstruction } from '../../constructions/composition.js';
import { createLibrarianMCPServer } from '../server.js';

const GENERATED_ID = '@librainian-community/mcp-invoke-registry-test';

describe('MCP construction registry tools', () => {
  it('lists constructions and includes runtime-generated entries', async () => {
    createConstruction(
      'mcp-invoke-registry-test',
      'MCP Invoke Registry Test',
      async (input: number) => ({
        data: input * 2,
        confidence: deterministic(true, 'mcp_test'),
      }),
    );

    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const results = await (server as any).executeListConstructions({
      tags: ['runtime'],
      availableOnly: true,
    });

    expect(results.count).toBeGreaterThan(0);
    expect(Array.isArray(results.constructions)).toBe(true);
    expect(results.hint).toContain('describe_construction');
    expect(results.constructions.some((manifest: { id: string }) => manifest.id === GENERATED_ID)).toBe(true);
    expect(results.constructions[0]).toHaveProperty('inputType');
    expect(results.constructions[0]).toHaveProperty('outputType');
  });

  it('invokes a registered runtime construction by id', async () => {
    createConstruction(
      'mcp-invoke-registry-test',
      'MCP Invoke Registry Test',
      async (input: number) => ({
        data: input * 2,
        confidence: deterministic(true, 'mcp_test'),
      }),
    );

    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const result = await (server as any).executeInvokeConstruction({
      constructionId: GENERATED_ID,
      input: 21,
    });

    expect(result.success).toBe(true);
    expect(result.constructionId).toBe(GENERATED_ID);
    expect(result.result.data).toBe(42);
  });

  it('rejects unknown construction IDs with an actionable error', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    await expect(
      (server as any).executeInvokeConstruction({
        constructionId: 'librainian:not-real',
        input: {},
      }),
    ).rejects.toThrow(/Unknown Construction ID/i);
  });

  it('describes a construction with example and composition hints', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const result = await (server as any).executeDescribeConstruction({
      id: 'librainian:security-audit-helper',
      includeExample: true,
      includeCompositionHints: true,
    });

    expect(result.id).toBe('librainian:security-audit-helper');
    expect(typeof result.agentDescription).toBe('string');
    expect(result.agentDescription.length).toBeGreaterThan(0);
    expect(typeof result.inputType).toBe('string');
    expect(typeof result.outputType).toBe('string');
    expect(typeof result.example).toBe('string');
    expect(result.example).toContain('.execute');
    expect(Array.isArray(result.compositionHints?.goodWith)).toBe(true);
    expect(result.compositionHints?.operator).toContain('seq');
  });

  it('recommends an operator when explain_operator receives only situation text', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const result = await (server as any).executeExplainOperator({
      situation: 'I need to run call graph lookup and test coverage query in parallel',
    });

    expect(result.recommendation).toBe('fanout');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    expect(typeof result.example).toBe('string');
  });

  it('returns compatibility guidance for check_construction_types', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const compatible = await (server as any).executeCheckConstructionTypes({
      first: 'librainian:security-audit-helper',
      second: 'librainian:comprehensive-quality-construction',
      operator: 'seq',
    });

    expect(compatible).toHaveProperty('compatible');
    expect(typeof compatible.compatible).toBe('boolean');
    if (compatible.compatible) {
      expect(typeof compatible.seam).toBe('string');
    } else {
      expect(Array.isArray(compatible.suggestions)).toBe(true);
      expect(compatible.suggestions.length).toBeGreaterThan(0);
    }
  });

  it('publishes construction discovery tools in tools/list', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const tools = (server as any).getAvailableTools().map((tool: { name: string }) => tool.name);
    expect(tools).toContain('list_constructions');
    expect(tools).toContain('describe_construction');
    expect(tools).toContain('explain_operator');
    expect(tools).toContain('check_construction_types');
  });
});
