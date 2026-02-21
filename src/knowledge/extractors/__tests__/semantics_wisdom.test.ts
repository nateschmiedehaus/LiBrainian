import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLlmServiceAdapter } from '../../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../../api/llm_env.js';
import { buildLlmEvidence } from '../llm_evidence.js';

vi.mock('../../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: vi.fn(),
}));

vi.mock('../../../api/llm_env.js', () => ({
  resolveLibrarianModelId: vi.fn(),
}));

vi.mock('../llm_evidence.js', () => ({
  buildLlmEvidence: vi.fn(),
}));

describe('extractSemanticsWithLLM wisdom extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLibrarianModelId).mockReturnValue('codex-medium');
    vi.mocked(buildLlmEvidence).mockResolvedValue({
      provider: 'codex',
      modelId: 'codex-medium',
      promptDigest: 'digest',
      timestamp: new Date().toISOString(),
    });
  });

  it('requests wisdom in system prompt and parses wisdom from LLM JSON', async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: 'codex',
      content: JSON.stringify({
        purpose: {
          summary: 'Coordinates dependency graph updates.',
          explanation: 'Keeps graph edges in sync after edits.',
          problemSolved: 'Prevents stale call/dependency graph state.',
          valueProp: 'Avoids incorrect impact analysis.',
        },
        domain: {
          concepts: ['dependency graph', 'index freshness'],
          boundedContext: 'indexing',
          businessRules: ['Graph updates must be deterministic'],
        },
        intent: {
          primaryUseCase: 'Rebuild affected graph edges after file changes.',
          secondaryUseCases: ['Incremental maintenance'],
          antiUseCases: ['Not a full index bootstrap command'],
        },
        mechanism: {
          explanation: 'Computes changed symbols and rewires edges.',
          algorithm: 'Incremental graph update',
          approach: 'Diff-based graph invalidation + rebuild',
          patterns: ['pipeline'],
        },
        complexity: {
          time: 'O(changed_edges)',
          space: 'O(changed_nodes)',
          cognitive: 'complex',
        },
        wisdom: {
          gotchas: ['Callers can be stale if file moves are not reindexed.'],
          tips: ['Always run index refresh before impact analysis.'],
          tribal: ['Team treats graph rebuild warnings as release-blocking.'],
          learningPath: [
            { order: 1, description: 'Start with invalidateGraphForFile().' },
            { order: 2, description: 'Then follow edge reconstruction pipeline.' },
          ],
        },
      }),
    });

    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const { extractSemanticsWithLLM } = await import('../semantics.js');
    const result = await extractSemanticsWithLLM(
      {
        name: 'refreshGraphEdges',
        filePath: 'src/graphs/refresh.ts',
        signature: 'function refreshGraphEdges(changedFiles: string[]): Promise<void>',
        content: 'export async function refreshGraphEdges(changedFiles: string[]) { /* ... */ }',
      },
      { llmProvider: 'codex' }
    );

    expect(chat).toHaveBeenCalledTimes(1);
    const call = chat.mock.calls[0][0];
    expect(call.messages[0]?.content).toContain('"wisdom"');
    expect(call.messages[0]?.content).toContain('"gotchas"');
    expect(call.messages[0]?.content).toContain('"learningPath"');

    expect(result.wisdom?.gotchas).toEqual(['Callers can be stale if file moves are not reindexed.']);
    expect(result.wisdom?.tips).toEqual(['Always run index refresh before impact analysis.']);
    expect(result.wisdom?.tribal).toEqual(['Team treats graph rebuild warnings as release-blocking.']);
    expect(result.wisdom?.learningPath).toEqual([
      { order: 1, description: 'Start with invalidateGraphForFile().' },
      { order: 2, description: 'Then follow edge reconstruction pipeline.' },
    ]);
  });

  it('defaults wisdom fields when absent from LLM response', async () => {
    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        provider: 'codex',
        content: JSON.stringify({
          purpose: {
            summary: 'Parses function signatures.',
            explanation: 'Extracts name and params.',
            problemSolved: 'Avoids ad-hoc parsing in callers.',
            valueProp: 'Consistent signature metadata.',
          },
          domain: {
            concepts: ['parser'],
            boundedContext: 'analysis',
            businessRules: [],
          },
          intent: {
            primaryUseCase: 'Signature parsing',
            secondaryUseCases: [],
            antiUseCases: [],
          },
          mechanism: {
            explanation: 'Regex + token checks.',
            algorithm: 'N/A',
            approach: 'Pattern matching',
            patterns: [],
          },
          complexity: {
            time: 'O(n)',
            space: 'O(1)',
            cognitive: 'simple',
          },
        }),
      }),
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const { extractSemanticsWithLLM } = await import('../semantics.js');
    const result = await extractSemanticsWithLLM(
      {
        name: 'parseSignature',
        filePath: 'src/parser/signature.ts',
      },
      { llmProvider: 'codex' }
    );

    expect(result.wisdom).toEqual({
      gotchas: [],
      tips: [],
      tribal: [],
      learningPath: [],
    });
  });
});
