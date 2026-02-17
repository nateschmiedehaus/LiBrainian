/**
 * Tests for automatic repo docs update functionality.
 * TDD: These tests verify the docs_update module correctly updates
 * agent documentation files with librarian usage information.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { updateRepoDocs, isDocsUpdateNeeded } from '../docs_update.js';
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
      expect(content).toContain('## Librarian: Codebase Knowledge System');
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
      expect(content).toContain("import { getLibrarian } from 'librainian'");
      expect(content).toContain('const librarian = await getLibrarian(workspaceRoot)');
      expect(content).toContain('librarian.query');
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
      expect(content).toContain('src/librarian/api/README.md');
      expect(content).toContain('docs/librarian/query-guide.md');
    });
  });
});
