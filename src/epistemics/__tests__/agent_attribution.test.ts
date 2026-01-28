/**
 * @fileoverview Tests for Agent Attribution Validation (WU-THIMPL-109)
 *
 * Tests cover:
 * - Required agent attribution for LLM/tool sources
 * - Warning behavior (default)
 * - Throwing behavior (configurable)
 * - Validation bypass for trusted sources
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SqliteEvidenceLedger,
  validateAgentAttribution,
  MissingAgentAttributionError,
  DEFAULT_AGENT_ATTRIBUTION_CONFIG,
  type EvidenceProvenance,
  type ExtractionEvidence,
  type SynthesisEvidence,
  type ToolCallEvidence,
} from '../evidence_ledger.js';

describe('Agent Attribution Validation (WU-THIMPL-109)', () => {
  describe('validateAgentAttribution', () => {
    it('should pass validation for llm_synthesis with agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
        agent: {
          type: 'llm',
          identifier: 'claude-3-opus',
          version: '2024-01-01',
        },
      };

      const result = validateAgentAttribution(provenance);

      expect(result).toBe(true);
    });

    it('should pass validation for tool_output with agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'tool_output',
        method: 'code-search',
        agent: {
          type: 'tool',
          identifier: 'ripgrep',
          version: '14.0.0',
        },
      };

      const result = validateAgentAttribution(provenance);

      expect(result).toBe(true);
    });

    it('should fail validation for llm_synthesis without agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
      };

      const warnings: string[] = [];
      const result = validateAgentAttribution(
        provenance,
        DEFAULT_AGENT_ATTRIBUTION_CONFIG,
        (_source, message) => warnings.push(message)
      );

      expect(result).toBe(false);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('llm_synthesis');
    });

    it('should fail validation for tool_output without agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'tool_output',
        method: 'search',
      };

      const warnings: string[] = [];
      const result = validateAgentAttribution(
        provenance,
        DEFAULT_AGENT_ATTRIBUTION_CONFIG,
        (_source, message) => warnings.push(message)
      );

      expect(result).toBe(false);
      expect(warnings[0]).toContain('tool_output');
    });

    it('should pass validation for ast_parser without agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'ast_parser',
        method: 'typescript-parser',
      };

      const result = validateAgentAttribution(provenance);

      expect(result).toBe(true);
    });

    it('should pass validation for user_input without agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'user_input',
        method: 'direct-input',
      };

      const result = validateAgentAttribution(provenance);

      expect(result).toBe(true);
    });

    it('should pass validation for system_observation without agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'system_observation',
        method: 'file-watcher',
      };

      const result = validateAgentAttribution(provenance);

      expect(result).toBe(true);
    });

    it('should pass validation for embedding_search without agent', () => {
      const provenance: EvidenceProvenance = {
        source: 'embedding_search',
        method: 'vector-search',
      };

      const result = validateAgentAttribution(provenance);

      expect(result).toBe(true);
    });

    it('should fail validation for empty agent identifier', () => {
      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
        agent: {
          type: 'llm',
          identifier: '', // Empty
        },
      };

      const warnings: string[] = [];
      const result = validateAgentAttribution(
        provenance,
        DEFAULT_AGENT_ATTRIBUTION_CONFIG,
        (_source, message) => warnings.push(message)
      );

      expect(result).toBe(false);
    });

    it('should fail validation for whitespace-only identifier', () => {
      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
        agent: {
          type: 'llm',
          identifier: '   ',
        },
      };

      const warnings: string[] = [];
      const result = validateAgentAttribution(
        provenance,
        DEFAULT_AGENT_ATTRIBUTION_CONFIG,
        (_source, message) => warnings.push(message)
      );

      expect(result).toBe(false);
    });

    it('should throw when throwOnMissing is true', () => {
      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
      };

      expect(() =>
        validateAgentAttribution(provenance, {
          enforceAttribution: true,
          throwOnMissing: true,
        })
      ).toThrow(MissingAgentAttributionError);
    });

    it('should not throw when enforceAttribution is false', () => {
      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
      };

      const result = validateAgentAttribution(provenance, {
        enforceAttribution: false,
        throwOnMissing: true,
      });

      expect(result).toBe(true);
    });

    it('should use console.warn when no warning callback provided', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const provenance: EvidenceProvenance = {
        source: 'llm_synthesis',
        method: 'analysis',
      };

      validateAgentAttribution(provenance);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('WARNING');

      consoleSpy.mockRestore();
    });
  });

  describe('SqliteEvidenceLedger integration', () => {
    let ledger: SqliteEvidenceLedger;
    let dbPath: string;

    beforeEach(async () => {
      dbPath = path.join(os.tmpdir(), `test-attribution-${Date.now()}.db`);
    });

    afterEach(async () => {
      if (ledger) {
        await ledger.close();
      }
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    });

    it('should record warnings for missing attribution', async () => {
      // Mock console.warn to prevent noise in test output
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      ledger = new SqliteEvidenceLedger(dbPath);
      await ledger.initialize();

      await ledger.append({
        kind: 'synthesis',
        payload: {
          request: 'analyze code',
          output: 'analysis result',
          model: { provider: 'test', modelId: 'test-model' },
          tokens: { input: 100, output: 50 },
          synthesisType: 'analysis',
        } satisfies SynthesisEvidence,
        provenance: {
          source: 'llm_synthesis',
          method: 'test',
          // Missing agent
        },
        relatedEntries: [],
      });

      const warnings = ledger.getAttributionWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0].source).toBe('llm_synthesis');

      vi.restoreAllMocks();
    });

    it('should throw when configured', async () => {
      ledger = new SqliteEvidenceLedger(dbPath, {
        enforceAttribution: true,
        throwOnMissing: true,
      });
      await ledger.initialize();

      await expect(
        ledger.append({
          kind: 'synthesis',
          payload: {
            request: 'analyze code',
            output: 'analysis result',
            model: { provider: 'test', modelId: 'test-model' },
            tokens: { input: 100, output: 50 },
            synthesisType: 'analysis',
          } satisfies SynthesisEvidence,
          provenance: {
            source: 'llm_synthesis',
            method: 'test',
          },
          relatedEntries: [],
        })
      ).rejects.toThrow(MissingAgentAttributionError);
    });

    it('should not warn when agent is provided', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      ledger = new SqliteEvidenceLedger(dbPath);
      await ledger.initialize();

      await ledger.append({
        kind: 'synthesis',
        payload: {
          request: 'analyze code',
          output: 'analysis result',
          model: { provider: 'test', modelId: 'test-model' },
          tokens: { input: 100, output: 50 },
          synthesisType: 'analysis',
        } satisfies SynthesisEvidence,
        provenance: {
          source: 'llm_synthesis',
          method: 'test',
          agent: {
            type: 'llm',
            identifier: 'test-model',
          },
        },
        relatedEntries: [],
      });

      const warnings = ledger.getAttributionWarnings();
      expect(warnings).toHaveLength(0);

      vi.restoreAllMocks();
    });

    it('should validate in appendBatch', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      ledger = new SqliteEvidenceLedger(dbPath);
      await ledger.initialize();

      await ledger.appendBatch([
        {
          kind: 'tool_call',
          payload: {
            toolName: 'search',
            arguments: {},
            result: null,
            success: true,
            durationMs: 100,
          } satisfies ToolCallEvidence,
          provenance: {
            source: 'tool_output',
            method: 'search',
            // Missing agent
          },
          relatedEntries: [],
        },
        {
          kind: 'tool_call',
          payload: {
            toolName: 'grep',
            arguments: {},
            result: null,
            success: true,
            durationMs: 50,
          } satisfies ToolCallEvidence,
          provenance: {
            source: 'tool_output',
            method: 'grep',
            // Also missing agent
          },
          relatedEntries: [],
        },
      ]);

      const warnings = ledger.getAttributionWarnings();
      expect(warnings).toHaveLength(2);

      vi.restoreAllMocks();
    });

    it('should clear warnings on request', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      ledger = new SqliteEvidenceLedger(dbPath);
      await ledger.initialize();

      await ledger.append({
        kind: 'synthesis',
        payload: {
          request: 'test',
          output: 'test',
          model: { provider: 'test', modelId: 'test' },
          tokens: { input: 1, output: 1 },
          synthesisType: 'summary',
        } satisfies SynthesisEvidence,
        provenance: {
          source: 'llm_synthesis',
          method: 'test',
        },
        relatedEntries: [],
      });

      expect(ledger.getAttributionWarnings()).toHaveLength(1);

      ledger.clearAttributionWarnings();

      expect(ledger.getAttributionWarnings()).toHaveLength(0);

      vi.restoreAllMocks();
    });

    it('should not warn for trusted sources', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      ledger = new SqliteEvidenceLedger(dbPath);
      await ledger.initialize();

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: {
          source: 'ast_parser', // Trusted source
          method: 'typescript-parser',
        },
        relatedEntries: [],
      });

      const warnings = ledger.getAttributionWarnings();
      expect(warnings).toHaveLength(0);

      vi.restoreAllMocks();
    });
  });

  describe('MissingAgentAttributionError', () => {
    it('should include source in error', () => {
      const error = new MissingAgentAttributionError('llm_synthesis', 'Test context');

      expect(error.source).toBe('llm_synthesis');
      expect(error.context).toBe('Test context');
      expect(error.message).toContain('llm_synthesis');
    });

    it('should have correct error name', () => {
      const error = new MissingAgentAttributionError('tool_output', 'Context');

      expect(error.name).toBe('MissingAgentAttributionError');
    });
  });
});
