import { describe, expect, it } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import { type ConstructionError } from '../base/construction_base.js';
import { toMCPTool } from '../mcp_bridge.js';
import { ok, type Construction, type ConstructionManifest } from '../types.js';

type TestInput = { value: number };
type TestOutput = {
  data: number;
  confidence: ReturnType<typeof deterministic>;
  evidenceRefs: string[];
  analysisTimeMs: number;
  predictionId: string;
};

const TEST_CONSTRUCTION_ID = 'librainian:security-audit-helper' as const;

function makeManifest(
  construction: Construction<TestInput, TestOutput, ConstructionError, Record<string, unknown>>,
): ConstructionManifest {
  return {
    id: TEST_CONSTRUCTION_ID,
    name: 'MCP Bridge Test Construction',
    scope: '@librainian',
    version: '1.0.0',
    description: 'Bridge test construction',
    agentDescription: 'Use this construction to validate MCP bridge behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number' },
      },
      required: ['value'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        data: { type: 'number' },
      },
      required: ['data'],
      additionalProperties: true,
    },
    requiredCapabilities: [],
    tags: ['test'],
    trustTier: 'official',
    examples: [
      {
        description: 'Doubles an input number.',
        input: { value: 2 },
        expectedOutputSummary: 'Returns doubled number.',
      },
    ],
    construction: construction as Construction<unknown, unknown, ConstructionError, unknown>,
    available: true,
  };
}

describe('toMCPTool', () => {
  it('returns success payload with confidence and evidence refs for valid input', async () => {
    const construction: Construction<TestInput, TestOutput, ConstructionError, Record<string, unknown>> = {
      id: TEST_CONSTRUCTION_ID,
      name: 'MCP Bridge Test Construction',
      async execute(input: TestInput) {
        return ok({
          data: input.value * 2,
          confidence: deterministic(true, 'mcp_bridge_test'),
          evidenceRefs: ['evidence:test:1'],
          analysisTimeMs: 7,
          predictionId: 'pred-bridge-1',
        });
      },
    };
    const manifest = makeManifest(construction);

    const tool = toMCPTool(construction, manifest, {});
    const response = await tool.execute({ value: 21 });

    expect(response.isError).toBe(false);
    const payload = JSON.parse(response.content[0].text) as Record<string, unknown>;
    expect(payload.constructionId).toBe(TEST_CONSTRUCTION_ID);
    expect((payload.result as { data: number }).data).toBe(42);
    expect(payload.evidenceRefs).toEqual(['evidence:test:1']);
    expect(typeof payload.analysisTimeMs).toBe('number');
    expect(typeof payload.confidence === 'number' || typeof payload.confidence === 'object').toBe(true);
  });

  it('returns schema-referenced validation failure for invalid input', async () => {
    const construction: Construction<TestInput, TestOutput, ConstructionError, Record<string, unknown>> = {
      id: TEST_CONSTRUCTION_ID,
      name: 'MCP Bridge Test Construction',
      async execute(input: TestInput) {
        return ok({
          data: input.value * 2,
          confidence: deterministic(true, 'mcp_bridge_test'),
          evidenceRefs: [],
          analysisTimeMs: 1,
          predictionId: 'pred-bridge-2',
        });
      },
    };
    const manifest = makeManifest(construction);

    const tool = toMCPTool(construction, manifest, {});
    const response = await tool.execute({});

    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0].text) as Record<string, unknown>;
    expect(payload.error).toBe('INPUT_VALIDATION_FAILED');
    expect(payload.schemaRef).toBe(`construction:${TEST_CONSTRUCTION_ID}:input`);
    expect(Array.isArray(payload.validationFailures)).toBe(true);
    expect((payload.validationFailures as string[]).some((issue) => issue.includes('required property is missing'))).toBe(true);
  });

  it('exposes executeStream for incremental MCP event delivery', async () => {
    const construction: Construction<TestInput, TestOutput, ConstructionError, Record<string, unknown>> = {
      id: TEST_CONSTRUCTION_ID,
      name: 'MCP Bridge Streaming Construction',
      async execute(input: TestInput) {
        return ok({
          data: input.value * 2,
          confidence: deterministic(true, 'mcp_bridge_streaming'),
          evidenceRefs: [],
          analysisTimeMs: 3,
          predictionId: 'pred-bridge-stream',
        });
      },
      stream: async function* (input: TestInput) {
        yield { kind: 'progress', step: 'start', percentComplete: 50 };
        yield {
          kind: 'completed',
          result: {
            data: input.value * 2,
            confidence: deterministic(true, 'mcp_bridge_streaming'),
            evidenceRefs: [],
            analysisTimeMs: 3,
            predictionId: 'pred-bridge-stream',
          },
        };
      },
    };
    const manifest = makeManifest(construction);
    const tool = toMCPTool(construction, manifest, {});

    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of tool.executeStream({ value: 9 })) {
      chunks.push(JSON.parse(chunk.content[0].text) as Record<string, unknown>);
    }

    expect(chunks.length).toBe(2);
    expect(((chunks[0].event as { kind: string }).kind)).toBe('progress');
    expect((chunks[1].result as { data: number }).data).toBe(18);
  });
});
