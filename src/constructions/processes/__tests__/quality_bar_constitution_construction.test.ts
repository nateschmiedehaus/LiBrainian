import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createQualityBarConstitutionConstruction,
  evaluateNormGuidedDepth,
  regenerateQualityBarConstitution,
  selectQualityNormsForTask,
  type QualityBarConstitution,
} from '../quality_bar_constitution_construction.js';

describe('QualityBarConstitutionConstruction', () => {
  let tempDir = '';
  let outputPath = '';
  let constitution: QualityBarConstitution;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-quality-bar-'));
    outputPath = path.join(tempDir, 'quality-bar-constitution.json');
    const construction = createQualityBarConstitutionConstruction();
    const result = await construction.execute({
      workspace: process.cwd(),
      outputPath,
      forceRegenerate: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }
    constitution = result.value.constitution;
  }, 60000);

  afterAll(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('generates a constitution JSON file with at least twenty mined conventions', async () => {
    expect(constitution.version).toBe('1.0.0');
    expect(constitution.project.length).toBeGreaterThan(0);
    expect(constitution.sourceFileCount).toBeGreaterThan(0);
    expect(constitution.conventions.length).toBeGreaterThanOrEqual(20);
    const diskJson = JSON.parse(await fs.readFile(outputPath, 'utf8')) as QualityBarConstitution;
    expect(diskJson.conventions.length).toBeGreaterThanOrEqual(20);
  });

  it('maps MUST/SHOULD/MAY exactly from mined frequency thresholds', () => {
    for (const convention of constitution.conventions) {
      if (convention.evidence.frequency > 0.9) {
        expect(convention.level).toBe('MUST');
      } else if (convention.evidence.frequency > 0.7) {
        expect(convention.level).toBe('SHOULD');
      } else {
        expect(convention.level).toBe('MAY');
      }
    }
  });

  it('selects three to five task-relevant quality norms for targeted files', () => {
    const selected = selectQualityNormsForTask({
      constitution,
      filesToModify: ['src/integration/agent_hooks.ts', 'src/integration/__tests__/agent_hooks.test.ts'],
      taskType: 'feature_implementation',
    });
    expect(selected.length).toBeGreaterThanOrEqual(3);
    expect(selected.length).toBeLessThanOrEqual(5);
    expect(selected[0]?.score ?? 0).toBeGreaterThan(0);
  });

  it('supports explicit on-demand regeneration that re-mines and rewrites output', async () => {
    const previousGeneratedAt = constitution.generatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const regenerated = await regenerateQualityBarConstitution(process.cwd(), { outputPath });
    expect(regenerated.generatedAt).not.toBe(previousGeneratedAt);
    const diskJson = JSON.parse(await fs.readFile(outputPath, 'utf8')) as QualityBarConstitution;
    expect(diskJson.generatedAt).toBe(regenerated.generatedAt);
  });

  it('shows higher implementation-depth signal when constitution norms are present', () => {
    const selected = selectQualityNormsForTask({
      constitution,
      filesToModify: ['src/constructions/processes/quality_bar_constitution_construction.ts'],
      taskType: 'feature_implementation',
    });
    const depth = evaluateNormGuidedDepth('Implement constitution-aware agent context injection', selected);
    expect(depth.withNorms).toBeGreaterThan(depth.withoutNorms);
    expect(depth.improvement).toBeGreaterThan(0);
  });

  it('ignores transient librarian backup directories when mining source files', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-quality-bar-workspace-'));
    const localOutput = path.join(workspace, '.librarian', 'constitution.json');
    const backupDir = path.join(workspace, '.librarian.backup.v0.test');

    try {
      await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(path.join(workspace, 'src', 'main.ts'), 'export function runTask() { return 1; }\n', 'utf8');
      await fs.writeFile(path.join(backupDir, 'stale.ts'), 'export const stale = true;\n', 'utf8');

      const regenerated = await regenerateQualityBarConstitution(workspace, { outputPath: localOutput });
      expect(regenerated.sourceFileCount).toBe(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
