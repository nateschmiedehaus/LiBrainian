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

function buildTriggerPrompt(tool: ToolEntry): string {
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
  return `I need to ${intent.toLowerCase()}. Which operation should I run first?`;
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
  it('maintains >=70% trigger compliance with one natural-language case per tool', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write', 'execute', 'network', 'admin'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const tools = ((server as any).getAvailableTools() as ToolEntry[])
      .map((tool) => ({ name: tool.name, description: tool.description ?? '' }));
    const cases: TriggerCase[] = tools.map((tool) => ({
      tool: tool.name,
      prompt: buildTriggerPrompt(tool),
    }));

    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.length).toBe(tools.length);

    let treatmentHits = 0;
    let baselineHits = 0;
    const misses: string[] = [];

    for (const testCase of cases) {
      const treatment = classifyTool(tools, testCase.prompt, true);
      const baseline = classifyTool(tools, testCase.prompt, false);
      if (treatment === testCase.tool) {
        treatmentHits += 1;
      } else {
        misses.push(`${testCase.tool} -> ${treatment}`);
      }
      if (baseline === testCase.tool) {
        baselineHits += 1;
      }
    }

    const compliance = treatmentHits / cases.length;
    expect(compliance).toBeGreaterThanOrEqual(0.7);
    expect(treatmentHits).toBeGreaterThanOrEqual(baselineHits);
    if (compliance < 0.7) {
      throw new Error(`Trigger compliance below threshold: ${(compliance * 100).toFixed(1)}%; misses=${misses.join(', ')}`);
    }
  });
});
