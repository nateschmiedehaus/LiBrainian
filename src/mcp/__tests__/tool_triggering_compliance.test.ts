import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

type ToolEntry = {
  name: string;
  description?: string;
};

type TriggerCase = {
  tool: string;
  prompt: string;
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'we', 'with', 'you', 'your',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/`[^`]+`/g, ' ')
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function buildTriggerPrompts(tool: ToolEntry): string[] {
  const base = (tool.description ?? '')
    .replace(/`[^`]+`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = base.split(/[.!?]/)[0]?.trim() ?? '';
  const scrubbed = firstSentence
    .replace(new RegExp(tool.name.replace(/_/g, ' '), 'ig'), '')
    .replace(/\b(use|tool|call|invoke)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  const intent = scrubbed.length > 0 ? scrubbed : `handle ${tool.name.replace(/_/g, ' ')}`;
  const normalizedIntent = intent.toLowerCase();
  return [
    `I need to ${normalizedIntent}. Which operation should I run first?`,
    `Help me ${normalizedIntent}. What tool fits this best?`,
    `What's the correct operation to ${normalizedIntent}?`,
    `I am trying to ${normalizedIntent}. Which command should I call?`,
    `Pick the right LiBrainian operation for: ${normalizedIntent}.`,
  ];
}

function scoreTool(tool: ToolEntry, promptTokens: Set<string>, includeDescription: boolean): number {
  const nameTokens = tokenize(tool.name.replace(/_/g, ' '));
  const descTokens = includeDescription ? tokenize(tool.description ?? '') : [];

  let score = 0;
  for (const token of nameTokens) {
    if (promptTokens.has(token)) score += 3;
  }
  for (const token of descTokens) {
    if (promptTokens.has(token)) score += 1;
  }
  return score;
}

function classifyTool(
  tools: ToolEntry[],
  prompt: string,
  includeDescription: boolean
): string {
  const promptTokens = new Set(tokenize(prompt));
  const ranked = tools
    .map((tool) => ({
      tool: tool.name,
      score: scoreTool(tool, promptTokens, includeDescription),
    }))
    .sort((a, b) => (b.score - a.score) || a.tool.localeCompare(b.tool));
  return ranked[0]?.tool ?? '';
}

describe('MCP tool triggering compliance', () => {
  it('maintains >=70% trigger compliance with per-tool baseline/treatment evaluation', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write', 'execute', 'network', 'admin'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const tools = ((server as any).getAvailableTools() as ToolEntry[])
      .map((tool) => ({ name: tool.name, description: tool.description ?? '' }));
    const cases: TriggerCase[] = tools.flatMap((tool) =>
      buildTriggerPrompts(tool).map((prompt) => ({ tool: tool.name, prompt }))
    );

    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.length).toBe(tools.length * 5);

    let treatmentHits = 0;
    let baselineHits = 0;
    const misses: string[] = [];
    const perTool = new Map<string, { treatmentHits: number; baselineHits: number; total: number }>();

    for (const tool of tools) {
      perTool.set(tool.name, { treatmentHits: 0, baselineHits: 0, total: 0 });
    }

    for (const testCase of cases) {
      const treatment = classifyTool(tools, testCase.prompt, true);
      const baseline = classifyTool(tools, testCase.prompt, false);
      const stats = perTool.get(testCase.tool)!;
      stats.total += 1;
      if (treatment === testCase.tool) {
        treatmentHits += 1;
        stats.treatmentHits += 1;
      } else {
        misses.push(`${testCase.tool} -> ${treatment}`);
      }
      if (baseline === testCase.tool) {
        baselineHits += 1;
        stats.baselineHits += 1;
      }
    }

    const compliance = treatmentHits / cases.length;
    const toolsAtTarget = Array.from(perTool.values())
      .filter((stats) => stats.total > 0 && (stats.treatmentHits / stats.total) >= 0.7).length;
    const baselineCompliance = baselineHits / cases.length;
    console.log(
      `[compliance] tools=${tools.length} cases=${cases.length} treatment=${(compliance * 100).toFixed(1)}% baseline=${(baselineCompliance * 100).toFixed(1)}% tools>=70=${toolsAtTarget}`
    );
    expect(perTool.size).toBe(tools.length);
    expect(toolsAtTarget).toBeGreaterThanOrEqual(5);
    expect(compliance).toBeGreaterThanOrEqual(0.7);
    expect(treatmentHits).toBeGreaterThanOrEqual(baselineHits);
    if (compliance < 0.7) {
      throw new Error(`Trigger compliance below threshold: ${(compliance * 100).toFixed(1)}%; misses=${misses.join(', ')}`);
    }
  });
});
