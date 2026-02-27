/**
 * Tests for automatic repo docs update functionality.
 * TDD: These tests verify the docs_update module correctly updates
 * agent documentation files with librarian usage information.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { updateRepoDocs, isDocsUpdateNeeded, ejectInjectedDocs } from '../docs_update.js';
import type { BootstrapReport, BootstrapCapabilities } from '../../types.js';

describe('Docs Update Module', () => {
  let tempDir: string;

  // Create a minimal bootstrap report for testing
  function createTestReport(overrides: Partial<BootstrapReport> = {}): BootstrapReport {
    return {
      workspace: tempDir,
      version: { major: 1, minor: 0, patch: 0 },
      startedAt: new Date('2026-01-18T00:00:00Z'),
      completedAt: new Date('2026-01-18T00:01:00Z'),
      success: true,
      phases: [
        {
          phase: { name: 'structural_scan', description: 'Scan', parallel: false, targetDurationMs: 5000 },
          startedAt: new Date('2026-01-18T00:00:00Z'),
          completedAt: new Date('2026-01-18T00:00:01Z'),
          itemsProcessed: 100,
          durationMs: 1000,
          errors: [],
        },
        {
          phase: { name: 'context_packs', description: 'Packs', parallel: false, targetDurationMs: 5000 },
          startedAt: new Date('2026-01-18T00:00:01Z'),
          completedAt: new Date('2026-01-18T00:00:02Z'),
          itemsProcessed: 10,
          durationMs: 500,
          errors: [],
        },
      ],
      totalFilesProcessed: 100,
      totalFunctionsIndexed: 250,
      totalContextPacksCreated: 10,
      capabilities: {
        semanticSearch: true,
        llmEnrichment: true,
        functionData: true,
        structuralData: true,
        relationshipGraph: true,
        contextPacks: true,
      },
      warnings: [],
      statusSummary: 'Bootstrap completed successfully',
      ...overrides,
    } as BootstrapReport;
  }

  function createTestCapabilities(overrides: Partial<BootstrapCapabilities> = {}): BootstrapCapabilities {
    return {
      semanticSearch: true,
      llmEnrichment: true,
      functionData: true,
      structuralData: true,
      relationshipGraph: true,
      contextPacks: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-docs-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('updateRepoDocs', () => {
    it('should return filesSkipped when no agent docs exist', async () => {
      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toHaveLength(0);
      expect(result.filesSkipped).toContain('(no agent docs found)');
    });

    it('should append librarian section to AGENTS.md', async () => {
      // Create AGENTS.md without librarian section
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n\nExisting content here.\n');

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toContain('AGENTS.md');

      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('<!-- LIBRARIAN_DOCS_START -->');
      expect(content).toContain('<!-- LIBRARIAN_DOCS_END -->');
      expect(content).toContain('## LiBrainian: Codebase Knowledge System');
      expect(content).toContain('Existing content here.');
    });

    it('should update existing librarian section (idempotent)', async () => {
      // Create AGENTS.md with existing librarian section
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `# Agents

Some content.

<!-- LIBRARIAN_DOCS_START -->
Old librarian docs here.
<!-- LIBRARIAN_DOCS_END -->

More content after.
`);

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport({ totalFilesProcessed: 999 }),
        capabilities: createTestCapabilities(),
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toContain('AGENTS.md');

      const content = await fs.readFile(agentsPath, 'utf-8');
      // Should have replaced old content
      expect(content).not.toContain('Old librarian docs here.');
      expect(content).toContain('**Files processed**: 999');
      // Should preserve content around the section
      expect(content).toContain('Some content.');
      expect(content).toContain('More content after.');
    });

    it('should skip if section exists and skipIfExists is true', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `# Agents
<!-- LIBRARIAN_DOCS_START -->
Existing section.
<!-- LIBRARIAN_DOCS_END -->
`);

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
        skipIfExists: true,
      });

      expect(result.success).toBe(true);
      expect(result.filesSkipped).toContain('AGENTS.md');
      expect(result.filesUpdated).toHaveLength(0);

      // Content should be unchanged
      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('Existing section.');
    });

    it('should update multiple doc files (AGENTS.md, CLAUDE.md, docs/AGENTS.md)', async () => {
      // Create multiple doc files
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '# Agents\n');
      await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), '# Claude\n');
      await fs.mkdir(path.join(tempDir, 'docs'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'docs', 'AGENTS.md'), '# Docs Agents\n');

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toHaveLength(3);
      expect(result.filesUpdated).toContain('AGENTS.md');
      expect(result.filesUpdated).toContain('CLAUDE.md');
      expect(result.filesUpdated).toContain('docs/AGENTS.md');
    });

    it('should announce CLAUDE.md writes with section name and line count', async () => {
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, '# Claude\n\nProject notes.\n');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const result = await updateRepoDocs({
          workspace: tempDir,
          report: createTestReport(),
          capabilities: createTestCapabilities(),
        });

        expect(result.success).toBe(true);
        expect(result.filesUpdated).toContain('CLAUDE.md');
        const joined = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
        expect(joined).toContain('[librainian] Writing docs to CLAUDE.md');
        expect(joined).toContain('section: LIBRARIAN_DOCS');
        expect(joined).toContain('npx librainian eject-docs');
        expect(joined).toMatch(/,\s*\d+\s+lines\)/);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('should skip CLAUDE.md updates when noClaudeMd is enabled', async () => {
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(claudePath, '# Claude\n\nDo not modify.\n');
      await fs.writeFile(agentsPath, '# Agents\n\nSafe to modify.\n');

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
        noClaudeMd: true,
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toContain('AGENTS.md');
      expect(result.filesSkipped).toContain('CLAUDE.md');

      const claude = await fs.readFile(claudePath, 'utf-8');
      const agents = await fs.readFile(agentsPath, 'utf-8');
      expect(claude).not.toContain('LIBRARIAN_DOCS_START');
      expect(agents).toContain('LIBRARIAN_DOCS_START');
    });

    it('should store CLAUDE.md hash in .librarian/state.json after successful write', async () => {
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, '# Claude\n');

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      expect(result.success).toBe(true);
      const statePath = path.join(tempDir, '.librarian', 'state.json');
      const rawState = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(rawState) as {
        docs?: { claudeFileHashes?: Record<string, string> };
      };
      expect(state.docs?.claudeFileHashes?.['CLAUDE.md']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should skip CLAUDE.md overwrite when hash mismatches stored state', async () => {
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, '# Claude\n\nTrusted content.\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport({ totalFilesProcessed: 10 }),
        capabilities: createTestCapabilities(),
      });

      await fs.appendFile(claudePath, '\nUser edit after injection.\n');

      const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = await updateRepoDocs({
          workspace: tempDir,
          report: createTestReport({ totalFilesProcessed: 999 }),
          capabilities: createTestCapabilities(),
        });

        expect(result.filesSkipped).toContain('CLAUDE.md');
        expect(result.warnings.some((warning) => warning.includes('hash mismatch'))).toBe(true);
        const content = await fs.readFile(claudePath, 'utf-8');
        expect(content).not.toContain('**Files processed**: 999');
        expect(content).toContain('User edit after injection.');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('should not write files in dry run mode', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n');

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toContain('AGENTS.md');

      // Content should be unchanged
      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toBe('# Agents\n');
      expect(content).not.toContain('LIBRARIAN_DOCS_START');
    });

    it('should include available capabilities in generated content', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities({
          semanticSearch: true,
          contextPacks: true,
          llmEnrichment: false,
        }),
      });

      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('**Available**:');
      expect(content).toContain('semantic search');
      expect(content).toContain('context packs');
      expect(content).toContain('**Limited/Unavailable**:');
      expect(content).toContain('llm enrichment');
    });

    it('should include index statistics in generated content', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport({
          totalFilesProcessed: 150,
          totalFunctionsIndexed: 500,
          totalContextPacksCreated: 25,
        }),
        capabilities: createTestCapabilities(),
      });

      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('**Files processed**: 150');
      expect(content).toContain('**Functions indexed**: 500');
      expect(content).toContain('**Context packs**: 25');
    });

    it('should handle malformed sections gracefully (missing end marker)', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `# Agents

<!-- LIBRARIAN_DOCS_START -->
Broken section without end marker.
Some more content.
`);

      const result = await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      expect(result.success).toBe(true);
      expect(result.filesUpdated).toContain('AGENTS.md');

      const content = await fs.readFile(agentsPath, 'utf-8');
      // Should have fixed the section
      expect(content).toContain('<!-- LIBRARIAN_DOCS_START -->');
      expect(content).toContain('<!-- LIBRARIAN_DOCS_END -->');
    });
  });

  describe('isDocsUpdateNeeded', () => {
    it('should return true when no librarian section exists', async () => {
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '# Agents\n');

      const needed = await isDocsUpdateNeeded(tempDir);
      expect(needed).toBe(true);
    });

    it('should return false when librarian section already exists', async () => {
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), `# Agents
<!-- LIBRARIAN_DOCS_START -->
Section content.
<!-- LIBRARIAN_DOCS_END -->
`);

      const needed = await isDocsUpdateNeeded(tempDir);
      expect(needed).toBe(false);
    });

    it('should return false when no agent docs exist', async () => {
      // Empty workspace
      const needed = await isDocsUpdateNeeded(tempDir);
      expect(needed).toBe(false);
    });

    it('should check all known doc file patterns', async () => {
      // Create CLAUDE.md without section
      await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), '# Claude\n');

      const needed = await isDocsUpdateNeeded(tempDir);
      expect(needed).toBe(true);
    });
  });

  describe('ejectInjectedDocs', () => {
    it('removes injected sections from CLAUDE.md and is idempotent', async () => {
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, '# Claude\n\nUser intro.\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      const first = await ejectInjectedDocs({ workspace: tempDir });
      expect(first.success).toBe(true);
      expect(first.filesUpdated).toContain('CLAUDE.md');

      const contentAfterFirst = await fs.readFile(claudePath, 'utf-8');
      expect(contentAfterFirst).toContain('User intro.');
      expect(contentAfterFirst).not.toContain('LIBRARIAN_DOCS_START');
      expect(contentAfterFirst).not.toContain('LIBRARIAN_DOCS_END');

      const second = await ejectInjectedDocs({ workspace: tempDir });
      expect(second.success).toBe(true);
      expect(second.filesUpdated).toHaveLength(0);
      expect(second.filesSkipped).toContain('CLAUDE.md');
    });
  });

  describe('Generated Content Quality', () => {
    it('should include usage code examples', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain("import { initializeLibrarian } from 'librainian'");
      expect(content).toContain('const librainian = await initializeLibrarian(workspaceRoot)');
      expect(content).toContain('librainian.query');
    });

    it('should include reindex instructions', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('npx librainian reindex --force');
      expect(content).toContain('When to Re-index');
    });

    it('should include documentation references', async () => {
      const agentsPath = path.join(tempDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, '# Agents\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('docs/librarian/README.md');
      expect(content).toContain('docs/librarian/API.md');
    });

    it('should include behavioral scaffolding and MCP tool guidance', async () => {
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, '# Claude\n');

      await updateRepoDocs({
        workspace: tempDir,
        report: createTestReport(),
        capabilities: createTestCapabilities(),
      });

      const content = await fs.readFile(claudePath, 'utf-8');
      expect(content).toContain('### When to Use LiBrainian Tools');
      expect(content).toContain('ALWAYS call `query` before');
      expect(content).toContain('Do NOT use `query` when');
      expect(content).toContain('### Available MCP Tools (quick summary)');
      expect(content).toContain('`query(intent, intentType)`');
      expect(content).toContain('`find_symbol(query)`');
      expect(content).toContain('`get_context_pack_bundle(entityIds, maxTokens)`');
      expect(content).toContain('`verify_claim(claimId)`');
      expect(content).toContain('`status()`');
      expect(content).toContain('`bootstrap(workspace)`');
      expect(content).toContain('`intentType` values');
      expect(content).toContain('`depth`');
    });
  });
});
